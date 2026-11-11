import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { unzipSync } from 'fflate'
import { closeMeasuredBrowser } from './close-browser.mjs'
import { diffAggregateBlocks } from './aggregate-observer.mjs'
import { createCurrentFormalObserver } from './current-formal-observer.mjs'
import { summarizeCurrentFormal, compactFormalRunForManifest } from './summarize-current-formal.mjs'
import { runAggregateWithDraftCleanup } from './aggregate-draft-cleanup.mjs'

// Current complete-v1 production runner. Fixture preparation is a separate,
// already-closed process; no product hook, injected state, retry or reduced load.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/run-current-formal.mjs --fixtures ABS --output ABS [--dist ABS] [--channel chrome] [--timeout-ms 180000] [--cases building-500,building-2000,natural-500,natural-2000,mixed-500,mixed-2000] [--smoke]')
  console.log('Formal: 3 independent runs per case, 30 grouped preview/adopt edits plus 30 independent immediate full-Prop edits and 60 object-list selections per run, real canvas selection, 3 x 30 pan moves and 3 x 20 wheel inputs, group/undo/redo, cold open, dual 4K PNG and exact package/storage audits. --smoke is diagnostic only: one run, 2 edits per flow and 4 list selections. Run exclusively and serially, without other automated browsers, builds or tests. Failures are retained, never retried. This measured subset cannot close all of 09 or P3.')
  process.exit(0)
}
const check = (value, message) => { if (!value) throw new Error(message) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const output = argument('--output', ''), fixtureDirectory = argument('--fixtures', '')
const dist = path.resolve(argument('--dist', path.join(root, 'dist'))), channel = argument('--channel', 'chrome')
const timeoutMs = Number(argument('--timeout-ms', '180000')), smoke = args.includes('--smoke')
const cases = argument('--cases', 'building-500,building-2000,natural-500,natural-2000,mixed-500,mixed-2000').split(',')
const runCount = smoke ? 1 : 3, editCount = smoke ? 2 : 30, selectionCount = smoke ? 4 : 60
check(path.isAbsolute(output) && path.isAbsolute(fixtureDirectory), '--fixtures and --output must be absolute')
check(output !== fixtureDirectory && !output.startsWith(`${fixtureDirectory}${path.sep}`), 'Output must be separate from frozen fixture inputs')
check(cases.length > 0 && new Set(cases).size === cases.length && cases.every(value => /^(building|natural|mixed)-(500|2000)(-remote|-local-ports)?$/.test(value)), 'Expected unique full-Prop cases')
check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000, 'Invalid timeout')
try { check((await fs.readdir(output)).length === 0, 'Existing evidence will not be overwritten') } catch (error) { if (error.code !== 'ENOENT') throw error }
await fs.mkdir(output, { recursive: true })
const write = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2))
async function fingerprint(directory, stem = '') {
  const result = []
  for (const entry of await fs.readdir(path.join(directory, stem), { withFileTypes: true })) {
    const name = path.join(stem, entry.name)
    if (entry.isDirectory()) result.push(...await fingerprint(directory, name))
    else if (entry.isFile()) { const bytes = await fs.readFile(path.join(directory, name)); result.push({ path: name, bytes: bytes.length, sha256: hash(bytes) }) }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
async function inputs() {
  return { src: await fingerprint(path.join(root, 'src')), public: await fingerprint(path.join(root, 'public')),
    assets: await fingerprint(path.join(root, 'assets')), build: await fingerprint(dist), fixtures: await fingerprint(fixtureDirectory),
    tools: await Promise.all(['tools/performance/run-current-formal.mjs', 'tools/performance/aggregate-draft-cleanup.mjs', 'tools/performance/current-formal-observer.mjs',
      'tools/performance/summarize-current-formal.mjs', 'tools/performance/aggregate-observer.mjs', 'tools/performance/native-m2-observer.mjs',
      'tools/performance/resources.mjs', 'tools/performance/close-browser.mjs', 'tools/testing/formal-capacity-fixtures.ts',
      'tools/testing/aggregate-capacity-fixtures.ts', 'package.json', 'package-lock.json', 'vite.config.ts']
      .map(async name => ({ path: name, sha256: hash(await fs.readFile(path.join(root, name))) }))) }
}
const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
check(!html.includes('/@vite/client') && !(await fs.readdir(dist)).includes('diagnostic-stages.json'), 'Expected normal production build')
const base = /<script[^>]+src="([^"]+\/assets\/)/.exec(html)?.[1]?.replace(/assets\/$/, '') ?? '/'
const frozen = await inputs()
const manifest = { format: 'sceneweave-current-formal-performance', version: 1, startedAt: new Date().toISOString(), status: 'running',
  measurementClass: smoke ? 'diagnostic-current-v1-production-ui-smoke' : 'formal-current-v1-production-ui-observation',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), frozen, inputFingerprint: hash(JSON.stringify(frozen)),
  device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  config: { cases, channel, timeoutMs, viewport: { width: 1512, height: 982 }, dpr: 1, runCount, editCount, immediateEditCount: editCount, selectionCount, base,
    cache: 'New dedicated Chrome headless process/profile for each case/run; HTTP cache disabled. OS cache is not purged. Page reload before cold open resets page/module/decoded-image state; same browser process remains.',
    ordinary: 'Grouped public full Prop world X alternates +1mm/back. Enter prepares a preview; trusted adoption click commits. Preview, adoption-click-to-domain and Enter-to-domain including review/automation delay are retained separately.',
    immediate: 'Fixed independent controls.remoteEntityId public full Prop world X alternates +1mm/back. Trusted Enter commits directly. Enter-to-validated-domain, saved, raster-ready and display-proxy intervals are retained separately; the 500-Prop 100ms ordinary-edit gate uses the complete Enter-to-domain interval.',
    frames: 'Nearest-rank browser rAF intervals overlapping actual trusted continuous pointer/wheel input only; double-rAF is a scheduling proxy, not presentation/GPU completion.',
    storage: 'Native readonly committed rows; SHA-verified immutable content payloads and distinct changed final JSON rows, never physical disk I/O.',
    aggregateDraftExit: 'After a completed or explicitly refused group attempt, dismiss only its remaining form through the ordinary cancel button. Cancellation is setup outside measured samples; unchanged revision/selection and exact complete-package payloads are audited before canvas selection. Unexpected failures are not discarded or retried.',
    limitations: ['RSS is the dedicated macOS process-tree sum and may double-count shared mappings; target JS heap excludes GPU/other targets.',
      'CPU brackets include automation, observer/CDP waits and retain process births/exits/resets; no profiler or forced GC.',
      'Tooling package/pixel/hash/storage audit and setup phases are excluded from product peaks.',
      'Predeclared replicate failures are retained and independent runs continue; there are no automatic retries.'] },
  omittedCoverage: ['Free Prop drag and broad marquee are not established by these grouped preview/adopt and independent immediate full-Prop X field edits.',
    'Continuous contour/curve edits, layer visibility/order, appearance editing, named/protected history, restoration depth/branches and failure matrices remain separate 09 work.',
    'Original SCN-01/02/03, VIS-01/02 and SCN-04 exact visual fixtures, cross-browser and physical display/GPU timings are not replaced by this corpus.',
    'Player PNG metadata/dimensions are checked; paired private-mutation pixel equality, privacy geometry/shadows, human visual quality and user P3 need independent evidence.',
    'No 10000/100000 or higher capacity claim; no physical disk-write, historical speedup or automatic full-09 pass.'], fixtures: [], results: [], failures: [] }
