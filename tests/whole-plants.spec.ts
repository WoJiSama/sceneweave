import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { unzipSync } from 'fflate'
import { WHOLE_PLANT_LICENSE, WHOLE_PLANT_SPECS } from '../src/shared/visual/whole-plant-art'
import { acknowledgeAssetQuality } from './asset-quality-helpers'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('whole plants adopt through the ordinary catalogue, retain fixed sources, place individually and survive undo and cold read', async ({ page }, info) => {
  test.setTimeout(360_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const creating = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await creating.getByLabel('场景名称', { exact: true }).fill('十二种整株植物 · 摆放示例')
  await creating.getByLabel('画布宽度', { exact: true }).fill('24')
  await creating.getByLabel('画布高度', { exact: true }).fill('18')
  await creating.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(creating).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  await openWorkspaceModule(page, '素材')
  const panel = page.getByRole('region', { name: '主题素材包', exact: true })
  await openDetailsBySummary(panel, /^主题素材包 · 场景与画风$/)
  await openDetailsBySummary(panel, /^整株植物 · 十二种林地与河岸植物$/)
  await panel.getByRole('button', { name: '预览添加十二种整株植物', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible({ timeout: 90_000 })
  await acknowledgeAssetQuality(page)
  await page.getByRole('button', { name: '采用组件修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const added = await keyboardProjectBackup(page, info.outputPath('added.sceneweave'))
  const files = unzipSync(new Uint8Array(await readFile(info.outputPath('added.sceneweave'))))
  const json = (name: string) => JSON.parse(new TextDecoder().decode(files[name]))
  const sources = json('sources.json'), manifest = json('manifest.json')
  const originalFiles = unzipSync(new Uint8Array(await readFile(info.outputPath('before.sceneweave'))))
  const originalSources = JSON.parse(new TextDecoder().decode(originalFiles['sources.json']))
  for (const [id, source] of Object.entries(originalSources)) expect(sources[id]).toEqual(source)
  for (const [id, definition] of Object.entries(before.document.propDefinitions)) expect(added.document.propDefinitions[id]).toEqual(definition)
  for (const [path, hash] of Object.entries(keyboardResourceHashes(before.hashes))) if (path !== 'sources.json') expect(added.hashes[path]).toBe(hash)
  for (const spec of WHOLE_PLANT_SPECS) {
    const definition = Object.values(added.document.propDefinitions).find(d => d.catalogId === spec.catalogId)!
    expect(definition).toBeTruthy()
    expect(definition.defaultVisualBoundsMm).toEqual(spec.visualBoundsMm)
    expect(definition.defaultFootprintMm).toEqual(spec.footprintMm)
    if (definition.defaultAppearance.kind !== 'image') throw Error('Expected a fixed plant image')
    const assetId = definition.defaultAppearance.assetId, asset = added.document.assets[assetId], source = sources[assetId]
    expect(source.rasterSha256).toBe(asset.sha256)
    for (const hash of [source.sourceSha256, source.normalizedSha256]) expect(sha(files[`sources/${hash}.svg`])).toBe(hash)
    const pixels = files[`assets/${asset.sha256}.png`]
    expect(sha(pixels)).toBe(asset.sha256)
    const png = PNG.sync.read(Buffer.from(pixels))
    expect(png.width).toBe(1024); expect(png.height).toBe(1024)
    let clear = 0, painted = 0
    for (let i = 3; i < png.data.length; i += 4) { if (png.data[i]) painted++; else clear++ }
    expect(clear).toBeGreaterThan(5000); expect(painted).toBeGreaterThan(5000)
    const border = Array.from({ length: 1024 }, (_, x) => [png.data[x * 4 + 3], png.data[(1023 * 1024 + x) * 4 + 3], png.data[(x * 1024) * 4 + 3], png.data[(x * 1024 + 1023) * 4 + 3]]).flat()
    expect(border.every(alpha => alpha === 0)).toBe(true)
    for (const subjectId of [definition.id, assetId]) {
      const binding = manifest.licenseBindings.find((row: { subjectId: string }) => row.subjectId === subjectId)
      expect(binding.embedding).toBe('allowed')
      expect(new TextDecoder().decode(files[binding.licensePath])).toBe(WHOLE_PLANT_LICENSE)
    }
    await writeFile(info.outputPath(`${spec.key}.png`), pixels)
  }
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('adoption-undone.sceneweave'))
  expect(undone.document.propDefinitions).toEqual(before.document.propDefinitions)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const restored = await keyboardProjectBackup(page, info.outputPath('adoption-redone.sceneweave'))
  expect(keyboardResourceHashes(restored.hashes)).toEqual(keyboardResourceHashes(added.hashes))

  // All twelve are placed as ordinary independent objects, at their real world sizes.
  const bounds = before.document.exportBoundsMm
  for (let index = 0; index < WHOLE_PLANT_SPECS.length; index++) {
    const spec = WHOLE_PLANT_SPECS[index]
    await openWorkspaceModule(page, '素材')
    const library = page.getByRole('region', { name: '组件素材库', exact: true })
    await library.getByLabel('搜索组件素材', { exact: true }).fill(spec.name)
    await library.getByRole('button', { name: `放置组件 ${spec.name}`, exact: true }).click()
    await openKeyboardPanel(page, 'inspector')
    for (const [axis, coordinate] of [['X', bounds.x + bounds.width * ((index % 4) + .5) / 4], ['Y', bounds.y + bounds.height * (Math.floor(index / 4) + .5) / 3]] as const) {
      const input = page.getByLabel(`放置 ${axis}`, { exact: true })
      await input.fill(String(coordinate / 1000)); await input.press('Tab')
    }
    const revision = Number(await page.locator('.workspace-unified').getAttribute('data-revision'))
    await page.getByRole('button', { name: '在此放置', exact: true }).click()
    await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(revision + 1))
    await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  const placed = await keyboardProjectBackup(page, info.outputPath('plants-placed.sceneweave'))
  const newProps = Object.values(placed.document.props).filter(prop => !before.document.props[prop.id])
  expect(newProps).toHaveLength(12)
  expect(new Set(newProps.map(prop => placed.document.propDefinitions[prop.definitionRef!.id].catalogId)).size).toBe(12)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect(Object.keys((await keyboardProjectBackup(page, info.outputPath('placement-undone.sceneweave'))).document.props)).toHaveLength(Object.keys(placed.document.props).length - 1)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('placement-redone.sceneweave'))
  expect(redone.document.props).toEqual(placed.document.props)
  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('plants-cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  for (const audience of ['gm', 'player'] as const) {
    const downloading = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
    const path = info.outputPath(`plants-${audience}.png`)
    await (await downloading).saveAs(path); await keyboardWorkspaceSaved(page)
    await page.locator('.workspace-export-menu > summary').click()
    const png = PNG.sync.read(await readFile(path)); expect(Math.max(png.width, png.height)).toBe(4096)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await openWorkspaceModule(page, '素材')
  await expect(page.getByRole('region', { name: '组件素材库', exact: true }).getByLabel('搜索组件素材', { exact: true })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflow).toBe(false)
  await page.screenshot({ path: info.outputPath('plants-narrow.png') })
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ count: newProps.length, sceneId: cold.document.sceneId, errors, overflow }, null, 2))
  expect(errors).toEqual([])
})
