import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { unzipSync } from 'fflate'
import { createCurrentFormalObserver } from './current-formal-observer.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'

// Run only after other automated browsers/builds/tests have stopped. Fixtures
// are prepared separately; the measured page receives only normal file input.
const [url, fixtureDir, output] = process.argv.slice(2)
const probe = process.env.SCENEWEAVE_OCEAN_PERF_PROBE === '1'
if (!url || !path.isAbsolute(fixtureDir ?? '') || !path.isAbsolute(output ?? '')) throw new Error('Usage: node tools/performance/run-ocean-formal.mjs URL ABS_FIXTURES ABS_NEW_OUTPUT')
try { if ((await fs.readdir(output)).length) throw new Error('Refusing to overwrite evidence') } catch (e) { if (e.code !== 'ENOENT') throw e }
await fs.mkdir(output, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const write = (file, data) => fs.writeFile(path.join(output, file), JSON.stringify(data, null, 2))
const check = (value, text) => { if (!value) throw new Error(text) }
const distribution = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return { count: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1] ?? null, p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, max: sorted.at(-1) ?? null } }
const manifest = { format: 'sceneweave-ocean-formal-performance', startedAt: new Date().toISOString(), runnerSha256: hash(await fs.readFile(new URL(import.meta.url))), device: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0].model, cpus: os.cpus().length, memory: os.totalmem(), node: process.version },
  measurementClass: probe ? 'diagnostic-only-selector-probe' : 'formal-serial-ocean-production-ui',
  method: { browser: 'Dedicated system Chrome headless/profile per replicate,1512×982,DPR1; HTTP cache disabled; OS cache retained', sizes: probe ? [500] : [500, 2000], grid: '180×180m,50×50 visible grids of3600mm', runs: probe ? 1 : 3, perRun: probe ? 'Diagnostic only:2 X edits,2 rotations,2 list +2 canvas selections,one pan/wheel segment,persistence and4K PNG; concurrent tests may be running' : '30 immediate real full-Prop X edits +30 rotations,30 list +30 canvas selections,3×30 pointer pan and3×20 wheel inputs,undo/redo,save,cold import,dual4K PNG',
    timing: 'Existing read-only trusted-event observer; 100ms gate uses input capture→validated domain commit. Frame p95 uses only continuous input windows. Save/raster/display are separate. No product hooks,state injection,GC,or canvas patches.',
    thresholds: { props500: { frameP95Ms: 33, domainCommitP95Ms: 100 }, props2000: 'Observe real pictures,editing,selection,persistence and memory; no invented latency gate' },
    limits: ['Single Windows device; browser rAF scheduling is not physical GPU presentation.', 'Repeated fixed images are real full Props, not unique art per instance.', 'Retained memory samples can identify growth, but do not alone prove absence of every leak.', 'This scope does not replace whole-project09 or human P3.'] }, results: [] }