await write('manifest.json', manifest)
let ownedServer, browser, observer, httpServer, interrupted = false
const sleepGuard = process.platform === 'darwin' ? spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : null
sleepGuard?.on('error', () => {})
const interrupt = () => { interrupted = true; void ownedServer?.kill() }
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
async function launch() {
  ownedServer = await chromium.launchServer({ channel, headless: true })
  browser = await chromium.connect(ownedServer.wsEndpoint())
  const context = await browser.newContext({ acceptDownloads: true, viewport: manifest.config.viewport, deviceScaleFactor: 1, locale: 'zh-CN' })
  const page = await context.newPage(); page.setDefaultTimeout(timeoutMs)
  return page
}
async function closeBrowser() {
  const result = await closeMeasuredBrowser(ownedServer, browser)
  ownedServer = browser = null
  return result
}

// Complete-package assertions copied from the existing development runner;
// these inspect every entity/resource/appearance field, not just changed IDs.
function packageData(bytes) {
  const entries = unzipSync(new Uint8Array(bytes)), read = name => { check(entries[name], `Missing ${name}`); return JSON.parse(Buffer.from(entries[name]).toString('utf8')) }
  const descriptor = read('manifest.json')
  for (const item of descriptor.entries) check(entries[item.path]?.length === item.sizeBytes && hash(entries[item.path]) === item.sha256, `Package entry mismatch: ${item.path}`)
  return { entries, scene: read('scene.json'), identity: read('identity.json'), appearance: read('appearance.json'), sources: read('sources.json'), manifest: descriptor,
    summary: { sha256: hash(bytes), bytes: bytes.length, expandedBytes: Object.values(entries).reduce((sum, value) => sum + value.length, 0), entries: Object.keys(entries).length } }
}
function sceneContent(scene) { const { revision, updatedAt, ...content } = scene; return content }
function sameResources(a, b) {
  const resources = entries => Object.fromEntries(Object.entries(entries).filter(([key]) => /^(assets|licenses|sources)\//.test(key)).map(([key, bytes]) => [key, hash(bytes)]))
  check(isDeepStrictEqual(resources(a.entries), resources(b.entries)), 'Resource/license/source bytes changed')
  check(isDeepStrictEqual(a.manifest.assetRecords, b.manifest.assetRecords) && isDeepStrictEqual(a.manifest.licenseBindings, b.manifest.licenseBindings), 'Resource metadata/license bindings changed')
}
function sameComplete(a, b) {
  check(isDeepStrictEqual(a.manifest, b.manifest), 'Cold package manifest changed')
  check(isDeepStrictEqual(Object.keys(a.entries).sort(), Object.keys(b.entries).sort()), 'Cold package entry set changed')
  for (const key of Object.keys(a.entries)) check(hash(a.entries[key]) === hash(b.entries[key]), `Cold package changed ${key}`)
}
function sameImported(a, b) {
  // Normal import creates an independent local project with a fresh root ID/clock.
  const expected = { ...a.scene, sceneId: b.scene.sceneId, createdAt: b.scene.createdAt, updatedAt: b.scene.updatedAt }
  check(a.scene.sceneId !== b.scene.sceneId && isDeepStrictEqual(expected, b.scene), 'Import changed scene beyond fresh root ID/clock')
  for (const key of ['identity', 'appearance', 'sources']) check(isDeepStrictEqual(a[key], b[key]), `Import changed ${key}`)
  sameResources(a, b)
  check(isDeepStrictEqual(Object.keys(a.entries).sort(), Object.keys(b.entries).sort()), 'Import changed package entry set')
  for (const key of Object.keys(a.entries)) if (!['scene.json', 'manifest.json'].includes(key)) check(hash(a.entries[key]) === hash(b.entries[key]), `Import changed package payload ${key}`)
  const first = { ...a.manifest, sceneId: b.manifest.sceneId, entries: a.manifest.entries.filter(row => row.path !== 'scene.json') }
  const last = { ...b.manifest, entries: b.manifest.entries.filter(row => row.path !== 'scene.json') }
  check(isDeepStrictEqual(first, last) && b.manifest.sceneId === b.scene.sceneId, 'Import changed package metadata beyond root scene reference')
}
function assertRemote(a, b, controls) {
  for (const [collection, id] of [['props', controls.remoteEntityId], ['terrainAreas', controls.remoteAreaId], ['paths', controls.externalRoadId], ['paths', controls.remoteRoadId], ['terrainConnections', controls.remoteConnectionId]]) {
    check(id && a.scene[collection][id] && isDeepStrictEqual(a.scene[collection][id], b.scene[collection][id]), `External ${collection}/${id} changed`)
    check(isDeepStrictEqual(a.scene.entityLayers[id], b.scene.entityLayers[id]), `External layer ${id} changed`)
  }
}
function assertCoreAppearance(a, b, controls, owned) {
  const expected = structuredClone(a.appearance)
  const movePoint = point => ({ ...point, x: point.x + controls.offsetMm.x, y: point.y + controls.offsetMm.y })
  const paint = value => { if (value?.alignment === 'surface') value.originMm = movePoint(value.originMm) }
  for (const [id, sourceId] of Object.entries(a.appearance.surfaceSources)) {
    if (!owned.has(id)) continue
    const source = a.appearance.sources[sourceId]
    check(source?.kind === 'surface', 'Expected fixed surface source')
    const snapshot = structuredClone(source.snapshot)
    paint(snapshot?.base)
    for (const overlay of snapshot?.overlays ?? []) { overlay.boundaryMm = overlay.boundaryMm.map(movePoint); paint(overlay.paint) }
    if (isDeepStrictEqual(snapshot, source.snapshot)) continue
    const adoptedId = b.appearance.surfaceSources[id], adopted = b.appearance.sources[adoptedId]
    check(adoptedId !== sourceId && adopted?.parentSourceId === sourceId && adopted.kind === 'surface', `Missing exact surface-source ancestry for ${id}`)
    check(isDeepStrictEqual(adopted, { id: adoptedId, kind: 'surface', parentSourceId: sourceId, snapshot }), `Surface-source derivation changed paint/business values for ${id}`)
    expected.surfaceSources[id] = adoptedId; expected.sources[adoptedId] = adopted
  }
  check(isDeepStrictEqual(expected, b.appearance), 'Core translation changed appearance beyond exact moved surface snapshots and preserved source ancestry')
}
function assertCore(a, b, controls) {
  check(a.scene.aggregateCoordinates.encoding === 'local' && b.scene.aggregateCoordinates.encoding === 'local', 'Expected authoritative local package geometry')
  const first = a.scene.aggregateCoordinates.groups, last = b.scene.aggregateCoordinates.groups
  check(isDeepStrictEqual(Object.keys(first).sort(), Object.keys(last).sort()), 'Group set changed')
  for (const [id, group] of Object.entries(first)) {
    const expected = structuredClone(group)
    if (id === controls.groupId) {
      check((controls.quarterTurns ?? 0) === 0 && group.parentId === null, 'This diagnostic comparison is for root translation')
      expected.frame.translationMm.x += controls.offsetMm.x; expected.frame.translationMm.y += controls.offsetMm.y
    }
    check(isDeepStrictEqual(expected, last[id]), `Unexpected group/frame change: ${id}`)
  }
  const collections = { vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', prop: 'props', region: 'regions', note: 'notes', terrainArea: 'terrainAreas', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections', path: 'paths', prefabInstance: 'prefabInstances', scatterGroup: 'scatterGroups', decoration: 'decorations', decorationCluster: 'decorationClusters', surfaceRule: 'surfaceRules' }
  for (const group of Object.values(first)) for (const member of group.members) {
    const collection = collections[member.kind]
    check(collection && isDeepStrictEqual(a.scene[collection][member.id], b.scene[collection][member.id]), `Local member changed during core translation: ${member.kind}/${member.id}`)
  }
  for (const collection of Object.values(collections)) check(isDeepStrictEqual(a.scene[collection], b.scene[collection]), `Pure core translation changed local/external ${collection}`)
  for (const key of ['entityLayers', 'userLayers', 'propDefinitions', 'prefabDefinitions']) check(isDeepStrictEqual(a.scene[key], b.scene[key]), `Pure core translation changed ${key}`)
  check(isDeepStrictEqual(a.identity, b.identity), 'Pure translation changed identity')
  check(isDeepStrictEqual(a.sources, b.sources), 'Pure translation changed authoring sources')
  const legacyVisual = scene => scene.visual.version === 3 ? scene.visual.base : scene.visual
  const firstVisual = legacyVisual(a.scene), lastVisual = legacyVisual(b.scene)
  const expectedVisual = structuredClone(firstVisual), owned = new Set(Object.values(first).flatMap(group => group.members.map(member => member.id)))
  assertCoreAppearance(a, b, controls, owned)
  const movedBoundaries = new Set()
  const movePoint = point => ({ ...point, x: point.x + controls.offsetMm.x, y: point.y + controls.offsetMm.y })
  if (controls.domain === 'natural') {
    for (const boundary of Object.values(expectedVisual.base.boundaries)) {
      if (!(boundary.binding.kind === 'path' && owned.has(boundary.binding.pathId)
        || boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => owned.has(side.areaId)))) continue
      movedBoundaries.add(boundary.id)
      for (const segment of boundary.segments) for (const key of ['start', 'control1', 'control2', 'end']) segment[key] = movePoint(segment[key])
    }
    const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
    for (const edge of Object.values(expectedVisual.materializedEdges)) if (movedBoundaries.has(edge.boundaryId)) {
      edge.polygons = edge.polygons.map(ring => ring.map(movePoint))
      edge.strokes = edge.strokes.map(stroke => ({ ...stroke, pointsMm: stroke.pointsMm.map(movePoint) }))
      edge.inputHash = hash(canonical(expectedVisual.base.boundaries[edge.boundaryId]))
    }
  }
  check(isDeepStrictEqual(expectedVisual, lastVisual), 'Core translation changed unrelated visual data or failed to translate its bound curves/edges exactly')
  check(b.scene.props[controls.privateMemberId]?.visibility === 'gm' && b.scene.notes[controls.secretNoteId]?.text === 'CAPACITY_PRIVATE_SENTINEL'
    && isDeepStrictEqual(a.scene.notes[controls.secretNoteId], b.scene.notes[controls.secretNoteId]), 'Private persisted records changed')
}
function assertOnlyProps(a, b, ids) {
  const expected = structuredClone(a.scene)
  expected.revision = b.scene.revision; expected.updatedAt = b.scene.updatedAt
  for (const id of ids) {
    check(expected.props[id] && b.scene.props[id], 'Local prop missing')
    const after = b.scene.props[id], prior = expected.props[id]
    const expectedProp = { ...prior, positionMm: { ...prior.positionMm, x: prior.positionMm.x + 1 } }
    let group = Object.values(a.scene.aggregateCoordinates.groups).find(group => group.members.some(member => member.kind === 'prop' && member.id === id)), rotation = 0
    const visited = new Set()
    while (group) {
      check(!visited.has(group.id), 'Cyclic group frames in downloaded package'); visited.add(group.id)
      rotation = (rotation + group.frame.quarterTurns) % 4
      group = group.parentId === null ? null : a.scene.aggregateCoordinates.groups[group.parentId]
    }
    // A trusted world +X millimetre has one exact displacement in each local frame.
    const delta = { x: after.positionMm.x - prior.positionMm.x, y: after.positionMm.y - prior.positionMm.y }
    const expectedDelta = [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }][rotation]
    check(isDeepStrictEqual(delta, expectedDelta), `Unexpected local displacement: ${id}`)
    expectedProp.positionMm = after.positionMm
    check(isDeepStrictEqual(expectedProp, after), `Local edit changed business fields: ${id}`)
    expected.props[id] = after
  }
  check(isDeepStrictEqual(expected, b.scene), 'Local edit changed entities/metadata outside the explicit prop set')
  check(isDeepStrictEqual(a.identity, b.identity) && isDeepStrictEqual(a.appearance, b.appearance) && isDeepStrictEqual(a.sources, b.sources), 'Local edit changed identity/appearance/sources')
}

