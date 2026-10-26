import { expect, test, type Page } from '@playwright/test'
import { serve } from '@hono/node-server'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { loadAiConfig } from '../services/ai/config'
import { createAiApp, connectionInfo } from '../services/ai/app'
import { TaskStore } from '../services/ai/store'
import { TaskEngine } from '../services/ai/engine'
import type { ProviderAdapter, ProviderCompletion, ProviderInput, ProviderToolCall } from '../services/ai/provider-types'
import type { CreateTaskRequest, TaskSnapshot } from '../src/shared/ai/protocol'
import type { Workspace } from '../src/application/workspace/workspace'

// Real UI/HTTP/SSE/SQLite and local protection. No paid provider or .env file.
let backendUrl: string, token: string, directory: string, store: TaskStore, engine: TaskEngine, server: ReturnType<typeof serve>
let requests = 0, releaseVisualEdit: (() => void) | undefined
const lightId = 'browser-visual-light', fogId = 'browser-visual-fog'
const requirements = ['新建一盏暖色点光，位置4000,4000毫米。', '新建一片局部晨雾，保留所有物理结构。']
const style = { palette: ['#EAC582', '#6F8A84'], lineWeightMm: 24, textureScaleMm: 900, detailDensity: .3, lightDirectionDeg: 50 }
const tool = (id: string, name: string, args: unknown): ProviderToolCall => ({ id, name, arguments: JSON.stringify(args) })
const completion = (toolCalls: ProviderToolCall[] = [], text = ''): ProviderCompletion => ({ text, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 10, outputTokens: 5 }, requestId: 'visual-browser-deterministic' })
const result = (input: ProviderInput, id: string) => input.messages.find(message => message.role === 'tool' && message.toolCallId === id)
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-visual-ai-browser-')); token = randomBytes(24).toString('hex')
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:1/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'deterministic-no-network', SCENEWEAVE_AI_PROVIDER_MODEL: 'visual-browser-deterministic' })
  const provider: ProviderAdapter = { async complete(input) {
    requests++
    if (!result(input, 'initial-plan')) return completion([tool('initial-plan', 'sceneweave_plan_draft', { phase: 'atmosphere', requirements: requirements.map((_, index) => ({ index, state: 'pending', evidenceIds: [], note: '按冻结清单制作，尚未产生视觉对象。' })) })])
    if (!result(input, 'visual-edit')) {
      await new Promise<void>(resolve => { releaseVisualEdit = resolve; if (input.signal.aborted) resolve(); else input.signal.addEventListener('abort', () => resolve(), { once: true }) })
      return completion([tool('visual-edit', 'sceneweave_edit_scene', { operations: [
        { kind: 'visualLight', id: lightId, positionMm: { x: 4000, y: 4000 }, radiusMm: 2000, color: '#EAC582', intensity: .65, wallOcclusion: true, enabled: true },
        { kind: 'visualFog', id: fogId, boundaryMm: [{ x: 2000, y: 6000 }, { x: 7000, y: 6000 }, { x: 7000, y: 8500 }, { x: 2000, y: 8500 }], color: '#A4B8B1', opacity: .2, directionDeg: 20, scaleMm: 1000, seed: 'visual-browser-fog', enabled: true },
      ] })])
    }
    if (!result(input, 'review-plan')) return completion([
      tool('review-plan', 'sceneweave_plan_draft', { phase: 'review', requirements: [{ index: 0, state: 'claimed', evidenceIds: [lightId], note: '已有暖色点光，效果待人工核对。' }, { index: 1, state: 'claimed', evidenceIds: [fogId], note: '已有局部晨雾，未改物理结构。' }] }),
      tool('diagnose', 'sceneweave_diagnose_draft', {}), tool('check', 'sceneweave_check_draft', {}),
    ])
    const text = '暖色点光与晨雾已进入隔离草稿，清单记录仍需人工核对。请检查视觉差异并明确采用。'
    await input.onText(text)
    return completion([], text)
  } }
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connectionInfo(config))
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  engine?.close(); releaseVisualEdit?.(); if (server && 'closeAllConnections' in server) server.closeAllConnections()
  await new Promise<void>(resolve => server?.close(() => resolve())); store?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})
