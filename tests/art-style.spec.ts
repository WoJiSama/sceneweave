import { expect, test, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { Workspace } from '../src/application/workspace/workspace'
import { createKeyboardProject, keyboardProjectBackup } from './keyboard-ux-helpers'
import { openVisualTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary, projectBackupButton, reloadSaved } from './workspace-ux-helpers'

const helperPath = '/tests/helpers/art-style-browser.ts'

const painted = (page: Page) => expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 45000 })
const saved = async (page: Page) => {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 45000 })
  await painted(page)
}
const styleTool = (page: Page) => openVisualTask(page, '画风')
const scene = (page: Page) => page.evaluate(() => {
  const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }
  const { document } = workspace.getState().project!
  return { revision: document.revision, style: document.artStyle ?? null,
    props: document.props, assets: document.assets, walls: document.walls, rooms: document.rooms }
})
const changeSlider = async (page: Page, name: string, value: number) => {
  const slider = page.getByRole('slider', { name, exact: true })
  await slider.fill(String(value)); await expect(slider).toHaveValue(String(value))
}
const canvasHash = async (canvas: Locator) => createHash('sha256').update(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).digest('hex')

function coastLineMarks(canvas: HTMLCanvasElement) {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
  const gray = (x: number, y: number) => {
    const at = (y * width + x) * 4
    return (data[at] + data[at + 1] + data[at + 2]) / 3
  }
  const darkFraction = (left: number, top: number, right: number, bottom: number) => {
    let dark = 0, samples = 0
    for (let y = Math.round(top * height); y < Math.round(bottom * height); y++) {
      for (let x = Math.round(left * width); x < Math.round(right * width); x++) {
        if (gray(x, y) < 180) dark++
        samples++
      }
    }
    return dark / samples
  }
  // Sample both visible shoulders before the pier, along the source road's
  // slope. Coordinates follow the artwork so a scale change keeps the test.
  const approach = [
    { from: 24600, to: 25350, upper: [18050, 18150], lower: [20080, 20080] },
    { from: 25350, to: 25900, upper: [18150, 18550], lower: [20080, 20320] },
    { from: 25900, to: 26650, upper: [18550, 19200], lower: [20320, 21040] },
    { from: 27900, to: 28600, upper: [19880, 19880], lower: [21280, 21280] },
    { from: 28700, to: 29250, upper: [19860, 19680], lower: [21300, 21520] },
  ]
  const roadSides = approach.map(({ from, to, upper, lower }) => [upper, lower].map(([startY, endY]) => {
    let covered = 0, longestGap = 0, gap = 0
    const first = Math.round(from * width / 40000), last = Math.round(to * width / 40000)
    for (let x = first; x <= last; x++) {
      const y = startY + (endY - startY) * (x - first) / Math.max(1, last - first)
      let dark = false
      for (let row = Math.round((y - 315) * height / 32000); row <= Math.round((y + 315) * height / 32000); row++) {
        if (gray(x, row) < 217) { dark = true; break }
      }
      if (dark) { covered++; gap = 0 } else longestGap = Math.max(longestGap, ++gap)
    }
    return { covered: covered / (last - first + 1), gapMm: longestGap * 40000 / width }
  }))
  return { openWater: darkFraction(.81, .09, .96, .32), building: darkFraction(.2, .21, .56, .55), pier: darkFraction(.77, .6, .96, .72), roadSides }
}

function expectCoastLineMarks(marks: ReturnType<typeof coastLineMarks>) {
  expect(marks.openWater).toBeLessThan(.01)
  expect(marks.building).toBeGreaterThan(.008)
  expect(marks.pier).toBeGreaterThan(.006)
  for (const sides of marks.roadSides) for (const side of sides) {
    expect(side.covered, JSON.stringify(marks.roadSides)).toBeGreaterThan(.58)
    expect(side.gapMm, JSON.stringify(marks.roadSides)).toBeLessThan(330)
  }
}

