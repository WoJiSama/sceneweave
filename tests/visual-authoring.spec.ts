import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Workspace } from '../src/application/workspace/workspace'

type Dev = { workspace: Workspace }
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message)) })
test.afterEach(async ({ page }, info) => {
  await info.attach('visual-page-errors.json', { body: JSON.stringify(errors.get(page) ?? []), contentType: 'application/json' })
  expect(errors.get(page)).toEqual([])
})
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 40_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 40_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 40_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 40_000 })
}
async function current(page: Page) {
  return page.evaluate(async () => {
    const path = '/tests/helpers/native-workspace-browser.ts', { readNativeCurrent } = await import(path) as typeof import('./helpers/native-workspace-browser')
    const project = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project
    if (!project) throw new Error('Expected a saved visual project')
    return { schemaVersion: project.schemaVersion, ...await readNativeCurrent(project) }
  })
}
async function openSample(page: Page, name: string) {
  await page.goto('/#workspace'); await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(dialog).toBeVisible({ timeout: 45_000 }); await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
}

test('original visual blank entry preserves the current scene on cancel and saves an empty full resource closure', async ({ page }, info) => {
  test.setTimeout(120_000)
  await openSample(page, '潮声浅湾 · 连续海岸')
  const original = await current(page)
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  const create = page.getByRole('button', { name: '新建视觉空白 · 原创素材', exact: true })
  await create.click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await expect(dialog.getByLabel('原创素材组', { exact: true })).toHaveValue('original')
  await expect(dialog.getByLabel('原创素材组', { exact: true })).toContainText('通用视觉 · 24项')
  await expect(dialog.getByLabel('画布宽度', { exact: true })).toHaveValue('24000')
  await expect(dialog.getByLabel('画布高度', { exact: true })).toHaveValue('18000')
  await dialog.getByLabel('场景名称', { exact: true }).fill('取消不创建视觉空白')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await current(page)).contentHash).toBe(original.contentHash)
  await create.click()
  await dialog.getByLabel('场景名称', { exact: true }).fill('原创素材视觉空白')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 45_000 }); await settled(page)
  const created = await current(page)
  expect(created.sceneId).not.toBe(original.sceneId)
  expect(created.schemaVersion).toBe(2); expect(created.document.schemaVersion).toBe(2)
  expect(created.title).toBe('原创素材视觉空白'); expect(created.revision).toBe(0)
  expect(created.document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 24000, height: 18000 })
  expect(Object.keys(created.document.assets)).toHaveLength(24)
  expect(Object.keys(created.document.materials)).toHaveLength(7)
  expect(Object.keys(created.document.propDefinitions)).toHaveLength(17)
  for (const key of ['vertices', 'walls', 'openings', 'rooms', 'props', 'regions', 'notes', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups', 'entityLayers'] as const) expect(created.document[key]).toEqual({})
  const saved = await page.evaluate(async ({ originalId, createdId }) => {
    const runtimePath = '/src/platform/browser/runtime.ts', projectPath = '/src/application/workspace/project.ts', helperPath = '/tests/helpers/visual-authoring-browser.ts', visualPath = '/src/shared/visual/types.ts'
    const { projectRepository, validation } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { fromBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { inspectVisualResourceClosure } = await import(helperPath) as typeof import('./helpers/visual-authoring-browser')
    const { emptyVisualSystem } = await import(visualPath) as typeof import('../src/shared/visual/types')
    const loaded = await projectRepository.load(createdId), prior = await projectRepository.load(originalId)
    if (!loaded || !prior) throw new Error('New visual blank must preserve both saved projects')
    const cold = await fromBundle(loaded, validation)
    return { closure: await inspectVisualResourceClosure(cold), current: cold.document, prior: prior.project.document, empty: emptyVisualSystem(), projects: await projectRepository.list() }
  }, { originalId: original.sceneId, createdId: created.sceneId })
  expect(saved.current).toEqual(created.document); expect(saved.prior).toEqual(original.document)
  expect(created.document.visual).toEqual(saved.empty); expect(saved.projects).toHaveLength(2)
  expect(Object.keys(saved.closure.sources)).toHaveLength(24); expect(Object.keys(saved.closure.assets)).toHaveLength(24)
  for (const [hash, actual] of Object.entries(saved.closure.hashes)) expect(actual).toBe(hash)
  for (const source of Object.values(saved.closure.sources)) expect(saved.closure.assets[source.rasterSha256]).toBeDefined()
  expect(saved.closure.licenseBindings.length).toBeGreaterThanOrEqual(48)
  expect(saved.closure.licenseBindings.every(binding => binding.embedding === 'allowed')).toBe(true)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page)
  expect((await current(page)).contentHash).toBe(created.contentHash)
  await info.attach('visual-original-blank.json', { body: JSON.stringify({ originalId: original.sceneId, createdId: created.sceneId, contentHash: created.contentHash, closure: saved.closure }), contentType: 'application/json' })
})

