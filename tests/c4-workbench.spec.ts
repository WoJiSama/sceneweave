import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { SceneDocumentV3 } from '../src/core/v3/types'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'
import type { SceneRepositoryV6 } from '../src/io/v6/storage'
import type { CompleteProjectV6 } from '../src/io/v6/types'

type Dev = { workspace: WorkspaceV6; repository: SceneRepositoryV6 }
async function project(page: Page): Promise<CompleteProjectV6> {
  return page.evaluate(() => structuredClone((Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!))
}
async function scene(page: Page): Promise<SceneDocumentV3> { return (await project(page)).document }
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}
async function blank(page: Page, title: string, width = 14000, height = 10000, preset = 'investigation') {
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByLabel('画布宽度', { exact: true }).fill(String(width))
  await dialog.getByLabel('画布高度', { exact: true }).fill(String(height))
  await dialog.getByLabel('使用预设', { exact: true }).selectOption(preset)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  const initial = await scene(page)
  expect(Object.keys(initial.rooms)).toEqual([]); expect(Object.keys(initial.terrainAreas)).toEqual([]); expect(Object.keys(initial.props)).toEqual([])
  expect(Object.keys(initial.propDefinitions)).toHaveLength(18); expect(Object.keys(initial.materials)).toHaveLength(10)
}
async function outdoorAdopt(page: Page) {
  const apply = page.getByRole('button', { name: '采用室外修改', exact: true })
  await expect(apply).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await apply.click(); await expect(apply).toHaveCount(0); await settled(page)
}
async function structureAdopt(page: Page) {
  const apply = page.getByRole('button', { name: '采用结构修改', exact: true })
  await expect(apply).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await apply.click(); await expect(apply).toHaveCount(0); await settled(page)
}
async function fillNumber(page: Page, label: string, value: number) {
  const field = page.getByRole('spinbutton', { name: label, exact: true })
  await field.fill(String(value)); await field.press('Tab')
}
async function saveSnapshot(page: Page, name: string) {
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled(page)
}
async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function addRegion(page: Page, points: string, kind: 'terrain' | 'hazard', blocksMovement: boolean) {
  const before = await scene(page), tools = page.getByRole('region', { name: '室外制作工具', exact: true })
  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('region')
  await tools.getByLabel('室外坐标', { exact: true }).fill(points)
  await tools.getByLabel('区域用途', { exact: true }).selectOption(kind)
  await tools.getByLabel('区域阻挡移动', { exact: true }).setChecked(blocksMovement)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  const current = await scene(page), added = Object.keys(current.regions).filter(id => !Object.hasOwn(before.regions, id))
  expect(added).toHaveLength(1)
  return current.regions[added[0]]
}

test('C4 road inspector preserves complete paint and multiple supports through cancel and adoption', async ({ page }, info) => {
  test.setTimeout(180_000)
  await blank(page, 'C4 多表面道路', 16000, 12000)
  await page.evaluate(async () => {
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    const current = workspace.getState().project!, floorId = Object.keys(current.document.floors)[0]
    const materials = Object.values(current.document.materials).filter(item => item.applicableSurfaces.includes('path'))
    if (materials.length < 2) throw new Error('Road regression requires two real path textures.')
    const paint = { materialRef: { id: materials[0].id, version: materials[0].version }, tileSizeMm: { width: 700, height: 1100 },
      rotationDeg: 35, alignment: 'world' as const, originMm: { x: -200, y: 125 }, tint: null, opacity: 1 }
    await workspace.execute([
      { type: 'createTerrainArea', id: 'left-support', floorId, boundaryMm: [{ x: 1000, y: 1000 }, { x: 8000, y: 1000 }, { x: 8000, y: 9000 }, { x: 1000, y: 9000 }] },
      { type: 'createTerrainArea', id: 'right-support', floorId, boundaryMm: [{ x: 8000, y: 1000 }, { x: 15000, y: 1000 }, { x: 15000, y: 9000 }, { x: 8000, y: 9000 }] },
      { type: 'createPath', id: 'multi-road', floorId, centerlineMm: [{ x: 3000, y: 4000 }, { x: 13000, y: 4000 }], widthMm: 1000,
        supportRefs: [{ kind: 'terrainArea', id: 'left-support' }, { kind: 'terrainArea', id: 'right-support' }],
        surfaceStyle: { base: paint, overlays: [{ id: 'preserved-overlay', boundaryMm: [{ x: 5000, y: 3800 }, { x: 6500, y: 3800 }, { x: 6500, y: 4200 }, { x: 5000, y: 4200 }],
          blendWidthMm: 120, renderOrder: 7, paint: { ...paint, materialRef: { id: materials[1].id, version: materials[1].version }, rotationDeg: 340, opacity: .75 } }] } },
    ])
  })
  await settled(page)
  await page.getByRole('button', { name: 'multi-road', exact: true }).click()
  const before = await project(page), path = before.document.paths['multi-road']
  await expect(page.getByLabel('对象道路支撑', { exact: true })).toHaveValues(['terrainArea:left-support', 'terrainArea:right-support'])
  await fillNumber(page, '对象通路净宽', 1200)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click()
  expect(await project(page)).toEqual(before)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click(); await settled(page)
  expect(await project(page)).toEqual(before)
  await fillNumber(page, '对象通路净宽', 1200)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await outdoorAdopt(page)
  const adopted = await project(page)
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(adopted.document.paths['multi-road']).toEqual({ ...path, widthMm: 1200 })
  await page.getByLabel('对象道路支撑', { exact: true }).selectOption(['terrainArea:left-support'])
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /支撑|support/ })).toBeVisible()
  expect(await project(page)).toEqual(adopted)
  const persisted = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    return (await repository.load(workspace.getState().project!.document.sceneId))!.document
  })
  expect(persisted).toEqual(adopted.document)
  await evidence(info, 'c4-road-multiple-supports-and-paint', { before: path, after: adopted.document.paths['multi-road'], canceledUnchanged: true, insufficientSupportRejected: true, persisted })
})

