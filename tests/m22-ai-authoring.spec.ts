import { test, expect, type Page, type Locator } from '@playwright/test'
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
import type { TaskSnapshot } from '../src/shared/ai/protocol'

// Real browser pixels, native IndexedDB, HTTP/CORS/SSE and SQLite. The model is
// deterministic and in-process; this never loads .env.ai or makes paid calls.
let backendUrl: string, token: string, directory: string, store: TaskStore, engine: TaskEngine
let server: ReturnType<typeof serve>, modelRequests = 0
const tool = (id: string, name: string, input: unknown): ProviderToolCall => ({ id, name, arguments: JSON.stringify(input) })
const completion = (calls: ProviderToolCall[] = [], text = ''): ProviderCompletion => ({ text, toolCalls: calls,
  finishReason: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 12, outputTokens: 9 }, requestId: 'm22-browser-fake-model' })
const result = <T,>(input: ProviderInput, callId: string): T | undefined => {
  const message = input.messages.find(value => value.role === 'tool' && value.toolCallId === callId)
  return message?.content ? JSON.parse(message.content) as T : undefined
}
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-m22-browser-')); token = randomBytes(24).toString('hex')
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory,
    SCENEWEAVE_AI_ALLOWED_ORIGINS: new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'not-a-real-key-no-network-provider', SCENEWEAVE_AI_PROVIDER_MODEL: 'deterministic-authoring-test' })
  const provider: ProviderAdapter = { async complete(input) {
    modelRequests++
    if (!result(input, 'read-summary')) return completion([
      tool('read-summary', 'sceneweave_read_scene', { section: 'summary' }),
      tool('find-lamp', 'sceneweave_find_assets', { query: '铜色桌灯', limit: 5 }),
    ])
    const asset = result<{ id: string }[]>(input, 'find-lamp')?.[0]
    if (!asset) throw new Error('The test must explicitly authorize its real lamp definition.')
    const placed = result<{ affectedIds: string[] }>(input, 'place-lamp')
    if (!placed) return completion([tool('place-lamp', 'sceneweave_edit_props', { operations: [
      { kind: 'place', definitionId: asset.id, positionMm: { x: 4000, y: 4000 } },
    ] })])
    const id = placed.affectedIds[0]
    const users = input.messages.filter(value => value.role === 'user').map(value => value.content ?? '')
    if (users.some(text => text.includes('暂停续批测试')) && !users.some(text => text.includes('明确继续扩展草稿'))) {
      await input.onText('已有一笔有效放置草稿，正在等待暂停。')
      await new Promise<void>(resolve => { if (input.signal.aborted) resolve(); else input.signal.addEventListener('abort', () => resolve(), { once: true }) })
      return completion([], '迟到模型结果不得改变已暂停任务。')
    }
    if (!result(input, 'adjust-opacity')) return completion([
      tool('adjust-opacity', 'sceneweave_edit_props', { operations: [{ kind: 'opacity', id, value: 0.6 }] }),
      tool('move-lamp', 'sceneweave_edit_props', { operations: [{ kind: 'transform', id, positionMm: { x: 5000, y: 4000 }, rotationDeg: 30 }] }),
    ])
    if (!result(input, 'check-final')) return completion([tool('check-final', 'sceneweave_check_draft', {})])
    const text = '桌灯已在独立草稿中放置、调为0.6透明度并移动。请检查后采用。'
    await input.onText(text); return completion([], text)
  } }
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connectionInfo(config))
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
    const path = '/src/editor/main/Workbench.tsx', { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    const value = nativeWorkspace.getState(), project = value.project
    if (!project) throw new Error('Expected an active native project.')
    return { document: structuredClone(project.document), identity: structuredClone(project.historyIdentity), appearance: structuredClone(project.appearance),
      canUndo: value.canUndo, canRedo: value.canRedo, checkpoint: nativeWorkspace.checkpoint(), status: value.status }
  })
}
async function snapshots(page: Page) {
  return page.evaluate(async () => {
    const runtimePath = '/src/platform/browser/runtime.ts', workbenchPath = '/src/editor/main/Workbench.tsx'
    const { projectRepository } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { nativeWorkspace } = await import(workbenchPath) as typeof import('../src/editor/main/Workbench')
    return projectRepository.listSnapshots(nativeWorkspace.getDocument()!.sceneId)
  })
}
async function settled(page: Page) {
  await expect.poll(async () => { try { return (await state(page)).status } catch { return null } }, { timeout: 30_000 }).toBe('saved')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}
