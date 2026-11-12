import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { chromium } from '@playwright/test'
import { createCurrentFormalObserver } from './current-formal-observer.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'
import { check, sha, readPackage, comparablePackage, assertJourney, auditPng, summarizePair } from './production-pair-audit.mjs'

// Diagnostic normal-production UI only. No automatic retry, product hooks,
// CPU profiler, forced GC, source-module import or mutation of product storage.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const argument = (key, fallback = '') => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/run-production-pair.mjs --before-source ABS --after-source ABS --before-dist ABS --after-dist ABS --fixtures ABS --output ABS --optimization encoding-owner|wall-paint|workflow|representation-worker|history-endpoint|history-audit|history-total [--case mixed-2000] [--pairs 3] [--history-depth 2] [--channel chrome] [--timeout-ms 180000]')
  console.log('AB/BA alternating independent browsers. Import -> first +1mm -> warm reset -> dual 4K -> page-reset cold open -> cold first +1mm -> cold warm reset. Stop product sampling before complete-package download; audit PNG/package in Node after browser exit. macOS RSS / Windows Working Set are distinct metrics. Diagnostic only; cannot close formal capacity/performance gates.')
  process.exit(0)
}
const optimization = argument('--optimization'), fixtureName = argument('--case', 'mixed-2000')
const output = argument('--output'), fixtures = argument('--fixtures'), channel = argument('--channel', 'chrome')
const pairs = Number(argument('--pairs', '3')), timeoutMs = Number(argument('--timeout-ms', '180000'))
const historyDepth = Number(argument('--history-depth', '2'))
const firstSide = argument('--first-side', 'before')
const sources = Object.fromEntries(['before', 'after'].map(side => [side, argument(`--${side}-source`)]))
const builds = Object.fromEntries(['before', 'after'].map(side => [side, argument(`--${side}-dist`)]))
check(['encoding-owner', 'wall-paint', 'workflow', 'representation-worker', 'history-endpoint', 'history-audit', 'history-total'].includes(optimization), 'Choose an explicit optimization scope')
check(Number.isSafeInteger(historyDepth) && historyDepth >= 2 && historyDepth <= 100 && historyDepth % 2 === 0, 'History depth must be an even count from 2 to 100')
check(['before', 'after'].includes(firstSide), 'Invalid first side')
check([output, fixtures, ...Object.values(sources), ...Object.values(builds)].every(value => value && path.isAbsolute(value)), 'All directory arguments must be absolute')
check(Number.isSafeInteger(pairs) && pairs >= 1 && pairs <= 10 && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000, 'Invalid pairs/timeout')
check(![fixtures, ...Object.values(builds), ...Object.values(sources)].some(directory => output === directory || output.startsWith(`${directory}${path.sep}`)), 'Output must be outside frozen directories')
await fs.mkdir(output, { recursive: true })
check((await fs.readdir(output)).length === 0, 'Existing evidence will not be overwritten')
const write = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2))
async function fingerprint(directory, stem = '') {
  const result = []
  for (const entry of await fs.readdir(path.join(directory, stem), { withFileTypes: true })) {
    const name = path.posix.join(stem, entry.name)
    if (entry.isDirectory()) result.push(...await fingerprint(directory, name))
    else if (entry.isFile()) { const bytes = await fs.readFile(path.join(directory, name)); result.push({ path: name, byteLength: bytes.length, sha256: sha(bytes) }) }
    else throw new Error(`Unexpected link in frozen input: ${name}`)
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
async function sourceFingerprint(directory) {
  const folders = ['src', 'public', 'assets']
  return (await Promise.all(folders.map(async folder => (await fingerprint(path.join(directory, folder))).map(row => ({ ...row, path: `${folder}/${row.path}` }))))).flat()
    .concat(await Promise.all(['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.ai.json', 'tools/check-architecture.mjs']
      .map(async file => ({ path: file, sha256: sha(await fs.readFile(path.join(directory, file))) }))))
}
async function inputs() {
  return { before: { source: await sourceFingerprint(sources.before), build: await fingerprint(builds.before) },
    after: { source: await sourceFingerprint(sources.after), build: await fingerprint(builds.after) },
    tools: await fingerprint(path.join(root, 'tools/performance')), fixtures: await fingerprint(fixtures) }
}
const manifest = { format: 'sceneweave-production-single-optimization-pair', version: 1, status: 'running', measurementClass: 'diagnostic-only',
  startedAt: new Date().toISOString(), optimization, pairs, fixtureName, runs: [],
  device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  config: { channel, historyDepth, firstSide, viewport: { width: 1512, height: 982 }, dpr: 1, timeoutMs, order: 'Alternating AB/BA from firstSide; a fresh dedicated browser/profile per side.',
    input: 'Trusted import-button click includes chooser automation; Enter is the trusted edit intent; exact DOM transaction revision and timestamp, saved/raster state and double-rAF are observed.',
    cache: 'HTTP cache disabled. OS cache not purged. Cold open uses a complete page/module reset in the same browser process, not an OS or process cold start.',
    rssMode: process.platform === 'darwin' ? 'macos-process-tree' : process.platform === 'win32' ? 'windows-process-tree' : 'unavailable', heapIntervalMs: 200 },
  limitations: ['Diagnostic low sample count; no formal p95, capacity pass, stable benefit or user P3 claim.',
    'No exclusive-system-load guard. Background competition cannot be excluded; no attribution of stable net benefit.',
    'Windows Working Set sum may double-count shared pages; private commitment is separate. Other unsupported platforms keep RSS unavailable. JS heap is target-only, not browser/GPU/physical memory.',
    'Target-page heap excludes worker, native Canvas and GPU allocations; it cannot establish total memory savings for the workflow output change.',
    'Actual polling intervals and phase-crossing samples are retained. Short phases may have no heap samples.',
    'Double-rAF is a scheduling proxy, not presentation. Intervals to domain, raster and saved overlap and must not be added.',
    'PNG/package audit occurs after product sampling and browser teardown. Package download itself is a separate audit operation.',
    'Independent public Prop X +1mm/reset does not cover free drag, grouped edits, histories, failure matrices, full privacy mutation checks or all of 09.'] }
await write('manifest.json', manifest)
let server, ownedBrowser, browser, observer, activePage, interrupted = false
const interrupt = () => { interrupted = true }
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
try {
  const frozen = await inputs(); manifest.frozen = frozen; manifest.fingerprint = sha(JSON.stringify(frozen))
  const before = new Map(frozen.before.source.map(row => [row.path, row.sha256])), after = new Map(frozen.after.source.map(row => [row.path, row.sha256]))
  const differences = [...new Set([...before.keys(), ...after.keys()])].filter(name => before.get(name) !== after.get(name)).sort()
  const expected = optimization === 'history-total' ? [
    'src/shared/validation/json.ts', 'src/shared/validation/json-capture.test.ts',
    'src/shared/aggregates/scene-coordinates.ts', 'src/shared/project/validate.ts',
    'src/shared/project/delta.ts', 'src/shared/project/delta.test.ts',
    'src/platform/browser/storage/history-records.ts', 'src/platform/browser/storage/storage-audit.ts',
    'src/platform/browser/storage/storage-accounting.ts', 'src/platform/browser/storage/repository.ts',
    'src/platform/browser/storage/repository.test.ts', 'src/platform/browser/storage/history-audit-transaction.test.ts',
  ].sort() : optimization === 'history-audit' ? [
    'src/platform/browser/storage/incremental-history.ts', 'src/platform/browser/storage/repository.ts',
    'src/platform/browser/storage/history-records.ts', 'src/platform/browser/storage/history-audit-worker.ts',
    'src/platform/browser/storage/history-audit-client.ts', 'src/platform/browser/storage/history-audit-client.test.ts',
    'src/platform/browser/storage/history-audit-transaction.test.ts', 'src/platform/browser/storage/transaction-lifetime.ts',
    'src/shared/validation/content.ts', 'src/shared/validation/snapshots.ts', 'src/shared/validation/content-validation.test.ts',
  ].sort() : optimization === 'history-endpoint' ? ['src/shared/project/delta.ts', 'src/shared/aggregates/representation-integration.test.ts'].sort()
    : optimization === 'representation-worker' ? [
    'src/shared/aggregates/scene-coordinates.ts', 'src/shared/aggregates/representation-integration.test.ts',
    'src/platform/browser/ai/svg-port.ts', 'src/platform/browser/ai/svg-worker.ts',
    'src/platform/browser/ai/svg-worker-client.ts', 'src/platform/browser/ai/svg-worker-client.test.ts',
  ].sort() : optimization === 'workflow' ? [
    'src/App.tsx',
    'src/platform/browser/render/canvas-renderer.ts',
    'src/platform/browser/render/renderer.test.ts',
    'src/platform/browser/render/renderer.ts',
    'src/platform/browser/storage/incremental-history.test.ts',
    'src/platform/browser/storage/incremental-history.ts',
    'src/platform/browser/storage/repository.test.ts',
    'src/platform/browser/storage/repository.ts',
    'src/shared/project/delta.test.ts',
    'src/shared/project/delta.ts',
    'src/shared/project/history.ts',
  ].sort() : optimization === 'encoding-owner'
    ? ['src/platform/browser/storage/content-context.ts', 'src/platform/browser/storage/content-encoding-reuse.test.ts', 'src/platform/browser/storage/repository.ts']
    : ['src/platform/browser/render/canvas-renderer.ts']
  check(isDeepStrictEqual(differences, expected), `Unexpected source differences: ${differences.join(', ')}`)
  manifest.sourceDifferences = differences
  if (optimization === 'workflow') manifest.scope = 'Combined cold history audit, internal verified import handoff, transactional resource reads and formal sprite paint bounds; not attribution to one micro-optimization.'
  const fixtureManifest = JSON.parse(await fs.readFile(path.join(fixtures, 'manifest.json'), 'utf8'))
  check(fixtureManifest.status === 'complete', 'Incomplete fixture preparation')
  const fixture = fixtureManifest.cases.find(row => row.name === fixtureName)
  check(fixture?.file && fixture.controls?.remoteEntityId, 'Missing explicit fixture/independent Prop target')
  const inputFile = path.resolve(fixtures, fixture.file)
  check(inputFile.startsWith(`${fixtures}${path.sep}`), 'Invalid fixture path')
  const inputBytes = await fs.readFile(inputFile), input = readPackage(inputBytes)
  check(input.sha256 === (fixture.sha256 ?? fixture.summary?.packageSha256), 'Fixture SHA mismatch')
  const propId = fixture.controls.remoteEntityId, prop = input.scene.props[propId]
  check(prop?.visibility === 'public' && !prop.editLocked && prop.positionMm, 'Expected unlocked public full Prop')
  check(!Object.values(input.scene.aggregateCoordinates?.groups ?? {}).some(group => group.members.some(member => member.id === propId)), 'Immediate target must be independent')
  manifest.fixture = { ...fixture, sha256: input.sha256, byteLength: input.byteLength }
  const urls = {}
  for (const side of ['before', 'after']) {
    const html = await fs.readFile(path.join(builds[side], 'index.html'), 'utf8')
    check(!html.includes('/@vite/client') && !(await fs.readdir(builds[side])).includes('diagnostic-stages.json'), 'Expected normal production build')
    urls[side] = /<script[^>]+src="([^"]+\/assets\/)/.exec(html)?.[1]?.replace(/assets\/$/, '') ?? '/'
  }
  let servedSide = 'before'
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), base = urls[servedSide]
      const relative = (base !== '/' && pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '')) || 'index.html'
      const file = path.resolve(builds[servedSide], relative)
      check(file.startsWith(`${builds[servedSide]}${path.sep}`), 'Invalid request path')
      const bytes = await fs.readFile(file)
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(bytes)
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const origin = `http://127.0.0.1:${server.address().port}`
  for (let pair = 1; pair <= pairs; pair++) {
    for (const side of (pair % 2 === 1) === (firstSide === 'before') ? ['before', 'after'] : ['after', 'before']) {
      check(!interrupted, 'Interrupted')
      check(isDeepStrictEqual(frozen, await inputs()), 'Frozen input/source/build/tool drift before run')
      servedSide = side
      const stem = `pair-${pair}-${side}`, result = { pair, side, status: 'running', pngs: [] }
      manifest.runs.push(result); await write('manifest.json', manifest)
      console.log(`Production pair: ${stem}`)
      let packageFile
      try {
        ownedBrowser = await chromium.launchServer({ channel, headless: true }); browser = await chromium.connect(ownedBrowser.wsEndpoint())
        result.browser = browser.version()
        result.rootPid = ownedBrowser.process().pid; await write('manifest.json', manifest)
        const context = await browser.newContext({ acceptDownloads: true, viewport: manifest.config.viewport, deviceScaleFactor: 1, locale: 'zh-CN' })
        const page = activePage = await context.newPage(); page.setDefaultTimeout(timeoutMs)
        await page.route('**/*', route => { const target = new URL(route.request().url()); return target.origin === origin || ['blob:', 'data:'].includes(target.protocol) ? route.continue() : route.abort('blockedbyclient') })
        observer = await createCurrentFormalObserver({ page, browser, rootPid: ownedBrowser.process().pid, timeoutMs, rssMode: manifest.config.rssMode })
        const url = `${origin}${urls[side]}#home`
        await page.goto(url)
        await observer.measure('import-project', { start: { event: 'click', selector: 'button', label: '打开工程文件' }, expectedRevision: input.scene.revision, requireSaved: true }, async () => {
          const pending = page.waitForEvent('filechooser')
          await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
          await (await pending).setFiles(inputFile)
        })
        const selectProp = async () => {
          await page.getByTestId('workspace-module-navigation').getByRole('button', { name: '场景', exact: true }).click()
          const panel = page.getByTestId('workspace-resources')
          await panel.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
          await panel.getByRole('searchbox', { name: '搜索场景对象', exact: true }).fill(propId)
          await panel.locator(`.asset-virtual-row[data-entity-id="${propId}"]`).click(); await observer.ready()
        }
        const edit = async (kind, offset) => {
          const field = page.getByRole('spinbutton', { name: '物件 X', exact: true }), state = await observer.snapshot()
          const unit = input.scene.units.display === 'ft' ? 304.8 : 1000
          const current = Math.round(Number(await field.inputValue()) * unit)
          check(current === prop.positionMm.x + (offset ? 0 : 1), 'Unexpected original world X')
          const target = prop.positionMm.x + offset
          await field.fill(String(target / unit))
          await observer.measure(kind, { start: { event: 'keydown', selector: 'input', key: 'Enter' }, expectedRevision: state.revision + 1,
            domainCommit: true, requireSaved: true, requireRaster: true, rejectText: '候选未通过，工程未修改', until: { preview: false } }, () => field.press('Enter'))
          check(Math.round(Number(await field.inputValue()) * unit) === target, 'Wrong edited world X')
        }
        await selectProp(); await edit('adopted-first-edit', 1); await edit('adopted-warm-edit', 0)
        for (let prepared = 2; prepared < historyDepth; prepared++) await edit(`history-preparation-${prepared + 1}`, prepared % 2 ? 0 : 1)
        for (const audience of ['gm', 'player']) {
          const menu = page.locator('details.workspace-export-menu')
          if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
          const label = audience === 'gm' ? '主持人地图 PNG · 含秘密' : '玩家地图 PNG'
          let file
          await observer.measure(`export-${audience}-4k`, { start: { event: 'click', selector: 'button', label }, externalEnd: true, unchangedDocument: true, requireSaved: true }, async () => {
            const pending = page.waitForEvent('download'); await menu.getByRole('button', { name: label, exact: true }).click(); file = await pending
            check(!await file.failure(), 'PNG download failed')
            await page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').endInputs())
          })
          observer.setPhase('setup-download')
          const filename = `${stem}-${audience}-4k.png`; await file.saveAs(path.join(output, filename)); result.pngs.push({ audience, file: filename })
          if (await menu.getAttribute('open') !== null) await menu.locator('summary').click()
        }
        // A changed query forces one full document/module reset. Navigating to
        // #home and immediately reloading can abort the first favicon request;
        // keep the network audit strict instead of discarding that failure.
        observer.setPhase('setup-page-reset'); await page.goto(url.replace('#home', `?cold=${encodeURIComponent(stem)}#home`))
        const row = page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: input.scene.title, exact: true }) })
        await row.getByRole('button', { name: '打开', exact: true }).waitFor({ state: 'visible' })
        await observer.measure('cold-open', { start: { event: 'click', selector: 'button', label: '打开' }, expectedRevision: input.scene.revision + historyDepth, requireSaved: true },
          () => row.getByRole('button', { name: '打开', exact: true }).click())
        await selectProp(); await edit('cold-first-edit', 1); await edit('cold-warm-edit', 0)
        result.metrics = await observer.stop(); observer = null
        const phaseRows = Object.entries(result.metrics.resources.summary.byPhase).filter(([name]) => !['idle', 'setup', 'setup-download', 'setup-page-reset'].includes(name))
        const peak = key => { const values = phaseRows.map(([, value]) => value[key]).filter(Number.isFinite); return values.length ? Math.max(...values) : null }
        result.productResources = { rssSampledPeakBytes: peak('rssPeakBytes'), jsHeapSampledPeakBytes: peak('jsHeapPeakUsedBytes'),
          phases: phaseRows.map(([name, values]) => ({ name, ...values })), processSamplingStatus: result.metrics.resources.summary.config.processSamplingStatus }
        check(result.metrics.clockGaps.length === 0 && result.metrics.resources.errors.length === 0, 'Observation clock/resource failure')
        check(Object.values(result.metrics.audit).every(rows => rows.length === 0), 'Product page/network/console error')
        const menu = page.locator('details.workspace-export-menu')
        if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
        const pending = page.waitForEvent('download'); await menu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
        const file = await pending; check(!await file.failure(), 'Complete-package download failed')
        packageFile = `${stem}-final.sceneweave`; await file.saveAs(path.join(output, packageFile))
        result.status = 'measured'
      } catch (error) {
        result.status = 'failed'; result.error = error.stack ?? String(error)
      } finally {
        if (observer) { try { result.metrics = await observer.stop() } catch (error) { result.observerError = String(error) }; observer = null }
        if (result.status === 'failed' && activePage) { try { await activePage.screenshot({ path: path.join(output, `${stem}-failure.png`), fullPage: true }); result.failureText = await activePage.locator('body').innerText() } catch {} }
        result.teardown = await closeMeasuredBrowser(ownedBrowser, browser); ownedBrowser = browser = activePage = null
      }
      if (result.status === 'measured') {
        try {
          const data = readPackage(await fs.readFile(path.join(output, packageFile))); assertJourney(input, data, historyDepth + 2)
          result.package = { file: packageFile, sha256: data.sha256, byteLength: data.byteLength, comparableSha256: sha(JSON.stringify(comparablePackage(data))) }
          for (const png of result.pngs) Object.assign(png, auditPng(await fs.readFile(path.join(output, png.file)), input.scene.exportBoundsMm))
          check(result.pngs[0].rgbaSha256 !== result.pngs[1].rgbaSha256, 'Secret-bearing fixture must produce distinct audience pixels')
          result.status = 'complete'
        } catch (error) { result.status = 'failed'; result.auditError = error.stack ?? String(error) }
      }
      check(isDeepStrictEqual(frozen, await inputs()), 'Frozen input/source/build/tool drift after run')
      await write(`${stem}.json`, result); await write('manifest.json', manifest)
    }
  }
  const complete = manifest.runs.filter(row => row.status === 'complete')
  manifest.equality = { completePackageCount: complete.length, normalizedPackageEqual: new Set(complete.map(row => row.package.comparableSha256)).size === 1,
    actualRgbaEqual: Object.fromEntries(['gm', 'player'].map(audience => [audience, new Set(complete.map(row => row.pngs.find(png => png.audience === audience).rgbaSha256)).size === 1])) }
  check(complete.length === pairs * 2 && manifest.equality.normalizedPackageEqual && Object.values(manifest.equality.actualRgbaEqual).every(Boolean), 'Incomplete pair or output mismatch')
  manifest.status = 'complete'
} catch (error) { manifest.status = interrupted ? 'interrupted' : 'failed'; manifest.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally {
  process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt)
  try { if (observer) await observer.stop(); await closeMeasuredBrowser(ownedBrowser, browser) } catch (error) { manifest.cleanupError = String(error); manifest.status = 'failed'; process.exitCode = 1 }
  if (server) await new Promise(resolve => server.close(resolve))
  manifest.endedAt = new Date().toISOString()
  await write('manifest.json', manifest); await write('summary.json', summarizePair(manifest))
}