function sameContent(a, b, context) {
  check(isDeepStrictEqual(sceneContent(a.scene), sceneContent(b.scene)), `${context}: complete scene content differs`)
  for (const key of ['identity', 'appearance', 'sources']) check(isDeepStrictEqual(a[key], b[key]), `${context}: complete ${key} differs`)
  sameResources(a, b)
}
async function details(locator) { if (await locator.getAttribute('open') === null) await locator.locator('summary').first().click() }
async function number(scope, label, value) { const field = scope.getByRole('spinbutton', { name: label, exact: true }); await field.fill(String(value)); await field.press('Enter') }
// Follow the same real module/task controls as workspace-navigation-helpers;
// navigation is setup, outside every measured edit/selection/export interval.
async function openWorkspaceModule(page, name) {
  const choice = page.getByTestId('workspace-module-navigation').getByRole('button', { name, exact: true })
  await choice.click()
  await choice.and(page.locator('[aria-current="page"]')).waitFor({ state: 'visible' })
  const panel = page.getByTestId('workspace-resources')
  await panel.and(page.locator('[data-open="true"]')).waitFor({ state: 'visible' })
  return panel
}
async function openSceneObjects(page) {
  const panel = await openWorkspaceModule(page, '场景')
  await panel.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
  return panel
}
async function download(page, stem) {
  observer.setPhase('tooling-package-audit')
  const menu = page.locator('details.workspace-export-menu'); await details(menu)
  const pending = page.waitForEvent('download')
  await menu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
  const file = await pending; check(!await file.failure(), 'Complete-package download failed')
  const filename = `${stem}.sceneweave`; await file.saveAs(path.join(output, filename))
  const result = packageData(await fs.readFile(path.join(output, filename)))
  check(result.scene.schemaVersion === 1 && result.manifest.schemaVersion === 1, 'Expected current complete v1 package')
  await observer.ready()
  if (await menu.getAttribute('open') !== null) await menu.locator('summary').click()
  observer.setPhase('setup')
  return result
}
async function adoptReview(page, kind, revision, expectedLabel) {
  const review = page.locator('.workspace-candidate-review[aria-label="候选审阅"]')
  const confirmation = review.getByLabel('确认完整影响范围', { exact: true })
  if (await confirmation.count()) await confirmation.check()
  return observer.measure(kind, { start: { event: 'click', selector: 'button', label: expectedLabel }, expectedRevision: revision,
    domainCommit: true, requireSaved: true }, () => review.getByRole('button', { name: expectedLabel, exact: true }).click())
}
async function selectMember(page, id) {
  const panel = await openSceneObjects(page)
  await panel.getByRole('searchbox', { name: '搜索场景对象', exact: true }).fill(id)
  await panel.locator(`.asset-virtual-row[data-entity-id="${id}"]`).click()
}
async function groupTools(page, controls) {
  const domain = controls.domain === 'building' ? '建筑' : '地形'
  const panel = await openWorkspaceModule(page, domain)
  if (domain === '建筑') await panel.getByRole('group', { name: '建筑任务', exact: true }).getByRole('button', { name: /^建筑组/ }).click()
  else {
    await panel.getByRole('group', { name: '地形任务', exact: true }).getByRole('button', { name: /^绘制地形/ }).click()
    await panel.getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: /^地形与高程/ }).click()
    await panel.getByRole('button', { name: '自然组 · 创建与整体调整', exact: true }).click()
  }
  const tools = page.getByTestId('workspace-inspector').getByLabel(domain === '建筑' ? '建筑组工具' : '自然组工具', { exact: true }); await details(tools)
  await tools.getByRole('combobox', { name: domain === '建筑' ? '建筑组' : '自然组', exact: true }).selectOption(controls.groupId)
  const prefix = domain === '建筑' ? '整栋' : '自然组'
  await number(tools, `${prefix}偏移 X`, controls.offsetMm.x / 1000)
  await number(tools, `${prefix}偏移 Y`, controls.offsetMm.y / 1000)
  await tools.getByRole('combobox', { name: `${prefix}旋转`, exact: true }).selectOption(String(controls.quarterTurns ?? 0))
  return { tools, preview: domain === '建筑' ? '预览整栋变换' : '预览自然组变换' }
}
async function groupLifecycle(page, fixture, baseline, result, stem) {
  const controls = fixture.controls, { tools, preview } = await groupTools(page, controls), before = await observer.snapshot()
  const blocks = await observer.blockSnapshot()
  try {
    await observer.measure('group-preview', { start: { event: 'click', selector: 'button', label: preview }, expectedRevision: before.revision,
      unchangedDocument: true, requireSaved: true, rejectText: '候选未通过，工程未修改', until: { preview: true } },
    () => tools.getByRole('button', { name: preview, exact: true }).click())
  } catch (error) {
    const text = await page.locator('body').innerText()
    if (!text.includes('候选未通过，工程未修改') || !/预算|上限|超限|几何|未随动|完整支撑/.test(text)) throw error
    const rejected = await download(page, `${stem}-group-rejected`); sameContent(baseline, rejected, 'Rejected group')
    check(rejected.scene.revision === baseline.scene.revision, 'Rejected group changed revision')
    result.coverage.groupTransform = { status: 'rejected', message: text, revisionUnchanged: true, completeContentUnchanged: true,
      expectedPreparation: fixture.summary.aggregatePreparation, meaning: 'Real normal-UI refusal at unchanged load; not a supported aggregate-capacity pass.' }
    result.storage.groupRejected = diffAggregateBlocks(blocks, await observer.blockSnapshot(blocks.databaseName))
    await page.screenshot({ path: path.join(output, `${stem}-group-rejected.png`), fullPage: true })
    return
  }
  check(controls.expectedGroupTransform !== 'reject-external-support', 'Incomplete external-support negative case unexpectedly prepared')
  const review = page.locator('.workspace-candidate-review[aria-label="候选审阅"]')
  const extra = review.locator('.composition-preview-details'); if (await extra.count()) await details(extra)
  const budget = review.getByLabel('普通事务保护详情', { exact: true }); if (await budget.count()) await details(budget)
  result.groupReview = await review.innerText()
  await page.screenshot({ path: path.join(output, `${stem}-group-preview.png`), fullPage: true })
  await adoptReview(page, 'group-adopt', before.revision + 1, '采用结构修改')
  const moved = await download(page, `${stem}-group-moved`)
  sameResources(baseline, moved); assertRemote(baseline, moved, controls); assertCore(baseline, moved, controls)
  result.storage.groupAdopt = diffAggregateBlocks(blocks, await observer.blockSnapshot(blocks.databaseName))
  for (const [kind, label, expected] of [['group-undo', '撤销编辑', baseline], ['group-redo', '重做编辑', moved], ['group-reset-undo', '撤销编辑', baseline]]) {
    const state = await observer.snapshot()
    await observer.measure(kind, { start: { event: 'click', selector: 'button', label }, expectedRevision: state.revision + 1, domainCommit: true, requireSaved: true },
      () => page.getByRole('button', { name: label, exact: true }).click())
    sameContent(expected, await download(page, `${stem}-${kind}`), kind)
  }
  result.coverage.groupTransform = { status: 'complete', coreFrameAndLocalMembersExact: true, externalRecordsUnchanged: true, undoRedoResetCompleteContent: true }
}

