import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { Path, PointMm } from '../src/shared/model/scene'
import type { SceneCommand } from '../src/shared/commands/commands'
import { keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openOutdoorTask } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const canvas = (page: Page) => page.locator('canvas[aria-label="材质场景主持人预览"]')
const overlay = (page: Page) => page.getByTestId('automatic-road-overlay')
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const controls = (page: Page) => page.locator('[aria-label="自动道路草稿"]')
const landings = (path: Path) => path.automaticRoute?.algorithm === 'terrain-road3' ? path.automaticRoute.landings ?? [] : []

async function screen(page: Page, world: PointMm) {
  return overlay(page).evaluate((node, { x, y }) => {
    const matrix = (node as SVGSVGElement).getScreenCTM()!
    const point = new DOMPoint(x, y).matrixTransform(matrix)
    return { x: point.x, y: point.y }
  }, world)
}

async function drag(page: Page, handle: Locator, target: PointMm) {
  const origin = await handle.evaluate(node => ({ x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }))
  const from = await screen(page, origin), to = await screen(page, target)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x + 5, to.y)
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
}

async function adopt(page: Page) {
  await expect(review(page)).toBeVisible()
  const confirm = review(page).getByLabel('确认完整影响范围', { exact: true })
  if (await confirm.count()) await confirm.check()
  await review(page).getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

async function openArchive(page: Page, file: string) {
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(file)
  await keyboardWorkspaceSaved(page)
}

test('a snowline route retains a fixed bend and platform after regrade, reload and undo', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  await page.goto('./#home')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const bytes = await page.evaluate(async () => {
    const helper = '/tests/helpers/automatic-road-browser.ts'
    return (await import(helper)).snowPassInput() as Promise<number[]>
  })
  const input = info.outputPath('snow-pass-input.sceneweave')
  await writeFile(input, Uint8Array.from(bytes))
  await openArchive(page, input)
  const tools = await openOutdoorTask(page, '道路')
  const width = tools.getByLabel('室外通路净宽', { exact: true })
  await width.fill('1.2'); await width.press('Tab')
  await tools.getByLabel('道路材质', { exact: true }).selectOption({ label: '踩实褐壤' })
  await tools.getByRole('button', { name: '在画布自动选路', exact: true }).click()
  await expect(canvas(page)).toBeVisible()
  const from = await screen(page, { x: 4300, y: 16000 }), to = await screen(page, { x: 22500, y: 16000 })
  await page.mouse.click(from.x, from.y)
  await page.mouse.move(to.x, to.y)
  await expect(overlay(page).getByTestId('automatic-road-band')).toBeVisible()
  await expect(overlay(page).locator('[data-auto-road-tread]').first()).toBeVisible()
  await page.mouse.click(to.x, to.y)
  const bend = overlay(page).locator('[data-road-handle="bend"]').first()
  await expect(bend).toBeVisible()
  const shoulder = { x: 14600, y: 10200 }
  await drag(page, bend, shoulder)
  const pinned = overlay(page).locator('[data-road-handle="fixed"]')
  await expect(pinned).toHaveCount(1)
  const fixed = await pinned.evaluate(node => ({ x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }))
  expect(Math.hypot(shoulder.x - fixed.x, shoulder.y - fixed.y)).toBeLessThan(175)
  await controls(page).getByRole('button', { name: '固定歇脚平台', exact: true }).click()
  await expect(overlay(page).locator('[data-auto-road-landing]').first()).toBeVisible()
  const platformLength = controls(page).getByLabel('平台长度')
  await platformLength.fill('1.65')
  await platformLength.press('Tab')
  await expect(platformLength).toHaveValue('1.65')
  await controls(page).getByRole('button', { name: '预览自动道路', exact: true }).click()
  await expect(review(page)).toContainText('铺设自动道路')
  await review(page).getByRole('button', { name: '取消室外预览', exact: true }).click()
  await expect(overlay(page).locator('[data-road-handle="fixed"]')).toHaveCount(1)
  await controls(page).getByRole('button', { name: '预览自动道路', exact: true }).click()
  await adopt(page)

  const first = await keyboardProjectBackup(page, info.outputPath('snow-pass.sceneweave'))
  const path = Object.values(first.document.paths)[0] as Path
  expect(path.automaticRoute?.fixedPointsMm[1]).toEqual(fixed)
  expect(path.automaticRoute?.algorithm).toBe('terrain-road3')
  expect(landings(path)).toEqual([{ pointMm: fixed, lengthMm: 1650, elevationMm: expect.any(Number) }])
  expect(path.roadSurface?.stations.map(row => row.kind)).toEqual(expect.arrayContaining(['trail', 'tread', 'landing']))
  expect(path.roadSurface?.stations.some(row => row.shoulderMm.some(width => width > 0) && !!row.outZMm)).toBe(true)
  const drawing = page.waitForEvent('download')
  await (await mapExportButton(page, 'gm')).click()
  await (await drawing).saveAs(info.outputPath('snow-pass.png'))
  await page.locator('.workspace-export-menu > summary').click()
  await keyboardWorkspaceSaved(page)
  await page.getByRole('button', { name: '斜俯视', exact: true }).click()
  const oblique = page.getByRole('dialog', { name: '斜俯视', exact: true })
  await expect(oblique.getByLabel('可旋转地图预览')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  const obliqueDrawing = page.waitForEvent('download')
  await oblique.getByRole('button', { name: '导出当前画面', exact: true }).click()
  await (await obliqueDrawing).saveAs(info.outputPath('snow-pass-oblique.png'))
  await page.keyboard.press('Escape')

  const cold = await browser.newPage({ baseURL: info.project.use.baseURL })
  try {
    await openArchive(cold, info.outputPath('snow-pass.sceneweave'))
    await canvas(cold).click(await screenRoadPoint(cold, fixed))
    const inspector = cold.getByRole('region', { name: '室外对象属性' })
    const width = inspector.getByLabel('对象通路净宽', { exact: true })
    await width.fill('1.25')
    await width.press('Tab')
    await inspector.getByRole('button', { name: '预览对象修改', exact: true }).click()
    await adopt(cold)
    await openDetailsBySummary(inspector, /^踏步材质与覆盖$/)
    await inspector.getByLabel('阶梯材质', { exact: true }).selectOption('slate')
    await inspector.getByRole('button', { name: '预览踏步外观', exact: true }).click()
    await adopt(cold)
    await cold.getByRole('button', { name: '调整自动道路', exact: true }).click()
    await drag(cold, overlay(cold).locator('[data-road-handle="start"]'), { x: 4000, y: 16000 })
    await controls(cold).getByRole('button', { name: '预览自动道路', exact: true }).click()
    await adopt(cold)
    const moved = await keyboardProjectBackup(cold, info.outputPath('moved.sceneweave'))
    const actual = Object.values(moved.document.paths)[0] as Path
    expect(actual.automaticRoute?.fixedPointsMm.slice(1)).toEqual(path.automaticRoute?.fixedPointsMm.slice(1))
    expect(landings(actual)).toEqual(landings(path))
    expect(actual.widthMm).toBe(1250)
    expect(actual.staircase?.material).toBe('slate')
    expect(actual.surfaceStyle).toEqual(path.surfaceStyle)
    expect(actual.automaticRoute?.fixedPointsMm[0]).not.toEqual(path.automaticRoute?.fixedPointsMm[0])
    const suffix = (road: Path) => road.centerlineMm.slice(road.centerlineMm.findIndex(p => p.x === fixed.x && p.y === fixed.y))
    expect(suffix(actual)).toEqual(suffix(path))

    await cold.getByRole('button', { name: '调整自动道路', exact: true }).click()
    await overlay(cold).locator('[data-road-handle="fixed"]').click()
    await expect(controls(cold).getByLabel('平台长度')).toHaveValue('1.65')
    await controls(cold).getByRole('button', { name: '恢复平台自动', exact: true }).click()
    await expect(controls(cold).getByRole('button', { name: '固定歇脚平台', exact: true })).toBeVisible()
    await expect(overlay(cold).locator('[data-road-handle="fixed"]')).toHaveCount(1)
    await controls(cold).getByRole('button', { name: '恢复此点自动', exact: true }).click()
    await expect(overlay(cold).locator('[data-road-handle="fixed"]')).toHaveCount(0)
    await controls(cold).getByRole('button', { name: '预览自动道路', exact: true }).click()
    await adopt(cold)
    const restored = await keyboardProjectBackup(cold, info.outputPath('restored.sceneweave'))
    expect((Object.values(restored.document.paths)[0] as Path).automaticRoute?.fixedPointsMm).toHaveLength(2)
    expect(landings(Object.values(restored.document.paths)[0] as Path)).toHaveLength(0)
    await cold.getByRole('button', { name: '撤销编辑', exact: true }).click()
    await keyboardWorkspaceSaved(cold)
    const undone = await keyboardProjectBackup(cold, info.outputPath('undo.sceneweave'))
    expect(undone.document.paths).toEqual(moved.document.paths)
  } finally { await cold.close() }
  expect(errors).toEqual([])
})

test('private grading leaves both player PNGs byte-identical', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./#home')
  const hashes = await page.evaluate(async () => {
    const [helper, archive, validation, commands, road, runtime, top, oblique] = await Promise.all([
      '/tests/helpers/automatic-road-browser.ts', '/src/shared/project/file.ts', '/src/platform/browser/project-validation.ts',
      '/src/shared/appearance/commands.ts', '/src/shared/geometry/automatic-road.ts', '/src/platform/browser/runtime.ts',
      '/src/platform/browser/render/renderer.ts', '/src/platform/browser/render/oblique-renderer.ts',
    ].map(url => import(url)))
    let bundle = await archive.importProject(Uint8Array.from(await helper.snowPassInput()), validation.browserProjectValidation)
    const scene = bundle.project.document, floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
    const fix = (edits: SceneCommand[]) => {
      const { document, historyIdentity, appearance } = bundle.project
      bundle = { ...bundle, project: { ...bundle.project, ...commands.applyCompositionDraftCommands({ document, historyIdentity, appearance }, edits, runtime.runtime) } }
    }
    fix([{ type: 'upsertManualMask', id: 'snow-road-mask', floorId, layerId, boundsMm: { x: 2200, y: 8000, width: 22800, height: 11500 } }])
    const pngs = async () => {
      const options = { audience: 'player' as const, floorId, longEdgePx: 640 }
      const blobs = [await top.exportPng(bundle, options), await oblique.exportObliquePng(bundle, options)]
      return Promise.all(blobs.map(async image => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await image.arrayBuffer())))))
    }
    const before = await pngs()
    const request = { floorId, layerId, widthMm: 1200, visibility: 'gm' as const }, fixedPointsMm = [{ x: 4300, y: 16000 }, { x: 22500, y: 16000 }]
    const path = road.createAutomaticRoadPlanner(bundle.project.document, request)(fixedPointsMm)
    fix([{ type: 'createPath', id: 'private-snow-road', ...request, centerlineMm: path.centerlineMm, supportRefs: path.supportRefs, roadSurface: path.roadSurface,
      automaticRoute: { algorithm: 'terrain-road3', fixedPointsMm, automaticStairs: true } }])
    return { before, after: await pngs() }
  })
  expect(hashes.after).toEqual(hashes.before)
})

