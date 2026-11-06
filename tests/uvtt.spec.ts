import { openVttExport } from './workspace-ux-helpers'
import { expect, test, type Download, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { inspectImageBytes } from '../src/shared/project/image-bytes'
import type { Workspace } from '../src/application/workspace/workspace'

const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const values: string[] = []; errors.set(page, values); page.on('pageerror', error => values.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function state(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/application/workspace/project.ts', h = '/src/shared/project/validate.ts'
    const { toBundle } = await import(p) as typeof import('../src/application/workspace/project')
    const { projectContentHash } = await import(h) as typeof import('../src/shared/project/validate')
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }
    const value = workspace.getState(), project = value.project
    if (!project) throw new Error('Expected an active complete project.')
    return { document: structuredClone(project.document), contentHash: projectContentHash(toBundle(project).project),
      checkpoint: workspace.checkpoint(), canUndo: value.canUndo, canRedo: value.canRedo }
  })
}
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 40_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 40_000 })
}
async function number(page: Page, name: string, value: number) {
  const field = page.getByLabel(name, { exact: true }); await field.fill(String(value)); await field.press('Tab')
}
async function createBlank(page: Page) {
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('VTT 导出实际像素自检')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18')
  await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
}
async function adopt(page: Page, kind: '结构' | '视觉' = '结构') {
  await page.getByLabel('确认完整影响范围', { exact: true }).check()
  await page.getByRole('button', { name: `采用${kind}修改`, exact: true }).click(); await settled(page)
}
async function createRoom(page: Page) {
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  await page.getByLabel('房间名称', { exact: true }).fill('公开测试房间')
  for (const [label, value] of [['房间起点 X', 2000], ['房间起点 Y', 2000], ['房间宽度', 6000], ['房间高度', 4000]] as const) await number(page, label, value / 1000)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  return Object.keys((await state(page)).document.rooms)[0]
}
async function selectWall(page: Page, roomId: string, wallId: string) {
  const room = page.locator(`[data-building-room-id="${roomId}"]`)
  if (!await room.evaluate(element => (element as HTMLDetailsElement).open)) await room.locator('summary').click()
  await room.locator(`[data-building-wall-id="${wallId}"]`).click()
}
async function downloaded(download: Download) {
  const file = await download.path(); expect(file).not.toBeNull()
  return new Uint8Array(await readFile(file!))
}
function pngChunks(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks: string[] = []
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset); chunks.push(strFromU8(bytes.subarray(offset + 4, offset + 8))); offset += length + 12
  }
  return chunks
}
function archive(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  expect(Object.keys(files).sort()).toEqual(['README.txt', 'map.png', 'mapping-report.json', 'scene.dd2vtt'])
  return { files, data: JSON.parse(strFromU8(files['scene.dd2vtt'])), report: JSON.parse(strFromU8(files['mapping-report.json'])),
    readme: strFromU8(files['README.txt']), png: files['map.png'] }
}