// Fixed before measurement from the frozen package geometry, independently of
// the existing small-Prop list/edit targets. Never pick from screen results.
const canvasSelectionIdsByKind = Object.freeze({
  building: Object.freeze(['q2-bed-sage-25', 'q2-bed-indigo-24']),
  natural: Object.freeze(['q1-tree-split-crown-3', 'q1-tree-windbent-6']),
  mixed: Object.freeze(['interior-94abf0846ab07254cb189ad3c7f8f4061cf5ee77', 'interior-0fdf5a321fc0023b9428541eface4c67b4be5310']),
})
function canvasSelectionIds(name) {
  // Mixed fixtures deliberately use the natural aggregate operation adapter.
  // Their fixture kind, rather than controls.domain, owns the frozen targets.
  const ids = canvasSelectionIdsByKind[name.split('-')[0]]
  check(ids?.length === 2 && new Set(ids).size === 2, `Missing fixed canvas targets for ${name}`)
  return ids
}
function immediatePropPreflight(data, id) {
  const scene = data.scene, prop = scene.props[id]
  check(prop?.visibility === 'public' && !prop.editLocked && !scene.userLayers[scene.entityLayers[id]]?.editLocked,
    `Immediate edit target must be an existing public unlocked full Prop: ${id}`)
  check(!Object.values(scene.aggregateCoordinates.groups).some(group => group.members.some(member => member.id === id)),
    `Immediate edit target is owned by an aggregate: ${id}`)
  for (const collection of ['prefabInstances', 'scatterGroups', 'decorationClusters']) {
    check(!Object.values(scene[collection]).some(group => Object.values(group.members).some(member => member.propId === id || member.entityId === id)),
      `Immediate edit target is managed by ${collection}: ${id}`)
  }
  // This corpus freezes a remote rectangular terrain support. Prove both
  // complete footprints remain inside it, without importing a compiled product
  // build or pretending a point-only check establishes arbitrary support.
  const support = prop.supportRef.kind === 'terrainArea' ? scene.terrainAreas[prop.supportRef.id] : null
  check(support?.floorId === prop.floorId && !support.editLocked
    && !scene.userLayers[scene.entityLayers[support.id]]?.editLocked, `Immediate edit requires its unlocked frozen terrain support: ${id}`)
  const ring = support.boundaryMm.map(vertex => vertex.positionMm)
  const left = Math.min(...ring.map(point => point.x)), right = Math.max(...ring.map(point => point.x))
  const top = Math.min(...ring.map(point => point.y)), bottom = Math.max(...ring.map(point => point.y))
  check(ring.length === 4 && left < right && top < bottom
    && new Set(ring.map(point => `${point.x},${point.y}`)).size === 4
    && ring.every((point, index) => (point.x === left || point.x === right) && (point.y === top || point.y === bottom)
      && (point.x === ring[(index + 1) % 4].x || point.y === ring[(index + 1) % 4].y)),
    `Immediate edit fixture support must be the declared exact rectangle: ${id}`)
  const floor = scene.floors[prop.floorId]?.boundsMm, angle = prop.rotationDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  const footprint = { x: prop.footprintOffsetMm.x - prop.footprintMm.width / 2,
    y: prop.footprintOffsetMm.y - prop.footprintMm.height / 2, ...prop.footprintMm }
  for (const offsetMm of [0, 1]) {
    const polygon = [[footprint.x, footprint.y], [footprint.x + footprint.width, footprint.y],
      [footprint.x + footprint.width, footprint.y + footprint.height], [footprint.x, footprint.y + footprint.height]]
      .map(([x, y]) => ({ x: prop.positionMm.x + offsetMm + x * c - y * s, y: prop.positionMm.y + x * s + y * c }))
    check(floor && polygon.every(point => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
      && point.x >= floor.x && point.x <= floor.x + floor.width && point.y >= floor.y && point.y <= floor.y + floor.height),
      `Immediate edit footprint loses actual support at world X+${offsetMm}mm: ${id}`)
    const bounds = { left: Math.min(...polygon.map(point => point.x)), right: Math.max(...polygon.map(point => point.x)),
      top: Math.min(...polygon.map(point => point.y)), bottom: Math.max(...polygon.map(point => point.y)) }
    check(!Object.values(scene.terrainAreas).some(area => area.floorId === prop.floorId && area.coveragePriority > support.coveragePriority
      && Math.max(...area.boundaryMm.map(vertex => vertex.positionMm.x)) > bounds.left
      && Math.min(...area.boundaryMm.map(vertex => vertex.positionMm.x)) < bounds.right
      && Math.max(...area.boundaryMm.map(vertex => vertex.positionMm.y)) > bounds.top
      && Math.min(...area.boundaryMm.map(vertex => vertex.positionMm.y)) < bounds.bottom),
      `Immediate edit fixture needs an unoccluded frozen support at world X+${offsetMm}mm: ${id}`)
  }
  return { fullPropId: id, supportRef: prop.supportRef, originalWorldPositionMm: prop.positionMm,
    supportedWorldXOffsetsMm: [0, 1], independentOfAggregateAndManagedContainers: true }
}
function worldProp(data, id) {
  const prop = structuredClone(data.scene.props[id]); check(prop, `Missing full Prop ${id}`)
  let group = Object.values(data.scene.aggregateCoordinates.groups).find(value => value.members.some(member => member.kind === 'prop' && member.id === id))
  const visited = new Set()
  while (group) {
    check(!visited.has(group.id), 'Cyclic group while deriving independent canvas target'); visited.add(group.id)
    prop.editLocked ||= group.editLocked
    const p = prop.positionMm, rotated = [{ x: p.x, y: p.y }, { x: -p.y, y: p.x }, { x: -p.x, y: -p.y }, { x: p.y, y: -p.x }][group.frame.quarterTurns]
    prop.positionMm = { x: rotated.x + group.frame.translationMm.x, y: rotated.y + group.frame.translationMm.y }
    prop.rotationDeg = (prop.rotationDeg + group.frame.quarterTurns * 90) % 360
    group = group.parentId === null ? null : data.scene.aggregateCoordinates.groups[group.parentId]
  }
  return prop
}
function canvasTarget(data, id) {
  const prop = worldProp(data, id), presentation = data.appearance.presentations?.[data.appearance.propSources[id]]
  check(prop.visibility === 'public' && !prop.editLocked && !data.scene.userLayers[data.scene.entityLayers[id]]?.editLocked
    && ['object', 'canopy'].includes(prop.renderLayer), `Canvas target must be a public unlocked object/canopy Prop: ${id}`)
  check(prop.appearance.kind === 'image' && Math.min(prop.visualBoundsMm.width, prop.visualBoundsMm.height) >= 1000,
    `Fixed canvas target must have an image with a visual short side of at least 1000mm: ${id}`)
  const b = prop.visualBoundsMm, near = presentation?.mode === 'nearSide', angle = (near ? 0 : prop.rotationDeg) * Math.PI / 180
  const x = b.x + b.width / 2 - (near ? presentation.rootAnchorMm.x : 0), y = b.y + b.height / 2 - (near ? presentation.rootAnchorMm.y : 0)
  return { x: prop.positionMm.x + x * Math.cos(angle) - y * Math.sin(angle), y: prop.positionMm.y + x * Math.sin(angle) + y * Math.cos(angle) }
}
async function continuousViewport(page, result) {
  const fit = page.getByRole('button', { name: '适应全图', exact: true }), viewport = page.locator('.asset-viewport')
  for (let repetition = 0; repetition < (smoke ? 1 : 3); repetition++) {
    await fit.click(); await page.getByRole('button', { name: '平移地图', exact: true }).click(); await observer.ready()
    let box = await viewport.boundingBox(); check(box, 'Missing viewport')
    const start = { x: box.x + box.width * .4, y: box.y + box.height * .45 }; await page.mouse.move(start.x, start.y)
    const pan = await observer.measure('continuous-pan', { start: { event: 'pointerdown', selector: '.asset-viewport', button: 0 }, eventScope: '.asset-viewport',
      endEvent: { event: 'pointerup', selector: '.asset-viewport', button: 0 }, unchangedDocument: true, requireSaved: true, until: { viewChanged: true } }, async () => {
      await page.mouse.down()
      for (let move = 1; move <= 30; move++) { await page.evaluate(() => new Promise(requestAnimationFrame)); await page.mouse.move(start.x + move * 3, start.y + move) }
      await page.mouse.up()
    })
    check(pan.sample.eventCounts.pointermove >= 30 && pan.sample.eventCounts.pointerup >= 1, 'Continuous pan lacks real input sequence')
    pan.sample.activeInputStartMs = pan.sample.intent.captureMs
    pan.sample.activeInputEndMs = pan.sample.endInput.captureMs
    await fit.click(); await page.getByRole('button', { name: '选择地图对象', exact: true }).click(); await observer.ready()
    box = await viewport.boundingBox(); await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
    const wheel = await observer.measure('continuous-wheel', { start: { event: 'wheel', selector: '.asset-viewport' }, eventScope: '.asset-viewport', externalEnd: true,
      unchangedDocument: true, requireSaved: true, until: { viewChanged: true } }, async () => {
      for (let step = 0; step < 20; step++) { await page.evaluate(() => new Promise(requestAnimationFrame)); await page.mouse.wheel(0, 12) }
      await page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').endInputs())
    })
    check(wheel.sample.eventCounts.wheel === 20, 'Continuous wheel sequence was lost/coalesced')
    wheel.sample.activeInputStartMs = wheel.sample.intent.captureMs
    wheel.sample.activeInputEndMs = wheel.sample.events.filter(event => event.type === 'wheel' && event.trusted).at(-1).captureMs
  }
  await fit.click(); await observer.ready()
  result.coverage.continuousViewport = { status: 'complete', segmentsPerKind: smoke ? 1 : 3, panMovesPerSegment: 30, wheelInputsPerSegment: 20,
    timingWindow: 'Only frame intervals overlapping first trusted input through pointerup / explicit last-wheel end; setup and trailing display/save waits excluded.' }
}
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0) }
  return (value ^ 0xffffffff) >>> 0
}
function pngData(bytes, bounds) {
  check(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Not a PNG')
  const chunks = []; let offset = 8, width, height
  while (offset < bytes.length) {
    check(offset + 12 <= bytes.length, 'Truncated PNG chunk')
    const size = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString('ascii'), end = offset + 12 + size
    check(end <= bytes.length && crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'Invalid PNG chunk/CRC')
    check(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB'].includes(type), `Unexpected PNG metadata chunk ${type}`)
    if (type === 'IHDR') { check(offset === 8 && size === 13, 'Invalid IHDR'); width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12) }
    chunks.push({ type, bytes: size }); offset = end
    if (type === 'IEND') { check(size === 0 && offset === bytes.length, 'Trailing PNG data'); break }
  }
  check(chunks.at(-1)?.type === 'IEND', 'Missing IEND')
  const expected = bounds.width >= bounds.height ? { width: 4096, height: Math.round(4096 * bounds.height / bounds.width) }
    : { width: Math.round(4096 * bounds.width / bounds.height), height: 4096 }
  check(width === expected.width && height === expected.height, '4K PNG dimensions/aspect mismatch')
  return { width, height, pixels: width * height, bytes: bytes.length, sha256: hash(bytes), chunks, metadataWhitelistOnly: true }
}
async function exportPng(page, data, audience, stem) {
  const label = audience === 'gm' ? '主持人地图 PNG · 含秘密' : '玩家地图 PNG'
  const menu = page.locator('details.workspace-export-menu'); await details(menu)
  let file
  await observer.measure(`export-png-${audience}`, { start: { event: 'click', selector: 'button', label }, externalEnd: true, unchangedDocument: true, requireSaved: true }, async () => {
    const pending = page.waitForEvent('download'); await menu.getByRole('button', { name: label, exact: true }).click(); file = await pending
    check(!await file.failure(), 'PNG download failed')
    await page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').endInputs())
  })
  observer.setPhase('tooling-pixel-audit')
  const filename = `${stem}-${audience}-4k.png`; await file.saveAs(path.join(output, filename))
  const bytes = await fs.readFile(path.join(output, filename)), info = pngData(bytes, data.scene.exportBoundsMm)
  info.decoded = await page.evaluate(async encoded => {
    const binary = atob(encoded), bytes = Uint8Array.from(binary, value => value.charCodeAt(0)), image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    try {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d'); if (!context) throw new Error('No audit Canvas2D')
      context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, image.width, image.height)
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels.data))].map(value => value.toString(16).padStart(2, '0')).join('')
      let transparentPixels = 0; for (let index = 3; index < pixels.data.length; index += 4) if (pixels.data[index] < 255) transparentPixels++
      return { width: image.width, height: image.height, rgbaSha256: sha256, transparentPixels }
    } finally { image.close() }
  }, bytes.toString('base64'))
  check(info.decoded.width === info.width && info.decoded.height === info.height, 'PNG decoder/header mismatch')
  if (await menu.getAttribute('open') !== null) await menu.locator('summary').click()
  observer.setPhase('setup')
  return { audience, file: filename, ...info, privacyPixelAcceptance: 'Not established by this export alone; requires paired private-mutation control corpus.' }
}

