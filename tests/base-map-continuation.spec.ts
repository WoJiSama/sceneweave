import { visualBase } from '../src/shared/visual/base.js'
import { test, expect, type Page, type Locator, type TestInfo } from '@playwright/test'
import { serve } from '@hono/node-server'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { unzipSync } from 'fflate'
import { loadAiConfig } from '../services/ai/config'
import { createAiApp, connectionInfo } from '../services/ai/app'
import { TaskStore } from '../services/ai/store'
import { TaskEngine } from '../services/ai/engine'
import type { ProviderAdapter, ProviderCompletion, ProviderInput, ProviderToolCall } from '../services/ai/provider-types'
import type { CreateTaskRequest } from '../src/shared/ai/protocol'
import { CONTINUATION_POLICY, createContinuationPolicyV2 } from '../src/shared/ai/budget-policy'


// Real UI, Worker, resource pixels, IndexedDB, HTTP/CORS/SSE and SQLite. The
// deterministic in-process provider never reads .env.ai or calls a paid model.
let backendUrl: string, token: string, directory: string, store: TaskStore, engine: TaskEngine
let server: ReturnType<typeof serve>, modelRequests = 0
const tool = (id: string, name: string, input: unknown): ProviderToolCall => ({ id, name, arguments: JSON.stringify(input) })
const completion = (calls: ProviderToolCall[] = [], text = ''): ProviderCompletion => ({ text, toolCalls: calls,
  finishReason: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 12, outputTokens: 9 }, requestId: 'base-map-continuation-browser-fixture' })
