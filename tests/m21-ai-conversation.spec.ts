import { test, expect, type Page } from '@playwright/test'
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
import type { ProviderAdapter, ProviderCompletion } from '../services/ai/provider-types'

// Real HTTP/CORS/SSE/SQLite and real browser UI, with a deterministic model substitute.
// The live paid-channel check is a separate explicit tool, never part of browser regression.
let backendUrl: string, token: string, directory: string, store: TaskStore, engine: TaskEngine
let server: ReturnType<typeof serve>, modelRequests = 0
const complete = (text: string, withTool = false): ProviderCompletion => ({ text,
  toolCalls: withTool ? [{ id: 'connection-call', name: 'sceneweave_connection_info', arguments: '{"topic":"connection"}' }] : [],
  finishReason: withTool ? 'tool_calls' : 'stop', usage: { inputTokens: 11, outputTokens: 7 }, requestId: 'browser-check' })

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-m21-browser-')); token = randomBytes(24).toString('hex')
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory,
    SCENEWEAVE_AI_ALLOWED_ORIGINS: new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'server-only-not-a-live-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'deterministic-test-model' })
  const provider: ProviderAdapter = { async complete(input) {
    modelRequests++
    const lastUser = input.messages.filter(message => message.role === 'user').at(-1)?.content ?? ''
    if (lastUser.includes('暂停测试')) {
      await input.onText('已收到暂停测试，正在等待。')
      await new Promise<void>(resolve => { if (input.signal.aborted) resolve(); else input.signal.addEventListener('abort', () => setTimeout(resolve, 50), { once: true }) })
      // A provider may complete late even after the engine aborts its generation.
      return complete('迟到结果不得复活任务。')
    }
    if (!input.messages.some(message => message.role === 'tool')) {
      await input.onText('正在检查连接。'); return complete('正在检查连接。', true)
    }
    await input.onText('连接检查完成。')
    await new Promise(resolve => setTimeout(resolve, 180))
    const text = '连接检查完成。当前只读，不修改场景。<img src=x onerror="window.aiUnsafe=true">'
    await input.onText(text.slice('连接检查完成。'.length))
    return complete(text)
  } }
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connectionInfo(config))
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => { if (server.listening) resolve(); else server.once('listening', resolve) })
  backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => { engine?.close(); if (server && 'closeAllConnections' in server) server.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

async function createBlank(page: Page, name: string) {
  await page.goto('/#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const form = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await form.getByLabel('场景名称', { exact: true }).fill(name); await form.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(form).toHaveCount(0); await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
}
async function connect(page: Page) {
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true })
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(backendUrl); await panel.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  return panel
}
async function project(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx'
    const { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    const state = nativeWorkspace.getState()
    return { document: structuredClone(state.project?.document), identity: structuredClone(state.project?.historyIdentity), canUndo: state.canUndo, checkpoint: nativeWorkspace.checkpoint() }
  })
}

