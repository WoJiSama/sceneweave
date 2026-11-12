import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import { createCurrentFormalObserver } from './current-formal-observer.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'
import { fingerprintPaths, assertFrozen, contentSha256 } from './frozen-input.mjs'
import { check, readPackage, assertJourney, auditPng } from './production-pair-audit.mjs'

const args = process.argv.slice(2), arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/run-capacity-journey.mjs --source ABS --dist ABS --fixtures ABS --output ABS_NEW [--cases names] [--cycles 3] [--edits 20] [--channel chrome]')
  console.log('Diagnostic normal production UI: repeated full Prop edits, undo/redo, named snapshot, both 4K audiences, page-reset cold reopen and cold-first save each cycle. Default 60 edits and 6 undo/redo revisions per case; new dedicated browser per case. Complete-package and actual RGBA audit after teardown. No support/performance acceptance promise.')
  process.exit(0)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = arg('--source'), dist = arg('--dist'), fixtures = arg('--fixtures'), output = arg('--output')
const cycles = Number(arg('--cycles', '3')), edits = Number(arg('--edits', '20')), timeoutMs = Number(arg('--timeout-ms', '180000'))
check([source, dist, fixtures, output].every(value => value && path.isAbsolute(value)), 'All paths must be absolute')
check(Number.isSafeInteger(cycles) && cycles >= 1 && cycles <= 10 && Number.isSafeInteger(edits) && edits >= 2 && edits <= 100 && edits % 2 === 0, 'Bounded cycles and positive even edits required')
check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000, 'Invalid timeout')
check(![source, dist, fixtures].some(value => output === value || output.startsWith(`${value}${path.sep}`)), 'Evidence output must be outside frozen inputs')
await fs.mkdir(output, { recursive: true }); check((await fs.readdir(output)).length === 0, 'Evidence directory must be empty')
const fixtureManifest = JSON.parse(await fs.readFile(path.join(fixtures, 'manifest.json'), 'utf8'))
check(fixtureManifest.status === 'complete', 'Fixture preparation is incomplete')
const names = arg('--cases', fixtureManifest.cases.map(row => row.name).join(',')).split(',')
check(names.length && new Set(names).size === names.length && names.every(name => fixtureManifest.cases.some(row => row.name === name)), 'Unknown or duplicate case')
const inputs = async () => ({ source: await fingerprintPaths(source, ['src', 'public', 'assets', 'package.json', 'package-lock.json', 'vite.config.ts']),
  build: await fingerprintPaths(dist, ['index.html', 'assets']), fixtures: await fingerprintPaths(fixtures, ['manifest.json', ...names.map(name => fixtureManifest.cases.find(row => row.name === name).file)]),
  tools: await fingerprintPaths(root, ['tools/performance']) })
const frozen = await inputs(), manifest = { format: 'sceneweave-capacity-journey-diagnostic', version: 1, status: 'running', startedAt: new Date().toISOString(),
  measurementClass: 'development-normal-production-diagnostic', frozen, fingerprint: contentSha256(JSON.stringify(frozen)), config: { cycles, edits, names, timeoutMs },
  device: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  cases: [], limitations: ['Development diagnostic; neither long-duration leak exclusion nor formal performance/capacity acceptance.',
    'No exclusive-load proof. Windows records sampled Working Set, private commitment, other browser counts and system CPU separately.',
    'Normal trusted UI field edits and undo/redo do not establish all tools, free drag, arbitrary history restoration or playable dense maps.',
    'Target heap omits workers/native/GPU. Shared process pages can be counted repeatedly. No forced GC or private user database access.',
    'Cold reopen resets page/module state in the same browser process; it does not clear OS caches. Inclusive intervals must not be added.'] }