const result = <T,>(input: ProviderInput, callId: string): T | undefined => {
  const message = input.messages.find(value => value.role === 'tool' && value.toolCallId === callId)
  return message?.content ? JSON.parse(message.content) as T : undefined
}
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-continuation-browser-')); token = randomBytes(24).toString('hex')
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory,
    SCENEWEAVE_AI_ALLOWED_ORIGINS: new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'not-a-real-key-no-network-provider', SCENEWEAVE_AI_PROVIDER_MODEL: 'deterministic-continuation-test' })
  const provider: ProviderAdapter = { async complete(input) {
    modelRequests++
    const summary = result<{ targetIds: string[] }>(input, 'read-authorized-summary')
    if (!summary) return completion([tool('read-authorized-summary', 'sceneweave_read_scene', { section: 'summary' })])
    if (input.messages.some(value => value.role === 'user' && value.content?.includes('取消接续测试'))) {
      await input.onText('已读取当前底图的明确授权，等待用户取消；尚未修改草稿。')
      await new Promise<void>(resolve => { if (input.signal.aborted) resolve(); else input.signal.addEventListener('abort', () => resolve(), { once: true }) })
      return completion([], '迟到结果不得改变已取消任务。')
    }
    const id = summary.targetIds[0]
    if (!id) throw new Error('The UI must authorize an existing independent public base-map prop.')
    if (!result(input, 'adjust-existing-opacity')) {
      const visual = input.messages.some(value => value.role === 'user' && value.content?.includes('生成底图视觉接线'))
      return completion([tool('adjust-existing-opacity', visual ? 'sceneweave_edit_scene' : 'sceneweave_edit_props', { operations: [
        { kind: 'opacity', id, value: 0.55 }, ...(visual ? [{ kind: 'visualLight', id: 'generated-ai-light', positionMm: { x: 8000, y: 4000 },
          radiusMm: 1800, color: '#EAC582', intensity: 0.5, wallOcclusion: true, enabled: true }] : []),
      ] })])
    }
    if (!result(input, 'check-continuation')) return completion([tool('check-continuation', 'sceneweave_check_draft', {})])
    const text = '已把一件明确授权的底图物件透明度调为0.55，并完成草稿检查。请审阅后采用。'
    await input.onText(text); return completion([], text)
  } }
  // Use the production capability constructor; the fixture replaces only the
  // provider and private data directory, never protocol/version negotiation.
  const connection = connectionInfo(config)
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connection)
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => { if (server.listening) resolve(); else server.once('listening', resolve) })
  backendUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
})
test.afterAll(async () => {
  engine?.close(); if (server && 'closeAllConnections' in server) server.closeAllConnections()
  await new Promise<void>(resolve => server?.close(() => resolve())); store?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function state(page: Page) {
  return page.evaluate(async () => {
    const workspacePath = '/src/editor/main/Workbench.tsx', projectPath = '/src/application/workspace/project.ts', hashPath = '/src/shared/project/validate.ts'
    const { nativeWorkspace } = await import(workspacePath) as typeof import('../src/editor/main/Workbench')
    const { toBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { projectContentHash } = await import(hashPath) as typeof import('../src/shared/project/validate')
    const value = nativeWorkspace.getState(), project = value.project
    if (!project) throw new Error('Expected an active native project.')
    return { schemaVersion: project.schemaVersion, document: structuredClone(project.document), hash: projectContentHash(toBundle(project).project),
      canUndo: value.canUndo, canRedo: value.canRedo, checkpoint: nativeWorkspace.checkpoint(), status: value.status }
  })
}
async function persisted(page: Page, sceneId: string) {
  return page.evaluate(async id => {
    const runtimePath = '/src/platform/browser/runtime.ts', hashPath = '/src/shared/project/validate.ts'
    const { projectRepository } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { projectContentHash } = await import(hashPath) as typeof import('../src/shared/project/validate')
    const bundle = await projectRepository.load(id)
    return { hash: bundle ? projectContentHash(bundle.project) : null, snapshots: await projectRepository.listSnapshots(id) }
  }, sceneId)
}
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
}
async function createBlank(page: Page, title: string) {
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
}
async function generateIsland(page: Page) {
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByLabel('程序底图生成位置', { exact: true }).selectOption('worker')
  await page.getByRole('button', { name: '选择岩岛地形', exact: true }).click()
  await page.getByLabel('地形画布尺寸', { exact: true }).selectOption('24000x18000')
  await page.getByLabel('地形方案种子', { exact: true }).fill('terrain-v1-0')
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(page.getByRole('article', { name: '当前地形候选', exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('button', { name: '继续用 AI 修改底图', exact: true })).toBeEnabled({ timeout: 90_000 })
  await expect(page.getByLabel('程序底图本次预算', { exact: true })).toContainText('本机程序生成')
}
async function connectContinuation(page: Page) {
  await page.getByRole('button', { name: '继续用 AI 修改底图', exact: true }).click()
  return connectAi(page)
}
async function connectAi(page: Page) {
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true })
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(backendUrl)
  await panel.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  return panel
}
async function beginContinuation(panel: Locator, prompt: string, visual = false) {
  const authoring = panel.getByRole('region', { name: 'AI 场景草稿', exact: true })
  await expect(authoring).toContainText('在程序底图上继续修改')
  await expect(authoring.getByRole('checkbox', { name: 'AI 素材创作和同化', exact: true })).toBeDisabled()
  await expect(authoring.getByRole('checkbox', { name: 'AI 视觉场景创作', exact: true })).toBeEnabled()
  if (visual) await authoring.getByRole('checkbox', { name: 'AI 视觉场景创作', exact: true }).check()
  await authoring.getByRole('button', { name: '授权全部独立公开物件', exact: true }).click()
  await authoring.getByRole('checkbox', { name: '移动 / 旋转', exact: true }).uncheck()
  await authoring.getByRole('checkbox', { name: '透明度', exact: true }).check()
  await authoring.getByLabel('AI 草稿要求', { exact: true }).fill(prompt)
  await authoring.getByRole('checkbox', { name: '同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容', exact: true }).check()
  await authoring.getByRole('button', { name: '创建底图 AI 接续任务', exact: true }).click()
  return authoring
}
async function downloadedBytes(page: Page, button: Locator) {
  const pending = page.waitForEvent('download'); await button.click()
  const download = await pending, path = await download.path()
  expect(path).not.toBeNull()
  return { bytes: await readFile(path!), name: download.suggestedFilename() }
}
async function exportPngProof(page: Page, info: TestInfo, audience: 'gm' | 'player') {
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: audience === 'gm' ? '主持人' : '玩家', exact: true }).click()
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
  const { bytes, name } = await downloadedBytes(page, page.getByRole('button', { name: '4K PNG', exact: true }))
  expect(name).toBe(`sceneweave-${audience}-map.png`)
  const pixels = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    try {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0, 32, 24)
      const data = context.getImageData(0, 0, 32, 24).data, colors = new Set<string>()
      let opaqueSamples = 0
      for (let offset = 0; offset < data.length; offset += 4) { colors.add([...data.slice(offset, offset + 4)].join(',')); if (data[offset + 3]) opaqueSamples++ }
      return { width: bitmap.width, height: bitmap.height, colors: colors.size, opaqueSamples }
    } finally { bitmap.close() }
  }, bytes.toString('base64'))
  expect(pixels).toMatchObject({ width: 4096, height: 3072 }); expect(pixels.colors).toBeGreaterThan(2); expect(pixels.opaqueSamples).toBeGreaterThan(0)
  await info.attach(`continuation-${audience}-4096.png`, { body: bytes, contentType: 'image/png' })
  return { audience, bytes: bytes.length, ...pixels }
}