test('VTT UI exports the actual player raster, proportional native walls/portals/lights and a full downgrade report without changing the project', async ({ page }, info) => {
  test.setTimeout(180_000)
  await createBlank(page)
  const roomId = await createRoom(page), document = (await state(page)).document
  const wall = Object.values(document.walls).find(row => document.vertices[row.startVertexId].yMm === 2000 && document.vertices[row.endVertexId].yMm === 2000)!
  await selectWall(page, roomId, wall.id)
  await number(page, '开口近端偏移', 0.5); await number(page, '开口净宽', 0.9)
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
  await number(page, '开口近端偏移', 3)
  await page.getByLabel('秘密开口', { exact: true }).check()
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '灯光', exact: true }).click()
  await number(page, '视觉灯光 X mm', 5000); await number(page, '视觉灯光 Y mm', 4000)
  await number(page, '视觉灯光半径 mm', 2500)
  await page.getByRole('button', { name: '预览灯光', exact: true }).click(); await adopt(page, '视觉')
  const before = await state(page)

  await openVttExport(page)
  const dialog = page.getByRole('dialog', { name: 'VTT 导出预检', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '下载 VTT 导入包', exact: true })).toBeDisabled()
  const expectedWarnings = await page.evaluate(async () => {
    const p = '/src/shared/export/uvtt.ts', { buildUvttPlan } = await import(p) as typeof import('../src/shared/export/uvtt')
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }, project = workspace.getState().project!
    return buildUvttPlan(project.document, project.appearance).report.warnings
  })
  expect(await dialog.locator('li').allTextContents()).toEqual(expectedWarnings)
  await dialog.getByLabel('我已了解上述降级和导入后的检查事项', { exact: true }).check()
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载 VTT 导入包', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('sceneweave-vtt.zip')
  const output = archive(await downloaded(download)), image = inspectImageBytes(output.png)
  expect(image.mimeType).toBe('image/png'); expect(image.width).toBe(output.report.image.widthPx); expect(image.height).toBe(output.report.image.heightPx)
  expect(output.data.image).toBe(Buffer.from(output.png).toString('base64'))
  const resolution = output.data.resolution
  expect(resolution.pixels_per_grid).toBeGreaterThan(0)
  expect(resolution.map_size.x * resolution.pixels_per_grid).toBe(image.width)
  expect(resolution.map_size.y * resolution.pixels_per_grid).toBe(image.height)
  expect(resolution.map_origin).toEqual({ x: 0, y: 0 })
  expect(output.report.units.distancePerGrid).toBeGreaterThan(0)
  expect(['m', 'ft']).toContain(output.report.units.distanceUnit)
  expect(output.data.portals).toHaveLength(1); expect(output.data.lights).toHaveLength(1)
  expect(output.data.portals[0].closed).toBe(true)
  expect(output.data.line_of_sight.length).toBeGreaterThan(0)
  expect(JSON.stringify(output.data)).not.toContain('公开测试房间')
  for (const id of Object.keys(before.document.openings)) expect(strFromU8(output.files['scene.dd2vtt'])).not.toContain(id)
  for (const chunk of ['tEXt', 'zTXt', 'iTXt', 'eXIf']) expect(pngChunks(output.png)).not.toContain(chunk)
  expect(output.report.blocked).toEqual([]); expect(output.report.warnings).toEqual(expectedWarnings)
  expect(output.readme).toContain('map.png'); expect(output.readme).toContain('scene.dd2vtt')

  // Export a separate counterfactual copy: neither a door state nor static
  // point lights may be baked again into the raster consumed by native VTT entities.
  // The pinned importer's `closed` field classifies a door versus a window;
  // opening.state is a reported degradation that must be corrected in Foundry.
  const withoutBaking = await page.evaluate(async () => {
    const e = '/src/platform/browser/export/uvtt.ts', p = '/src/application/workspace/project.ts', v = '/src/shared/visual/base.ts'
    const { exportUvtt } = await import(e) as typeof import('../src/platform/browser/export/uvtt')
    const { toBundle } = await import(p) as typeof import('../src/application/workspace/project')
    const { visualBase } = await import(v) as typeof import('../src/shared/visual/base')
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }, bundle = toBundle(workspace.getState().project!)
    const project = structuredClone(bundle.project), lights = visualBase(project.document)
    if (lights) lights.lights = {}
    for (const opening of Object.values(project.document.openings)) if (!opening.secret) opening.state = 'open'
    return [...new Uint8Array(await (await exportUvtt({ project, resources: bundle.resources })).arrayBuffer())]
  })
  const counterfactual = archive(new Uint8Array(withoutBaking))
  expect(counterfactual.data.lights).toEqual([]); expect(counterfactual.data.portals[0].closed).toBe(true)
  expect(counterfactual.png).toEqual(output.png)
  expect(await state(page)).toEqual(before)
  await info.attach('uvtt-ui.png', { body: await dialog.screenshot(), contentType: 'image/png' })
  await info.attach('uvtt-mapping-report.json', { body: Buffer.from(output.files['mapping-report.json']), contentType: 'application/json' })
  await info.attach('uvtt-map.png', { body: Buffer.from(output.png), contentType: 'image/png' })
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).toHaveCount(0); expect(await state(page)).toEqual(before)
})

