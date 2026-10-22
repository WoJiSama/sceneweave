import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { BoundsMm, PointMm, PropV2, SceneDocumentV2 } from '../src/core/v2/types'
import type { PerformanceFixtureSummaryV2 } from '../src/editor/v2/performance-fixtures'

const ids = { a: 'c1b-chair-a', b: 'c1b-chair-b', c: 'c1b-chair-c', lower: 'c1b-overlap-lower', upper: 'c1b-overlap-upper', locked: 'c1b-locked', private: 'c1b-private' }
type Sample = 'study' | 'island'
type Count = 500 | 2000
type Fixture = { bytes: Buffer; summary: PerformanceFixtureSummaryV2 }
const smallFixtures = new Map<boolean, Buffer>(), loadFixtures = new Map<string, Fixture>()

async function state(page: Page): Promise<{ document: SceneDocumentV2; hashes: string[]; licenseHashes: string[]; status: string; canUndo: boolean; canRedo: boolean }> {
  return page.evaluate(() => {
    const value = Reflect.get(window, '__sceneweaveAssetsDev').workspace.getState()
    return { document: structuredClone(value.project.document), hashes: Object.keys(value.project.assets).sort(),
      licenseHashes: Object.keys(value.project.licenses).sort(), status: value.status, canUndo: value.canUndo, canRedo: value.canRedo }
  })
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveAssetsDev')
    const project = await repository.load(workspace.getState().project.document.sceneId)
    const counts: Record<string, number> = {}
    for (const table of ['scenes', 'snapshots', 'resourceBindings', 'assetBlobs', 'licenseTexts']) counts[table] = await repository.db.table(table).count()
    return { document: structuredClone(project.document), hashes: Object.keys(project.assets).sort(), licenseHashes: Object.keys(project.licenses).sort(), counts }
  })
}

