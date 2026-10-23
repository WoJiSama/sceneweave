import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'

// Run after the normal production build is served on 4173. No test API or source modules are used.
const root = path.resolve(process.env.SCENEWEAVE_PRODUCTION_OUTPUT ?? 'work/c5-20261022/production-ui')
const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`, output = path.join(root, runId)
await fs.mkdir(output, { recursive: true })
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'runner-used.mjs'))
const report = { status: 'running', startedAt: new Date().toISOString(), url: process.env.SCENEWEAVE_PRODUCTION_URL ?? 'http://127.0.0.1:4173/sceneweave/#outdoor',
  method: 'Normal production UI only; one complete native-v6 building/outdoor/composition/layer/appearance/history journey, independent downloaded-container hashes, native image decode, selected history and dual-audience PNG checks; no source-module import or product API.',
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
  const revision = async () => Number(await page.getByTestId('outdoor-workbench').getAttribute('data-revision'))
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
  const adopt = async (kind = '室外') => {
    const apply = page.getByRole('button', { name: `采用${kind}修改`, exact: true })
    if (kind === '室外' || kind === '结构') {
      await expect(apply).toBeDisabled()
      await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
    }
    await apply.click(); await expect(apply).toHaveCount(0); await settled()
  }
  const chooseProp = async id => {
    await page.getByRole('tab', { name: '场景', exact: true }).click()
    await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
    await page.getByLabel('搜索场景物件', { exact: true }).fill(id)
    await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
  }
  const brightness = async value => {
    const appearance = page.getByRole('region', { name: '非破坏性外观', exact: true })
    await appearance.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
    await appearance.getByLabel('外观亮度', { exact: true }).fill(String(value))
    await appearance.getByRole('button', { name: '预览外观调整', exact: true }).click(); await adopt('组件')
  }
  const outdoor = () => page.getByRole('region', { name: '室外制作工具', exact: true })
  step('open normal production outdoor route')
  await page.goto(report.url); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  report.productDevApiKeys = await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => key.startsWith('__sceneweave')))
  expect(report.productDevApiKeys).toEqual([])
  step('create blank 20 by 20 metre complete scene')
  await page.getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('C5 生产书房与庭院联合闭环')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('20000')
  await dialog.getByLabel('画布高度', { exact: true }).fill('20000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled()
  const blank = await archive('完整工程', 'blank-complete.sceneweave')
  expect(Object.keys(blank.document.propDefinitions)).toHaveLength(18)
  expect(Object.keys(blank.document.materials)).toHaveLength(10)
  expect(Object.keys(blank.document.props)).toHaveLength(0)
  report.blank = { sceneId: blank.document.sceneId, contentHash: blank.contentHash, stockDefinitions: 18, materials: 10, actualDecodedImages: blank.actualImageCount }
  const floorId = Object.keys(blank.document.floors)[0]
  step('draw an indoor room with the building tool and explicit confirmation')
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByLabel('房间名称', { exact: true }).fill('C5 书房')
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  for (const [label, value] of [['房间起点 X', 1000], ['房间起点 Y', 1000], ['房间宽度', 6000], ['房间高度', 5500]]) await number(label, value)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt('结构')
  const building = await archive('完整工程'), roomId = Object.keys(building.document.rooms)[0]
  expect(Object.keys(building.document.walls)).toHaveLength(4)
  step('create a furniture layer and place two real images with explicit room support')
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('button', { name: '新建用户图层', exact: true }).click()
  await page.getByLabel('新图层名称', { exact: true }).fill('C5 家具')
  await page.getByRole('button', { name: '创建图层', exact: true }).click(); await settled()
  await page.getByRole('button', { name: '设为当前图层 C5 家具', exact: true }).click()
  for (const x of [3000, 5000]) {
    await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '放置', exact: true }).click()
    await page.getByRole('button', { name: `放置${blank.document.propDefinitions['b2-p-03'].name}`, exact: true }).click()
    await number('放置 X', x); await number('放置 Y', 3500)
    await page.getByLabel('放置表面', { exact: true }).selectOption(`room:${roomId}`)
    await expect(page.getByRole('button', { name: '在此放置', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '在此放置', exact: true }).click(); await settled()
  }
  const furnished = await archive('完整工程'), chairIds = Object.keys(furnished.document.props)
  expect(chairIds).toHaveLength(2)
  const furnitureLayer = Object.values(furnished.document.userLayers).find(layer => layer.name === 'C5 家具').id
  for (const id of chairIds) { same(furnished.document.props[id].supportRef, { kind: 'room', id: roomId }); expect(furnished.document.entityLayers[id]).toBe(furnitureLayer) }
  step('save a fixed two-chair composition and adopt one finite appearance adjustment')
  await chooseProp(chairIds[0]); await page.getByLabel('搜索场景物件', { exact: true }).fill('')
  await page.locator(`.asset-entity-list [data-entity-id="${chairIds[1]}"]`).click({ modifiers: ['Shift'] })
  await page.getByLabel('新组合名称', { exact: true }).fill('C5 双椅')
  await page.getByRole('button', { name: '预览保存组合 · 2 件', exact: true }).click(); await adopt('组件')
  await chooseProp(chairIds[0]); await brightness(.85)
  const composed = await archive('完整工程'), prefabId = Object.keys(composed.document.prefabInstances)[0]
  expect(composed.identity.prefabTokens[prefabId]).toBeTruthy()
  expect(composed.appearance.instanceAdjustments[chairIds[0]]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'brightness', value: .85, enabled: true })]))
  for (const id of chairIds) same(physical(composed.document.props[id]), physical(furnished.document.props[id]))
  report.composition = { roomId, chairIds, furnitureLayer, prefabId, supportedAndLayered: true, appearancePreservedPhysicalSemantics: true }
  await page.getByRole('button', { name: '设为当前图层 默认图层', exact: true }).click()
  step('draw terrain with actual material and preview without revision change')
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  await outdoor().getByLabel('室外坐标', { exact: true }).fill('9000, 9000\n19000, 9000\n19000, 19000\n9000, 19000')
  await outdoor().getByLabel('地形材质', { exact: true }).selectOption('b3-m-01')
  const blankRevision = await revision()
  await outdoor().getByRole('button', { name: '预览室外修改', exact: true }).click()
  expect(await revision()).toBe(blankRevision)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  expect(await revision()).toBe(blankRevision)
  await outdoor().getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt()
  const terrain = await archive('完整工程'), areaId = Object.keys(terrain.document.terrainAreas)[0]
  expect(terrain.identity.outdoorTokens[areaId]).toBeTruthy()
  step('create road with explicit floor support')
  await outdoor().getByLabel('室外制作工具', { exact: true }).selectOption('path')
  await outdoor().getByLabel('室外坐标', { exact: true }).fill('2000, 7500\n18000, 7500')
  await outdoor().getByLabel('道路支撑表面', { exact: true }).selectOption(`floor:${floorId}`)
  await outdoor().getByLabel('道路材质', { exact: true }).selectOption('')
  await number('室外通路宽度毫米', 1000)
  await outdoor().getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt()
  const road = await archive('完整工程'), pathId = Object.keys(road.document.paths)[0]
  step('create and explicitly generate a small scatter group')
  await outdoor().getByLabel('室外制作工具', { exact: true }).selectOption('scatter')
  await outdoor().getByLabel('散布域', { exact: true }).selectOption(`area:${areaId}`)
  await outdoor().getByLabel('散布素材', { exact: true }).selectOption('b3-p-01')
  await outdoor().getByLabel('散布方案', { exact: true }).fill('c5-production-joint')
  await outdoor().getByLabel('散布密度', { exact: true }).fill('1')
  await outdoor().getByLabel('散布候选格距', { exact: true }).fill('4000')
  await outdoor().getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt()
  const scatterCreated = await archive('完整工程'), scatterId = Object.keys(scatterCreated.document.scatterGroups)[0]
  await page.getByRole('button', { name: scatterId, exact: true }).click()
  await page.getByRole('button', { name: '预览重新散布', exact: true }).click(); await adopt()
  const baseline = await archive('完整工程', 'mixed-baseline.sceneweave')
  expect(Object.keys(baseline.document.props).length).toBeGreaterThan(2)
  const snapshotName = 'C5 书房与庭院基线'
  step('name snapshot and edit terrain plus independent road and component parameters')
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(snapshotName)
  await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled()
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  await page.getByRole('button', { name: areaId, exact: true }).click()
  await page.getByLabel('室外对象坐标', { exact: true }).fill('8800, 8800\n19200, 8800\n19200, 19200\n8800, 19200')
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await adopt()
  await page.getByRole('button', { name: pathId, exact: true }).click()
  await number('对象通路净宽', 1200)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await adopt()
  await chooseProp(chairIds[0]); await number('物件旋转', 20); await settled(); await brightness(.65)
  const beforeRestore = await archive('完整工程')
  expect(beforeRestore.document.props[chairIds[0]].rotationDeg).toBe(20)
  expect(beforeRestore.appearance.instanceAdjustments[chairIds[0]]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'brightness', value: .65, enabled: true })]))
  step('reload then restore only terrain geometry with protection point')
  await page.reload(); await settled()
  const reloaded = await archive('完整工程'); same(reloaded.current, beforeRestore.current)
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: `查看快照 ${snapshotName}`, exact: true }).click()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('outdoorGeometry')
  await page.getByRole('checkbox', { name: `恢复物件 ${areaId}`, exact: true }).check()
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  await expect(page.getByLabel('局部恢复差异', { exact: true })).toBeVisible()
  expect(await revision()).toBe(beforeRestore.document.revision)
  await shot('mixed-restore-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0))
  report.narrowPreviewWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(report.narrowPreviewWidth).toBeLessThanOrEqual(390)
  await shot('mixed-restore-390.png', true); await page.setViewportSize(report.viewport)
  await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled()
  const restored = await archive('完整工程', 'restored-complete.sceneweave')
  same(restored.document.terrainAreas[areaId].boundaryMm, baseline.document.terrainAreas[areaId].boundaryMm)
  same(restored.document.paths[pathId], beforeRestore.document.paths[pathId])
  same(restored.document.scatterGroups, beforeRestore.document.scatterGroups)
  same(restored.document.props, beforeRestore.document.props)
  same(restored.document.rooms, beforeRestore.document.rooms)
  same(restored.document.walls, beforeRestore.document.walls)
  same(restored.document.prefabInstances, beforeRestore.document.prefabInstances)
  same(restored.document.entityLayers, beforeRestore.document.entityLayers)
  same(restored.appearance, beforeRestore.appearance)
  same(restored.identity, beforeRestore.identity)
  expect(restored.document.revision).toBe(beforeRestore.document.revision + 1)
  await expect(page.locator('.history-snapshot-row')).toHaveCount(2)
  report.restore = { areaId, pathId, scatterId, roomId, prefabId, fromRevision: beforeRestore.document.revision, toRevision: restored.document.revision,
    preservedRoadWidth: restored.document.paths[pathId].widthMm, preservedProps: Object.keys(restored.document.props).length, preservedRotation: restored.document.props[chairIds[0]].rotationDeg,
    appearanceAndLayerMembershipPreserved: true, buildingAndCompositionPreserved: true, protectionCount: 1 }
  step('download selected history and verify complete bytes, license and snapshot hashes')
  await page.getByRole('checkbox', { name: '备份携带所选快照', exact: true }).check()
  await page.getByRole('checkbox', { name: `备份快照 ${snapshotName}`, exact: true }).check()
  const history = await archive('下载工程与所选历史 · 1 份', 'selected-history.sceneweave')
  expect(history.manifest.packageMode).toBe('history'); expect(history.snapshotChecks).toHaveLength(1)
  same(history.current, restored.current)
  report.archive = { bytes: history.bytes, sha256: history.sha256, contentHash: history.contentHash, manifest: history.manifest, selectedSnapshots: history.snapshotChecks, actualDecodedImages: history.actualImageCount, allEntryHashesVerified: true }
  step('export real GM and player 4K PNG with no textual metadata')
  const pngReport = {}
  for (const [audience, label] of [['gm', '主持人'], ['player', '玩家']]) {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: label, exact: true }).click(); await settled()
    const png = await download('4K PNG'); await fs.writeFile(path.join(output, `${audience}-4k.png`), png.bytes)
    const chunks = pngChunks(png.bytes)
    expect(chunks.some(value => ['tEXt','iTXt','zTXt','eXIf','tIME'].includes(value))).toBe(false)
    const decoded = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' })), canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d')
      try { context.drawImage(bitmap,0,0); const pixels=context.getImageData(0,0,canvas.width,canvas.height).data; return { width:canvas.width,height:canvas.height,pixelHash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels.buffer))].map(v=>v.toString(16).padStart(2,'0')).join('') } }
      finally { bitmap.close();canvas.width=canvas.height=0 }
    }, Array.from(png.bytes))
    expect(Math.max(decoded.width, decoded.height)).toBe(4096)
    pngReport[audience] = { ...decoded, sha256:hash(png.bytes),bytes:png.bytes.length,chunks }
  }
  expect(pngReport.player.pixelHash).toBe(pngReport.gm.pixelHash)
  report.png = { ...pngReport, scope:'All-public mixed building/outdoor/composition scene: both normal production export paths have identical decoded pixels. Secret-change isolation is independently covered by the C5 browser paired-audience journey.' }
  step('reopen complete native v6 project and inspect desktop and 390px layout')
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click(); await settled()
  await page.reload(); await settled()
  const reopened = await archive('完整工程'); same(reopened.current,restored.current)
  report.reopened = { sameCompleteContent:true,contentHash:reopened.contentHash,revision:reopened.document.revision }
  await chooseProp(chairIds[0])
  await page.evaluate(()=>window.scrollTo(0,0)); await shot('mixed-reopened-desktop.png')
  await page.setViewportSize({ width:390,height:844 }); await page.evaluate(()=>window.scrollTo(0,0))
  report.narrowMixedWidth=await page.evaluate(()=>document.documentElement.scrollWidth)
  expect(report.narrowMixedWidth).toBeLessThanOrEqual(390); await shot('mixed-reopened-390.png',true)
  expect(await page.evaluate(()=>Object.getOwnPropertyNames(window).filter(key=>key.startsWith('__sceneweave')))).toEqual([])
  expect(report.errors).toEqual([])
  expect(report.consoleErrors.filter(event=>!event.url.endsWith('/favicon.ico'))).toEqual([])
  expect(report.httpErrors.filter(event=>!event.url.endsWith('/favicon.ico')||event.status!==404)).toEqual([])
  report.status='passed'
} catch(error) {
  report.status='failed';report.failure=String(error);report.stack=error instanceof Error?error.stack:undefined
  if(page){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(output,'failure-ui.txt'),await page.locator('body').innerText().catch(()=>''))}
  throw error
} finally {
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2))
  await browser?.close();process.stdout.write(`Production evidence: ${output}\n`)
}
