import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { unzipSync, zipSync } from 'fflate'
import { canonicalJson } from '../src/shared/validation/json'
import type { SceneDocument } from '../src/shared/model/scene'
import type { ProjectManifest } from '../src/shared/project/file'
import { applyCompositionCommands } from '../src/shared/appearance/commands'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

type Point = { x: number; y: number }
type Bounds = Point & { width: number; height: number }
const reviewFor = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })

async function outdoorTools(page: Page, task: '地形与高程' | '道路'): Promise<Locator> {
  const resources = await openWorkspaceModule(page, '地形')
  await resources.getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: new RegExp(`^${task}`) }).click()
  const inspector = page.getByTestId('workspace-inspector')
  await expect(inspector).toHaveAttribute('data-open', 'true')
  return inspector.locator('.outdoor-panel.workspace-tool-parameters')
}

async function commitNumber(scope: Locator, label: string, value: string): Promise<void> {
  const input = scope.getByLabel(label, { exact: true })
  await input.fill(value)
  await input.press('Tab')
}

async function adoptOutdoor(page: Page): Promise<void> {
  const review = reviewFor(page)
  await expect(review).toBeVisible()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
}

/** Resolve real pointer coordinates from the rendered map, without an editor test API. */
async function screenPoint(page: Page, world: Point, bounds: Bounds): Promise<Point> {
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  await expect(canvas).toBeVisible()
  const target = await canvas.evaluate((node, { world, bounds }) => {
    const box = node.getBoundingClientRect()
    const x = box.x + (world.x - bounds.x) / bounds.width * box.width
    const y = box.y + (world.y - bounds.y) / bounds.height * box.height
    return { x, y, hitCanvas: document.elementFromPoint(x, y) === node }
  }, { world, bounds })
  expect(target.hitCanvas, `World point ${JSON.stringify(world)} must reach the visible canvas`).toBe(true)
  return { x: target.x, y: target.y }
}

async function readDraftPoints(input: Locator): Promise<Point[]> {
  return (await input.inputValue()).trim().split('\n').filter(Boolean).map(row => {
    const [x, y] = row.split(',').map(Number)
    return { x, y }
  })
}

async function startElevation(page: Page, areaId: string): Promise<Locator> {
  const scene = await openWorkspaceModule(page, '场景')
  const allLayers = scene.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await allLayers.isVisible()) await allLayers.click()
  await scene.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  await scene.getByLabel('搜索场景对象', { exact: true }).fill(areaId)
  await scene.locator(`[data-entity-id="${areaId}"]`).click()
  const resources = await openWorkspaceModule(page, '地形')
  await resources.getByRole('button', { name: '开始整面高程', exact: true }).click()
  const tools = page.getByTestId('workspace-inspector').getByRole('region', { name: '地形高程工具', exact: true })
  await expect(tools).toBeVisible()
  await expect(tools.getByLabel('高程操作范围', { exact: true })).toContainText('已选 1 个地形面')
  return tools
}