test('both styles can be switched independently, compared, saved and restored', async ({ page }, info) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(12_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#workspace')
  await expect(page.getByTestId('workspace-layout')).toBeVisible()
  const fixture = await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).makeArtStyleRoom(), helperPath)
  await saved(page)
  const original = await scene(page)

  const proof = page.waitForEvent('download')
  const counts = await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).renderArtStyleEvidence(), helperPath)
  await (await proof).saveAs(info.outputPath('art-style-room.png'))
  expect(counts.bedDepth).toBeGreaterThan(1000)
  expect(counts.woodDepth).toBeGreaterThan(1000)
  expect(counts.rugDepth).toBe(0)
  expect(counts.rugTone).toBeGreaterThan(2000)
  expect(counts.rugGrain).toBeGreaterThan(2000)
  expect(counts.rugGrainSize).toBeGreaterThan(2000)
  expect(counts.sameKnobsBed).toBeGreaterThan(1000)
  expect(counts.zeroStrength).toBe(0)
  expect(counts.styledAlpha).toBe(0)
  expect(counts.stackedAlpha).toBe(0)
  expect(counts.stackedFromHand).toBeGreaterThan(10000)
  expect(counts.stackedFromTea).toBeGreaterThan(10000)
  expect(counts.zeroHand).toBe(0)
  expect(counts.zeroTea).toBe(0)
  expect(counts.handHalf).toBeGreaterThan(0)
  expect(counts.handFull).toBeGreaterThan(counts.handHalf)
  expect(counts.teaHalf).toBeGreaterThan(0)
  expect(counts.teaFull).toBeGreaterThan(counts.teaHalf)
  expect(counts.legacyHand).toBeLessThan(counts.handFull)
  expect(counts.legacyTea).toBeLessThan(counts.teaFull)
  expect(counts.barrelBrush).toBeGreaterThan(1000)
  expect(counts.sackBrush).toBeGreaterThan(1000)
  expect(counts.unchangedAlpha).toBe(0)

  const style = await styleTool(page)
  const hand = style.getByRole('checkbox', { name: '手绘', exact: true })
  const tea = style.getByRole('checkbox', { name: '茶绘', exact: true })
  const handParams = style.getByRole('button', { name: '手绘参数', exact: true })
  const teaParams = style.getByRole('button', { name: '茶绘参数', exact: true })
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  const paint = async () => {
    await painted(page)
    await expect(canvas).toBeVisible()
    return canvasHash(canvas)
  }
  await expect(hand).not.toBeChecked()
  await expect(tea).not.toBeChecked()
  const originalPaint = await paint()
  await tea.check()
  await changeSlider(page, '冷暖', 52)
  await changeSlider(page, '颗粒感', 0)
  const teaPaint = await paint()
  await expect(style.getByRole('slider', { name: '厚重感', exact: true })).toBeEnabled()
  await expect(style.getByRole('button', { name: '采用画风' })).toBeVisible()
  await expect(page.locator('.workspace-session-feedback').getByRole('status').filter({ hasText: '正在预览全图画风' })).toBeVisible()
  await expect(page.getByRole('button', { name: '对比原色（仅预览）', exact: true })).toBeDisabled()
  await expect(await scene(page)).toEqual(original)

  await style.getByRole('button', { name: '前后对比', exact: true }).click()
  const divider = page.locator('.art-style-divider')
  await expect(divider).toHaveAttribute('data-angle', '0', { timeout: 30000 })
  const before = page.getByLabel('画风调整前', { exact: true })
  const beforeData = await canvasHash(before)
  const position = page.getByRole('button', { name: '移动画风对比线' })
  const pivot = (await position.boundingBox())!
  await page.mouse.move(pivot.x + pivot.width / 2, pivot.y + pivot.height / 2)
  await page.mouse.down(); await page.mouse.move(pivot.x + pivot.width / 2 + 94, pivot.y + pivot.height / 2 + 15, { steps: 4 }); await page.mouse.up()
  const moved = await divider.getAttribute('data-position-x')
  expect(Number(moved)).toBeGreaterThan(.5)
  const end = page.getByRole('button', { name: '旋转对比线端点二' })
  const endAt = (await end.boundingBox())!, rotationPivot = (await position.boundingBox())!
  await page.mouse.move(endAt.x + endAt.width / 2, endAt.y + endAt.height / 2)
  await page.mouse.down()
  await page.mouse.move(rotationPivot.x + rotationPivot.width / 2 - 170, rotationPivot.y + rotationPivot.height / 2, { steps: 6 })
  await page.mouse.up()
  const horizontal = Number(await divider.getAttribute('data-angle'))
  expect(horizontal).toBeCloseTo(90, 0)
  await end.press('Shift+ArrowLeft')
  const diagonal = await divider.getAttribute('data-angle')
  expect(Number(diagonal)).toBeCloseTo(75, 0)

  await hand.check()
  await expect(tea).toBeChecked()
  await expect(handParams).toHaveAttribute('aria-pressed', 'true')
  await changeSlider(page, '冷暖', -20)
  const combined = await paint()
  expect(combined).not.toBe(teaPaint)
  await teaParams.click()
  await expect(style.getByRole('slider', { name: '冷暖', exact: true })).toHaveValue('52')
  expect(await paint()).toBe(combined)
  await hand.uncheck()
  await expect(tea).toBeChecked()
  expect(await paint()).toBe(teaPaint)
  await hand.check()
  await tea.uncheck()
  await expect(hand).toBeChecked()
  await expect(style.getByRole('slider', { name: '冷暖', exact: true })).toHaveValue('-20')
  expect(await paint()).not.toBe(combined)
  await hand.uncheck()
  await expect(tea).not.toBeChecked()
  await expect(style.getByRole('checkbox', { name: '原画调色', exact: true })).toBeVisible()
  expect(await paint()).toBe(originalPaint)
  // Re-enable in the opposite order and recover both parameter sets and the same paint.
  await hand.check()
  await tea.check()
  await expect(style.getByRole('slider', { name: '冷暖', exact: true })).toHaveValue('52')
  expect(await paint()).toBe(combined)
  await expect(divider).toHaveAttribute('data-angle', diagonal!, { timeout: 30000 })
  await expect(divider).toHaveAttribute('data-position-x', moved!)
  expect(await canvasHash(before)).toBe(beforeData)
  await page.screenshot({ path: info.outputPath('art-style-compare.png') })

  const image = (await canvas.boundingBox())!
  const { bounds, rug } = fixture
  await page.mouse.click(image.x + (rug.x - bounds.x) * image.width / bounds.width, image.y + (rug.y - bounds.y) * image.height / bounds.height)
  await expect(style.getByText(/普通图片支持调色和纸纹/)).toBeVisible()
  await expect(style.getByRole('slider', { name: '厚重感', exact: true })).toBeDisabled()
  await expect(style.getByRole('slider', { name: '冷暖', exact: true })).toBeEnabled()

  await style.getByRole('button', { name: '采用画风', exact: true }).click()
  await saved(page)
  const adopted = await scene(page)
  expect(adopted.revision).toBe(original.revision + 1)
  expect(adopted.style?.active).toBe('both')
  expect(adopted.style?.presets.tea).toMatchObject({ filter: { warmth: 52 }, effects: { grain: 0 } })
  expect(adopted.style?.presets.handDrawn).toMatchObject({ filter: { warmth: -20 } })
  expect(adopted.props).toEqual(original.props); expect(adopted.assets).toEqual(original.assets)
  expect(adopted.walls).toEqual(original.walls); expect(adopted.rooms).toEqual(original.rooms)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  expect((await scene(page)).style).toBeNull()
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  expect((await scene(page)).style).toEqual(adopted.style)
  await reloadSaved(page)
  await expect(page.getByText('已重新载入本地工程，本次选区和撤销记录已重置。', { exact: true })).toBeVisible({ timeout: 45000 })
  await saved(page)
  await styleTool(page)
  await expect(tea).toBeChecked(); await expect(hand).toBeChecked()
  await teaParams.click()
  await expect(style.getByRole('slider', { name: '冷暖', exact: true })).toHaveValue('52')
  const savedPaint = await paint()
  await style.getByRole('button', { name: '前后对比', exact: true }).click()
  await expect(divider).toBeVisible({ timeout: 30000 })
  await changeSlider(page, '冷暖', -15)
  await expect(style.getByRole('button', { name: '采用画风', exact: true })).toBeEnabled({ timeout: 30000 })
  expect(await canvasHash(before)).toBe(savedPaint)
  expect(await paint()).not.toBe(savedPaint)

  await handParams.click()
  await expect(style.getByRole('slider', { name: '冷暖', exact: true })).toHaveValue('-20')
  await style.getByRole('button', { name: '取消画风调整', exact: true }).click()
  await expect(tea).toBeChecked(); await expect(hand).toBeChecked()
  await tea.uncheck(); await hand.uncheck()
  await style.getByRole('button', { name: '采用画风', exact: true }).click()
  await saved(page)
  expect((await scene(page)).style).toEqual({ ...adopted.style, active: 'original' })
  expect(await paint()).toBe(originalPaint)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await saved(page)
  expect((await scene(page)).style).toEqual(adopted.style)
  await expect(tea).toBeChecked(); await expect(hand).toBeChecked()
  await style.getByRole('button', { name: '前后对比', exact: true }).click()
  await expect(divider).toBeVisible({ timeout: 30000 })
  const audience = page.getByRole('group', { name: '预览受众' })
  await audience.getByRole('button', { name: '玩家', exact: true }).click()
  await expect(divider).toHaveCount(0); await expect(before).toHaveCount(0)
  await expect(page.getByLabel('材质场景玩家预览', { exact: true })).toBeVisible()
  await audience.getByRole('button', { name: '主持人', exact: true }).click()
  const result = await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).artStylePrivatePair(), helperPath)
  expect(result.samePlayer).toBe(true)
  expect(result.sameGm).toBe(false)
  expect(result.style).toEqual(adopted.style)
  await saved(page)
  const png = page.waitForEvent('download')
  await (await mapExportButton(page, 'player')).click()
  const player = await png
  expect(player.suggestedFilename()).toBe('sceneweave-player-map.png')
  await player.saveAs(info.outputPath('art-style-player.png'))
  await saved(page)
  const backup = page.waitForEvent('download')
  await (await projectBackupButton(page)).click()
  const path = info.outputPath('art-style-room.sceneweave')
  await (await backup).saveAs(path)
  const backupFiles = unzipSync(await readFile(path))
  expect(JSON.parse(new TextDecoder().decode(backupFiles['scene.json'])).artStyle).toEqual(adopted.style)
  const exportedSources = JSON.parse(new TextDecoder().decode(backupFiles['sources.json']))
  expect(Object.keys(exportedSources)).toContain('theme-pack-fantasy-art-straw-bed-v1')
  expect(Object.keys(backupFiles)).toContain(`assets/${Object.values(adopted.assets).find(asset => asset.origin.attribution === 'Sceneweave original bitmap fixture')!.sha256}.png`)
  expect(errors).toEqual([])
})

