import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { CompleteProjectV6 } from '../src/io/v6/types'
import type { SceneRepositoryV6 } from '../src/io/v6/storage'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'
import type { SceneDocumentV3 } from '../src/core/v3/types'

type Dev = { workspace: WorkspaceV6; repository: SceneRepositoryV6 }
async function state(page: Page): Promise<CompleteProjectV6> {
  return page.evaluate(() => structuredClone((Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!))
}
async function settled(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
}
async function number(page: Page, name: string, value: number) {
  const input = page.getByRole('spinbutton', { name, exact: true }); await input.fill(String(value)); await input.press('Tab')
}
async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function adopt(page: Page, kind: '室外' | '结构' | '组件') {
  const button = page.getByRole('button', { name: `采用${kind}修改`, exact: true })
  if (kind !== '组件') { await expect(button).toBeDisabled(); await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check() }
  await button.click(); await expect(button).toHaveCount(0); await settled(page)
}
async function sample(page: Page) {
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.getByRole('button', { name: /海岸哨所 · 混合场景/ }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开室外工程', exact: true })
  await expect(dialog).toBeVisible({ timeout: 30_000 }); await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
}
async function selectProp(page: Page, id: string) {
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill(id)
  await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}
async function selectGroup(page: Page, id: string) {
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '组合', exact: true }).click()
  await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}
async function selectOutdoor(page: Page, id: string) {
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  await page.getByRole('region', { name: '室外制作工具', exact: true }).getByRole('button', { name: id, exact: true }).click()
}
async function snapshot(page: Page, name: string) {
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled(page)
}
function atWall(scene: SceneDocumentV3, x: number, y: number) {
  const matches = Object.values(scene.walls).filter(wall => {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    return (x - a.xMm) * (b.yMm - a.yMm) === (y - a.yMm) * (b.xMm - a.xMm)
      && x >= Math.min(a.xMm, b.xMm) && x <= Math.max(a.xMm, b.xMm) && y >= Math.min(a.yMm, b.yMm) && y <= Math.max(a.yMm, b.yMm)
  })
  expect(matches).toHaveLength(1); return matches[0]
}
async function selectWall(page: Page, id: string) {
  const scene = (await state(page)).document, wall = scene.walls[id]
  const owner = Object.values(scene.rooms).find(room => room.boundaryVertexIds.some((key, i, ids) => [key, ids[(i + 1) % ids.length]].includes(wall.startVertexId) && [key, ids[(i + 1) % ids.length]].includes(wall.endVertexId)))!
  const details = page.locator(`.building-entity-list [data-building-room-id="${owner.id}"]`)
  if (await details.getAttribute('open') === null) { const summary = details.locator(':scope > summary'); await summary.focus(); await summary.press('Enter') }
  await details.locator(`[data-building-wall-id="${id}"]`).click()
}
const points = (values: readonly (readonly [number, number])[]) => values.map(([x, y]) => `${x}, ${y}`).join('\n')
const lowPoints = points([[2000, 4000], [17000, 2000], [23000, 5000], [23000, 20000], [17000, 24000], [3000, 23000]])
const highPoints = points([[23000, 5000], [32000, 7000], [33000, 18000], [23000, 20000]])