async function createBlank(page: Page, title: string) {
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18000'); await dialog.getByLabel('画布高度', { exact: true }).fill('12000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
}
async function connect(page: Page) {
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true })
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(backendUrl)
  await panel.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  return panel
}
async function beginDraft(page: Page, panel: Locator, prompt = '在明确范围放一盏铜色桌灯，透明度0.6，移动到5000,4000并旋转30度。') {
  const authoring = panel.getByRole('region', { name: 'AI 场景草稿', exact: true })
  await authoring.getByRole('checkbox', { name: '允许使用明确素材放置新物件', exact: true }).check()
  const floor = Object.keys((await state(page)).document.floors)[0]
  await authoring.getByLabel('AI 放置表面', { exact: true }).selectOption('floor:' + floor)
  await authoring.getByText('授权本工程素材（0）', { exact: true }).click()
  await authoring.getByRole('checkbox', { name: '铜色桌灯', exact: true }).check()
  await authoring.getByLabel('AI 草稿要求', { exact: true }).fill(prompt)
  await authoring.getByRole('checkbox', { name: '同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容', exact: true }).check()
  await authoring.getByRole('button', { name: '创建独立草稿任务', exact: true }).click()
  return authoring
}
async function createDraft(page: Page, panel: Locator) {
  const authoring = await beginDraft(page, panel)
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 30_000 })
  await expect(authoring.getByLabel('AI 草稿差异', { exact: true }).locator(':scope > li')).toHaveCount(1)
  await expect(authoring).toContainText('实际操作 3/256')
  return authoring
}

test('M2-2 authorized tools make an isolated draft, then protected one-transaction adoption survives undo/redo and native reopen', async ({ page }, info) => {
  test.setTimeout(90_000)
  const errors: string[] = [], creates: unknown[] = []; page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url() === backendUrl + '/v1/tasks' && request.method() === 'POST') creates.push(request.postDataJSON()) })
  await createBlank(page, 'M2-2 真实浏览器草稿采用')
  const before = await state(page), initial = modelRequests, panel = await connect(page), authoring = await createDraft(page, panel)
  expect(await state(page)).toEqual(before); expect(await snapshots(page)).toEqual([])
  expect(modelRequests - initial).toBe(5); expect(creates).toHaveLength(1)
  const posted = creates[0] as { authoring: { scope: { placement: { definitionIds: string[] } }; project: { assets: unknown } } }
  expect(posted.authoring.scope.placement.definitionIds).toHaveLength(1)
  expect(JSON.stringify(creates[0])).not.toContain('"resources"')
  await page.getByRole('button', { name: '查看AI草稿', exact: true }).click()
  await expect(page.locator('.ai-preview-banner')).toContainText('AI草稿预览 · 主工程未改变')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  expect(await state(page)).toEqual(before)
  await page.getByRole('button', { name: '查看主工程', exact: true }).click()
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 30_000 })
  await expect(authoring).toContainText('保护快照和保存已完成', { timeout: 30_000 }); await settled(page)
  const adopted = await state(page), [id] = Object.keys(adopted.document.props), protections = await snapshots(page)
  expect(adopted.document.revision).toBe(1); expect(Object.keys(adopted.document.props)).toHaveLength(1)
  expect(adopted.document.props[id]).toMatchObject({ positionMm: { x: 5000, y: 4000 }, rotationDeg: 30, appearance: { opacity: 0.6 } })
  expect(adopted.canUndo).toBe(true); expect(protections).toHaveLength(1); expect(protections[0]).toMatchObject({ kind: 'protection', sourceRevision: 0 })
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await state(page); expect(undone.document.revision).toBe(2); expect(undone.document.props).toEqual({}); expect(undone.canUndo).toBe(false)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  const redone = await state(page); expect(redone.document.revision).toBe(3); expect(redone.document.props[id]).toEqual(adopted.document.props[id])
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page)
  const reopened = await state(page); expect(reopened.document).toEqual(redone.document); expect(reopened.canUndo).toBe(false)
  expect(await snapshots(page)).toEqual(protections); expect(modelRequests - initial).toBe(5)
  expect(await page.evaluate(secret => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(secret), token)).toBe(false)
  expect(errors).toEqual([])
  await info.attach('m22-protected-adoption.json', { body: JSON.stringify({ sceneId: adopted.document.sceneId, revisions: [1, 2, 3], propId: id, protectionId: protections[0].id, modelRequests: 5 }), contentType: 'application/json' })
})

