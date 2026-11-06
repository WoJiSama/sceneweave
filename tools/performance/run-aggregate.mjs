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
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'
import { createAggregateObserver, diffAggregateBlocks } from './aggregate-observer.mjs'

// Deliberately a low-sample development observation, never the formal 09 matrix.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2), argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/run-aggregate.mjs --output ABS [--dist ABS] [--fixtures ABS] [--cases building-500,building-2000,natural-500,natural-2000,mixed-500,mixed-2000,mixed-500-remote,mixed-500-boundary] [--channel chrome] [--timeout-ms 180000]')
  console.log('Fresh exclusive output; normal production UI; one diagnostic lifecycle per case. Prepare real complete packages in a separate browser first, then close it. Run serially without other automated browsers, tests or builds. Block payload growth is not physical I/O. No p95 or capacity pass is produced.')
  process.exit(0)
}
const check = (value, message) => { if (!value) throw new Error(message) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const output = argument('--output', ''), dist = path.resolve(argument('--dist', path.join(root, 'dist')))
const channel = argument('--channel', 'chrome'), timeoutMs = Number(argument('--timeout-ms', '180000'))
const fixtureDirectory = argument('--fixtures', null)
const cases = argument('--cases', 'building-500,building-2000,natural-500,natural-2000,mixed-500,mixed-2000').split(',')
check(path.isAbsolute(output), '--output must be absolute')
check(cases.length > 0 && new Set(cases).size === cases.length && cases.every(value => /^(building|natural|mixed)-(500|2000)$/.test(value) || /^mixed-500-(remote|boundary)$/.test(value)), 'Expected unique kind-500/kind-2000 cases or mixed-500-remote/boundary')
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
  return { src: await fingerprint(path.join(root, 'src')), public: await fingerprint(path.join(root, 'public')), assets: await fingerprint(path.join(root, 'assets')), build: await fingerprint(dist),
    tools: await Promise.all(['tools/performance/run-aggregate.mjs', 'tools/performance/aggregate-observer.mjs', 'tools/performance/native-m2-observer.mjs',
      'tools/performance/resources.mjs', 'tools/performance/close-browser.mjs', 'tools/performance/prepare-native-m2-fixture.mjs',
      'tools/testing/aggregate-capacity-fixtures.ts', 'package.json', 'package-lock.json', 'vite.config.ts'].map(async name => ({ path: name, sha256: hash(await fs.readFile(path.join(root, name))) }))) }
}
const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
check(!html.includes('/@vite/client'), 'Expected production build')
check(!(await fs.readdir(dist)).includes('diagnostic-stages.json'), 'Instrumented build is not supported')
const base = /<script[^>]+src="([^"]+\/assets\/)/.exec(html)?.[1]?.replace(/assets\/$/, '') ?? '/'
const frozen = await inputs()
const manifest = { format: 'sceneweave-aggregate-development-observation', version: 1, startedAt: new Date().toISOString(), status: 'running',
  measurementClass: 'diagnostic-normal-production-ui', sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), frozen, inputFingerprint: hash(JSON.stringify(frozen)),
  device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  config: { cases, channel, timeoutMs, viewport: { width: 1512, height: 982 }, dpr: 1, samplesPerOperation: 1, base,
    cache: 'Fresh dedicated Chrome process/profile per case; HTTP cache disabled. OS caches are not purged.',
    timing: 'Trusted input capture to domain commit, saved state and double-rAF scheduling proxy. Preview, adoption, local edit and cold open are separate. CPU brackets include observer/automation waits. Reload before cold Open is setup.',
    storage: 'SHA-verified new committed immutable payload bytes and distinct changed final row JSON bytes between readonly snapshots. Neither observes repeated identical writes nor physical disk I/O.',
    limits: ['Development observations only; no percentile, speedup or capacity promise.', 'Resource, permission, geometry and CAS protections remain enabled.', 'RSS is macOS dedicated process-tree sum, can double-count shared pages; heap omits GPU/other targets.', 'Tooling download/storage audit phases are excluded from product phase peaks.'] }, fixtures: [], results: [], failures: [] }