test('rock under a cut is visible through its side of the tread', async ({ page }) => {
  await page.goto('./#home')
  const samples = await page.evaluate(async () => {
    const modulePath = '/src/platform/browser/render/graded-road-paint.ts'
    const { paintRoadWearMask } = await import(modulePath)
    const section = (x: number) => [{ x, y: 300, z: 440 }, { x, y: 600, z: 0 }, { x, y: 1800, z: 0 }, { x, y: 1950, z: -60 }]
    const spans = Array.from({ length: 20 }, (_, i) => ({ start: section(i * 480), end: section((i + 1) * 480) }))
    const read = (rock: boolean) => {
      const canvas = document.createElement('canvas')
      canvas.width = 384; canvas.height = 96
      const ctx = canvas.getContext('2d')!
      ctx.scale(.04, .04)
      paintRoadWearMask(ctx, { spans }, (p: PointMm) => ({ material: rock && p.y < 600 ? 'stone' : 'earth', tint: null }))
      const mean = (y: number) => {
        const bytes = ctx.getImageData(32, y, 320, 1).data
        let sum = 0
        for (let i = 3; i < bytes.length; i += 4) sum += bytes[i]
        return sum / 320
      }
      return { cut: mean(43), fill: mean(67), outside: mean(8) }
    }
    return { rock: read(true), earth: read(false) }
  })
  expect(samples.earth.cut - samples.rock.cut).toBeGreaterThan(20)
  expect(samples.earth.fill).toBe(samples.rock.fill)
  expect(samples.rock.outside).toBe(0)
})

async function screenRoadPoint(page: Page, point: PointMm) {
  const box = (await canvas(page).boundingBox())!
  return { position: { x: box.width * point.x / 42000, y: box.height * point.y / 33000 } }
}
