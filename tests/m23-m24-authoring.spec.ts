import { test, expect } from '@playwright/test'
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
import type { ProviderAdapter, ProviderCompletion, ProviderToolCall } from '../services/ai/provider-types'

let url: string, token: string, directory: string, store: TaskStore, engine: TaskEngine, server: ReturnType<typeof serve>
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M40 2 L75 70 L5 70 Z" fill="#a95629" stroke="#3b241f" stroke-width="3"/><circle cx="40" cy="48" r="12" fill="#ffd36a"/></svg>'
const call = (id: string, operations: unknown[]): ProviderToolCall => ({ id, name: 'sceneweave_edit_scene', arguments: JSON.stringify({ operations }) })
const done = (toolCalls: ProviderToolCall[] = []): ProviderCompletion => ({ text: toolCalls.length ? '' : '小屋与院落草稿已完成，请检查。', toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 20, outputTokens: 30 }, requestId: 'controlled-m23-m24' })
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-m234-')); token = randomBytes(24).toString('hex')
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: 'http://127.0.0.1:5173', SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'no-network-controlled-provider', SCENEWEAVE_AI_PROVIDER_MODEL: 'controlled-m234' })
  const provider: ProviderAdapter = { async complete(input) {
    const receipt = (id: string) => input.messages.some(m => m.role === 'tool' && m.toolCallId === id)
    const authorization = JSON.parse(input.messages.find(m => m.role === 'user' && m.content?.startsWith('Authorized public'))!.content!.split('\n').slice(1).join('\n'))
    const floor = authorization.worldBoundsMm[0].floorId
    if (!receipt('rooms')) return done([call('rooms', [
      { kind: 'room', id: 'ai-room-one', boundaryMm: [{ x: 2000, y: 2000 }, { x: 6000, y: 2000 }, { x: 6000, y: 6000 }, { x: 2000, y: 6000 }], thicknessMm: 100, purpose: '起居室' },
      { kind: 'room', id: 'ai-room-two', boundaryMm: [{ x: 6000, y: 2000 }, { x: 10000, y: 2000 }, { x: 10000, y: 6000 }, { x: 6000, y: 6000 }], thicknessMm: 100, purpose: '卧室' },
      { kind: 'terrain', id: 'ai-yard', boundaryMm: [{ x: 1500, y: 6800 }, { x: 16000, y: 6800 }, { x: 16000, y: 11000 }, { x: 1500, y: 11000 }], groundElevationMm: 0 },
      { kind: 'path', id: 'ai-road', centerlineMm: [{ x: 4000, y: 6500 }, { x: 4000, y: 10500 }], widthMm: 900, supportRefs: [{ kind: 'floor', id: floor }, { kind: 'terrainArea', id: 'ai-yard' }] },
    ])])
    if (!receipt('read-build')) return done([{ id: 'read-build', name: 'sceneweave_read_scene', arguments: JSON.stringify({ section: 'scene', limit: 16 }) }])
    const scene = JSON.parse(input.messages.find(m => m.role === 'tool' && m.toolCallId === 'read-build')!.content!)
    if (!receipt('door')) {
      const vertices = scene.entities.filter((e: { entityKind: string }) => e.entityKind === 'vertex')
      const bottom = scene.entities.find((e: { entityKind: string; startVertexId: string; endVertexId: string }) => e.entityKind === 'wall' && vertices.some((v: { id: string; yMm: number }) => v.id === e.startVertexId && v.yMm === 6000) && vertices.some((v: { id: string; yMm: number }) => v.id === e.endVertexId && v.yMm === 6000))
      return done([call('door', [{ kind: 'opening', id: 'ai-door', wallId: bottom.id, offsetReferenceVertexId: bottom.startVertexId, offsetMm: 1200, widthMm: 1000, openingKind: 'door', state: 'open' }, { kind: 'entrance', openingIds: ['ai-door'] }])])
    }
    if (!receipt('find')) return done([{ id: 'find', name: 'sceneweave_find_assets', arguments: JSON.stringify({ query: '铜色桌灯', limit: 1 }) }])
    const definition = JSON.parse(input.messages.find(m => m.role === 'tool' && m.toolCallId === 'find')!.content!)[0].id
    if (!receipt('furnish')) return done([call('furnish', [{ kind: 'furnish', id: 'ai-lamp', definitionId: definition, positionMm: { x: 3500, y: 3500 }, supportRef: { kind: 'room', id: 'ai-room-one' } }, { kind: 'gmNote', id: 'ai-clue', anchor: { type: 'entity', entityKind: 'room', entityId: 'ai-room-one' }, noteKind: 'clue', title: '来客', text: '桌上有一封没有署名的信。' }])])
    if (!receipt('artwork')) return done([call('artwork', [{ kind: 'svg', id: 'ai-lamp', sourceSvg: svg, longEdgePx: 96, name: '铜色营灯变体' }, { kind: 'style', ids: ['ai-lamp'], brightness: .8, opacity: .7 }])])
    if (!receipt('check')) return done([{ id: 'check', name: 'sceneweave_check_draft', arguments: '{}' }])
    const completion = done()
    input.onText(completion.text)
    return completion
  } }
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connectionInfo(config))
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => { engine?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

test('complete scene and SVG recipes survive real HTTP review, protected adoption, undo and offline native reopen', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/#home'); await page.getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('M2-3/4 联合小屋')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18000'); await dialog.getByLabel('画布高度', { exact: true }).fill('12000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true }), authoring = page.getByRole('region', { name: 'AI 场景草稿', exact: true })
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(url); await panel.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click(); await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  await authoring.getByLabel('AI 完整场景创作', { exact: true }).check()
  await authoring.getByText('授权本工程素材（0）', { exact: true }).click(); await authoring.getByRole('checkbox', { name: '铜色桌灯', exact: true }).check()
  await authoring.getByLabel('AI 素材创作和同化', { exact: true }).check()
  await authoring.getByRole('checkbox', { name: '同时允许制作本任务新建物件的外观', exact: true }).check()
  await authoring.getByLabel('AI 草稿要求', { exact: true }).fill('制作两间小屋、入口、道路与院落，放一盏灯并制作SVG变体和线索。')
  await authoring.getByRole('checkbox', { name: '同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容', exact: true }).check()
  await authoring.getByRole('button', { name: '创建独立草稿任务', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 60_000 })
  const snapshot = store.list('maintainer')[0]
  expect(snapshot).toBeDefined()
  await expect(authoring.getByLabel('AI 草稿差异')).toContainText('SVG来源')
  const before = await page.evaluate(async () => { const { nativeWorkspace } = await import('/src/editor/main/Workbench.tsx' as string); return nativeWorkspace.getDocument().revision })
  expect(before).toBe(0)
  await authoring.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check(); await authoring.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 60_000 }); await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  const read = () => page.evaluate(async () => { const { nativeWorkspace } = await import('/src/editor/main/Workbench.tsx' as string); const p = nativeWorkspace.getState().project; return { document: p.document, sources: p.authoringSources, appearance: p.appearance } })
  const adopted = await read()
  expect(Object.keys(adopted.document.rooms)).toHaveLength(2); expect(Object.keys(adopted.document.walls)).toHaveLength(7)
  expect(adopted.document.constraints.entranceOpeningIds).toEqual(['ai-door']); expect(adopted.document.notes['ai-clue'].visibility).toBe('gm')
  expect(adopted.document.props['ai-lamp'].supportRef).toEqual({ kind: 'room', id: 'ai-room-one' }); expect(adopted.document.props['ai-lamp'].appearance.opacity).toBe(.7)
  expect(Object.keys(adopted.sources)).toHaveLength(1)
  const verification = await page.evaluate(async () => {
    const { nativeWorkspace } = await import('/src/editor/main/Workbench.tsx' as string), { validation, projectRepository } = await import('/src/platform/browser/runtime.ts' as string)
    const { exportHistoryArchive, importHistoryArchive } = await import('/src/shared/project/file.ts' as string)
    const p = nativeWorkspace.getState().project, { resources, ...project } = p
    const snapshots = await projectRepository.listSnapshots(project.document.sceneId)
    const bundle = { project, resources }, archive = { current: bundle, snapshots: [] }
    const bytes = await exportHistoryArchive(archive, validation), imported = await importHistoryArchive(bytes, validation)
    const source = Object.values(imported.current.project.authoringSources)[0] as { sourceSha256: string }
    const text = new TextDecoder().decode(await imported.current.resources.read(source.sourceSha256))
    return { sourceCount: Object.keys(imported.current.project.authoringSources).length, text, protectionCount: snapshots.length }
  })
  expect(verification).toEqual({ sourceCount: 1, text: svg, protectionCount: 1 })
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await expect(page.locator('.asset-save')).toHaveText('本地已保存'); expect((await read()).document.rooms).toEqual({})
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  const reopened = await read(); expect(reopened.sources).toEqual(adopted.sources); expect(reopened.document.props['ai-lamp']).toEqual(adopted.document.props['ai-lamp'])
  expect(errors).toEqual([])
})