await write('manifest.json', manifest)
for (const count of (probe ? [500] : [500, 2000])) for (let run = 1; run <= (probe ? 1 : 3); run++) {
  const stem = `ocean-${count}-run-${run}`, result = { count, run, status: 'running', files: {} }
  let server, browser, observer
  try {
    const input = path.join(fixtureDir, `ocean-${count}.sceneweave`), bytes = await fs.readFile(input)
    result.fixture = { sha256: hash(bytes), bytes: bytes.length }
    server = await chromium.launchServer({ channel: 'chrome', headless: true }); browser = await chromium.connect(server.wsEndpoint())
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1, locale: 'zh-CN', acceptDownloads: true })
    const page = await context.newPage(); page.setDefaultTimeout(180000)
    observer = await createCurrentFormalObserver({ page, browser, rootPid: server.process().pid, timeoutMs: 180000, rssMode: 'windows-process-tree' })
    await page.goto(new URL('#home', url).href); await page.getByTestId('native-project-file').setInputFiles(input); await observer.ready()
    const menu = async () => { const trigger = page.locator('.workspace-export-menu > summary'); if (!await page.locator('.workspace-export-menu').getAttribute('open').then(v => v !== null)) await trigger.click() }
    const download = async name => {
      await menu(); const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
      const file = path.join(output, `${stem}-${name}.sceneweave`); await (await pending).saveAs(file); await observer.ready(); await page.locator('.workspace-export-menu > summary').click()
      const encoded = await fs.readFile(file), entries = unzipSync(encoded), scene = JSON.parse(Buffer.from(entries['scene.json']).toString())
      const descriptor = JSON.parse(Buffer.from(entries['manifest.json']).toString())
      for (const row of descriptor.entries) check(entries[row.path]?.length === row.sizeBytes && hash(entries[row.path]) === row.sha256, `Invalid package ${row.path}`)
      result.files[name] = { file: path.basename(file), sha256: hash(encoded) }; return { scene, entries }
    }
    const initial = await download('initial'); check(Object.keys(initial.scene.props).length === count, 'Full-Prop load differs')
    const objects = page.getByTestId('workspace-resources')
    await page.getByTestId('workspace-module-navigation').getByRole('button', { name: '场景', exact: true }).click()
    await objects.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
    const ids = ['ocean-load-8', 'ocean-load-9']
    for (let i = 0; i < (probe ? 2 : 30); i++) {
      const id = ids[i % 2]; await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
      await observer.measure('list-selection', { start: { event: 'click', selector: '.asset-virtual-row' }, unchangedDocument: true, requireSaved: true, until: { selection: JSON.stringify([id]) } }, () => page.locator(`.asset-virtual-row[data-entity-id="${id}"]`).click())
    }
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    await page.getByRole('button', { name: '选择地图对象', exact: true }).click(); await observer.ready()
    const canvas = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
    check(canvas, 'Expected actual image canvas for hit selection')
    const bounds = initial.scene.exportBoundsMm
    for (let i = 0; i < (probe ? 2 : 30); i++) {
      const id = ids[i % 2], point = initial.scene.props[id].positionMm
      await observer.measure('canvas-selection', { start: { event: 'pointerdown', selector: '.asset-viewport', button: 0 }, unchangedDocument: true, requireSaved: true, until: { selection: JSON.stringify([id]) } }, () => page.mouse.click(canvas.x + (point.x - bounds.x) / bounds.width * canvas.width, canvas.y + (point.y - bounds.y) / bounds.height * canvas.height))
    }
    for (const [kind, label, delta, factor] of [['position-edit', '物件 X', .001, 1000], ['rotation-edit', '物件旋转', 15, 1]]) {
      const field = page.getByRole('spinbutton', { name: label, exact: true }), original = Number(await field.inputValue())
      for (let i = 0; i < (probe ? 2 : 30); i++) {
        const state = await observer.snapshot(), value = original + (i % 2 === 0 ? delta : 0)
        await field.fill(String(value))
        await observer.measure(kind, { start: { event: 'keydown', selector: 'input', key: 'Enter' }, expectedRevision: state.revision + 1, domainCommit: true, requireSaved: true, requireRaster: true, rejectText: '候选未通过，工程未修改', until: { preview: false } }, () => field.press('Enter'))
        check(Math.round(Number(await field.inputValue()) * factor) === Math.round(value * factor), 'Committed field differs')
      }
    }
    for (const label of ['撤销编辑', '重做编辑']) { await page.getByRole('button', { name: label, exact: true }).click(); await observer.ready() }
    const viewport = page.locator('.asset-viewport'), fit = page.getByRole('button', { name: '适应全图', exact: true })
    for (let i = 0; i < (probe ? 1 : 3); i++) {
      await fit.click(); await page.getByRole('button', { name: '平移地图', exact: true }).click(); await observer.ready()
      const box = await viewport.boundingBox(), x = box.x + box.width * .4, y = box.y + box.height * .45; await page.mouse.move(x, y)
      const pan = await observer.measure('pan', { start: { event: 'pointerdown', selector: '.asset-viewport', button: 0 }, eventScope: '.asset-viewport', endEvent: { event: 'pointerup', selector: '.asset-viewport', button: 0 }, unchangedDocument: true, requireSaved: true, until: { viewChanged: true } }, async () => {
        await page.mouse.down(); for (let j = 1; j <= 30; j++) { await page.evaluate(() => new Promise(requestAnimationFrame)); await page.mouse.move(x + j * 3, y + j) } await page.mouse.up()
      })
      pan.sample.activeInputStartMs = pan.sample.intent.captureMs; pan.sample.activeInputEndMs = pan.sample.endInput.captureMs
      await fit.click(); await observer.ready(); await page.mouse.move(x, y)
      const wheel = await observer.measure('wheel', { start: { event: 'wheel', selector: '.asset-viewport' }, eventScope: '.asset-viewport', externalEnd: true, unchangedDocument: true, requireSaved: true, until: { viewChanged: true } }, async () => {
        for (let j = 0; j < 20; j++) { await page.evaluate(() => new Promise(requestAnimationFrame)); await page.mouse.wheel(0, 12) } await page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').endInputs())
      })
      wheel.sample.activeInputStartMs = wheel.sample.intent.captureMs; wheel.sample.activeInputEndMs = wheel.sample.events.filter(e => e.type === 'wheel').at(-1).captureMs
    }
    const edited = await download('edited'), strip = s => { const { revision, updatedAt, ...rest } = s; return rest }
    check(isDeepStrictEqual(strip(initial.scene), strip(edited.scene)), 'Alternating edits/undo-redo changed complete content')
    await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
    await page.getByTestId('workspace-home').locator(`[data-project-key="native:${edited.scene.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await observer.ready()
    const cold = await download('cold'); for (const [name, data] of Object.entries(edited.entries)) check(hash(data) === hash(cold.entries[name]), `Cold package changed ${name}`)
    for (const audience of ['gm', 'player']) {
      await menu(); const label = audience === 'gm' ? '主持人地图 PNG · 含秘密' : '玩家地图 PNG', pending = page.waitForEvent('download')
      const start = performance.now(); await page.getByRole('button', { name: label, exact: true }).click(); const file = path.join(output, `${stem}-${audience}.png`); await (await pending).saveAs(file)
      const png = await fs.readFile(file); check(Math.max(png.readUInt32BE(16), png.readUInt32BE(20)) === 4096, 'Expected4K PNG')
      result.files[audience] = { file: path.basename(file), sha256: hash(png), exportMs: performance.now() - start }; await observer.ready(); await page.locator('.workspace-export-menu > summary').click()
    }
    result.status = 'complete'
  } catch (e) { result.status = 'failed'; result.error = String(e.stack ?? e); console.error(result.error) }
  finally {
    if (observer) result.metrics = await observer.stop()
    if (!probe && result.metrics?.clockGaps?.length) { result.status = 'failed'; result.error = 'Host clock gap invalidates formal timing' }
    if (result.metrics?.audit?.pageErrors?.length) { result.status = 'failed'; result.error = `Page errors: ${JSON.stringify(result.metrics.audit.pageErrors)}` }
    result.close = await closeMeasuredBrowser(server, browser)
    const samples = result.metrics?.samples ?? []
    result.domainMs = distribution(samples.filter(s => s.kind.endsWith('-edit') && s.status === 'complete').map(s => s.sample.intentToDomainCommitMs))
    result.framesMs = distribution(samples.filter(s => ['pan', 'wheel'].includes(s.kind) && s.status === 'complete').flatMap(s => s.sample.frameIntervals.filter(f => f.endMs >= s.sample.activeInputStartMs && f.startMs <= s.sample.activeInputEndMs).map(f => f.durationMs)))
    result.gates = count === 500 && !probe ? { domain: result.domainMs.count === 60 && result.domainMs.p95 <= 100, frames: result.framesMs.count > 0 && result.framesMs.p95 <= 33 } : null
    await write(`${stem}.json`, result); manifest.results.push({ ...result, metrics: undefined, evidence: `${stem}.json` }); await write('manifest.json', manifest)
  }
}
manifest.finishedAt = new Date().toISOString(); manifest.status = manifest.results.every(r => r.status === 'complete') ? 'completed' : 'has-failures'; await write('manifest.json', manifest)
if (manifest.status !== 'completed' || manifest.results.some(r => r.gates && Object.values(r.gates).includes(false))) process.exitCode = 1