async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 40_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 40_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 40_000 })
}
async function current(page: Page) {
  return page.evaluate(async () => {
    const path = '/tests/helpers/native-workspace-browser.ts', { readNativeCurrent } = await import(path) as typeof import('./helpers/native-workspace-browser')
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }).workspace, project = workspace.getState().project!
    return { ...await readNativeCurrent(project), canUndo: workspace.getState().canUndo }
  })
}
test('a visual-only AI grant submits the complete brief, streams its plan and adopts exact visual differences once with protection', async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = [], creates: CreateTaskRequest[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url() === backendUrl + '/v1/tasks' && request.method() === 'POST') creates.push(request.postDataJSON() as CreateTaskRequest) })
  await page.goto('/#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('只授权视觉的AI任务')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await saved(page)
  const before = await current(page)
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true }), authoring = page.getByRole('region', { name: 'AI 场景草稿', exact: true })
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(backendUrl); await panel.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  await authoring.getByRole('checkbox', { name: '移动 / 旋转', exact: true }).uncheck(); await authoring.getByRole('checkbox', { name: '透明度', exact: true }).uncheck()
  await authoring.getByLabel('AI 草稿要求', { exact: true }).fill('仅按清单新建点光和局部雾；所有其他场景内容保持。')
  await authoring.getByRole('checkbox', { name: '同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容', exact: true }).check()
  await authoring.getByText('制作清单与统一风格', { exact: true }).click()
  await authoring.getByLabel('AI 场景类型', { exact: true }).selectOption('custom'); await authoring.getByLabel('AI 制作清单', { exact: true }).fill(requirements.join('\n'))
  await authoring.getByRole('checkbox', { name: '使用明确风格参数', exact: true }).check()
  await authoring.getByLabel('AI 风格配色', { exact: true }).fill(style.palette.join(', '))
  for (const [label, value] of [['AI 线条毫米', style.lineWeightMm], ['AI 纹理毫米', style.textureScaleMm], ['AI 细节密度', style.detailDensity], ['AI 光照方向', style.lightDirectionDeg]] as const) await authoring.getByLabel(label, { exact: true }).fill(String(value))
  await authoring.getByText('可核对目标', { exact: true }).click()
  const checks = authoring.getByRole('group', { name: 'AI 可核对目标', exact: true })
  await checks.getByRole('button', { name: '添加活动区净空', exact: true }).click()
  await checks.getByLabel('活动区宽（毫米）', { exact: true }).fill('4000')
  await checks.getByLabel('活动区高（毫米）', { exact: true }).fill('4000')
  await checks.getByLabel('活动区最小净宽（毫米）', { exact: true }).fill('4000')
  await checks.getByRole('button', { name: '添加高差与连接', exact: true }).click()
  await checks.getByRole('group', { name: '核对目标 2', exact: true }).getByRole('button', { name: '移除此目标', exact: true }).click()
  await expect(checks.getByRole('group', { name: /^核对目标/ })).toHaveCount(1)
  const start = authoring.getByRole('button', { name: '创建独立草稿任务', exact: true })
  await expect(start).toBeDisabled()
  await authoring.getByLabel('AI 视觉场景创作', { exact: true }).check()
  await expect(authoring.getByLabel('AI 完整场景创作', { exact: true })).not.toBeChecked()
  await expect(authoring.getByLabel('AI 素材创作和同化', { exact: true })).not.toBeChecked()
  await expect(authoring.getByRole('checkbox', { name: '允许使用明确素材放置新物件', exact: true })).not.toBeChecked()
  await expect(start).toBeEnabled()
  const creation = page.waitForResponse(response => response.url() === backendUrl + '/v1/tasks' && response.request().method() === 'POST')
  await start.click(); const task = await (await creation).json() as TaskSnapshot
  const progress = authoring.getByLabel('AI 制作进度', { exact: true })
  await expect(progress).toContainText('当前阶段：环境'); await expect(progress.locator('li')).toHaveCount(2)
  await expect(progress).toContainText('待完成'); expect((await current(page)).contentHash).toBe(before.contentHash)
  await expect.poll(() => Boolean(releaseVisualEdit)).toBe(true); releaseVisualEdit!()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 40_000 })
  await expect(progress).toContainText('当前阶段：复核'); await expect(progress).toContainText('AI 已标记，待人工核对')
  const differences = authoring.getByLabel('AI 草稿差异', { exact: true })
  await expect(differences.locator(':scope > li')).toHaveCount(2)
  await expect(differences).toContainText(`点光 · ${lightId} · 新增`); await expect(differences).toContainText(`区域雾 · ${fogId} · 新增`)
  expect((await current(page)).contentHash).toBe(before.contentHash); expect(creates).toHaveLength(1)
  const posted = creates[0].authoring!
  expect(posted.scope.targetIds).toEqual([]); expect(posted.scope.operations).toEqual([]); expect(posted.scope.placement).toBeNull()
  expect(posted.scope.scene ?? null).toBeNull(); expect(posted.scope.artwork ?? null).toBeNull()
  expect(posted.scope.visual).toMatchObject({ entityIds: [], definitionIds: [], materialIds: [], allowGlobalEnvironment: false, boundsMm: before.document.exportBoundsMm })
  expect(posted.brief).toMatchObject({ recipe: 'custom', requirements, style, checks: [{ kind: 'clearArea', floorId: Object.keys(before.document.floors)[0], boundsMm: { x: 0, y: 0, width: 4000, height: 4000 }, minimumWidthMm: 4000, avoidVisual: true }] })
  expect(posted.brief!.checks![0].id).toMatch(/^check-/); expect(creates[0].vision).toBeUndefined()
  const stored = store.read(task.id)
  expect(stored.snapshot.tools.every(value => value.success)).toBe(true); expect(requests).toBe(4)
  expect(stored.authoring!.state.steps).toHaveLength(1); expect(stored.authoring!.state.steps[0].operations.map(value => value.kind)).toEqual(['visualLight', 'visualFog'])
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 40_000 }); await expect(authoring).toContainText('保护快照和保存已完成', { timeout: 40_000 }); await saved(page)
  const adopted = await current(page)
  expect(adopted.revision).toBe(before.revision + 1); expect(adopted.document.visual!.lights[lightId]).toMatchObject({ color: '#EAC582', intensity: .65, visibility: 'public' })
  expect(adopted.document.visual!.fogs[fogId]).toMatchObject({ seed: 'visual-browser-fog', opacity: .2, visibility: 'public' })
  const physical = (scene: typeof adopted.document) => { const { visual: _visual, revision: _revision, updatedAt: _updatedAt, ...rest } = scene; return rest }
  expect(physical(adopted.document)).toEqual(physical(before.document)); expect(adopted.document.visual!.environment).toEqual(before.document.visual!.environment)
  const snapshots = await page.evaluate(async sceneId => { const path = '/src/platform/browser/runtime.ts'; return (await import(path) as typeof import('../src/platform/browser/runtime')).projectRepository.listSnapshots(sceneId) }, adopted.sceneId)
  expect(snapshots).toHaveLength(1); expect(snapshots[0]).toMatchObject({ kind: 'protection', sourceRevision: before.revision })
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(page)
  const undone = await current(page); expect(undone.document.visual).toEqual(before.document.visual); expect(undone.canUndo).toBe(false)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(page)
  const redone = await current(page); expect(redone.document.visual).toEqual(adopted.document.visual)
  expect(requests).toBe(4); expect(errors).toEqual([])
  expect(await page.evaluate(secret => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(secret), token)).toBe(false)
  await info.attach('visual-only-ai-grant.json', { body: JSON.stringify({ scope: posted.scope, brief: posted.brief, plan: stored.authoring!.plan, tools: stored.snapshot.tools, snapshots, revisions: [before.revision, adopted.revision, undone.revision, redone.revision], errors }), contentType: 'application/json' })
})