test('whole-surface elevation preserves saved material overlays through review, undo and cold reopen', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  await createKeyboardProject(page, '带纯材质覆盖的整面升降')
  const outdoor = await outdoorTools(page, '地形与高程')
  await openDetailsBySummary(outdoor, /^精确坐标 · 区域轮廓$/)
  await outdoor.getByLabel('室外坐标', { exact: true }).fill('3000,3000\n7000,3000\n7000,7000\n3000,7000')
  await outdoor.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await adoptOutdoor(page)
  const sourcePath = info.outputPath('plain.sceneweave')
  const plain = await keyboardProjectBackup(page, sourcePath)
  const archive = unzipSync(new Uint8Array(await readFile(sourcePath)))
  const document = JSON.parse(new TextDecoder().decode(archive['scene.json'])) as SceneDocument
  const area = Object.values(document.terrainAreas)[0]
  const paint = area.surfaceStyle!.base
  expect(document.materials[paint.materialRef.id].applicableSurfaces).toContain('terrain')
  area.surfaceStyle = { base: paint, overlays: [{ id: 'elevation-saved-material-overlay', paint: { ...paint, rotationDeg: 15, opacity: 0.65 },
    boundaryMm: [{ x: 4000, y: 4000 }, { x: 6000, y: 4000 }, { x: 6000, y: 6000 }, { x: 4000, y: 6000 }], blendWidthMm: 300, renderOrder: 0 }] }
  // A complete file fixture enters through ordinary import and resource checks.
  // Construct the fixture through the ordinary complete-model transaction so
  // overlay identity and immutable appearance sources agree with scene paint.
  const painted = applyCompositionCommands({ document: plain.document, historyIdentity: plain.identity, appearance: plain.appearance },
    [{ type: 'updateTerrainArea', id: area.id, changes: { surfaceStyle: area.surfaceStyle } }], {
    ids: { nextId: () => randomUUID() }, clock: { now: () => document.updatedAt },
  })
  archive['scene.json'] = new TextEncoder().encode(canonicalJson(painted.document))
  archive['identity.json'] = new TextEncoder().encode(canonicalJson(painted.historyIdentity))
  archive['appearance.json'] = new TextEncoder().encode(canonicalJson(painted.appearance))
  const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json'])) as ProjectManifest
  for (const path of ['scene.json', 'identity.json', 'appearance.json']) {
    const entry = manifest.entries.find(entry => entry.path === path)!
    entry.sha256 = createHash('sha256').update(archive[path]).digest('hex'); entry.sizeBytes = archive[path].length
  }
  archive['manifest.json'] = new TextEncoder().encode(canonicalJson(manifest))
  const fixturePath = info.outputPath('painted.sceneweave')
  await writeFile(fixturePath, zipSync(archive))
  const context = await browser.newContext()
  try {
    const target = await context.newPage()
    await target.goto(new URL('./#home', page.url()).href)
    const choosing = target.waitForEvent('filechooser')
    await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await choosing).setFiles(fixturePath); await keyboardWorkspaceSaved(target)
    const before = await keyboardProjectBackup(target, info.outputPath('painted-before.sceneweave'))
    expect(before.document.terrainAreas[area.id].surfaceStyle).toEqual(area.surfaceStyle)
    expect(keyboardResourceHashes(before.hashes)).toEqual(keyboardResourceHashes(plain.hashes))
    const tools = await startElevation(target, area.id)
    await commitNumber(tools, '整面目标高程', '0.3')
    await tools.getByRole('button', { name: '预览整面高程', exact: true }).click()
    await adoptOutdoor(target)
    const adopted = await keyboardProjectBackup(target, info.outputPath('painted-raised.sceneweave'))
    expect(adopted.document).toEqual({ ...before.document, revision: before.document.revision + 1, updatedAt: adopted.document.updatedAt,
      terrainAreas: { ...before.document.terrainAreas, [area.id]: { ...before.document.terrainAreas[area.id], groundElevationMm: 300 } } })
    expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))
    await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const undone = await keyboardProjectBackup(target, info.outputPath('painted-undone.sceneweave'))
    expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
    await target.reload(); await target.getByRole('button', { name: '回到首页', exact: true }).click()
    await target.getByTestId('workspace-home').locator(`[data-project-key="native:${before.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(target)
    expect((await keyboardProjectBackup(target, info.outputPath('painted-cold.sceneweave'))).hashes).toEqual(undone.hashes)
  } finally { await context.close() }
})

test('road canvas snaps by default, bypasses assistance while Shift is held and resumes on release', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '道路默认吸附与临时自由取点')
  const tools = await outdoorTools(page, '道路')
  await commitNumber(tools, '室外通路净宽', '1')
  await openDetailsBySummary(tools, /^精确坐标 · 道路中心线$/)
  const coordinates = tools.getByLabel('室外坐标', { exact: true })
  await coordinates.fill('3000,3000\n7000,3000')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await adoptOutdoor(page)
  const before = await keyboardProjectBackup(page, info.outputPath('road-before.sceneweave'))
  expect(Object.keys(before.document.paths)).toHaveLength(1)
  const endpoint = { x: 7000, y: 3000 }
  expect(Object.values(before.document.paths)[0].centerlineMm).toEqual([{ x: 3000, y: 3000 }, endpoint])

  await outdoorTools(page, '道路')
  await openDetailsBySummary(tools, /^精确坐标 · 道路中心线$/)
  await tools.getByRole('button', { name: '在画布逐点绘制', exact: true }).click()
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await expect(page.getByLabel('地图缩放比例', { exact: true })).toHaveText('100%')
  // The offset is within the endpoint capture radius, but beyond the grid's
  // rounding midpoint: ordinary grid snapping alone cannot pass this check.
  const raw = { x: endpoint.x + before.document.units.snapMm * 0.75, y: endpoint.y + before.document.units.snapMm * 0.75 }
  const pointer = await screenPoint(page, raw, before.document.exportBoundsMm)
  await page.mouse.click(pointer.x, pointer.y)
  await expect.poll(() => readDraftPoints(coordinates)).toEqual([endpoint])

  await page.keyboard.down('Shift')
  try {
    await page.mouse.click(pointer.x, pointer.y)
    await expect.poll(async () => (await readDraftPoints(coordinates)).length).toBe(2)
    const free = (await readDraftPoints(coordinates))[1]
    expect(Number.isSafeInteger(free.x) && Number.isSafeInteger(free.y)).toBe(true)
    expect(free).not.toEqual(endpoint)
    expect(free.x % before.document.units.snapMm !== 0 || free.y % before.document.units.snapMm !== 0).toBe(true)
  } finally {
    await page.keyboard.up('Shift')
  }
  await page.mouse.click(pointer.x, pointer.y)
  await expect.poll(async () => (await readDraftPoints(coordinates)).at(-1)).toEqual(endpoint)
  await expect.poll(async () => (await readDraftPoints(coordinates)).length).toBe(3)
  await page.keyboard.down('Shift')
  await expect(page.locator('.asset-viewport-hint')).toContainText('道路自由取点')
  await coordinates.focus()
  await expect(page.getByTestId('road-snap-target')).toHaveCount(0)
  await expect(page.locator('.asset-viewport-hint')).toContainText('道路默认吸附')
  await page.keyboard.up('Shift')
  await page.getByRole('group', { name: '地图视口', exact: true }).focus()
  await page.mouse.click(pointer.x, pointer.y)
  await expect.poll(async () => (await readDraftPoints(coordinates)).length).toBe(4)
  await expect.poll(async () => (await readDraftPoints(coordinates)).at(-1)).toEqual(endpoint)
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
  await expect(reviewFor(page)).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('road-snap-shift-restored.png'), animations: 'disabled' })
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  await viewport.focus()
  await viewport.press('Escape')
  await page.getByRole('button', { name: '取消室外草稿', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('road-cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  await page.locator('.workspace-file-menu > summary').click()
  await page.getByRole('group', { name: '文件操作', exact: true }).getByRole('button', { name: '新建空白场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('道路工具跨工程继续')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  const nextTools = await outdoorTools(page, '道路')
  await nextTools.getByRole('button', { name: '在画布逐点绘制', exact: true }).click()
  await expect(page.locator('.asset-viewport-hint')).toContainText('道路默认吸附')
  await page.getByRole('group', { name: '地图视口', exact: true }).focus()
  await page.keyboard.down('Shift')
  await expect(page.locator('.asset-viewport-hint')).toContainText('道路自由取点')
  await page.keyboard.up('Shift')
  await expect(page.locator('.asset-viewport-hint')).toContainText('道路默认吸附')
  expect(errors).toEqual([])
})

test('whole-surface wheel drafts require preview and adoption, cancel unchanged, undo once and leave normal wheel zoom intact', async ({ page }, info) => {
  test.setTimeout(240000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '整面高程草稿与撤销')
  const outdoor = await outdoorTools(page, '地形与高程')
  await openDetailsBySummary(outdoor, /^精确坐标 · 区域轮廓$/)
  await outdoor.getByLabel('室外坐标', { exact: true }).fill('3000,3000\n7000,3000\n7000,7000\n3000,7000')
  await commitNumber(outdoor, '地形高程', '0')
  await outdoor.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await adoptOutdoor(page)
  const before = await keyboardProjectBackup(page, info.outputPath('elevation-before.sceneweave'))
  expect(Object.keys(before.document.terrainAreas)).toHaveLength(1)
  const area = Object.values(before.document.terrainAreas)[0]
  expect(area.groundElevationMm).toBe(0)
  const revision = page.locator('.workspace-unified')
  const zoom = page.getByLabel('地图缩放比例', { exact: true })
  const review = reviewFor(page)
  const wheel = async (deltaY: number) => {
    const point = await screenPoint(page, { x: 5000, y: 5000 }, before.document.exportBoundsMm)
    await page.mouse.move(point.x, point.y)
    await page.mouse.wheel(0, deltaY)
  }
  const enableWheel = async () => {
    const tools = await startElevation(page, area.id)
    await expect(tools.getByLabel('整面目标高程', { exact: true })).toHaveValue('0')
    await expect(tools.getByLabel('高程升降步长', { exact: true })).toHaveValue('0.1')
    await tools.getByRole('button', { name: '启用整面滚轮升降', exact: true }).click()
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    await expect(zoom).toHaveText('100%')
    return tools
  }

  let tools = await enableWheel()
  const target = tools.getByLabel('整面目标高程', { exact: true })
  await wheel(-120)
  await expect(target).toHaveValue('0.1')
  await wheel(120)
  await expect(target).toHaveValue('0')
  await wheel(-120)
  await expect(target).toHaveValue('0.1')
  await expect(zoom).toHaveText('100%')
  await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
  await expect(review).toHaveCount(0)
  // Wheel outside the explicitly selected surface never changes its draft.
  const outside = await screenPoint(page, { x: 8000, y: 8000 }, before.document.exportBoundsMm)
  await page.mouse.move(outside.x, outside.y)
  await page.mouse.wheel(0, -120)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(target).toHaveValue('0.1')
  await expect(zoom).toHaveText('100%')

  // Browsing another module pauses the canvas tool while retaining its draft.
  await openWorkspaceModule(page, '建筑')
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await wheel(-120)
  await expect(zoom).not.toHaveText('100%')
  await expect(target).toHaveValue('0.1')
  await page.getByRole('button', { name: '返回当前工具与草稿', exact: true }).click()
  await expect(page.getByTestId('workspace-module-navigation').getByRole('button', { name: '地形', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(tools).toBeVisible()
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await wheel(-120)
  await expect(target).toHaveValue('0.2')
  await expect(zoom).toHaveText('100%')

  const library = await openWorkspaceModule(page, '素材与布景')
  await library.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await library.getByRole('button', { name: '查看素材 铜色桌灯', exact: true }).click()
  const catalog = page.getByTestId('workspace-inspector').getByRole('region', { name: '素材详情面板', exact: true })
  await expect(catalog).toBeVisible()
  // Keep catalog details open after returning to the terrain module, so this
  // checks the hidden-inspector guard independently of the module pause above.
  await openWorkspaceModule(page, '地形')
  await expect(catalog).toBeVisible()
  await expect(tools).toBeHidden()
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await wheel(-120)
  await expect(zoom).not.toHaveText('100%')
  await catalog.getByRole('button', { name: '返回当前任务', exact: true }).click()
  await expect(tools).toBeVisible()
  await expect(target).toHaveValue('0.2')
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await wheel(120)
  await expect(target).toHaveValue('0.1')
  await expect(zoom).toHaveText('100%')
  await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
  await tools.getByRole('button', { name: '从地面取高', exact: true }).click()
  const samplePoint = await screenPoint(page, { x: 1000, y: 1000 }, before.document.exportBoundsMm)
  await page.mouse.click(samplePoint.x, samplePoint.y)
  await expect(target).toHaveValue('0')
  await expect(page.locator('.asset-notice')).toContainText('已读取')
  await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
  await tools.getByRole('button', { name: '启用整面滚轮升降', exact: true }).click()
  await wheel(-120)
  await expect(target).toHaveValue('0.1')
  await tools.getByRole('button', { name: '取消高程草稿', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('elevation-draft-cancelled.sceneweave'))).hashes).toEqual(before.hashes)

  tools = await enableWheel()
  await wheel(-120)
  await expect(tools.getByLabel('整面目标高程', { exact: true })).toHaveValue('0.1')
  await expect(tools.getByRole('button', { name: '预览整面高程', exact: true })).toBeEnabled()
  await expect(tools.getByRole('button', { name: '取消高程草稿', exact: true })).toBeEnabled()
  // Dispatch only the ordinary buttons, synchronously in one browser task:
  // cancellation must happen before the awaited preview continuation. This
  // neither intercepts resources nor replaces any workspace or diagnostic API.
  await tools.evaluate(node => {
    const buttons = [...node.querySelectorAll<HTMLButtonElement>('button')]
    const preview = buttons.find(button => button.textContent?.trim() === '预览整面高程')
    const cancel = buttons.find(button => button.textContent?.trim() === '取消高程草稿')
    if (!preview || !cancel || preview.disabled || cancel.disabled) throw new Error('Expected enabled elevation preview and cancel controls.')
    preview.click()
    cancel.click()
  })
  await keyboardWorkspaceSaved(page)
  await expect(tools).toHaveCount(0)
  await expect(page.locator('.asset-notice')).toContainText('已取消高程草稿，工程未修改。')
  await expect(review).toHaveCount(0)
  expect((await keyboardProjectBackup(page, info.outputPath('elevation-pending-preview-cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  await expect(review).toHaveCount(0)

  tools = await enableWheel()
  await wheel(-120)
  await expect(tools.getByLabel('整面目标高程', { exact: true })).toHaveValue('0.1')
  await tools.getByRole('button', { name: '预览整面高程', exact: true }).click()
  await expect(review).toContainText('调整整面高程')
  await expect(review.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
  await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
  await page.screenshot({ path: info.outputPath('elevation-preview.png'), animations: 'disabled' })
  await review.getByRole('button', { name: '取消室外预览', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('elevation-preview-cancelled.sceneweave'))).hashes).toEqual(before.hashes)

  tools = await enableWheel()
  await wheel(-120)
  await expect(tools.getByLabel('整面目标高程', { exact: true })).toHaveValue('0.1')
  await tools.getByRole('button', { name: '预览整面高程', exact: true }).click()
  await adoptOutdoor(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('elevation-adopted.sceneweave'))
  expect(adopted.document).toEqual({
    ...before.document,
    revision: before.document.revision + 1,
    updatedAt: adopted.document.updatedAt,
    terrainAreas: { ...before.document.terrainAreas, [area.id]: { ...area, groundElevationMm: 100 } },
  })
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('elevation-undone.sceneweave'))
  expect(undone.document).toEqual({ ...before.document, revision: before.document.revision + 2, updatedAt: undone.document.updatedAt })
  expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await expect(zoom).toHaveText('100%')
  await wheel(-120)
  await expect(zoom).not.toHaveText('100%')
  await expect(review).toHaveCount(0)
  await expect(revision).toHaveAttribute('data-revision', String(undone.document.revision))
  expect((await keyboardProjectBackup(page, info.outputPath('elevation-normal-zoom.sceneweave'))).hashes).toEqual(undone.hashes)
  expect(errors).toEqual([])
})
