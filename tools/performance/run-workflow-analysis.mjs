import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import { createCurrentFormalObserver } from './current-formal-observer.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'
import { installDiagnosticStageObserver } from './diagnostic-stages.mjs'
import { readPackage, check, sha, assertJourney, auditPng } from './production-pair-audit.mjs'

// Attribution only: one unchanged normal build with CPU sampling OR a separate
// function-stage build. Neither mode establishes a performance improvement.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2), argument = (key, fallback = '') => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/run-workflow-analysis.mjs --mode stages|cpu --dist ABS --fixtures ABS --output ABS [--case mixed-2000] [--channel chrome]')
  console.log('One dedicated browser, same eight trusted UI operations as production-pair. Detailed stages or per-operation 1ms target-main-thread CPU profiles; no product source changes, no GC, no retries. Outputs are fully audited after browser exit. Attribution only, not formal timing or before/after evidence.')
  process.exit(0)
}
const mode = argument('--mode'), dist = argument('--dist'), fixtures = argument('--fixtures'), output = argument('--output')
const channel = argument('--channel', 'chrome'), caseName = argument('--case', 'mixed-2000'), timeoutMs = 180000
check(['stages', 'cpu'].includes(mode) && [dist, fixtures, output].every(value => value && path.isAbsolute(value)), 'Expected mode and absolute paths')
check(output !== fixtures && output !== dist && !output.startsWith(`${dist}${path.sep}`) && !output.startsWith(`${fixtures}${path.sep}`), 'Output must be independent')
await fs.mkdir(output, { recursive: true }); check((await fs.readdir(output)).length === 0, 'Output must be new/empty')
const write = (file, value) => fs.writeFile(path.join(output, file), JSON.stringify(value, null, 2))
async function fingerprint(directory, prefix = '') {
  const result = []
  for (const row of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const file = path.posix.join(prefix, row.name)
    if (row.isDirectory()) result.push(...await fingerprint(directory, file))
    else if (row.isFile()) result.push({ file, sha256: sha(await fs.readFile(path.join(directory, file))) })
  }
  return result.sort((a, b) => a.file.localeCompare(b.file))
}
const frozen = { src: await fingerprint(path.join(root, 'src')), build: await fingerprint(dist), fixtures: await fingerprint(fixtures), tools: await fingerprint(path.join(root, 'tools/performance')) }
const record = { format: 'sceneweave-workflow-attribution', version: 1, mode, status: 'running', startedAt: new Date().toISOString(),
  device: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version }, frozen,
  operations: [], limitations: ['Attribution only: timers/extra awaits or CPU profiling alter costs. Never combine these timings with normal-production distributions.',
    'Inclusive function spans overlap; nested totals cannot be added. A synchronous function returning a promise measures submission only.',
    'CPU profile samples cover only the target main thread, not image decoding workers, GPU, IndexedDB service or all browser processes. Idle/GC are explicit.',
    'Windows RSS unavailable. No exclusive system-load guard. Resource polling and trusted UI automation overhead retained.'] }
