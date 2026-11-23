import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { projectScene } from '../src/shared/projection/projection'
import { visualBase } from '../src/shared/visual/base'
import type { BoundsMm, PointMm } from '../src/shared/model/scene'
import type { HomeShowcaseKind } from '../src/platform/browser/content/home-showcase'
import { importSampleFile } from './home-showcase-helpers'
import { clickKeyboardWorldPoint, createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openSceneObjects, openVisualTask } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary, reloadSaved } from './workspace-ux-helpers'

async function adopt(page: Page, kind: '视觉' | '结构' | '组件' = '视觉') {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible({ timeout: 30_000 })
  const button = review.getByRole('button', { name: `采用${kind}修改`, exact: true })
  if (kind !== '组件') {
    await expect(button).toBeDisabled()
    await review.getByLabel('确认完整影响范围', { exact: true }).check()
  }
  await button.click()
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
}

async function sample(page: Page, id: HomeShowcaseKind) {
  await page.goto('./#home')
  await importSampleFile(page, id)
  await keyboardWorkspaceSaved(page)
}

async function png(page: Page, audience: 'gm' | 'player', path: string) {
  const download = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await download).saveAs(path)
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
}

async function patchColor(page: Page, path: string, point: PointMm, bounds: BoundsMm) {
  return page.evaluate(async ({ encoded, point, bounds }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), value => value.charCodeAt(0))], { type: 'image/png' }))
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const x = Math.round((point.x - bounds.x) * bitmap.width / bounds.width)
      const y = Math.round((point.y - bounds.y) * bitmap.height / bounds.height)
      const patch = context.getImageData(x - 6, y - 6, 13, 13).data
      const totals = [0, 0, 0, 0]
      for (let i = 0; i < patch.length; i++) totals[i % 4] += patch[i]
      const [red, green, blue] = totals.map(value => value / (13 * 13))
      return { brightness: (red + green + blue) / 3, blueBias: blue - red }
    } finally { bitmap.close() }
  }, { encoded: (await readFile(path)).toString('base64'), point, bounds })
}

const save = (page: Page, info: TestInfo, name: string) => keyboardProjectBackup(page, info.outputPath(name + '.sceneweave'))

test('canvas aiming, editable independent line, privacy, undo and saved PNG output', async ({ page }, info) => {
  test.setTimeout(160_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '聚光和线光验收', { widthMeters: 12, heightMeters: 10 })
  const source = await save(page, info, 'empty'), bounds = source.document.exportBoundsMm
  const form = await openVisualTask(page, '灯光')
  await form.getByLabel('灯光类型', { exact: true }).selectOption('spot')
  await form.getByRole('button', { name: '在画布定位并瞄准', exact: true }).click()
  await clickKeyboardWorldPoint(page, { x: 4000, y: 5000 }, bounds)
  await expect(page.locator('.asset-selection-notice')).toContainText('确定聚光朝向')
  await clickKeyboardWorldPoint(page, { x: 6500, y: 5000 }, bounds)
  await expect(form.getByLabel('视觉聚光方向 °', { exact: true })).toHaveValue('0')
  await form.getByLabel('灯光可见性', { exact: true }).selectOption('gm')
  await form.getByLabel('视觉灯光强度', { exact: true }).fill('1.4')
  await form.getByRole('button', { name: '预览灯光', exact: true }).click()
  await adopt(page)
  const lit = await save(page, info, 'spot')
  const spot = Object.values(visualBase(lit.document)!.lights)[0]
  expect(spot.shape).toMatchObject({ kind: 'spot', directionDeg: 0 })
  expect(spot.visibility).toBe('gm')
  expect(spot.positionMm.x).toBeCloseTo(4000, -2)
  await form.getByLabel('灯光类型', { exact: true }).selectOption('line')
  await form.getByRole('button', { name: '在画布画线', exact: true }).click()
  await clickKeyboardWorldPoint(page, { x: 4200, y: 7000 }, bounds)
  await clickKeyboardWorldPoint(page, { x: 7900, y: 7100 }, bounds)
  await form.getByRole('button', { name: '预览灯光', exact: true }).click()
  await adopt(page)
  const both = await save(page, info, 'spot-and-line')
  const line = Object.values(visualBase(both.document)!.lights).find(light => light.shape?.kind === 'line')!
  expect(line.shape).toMatchObject({ kind: 'line', source: { kind: 'segment' } })
  await form.getByLabel('灯光', { exact: true }).selectOption(line.id)
  await form.getByRole('button', { name: '移除灯光', exact: true }).click()
  await adopt(page)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await reloadSaved(page)
  await keyboardWorkspaceSaved(page)
  const cold = await save(page, info, 'reopened')
  expect(visualBase(cold.document)?.lights).toEqual(visualBase(both.document)?.lights)
  const gm = info.outputPath('gm.png'), player = info.outputPath('player.png')
  await png(page, 'gm', gm)
  await png(page, 'player', player)
  const point = { x: spot.positionMm.x + 1200, y: spot.positionMm.y }
  expect((await patchColor(page, gm, point, bounds)).brightness).toBeGreaterThan((await patchColor(page, player, point, bounds)).brightness + 8)
  const away = { x: spot.positionMm.x - 1200, y: spot.positionMm.y }
  expect(await patchColor(page, gm, away, bounds)).toEqual(await patchColor(page, player, away, bounds))
  expect(errors).toEqual([])
})

