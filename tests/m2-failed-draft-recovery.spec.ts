import { expect, test, type Page } from '@playwright/test'
import { serve } from '@hono/node-server'
import { randomBytes, createHash } from 'node:crypto'
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
import type { ProviderAdapter, ProviderToolCall } from '../services/ai/provider-types'

// Real native UI/HTTP/SSE/SQLite/IndexedDB. The deterministic provider deliberately
// exhausts its request budget and ignores the final text-only boundary; no .env
// file or paid provider is used. Its last tool call must remain unexecuted.
let url: string, token: string, directory: string, store: TaskStore, engine: TaskEngine, server: ReturnType<typeof serve>
let providerRequests = 0
const providerToolCounts: number[] = []
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-failed-draft-')); token = randomBytes(24).toString('hex')
  const origin = new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_ACCESS_TOKEN: token,
    SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:1/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'deterministic-no-network', SCENEWEAVE_AI_PROVIDER_MODEL: 'deterministic-failed-draft' })
  const provider: ProviderAdapter = { async complete(input) {
    providerRequests++
    providerToolCounts.push(input.tools.length)
    const created = input.messages.some(message => message.role === 'tool' && message.toolCallId === 'create-valid-clue')
    const call: ProviderToolCall = created
      ? { id: `check-${providerRequests}`, name: 'sceneweave_check_draft', arguments: '{}' }
      : { id: 'create-valid-clue', name: 'sceneweave_edit_scene', arguments: JSON.stringify({ operations: [
        { kind: 'gmNote', id: 'preserved-gm-clue', anchor: { type: 'point', positionMm: { x: 3500, y: 3500 } }, noteKind: 'clue', title: '未寄出的信', text: '抽屉底下藏着一封写到一半的信。' },
      ] }) }
    return { text: '', toolCalls: [call], finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1 }, requestId: `deterministic-${providerRequests}` }
  } }
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connectionInfo(config))
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  engine?.close(); if (server && 'closeAllConnections' in server) server.closeAllConnections()
  await new Promise<void>(resolve => server?.close(() => resolve())); store?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function state(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx', { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    const value = nativeWorkspace.getState(), project = value.project!
    return { document: structuredClone(project.document), appearance: structuredClone(project.appearance), identity: structuredClone(project.historyIdentity),
      sources: structuredClone(project.authoringSources), checkpoint: nativeWorkspace.checkpoint(), canUndo: value.canUndo, canRedo: value.canRedo, status: value.status }
  })
}
async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}

