import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

async function openTavern(page: Page) {
  await page.goto('./#home')
  await page.locator('article[data-sample="fantasy"]').getByRole('button', { name: '余烬酒馆与旅舍', exact: true }).click()
  await page.getByRole('dialog', { name: '确认打开工程', exact: true }).getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

test('fine texture detail converges when zoomed out and transparent paint keeps its pigment', async ({ page }) => {
  await page.goto('./#home')
  const samples = await page.evaluate(async () => {
    const meshModule = '/src/platform/browser/render/oblique-mesh.ts'
    const { ObliqueMesh, mountObliqueMesh } = await import(meshModule)
    const canvas = (width: number, height: number) => Object.assign(document.createElement('canvas'), { width, height })
    const source = canvas(510, 318), paint = source.getContext('2d')!
    const bounds = { x: 0, y: 0, width: 2600, height: 2600 }
    const render = () => {
      const mesh = new ObliqueMesh()
      mesh.quad({ image: source, unlit: true }, [[0, 0, 0], [2600, 0, 0], [2600, 2600, 0], [0, 2600, 0]])
      const target = canvas(96, 96)
      const read = canvas(96, 96).getContext('2d')!
      const view = mountObliqueMesh(target, mesh, bounds, [1, 1, 1], [0, .24, .33])
      try {
        view.draw({ azimuthDeg: 32, elevationDeg: 46, zoom: .83 })
        read.drawImage(target, 0, 0)
        return read
      } finally { view.dispose() }
    }
    paint.fillStyle = '#000'
    paint.fillRect(0, 0, source.width, source.height)
    paint.fillStyle = '#fff'
    for (let x = 0; x < source.width; x += 2) paint.fillRect(x, 0, 1, source.height)
    const bands = Array.from(render().getImageData(36, 36, 24, 24).data).filter((_, i) => i % 4 === 0)
    paint.clearRect(0, 0, source.width, source.height)
    paint.fillStyle = '#ff9a48'
    paint.beginPath()
    paint.ellipse(255, 159, 186, 106, 0, 0, Math.PI * 2)
    paint.fill()
    const { data } = render().getImageData(0, 0, 96, 96)
    let darkFringe = 0
    for (let i = 0; i < data.length; i += 4) {
      const [r, g] = [data[i], data[i + 1]]
      if (r > 55 && g < 61 + r / 255 * 93 - 5) darkFringe++
    }
    return { min: Math.min(...bands), max: Math.max(...bands), darkFringe }
  })
  expect(samples.min).toBeGreaterThan(113)
  expect(samples.max).toBeLessThan(142)
  expect(samples.darkFringe).toBe(0)
})

test('sample opens on the editable plane, rotates on demand, and exports the current camera', async ({ page }, info) => {
  test.setTimeout(120_000)
  await openTavern(page)
  const workbench = page.getByTestId('outdoor-workbench'), trigger = workbench.getByRole('button', { name: '斜俯视', exact: true })
  await expect(workbench.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(page.locator('.oblique-stage canvas')).toHaveCount(0)
  const revision = await workbench.getAttribute('data-revision')
  await trigger.click()
  const preview = page.getByRole('dialog', { name: '斜俯视', exact: true })
  const canvas = preview.locator('canvas')
  await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 40_000 })
  const pixels = () => canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL())
  const first = await pixels()
  await canvas.focus()
  await canvas.press('ArrowRight')
  await expect.poll(pixels).not.toBe(first)
  await preview.getByRole('slider', { name: '3D 缩放' }).fill('2.35')
  await expect.poll(pixels).not.toBe(first)
  await page.screenshot({ path: info.outputPath('tavern-oblique-editor.png') })
  const downloadEvent = page.waitForEvent('download')
  await preview.getByRole('button', { name: '导出当前画面' }).click()
  const file = await downloadEvent
  expect(file.suggestedFilename()).toMatch(/-3D\.png$/)
  expect(await file.failure()).toBeNull()
  const exported = info.outputPath('tavern-current-angle.png')
  await file.saveAs(exported)
  const png = await readFile(exported)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.readUInt32BE(16)).toBe(2560)
  await preview.getByRole('button', { name: '返回俯视' }).click()
  await expect(preview).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(workbench).toHaveAttribute('data-revision', revision!)
  await trigger.click()
  await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 40_000 })
  expect(await pixels()).toBe(first)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
})

