import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { decodeCanonicalPng } from '../src/shared/project/png-rgba'
import { keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openOutdoorTask, openSceneObjects } from './workspace-navigation-helpers'

test('an in-map partition focuses, updates membership and crops a public PNG without changing the continuous road', async ({ page }, info) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(12000)
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { prepareCompositionCommands } = await vite.ssrLoadModule('/src/application/workspace/prepare.ts')
    const { fromBundle, toBundle } = await vite.ssrLoadModule('/src/application/workspace/project.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const project = await fromBundle(fixture(), validation), floorId = 'blank-floor', layerId = project.document.entityLayers.item
    const p = (x: number, y: number) => ({ x, y })
    const staged = await prepareCompositionCommands(project, [
      { type: 'createRegion', id: 'market', floorId, layerId, kind: 'partition', name: '市集', boundaryMm: [p(2000, 2000), p(7000, 2000), p(7000, 7000), p(2000, 9000)] },
      { type: 'createRegion', id: 'shore', floorId, layerId, kind: 'partition', name: '河岸', boundaryMm: [p(7000, 2000), p(11000, 2000), p(11000, 8000), p(7000, 7000)] },
      { type: 'createPath', id: 'market-road', floorId, layerId, widthMm: 1000, centerlineMm: [p(3500, 5200), p(14500, 5200)], supportRefs: [{ kind: 'floor', id: floorId }] },
    ], { runtime, validation })
    archive = await exportProject(toBundle(staged), validation)
  } finally { await vite.close() }
  await page.goto('./#home')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles({ name: 'partitions.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const inspector = page.getByTestId('workspace-inspector'), canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  async function selectObject(id: string, category: '结构' | '物件与装饰' = '结构') {
    const list = await openSceneObjects(page, category)
    await list.getByLabel('搜索场景对象', { exact: true }).fill(id)
    await list.locator(`[data-entity-id="${id}"]`).click()
  }
  await selectObject('item', '物件与装饰')
  await expect(inspector.getByRole('button', { name: '所在分区 · 市集' })).toBeVisible()
  const fit = await canvas.boundingBox()
  if (!fit) throw Error('Missing map canvas')
  await page.mouse.dblclick(fit.x + fit.width * .25, fit.y + fit.height * .16)
  await expect(inspector.getByRole('group', { name: '分区操作', exact: true })).toBeVisible()
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(fit.width)

  await inspector.getByRole('button', { name: '预览玩家揭开此分区', exact: true }).click()
  await expect(page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '玩家', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const fog = page.getByTestId('partition-fog-preview')
  expect(await fog.evaluate(node => {
    const mask = node as unknown as SVGPathElement
    return [mask.isPointInFill(new DOMPoint(5000, 5000)), mask.isPointInFill(new DOMPoint(9000, 5000))]
  })).toEqual([false, true])
  await page.getByRole('button', { name: '退出分区迷雾预览', exact: true }).click()
  await expect(fog).toHaveCount(0)
  expect((await keyboardProjectBackup(page, info.outputPath('fog-preview.sceneweave'))).hashes).toEqual(before.hashes)
  await page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '主持人', exact: true }).click()
  await selectObject('market')

  const output = info.outputPath('market-player.png'), pending = page.waitForEvent('download')
  await inspector.getByRole('button', { name: '分区玩家 PNG', exact: true }).click()
  await (await pending).saveAs(output)
  const png = decodeCanonicalPng(await readFile(output))
  expect([png.width, png.height]).toEqual([2743, 3840])
  const alpha = (x: number, y: number) => png.rgba[(y * png.width + x) * 4 + 3]
  expect(alpha(0, 0)).toBe(255)
  expect(alpha(png.width - 1, png.height - 1)).toBe(0)
  await keyboardWorkspaceSaved(page)

  const coords = inspector.getByLabel('室外对象坐标', { exact: true })
  if (!await coords.isVisible()) await inspector.getByText('精确坐标 · 轮廓', { exact: true }).click()
  await coords.fill('2000,2000\n7000,2000\n7000,7000\n4800,7000\n4800,3200\n2000,3200')
  await inspector.getByRole('button', { name: '预览对象修改', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await selectObject('item', '物件与装饰')
  await expect(inspector.getByRole('button', { name: /^所在分区/ })).toHaveCount(0)
  const after = await keyboardProjectBackup(page, info.outputPath('after.sceneweave'))
  expect(after.document.props).toEqual(before.document.props)
  expect(after.document.paths).toEqual(before.document.paths)
  expect(after.document.regions.market.boundaryMm).toHaveLength(6)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await selectObject('item', '物件与装饰')
  await expect(inspector.getByRole('button', { name: '所在分区 · 市集' })).toBeVisible()

  const tools = await openOutdoorTask(page, '用途 / 危险区域')
  await tools.getByLabel('区域用途', { exact: true }).selectOption('partition')
  await tools.getByLabel('分区名称', { exact: true }).fill('重叠测试')
  await tools.getByText('精确坐标 · 区域轮廓', { exact: true }).click()
  await tools.getByLabel('室外坐标', { exact: true }).fill('3000,3000\n5000,3000\n5000,5000\n3000,5000')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '内部重叠' })).toBeVisible()
  await expect(review).toHaveCount(0)
})