test('each side of the split keeps its own style and only the chosen side is adopted', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#workspace')
  await expect(page.getByTestId('workspace-layout')).toBeVisible()
  await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).makeArtStyleRoom(), helperPath)
  await saved(page)
  const original = await scene(page)
  const style = await styleTool(page)
  const compare = style.getByRole('button', { name: '两侧画风对比', exact: true })
  const close = style.getByRole('button', { name: '退出两侧对比', exact: true })
  const divider = page.getByLabel('两侧画风对比线', { exact: true })
  const side = (key: 'A' | 'B') => style.getByRole('group', { name: '选择调整哪一侧' }).getByRole('button', { name: new RegExp(`^${key} ·`) })
  const hand = style.getByRole('checkbox', { name: '手绘', exact: true })
  const tea = style.getByRole('checkbox', { name: '茶绘', exact: true })
  const warmth = style.getByRole('slider', { name: '冷暖', exact: true })
  const adoptA = style.getByRole('button', { name: '采用 A 侧为全图画风', exact: true })
  const a = page.getByLabel('画风 A 侧', { exact: true })
  const b = page.getByLabel('画风 B 侧', { exact: true })
  const map = page.getByLabel('材质场景主持人预览', { exact: true })
  const pair = async () => {
    await painted(page)
    await expect(divider).toBeVisible()
    return Promise.all([canvasHash(a), canvasHash(b)])
  }
  const originalPaint = await canvasHash(map)

  await compare.click()
  await expect(side('A')).toHaveText('A · 手绘')
  await expect(side('B')).toHaveText('B · 茶绘')
  await expect(side('B')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '对比原色（仅预览）', exact: true })).toBeDisabled()
  const [defaultA, defaultB] = await pair()
  expect(defaultA).not.toBe(originalPaint)
  expect(defaultB).not.toBe(originalPaint)
  expect(defaultA).not.toBe(defaultB)
  await page.screenshot({ path: info.outputPath('art-style-ab.png') })

  await changeSlider(page, '冷暖', 24)
  const [sameA, editedB] = await pair()
  expect(sameA).toBe(defaultA)
  expect(editedB).not.toBe(defaultB)
  await side('A').click()
  await expect(warmth).not.toHaveValue('24')
  await hand.uncheck()
  expect(await pair()).toEqual([originalPaint, editedB])
  await hand.check()
  await tea.check()
  await changeSlider(page, '冷暖', -30)
  const [stackedA, stillB] = await pair()
  expect(stackedA).not.toBe(defaultA)
  expect(stillB).toBe(editedB)
  await side('B').click()
  await expect(warmth).toHaveValue('24')
  await hand.check()
  expect((await pair())[1]).not.toBe(editedB)
  await tea.uncheck()
  await hand.uncheck()
  expect(await pair()).toEqual([stackedA, originalPaint])
  await tea.check()
  await expect(warmth).toHaveValue('24')
  expect(await pair()).toEqual([stackedA, editedB])

  const verticalClip = await a.evaluate(element => getComputedStyle(element).clipPath)
  const end = page.getByRole('button', { name: '旋转对比线端点二' })
  for (let step = 0; step < 6; step++) await end.press('Shift+ArrowRight')
  await expect(divider).toHaveAttribute('data-angle', '90')
  expect(await a.evaluate(element => getComputedStyle(element).clipPath)).not.toBe(verticalClip)
  await expect(divider.locator('text')).toHaveText(['A · 手绘 + 茶绘', 'B · 茶绘'])
  expect(await pair()).toEqual([stackedA, editedB])
  await close.click()
  await painted(page)
  await expect(divider).toHaveCount(0)
  expect(await canvasHash(map)).toBe(originalPaint)
  expect(await scene(page)).toEqual(original)

  await tea.check()
  await changeSlider(page, '冷暖', -19)
  await painted(page)
  const draft = await canvasHash(map)
  await compare.click()
  await changeSlider(page, '冷暖', 32)
  await close.click()
  await painted(page)
  await expect(warmth).toHaveValue('-19')
  expect(await canvasHash(map)).toBe(draft)
  expect(await scene(page)).toEqual(original)

  await compare.click()
  await side('A').click()
  await changeSlider(page, '冷暖', -33)
  const [chosen, unchosen] = await pair()
  expect(chosen).not.toBe(unchosen)
  await adoptA.click()
  await saved(page)
  await expect(divider).toHaveCount(0)
  expect(await canvasHash(map)).toBe(chosen)
  const adopted = await scene(page)
  expect(adopted).toEqual({ ...original, revision: original.revision + 1, style: adopted.style })
  expect(adopted.style?.active).toBe('handDrawn')
  expect(adopted.style?.presets.handDrawn).toMatchObject({ filter: { warmth: -33 } })
  expect(adopted.style?.presets.tea).toMatchObject({ filter: { warmth: -19 } })

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await saved(page)
  expect((await scene(page)).style).toBeNull()
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await saved(page)
  await reloadSaved(page)
  await expect(page.getByText('已重新载入本地工程，本次选区和撤销记录已重置。', { exact: true })).toBeVisible({ timeout: 45000 })
  await saved(page)
  expect((await scene(page)).style).toEqual(adopted.style)
  expect(await canvasHash(map)).toBe(chosen)

  await styleTool(page)
  await compare.click()
  await pair()
  await page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '玩家', exact: true }).click()
  await expect(divider).toHaveCount(0)
  await expect(a).toHaveCount(0)
  await expect(b).toHaveCount(0)
  await expect(page.getByLabel('材质场景玩家预览', { exact: true })).toBeVisible()
  expect((await scene(page)).style).toEqual(adopted.style)
  expect(errors).toEqual([])
})

