import { test, expect } from '@playwright/test'
import { serve } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
    const action = context.receipts.length >= 3 || !target && context.receipts.length > 0
      ? { kind: 'finish', stateHash: context.stateHash, candidateId: context.receipts.at(-1)!.candidateId, reason: '选择真实候选，保留逐房诊断供用户审阅。' }
      : target ? { kind: 'repair-furniture', stateHash: context.stateHash, ...target, reason: '按实际缺项修正指定房间，保全建筑和人工内容。' }
      : { kind: 'generate', stateHash: context.stateHash, seed: context.request.parameters.seed, reason: '先按原始种子和要求生成。' }
    return { text: '', toolCalls: [{ id: randomUUID(), name: 'sceneweave_forest_action', arguments: JSON.stringify(action) }],
      finishReason: 'tool_calls', usage: { inputTokens: 20, outputTokens: 10 }, requestId: randomUUID() }
  } }, connectionInfo(config))
  const app = createAiApp(config, { store, engine })
  server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  backend = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => { engine.close(); store.close(); await new Promise<void>(resolve => server.close(() => resolve())) })

test('the model sees actual diagnostics and adjusts, then the user saves and edits a complete cold-readable project', async ({ page }, info) => {
  test.setTimeout(240000)
  await createKeyboardProject(page, '候选闭环原工程')
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const source = await forestSourceStorage(page, before.document.sceneId)
  const ai = (await openWorkspaceModule(page, 'AI')).getByLabel('AI 对话面板', { exact: true })
  await ai.getByLabel('AI 后端地址', { exact: true }).fill(backend)
  await ai.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await ai.getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(ai).toContainText('文字模型 deterministic-forest-loop')
  await openGenerationTask(page, '混合场景')
  const panel = page.getByTestId('workspace-resources').getByRole('region', { name: '混合场景生成', exact: true })
  await panel.getByLabel('混合建筑房间数量', { exact: true }).fill('2')
  await panel.getByLabel('混合建筑房间用途', { exact: true }).fill('哨站休息室')
  await panel.getByLabel('混合生成种子', { exact: true }).fill('forest-outpost-1')
  const loop = panel.getByLabel('林中建筑自动候选闭环', { exact: true })
  await loop.locator(':scope > summary').click()
  await loop.getByLabel('允许本轮有限自动候选', { exact: true }).check()
  await loop.getByRole('button', { name: '开始自动候选比较', exact: true }).click()
  await expect(loop.getByRole('button', { name: '只读查询原模型任务', exact: true })).toBeVisible({ timeout: 180000 })
  await expect(loop.getByText('模型已完成比较，候选等待你审阅保存。', { exact: true })).toBeVisible()
  expect(inputs).toHaveLength(4)
  expect(inputs[1].receipts).toHaveLength(1); expect(inputs[2].receipts).toHaveLength(2)
  expect(inputs[0].request.parameters.roomCount).toBe(2)
  expect(inputs[2].request).toEqual(inputs[0].request)
  await expect(loop.getByLabel('自动候选 1', { exact: true })).toContainText('2个房间')
  expect(inputs[1].receipts[0].diagnostics?.deficit).toBe(4)
  expect(inputs[3].receipts[2].diagnostics?.deficit).toBeLessThan(4)
  await expect(loop.getByLabel('自动候选 3', { exact: true })).toContainText('模型选择')
  await expect(loop.getByLabel('自动候选 3', { exact: true })).not.toContainText('座椅目标5件，实际3件，缺2件')
  await expect(loop).toContainText('模型本轮只收到结构诊断')
  expect(await forestSourceStorage(page, before.document.sceneId)).toEqual(source)
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-revision', String(before.document.revision))
  const downloadEvent = page.waitForEvent('download')
  await loop.getByLabel('自动候选 1', { exact: true }).getByRole('link', { name: '下载此候选的完整工程' }).click()
  await (await downloadEvent).saveAs(info.outputPath('first-candidate.sceneweave'))
  await page.screenshot({ path: info.outputPath('compared-candidates.png'), fullPage: true })
  const candidate = page.getByTestId('workspace-inspector').getByLabel('混合候选摘要', { exact: true })
  await expect(candidate).not.toContainText('座椅目标5件，实际3件，缺2件')
  await candidate.getByRole('button', { name: '保存混合场景为新工程', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '混合场景已完整保存并打开' })).toBeVisible({ timeout: 90000 })
  await keyboardWorkspaceSaved(page)
  const generated = await keyboardProjectBackup(page, info.outputPath('generated.sceneweave'))
  expect(Object.keys(generated.document.rooms)).toHaveLength(2)
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
})
