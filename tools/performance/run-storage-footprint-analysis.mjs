import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen } from './frozen-input.mjs'
import { startResourceSampling } from './resources.mjs'

const args = process.argv.slice(2), arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/run-storage-footprint-analysis.mjs --before-source ABS --after-source ABS --input ABS_SCENEWEAVE --output ABS_NEW_DIRECTORY [--history 20,44,66] [--rounds 2] [--edits 6] [--mode local|generic] [--prop-id ID] [--heap-diagnostic] [--copy-diagnostic] [--channel chrome]')
  console.log('Source component only. Independent Chrome profiles, serial AB/BA, real Workspace local edits or generic saves. Read-only native table/reachability statistics; no user database, GC, compression, deletion or product API. Optional heap diagnostics force GC only after timing and normal sampling have stopped.')
  process.exit(0)
}
const sources = { before: arg('--before-source'), after: arg('--after-source') }, inputPath = arg('--input'), output = arg('--output')
const histories = arg('--history', '20,44,66').split(',').map(Number), rounds = Number(arg('--rounds', '2')), edits = Number(arg('--edits', '6'))
const mode = arg('--mode', 'local'), heapDiagnostic = args.includes('--heap-diagnostic')
if (![...Object.values(sources), inputPath, output].every(value => value && path.isAbsolute(value))
  || histories.some(value => !Number.isSafeInteger(value) || value < 0 || value > 100) || !histories.length
  || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10 || !Number.isSafeInteger(edits) || edits < 1 || edits > 30
  || !['local', 'generic'].includes(mode)) throw new Error('Use absolute paths and bounded history/rounds/edits/mode')