test('line art makes pale paper and dark contours and saves independently of the other side', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/#workspace')
  await expect(page.getByTestId('workspace-layout')).toBeVisible()
  await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).makeArtStyleRoom(), helperPath)
  await saved(page)
  const original = await scene(page)
  const map = page.getByLabel('材质场景主持人预览', { exact: true })
  const style = await styleTool(page)
  await painted(page)
  const rememberPaint = (label: string) => map.evaluate((canvas: HTMLCanvasElement, label) => {
    const copy = document.createElement('canvas')
    copy.width = canvas.width; copy.height = canvas.height
    const context = copy.getContext('2d', { willReadFrequently: true })!
    context.drawImage(canvas, 0, 0)
    Reflect.set(window, label, context.getImageData(0, 0, canvas.width, canvas.height))
  }, label)
  // The two DOM canvases can round antialiased RGB differently by one level.
  const expectPaint = async (canvas: Locator, label: string) => {
    const difference = await canvas.evaluate((canvas: HTMLCanvasElement, label) => {
      const original = Reflect.get(window, label) as ImageData
      const next = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      if (next.width !== original.width || next.height !== original.height) return { peak: 255, alphaChanges: -1 }
      let peak = 0, alphaChanges = 0
      for (let i = 0; i < next.data.length; i++) {
        const delta = Math.abs(next.data[i] - original.data[i])
        peak = Math.max(peak, delta)
        if (i % 4 === 3 && delta) alphaChanges++
      }
      return { peak, alphaChanges }
    }, label)
    expect(difference.peak).toBeLessThanOrEqual(1)
    expect(difference.alphaChanges).toBe(0)
  }
  await rememberPaint('__lineArtOriginal')
  const previewReady = () => expect(style.getByRole('button', { name: '采用画风', exact: true })).toBeEnabled({ timeout: 30000 })
  const line = style.getByRole('checkbox', { name: '线稿', exact: true })
  const inkAndPaper = () => map.evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
    let paper = 0, ink = 0, opaque = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) continue
      opaque++
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (brightness > 220) paper++
      if (brightness < 110) ink++
    }
    return { paper, ink, opaque }
  })
  await line.check()
  await previewReady()
  const applied = await inkAndPaper()
  expect(applied.paper).toBeGreaterThan(applied.opaque * .7)
  expect(applied.ink).toBeGreaterThan(500)
  await changeSlider(page, '墨线强度', 0)
  await previewReady()
  const pale = await inkAndPaper()
  expect(pale.opaque).toBe(applied.opaque)
  expect(pale.ink).toBeLessThan(applied.ink / 4)
  const effects = style.getByRole('checkbox', { name: '启用主题画法', exact: true })
  const filter = style.getByRole('checkbox', { name: '启用调色', exact: true })
  await effects.uncheck()
  await previewReady()
  const onlyColor = await canvasHash(map)
  await filter.uncheck()
  await previewReady()
  expect(await canvasHash(map)).not.toBe(onlyColor)
  await expectPaint(map, '__lineArtOriginal')
  await effects.check()
  await filter.check()
  await changeSlider(page, '墨线强度', 85)
  await changeSlider(page, '冷暖', 22)
  await previewReady()
  await rememberPaint('__lineArtPicked')

  await style.getByRole('button', { name: '两侧画风对比', exact: true }).click()
  await expect(style.getByRole('button', { name: 'B · 茶绘', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await line.check()
  await expect(style.getByRole('button', { name: 'B · 线稿 + 茶绘', exact: true })).toBeVisible()
  await changeSlider(page, '冷暖', -32)
  await style.getByRole('button', { name: 'A · 线稿', exact: true }).click()
  await expect(style.getByRole('slider', { name: '冷暖', exact: true })).toHaveValue('22')
  const adopt = style.getByRole('button', { name: '采用 A 侧为全图画风', exact: true })
  await expect(adopt).toBeEnabled({ timeout: 30000 })
  await expectPaint(page.getByLabel('画风 A 侧', { exact: true }), '__lineArtPicked')
  await adopt.click()
  await saved(page)
  const adopted = await scene(page)
  expect(adopted).toEqual({ ...original, revision: original.revision + 1, style: adopted.style })
  expect(adopted.style?.active).toBe('lineArt')
  expect(adopted.style?.presets.lineArt).toMatchObject({ filter: { warmth: 22 }, effects: { ink: 85 } })
  await expectPaint(map, '__lineArtPicked')
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await saved(page)
  await expectPaint(map, '__lineArtOriginal')
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await saved(page)
  await expectPaint(map, '__lineArtPicked')
  const privacy = await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).artStylePrivatePair(), helperPath)
  expect(privacy.samePlayer).toBe(true)
  expect(privacy.sameGm).toBe(false)
})

