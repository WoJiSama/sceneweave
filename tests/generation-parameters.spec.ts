import { expect, test, type Page } from '@playwright/test'
import { z } from 'zod'
import { AI_LIMITS, ConnectionInfoSchema, TaskSnapshotSchema } from '../src/shared/ai/protocol'
import { openGenerationTask, openWorkspaceModule } from './workspace-navigation-helpers'

const backend = 'http://127.0.0.1:9876'
const capability = ConnectionInfoSchema.parse({ schemaVersion: 1, model: 'deterministic-parameter-substitute', protocol: 'chat-completions',
  capabilities: { conversation: true, connectionTool: true, sceneDraft: false, svg: true, vision: 'disabled' }, retentionDays: AI_LIMITS.retentionDays,
  limits: { modelRequests: AI_LIMITS.modelRequests, toolCalls: AI_LIMITS.toolCalls, executionMs: AI_LIMITS.executionMs,
    promptBytes: AI_LIMITS.promptBytes, outputBytes: AI_LIMITS.outputBytes } })
const completion = (clientRequestId: string, text: string) => TaskSnapshotSchema.parse({ schemaVersion: 1, id: 'parameter-test-task', clientRequestId, context: null,
  status: 'completed', generation: 1, lastSequence: 0, text, tools: [], usage: { requests: 1, inputTokens: 10, outputTokens: 20, unknown: false },
  error: null, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86400000 })
const taskListSchema = z.object({ schemaVersion: z.literal(1), tasks: z.array(TaskSnapshotSchema).max(20) }).strict()
const taskList = (tasks: unknown[] = []) => taskListSchema.parse({ schemaVersion: 1, tasks })
const valid = JSON.stringify({ parameters: { roomCount: 2, title: '解析的林中哨站' }, ambiguities: ['房间共用休息用途，需确认'], unsupported: ['帐篷尚未支持'] })

async function openAssistant(page: Page) {
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('参数解析保全原工程')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await openWorkspaceModule(page, 'AI')
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true })
  const settings = panel.locator('details.ai-connection')
  if (await settings.getAttribute('open') === null) await settings.locator('summary').first().click()
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(backend)
  await panel.getByLabel('AI 应用凭据', { exact: true }).fill('not-a-provider-key')
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  await openGenerationTask(page, '混合场景')
  const mixed = page.getByRole('region', { name: '混合场景生成', exact: true })
  const assistant = mixed.locator('details[aria-label="自然语言填参数试验"]')
  await assistant.locator('summary').click()
  await assistant.getByLabel('参数解析地图需求').fill('林中哨站，两间房，需要帐篷')
  return { mixed, assistant }
}

test('parameter task proposes a reviewed form draft without generating or changing the current project', async ({ page }) => {
  test.setTimeout(180000)
  const creates: Record<string, unknown>[] = [], workers: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  await page.route(backend + '/v1/**', async route => {
    const request = route.request(), headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (request.url().includes('/capabilities')) return route.fulfill({ json: capability, headers })
    if (request.method() === 'POST' && request.url().endsWith('/tasks')) {
      const input = request.postDataJSON(); creates.push(input)
      return route.fulfill({ status: 201, json: completion(input.clientRequestId, valid), headers })
    }
    return route.fulfill({ json: taskList(), headers })
  })
  const { mixed, assistant } = await openAssistant(page), workerCount = workers.length
  await assistant.getByRole('button', { name: '解析为参数草稿', exact: true }).click()
  await expect(assistant.getByRole('region', { name: '待确认生成参数' })).toBeVisible()
  await expect(mixed.getByLabel('混合建筑房间数量')).toHaveValue('1')
  await expect(assistant).toContainText('沿用当前表单')
  await expect(assistant).toContainText('帐篷尚未支持')
  await assistant.getByRole('button', { name: '填入生成参数', exact: true }).click()
  await expect(mixed.getByLabel('混合建筑房间数量')).toHaveValue('2')
  await expect(mixed.getByLabel('混合工程名称')).toHaveValue('解析的林中哨站')
  await expect(page.getByLabel('混合候选摘要', { exact: true })).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  expect(workers.length).toBe(workerCount)
  expect(creates).toHaveLength(1)
  expect(creates[0]).toMatchObject({ context: null, schemaVersion: 1 })
  expect(creates[0]).not.toHaveProperty('authoring'); expect(creates[0]).not.toHaveProperty('vision')
  expect(String(creates[0].prompt)).not.toContain('参数解析保全原工程')
})