test('tavern window stays linked when the actual opening is widened in the building inspector', async ({ page }, info) => {
  test.setTimeout(150_000)
  await sample(page, 'fantasy')
  const initial = await save(page, info, 'window-initial')
  const id = 'ember-exterior-window-0'
  const form = await openVisualTask(page, '灯光')
  await form.getByLabel('灯光', { exact: true }).selectOption('ember-rain-window')
  await expect(form.getByLabel('灯光类型', { exact: true })).toHaveValue('window')
  await expect(form.getByLabel('发光窗户', { exact: true })).toHaveValue(id)
  await form.getByLabel('视觉光边柔度', { exact: true }).fill('0.6')
  await form.getByRole('button', { name: '预览灯光', exact: true }).click()
  await adopt(page)
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`[data-entity-id="${id}"]`).click()
  const width = page.getByLabel('开口净宽', { exact: true })
  await width.fill('2.4'); await width.press('Tab')
  await page.getByRole('button', { name: '预览门窗修改', exact: true }).click()
  await adopt(page, '结构')
  const wider = await save(page, info, 'window-wider')
  expect(wider.document.openings[id].widthMm).toBe(2400)
  const beam = projectScene(wider.document, 'player', wider.appearance).visual!.lights.find(light => light.id === 'ember-rain-window')!.shape
  if (beam?.kind !== 'window') throw Error('Window is absent from player image')
  expect(Math.hypot(beam.aperture[1].x - beam.aperture[0].x, beam.aperture[1].y - beam.aperture[0].y)).toBeGreaterThan(initial.document.openings[id].widthMm)
  await png(page, 'player', info.outputPath('wide-window-player.png'))
})

test('fixture spotlight uses the physical lamp transform and can be adjusted in the normal inspector', async ({ page }, info) => {
  test.setTimeout(150_000)
  await sample(page, 'investigation')
  const id = 'authored-desk-8-brass-lamp'
  const first = await save(page, info, 'initial-fixture')
  await selectKeyboardProp(page, id)
  await openDetailsBySummary(page.getByTestId('workspace-inspector'), /^外观与图层调整$/)
  await page.getByLabel('外观调整项目', { exact: true }).selectOption('propGlow')
  await expect(page.getByLabel('物件出光类型', { exact: true })).toHaveValue('spot')
  await page.getByLabel('物件内朝向 °', { exact: true }).fill('80')
  await page.getByRole('button', { name: '预览外观调整', exact: true }).click()
  await adopt(page, '组件')
  const next = await save(page, info, 'aimed-fixture')
  expect(next.document.props[id].appearance.glow?.beam?.directionDeg).toBe(80)
  expect(next.document.props[id].positionMm).toEqual(first.document.props[id].positionMm)
  const resolved = projectScene(next.document, 'player', next.appearance).visual!.fixtureGlows!.find(light => light.beam)
  expect(resolved?.beam?.directionDeg).toBe((next.document.props[id].rotationDeg + 80) % 360)
})

test('route and area hosts remain editable, and the same floor switches from sun to moon', async ({ page }, info) => {
  test.setTimeout(240_000)
  for (const [id, lampId, kind, field] of [
    ['coast', 'tidehaven-pier-light-right', 'line', '视觉溢光范围 mm'],
    ['volcano', 'natural-volcano-lava-glow', 'area', '视觉表面亮度'],
  ] as const) {
    await sample(page, id)
    const form = await openVisualTask(page, '灯光')
    await form.getByLabel('灯光', { exact: true }).selectOption(lampId)
    await expect(form.getByLabel('灯光类型', { exact: true })).toHaveValue(kind)
    await form.getByLabel(field, { exact: true }).fill(kind === 'area' ? '0.55' : '1300')
    await form.getByRole('button', { name: '预览灯光', exact: true }).click()
    await adopt(page)
    const backup = await save(page, info, id + '-edited')
    const light = visualBase(backup.document)!.lights[lampId]
    if (kind === 'area') expect(light.shape).toMatchObject({ source: { kind: 'terrainArea', id: 'natural-volcano-lava-area' }, surfaceIntensity: .55 })
    else {
      expect(light.radiusMm).toBe(1300)
      const projected = projectScene(backup.document, 'player', backup.appearance).visual!.lights.find(row => row.id === lampId)
      if (projected?.shape?.kind !== 'line') throw Error('Bridge light missing')
      expect(projected.shape.runs).toHaveLength(2)
    }
  }
  await sample(page, 'island')
  const sunPng = info.outputPath('island-sun-gm.png'), moonPng = info.outputPath('island-moon-gm.png')
  await png(page, 'gm', sunPng)
  const form = await openVisualTask(page, '环境')
  await expect(form.getByLabel('平行光', { exact: true })).toHaveValue('sun')
  await form.getByLabel('平行光', { exact: true }).selectOption('moon')
  await form.getByLabel('视觉光源高度 °', { exact: true }).fill('50')
  await form.getByRole('button', { name: '预览环境', exact: true }).click()
  await adopt(page)
  const moon = await save(page, info, 'island-moon')
  expect(visualBase(moon.document)!.environment.directionalLight).toMatchObject({ kind: 'moon', elevationDeg: 50 })
  await png(page, 'gm', moonPng)
  const bounds = moon.document.exportBoundsMm, beach = { x: 6750, y: 12500 }
  const day = await patchColor(page, sunPng, beach, bounds), night = await patchColor(page, moonPng, beach, bounds)
  expect(night.brightness).toBeLessThan(day.brightness - 20)
  expect(night.blueBias).toBeGreaterThan(day.blueBias + 8)
})