test('locally cleans an imported floor image and round-trips the original pixels and recipe', async ({ page, browser }, info) => {
  test.setTimeout(160_000)
  const network: string[] = []
  const localOrigin = new URL(info.project.use.baseURL!).origin
  page.on('request', request => {
    const url = new URL(request.url())
    if ((url.protocol === 'http:' || url.protocol === 'https:') && (url.origin !== localOrigin || url.pathname.includes('/image-edit'))) network.push(request.url())
  })
  await createKeyboardProject(page, '潮湾位图线稿', { widthMeters: 40, heightMeters: 32 })
  await page.evaluate(() => {
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }
    const { units, presetSnapshot } = workspace.getState().project!.document
    return workspace.execute([{
      type: 'setSceneDisplay', display: units.display, distanceMode: presetSnapshot.distanceMode,
      gridSizeMm: units.gridSizeMm, snapMm: units.snapMm, gridVisible: false,
    }])
  })
  await saved(page)
  const scenePanel = await openWorkspaceModule(page, '场景')
  await openDetailsBySummary(scenePanel, /^楼层底图$/)
  const artwork = scenePanel.getByLabel('楼层底图', { exact: true })
  await artwork.getByLabel('底图文件', { exact: true }).setInputFiles('public/assets/home-scenes/coast-stage1.png')
  await artwork.getByLabel('底图署名与来源', { exact: true }).fill('Sceneweave 潮湾样板成图')
  await artwork.getByLabel('底图许可', { exact: true }).fill('Sceneweave repository map artwork for local testing.')
  await artwork.getByLabel('允许将底图嵌入工程和出图', { exact: true }).check()
  await artwork.getByRole('button', { name: '预览更换底图', exact: true }).click()
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await saved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('coast-bitmap.sceneweave'))

  const style = await styleTool(page)
  const map = page.getByLabel('材质场景主持人预览', { exact: true })
  const original = await canvasHash(map)
  await style.getByRole('checkbox', { name: '线稿', exact: true }).check()
  const adopt = style.getByRole('button', { name: '采用画风', exact: true })
  await expect(adopt).toBeEnabled({ timeout: 45000 })
  expect(await canvasHash(map)).not.toBe(original)
  expectCoastLineMarks(await map.evaluate(coastLineMarks))

  await adopt.click()
  await saved(page)
  const player = page.waitForEvent('download', { timeout: 60000 })
  await (await mapExportButton(page, 'player')).click()
  const playerPath = info.outputPath('coast-bitmap-line-art-player.png')
  await (await player).saveAs(playerPath)
  const pngBytes = await readFile(playerPath)
  const output = page.locator('#coast-proof-png')
  const dimensions = await page.evaluate(async encoded => {
    const source = await fetch(`data:image/png;base64,${encoded}`)
    const png = await createImageBitmap(await source.blob())
    const canvas = window.document.createElement('canvas')
    canvas.id = 'coast-proof-png'
    const { width, height } = png
    canvas.width = 1200
    canvas.height = Math.round(height * canvas.width / width)
    canvas.hidden = true
    canvas.getContext('2d')!.drawImage(png, 0, 0, canvas.width, canvas.height)
    png.close()
    window.document.body.append(canvas)
    return { width, height }
  }, pngBytes.toString('base64'))
  try {
    expect(dimensions).toEqual({ width: 4096, height: 3277 })
    expectCoastLineMarks(await output.evaluate(coastLineMarks))
  } finally { await output.evaluate(canvas => canvas.remove()) }
  const path = info.outputPath('coast-bitmap-line-art.sceneweave')
  const after = await keyboardProjectBackup(page, path)
  expect(after.document.artStyle?.active).toBe('lineArt')
  expect(after.document.artStyle).toMatchObject({ version: 2, presets: { lineArt: { effects: { edgeDetail: 42, bitmapLineVersion: 2 } } } })
  expect(after.document.floors).toEqual(before.document.floors)
  expect(after.document.assets).toEqual(before.document.assets)
  const floor = Object.values(after.document.floors)[0]
  const hash = after.document.assets[floor.artwork!.assetId].sha256
  expect(after.hashes['assets/' + hash + '.png']).toBe(hash)
  expect(after.hashes['assets/' + hash + '.png']).toBe(before.hashes['assets/' + hash + '.png'])
  const cold = await browser.newPage()
  try {
    await cold.goto(new URL('./#home', info.project.use.baseURL!).href)
    await cold.getByTestId('native-project-file').setInputFiles(path)
    await saved(cold)
    expect((await scene(cold)).style).toEqual(after.document.artStyle)
  } finally {
    await cold.close()
  }
  expect(network).toEqual([])
})

