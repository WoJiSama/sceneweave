// Isolated source-component diagnosis; never installs an application API.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen, contentSha256 as sha } from './frozen-input.mjs'
import { startResourceSampling } from './resources.mjs'
import { coldSaveTargets, instrumentColdSave, instrumentColdWorker } from './instrument-cold-save.mjs'

const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
if (args.includes('--help')) {
  console.log('node tools/performance/run-cold-save-analysis.mjs --config ABS_JSON --output ABS_NEW_WORK')
  console.log('Config: source, rounds (1–3), cases [{name,input,owners (1–4),history (0–66),edit:metadata|prop,propId?}]. Reverse case order in round 2; each fresh browser measures cold and two warm saves, then complete cold reads and historical hashes. Diagnostic copy only; no formal performance verdict.')
  process.exit(0)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), configPath = arg('--config'), output = arg('--output')
if (![configPath, output].every(v => v && path.isAbsolute(v)) || !output.startsWith(path.join(root, 'work') + path.sep)) throw Error('Use absolute config and a new ignored work output')
const configBytes = await fs.readFile(configPath), config = JSON.parse(configBytes), { source, rounds, cases } = config
if (!path.isAbsolute(source) || output.startsWith(source + path.sep) || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 3
  || !Array.isArray(cases) || !cases.length || cases.length > 10 || new Set(cases.map(c => c.name)).size !== cases.length
  || cases.some(c => !/^[a-z0-9-]+$/.test(c.name) || !path.isAbsolute(c.input) || !Number.isSafeInteger(c.owners) || c.owners < 1 || c.owners > 4
    || !Number.isSafeInteger(c.history) || c.history < 0 || c.history > 66 || !['metadata', 'prop'].includes(c.edit))) throw Error('Invalid bounded cold-save configuration')
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Preserve existing evidence')
const sourcePaths = ['src', 'public', 'assets', 'package.json', 'package-lock.json']
const toolPaths = ['tools/performance/run-cold-save-analysis.mjs', 'tools/performance/instrument-cold-save.mjs', 'tools/performance/prepare-native-m2-fixture.mjs', 'tools/performance/frozen-input.mjs', 'tools/performance/resources.mjs', 'tools/performance/windows-process-sampler.mjs']
const inputs = new Map(); for (const c of cases) if (!inputs.has(c.input)) inputs.set(c.input, await fs.readFile(c.input))
const fingerprint = async () => ({ config: sha(await fs.readFile(configPath)), source: await fingerprintPaths(source, sourcePaths), tools: await fingerprintPaths(root, toolPaths),
  inputs: await Promise.all([...inputs.keys()].map(async file => ({ path: file, sha256: sha(await fs.readFile(file)) }))) })
const frozen = await fingerprint(), diagnostic = path.join(output, 'diagnostic-source')
const report = { format: 'sceneweave-cold-save-factor-analysis', version: 1, status: 'running', startedAt: new Date().toISOString(), config, frozen,
  device: { platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version }, rows: [], limitations: [
    'Instrumented source copy, actual repository saves; metadata/Prop edits have no editor local receipt and no rendered UI. Not normal production latency or formal performance.',
    'Function times are inclusive, asynchronous and nested; page/Worker/native spans must not be summed. SHA bytes include blocks, projects and resources.',
    'Native transaction lifetime includes JS, clone and scheduling; it is not disk time or exact lock occupancy. Worker elapsed includes startup/module loading and cloning.',
    'Resource fixtures may also differ in scene content. Counts and component boundaries do not make their total difference a pure image-count effect.',
    'Finite sampled page heap excludes Worker/native/GPU; process working sets may count shared pages repeatedly. No exclusive full-machine load guard, forced GC or automatic retry.',
  ] }
