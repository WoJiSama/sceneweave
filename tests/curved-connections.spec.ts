import { openTerrainTask } from './workspace-navigation-helpers'
import { openDetailsBySummary, reloadSaved } from './workspace-ux-helpers'
import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { TerrainConnection } from '../src/shared/model/scene.js'

const workbench = (page: Page) => page.getByTestId('outdoor-workbench')
async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
}
async function blank5(page: Page, title: string) {
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await saved(page)
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  for (const version of [3, 4]) {
    await page.getByRole('button', { name: '保存独立地形副本', exact: true }).click()
    await expect(workbench(page)).toHaveAttribute('data-native-format', `sceneweave-complete-project@${version}`, { timeout: 90000 }); await saved(page)
  }
  await page.getByRole('button', { name: '保存独立曲线连接副本', exact: true }).click()
  await expect(workbench(page)).toHaveAttribute('data-native-format', 'sceneweave-complete-project@5', { timeout: 90000 }); await saved(page)
}
async function adopt(page: Page, kind: '室外' | '视觉') {
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: `采用${kind}修改`, exact: true }).click(); await saved(page)
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/editor/main/Workbench.tsx', h = '/src/shared/project/validate.ts', b = '/src/application/workspace/project.ts'
    const { nativeWorkspace } = await import(p), { projectContentHash } = await import(h), { toBundle } = await import(b)
    const project = nativeWorkspace.getState().project!
    return { document: structuredClone(project.document), hash: projectContentHash(toBundle(project).project), checkpoint: nativeWorkspace.checkpoint() }
  })
}