try {
  const previous = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'manifest.json'), 'utf8'))
  check(['sceneweave-current-formal-fixtures', 'sceneweave-aggregate-development-observation'].includes(previous.format), 'Expected frozen current complete-v1 fixture manifest')
  const available = previous.cases ?? previous.fixtures; check(Array.isArray(available), 'Fixture cases missing')
  for (const name of cases) {
    const row = available.find(value => value.name === name); check(row?.summary && row?.controls, `Missing formal fixture ${name}`)
    const sourceFile = row.file ?? row.artifact?.path; check(typeof sourceFile === 'string', `Missing fixture package ${name}`)
    const bytes = await fs.readFile(path.resolve(fixtureDirectory, sourceFile)), data = packageData(bytes)
    const expectedHash = row.package?.sha256 ?? row.artifact?.sha256 ?? row.summary.packageSha256
    check(typeof expectedHash === 'string' && hash(bytes) === expectedHash, `Frozen fixture SHA mismatch ${name}`)
    const expectedCount = Number(name.split('-')[1]) + (name.endsWith('-remote') ? 500 : 0)
    check(Object.keys(data.scene.props).length === expectedCount && Object.keys(data.scene.decorations).length === 0, `Fixture ${name} is not the declared complete-Prop load`)
    check(data.scene.schemaVersion === 1 && data.manifest.schemaVersion === 1, 'Frozen fixture must be current complete v1')
    check(data.scene.units.gridVisible === true && data.scene.units.gridSizeMm === 3600 && data.scene.exportBoundsMm.width === 180000 && data.scene.exportBoundsMm.height === 180000, 'Expected real 50x50 displayed grid')
    for (const id of canvasSelectionIds(name)) canvasTarget(data, id)
    immediatePropPreflight(data, row.controls.remoteEntityId)
    const filename = `${name}-input.sceneweave`; await fs.writeFile(path.join(output, filename), bytes, { flag: 'wx' })
    check(hash(await fs.readFile(path.join(output, filename))) === expectedHash, 'Fixture copied bytes differ')
    manifest.fixtures.push({ ...row, file: filename, package: data.summary })
  }
  await write('manifest.json', manifest)
  check(isDeepStrictEqual(frozen, await inputs()), 'Frozen inputs changed before measurement')
  httpServer = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const relative = (base !== '/' && pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '')) || 'index.html'
      const file = path.resolve(dist, relative); check(file.startsWith(`${dist}${path.sep}`), 'Invalid path')
      const bytes = await fs.readFile(file), mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(bytes)
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve) })
  const origin = `http://127.0.0.1:${httpServer.address().port}`, url = `${origin}${base}#home`
  for (const fixture of manifest.fixtures) for (let run = 1; run <= runCount; run++) {
    if (interrupted) throw new Error('Interrupted')
    const stem = `${fixture.name}-run${run}`, result = { name: fixture.name, run, status: 'running', storage: {}, coverage: {}, exports: [] }
    manifest.results.push(result); console.log(`Current formal: ${stem}`)
    let page
    try {
      page = await launch(); result.browserVersion = browser.version()
      await page.route('**/*', route => { const target = new URL(route.request().url()); return target.origin === origin || ['blob:', 'data:'].includes(target.protocol) ? route.continue() : route.abort('blockedbyclient') })
      observer = await createCurrentFormalObserver({ page, browser, rootPid: ownedServer.process().pid, timeoutMs })
      observer.setPhase('setup-import'); const importStartedNodeMs = performance.now(); await page.goto(url)
      const chooser = page.waitForEvent('filechooser')
      await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
      await (await chooser).setFiles(path.join(output, fixture.file)); await observer.ready()
      result.importSetupNodeMs = performance.now() - importStartedNodeMs
      const baseline = await download(page, `${stem}-baseline`)
      sameImported(packageData(await fs.readFile(path.join(output, fixture.file))), baseline)
      result.storage.baseline = await observer.blockSnapshot()
      result.coverage.aggregateDraftExit = await runAggregateWithDraftCleanup({
        operation: () => groupLifecycle(page, fixture, baseline, result, stem), page, observer, domain: fixture.controls.domain,
        readProject: phase => download(page, `${stem}-${phase}`), assertSameProject: sameComplete,
      })
      const controls = fixture.controls, ids = controls.selectionMemberIds ?? [controls.editableMemberId, controls.remoteEntityId]
      check(ids.length === 2 && new Set(ids).size === 2 && ids.every(id => baseline.scene.props[id]?.visibility === 'public'), 'Two explicit public full Prop selection targets required')
      const canvasTargets = canvasSelectionIds(fixture.name).map(id => ({ id,
        visualBoundsMm: baseline.scene.props[id].visualBoundsMm, worldVisualCenterMm: canvasTarget(baseline, id) }))
      result.coverage.canvasSelection = { status: 'running', count: 0, expectedCount: smoke ? 2 : 6,
        explicitExpectedIds: canvasTargets.map(target => target.id), targets: canvasTargets,
        coordinateSource: 'Fixed per-kind full Prop IDs, complete local package frames and actual presentation visual center, mapped through transformed canvas DOM bounds; exact expected ID asserted.' }
      await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
      await page.getByRole('button', { name: '适应全图', exact: true }).click()
      await page.getByRole('checkbox', { name: '选择组合成员', exact: true }).check()
      await page.getByRole('button', { name: '替换选择', exact: true }).click(); await observer.ready()
      for (let index = 0; index < (smoke ? 2 : 6); index++) {
        const { id, worldVisualCenterMm: target } = canvasTargets[index % 2], bounds = baseline.scene.exportBoundsMm
        const box = await page.locator('canvas[aria-label="材质场景主持人预览"]').boundingBox(), viewport = await page.locator('.asset-viewport').boundingBox()
        check(box && viewport, 'Canvas target unavailable')
        const point = { x: box.x + (target.x - bounds.x) / bounds.width * box.width, y: box.y + (target.y - bounds.y) / bounds.height * box.height }
        check(point.x > viewport.x && point.x < viewport.x + viewport.width && point.y > viewport.y && point.y < viewport.y + viewport.height, 'Independent canvas target is clipped')
        const state = await observer.snapshot()
        await observer.measure('canvas-prop-selection', { start: { event: 'click', selector: '.asset-viewport' }, expectedRevision: state.revision,
          unchangedDocument: true, requireSaved: true, until: { selection: JSON.stringify([id]) } }, () => page.mouse.click(point.x, point.y))
        result.coverage.canvasSelection.count++
      }
      result.coverage.canvasSelection.status = 'complete'
      const objects = await openSceneObjects(page)
      for (let index = 0; index < selectionCount; index++) {
        const id = ids[index % 2]; await objects.getByRole('searchbox', { name: '搜索场景对象', exact: true }).fill(id)
        const state = await observer.snapshot()
        await observer.measure('object-list-selection', { start: { event: 'click', selector: '.asset-virtual-row' }, expectedRevision: state.revision,
          unchangedDocument: true, requireSaved: true, until: { selection: JSON.stringify([id]) } }, () => page.locator(`.asset-virtual-row[data-entity-id="${id}"]`).click())
      }
      result.coverage.objectListSelection = { status: 'complete', count: selectionCount, explicitExpectedIds: ids }
      await selectMember(page, controls.editableMemberId)
      const displayMillimetres = baseline.scene.units.display === 'ft' ? 304.8 : 1000
      const field = page.getByRole('spinbutton', { name: '物件 X', exact: true }), originalMm = Math.round(Number(await field.inputValue()) * displayMillimetres)
      const beforeEdits = await download(page, `${stem}-pre-edits`), beforeBlocks = await observer.blockSnapshot()
      for (let index = 0; index < editCount; index++) {
        if (interrupted) throw new Error('Interrupted')
        const targetMm = originalMm + (index % 2 === 0 ? 1 : 0), state = await observer.snapshot()
        await field.fill(String(targetMm / displayMillimetres))
        const preview = await observer.measure('ordinary-preview', { start: { event: 'keydown', selector: 'input', key: 'Enter' }, expectedRevision: state.revision,
          unchangedDocument: true, requireSaved: true, rejectText: '候选未通过，工程未修改', until: { preview: true } }, () => field.press('Enter'))
        const adopted = await adoptReview(page, 'ordinary-adopt', state.revision + 1, '采用组件修改')
        adopted.sample.editIntentToDomainCommitMs = adopted.sample.domainCommittedAtMs - preview.sample.intent.captureMs
        adopted.sample.editIntentToSavedMs = adopted.sample.savedReadyMs - preview.sample.intent.captureMs
        adopted.sample.previewIntentToReviewDisplayMs = preview.sample.intentToDisplayProxyMs
        adopted.sample.reviewReadyToAdoptionCaptureMs = adopted.sample.intent.captureMs - preview.sample.displayProxyMs
        check(Math.round(Number(await field.inputValue()) * displayMillimetres) === targetMm, 'Adopted world millimetre position differs')
        if (index === 0) {
          const first = await download(page, `${stem}-first-edit`); assertOnlyProps(beforeEdits, first, [controls.editableMemberId]); sameResources(beforeEdits, first)
          result.storage.firstPropEdit = diffAggregateBlocks(beforeBlocks, await observer.blockSnapshot(beforeBlocks.databaseName))
        }
      }
      const groupedEdited = await download(page, `${stem}-grouped-edited`); sameContent(beforeEdits, groupedEdited, 'Alternating grouped ordinary edits')
      check(groupedEdited.scene.revision === beforeEdits.scene.revision + editCount, 'Grouped ordinary edits did not produce one revision each')
      const afterBlocks = await observer.blockSnapshot(beforeBlocks.databaseName)
      result.storage.allPropEdits = diffAggregateBlocks(beforeBlocks, afterBlocks); result.storage.afterGroupedEdits = afterBlocks
      result.coverage.ordinary = { status: 'complete', count: editCount, fullPropId: controls.editableMemberId, exactFirstEditAndFinalContent: true,
        flow: 'Enter -> complete preview -> trusted adoption click -> exact domain revision and saved/raster-ready; both intervals retained.' }
      const immediateTarget = immediatePropPreflight(groupedEdited, controls.remoteEntityId)
      await selectMember(page, immediateTarget.fullPropId); await observer.ready()
      const immediateField = page.getByRole('spinbutton', { name: '物件 X', exact: true })
      const immediateOriginalMm = Math.round(Number(await immediateField.inputValue()) * displayMillimetres)
      check(immediateOriginalMm === immediateTarget.originalWorldPositionMm.x, 'Immediate target field differs from its independent world position')
      result.coverage.immediateOrdinary = { status: 'running', count: 0, expectedCount: editCount, ...immediateTarget,
        flow: 'Trusted Enter -> immediate complete validated domain commit -> actual saved/raster-ready; no preview/adoption interval.' }
      for (let index = 0; index < editCount; index++) {
        if (interrupted) throw new Error('Interrupted')
        const targetMm = immediateOriginalMm + (index % 2 === 0 ? 1 : 0), state = await observer.snapshot()
        await immediateField.fill(String(targetMm / displayMillimetres))
        await observer.measure('immediate-prop-edit', { start: { event: 'keydown', selector: 'input', key: 'Enter' }, expectedRevision: state.revision + 1,
          domainCommit: true, requireSaved: true, requireRaster: true, rejectText: '候选未通过，工程未修改', until: { preview: false } }, () => immediateField.press('Enter'))
        check(Math.round(Number(await immediateField.inputValue()) * displayMillimetres) === targetMm, 'Immediate world millimetre position differs')
        result.coverage.immediateOrdinary.count++
        if (index === 0) {
          const first = await download(page, `${stem}-first-immediate-edit`)
          assertOnlyProps(groupedEdited, first, [immediateTarget.fullPropId]); sameResources(groupedEdited, first)
          result.storage.firstImmediatePropEdit = diffAggregateBlocks(afterBlocks, await observer.blockSnapshot(afterBlocks.databaseName))
        }
      }
      const edited = await download(page, `${stem}-edited`); sameContent(groupedEdited, edited, 'Alternating independent immediate edits')
      check(edited.scene.revision === groupedEdited.scene.revision + editCount, 'Immediate edits did not produce one revision each')
      const finalBlocks = await observer.blockSnapshot(afterBlocks.databaseName)
      result.storage.allImmediatePropEdits = diffAggregateBlocks(afterBlocks, finalBlocks); result.storage.afterEdits = finalBlocks
      result.coverage.immediateOrdinary.status = 'complete'; result.coverage.immediateOrdinary.exactFirstEditAndFinalContent = true
      await continuousViewport(page, result)
      result.exports.push(await exportPng(page, edited, 'gm', stem)); result.exports.push(await exportPng(page, edited, 'player', stem))
      check(result.exports[0].decoded.rgbaSha256 !== result.exports[1].decoded.rgbaSha256, 'Secret-bearing fixture produced identical GM/player pixels')
      result.coverage.png = { status: 'complete', dimensionsAndMetadata: true, decodedPixelHashes: true, pairedPrivateMutationPrivacy: false }
      observer.setPhase('tooling-screenshot'); await page.screenshot({ path: path.join(output, `${stem}-final.png`), fullPage: true })
      observer.setPhase('setup-cold-reload'); await page.goto(url); await page.reload()
      const row = page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: edited.scene.title, exact: true }) })
      await row.getByRole('button', { name: '打开', exact: true }).waitFor({ state: 'visible' })
      await observer.measure('cold-open', { start: { event: 'click', selector: 'button', label: '打开' }, expectedRevision: edited.scene.revision, requireSaved: true },
        () => row.getByRole('button', { name: '打开', exact: true }).click())
      await observer.ready(); const cold = await download(page, `${stem}-cold`); sameComplete(edited, cold)
      result.coverage.coldOpen = { status: 'complete', allEntryHashesEqual: true, exactResourceLicenseAndSourceClosure: true }
      result.verification = { baseline: baseline.summary, edited: edited.summary, cold: cold.summary, identityVersion: cold.identity.version }
      result.status = 'complete'
    } catch (error) {
      result.status = interrupted ? 'interrupted' : 'failed'; result.error = error.stack ?? String(error)
      try { observer?.setPhase('tooling-failure'); await page.screenshot({ path: path.join(output, `${stem}-failure.png`), fullPage: true }); result.failureText = await page.locator('body').innerText() } catch {}
      manifest.failures.push({ name: fixture.name, run, error: result.error })
    } finally {
      try { if (observer) result.metrics = await observer.stop() } catch (error) { result.status = 'failed'; result.observerError = String(error); manifest.failures.push({ name: fixture.name, run, error: result.observerError }) }
      observer = null
      try { result.teardown = await closeBrowser() } catch (error) { result.status = 'failed'; result.teardownError = String(error); manifest.failures.push({ name: fixture.name, run, error: result.teardownError }) }
      if (result.metrics) {
        const audit = result.metrics.audit
        const errors = [...audit.pageErrors, ...audit.requestFailures.filter(row => !row.errorText?.includes('ERR_ABORTED')),
          ...audit.httpErrors.filter(row => !row.url.endsWith('/favicon.ico')), ...audit.consoleErrors.filter(row => !row.location?.url?.endsWith('/favicon.ico')),
          ...audit.browserErrors.filter(row => !row.url?.endsWith('/favicon.ico')), ...(result.metrics.resources.errors ?? []), ...(result.metrics.clockGaps ?? [])]
        if (errors.length) { result.status = 'failed'; result.auditFailures = errors; manifest.failures.push({ name: fixture.name, run, error: 'Browser/network/resource/clock errors', details: errors }) }
      }
      const rawName = `${stem}.json`
      const rawBytes = JSON.stringify(result, null, 2)
      await fs.writeFile(path.join(output, rawName), rawBytes)
      manifest.results[manifest.results.length - 1] = compactFormalRunForManifest(result,
        { file: rawName, sha256: hash(rawBytes), resourceSeries: 'All exact raw process and heap samples remain in this per-run file.' })
      await write('manifest.json', manifest)
    }
    check(isDeepStrictEqual(frozen, await inputs()), 'Source/build/tool/fixture bytes drifted during measurement')
  }
  manifest.status = manifest.failures.length ? 'failed' : 'complete'
  if (manifest.failures.length) process.exitCode = 1
} catch (error) {
  manifest.status = interrupted ? 'interrupted' : 'failed'; manifest.error = error.stack ?? String(error); process.exitCode = 1; console.error(error)
} finally {
  const errors = []
  for (const [name, action] of [['observer', () => observer?.stop()], ['browser', async () => { if (ownedServer) manifest.finalTeardown = await closeBrowser() }],
    ['http', () => httpServer && new Promise(resolve => httpServer.close(resolve))]]) {
    try { await action() } catch (error) { errors.push({ name, error: String(error) }) }
  }
  if (errors.length) { manifest.cleanupErrors = errors; manifest.status = 'failed'; process.exitCode = 1 }
  try { manifest.inputUnchangedAfterMeasurement = isDeepStrictEqual(frozen, await inputs()) } catch (error) { manifest.inputAuditError = String(error); manifest.inputUnchangedAfterMeasurement = false }
  if (!manifest.inputUnchangedAfterMeasurement) { manifest.status = 'failed'; process.exitCode = 1 }
  manifest.finishedAt = new Date().toISOString(); await write('manifest.json', manifest); await write('summary.json', summarizeCurrentFormal(manifest))
  sleepGuard?.kill(); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt)
}