async function ready(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await settle(page)
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
async function revision(page: Page, value: number) {
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', String(value))
}
async function selected(page: Page): Promise<string[]> {
  const value = await page.getByLabel('地图视口', { exact: true }).getAttribute('data-selected-ids')
  if (value === null) throw new Error('The product viewport did not expose its temporary selection.')
  return JSON.parse(value)
}
async function expectSelection(page: Page, values: string[]) {
  await expect.poll(async () => (await selected(page)).sort()).toEqual([...values].sort())
}
async function view(page: Page) {
  return page.getByLabel('地图视口', { exact: true }).evaluate(node => ({
    zoom: Number(node.getAttribute('data-zoom')), panX: Number(node.getAttribute('data-pan-x')),
    panY: Number(node.getAttribute('data-pan-y')), renderCount: Number(node.getAttribute('data-render-count')),
  }))
}
async function number(page: Page, name: string, value: number) {
  const input = page.getByRole('spinbutton', { name, exact: true })
  await input.fill(String(value)); await input.press('Tab')
}
async function evidence(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}

// Fixtures use the complete public factory and package importer. No React state or
// selection implementation is called to perform the interactions under test.
async function smallFixture(page: Page, guarded: boolean): Promise<Buffer> {
  const cached = smallFixtures.get(guarded)
  if (cached) return cached
  const bytes = await page.evaluate(async ({ guarded, ids }) => {
    const factoryPath = '/src/editor/v2/blank-project.ts', ioPath = '/src/io/v2/project-file.ts'
    const { createBlankProjectV2, createPlacedPropV2 } = await import(factoryPath)
    const { exportProjectV2 } = await import(ioPath)
    const project = await createBlankProjectV2({ title: 'C1b 选择与事务夹具', widthMm: 14000, heightMm: 10000, preset: 'investigation', sceneId: guarded ? 'c1b-guarded-fixture' : 'c1b-selection-fixture', now: '2026-10-21T00:00:00.000Z' })
    const document = structuredClone(project.document)
    const definition = document.propDefinitions['b2-p-03']
    if (!definition) throw new Error('The C1b fixture requires the adopted b2-p-03 chair.')
    for (const [id, x, y, rotationDeg] of [
      [ids.a, 3500, 3500, 0], [ids.b, 5500, 3500, 45], [ids.c, 7500, 3500, 0],
      [ids.lower, 9000, 6500, 0], [ids.upper, 9000, 6500, 0], [ids.locked, 11000, 3500, 0], [ids.private, 11000, 6500, 0],
    ] as [string, number, number, number][]) {
      document.props[id] = createPlacedPropV2(document, definition.id, { x, y }, { id, rotationDeg })
    }
    document.props[ids.locked].editLocked = true
    document.props[ids.private].visibility = 'gm'
    document.regions['c1b-private-mask'] = { id: 'c1b-private-mask', floorId: document.props[ids.private].floorId, editLocked: false,
      kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1,
      boundaryMm: [{ x: 10000, y: 5500 }, { x: 12500, y: 5500 }, { x: 12500, y: 8000 }, { x: 10000, y: 8000 }] }
    if (guarded) document.notes['c1b-anchor'] = { id: 'c1b-anchor', floorId: document.props[ids.b].floorId, editLocked: false,
      anchor: { type: 'entity', entityKind: 'prop', entityId: ids.b }, kind: 'note', text: 'C1b anchored deletion guard', visibility: 'gm' }
    return [...new Uint8Array(await (await exportProjectV2({ ...project, document })).arrayBuffer())]
  }, { guarded, ids })
  const result = Buffer.from(bytes); smallFixtures.set(guarded, result); return result
}
async function importFixture(page: Page, bytes: Buffer, name: string) {
  await page.getByLabel('选择完整素材工程', { exact: true }).setInputFiles({ name, mimeType: 'application/x-sceneweave', buffer: bytes })
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await ready(page); await revision(page, 0)
}
async function openSmall(page: Page, guarded = false) {
  await page.goto('/#assets'); await importFixture(page, await smallFixture(page, guarded), 'c1b-selection.sceneweave')
  return (await state(page)).document
}
async function openStudy(page: Page) {
  await page.goto('/#assets'); await page.locator('.asset-study-card').click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await ready(page)
  return (await state(page)).document
}

function corners(prop: PropV2): PointMm[] {
  const b = prop.visualBoundsMm, angle = prop.rotationDeg * Math.PI / 180
  return [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].map(([x, y]) => ({
    x: prop.positionMm.x + x * Math.cos(angle) - y * Math.sin(angle), y: prop.positionMm.y + x * Math.sin(angle) + y * Math.cos(angle),
  }))
}
function enclosing(props: PropV2[], padding = 80): BoundsMm {
  const points = props.flatMap(corners), left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y))
  return { x: left - padding, y: top - padding, width: Math.max(...points.map(p => p.x)) - left + padding * 2, height: Math.max(...points.map(p => p.y)) - top + padding * 2 }
}
async function screen(page: Page, point: PointMm, audience: 'gm' | 'player' = 'gm') {
  const box = await page.getByLabel(audience === 'gm' ? '材质场景主持人预览' : '材质场景玩家预览', { exact: true }).boundingBox()
  if (!box) throw new Error('No actual rendered map for pointer input.')
  const bounds = (await state(page)).document.exportBoundsMm
  return { x: box.x + (point.x - bounds.x) / bounds.width * box.width, y: box.y + (point.y - bounds.y) / bounds.height * box.height }
}
async function clickWorld(page: Page, point: PointMm, options: { button?: 'left' | 'right'; modifier?: 'Shift' | 'Alt'; audience?: 'gm' | 'player' } = {}) {
  const at = await screen(page, point, options.audience)
  if (options.modifier) await page.keyboard.down(options.modifier)
  try { await page.mouse.click(at.x, at.y, { button: options.button ?? 'left' }) }
  finally { if (options.modifier) await page.keyboard.up(options.modifier) }
}
async function dragBounds(page: Page, bounds: BoundsMm, options: { modifier?: 'Shift' | 'Alt'; reverse?: boolean } = {}) {
  let from = await screen(page, { x: bounds.x, y: bounds.y }), to = await screen(page, { x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  if (options.reverse) [from, to] = [to, from]
  if (options.modifier) await page.keyboard.down(options.modifier)
  try { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up() }
  finally { if (options.modifier) await page.keyboard.up(options.modifier) }
  await settle(page)
}
async function selectPair(page: Page, scene: SceneDocumentV2) {
  await page.getByRole('button', { name: '替换选择', exact: true }).click()
  await page.getByRole('checkbox', { name: '包含相交对象', exact: true }).uncheck()
  await dragBounds(page, enclosing([scene.props[ids.a], scene.props[ids.b]])); await expectSelection(page, [ids.a, ids.b])
  await expect(page.getByRole('heading', { name: '多选属性', exact: true })).toBeVisible()
}
async function adopt(page: Page, nextRevision: number) {
  await page.getByRole('button', { name: '采用批量修改', exact: true }).click(); await revision(page, nextRevision); await ready(page)
}

test('C1b real marquee uses transformed image geometry, explicit intersection and replacement/addition/subtraction', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const scene = await openSmall(page), before = await state(page), persisted = await stored(page), initial = await view(page)
  const zoomMatrix: { zoom: number; selected: string[]; renderCount: number }[] = []
  for (const target of [.25, 1, 8]) {
    await page.getByRole('button', { name: '适应全图', exact: true }).click(); await settle(page)
    const viewport = page.getByLabel('地图视口', { exact: true }), frame = await viewport.boundingBox()
    if (!frame) throw new Error('No viewport for the zoom selection matrix.')
    const chair = await screen(page, scene.props[ids.a].positionMm), center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
    await page.mouse.move(chair.x, chair.y); await page.mouse.down({ button: 'middle' })
    await page.mouse.move(center.x, center.y, { steps: 8 }); await page.mouse.up({ button: 'middle' }); await settle(page)
    await viewport.focus()
    for (let step = 0; step < (target === .25 ? 7 : target === 8 ? 10 : 0); step++) await viewport.press(target === .25 ? '-' : '+')
    await expect.poll(async () => (await view(page)).zoom).toBe(target); await settle(page)
    const box = enclosing([scene.props[ids.a]], target === .25 ? 300 : 80)
    const from = await screen(page, box), to = await screen(page, { x: box.x + box.width, y: box.y + box.height })
    expect(from.x).toBeGreaterThan(frame.x); expect(from.y).toBeGreaterThan(frame.y)
    expect(to.x).toBeLessThan(frame.x + frame.width); expect(to.y).toBeLessThan(frame.y + frame.height)
    await dragBounds(page, box); await expectSelection(page, [ids.a])
    expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
    expect((await view(page)).renderCount).toBe(initial.renderCount)
    zoomMatrix.push({ zoom: target, selected: await selected(page), renderCount: (await view(page)).renderCount })
    await page.getByRole('button', { name: '返回工程信息', exact: true }).click(); await expectSelection(page, [])
  }
  await page.getByRole('button', { name: '适应全图', exact: true }).click(); await settle(page)
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  await page.getByLabel('地图视口', { exact: true }).focus(); await page.keyboard.press('ArrowRight'); await settle(page)
  expect((await view(page)).zoom).toBeGreaterThan(1); expect((await view(page)).panX).not.toBe(0)
  await selectPair(page, scene)
  await testInfo.attach('c1b-transformed-multiselect.png', { body: await page.screenshot(), contentType: 'image/png' })
  const b = scene.props[ids.b], inner = { x: b.positionMm.x - 200, y: b.positionMm.y - 200, width: 400, height: 400 }
  await dragBounds(page, inner); await expectSelection(page, [])
  await page.getByRole('checkbox', { name: '包含相交对象', exact: true }).check()
  await dragBounds(page, inner, { reverse: true }); await expectSelection(page, [ids.b])
  // This corner lies inside the rotated chair's AABB but outside its actual diamond.
  const envelope = enclosing([b], 0)
  await dragBounds(page, { x: envelope.x + 20, y: envelope.y + 20, width: 120, height: 120 }); await expectSelection(page, [])
  await selectPair(page, scene)
  await clickWorld(page, scene.props[ids.c].positionMm, { modifier: 'Shift' }); await expectSelection(page, [ids.a, ids.b, ids.c])
  await clickWorld(page, b.positionMm, { modifier: 'Alt' }); await expectSelection(page, [ids.a, ids.c])
  await page.getByRole('button', { name: '增加选择', exact: true }).click()
  await dragBounds(page, enclosing([b])); await expectSelection(page, [ids.a, ids.b, ids.c])
  await page.getByRole('button', { name: '减去选择', exact: true }).click()
  await dragBounds(page, enclosing([scene.props[ids.a]]), { reverse: true }); await expectSelection(page, [ids.b, ids.c])
  await page.getByRole('button', { name: '替换选择', exact: true }).click()
  await dragBounds(page, enclosing([scene.props[ids.c]])); await expectSelection(page, [ids.c])
  expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  expect((await view(page)).renderCount).toBe(initial.renderCount)
  await evidence(testInfo, 'c1b-transformed-selection.json', { selected: await selected(page), zoomMatrix, initialView: initial, finalView: await view(page), documentUnchanged: true, storageUnchanged: true })
})

test('C1b Escape, focus loss and lost capture cancel marquee while pan remains independent of selection', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const scene = await openSmall(page), viewport = page.getByLabel('地图视口', { exact: true })
  await clickWorld(page, scene.props[ids.a].positionMm); await expectSelection(page, [ids.a])
  const before = await state(page), persisted = await stored(page), bounds = enclosing([scene.props[ids.b], scene.props[ids.c]])
  const start = async () => {
    const from = await screen(page, bounds), to = await screen(page, { x: bounds.x + bounds.width, y: bounds.y + bounds.height })
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 })
    await expect(page.getByTestId('selection-marquee')).toBeVisible()
  }
  await start(); await page.keyboard.press('Escape'); await settle(page); await page.mouse.up()
  await expect(page.getByTestId('selection-marquee')).toHaveCount(0); await expectSelection(page, [ids.a])
  await clickWorld(page, scene.props[ids.b].positionMm); await expectSelection(page, [ids.b])
  await clickWorld(page, scene.props[ids.a].positionMm); await expectSelection(page, [ids.a])
  await start(); await page.getByRole('spinbutton', { name: '物件 X', exact: true }).focus(); await page.mouse.up()
  await expect(page.getByTestId('selection-marquee')).toHaveCount(0); await expectSelection(page, [ids.a])
  await viewport.evaluate(node => node.addEventListener('pointerdown', event => node.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId)), { once: true }))
  await start()
  await viewport.evaluate(node => node.releasePointerCapture(Number(node.getAttribute('data-test-pointer'))))
  await page.mouse.up(); await expect(page.getByTestId('selection-marquee')).toHaveCount(0); await expectSelection(page, [ids.a])
  const initialView = await view(page), center = await screen(page, { x: 6500, y: 5000 })
  await page.mouse.move(center.x, center.y); await page.mouse.down({ button: 'middle' }); await page.mouse.move(center.x + 50, center.y + 30, { steps: 5 }); await page.mouse.up({ button: 'middle' }); await settle(page)
  expect((await view(page)).panX).not.toBe(initialView.panX); await expectSelection(page, [ids.a])
  await viewport.focus(); await page.keyboard.down('Space'); await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x - 40, center.y - 20, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Space')
  await expectSelection(page, [ids.a]); expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  await evidence(testInfo, 'c1b-cancel-selection.json', { escape: true, focusLoss: true, captureLoss: true, middleAndSpacePan: true, documentAndHistoryUnchanged: true })
})

