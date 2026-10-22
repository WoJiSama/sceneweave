import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { PointMm, SceneDocumentV3 } from '../src/core/v3/types'
import type { WorkspaceV4 } from '../src/editor/v4/workspace'
import type { SceneRepositoryV4 } from '../src/io/v4/storage'

type HistoryDev = { workspace: WorkspaceV4; repository: SceneRepositoryV4 }
async function scene(page: Page): Promise<SceneDocumentV3> {
  return page.evaluate(() => structuredClone((Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev).workspace.getState().project!.document))
}
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true })
  await input.fill(String(value)); await input.press('Tab')
}
async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function blank(page: Page, title: string) {
  await page.goto('/#history'); await expect(page.getByTestId('history-workbench')).toBeVisible()
  await page.getByRole('button', { name: '新建空白场景', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByLabel('画布宽度', { exact: true }).fill('22000')
  await dialog.getByLabel('画布高度', { exact: true }).fill('18000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await expect(page.getByRole('region', { name: '建筑工具', exact: true })).toBeVisible()
  expect(Object.keys((await scene(page)).rooms)).toEqual([])
}
async function adopt(page: Page) {
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认建筑完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认建筑完整影响范围', exact: true })).toHaveCount(0)
  await settled(page)
}
async function room(page: Page, name: string, x: number, y: number, width: number, height: number) {
  await page.getByLabel('房间名称', { exact: true }).fill(name)
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  for (const [label, value] of [['房间起点 X', x], ['房间起点 Y', y], ['房间宽度', width], ['房间高度', height]] as const) await number(page, label, value)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  return Object.values((await scene(page)).rooms).find(room => room.purpose === name)!
}
async function expandRoom(page: Page, name: string) {
  const details = page.locator('.building-entity-list > details').filter({ has: page.getByRole('button', { name, exact: true }) }).first()
  if (await details.getAttribute('open') === null) { const summary = details.locator(':scope > summary'); await summary.focus(); await summary.press('Enter') }
  await expect(details).toHaveAttribute('open', '')
  return details
}
function wallAt(document: SceneDocumentV3, center: PointMm) {
  const walls = Object.values(document.walls).filter(wall => {
    const a = document.vertices[wall.startVertexId], b = document.vertices[wall.endVertexId]
    return (center.x - a.xMm) * (b.yMm - a.yMm) === (center.y - a.yMm) * (b.xMm - a.xMm)
      && center.x >= Math.min(a.xMm, b.xMm) && center.x <= Math.max(a.xMm, b.xMm)
      && center.y >= Math.min(a.yMm, b.yMm) && center.y <= Math.max(a.yMm, b.yMm)
  })
  if (walls.length !== 1) throw new Error(`UI fixture expected one actual wall at ${JSON.stringify(center)}, got ${walls.length}.`)
  return walls[0]
}
async function wall(page: Page, id: string) {
  const current = await scene(page), target = current.walls[id]
  const owner = Object.values(current.rooms).find(room => room.boundaryVertexIds.some((vertex, i, ids) => [vertex, ids[(i + 1) % ids.length]].includes(target.startVertexId) && [vertex, ids[(i + 1) % ids.length]].includes(target.endVertexId)))!
  const details = await expandRoom(page, owner.purpose)
  await details.locator(`[data-building-wall-id="${id}"]`).click()
  await expect(page.getByRole('heading', { name: '墙体', exact: true })).toBeVisible()
}
async function opening(page: Page, id: string) {
  const document = await scene(page), item = document.openings[id]
  await wall(page, item.wallId)
  const wallButton = page.locator(`[data-building-wall-id="${item.wallId}"]`).first()
  await wallButton.locator('..').getByRole('button', { name: `${item.kind === 'door' ? '门' : '窗'} · ${item.widthMm} mm${item.secret ? ' · 秘密' : ''}`, exact: true }).click()
  await expect(page.locator('.building-stable-id')).toHaveText(id)
}
async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: label, exact: true }).click()
  const item = await pending, path = await item.path()
  if (!path) throw new Error(`Download did not yield a path: ${label}.`)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  return { name: item.suggestedFilename(), bytes: await readFile(path) }
}

