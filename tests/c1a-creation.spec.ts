import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { PropDefinition, SceneDocumentV2 } from '../src/core/v2/types'

const entityCollections = ['vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups'] as const

type State = {
  document: SceneDocumentV2
  hashes: string[]
  licenseHashes: string[]
  status: string
  canUndo: boolean
  canRedo: boolean
}

async function state(page: Page): Promise<State> {
  return page.evaluate(() => {
    const current = Reflect.get(window, '__sceneweaveAssetsDev').workspace.getState()
    return { document: structuredClone(current.project.document), hashes: Object.keys(current.project.assets).sort(),
      licenseHashes: Object.keys(current.project.licenses).sort(), status: current.status, canUndo: current.canUndo, canRedo: current.canRedo }
  })
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveAssetsDev')
    const id = workspace.getState().project.document.sceneId
    const persisted = await repository.load(id)
    const counts: Record<string, number> = {}
    for (const table of ['scenes', 'snapshots', 'resourceBindings', 'assetBlobs', 'licenseTexts']) counts[table] = await repository.db.table(table).count()
    return { document: structuredClone(persisted.document), sceneIds: (await repository.list()).map((entry: { sceneId: string }) => entry.sceneId).sort(), counts }
  })
}

async function saved(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
}

async function revision(page: Page, value: number) {
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', String(value))
}

async function openCreation(page: Page) {
  await page.getByRole('button', { name: '新建空白场景', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function createBlank(page: Page, title = 'C1a 空白创作', preset = 'investigation') {
  const dialog = await openCreation(page)
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByLabel('画布宽度', { exact: true }).fill('14000')
  await dialog.getByLabel('画布高度', { exact: true }).fill('10000')
  await dialog.getByLabel('使用预设', { exact: true }).selectOption(preset)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await saved(page)
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  return state(page)
}

async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true })
  await input.fill(String(value)); await input.press('Tab')
}

