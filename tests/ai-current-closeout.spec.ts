import { test, expect, type Page } from '@playwright/test'
import { serve } from '@hono/node-server'
import { createHash, randomBytes } from 'node:crypto'
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
import type { PublicScreenshotRefV4 } from '../src/shared/ai/authoring-closeout'
import type { SceneDocument } from '../src/shared/model/scene'
import type { DraftStampV4 } from '../src/shared/ai/authoring-protocol-v4'

// Actual Canvas/player PNG, HTTP/SSE, SQLite, IndexedDB and native resource
// validation. Only the provider is deterministic; no env file or paid request.
let directory: string, token: string, backendUrl: string, store: TaskStore, engine: TaskEngine
let server: ReturnType<typeof serve>, requests = 0, waitingForPause = false, createdTaskId = ''
const seenImages: { sha256: string; draftRevision: number; generation: number }[] = []
const tool = (id: string, name: string, args: unknown): ProviderToolCall => ({ id, name, arguments: JSON.stringify(args) })
const completion = (toolCalls: ProviderToolCall[] = [], text = ''): ProviderCompletion => ({ text, toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 12, outputTokens: 9 }, requestId: 'current-authoring-local-fixture' })
const result = <T,>(input: ProviderInput, id: string): T | undefined => {
  const message = input.messages.find(value => value.role === 'tool' && value.toolCallId === id)
  return message?.content ? JSON.parse(message.content) as T : undefined
}
function screenshotReference(input: ProviderInput): PublicScreenshotRefV4 | undefined {
  const message = input.messages.findLast(value => value.images?.length)
  const match = message?.content?.match(/Server-owned public screenshot reference \(data only\): (\{[^\n]+\})\. Use this compact/)
  if (!match) return undefined
  const ref = JSON.parse(match[1]) as PublicScreenshotRefV4
  expect(ref.sha256).toBe(message!.images!.at(-1)!.sha256)
  return ref
}
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-current-authoring-')); token = randomBytes(24).toString('hex')
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory,
    SCENEWEAVE_AI_ALLOWED_ORIGINS: new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:1/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'deterministic-no-network', SCENEWEAVE_AI_PROVIDER_MODEL: 'current-authoring-local-fixture',
    SCENEWEAVE_AI_PROVIDER_VISION: 'enabled' })
  const provider: ProviderAdapter = { async complete(input) {
    requests++
    const ref = screenshotReference(input)
    if (ref && !seenImages.some(value => value.sha256 === ref.sha256 && value.generation === ref.generation)) seenImages.push({ sha256: ref.sha256, draftRevision: ref.draft.draftRevision, generation: ref.generation })
    if (!result(input, 'find-fixed-lamp')) return completion([tool('find-fixed-lamp', 'sceneweave_find_assets', { query: '铜色桌灯', limit: 5 })])
    const definitionId = result<{ assets: { id: string }[] }>(input, 'find-fixed-lamp')?.assets[0]?.id
    if (!definitionId) throw new Error('Expected the explicitly granted fixed lamp')
    const placed = result<{ affectedIds: string[]; expected: DraftStampV4 }>(input, 'place-fixed-lamp')
    if (!placed) return completion([tool('place-fixed-lamp', 'sceneweave_edit_props', { operations: [
      { kind: 'place', definitionId, positionMm: { x: 4000, y: 4000 } },
    ] })])
    const id = placed.affectedIds[0]
    if (!result(input, 'atomic-furnishing-stage')) return completion([tool('atomic-furnishing-stage', 'sceneweave_apply_stage', {
      stage: 'furnishing', expected: placed.expected,
      operations: Array.from({ length: 17 }, (_, index) => ({ kind: 'opacity', id, value: index % 2 ? 0.7 : 0.65 })),
    })])
    if (!input.messages.some(message => message.role === 'user' && message.content?.includes('画面复核继续'))) {
      waitingForPause = true; await input.onText('阶段已原子完成，等待用户暂停并另行授权当前草稿图片。')
      await new Promise<void>(resolve => { if (input.signal.aborted) resolve(); else input.signal.addEventListener('abort', () => resolve(), { once: true }) })
      return completion([], '迟到结果不能写回已暂停任务。')
    }
    if (result(input, 'apply-exact-visual-correction')) {
      const text = '阶段与有限修正已完成。清单中的其他目标和最终画面仍需人工核对。'
      await input.onText(text); return completion([], text)
    }
    if (!ref) throw new Error('Fresh resumed exact-draft public image reference is required')
    const proposed = result<{ candidateHash: string; expected: DraftStampV4; screenshotBinding: PublicScreenshotRefV4;
      issues: unknown[]; candidateOperations: unknown[] }>(input, 'review-real-public-png')
    if (!proposed) return completion([tool('review-real-public-png', 'sceneweave_visual_review', { screenshotRef: ref,
      issues: [{ observation: '本地替身的指定观察：灯具透明度需要微调。', uncertainty: '此固定测试不作审美判断。', target: { kind: 'entities', ids: [id] } }],
      candidateOperations: [{ kind: 'opacity', id, value: 0.55 }],
    })])
    if (!result(input, 'apply-exact-visual-correction')) return completion([tool('apply-exact-visual-correction', 'sceneweave_apply_visual_correction', {
      screenshotRef: proposed.screenshotBinding, issues: proposed.issues, candidateOperations: proposed.candidateOperations,
      expected: proposed.expected, candidateHash: proposed.candidateHash,
    })])
    const text = '阶段与有限修正已完成。清单中的其他目标和最终画面仍需人工核对。'
    await input.onText(text); return completion([], text)
  } }
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connectionInfo(config))
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  engine?.close(); if (server && 'closeAllConnections' in server) server.closeAllConnections()
  await new Promise<void>(resolve => server?.close(() => resolve())); store?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus || !createdTaskId) return
  try {
    const current = store.read(createdTaskId)
    await info.attach('task-at-failure.json', { body: JSON.stringify({ requests, snapshot: current.snapshot }), contentType: 'application/json' })
  } catch (error) {
    await info.attach('task-at-failure.txt', { body: `mock provider requests=${requests}; ${String(error)}`, contentType: 'text/plain' })
  }
})
async function saved(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90000 })
}
async function current(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const filename = await (await pending).path()
  if (!filename) throw new Error('Expected the actual complete project download')
  const files = unzipSync(new Uint8Array(await readFile(filename))), decode = new TextDecoder()
  const manifest = JSON.parse(decode.decode(files['manifest.json'])) as { schemaVersion: number; entries: { path: string; sizeBytes: number; sha256: string }[]; assetRecords: Record<string, unknown>; licenseBindings: unknown[] }
  const document = JSON.parse(decode.decode(files['scene.json'])) as SceneDocument
  const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
  expect(Object.keys(files).sort()).toEqual(['manifest.json', ...manifest.entries.map(entry => entry.path)].sort())
  for (const entry of manifest.entries) { expect(files[entry.path].length).toBe(entry.sizeBytes); expect(sha(files[entry.path])).toBe(entry.sha256) }
  return { document, schemaVersion: manifest.schemaVersion, assetCount: Object.keys(manifest.assetRecords).length,
    hash: sha(JSON.stringify({ entries: manifest.entries.slice().sort((a, b) => a.path.localeCompare(b.path)), assetRecords: manifest.assetRecords, licenseBindings: manifest.licenseBindings })),
    canUndo: await page.getByRole('button', { name: '撤销素材编辑', exact: true }).isEnabled() }
}

