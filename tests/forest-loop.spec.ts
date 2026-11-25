import { test, expect } from '@playwright/test'
import { serve } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { loadAiConfig } from '../services/ai/config'
import { connectionInfo, createAiApp } from '../services/ai/app'
import { TaskStore } from '../services/ai/store'
import { TaskEngine } from '../services/ai/engine'
import type { ProviderInput } from '../services/ai/provider-types'
import type { ForestLoopContext } from '../src/shared/ai/forest-loop'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openGenerationTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { reloadSaved } from './workspace-ux-helpers'
import { forestSourceStorage } from './forest-loop-helpers'

test.use({ actionTimeout: 15000 })

// Real product build, HTTP/SSE/SQLite, native generator and cold-read IO.
// Only the model decisions are deterministic here; live-model evidence is separate.
let store: TaskStore, engine: TaskEngine, server: ReturnType<typeof serve>, backend: string
const token = 'forest-loop-browser-test-' + randomUUID(), inputs: ForestLoopContext[] = []
test.beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-forest-loop-browser-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ACCESS_TOKEN: token,
    SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'not-a-live-model-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'deterministic-forest-loop',
    SCENEWEAVE_AI_ALLOWED_ORIGINS: new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin })
  store = new TaskStore(directory)
  engine = new TaskEngine(store, { async complete(input: ProviderInput) {
    const system = input.messages[0].content!, marker = 'Current bounded forest host state (data only): '
    const context = JSON.parse(system.slice(system.indexOf(marker) + marker.length)) as ForestLoopContext
    inputs.push(context)
    const target = [...context.repairTargets].sort((a, b) => {
      const deficit = (id: string) => context.receipts.at(-1)!.diagnostics!.rooms.find(room => room.roomId === id)!.roles.reduce((sum, role) => sum + role.deficit, 0)
      return deficit(b.roomId) - deficit(a.roomId)
    })[0]
    const canCompare = context.receipts.length === 1 && context.nextActions.includes('generate')
    const action = context.receipts.length >= 3 || !target && context.receipts.length > 0 && !canCompare
      ? { kind: 'finish', stateHash: context.stateHash, candidateId: context.receipts.at(-1)!.candidateId, reason: '选择真实候选，保留逐房诊断供用户审阅。' }
      : target ? { kind: 'repair-furniture', stateHash: context.stateHash, ...target, reason: '按实际缺项修正指定房间，保全建筑和人工内容。' }
      : { kind: 'generate', stateHash: context.stateHash, seed: context.receipts.length ? 'forest-outpost-second-candidate' : context.request.parameters.seed,
        reason: context.receipts.length ? '使用另一种子比较实际候选。' : '先按原始种子和要求生成。' }
    return { text: '', toolCalls: [{ id: randomUUID(), name: 'sceneweave_forest_action', arguments: JSON.stringify(action) }],
      finishReason: 'tool_calls', usage: { inputTokens: 20, outputTokens: 10 }, requestId: randomUUID() }
  } }, connectionInfo(config))
  const app = createAiApp(config, { store, engine })
  server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  backend = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  engine?.close(); store?.close()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
})