test('M2-2 a manual edit invalidates old task adoption while the isolated complete draft remains downloadable', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createBlank(page, 'M2-2 旧基线保留')
  const initial = modelRequests, panel = await connect(page), authoring = await createDraft(page, panel)
  await page.getByTestId('workspace-navigation').getByRole('tab', { name: '图层', exact: true }).click()
  await page.getByRole('button', { name: '新建用户图层', exact: true }).click()
  await page.getByLabel('新图层名称', { exact: true }).fill('任务之后的人工图层')
  await page.getByRole('button', { name: '创建图层', exact: true }).click(); await settled(page)
  const manual = await state(page); expect(manual.document.revision).toBe(1)
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  await expect(panel).toContainText('工程已有新修订')
  const downloaded = page.waitForEvent('download')
  await authoring.getByRole('button', { name: '下载完整草稿备份', exact: true }).click()
  const download = await downloaded; expect(download.suggestedFilename()).toBe('sceneweave-ai-draft.sceneweave')
  const filename = await download.path(); expect(filename).not.toBeNull()
  const archive = unzipSync(new Uint8Array(await readFile(filename!))), decode = new TextDecoder()
  const manifest = JSON.parse(decode.decode(archive['manifest.json'])), scene = JSON.parse(decode.decode(archive['scene.json']))
  expect(manifest).toMatchObject({ format: 'sceneweave-complete-project', schemaVersion: 1, packageMode: 'complete', revision: 0 })
  expect(Object.keys(scene.props)).toHaveLength(1); expect(scene.revision).toBe(0)
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(authoring.getByRole('alert')).toContainText('已有修改')
  expect(await state(page)).toEqual(manual); expect(await snapshots(page)).toEqual([])
  expect(modelRequests - initial).toBe(5); expect(errors).toEqual([])
})

test('M2-2 explicit pause and supplementary resume preserve earlier draft steps and adopt all steps once', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createBlank(page, 'M2-2 暂停续批')
  const before = await state(page), initial = modelRequests, panel = await connect(page)
  const creation = page.waitForResponse(response => response.url() === backendUrl + '/v1/tasks' && response.request().method() === 'POST')
  const authoring = await beginDraft(page, panel, '暂停续批测试：先放一盏铜色桌灯，等待我追加要求。')
  const created = await (await creation).json() as TaskSnapshot
  await expect(panel.getByLabel('AI 回复文字', { exact: true })).toContainText('已有一笔有效放置草稿')
  await expect(authoring).toContainText('实际操作 1/256')
  await expect(authoring.getByLabel('AI 草稿差异', { exact: true }).locator(':scope > li')).toHaveCount(1)
  const firstStep = structuredClone(store.read(created.id).authoring!.state.steps[0])
  expect(modelRequests - initial).toBe(3); expect(await state(page)).toEqual(before)
  await panel.getByRole('button', { name: '暂停回复', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已暂停')
  const paused = store.read(created.id)
  expect(paused.snapshot.generation).toBe(2); expect(paused.authoring!.state.steps).toEqual([firstStep])
  expect(await state(page)).toEqual(before); expect(await snapshots(page)).toEqual([])
  await panel.getByLabel('AI 继续补充要求', { exact: true }).fill('明确继续扩展草稿：保留已放桌灯，再设透明度0.6并移动到5000,4000、旋转30度。')
  await panel.getByRole('checkbox', { name: /^我确认继续会发起新的模型请求/ }).check()
  await panel.getByRole('button', { name: '确认继续任务', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 30_000 })
  await expect(authoring).toContainText('实际操作 3/256')
  const continued = store.read(created.id)
  expect(continued.snapshot.generation).toBe(3); expect(continued.authoring!.state.steps).toHaveLength(3)
  expect(continued.authoring!.state.steps[0]).toEqual(firstStep)
  expect(continued.snapshot.text).not.toContain('迟到模型结果'); expect(modelRequests - initial).toBe(6)
  expect(await state(page)).toEqual(before)
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 30_000 })
  await expect(authoring).toContainText('保护快照和保存已完成', { timeout: 30_000 }); await settled(page)
  const adopted = await state(page), [prop] = Object.values(adopted.document.props)
  expect(adopted.document.revision).toBe(1); expect(Object.keys(adopted.document.props)).toHaveLength(1)
  expect(prop).toMatchObject({ positionMm: { x: 5000, y: 4000 }, rotationDeg: 30, appearance: { opacity: 0.6 } })
  expect(await snapshots(page)).toHaveLength(1)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  expect((await state(page)).document.props).toEqual({}); expect((await state(page)).canUndo).toBe(false)
  expect(modelRequests - initial).toBe(6); expect(errors).toEqual([])
})