test('actual UI upgrades a preserved copy, edits a routed stair with canvas handles and cold-reopens its complete geometry', async ({ page }, info) => {
  test.setTimeout(300000)
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message))
  await blank5(page, '曲线连接UI')
  await openTerrainTask(page, '绘制地形')
  const tools = page.getByRole('region', { name: '室外制作工具', exact: true })
  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('terrain')
  await openDetailsBySummary(tools, /^精确坐标 · 区域轮廓$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill('7300,1000\n12500,1000\n12500,9000\n7300,9000')
  await tools.getByLabel('地形高程', { exact: true }).fill('1.2')
  await tools.getByLabel('地形高程', { exact: true }).press('Tab')
  await openDetailsBySummary(tools, /^重叠地形的显示顺序$/)
  await tools.getByLabel('地形覆盖优先级', { exact: true }).fill('1')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  const high = Object.keys((await state(page)).document.terrainAreas)[0]
  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('connection')
  await openDetailsBySummary(tools, /^路线形态与踏面$/)
  await tools.getByLabel('连接路线形态', { exact: true }).selectOption('polyline')
  await openDetailsBySummary(tools, /^精确坐标 · 连接路线节点$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill('2000,3000\n5000,3000\n5000,7000\n10500,7000')
  await tools.getByLabel('连接终点表面', { exact: true }).selectOption(`terrainArea:${high}`)
  await tools.getByLabel('室外通路净宽', { exact: true }).fill('0.9')
  await tools.getByLabel('室外通路净宽', { exact: true }).press('Tab')
  await tools.getByLabel('连接踏面风格', { exact: true }).selectOption('wood')
  const before = await state(page)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消室外预览', exact: true })).toBeVisible({ timeout: 90000 })
  expect((await state(page)).hash).toBe(before.hash)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  const polyline = await state(page), id = Object.keys(polyline.document.terrainConnections)[0]
  expect(polyline.document.terrainConnections[id].route).toMatchObject({ kind: 'polyline', stairStyle: 'wood' })
  await openDetailsBySummary(tools, /^室外对象 · /)
  await tools.getByTitle(id, { exact: true }).click()
  const inspector = page.getByRole('region', { name: '室外对象属性', exact: true })
  await openDetailsBySummary(inspector, /^路线形态与踏面$/)
  await inspector.getByLabel('连接路线形态', { exact: true }).selectOption('cubic')
  await inspector.getByRole('button', { name: '从路线节点生成曲线控制点', exact: true }).click()
  await inspector.getByLabel('在画布编辑连接控制点', { exact: true }).check()
  const controls = await inspector.getByLabel('连接曲线控制点', { exact: true }).inputValue()
  const handle = page.getByTestId('curve-handle-0-control1'); await expect(handle).toBeVisible()
  const rect = (await handle.boundingBox())!
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 + 8, { steps: 5 }); await page.mouse.up()
  await expect(inspector.getByLabel('连接曲线控制点', { exact: true })).not.toHaveValue(controls)
  expect((await state(page)).hash).toBe(polyline.hash)
  await inspector.getByLabel('连接踏面风格', { exact: true }).selectOption('naturalRock')
  await inspector.getByRole('button', { name: '预览对象修改', exact: true }).click(); await adopt(page, '室外')
  const curved = await state(page)
  expect(curved.document.terrainConnections[id].route?.kind).toBe('cubic')
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.terrainConnections[id].route).toEqual(polyline.document.terrainConnections[id].route)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.terrainConnections[id].route).toEqual(curved.document.terrainConnections[id].route)
  await reloadSaved(page); await saved(page)
  await expect(workbench(page)).toHaveAttribute('data-native-format', 'sceneweave-complete-project@5')
  expect((await state(page)).document.terrainConnections[id].route).toEqual(curved.document.terrainConnections[id].route)
  await info.attach('curved-stair-ui.png', { body: await page.screenshot(), contentType: 'image/png' })

  const proof = await page.evaluate(async id => {
    const p = '/src/editor/main/Workbench.tsx', a = '/src/application/workspace/project.ts', r = '/src/platform/browser/runtime.ts', renderer = '/src/platform/browser/render/renderer.ts', h = '/src/shared/validation/hash.ts', f = '/src/shared/project/file.ts', v = '/src/shared/project/validate.ts'
    const { nativeWorkspace } = await import(p), { captureEditableDraft, validateEditableProject, toBundle } = await import(a), { validation, projectRepository } = await import(r), { renderProject } = await import(renderer), { sha256Bytes } = await import(h), { exportProject, importProject } = await import(f), { projectContentHash } = await import(v)
    const current = nativeWorkspace.getState().project!, styles = []
    for (const style of ['stone', 'wood', 'naturalRock']) {
      const draft = captureEditableDraft(current); draft.document.terrainConnections[id].route.stairStyle = style
      const project = await validateEditableProject(draft, validation), canvas = await renderProject(toBundle(project), { audience: 'gm', longEdgePx: 1400 })
      const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      styles.push({ style, width: canvas.width, height: canvas.height, pixelHash: sha256Bytes(new Uint8Array(rgba.buffer)), png: canvas.toDataURL('image/png').split(',')[1] })
    }
    const bundle = toBundle(current), bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation), cold = await projectRepository.load(current.document.sceneId)
    if (projectContentHash(bundle.project) !== projectContentHash(round.project) || projectContentHash(cold!.project) !== projectContentHash(bundle.project)) throw new Error('Actual routed package/cold save mismatch')
    const output = []
    for (const audience of ['gm', 'player']) { const canvas = await renderProject(bundle, { audience, longEdgePx: 4096 }); output.push({ audience, width: canvas.width, height: canvas.height, png: canvas.toDataURL('image/png').split(',')[1] }) }
    const privateHashes = [], privateImages = []
    for (const offset of [0, 200]) {
      const draft = captureEditableDraft(current), connection = draft.document.terrainConnections[id]
      connection.visibility = 'gm'; connection.route.segments[0].control1.y += offset
      const routePath = '/src/shared/geometry/connection-route.ts', { sampleConnectionRoute } = await import(routePath)
      connection.route.centerlineMm = sampleConnectionRoute(connection.route)
      const maskId = 'private-route-mask'
      draft.document.regions[maskId] = { id: maskId, floorId: connection.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', boundaryMm: [{ x: 800, y: 1500 }, { x: 11800, y: 1500 }, { x: 11800, y: 8800 }, { x: 800, y: 8800 }], blocksMovement: false, movementCostMultiplier: 1 }
      draft.document.entityLayers[maskId] = draft.document.entityLayers[id]
      const project = await validateEditableProject(draft, validation), canvas = await renderProject(toBundle(project), { audience: 'player', longEdgePx: 1400 })
      const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      privateHashes.push(sha256Bytes(new Uint8Array(rgba.buffer))); privateImages.push(canvas.toDataURL('image/png').split(',')[1])
    }
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return { route: current.document.terrainConnections[id].route, hash: projectContentHash(bundle.project), styles, output, privateHashes, privateImages, package: btoa(binary) }
  }, id)
  expect(new Set(proof.styles.map(row => row.pixelHash)).size).toBe(3)
  expect(proof.privateHashes[0]).toBe(proof.privateHashes[1])
  for (const row of proof.styles) await writeFile(`work/curved-connections-20261031/stair-${row.style}.png`, Buffer.from(row.png, 'base64'))
  for (const row of proof.output) { expect(row.width).toBe(4096); await writeFile(info.outputPath(`${row.audience}-4k.png`), Buffer.from(row.png, 'base64')) }
  await writeFile(info.outputPath('curved.sceneweave'), Buffer.from(proof.package, 'base64'))
  for (const [index, png] of proof.privateImages.entries()) await writeFile(info.outputPath(`private-player-${index}.png`), Buffer.from(png, 'base64'))
  await writeFile(info.outputPath('proof.json'), JSON.stringify({ ...proof, package: undefined, privateImages: undefined, styles: proof.styles.map(({ png, ...row }) => row), output: proof.output.map(({ png, ...row }) => row) }, null, 2))
  expect(pageErrors).toEqual([])
})