test('copies custom channel curves without copying the theme effects, and saves the adopted curve', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  await page.goto('/#workspace')
  await expect(page.getByTestId('workspace-layout')).toBeVisible()
  await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).makeArtStyleRoom(), helperPath)
  await saved(page)
  const style = await styleTool(page)
  await style.getByRole('button', { name: '两侧画风对比', exact: true }).click()
  const side = (key: 'A' | 'B') => style.getByRole('group', { name: '选择调整哪一侧' }).getByRole('button', { name: new RegExp(`^${key} ·`) })
  const effects = style.getByRole('checkbox', { name: '启用主题画法', exact: true })
  const a = page.getByLabel('画风 A 侧', { exact: true }), b = page.getByLabel('画风 B 侧', { exact: true })
  const pair = async () => {
    await painted(page)
    await expect(page.getByLabel('两侧画风对比线', { exact: true })).toBeVisible()
    return Promise.all([canvasHash(a), canvasHash(b)])
  }
  await effects.uncheck()
  await style.getByText('曲线与更多调色', { exact: true }).click()
  const rgb = style.getByRole('group', { name: 'RGB 综合曲线图', exact: true })
  const notes = style.getByLabel('曲线输出', { exact: true })
  await rgb.getByRole('button', { name: /输入 128，/ }).focus()
  await notes.fill('164')
  await notes.press('Enter')
  const channel = (name: string) => style.getByRole('group', { name: '曲线通道', exact: true }).getByRole('button', { name, exact: true })
  await channel('绿').click()
  const green = style.getByRole('group', { name: '绿曲线图', exact: true })
  await green.click()
  await expect(green.locator('circle')).toHaveCount(3)
  await style.getByRole('button', { name: '删除控制点', exact: true }).click()
  await expect(green.locator('circle')).toHaveCount(2)
  await channel('蓝').click()
  const blue = style.getByRole('group', { name: '蓝曲线图', exact: true })
  await blue.click()
  const selected = blue.locator('circle[aria-pressed=true]')
  const handle = (await selected.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 20, { steps: 5 })
  await page.mouse.up()
  await expect(notes).not.toHaveValue('128')
  const point = { input: Number(await style.getByLabel('曲线输入', { exact: true }).inputValue()), output: Number(await notes.inputValue()) }
  expect(point.output).toBeLessThan(128)
  await style.getByRole('button', { name: '复制调色到 A 侧 · 手绘', exact: true }).click()
  await side('A').click()
  await expect(effects).toBeChecked()
  await effects.uncheck()
  const equal = await pair()
  expect(equal[0]).toBe(equal[1])
  await effects.check()
  await side('B').click()
  await expect(effects).not.toBeChecked()
  await effects.check()
  const themed = await pair()
  expect(themed[0]).not.toBe(themed[1])
  await page.screenshot({ path: info.outputPath('shared-curves-different-themes.png') })
  await style.getByRole('button', { name: '采用 B 侧为全图画风', exact: true }).click()
  await saved(page)
  const backupPath = info.outputPath('custom-curve-tea.sceneweave')
  const backup = await keyboardProjectBackup(page, backupPath)
  const adopted = backup.document.artStyle
  expect(adopted).toMatchObject({ version: 2, active: 'tea' })
  if (adopted?.version !== 2) throw new Error('Missing saved theme curve.')
  expect(adopted.presets.tea.filter.curves.rgb).toContainEqual({ input: 128, output: 164 })
  expect(adopted.presets.tea.filter.curves.blue).toContainEqual(point)
  const cold = await browser.newPage()
  try {
    await cold.goto(new URL('./#home', info.project.use.baseURL!).href)
    await cold.getByTestId('native-project-file').setInputFiles(backupPath)
    await saved(cold)
    expect((await scene(cold)).style).toEqual(adopted)
  } finally { await cold.close() }
})

test('keeps native road contours stable when adding a PNG and applies regional color after full line art', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/#workspace')
  await expect(page.getByTestId('workspace-layout')).toBeVisible()
  await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).makeArtStyleRoom(), helperPath)
  const result = await page.evaluate(async path => (await import(path) as typeof import('./helpers/art-style-browser')).verifyMixedLineArt(), helperPath)
  expect(result.remoteRoadChanged).toBe(0)
  expect(result.rugChanged).toBeGreaterThan(1000)
  expect(result.roadInk).toBeGreaterThan(200)
  expect(result.regionalChanged).toBeGreaterThan(1000)
  expect(result.outsideRegionChanged).toBe(0)
})
