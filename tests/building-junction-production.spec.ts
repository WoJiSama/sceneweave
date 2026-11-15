import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openBuildingTask, openSceneObjects } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>

function contents(document: Backup['document']) {
  const { revision: _revision, updatedAt: _updatedAt, ...value } = document
  return value
}
async function number(page: Page, name: string, value: number) {
  if (name.startsWith('房间起点')) {
    const details = page.locator('.building-panel form details').filter({ has: page.getByLabel(name, { exact: true }) })
    if (await details.getAttribute('open') === null) await details.locator('summary').click()
  }
  const input = page.getByLabel(name, { exact: true })
  await input.fill(String(value)); await input.press('Tab')
}
async function adopt(page: Page) {
  await page.getByLabel('确认完整影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function select(page: Page, id: string) {
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}
async function detail(page: Page, name: string) {
  const target = page.getByLabel('建筑属性', { exact: true }).locator('details').filter({ has: page.getByText(name, { exact: true }) })
  if (await target.getAttribute('open') === null) await target.locator('summary').click()
}
async function exportPictures(page: Page, info: TestInfo, phase: string) {
  const pictures = []
  for (const audience of ['gm', 'player'] as const) {
    const downloading = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
    const path = info.outputPath(`${phase}-${audience}-4096.png`)
    await (await downloading).saveAs(path); await keyboardWorkspaceSaved(page)
    await page.locator('.workspace-export-menu > summary').click()
    const png = PNG.sync.read(await readFile(path))
    expect(Math.max(png.width, png.height)).toBe(4096)
    pictures.push({ audience, width: png.width, height: png.height, rgbaSha256: createHash('sha256').update(png.data).digest('hex') })
  }
  return pictures
}

// State assertions use actual UI downloads. No DEV handles, source imports in
// the page, or database fixture writes are needed by this production journey.
test('normal building junction repair preserves a real door through preview, atomic adoption, undo, redo and cold reopen', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  let serial = 0
  const backup = (label: string) => keyboardProjectBackup(page, info.outputPath(`${++serial}-${label}.sceneweave`))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('建筑接点与真实门洞 · 生产入口核对')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18')
  await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await keyboardWorkspaceSaved(page); await expect(dialog).toHaveCount(0)

  async function rectangle(name: string, x: number, y: number, width: number, height: number) {
    await openBuildingTask(page)
    await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
    await page.getByLabel('房间名称', { exact: true }).fill(name)
    for (const [label, value] of [['房间起点 X', x], ['房间起点 Y', y], ['房间宽度', width], ['房间高度', height]] as const) await number(page, label, value / 1000)
    await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
    const state = await backup(name)
    return Object.values(state.document.rooms).find(room => room.purpose === name)!.id
  }
  const targetId = await rectangle('接入目标', 2000, 2000, 6000, 4000)
  const sourceId = await rectangle('待拆独立墙', 10000, 4000, 3000, 3000)
  const drawn = await backup('two-rooms'), document = drawn.document
  const targetWall = Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].xMm === 8000 && document.vertices[wall.endVertexId].xMm === 8000)!
  const sourceWall = Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].xMm === 10000 && document.vertices[wall.startVertexId].yMm === 4000 && document.vertices[wall.endVertexId].xMm === 13000)!
  expect(targetWall).toBeTruthy(); expect(sourceWall).toBeTruthy()
  await select(page, targetWall.id)
  await number(page, '开口近端偏移', 2.5)
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
  await select(page, sourceId); await detail(page, '删除房间')
  await page.getByRole('button', { name: '预览删除房间', exact: true }).click(); await adopt(page)
  await select(page, sourceWall.id); await detail(page, '平移整面墙')
  await number(page, '墙平移 X', -2)
  const before = await backup('before-repair'), opening = Object.values(before.document.openings)[0]
  expect(opening).toBeTruthy()
  expect(before.document.rooms[targetId].boundaryVertexIds).toHaveLength(4)
  await page.getByRole('button', { name: '预览平移并修复接点', exact: true }).click()
  await expect(page.getByLabel('待采用建筑操作 ID', { exact: true })).toHaveValue(new RegExp(targetId))
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await backup('preview-cancelled')).hashes).toEqual(before.hashes)
  await page.getByRole('button', { name: '预览平移并修复接点', exact: true }).click()
  await expect(page.getByLabel('待采用建筑操作 ID', { exact: true })).toHaveValue(new RegExp(targetId))
  await adopt(page)
  const adopted = await backup('adopted'), mapped = adopted.document.openings[opening.id]
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(adopted.document.rooms[targetId].boundaryVertexIds).toHaveLength(5)
  expect(mapped.wallId).not.toBe(opening.wallId)
  expect(mapped.offsetReferenceVertexId).toBe(sourceWall.startVertexId)
  expect(mapped.offsetMm).toBe(500)
  expect(mapped.widthMm).toBe(opening.widthMm)
  expect(adopted.document.walls[mapped.wallId].startVertexId).toBe(sourceWall.startVertexId)
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await backup('undone')
  expect(undone.document.revision).toBe(adopted.document.revision + 1)
  expect(contents(undone.document)).toEqual(contents(before.document))
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await backup('redone')
  expect(redone.document.revision).toBe(undone.document.revision + 1)
  expect(contents(redone.document)).toEqual(contents(adopted.document))
  const beforeColdPictures = await exportPictures(page, info, 'redone')

  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await backup('cold')
  expect(cold.hashes).toEqual(redone.hashes)
  const coldPictures = await exportPictures(page, info, 'cold')
  expect(coldPictures).toEqual(beforeColdPictures)
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ sceneId: cold.document.sceneId, targetId, sourceWallId: sourceWall.id,
    openingId: opening.id, beforeRevision: before.document.revision, adoptedRevision: adopted.document.revision,
    coldRevision: cold.document.revision, beforeColdPictures, coldPictures, errors }, null, 2))
  expect(errors).toEqual([])
})