test('UI generates a profile-bound v3 island, continues one authorized prop and adopts a protected new project with complete undo, cold read and real exports', async ({ page }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = [], creates: CreateTaskRequest[] = [], capabilities: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/v1/tasks' && request.method() === 'POST') {
      expect(new URL(request.url()).search).toBe('?authoringVersion=4'); creates.push(request.postDataJSON() as CreateTaskRequest)
    }
    if (request.url().startsWith(backendUrl + '/v1/capabilities?')) capabilities.push(request.url())
  })
  await createBlank(page, '底图接续 · 保全原工程')
  const before = await state(page), initialRequests = modelRequests
  await generateIsland(page); expect(await state(page)).toEqual(before)
  const panel = await connectContinuation(page), authoring = await beginContinuation(panel, '生成底图视觉接线：把明确授权的第一个现存底图物件透明度调为0.55，并按明确视觉授权新建公开点光；保留全部地形。', true)
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 90_000 })
  const differences = authoring.getByLabel('AI 草稿差异', { exact: true })
  await expect(differences).toContainText('地形区域')
  await expect(differences).toContainText('独立物件')
  await expect(authoring).toContainText('AI 2/1024')
  expect(await state(page)).toEqual(before); expect((await persisted(page, before.document.sceneId)).snapshots).toEqual([])
  expect(creates).toHaveLength(1); expect(modelRequests - initialRequests).toBe(4)
  const posted = creates[0]
  expect(posted.context).toEqual({ sceneId: before.document.sceneId, revision: 0, audience: 'public' })
  if (posted.authoring?.schemaVersion !== 4 || posted.authoring.source.version !== 3) throw new Error('The current UI must create authoring4 with a proven generated source3.')
  const start = posted.authoring, task = store.list('maintainer').find(value => value.clientRequestId === posted.clientRequestId)!
  const source = start.source
  if (source.version !== 3) throw new Error('Expected verified generation source3')
  const stored = store.read(task.id), draft = stored.authoring!
  if (draft.state.schemaVersion !== 4) throw new Error('Expected the persisted authoring4 ledger.')
  expect(start.policy.policyHash).toBe(createContinuationPolicyV2(source.request.profile).policyHash); expect(source.request.version).toBe(3)
  expect(source.request.profile.profileId).toBe('standard'); expect(source.request.generation.kind === 'terrain' && source.request.generation.input.algorithmVersion).toBe(5); expect(start.policy.generationTargets).toBe(1024)
  expect(capabilities).toContain(backendUrl + '/v1/capabilities?authoringVersion=4&surfaceVersion=1')
  await expect(page.getByLabel('程序底图本次预算', { exact: true })).toContainText(`编辑目标 ${source.response.generationBudget.semanticCost}/${start.policy.generationTargets}`)
  await expect(page.getByLabel('程序底图本次预算', { exact: true })).toContainText(`轮廓点 ${source.response.generationBudget.usage.geometryPoints}/${source.request.profile.limits.geometryPoints}`)
  expect(source.response.generationBudget.usage.geometryPoints).toBeGreaterThan(256)
  expect(start.scope.artwork).toBeNull(); expect(start.scope.visual?.operations).toContain('visualLight')
  expect(source.execution).toMatchObject({ executor: 'worker', generationCalls: 1, materializationCalls: 1 })
  expect(source.execution.activeRuntimeMs).toBeGreaterThan(0)
  expect(source.preservation).toMatchObject({ sceneId: before.document.sceneId, revision: 0, contentHash: before.hash })
  expect(start.project.document.sceneId).not.toBe(before.document.sceneId)
  expect(draft.state.budget.generationCost).toBeGreaterThan(0); expect(draft.state.budget.aiCost).toBe(2)
  expect(draft.state.budget.finalAdoptionCost).toBeLessThanOrEqual(start.policy.finalAdoptionTargets)
  expect(draft.state.ledger.map(entry => entry.category)).toEqual(['generation', 'ai', 'ai'])
  expect(draft.state.ledger[1].targets).toEqual([`prop:${[...start.scope.targetIds].sort()[0]}`])
  expect(draft.state.ledger[1].semanticCost).toBe(1)
  expect(draft.state.ledger[2].semanticCost).toBe(1)
  expect(draft.state.ledger[2].targets.some(id => id.includes('generated-ai-light'))).toBe(true)
  expect(stored.snapshot.executionCheckpoint).toMatchObject({ policyHash: draft.state.policyHash, sourceHash: draft.state.sourceHash,
    ledgerHeadHash: draft.state.ledgerHeadHash, budgetStateHash: draft.state.budgetStateHash, modelRequests: 4 })
  const id = [...start.scope.targetIds].sort()[0]
  await page.getByRole('button', { name: '查看AI草稿', exact: true }).click()
  await expect(page.locator('.ai-preview-banner')).toContainText('AI草稿预览 · 主工程未改变')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
  await page.getByRole('button', { name: '查看程序底图', exact: true }).click(); expect(await state(page)).toEqual(before)
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(authoring).toContainText('保护快照和保存已完成', { timeout: 90_000 }); await settled(page)
  const adopted = await state(page), original = await persisted(page, before.document.sceneId)
  expect(adopted.schemaVersion).toBe(start.project.schemaVersion); expect(adopted.document.sceneId).toBe(start.project.document.sceneId); expect(adopted.document.revision).toBe(1)
  expect(adopted.document.props[id].appearance.opacity).toBe(0.55); expect(visualBase(adopted.document)!.lights['generated-ai-light']).toMatchObject({ visibility: 'public', intensity: 0.5 }); expect(Object.keys(adopted.document.terrainAreas).length).toBeGreaterThan(0)
  expect(original.hash).toBe(before.hash); expect(original.snapshots).toHaveLength(1)
  expect(original.snapshots[0]).toMatchObject({ kind: 'protection', sourceRevision: 0, contentHash: before.hash })
  expect((await persisted(page, adopted.document.sceneId)).hash).toBe(adopted.hash)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await state(page)
  expect(undone.document.sceneId).toBe(adopted.document.sceneId); expect(undone.document.revision).toBe(2)
  expect(undone.document.props).toEqual({}); expect(undone.document.terrainAreas).toEqual({}); expect(undone.canUndo).toBe(false)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  const redone = await state(page)
  expect(redone.document.revision).toBe(3); expect(redone.document.props).toEqual(adopted.document.props); expect(redone.document.terrainAreas).toEqual(adopted.document.terrainAreas)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page)
  const reopened = await state(page); expect(reopened.hash).toBe(redone.hash); expect(reopened.canUndo).toBe(false)
  const packaged = await downloadedBytes(page, page.getByRole('button', { name: '完整工程', exact: true }))
  const archive = unzipSync(packaged.bytes), decode = new TextDecoder(), manifest = JSON.parse(decode.decode(archive['manifest.json']))
  expect(manifest).toMatchObject({ format: 'sceneweave-complete-project', schemaVersion: adopted.schemaVersion, packageMode: 'complete', sceneId: adopted.document.sceneId, revision: 3 })
  expect(Object.keys(archive).some(path => path.startsWith('assets/'))).toBe(true)
  const imported = await page.evaluate(async base64 => {
    const filePath = '/src/shared/project/file.ts', runtimePath = '/src/platform/browser/runtime.ts', hashPath = '/src/shared/project/validate.ts'
    const { importProject } = await import(filePath) as typeof import('../src/shared/project/file')
    const { validation } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { projectContentHash } = await import(hashPath) as typeof import('../src/shared/project/validate')
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0)), bundle = await importProject(bytes, validation)
    return { hash: projectContentHash(bundle.project), assets: Object.keys(bundle.project.assets).length }
  }, packaged.bytes.toString('base64'))
  expect(imported.hash).toBe(redone.hash); expect(imported.assets).toBeGreaterThan(0)
  await info.attach('continuation-complete.sceneweave', { body: packaged.bytes, contentType: 'application/zip' })
  const pngs = [await exportPngProof(page, info, 'gm'), await exportPngProof(page, info, 'player')]
  expect((await persisted(page, before.document.sceneId)).hash).toBe(before.hash)
  expect(modelRequests - initialRequests).toBe(4); expect(errors).toEqual([])
  expect(await page.evaluate(secret => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(secret), token)).toBe(false)
  await info.attach('continuation-ui-evidence.json', { body: JSON.stringify({ originalSceneId: before.document.sceneId, originalHash: before.hash,
    newSceneId: adopted.document.sceneId, sourceHash: draft.state.sourceHash, budget: draft.state.budget, revisions: [1, 2, 3], protectionId: original.snapshots[0].id,
    modelRequests: 4, packageHash: imported.hash, pngs }, null, 2), contentType: 'application/json' })
})

