import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openOutdoorTask, openSceneObjects } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

test.use({ actionTimeout: 15000 })

const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
async function number(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true }); await field.fill(value); await field.press('Tab')
}
async function adopt(page: Page) {
  const candidate = review(page)
  await expect(candidate).toBeVisible({ timeout: 90000 })
  const confirmation = candidate.getByLabel('确认完整影响范围', { exact: true })
  if (await confirmation.isVisible()) await confirmation.check()
  await candidate.getByRole('button', { name: /^采用(?:结构|室外|视觉|组件)修改$/ }).click()
  await keyboardWorkspaceSaved(page)
}
async function open(details: Locator) {
  await expect(details).toBeVisible()
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
}
async function selectStructure(page: Page, id: string) {
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`.asset-entity-list [data-entity-id=${JSON.stringify(id)}]`).click()
}
async function coldOpen(page: Page, sceneId: string) {
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function pngHashes(page: Page, info: TestInfo, phase: string) {
  const result = []
  for (const audience of ['gm', 'player'] as const) {
    const downloading = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
    const path = info.outputPath(`${phase}-${audience}.png`)
    await (await downloading).saveAs(path); await keyboardWorkspaceSaved(page)
    await page.locator('.workspace-export-menu > summary').click()
    const bytes = await readFile(path)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    result.push({ audience, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  return result
}

for (const { actualShell, nonorthogonal } of [
  { actualShell: false, nonorthogonal: false },
  { actualShell: true, nonorthogonal: false },
  { actualShell: true, nonorthogonal: true },
]) test(`ordinary mountain tools${actualShell ? ' with actual shoulder and foot geometry' : ''}${nonorthogonal ? ' on a slanted host with an initial slanted edge' : ''} create a continuous physical cut, cancel/adopt it, undo/redo, and cold-reopen identical GM/player PNGs`, async ({ page }, info) => {
  test.setTimeout(300000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('真实岩体与连续山路 UI 自检')
  await dialog.getByRole('combobox', { name: '常用画布尺寸', exact: true }).selectOption(nonorthogonal ? '36000,24000' : '24000,18000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const outdoor = await openOutdoorTask(page, '地形与高程')
  await openDetailsBySummary(outdoor, /^精确坐标 · 区域轮廓$/)
  const boundary = nonorthogonal
    ? '18000,4000\n19800,7000\n19000,12500\n14500,15000\n9500,14000\n6000,11000\n6000,4000'
    : '6000,4000\n20000,4000\n20000,14000\n6000,14000'
  await outdoor.getByLabel('室外坐标', { exact: true }).fill(boundary)
  await number(page, '地形高程', '2')
  await outdoor.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page)
  const area = await keyboardProjectBackup(page, info.outputPath('terrain.sceneweave'))
  const areaId = Object.keys(area.document.terrainAreas)[0]
  expect(area.document.terrainAreas[areaId].groundElevationMm).toBe(2000)
  await selectStructure(page, areaId)
  const tools = page.locator('[data-carved-mountain-tools]')
  await open(tools); await number(page, '岩体底高', '-0.5')
  await tools.getByRole('button', { name: '预览建立岩体', exact: true }).click(); await adopt(page)
  let rock = await keyboardProjectBackup(page, info.outputPath('rock.sceneweave'))
  expect(rock.document.terrainAreas[areaId].rockBody).toEqual({ baseElevationMm: -500 })
  const sourceIndex = nonorthogonal ? 6 : 0, entryIndex = nonorthogonal ? 5 : 3
  const sourceSegment = rock.document.terrainAreas[areaId].boundaryMm[sourceIndex].segmentId
  if (nonorthogonal) {
    await open(tools)
    const sourceSelect = tools.getByRole('combobox', { name: '山路源边', exact: true })
    await expect(sourceSelect).toHaveValue(rock.document.terrainAreas[areaId].boundaryMm[entryIndex].segmentId)
    await expect(sourceSelect.locator('option').first()).toHaveJSProperty('disabled', true)
  }
  if (actualShell) {
    await open(tools)
    const shellTools = tools.locator('[data-rock-shell-tools]')
    await open(shellTools); await number(page, '岩体侧坡最大宽度', '3.2')
    if (nonorthogonal) for (let edge = 0; edge < 7; edge++) {
      await shellTools.getByRole('checkbox', { name: `第 ${edge + 1} 段保留竖直（源崖或入口）`, exact: true }).setChecked(edge === sourceIndex || edge === entryIndex)
    }
    await shellTools.getByRole('button', { name: '预览岩肩与坡脚', exact: true }).click(); await adopt(page)
    const original = rock.document.terrainAreas[areaId]
    rock = await keyboardProjectBackup(page, info.outputPath('rock-shell.sceneweave'))
    expect(rock.document.terrainAreas[areaId].boundaryMm).toEqual(original.boundaryMm)
    const shell = rock.document.terrainAreas[areaId].rockBody!.shell!
    expect(Object.keys(shell.faces).length).toBeGreaterThan(0)
    expect(shell.footSurfaceRef).toEqual({ kind: 'floor', id: original.floorId })
    const maxX = Math.max(...original.boundaryMm.map(p => p.positionMm.x)), maxY = Math.max(...original.boundaryMm.map(p => p.positionMm.y))
    expect(Object.values(shell.verticesMm).some(p => p.x > maxX || p.y > maxY)).toBe(true)
  }
  const pathEndX = nonorthogonal ? 17000 : 18000
  const fillPath = async (endX = pathEndX) => {
    await open(tools)
    await tools.getByRole('combobox', { name: '山路源边', exact: true }).selectOption(sourceSegment)
    await tools.getByRole('combobox', { name: '朝向原崖外缘', exact: true }).selectOption('right')
    await number(page, '山路净宽', '1')
    await tools.getByLabel('山路实际路线', { exact: true }).fill(`6000 6000 0\n${endX} 6000 2000`)
  }
  if (nonorthogonal) {
    // This apron reaches the north/east corner. The adjacent slanted face was
    // not reserved as vertical, so the complete cut must be refused unchanged.
    await fillPath(18000); await tools.getByRole('button', { name: '预览山路与切壁', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('保留山路源崖及完整入口边为竖直面')
    await expect(review(page)).not.toBeVisible()
    const refused = await keyboardProjectBackup(page, info.outputPath('unreserved-slanted-cut.sceneweave'))
    expect(refused.hashes).toEqual(rock.hashes)
  }
  await fillPath(); await tools.getByRole('button', { name: '预览山路与切壁', exact: true }).click()
  await expect(review(page)).toBeVisible()
  await openDetailsBySummary(review(page), /^实际操作范围/)
  const disclosed = (await review(page).locator('textarea[readonly]').inputValue()).split('\n')
  expect(disclosed).toContain(areaId)
  await page.screenshot({ path: info.outputPath('mountain-candidate.png') })
  await review(page).getByRole('button', { name: /^取消(?:视觉|组件|室外|结构)预览$/ }).click(); await keyboardWorkspaceSaved(page)
  const cancelled = await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))
  expect(cancelled.hashes).toEqual(rock.hashes)
  await fillPath(); await tools.getByRole('button', { name: '预览山路与切壁', exact: true }).click(); await adopt(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('carved.sceneweave'))
  const connection = Object.values(adopted.document.terrainConnections).find(row => row.carvedStrip)!
  const strip = connection.carvedStrip!
  expect(connection).toMatchObject({ kind: 'ramp', widthMm: 1000, from: { positionMm: { x: 6000, y: 6000 } }, to: { positionMm: { x: pathEndX, y: 6000 } } })
  expect(strip).toMatchObject({ algorithmId: 'carved-strip1', algorithmVersion: 1, hostAreaId: areaId, sourceSegmentIds: [sourceSegment], cutSide: 'right' })
  expect(Object.keys(strip.verticesMm).length).toBeGreaterThan(0)
  expect(strip.cutCells.length).toBeGreaterThan(0)
  expect(adopted.document.attachments![strip.attachmentId].proofs.child.birthToken).toBe(adopted.identity.outdoorTokens[connection.id].token)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.terrainConnections[connection.id]).toBeUndefined()
  expect(undone.document.terrainAreas[areaId]).toEqual(rock.document.terrainAreas[areaId])
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))
  expect(redone.document.terrainConnections[connection.id].carvedStrip).toEqual(strip)
  expect(redone.identity.outdoorTokens[connection.id].topologyToken).not.toBe(adopted.identity.outdoorTokens[connection.id].topologyToken)
  const pictures = await pngHashes(page, info, 'redone')
  await coldOpen(page, redone.document.sceneId)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  expect(await pngHashes(page, info, 'cold')).toEqual(pictures)
  await selectStructure(page, connection.id)
  await openDetailsBySummary(page.getByRole('region', { name: '室外对象属性', exact: true }), /^连续凿岩山路$/)
  await expect(page.getByRole('button', { name: '预览移除并回填岩体', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('mountain-cold.png') })
  expect(errors).toEqual([])
  await writeFile(info.outputPath('mountain-result.json'), JSON.stringify({ formalAcceptance: false, ordinaryProductionUI: true, areaId, connectionId: connection.id,
    sourceSegment, actualShell, nonorthogonal, stations: strip.stations.length, faces: Object.keys(strip.faces).length, previewCancellationExact: true, undoRedo: true, coldArchiveExact: true, pngHashes: pictures, errors }, null, 2))
})

test('ordinary mountain tools explain and disable carving when every source edge is slanted', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('全斜边源崖拒绝 UI 自检')
  await dialog.getByRole('combobox', { name: '常用画布尺寸', exact: true }).selectOption('24000,18000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const outdoor = await openOutdoorTask(page, '地形与高程')
  await openDetailsBySummary(outdoor, /^精确坐标 · 区域轮廓$/)
  await outdoor.getByLabel('室外坐标', { exact: true }).fill('12000,4000\n18000,9000\n12000,14000\n6000,9000')
  await number(page, '地形高程', '2')
  await outdoor.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page)
  const area = await keyboardProjectBackup(page, info.outputPath('all-slanted.sceneweave'))
  const id = Object.keys(area.document.terrainAreas)[0]
  await selectStructure(page, id)
  const tools = page.locator('[data-carved-mountain-tools]')
  await open(tools); await number(page, '岩体底高', '-0.5')
  await tools.getByRole('button', { name: '预览建立岩体', exact: true }).click(); await adopt(page)
  await open(tools)
  await expect(tools.getByRole('combobox', { name: '山路源边', exact: true })).toBeDisabled()
  await expect(tools.getByRole('button', { name: '预览山路与切壁', exact: true })).toBeDisabled()
  await expect(tools).toContainText('当前岩体没有水平或竖直源边')
  await page.screenshot({ path: info.outputPath('all-slanted-source-disabled.png') })
})

test('ordinary attachment tools bind to a real table face and preserve local placement while moving and rotating the host', async ({ page }, info) => {
  test.setTimeout(240000)
  // SSR creates a legal ordinary archive only; the browser imports, reviews,
  // edits and saves through the same public UI as a user.
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture(), scene = source.project.document
    scene.title = '桌面实际承托 UI 自检'; scene.units.display = 'm'
    Object.assign(scene.props.item, { positionMm: { x: 6000, y: 6000 }, rotationDeg: 0, footprintMm: { width: 2400, height: 1600 }, footprintOffsetMm: { x: 0, y: 0 },
      visualBoundsMm: { x: -1200, y: -800, width: 2400, height: 1600 }, blocksMovement: false })
    Object.assign(scene.props.other, { positionMm: { x: 6200, y: 6000 }, rotationDeg: 0, footprintMm: { width: 400, height: 200 }, footprintOffsetMm: { x: 0, y: 0 },
      visualBoundsMm: { x: -200, y: -100, width: 400, height: 200 }, blocksMovement: false })
    scene.props.other.appearance.symbol = 'crate'
    Object.assign(source.project, createCompositionContent(scene, runtime))
    archive = await exportProject(source, validation)
  } finally { await vite.close() }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'table-attachment.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await keyboardWorkspaceSaved(page)
  await selectKeyboardProp(page, 'item')
  const tools = page.locator('[data-attachment-tools]')
  await open(tools); await number(page, '承托面离底高度', '0.8')
  await tools.getByRole('button', { name: '预览建立顶面', exact: true }).click(); await adopt(page)
  const withSurface = await keyboardProjectBackup(page, info.outputPath('table-surface.sceneweave'))
  const surfaceId = Object.keys(withSurface.document.attachmentSurfaces!)[0]
  expect(withSurface.document.attachmentSurfaces![surfaceId].owner).toEqual({ kind: 'prop', id: 'item' })
  await selectKeyboardProp(page, 'other')
  await open(tools); await tools.getByRole('combobox', { name: '物件附着表面', exact: true }).selectOption(surfaceId)
  await number(page, '面上相对 X', '0.2'); await number(page, '面上相对 Y', '0')
  await tools.getByRole('button', { name: '预览附着', exact: true }).click()
  await expect(review(page).getByLabel('关联对象', { exact: true })).toContainText('桌子')
  await expect(review(page).getByLabel('关联对象', { exact: true })).toContainText('木箱')
  await adopt(page)
  const attached = await keyboardProjectBackup(page, info.outputPath('attached.sceneweave'))
  const relation = Object.values(attached.document.attachments!)[0]
  expect(relation).toMatchObject({ mode: 'support', child: { kind: 'prop', id: 'other' }, anchor: { kind: 'horizontal', localMm: { x: 200, y: 0 } }, materialized: { contactElevationMm: 800 } })
  await selectKeyboardProp(page, 'item')
  await number(page, '物件 X', '7'); await keyboardWorkspaceSaved(page)
  await number(page, '物件 Y', '6.5'); await keyboardWorkspaceSaved(page)
  await number(page, '物件旋转', '90'); await keyboardWorkspaceSaved(page)
  const moved = await keyboardProjectBackup(page, info.outputPath('host-moved.sceneweave'))
  expect(moved.document.props.other).toMatchObject({ positionMm: { x: 7000, y: 6700 }, rotationDeg: 90 })
  expect(moved.document.attachments![relation.id].proofs).toEqual(relation.proofs)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('host-undone.sceneweave'))
  expect(undone.document.props.other).toMatchObject({ positionMm: { x: 7200, y: 6500 }, rotationDeg: 0 })
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('host-redone.sceneweave'))
  expect(redone.document.props.other).toEqual(moved.document.props.other)
  await coldOpen(page, redone.document.sceneId)
  const cold = await keyboardProjectBackup(page, info.outputPath('table-cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  expect(cold.document.attachments![relation.id].proofs).toEqual(relation.proofs)
  await selectKeyboardProp(page, 'other'); await open(tools)
  await expect(tools).toContainText('已承托 · 跟随宿主')
  await page.screenshot({ path: info.outputPath('table-cold.png') })
  expect(errors).toEqual([])
  await writeFile(info.outputPath('table-result.json'), JSON.stringify({ formalAcceptance: false, ordinaryProductionUI: true, surfaceId, relationId: relation.id,
    actualContactElevationMm: 800, followedPositionMm: cold.document.props.other.positionMm, undoRedo: true, coldArchiveExact: true, errors }, null, 2))
})

test('ordinary wall attachment tools reject a doorway overlap and keep a lamp on its wall face through thickness edits and cold reopen', async ({ page }, info) => {
  test.setTimeout(240000)
  // The legal image-backed lamp starts unattached. Its root lies on the
  // wall-facing physical edge, so the UI's zero normal offset is real contact.
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture({ image: true, building: true }), scene = source.project.document
    scene.title = '墙灯真实接触与竖向范围 UI 自检'; scene.units.display = 'm'
    scene.rooms.room.purpose = '公开挂灯房间'
    delete scene.props.other; delete scene.entityLayers.other
    const lamp = scene.props.item, definition = scene.propDefinitions.definition
    Object.assign(lamp, { positionMm: { x: 5000, y: 4500 }, rotationDeg: 0, footprintMm: { width: 400, height: 200 }, footprintOffsetMm: { x: 0, y: 100 },
      visualBoundsMm: { x: -200, y: 0, width: 400, height: 200 }, blocksMovement: false, visibility: 'public', supportRef: { kind: 'floor', id: 'blank-floor' } })
    Object.assign(definition, { name: '壁灯', defaultVisualBoundsMm: lamp.visualBoundsMm, defaultFootprintMm: lamp.footprintMm,
      defaultFootprintOffsetMm: lamp.footprintOffsetMm, defaultBlocksMovement: false })
    // A public, non-secret door makes the refused along-wall interval explicit.
    scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
      offsetMm: 3000, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    scene.entityLayers.door = scene.entityLayers['wall-0']
    Object.assign(source.project, createCompositionContent(scene, runtime))
    archive = await exportProject(source, validation)
  } finally { await vite.close() }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'wall-lamp-attachment.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await keyboardWorkspaceSaved(page)
  const imported = await keyboardProjectBackup(page, info.outputPath('wall-lamp-imported.sceneweave'))
  expect(imported.document.walls['wall-0'].thicknessMm).toBe(200)
  expect(imported.document.openings.door).toMatchObject({ secret: false, state: 'open', locked: false })
  await selectStructure(page, 'wall-0')
  const tools = page.locator('[data-attachment-tools]')
  await open(tools)
  await tools.getByRole('combobox', { name: '挂接墙侧', exact: true }).selectOption('left')
  await number(page, '挂接区起距', '0'); await number(page, '挂接区终距', '7')
  await number(page, '挂接区底高', '0'); await number(page, '挂接区顶高', '3')
  await tools.getByRole('button', { name: '预览建立挂接面', exact: true }).click(); await adopt(page)
  const withSurface = await keyboardProjectBackup(page, info.outputPath('wall-lamp-surface.sceneweave'))
  const surface = Object.values(withSurface.document.attachmentSurfaces!).find(row => row.owner.kind === 'wall')!
  expect(surface).toMatchObject({ owner: { kind: 'wall', id: 'wall-0' }, capabilities: ['hang'],
    feature: { kind: 'wallSide', referenceVertexId: 'vertex-0', side: 'left', startMm: 0, endMm: 7000, lowMm: 0, highMm: 3000 } })
  await selectKeyboardProp(page, 'item'); await open(tools)
  await tools.getByRole('combobox', { name: '物件附着表面', exact: true }).selectOption(surface.id)
  await number(page, '沿墙挂点距离', '3.5')
  await number(page, '挂点高度', '1.8'); await number(page, '物件竖向高度', '0.4')
  await tools.getByRole('combobox', { name: '宿主变化', exact: true }).selectOption('follow')
  await tools.getByRole('button', { name: '预览附着', exact: true }).click()
  const rejection = page.locator('.asset-notice[role="alert"]')
  await expect(rejection).toContainText('悬挂接触范围与门窗开口相交')
  await expect(review(page)).toHaveCount(0)
  expect((await keyboardProjectBackup(page, info.outputPath('wall-lamp-door-refused.sceneweave'))).hashes).toEqual(withSurface.hashes)
  await page.screenshot({ path: info.outputPath('wall-lamp-door-refusal.png') })
  await number(page, '沿墙挂点距离', '2')
  await tools.getByRole('button', { name: '预览附着', exact: true }).click()
  await expect(review(page).getByLabel('关联对象', { exact: true })).toContainText('壁灯')
  await adopt(page)
  const attached = await keyboardProjectBackup(page, info.outputPath('wall-lamp-attached.sceneweave'))
  const relation = Object.values(attached.document.attachments!)[0]
  expect(relation).toMatchObject({ mode: 'hang', child: { kind: 'prop', id: 'item' }, follow: 'follow', anchorState: 'manual', surfaceId: surface.id,
    anchor: { kind: 'vertical', referenceVertexId: 'vertex-0', alongMm: 2000, heightMm: 1800, heightExtentMm: 400, normalOffsetMm: 0 },
    materialized: { contactElevationMm: 1800 } })
  expect(attached.document.props.item).toMatchObject({ positionMm: { x: 5000, y: 3100 }, rotationDeg: 0, footprintOffsetMm: { x: 0, y: 100 } })
  expect(attached.document.props.item.supportRef).toEqual(imported.document.props.item.supportRef)
  await selectStructure(page, 'wall-0')
  await number(page, '编辑墙厚', '40')
  await page.getByRole('button', { name: '预览墙厚修改', exact: true }).click()
  await expect(review(page).getByLabel('关联对象', { exact: true })).toContainText('壁灯')
  await adopt(page)
  const moved = await keyboardProjectBackup(page, info.outputPath('wall-lamp-followed.sceneweave'))
  expect(moved.document.walls['wall-0'].thicknessMm).toBe(400)
  expect(moved.document.props.item).toMatchObject({ positionMm: { x: 5000, y: 3200 }, rotationDeg: 0 })
  expect(moved.document.attachments![relation.id]).toMatchObject({ anchor: relation.anchor, proofs: relation.proofs, materialized: { contactElevationMm: 1800 } })
  expect(moved.document.openings.door).toEqual(attached.document.openings.door)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('wall-lamp-undone.sceneweave'))
  expect(undone.document.walls['wall-0'].thicknessMm).toBe(200)
  expect(undone.document.props.item).toEqual(attached.document.props.item)
  expect(undone.document.attachments![relation.id]).toEqual(attached.document.attachments![relation.id])
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('wall-lamp-redone.sceneweave'))
  expect(redone.document.props.item).toEqual(moved.document.props.item)
  expect(redone.document.attachments![relation.id]).toEqual(moved.document.attachments![relation.id])
  await coldOpen(page, redone.document.sceneId)
  const cold = await keyboardProjectBackup(page, info.outputPath('wall-lamp-cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  expect(cold.document.attachments![relation.id]).toEqual(moved.document.attachments![relation.id])
  await selectKeyboardProp(page, 'item'); await open(tools)
  await expect(tools).toContainText('已挂接 · 跟随宿主')
  await page.screenshot({ path: info.outputPath('wall-lamp-cold.png') })
  expect(errors).toEqual([])
  await writeFile(info.outputPath('wall-lamp-result.json'), JSON.stringify({ formalAcceptance: false, ordinaryProductionUI: true, surfaceId: surface.id, relationId: relation.id,
    rootSupportPreserved: true, doorwayOverlapRejected: true, archivePreservedOnRefusal: true, contactHeightMm: 1800, heightExtentMm: 400,
    wallThicknessMm: 400, followedPositionMm: cold.document.props.item.positionMm, undoRedo: true, coldArchiveExact: true, errors }, null, 2))
})