const write = () => fs.writeFile(path.join(output, 'analysis.json'), JSON.stringify(report, null, 2)); await write()
for (const name of sourcePaths) await fs.cp(path.join(source, name), path.join(diagnostic, name), { recursive: true, errorOnExist: true, force: false })
await fs.symlink(path.join(root, 'node_modules'), path.join(diagnostic, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
for (const file of Object.keys(coldSaveTargets)) { const target = path.join(diagnostic, file); await fs.writeFile(target, instrumentColdSave(await fs.readFile(target, 'utf8'), file)) }
const worker = path.join(diagnostic, 'src/platform/browser/storage/history-audit-worker.ts')
await fs.writeFile(worker, instrumentColdWorker(await fs.readFile(worker, 'utf8')))
report.diagnosticFingerprint = sha(JSON.stringify(await fingerprintPaths(diagnostic, sourcePaths))); await write()

function installNativeObservation() {
  const original = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (...args) {
    const api = Reflect.get(globalThis, '__sceneweaveColdSave'), started = performance.now(), tx = Reflect.apply(original, this, args)
    tx.addEventListener('complete', () => api?.native(`transaction.${tx.mode}`, performance.now() - started), { once: true })
    return tx
  }
}

let tooling
try {
  tooling = await startNativeFixtureTooling({ root: diagnostic })
  for (let round = 0; round < rounds; round++) for (const c of round % 2 ? [...cases].reverse() : cases) {
    const row = { case: c.name, round: round + 1, status: 'running', saves: [], events: [] }; report.rows.push(row); await write()
    let server, browser, sampler, watchdog, activeSave
    try {
      server = await chromium.launchServer({ channel: 'chrome', headless: true }); browser = await chromium.connect(server.wsEndpoint()); row.browser = browser.version()
      const page = await browser.newPage(); watchdog = setTimeout(() => { void page.close().catch(() => {}) }, 360_000)
      page.on('pageerror', error => row.events.push({ type: 'pageerror', message: error.message }))
      page.on('console', event => { const text = event.text(); if (text.startsWith('SCENEWEAVE_COLD_WORKER ') && activeSave) activeSave.workers.push(JSON.parse(text.slice(23))); else if (event.type() === 'error') row.events.push({ type: 'console-error', message: text }) })
      await page.addInitScript(installNativeObservation); await page.goto(tooling.url)
      console.log(`Cold factors setup: round ${round + 1} ${c.name}`)
      row.setup = await page.evaluate(async ({ base64, factor }) => {
        const paths = ['/src/shared/project/file.ts', '/src/shared/project/resources.ts', '/src/platform/browser/storage/repository.ts', '/src/platform/browser/runtime.ts', '/src/shared/project/validate.ts', '/src/shared/validation/json.ts']
        const [{ importProject }, resources, { ProjectRepository }, { runtime, validation }, projectValidation, { canonicalJson }] = await Promise.all(paths.map(p => import(p)))
        const input = await importProject(Uint8Array.from(atob(base64), v => v.charCodeAt(0)), validation)
        const name = `sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-', '')}`, make = () => new ProjectRepository({ name, runtime, validation })
        let repo = make(); const owners = []
        const next = (bundle, index) => {
          const scene = bundle.project.document, prop = scene.props[factor.propId ?? 'capacity-mixed-remote-0000']
          if (factor.edit === 'prop' && !prop) throw Error('Explicit geometry Prop is missing')
          const derived = resources.tryDerivedProjectBundle({ project: { ...bundle.project, document: { ...scene, title: `cold factor ${index}`,
            revision: scene.revision + 1, updatedAt: new Date().toISOString(), ...(factor.edit === 'prop' ? { props: { ...scene.props, [prop.id]: { ...prop, positionMm: { ...prop.positionMm, x: prop.positionMm.x + 1 } } } } : {}) } }, resources: bundle.resources }, bundle)
          if (!derived) throw Error('Owned resource closure missing'); return derived
        }
        for (let i = 0; i < factor.owners; i++) {
          let current = (await repo.importSnapshotArchive({ current: input, snapshots: [] })).project
          for (let h = 0; h < factor.history; h++) { const candidate = next(current, `setup ${h}`); await repo.saveSnapshot(candidate, current.project.document.revision); current = candidate }
          owners.push(current)
        }
        repo.close(); repo = make()
        const loadStarted = performance.now(), loaded = await repo.load(owners[0].project.document.sceneId), coldOpenMs = performance.now() - loadStarted
        const current = await resources.validateProjectSnapshot(loaded, validation)
        const initialOrderOnly = JSON.stringify(current.project) !== JSON.stringify(owners[0].project)
        if (canonicalJson(current.project) !== canonicalJson(owners[0].project)) throw Error('Initial complete cold read mismatch')
        owners[0] = current
        Reflect.set(globalThis, '__coldFactorState', { repo, owners, current, next, make, validation, projectValidation, canonicalJson })
        return { coldOpenMs, initialOrderOnly, owners: owners.length, versions: await repo.database.historyVersions.count(), props: Object.keys(current.project.document.props).length, assets: Object.keys(current.project.assets).length }
      }, { base64: inputs.get(c.input).toString('base64'), factor: c })
      const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable')
      sampler = startResourceSampling({ rootPid: server.process().pid, cdp }); sampler.setPhase('opened-idle'); await page.waitForTimeout(1000)
      for (const stage of ['cold', 'warm-1', 'warm-2']) {
        const save = { stage, workers: [] }; row.saves.push(save); activeSave = save; sampler.setPhase(stage)
        Object.assign(save, await page.evaluate(async stage => {
          const state = Reflect.get(globalThis, '__coldFactorState'), candidate = state.next(state.current, stage), api = Reflect.get(globalThis, '__sceneweaveColdSave')
          api.reset(); const start = performance.now(); await state.repo.saveSnapshot(candidate, state.current.project.document.revision)
          const totalMs = performance.now() - start, diagnostic = api.finish(); state.current = candidate; state.owners[0] = candidate
          return { totalMs, diagnostic }
        }, stage))
        activeSave = undefined; console.log(`Cold factors measured: ${c.name} ${stage} ${save.totalMs.toFixed(1)}ms`); await write()
      }
      sampler.setPhase('saved-idle'); await page.waitForTimeout(1000); row.resources = await sampler.stop(); sampler = undefined
      if (row.resources.errors.length || row.events.length) throw Error('Sampling/page error; preserve evidence')
      row.consistency = await page.evaluate(async ({ expectedVersions }) => {
        const state = Reflect.get(globalThis, '__coldFactorState'); state.repo.close(); state.repo = state.make(); await state.repo.open(); const historical = []
        if (await state.repo.database.historyVersions.count() !== expectedVersions) throw Error('Unexpected total history length')
        for (const current of state.owners) {
          const owner = current.project.document.sceneId, loaded = await state.repo.load(owner)
          if (state.canonicalJson(loaded.project) !== state.canonicalJson(current.project)) throw Error('Final complete cold project mismatch')
          const versions = (await state.repo.database.historyVersions.where('ownerSceneId').equals(owner).toArray()).sort((a, b) => a.revision - b.revision)
          for (const index of new Set([0, Math.floor(versions.length / 2), versions.length - 1])) {
            const version = versions[index], restored = await state.repo.loadHistoryVersion(owner, version.id)
            if (!restored || state.projectValidation.projectContentHash(restored.project) !== version.contentHash) throw Error('Actual historical complete hash differs')
          }
          historical.push({ versions: versions.length, completeHashesChecked: Math.min(3, versions.length) })
        }
        state.repo.close(); Reflect.deleteProperty(globalThis, '__coldFactorState')
        return { completeColdEqual: true, versions: expectedVersions, owners: historical }
      }, { expectedVersions: c.owners * (c.history + 1) + 3 })
      row.status = 'complete'; await write()
    } catch (error) { row.status = 'failed'; row.error = error.stack ?? String(error); throw error }
    finally { clearTimeout(watchdog); await sampler?.stop(); await browser?.close(); await server?.close(); await write() }
  }
  assertFrozen(frozen, await fingerprint(), 'cold factor source/config/tools/inputs')
  report.status = 'complete'
} catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1 }
finally { await tooling?.close(); report.endedAt = new Date().toISOString(); await write() }
console.log(JSON.stringify({ status: report.status, error: report.error, completeCases: report.rows.filter(r => r.status === 'complete').length }))