test('C4 scatter batch move and context menu lock require complete dependency confirmation', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.evaluate(async () => {
    const fixturePath = '/tests/c4-fixtures.ts'
    const { createC4ProjectV6 } = await import(fixturePath) as typeof import('./c4-fixtures')
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    await workspace.adoptNew(await createC4ProjectV6({ title: 'C4 散布批量确认' }))
  })
  await settled(page)
  const initial = await project(page), groupId = 'c4-scatter'
  const members = Object.entries(initial.document.scatterGroups[groupId].members).filter(([, member]) => member.propId)
  const selected = members.slice(0, 2).map(([, member]) => member.propId!)
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.locator(`.asset-entity-list [data-entity-id="${selected[0]}"]`).click()
  await page.locator(`.asset-entity-list [data-entity-id="${selected[1]}"]`).click({ modifiers: ['Shift'] })
  await fillNumber(page, '批量位移 X', 100)
  await page.getByRole('button', { name: '预览批量移动', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
  const moveScope = (await page.getByLabel('待采用室外操作 ID', { exact: true }).inputValue()).split('\n')
  expect(moveScope).toEqual(expect.arrayContaining([groupId, 'c4-terrain', ...selected]))
  expect(await project(page)).toEqual(initial)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click(); await settled(page)
  expect(await project(page)).toEqual(initial)
  await fillNumber(page, '批量位移 X', 100)
  await page.getByRole('button', { name: '预览批量移动', exact: true }).click(); await outdoorAdopt(page)
  const moved = await project(page)
  expect(moved.document.revision).toBe(initial.document.revision + 1)
  for (const [key, member] of members) {
    const id = member.propId!, before = initial.document.props[id]
    expect(moved.document.props[id].positionMm).toEqual(selected.includes(id) ? { x: before.positionMm.x + 100, y: before.positionMm.y } : before.positionMm)
    if (selected.includes(id)) expect(moved.document.scatterGroups[groupId].members[key].state).toBe('manual')
  }
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '锁定所选', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
  const lockScope = (await page.getByLabel('待采用室外操作 ID', { exact: true }).inputValue()).split('\n')
  expect(lockScope).toEqual(expect.arrayContaining([groupId, 'c4-terrain', ...selected]))
  expect(await project(page)).toEqual(moved)
  await outdoorAdopt(page)
  const locked = await project(page)
  expect(locked.document.revision).toBe(moved.document.revision + 1)
  for (const id of selected) expect(locked.document.props[id]).toEqual({ ...moved.document.props[id], editLocked: true })
  await evidence(info, 'c4-scatter-batch-confirmation', { selected, moveScope, lockScope, canceledUnchanged: true, revisions: [initial.document.revision, moved.document.revision, locked.document.revision], group: locked.document.scatterGroups[groupId] })
})

test('C4 blank terrain edits require explicit edge remapping and confirm the exact impact once', async ({ page }, info) => {
  test.setTimeout(180_000)
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message))
  await blank(page, 'C4 地形闭环')
  let before = await project(page)
  const panel = page.getByRole('region', { name: '室外制作工具', exact: true })
  await panel.getByLabel('室外坐标', { exact: true }).fill('2000, 2000\n10000, 2000\n10000, 8000\n2000, 8000')
  await panel.getByLabel('地形材质', { exact: true }).selectOption('b3-m-01')
  await panel.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用室外修改', exact: true })).toBeVisible()
  expect((await project(page)).document.revision).toBe(before.document.revision)
  const previewIds = await page.getByLabel('待采用室外操作 ID', { exact: true }).inputValue()
  expect(previewIds.split('\n')).toHaveLength(1)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  expect((await project(page)).document).toEqual(before.document)

  await panel.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  let current = await scene(page), areaId = Object.keys(current.terrainAreas)[0], area = current.terrainAreas[areaId]
  expect(area.surfaceStyle?.base.materialRef).toEqual({ id: 'b3-m-01', version: 1 })
  expect(area.boundaryMm.map(point => point.positionMm)).toEqual([{ x: 2000, y: 2000 }, { x: 10000, y: 2000 }, { x: 10000, y: 8000 }, { x: 2000, y: 8000 }])
  await page.getByRole('button', { name: areaId, exact: true }).click()
  await page.getByText('来源边缘与局部铺装', { exact: true }).click()
  await page.getByRole('button', { name: '预览来源边缘', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page); const edgeId = Object.keys(current.terrainEdges)[0]
  expect(current.terrainEdges[edgeId].source).toEqual({ areaId, segmentId: current.terrainAreas[areaId].boundaryMm[0].segmentId })

  await page.getByRole('button', { name: areaId, exact: true }).click()
  before = await project(page)
  await fillNumber(page, '对象地形高程', 1000)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /来源边缘|崖边|边段|高差边界|cliff/ })).toBeVisible()
  expect((await project(page)).document).toEqual(before.document)
  await page.getByRole('button', { name: '关闭工坊提示', exact: true }).click()

  const relatedEdges = page.getByText('关联来源边缘 · 1', { exact: true })
  await relatedEdges.click()
  await expect(relatedEdges.locator('..')).toHaveAttribute('open', '')
  await page.getByLabel('同时重映射来源边缘', { exact: true }).check()
  await fillNumber(page, `重映射边段 ${edgeId}`, 1)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用室外修改', exact: true })).toBeVisible()
  const actualScope = (await page.getByLabel('待采用室外操作 ID', { exact: true }).inputValue()).split('\n')
  expect(actualScope).toEqual(expect.arrayContaining([areaId, edgeId]))
  await outdoorAdopt(page)
  current = await scene(page)
  expect(current.terrainAreas[areaId].groundElevationMm).toBe(1000)
  expect(current.terrainEdges[edgeId]).toMatchObject({ kind: 'cliff', blocksMovement: true, source: { segmentId: current.terrainAreas[areaId].boundaryMm[0].segmentId } })

  const overlayMaterial = Object.values(current.materials).find(material => material.applicableSurfaces.includes('terrain') && material.id !== 'b3-m-01')
  expect(overlayMaterial).toBeTruthy()
  await page.getByText('来源边缘与局部铺装', { exact: true }).click()
  await page.getByLabel('局部覆盖坐标', { exact: true }).fill('3000, 3000\n5000, 3000\n5000, 5000\n3000, 5000')
  await page.getByLabel('局部覆盖材质', { exact: true }).selectOption(overlayMaterial!.id)
  await page.getByRole('button', { name: '预览增加覆盖', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page)
  expect(current.terrainAreas[areaId].surfaceStyle?.overlays).toHaveLength(1)
  expect(current.terrainAreas[areaId].surfaceStyle?.overlays[0].paint.materialRef.id).toBe(overlayMaterial!.id)
  expect((await project(page)).historyIdentity.outdoorTokens[areaId]).toBeTruthy()
  await evidence(info, 'c4-terrain-edge-overlay', { firstCanceledPreviewUnchanged: true, failedImplicitRemapUnchanged: true, actualScope, area: current.terrainAreas[areaId], edge: current.terrainEdges[edgeId], token: (await project(page)).historyIdentity.outdoorTokens[areaId] })
  expect(pageErrors).toEqual([])
})

