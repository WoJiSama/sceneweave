import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import type { CompositionCommand } from '../src/shared/model/appearance'
import { clickKeyboardWorldPoint, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'

async function importProject(page: Page, bytes: Uint8Array) {
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'sight-component.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await keyboardWorkspaceSaved(page)
}

async function sightTools(page: Page, id: string) {
  const objects = await openSceneObjects(page, '物件与装饰')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`[data-entity-id="${id}"]`).click()
  const tools = page.locator('[data-sight-occluder-tools]')
  await tools.locator('summary').click()
  return tools
}

async function adoptComponent(page: Page) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await review.getByRole('button', { name: '采用组件修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

test('draws an instance sight component and pastes a local copy across tabs and after switching projects', async ({ page, context }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(12000)
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let source: Uint8Array, destination: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const archive = (title: string, positionMm: { x: number; y: number }, rotationDeg: number) => {
      const bundle = fixture(), scene = bundle.project.document
      scene.title = title
      scene.units.display = 'm'
      scene.props.item.positionMm = positionMm
      scene.props.item.rotationDeg = rotationDeg
      Object.assign(bundle.project, createCompositionContent(scene, runtime))
      return exportProject(bundle, validation)
    }
    source = await archive('遮挡来源', { x: 6000, y: 6000 }, 0)
    destination = await archive('遮挡目标', { x: 7400, y: 5000 }, 90)
  } finally {
    await vite.close()
  }
  await page.goto('./#home')
  await importProject(page, source)
  const original = await keyboardProjectBackup(page, info.outputPath('source.sceneweave'))
  let tools = await sightTools(page, 'item')
  await tools.getByRole('button', { name: '在画布画遮挡线', exact: true }).click()
  for (const x of [5600, 6400]) await clickKeyboardWorldPoint(page, { x, y: 6100 }, original.document.exportBoundsMm)
  await page.getByRole('button', { name: '预览遮挡线', exact: true }).click()
  await adoptComponent(page)
  const drawn = await keyboardProjectBackup(page, info.outputPath('drawn.sceneweave'))
  const component = drawn.document.props.item.sightOccluder!
  expect(component.pointsLocalMm).toHaveLength(2)
  expect(component.pointsLocalMm[0].x).toBeLessThan(-370)
  expect(component.pointsLocalMm[1].x).toBeGreaterThan(370)
  expect(drawn.document.props.other.sightOccluder).toBeUndefined()
  await page.getByRole('button', { name: '临时视野', exact: true }).click()
  await clickKeyboardWorldPoint(page, { x: 6000, y: 5000 }, original.document.exportBoundsMm)
  const sight = page.getByTestId('sight-preview-boundary')
  const beyondScreen = () => sight.evaluate(node => (node as unknown as SVGPolygonElement).isPointInFill(new DOMPoint(6000, 7100)))
  await expect.poll(beyondScreen).toBe(false)
  await selectKeyboardProp(page, 'item')
  const propX = page.getByLabel('物件 X', { exact: true })
  await propX.fill('7'); await propX.press('Tab'); await keyboardWorkspaceSaved(page)
  await expect.poll(beyondScreen).toBe(true)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await expect.poll(beyondScreen).toBe(false)
  await page.getByRole('button', { name: '退出临时视野', exact: true }).click()
  tools = await sightTools(page, 'item')
  await tools.getByRole('button', { name: '复制遮挡组件', exact: true }).click()
  await expect(tools.getByRole('status')).toContainText('已复制遮挡线')

  const second = await context.newPage()
  second.setDefaultTimeout(12000)
  await second.goto('./#home')
  await importProject(second, destination)
  const target = await keyboardProjectBackup(second, info.outputPath('target.sceneweave'))
  let targetTools = await sightTools(second, 'item')
  await targetTools.getByRole('button', { name: '预览粘贴遮挡组件', exact: true }).click()
  await adoptComponent(second)
  const pasted = (await keyboardProjectBackup(second, info.outputPath('pasted.sceneweave'))).document.props.item
  expect(pasted.sightOccluder?.id).not.toBe(component.id)
  expect(pasted.sightOccluder?.pointsLocalMm).toEqual(component.pointsLocalMm)
  expect(pasted).toEqual({ ...target.document.props.item, sightOccluder: pasted.sightOccluder })
  await second.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(second)
  await second.close()

  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${target.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  targetTools = await sightTools(page, 'item')
  await targetTools.getByRole('button', { name: '预览粘贴遮挡组件', exact: true }).click()
  await adoptComponent(page)
  const switched = (await keyboardProjectBackup(page, info.outputPath('switched.sceneweave'))).document.props.item.sightOccluder!
  expect(switched.id).not.toBe(pasted.sightOccluder?.id)
  expect(switched.pointsLocalMm).toEqual(component.pointsLocalMm)
})

async function moduleVersionControls(page: Page, id: string) {
  const objects = await openSceneObjects(page, '组合')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`[data-entity-id="${id}"]`).click()
  const panel = await openKeyboardPanel(page, 'inspector')
  const settings = panel.getByText('组合与重复布置', { exact: true }).locator('..')
  if (await settings.getAttribute('open') === null) await settings.locator(':scope > summary').click()
  const versions = settings.getByText(/^模块版本 · v/).locator('..')
  if (await versions.getAttribute('open') === null) await versions.locator(':scope > summary').click()
  return versions
}

test('publishes only the chosen module change, places the unpainted revision and syncs one earlier instance', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(12000)
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  const moduleName = '书柜模块验收'
  let source: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { fromBundle, toBundle } = await vite.ssrLoadModule('/src/application/workspace/project.ts')
    const { prepareCompositionCommands } = await vite.ssrLoadModule('/src/application/workspace/prepare.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const original = await fromBundle(fixture({ image: true }), validation)
    const grouped = await prepareCompositionCommands(original, [{ type: 'createPrefab', id: 'source-shelf', definitionId: 'shelf-v1',
      name: moduleName, ids: ['item'], anchorMm: original.document.props.item.positionMm }], { runtime, validation })
    const instances: CompositionCommand[] = ['update-shelf', 'keep-shelf'].map((id, index) => ({
      type: 'instantiatePrefab', id, definitionRef: { id: 'shelf-v1', version: 1 }, memberIds: { 'member-1': `${id}-member` },
      layerId: grouped.document.entityLayers.item, supportRef: { kind: 'floor', id: 'blank-floor' }, anchorMm: { x: 7500 + 3000 * index, y: 6000 },
    }))
    const placed = await prepareCompositionCommands(grouped, instances, { runtime, validation })
    source = await exportProject(toBundle(placed), validation)
  } finally { await vite.close() }

  await page.goto('./#home')
  const homeUrl = page.url()
  await importProject(page, source)
  const initial = await keyboardProjectBackup(page, info.outputPath('initial.sceneweave'))
  const host = initial.document.props.item, tools = await sightTools(page, host.id)
  await tools.getByRole('button', { name: '在画布画遮挡线', exact: true }).click()
  for (const x of [host.positionMm.x - 400, host.positionMm.x + 400]) {
    await clickKeyboardWorldPoint(page, { x, y: host.positionMm.y + 100 }, initial.document.exportBoundsMm)
  }
  await page.getByRole('button', { name: '预览遮挡线', exact: true }).click()
  await adoptComponent(page)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByText('外观与图层调整', { exact: true }).click()
  await inspector.getByLabel('外观调色颜色', { exact: true }).fill('#ff0000')
  await inspector.getByRole('button', { name: '预览外观调整', exact: true }).click()
  await adoptComponent(page)
  const before = await keyboardProjectBackup(page, info.outputPath('painted.sceneweave'))
  expect(before.document.props.item.appearance).not.toEqual(host.appearance)

  const versions = await moduleVersionControls(page, 'source-shelf')
  await expect(versions.getByRole('checkbox', { name: /物件外观$/ })).not.toBeChecked()
  await versions.getByRole('checkbox', { name: /视线遮挡$/ }).check()
  await versions.getByRole('button', { name: '预览发布模块新版', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review.getByRole('list', { name: '模块版本改动' })).toContainText('视线遮挡')
  await expect(review.getByRole('list', { name: '模块版本改动' })).not.toContainText('物件外观')
  await review.getByRole('button', { name: '发布到我的素材', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const after = await keyboardProjectBackup(page, info.outputPath('published.sceneweave'))
  expect(after.document).toEqual(before.document)

  const sync = await moduleVersionControls(page, 'update-shelf')
  await sync.getByRole('button', { name: '预览同步这个实例', exact: true }).click()
  await expect(review.getByRole('list', { name: '模块版本改动' })).toContainText('同步新版')
  await adoptComponent(page)
  const accepted = await keyboardProjectBackup(page, info.outputPath('updated.sceneweave'))
  expect(accepted.document.prefabInstances['source-shelf'].definitionRef.version).toBe(1)
  expect(accepted.document.prefabInstances['keep-shelf'].definitionRef.version).toBe(1)
  expect(accepted.document.prefabInstances['update-shelf'].definitionRef.version).toBe(2)
  expect(accepted.document.props['update-shelf-member'].sightOccluder).toEqual(before.document.props.item.sightOccluder)
  expect(accepted.document.props['keep-shelf-member'].sightOccluder).toBeUndefined()
  expect(accepted.document.props.item).toEqual(before.document.props.item)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.prefabInstances['update-shelf'].definitionRef.version).toBe(1)
  expect(undone.document.props['update-shelf-member'].sightOccluder).toBeUndefined()

  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByRole('button', { name: '浏览素材', exact: true }).click()
  await library.getByLabel('素材来源', { exact: true }).selectOption('mine')
  await library.getByLabel('搜索组件素材', { exact: true }).fill(moduleName)
  await library.getByRole('button', { name: `添加并放置 ${moduleName}`, exact: true }).click()
  await review.getByRole('button', { name: '添加并继续放置', exact: true }).click()
  await inspector.getByLabel('组合放置X', { exact: true }).fill('14400')
  await inspector.getByLabel('组合放置Y', { exact: true }).fill('7000')
  await inspector.getByRole('button', { name: '预览放置组合', exact: true }).click()
  await adoptComponent(page)
  const placement = inspector.getByRole('button', { name: '取消组合放置', exact: true })
  if (await placement.isVisible()) await placement.click()
  const exportedPath = info.outputPath('placed.sceneweave')
  const placed = await keyboardProjectBackup(page, exportedPath)
  const added = Object.values(placed.document.prefabInstances).find(group => !(group.id in initial.document.prefabInstances))!
  const addedId = added.members['member-1'].propId!
  expect(added.definitionRef.version).toBe(2)
  expect(placed.document.props[addedId].appearance).toEqual(host.appearance)
  expect(placed.document.props[addedId].sightOccluder).toEqual(before.document.props.item.sightOccluder)

  const fresh = await browser.newPage()
  fresh.setDefaultTimeout(12000)
  try {
    await fresh.goto(homeUrl)
    await importProject(fresh, await readFile(exportedPath))
    const imported = await keyboardProjectBackup(fresh, info.outputPath('imported.sceneweave'))
    expect(imported.document.props[addedId]).toEqual(placed.document.props[addedId])
    const importedTools = await sightTools(fresh, addedId)
    await importedTools.getByLabel('遮挡可见范围', { exact: true }).selectOption('gm')
    await adoptComponent(fresh)
    await fresh.reload()
    await fresh.getByRole('button', { name: '回到首页', exact: true }).click()
    await fresh.getByTestId('workspace-home').locator(`[data-project-key="native:${imported.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(fresh)
    const reopened = await keyboardProjectBackup(fresh, info.outputPath('reopened.sceneweave'))
    expect(reopened.document.props[addedId].sightOccluder).toEqual({ ...placed.document.props[addedId].sightOccluder, visibility: 'gm' })
  } finally { await fresh.close() }
})
