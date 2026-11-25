import { expect, test, type Locator, type Page } from '@playwright/test'
import type { SceneDocument } from '../src/shared/model/scene'
import { pointInPolygon, terrainPoints } from '../src/shared/geometry/geometry'
import { openGenerationTask, openSceneObjects, openWorkspaceModule, setGenerationDimensions } from './workspace-navigation-helpers'

const current = (page: Page): Promise<SceneDocument> => page.evaluate(async () => {
  const path = '/src/editor/main/Workbench.tsx'
  const { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
  return structuredClone(nativeWorkspace.getState().project!.document)
})

async function saved(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
}

async function dragHandle(page: Page, handle: Locator, dx: number, dy: number) {
  await expect(handle).toBeVisible()
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid'), { x, y })
  expect(hit).toBe(await handle.getAttribute('data-testid'))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 6 })
  await page.mouse.up()
}

test('a generated island stays editable through the scene inspector and a reopened backup', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(15_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const setup = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await setup.getByLabel('场景名称', { exact: true }).fill('岩岛 · 页面编辑示例')
  await setup.getByLabel('常用画布尺寸', { exact: true }).selectOption('24000,18000')
  await setup.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await saved(page)
  await openGenerationTask(page, '自然地形')
  await page.getByRole('button', { name: '选择岩岛地形', exact: true }).click()
  await setGenerationDimensions(page, 24, 18)
  await page.getByLabel('地形方案种子', { exact: true }).fill('terrain-v1-0')
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  const addToCanvas = page.getByRole('button', { name: '加入当前画布', exact: true })
  await expect(addToCanvas).toBeVisible({ timeout: 90_000 })
  await addToCanvas.click()
  await expect(addToCanvas).toHaveCount(0, { timeout: 90_000 })
  await saved(page)

  const inspect = page.getByTestId('workspace-inspector')
  const outdoor = inspect.getByRole('region', { name: '室外对象属性', exact: true })
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const adopt = async (kind: '组件' | '视觉' | '室外') => {
    if (kind !== '组件') await review.getByLabel('确认完整影响范围', { exact: true }).check()
    await review.getByRole('button', { name: `采用${kind}修改`, exact: true }).click()
    await expect(review).toHaveCount(0)
    await saved(page)
  }
  const search = async (term: string, category: '结构' | '物件与装饰', id?: string) => {
    const objects = await openSceneObjects(page, category)
    await objects.getByLabel('搜索场景对象', { exact: true }).fill(term)
    return objects.locator(id ? `.asset-entity-list [data-entity-id="${id}"]` : '.asset-entity-list [data-entity-id]')
  }

  const initial = await current(page)
  const stone = Object.values(initial.props).find(prop => prop.definitionRef?.id === 'natural-stone-v1-weathered')!
  expect(stone).toBeDefined()
  await (await search('苔痕岩块', '物件与装饰', stone.id)).click()
  const position = inspect.getByRole('spinbutton', { name: '物件 X', exact: true })
  await position.fill(String((stone.positionMm.x + 120) / 1000))
  await position.press('Enter')
  await saved(page)
  expect((await current(page)).props[stone.id].positionMm).toEqual({ ...stone.positionMm, x: stone.positionMm.x + 120 })
  const rotation = inspect.getByRole('spinbutton', { name: '物件旋转', exact: true })
  const angle = Math.round(stone.rotationDeg + 15) % 360
  await rotation.fill(String(angle))
  await rotation.press('Enter')
  await expect.poll(async () => (await current(page)).props[stone.id].rotationDeg).toBe(angle)
  await saved(page)
  const variants = inspect.getByLabel('物件外观变体', { exact: true })
  await expect(variants.locator('optgroup[label="自然岩石"] option')).toHaveCount(5)
  await variants.selectOption('natural-stone-v1-slab')
  await inspect.getByRole('button', { name: '预览外观替换', exact: true }).click()
  await adopt('组件')
  expect((await current(page)).props[stone.id]).toMatchObject({
    definitionRef: { id: 'natural-stone-v1-slab', version: 1 }, supportRef: stone.supportRef,
    footprintMm: stone.footprintMm, blocksMovement: stone.blocksMovement, rotationDeg: angle,
  })

  const library = await openWorkspaceModule(page, '素材与布景')
  await library.getByLabel('素材来源', { exact: true }).selectOption('project')
  await library.getByLabel('搜索组件素材', { exact: true }).fill('自然岩石')
  await expect(library.locator('.catalog-entries [data-definition-id^="natural-stone-v1-"]')).toHaveCount(5)
  await library.getByRole('button', { name: '放置组件 潮磨卵石', exact: true }).click()
  const summit = Object.values(initial.terrainAreas).sort((left, right) => right.groundElevationMm - left.groundElevationMm)[0]
  const summitStair = Object.values(initial.terrainConnections).find(connection => connection.to.surfaceRef.id === summit.id)!
  const origin = { x: stone.positionMm.x - 1000, y: stone.positionMm.y + 600 }
  const support = `${stone.supportRef.kind}:${stone.supportRef.id}`
  const surfaces = inspect.getByLabel('放置表面', { exact: true })
  await expect(surfaces.getByRole('option', { name: '崖壁地形 · 0.800 m · 浅绿碎叶苔草', exact: true })).toHaveAttribute('value', support)
  await surfaces.selectOption(support)
  for (const [axis, value] of [['X', origin.x], ['Y', origin.y]] as const) {
    const coordinate = inspect.getByRole('spinbutton', { name: `放置 ${axis}`, exact: true })
    await coordinate.fill(String(value / 1000))
    await coordinate.press('Enter')
  }
  await inspect.getByRole('button', { name: '在此放置', exact: true }).click()
  await expect.poll(async () => Object.keys((await current(page)).props).length).toBe(Object.keys(initial.props).length + 1)
  await saved(page)
  const placed = Object.values((await current(page)).props).find(prop => !initial.props[prop.id])!
  expect(placed).toMatchObject({ definitionRef: { id: 'natural-stone-v1-cobble' }, positionMm: origin, supportRef: stone.supportRef })

  const reefRow = (await search('礁石', '结构')).filter({ hasText: '0.76 m' })
  await expect(reefRow).toHaveCount(1)
  const reefId = (await reefRow.getAttribute('data-entity-id'))!
  expect(reefId).toMatch(/^generated-/)
  const beforeReef = await current(page)
  const outline = outdoor.getByRole('region', { name: '地形轮廓', exact: true })
  const startContour = outline.getByRole('button', { name: '在画布调整轮廓', exact: true })
  const previewContour = outline.getByRole('button', { name: '预览轮廓修改', exact: true })
  await reefRow.click()
  await startContour.click()
  await expect(previewContour).toBeDisabled()
  await dragHandle(page, page.getByTestId('curve-handle-2-start'), 18, -12)
  await expect(outdoor.getByLabel('对象地形高程', { exact: true })).toBeDisabled()
  await saved(page)
  await page.screenshot({ path: info.outputPath('reef-contour.png') })
  await previewContour.click()
  await expect(review.getByRole('button', { name: '采用视觉修改', exact: true })).toBeDisabled()
  expect(await current(page)).toEqual(beforeReef)
  await review.getByRole('button', { name: '取消视觉预览', exact: true }).click()
  expect(await current(page)).toEqual(beforeReef)
  await reefRow.click()
  await startContour.click()
  await dragHandle(page, page.getByTestId('curve-handle-2-start'), 18, -12)
  await previewContour.click()
  await adopt('视觉')
  const reef = (await current(page)).terrainAreas[reefId]
  expect(reef.boundaryMm).not.toEqual(beforeReef.terrainAreas[reefId].boundaryMm)
  expect(reef.relief).toEqual(beforeReef.terrainAreas[reefId].relief)

  await (await search('崖壁', '结构', summit.id)).click()
  await outdoor.getByLabel('地形崖面画法', { exact: true }).selectOption('rockRelief7')
  await outdoor.getByRole('button', { name: '预览崖壁样式', exact: true }).click()
  await adopt('视觉')
  const styled = await current(page)
  const visual = styled.visual.base.base
  const cliffBoundary = Object.values(visual.boundaries).find(boundary => boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => side.areaId === summit.id))!
  expect(Object.values(visual.edgeLooks)).toContainEqual(expect.objectContaining({ boundaryId: cliffBoundary.id, kind: 'cliff', renderProfile: 'rockRelief7' }))
  expect(styled.terrainAreas[summit.id]).toEqual(initial.terrainAreas[summit.id])

  await (await search('台阶', '结构', summitStair.id)).click()
  await expect(outdoor.getByLabel('连接踏面风格', { exact: true })).toHaveValue('naturalRock')
  await outdoor.getByLabel('在画布调整路线节点', { exact: true }).check()
  await expect(page.getByTestId('curve-handle-0-control1')).toHaveCount(0)
  await dragHandle(page, page.getByTestId('curve-handle-0-start'), -4, 7)
  const widthMm = summitStair.widthMm - 80
  const width = outdoor.getByLabel('对象通路净宽', { exact: true })
  await width.fill(String(widthMm / 1000))
  await width.press('Enter')
  await outdoor.getByLabel('岩阶色调', { exact: true }).selectOption('naturalRockSteps8')
  await page.screenshot({ path: info.outputPath('stair-route.png') })
  await outdoor.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await adopt('室外')
  const edited = await current(page), editedStair = edited.terrainConnections[summitStair.id]
  expect(editedStair.from.positionMm.x).toBeLessThan(summitStair.from.positionMm.x)
  expect(editedStair.from.positionMm.y).toBeGreaterThan(summitStair.from.positionMm.y)
  expect(editedStair.from.surfaceRef).toEqual(summitStair.from.surfaceRef)
  expect(editedStair.to).toEqual(summitStair.to)
  expect(editedStair.widthMm).toBe(widthMm)
  expect(editedStair.route?.renderProfile).toBe('naturalRockSteps8')
  for (const end of [editedStair.from, editedStair.to]) {
    expect(pointInPolygon(end.positionMm, terrainPoints(edited.terrainAreas[end.surfaceRef.id]))).toBe(true)
  }

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await saved(page)
  expect((await current(page)).terrainConnections[summitStair.id]).toEqual(summitStair)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await saved(page)
  expect((await current(page)).terrainConnections[summitStair.id]).toEqual(editedStair)

  const output = info.outputPath('edited-island.sceneweave')
  const exportMenu = page.locator('details.workspace-export-menu')
  await exportMenu.locator('summary').click()
  const download = page.waitForEvent('download')
  await exportMenu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
  await (await download).saveAs(output)
  const cold = await browser.newContext()
  try {
    const reopened = await cold.newPage()
    reopened.on('pageerror', error => errors.push(error.message))
    await reopened.goto(new URL('/#home', page.url()).href)
    await reopened.getByTestId('native-project-file').setInputFiles(output)
    await saved(reopened)
    const restored = await current(reopened)
    const archived: SceneDocument = JSON.parse(JSON.stringify(edited))
    expect(restored.terrainAreas).toEqual(archived.terrainAreas)
    expect(restored.terrainConnections).toEqual(archived.terrainConnections)
    expect(restored.props).toEqual(archived.props)
    expect(restored.visual).toEqual(archived.visual)
    expect(restored.assets).toEqual(archived.assets)
    await reopened.screenshot({ path: info.outputPath('edited-island.png') })
  } finally { await cold.close() }
  expect(errors).toEqual([])
})
