import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'

// Run after the normal production build is served on 4173. No test API or source modules are used.
const root = path.resolve(process.env.SCENEWEAVE_PRODUCTION_OUTPUT ?? 'docs/evidence/m1-c3/production-ui')
const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`, output = path.join(root, runId)
await fs.mkdir(output, { recursive: true })
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'runner-used.mjs'))
const report = { status: 'running', startedAt: new Date().toISOString(), url: process.env.SCENEWEAVE_PRODUCTION_URL ?? 'http://127.0.0.1:4173/sceneweave/#composition',
  method: 'Normal production UI only; independent downloaded-container hashes, actual native image decode and parameter pixel checks; no source-module import or __sceneweave API.',
  viewport: { width: 1512, height: 982 }, errors: [], consoleErrors: [], httpErrors: [], steps: [], screenshots: [], output }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => JSON.stringify(value, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)
const same = (left, right) => expect(canonical(left)).toBe(canonical(right))
const step = name => { report.steps.push({ name, at: new Date().toISOString() }); process.stdout.write(`${name}\n`) }
const pngChunks = bytes => {
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const chunks = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 8; offset < bytes.length;) { const size = view.getUint32(offset); expect(offset + size + 12).toBeLessThanOrEqual(bytes.length); chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset += size + 12 }
  expect(chunks.at(-1)).toBe('IEND'); return chunks
}
const physical = prop => Object.fromEntries(['id', 'floorId', 'positionMm', 'rotationDeg', 'footprintMm', 'footprintOffsetMm', 'supportRef', 'roomId', 'blocksMovement', 'blocksSight', 'visibility', 'editLocked', 'renderLayer', 'renderOrder'].filter(key => key in prop).map(key => [key, prop[key]]))
let browser, page
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true }); report.browser = browser.version()
  page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 }); page.setDefaultTimeout(60_000)
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ text: event.text(), url: event.location().url }) })
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() }) })
  const settled = async () => { await expect(page.locator('.asset-busy')).toHaveCount(0); await expect(page.locator('.asset-save')).toHaveText('本地已保存'); await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false') }
  const revision = async () => Number(await page.getByTestId('composition-workbench').getAttribute('data-revision'))
  const number = async (label, value) => { const input = page.getByRole('spinbutton', { name: label, exact: true }); await input.fill(String(value)); await input.press('Tab') }
  const shot = async (name, fullPage = false) => { await page.screenshot({ path: path.join(output, name), fullPage }); report.screenshots.push(name) }
  const download = async label => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click()
    const result = await pending, bytes = await fs.readFile(await result.path()); await expect(page.locator('.asset-busy')).toHaveCount(0)
    return { name: result.suggestedFilename(), bytes }
  }
  const decodeAssets = async entries => page.evaluate(async entries => {
    const result = {}
    for (const entry of entries) {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(entry.bytes)], { type: entry.mimeType }))
      try { result[entry.sha256] = { width: bitmap.width, height: bitmap.height } } finally { bitmap.close() }
    }
    return result
  }, entries)
  const archive = async (label, fileName) => {
    const downloaded = await download(label), files = unzipSync(downloaded.bytes)
    const manifest = JSON.parse(strFromU8(files['manifest.json'])), document = JSON.parse(strFromU8(files['scene.json']))
    const identity = JSON.parse(strFromU8(files['identity.json'])), appearance = JSON.parse(strFromU8(files['appearance.json']))
    expect(manifest).toMatchObject({ containerVersion: 5, documentSchemaVersion: 3, profile: 'm1-composition' })
    expect(document.schemaVersion).toBe(3); expect(identity.version).toBe(2); expect(appearance.version).toBe(1)
    expect(Object.keys(identity).sort()).toEqual(['lineageId', 'prefabTokens', 'propTokens', 'rootSceneId', 'version'])
    expect(manifest.sceneId).toBe(document.sceneId); expect(manifest.revision).toBe(document.revision)
    expect(new Set(manifest.entries.map(entry => entry.path)).size).toBe(manifest.entries.length)
    expect(Object.keys(files).sort()).toEqual(['manifest.json', ...manifest.entries.map(entry => entry.path)].sort())
    for (const entry of manifest.entries) { expect(files[entry.path].length).toBe(entry.sizeBytes); expect(hash(files[entry.path])).toBe(entry.sha256) }
    expect(manifest.entries.find(entry => entry.path === 'identity.json').role).toBe('identity')
    expect(manifest.entries.find(entry => entry.path === 'appearance.json').role).toBe('appearance')
    expect(Object.keys(files).some(name => name.includes('migration') || name.includes('original'))).toBe(false)
    const imageEntries = manifest.entries.filter(entry => entry.role === 'asset'), licenseEntries = manifest.entries.filter(entry => entry.role === 'license')
    const actual = await decodeAssets(imageEntries.map(entry => ({ ...entry, bytes: Array.from(files[entry.path]) })))
    const assets = Object.fromEntries(imageEntries.map(entry => [entry.sha256, { sha256: entry.sha256, mimeType: entry.mimeType, sizeBytes: entry.sizeBytes, pixelWidth: actual[entry.sha256].width, pixelHeight: actual[entry.sha256].height }]))
    const licenses = Object.fromEntries(licenseEntries.map(entry => [entry.sha256, { sha256: entry.sha256, text: strFromU8(files[entry.path]) }]))
    const content = (doc, historyIdentity, graph, refs, licenseBindings) => {
      const selectedAssets = Object.fromEntries(refs.assetHashes.map(value => [value, assets[value]])), selectedLicenses = Object.fromEntries(refs.licenseHashes.map(value => [value, licenses[value]]))
      for (const asset of Object.values(doc.assets)) { expect(selectedAssets[asset.sha256]).toMatchObject({ sha256: asset.sha256, mimeType: asset.mimeType, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight }); expect(actual[asset.sha256]).toEqual({ width: asset.pixelWidth, height: asset.pixelHeight }) }
      for (const binding of licenseBindings) { expect(binding.embedding).toBe('allowed'); expect(files[binding.licensePath]).toBeDefined(); expect(selectedLicenses[binding.licensePath.slice(9, -4)]).toBeDefined() }
      for (const propId of Object.keys(doc.props)) { expect(historyIdentity.propTokens[propId]).toBeTruthy(); expect(graph.sources[graph.propSources[propId]]).toBeDefined() }
      for (const groupId of Object.keys(doc.prefabInstances)) expect(historyIdentity.prefabTokens[groupId]).toBeTruthy()
      for (const variant of Object.values(graph.variants)) {
        const source = doc.assets[variant.sourceAssetId], target = doc.assets[variant.outputAssetId]
        expect(source).toBeDefined(); expect(target).toBeDefined(); expect(source.licenseRef).toBe(target.licenseRef)
        same(source.origin, target.origin); same(source.logicalSizeMm, target.logicalSizeMm)
      }
      return { document: doc, historyIdentity, appearance: graph, assets: selectedAssets, licenses: selectedLicenses, licenseBindings }
    }
    const history = files['history.json'] ? JSON.parse(strFromU8(files['history.json'])) : null
    const current = content(document, identity, appearance, history?.current ?? { assetHashes: Object.keys(assets), licenseHashes: Object.keys(licenses) }, manifest.licenseBindings)
    const snapshotChecks = []
    if (history) for (const snapshot of history.snapshots) {
      expect(manifest.entries.find(entry => entry.path === snapshot.appearancePath).role).toBe('snapshot-appearance')
      expect(manifest.entries.find(entry => entry.path === snapshot.identityPath).role).toBe('snapshot-identity')
      const historic = content(JSON.parse(strFromU8(files[snapshot.scenePath])), JSON.parse(strFromU8(files[snapshot.identityPath])), JSON.parse(strFromU8(files[snapshot.appearancePath])), snapshot, snapshot.licenseBindings)
      expect(hash(canonical(historic))).toBe(snapshot.summary.contentHash)
      expect(historic.document.revision).toBe(snapshot.summary.sourceRevision); expect(historic.historyIdentity.lineageId).toBe(snapshot.summary.lineageId)
      snapshotChecks.push({ id: snapshot.summary.id, name: snapshot.summary.name, hash: snapshot.summary.contentHash, sourceRevision: snapshot.summary.sourceRevision })
    }
    if (fileName) await fs.writeFile(path.join(output, fileName), downloaded.bytes)
    return { files, manifest, document, identity, appearance, current, history, bytes: downloaded.bytes.length, sha256: hash(downloaded.bytes), contentHash: hash(canonical(current)), snapshotChecks, actualImageCount: imageEntries.length, actual, data: downloaded.bytes }
  }
  const verifyVariantPixels = async packed => {
    const assets = Object.fromEntries(packed.manifest.entries.filter(entry => entry.role === 'asset').map(entry => [entry.sha256, { bytes: Array.from(packed.files[entry.path]), mimeType: entry.mimeType }]))
    return page.evaluate(async ({ assets, document: scene, variants }) => {
      const read = async asset => { const value = assets[asset.sha256], bitmap = await createImageBitmap(new Blob([Uint8Array.from(value.bytes)], { type: value.mimeType }), { colorSpaceConversion: 'default', premultiplyAlpha: 'none' }), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }); try { context.drawImage(bitmap, 0, 0); return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data } } finally { bitmap.close(); canvas.width = canvas.height = 0 } }
      const results = []
      for (const variant of variants) {
        const source = await read(scene.assets[variant.sourceAssetId]), target = await read(scene.assets[variant.outputAssetId]), canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height
        const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }), image = context.createImageData(source.width, source.height), tint = variant.tint === null ? [255, 255, 255] : [1, 3, 5].map(offset => parseInt(variant.tint.slice(offset, offset + 2), 16))
        for (let i = 0; i < source.pixels.length; i += 4) { image.data[i + 3] = source.pixels[i + 3]; if (source.pixels[i + 3]) for (let channel = 0; channel < 3; channel++) image.data[i + channel] = Math.round(Math.min(255, source.pixels[i + channel] * tint[channel] / 255 * variant.brightness)) }
        context.putImageData(image, 0, 0); const expected = context.getImageData(0, 0, canvas.width, canvas.height).data
        const equal = target.width === source.width && target.height === source.height && expected.every((value, index) => value === target.pixels[index]); canvas.width = canvas.height = 0
        if (!equal) throw new Error(`Actual production parameter pixels differ: ${variant.id}`)
        results.push({ id: variant.id, tint: variant.tint, brightness: variant.brightness, width: source.width, height: source.height, equalPixels: equal })
      }
      return results
    }, { assets, document: packed.document, variants: Object.values(packed.appearance.variants) })
  }
  const adopt = async () => { await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toHaveCount(0); await settled() }
  const adjust = async (kind, value) => {
    const before = await revision(); await page.getByLabel('外观调整范围', { exact: true }).selectOption('targets'); await page.getByLabel('外观调整项目', { exact: true }).selectOption(kind)
    await page.getByLabel(kind === 'tint' ? '外观调色颜色' : '外观亮度', { exact: true }).fill(value)
    await page.getByRole('button', { name: '预览外观调整', exact: true }).click(); await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible(); expect(await revision()).toBe(before)
    await adopt(); expect(await revision()).toBe(before + 1)
  }

  step('open normal production composition route')
  await page.goto(report.url); await expect(page.getByTestId('composition-workbench')).toBeVisible()
  report.productDevApiKeys = await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => key.startsWith('__sceneweave'))); expect(report.productDevApiKeys).toEqual([])
  step('create blank scene with 18 complete stock objects')
  await page.getByRole('button', { name: '新建空白场景', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('C3 生产组件与外观')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('16000'); await dialog.getByLabel('画布高度', { exact: true }).fill('12000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled()
  const blank = await archive('完整工程', 'blank-complete.sceneweave')
  expect(Object.keys(blank.document.propDefinitions)).toHaveLength(18); expect(blank.actualImageCount).toBe(18); expect(Object.keys(blank.document.props)).toHaveLength(0)
  report.blank = { sceneId: blank.document.sceneId, contentHash: blank.contentHash, stockDefinitions: 18, actualDecodedImages: blank.actualImageCount }
  const definition = Object.values(blank.document.propDefinitions).find(item => item.defaultAppearance.kind === 'image')
  step('place a fixed stock component through UI')
  await page.getByRole('tab', { name: '素材库', exact: true }).click()
  await page.getByLabel('搜索组件素材', { exact: true }).fill(definition.id)
  await page.getByRole('button', { name: `放置组件 ${definition.name}`, exact: true }).click()
  await number('放置 X', 5000); await number('放置 Y', 4500)
  await page.getByLabel('放置表面', { exact: true }).selectOption(`floor:${Object.keys(blank.document.floors)[0]}`)
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await settled()
  const placed = await archive('完整工程'), propId = Object.keys(placed.document.props)[0], originalProp = placed.document.props[propId]
  expect(Object.keys(placed.document.props)).toHaveLength(1); expect(originalProp.definitionRef.id).toBe(definition.id)
  report.placed = { id: propId, definitionId: definition.id, name: definition.name, revision: placed.document.revision, source: placed.appearance.propSources[propId] }
  step('apply instance tint and brightness as separate preview/adopt transactions')
  await adjust('tint', '#80c080'); await adjust('brightness', '0.7')
  const baseline = await archive('完整工程', 'appearance-baseline.sceneweave')
  same(physical(baseline.document.props[propId]), physical(originalProp)); expect(baseline.appearance.propSources[propId]).toBe(placed.appearance.propSources[propId])
  expect(Object.keys(baseline.appearance.variants)).toHaveLength(2); report.baselinePixelChecks = await verifyVariantPixels(baseline)
  await shot('appearance-desktop.png')
  step('create named snapshot and make a later color change')
  await page.getByRole('button', { name: '命名历史快照', exact: true }).click(); await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  const snapshotName = 'C3 固定源与参数基线'
  await page.getByLabel('命名快照名称', { exact: true }).fill(snapshotName); await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled()
  expect(await revision()).toBe(baseline.document.revision)
  await adjust('tint', '#ff8080'); const beforeRestore = await archive('完整工程')
  expect(beforeRestore.document.props[propId].appearance.assetId).not.toBe(baseline.document.props[propId].appearance.assetId)
  step('preview and locally restore only the selected component appearance')
  await page.getByRole('button', { name: `查看快照 ${snapshotName}`, exact: true }).click(); await page.getByLabel('局部恢复模式', { exact: true }).selectOption('appearance')
  await page.getByRole('checkbox', { name: `恢复物件 ${propId}`, exact: true }).check(); await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  await expect(page.getByRole('status', { name: '局部恢复候选', exact: true })).toBeVisible(); expect(await revision()).toBe(beforeRestore.document.revision)
  await shot('appearance-restore-preview-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0))
  report.narrowPreviewWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(report.narrowPreviewWidth).toBeLessThanOrEqual(390)
  await shot('appearance-restore-preview-390.png', true); await page.setViewportSize(report.viewport)
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled()
  expect(await revision()).toBe(beforeRestore.document.revision + 1); await expect(page.locator('.history-snapshot-row')).toHaveCount(2)
  const restored = await archive('完整工程', 'restored-complete.sceneweave')
  same(restored.document.props[propId].appearance, baseline.document.props[propId].appearance); same(physical(restored.document.props[propId]), physical(originalProp))
  same(restored.appearance.layerAdjustments, beforeRestore.appearance.layerAdjustments)
  for (const [id, asset] of Object.entries(blank.document.assets)) same(restored.document.assets[id], asset)
  report.restore = { fromRevision: beforeRestore.document.revision, toRevision: restored.document.revision, restoredPropId: propId, historicalAppearance: baseline.document.props[propId].appearance, resultingAppearance: restored.document.props[propId].appearance, protectionCount: 1 }
  report.restoredPixelChecks = await verifyVariantPixels(restored)
  step('download explicitly selected history and independently verify every entry and snapshot hash')
  await page.getByRole('checkbox', { name: '备份携带所选快照', exact: true }).check(); await page.getByRole('checkbox', { name: `备份快照 ${snapshotName}`, exact: true }).check()
  const history = await archive('下载工程与所选历史 · 1 份', 'selected-history.sceneweave')
  expect(history.manifest.packageMode).toBe('history'); expect(history.snapshotChecks).toHaveLength(1); expect(history.snapshotChecks[0].name).toBe(snapshotName)
  same(history.document, restored.document); same(history.identity, restored.identity); same(history.appearance, restored.appearance)
  const oldScene = JSON.parse(strFromU8(history.files[history.history.snapshots[0].scenePath])); same(oldScene, baseline.document)
  report.archive = { bytes: history.bytes, sha256: history.sha256, contentHash: history.contentHash, manifest: history.manifest, selectedSnapshots: history.snapshotChecks, actualDecodedImages: history.actualImageCount, allEntryHashesVerified: true }
  step('download GM and player PNG from actual production controls')
  const pngReport = {}
  for (const [audience, label] of [['gm', '主持人'], ['player', '玩家']]) {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: label, exact: true }).click(); await settled()
    const png = await download('4K PNG'); await fs.writeFile(path.join(output, `${audience}-4k.png`), png.bytes)
    const chunks = pngChunks(png.bytes); expect(chunks.some(value => ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(value))).toBe(false)
    const decoded = await page.evaluate(async bytes => { const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' })), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d'); try { context.drawImage(bitmap, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; return { width: canvas.width, height: canvas.height, pixelHash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels.buffer))].map(value => value.toString(16).padStart(2, '0')).join('') } } finally { bitmap.close(); canvas.width = canvas.height = 0 } }, Array.from(png.bytes))
    expect(Math.max(decoded.width, decoded.height)).toBe(4096)
    pngReport[audience] = { ...decoded, sha256: hash(png.bytes), bytes: png.bytes.length, chunks }
  }
  expect(pngReport.player.pixelHash).toBe(pngReport.gm.pixelHash); report.png = { ...pngReport, scope: 'All-public stock scene: equal audience pixels prove both production export paths, not the complete private-scene matrix.' }
  step('reopen the persisted current project and inspect desktop and narrow layout')
  await page.reload(); await settled(); expect(await revision()).toBe(restored.document.revision)
  const reopened = await archive('完整工程'); same(reopened.document, restored.document); same(reopened.identity, restored.identity); same(reopened.appearance, restored.appearance); expect(reopened.contentHash).toBe(restored.contentHash)
  report.reopened = { sameCompleteContent: true, contentHash: reopened.contentHash, revision: reopened.document.revision }
  await page.getByRole('tab', { name: '素材库', exact: true }).click(); await page.getByLabel('搜索组件素材', { exact: true }).fill(definition.id)
  await page.getByRole('button', { name: `查看素材 ${definition.name}`, exact: true }).click(); await page.getByText('完整许可与署名', { exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, 0)); await shot('library-reopened-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0))
  report.narrowLibraryWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(report.narrowLibraryWidth).toBeLessThanOrEqual(390); await shot('library-reopened-390.png', true)
  expect(await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => key.startsWith('__sceneweave')))).toEqual([])
  expect(report.errors).toEqual([]); expect(report.consoleErrors.filter(event => !event.url.endsWith('/favicon.ico'))).toEqual([])
  expect(report.httpErrors.filter(event => !event.url.endsWith('/favicon.ico') || event.status !== 404)).toEqual([])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.failure = String(error); report.stack = error instanceof Error ? error.stack : undefined
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(output, 'failure-ui.txt'), await page.locator('body').innerText().catch(() => '')) }
  throw error
} finally {
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close(); process.stdout.write(`Production evidence: ${output}\n`)
}