test('C2 authors SCN-01 seven rooms and twelve openings from blank UI, saves exact geometry and exports both 4K audiences', async ({ page }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await blank(page, 'C2 手工作图 · 雾灯宅')
  const baseline = await scene(page)
  const sourceResources = await page.evaluate(async () => {
    const project = (Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev).workspace.getState().project!
    const assets = Object.fromEntries(await Promise.all(Object.entries(project.assets).map(async ([key, record]) => {
      const actualSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await record.blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
      return [key, { sha256: record.sha256, actualSha256, sizeBytes: record.sizeBytes, mimeType: record.mimeType, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight }]
    })))
    return { assets, licenses: structuredClone(project.licenses), licenseBindings: structuredClone(project.licenseBindings) }
  })
  const inputs = await page.evaluate(async () => {
    const path = '/tests/c2-fixtures.ts', fixture = await import(path)
    return { rooms: fixture.C2_ROOMS, doors: fixture.C2_DOORS, windows: fixture.C2_WINDOWS, floor: fixture.C2_FLOOR_BOUNDS, bounds: fixture.C2_EXPORT_BOUNDS }
  })
  await page.getByText('世界与导出范围', { exact: true }).click()
  for (const [labels, values] of [[['世界起点 X', '世界起点 Y', '世界宽度', '世界高度'], inputs.floor], [['导出起点 X', '导出起点 Y', '导出宽度', '导出高度'], inputs.bounds]] as const)
    for (const [i, key] of (['x', 'y', 'width', 'height'] as const).entries()) await number(page, labels[i], values[key])
  await page.getByRole('button', { name: '预览画布范围', exact: true }).click(); await adopt(page)
  for (const data of inputs.rooms) await room(page, data.purpose, data.x, data.y, data.width, data.height)
  const geometric = await scene(page)
  expect(Object.keys(geometric.rooms)).toHaveLength(7); expect(Object.keys(geometric.walls)).toHaveLength(20); expect(Object.keys(geometric.vertices)).toHaveLength(14)
  const opened: Record<string, string> = {}
  for (const data of [...inputs.doors.map((item: any) => ({ ...item, kind: 'door' })), ...inputs.windows.map((item: any) => ({ ...item, kind: 'window' }))]) {
    const current = await scene(page), attached = wallAt(current, data.center), reference = current.vertices[attached.startVertexId]
    await wall(page, attached.id)
    await page.getByLabel('开口类型', { exact: true }).selectOption(data.kind)
    await page.getByLabel('开口基准端点', { exact: true }).selectOption(attached.startVertexId)
    await number(page, '开口近端偏移', Math.round(Math.hypot(data.center.x - reference.xMm, data.center.y - reference.yMm) - data.width / 2))
    await number(page, '开口净宽', data.width)
    await page.getByRole('checkbox', { name: '秘密开口', exact: true }).setChecked(data.id.endsWith('-HS'))
    await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
    const after = await scene(page), id = Object.keys(after.openings).find(id => !current.openings[id])!
    opened[data.id] = id
  }
  await opening(page, opened['outside-H1'])
  await page.getByRole('checkbox', { name: '设为外部入口', exact: true }).check()
  await page.getByRole('button', { name: '预览入口修改', exact: true }).click(); await adopt(page)
  await page.getByText('固定玩家遮罩', { exact: true }).click()
  for (const [label, value] of [['遮罩 X', 5500], ['遮罩 Y', 12200], ['遮罩宽度', 13000], ['遮罩高度', 2300]] as const) await number(page, label, value)
  await page.getByRole('button', { name: '预览新增遮罩', exact: true }).click(); await adopt(page)
  for (const data of inputs.rooms) {
    await page.locator('.building-entity-list').getByRole('button', { name: data.purpose, exact: true }).click()
    await page.getByLabel('房间连通要求', { exact: true }).selectOption('required')
    if (data.id === 'HS') await page.getByLabel('房间可见性', { exact: true }).selectOption('gm')
    await page.getByRole('button', { name: '预览房间属性', exact: true }).click(); await adopt(page)
  }
  await page.getByText('文字与线索', { exact: true }).click()
  await page.getByLabel('新注记内容', { exact: true }).fill('C2 主持人线索：书架背板留有旧灯线。')
  await page.getByLabel('新注记可见性', { exact: true }).selectOption('gm')
  await number(page, '新注记 X', 15000); await number(page, '新注记 Y', 9200)
  await page.getByRole('button', { name: '预览新增注记', exact: true }).click(); await adopt(page)
  const created = await scene(page)
  expect(created.exportBoundsMm).toEqual(inputs.bounds); expect(created.floors['blank-floor'].boundsMm).toEqual(inputs.floor)
  expect(Object.keys(created.openings)).toHaveLength(12); expect(created.constraints.entranceOpeningIds).toEqual([opened['outside-H1']])
  expect(Object.values(created.rooms).every(room => room.accessExpectation === 'required')).toBe(true)
  expect(Object.values(created.rooms).find(room => room.purpose === '暗廊')!.visibility).toBe('gm')
  expect(created.openings[opened['H5-HS']]).toMatchObject({ secret: true, revealed: false, state: 'closed' })
  expect(created.openings[opened['H6-HS']]).toMatchObject({ secret: true, revealed: false, state: 'closed' })
  const packageDownload = await download(page, '完整工程')
  const imported = await page.evaluate(async bytes => {
    const path = '/src/io/v4/project-file.ts', io = await import(path) as typeof import('../src/io/v4/project-file')
    const project = await io.importProjectV4(new Blob([Uint8Array.from(bytes)]))
    const assets = Object.fromEntries(await Promise.all(Object.entries(project.assets).map(async ([key, record]) => {
      const actualSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await record.blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
      return [key, { sha256: record.sha256, actualSha256, sizeBytes: record.sizeBytes, mimeType: record.mimeType, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight }]
    })))
    return { document: project.document, resources: { assets, licenses: project.licenses, licenseBindings: project.licenseBindings } }
  }, Array.from(packageDownload.bytes))
  expect(imported.document).toEqual(created); expect(imported.resources).toEqual(sourceResources)
  await page.reload(); await settled(page); expect(await scene(page)).toEqual(created)
  const pngs: { audience: string; bytes: number; width: number; height: number }[] = []
  for (const [audience, label] of [['gm', '主持人'], ['player', '玩家']] as const) {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: label, exact: true }).click(); await settled(page)
    const result = await download(page, '4K PNG')
    expect(result.name).toBe(`sceneweave-${audience}-map.png`)
    expect(result.bytes.readUInt32BE(16)).toBe(4096); expect(result.bytes.readUInt32BE(20)).toBe(3234)
    await info.attach(`c2-ui-scn01-${audience}-4k.png`, { body: result.bytes, contentType: 'image/png' })
    pngs.push({ audience, bytes: result.bytes.length, width: result.bytes.readUInt32BE(16), height: result.bytes.readUInt32BE(20) })
  }
  expect(errors).toEqual([])
  await info.attach('c2-ui-scn01-player.png', { body: await page.screenshot(), contentType: 'image/png' })
  await evidence(info, 'c2-ui-scn01-authoring.json', { method: 'Real empty-project UI, numeric room authoring, actual shared-wall list, attached door/window editors, explicit complete-scope adoption, fixed mask and private note, full save/reload/ZIP/4K. Exact actual bitmap hashes/metadata, license texts and subject bindings compare with the blank-project baseline. No document injection. This covers architectural SCN-01, not all specified furnishings or full pathfinding.', baselineRevision: baseline.revision, sourceResources, importedResources: imported.resources, document: created, opened, pngs, errors })
})