const write = () => fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
check(!html.includes('/@vite/client') && !(await fs.readdir(dist)).includes('diagnostic-stages.json'), 'Expected normal production build')
const base = /<script[^>]+src="([^"]+\/assets\/)/.exec(html)?.[1]?.replace(/assets\/$/, '') ?? '/'
let server, ownedBrowser, browser, observer, activePage
try {
  await write()
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const relative = (base !== '/' && pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '')) || 'index.html'
      const file = path.resolve(dist, relative); check(file.startsWith(`${dist}${path.sep}`), 'Invalid asset request')
      const bytes = await fs.readFile(file), mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream'
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); response.end(bytes)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}${base}#home`
  for (const name of names) {
    assertFrozen(frozen, await inputs(), 'capacity source/input/build/tools before case')
    const fixture = fixtureManifest.cases.find(row => row.name === name), inputFile = path.resolve(fixtures, fixture.file)
    check(inputFile.startsWith(`${fixtures}${path.sep}`), 'Invalid fixture path')
    const bytes = await fs.readFile(inputFile), input = readPackage(bytes)
    check(input.sha256 === (fixture.sha256 ?? fixture.summary?.packageSha256), 'Input SHA mismatch')
    const target = fixture.controls.remoteEntityId, prop = input.scene.props[target]
    check(prop && !prop.editLocked && prop.visibility === 'public', 'Expected independent public full Prop')
    const row = { name, status: 'running', inputSha256: input.sha256, summary: fixture.summary, pngs: [], snapshots: [] }
    manifest.cases.push(row); await write(); console.log(`Capacity journey: ${name}`)
    try {
      ownedBrowser = await chromium.launchServer({ channel: arg('--channel', 'chrome'), headless: true }); browser = await chromium.connect(ownedBrowser.wsEndpoint())
      row.browser = browser.version(); row.rootPid = ownedBrowser.process().pid
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1, locale: 'zh-CN' })
      const page = activePage = await context.newPage(); page.setDefaultTimeout(timeoutMs)
      await page.route('**/*', route => { const value = new URL(route.request().url()); return value.origin === origin || ['blob:', 'data:'].includes(value.protocol) ? route.continue() : route.abort('blockedbyclient') })
      observer = await createCurrentFormalObserver({ page, browser, rootPid: row.rootPid, timeoutMs,
        rssMode: process.platform === 'win32' ? 'windows-process-tree' : process.platform === 'darwin' ? 'macos-process-tree' : 'unavailable' })
      await page.goto(url)
      await observer.measure('import-project', { start: { event: 'click', selector: 'button', label: '打开工程文件' }, expectedRevision: input.scene.revision, requireSaved: true }, async () => {
        const pending = page.waitForEvent('filechooser'); await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click(); await (await pending).setFiles(inputFile)
      })
      const choose = async () => {
        await page.getByTestId('workspace-module-navigation').getByRole('button', { name: '场景', exact: true }).click()
        const panel = page.getByTestId('workspace-resources')
        await panel.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
        await panel.getByRole('searchbox', { name: '搜索场景对象', exact: true }).fill(target)
        await panel.locator(`.asset-virtual-row[data-entity-id="${target}"]`).click(); await observer.ready()
      }
      let revision = input.scene.revision
      for (let cycle = 0; cycle < cycles; cycle++) {
        await choose()
        for (let edit = 0; edit < edits; edit++) {
          const field = page.getByRole('spinbutton', { name: '物件 X', exact: true }), unit = input.scene.units.display === 'ft' ? 304.8 : 1000
          const position = prop.positionMm.x + (edit % 2 ? 0 : 1)
          await field.fill(String(position / unit)); revision++
          await observer.measure(`cycle-${cycle + 1}-edit-${edit + 1}`, { start: { event: 'keydown', selector: 'input', key: 'Enter' }, expectedRevision: revision,
            requireSaved: true, requireRaster: true, domainCommit: true, until: { preview: false }, rejectText: '候选未通过，工程未修改' }, () => field.press('Enter'))
          check(Math.round(Number(await field.inputValue()) * unit) === position, 'Wrong actual field position')
        }
        for (const label of ['撤销编辑', '重做编辑']) {
          revision++
          await observer.measure(`cycle-${cycle + 1}-${label}`, { start: { event: 'click', selector: 'button', label }, expectedRevision: revision, requireSaved: true, requireRaster: true },
            () => page.getByRole('button', { name: label, exact: true }).click())
        }
        await page.getByTestId('workspace-module-navigation').getByRole('button', { name: '历史', exact: true }).click()
        const snapshotName = `压力循环 ${cycle + 1}`
        await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
        await page.getByLabel('命名快照名称', { exact: true }).fill(snapshotName)
        await observer.measure(`cycle-${cycle + 1}-named-snapshot`, { start: { event: 'click', selector: 'button', label: '保存快照' }, expectedRevision: revision, requireSaved: true,
          until: { text: { selector: '.history-snapshot-row strong', value: snapshotName } } }, () => page.getByRole('button', { name: '保存快照', exact: true }).click())
        row.snapshots.push(snapshotName)
        if (cycle === 0 || cycle === cycles - 1) for (const audience of ['gm', 'player']) {
          const menu = page.locator('details.workspace-export-menu'); if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
          const label = audience === 'gm' ? '主持人地图 PNG · 含秘密' : '玩家地图 PNG'; let download
          await observer.measure(`cycle-${cycle + 1}-export-${audience}-4k`, { start: { event: 'click', selector: 'button', label }, requireSaved: true, unchangedDocument: true, externalEnd: true }, async () => {
            const pending = page.waitForEvent('download'); await menu.getByRole('button', { name: label, exact: true }).click(); download = await pending
            check(!await download.failure(), 'PNG download failed'); await page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').endInputs())
          })
          const file = `${name}-cycle-${cycle + 1}-${audience}.png`; observer.setPhase('tooling-download'); await download.saveAs(path.join(output, file)); row.pngs.push({ audience, cycle: cycle + 1, file })
          if (await menu.getAttribute('open') !== null) await menu.locator('summary').click()
        }
        observer.setPhase('setup-page-reset'); await page.goto(url.replace('#home', `?cycle=${cycle + 1}#home`))
        const projectRow = page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: input.scene.title, exact: true }) })
        await projectRow.getByRole('button', { name: '打开', exact: true }).waitFor({ state: 'visible' })
        await observer.measure(`cycle-${cycle + 1}-cold-open`, { start: { event: 'click', selector: 'button', label: '打开' }, expectedRevision: revision, requireSaved: true },
          () => projectRow.getByRole('button', { name: '打开', exact: true }).click())
        await page.getByTestId('workspace-module-navigation').getByRole('button', { name: '历史', exact: true }).click()
        for (const snapshot of row.snapshots) await page.getByRole('button', { name: `查看快照 ${snapshot}`, exact: true }).waitFor({ state: 'visible' })
      }
      row.workersBeforeIdle = page.workers().length
      observer.setPhase('tail-idle'); await page.waitForTimeout(6000)
      row.workersAfterIdle = page.workers().length
      check(row.workersAfterIdle === 0, 'Idle canonical workers were retained beyond their release interval')
      row.metrics = await observer.stop(); observer = null
      check(row.metrics.resources.errors.length === 0 && Object.values(row.metrics.audit).every(values => values.length === 0), 'Product/resource audit failure')
      const menu = page.locator('details.workspace-export-menu'); if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
      const pending = page.waitForEvent('download'); await menu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
      const download = await pending; check(!await download.failure(), 'Final package download failed')
      row.packageFile = `${name}-final.sceneweave`; await download.saveAs(path.join(output, row.packageFile)); row.finalRevision = revision
      row.status = 'measured'
    } catch (error) { row.status = 'failed'; row.error = error.stack ?? String(error) }
    finally {
      if (observer) { try { row.metrics = await observer.stop() } catch (error) { row.observerError = String(error) }; observer = null }
      if (row.status === 'failed' && activePage) { try { row.failureText = await activePage.locator('body').innerText(); await activePage.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }) } catch {} }
      row.teardown = await closeMeasuredBrowser(ownedBrowser, browser); ownedBrowser = browser = activePage = null
    }
    if (row.status === 'measured') {
      try {
        const final = readPackage(await fs.readFile(path.join(output, row.packageFile)))
        assertJourney(input, final, cycles * (edits + 2)); row.packageSha256 = final.sha256
        for (const png of row.pngs) Object.assign(png, auditPng(await fs.readFile(path.join(output, png.file)), input.scene.exportBoundsMm))
        for (const audience of ['gm', 'player']) check(new Set(row.pngs.filter(png => png.audience === audience).map(png => png.rgbaSha256)).size === 1, 'Actual pixels drifted across cycles')
        row.status = 'complete'
      } catch (error) { row.status = 'failed'; row.auditError = error.stack ?? String(error) }
    }
    assertFrozen(frozen, await inputs(), 'capacity source/input/build/tools after case'); await write()
    await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(row, null, 2))
  }
  check(manifest.cases.every(row => row.status === 'complete'), 'One or more journeys failed; retained without retry')
  manifest.status = 'complete'
} catch (error) { manifest.status = 'failed'; manifest.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally {
  if (observer) await observer.stop(); await closeMeasuredBrowser(ownedBrowser, browser)
  if (server) await new Promise(resolve => server.close(resolve))
  manifest.endedAt = new Date().toISOString(); await write()
}