test('M1-D blank UI authors the coastal outpost mixed structural baseline with real supports, one shared wall and guarded cancellation', async ({ page }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('M1-D 从空白制作海岸哨所')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('36000'); await dialog.getByLabel('画布高度', { exact: true }).fill('28000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled(page)
  const blank = await state(page), floorId = Object.keys(blank.document.floors)[0]
  expect(Object.keys(blank.document.rooms)).toHaveLength(0); expect(Object.keys(blank.document.terrainAreas)).toHaveLength(0)
  const materialId = (catalogId: string) => Object.values(blank.document.materials).find(material => material.catalogId === catalogId)!.id
  const wood = materialId('material.sw.wood-dark'), stone = materialId('material.sw.stone-paver'), dirt = materialId('material.sw.dirt-gravel')
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  const tools = page.getByRole('region', { name: '室外制作工具', exact: true })
  async function terrain(coordinates: string, elevation: number, priority: number, material: string, blocked = false) {
    const before = await state(page)
    await tools.getByLabel('室外制作工具', { exact: true }).selectOption('terrain')
    await tools.getByLabel('室外坐标', { exact: true }).fill(coordinates)
    await number(page, '地形高程毫米', elevation); await number(page, '地形覆盖优先级', priority)
    await tools.getByLabel('地形材质', { exact: true }).selectOption(material)
    await tools.getByLabel('区域阻挡移动', { exact: true }).setChecked(blocked)
    await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
    return Object.keys((await state(page)).document.terrainAreas).find(id => !before.document.terrainAreas[id])!
  }
  const waterMaterial = Object.values(blank.document.materials).find(material => material.catalogId.includes('water'))!.id
  const grass = Object.values(blank.document.materials).find(material => material.catalogId.includes('grass'))!.id
  const rock = Object.values(blank.document.materials).find(material => material.catalogId.includes('rock') && material.applicableSurfaces.includes('terrain'))!.id
  const water = await terrain(points([[0, 0], [36000, 0], [36000, 28000], [0, 28000]]), 0, 0, waterMaterial, true)
  const low = await terrain(lowPoints, 1000, 10, grass), high = await terrain(highPoints, 3000, 10, rock)
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  const building = page.getByRole('region', { name: '建筑工具', exact: true })
  async function room(name: string, x: number, width: number, material: string) {
    await building.getByLabel('房间名称', { exact: true }).fill(name)
    await building.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
    for (const [name, value] of [['房间起点 X', x], ['房间起点 Y', 7000], ['房间宽度', width], ['房间高度', 6000], ['新房间墙厚', 200]] as const) await number(page, name, value)
    await building.getByLabel('房间支撑表面', { exact: true }).selectOption(`terrainArea:${low}`)
    await building.getByLabel('新房间地板材质', { exact: true }).selectOption(material)
    await building.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page, '结构')
    return Object.values((await state(page)).document.rooms).find(room => room.purpose === name)!.id
  }
  const roomId = await room('手工值守室', 6000, 6000, wood), storeId = await room('手工储物间', 12000, 4000, stone)
  let current = (await state(page)).document
  expect(Object.keys(current.walls)).toHaveLength(7)
  const sharedWall = atWall(current, 12000, 10000), exteriorWall = atWall(current, 9000, 13000)
  for (const [wall, center, width] of [[exteriorWall, { x: 9000, y: 13000 }, 1200], [sharedWall, { x: 12000, y: 10000 }, 1000]] as const) {
    await selectWall(page, wall.id)
    const reference = current.vertices[wall.startVertexId]
    await page.getByLabel('开口基准端点', { exact: true }).selectOption(wall.startVertexId)
    await number(page, '开口近端偏移', Math.round(Math.hypot(center.x - reference.xMm, center.y - reference.yMm) - width / 2))
    await number(page, '开口净宽', width); await page.getByLabel('门窗状态', { exact: true }).selectOption('open')
    await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page, '结构')
    current = (await state(page)).document
  }
  expect(Object.values(current.openings).map(opening => opening.widthMm).sort()).toEqual([1000, 1200])
  const entrance = Object.values(current.openings).find(opening => opening.wallId === exteriorWall.id)!
  await selectWall(page, exteriorWall.id)
  await page.locator(`[data-building-opening-id="${entrance.id}"]`).click()
  await page.getByLabel('设为外部入口', { exact: true }).check(); await page.getByRole('button', { name: '预览入口修改', exact: true }).click(); await adopt(page, '结构')
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('path')
  await tools.getByLabel('室外坐标', { exact: true }).fill(points([[9000, 14000], [9000, 16000], [21000, 16000], [21500, 13000]]))
  await tools.getByLabel('道路支撑表面', { exact: true }).selectOption(`terrainArea:${low}`)
  await tools.getByLabel('道路材质', { exact: true }).selectOption(dirt)
  await number(page, '室外通路宽度毫米', 2000)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  const path = Object.keys((await state(page)).document.paths)[0]
  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('connection')
  await tools.getByLabel('室外坐标', { exact: true }).fill('21500, 13000\n24500, 13000')
  await tools.getByLabel('连接起点表面', { exact: true }).selectOption(`terrainArea:${low}`)
  await tools.getByLabel('连接终点表面', { exact: true }).selectOption(`terrainArea:${high}`)
  const canceledBefore = await state(page)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click(); expect(await state(page)).toEqual(canceledBefore)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  const beforeInvalid = await state(page), connectionId = Object.keys(beforeInvalid.document.terrainConnections)[0]
  await selectOutdoor(page, connectionId)
  await page.getByLabel('对象连接端点', { exact: true }).fill('21500, 13000\n35000, 13000')
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /连接|表面|支撑/ })).toBeVisible()
  expect(await state(page)).toEqual(beforeInvalid); await expect(page.getByRole('button', { name: '采用室外修改', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭工坊提示', exact: true }).click()
  await expect(page.getByRole('button', { name: '撤销素材编辑', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '取消室外属性草稿', exact: true }).click()
  expect(await state(page)).toEqual(beforeInvalid)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await state(page); expect(undone.document.terrainConnections[connectionId]).toBeUndefined(); expect(undone.document.revision).toBe(beforeInvalid.document.revision + 1)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  const final = await state(page)
  expect(final.document.rooms[roomId].supportRef).toEqual({ kind: 'terrainArea', id: low }); expect(final.document.rooms[storeId].groundElevationMm).toBe(1000)
  expect(final.document.paths[path].supportRefs).toEqual([{ kind: 'terrainArea', id: low }]); expect(final.document.constraints.entranceOpeningIds).toEqual([entrance.id])
  await page.reload(); await expect(page.getByTestId('outdoor-workbench')).toBeVisible(); await settled(page); expect(await state(page)).toEqual(final)
  expect(errors).toEqual([])
  await evidence(info, 'm1d-blank-mixed-structure.json', { method: 'Actual Chromium UI from empty 36×28m v6. Explicit terrain support for both rooms, unique shared wall and open doors, explicit path/height connection. Every structural/outdoor change used preview and impact confirmation; canceled candidate and illegal detached endpoint left the full project unchanged. Undo/redo revisions and native reopen checked.',
    limits: 'This manual route verifies the structural subset. The independent editable sample carries yard, props, prefabs, scatter and artwork; this is not complete manual SCN-04 authoring, general pathfinding, art signoff or performance acceptance.',
    ids: { floorId, water, low, high, roomId, storeId, path, connectionId, entrance: entrance.id }, canceledUnchanged: true, invalidUnchanged: true, undoRevision: undone.document.revision, final })
})

test('M1-D fixed SCN-04 mask hides crate, note and shadow variants in actual 4K player pixels and PNG metadata', async ({ page }, info) => {
  test.setTimeout(240_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const samplePath = '/src/editor/v6/outpost-project.ts', renderPath = '/src/render/v3/renderer.ts', projectionPath = '/src/render/v3/projection.ts'
    const ioPath = '/src/io/v6/project-file.ts', auditPath = '/tests/helpers/m1d-outpost-browser.ts'
    const { createOutpostPrivacyProject, OUTPOST_IDS } = await import(samplePath) as typeof import('../src/editor/v6/outpost-project')
    const { exportPngV3 } = await import(renderPath) as typeof import('../src/render/v3/renderer')
    const { projectSceneV3 } = await import(projectionPath) as typeof import('../src/render/v3/projection')
    const { toCompleteProjectV3 } = await import(ioPath) as typeof import('../src/io/v6/project-file')
    const { describeM1DPng, m1dHash } = await import(auditPath) as typeof import('./helpers/m1d-outpost-browser')
    const a = await createOutpostPrivacyProject('a'), b = await createOutpostPrivacyProject('b'), reference = await createOutpostPrivacyProject('reference')
    const observations = []
    for (const [name, project, audience] of [['a-gm', a, 'gm'], ['b-gm', b, 'gm'], ['a-player', a, 'player'], ['b-player', b, 'player'], ['reference-player', reference, 'player']] as const) {
      const before = JSON.stringify(project), native = window.createImageBitmap.bind(window), actualDecodeHashes: string[] = []
      let closed = 0, blob!: Blob
      window.createImageBitmap = (async (input: ImageBitmapSource, options?: ImageBitmapOptions) => {
        if (!(input instanceof Blob)) throw new Error('SCN-04 renderer must decode the complete project Blob')
        actualDecodeHashes.push(await m1dHash(await input.arrayBuffer()))
        const bitmap = await native(input, options), close = bitmap.close.bind(bitmap)
        bitmap.close = () => { closed++; close() }; return bitmap
      }) as typeof createImageBitmap
      try { blob = await exportPngV3(toCompleteProjectV3(project), { audience, longEdgePx: 4096 }) }
      finally { window.createImageBitmap = native }
      const projection = projectSceneV3(project.document, audience), png = await describeM1DPng(blob)
      observations.push({ name, audience, ...png, actualDecodeHashes: actualDecodeHashes.sort(), closed,
        expectedDecodeHashes: [...new Set(projection.assetIds.map(id => project.document.assets[id].sha256))].sort(),
        propIds: projection.props.map(prop => prop.id), noteIds: projection.notes.map(note => note.id), assetIds: projection.assetIds, limitations: projection.limitations,
        sourceUnchanged: before === JSON.stringify(project) })
    }
    return { ids: OUTPOST_IDS, maskA: a.document.regions[OUTPOST_IDS.privacyMask], maskB: b.document.regions[OUTPOST_IDS.privacyMask],
      privateA: { crate: a.document.props[OUTPOST_IDS.privacyCrate], note: a.document.notes[OUTPOST_IDS.privacyNote] },
      privateB: { crate: b.document.props[OUTPOST_IDS.privacyCrate], note: b.document.notes[OUTPOST_IDS.privacyNote] },
      independentReference: { noCrate: !reference.document.props[OUTPOST_IDS.privacyCrate], noNote: !reference.document.notes[OUTPOST_IDS.privacyNote] }, observations }
  })
  expect(report.maskA).toEqual(report.maskB)
  expect(report.maskA.boundaryMm).toEqual([{ x: 12500, y: 7500 }, { x: 15500, y: 7500 }, { x: 15500, y: 11500 }, { x: 12500, y: 11500 }])
  expect(report.privateA.crate).not.toEqual(report.privateB.crate); expect(report.privateA.note.text).not.toBe(report.privateB.note.text)
  expect(report.privateA.crate.shadowOverride).not.toEqual(report.privateB.crate.shadowOverride)
  expect(report.independentReference).toEqual({ noCrate: true, noNote: true })
  const item = (name: string) => report.observations.find(observation => observation.name === name)!
  expect(item('a-gm').rgbaHash).not.toBe(item('b-gm').rgbaHash)
  expect(item('a-player').rgbaHash).toBe(item('b-player').rgbaHash)
  expect(item('a-player').rgbaHash).toBe(item('reference-player').rgbaHash)
  expect(item('a-gm').rgbaHash).not.toBe(item('a-player').rgbaHash)
  for (const observation of report.observations) {
    expect([observation.width, observation.height]).toEqual([4096, 3186]); expect(observation.metadata).toEqual([])
    expect(observation.chunks.at(-1)).toBe('IEND'); expect(observation.sourceUnchanged).toBe(true); expect(observation.limitations).toEqual([])
    expect(observation.actualDecodeHashes).toEqual(observation.expectedDecodeHashes); expect(observation.closed).toBe(observation.actualDecodeHashes.length)
    expect(observation.noteIds).toEqual(expect.arrayContaining([report.ids.publicLabel, report.ids.publicDescription]))
    if (observation.audience === 'player') {
      expect(observation.propIds).not.toContain(report.ids.privacyCrate); expect(observation.noteIds).not.toContain(report.ids.privacyNote); expect(observation.noteIds).not.toContain(report.ids.secretNote)
      expect(observation.maskCenterPixel).toEqual(item('reference-player').maskCenterPixel)
    }
    if (observation.name !== 'reference-player') await info.attach(`m1d-${observation.name}-4k.png`, { body: Buffer.from(observation.url.split(',')[1], 'base64'), contentType: 'image/png' })
  }
  await evidence(info, 'm1d-fixed-mask-4k-privacy.json', { method: 'Five serial actual Chromium native-v3 4096×3186 PNG exports from strict complete-v6 views, decoded sRGB RGBA and actual byte SHA-256. Exact fixed SCN-04 mask; a/b vary only private crate transform/color/shadow and private text/metadata. Independently constructed reference contains neither varying crate nor note. Native bitmap decode closure and final PNG metadata are checked. No art or performance acceptance.',
    ...report, observations: report.observations.map(({ url: _url, ...value }) => value) })
})

test('M1-D editable outpost UI retains scatter records and dimensions across layer, material, display, wall and scoped recovery edits', async ({ page }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await sample(page)
  const ids = await page.evaluate(async () => { const path = '/src/editor/v6/outpost-project.ts'; return (await import(path) as typeof import('../src/editor/v6/outpost-project')).OUTPOST_IDS })
  const baseline = await state(page)
  expect(Object.keys(baseline.document.userLayers)).toHaveLength(6)
  expect(baseline.document.notes[ids.secretNote]).toMatchObject({ text: '灯架下藏有返航账目', visibility: 'gm' })
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByText('文字与线索', { exact: true }).click()
  const publishedText = '海湾潮声淹没了旧灯架的回响'
  await page.getByLabel('新注记内容', { exact: true }).fill(publishedText)
  await page.getByLabel('新注记可见性', { exact: true }).selectOption('gm')
  await number(page, '新注记 X', 26500); await number(page, '新注记 Y', 15600)
  await page.getByRole('button', { name: '预览新增注记', exact: true }).click(); await adopt(page, '结构')
  const privateDescription = Object.values((await state(page)).document.notes).find(note => note.text === publishedText)!
  await page.getByRole('region', { name: '建筑工具', exact: true }).getByRole('button', { name: `注记 · ${publishedText.slice(0, 18)}`, exact: true }).click()
  await page.getByLabel('注记可见性', { exact: true }).selectOption('public')
  await page.getByRole('button', { name: '预览注记修改', exact: true }).click(); await adopt(page, '结构')
  const published = await state(page)
  expect(published.document.notes[privateDescription.id]).toMatchObject({ text: publishedText, visibility: 'public' })
  expect(published.document.notes[ids.secretNote]).toEqual(baseline.document.notes[ids.secretNote])
  await page.getByRole('region', { name: '建筑工具', exact: true }).getByRole('button', { name: baseline.document.rooms[ids.room].purpose, exact: true }).click()
  await page.getByLabel('编辑房间地面材质', { exact: true }).selectOption(ids.materials.woodWorn)
  await page.getByRole('button', { name: '预览房间地面材质', exact: true }).click(); await adopt(page, '结构')
  const painted = await state(page)
  expect(painted.document.rooms[ids.room].floorStyle!.base.materialRef.id).toBe(ids.materials.woodWorn)
  for (const key of ['vertices', 'walls', 'openings', 'terrainAreas', 'terrainConnections', 'paths', 'props'] as const) expect(painted.document[key]).toEqual(baseline.document[key])
  expect(painted.document.rooms[ids.room].supportRef).toEqual(baseline.document.rooms[ids.room].supportRef)

  await selectGroup(page, ids.suppliesGroup)
  const supplyBefore = painted.document.prefabInstances[ids.suppliesGroup]
  await number(page, '组合 X', supplyBefore.anchorMm.x + 200); await settled(page)
  const moved = await state(page)
  expect(moved.document.prefabInstances[ids.suppliesGroup].anchorMm.x).toBe(supplyBefore.anchorMm.x + 200)
  for (const member of Object.values(supplyBefore.members)) if (member.propId) {
    const original = painted.document.props[member.propId], changed = moved.document.props[member.propId]
    expect(changed.positionMm).toEqual({ ...original.positionMm, x: original.positionMm.x + 200 })
    expect(changed.supportRef).toEqual(original.supportRef); expect(changed.visibility).toBe(original.visibility)
  }
  const treeStart = await state(page), treeStartGroup = treeStart.document.scatterGroups[ids.scatterTrees]
  const manualStart = Object.entries(treeStartGroup.members).find(([, member]) => member.state === 'manual' && member.propId)!
  const toLock = Object.entries(treeStartGroup.members).find(([, member]) => member.propId && member.propId !== manualStart[1].propId)!
  expect(manualStart).toBeTruthy(); expect(toLock).toBeTruthy()
  await selectProp(page, manualStart[1].propId!)
  await number(page, '物件 X', treeStart.document.props[manualStart[1].propId!].positionMm.x - 100); await adopt(page, '室外')
  await selectProp(page, toLock[1].propId!)
  await page.getByRole('button', { name: '固定此物件', exact: true }).click(); await settled(page)
  await selectOutdoor(page, ids.scatterTrees)
  const scatterBefore = await state(page), groupBefore = scatterBefore.document.scatterGroups[ids.scatterTrees]
  const manual = Object.entries(groupBefore.members).find(([key]) => key === manualStart[0])!
  const locked = Object.entries(groupBefore.members).find(([key]) => key === toLock[0])!
  expect(scatterBefore.document.props[locked[1].propId!].editLocked).toBe(true)
  await page.getByLabel('对象散布密度', { exact: true }).fill('0.5')
  await page.getByRole('button', { name: '预览重新散布', exact: true }).click(); await adopt(page, '室外')
  const regenerated = await state(page), treeGroup = regenerated.document.scatterGroups[ids.scatterTrees]
  expect(treeGroup.densityFactor).toBe(.5)
  expect(regenerated.document.props[manual[1].propId!]).toEqual(scatterBefore.document.props[manual[1].propId!])
  expect(regenerated.document.props[locked[1].propId!]).toEqual(scatterBefore.document.props[locked[1].propId!])
  expect(treeGroup.members[manual[0]]).toEqual(manual[1]); expect(treeGroup.members[locked[0]]).toEqual(locked[1]); expect(treeGroup.exclusions).toEqual(groupBefore.exclusions)
  expect(regenerated.document.scatterGroups[ids.scatterShrubs]).toEqual(scatterBefore.document.scatterGroups[ids.scatterShrubs])
  await selectProp(page, locked[1].propId!)
  await page.getByRole('button', { name: '解除物件固定', exact: true }).click(); await settled(page)
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  const vegetationName = regenerated.document.userLayers[ids.layers.vegetation].name
  await page.getByRole('button', { name: `锁定图层 ${vegetationName}`, exact: true }).click(); await settled(page)
  await selectProp(page, manual[1].propId!)
  await expect(page.getByRole('spinbutton', { name: '物件 X', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: `解锁图层 ${vegetationName}`, exact: true }).click(); await settled(page)
  await snapshot(page, '海岸哨所 · 编辑基线')
  const restoreBaseline = await state(page)
  // The lamp carries the GM clue as an entity anchor and is intentionally
  // ineligible for an appearance-only restore. Use the independent campfire
  // so this UI path exercises a valid scoped restore while the clue remains
  // private and stable.
  const restoreAppearanceId = ids.campfire
  await selectProp(page, restoreAppearanceId)
  const appearance = page.getByRole('region', { name: '非破坏性外观', exact: true })
  await appearance.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await appearance.getByLabel('外观亮度', { exact: true }).fill('0.7')
  await appearance.getByRole('button', { name: '预览外观调整', exact: true }).click(); await adopt(page, '组件')
  const adjusted = await state(page)
  expect(adjusted.appearance.instanceAdjustments[restoreAppearanceId]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'brightness', value: .7, enabled: true })]))
  for (const key of ['positionMm', 'footprintMm', 'visualBoundsMm', 'supportRef', 'visibility', 'blocksMovement', 'blocksSight'] as const) expect(adjusted.document.props[restoreAppearanceId][key]).toEqual(restoreBaseline.document.props[restoreAppearanceId][key])
  await selectOutdoor(page, ids.path)
  await page.getByLabel('对象通路净宽', { exact: true }).fill('2200')
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await adopt(page, '室外')
  const later = await state(page)
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '查看快照 海岸哨所 · 编辑基线', exact: true }).click()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('appearance')
  await page.getByLabel('搜索历史物件', { exact: true }).fill(restoreAppearanceId)
  await page.getByRole('checkbox', { name: `恢复物件 ${restoreAppearanceId}`, exact: true }).check()
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  await expect(page.getByRole('button', { name: '保护当前并采用', exact: true })).toBeDisabled()
  expect(await state(page)).toEqual(later)
  await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled(page)
  const restored = await state(page)
  expect(restored.document.revision).toBe(later.document.revision + 1)
  expect(restored.document.props[restoreAppearanceId].appearance).toEqual(restoreBaseline.document.props[restoreAppearanceId].appearance)
  expect(restored.document.paths[ids.path]).toEqual(later.document.paths[ids.path])
  expect(restored.document.scatterGroups).toEqual(later.document.scatterGroups)
  expect(restored.document.prefabInstances[ids.suppliesGroup]).toEqual(later.document.prefabInstances[ids.suppliesGroup])
  expect(restored.document.rooms[ids.room].floorStyle).toEqual(later.document.rooms[ids.room].floorStyle)

  // Display settings are previewed from the unselected project information panel.
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByText('单位与格线', { exact: true }).click()
  await page.getByLabel('场景显示预设', { exact: true }).selectOption('tactical')
  await page.getByRole('button', { name: '预览显示设置', exact: true }).click()
  await page.getByRole('button', { name: '取消显示预览', exact: true }).click(); expect(await state(page)).toEqual(restored)
  await page.getByRole('button', { name: '预览显示设置', exact: true }).click(); await page.getByRole('button', { name: '采用显示设置', exact: true }).click(); await settled(page)
  const tactical = await state(page)
  expect(tactical.document.units).toMatchObject({ world: 'mm', display: 'ft', gridVisible: true, gridSizeMm: 1524, snapMm: 254 })
  expect(tactical.document.presetSnapshot).toMatchObject({ presetId: restored.document.presetSnapshot.presetId, presetVersion: 1, source: restored.document.presetSnapshot.source, distanceMode: 'grid' })
  for (const key of ['vertices', 'walls', 'openings', 'rooms', 'props', 'terrainAreas', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups', 'entityLayers', 'userLayers', 'exportBoundsMm'] as const) expect(tactical.document[key]).toEqual(restored.document[key])
  await page.getByText('单位与格线', { exact: true }).click()
  await page.getByLabel('场景显示预设', { exact: true }).selectOption('investigation')
  await page.getByRole('button', { name: '预览显示设置', exact: true }).click(); await page.getByRole('button', { name: '采用显示设置', exact: true }).click(); await settled(page)
  const metric = await state(page)
  expect(metric.document.units.display).toBe('m'); expect(metric.document.presetSnapshot.presetId).toBe(baseline.document.presetSnapshot.presetId)
  await selectWall(page, ids.southWall)
  await page.getByText('平移整面墙', { exact: true }).click()
  await number(page, '墙平移 Y', 300)
  const beforeWall = await state(page), originalWall = beforeWall.document.walls[ids.southWall]
  await page.getByRole('button', { name: '预览整墙平移', exact: true }).click()
  const scope = (await page.getByLabel('待采用建筑操作 ID', { exact: true }).inputValue()).split('\n')
  for (const id of [ids.southWall, originalWall.startVertexId, originalWall.endVertexId, ids.entrance, ids.room, ids.store, ids.sharedWall]) expect(scope).toContain(id)
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click(); expect(await state(page)).toEqual(beforeWall)
  await page.getByRole('button', { name: '预览整墙平移', exact: true }).click(); await adopt(page, '结构')
  const shiftedWall = await state(page)
  expect(shiftedWall.document.openings[ids.entrance]).toEqual(beforeWall.document.openings[ids.entrance])
  for (const vertexId of [originalWall.startVertexId, originalWall.endVertexId]) expect(shiftedWall.document.vertices[vertexId]).toEqual({ ...beforeWall.document.vertices[vertexId], yMm: beforeWall.document.vertices[vertexId].yMm + 300 })
  expect(shiftedWall.document.props).toEqual(beforeWall.document.props)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const wallUndone = await state(page)
  expect(wallUndone.document.vertices).toEqual(beforeWall.document.vertices); expect(wallUndone.document.openings).toEqual(beforeWall.document.openings)
  expect(wallUndone.document.revision).toBe(shiftedWall.document.revision + 1)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  const final = await state(page)
  expect(final.document.vertices).toEqual(shiftedWall.document.vertices); expect(final.document.revision).toBe(wallUndone.document.revision + 1)
  await page.reload(); await expect(page.getByTestId('outdoor-workbench')).toBeVisible(); await settled(page); expect(await state(page)).toEqual(final)
  const protection = await page.evaluate(async () => { const dev = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev; return (await dev.repository.listNamedSnapshots(dev.workspace.getState().project!.document.sceneId)).filter(snapshot => snapshot.kind === 'protection') })
  expect(protection).toHaveLength(1); expect(errors).toEqual([])
  await evidence(info, 'm1d-editable-ui-material-scatter-display-restore.json', { method: 'Actual Chromium workbench controls select the editable sample, change room material, move the supply prefab, regenerate saved scatter density, exercise layer locks, apply independent campfire appearance and then protect/restore only its appearance while a later road edit survives. Tactical and metric display presets use cancel/adopt and preserve every physical field, original preset identity and source. Native reload keeps the complete branch.',
    limits: 'Finite manual exercise of the initial coastal sample; original source art stays P2 pending user art review. No complete performance, whole-map path search or small-group acceptance.',
    ids, restoreAppearanceId, publishedDescription: { id: privateDescription.id, text: publishedText, gmClueUnchanged: true }, manual: { key: manual[0], propId: manual[1].propId }, locked: { key: locked[0], propId: locked[1].propId }, scatterExclusions: treeGroup.exclusions, protection,
    wall: { scope, canceledUnchanged: true, shiftMm: { x: 0, y: 300 }, entranceRetainsStableAttachment: true, revisions: [beforeWall.document.revision, shiftedWall.document.revision, wallUndone.document.revision, final.document.revision] },
    revisions: [baseline.document.revision, painted.document.revision, moved.document.revision, regenerated.document.revision, restoreBaseline.document.revision, adjusted.document.revision, later.document.revision, restored.document.revision, tactical.document.revision, metric.document.revision, final.document.revision], final })
})