for (const protection of ['mask', 'gm-room'] as const) test(`VTT preflight blocks ${protection} structure export and offers a real masked player PNG fallback`, async ({ page }) => {
  test.setTimeout(120_000)
  await createBlank(page); const roomId = await createRoom(page)
  // The fixture is a real atomic workspace edit; preflight and download use UI.
  await page.evaluate(async ({ roomId, protection }) => {
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }, scene = workspace.getDocument()!, room = scene.rooms[roomId]
    await workspace.execute([
      { type: 'upsertManualMask', id: 'vtt-fixed-mask', floorId: room.floorId, layerId: scene.entityLayers[roomId], boundsMm: { x: 1000, y: 1000, width: 8000, height: 6000 } },
      ...(protection === 'gm-room' ? [{ type: 'updateRoom' as const, id: roomId, changes: { visibility: 'gm' as const, purpose: 'private-room-must-not-leak' } }] : []),
    ])
    await workspace.flush()
  }, { roomId, protection })
  await settled(page); const before = await state(page)
  await openVttExport(page)
  const dialog = page.getByRole('dialog', { name: 'VTT 导出预检', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('此场景不能安全导出结构包')
  await expect(dialog.getByRole('button', { name: '下载 VTT 导入包', exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('我已了解上述降级和导入后的检查事项', { exact: true })).toHaveCount(0)
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载玩家 PNG 回退', exact: true }).click()
  const download = await downloadEvent, bytes = await downloaded(download), image = inspectImageBytes(bytes)
  expect(download.suggestedFilename()).toBe('sceneweave-player-map.png')
  expect(Math.max(image.width, image.height)).toBe(4096)
  for (const chunk of ['tEXt', 'zTXt', 'iTXt', 'eXIf']) expect(pngChunks(bytes)).not.toContain(chunk)
  const covered = await page.evaluate(async data => {
    const bytes = Uint8Array.from(atob(data), value => value.charCodeAt(0)), bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    const at = (x: number, y: number) => [...context.getImageData(Math.round(canvas.width * x / 18000), Math.round(canvas.height * y / 12000), 1, 1).data]
    return { center: at(5000, 4000), nearCorner: at(1500, 1500) }
  }, Buffer.from(bytes).toString('base64'))
  expect(covered.center).toEqual([216, 213, 197, 255]); expect(covered.nearCorner).toEqual(covered.center)
  expect(await state(page)).toEqual(before)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  expect(await state(page)).toEqual(before)
})

test('browser VTT export rejects missing real bytes and cancellation while preserving the active project and undo state', async ({ page }) => {
  test.setTimeout(120_000)
  await createBlank(page); const before = await state(page)
  const failures = await page.evaluate(async () => {
    const e = '/src/platform/browser/export/uvtt.ts', p = '/src/application/workspace/project.ts'
    const { exportUvtt } = await import(e) as typeof import('../src/platform/browser/export/uvtt')
    const { toBundle } = await import(p) as typeof import('../src/application/workspace/project')
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }, bundle = toBundle(workspace.getState().project!)
    let missing = '', cancelled = '', reads = 0
    try { await exportUvtt({ project: bundle.project, resources: { read: async () => { reads++; throw new Error('vtt-test-missing-resource-bytes') } } }) }
    catch (error) { missing = (error as Error).message }
    const controller = new AbortController(); controller.abort()
    try { await exportUvtt(bundle, controller.signal) }
    catch (error) { cancelled = (error as Error).name }
    return { missing, cancelled, reads }
  })
  expect(failures.reads).toBeGreaterThan(0)
  expect(failures.missing).toContain('vtt-test-missing-resource-bytes')
  expect(failures.cancelled).toBe('AbortError')
  expect(await state(page)).toEqual(before)
})

test('VTT crop keeps integer-grid padding empty and maps a nonzero origin without rendering beyond the source crop', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createBlank(page); await createRoom(page)
  const before = await state(page), sourceBounds = { x: 2500, y: 2300, width: 10000, height: 7000 }
  const bytes = await page.evaluate(async sourceBounds => {
    const e = '/src/platform/browser/export/uvtt.ts', p = '/src/application/workspace/project.ts'
    const { exportUvtt } = await import(e) as typeof import('../src/platform/browser/export/uvtt')
    const { toBundle } = await import(p) as typeof import('../src/application/workspace/project')
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }, bundle = toBundle(workspace.getState().project!)
    const project = structuredClone(bundle.project)
    project.document.exportBoundsMm = sourceBounds
    return [...new Uint8Array(await (await exportUvtt({ project, resources: bundle.resources })).arrayBuffer())]
  }, sourceBounds)
  const output = archive(new Uint8Array(bytes)), image = inspectImageBytes(output.png)
  const padding = output.report.paddedBoundsMm, grid = output.report.units.gridSizeMm, resolution = output.data.resolution
  expect(output.report.sourceBoundsMm).toEqual(sourceBounds)
  expect(padding.x).toBeLessThan(sourceBounds.x); expect(padding.y).toBeLessThan(sourceBounds.y)
  expect(resolution.map_origin).toEqual({ x: padding.x / grid, y: padding.y / grid })
  expect(resolution.map_origin).not.toEqual({ x: 0, y: 0 })
  expect(image.width).toBe(resolution.map_size.x * resolution.pixels_per_grid)
  expect(image.height).toBe(resolution.map_size.y * resolution.pixels_per_grid)
  expect(image.width).toBe(output.report.image.widthPx); expect(image.height).toBe(output.report.image.heightPx)
  expect(output.data.line_of_sight.length).toBeGreaterThan(0)
  for (const line of output.data.line_of_sight as { x: number; y: number }[][]) for (const point of line) {
    expect(point.x * grid).toBeGreaterThanOrEqual(sourceBounds.x)
    expect(point.x * grid).toBeLessThanOrEqual(sourceBounds.x + sourceBounds.width)
    expect(point.y * grid).toBeGreaterThanOrEqual(sourceBounds.y)
    expect(point.y * grid).toBeLessThanOrEqual(sourceBounds.y + sourceBounds.height)
  }
  const pixels = await page.evaluate(async ({ png, padding }) => {
    const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0)), bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    const at = (x: number, y: number) => [...context.getImageData(Math.round((x - padding.x) * canvas.width / padding.width), Math.round((y - padding.y) * canvas.height / padding.height), 1, 1).data]
    return { outsideSource: at(2250, 4000), insideSource: at(3000, 4000) }
  }, { png: Buffer.from(output.png).toString('base64'), padding })
  expect(pixels.outsideSource).toEqual([216, 213, 197, 255])
  expect(pixels.insideSource).not.toEqual(pixels.outsideSource)
  expect(await state(page)).toEqual(before)
  await info.attach('uvtt-crop-map.png', { body: Buffer.from(output.png), contentType: 'image/png' })
  await info.attach('uvtt-crop-report.json', { body: Buffer.from(output.files['mapping-report.json']), contentType: 'application/json' })
})