test('C4 outdoor geometry restore after reload preserves later road edits and writes a protection point', async ({ page }, info) => {
  test.setTimeout(240_000)
  await blank(page, 'C4 地形恢复')
  const tools = page.getByRole('region', { name: '室外制作工具', exact: true })
  await tools.getByLabel('室外坐标', { exact: true }).fill('2000, 2000\n10000, 2000\n10000, 8000\n2000, 8000')
  await tools.getByLabel('地形材质', { exact: true }).selectOption('b3-m-01')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  let current = await scene(page), areaId = Object.keys(current.terrainAreas)[0]

  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('path')
  await tools.getByLabel('室外坐标', { exact: true }).fill('2000, 9000\n12000, 9000')
  await tools.getByLabel('道路支撑表面', { exact: true }).selectOption(`floor:${Object.keys(current.floors)[0]}`)
  await fillNumber(page, '室外通路宽度毫米', 1000)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page); const pathId = Object.keys(current.paths)[0], originalBoundary = structuredClone(current.terrainAreas[areaId].boundaryMm)
  await saveSnapshot(page, 'C4 地形基线')

  await page.getByRole('tab', { name: '室外', exact: true }).click()
  await page.getByRole('button', { name: areaId, exact: true }).click()
  await page.getByLabel('室外对象坐标', { exact: true }).fill('2500, 2500\n9000, 2500\n9000, 7500\n2500, 7500')
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page)
  expect(current.terrainAreas[areaId].boundaryMm).not.toEqual(originalBoundary)
  await page.getByRole('button', { name: pathId, exact: true }).click()
  await fillNumber(page, '对象通路净宽', 1200)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page)
  const laterPath = structuredClone(current.paths[pathId]), beforeReload = await project(page)
  await page.reload(); await expect(page.getByTestId('outdoor-workbench')).toBeVisible(); await settled(page)
  current = await scene(page)
  expect(current.terrainAreas[areaId].boundaryMm).toEqual(beforeReload.document.terrainAreas[areaId].boundaryMm)
  expect(current.paths[pathId]).toEqual(laterPath)

  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '查看快照 C4 地形基线', exact: true }).click()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('outdoorGeometry')
  await page.getByRole('checkbox', { name: `恢复物件 ${areaId}`, exact: true }).check()
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  await expect(page.getByLabel('局部恢复差异', { exact: true })).toBeVisible()
  expect((await scene(page)).terrainAreas[areaId].boundaryMm).toEqual(beforeReload.document.terrainAreas[areaId].boundaryMm)
  const restorePreview = await page.getByLabel('局部恢复完整实际范围', { exact: true }).inputValue()
  expect(restorePreview.split('\n')).toContain(areaId)
  await expect(page.getByRole('button', { name: '保护当前并采用', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled(page)
  current = await scene(page)
  expect(current.revision).toBe(beforeReload.document.revision + 1)
  expect(current.terrainAreas[areaId].boundaryMm).toEqual(originalBoundary)
  expect(current.paths[pathId]).toEqual(laterPath)
  const protection = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    return (await repository.listNamedSnapshots(workspace.getState().project!.document.sceneId)).filter(item => item.kind === 'protection')
  })
  expect(protection).toHaveLength(1)
  await evidence(info, 'c4-restore-after-reload', { beforeReload, restored: current, pathPreserved: laterPath, restorePreview, protection })
})