test('M1-D exact outpost resources and selected protected history survive complete packages, empty offline storage and native reopen', async ({ page, browser }, info) => {
  test.setTimeout(300_000)
  await page.goto('/')
  const exported = await page.evaluate(async () => {
    const projectPath = '/src/editor/v6/outpost-project.ts', constraintPath = '/src/editor/v6/outpost-constraints.ts'
    const storagePath = '/src/io/v6/storage.ts', workspacePath = '/src/editor/v6/workspace.ts', ioPath = '/src/io/v6/project-file.ts', auditPath = '/tests/helpers/m1d-outpost-browser.ts'
    const { createOutpostProject, OUTPOST_IDS } = await import(projectPath) as typeof import('../src/editor/v6/outpost-project')
    const { validateOutpostEditsV3 } = await import(constraintPath) as typeof import('../src/editor/v6/outpost-constraints')
    const { SceneRepositoryV6 } = await import(storagePath) as typeof import('../src/io/v6/storage')
    const { WorkspaceV6 } = await import(workspacePath) as typeof import('../src/editor/v6/workspace')
    const io = await import(ioPath) as typeof import('../src/io/v6/project-file')
    const { describeM1DProject } = await import(auditPath) as typeof import('./helpers/m1d-outpost-browser')
    const original = await createOutpostProject(), databaseName = `m1d-source-${crypto.randomUUID()}`, repository = new SceneRepositoryV6(databaseName), workspace = new WorkspaceV6(repository, validateOutpostEditsV3)
    await repository.open()
    try {
      await workspace.adoptNew(original)
      const baseline = await workspace.createNamedSnapshot('海岸哨所完整基线'), omitted = await workspace.createNamedSnapshot('未勾选历史')
      await workspace.execute([{ type: 'updatePath', id: OUTPOST_IDS.path, changes: { widthMm: 2200, movementCostMultiplier: 2 } }]); await workspace.flush()
      await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: [OUTPOST_IDS.lamp] }, adjustment: { id: 'm1d-portable-lamp', kind: 'brightness', value: .75, enabled: true } }]); await workspace.flush()
      const edited = workspace.getState().project!, editedHash = await io.projectContentHashV6(edited)
      const preview = await workspace.prepareRestore(baseline.id, { ids: [OUTPOST_IDS.path], mode: 'outdoorGeometry' })
      const protection = await workspace.applyRestore(preview); await workspace.flush()
      const current = workspace.getState().project!, full = await io.exportProjectV6(current), reimported = await io.importProjectV6(full)
      const archive = await repository.exportArchive(current.document.sceneId, [baseline.id, protection.id]), history = await io.exportHistoryArchiveV6(archive)
      const saved = await repository.load(current.document.sceneId)
      if (!saved) throw new Error('Actual native outpost save missing')
      return { ids: OUTPOST_IDS, fullBytes: Array.from(new Uint8Array(await full.arrayBuffer())), historyBytes: Array.from(new Uint8Array(await history.arrayBuffer())),
        source: await describeM1DProject(original), current: await describeM1DProject(current), reimported: await describeM1DProject(reimported), savedHash: await io.projectContentHashV6(saved), editedHash,
        snapshots: { baselineId: baseline.id, omittedId: omitted.id, protectionId: protection.id, protectionHash: protection.contentHash },
        scope: { affectedIds: preview.plan.affectedIds, cost: preview.plan.commandCost, changes: preview.plan.changes },
        nativeHistory: await repository.listNamedSnapshots(current.document.sceneId) }
    } finally { repository.close(); await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(databaseName); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) }) }
  })
  const verifyBytes = (value: typeof exported.current) => {
    expect(Object.keys(value.assets).length).toBeGreaterThanOrEqual(34)
    for (const asset of Object.values(value.assets)) {
      expect(asset.actualHash).toBe(asset.sha256); expect(asset.actualSize).toBe(asset.sizeBytes)
      expect([asset.decodedWidth, asset.decodedHeight]).toEqual([asset.pixelWidth, asset.pixelHeight])
    }
    for (const license of Object.values(value.licenses)) expect(license.actualHash).toBe(license.sha256)
  }
  verifyBytes(exported.source); verifyBytes(exported.current); expect(Object.keys(exported.source.assets)).toHaveLength(34)
  expect(exported.reimported).toEqual(exported.current); expect(exported.savedHash).toBe(exported.current.contentHash)
  expect(exported.snapshots.protectionHash).toBe(exported.editedHash)
  expect(exported.current.document.paths[exported.ids.path]).toMatchObject({ widthMm: 2000, movementCostMultiplier: 2 })
  const scene = exported.source.document
  expect(scene.exportBoundsMm).toEqual({ x: 0, y: 0, width: 36000, height: 28000 })
  expect(Object.keys(scene.rooms)).toHaveLength(2); expect(Object.keys(scene.walls)).toHaveLength(7); expect(Object.keys(scene.openings)).toHaveLength(2)
  expect(scene.rooms[exported.ids.room]).toMatchObject({ groundElevationMm: 1000, supportRef: { kind: 'terrainArea', id: exported.ids.low } })
  expect(scene.rooms[exported.ids.store]).toMatchObject({ groundElevationMm: 1000, supportRef: { kind: 'terrainArea', id: exported.ids.low } })
  expect(scene.terrainAreas[exported.ids.low].boundaryMm.map(point => point.positionMm)).toEqual([{ x: 2000, y: 4000 }, { x: 17000, y: 2000 }, { x: 23000, y: 5000 }, { x: 23000, y: 20000 }, { x: 17000, y: 24000 }, { x: 3000, y: 23000 }])
  expect(scene.terrainAreas[exported.ids.high].boundaryMm.map(point => point.positionMm)).toEqual([{ x: 23000, y: 5000 }, { x: 32000, y: 7000 }, { x: 33000, y: 18000 }, { x: 23000, y: 20000 }])
  expect(scene.terrainAreas[exported.ids.water].blocksMovement).toBe(true)
  expect(scene.paths[exported.ids.path].supportRefs).toEqual([{ kind: 'terrainArea', id: exported.ids.low }])
  expect(scene.paths[exported.ids.path].centerlineMm).toEqual([{ x: 9000, y: 14000 }, { x: 9000, y: 16000 }, { x: 21000, y: 16000 }, { x: 21500, y: 13000 }])
  expect(Object.keys(scene.terrainConnections)).toHaveLength(1)
  const targetContext = await browser.newContext({ baseURL: new URL(page.url()).origin }), target = await targetContext.newPage(), databaseName = `m1d-offline-${crypto.randomUUID()}`
  try {
    await target.goto('/')
    await target.evaluate(async databaseName => {
      const ioPath = '/src/io/v6/project-file.ts', storagePath = '/src/io/v6/storage.ts', workspacePath = '/src/editor/v6/workspace.ts', auditPath = '/tests/helpers/m1d-outpost-browser.ts', constraintsPath = '/src/editor/v6/outpost-constraints.ts'
      const io = await import(ioPath) as typeof import('../src/io/v6/project-file')
      const { SceneRepositoryV6 } = await import(storagePath) as typeof import('../src/io/v6/storage')
      const { WorkspaceV6 } = await import(workspacePath) as typeof import('../src/editor/v6/workspace')
      const { describeM1DProject } = await import(auditPath) as typeof import('./helpers/m1d-outpost-browser')
      const { validateOutpostEditsV3 } = await import(constraintsPath) as typeof import('../src/editor/v6/outpost-constraints')
      const repository = new SceneRepositoryV6(databaseName); await repository.open()
      Reflect.set(window, '__m1dOffline', { io, repository, workspace: new WorkspaceV6(repository, validateOutpostEditsV3), describe: describeM1DProject })
    }, databaseName)
    await targetContext.setOffline(true)
    const imported = await target.evaluate(async ({ bytes, sourceId, pathId }) => {
      const dev = Reflect.get(window, '__m1dOffline') as { io: typeof import('../src/io/v6/project-file'); repository: SceneRepositoryV6; workspace: WorkspaceV6; describe: typeof import('./helpers/m1d-outpost-browser').describeM1DProject }
      const empty = await dev.repository.list(), archive = await dev.io.importHistoryArchiveV6(new Blob([Uint8Array.from(bytes).buffer], { type: 'application/x-sceneweave' }))
      await dev.workspace.adoptArchive(archive)
      const project = dev.workspace.getState().project!, before = await dev.describe(project), sceneId = project.document.sceneId
      const snapshots = await dev.repository.listNamedSnapshots(sceneId)
      const noteId = Object.values(project.document.notes).find(note => note.visibility === 'gm')!.id
      await dev.workspace.execute([{ type: 'updatePath', id: pathId, changes: { widthMm: 2300, movementCostMultiplier: 3 } }, { type: 'updateNote', id: noteId, changes: { text: '离线后新增的线索必须保留' } }]); await dev.workspace.flush()
      const editedHash = await dev.io.projectContentHashV6(dev.workspace.getState().project!)
      dev.repository.close(); await dev.repository.open()
      const saved = (await dev.repository.load(sceneId))!; await dev.workspace.openPersisted(saved)
      const reopenedHash = await dev.io.projectContentHashV6(saved)
      const preview = await dev.workspace.prepareRestore(sourceId, { ids: [pathId], mode: 'outdoorGeometry' })
      const protection = await dev.workspace.applyRestore(preview); await dev.workspace.flush()
      return { empty, before, snapshots, editedHash, reopenedHash, noteId, protectionHash: protection.contentHash, after: await dev.describe(dev.workspace.getState().project!), usage: await dev.repository.usage(sceneId) }
    }, { bytes: exported.historyBytes, sourceId: exported.snapshots.baselineId, pathId: exported.ids.path })
    expect(imported.empty).toEqual([]); verifyBytes(imported.before); verifyBytes(imported.after)
    for (const key of ['rooms', 'walls', 'vertices', 'openings', 'notes', 'userLayers', 'entityLayers', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'props', 'prefabInstances', 'scatterGroups'] as const) expect(imported.before.document[key]).toEqual(exported.current.document[key])
    expect(imported.before.appearance).toEqual(exported.current.appearance); expect(imported.before.historyIdentity).toEqual(exported.current.historyIdentity)
    expect(imported.before.assets).toEqual(exported.current.assets); expect(imported.before.licenses).toEqual(exported.current.licenses); expect(imported.before.licenseBindings).toEqual(exported.current.licenseBindings)
    expect(imported.before.document.sceneId).not.toBe(exported.current.document.sceneId); expect(imported.before.document.revision).toBe(0)
    expect(imported.snapshots.map(snapshot => snapshot.id).sort()).toEqual([exported.snapshots.baselineId, exported.snapshots.protectionId].sort())
    expect(imported.snapshots.some(snapshot => snapshot.id === exported.snapshots.omittedId)).toBe(false)
    expect(imported.reopenedHash).toBe(imported.editedHash); expect(imported.protectionHash).toBe(imported.editedHash)
    expect(imported.after.document.paths[exported.ids.path]).toMatchObject({ widthMm: 2000, movementCostMultiplier: 3 })
    expect(imported.after.document.notes[imported.noteId].text).toBe('离线后新增的线索必须保留')
    expect(imported.after.appearance).toEqual(imported.before.appearance); expect(imported.after.assets).toEqual(imported.before.assets)
    expect(imported.usage).toMatchObject({ namedCount: 1, protectionCount: 2 })
    await info.attach('m1d-outpost-complete.sceneweave', { body: Buffer.from(exported.fullBytes), contentType: 'application/x-sceneweave' })
    await info.attach('m1d-outpost-selected-history.sceneweave', { body: Buffer.from(exported.historyBytes), contentType: 'application/x-sceneweave' })
    const { fullBytes: _full, historyBytes: _history, ...sourceReport } = exported
    await evidence(info, 'm1d-complete-native-offline-history.json', { method: 'Actual original PNG bytes, native Chromium image decoding, strict v6 validation, complete ZIP and chosen-history ZIP, native IndexedDB. Separate context/empty database modules preload online, then offline import, editing, close/reopen and scoped restoration run without fetch. This does not prove offline PWA cold start, general routing, full art or performance.', packageBytes: { full: exported.fullBytes.length, history: exported.historyBytes.length }, ...sourceReport, imported })
  } finally {
    await target.evaluate(async databaseName => {
      (Reflect.get(window, '__m1dOffline') as { repository: SceneRepositoryV6 } | undefined)?.repository.close()
      await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(databaseName); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
    }, databaseName).catch(() => {})
    await targetContext.close()
  }
})
