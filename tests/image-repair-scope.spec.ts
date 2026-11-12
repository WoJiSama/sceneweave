import { expect, test, type Locator } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { writeImageWorkPackage, readImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'
import { createKeyboardProject, keyboardWorkspaceSaved, keyboardProjectBackup, selectKeyboardProp, openKeyboardPanel, keyboardResourceHashes } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 80
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
async function clickPoint(dialog: Locator, x: number, y: number) {
  const canvas = dialog.getByLabel('图片标注画布', { exact: true }), bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas missing')
  await canvas.click({ position: { x: x / width * bounds.width, y: y / height * bounds.height } })
}
async function exportWork(dialog: Locator, filename: string) {
  const event = dialog.page().waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  await (await event).saveAs(filename)
  return readImageWorkPackage(new Uint8Array(await readFile(filename)))
}

test('independent repair scopes resume unfinished points, preserve selection and survive adoption, movement, undo and cold save', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set(x >= 52 && x < 66 && y >= 20 && y < 40 ? [95, 50, 25, 255] : y % 10 === 0 ? [30, 26, 22, 255] : [100 + x % 4, 85 + y % 10, 70, 255], (y * width + x) * 4)
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  const selectionMask = { x: 55, y: 24, width: 8, height: 12, runs: [96, 255] }
  const state: ImageWorkState = { format: 'sceneweave-image-work', version: 1, id: 'repair-scope-ui', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height }, original: { name: 'wood.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    draft: { title: '椅子露木板测试', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 }, roomPointsPx: rect(6, 6, width - 12, height - 12), sourceBoundaryPx: rect(0, 0, width, height), layers: [] },
    active: { name: '椅子', polygon: rect(55, 24, 8, 12), donor: [{ x: 4, y: 8 }, { x: 40, y: 64 }], renderLayer: 'object', blocksMovement: true, repair: 'context', selectionMask },
    rights: { attribution: 'Original synthetic test', licenseText: 'CC0 synthetic pixels', canEmbed: true }, notes: '', nextAction: '圈移除和保护范围', scaleStatus: 'provisional', journal: [], reviews: [] }
  const pack = await writeImageWorkPackage(state, bytes, bytes)
  await createKeyboardProject(page, '保留旧工程')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles({ name: 'wood.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(pack) })
  await dialog.getByRole('button', { name: '画移除范围', exact: true }).click()
  await clickPoint(dialog, 52, 20); await clickPoint(dialog, 68, 20)
  const incomplete = await exportWork(dialog, info.outputPath('incomplete.sceneweave-image-work'))
  expect(incomplete.state.active?.removalPointsPx).toHaveLength(2)
  expect(incomplete.state.active?.removalMask).toBeUndefined()
  await expect(dialog.getByRole('status').filter({ hasText: '制作进度已保存' })).toBeVisible({ timeout: 20000 })
  await page.reload()
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByRole('button', { name: '继续上次拆分', exact: true }).click()
  await dialog.getByRole('button', { name: '画移除范围', exact: true }).click()
  await clickPoint(dialog, 68, 40); await clickPoint(dialog, 52, 40)
  await dialog.getByRole('button', { name: '画保护范围', exact: true }).click()
  for (const p of rect(66, 20, 4, 20)) await clickPoint(dialog, p.x, p.y)
  await dialog.getByRole('button', { name: '清除保护范围', exact: true }).click()
  await dialog.getByRole('button', { name: '撤销标注', exact: true }).click()
  const complete = await exportWork(dialog, info.outputPath('scopes.sceneweave-image-work'))
  expect(complete.state.active?.selectionMask).toEqual(selectionMask)
  expect(complete.state.active?.removalMask).toMatchObject({ x: 52, y: 20, width: 16, height: 20 })
  expect(complete.state.active?.protectionMask).toMatchObject({ x: 66, y: 20, width: 4, height: 20 })
  await dialog.screenshot({ path: info.outputPath('scope-overlay.png') })
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(dialog.getByRole('status').filter({ hasText: '已拆出原始像素' })).toBeVisible()
  const applied = await exportWork(dialog, info.outputPath('applied.sceneweave-image-work'))
  expect(applied.state.draft.layers[0].selectionMask).toEqual(selectionMask)
  expect(applied.state.draft.layers[0].removalMask).toEqual(complete.state.active!.removalMask)
  expect(applied.state.draft.layers[0].protectionMask).toEqual(complete.state.active!.protectionMask)
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  const chairDefinition = Object.values(original.document.propDefinitions).find(row => row.name === '椅子')!
  const chair = Object.values(original.document.props).find(row => row.definitionRef?.id === chairDefinition.id)!
  await selectKeyboardProp(page, chair.id)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByLabel('物件 X', { exact: true }).fill(String((chair.positionMm.x + 100) / 1000))
  await inspector.getByLabel('物件 X', { exact: true }).press('Enter'); await keyboardWorkspaceSaved(page)
  const movedFile = info.outputPath('moved.sceneweave'), moved = await keyboardProjectBackup(page, movedFile)
  expect(moved.document.props[chair.id].positionMm.x).toBe(chair.positionMm.x + 100)
  expect(keyboardResourceHashes(moved.hashes)).toEqual(keyboardResourceHashes(original.hashes))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.props[chair.id].positionMm).toEqual(chair.positionMm)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${moved.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.document.props[chair.id]).toEqual(moved.document.props[chair.id])
  const context = await browser.newContext()
  try {
    const fresh = await context.newPage(); await fresh.goto('/')
    await fresh.getByRole('button', { name: '从图片新建场景', exact: true }).click()
    const restored = fresh.getByRole('dialog', { name: '图片导入工作台', exact: true })
    await restored.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(info.outputPath('scopes.sceneweave-image-work'))
    const back = await exportWork(restored, info.outputPath('cold-work.sceneweave-image-work'))
    expect(back.state.active).toEqual(complete.state.active)
  } finally { await context.close() }
})