for (const sample of [
  { kind: 'beach', name: '潮声浅湾 · 连续海岸', title: '潮声浅湾', ratio: [4096, 3072] },
  { kind: 'island', name: '苔冠岩岛 · 高差与草沿', title: '苔冠岩岛', ratio: [4096, 3072] },
  { kind: 'interior', name: '灯下旅舍 · 材质与灯光', title: '灯下旅舍', ratio: [4096, 3072] },
] as const) test(`visual ${sample.kind} UI copy saves, cold reopens and exports exact 4K pixels from an offline full package`, async ({ page, context, browserName }, info) => {
  test.setTimeout(180_000)
  await openSample(page, sample.name)
  const original = await current(page)
  expect(original.schemaVersion).toBe(2); expect(original.document.schemaVersion).toBe(2)
  expect(original.title).toBe(sample.title); expect(original.document.visual).toBeDefined()
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page)
  const reopened = await current(page)
  expect(reopened.contentHash).toBe(original.contentHash); expect(reopened.document.visual).toEqual(original.document.visual)
  const before = await page.evaluate(async () => {
    const path = '/tests/helpers/visual-authoring-browser.ts', helper = await import(path) as typeof import('./helpers/visual-authoring-browser')
    const project = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!
    const staged = await helper.stageVisualRoundTrip(project)
    Reflect.set(window, '__visualOfflineStage', staged)
    return { ...staged, bytes: staged.bytes.length }
  })
  let requestsAfterOffline = 0
  const countNetwork = (request: import('@playwright/test').Request) => { if (/^https?:/.test(request.url())) requestsAfterOffline++ }
  page.on('request', countNetwork)
  // WebKit's offline emulation rejects local Blob APIs too. Block every HTTP(S)
  // request there, retaining actual local bytes, decoding and IndexedDB checks.
  const denyNetwork = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
  if (browserName === 'webkit') await context.route(/^https?:/, denyNetwork)
  else await context.setOffline(true)
  let after: Awaited<ReturnType<typeof import('./helpers/visual-authoring-browser').finishVisualRoundTrip>>
  try {
    after = await page.evaluate(async () => {
      const path = '/tests/helpers/visual-authoring-browser.ts', helper = await import(path) as typeof import('./helpers/visual-authoring-browser')
      return helper.finishVisualRoundTrip(Reflect.get(window, '__visualOfflineStage'))
    })
  } finally {
    if (browserName === 'webkit') await context.unroute(/^https?:/, denyNetwork)
    else await context.setOffline(false)
    page.off('request', countNetwork)
  }
  expect(requestsAfterOffline).toBe(0)
  expect(after.contentHash).toBe(before.contentHash); expect(after.visual).toBe(before.visual)
  expect(after.hashes).toEqual(before.hashes); expect(after.sources).toBe(before.sources); expect(after.licenses).toBe(before.licenses)
  expect(after.authoringSources).toBe(before.authoringSources); expect(after.assets).toBe(before.assets)
  expect(after.authoringSources).toBeGreaterThanOrEqual(19); expect(after.assets).toBeGreaterThanOrEqual(19)
  expect(after.schemaVersion).toBe(2); expect(after.sceneSchemaVersion).toBe(2)
  for (const audience of ['gm', 'player'] as const) {
    expect([after[audience].width, after[audience].height]).toEqual(sample.ratio)
    expect(after[audience].rgbaHash).toBe(before[audience].rgbaHash)
    expect(after[audience].containsMetadata).toBe(false); expect([...new Set(after[audience].chunks)]).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
  }
  await info.attach('visual-offline-package.json', { body: JSON.stringify({ sample: sample.kind, source: before, offline: after, requestsAfterOffline,
    networkDenial: browserName === 'webkit' ? 'all HTTP(S) aborted; local Blob APIs enabled' : 'native browser offline emulation' }), contentType: 'application/json' })
})