test('M2-2 ready tasks survive a page refresh and explicitly reattach to the exact local baseline without another model request', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createBlank(page, 'M2-2 刷新重绑')
  const before = await state(page), initial = modelRequests
  let panel = await connect(page)
  await createDraft(page, panel); expect(modelRequests - initial).toBe(5)
  expect(await state(page)).toEqual(before)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const savedRow = page.getByTestId('workspace-home').locator('.home-project-row').filter({ has: page.getByRole('heading', { name: 'M2-2 刷新重绑', exact: true }) })
  await savedRow.getByRole('button', { name: '打开', exact: true }).click(); await settled(page)
  panel = await connect(page)
  await panel.getByRole('button', { name: '查询最近任务', exact: true }).click()
  const recent = panel.getByLabel('当前工程 AI 最近任务', { exact: true })
  await expect(recent.locator(':scope > li')).toHaveCount(1)
  await recent.getByRole('button', { name: /^查看任务 / }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用')
  const authoring = panel.getByRole('region', { name: 'AI 场景草稿', exact: true })
  await expect(authoring).toContainText('此任务尚未绑定当前本机基线')
  await expect(authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true })).toHaveCount(0)
  const reopened = await state(page)
  expect(reopened.document).toEqual(before.document); expect(reopened.identity).toEqual(before.identity); expect(reopened.appearance).toEqual(before.appearance)
  expect(modelRequests - initial).toBe(5); expect(await snapshots(page)).toEqual([])
  await authoring.getByRole('button', { name: '重新绑定并校验草稿', exact: true }).click()
  await expect(authoring.getByLabel('AI 草稿差异', { exact: true }).locator(':scope > li')).toHaveCount(1)
  await expect(authoring).toContainText('本机重放及实际素材校验通过')
  expect(await state(page)).toEqual(reopened); expect(modelRequests - initial).toBe(5)
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 30_000 })
  await expect(authoring).toContainText('保护快照和保存已完成', { timeout: 30_000 }); await settled(page)
  expect((await state(page)).document.revision).toBe(1); expect(await snapshots(page)).toHaveLength(1)
  expect(modelRequests - initial).toBe(5); expect(errors).toEqual([])
})

test('M2-2 a paused nonempty draft can finish for review and adopt without another model request', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = [], controls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.url().startsWith(backendUrl + '/v1/tasks/') && request.url().endsWith('/control') && request.method() === 'POST') {
      controls.push((request.postDataJSON() as { action: string }).action)
    }
  })
  await createBlank(page, 'M2-2 暂停草稿直接审阅')
  const before = await state(page), initial = modelRequests, panel = await connect(page)
  const creation = page.waitForResponse(response => response.url() === backendUrl + '/v1/tasks' && response.request().method() === 'POST')
  const authoring = await beginDraft(page, panel, '暂停续批测试：先放一盏铜色桌灯，我可能直接结束并采用当前草稿。')
  const created = await (await creation).json() as TaskSnapshot
  await expect(panel.getByLabel('AI 回复文字', { exact: true })).toContainText('已有一笔有效放置草稿')
  await expect(authoring).toContainText('实际操作 1/256')
  await expect(authoring.getByLabel('AI 草稿差异', { exact: true }).locator(':scope > li')).toHaveCount(1)
  const firstStep = structuredClone(store.read(created.id).authoring!.state.steps[0])
  expect(modelRequests - initial).toBe(3); expect(await state(page)).toEqual(before)
  await panel.getByRole('button', { name: '暂停回复', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已暂停')
  expect(store.read(created.id).snapshot.generation).toBe(2)
  expect(store.read(created.id).authoring!.state.steps).toEqual([firstStep])
  const finish = authoring.getByRole('button', { name: '结束生成并审阅当前草稿', exact: true })
  await expect(finish).toBeEnabled()
  await finish.click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 30_000 })
  await expect(authoring.getByLabel('AI 草稿差异', { exact: true }).locator(':scope > li')).toHaveCount(1)
  expect(modelRequests - initial).toBe(3); expect(controls).toEqual(['pause'])
  expect(store.read(created.id).authoring!.state.steps).toEqual([firstStep])
  expect(await state(page)).toEqual(before); expect(await snapshots(page)).toEqual([])
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 30_000 })
  await expect(authoring).toContainText('保护快照和保存已完成', { timeout: 30_000 }); await settled(page)
  const adopted = await state(page), [prop] = Object.values(adopted.document.props)
  expect(adopted.document.revision).toBe(1); expect(Object.keys(adopted.document.props)).toHaveLength(1)
  expect(prop).toMatchObject({ positionMm: { x: 4000, y: 4000 }, rotationDeg: 0, appearance: { opacity: 1 } })
  expect(await snapshots(page)).toHaveLength(1)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  expect((await state(page)).document.props).toEqual({}); expect((await state(page)).canUndo).toBe(false)
  expect(modelRequests - initial).toBe(3); expect(controls).toEqual(['pause']); expect(errors).toEqual([])
})