await write('analysis.json', record)
let server, browserServer, browser, observer, cdp
try {
  const stageMetadata = frozen.build.some(row => row.file === 'diagnostic-stages.json')
  check((mode === 'stages') === stageMetadata, 'Stages require the instrumented build; CPU requires an uninstrumented build')
  const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
  check(!html.includes('/@vite/client'), 'Production build required')
  const base = /<script[^>]+src="([^"]+\/assets\/)/.exec(html)?.[1]?.replace(/assets\/$/, '') ?? '/'
  const fixtureManifest = JSON.parse(await fs.readFile(path.join(fixtures, 'manifest.json'), 'utf8'))
  const fixture = fixtureManifest.cases.find(row => row.name === caseName)
  check(fixtureManifest.status === 'complete' && fixture?.controls?.remoteEntityId && fixture.file, 'Complete explicit fixture required')
  const inputFile = path.resolve(fixtures, fixture.file); check(inputFile.startsWith(`${fixtures}${path.sep}`), 'Unsafe input path')
  const input = readPackage(await fs.readFile(inputFile)); check(input.sha256 === fixture.sha256, 'Frozen fixture changed')
  record.input = { sha256: input.sha256, byteLength: input.byteLength, summary: fixture.summary }
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const relative = (base !== '/' && pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '')) || 'index.html'
      const file = path.resolve(dist, relative); check(file.startsWith(`${dist}${path.sep}`), 'Unsafe path')
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(await fs.readFile(file))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}${base}#home`
  browserServer = await chromium.launchServer({ channel, headless: true }); browser = await chromium.connect(browserServer.wsEndpoint())
  record.browser = browser.version(); record.rootPid = browserServer.process().pid
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1, locale: 'zh-CN' })
  const page = await context.newPage(); page.setDefaultTimeout(timeoutMs)
  await page.route('**/*', route => { const target = new URL(route.request().url()); return target.origin === origin || ['blob:', 'data:'].includes(target.protocol) ? route.continue() : route.abort('blockedbyclient') })
  observer = await createCurrentFormalObserver({ page, browser, rootPid: record.rootPid, timeoutMs, rssMode: process.platform === 'darwin' ? 'macos-process-tree' : 'unavailable' })
  if (mode === 'stages') await page.addInitScript(installDiagnosticStageObserver, { compact: true })
  cdp = await context.newCDPSession(page)
  const measure = async (name, options, action) => {
    const operation = { name, status: 'running' }; record.operations.push(operation)
    if (mode === 'stages') await page.evaluate(name => Reflect.get(window, '__sceneweaveDiagnosticStages').start(name, 1), name)
    else { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start') }
    try {
      operation.observation = await observer.measure(name, options, action)
      const tailStart = performance.now()
      // Keep primary/saved UI completion separate from the delayed refinement.
      // Drain it outside that user interval so the next phase cannot absorb an
      // older preview. These extra waits belong only to attribution tooling.
      await page.waitForFunction(stages => {
        const snapshot = Reflect.get(window, '__sceneweaveNativeM2Probe')?.snapshot()
        return !snapshot?.refinementPending && (!stages || Reflect.get(window, '__sceneweaveDiagnosticStages').pending() === 0)
      }, mode === 'stages', { timeout: timeoutMs })
      operation.tailDrainNodeMs = performance.now() - tailStart
      operation.status = 'complete'
    }
    finally {
      if (mode === 'stages') { operation.stages = await page.evaluate(() => Reflect.get(window, '__sceneweaveDiagnosticStages').finish()); check(!operation.stages.dropped && !operation.stages.openAtEnd.length, 'Dropped/open diagnostic spans') }
      else {
        const { profile } = await cdp.send('Profiler.stop'); operation.profile = `${name}.cpuprofile`; await write(operation.profile, profile)
      }
      await write('analysis.json', record)
    }
  }
  await page.goto(url)
  await measure('import-project', { start: { event: 'click', selector: 'button', label: '打开工程文件' }, expectedRevision: input.scene.revision, requireSaved: true }, async () => {
    const pending = page.waitForEvent('filechooser'); await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click(); await (await pending).setFiles(inputFile)
  })
  const propId = fixture.controls.remoteEntityId, prop = input.scene.props[propId]
  check(prop?.visibility === 'public' && !prop.editLocked, 'Expected independent public prop')
  const select = async () => {
    await page.getByTestId('workspace-module-navigation').getByRole('button', { name: '场景', exact: true }).click()
    const panel = page.getByTestId('workspace-resources'); await panel.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
    await panel.getByRole('searchbox', { name: '搜索场景对象', exact: true }).fill(propId)
    await panel.locator(`.asset-virtual-row[data-entity-id="${propId}"]`).click(); await observer.ready()
  }
  const edit = async (name, offset) => {
    const field = page.getByRole('spinbutton', { name: '物件 X', exact: true }), state = await observer.snapshot(), unit = input.scene.units.display === 'ft' ? 304.8 : 1000
    check(Math.round(Number(await field.inputValue()) * unit) === prop.positionMm.x + (offset ? 0 : 1), 'Unexpected original world X')
    await field.fill(String((prop.positionMm.x + offset) / unit))
    await measure(name, { start: { event: 'keydown', selector: 'input', key: 'Enter' }, expectedRevision: state.revision + 1,
      domainCommit: true, requireSaved: true, requireRaster: true, rejectText: '候选未通过，工程未修改', until: { preview: false } }, () => field.press('Enter'))
  }
  await select(); await edit('adopted-first-edit', 1); await edit('adopted-warm-edit', 0)
  record.pngs = []
  for (const audience of ['gm', 'player']) {
    const menu = page.locator('details.workspace-export-menu'); if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
    const label = audience === 'gm' ? '主持人地图 PNG · 含秘密' : '玩家地图 PNG'; let file
    await measure(`export-${audience}-4k`, { start: { event: 'click', selector: 'button', label }, externalEnd: true, unchangedDocument: true, requireSaved: true }, async () => {
      const pending = page.waitForEvent('download'); await menu.getByRole('button', { name: label, exact: true }).click(); file = await pending; check(!await file.failure(), 'PNG failed')
      await page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').endInputs())
    })
    observer.setPhase('setup-download'); const filename = `${audience}-4k.png`; await file.saveAs(path.join(output, filename)); record.pngs.push({ audience, file: filename })
    if (await menu.getAttribute('open') !== null) await menu.locator('summary').click()
  }
  observer.setPhase('setup-page-reset'); await page.goto(url.replace('#home', '?cold=analysis#home'))
  const row = page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: input.scene.title, exact: true }) })
  await row.getByRole('button', { name: '打开', exact: true }).waitFor({ state: 'visible' })
  await measure('cold-open', { start: { event: 'click', selector: 'button', label: '打开' }, expectedRevision: input.scene.revision + 2, requireSaved: true }, () => row.getByRole('button', { name: '打开', exact: true }).click())
  await select(); await edit('cold-first-edit', 1); await edit('cold-warm-edit', 0)
  record.metrics = await observer.stop(); observer = null
  check(record.metrics.clockGaps.length === 0 && record.metrics.resources.errors.length === 0 && Object.values(record.metrics.audit).every(rows => rows.length === 0), 'Observer clock/resource/page/network failure')
  const menu = page.locator('details.workspace-export-menu'); if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
  const pending = page.waitForEvent('download'); await menu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click(); const file = await pending
  check(!await file.failure(), 'Final package failed'); await file.saveAs(path.join(output, 'final.sceneweave'))
  await cdp.detach(); cdp = null
  record.teardown = await closeMeasuredBrowser(browserServer, browser); browserServer = browser = null
  const final = readPackage(await fs.readFile(path.join(output, 'final.sceneweave'))); assertJourney(input, final, 4)
  record.final = { sha256: final.sha256, byteLength: final.byteLength }
  for (const png of record.pngs) Object.assign(png, auditPng(await fs.readFile(path.join(output, png.file)), input.scene.exportBoundsMm))
  const after = { src: await fingerprint(path.join(root, 'src')), build: await fingerprint(dist), fixtures: await fingerprint(fixtures), tools: await fingerprint(path.join(root, 'tools/performance')) }
  check(JSON.stringify(after) === JSON.stringify(frozen), 'Source/build/input/tool changed during analysis')
  record.status = 'complete'
} catch (error) { record.status = 'failed'; record.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally {
  try { if (observer) record.metrics = await observer.stop(); if (cdp) await cdp.detach(); if (browserServer) record.teardown = await closeMeasuredBrowser(browserServer, browser) } catch (error) { record.cleanupError = String(error); record.status = 'failed'; process.exitCode = 1 }
  if (server) await new Promise(resolve => server.close(resolve))
  record.endedAt = new Date().toISOString(); await write('analysis.json', record)
}