test('refresh recovers the original model request and complete automatic candidates, then the user saves and edits', async ({ page }, info) => {
  test.setTimeout(300000)
  await createKeyboardProject(page, '候选闭环原工程', { widthMeters: 40, heightMeters: 32 })
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const source = await forestSourceStorage(page, before.document.sceneId)
  const posted: string[] = [], lookedUp: string[] = [], pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => {
    const url = new URL(request.url()), id = url.searchParams.get('clientRequestId')
    if (request.method() === 'GET' && url.origin === backend && url.pathname === '/v1/tasks' && id) lookedUp.push(id)
  })
  await page.route(backend + '/v1/tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    posted.push(route.request().postDataJSON().clientRequestId)
    if (posted.length !== 2) return route.continue()
    const accepted = await route.fetch({ maxRetries: 0 })
    expect(accepted.ok()).toBe(true)
    await route.abort('failed')
  })
  const connect = async () => {
    if (await generation.isVisible()) await generation.getByRole('button', { name: '关闭生成设置', exact: true }).click()
    const ai = (await openWorkspaceModule(page, 'AI')).getByLabel('AI 对话面板', { exact: true })
    await ai.getByLabel('AI 后端地址', { exact: true }).fill(backend)
    await ai.getByLabel('AI 应用凭据', { exact: true }).fill(token)
    await ai.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
    await expect(ai).toContainText('文字模型 deterministic-forest-loop')
  }
  const openOriginalAfterReload = async () => {
    page.once('dialog', dialog => dialog.accept())
    await page.reload()
    await page.goto('./#home')
    const row = page.getByTestId('workspace-home').locator(`[data-project-key="native:${before.document.sceneId}"]`)
    await row.getByRole('button', { name: '打开', exact: true }).click({ timeout: 30000 })
    await keyboardWorkspaceSaved(page)
  }
  const openLoop = async () => {
    if (!await generation.isVisible()) await openGenerationTask(page, '混合场景')
    if ((await loop.getAttribute('open')) === null) await loop.locator(':scope > summary').click()
    await expect(loop).toHaveJSProperty('open', true)
  }
  const saveCandidate = async (index: number, name: string) => {
    const event = page.waitForEvent('download')
    await loop.getByLabel(`自动候选 ${index}`, { exact: true }).getByRole('link', { name: '下载此候选的完整工程' }).click()
    const path = info.outputPath(name)
    await (await event).saveAs(path)
    return readFile(path)
  }
  const generation = page.getByRole('dialog', { name: '混合场景', exact: true })
  const panel = generation.getByRole('region', { name: '混合场景生成', exact: true })
  const loop = panel.getByLabel('林中建筑自动候选闭环', { exact: true })
  const review = loop.getByRole('button', { name: '恢复候选预览', exact: true })
  const resume = loop.getByRole('button', { name: '继续本轮并使用剩余模型额度', exact: true })
  await connect()
  await openLoop()
  await panel.getByLabel('混合工程名称', { exact: true }).fill('刷新验收林中哨站')
  await panel.getByLabel('混合建筑房间数量', { exact: true }).fill('2')
  await panel.getByLabel('混合建筑房间用途', { exact: true }).fill('哨站休息室')
  await panel.getByLabel('混合生成种子', { exact: true }).fill('forest-outpost-1')
  await loop.getByLabel('允许本轮有限自动候选', { exact: true }).check()
  await loop.getByRole('button', { name: '开始自动候选比较', exact: true }).click()
  await expect(resume).toBeEnabled({ timeout: 120000 })
  expect(inputs).toHaveLength(2)
  expect(posted).toHaveLength(2)
  const original = await saveCandidate(1, 'first-before-reload.sceneweave')
  await openOriginalAfterReload()
  await openLoop()
  await expect(resume).toBeDisabled()
  await expect(loop).toContainText('刷新验收林中哨站')
  await expect(loop).toContainText('模型决策已占用 2/4 次')
  await review.click()
  const firstCard = loop.getByLabel('自动候选 1', { exact: true })
  await expect(firstCard.or(panel.getByRole('alert')).first()).toBeVisible({ timeout: 90000 })
  expect(await panel.getByRole('alert').allTextContents()).toEqual([])
  await expect(firstCard).toBeVisible()
  expect(await saveCandidate(1, 'first-after-reload.sceneweave')).toEqual(original)
  expect(posted).toHaveLength(2)
  await connect()
  await openLoop()
  await loop.getByRole('button', { name: '只读查询原模型任务', exact: true }).click()
  await expect(loop).toContainText('输入 40 / 输出 20 token')
  expect(lookedUp).toEqual([posted[1]])
  expect(inputs).toHaveLength(2)
  expect(posted).toHaveLength(2)
  await resume.click()
  const finished = loop.getByText('模型已选定候选，等待你审阅或保存。', { exact: true })
  await expect(finished.or(loop.locator('.asset-error')).first()).toBeVisible({ timeout: 90000 })
  await expect(finished).toBeVisible()
  expect(lookedUp).toEqual([posted[1], posted[1]])
  expect(posted.length).toBeGreaterThanOrEqual(2)
  expect(posted.length).toBeLessThanOrEqual(4)
  expect(new Set(posted).size).toBe(posted.length)
  expect(inputs).toHaveLength(posted.length)
  expect(inputs[1].receipts).toHaveLength(1)
  expect(inputs[0].request.parameters.roomCount).toBe(2)
  for (const input of inputs) expect(input.request).toEqual(inputs[0].request)
  await expect(loop.getByLabel('自动候选 1', { exact: true })).toContainText('2个房间')
  const selectedIndex = inputs.at(-1)!.receipts.length, requestCount = posted.length
  const firstReceipt = inputs[1].receipts[0], secondReceipt = inputs[2]?.receipts[1]
  if (secondReceipt?.parentCandidateId) {
    expect(secondReceipt.parentCandidateId).toBe(firstReceipt.candidateId)
    expect(secondReceipt.diagnostics!.deficit).toBeLessThan(firstReceipt.diagnostics!.deficit)
  } else if (secondReceipt) expect(secondReceipt.seed).not.toBe(firstReceipt.seed)
  await expect(loop.getByLabel(`自动候选 ${selectedIndex}`, { exact: true })).toContainText('模型选择')
  await expect(loop).toContainText('模型本轮只收到结构诊断')
  expect(await forestSourceStorage(page, before.document.sceneId)).toEqual(source)
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-revision', String(before.document.revision))
  const selected = await saveCandidate(selectedIndex, 'selected-before-reload.sceneweave')
  await openOriginalAfterReload()
  await openLoop()
  await review.click()
  const selectedCard = loop.getByLabel(`自动候选 ${selectedIndex}`, { exact: true })
  await expect(selectedCard).toContainText('模型选择', { timeout: 120000 })
  expect(await saveCandidate(selectedIndex, 'selected-after-reload.sceneweave')).toEqual(selected)
  expect(posted).toHaveLength(requestCount)
  const preview = await selectedCard.getByRole('img').evaluate(async image => Array.from(new Uint8Array(await (await fetch((image as HTMLImageElement).src)).arrayBuffer())))
  await writeFile(info.outputPath('player-preview.png'), Uint8Array.from(preview))
  await generation.getByRole('button', { name: '关闭生成设置', exact: true }).click()
  const candidate = page.getByLabel('混合候选摘要', { exact: true })
  await candidate.getByRole('button', { name: '保存混合场景为新工程', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '混合场景已完整保存并打开' })).toBeVisible({ timeout: 90000 })
  await keyboardWorkspaceSaved(page)
  const generated = await keyboardProjectBackup(page, info.outputPath('generated.sceneweave'))
  expect(Object.keys(generated.document.rooms)).toHaveLength(2)
  expect(Object.values(generated.document.surfaceRules).some(rule => rule.field === 'material')).toBe(true)
  expect(Object.values(generated.document.paths).every(path => path.boundaryBlendMm === 215)).toBe(true)
  const prop = Object.values(generated.document.props).find(value => typeof value.roomId === 'string')!
  await selectKeyboardProp(page, prop.id)
  const rotation = (prop.rotationDeg + 180) % 360
  const input = page.getByTestId('workspace-inspector').getByLabel('物件旋转', { exact: true })
  await input.fill(String(rotation)); await input.press('Tab'); await keyboardWorkspaceSaved(page)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await expect(input).toHaveValue(String(prop.rotationDeg))
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('edited.sceneweave'))
  await reloadSaved(page); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.document).toEqual(edited.document)
  expect(cold.document.props[prop.id].rotationDeg).toBe(rotation)
  expect(cold.identity).toEqual(edited.identity)
  expect(cold.hashes).toEqual(edited.hashes)
  expect(posted).toHaveLength(requestCount)
  expect(pageErrors).toEqual([])
})