test('unknown create only queries the original request and keeps the form manually editable', async ({ page }) => {
  test.setTimeout(180000)
  let creates = 0, queries = 0
  await page.route(backend + '/v1/**', async route => {
    const request = route.request(), headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (request.url().includes('/capabilities')) return route.fulfill({ json: capability, headers })
    if (request.method() === 'POST') { creates++; return route.abort('failed') }
    queries++; return route.fulfill({ json: taskList(), headers })
  })
  const { mixed, assistant } = await openAssistant(page)
  await assistant.getByRole('button', { name: '解析为参数草稿', exact: true }).click()
  await expect(assistant).toContainText('创建结果未确认')
  await expect(assistant.getByRole('button', { name: '解析为参数草稿', exact: true })).toBeDisabled()
  await assistant.getByRole('button', { name: '查询已有参数任务', exact: true }).click()
  await expect(assistant).toContainText('结果仍未知')
  await mixed.getByLabel('混合建筑房间数量').fill('3')
  await expect(mixed.getByLabel('混合建筑房间数量')).toHaveValue('3')
  await expect(assistant.getByLabel('参数解析地图需求')).toHaveValue('林中哨站，两间房，需要帐篷')
  expect(creates).toBe(1); expect(queries).toBe(1)
  await expect(page.getByLabel('混合候选摘要', { exact: true })).toHaveCount(0)
})

test('unknown creation recovers the original request after twenty-one newer tasks without another create', async ({ page }) => {
  test.setTimeout(180000)
  let creates = 0
  let original: ReturnType<typeof completion> | undefined
  const queries: URL[] = []
  const newer = Array.from({ length: 21 }, (_, index) => TaskSnapshotSchema.parse({
    ...completion(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, valid), id: `newer-task-${index}`,
  }))
  await page.route(backend + '/v1/**', async route => {
    const request = route.request(), headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (request.url().includes('/capabilities')) return route.fulfill({ json: capability, headers })
    if (request.method() === 'POST') {
      creates++
      original = TaskSnapshotSchema.parse({ ...completion(request.postDataJSON().clientRequestId, valid), createdAt: newer[0].createdAt - 60000, updatedAt: newer[0].updatedAt - 60000 })
      return route.abort('failed')
    }
    const url = new URL(request.url()); queries.push(url)
    const tasks = url.searchParams.get('clientRequestId') === original?.clientRequestId ? [original!] : newer.slice(0, 20)
    return route.fulfill({ json: taskList(tasks), headers })
  })
  const { mixed, assistant } = await openAssistant(page)
  await assistant.getByRole('button', { name: '解析为参数草稿', exact: true }).click()
  await expect(assistant).toContainText('创建结果未确认')
  expect(newer.every(task => task.updatedAt > original!.updatedAt)).toBe(true)
  await assistant.getByRole('button', { name: '查询已有参数任务', exact: true }).click()
  await expect(assistant.getByRole('region', { name: '待确认生成参数' })).toBeVisible()
  await expect(assistant.getByRole('button', { name: '解析为参数草稿', exact: true })).toBeEnabled()
  await expect(mixed.getByLabel('混合建筑房间数量')).toHaveValue('1')
  await expect(page.getByLabel('混合候选摘要', { exact: true })).toHaveCount(0)
  expect(creates).toBe(1)
  expect(queries).toHaveLength(1)
  expect(queries[0].pathname).toBe('/v1/tasks')
  expect([...queries[0].searchParams]).toEqual([['clientRequestId', original!.clientRequestId]])
})

test('malformed output preserves form data and a late valid result cannot overwrite intervening edits', async ({ page }) => {
  test.setTimeout(180000)
  let creates = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(backend + '/v1/**', async route => {
    const request = route.request(), headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (request.url().includes('/capabilities')) return route.fulfill({ json: capability, headers })
    if (request.method() === 'POST') {
      const input = request.postDataJSON(); creates++
      if (creates === 2) await gate
      return route.fulfill({ status: 201, json: completion(input.clientRequestId, creates === 1 ? '{"parameters":' : valid), headers })
    }
    return route.fulfill({ json: taskList(), headers })
  })
  const { mixed, assistant } = await openAssistant(page)
  await assistant.getByRole('button', { name: '解析为参数草稿', exact: true }).click()
  await expect(assistant).toContainText('AI回复不是完整JSON')
  await expect(mixed.getByLabel('混合建筑房间数量')).toHaveValue('1')
  await assistant.getByRole('button', { name: '解析为参数草稿', exact: true }).click()
  await expect.poll(() => creates).toBe(2)
  await mixed.getByLabel('混合建筑房间数量').fill('3'); release()
  await expect(assistant.getByRole('region', { name: '待确认生成参数' })).toBeVisible()
  await expect(assistant.getByRole('button', { name: '填入生成参数', exact: true })).toBeDisabled()
  await expect(assistant).toContainText('旧草稿不能覆盖新参数')
  await expect(mixed.getByLabel('混合建筑房间数量')).toHaveValue('3')
  await expect(page.getByLabel('混合候选摘要', { exact: true })).toHaveCount(0)
})