test('C2 room previews cancel cleanly, shared thickness is one undoable edit, and entity/layer locks reject changes', async ({ page }, info) => {
  test.setTimeout(150_000)
  await blank(page, 'C2 共墙与锁')
  const left = await room(page, '左室', 2000, 2000, 4000, 4000), before = await scene(page)
  await page.getByLabel('房间名称', { exact: true }).fill('右室')
  await number(page, '房间起点 X', 6000); await number(page, '房间起点 Y', 2000)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click()
  expect(await scene(page)).toEqual(before)
  const scope = page.getByLabel('待采用建筑操作 ID', { exact: true })
  await page.getByText(/实际操作范围 ·/).click(); expect(await scope.inputValue()).toContain(left.id)
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click(); expect(await scene(page)).toEqual(before)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  const two = await scene(page), shared = wallAt(two, { x: 6000, y: 4000 })
  expect(Object.keys(two.walls)).toHaveLength(7); expect(Object.keys(two.vertices)).toHaveLength(6)
  await wall(page, shared.id); await number(page, '编辑墙厚', 150)
  await page.getByRole('button', { name: '预览墙厚修改', exact: true }).click(); expect(await scene(page)).toEqual(two)
  await adopt(page); const thick = await scene(page)
  expect(thick.walls[shared.id].thicknessMm).toBe(150); expect(thick.revision).toBe(two.revision + 1)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await scene(page); expect(undone.walls).toEqual(two.walls); expect(undone.revision).toBe(thick.revision + 1)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  expect((await scene(page)).walls).toEqual(thick.walls)
  await page.locator('.building-entity-list').getByRole('button', { name: '右室', exact: true }).click()
  await page.getByRole('button', { name: '锁定建筑对象', exact: true }).click(); await settled(page)
  await wall(page, shared.id); await expect(page.getByRole('spinbutton', { name: '编辑墙厚', exact: true })).toBeDisabled()
  const locked = await scene(page)
  await page.getByRole('button', { name: '锁定图层 默认图层', exact: true }).click(); await settled(page)
  await expect(page.getByRole('button', { name: '预览新房间', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '在图上画房间', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '解锁图层 默认图层', exact: true }).click(); await settled(page)
  expect(Object.values((await scene(page)).rooms).find(room => room.purpose === '右室')!.editLocked).toBe(true)
  await evidence(info, 'c2-ui-shared-wall-locks.json', { previewAndCancelPreserved: true, before, two, thick, undone, locked, current: await scene(page) })
})

test('C2 pointer rectangles and zoomed ruler use snapped world coordinates and leave measurement out of history', async ({ page }, info) => {
  test.setTimeout(120_000)
  await blank(page, 'C2 绘图与量尺')
  await page.getByRole('button', { name: '在图上画房间', exact: true }).click()
  const image = page.getByLabel('材质场景主持人预览', { exact: true }), box = await image.boundingBox()
  if (!box) throw new Error('No actual canvas for pointer room.')
  const points = [{ x: Math.round(box.x + box.width * .15), y: Math.round(box.y + box.height * .15) }, { x: Math.round(box.x + box.width * .4), y: Math.round(box.y + box.height * .4) }]
  await page.mouse.click(points[0].x, points[0].y); await page.mouse.click(points[1].x, points[1].y)
  const x = Number(await page.getByRole('spinbutton', { name: '房间起点 X', exact: true }).inputValue()), y = Number(await page.getByRole('spinbutton', { name: '房间起点 Y', exact: true }).inputValue())
  const width = Number(await page.getByRole('spinbutton', { name: '房间宽度', exact: true }).inputValue()), height = Number(await page.getByRole('spinbutton', { name: '房间高度', exact: true }).inputValue())
  for (const value of [x, y, width, height]) expect(value % 100).toBe(0)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  const created = await scene(page)
  expect(Object.keys(created.rooms)).toHaveLength(1)
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  const viewport = page.getByLabel('地图视口', { exact: true }); await viewport.focus(); await viewport.press('ArrowRight')
  await page.getByRole('button', { name: '量尺', exact: true }).click()
  const zoomed = await image.boundingBox()
  if (!zoomed) throw new Error('No transformed canvas for ruler.')
  const start = { x: Math.round(zoomed.x + zoomed.width * .35), y: Math.round(zoomed.y + zoomed.height * .35) }
  const end = { x: Math.round(zoomed.x + zoomed.width * .45), y: Math.round(zoomed.y + zoomed.height * .45) }
  const bounds = created.exportBoundsMm, step = created.units.snapMm
  const world = (point: PointMm) => ({ x: Math.round(Math.round(bounds.x + (point.x - zoomed.x) / zoomed.width * bounds.width) / step) * step,
    y: Math.round(Math.round(bounds.y + (point.y - zoomed.y) / zoomed.height * bounds.height) / step) * step })
  const a = world(start), b = world(end), expected = Math.hypot(b.x - a.x, b.y - a.y) / 1000
  await page.mouse.click(start.x, start.y); await page.mouse.click(end.x, end.y)
  await expect(page.getByLabel('量尺结果', { exact: true })).toContainText(`${expected.toFixed(3)} m`)
  expect(await scene(page)).toEqual(created)
  await page.getByRole('button', { name: '取消绘图或量尺', exact: true }).click()
  await expect(page.getByLabel('量尺结果', { exact: true })).toHaveCount(0)
  expect(await scene(page)).toEqual(created)
  await evidence(info, 'c2-ui-pointer-ruler.json', { pointerRectangle: { x, y, width, height }, transformedMeasure: { a, b, expectedM: expected }, revisionUnchangedByRuler: created.revision })
})