test('request-limit failure keeps a valid local draft reviewable, downloadable and adoptable without another model request', async ({ page }, info) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('M2 请求耗尽后保全有效草稿')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await saved(page)
  const original = await state(page), count = providerRequests
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true }), authoring = page.getByRole('region', { name: 'AI 场景草稿', exact: true })
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(url); await panel.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  await authoring.getByLabel('AI 完整场景创作', { exact: true }).check()
  await authoring.getByLabel('AI 草稿要求', { exact: true }).fill('生成一条主持人线索；本测试模型随后反复自检直到请求次数耗尽。')
  await authoring.getByRole('checkbox', { name: '同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容', exact: true }).check()
  await authoring.getByRole('button', { name: '创建独立草稿任务', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('未完成', { timeout: 30_000 })
  expect(providerRequests - count).toBe(16)
  const task = store.list('maintainer').find(item => item.context?.sceneId === original.document.sceneId)!
  const failed = store.read(task.id, 'maintainer')
  expect(failed.snapshot).toMatchObject({ status: 'failed', usage: { requests: 16, unknown: false }, error: { code: 'request_limit', requestState: 'finished' } })
  expect(providerToolCounts.slice(count, count + 15).every(value => value > 0)).toBe(true)
  expect(providerToolCounts[count + 15]).toBe(0)
  expect(failed.authoring!.state.draftRevision).toBe(1); expect(failed.snapshot.tools).toHaveLength(15)
  expect(failed.snapshot.tools.some(item => item.callId === `check-${count + 16}`)).toBe(false)
  expect(failed.snapshot.tools.every(item => item.success)).toBe(true)
  expect(await state(page)).toEqual(original)
  await authoring.getByRole('button', { name: '重新绑定并校验草稿', exact: true }).click()
  await expect(authoring.getByRole('button', { name: '下载完整草稿备份', exact: true })).toBeEnabled()
  await expect(authoring.getByLabel('AI 草稿差异')).toContainText('preserved-gm-clue')
  expect(await state(page)).toEqual(original)
  const downloaded = page.waitForEvent('download')
  await authoring.getByRole('button', { name: '下载完整草稿备份', exact: true }).click()
  const download = await downloaded, filename = await download.path()
  expect(download.suggestedFilename()).toBe('sceneweave-ai-draft.sceneweave'); expect(filename).not.toBeNull()
  const archive = unzipSync(new Uint8Array(await readFile(filename!))), decode = new TextDecoder()
  const manifest = JSON.parse(decode.decode(archive['manifest.json'])), draftScene = JSON.parse(decode.decode(archive['scene.json']))
  expect(manifest).toMatchObject({ format: 'sceneweave-complete-project', schemaVersion: 2, packageMode: 'complete', revision: 0 })
  expect(draftScene.notes['preserved-gm-clue']).toMatchObject({ visibility: 'gm', kind: 'clue', title: '未寄出的信' })
  const entries = manifest.entries as { path: string; sizeBytes: number; sha256: string }[]
  for (const entry of entries) {
    expect(archive[entry.path].byteLength).toBe(entry.sizeBytes)
    expect(createHash('sha256').update(archive[entry.path]).digest('hex')).toBe(entry.sha256)
  }
  expect(await state(page)).toEqual(original); expect(providerRequests - count).toBe(16)
  await authoring.getByRole('button', { name: '结束生成并审阅当前草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用')
  expect(store.read(task.id, 'maintainer').snapshot).toMatchObject({ status: 'ready', usage: { requests: 16 }, error: null })
  expect(providerRequests - count).toBe(16); expect(await state(page)).toEqual(original)
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用'); await saved(page)
  await expect(authoring.getByRole('button', { name: '确认本机未采用并释放租约', exact: true })).toHaveCount(0)
  const adopted = await state(page)
  expect(adopted.document.revision).toBe(original.document.revision + 1)
  expect(adopted.document.notes['preserved-gm-clue']).toEqual(draftScene.notes['preserved-gm-clue'])
  const persistence = await page.evaluate(async sceneId => {
    const path = '/src/platform/browser/runtime.ts', { projectRepository } = await import(path) as typeof import('../src/platform/browser/runtime')
    const current = await projectRepository.load(sceneId), snapshots = await projectRepository.listSnapshots(sceneId)
    const protection = await projectRepository.loadSnapshot(sceneId, snapshots[0].id)
    return { document: current!.project.document, snapshots, protectedDocument: protection!.bundle.project.document }
  }, adopted.document.sceneId)
  expect(persistence.document).toEqual(adopted.document); expect(persistence.snapshots).toHaveLength(1)
  expect(persistence.snapshots[0].kind).toBe('protection'); expect(persistence.protectedDocument).toEqual(original.document)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(page)
  const undone = await state(page)
  expect(undone.document.notes).toEqual(original.document.notes)
  expect(undone.document.props).toEqual(original.document.props)
  expect(undone.document.revision).toBe(adopted.document.revision + 1); expect(undone.canRedo).toBe(true)
  expect(providerRequests - count).toBe(16); expect(errors).toEqual([])
  await info.attach('failed-draft-recovery.json', { body: JSON.stringify({ provider: 'deterministic; no paid model', requests: 16, additionalRequestsDuringReviewBackupAdoptionUndo: 0,
    failedDraftRevision: failed.authoring!.state.draftRevision, verifiedBackupEntries: entries.length, protectionCount: persistence.snapshots.length,
    mainRevisions: [original.document.revision, adopted.document.revision, undone.document.revision] }), contentType: 'application/json' })
})