test('M2-1 real HTTP text/tool continuation is plain text, preserves the project and recovers persisted tasks', async ({ page }) => {
  const errors: string[] = [], requests: unknown[] = []; page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url() === backendUrl + '/v1/tasks' && request.method() === 'POST') requests.push(request.postDataJSON()) })
  await createBlank(page, 'M2-1 对话隔离'); const before = await project(page), initial = modelRequests, panel = await connect(page)
  await panel.getByLabel('AI 对话输入', { exact: true }).fill('请检查连接，保持当前地图。')
  await panel.getByRole('button', { name: '发送新任务', exact: true }).click()
  const task = panel.getByRole('article', { name: 'AI 当前任务', exact: true })
  await expect(task.locator('.ai-task-heading > strong')).toHaveText('已完成')
  await expect(panel.getByLabel('AI 回复文字', { exact: true })).toContainText('当前只读，不修改场景。<img')
  await expect(panel.getByLabel('AI 只读工具进度', { exact: true })).toContainText('sceneweave_connection_info：完成')
  expect(await panel.locator('.ai-response img').count()).toBe(0)
  expect(await page.evaluate(() => (window as unknown as { aiUnsafe?: boolean }).aiUnsafe)).toBeUndefined()
  expect(modelRequests - initial).toBe(2); expect(await project(page)).toEqual(before)
  expect(requests).toHaveLength(1)
  expect(Object.keys(requests[0] as object).sort()).toEqual(['clientRequestId', 'context', 'prompt', 'schemaVersion'])
  const input = requests[0] as { context: { sceneId: string; revision: number; audience: string } }
  expect(input.context).toEqual({ sceneId: before.document!.sceneId, revision: before.document!.revision, audience: 'public' })
  expect(await page.evaluate(secret => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(secret), token)).toBe(false)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').getByRole('button', { name: '继续编辑', exact: true }).first().click()
  await expect(panel.getByLabel('AI 回复文字', { exact: true })).toContainText('连接检查完成。')
  await panel.getByRole('button', { name: '查询最近任务', exact: true }).click()
  const recent = panel.getByLabel('当前工程 AI 最近任务', { exact: true }); await expect(recent.locator('li')).toHaveCount(1)
  await recent.getByRole('button', { name: /^查看任务 / }).click()
  expect(modelRequests - initial).toBe(2); expect(await project(page)).toEqual(before)
  await panel.getByRole('button', { name: '删除服务器任务', exact: true }).click()
  await panel.getByRole('button', { name: '确认删除服务器任务', exact: true }).click()
  await expect(task).toHaveCount(0); expect(store.count()).toBe(0); expect(await project(page)).toEqual(before); expect(errors).toEqual([])
  await page.reload(); await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  await expect(panel.getByLabel('AI 应用凭据', { exact: true })).toHaveValue('')
})

test('M2-1 disconnect only rereads checkpoints, pause/resume is explicit and cancel rejects late model completion', async ({ page }) => {
  await createBlank(page, 'M2-1 中断代次'); const before = await project(page), panel = await connect(page), initial = modelRequests
  await panel.getByLabel('AI 对话输入', { exact: true }).fill('暂停测试')
  await panel.getByRole('button', { name: '发送新任务', exact: true }).click()
  await expect(panel.getByLabel('AI 回复文字', { exact: true })).toContainText('正在等待')
  await panel.getByRole('button', { name: '停止本地读取', exact: true }).click()
  await panel.getByRole('button', { name: '重新连接', exact: true }).click()
  await expect(panel.getByRole('button', { name: '暂停回复', exact: true })).toBeEnabled(); expect(modelRequests - initial).toBe(1)
  await panel.getByRole('button', { name: '暂停回复', exact: true }).click()
  const status = panel.locator('.ai-task-heading > strong'); await expect(status).toHaveText('已暂停')
  expect(await project(page)).toEqual(before)
  await panel.getByLabel('AI 继续补充要求', { exact: true }).fill('请完成连接检查。')
  await panel.getByRole('checkbox', { name: /^我确认继续会发起新的模型请求/ }).check(); await panel.getByRole('button', { name: '确认继续任务', exact: true }).click()
  await expect(status).toHaveText('已完成'); expect(modelRequests - initial).toBe(3)
  await panel.getByLabel('AI 对话输入', { exact: true }).fill('暂停测试：取消时检查迟到回复')
  await panel.getByRole('button', { name: '发送新任务', exact: true }).click()
  await expect(panel.getByLabel('AI 回复文字', { exact: true })).toContainText('正在等待')
  await panel.getByRole('button', { name: '取消任务', exact: true }).click(); await expect(status).toHaveText('已取消')
  await panel.getByRole('button', { name: '刷新任务', exact: true }).click(); await expect(status).toHaveText('已取消')
  await expect(panel.getByLabel('AI 回复文字', { exact: true })).not.toContainText('迟到结果')
  expect(await project(page)).toEqual(before)
})