test('player projection, PNG and public cropped PNG ignore private light, fog, filters, occluders and source metadata', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.goto('/#workspace')
  const pair = await page.evaluate(async () => { const path = '/tests/helpers/visual-authoring-browser.ts'; return (await import(path) as typeof import('./helpers/visual-authoring-browser')).verifyVisualPrivacy() })
  expect(pair.a.gm.rgbaHash).not.toBe(pair.b.gm.rgbaHash)
  expect(pair.a.player.rgbaHash).toBe(pair.b.player.rgbaHash); expect(pair.a.crop.rgbaHash).toBe(pair.b.crop.rgbaHash)
  expect(pair.a.projectedText).toBe(pair.b.projectedText)
  expect(pair.a.projectedText).not.toContain('SECRET-VISUAL'); expect(pair.a.projectedText).not.toContain(pair.a.privateProp)
  for (const image of [pair.a.player, pair.b.player, pair.a.crop, pair.b.crop]) { expect(image.containsMetadata).toBe(false); expect([...new Set(image.chunks)]).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND']) }
  await info.attach('visual-private-pair.json', { body: JSON.stringify(pair), contentType: 'application/json' })
})

test('manual curve drag stays a draft, previews both bound sides, adopts once and undoes once with out-of-scope work intact', async ({ page }, info) => {
  test.setTimeout(120_000)
  await openSample(page, '潮声浅湾 · 连续海岸')
  const before = await current(page)
  await page.getByRole('tab', { name: '视觉', exact: true }).click()
  const panel = page.getByRole('region', { name: '视觉场景创作', exact: true })
  await panel.getByLabel('视觉已有曲线', { exact: true }).selectOption('beach-coast')
  const handle = page.getByTestId('curve-handle-0-control1')
  await expect(handle).toBeVisible()
  const position = await handle.boundingBox(); if (!position) throw new Error('Curve handle has no real viewport bounds')
  const originalX = await handle.getAttribute('cx')
  await page.mouse.move(position.x + position.width / 2, position.y + position.height / 2)
  await page.mouse.down(); await page.mouse.move(position.x + position.width / 2 + 4, position.y + position.height / 2 + 3, { steps: 4 }); await page.mouse.up()
  await expect(handle).not.toHaveAttribute('cx', originalX!)
  expect((await current(page)).contentHash).toBe(before.contentHash)
  await panel.getByRole('button', { name: '预览曲线与边带', exact: true }).click()
  const candidate = page.locator('.asset-structure-preview')
  await expect(candidate).toContainText('候选预览', { timeout: 30_000 })
  const impact = await candidate.getByLabel('待采用视觉操作 ID', { exact: true }).inputValue()
  expect(impact).toContain('beach-coast'); expect(impact).toContain('beach-sand'); expect(impact).toContain('beach-water')
  expect((await current(page)).contentHash).toBe(before.contentHash)
  await expect(candidate.getByRole('button', { name: '采用视觉修改', exact: true })).toBeDisabled()
  await candidate.getByLabel('确认完整影响范围', { exact: true }).check(); await candidate.getByRole('button', { name: '采用视觉修改', exact: true }).click()
  await expect(candidate).toHaveCount(0); await settled(page)
  const adopted = await current(page)
  expect(adopted.revision).toBe(before.revision + 1)
  expect(adopted.document.visual!.boundaries['beach-coast']).not.toEqual(before.document.visual!.boundaries['beach-coast'])
  expect(adopted.document.terrainAreas['beach-sand'].boundaryMm).not.toEqual(before.document.terrainAreas['beach-sand'].boundaryMm)
  const unchanged = await page.evaluate(async ({ a, b }) => {
    const path = '/tests/helpers/visual-authoring-browser.ts', helper = await import(path) as typeof import('./helpers/visual-authoring-browser')
    return { before: helper.unchangedVisualScope(a), after: helper.unchangedVisualScope(b) }
  }, { a: before.document, b: adopted.document })
  expect(unchanged.after).toEqual(unchanged.before)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await current(page)
  expect(undone.revision).toBe(adopted.revision + 1)
  expect(undone.document.visual).toEqual(before.document.visual); expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
  await expect(page.getByRole('button', { name: '撤销素材编辑', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  const redone = await current(page); expect(redone.document.visual).toEqual(adopted.document.visual)
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const file = await download, path = await file.path(); expect(path).not.toBeNull()
  const bytes = await readFile(path!)
  expect(bytes.subarray(0, 2).toString()).toBe('PK')
  await info.attach('visual-manual-curve.json', { body: JSON.stringify({ before: before.document.visual, adopted: adopted.document.visual, revision: [before.revision, adopted.revision, undone.revision, redone.revision], impact, downloadBytes: bytes.length }), contentType: 'application/json' })
})

test('visual history restores an existing light with protection and once undo, keeps other edits and rejects a reopened witness', async ({ page }, info) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  await openSample(page, '灯下旅舍 · 材质与灯光')
  const original = await current(page), id = 'inn-light-common', name = '旅舍原有灯光'
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled(page)
  await page.getByRole('tab', { name: '视觉', exact: true }).click()
  const panel = page.getByRole('region', { name: '视觉场景创作', exact: true })
  await panel.getByRole('button', { name: '灯光', exact: true }).click()
  await panel.getByRole('combobox', { name: /^灯光/ }).selectOption(id)
  await panel.getByLabel('视觉灯光强度', { exact: true }).fill('0.35')
  await panel.getByRole('button', { name: '预览灯光', exact: true }).click()
  const candidate = page.locator('.asset-structure-preview')
  const impact = await candidate.getByLabel('待采用视觉操作 ID', { exact: true }).inputValue()
  expect(impact.split(/\s*[,，、\n]\s*/)).toContain(id)
  const remoteBedroomProps = Object.values(original.document.props).filter(prop => prop.roomId === 'inn-bedroom')
  expect(remoteBedroomProps.length).toBeGreaterThan(0)
  for (const prop of remoteBedroomProps) expect(impact).not.toContain(prop.id)
  await candidate.getByLabel('确认完整影响范围', { exact: true }).check()
  await candidate.getByRole('button', { name: '采用视觉修改', exact: true }).click(); await settled(page)
  await page.evaluate(async () => {
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace
    const prop = Object.values(workspace.getState().project!.document.props)[0]
    await workspace.updateProp(prop.id, { rotationDeg: 45 }); await workspace.flush()
  })
  await settled(page)
  const beforeRestore = await current(page)
  expect(beforeRestore.document.visual!.lights[id].intensity).toBe(.35)
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  const selectHistoricalLight = async () => {
    await page.getByRole('button', { name: `查看快照 ${name}`, exact: true }).click()
    await page.getByLabel('局部恢复模式', { exact: true }).selectOption('visual')
    await page.getByLabel('搜索历史物件', { exact: true }).fill(id)
    await page.getByRole('checkbox', { name: `恢复物件 ${id}`, exact: true }).check()
    await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  }
  await selectHistoricalLight()
  const changes = page.getByRole('region', { name: '局部恢复差异', exact: true })
  await expect(changes).toContainText('本会话视觉参数')
  await expect(changes.getByLabel('局部恢复完整实际范围', { exact: true })).toHaveValue(new RegExp(id))
  expect((await current(page)).contentHash).toBe(beforeRestore.contentHash)
  await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled(page)
  const restored = await current(page)
  expect(restored.revision).toBe(beforeRestore.revision + 1)
  expect(restored.document.visual!.lights[id]).toEqual(original.document.visual!.lights[id])
  const omitSelectedLight = (scene: typeof restored.document) => {
    const { revision: _revision, updatedAt: _updatedAt, visual, ...rest } = scene
    const { [id]: _light, ...lights } = visual!.lights
    return { ...rest, visual: { ...visual, lights } }
  }
  expect(omitSelectedLight(restored.document)).toEqual(omitSelectedLight(beforeRestore.document))
  const snapshots = await page.evaluate(async sceneId => {
    const path = '/src/platform/browser/runtime.ts'
    const { projectRepository } = await import(path) as typeof import('../src/platform/browser/runtime')
    return projectRepository.listSnapshots(sceneId)
  }, restored.document.sceneId)
  expect(snapshots.filter(snapshot => snapshot.kind === 'protection')).toHaveLength(1)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await current(page)
  expect(undone.revision).toBe(restored.revision + 1)
  expect(undone.document.visual).toEqual(beforeRestore.document.visual)
  expect(omitSelectedLight(undone.document)).toEqual(omitSelectedLight(beforeRestore.document))
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page)
  const reopened = await current(page)
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await selectHistoricalLight()
  await expect(page.getByRole('alert')).toContainText('本会话')
  await expect(changes).toHaveCount(0)
  expect((await current(page)).contentHash).toBe(reopened.contentHash)
  await info.attach('visual-history-protection.json', { body: JSON.stringify({ id, snapshots, revision: [original.revision, beforeRestore.revision, restored.revision, undone.revision], reopenRejected: true }), contentType: 'application/json' })
})