test('ordinary fence component bends and stretches through one preview while world detail spacing and source identities persist', async ({ page }, info) => {
  test.setTimeout(180000)
  await blank5(page, '程序组件变形UI')
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  const visual = page.getByRole('region', { name: '视觉场景创作', exact: true })
  await visual.getByLabel('视觉曲线绑定', { exact: true }).selectOption('decoration')
  await visual.getByRole('button', { name: '建立曲线草稿', exact: true }).click()
  await visual.getByLabel('视觉边带样式', { exact: true }).selectOption('fence')
  await visual.getByLabel('视觉细节间隔 mm', { exact: true }).fill('350')
  await visual.getByRole('button', { name: '预览曲线与边带', exact: true }).click(); await adopt(page, '视觉')
  const before = await state(page), base = before.document.visual!.version === 3 ? before.document.visual!.base.base : null
  const boundaryId = Object.keys(base!.boundaries)[0], edgeId = Object.keys(base!.edgeLooks)[0]
  await visual.getByLabel('视觉已有曲线', { exact: true }).selectOption(boundaryId)
  await visual.getByText('组件弯曲与局部拉伸', { exact: true }).click()
  await visual.getByLabel('视觉组件弯曲量 mm', { exact: true }).fill('250')
  await visual.getByRole('button', { name: '弯曲组件草稿', exact: true }).click()
  await visual.getByLabel('视觉组件拉伸倍数', { exact: true }).fill('1.1')
  await visual.getByRole('button', { name: '拉伸组件草稿', exact: true }).click()
  expect((await state(page)).hash).toBe(before.hash)
  await visual.getByRole('button', { name: '预览曲线与边带', exact: true }).click(); await adopt(page, '视觉')
  const after = await state(page), current = after.document.visual!.version === 3 ? after.document.visual!.base.base : null
  expect(current!.boundaries[boundaryId].segments.map((segment: { id: string }) => segment.id)).toEqual(base!.boundaries[boundaryId].segments.map((segment: { id: string }) => segment.id))
  expect(current!.boundaries[boundaryId].segments).not.toEqual(base!.boundaries[boundaryId].segments)
  expect(current!.edgeLooks[edgeId]).toEqual(base!.edgeLooks[edgeId])
  expect(after.document.paths).toEqual(before.document.paths); expect(after.document.terrainAreas).toEqual(before.document.terrainAreas)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.visual).toEqual(before.document.visual)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.visual).toEqual(after.document.visual)
  await reloadSaved(page); await saved(page)
  expect((await state(page)).document.visual).toEqual(after.document.visual)
  await info.attach('fence-deformation-ui.png', { body: await page.screenshot(), contentType: 'image/png' })
})