async function beginPlacement(page: Page): Promise<PropDefinition> {
  const scene = (await state(page)).document
  const definition = scene.propDefinitions['b2-p-03'] ?? Object.values(scene.propDefinitions).find(item => item.catalogId === 'prop.sw.chair-oak')
  if (!definition) throw new Error('The complete blank project is missing its bundled small chair definition.')
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '放置', exact: true }).click()
  await page.getByRole('button', { name: `放置${definition.name}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: '放置物件', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '在此放置', exact: true })).toBeEnabled()
  return definition
}

async function numericPlacement(page: Page, x = 3500, y = 3000, rotation = 0) {
  const definition = await beginPlacement(page)
  const before = (await state(page)).document
  await number(page, '放置 X', x); await number(page, '放置 Y', y); await number(page, '放置旋转', rotation)
  await page.getByRole('button', { name: '在此放置', exact: true }).click()
  await revision(page, before.revision + 1)
  const after = (await state(page)).document
  const ids = Object.keys(after.props).filter(id => !before.props[id])
  expect(ids).toHaveLength(1)
  const prop = after.props[ids[0]]
  expect(prop.positionMm).toEqual({ x, y }); expect(prop.rotationDeg).toBe(rotation)
  expect(prop.definitionRef).toEqual({ id: definition.id, version: definition.version })
  await expect(page.getByRole('heading', { name: '放置物件', exact: true })).toHaveCount(0)
  return prop
}

async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: label, exact: true }).click()
  const item = await pending
  const location = await item.path()
  if (!location) throw new Error(`No actual ${label} download was produced.`)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  return { bytes: await readFile(location), name: item.suggestedFilename() }
}

async function evidence(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}

async function injectSnapshotFailure(page: Page) {
  await page.evaluate(() => {
    const table = Reflect.get(window, '__sceneweaveAssetsDev').repository.db.table('snapshots')
    const original = table.add
    table.add = async () => { throw new DOMException('C1a simulated snapshot write failure', 'QuotaExceededError') }
    Reflect.set(window, '__c1aSnapshotFailure', { restore: () => { table.add = original } })
  })
}

async function restoreSnapshotWrites(page: Page) {
  await page.evaluate(() => {
    Reflect.get(window, '__c1aSnapshotFailure')?.restore()
    Reflect.deleteProperty(window, '__c1aSnapshotFailure')
  })
}

test('C1a creates an actual empty project with chosen bounds and preset while cancel and invalid input preserve the open project', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/#assets')
  await page.locator('.asset-study-card').click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await saved(page)
  const original = await state(page), originalStored = await stored(page)

  let dialog = await openCreation(page)
  await expect(dialog.getByLabel('画布宽度', { exact: true })).toHaveValue('14000')
  await expect(dialog.getByLabel('画布高度', { exact: true })).toHaveValue('10000')
  await expect(dialog.getByLabel('使用预设', { exact: true })).toHaveValue('investigation')
  await dialog.getByLabel('场景名称', { exact: true }).fill('取消的空白工程')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(await state(page)).toEqual(original); expect(await stored(page)).toEqual(originalStored)

  dialog = await openCreation(page)
  await dialog.getByLabel('画布宽度', { exact: true }).fill('0')
  const create = dialog.getByRole('button', { name: '创建空白场景', exact: true })
  if (await create.isEnabled()) await create.click()
  await expect(dialog).toBeVisible()
  expect(await state(page)).toEqual(original); expect(await stored(page)).toEqual(originalStored)
  await dialog.getByLabel('场景名称', { exact: true }).fill('从空白开始 · 战术')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('12000')
  await dialog.getByLabel('画布高度', { exact: true }).fill('9000')
  await dialog.getByLabel('使用预设', { exact: true }).selectOption('tactical')
  await create.click(); await expect(dialog).toHaveCount(0); await saved(page)
  const blank = await state(page)
  expect(blank.document.title).toBe('从空白开始 · 战术')
  expect(blank.document.sceneId).not.toBe(original.document.sceneId)
  expect(blank.document.schemaVersion).toBe(2); expect(blank.document.revision).toBe(0)
  expect(blank.document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 12000, height: 9000 })
  expect(Object.values(blank.document.floors)).toHaveLength(1)
  expect(Object.values(blank.document.floors)[0].boundsMm).toEqual(blank.document.exportBoundsMm)
  expect(blank.document.presetSnapshot.presetId).toBe('tactical')
  expect(blank.document.presetSnapshot.distanceMode).toBe('grid')
  for (const key of entityCollections) expect(blank.document[key], key).toEqual({})
  expect(blank.document.constraints.entranceOpeningIds).toEqual([])
  expect(blank.hashes.length).toBeGreaterThan(0); expect(blank.licenseHashes.length).toBeGreaterThan(0)
  expect(blank.canUndo).toBe(false); expect(blank.canRedo).toBe(false)
  const oldPersisted = await page.evaluate(async id => (await Reflect.get(window, '__sceneweaveAssetsDev').repository.load(id)).document, original.document.sceneId)
  expect(oldPersisted).toEqual(original.document)
  await evidence(testInfo, 'c1a-blank-creation.json', { originalSceneRetained: true, cancelledAndInvalidPreserved: true, document: blank.document, resourceHashes: blank.hashes })
})

test('C1a pointer and numeric placement share atomic editing, deletion, undo and redo', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#assets'); await createBlank(page)
  const viewport = page.getByLabel('地图视口', { exact: true })
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  await expect.poll(async () => Number(await viewport.getAttribute('data-zoom'))).toBeGreaterThan(1)
  await viewport.focus(); await viewport.press('ArrowRight')
  await expect.poll(async () => Number(await viewport.getAttribute('data-pan-x'))).not.toBe(0)
  const definition = await beginPlacement(page), before = await state(page)
  const image = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  if (!image) throw new Error('No rendered blank map for actual pointer placement.')
  const x = Math.round(image.x + image.width / 2), y = Math.round(image.y + image.height / 2)
  const bounds = before.document.exportBoundsMm
  const expected = { x: Math.round(bounds.x + (x - image.x) / image.width * bounds.width), y: Math.round(bounds.y + (y - image.y) / image.height * bounds.height) }
  await page.mouse.click(x, y); await revision(page, 1)
  const placed = (await state(page)).document
  expect(Object.keys(placed.props)).toHaveLength(1)
  const first = Object.values(placed.props)[0]
  expect(first.positionMm).toEqual(expected)
  expect(Number.isSafeInteger(first.positionMm.x) && Number.isSafeInteger(first.positionMm.y)).toBe(true)
  expect(first.definitionRef).toEqual({ id: definition.id, version: definition.version })
  expect(first.supportRef).toEqual({ kind: 'floor', id: Object.keys(placed.floors)[0] })
  await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()

  await beginPlacement(page)
  // Re-selecting the same asset replaces the temporary candidate and must become ready again.
  await beginPlacement(page)
  await number(page, '放置 X', 0); await number(page, '放置 Y', 0)
  await page.getByRole('button', { name: '在此放置', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect((await state(page)).document).toEqual(placed)
  await page.getByRole('button', { name: '取消放置', exact: true }).click()
  await beginPlacement(page); await viewport.focus(); await viewport.press('Escape')
  await expect(page.getByRole('heading', { name: '放置物件', exact: true })).toHaveCount(0)
  expect((await state(page)).document).toEqual(placed)

  const second = await numericPlacement(page, 3000, 2500, 30)
  await number(page, '物件 X', 4200); await number(page, '物件 Y', 3200); await number(page, '物件旋转', 45)
  await revision(page, 5)
  const edited = (await state(page)).document
  expect(edited.props[second.id].positionMm).toEqual({ x: 4200, y: 3200 })
  expect(edited.props[second.id].rotationDeg).toBe(45)
  expect(edited.props[first.id]).toEqual(first)
  await page.getByRole('button', { name: '删除物件', exact: true }).click(); await revision(page, 6)
  expect((await state(page)).document.props[second.id]).toBeUndefined()
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await revision(page, 7)
  expect((await state(page)).document.props).toEqual(edited.props)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await revision(page, 8)
  expect((await state(page)).document.props[second.id]).toBeUndefined()
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await revision(page, 9); await saved(page)
  expect((await stored(page)).document.props).toEqual(edited.props)
  expect(errors).toEqual([])
  await evidence(testInfo, 'c1a-placement-history.json', { transformedPointerWorldMm: expected, invalidAndCancelledPlacementPreserved: true, placedIds: [first.id, second.id], finalRevision: 9, browserErrors: errors })
})

test('C1a complete package reopens in empty storage, continues editing and exports both fixed-range audiences', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/#assets'); await createBlank(page, 'C1a 可携带地图', 'narrative')
  const prop = await numericPlacement(page, 3500, 3000, 30); await saved(page)
  const original = await state(page)
  const complete = await download(page, '完整工程')
  await testInfo.attach('c1a-complete.sceneweave', { body: complete.bytes, contentType: 'application/zip' })
  await page.reload(); await saved(page)
  const reopened = await state(page)
  expect(reopened.document).toEqual(original.document); expect(reopened.hashes).toEqual(original.hashes)

  const freshContext = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const fresh = await freshContext.newPage(); await fresh.goto('/#assets')
    await expect(fresh.getByTestId('asset-workbench')).toBeVisible()
    await freshContext.setOffline(true)
    await fresh.getByLabel('选择完整素材工程', { exact: true }).setInputFiles({ name: 'c1a-roundtrip.sceneweave', mimeType: 'application/x-sceneweave', buffer: complete.bytes })
    await fresh.getByRole('button', { name: '保存并打开副本', exact: true }).click()
    await expect(fresh.getByRole('dialog')).toHaveCount(0); await saved(fresh)
    const imported = await state(fresh)
    expect(imported.document.sceneId).not.toBe(original.document.sceneId)
    expect(imported.document.revision).toBe(0)
    for (const key of [...entityCollections, 'floors', 'exportBoundsMm', 'propDefinitions', 'materials', 'assets', 'styleThemes', 'presetSnapshot'] as const) expect(imported.document[key], key).toEqual(original.document[key])
    expect(imported.hashes).toEqual(original.hashes); expect(imported.licenseHashes).toEqual(original.licenseHashes)
    await fresh.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
    await fresh.locator(`[data-entity-id="${prop.id}"]`).click()
    await number(fresh, '物件 X', 4000); await saved(fresh)
    expect((await state(fresh)).document.props[prop.id].positionMm.x).toBe(4000)
    const images: { audience: string; width: number; height: number; bytes: number }[] = []
    for (const audience of ['gm', 'player'] as const) {
      await fresh.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: audience === 'gm' ? '主持人' : '玩家', exact: true }).click()
      await expect(fresh.getByLabel(audience === 'gm' ? '材质场景主持人预览' : '材质场景玩家预览', { exact: true })).toBeVisible()
      const png = await download(fresh, '4K PNG')
      expect(png.name).toBe(`sceneweave-${audience}-map.png`)
      expect(png.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(png.bytes.readUInt32BE(16)).toBe(4096); expect(png.bytes.readUInt32BE(20)).toBe(2926)
      await testInfo.attach(`c1a-${audience}-4k.png`, { body: png.bytes, contentType: 'image/png' })
      images.push({ audience, width: 4096, height: 2926, bytes: png.bytes.length })
    }
    await evidence(testInfo, 'c1a-portability.json', { blankSceneCreatedThroughUi: true, importedWithoutAssetNetwork: true, independentScene: true, continuedEdit: true, resourceHashes: imported.hashes, images, browser: browser.version() })
  } finally { await freshContext.close() }
  expect((await state(page)).document).toEqual(original.document)
})

test('C1a new-project attempts preserve unsaved work and roll back failed initial persistence', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/#assets'); await createBlank(page, 'C1a 待保护工程')
  const prop = await numericPlacement(page); await saved(page)
  const beforeFailure = await stored(page)
  await injectSnapshotFailure(page)
  try {
    await number(page, '物件 X', 4100)
    await expect(page.locator('.asset-save')).toHaveText('保存失败')
    const unsaved = await state(page)
    expect(unsaved.document.props[prop.id].positionMm.x).toBe(4100)
    const dialog = await openCreation(page)
    await dialog.getByLabel('场景名称', { exact: true }).fill('不得丢失当前编辑')
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    await expect(dialog.getByRole('alert')).toContainText('C1a simulated snapshot write failure')
    expect(await state(page)).toEqual(unsaved)
    expect(await stored(page)).toEqual(beforeFailure)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  } finally { await restoreSnapshotWrites(page) }
  await page.getByRole('button', { name: '重试保存', exact: true }).click(); await saved(page)
  const recovered = await state(page), savedBranch = await stored(page)
  expect(recovered.document.props[prop.id].positionMm.x).toBe(4100)

  await injectSnapshotFailure(page)
  try {
    const dialog = await openCreation(page)
    await dialog.getByLabel('场景名称', { exact: true }).fill('不得留下半工程')
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('C1a simulated snapshot write failure')
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    expect(await state(page)).toEqual(recovered)
    expect(await stored(page)).toEqual(savedBranch)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  } finally { await restoreSnapshotWrites(page) }
  await createBlank(page, 'C1a 故障解除后可新建')
  const old = await page.evaluate(async id => (await Reflect.get(window, '__sceneweaveAssetsDev').repository.load(id)).document, recovered.document.sceneId)
  expect(old).toEqual(recovered.document)
  await evidence(testInfo, 'c1a-initial-save-failure.json', { injectedFailure: 'snapshot table write, simulated quota', unsavedMemoryPreserved: true, originalPersistedBranchPreserved: true, newSceneAndResourceBindingsRolledBack: true, retryRetainedX: 4100, laterCreationSucceeded: true })
})

test('C1a cancelling new-scene asset loading preserves the saved project and rejects a late response', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/#assets'); await createBlank(page, 'C1a 取消前的工程')
  const prop = await numericPlacement(page)
  await number(page, '物件 X', 4300); await saved(page)
  const original = await state(page), persisted = await stored(page)
  expect(original.document.props[prop.id].positionMm.x).toBe(4300)

  const assetUrl = /\/assets\/sceneweave-handdrawn\/[^?]+\.png(?:\?.*)?$/
  let releaseResponse!: () => void, finishHandler!: () => void
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
  const handlerFinished = new Promise<void>(resolve => { finishHandler = resolve })
  const held: { route?: import('@playwright/test').Route } = {}
  let upstreamReady = false, lateResponseAttempted = false, handlerCompleted = false
  let preparationError: string | null = null, lateResponseError: string | null = null
  const holdFirstAsset = async (route: import('@playwright/test').Route) => {
    held.route = route
    let response: import('@playwright/test').APIResponse | undefined
    try {
      // Obtain valid bytes but hold their delivery to the creation fetch until cancellation.
      response = await route.fetch({ timeout: 10_000 })
      if (!response.ok()) throw new Error(`Held asset returned HTTP ${response.status()}.`)
      upstreamReady = true
      await responseGate
      lateResponseAttempted = true
      try { await route.fulfill({ response }) }
      catch (error) { lateResponseError = error instanceof Error ? error.message : String(error) }
    } catch (error) { preparationError = error instanceof Error ? error.message : String(error) }
    finally {
      if (response) await response.dispose().catch(() => {})
      handlerCompleted = true; finishHandler()
    }
  }
  // Existing previews use stored blobs. Only the next factory's first built-in PNG is held.
  await page.route(assetUrl, holdFirstAsset, { times: 1 })
  try {
    const dialog = await openCreation(page)
    await dialog.getByLabel('场景名称', { exact: true }).fill('不得被迟到结果打开')
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
    await expect.poll(() => upstreamReady || preparationError, { timeout: 15_000 }).toBe(true)
    await expect(page.locator('.asset-busy')).toBeVisible()
    const cancel = dialog.getByRole('button', { name: '取消', exact: true })
    await expect(cancel).toBeEnabled(); await cancel.click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    expect(await state(page)).toEqual(original); expect(await stored(page)).toEqual(persisted)

    releaseResponse(); await handlerFinished
    expect(preparationError).toBeNull(); expect(lateResponseAttempted).toBe(true)
    await expect.poll(() => held.route?.request().failure()?.errorText ?? null).not.toBeNull()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await revision(page, original.document.revision); await saved(page)
    expect(await state(page)).toEqual(original); expect(await stored(page)).toEqual(persisted)
    await evidence(testInfo, 'c1a-creation-cancel.json', { cancelledDuringAssetFetch: true,
      sceneId: original.document.sceneId, revision: original.document.revision, memoryAndStoragePreserved: true,
      resourceCounts: persisted.counts, lateResponseAttempted, requestFailure: held.route?.request().failure(), lateResponseError })
  } finally {
    releaseResponse()
    if (held.route && !handlerCompleted) await held.route.abort().catch(() => {})
    await page.unroute(assetUrl, holdFirstAsset)
    if (held.route) await handlerFinished
  }
})

test('C1a placement decode failure discards the preview without changing the project and can be retried', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#assets'); await createBlank(page, 'C1a 预览解码保护')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  const original = await state(page), persisted = await stored(page)
  const definition = original.document.propDefinitions['b2-p-03']
  expect(definition).toBeDefined()
  let failedDecodeCalls = 0
  await page.evaluate(() => {
    const originalDecoder = window.createImageBitmap
    const failure = { calls: 0, restore: () => { window.createImageBitmap = originalDecoder } }
    Reflect.set(window, '__c1aPlacementDecoderFailure', failure)
    window.createImageBitmap = async () => {
      failure.calls += 1
      throw new Error('C1a placement decoder unavailable')
    }
  })
  try {
    // The successful-placement helper waits for readiness, so select directly for this failure path.
    await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '放置', exact: true }).click()
    await page.getByRole('button', { name: `放置${definition.name}`, exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '待放置素材预览失败' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '放置物件', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '在此放置', exact: true })).toHaveCount(0)
    failedDecodeCalls = await page.evaluate(() => Reflect.get(window, '__c1aPlacementDecoderFailure').calls)
    expect(failedDecodeCalls).toBeGreaterThan(0)
    await revision(page, original.document.revision); await saved(page)
    expect(await state(page)).toEqual(original)
    await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  } finally {
    await page.evaluate(() => {
      Reflect.get(window, '__c1aPlacementDecoderFailure')?.restore()
      Reflect.deleteProperty(window, '__c1aPlacementDecoderFailure')
    })
  }

  // Repository.load deliberately validates every image too; read the persisted
  // branch only after restoring the decoder used by that independent validation.
  expect(await stored(page)).toEqual(persisted)
  const prop = await numericPlacement(page, 3500, 3000, 45); await saved(page)
  const recovered = await state(page)
  expect(recovered.document.revision).toBe(original.document.revision + 1)
  expect(Object.keys(recovered.document.props)).toEqual([prop.id])
  expect((await stored(page)).document).toEqual(recovered.document)
  expect(errors).toEqual([])
  await evidence(testInfo, 'c1a-placement-decode-failure.json', { injectedFailure: 'C1a placement decoder unavailable',
    failedDecodeCalls, previewDiscarded: true, failedAttemptPreservedMemoryAndStorage: true,
    laterPlacementId: prop.id, laterRevision: recovered.document.revision, browserErrors: errors })
})