if (Object.values(sources).some(source => output.startsWith(source + path.sep))) throw new Error('Output must stay outside frozen sources')
await fs.mkdir(output, { recursive: true })
if ((await fs.readdir(output)).length) throw new Error('Existing evidence will not be overwritten')
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), input = await fs.readFile(inputPath)
const report = { format: 'sceneweave-storage-footprint-analysis', version: 1, status: 'running', startedAt: new Date().toISOString(),
  input: { path: inputPath, byteLength: input.length, sha256: sha(input) }, runnerSha256: sha(await fs.readFile(new URL(import.meta.url))),
  device: { platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  config: { sources, histories, rounds, edits, mode, heapDiagnostic, copyDiagnostic: args.includes('--copy-diagnostic'), propId: arg('--prop-id') ?? null }, rows: [], limitations: [
    'Source component, no rendered UI; nonexclusive background load and finite sampling. No formal performance or capacity verdict.',
    'Process working sets may count shared pages more than once; page heap excludes Worker/native/GPU. Phase-crossing samples are retained separately.',
    'Logical payload/JSON bytes and browser estimate are separate from physical IndexedDB files; no filesystem reclamation claim.',
    'Optional forced-GC heap diagnostics occur after all measured actions; they are retained-size observations, not natural idle behavior or a leak proof.',
  ] }
const write = () => fs.writeFile(path.join(output, 'analysis.json'), JSON.stringify(report, null, 2))
await write()
for (const history of histories) for (let round = 0; round < rounds; round++) for (const side of round % 2 ? ['after', 'before'] : ['before', 'after']) {
  let tooling, server, browser, sampler, cdp, watchdog
  const source = sources[side], label = `${mode}-${history}-${round + 1}-${side}`
  const frozen = await fingerprintPaths(source, ['src', 'public', 'assets', 'package.json', 'package-lock.json'])
  try {
    tooling = await startNativeFixtureTooling({ root: source })
    server = await chromium.launchServer({ channel: arg('--channel', 'chrome'), headless: true })
    const rootPid = server.process().pid
    browser = await chromium.connect(server.wsEndpoint())
    const page = await browser.newPage(), errors = []
    watchdog = setTimeout(() => { void page.close().catch(() => {}) }, 300_000)
    page.on('pageerror', error => errors.push(error.stack ?? String(error)))
    await page.goto(tooling.url)
    // Setup runs before sampling so repeated imports and history creation are
    // not mislabeled as a cold-save peak. Keep only the active Workspace.
    const setup = await page.evaluate(async ({ base64, history, mode, explicitPropId }) => {
      const paths = ['/src/shared/project/file.ts', '/src/shared/project/resources.ts', '/src/platform/browser/storage/repository.ts',
        '/src/platform/browser/runtime.ts', '/src/application/workspace/workspace.ts', '/src/application/workspace/project.ts', '/src/shared/project/validate.ts']
      const [{ importProject }, resources, { ProjectRepository }, { runtime, validation }, { Workspace }, { fromBundle, toBundle }, projectValidation] = await Promise.all(paths.map(value => import(value)))
      const input = await importProject(Uint8Array.from(atob(base64), value => value.charCodeAt(0)), validation)
      const name = `sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-', '')}`
      const make = () => new ProjectRepository({ name, runtime, validation })
      let repo = make(), current = (await repo.importSnapshotArchive({ current: input, snapshots: [] })).project
      const props = current.project.document.props
      const propId = explicitPropId ?? props['capacity-mixed-remote-0000']?.id ?? Object.values(props).find(prop => !prop.editLocked && prop.visibility === 'public')?.id
      if (!propId || !props[propId] || props[propId].editLocked || props[propId].visibility !== 'public') throw new Error('An unlocked public Prop is required')
      const next = (bundle, index) => {
        const prop = bundle.project.document.props[propId]
        const candidate = resources.tryDerivedProjectBundle({ project: { ...bundle.project, document: { ...bundle.project.document,
          title: `footprint ${index}`, revision: bundle.project.document.revision + 1, updatedAt: new Date().toISOString(),
          props: { ...bundle.project.document.props, [propId]: { ...prop, positionMm: { ...prop.positionMm, x: prop.positionMm.x + 1 } } },
        } }, resources: bundle.resources }, bundle)
        if (!candidate) throw new Error('Verified resource closure missing')
        return candidate
      }
      for (let index = 0; index < history; index++) { const candidate = next(current, index); await repo.saveSnapshot(candidate, current.project.document.revision); current = candidate }
      const owner = current.project.document.sceneId
      repo.close(); repo = make()
      const loadStart = performance.now(), loaded = await repo.load(owner), coldLoadMs = performance.now() - loadStart
      current = await resources.validateProjectSnapshot(loaded, validation)
      const workspace = new Workspace(repo, { runtime, validation })
      if (mode === 'local') await workspace.openPersisted(await fromBundle(current, validation))
      window.__footprint = { repo, workspace, current, owner, propId, make, next, toBundle, validation, projectValidation,
        initialX: current.project.document.props[propId].positionMm.x, history, mode }
      return { coldLoadMs, owner, propId, initialX: window.__footprint.initialX }
    }, { base64: input.toString('base64'), history, mode, explicitPropId: arg('--prop-id') })
    console.log(`Prepared ${label}`)
    cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    sampler = startResourceSampling({ rootPid, cdp })
    sampler.setPhase('opened-idle')
    await page.waitForTimeout(1500)
    const saves = []
    for (let index = 0; index < edits; index++) {
      const phase = index ? 'warm-edit-save' : 'cold-first-edit-save'
      sampler.setPhase(phase)
      saves.push(await page.evaluate(async index => {
        const state = window.__footprint, tasks = [], transactions = [], nativeTransaction = IDBDatabase.prototype.transaction
        const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, ms: entry.duration }))))
        observer.observe({ type: 'longtask' })
        IDBDatabase.prototype.transaction = function (...args) {
          const tx = nativeTransaction.apply(this, args), row = { mode: tx.mode, start: performance.now(), stores: [...tx.objectStoreNames] }
          transactions.push(row)
          tx.addEventListener('complete', () => { row.ms = performance.now() - row.start })
          tx.addEventListener('abort', () => { row.aborted = true; row.ms = performance.now() - row.start })
          return tx
        }
        const start = performance.now()
        let commitMs = null, localEvidence = null
        try {
          if (state.mode === 'local') {
            const prop = state.workspace.getState().project.document.props[state.propId]
            await state.workspace.updateProp(state.propId, { positionMm: { ...prop.positionMm, x: prop.positionMm.x + 1 } })
            commitMs = performance.now() - start
            const source = state.toBundle(state.workspace.getState().project).project
            localEvidence = !!state.projectValidation.getProjectLocalTransaction(source)
            await state.workspace.flush()
          } else {
            const candidate = state.next(state.current, `measured ${index}`)
            await state.repo.saveSnapshot(candidate, state.current.project.document.revision); state.current = candidate
          }
        } finally { IDBDatabase.prototype.transaction = nativeTransaction }
        const end = performance.now()
        await new Promise(resolve => setTimeout(resolve, 80)); observer.disconnect()
        const relevant = tasks.filter(task => task.start < end && task.start + task.ms > start)
        return { index, kind: index ? 'warm' : 'cold-first', totalMs: end - start, commitMs, localEvidence, transactions,
          longestPageTaskMs: Math.max(0, ...relevant.map(task => task.ms)), longTasks: relevant }
      }, index))
      sampler.setPhase('saved-idle')
      await page.waitForTimeout(500)
    }
    sampler.setPhase('final-saved-idle'); await page.waitForTimeout(2000)
    if (page.workers().length) throw new Error('An idle Worker remained after complete saves')
    const sampling = await sampler.stop(); sampler = null
    await fs.writeFile(path.join(output, `${label}-resources.json`), JSON.stringify(sampling))
    if (sampling.errors.length) throw new Error(`Resource sampling failed; see retained samples (${sampling.errors.length} errors)`)
    let heap = null
    if (heapDiagnostic) {
      await cdp.send('HeapProfiler.collectGarbage')
      const chunks = [], listener = event => chunks.push(event.chunk)
      cdp.on('HeapProfiler.addHeapSnapshotChunk', listener)
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
      cdp.off('HeapProfiler.addHeapSnapshotChunk', listener)
      const serialized = chunks.join(''), snapshot = JSON.parse(serialized), fields = snapshot.snapshot.meta.node_fields
      const stride = fields.length, nameIndex = fields.indexOf('name'), sizeIndex = fields.indexOf('self_size'), types = snapshot.snapshot.meta.node_types[fields.indexOf('type')]
      const totals = {}, buffers = { count: 0, bytes: 0 }, typedArrays = { count: 0, selfBytes: 0 }
      for (let i = 0; i < snapshot.nodes.length; i += stride) {
        const type = types[snapshot.nodes[i + fields.indexOf('type')]], name = snapshot.strings[snapshot.nodes[i + nameIndex]], size = snapshot.nodes[i + sizeIndex]
        totals[type] = (totals[type] ?? 0) + size
        if (name === 'system / JSArrayBufferData') { buffers.count++; buffers.bytes += size }
        if (name === 'Uint8Array' && type === 'object') { typedArrays.count++; typedArrays.selfBytes += size }
      }
      heap = { forcedGcAfterMeasurement: true, totals, buffers, typedArrays, snapshotSha256: sha(serialized) }
      await fs.writeFile(path.join(output, `${label}.heapsnapshot`), serialized)
    }
    const disk = await page.evaluate(async ({ edits, copyDiagnostic }) => {
      const state = window.__footprint, repo = state.repo, project = state.mode === 'local' ? state.toBundle(state.workspace.getState().project).project : state.current.project
      const [{ CONTENT_PAYLOAD_FIELDS }, { checkedContentBlock, isProjectBlockManifest, validateProjectBlockManifest }, { canonicalJson, encodeUtf8 }, { projectContentHash }] = await Promise.all([
        import('/src/platform/browser/storage/content-block-middleware.ts'), import('/src/platform/browser/storage/content-blocks.ts'),
        import('/src/shared/validation/json.ts'), import('/src/shared/project/validate.ts')])
      const names = [...repo.database.backendDB().objectStoreNames]
      const rows = await new Promise((resolve, reject) => {
        const tx = repo.database.backendDB().transaction(names, 'readonly'), captured = {}
        tx.oncomplete = () => resolve(captured); tx.onabort = () => reject(tx.error)
        for (const name of names) { const request = tx.objectStore(name).getAll(); request.onsuccess = () => { captured[name] = request.result } }
      })
      const tables = {}, references = new Map(), manifests = [], owners = new Set()
      const measure = value => {
        let binaryBytes = 0
        const json = JSON.stringify(value, (_key, item) => {
          if (item instanceof Uint8Array) { binaryBytes += item.byteLength; return null }
          return item
        })
        return { jsonBytes: encodeUtf8(json).length, binaryBytes }
      }
      for (const [name, values] of Object.entries(rows)) {
        tables[name] = { rows: values.length, jsonBytes: 0, binaryBytes: 0 }
        for (const row of values) {
          const bytes = measure(row); tables[name].jsonBytes += bytes.jsonBytes; tables[name].binaryBytes += bytes.binaryBytes
          if (row.ownerSceneId) owners.add(row.ownerSceneId)
          const field = CONTENT_PAYLOAD_FIELDS[name], manifest = field && row[field]
          if (isProjectBlockManifest(manifest)) {
            const checked = validateProjectBlockManifest(manifest)
            manifests.push({ table: name, referenceBytes: checked.fields.reduce((sum, field) => sum + field.blocks.reduce((sum, ref) => sum + ref.byteLength, 0), 0), fullBytes: checked.byteLength })
            for (const field of checked.fields) for (const ref of field.blocks) {
              if (references.has(ref.sha256) && references.get(ref.sha256) !== ref.byteLength) throw new Error('Reference length conflict')
              references.set(ref.sha256, ref.byteLength)
            }
          }
        }
      }
      const blocks = { rows: 0, payloadBytes: 0, reachableCount: 0, reachableBytes: 0, unreachableCount: 0, unreachableBytes: 0, missingCount: 0 }
      for (const row of rows.projectContentBlocks) {
        const checked = checkedContentBlock(row), expected = references.get(checked.sha256)
        blocks.rows++; blocks.payloadBytes += checked.bytes.length
        if (expected !== undefined) {
          if (expected !== checked.bytes.length) throw new Error('Actual block length conflict')
          blocks.reachableCount++; blocks.reachableBytes += checked.bytes.length; references.delete(checked.sha256)
        } else { blocks.unreachableCount++; blocks.unreachableBytes += checked.bytes.length }
      }
      blocks.missingCount = references.size
      if (references.size) throw new Error('Missing referenced block')
      const versions = rows.historyVersions.length, expectedVersions = state.history + edits + 1
      if (versions !== expectedVersions || owners.size !== 1 || project.document.props[state.propId].positionMm.x !== state.initialX + edits) throw new Error('Retained versions/owners/geometry differ')
      const expectedHash = projectContentHash(project)
      // No capture or measurement references are kept across close/cold load.
      if (state.mode === 'local') await state.workspace.close()
      repo.close()
      const fresh = state.make(), reopened = await fresh.load(state.owner)
      if (!reopened || canonicalJson(reopened.project) !== canonicalJson(project)) throw new Error('Complete cold project differs')
      const summaries = (await fresh.listHistoryVersions(state.owner)).versions.sort((a, b) => a.revision - b.revision), historyChecked = []
      for (const summary of [summaries[0], summaries[Math.floor(summaries.length / 2)], summaries.at(-1)]) {
        const version = await fresh.loadHistoryVersion(state.owner, summary.id)
        if (!version || projectContentHash(version.project) !== summary.contentHash) throw new Error('Historical complete hash differs')
        historyChecked.push({ revision: summary.revision, contentHash: summary.contentHash })
      }
      let copies = null
      if (copyDiagnostic) {
        const { validateProjectSnapshot } = await import('/src/shared/project/resources.ts')
        const { prepareEncodedSnapshot, snapshotContentPartition, releaseEncodedSnapshot } = await import('/src/platform/browser/storage/content-context.ts')
        const verified = await validateProjectSnapshot(reopened, state.validation), originalSlice = Uint8Array.prototype.slice
        const phases = { preparation: { count: 0, bytes: 0 }, boundary: { count: 0, bytes: 0 } }
        let phase = phases.preparation, snapshot
        // Synchronous owned operations only, after all timing/sampling/heap
        // snapshots. Counts this exact copy primitive, not total allocations.
        Uint8Array.prototype.slice = function (...args) {
          const result = originalSlice.apply(this, args); phase.count++; phase.bytes += result.byteLength; return result
        }
        try {
          snapshot = prepareEncodedSnapshot(verified)
          phase = phases.boundary
          const returned = snapshotContentPartition(snapshot)
          if (returned.manifest.contentHash !== expectedHash) throw new Error('Diagnostic encoding changed complete content')
          copies = { ...phases, primitive: 'Uint8Array.prototype.slice', afterAllMeasurements: true }
        } finally { Uint8Array.prototype.slice = originalSlice; if (snapshot) releaseEncodedSnapshot(snapshot) }
      }
      fresh.close()
      return { tables, blocks, manifests, owners: owners.size, versions, expectedHash, historyChecked, copies, completeColdEqual: true, browserEstimate: await navigator.storage.estimate() }
    }, { edits, copyDiagnostic: args.includes('--copy-diagnostic') })
    if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`)
    assertFrozen(frozen, await fingerprintPaths(source, ['src', 'public', 'assets', 'package.json', 'package-lock.json']), 'footprint source')
    if (sha(await fs.readFile(inputPath)) !== report.input.sha256) throw new Error('Input drift')
    report.rows.push({ label, side, history, round: round + 1, browser: browser.version(), sourceFingerprint: sha(JSON.stringify(frozen)), setup, saves, heap, disk, resources: sampling.summary })
    await write()
    console.log(JSON.stringify({ label, saves: saves.map(row => Math.round(row.totalMs)), blocks: disk.blocks, buffers: heap?.buffers }))
  } catch (error) {
    report.status = 'failed'; report.error = { label, message: error.stack ?? String(error) }; await write(); throw error
  } finally {
    clearTimeout(watchdog)
    if (sampler) await sampler.stop().then(value => fs.writeFile(path.join(output, `${label}-partial-resources.json`), JSON.stringify(value)))
    await browser?.close(); await server?.close(); await tooling?.close()
  }
}
report.status = 'complete'; report.endedAt = new Date().toISOString(); await write()