test('actual UI creates a U switchback with opposite runs and traversal follows its real crossing', async ({ page }, info) => {
  test.setTimeout(180000)
  await blank5(page, 'U形回折楼梯UI')
  await openTerrainTask(page, '绘制地形')
  const tools = page.getByRole('region', { name: '室外制作工具', exact: true })
  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('terrain')
  await openDetailsBySummary(tools, /^精确坐标 · 区域轮廓$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill('1000,5000\n13000,5000\n13000,9000\n1000,9000')
  await tools.getByLabel('地形高程', { exact: true }).fill('1.2')
  await tools.getByLabel('地形高程', { exact: true }).press('Tab')
  await openDetailsBySummary(tools, /^重叠地形的显示顺序$/)
  await tools.getByLabel('地形覆盖优先级', { exact: true }).fill('1')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  const high = Object.keys((await state(page)).document.terrainAreas)[0]
  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('connection')
  await openDetailsBySummary(tools, /^路线形态与踏面$/)
  await tools.getByLabel('连接路线形态', { exact: true }).selectOption('polyline')
  await openDetailsBySummary(tools, /^精确坐标 · 连接路线节点$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill('10000,2000\n4000,2000\n4000,7000\n10000,7000')
  await tools.getByLabel('连接终点表面', { exact: true }).selectOption(`terrainArea:${high}`)
  await tools.getByLabel('室外通路净宽', { exact: true }).fill('0.9')
  await tools.getByLabel('室外通路净宽', { exact: true }).press('Tab')
  await tools.getByLabel('连接踏面风格', { exact: true }).selectOption('stone')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  const proof = await page.evaluate(async () => {
    const p = '/src/editor/main/Workbench.tsx', t = '/src/shared/geometry/terrain-travel.ts', r = '/src/platform/browser/render/renderer.ts', a = '/src/application/workspace/project.ts'
    const { nativeWorkspace } = await import(p), { checkTerrainRoute, checkTerrainTravel } = await import(t), { renderProject } = await import(r), { toBundle } = await import(a)
    const project = nativeWorkspace.getState().project!, connection = (Object.values(project.document.terrainConnections) as TerrainConnection[])[0]
    if (!connection?.route) throw new Error('The saved U switchback must contain its complete route.')
    const points = [connection.from.positionMm, ...connection.route.segments.map((segment: { end: { x: number; y: number } }) => segment.end)]
    const request = { floorId: connection.floorId, pointsMm: points, widthMm: 800 }
    const travel = checkTerrainRoute(project.document, request), chord = checkTerrainTravel(project.document, { floorId: connection.floorId, from: points[0], to: points.at(-1)!, widthMm: 800 })
    const canvas = await renderProject(toBundle(project), { audience: 'gm', longEdgePx: 1400 })
    return { route: connection.route, travel, chord, png: canvas.toDataURL('image/png').split(',')[1] }
  })
  expect(proof.travel.ok, JSON.stringify(proof.travel.issues)).toBe(true)
  expect(proof.travel.lengthMm).toBe(17000)
  expect(proof.chord.ok).toBe(false)
  await writeFile('work/curved-connections-20261031/stair-switchback.png', Buffer.from(proof.png, 'base64'))
  await writeFile(info.outputPath('switchback-proof.json'), JSON.stringify({ ...proof, png: undefined }, null, 2))
})