test('cancelled authoring4 with A=0 preserves its generated baseline for explicit protected adoption', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createBlank(page, '底图接续 · 取消后独立采用')
  const before = await state(page), initialRequests = modelRequests, capabilities: string[] = []
  page.on('request', request => { if (request.url().startsWith(backendUrl + '/v1/capabilities?')) capabilities.push(request.url()) })
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  const panel = await connectAi(page)
  expect(capabilities).toContain(backendUrl + '/v1/capabilities?authoringVersion=2')
  await generateIsland(page)
  await page.getByRole('button', { name: '继续用 AI 修改底图', exact: true }).click()
  await expect.poll(() => capabilities.includes(backendUrl + '/v1/capabilities?authoringVersion=4&surfaceVersion=1')).toBe(true)
  await beginContinuation(panel, '取消接续测试：读授权后等待，不要修改物件。')
  await expect(panel.getByLabel('AI 回复文字', { exact: true })).toContainText('等待用户取消', { timeout: 90_000 })
  await panel.getByRole('button', { name: '取消任务', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已取消', { timeout: 30_000 })
  expect(await state(page)).toEqual(before); expect((await persisted(page, before.document.sceneId)).snapshots).toEqual([])
  await expect(page.getByRole('button', { name: '继续用 AI 修改底图', exact: true })).toBeEnabled()
  const authoring = panel.getByRole('region', { name: 'AI 场景草稿', exact: true })
  await authoring.getByRole('button', { name: '重新绑定并校验草稿', exact: true }).click()
  await expect(authoring.getByLabel('AI 草稿差异', { exact: true })).toContainText('地形区域', { timeout: 90000 })
  await authoring.getByRole('button', { name: '结束生成并审阅当前草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 90000 })
  await expect(authoring).toContainText('AI 0/1024')
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(authoring).toContainText('保护快照和保存已完成', { timeout: 90000 }); await settled(page)
  const adopted = await state(page)
  expect(adopted.document.sceneId).not.toBe(before.document.sceneId); expect(adopted.document.revision).toBe(1)
  expect(Object.keys(adopted.document.terrainAreas).length).toBeGreaterThan(0)
  expect(Object.values(adopted.document.props).every(prop => prop.appearance.opacity !== 0.55)).toBe(true)
  expect((await persisted(page, adopted.document.sceneId)).hash).toBe(adopted.hash)
  const original = await persisted(page, before.document.sceneId)
  expect(original.hash).toBe(before.hash); expect(original.snapshots).toHaveLength(1)
  expect(modelRequests - initialRequests).toBe(2); expect(errors).toEqual([])
})

test('explicit legacy v2 fixture remains readable through the v2 connection without creating or resuming a model request', async ({ page }) => {
  test.setTimeout(120_000)
  await createBlank(page, '旧版接续 · 只读取回')
  const before = await state(page), initialRequests = modelRequests, source = await page.evaluate(async () => {
    const fixturePath = '/tests/helpers/continuation-fixture.ts'
    return structuredClone((await import(fixturePath)).continuationFixture())
  })
  // This explicit legacy fixture covers metadata/read compatibility only. It is
  // not used as resource-byte, pixel, generation or adoption evidence.
  source.source.preservation = { ...source.source.preservation, sceneId: before.document.sceneId, revision: 0, contentHash: before.hash }
  source.source.request.workspaceSceneId = before.document.sceneId
  source.source.response.workspaceSceneId = before.document.sceneId
  const created = store.create('maintainer', { schemaVersion: 1, clientRequestId: crypto.randomUUID(), prompt: '旧版任务只读取回。',
    context: { sceneId: before.document.sceneId, revision: 0, audience: 'public' }, authoring: source }, 1).task
  store.change(created.snapshot.id, created.snapshot.generation, task => {
    store.stopClock(task); task.snapshot.generation++; task.snapshot.status = 'paused'
    return [{ type: 'status', data: { status: 'paused', reason: '旧版任务只读兼容夹具。' } }]
  })
  try {
    const requests: { path: string; method: string }[] = []
    page.on('request', request => { if (request.url().startsWith(backendUrl + '/v1/')) requests.push({ path: new URL(request.url()).pathname + new URL(request.url()).search, method: request.method() }) })
    await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
    const panel = await connectAi(page)
    await panel.getByText('按任务 ID 查询', { exact: true }).click()
    await panel.getByLabel('AI 任务 ID', { exact: true }).fill(created.snapshot.id)
    await panel.getByRole('button', { name: '按任务 ID 只读查询', exact: true }).click()
    await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已暂停')
    await expect(panel.getByRole('region', { name: 'AI 场景草稿', exact: true })).toContainText('AI 0/256')
    expect(store.read(created.snapshot.id).snapshot.authoring).toMatchObject({ schemaVersion: 2, policyHash: CONTINUATION_POLICY.policyHash })
    expect(requests).toContainEqual({ path: '/v1/capabilities?authoringVersion=2', method: 'GET' })
    expect(requests.every(request => request.method === 'GET')).toBe(true)
    expect(modelRequests).toBe(initialRequests); expect(await state(page)).toEqual(before)
  } finally { store.delete(created.snapshot.id, 'maintainer') }
})