test('C4 creates supported roads and explicit stairs without treating drawing as movement', async ({ page }, info) => {
  test.setTimeout(180_000)
  await blank(page, 'C4 支撑与连接', 30000, 24000)
  const tools = page.getByRole('region', { name: '室外制作工具', exact: true })
  await tools.getByLabel('室外坐标', { exact: true }).fill('16000, 8000\n24000, 8000\n24000, 16000\n16000, 16000')
  await tools.getByLabel('地形高程毫米', { exact: true }).fill('1000')
  await tools.getByLabel('地形材质', { exact: true }).selectOption('b3-m-01')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  let current = await scene(page), areaId = Object.keys(current.terrainAreas)[0]
  expect(current.terrainAreas[areaId].groundElevationMm).toBe(1000)

  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('connection')
  await tools.getByLabel('室外坐标', { exact: true }).fill('10000, 12000\n17000, 12000')
  await tools.getByLabel('连接起点表面', { exact: true }).selectOption(`floor:${Object.keys(current.floors)[0]}`)
  await tools.getByLabel('连接终点表面', { exact: true }).selectOption(`terrainArea:${areaId}`)
  await tools.getByLabel('高差连接类型', { exact: true }).selectOption('stairs')
  await fillNumber(page, '室外通路宽度毫米', 2000)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page); const connectionId = Object.keys(current.terrainConnections)[0]
  expect(current.terrainConnections[connectionId]).toMatchObject({ kind: 'stairs', widthMm: 2000, from: { surfaceRef: { kind: 'floor' } }, to: { surfaceRef: { kind: 'terrainArea', id: areaId } }, blocksMovement: false })
  const fullSupport = current.terrainConnections[connectionId]

  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('path')
  await tools.getByLabel('室外坐标', { exact: true }).fill('2000, 20000\n12000, 20000')
  await tools.getByLabel('道路支撑表面', { exact: true }).selectOption(`floor:${Object.keys(current.floors)[0]}`)
  await fillNumber(page, '室外通路宽度毫米', 1200)
  const pathMaterial = Object.values(current.materials).find(material => material.applicableSurfaces.includes('path'))
  if (pathMaterial) await tools.getByLabel('道路材质', { exact: true }).selectOption(pathMaterial.id)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page); const pathId = Object.keys(current.paths)[0]
  expect(current.paths[pathId]).toMatchObject({ widthMm: 1200, supportRefs: [{ kind: 'floor', id: Object.keys(current.floors)[0] }] })
  expect(Object.keys(current.rooms)).toEqual([])
  expect(current.terrainConnections[connectionId]).toEqual(fullSupport)
  await evidence(info, 'c4-supported-connection-path', { area: current.terrainAreas[areaId], connection: fullSupport, path: current.paths[pathId], rooms: current.rooms })
})