test('a tavern box lid supports a new lamp and shows the snap when the lamp is dragged back', async ({ page }, info) => {
  test.setTimeout(160_000)
  page.setDefaultTimeout(20_000)
  await openTavern(page)
  const boxId = 'interior-f24de85621df9ee6891aeb2adfb29e08a35893d1'
  await selectKeyboardProp(page, boxId)
  const inspector = page.getByTestId('workspace-inspector')
  await openDetailsBySummary(inspector, /^立体形状$/)
  await inspector.getByLabel('立体结构模板', { exact: true }).selectOption('box')
  await expect(inspector.getByRole('checkbox', { name: '箱顶可放物件', exact: true })).toBeChecked()
  const height = inspector.getByLabel('立体高度', { exact: true })
  await height.fill('0.79'); await height.press('Tab')
  await inspector.getByRole('button', { name: '预览立体设置', exact: true }).click()
  const apply = async () => {
    const review = page.getByRole('region', { name: '候选审阅', exact: true })
    await review.getByLabel('确认完整影响范围', { exact: true }).check({ timeout: 15_000 })
    await review.getByRole('button', { name: '采用视觉修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  await apply()
  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('锻铁六角提灯')
  await library.getByRole('button', { name: '放置组件 锻铁六角提灯', exact: true }).click()
  await expect(page.getByRole('button', { name: '在此放置', exact: true })).toBeEnabled()
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  const world = { x: 0, y: 0, width: 17_500, height: 15_000 }
  const fit = async () => {
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    const area = await canvas.boundingBox()
    expect(area).toBeTruthy()
    return ({ x, y }: { x: number; y: number }) => ({ x: area!.x + (x - world.x) * area!.width / world.width,
      y: area!.y + (y - world.y) * area!.height / world.height })
  }
  const pointer = await fit(), drop = pointer({ x: 15090, y: 7905 })
  await page.mouse.move(drop.x, drop.y)
  await expect(page.locator('[data-prop-top-snap]')).toBeVisible()
  await page.mouse.click(drop.x, drop.y)
  await keyboardWorkspaceSaved(page)
  const initial = await keyboardProjectBackup(page, info.outputPath('lamp-placed.sceneweave'))
  expect(initial.document.props[boxId].volume).toEqual({ kind: 'box', heightMm: 790 })
  const lid = Object.values(initial.document.attachmentSurfaces!).find(surface => surface.owner.id === boxId)!
  const first = Object.values(initial.document.attachments!).find(relation => relation.mode === 'support' && relation.surfaceId === lid.id)!
  expect(first).toMatchObject({ mode: 'support', follow: 'follow', materialized: { contactElevationMm: 790 } })
  const lampId = first.child.id
  expect(initial.document.props[lampId].supportRef).toEqual(initial.document.props[boxId].supportRef)

  await selectKeyboardProp(page, lampId)
  await openDetailsBySummary(inspector, /^承托与挂接$/)
  await inspector.getByRole('button', { name: '预览解除附着', exact: true }).click()
  await apply()
  const x = inspector.getByLabel('物件 X', { exact: true })
  await x.fill('13.7'); await x.press('Tab')
  await keyboardWorkspaceSaved(page)
  const dragPointer = await fit(), start = dragPointer({ x: 13700, y: initial.document.props[lampId].positionMm.y })
  const end = dragPointer(initial.document.props[boxId].positionMm)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await expect(page.getByTestId('selection-drag-status')).toContainText('已对准承托面')
  await page.screenshot({ path: info.outputPath('tavern-lid-snap.png') })
  await page.mouse.up()
  await apply()
  const attached = await keyboardProjectBackup(page, info.outputPath('lamp-snapped.sceneweave'))
  const relation = Object.values(attached.document.attachments!).find(row => row.child.id === lampId)!
  expect(relation).toMatchObject({ surfaceId: lid.id, mode: 'support', materialized: { contactElevationMm: 790 } })
  await selectKeyboardProp(page, boxId)
  await x.fill('14.69'); await x.press('Tab')
  await keyboardWorkspaceSaved(page)
  const moved = await keyboardProjectBackup(page, info.outputPath('crate-moved.sceneweave'))
  expect(moved.document.props[lampId].positionMm.x).toBe(attached.document.props[lampId].positionMm.x - 400)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${moved.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('crate-reopened.sceneweave'))).hashes).toEqual(moved.hashes)
})

test('the natural volcano can be downloaded and reopened with the same editable relief in both views', async ({ page }, info) => {
  test.setTimeout(150_000)
  await createKeyboardProject(page, '火山生成入口检查')
  await openWorkspaceModule(page, '素材')
  const themes = page.getByRole('region', { name: '主题素材包', exact: true })
  await themes.locator(':scope > details > summary').click()
  await openDetailsBySummary(themes, /^火山 ·/)
  const downloading = page.waitForEvent('download', { timeout: 90_000 })
  await themes.getByRole('button', { name: '下载场景 · 自然火口与熔岩池', exact: true }).click()
  const archive = info.outputPath('natural-volcano.sceneweave')
  await (await downloading).saveAs(archive)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(archive)
  await keyboardWorkspaceSaved(page)
  const reopened = await keyboardProjectBackup(page, info.outputPath('natural-volcano-reopened.sceneweave'))
  expect(reopened.document.title).toBe('灰脊火口 · 自然岩坡与熔岩池')
  const shaped = Object.values(reopened.document.terrainAreas).filter(area => area.relief)
  expect(shaped).toHaveLength(2)
  expect(shaped.every(area => new Set(area.relief!.offsetsMm).size > 2)).toBe(true)
  await page.screenshot({ path: info.outputPath('natural-volcano-top.png') })
  await page.getByRole('button', { name: '斜俯视', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '斜俯视', exact: true })
  await expect(dialog.locator('canvas')).toHaveAttribute('data-ready', 'true', { timeout: 40_000 })
  await page.screenshot({ path: info.outputPath('natural-volcano-oblique.png') })
})

test('terrain brush marks the fixed steps before applying the stroke and preserves them on request', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./#home')
  await page.locator('article[data-sample="volcano"]').getByRole('button', { name: '灰脊火口观测步道', exact: true }).click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const readProject = async (name: string) => (await keyboardProjectBackup(page, info.outputPath(name + '.sceneweave'))).document
  const scene = await readProject('volcano-before-stroke')
  const mountain = Object.values(scene.terrainAreas).find(row => row.relief && row.groundElevationMm > 0)!
  const resources = await openWorkspaceModule(page, '场景')
  const allLayers = resources.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await allLayers.isVisible()) await allLayers.click()
  await resources.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  await resources.getByLabel('搜索场景对象', { exact: true }).fill(mountain.id)
  await resources.locator(`[data-entity-id="${mountain.id}"]`).click()
  await openWorkspaceModule(page, '地形')
  await page.getByRole('button', { name: '起伏笔刷', exact: true }).click()
  const tools = page.getByRole('region', { name: '起伏笔刷设置' })
  const amount = tools.getByLabel('每笔高程变化（负数下挖）', { exact: true })
  await amount.fill('-0.55')
  await amount.press('Tab')
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  const world = scene.exportBoundsMm
  const pointer = (x: number, y: number) => ({ x: box!.x + box!.width * (x - world.x) / world.width, y: box!.y + box!.height * (y - world.y) / world.height })
  const from = pointer(12450, 18900), to = pointer(13450, 20450)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  const conflict = page.locator('[data-stair-support="conflict"]').first()
  await expect(conflict).toBeInViewport()
  await page.screenshot({ path: info.outputPath('volcano-stair-conflict.png') })
  await page.mouse.up()
  await tools.getByRole('button', { name: '保留阶下岩土' }).click()
  await expect(page.locator('[data-stair-support="preserve"]').first()).toBeVisible()
  await tools.getByRole('button', { name: '预览这笔起伏' }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const changed = await readProject('volcano-protected-stroke')
  expect(changed.terrainAreas[mountain.id].relief).not.toEqual(mountain.relief)
  expect(changed.terrainConnections).toEqual(scene.terrainConnections)
  await page.getByRole('button', { name: '撤销编辑' }).click()
  await keyboardWorkspaceSaved(page)
  expect((await readProject('volcano-undone-stroke')).terrainAreas[mountain.id].relief).toEqual(mountain.relief)
})