test('complete6 staged draft uses fresh authorised actual PNG for finite correction and protected in-place adoption', async ({ page }, info) => {
  test.setTimeout(240000)
  const errors: string[] = [], external: string[] = [], creates: CreateTaskRequest[] = [], capabilityUrls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) return route.continue()
    external.push(url.origin); return route.abort()
  })
  page.on('request', request => {
    if (request.url() === backendUrl + '/v1/tasks?authoringVersion=4' && request.method() === 'POST') creates.push(request.postDataJSON() as CreateTaskRequest)
    if (request.url().startsWith(backendUrl + '/v1/capabilities?')) capabilityUrls.push(request.url())
  })
  page.on('response', response => {
    if (response.url() === backendUrl + '/v1/tasks?authoringVersion=4' && response.request().method() === 'POST' && response.status() === 201) {
      void response.json().then((snapshot: { id: string }) => { createdTaskId = snapshot.id }).catch(() => {})
    }
  })
  await page.goto(new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').pathname + '#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('AI当前完整6阶段与真实图片链路')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await saved(page)
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  for (const version of [3, 4, 5, 6]) {
    const name = version === 6 ? '保存独立簇状布景副本' : version === 5 ? '保存独立曲线连接副本' : '保存独立地形副本'
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', `sceneweave-complete-project@${version}`, { timeout: 90000 })
    await saved(page)
  }
  await saved(page); const before = await current(page); expect(before.schemaVersion).toBe(6)
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true }), authoring = panel.getByRole('region', { name: 'AI 场景草稿', exact: true })
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(backendUrl); await panel.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  await authoring.getByRole('checkbox', { name: '允许使用明确素材放置新物件', exact: true }).check()
  await authoring.getByLabel('AI 放置表面', { exact: true }).selectOption('floor:' + Object.keys(before.document.floors)[0])
  await authoring.getByText('授权本工程素材（0）', { exact: true }).click(); await authoring.getByRole('checkbox', { name: '铜色桌灯', exact: true }).check()
  await authoring.getByLabel('AI 草稿要求', { exact: true }).fill('放一盏固定灯，阶段调整后等待我暂停，重新授权实际图片后做有限修正。')
  await authoring.getByRole('checkbox', { name: 'AI 发送公开截图', exact: true }).check()
  await authoring.getByRole('checkbox', { name: '同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容', exact: true }).check()
  await authoring.getByRole('button', { name: '创建独立草稿任务', exact: true }).click()
  await expect.poll(() => waitingForPause, { timeout: 60000 }).toBe(true)
  expect(creates).toHaveLength(1); expect(creates[0].authoring?.schemaVersion).toBe(4)
  expect(capabilityUrls).toContain(backendUrl + '/v1/capabilities?authoringVersion=4')
  await panel.getByRole('button', { name: '暂停回复', exact: true }).click(); await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已暂停')
  expect((await current(page)).hash).toBe(before.hash)
  await panel.getByLabel('AI 继续补充要求', { exact: true }).fill('画面复核继续：另行授权本次实际公开图片，先提案后精确修正。')
  await panel.getByRole('checkbox', { name: 'AI 继续发送公开截图', exact: true }).check()
  await panel.getByText('我确认继续会发起新的模型请求，可能产生费用；上一请求未知时不会自动重发。', { exact: true }).click()
  await panel.getByRole('button', { name: '确认继续任务', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 90000 })
  const taskId = (await panel.innerText()).match(/任务 ([A-Za-z0-9_.:-]+) · 发起修订/)?.[1]
  expect(taskId).toBeTruthy()
  const stored = store.read(taskId!)
  expect(stored.authoring!.start.schemaVersion).toBe(4)
  expect(stored.authoring!.state.steps).toHaveLength(4)
  expect(stored.authoring!.state.steps.map(step => step.operations.length)).toEqual([1, 16, 1, 1])
  expect(stored.snapshot.tools.every(value => value.success)).toBe(true)
  expect(stored.snapshot.authoring).toMatchObject({ schemaVersion: 4, closeout: { reviewable: true, appearanceReview: 'unconfirmed' } })
  expect(seenImages).toHaveLength(2); expect(seenImages.map(value => value.draftRevision)).toEqual([0, 3])
  expect(seenImages[0].sha256).not.toBe(seenImages[1].sha256)
  expect((await current(page)).hash).toBe(before.hash)
  const downloaded = page.waitForEvent('download'); await authoring.getByRole('button', { name: '下载完整草稿备份', exact: true }).click()
  const archivePath = await (await downloaded).path(); expect(archivePath).not.toBeNull()
  const archiveBytes = new Uint8Array(await readFile(archivePath!)), archive = unzipSync(archiveBytes)
  expect(JSON.parse(new TextDecoder().decode(archive['manifest.json']))).toMatchObject({ format: 'sceneweave-complete-project', schemaVersion: 6 })
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 90000 }); await saved(page)
  const adopted = await current(page), id = Object.keys(adopted.document.props)[0]
  expect(adopted.document.sceneId).toBe(before.document.sceneId); expect(adopted.document.revision).toBe(1)
  expect(adopted.document.props[id].appearance.opacity).toBe(0.55); expect(adopted.assetCount).toBe(before.assetCount)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(page)
  expect((await current(page)).document.props).toEqual({})
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(page)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await saved(page)
  const cold = await current(page); expect(cold.document.props[id].appearance.opacity).toBe(0.55); expect(cold.document.revision).toBe(3)
  expect(errors).toEqual([]); expect(external).toEqual([])
  await info.attach('current-authoring-complete6.sceneweave', { body: Buffer.from(archiveBytes), contentType: 'application/zip' })
  await info.attach('current-authoring-evidence.json', { body: JSON.stringify({ taskId: stored.snapshot.id, sourceKind: 'current-baseline', nativeVersion: 6,
    mockProviderRequests: requests, images: seenImages, steps: [1, 16, 1, 1], finalRevision: 3, completePackageBytes: archiveBytes.length }), contentType: 'application/json' })
})