await write('manifest.json', manifest)
const sleepGuard = process.platform === 'darwin' ? spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : null
sleepGuard?.on('error', () => {})
let tooling, ownedServer, browser, observer, httpServer, interrupted = false
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
async function details(locator) { if (await locator.getAttribute('open') === null) await locator.locator('summary').first().click() }
async function number(scope, label, value) { const field = scope.getByRole('spinbutton', { name: label, exact: true }); await field.fill(String(value)); await field.press('Enter') }
async function adoptReview(page, kind, revision, expectedLabel) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const confirmation = review.getByLabel('确认完整影响范围', { exact: true })
  if (await confirmation.count()) await confirmation.check()
  const button = review.getByRole('button', { name: expectedLabel, exact: true })
  return observer.measure(kind, { start: { event: 'click', selector: 'button', label: expectedLabel }, expectedRevision: revision,
    domainCommit: true, requireSaved: true }, () => button.click())
}
async function download(page, name) {
  observer.setPhase('tooling-package-audit')
  const menu = page.locator('details.workspace-export-menu'); await details(menu)
  const pending = page.waitForEvent('download')
  await menu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
  const file = await pending; check(!await file.failure(), 'Download failed')
  await file.saveAs(path.join(output, name))
  const result = packageData(await fs.readFile(path.join(output, name)))
  await observer.ready()
  if (await menu.getAttribute('open') !== null) await menu.locator('summary').click()
  observer.setPhase('setup')
  return result
}
async function groupTools(page, controls) {
  const domain = controls.domain === 'building' ? '建筑' : '地形'
  await page.getByRole('tab', { name: domain, exact: true }).click()
  if (domain === '地形') await page.getByRole('group', { name: '地形任务', exact: true }).getByRole('button', { name: /^绘制地形/ }).click()
  const tools = page.getByLabel(domain === '建筑' ? '建筑组工具' : '自然组工具', { exact: true })
  await details(tools)
  await tools.getByRole('combobox', { name: domain === '建筑' ? '建筑组' : '自然组', exact: true }).selectOption(controls.groupId)
  const prefix = domain === '建筑' ? '整栋' : '自然组'
  await number(tools, `${prefix}偏移 X`, controls.offsetMm.x / 1000)
  await number(tools, `${prefix}偏移 Y`, controls.offsetMm.y / 1000)
  await tools.getByRole('combobox', { name: `${prefix}旋转`, exact: true }).selectOption(String(controls.quarterTurns ?? 0))
  return { tools, preview: domain === '建筑' ? '预览整栋变换' : '预览自然组变换' }
}
async function editMember(page, controls, suffix) {
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索场景物件', exact: true }).fill(controls.editableMemberId)
  await page.locator(`.asset-virtual-row[data-entity-id="${controls.editableMemberId}"]`).click()
  check(controls.editableMemberKind === 'prop', 'Diagnostic local edit currently requires a real prop')
  const field = page.getByRole('spinbutton', { name: '物件 X', exact: true })
  const before = await observer.snapshot(), original = Number(await field.inputValue())
  await field.fill(String(original + 0.001))
  await observer.measure(`local-edit-preview${suffix}`, { start: { event: 'keydown', selector: 'input', key: 'Enter' }, expectedRevision: before.revision,
    unchangedDocument: true, requireSaved: true, rejectText: '候选未通过，工程未修改', until: { preview: true } }, () => field.press('Enter'))
  return adoptReview(page, `local-edit${suffix}`, before.revision + 1, '采用组件修改')
}
async function bulkMembers(page, controls) {
  const ids = controls.bulkEditableMemberIds
  check(Array.isArray(ids) && ids.length === 32 && new Set(ids).size === 32, 'Expected 32 explicit supported props')
  for (const [index, id] of ids.entries()) {
    await page.getByRole('searchbox', { name: '搜索场景物件', exact: true }).fill(id)
    await page.locator(`.asset-virtual-row[data-entity-id="${id}"]`).click({ modifiers: index ? ['Shift'] : [] })
  }
  await number(page, '批量位移 X', 1)
  const before = await observer.snapshot(), preview = '预览批量移动'
  await observer.measure('bulk-32-preview', { start: { event: 'click', selector: 'button', label: preview }, expectedRevision: before.revision, unchangedDocument: true, rejectText: '候选未通过，工程未修改', until: { preview: true } }, () => page.getByRole('button', { name: preview, exact: true }).click())
  return adoptReview(page, 'bulk-32-adopt', before.revision + 1, '采用批量修改')
}
try {
  // All fixture work is finished before the first measured product process.
  let page
  if (fixtureDirectory) {
    check(path.isAbsolute(fixtureDirectory), '--fixtures must be absolute')
    const previous = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'manifest.json'), 'utf8'))
    check(previous.format === manifest.format && previous.fixtures.length, 'Expected previously frozen aggregate corpus')
    for (const name of cases) {
      const fixture = previous.fixtures.find(row => row.name === name); check(fixture, `Missing frozen fixture ${name}`)
      const bytes = await fs.readFile(path.join(fixtureDirectory, fixture.file)); check(hash(bytes) === fixture.package.sha256, `Frozen fixture mismatch ${name}`)
      packageData(bytes)
      await fs.writeFile(path.join(output, fixture.file), bytes, { flag: 'wx' })
      check(hash(await fs.readFile(path.join(output, fixture.file))) === hash(bytes), 'Frozen fixture copy reread mismatch')
      manifest.fixtures.push(fixture)
    }
    manifest.fixtureReuse = { directory: fixtureDirectory, inputFingerprint: previous.inputFingerprint, method: 'Exact previously browser-validated frozen package bytes, SHA-verified and disk-reread; no regeneration.' }
  } else {
  tooling = await startNativeFixtureTooling({ root })
  page = await launch(); await page.goto(tooling.url)
  for (const name of cases) {
    if (interrupted) throw new Error('Interrupted')
    console.log(`Aggregate fixture: ${name}`)
    const [kind, count, axis] = name.split('-'), variant = axis === 'remote' ? { remoteExtraDetails: 500 } : axis === 'boundary' ? { extraExternalConnections: 16 } : undefined
    const prepared = await page.evaluate(async ({ kind, detailCount, variant }) => {
      const module = await import('/tools/testing/aggregate-capacity-fixtures.ts')
      const fixture = await module.prepareAggregateCapacityFixture(kind, detailCount, variant)
      return { ...fixture, bytes: Array.from(fixture.bytes) }
    }, { kind, detailCount: Number(count), variant })
    const bytes = Uint8Array.from(prepared.bytes), filename = `${name}-input.sceneweave`
    await fs.writeFile(path.join(output, filename), bytes, { flag: 'wx' })
    const reread = await fs.readFile(path.join(output, filename)); check(hash(bytes) === hash(reread), 'Fixture disk reread mismatch')
    const parsed = packageData(reread)
    manifest.fixtures.push({ name, file: filename, summary: prepared.summary, controls: prepared.controls, package: parsed.summary })
    await write('manifest.json', manifest)
  }
  manifest.fixtureTeardown = await closeBrowser(); await tooling.close(); tooling = null
  }
  check(isDeepStrictEqual(frozen, await inputs()), 'Inputs drifted during fixture preparation')
  httpServer = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const relative = (base !== '/' && pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '')) || 'index.html'
      const file = path.resolve(dist, relative)
      check(file.startsWith(`${dist}${path.sep}`), 'Invalid path')
      const bytes = await fs.readFile(file), mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(bytes)
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve) })
  const url = `http://127.0.0.1:${httpServer.address().port}${base}#home`
  for (const fixture of manifest.fixtures) {
    if (interrupted) throw new Error('Interrupted')
    const result = { name: fixture.name, status: 'running', fixture, observations: [], storage: {}, verification: {} }
    manifest.results.push(result)
    console.log(`Aggregate product: ${fixture.name}`)
    try {
      page = await launch(); result.browserVersion = browser.version()
      observer = await createAggregateObserver({ page, browser, rootPid: ownedServer.process().pid, timeoutMs })
      observer.setPhase('setup-import')
      await page.goto(url)
      const chooser = page.waitForEvent('filechooser')
      await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
      await (await chooser).setFiles(path.join(output, fixture.file))
      await observer.ready(); observer.setPhase('setup')
      const baseline = await download(page, `${fixture.name}-baseline.sceneweave`)
      sameImported(packageData(await fs.readFile(path.join(output, fixture.file))), baseline)
      let stored = await observer.blockSnapshot(); result.storage.baseline = stored
      const controls = fixture.controls
      await page.getByRole('searchbox', { name: '搜索场景物件', exact: true }).fill(controls.remoteEntityId)
      const remoteState = await observer.snapshot()
      result.observations.push(await observer.measure('remote-selection', { start: { event: 'click', selector: '.asset-virtual-row' }, expectedRevision: remoteState.revision,
        unchangedDocument: true, requireSaved: true, until: { selection: JSON.stringify([controls.remoteEntityId]) } }, () => page.locator(`.asset-virtual-row[data-entity-id="${controls.remoteEntityId}"]`).click()))
      check(Number(await page.getByRole('spinbutton', { name: '物件 X', exact: true }).inputValue()) === baseline.scene.props[controls.remoteEntityId].positionMm.x / 1000, 'Remote selection did not materialize the correct world position')
      const { tools, preview } = await groupTools(page, controls)
      const before = await observer.snapshot()
      result.observations.push(await observer.measure('group-preview', { start: { event: 'click', selector: 'button', label: preview }, expectedRevision: before.revision, unchangedDocument: true, requireSaved: true, rejectText: '候选未通过，工程未修改', until: { preview: true } }, () => tools.getByRole('button', { name: preview, exact: true }).click()))
      const review = page.getByRole('region', { name: '候选审阅', exact: true })
      await details(review.locator('.composition-preview-details'))
      await details(review.getByLabel('普通事务保护详情', { exact: true }))
      result.budgetReview = await review.innerText()
      await page.screenshot({ path: path.join(output, `${fixture.name}-preview.png`), fullPage: true })
      await review.getByLabel('确认完整影响范围', { exact: true }).check()
      result.observations.push(await observer.measure('group-adopt', { start: { event: 'click', selector: 'button', label: '采用结构修改' }, expectedRevision: before.revision + 1, domainCommit: true, requireSaved: true }, () => review.getByRole('button', { name: '采用结构修改', exact: true }).click()))
      let next = await observer.blockSnapshot(stored.databaseName); result.storage.group = diffAggregateBlocks(stored, next); stored = next
      const moved = await download(page, `${fixture.name}-moved.sceneweave`)
      sameResources(baseline, moved); assertRemote(baseline, moved, controls)
      assertCore(baseline, moved, controls)
      for (const [kind, label] of [['undo', '撤销编辑'], ['redo', '重做编辑']]) {
        const state = await observer.snapshot()
        result.observations.push(await observer.measure(kind, { start: { event: 'click', selector: 'button', label }, expectedRevision: state.revision + 1, domainCommit: true, requireSaved: true }, () => page.getByRole('button', { name: label, exact: true }).click()))
        const data = await download(page, `${fixture.name}-${kind}.sceneweave`)
        const expected = kind === 'undo' ? baseline : moved
        check(isDeepStrictEqual(sceneContent(expected.scene), sceneContent(data.scene)), `${kind}: complete scene content mismatch`)
        for (const key of ['identity', 'appearance', 'sources']) check(isDeepStrictEqual(expected[key], data[key]), `${kind}: complete ${key} mismatch`)
        sameResources(baseline, data)
      }
      const preLocal = await observer.blockSnapshot(stored.databaseName)
      result.observations.push(await editMember(page, controls, ''))
      next = await observer.blockSnapshot(stored.databaseName); result.storage.local = diffAggregateBlocks(preLocal, next); result.storage.final = next
      let edited = await download(page, `${fixture.name}-edited.sceneweave`)
      assertRemote(baseline, edited, controls); sameResources(baseline, edited)
      assertOnlyProps(moved, edited, [controls.editableMemberId])
      check(!isDeepStrictEqual(moved.scene.props[controls.editableMemberId], edited.scene.props[controls.editableMemberId]), 'Local prop did not change')
      if (fixture.name === 'mixed-500') {
        const preBulk = await observer.blockSnapshot(stored.databaseName)
        result.observations.push(await bulkMembers(page, controls))
        const postBulk = await observer.blockSnapshot(stored.databaseName); result.storage.bulk32 = diffAggregateBlocks(preBulk, postBulk); result.storage.final = postBulk
        const bulk = await download(page, `${fixture.name}-bulk.sceneweave`)
        assertOnlyProps(edited, bulk, controls.bulkEditableMemberIds)
        const changed = Object.keys(edited.scene.props).filter(id => !isDeepStrictEqual(edited.scene.props[id], bulk.scene.props[id]))
        check(isDeepStrictEqual(changed.sort(), [...controls.bulkEditableMemberIds].sort()), 'Bulk edit changed the wrong prop set')
        assertRemote(baseline, bulk, controls); sameResources(baseline, bulk); edited = bulk
        result.verification.bulk32ExactPropSet = true
      }
      await page.screenshot({ path: path.join(output, `${fixture.name}-edited.png`), fullPage: true })
      await observer.ready()
      observer.setPhase('setup-cold-reload'); await page.goto(url); await page.reload()
      const row = page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: edited.scene.title, exact: true }) })
      await row.getByRole('button', { name: '打开', exact: true }).waitFor({ state: 'visible' })
      result.observations.push(await observer.measure('cold-open', { start: { event: 'click', selector: 'button', label: '打开' }, expectedRevision: edited.scene.revision, requireSaved: true }, () => row.getByRole('button', { name: '打开', exact: true }).click()))
      await observer.ready()
      const cold = await download(page, `${fixture.name}-cold.sceneweave`); sameComplete(edited, cold)
      result.verification = { ...result.verification, importedFullScene: true, immutableResources: true, externalRecordsUnchanged: true, coreFrameAndLocalMembersExact: true, privateRecordsPreserved: true,
        playerExport: 'Not exercised in this development observation; complete projection/PNG privacy acceptance remains in 09.', undoRedoFullScene: true, localEditExactPropSet: true, coldAllEntryHashesEqual: true,
        baseline: baseline.summary, moved: moved.summary, edited: edited.summary, cold: cold.summary }
      result.status = 'complete'
    } catch (error) {
      result.status = 'failed'; result.error = error.stack ?? String(error)
      try { await page.screenshot({ path: path.join(output, `${fixture.name}-failure.png`), fullPage: true }); result.failureText = await page.locator('body').innerText() } catch {}
      manifest.failures.push({ name: fixture.name, error: result.error })
    } finally {
      if (observer) { result.metrics = await observer.stop(); observer = null }
      result.teardown = await closeBrowser()
      if (result.metrics) {
        const audit = result.metrics.audit
        const errors = [...audit.pageErrors, ...audit.requestFailures.filter(row => !row.errorText?.includes('ERR_ABORTED')),
          ...audit.httpErrors.filter(row => !row.url.endsWith('/favicon.ico')), ...audit.consoleErrors.filter(row => !row.location?.url?.endsWith('/favicon.ico')), ...audit.browserErrors.filter(row => !row.url?.endsWith('/favicon.ico'))]
        if (errors.length) { result.status = 'failed'; result.auditFailures = errors; manifest.failures.push({ name: fixture.name, error: 'Unexpected browser/network errors', details: errors }) }
      }
      await write(`${fixture.name}.json`, result); await write('manifest.json', manifest)
    }
    check(isDeepStrictEqual(frozen, await inputs()), 'Source/build/tooling drifted during product observation')
    // A failed case is evidence, not permission to silently substitute a load.
    if (result.status !== 'complete') throw new Error(`${fixture.name} failed; inspect retained evidence before proceeding`)
  }
  manifest.status = 'complete'
} catch (error) {
  manifest.status = interrupted ? 'interrupted' : 'failed'; manifest.error = error.stack ?? String(error); process.exitCode = 1
  console.error(error)
} finally {
  const cleanupErrors = []
  for (const [name, action] of [['observer', () => observer?.stop()], ['browser', async () => { if (ownedServer) manifest.finalTeardown = await closeBrowser() }],
    ['tooling', () => tooling?.close()], ['http', () => httpServer && new Promise(resolve => httpServer.close(resolve))]]) {
    try { await action() } catch (error) { cleanupErrors.push({ name, error: String(error) }) }
  }
  sleepGuard?.kill(); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt)
  if (cleanupErrors.length) { manifest.status = 'failed'; manifest.cleanupErrors = cleanupErrors; process.exitCode = 1 }
  manifest.endedAt = new Date().toISOString(); await write('manifest.json', manifest)
}