test('C1b batch move, rotation, copy and delete preview atomically and retain monotonic undo/redo', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const scene = await openSmall(page); await selectPair(page, scene)
  const before = await state(page), persisted = await stored(page)
  await number(page, '批量位移 X', 400); await number(page, '批量位移 Y', 300)
  await page.getByRole('button', { name: '预览批量移动', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用批量修改', exact: true })).toBeVisible()
  expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  await page.getByRole('button', { name: '取消批量预览', exact: true }).click(); await ready(page)
  expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  await page.getByRole('button', { name: '预览批量移动', exact: true }).click(); await adopt(page, 1)
  const moved = (await state(page)).document
  for (const id of [ids.a, ids.b]) expect(moved.props[id].positionMm).toEqual({ x: scene.props[id].positionMm.x + 400, y: scene.props[id].positionMm.y + 300 })
  for (const id of Object.keys(scene.props).filter(id => id !== ids.a && id !== ids.b)) expect(moved.props[id]).toEqual(scene.props[id])
  const range = enclosing([moved.props[ids.a], moved.props[ids.b]], 0), center = { x: range.x + range.width / 2, y: range.y + range.height / 2 }
  await number(page, '批量旋转', 90); await page.getByRole('button', { name: '预览批量旋转', exact: true }).click(); await adopt(page, 2)
  const rotated = (await state(page)).document
  for (const id of [ids.a, ids.b]) {
    const p = moved.props[id].positionMm
    expect(rotated.props[id].positionMm).toEqual({ x: Math.round(center.x - (p.y - center.y)), y: Math.round(center.y + (p.x - center.x)) })
    expect(rotated.props[id].rotationDeg).toBe(moved.props[id].rotationDeg + 90)
  }
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await revision(page, 3); await ready(page)
  expect((await state(page)).document.props).toEqual(moved.props)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await revision(page, 4); await ready(page)
  expect((await state(page)).document.props).toEqual(rotated.props)
  const preCopy = await state(page), preCopyStored = await stored(page)
  await page.getByRole('button', { name: '预览复制所选', exact: true }).click()
  expect(await state(page)).toEqual(preCopy); await page.getByRole('button', { name: '取消批量预览', exact: true }).click(); await ready(page)
  expect(await stored(page)).toEqual(preCopyStored)
  await page.getByRole('button', { name: '预览复制所选', exact: true }).click(); await adopt(page, 5)
  const copied = (await state(page)).document, newIds = Object.keys(copied.props).filter(id => !scene.props[id])
  expect(newIds).toHaveLength(2)
  for (const id of [ids.a, ids.b]) {
    expect(copied.props[id]).toEqual(rotated.props[id])
    const copies = newIds.map(id => copied.props[id]).filter(p => p.positionMm.x === rotated.props[id].positionMm.x + 300 && p.positionMm.y === rotated.props[id].positionMm.y + 300)
    expect(copies).toHaveLength(1); expect(copies[0].definitionRef).toEqual(rotated.props[id].definitionRef); expect(copies[0].rotationDeg).toBe(rotated.props[id].rotationDeg)
  }
  const copiedA = newIds.map(id => copied.props[id]).find(prop => prop.positionMm.y === rotated.props[ids.a].positionMm.y + 300)!
  const copiedB = newIds.map(id => copied.props[id]).find(prop => prop.positionMm.y === rotated.props[ids.b].positionMm.y + 300)!
  expect(Math.sign(copiedB.renderOrder - copiedA.renderOrder)).toBe(Math.sign(rotated.props[ids.b].renderOrder - rotated.props[ids.a].renderOrder))
  await page.getByRole('button', { name: '预览删除所选', exact: true }).click()
  expect((await state(page)).document).toEqual(copied)
  await page.getByRole('button', { name: '取消批量预览', exact: true }).click(); await ready(page)
  await page.getByRole('button', { name: '预览删除所选', exact: true }).click(); await adopt(page, 6)
  const removed = (await state(page)).document
  expect(removed.props[ids.a]).toBeUndefined(); expect(removed.props[ids.b]).toBeUndefined()
  for (const id of newIds) expect(removed.props[id]).toEqual(copied.props[id])
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await revision(page, 7); await ready(page)
  expect((await state(page)).document.props).toEqual(copied.props)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await revision(page, 8); await ready(page)
  expect((await state(page)).document.props).toEqual(removed.props)
  expect((await stored(page)).document).toEqual((await state(page)).document)
  await evidence(testInfo, 'c1b-atomic-batches.json', { revisions: [0, 1, 2, 3, 4, 5, 6, 7, 8], createdIds: newIds, previewCancelledWithoutHistory: true, finalDocument: (await state(page)).document })
})

test('C1b a later invalid target rejects the whole batch and lock state excludes marquee but permits explicit inspection', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const scene = await openSmall(page, true); await selectPair(page, scene)
  // Establish action order explicitly: the unguarded object is visited before
  // the anchored target, so this also catches a partially applied deletion.
  await clickWorld(page, scene.props[ids.a].positionMm); await clickWorld(page, scene.props[ids.b].positionMm, { modifier: 'Shift' })
  expect(await selected(page)).toEqual([ids.a, ids.b])
  const before = await state(page), persisted = await stored(page)
  await page.getByRole('button', { name: '预览删除所选', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('整批未采用')
  await expect(page.getByRole('button', { name: '采用批量修改', exact: true })).toHaveCount(0)
  expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  await number(page, '批量位移 X', 9000); await page.getByRole('button', { name: '预览批量移动', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('整批未采用')
  expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  await page.getByRole('button', { name: '锁定所选', exact: true }).click(); await revision(page, 1); await ready(page)
  const locked = (await state(page)).document
  expect(locked.props[ids.a].editLocked).toBe(true); expect(locked.props[ids.b].editLocked).toBe(true)
  await expect(page.getByRole('button', { name: '预览批量移动', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '预览删除所选', exact: true })).toBeDisabled()
  await dragBounds(page, enclosing([scene.props[ids.a], scene.props[ids.b]])); await expectSelection(page, [])
  await expect(page.locator('.asset-selection-notice')).toContainText('排除锁定 2 个')
  await clickWorld(page, scene.props[ids.a].positionMm); await clickWorld(page, scene.props[ids.b].positionMm, { modifier: 'Shift' })
  await expectSelection(page, [ids.a, ids.b])
  await page.getByRole('button', { name: '解锁所选', exact: true }).click(); await revision(page, 2); await ready(page)
  const unlocked = (await state(page)).document
  expect(unlocked.props[ids.a]).toEqual(scene.props[ids.a]); expect(unlocked.props[ids.b]).toEqual(scene.props[ids.b])
  expect(unlocked.props[ids.locked]).toEqual(scene.props[ids.locked]); expect(unlocked.notes).toEqual(scene.notes)
  await evidence(testInfo, 'c1b-rejection-and-locks.json', { guardedTarget: ids.b, rejectedDeletionAndOutOfBoundsMove: true, atomicLockRevision: 1, atomicUnlockRevision: 2, unrelatedLockRetained: true })
})

test('C1b context menu retains selection, disambiguates overlaps and places at its captured blank world point', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const scene = await openSmall(page); await selectPair(page, scene)
  const before = await state(page), persisted = await stored(page), menu = page.getByRole('menu', { name: '场景操作', exact: true })
  await clickWorld(page, scene.props[ids.a].positionMm, { button: 'right' })
  await expect(menu).toContainText('已选 2 个对象'); await expectSelection(page, [ids.a, ids.b])
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(page.getByLabel('地图视口', { exact: true })).toBeFocused()
  await clickWorld(page, scene.props[ids.c].positionMm, { button: 'right' })
  await expect(menu).toContainText('已选 1 个对象'); await expectSelection(page, [ids.c])
  await menu.getByRole('menuitem', { name: '复制所选', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用批量修改', exact: true })).toBeVisible(); expect(await state(page)).toEqual(before)
  await page.getByRole('button', { name: '取消批量预览', exact: true }).click(); await ready(page)
  await clickWorld(page, scene.props[ids.upper].positionMm, { button: 'right' }); await expectSelection(page, [ids.upper])
  await expect(menu.locator(`[data-entity-id="${ids.upper}"]`)).toBeVisible()
  await testInfo.attach('c1b-overlapping-context-menu.png', { body: await page.screenshot(), contentType: 'image/png' })
  await menu.locator(`[data-entity-id="${ids.lower}"]`).click(); await expectSelection(page, [ids.lower])
  await selectPair(page, scene)
  const blank = { x: 5500, y: 7000 }, at = await screen(page, blank)
  // Chromium quantizes contextmenu client coordinates. Observe the real trusted
  // event rather than assuming the requested fractional mouse coordinates survive.
  await page.evaluate(bounds => {
    const node = document.querySelector('.asset-viewport')!
    node.addEventListener('contextmenu', event => {
      const pointer = event as MouseEvent, canvas = node.querySelector('canvas')!.getBoundingClientRect()
      Reflect.set(window, '__c1bObservedContextPoint', {
        x: Math.round(bounds.x + (pointer.clientX - canvas.x) / canvas.width * bounds.width),
        y: Math.round(bounds.y + (pointer.clientY - canvas.y) / canvas.height * bounds.height), trusted: pointer.isTrusted,
      })
    }, { once: true, capture: true })
  }, scene.exportBoundsMm)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  const observedPoint = await page.evaluate(() => Reflect.get(window, '__c1bObservedContextPoint') as PointMm & { trusted: boolean })
  expect(observedPoint.trusted).toBe(true)
  const expectedPoint = { x: observedPoint.x, y: observedPoint.y }
  await expect(menu).toContainText('此处空白'); await expectSelection(page, [ids.a, ids.b])
  expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  await menu.getByLabel('右键放置素材', { exact: true }).selectOption('b2-p-03')
  await menu.getByRole('menuitem', { name: '在此预览放置', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '放置 X', exact: true })).toHaveValue(String(expectedPoint.x))
  await expect(page.getByRole('spinbutton', { name: '放置 Y', exact: true })).toHaveValue(String(expectedPoint.y))
  await expect(page.getByRole('button', { name: '在此放置', exact: true })).toBeEnabled()
  expect(await state(page)).toEqual(before)
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await revision(page, 1); await ready(page)
  const after = (await state(page)).document, newIds = Object.keys(after.props).filter(id => !scene.props[id])
  expect(newIds).toHaveLength(1); expect(after.props[newIds[0]].positionMm).toEqual(expectedPoint)
  for (const id of Object.keys(scene.props)) expect(after.props[id]).toEqual(scene.props[id])
  await evidence(testInfo, 'c1b-context-selection.json', { overlapTop: ids.upper, explicitLower: ids.lower, capturedWorldPoint: expectedPoint, createdId: newIds[0], menuDidNotMutateDocument: true })
})

test('C1b keyboard context actions restore focus, keep text controls native and remain unavailable in player view', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const scene = await openSmall(page); await selectPair(page, scene)
  const menu = page.getByRole('menu', { name: '场景操作', exact: true }), viewport = page.getByLabel('地图视口', { exact: true })
  const allEditable = Object.values(scene.props).filter(prop => !prop.editLocked).map(prop => prop.id)
  await viewport.focus(); await viewport.press('ControlOrMeta+A'); await expectSelection(page, allEditable)
  await clickWorld(page, scene.props[ids.a].positionMm)
  await page.getByRole('button', { name: '全选可编辑对象', exact: true }).click(); await expectSelection(page, allEditable)
  const row = (id: string) => page.locator(`.asset-entity-list [data-entity-id="${id}"]`)
  await row(ids.a).click(); await row(ids.b).focus(); await row(ids.b).press('Shift+Enter'); await expectSelection(page, [ids.a, ids.b])
  await row(ids.a).focus(); await row(ids.a).press('Alt+Enter'); await expectSelection(page, [ids.b])
  await row(ids.c).click({ modifiers: ['Shift'] }); await row(ids.b).click({ modifiers: ['Alt'] }); await expectSelection(page, [ids.c])
  await selectPair(page, scene)
  const before = await state(page), persisted = await stored(page), more = page.getByRole('button', { name: '更多操作', exact: true })
  await more.click(); await expect(menu.getByRole('menuitem', { name: '属性 / 编辑', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: '复制所选', exact: true })).toBeFocused()
  await page.keyboard.press('Enter'); await expect(menu).toHaveCount(0)
  await expect(page.getByRole('button', { name: '取消批量预览', exact: true })).toBeVisible(); expect(await state(page)).toEqual(before)
  await page.getByRole('button', { name: '取消批量预览', exact: true }).click(); await ready(page)
  await more.click(); await page.keyboard.press('Escape'); await expect(more).toBeFocused()
  await viewport.focus(); await page.keyboard.press('Shift+F10'); await expect(menu).toBeVisible()
  await page.keyboard.press('End'); await expect(menu.getByRole('menuitem', { name: '适应全图', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp'); await expect(menu.getByRole('menuitem', { name: '清空选择', exact: true })).toBeFocused()
  await page.keyboard.press('Enter'); await expectSelection(page, []); await expect(viewport).toBeFocused()
  await viewport.press('Shift+F10'); await expect(menu).toContainText('此处空白')
  await expect(menu.getByRole('menuitem', { name: '适应全图', exact: true })).toBeFocused()
  await page.keyboard.press('Tab'); await expect(menu.getByLabel('右键放置素材', { exact: true })).toBeFocused()
  await menu.getByLabel('右键放置素材', { exact: true }).selectOption('b2-p-03')
  await page.keyboard.press('Tab'); await expect(menu.getByRole('menuitem', { name: '在此预览放置', exact: true })).toBeFocused()
  await page.keyboard.press('Enter'); await expect(page.getByRole('heading', { name: '放置物件', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '在此放置', exact: true })).toBeEnabled()
  await viewport.focus(); await viewport.press('Escape')
  await expect(page.getByRole('heading', { name: '放置物件', exact: true })).toHaveCount(0)
  expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  await clickWorld(page, scene.props[ids.a].positionMm)
  const input = page.getByRole('spinbutton', { name: '物件 X', exact: true })
  await input.focus(); await page.keyboard.press('Shift+F10'); await expect(menu).toHaveCount(0); await page.keyboard.press('Escape')
  await input.click({ button: 'right' }); await expect(menu).toHaveCount(0); await page.keyboard.press('Escape')
  await clickWorld(page, scene.props[ids.private].positionMm); await expectSelection(page, [ids.private])
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '玩家', exact: true }).click()
  await expect(page.getByLabel('材质场景玩家预览', { exact: true })).toBeVisible(); await expectSelection(page, [])
  await clickWorld(page, scene.props[ids.private].positionMm, { button: 'right', audience: 'player' }); await expect(menu).toHaveCount(0)
  await viewport.focus(); await page.keyboard.press('Shift+F10'); await expect(menu).toHaveCount(0)
  await expect(page.getByRole('button', { name: '替换选择', exact: true })).toHaveCount(0)
  expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
  await evidence(testInfo, 'c1b-keyboard-menu.json', { selectAllToolbarAndShortcut: true, treePointerAndKeyboardModifiers: true, moreButton: true, shiftF10: true, arrowsAndEnter: true, blankMenuTabSelectAndPlacement: true, focusRestored: true, textContextNotIntercepted: true, playerActionsUnavailable: true })
})

test('C1b real sample distinguishes whole groups from members, moves groups once and refuses mixed structural batches', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const scene = await openStudy(page), chair = scene.props['study-chair'], memberMode = page.getByRole('checkbox', { name: '选择组合成员', exact: true }), intersect = page.getByRole('checkbox', { name: '包含相交对象', exact: true })
  await clickWorld(page, chair.positionMm); await expectSelection(page, ['study-group'])
  await dragBounds(page, enclosing([chair], 30)); await expectSelection(page, [])
  await intersect.check(); await dragBounds(page, enclosing([chair], 30)); await expectSelection(page, ['study-group', 'study-room'])
  await memberMode.check(); await intersect.uncheck(); await dragBounds(page, enclosing([chair], 30)); await expectSelection(page, ['study-chair'])
  await clickWorld(page, scene.props['study-books-middle'].positionMm, { modifier: 'Shift' }); await expectSelection(page, ['study-chair', 'study-books-middle'])
  expect(await selected(page)).not.toContain('study-group')
  await memberMode.uncheck(); await clickWorld(page, chair.positionMm)
  const terraceMember = Object.values(scene.prefabInstances['terrace-group'].members).find(member => member.propId?.includes('chair-south'))?.propId
  if (!terraceMember) throw new Error('VIS-01 no longer has its fixed terrace chair member.')
  await clickWorld(page, scene.props[terraceMember].positionMm, { modifier: 'Shift' }); await expectSelection(page, ['study-group', 'terrace-group'])
  await expect(page.getByRole('button', { name: '预览复制所选', exact: true })).toBeDisabled()
  await number(page, '批量位移 X', 100); await number(page, '批量位移 Y', 100)
  await page.getByRole('button', { name: '预览批量移动', exact: true }).click(); await adopt(page, 1)
  const moved = (await state(page)).document, members = new Set<string>()
  for (const id of ['study-group', 'terrace-group']) {
    expect(moved.prefabInstances[id].anchorMm).toEqual({ x: scene.prefabInstances[id].anchorMm.x + 100, y: scene.prefabInstances[id].anchorMm.y + 100 })
    for (const member of Object.values(scene.prefabInstances[id].members)) if (member.propId) {
      members.add(member.propId)
      expect(moved.props[member.propId].positionMm).toEqual({ x: scene.props[member.propId].positionMm.x + 100, y: scene.props[member.propId].positionMm.y + 100 })
    }
  }
  for (const id of Object.keys(scene.props).filter(id => !members.has(id))) expect(moved.props[id]).toEqual(scene.props[id])
  await page.getByRole('button', { name: '锁定所选', exact: true }).click(); await revision(page, 2); await ready(page)
  await dragBounds(page, enclosing([...members].map(id => moved.props[id])))
  expect(await selected(page)).not.toContain('study-group'); expect(await selected(page)).not.toContain('terrace-group')
  await clickWorld(page, moved.props['study-chair'].positionMm); await clickWorld(page, moved.props[terraceMember].positionMm, { modifier: 'Shift' })
  await expectSelection(page, ['study-group', 'terrace-group'])
  await page.getByRole('button', { name: '解锁所选', exact: true }).click(); await revision(page, 3); await ready(page)
  await memberMode.check(); await clickWorld(page, moved.props['study-chair'].positionMm)
  const wall = scene.walls['study-w0'], a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
  await clickWorld(page, { x: (a.xMm + b.xMm) / 2, y: (a.yMm + b.yMm) / 2 }, { modifier: 'Shift' })
  await expectSelection(page, ['study-chair', 'study-w0'])
  await expect(page.getByRole('button', { name: '预览批量移动', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '预览删除所选', exact: true })).toBeDisabled()
  const preMenu = await state(page), preMenuStored = await stored(page)
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  const menu = page.getByRole('menu', { name: '场景操作', exact: true }), disabled = menu.getByRole('menuitem', { name: '删除所选', exact: true })
  await expect(disabled).toBeDisabled(); await expect(disabled).toHaveAttribute('aria-describedby', /menu-reason/)
  await expect(menu).toContainText('结构请使用专用属性工具')
  await page.keyboard.press('Escape'); expect(await state(page)).toEqual(preMenu); expect(await stored(page)).toEqual(preMenuStored)
  await evidence(testInfo, 'c1b-groups-and-structures.json', { movedMemberIds: [...members], groupMoveRevision: 1, groupLockRevision: 2, groupUnlockRevision: 3, mixedSelection: await selected(page), disabledReasonVisible: true })
})

async function loadFixture(page: Page, sample: Sample, count: Count): Promise<Fixture> {
  const key = `${sample}-${count}`, cached = loadFixtures.get(key)
  if (cached) return cached
  const directory = process.env.SCENEWEAVE_B5_FIXTURE_DIR
  let result: Fixture
  if (directory) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    const entry = manifest.cases.find((value: { name: string }) => value.name === key)
    if (!entry) throw new Error(`Missing ${key} in supplied B5 fixture manifest.`)
    result = { bytes: await readFile(path.join(directory, 'fixtures', `${key}.sceneweave`)), summary: entry.summary }
  } else {
    const value = await page.evaluate(async ({ sample, count }) => {
      const fixturePath = '/src/editor/v2/performance-fixtures.ts', ioPath = '/src/io/v2/project-file.ts'
      const { createPerformanceFixtureV2 } = await import(fixturePath), { exportProjectV2 } = await import(ioPath)
      const { project, summary } = await createPerformanceFixtureV2(sample, count)
      return { bytes: [...new Uint8Array(await (await exportProjectV2(project)).arrayBuffer())], summary }
    }, { sample, count })
    result = { bytes: Buffer.from(value.bytes), summary: value.summary }
  }
  loadFixtures.set(key, result); return result
}

for (const sample of ['study', 'island'] as const) {
  test(`C1b ${sample} 2000: virtual object list keeps search, keyboard navigation and explicit location temporary`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto('/#assets'); const fixture = await loadFixture(page, sample, 2000)
    await importFixture(page, fixture.bytes, `${sample}-2000.sceneweave`)
    const before = await state(page), persisted = await stored(page), initialView = await view(page)
    const objectIds = Object.keys(before.document.props), firstId = objectIds[0], secondId = objectIds[1], lastId = objectIds.at(-1)!
    const list = page.getByRole('group', { name: '场景物件列表', exact: true }), rows = list.locator('[data-entity-id]')
    const search = page.getByRole('searchbox', { name: '搜索场景物件', exact: true })
    const locate = page.getByRole('button', { name: '定位所选对象', exact: true })
    const row = (id: string) => list.locator(`[data-entity-id="${id}"]`)
    const mountedCounts: number[] = []
    const bounded = async () => {
      await expect(list).toHaveAttribute('data-total-rows', String(objectIds.length))
      const mounted = await rows.count(); mountedCounts.push(mounted)
      expect(mounted).toBeGreaterThan(0); expect(mounted).toBeLessThanOrEqual(20)
    }
    expect(objectIds).toHaveLength(2000); expect(lastId).toBe(fixture.summary.editablePropId)
    await bounded(); await expect(row(lastId)).toHaveCount(0); await expect(locate).toBeDisabled()
    await expectSelection(page, [])

    // Full-data search can reveal an unmounted row, without treating the match
    // as a selection or changing the complete project and its saved history.
    await search.fill(lastId.toUpperCase()); await expect(rows).toHaveCount(1)
    await expect(row(lastId)).toBeVisible(); await expectSelection(page, [])
    await search.fill('c1b-no-such-object'); await expect(list).toHaveCount(0)
    await expect(page.getByText('没有匹配的物件。可按名称或完整 ID 搜索。', { exact: true })).toBeVisible()
    await expectSelection(page, [])
    await search.press('Escape'); await expect(search).toHaveValue(''); await bounded()

    // The destinations come from the document, while the page step comes from
    // actual rendered dimensions. Navigation must mount/focus, never select.
    await search.press('ArrowDown'); await expect(row(firstId)).toBeFocused()
    const pageStep = await list.evaluate(node => Math.max(1, Math.floor(node.clientHeight / node.querySelector('button')!.getBoundingClientRect().height)))
    await page.keyboard.press('End'); await expect(row(lastId)).toBeFocused(); await bounded()
    await expectSelection(page, [])
    await page.keyboard.press('Home'); await expect(row(firstId)).toBeFocused()
    await page.keyboard.press('PageDown'); await expect(row(objectIds[pageStep])).toBeFocused()
    await page.keyboard.press('PageUp'); await expect(row(firstId)).toBeFocused()
    await page.keyboard.press('ArrowDown'); await expect(row(secondId)).toBeFocused(); await expectSelection(page, [])
    await page.keyboard.press('Enter'); await expectSelection(page, [secondId])
    await page.keyboard.press('Home'); await expect(row(firstId)).toBeFocused(); await expectSelection(page, [secondId])
    await page.keyboard.press('Shift+Enter'); await expectSelection(page, [firstId, secondId])
    await page.keyboard.press('End'); await expect(row(lastId)).toBeFocused()
    await page.keyboard.press('Shift+Space'); await expectSelection(page, [firstId, secondId, lastId])
    await page.keyboard.press('Alt+Space'); await expectSelection(page, [firstId, secondId])
    await page.keyboard.press('Home'); await expect(row(firstId)).toBeFocused()
    await page.keyboard.press('Alt+Enter'); await expectSelection(page, [secondId]); await bounded()

    // Canvas selection leaves the browsing position alone; only the explicit
    // location action scrolls. It can also clear a query excluding the target.
    const browsingTop = await list.evaluate(node => node.scrollTop)
    await clickWorld(page, fixture.summary.selectionPointMm); await expectSelection(page, [lastId])
    expect(await list.evaluate(node => node.scrollTop)).toBe(browsingTop)
    await expect(row(lastId)).toHaveCount(0)
    await locate.click(); await expect(row(lastId)).toBeFocused(); await expect(row(lastId)).toHaveAttribute('aria-pressed', 'true')
    await bounded(); expect(await list.evaluate(node => node.scrollTop)).toBeGreaterThan(browsingTop)
    await search.fill(firstId); await expect(row(lastId)).toHaveCount(0); await expectSelection(page, [lastId])
    await locate.click(); await expect(search).toHaveValue(''); await expect(row(lastId)).toBeFocused()
    await expectSelection(page, [lastId]); await bounded()
    expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
    expect((await view(page)).renderCount).toBe(initialView.renderCount); expect(errors).toEqual([])
    await evidence(testInfo, `c1b-${sample}-2000-object-list.json`, {
      objectCount: objectIds.length, mountedCounts, pageStep, firstId, secondId, lastId,
      searchWithoutSelection: true, navigationWithoutSelection: true, keyboardModifiers: ['Shift+Enter', 'Alt+Enter', 'Shift+Space', 'Alt+Space'],
      canvasSelectionDoesNotAutoScroll: true, explicitLocationClearsExcludingSearch: true, documentAndStorageUnchanged: true,
      scope: 'Real browser search, focus, keyboard and canvas selection regression. Bounded DOM is not complete interaction performance acceptance.',
    })
  })
}

for (const sample of ['study', 'island'] as const) for (const count of [500, 2000] as const) {
  test(`C1b ${sample} ${count}: real broad member marquee preserves the project and refuses an over-budget batch`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto('/#assets'); const fixture = await loadFixture(page, sample, count)
    await importFixture(page, fixture.bytes, `${sample}-${count}.sceneweave`)
    const before = await state(page), persisted = await stored(page), initialView = await view(page), scene = before.document
    await page.getByRole('checkbox', { name: '选择组合成员', exact: true }).check()
    const props = Object.values(scene.props)
    expect(props).toHaveLength(count)
    const unlocked = props.filter(prop => !prop.editLocked && ![...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].some(group => group.editLocked && Object.values(group.members).some(member => member.propId === prop.id)))
    // Derive the expected prop subset from transformed visual corners and parent
    // locks, independently of selection.ts. Structural selections are additional.
    const bounds = scene.exportBoundsMm
    const rectangle = { x: bounds.x + 100, y: bounds.y + 100, width: bounds.width - 200, height: bounds.height - 200 }
    const expectedProps = unlocked.filter(prop => corners(prop).every(p => p.x >= rectangle.x && p.x <= rectangle.x + rectangle.width && p.y >= rectangle.y && p.y <= rectangle.y + rectangle.height)).map(prop => prop.id).sort()
    expect(expectedProps.length).toBeGreaterThan(256)
    const observation = page.evaluate(() => new Promise<{ trustedInputs: number; pointerMoves: number; frameGapMs: number[]; elapsedMs: number; timedOut: boolean }>(resolve => {
      const node = document.querySelector('.asset-viewport')!, frameGapMs: number[] = []
      let started: number | null = null, trustedInputs = 0, pointerMoves = 0, frame = 0, last = 0, finished = false
      const input = (event: Event) => {
        if (event.type === 'pointerdown') { started = performance.now(); frame = requestAnimationFrame(tick) }
        if (started === null) return
        if (event.isTrusted) trustedInputs++
        if (event.type === 'pointermove') pointerMoves++
      }
      const tick = (time: number) => { if (last) frameGapMs.push(time - last); last = time; frame = requestAnimationFrame(tick) }
      const finish = (timedOut: boolean) => {
        if (finished) return
        finished = true; clearTimeout(timer); cancelAnimationFrame(frame)
        node.removeEventListener('pointerdown', input, true); node.removeEventListener('pointermove', input, true); node.removeEventListener('pointerup', stop, true)
        resolve({ trustedInputs, pointerMoves, frameGapMs, elapsedMs: started === null ? 0 : performance.now() - started, timedOut })
      }
      const stop = () => requestAnimationFrame(() => requestAnimationFrame(() => finish(false))), timer = setTimeout(() => finish(true), 20_000)
      node.addEventListener('pointerdown', input, true); node.addEventListener('pointermove', input, true); node.addEventListener('pointerup', stop, true)
    }))
    await settle(page); await dragBounds(page, rectangle)
    const observed = await observation, actual = await selected(page)
    expect(observed.timedOut).toBe(false); expect(observed.trustedInputs).toBeGreaterThan(0); expect(observed.pointerMoves).toBeGreaterThanOrEqual(8)
    expect(actual.filter(id => !!scene.props[id]).sort()).toEqual(expectedProps)
    await expect(page.getByRole('heading', { name: `已选择 ${actual.length} 个对象`, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '预览批量移动', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '预览删除所选', exact: true })).toBeDisabled()
    await expect(page.locator('.asset-inspector')).toContainText('一次事务最多 256 条命令')
    expect(await state(page)).toEqual(before); expect(await stored(page)).toEqual(persisted)
    expect((await view(page)).renderCount).toBe(initialView.renderCount)
    await clickWorld(page, fixture.summary.selectionPointMm); await expectSelection(page, [fixture.summary.editablePropId])
    expect((await view(page)).renderCount).toBe(initialView.renderCount); expect(errors).toEqual([])
    expect(await page.evaluate(() => Reflect.has(window, '__sceneweavePerformance'))).toBe(false)
    await evidence(testInfo, `c1b-${sample}-${count}-selection.json`, {
      fixture: fixture.summary, expectedPropCount: expectedProps.length, actualPropCount: actual.filter(id => !!scene.props[id]).length,
      selectedIds: actual, pointerObservation: observed, baseRenderCount: initialView.renderCount, documentAndStorageUnchanged: true,
      scope: 'Single real pointer marquee and replacement selection. Browser scheduling observations only; no GPU/display latency or complete interaction performance acceptance is claimed.',
    })
  })
}
