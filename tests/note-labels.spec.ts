import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'vite'
import { readFile, writeFile } from 'node:fs/promises'
import { keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSceneObjects } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

async function picture(page: Page, path: string, audience: 'gm' | 'player') {
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(path)
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
}

test('co-located public names and attached GM detail remain readable and private through editing and cold import', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  let bytes: Uint8Array
  try {
    const { fixture, validation, runtime } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const bundle = fixture({ building: true }), scene = bundle.project.document
    scene.title = '同锚地标与附着线索'
    scene.units.gridVisible = false
    const base = { floorId: 'blank-floor', editLocked: false, kind: 'note', visibility: 'public' }
    scene.notes = {
      'a-room-name': { ...base, id: 'a-room-name', anchor: { type: 'entity', entityKind: 'room', entityId: 'room' }, text: '修缮间' },
      'b-room-use': { ...base, id: 'b-room-use', anchor: { type: 'entity', entityKind: 'note', entityId: 'a-room-name' }, text: '工具登记处' },
      'c-private': { ...base, id: 'c-private', visibility: 'gm', anchor: { type: 'entity', entityKind: 'note', entityId: 'b-room-use' }, text: '柜后留有一封旧信' },
    }
    for (const id of Object.keys(scene.notes)) scene.entityLayers[id] = scene.entityLayers.room
    Object.assign(bundle.project, createCompositionContent(scene, runtime))
    bytes = await exportProject(bundle, validation)
  } finally { await vite.close() }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await writeFile(info.outputPath('input.sceneweave'), bytes!)
  await page.goto('./#home')
  await page.getByTestId('native-project-file').setInputFiles({ name: 'room-notes.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes!) })
  await keyboardWorkspaceSaved(page)
  const initial = await keyboardProjectBackup(page, info.outputPath('initial.sceneweave'))
  for (const audience of ['gm','player'] as const) await picture(page, info.outputPath(`initial-${audience}-4096.png`), audience)
  // An actual independent room has a plain floor at this second label row.
  // The previous renderer leaves it blank because both names share one center.
  const bounds = initial.document.exportBoundsMm!
  const secondRowInk = await page.evaluate(async ({ png, bounds }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const x = Math.ceil((4500-bounds.x)/bounds.width*image.width)
    const y = Math.ceil((6670-bounds.y)/bounds.height*image.height)
    const right = Math.floor((8500-bounds.x)/bounds.width*image.width)
    const bottom = Math.floor((6890-bounds.y)/bounds.height*image.height)
    const rgba = context.getImageData(x, y, right-x, bottom-y).data
    let ink = 0
    for (let offset = 0; offset < rgba.length; offset += 4) {
      if (rgba[offset] < 110 && rgba[offset+1] < 115 && rgba[offset+2] < 110) ink++
    }
    return ink
  }, { png: (await readFile(info.outputPath('initial-player-4096.png'))).toString('base64'), bounds })
  await writeFile(info.outputPath('second-row.json'), JSON.stringify({ secondRowInk, rowWorldMm: { x: 4500, y: 6670, width: 4000, height: 220 } }, null, 2))
  expect(secondRowInk).toBeGreaterThan(20)
  const list = await openSceneObjects(page)
  await list.getByLabel('搜索场景对象', { exact: true }).fill('c-private')
  await list.locator('[data-entity-id="c-private"]').click()
  await expect(page.getByLabel('编辑注记类型', { exact: true })).toHaveValue('note')
  await expect(page.getByLabel('编辑注记标题', { exact: true })).toHaveValue('')
  await page.getByLabel('编辑注记类型', { exact: true }).selectOption('label')
  await expect(page.getByLabel('编辑注记标题', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('编辑注记内容', { exact: true })).toHaveValue(initial.document.notes['c-private'].text)
  await page.getByLabel('编辑注记类型', { exact: true }).selectOption('clue')
  await page.getByLabel('编辑注记标题', { exact: true }).fill('柜后的旧信')
  await page.getByLabel('编辑注记内容', { exact: true }).fill('新版主持人线索：信封来自昨日抵达的旅客')
  await page.getByRole('button', { name: '预览注记修改', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click()
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(initial.hashes)
  await page.getByLabel('编辑注记类型', { exact: true }).selectOption('clue')
  await page.getByLabel('编辑注记标题', { exact: true }).fill('柜后的旧信')
  await page.getByLabel('编辑注记内容', { exact: true }).fill('新版主持人线索：信封来自昨日抵达的旅客')
  await page.getByRole('button', { name: '预览注记修改', exact: true }).click()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const changed = await keyboardProjectBackup(page, info.outputPath('changed.sceneweave'))
  expect(changed.document.notes['c-private']).toEqual({ ...initial.document.notes['c-private'], kind: 'clue', title: '柜后的旧信', text: '新版主持人线索：信封来自昨日抵达的旅客' })
  expect(changed.document.notes['c-private'].anchor).toEqual(initial.document.notes['c-private'].anchor)
  expect(changed.document.notes['a-room-name']).toEqual(initial.document.notes['a-room-name'])
  expect(changed.document.notes['b-room-use']).toEqual(initial.document.notes['b-room-use'])
  for (const audience of ['gm','player'] as const) await picture(page, info.outputPath(`changed-${audience}-4096.png`), audience)
  expect(await readFile(info.outputPath('changed-player-4096.png'))).toEqual(await readFile(info.outputPath('initial-player-4096.png')))
  expect(await readFile(info.outputPath('changed-gm-4096.png'))).not.toEqual(await readFile(info.outputPath('initial-gm-4096.png')))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const final = await keyboardProjectBackup(page, info.outputPath('final.sceneweave'))
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.reload()
  await page.locator(`[data-project-key="native:${final.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))).hashes).toEqual(final.hashes)
  await page.setViewportSize({ width: 390, height: 844 })
  await closeWorkspaceDrawers(page)
  await page.screenshot({ path: info.outputPath('narrow-390.png') })
  const context = await browser.newContext()
  try {
    const other = await context.newPage()
    other.on('pageerror', error => errors.push(error.message))
    await other.goto('./#home')
    await other.getByTestId('native-project-file').setInputFiles(info.outputPath('cold.sceneweave'))
    await keyboardWorkspaceSaved(other)
    const imported = await keyboardProjectBackup(other, info.outputPath('independent.sceneweave'))
    expect(imported.document.notes).toEqual(final.document.notes)
    await picture(other, info.outputPath('independent-player-4096.png'), 'player')
    expect(await readFile(info.outputPath('independent-player-4096.png'))).toEqual(await readFile(info.outputPath('changed-player-4096.png')))
  } finally { await context.close() }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ browserVersion: browser.version(), secondRowInk, errors }, null, 2))
})
