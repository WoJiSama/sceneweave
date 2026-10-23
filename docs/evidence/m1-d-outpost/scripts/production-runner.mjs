import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'

// Serve the normal production build on 4175. Browser reads are limited to DOM
// and independently downloaded bytes; no source imports or product test API.
const root = path.resolve(process.env.SCENEWEAVE_PRODUCTION_OUTPUT ?? 'work/m1d-outpost-20261023/production-ui')
const output = path.join(root, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await fs.mkdir(output, { recursive: true })
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'runner-used.mjs'))
const report = {
  status: 'running', startedAt: new Date().toISOString(), output,
  url: process.env.SCENEWEAVE_PRODUCTION_URL ?? 'http://127.0.0.1:4175/sceneweave/#outdoor',
  method: 'Normal production UI only. Independently audit every complete ZIP entry, actual native image decoding, v6 identities and appearance, exact native persistence, scoped protected restoration and dual-audience 4K PNG pixels/metadata.',
  limits: 'Initial editable SCN-04 sample and finite UI journey. This does not prove complete art/P3, whole-map pathfinding, small-group acceptance, offline PWA cold start, full M1 or interaction performance.',
  viewport: { width: 1512, height: 982 }, errors: [], consoleErrors: [], httpErrors: [], sourceRequests: [], steps: [], screenshots: [], archives: [],
}
const ids = { path: 'outpost-path', lamp: 'outpost-lamp-stand', secretNote: 'outpost-gm-ledger', room: 'outpost-room', store: 'outpost-store', low: 'outpost-low', high: 'outpost-high', entrance: 'outpost-entrance', sharedDoor: 'outpost-shared-door', treeScatter: 'outpost-trees', shrubScatter: 'outpost-shrubs', supplies: 'outpost-supplies-group' }
const hash = value => createHash('sha256').update(value).digest('hex')
const canonical = value => JSON.stringify(value, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)
const same = (left, right) => expect(canonical(left)).toBe(canonical(right))
const step = name => { report.stage = name; report.steps.push({ name, at: new Date().toISOString() }); process.stdout.write(`${name}\n`) }
const physical = prop => Object.fromEntries(['id', 'floorId', 'positionMm', 'rotationDeg', 'footprintMm', 'footprintOffsetMm', 'visualBoundsMm', 'supportRef', 'roomId', 'blocksMovement', 'blocksSight', 'visibility', 'editLocked', 'renderLayer', 'renderOrder'].filter(key => key in prop).map(key => [key, prop[key]]))
const pngChunks = bytes => {
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const chunks = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset < bytes.length) {
    const size = view.getUint32(offset)
    expect(offset + size + 12).toBeLessThanOrEqual(bytes.length)
    chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset += size + 12
  }
  expect(offset).toBe(bytes.length); expect(chunks.at(-1)).toBe('IEND'); return chunks
}
let browser, page
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true }); report.browser = browser.version()
  page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 }); page.setDefaultTimeout(60_000)
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ text: event.text(), url: event.location().url }) })
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() }) })
  page.on('request', request => { if (/(?:^|\/)src\//.test(new URL(request.url()).pathname)) report.sourceRequests.push(request.url()) })
  const settled = async () => {
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    await expect(page.locator('.asset-save')).toHaveText('本地已保存')
    await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  }
  const revision = async () => Number(await page.getByTestId('outdoor-workbench').getAttribute('data-revision'))
  const number = async (label, value) => { const input = page.getByRole('spinbutton', { name: label, exact: true }); await input.fill(String(value)); await input.press('Tab') }
  const shot = async (name, fullPage = false) => { await page.screenshot({ path: path.join(output, name), fullPage }); report.screenshots.push(name) }
  const download = async label => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click()
    const downloaded = await pending, bytes = await fs.readFile(await downloaded.path())
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    return { name: downloaded.suggestedFilename(), bytes }
  }
  const decodeAssets = async entries => page.evaluate(async entries => {
    const result = {}
    for (const entry of entries) {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(entry.bytes)], { type: entry.mimeType })), canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      try {
        const context = canvas.getContext('2d'); if (!context) throw new Error('Native canvas unavailable')
        context.drawImage(bitmap, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        result[entry.sha256] = { width: bitmap.width, height: bitmap.height, rgbaHash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('') }
      } finally { bitmap.close(); canvas.width = canvas.height = 0 }
    }
    return result
  }, entries)
  const archive = async (label, fileName) => {
    const downloaded = await download(label), files = unzipSync(downloaded.bytes)
    const manifest = JSON.parse(strFromU8(files['manifest.json'])), document = JSON.parse(strFromU8(files['scene.json']))
    const identity = JSON.parse(strFromU8(files['identity.json'])), appearance = JSON.parse(strFromU8(files['appearance.json']))
    expect(manifest).toMatchObject({ containerVersion: 6, documentSchemaVersion: 3, profile: 'm1-outdoor' })
    expect(document.schemaVersion).toBe(3); expect(identity.version).toBe(3); expect(appearance.version).toBe(1)
    expect(Object.keys(identity).sort()).toEqual(['lineageId', 'outdoorTokens', 'prefabTokens', 'propTokens', 'rootSceneId', 'version'])
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
      for (const asset of Object.values(doc.assets)) {
        expect(selectedAssets[asset.sha256]).toMatchObject({ sha256: asset.sha256, mimeType: asset.mimeType, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight })
        expect(actual[asset.sha256]).toMatchObject({ width: asset.pixelWidth, height: asset.pixelHeight })
      }
      for (const binding of licenseBindings) { expect(binding.embedding).toBe('allowed'); expect(files[binding.licensePath]).toBeDefined(); expect(selectedLicenses[binding.licensePath.slice(9, -4)]).toBeDefined() }
      for (const propId of Object.keys(doc.props)) { expect(historyIdentity.propTokens[propId]).toBeTruthy(); expect(graph.sources[graph.propSources[propId]]).toBeDefined() }
      for (const groupId of Object.keys(doc.prefabInstances)) expect(historyIdentity.prefabTokens[groupId]).toBeTruthy()
      for (const collection of ['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'scatterGroups']) for (const id of Object.keys(doc[collection])) expect(historyIdentity.outdoorTokens[id]).toBeTruthy()
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
      snapshotChecks.push({ id: snapshot.summary.id, kind: snapshot.summary.kind, name: snapshot.summary.name, hash: snapshot.summary.contentHash, sourceRevision: snapshot.summary.sourceRevision })
    }
    await fs.writeFile(path.join(output, fileName), downloaded.bytes)
    const result = { manifest, document, identity, appearance, current, history, bytes: downloaded.bytes.length, sha256: hash(downloaded.bytes), contentHash: hash(canonical(current)), snapshotChecks, actualImageCount: imageEntries.length, actual }
    report.archives.push({ file: fileName, bytes: result.bytes, sha256: result.sha256, contentHash: result.contentHash, revision: document.revision, actualDecodedImages: result.actualImageCount, decodedImages: actual, snapshots: snapshotChecks, allEntryHashesVerified: true })
    return result
  }
  const adoptOutdoor = async () => {
    const apply = page.getByRole('button', { name: '采用室外修改', exact: true }); await expect(apply).toBeDisabled()
    await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check(); await apply.click(); await expect(apply).toHaveCount(0); await settled()
  }
  step('open normal production outdoor route and editable coastal outpost sample')
  await page.goto(report.url); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  report.productDevApiKeys = await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => key.startsWith('__sceneweave')))
  expect(report.productDevApiKeys).toEqual([])
  await page.getByRole('button', { name: /海岸哨所 · 混合场景/ }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开室外工程', exact: true })
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled()
  const baseline = await archive('完整工程', 'outpost-baseline.sceneweave')
  expect(baseline.actualImageCount).toBe(34)
  expect(Object.keys(baseline.document.propDefinitions)).toHaveLength(23); expect(Object.keys(baseline.document.materials)).toHaveLength(11)
  expect(Object.keys(baseline.document.prefabDefinitions)).toHaveLength(3); expect(Object.keys(baseline.document.userLayers)).toHaveLength(6)
  expect(Object.keys(baseline.document.rooms)).toHaveLength(2); expect(Object.keys(baseline.document.walls)).toHaveLength(7); expect(Object.keys(baseline.document.openings)).toHaveLength(2)
  expect(baseline.document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 36000, height: 28000 })
  expect(baseline.document.rooms[ids.room]).toMatchObject({ groundElevationMm: 1000, supportRef: { kind: 'terrainArea', id: ids.low } })
  expect(baseline.document.terrainAreas[ids.high].groundElevationMm).toBe(3000)
  expect(baseline.document.openings[ids.entrance]).toMatchObject({ widthMm: 1200, state: 'open' }); expect(baseline.document.openings[ids.sharedDoor]).toMatchObject({ widthMm: 1000, state: 'open' })
  expect(baseline.document.notes[ids.secretNote]).toMatchObject({ text: '灯架下藏有返航账目', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: ids.lamp } })
  expect(Object.values(baseline.document.scatterGroups[ids.treeScatter].members).some(member => member.state === 'manual')).toBe(true)
  expect(Object.values(baseline.document.scatterGroups[ids.shrubScatter].members).some(member => member.state === 'deleted')).toBe(true)
  report.sample = { sceneId: baseline.document.sceneId, contentHash: baseline.contentHash, definitions: 23, materials: 11, fixedPrefabs: 3, userLayers: 6, actualDecodedImages: baseline.actualImageCount, geometryAndSavedScatterRecordsVerified: true }
  await shot('outpost-open-gm-desktop.png')
  const snapshotName = 'M1-D 海岸哨所生产基线'
  step('name complete snapshot and preview/cancel/adopt a genuine road width and cost edit')
  await page.getByRole('tab', { name: '历史', exact: true }).click(); await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(snapshotName); await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled()
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  await page.getByRole('region', { name: '室外制作工具', exact: true }).getByRole('button', { name: ids.path, exact: true }).click()
  await number('对象通路净宽', 2200); await number('对象移动代价', 2)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); expect(await revision()).toBe(baseline.document.revision)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  const canceled = await archive('完整工程', 'outpost-canceled.sceneweave'); same(canceled.current, baseline.current)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await adoptOutdoor()
  step('apply independent later lamp appearance while retaining its private clue and physical fields')
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill(ids.lamp); await page.locator(`.asset-entity-list [data-entity-id="${ids.lamp}"]`).click()
  const appearancePanel = page.getByRole('region', { name: '非破坏性外观', exact: true })
  await appearancePanel.getByLabel('外观调整项目', { exact: true }).selectOption('brightness'); await appearancePanel.getByLabel('外观亮度', { exact: true }).fill('0.75')
  await appearancePanel.getByRole('button', { name: '预览外观调整', exact: true }).click()
  await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await settled()
  const beforeRestore = await archive('完整工程', 'outpost-before-restore.sceneweave')
  expect(beforeRestore.document.paths[ids.path]).toMatchObject({ widthMm: 2200, movementCostMultiplier: 2 })
  expect(beforeRestore.appearance.instanceAdjustments[ids.lamp]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'brightness', value: .75, enabled: true })]))
  same(physical(beforeRestore.document.props[ids.lamp]), physical(baseline.document.props[ids.lamp])); same(beforeRestore.document.notes[ids.secretNote], baseline.document.notes[ids.secretNote])
  step('reload exact complete content and prepare scoped geometry restoration with later edits retained')
  await page.reload(); await expect(page.getByTestId('outdoor-workbench')).toBeVisible(); await settled()
  const reloaded = await archive('完整工程', 'outpost-reloaded-before-restore.sceneweave'); same(reloaded.current, beforeRestore.current)
  await page.getByRole('tab', { name: '历史', exact: true }).click(); await page.getByRole('button', { name: `查看快照 ${snapshotName}`, exact: true }).click()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('outdoorGeometry'); await page.getByLabel('搜索历史物件', { exact: true }).fill(ids.path)
  await page.getByRole('checkbox', { name: `恢复物件 ${ids.path}`, exact: true }).check(); await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  await expect(page.getByLabel('局部恢复差异', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '保护当前并采用', exact: true })).toBeDisabled()
  expect(await revision()).toBe(beforeRestore.document.revision)
  report.restoreScope = await page.getByLabel('局部恢复完整实际范围', { exact: true }).inputValue()
  await shot('outpost-restore-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0))
  report.narrowPreviewWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(report.narrowPreviewWidth).toBeLessThanOrEqual(390)
  await shot('outpost-restore-390.png', true); await page.setViewportSize(report.viewport)
  await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check(); await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled()
  const restored = await archive('完整工程', 'outpost-restored.sceneweave')
  same(restored.document.paths[ids.path], { ...beforeRestore.document.paths[ids.path], widthMm: baseline.document.paths[ids.path].widthMm })
  same(restored.appearance, beforeRestore.appearance); same(restored.document.props, beforeRestore.document.props); same(restored.identity, beforeRestore.identity)
  same(restored.document.scatterGroups, beforeRestore.document.scatterGroups); same(restored.document.prefabInstances, beforeRestore.document.prefabInstances)
  same(restored.document.rooms, beforeRestore.document.rooms); same(restored.document.notes, beforeRestore.document.notes)
  expect(restored.document.revision).toBe(beforeRestore.document.revision + 1); await expect(page.locator('.history-snapshot-row')).toHaveCount(2)
  report.restore = { fromRevision: beforeRestore.document.revision, toRevision: restored.document.revision, geometryWidthMm: restored.document.paths[ids.path].widthMm, retainedMovementCost: restored.document.paths[ids.path].movementCostMultiplier, retainedLampBrightness: .75, privateClueUnchanged: true, protectionCount: 1 }
  step('download chosen named and protection history and independently verify every snapshot content hash')
  await page.getByRole('checkbox', { name: '备份携带所选快照', exact: true }).check()
  const backupInputs = page.getByLabel('历史备份范围', { exact: true }).getByRole('checkbox')
  await expect(backupInputs).toHaveCount(2)
  await backupInputs.nth(0).check(); await backupInputs.nth(1).check()
  const history = await archive('下载工程与所选历史 · 2 份', 'outpost-selected-history.sceneweave')
  expect(history.manifest.packageMode).toBe('history'); expect(history.snapshotChecks).toHaveLength(2); same(history.current, restored.current)
  expect(history.snapshotChecks.find(snapshot => snapshot.kind === 'named')?.hash).toBe(baseline.contentHash)
  expect(history.snapshotChecks.find(snapshot => snapshot.kind === 'protection')?.hash).toBe(beforeRestore.contentHash)
  report.history = { selectedSnapshots: history.snapshotChecks, allEntryHashesVerified: true, actualDecodedImages: history.actualImageCount, protectionMatchesCompletePreRestoreContent: true }
  step('download actual GM and player 4K PNG and decode complete RGBA plus metadata')
  const pngReport = {}
  for (const [audience, label] of [['gm', '主持人'], ['player', '玩家']]) {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: label, exact: true }).click(); await settled()
    await page.evaluate(() => window.scrollTo(0, 0)); await shot(`outpost-${audience}-desktop.png`)
    const png = await download('4K PNG'); await fs.writeFile(path.join(output, `${audience}-4k.png`), png.bytes)
    const chunks = pngChunks(png.bytes), metadata = chunks.filter(chunk => ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(chunk)); expect(metadata).toEqual([])
    const decoded = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' })), canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      try {
        const context = canvas.getContext('2d'); if (!context) throw new Error('Native canvas unavailable')
        context.drawImage(bitmap, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        return { width: canvas.width, height: canvas.height, rgbaHash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('') }
      } finally { bitmap.close(); canvas.width = canvas.height = 0 }
    }, Array.from(png.bytes))
    expect([decoded.width, decoded.height]).toEqual([4096, 3186]); pngReport[audience] = { ...decoded, bytes: png.bytes.length, sha256: hash(png.bytes), chunks, metadata }
  }
  expect(pngReport.player.rgbaHash).not.toBe(pngReport.gm.rgbaHash)
  report.png = { ...pngReport, scope: 'Normal production sample GM/player export with the private anchored clue and independently authored public labels. Fixed-mask variant/reference pixel equivalence is a separate M1-D browser test.' }
  step('reopen complete native sample and capture desktop plus narrow player and GM UI')
  await page.reload(); await expect(page.getByTestId('outdoor-workbench')).toBeVisible(); await settled()
  const reopened = await archive('完整工程', 'outpost-reopened.sceneweave'); same(reopened.current, restored.current)
  report.reopened = { sameCompleteContent: true, revision: reopened.document.revision, contentHash: reopened.contentHash }
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '玩家', exact: true }).click(); await settled()
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0))
  report.narrowPlayerWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(report.narrowPlayerWidth).toBeLessThanOrEqual(390); await shot('outpost-reopened-player-390.png', true)
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click(); await settled()
  await page.evaluate(() => window.scrollTo(0, 0)); report.narrowGmWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(report.narrowGmWidth).toBeLessThanOrEqual(390); await shot('outpost-reopened-gm-390.png', true)
  await page.setViewportSize(report.viewport); await page.evaluate(() => window.scrollTo(0, 0)); await shot('outpost-reopened-gm-desktop.png')
  expect(await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => key.startsWith('__sceneweave')))).toEqual([])
  expect(report.sourceRequests).toEqual([]); expect(report.errors).toEqual([])
  expect(report.consoleErrors.filter(event => !event.url.endsWith('/favicon.ico'))).toEqual([])
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
