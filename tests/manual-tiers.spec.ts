import { openWorkspaceModule } from './workspace-navigation-helpers'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { createServer } from 'vite'

const TITLE = 'T2 普通事务分档自检'

async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90000 })
}
async function backup(page: Page, file: string) {
  const menu = page.locator('.workspace-export-menu')
  if (!await menu.evaluate(node => (node as HTMLDetailsElement).open)) await menu.locator('summary').click()
  const pending = page.waitForEvent('download')
  await menu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
  await (await pending).saveAs(file); await saved(page)
  const files = unzipSync(new Uint8Array(await readFile(file)))
  return JSON.parse(new TextDecoder().decode(files['scene.json']))
}

test('normal UI moves 500 layer members in one frozen tier and preserves undo, redo and cold reopen', async ({ page }, info) => {
  test.setTimeout(240000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  // SSR prepares an ordinary project file; all editing, review, persistence and
  // readback below use the normal production UI and exported project bytes.
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  let bytes: Uint8Array, layerId: string, layerName: string
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture({ image: true }), scene = source.project.document, prop = scene.props.item
    layerId = scene.entityLayers.item
    layerName = scene.userLayers[layerId].name
    scene.title = TITLE
    scene.props = {}; scene.entityLayers = {}
    scene.userLayers.target = { id: 'target', floorId: 'blank-floor', name: '分档目标', order: 1, editLocked: false }
    for (let index = 0; index < 500; index++) {
      const id = `dense-${index}`
      scene.props[id] = { ...structuredClone(prop), id, positionMm: { x: 1000 + index % 25 * 300, y: 1000 + Math.floor(index / 25) * 300 } }
      scene.entityLayers[id] = layerId
    }
    Object.assign(source.project, createCompositionContent(scene, runtime))
    bytes = await exportProject(source, validation)
  } finally { await vite.close() }
  await page.goto('./#home')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles({ name: 'manual-tier.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await saved(page)
  await openWorkspaceModule(page, '场景')
  const layers = page.getByRole('region', { name: '用户图层', exact: true })
  await layers.getByRole('button', { name: `查看图层 ${layerName}`, exact: true }).click()
  const drawingLayer = layers.getByRole('button', { name: `设为绘制图层 ${layerName}`, exact: true })
  if (await drawingLayer.getAttribute('aria-pressed') !== 'true') await drawingLayer.click()
  await expect(drawingLayer).toHaveAttribute('aria-pressed', 'true')
  await layers.getByRole('button', { name: `选择图层成员 ${layerName}`, exact: true }).click()
  await expect(layers.getByRole('button', { name: '移动所选到图层 · 500', exact: true })).toBeEnabled()
  await layers.getByRole('button', { name: '移动所选到图层 · 500', exact: true }).click()
  await layers.getByLabel('图层操作目标', { exact: true }).selectOption('target')
  await layers.getByRole('button', { name: '预览图层修改', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  await review.locator('details.composition-preview-details > summary').click()
  const details = page.getByLabel('普通事务保护详情', { exact: true })
  await expect(details).not.toHaveAttribute('open', '')
  await details.locator('summary').click()
  await expect(details.getByText('编辑目标', { exact: true })).toBeVisible()
  await expect(details).toContainText('500 / 512')
  await page.getByRole('button', { name: '采用图层修改', exact: true }).click(); await saved(page)
  const first = await backup(page, info.outputPath('adopted.sceneweave'))
  expect(first.revision).toBe(1); expect(Object.keys(first.props)).toHaveLength(500)
  expect(Object.values(first.entityLayers).every(id => id === 'target')).toBe(true)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const undone = await backup(page, info.outputPath('undone.sceneweave'))
  expect(undone.revision).toBe(2); expect(Object.values(undone.entityLayers).every(id => id === layerId)).toBe(true)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  await page.screenshot({ path: info.outputPath('manual-tier.png'), fullPage: true })
  await page.reload()
  await page.goto('./#home')
  await page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: TITLE, exact: true }) })
    .getByRole('button', { name: '打开', exact: true }).click()
  await saved(page)
  const cold = await backup(page, info.outputPath('cold.sceneweave'))
  expect(cold.revision).toBe(3); expect(cold.props).toEqual(first.props); expect(cold.entityLayers).toEqual(first.entityLayers)
  expect(JSON.stringify(cold)).not.toContain('budgetProfile'); expect(errors).toEqual([])
})