test('C4 scatter density cycles preserve manual, deleted, detached, locked and stored births after reopen', async ({ page }, info) => {
  test.setTimeout(240_000)
  await blank(page, 'C4 人工散布')
  const tools = page.getByRole('region', { name: '室外制作工具', exact: true })
  await tools.getByLabel('室外坐标', { exact: true }).fill('1000, 1000\n13000, 1000\n13000, 9000\n1000, 9000')
  await tools.getByLabel('地形材质', { exact: true }).selectOption('b3-m-01')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  let current = await scene(page), areaId = Object.keys(current.terrainAreas)[0]

  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('scatter')
  await tools.getByLabel('散布域', { exact: true }).selectOption(`area:${areaId}`)
  await tools.getByLabel('散布素材', { exact: true }).selectOption('b3-p-01')
  await tools.getByLabel('散布密度', { exact: true }).fill('1')
  await tools.getByLabel('散布候选格距', { exact: true }).fill('2000')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page); const groupId = Object.keys(current.scatterGroups)[0]
  await page.getByRole('button', { name: groupId, exact: true }).click()
  await page.getByLabel('对象散布密度', { exact: true }).fill('1')
  await page.getByLabel('对象散布格距', { exact: true }).fill('2000')
  await page.getByRole('button', { name: '预览重新散布', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page)
  let group = current.scatterGroups[groupId]
  const firstMembers = Object.entries(group.members).filter(([, member]) => member.propId)
  expect(firstMembers.length).toBeGreaterThanOrEqual(4)
  const [manualKey, manual] = firstMembers[0], [deletedKey, deleted] = firstMembers[1], [detachedKey, detached] = firstMembers[2], [lockedKey, locked] = firstMembers[3]
  const manualBefore = structuredClone(current.props[manual.propId!]), deletedBefore = structuredClone(current.props[deleted.propId!]), detachedBefore = structuredClone(current.props[detached.propId!]), lockedBefore = structuredClone(current.props[locked.propId!])
  const selectMember = async (id: string) => {
    await page.getByRole('button', { name: groupId, exact: true }).click()
    await page.getByText(`完整成员记录 · ${Object.keys(group.members).length}`, { exact: true }).click()
    await page.locator('.asset-inspector').getByRole('button', { name: id, exact: true }).click()
    await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()
  }
  await selectMember(manual.propId!)
  const beforeManualEdit = await project(page)
  await fillNumber(page, '物件 X', manualBefore.positionMm.x + 100)
  await expect(page.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
  const manualScope = (await page.getByLabel('待采用室外操作 ID', { exact: true }).inputValue()).split('\n')
  expect(manualScope).toEqual(expect.arrayContaining([groupId, manual.propId!]))
  expect(await project(page)).toEqual(beforeManualEdit)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click(); await settled(page)
  expect(await project(page)).toEqual(beforeManualEdit)
  await fillNumber(page, '物件 X', manualBefore.positionMm.x + 100); await outdoorAdopt(page)
  await fillNumber(page, '物件 Y', manualBefore.positionMm.y + 100); await outdoorAdopt(page)
  await selectMember(deleted.propId!)
  await page.getByRole('button', { name: '删除并保留排除区', exact: true }).click(); await outdoorAdopt(page)
  await expect(page.getByLabel('对象散布密度', { exact: true })).toBeVisible()
  await selectMember(detached.propId!)
  await page.getByRole('button', { name: '退出散布，保留物件', exact: true }).click(); await outdoorAdopt(page)
  await expect(page.getByRole('heading', { name: '工程信息', exact: true })).toBeVisible()
  await selectMember(locked.propId!)
  await page.getByRole('button', { name: '固定此物件', exact: true }).click(); await settled(page)
  await page.getByRole('button', { name: groupId, exact: true }).click()
  current = await scene(page); group = current.scatterGroups[groupId]
  expect(group.members[manualKey].state).toBe('manual'); expect(group.members[deletedKey].state).toBe('deleted'); expect(group.members[detachedKey].state).toBe('detached'); expect(current.props[locked.propId!].editLocked).toBe(true)

  await page.getByLabel('对象散布密度', { exact: true }).fill('0')
  await page.getByRole('button', { name: '预览重新散布', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page); group = current.scatterGroups[groupId]
  expect(group.members[manualKey].propId).toBe(manual.propId); expect(group.members[manualKey].state).toBe('manual')
  expect(group.members[deletedKey].state).toBe('deleted'); expect(current.props[deleted.propId!]).toBeUndefined()
  expect(group.members[detachedKey].propId).toBeNull(); expect(group.members[detachedKey].state).toBe('detached'); expect(current.props[detached.propId!]).toEqual(detachedBefore)
  expect(group.members[lockedKey].propId).toBe(locked.propId); expect(current.props[locked.propId!].editLocked).toBe(true)
  expect(current.props[manual.propId!].positionMm).toEqual({ x: manualBefore.positionMm.x + 100, y: manualBefore.positionMm.y + 100 })
  const zeroBirthKeys = Object.keys(group.members), zeroIdentity = (await project(page)).historyIdentity.propTokens, retainedExclusions = structuredClone(group.exclusions)

  await page.getByLabel('对象散布密度', { exact: true }).fill('1')
  await page.getByRole('button', { name: '预览重新散布', exact: true }).click(); await outdoorAdopt(page)
  current = await scene(page); group = current.scatterGroups[groupId]
  const liveAfter = Object.values(group.members).flatMap(member => member.propId ? [member.propId] : [])
  expect(liveAfter).toContain(manual.propId); expect(liveAfter).not.toContain(detached.propId); expect(current.props[detached.propId!]).toEqual(detachedBefore); expect(liveAfter).toContain(locked.propId)
  expect(current.props[deleted.propId!]).toBeUndefined(); expect(group.exclusions).toEqual(retainedExclusions)
  expect(current.props[manual.propId!].positionMm).toEqual({ x: manualBefore.positionMm.x + 100, y: manualBefore.positionMm.y + 100 })
  expect(current.props[locked.propId!]).toMatchObject({ ...lockedBefore, editLocked: true })
  const bornAfter = liveAfter.filter(id => !Object.hasOwn(zeroIdentity, id))
  expect(bornAfter.length).toBeGreaterThan(0)
  const committed = await project(page)
  const retained = { manualKey, deletedKey, detachedKey, lockedKey, manualId: manual.propId, deletedId: deleted.propId, detachedId: detached.propId, lockedId: locked.propId,
    manualBefore, deletedBefore, detachedBefore, lockedBefore, zeroBirthKeys, bornAfter, exclusions: group.exclusions, props: Object.fromEntries(liveAfter.map(id => [id, current.props[id]])) }
  await page.reload(); await expect(page.getByTestId('outdoor-workbench')).toBeVisible(); await settled(page)
  const reopened = await project(page); const reopenedGroup = reopened.document.scatterGroups[groupId]
  expect(reopened.document.scatterGroups[groupId]).toEqual(committed.document.scatterGroups[groupId])
  expect(reopened.document.props[manual.propId!]).toMatchObject({ ...manualBefore, positionMm: { x: manualBefore.positionMm.x + 100, y: manualBefore.positionMm.y + 100 } })
  expect(reopened.document.props[locked.propId!].editLocked).toBe(true); expect(reopened.document.props[deleted.propId!]).toBeUndefined()
  expect(reopened.historyIdentity.propTokens).toEqual(committed.historyIdentity.propTokens)
  expect(Object.keys(reopenedGroup.members)).toEqual(Object.keys(group.members))
  await evidence(info, 'c4-scatter-density-reopen', { retained, reopened: { group: reopenedGroup, manual: reopened.document.props[manual.propId!], deleted: reopened.document.props[deleted.propId!], detached: reopened.document.props[detached.propId!], locked: reopened.document.props[locked.propId!], identity: reopened.historyIdentity } })
})

test('C4 creates an open SCN-03 technical baseline with exact temporary rulers, blocked water and paired private notes', async ({ page }, info) => {
  test.setTimeout(300_000)
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message))
  await blank(page, 'C4 · SCN-03 风桥营地技术基线', 30000, 24000, 'narrative')
  const start = await project(page), floorId = Object.keys(start.document.floors)[0]
  expect(start.document.presetSnapshot).toMatchObject({ presetId: 'narrative', distanceMode: 'abstract' })
  const camp = await addRegion(page, '2000, 5000\n12000, 5000\n12000, 19000\n2000, 19000', 'terrain', false)
  const northWater = await addRegion(page, '14000, 0\n18000, 0\n18000, 11000\n14000, 11000', 'hazard', true)
  const southWater = await addRegion(page, '14000, 13000\n18000, 13000\n18000, 24000\n14000, 24000', 'hazard', true)
  const lookout = await addRegion(page, '20000, 6000\n28000, 6000\n28000, 18000\n20000, 18000', 'terrain', false)
  const bridge = await addRegion(page, '14000, 11000\n18000, 11000\n18000, 13000\n14000, 13000', 'terrain', false)
  let current = await scene(page)
  expect(Object.keys(current.rooms)).toEqual([])
  expect(Object.keys(current.regions)).toHaveLength(5)
  expect(Object.keys(current.paths)).toHaveLength(0)
  expect(current.terrainAreas).toEqual({})
  expect([camp, lookout].every(region => region.kind === 'terrain' && !region.blocksMovement)).toBe(true)
  expect([northWater, southWater].every(region => region.kind === 'hazard' && region.blocksMovement)).toBe(true)
  expect(bridge).toMatchObject({ floorId, kind: 'terrain', blocksMovement: false, movementCostMultiplier: 1 })

  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '放置', exact: true }).click()
  const definition = start.document.propDefinitions['b3-p-05']
  expect(definition).toBeTruthy()
  await page.getByRole('button', { name: `放置${definition.name}`, exact: true }).click()
  await fillNumber(page, '放置 X', 8000); await fillNumber(page, '放置 Y', 14000)
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await settled(page)
  const prop = Object.values((await scene(page)).props).find(item => item.definitionRef?.id === definition.id)
  expect(prop?.positionMm).toEqual({ x: 8000, y: 14000 })

  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByText('文字与线索', { exact: true }).click()
  const privateNotes: string[] = [], publicNotes: string[] = []
  for (const [text, x, y] of [
    ['营火地标 · 8000,12000（技术标记，营火美术待补）', 8000, 12000],
    ['西桥头', 14000, 12000], ['东桥头', 18000, 12000],
    ['瞭望台 · 旧灯架（技术标记，灯架美术待补）', 24000, 12000],
  ] as const) {
    await page.getByLabel('新注记内容', { exact: true }).fill(text)
    await page.getByLabel('新注记可见性', { exact: true }).selectOption('public')
    await fillNumber(page, '新注记 X', x); await fillNumber(page, '新注记 Y', y)
    await page.getByRole('button', { name: '预览新增注记', exact: true }).click(); await structureAdopt(page)
    current = await scene(page); const note = Object.values(current.notes).find(item => item.text === text)!
    expect(note.visibility).toBe('public'); publicNotes.push(note.id)
  }
  for (const [text, x, y] of [
    ['其中一根支撑绳被新打的绳结临时接长。', 14000, 12000],
    ['灯油的气味来自营地同一批物资。', 24000, 12000],
  ] as const) {
    await page.getByLabel('新注记内容', { exact: true }).fill(text)
    await page.getByLabel('新注记可见性', { exact: true }).selectOption('gm')
    await fillNumber(page, '新注记 X', x); await fillNumber(page, '新注记 Y', y)
    await page.getByRole('button', { name: '预览新增注记', exact: true }).click()
    await structureAdopt(page)
    current = await scene(page)
    const note = Object.values(current.notes).find(item => item.text === text)
    expect(note).toMatchObject({ visibility: 'gm', anchor: { type: 'point', positionMm: { x, y } } })
    privateNotes.push(note!.id)
  }

  const rulerStart = await project(page), snapshotsBefore = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    return { snapshots: await repository.listSnapshots(workspace.getState().project!.document.sceneId), named: await repository.listNamedSnapshots(workspace.getState().project!.document.sceneId) }
  })
  await page.getByRole('button', { name: '量尺', exact: true }).click()
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true }), box = await canvas.boundingBox()
  if (!box) throw new Error('SCN-03 ruler requires the actual rendered canvas.')
  const point = (x: number, y: number) => ({ x: box.x + (x - rulerStart.document.exportBoundsMm.x) / rulerStart.document.exportBoundsMm.width * box.width,
    y: box.y + (y - rulerStart.document.exportBoundsMm.y) / rulerStart.document.exportBoundsMm.height * box.height })
  const measurements = [[8000, 12000, 14000, 12000, 6000], [14000, 12000, 18000, 12000, 4000], [18000, 12000, 24000, 12000, 6000]] as const
  const measured = []
  for (const [x1, y1, x2, y2, length] of measurements) {
    const from = point(x1, y1), to = point(x2, y2)
    await page.mouse.click(from.x, from.y); await page.mouse.click(to.x, to.y)
    await expect(page.getByLabel('量尺结果', { exact: true })).toContainText(`${(length / 1000).toFixed(3)} m`)
    measured.push({ from: [x1, y1], to: [x2, y2], expectedMm: length, displayed: await page.getByLabel('量尺结果', { exact: true }).innerText() })
  }
  expect(await project(page)).toEqual(rulerStart)
  const snapshotsAfter = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    return { snapshots: await repository.listSnapshots(workspace.getState().project!.document.sceneId), named: await repository.listNamedSnapshots(workspace.getState().project!.document.sceneId) }
  })
  expect(snapshotsAfter).toEqual(snapshotsBefore)
  await page.getByRole('button', { name: '取消绘图或量尺', exact: true }).click()

  const audienceResults: Record<string, unknown> = {}
  for (const audience of ['gm', 'player'] as const) {
    const projection = await page.evaluate(async audience => {
      const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
      const path = '/src/render/v3/projection.ts', { projectSceneV3 } = await import(path) as typeof import('../src/render/v3/projection')
      const project = workspace.getState().project!
      const result = projectSceneV3(project.document, audience)
      return { noteIds: result.notes.map(note => note.id), pathIds: result.paths.map(path => path.id), propIds: result.props.map(prop => prop.id) }
    }, audience)
    expect(projection.noteIds).toEqual(expect.arrayContaining(publicNotes))
    expect(projection.noteIds).toHaveLength(audience === 'gm' ? 6 : 4)
    for (const id of privateNotes) expect(projection.noteIds.includes(id)).toBe(audience === 'gm')
    if (audience === 'player') await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '玩家', exact: true }).click()
    else await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '4K PNG', exact: true }).click()
    const file = await pending, filePath = await file.path()
    if (!filePath) throw new Error(`No ${audience} SCN-03 PNG file.`)
    const bytes = await readFile(filePath), chunks: string[] = []
    for (let offset = 8; offset + 12 <= bytes.length;) { const size = bytes.readUInt32BE(offset); chunks.push(bytes.toString('ascii', offset + 4, offset + 8)); offset += size + 12 }
    const privateText = ['其中一根支撑绳被新打的绳结临时接长。', '灯油的气味来自营地同一批物资。'].filter(text => bytes.includes(Buffer.from(text)))
    audienceResults[audience] = { fileName: file.suggestedFilename(), byteLength: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), chunks, privateTextMarkers: privateText, projection }
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(bytes.readUInt32BE(16)).toBe(4096); expect(bytes.readUInt32BE(20)).toBe(3277)
    expect(chunks.some(chunk => ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(chunk))).toBe(false)
    expect(privateText).toEqual([])
    await info.attach(`c4-scn03-${audience}-4k.png`, { body: bytes, contentType: 'image/png' })
    await settled(page)
  }

  const movement = await page.evaluate(async () => {
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev, document = workspace.getState().project!.document
    const geometryPath = '/src/core/v3/geometry-view.ts', travelPath = '/src/core/v2/terrain-travel.ts'
    const { toGeometryDocumentV2 } = await import(geometryPath) as typeof import('../src/core/v3/geometry-view')
    const { checkTerrainTravelV2 } = await import(travelPath) as typeof import('../src/core/v2/terrain-travel')
    const scene = toGeometryDocumentV2(document), floorId = Object.keys(document.floors)[0]
    return {
      bridgeRoute: checkTerrainTravelV2(scene, { floorId, from: { x: 12000, y: 12000 }, to: { x: 20000, y: 12000 }, widthMm: 2000 }),
      waterRoute: checkTerrainTravelV2(scene, { floorId, from: { x: 12000, y: 9500 }, to: { x: 20000, y: 9500 }, widthMm: 2000 }),
    }
  })
  expect(movement.bridgeRoute.ok).toBe(true)
  expect(movement.waterRoute.ok).toBe(false)
  expect(movement.waterRoute.issues.some(issue => issue.code === 'TERRAIN_TRAVEL_OBSTACLE')).toBe(true)
  await evidence(info, 'c4-scn03-open-camp-rulers-travel-privacy-and-4k', {
    method: 'Native blank v6 authored through Chromium UI; every region/note used preview, explicit impact confirmation and one transaction. N-M01 uses Region/Prop/Note only and no Room or Path. Three ruler pairs were clicked on the actual canvas. Two sequential UI 4K PNG downloads were parsed from their actual bytes.',
    limits: 'SCN-03 technical baseline only: one technical P2 stone prop, no full fire/tent/lamp artwork, no small-group or pathfinding acceptance. The east highland is a region at ground level; nonzero-height stairs are a separate C4 case.',
    preset: rulerStart.document.presetSnapshot, rooms: Object.keys(current.rooms), regions: current.regions, paths: current.paths,
    notes: Object.fromEntries([...publicNotes, ...privateNotes].map(id => [id, current.notes[id]])), measured,
    rulerWasTemporary: JSON.stringify(await project(page)) === JSON.stringify(rulerStart) && JSON.stringify(snapshotsAfter) === JSON.stringify(snapshotsBefore), movement, audienceResults,
  })
  expect(pageErrors).toEqual([])
})
