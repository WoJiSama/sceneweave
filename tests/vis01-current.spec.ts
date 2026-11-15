import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSceneObjects, openSamples, openVisualTask } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const content = (scene: object) => {
  const { revision: _revision, updatedAt: _updatedAt, ...rest } = scene as Record<string, unknown>
  return rest
}
async function select(page: Page, id: string, category: Parameters<typeof openSceneObjects>[1] = '全部') {
  const panel = await openSceneObjects(page, category)
  await panel.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await panel.locator(`[data-entity-id="${id}"]`).click()
}
async function number(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(value)
  await field.press('Tab')
}
async function adopt(page: Page, kind: 'component' | 'structure' | 'visual' = 'component') {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  if (kind !== 'component') await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: { component: '采用组件修改', structure: '采用结构修改', visual: '采用视觉修改' }[kind], exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function undo(page: Page) {
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function picture(page: Page, path: string, audience: 'gm' | 'player') {
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(path)
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
}

test('VIS01 current production UI preserves angled openings, editable surfaces and actual prefab members through cold import', async ({ page, browser }, info) => {
  test.setTimeout(300000)
  const errors: string[] = [], events: unknown[] = []
  page.on('pageerror', error => errors.push(error.message))
  const backup = async (label: string) => {
    const path = info.outputPath(label + '.sceneweave'), saved = await keyboardProjectBackup(page, path)
    events.push({ label, path, revision: saved.document.revision })
    return saved
  }
  await createKeyboardProject(page, 'VIS01样板前当前工程')
  await openSamples(page)
  await page.getByRole('region', { name: '场景样板', exact: true }).getByRole('button', { name: '书房与露台', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  const initial = await backup('initial'), scene = initial.document
  expect(scene.exportBoundsMm).toEqual({ x: 0, y: 0, width: 14000, height: 10000 })
  expect(Object.values(scene.vertices).map(v => [v.xMm, v.yMm])).toEqual([[1000,1000],[8000,1000],[9000,2000],[9000,7000],[1000,7000]])
  expect(Object.values(scene.walls).every(wall => wall.thicknessMm === 200)).toBe(true)
  expect(scene.openings['diagonal-window']).toMatchObject({ wallId: 'study-w1', offsetReferenceVertexId: 'study-v1', offsetMm: 400, widthMm: 600 })
  expect(scene.openings['entrance-door'].widthMm).toBe(1000)
  expect(scene.openings['terrace-door'].widthMm).toBe(1200)
  expect(Object.keys(scene.props)).toHaveLength(13)
  expect(Object.keys(scene.prefabInstances['study-group'].members)).toHaveLength(6)
  expect(Object.keys(scene.prefabInstances['terrace-group'].members)).toHaveLength(3)
  for (const audience of ['gm', 'player'] as const) await picture(page, info.outputPath(`initial-${audience}-4096.png`), audience)

  // The candidate cannot commit either geometry or attached-window changes on cancellation.
  await select(page, 'study-v1', '顶点与边缘')
  await number(page, '建筑顶点 X', '7.8')
  await page.getByRole('button', { name: '预览顶点修改', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click()
  expect((await backup('vertex-cancelled')).hashes).toEqual(initial.hashes)
  await number(page, '建筑顶点 X', '7.8')
  await page.getByRole('button', { name: '预览顶点修改', exact: true }).click()
  await adopt(page, 'structure')
  const reshaped = await backup('vertex-adopted')
  expect(reshaped.document.vertices['study-v1'].xMm).toBe(7800)
  expect(reshaped.document.openings).toEqual(scene.openings)
  await page.screenshot({ path: info.outputPath('angled-wall-edited.png') })
  await undo(page)
  expect(content((await backup('vertex-undo')).document)).toEqual(content(scene))

  await select(page, 'study-w1', '结构')
  await page.getByRole('button', { name: '反转方向', exact: true }).click()
  await adopt(page, 'structure')
  const reversed = await backup('reversed-wall')
  expect(reversed.document.walls['study-w1'].startVertexId).toBe(scene.walls['study-w1'].endVertexId)
  expect(reversed.document.openings).toEqual(scene.openings)
  await undo(page)
  await number(page, '编辑墙厚', '25')
  await page.getByRole('button', { name: '预览墙厚修改', exact: true }).click()
  await adopt(page, 'structure')
  const thickened = await backup('wall-thickened')
  expect(thickened.document.walls['study-w1'].thicknessMm).toBe(250)
  expect(thickened.document.openings).toEqual(scene.openings)
  await undo(page)
  await select(page, 'terrace-v1', '顶点与边缘')
  await number(page, '轮廓点 X', '13200')
  await adopt(page)
  const terrace = await backup('terrace-edited')
  expect(terrace.document.terrainAreas['terrace-area'].boundaryMm[1].positionMm.x).toBe(13200)
  expect(terrace.document.props).toEqual(scene.props)
  await undo(page)

  await openVisualTask(page, '铺装')
  await page.getByLabel('视觉铺装对象', { exact: true }).selectOption('study-room')
  await page.getByLabel('视觉铺装底材', { exact: true }).selectOption('b2-m-02')
  await page.getByLabel('视觉纹理方向 °', { exact: true }).fill('90')
  await page.getByRole('button', { name: '预览铺装', exact: true }).click()
  await adopt(page, 'visual')
  const surface = await backup('surface-edited')
  expect(surface.document.rooms['study-room'].floorStyle?.base).toMatchObject({ materialRef: { id: 'b2-m-02', version: 1 }, rotationDeg: 90, tileSizeMm: { width: 2000, height: 2000 } })
  expect(surface.document.openings).toEqual(scene.openings)
  expect(surface.document.props).toEqual(scene.props)

  await select(page, 'study-group', '组合')
  await number(page, '组合 X', '3500')
  await keyboardWorkspaceSaved(page)
  const moved = await backup('group-moved')
  for (const member of Object.values(scene.prefabInstances['study-group'].members)) {
    const id = member.propId!
    expect(moved.document.props[id].positionMm).toEqual({ x: scene.props[id].positionMm.x + 500, y: scene.props[id].positionMm.y })
  }
  expect(moved.document.prefabInstances['terrace-group']).toEqual(scene.prefabInstances['terrace-group'])
  await number(page, '组合旋转', '15')
  await keyboardWorkspaceSaved(page)
  const rotated = await backup('group-rotated')
  expect(rotated.document.prefabInstances['study-group'].rotationDeg).toBe(15)
  for (const member of Object.values(scene.prefabInstances['study-group'].members)) expect(rotated.document.props[member.propId!].rotationDeg).toBe(15)
  await undo(page)
  expect(content((await backup('group-rotation-undo')).document)).toEqual(content(moved.document))
  await page.getByRole('button', { name: '拆开组合', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const unpacked = await backup('group-unpacked')
  expect(unpacked.document.prefabInstances['study-group']).toBeUndefined()
  expect(unpacked.document.props).toEqual(moved.document.props)
  await undo(page)
  expect((await backup('unpack-undo')).document.prefabInstances).toEqual(moved.document.prefabInstances)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await select(page, 'study-books-left', '物件与装饰')
  await number(page, '物件 X', '3.15')
  await keyboardWorkspaceSaved(page)
  const book = await backup('single-book-edited')
  expect(book.document.props['study-books-left'].positionMm.x).toBe(3150)
  expect(book.document.props['study-books-middle']).toEqual(moved.document.props['study-books-middle'])
  await select(page, 'study-chair', '物件与装饰')
  await page.getByLabel('物件外观变体', { exact: true }).selectOption('b2-p-03')
  await page.getByRole('button', { name: '预览外观替换', exact: true }).click()
  await adopt(page)
  const final = await backup('final'), chair = final.document.props['study-chair'], oldChair = book.document.props['study-chair']
  for (const key of ['positionMm', 'rotationDeg', 'footprintMm', 'footprintOffsetMm', 'visualBoundsMm', 'blocksMovement', 'blocksSight', 'supportRef', 'visibility'] as const) expect(chair[key]).toEqual(oldChair[key])
  expect(chair.appearance).not.toEqual(oldChair.appearance)
  expect(keyboardResourceHashes(final.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
  expect(final.document.vertices).toEqual(scene.vertices)
  expect(final.document.walls).toEqual(scene.walls)
  expect(final.document.openings).toEqual(scene.openings)
  expect(final.document.terrainAreas).toEqual(scene.terrainAreas)

  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.reload()
  await page.locator(`[data-project-key="native:${final.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await backup('cold')
  expect(cold.hashes).toEqual(final.hashes)
  for (const audience of ['gm', 'player'] as const) await picture(page, info.outputPath(`cold-${audience}-4096.png`), audience)
  await page.setViewportSize({ width: 390, height: 844 })
  await select(page, 'study-books-left', '物件与装饰')
  await expect(page.getByLabel('物件 X', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('narrow-390.png') })
  await closeWorkspaceDrawers(page)

  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const other = await context.newPage()
    other.on('pageerror', error => errors.push(error.message))
    await other.goto('./#home')
    await other.getByTestId('native-project-file').setInputFiles(info.outputPath('cold.sceneweave'))
    await keyboardWorkspaceSaved(other)
    const imported = await keyboardProjectBackup(other, info.outputPath('independent.sceneweave'))
    // A normal file import opens an independent project with fresh scene audit metadata.
    expect(imported.document.sceneId).not.toBe(cold.document.sceneId)
    expect(imported.document.revision).toBe(0)
    expect(imported.document.createdAt).toBe(imported.document.updatedAt)
    expect(content({ ...imported.document, sceneId: cold.document.sceneId, createdAt: cold.document.createdAt })).toEqual(content(cold.document))
    expect(Object.fromEntries(Object.entries(imported.hashes).filter(([key]) => !['scene.json', 'manifest.json'].includes(key))))
      .toEqual(Object.fromEntries(Object.entries(cold.hashes).filter(([key]) => !['scene.json', 'manifest.json'].includes(key))))
    await select(other, 'study-books-left', '物件与装饰')
    await number(other, '物件 X', '3.25')
    await keyboardWorkspaceSaved(other)
    const continued = await keyboardProjectBackup(other, info.outputPath('independent-continued.sceneweave'))
    expect(continued.document.props['study-books-left'].positionMm.x).toBe(3250)
    expect(continued.document.revision).toBe(imported.document.revision + 1)
    await undo(other)
    expect(content((await keyboardProjectBackup(other, info.outputPath('independent-undo.sceneweave'))).document)).toEqual(content(imported.document))
    await picture(other, info.outputPath('independent-player-4096.png'), 'player')
  } finally { await context.close() }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ browserVersion: browser.version(), events, errors, finalFile: info.outputPath('cold.sceneweave'), userP3: false }, null, 2) + '\n')
})
