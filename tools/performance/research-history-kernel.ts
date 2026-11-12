// Research only. Copied into an isolated Vite root; never imported by the app.
import { checkedContentBlock, validateProjectBlockManifest, materializeProjectContent, isProjectBlockManifest } from '../src/platform/browser/storage/content-blocks.js'
import { canonicalJson, cloneJson, captureJson, freezeJson, equalOwnedJson, encodeUtf8 } from '../src/shared/validation/json.js'
import { canonicalProjectCoordinates, decodeProjectCoordinates } from '../src/shared/aggregates/scene-coordinates.js'
import { parseBoundedJson } from '../src/shared/project/json.js'
import { PACKAGE_LIMITS } from '../src/shared/project/limits.js'
import { sha256Bytes } from '../src/shared/validation/hash.js'
import { auditHistoryRecords } from '../src/platform/browser/storage/history-records.js'
import { createProjectDelta, validateProjectDelta } from '../src/shared/project/delta.js'
import { getVerifiedProjectBundle } from '../src/shared/project/resources.js'
import { getOwnedProjectEncoding } from '../src/shared/project/encoding.js'
import { ownedEncodedSnapshot } from '../src/platform/browser/storage/content-context.js'

const own = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
export const digest = value => sha256Bytes(encodeUtf8(canonicalJson(value)))
export const hashBytes = sha256Bytes
export function makeContext(rawBlocks, maximum = 64 * 1024 * 1024, valueLimit = PACKAGE_LIMITS.jsonValues) {
  // All inputs are independently captured and hashed; the map stays private.
  const blocks = new Map(), parsed = new Map()
  let retained = 0, closed = false
  const stats = { blockChecks: 0, parses: 0, hits: 0, evictions: 0, retainedPeak: 0, projects: 0, projectHashes: 0 }
  for (const raw of rawBlocks) {
    const checked = checkedContentBlock(raw); stats.blockChecks++
    if (blocks.has(checked.sha256)) throw new Error('duplicate captured block')
    blocks.set(checked.sha256, checked); retained += checked.bytes.length + 160
  }
  const blockBytes = retained
  const entry = ref => {
    const block = blocks.get(ref.sha256)
    if (!block || block.bytes.length !== ref.byteLength) throw new Error('actual block length or missing block')
    const known = parsed.get(ref.sha256)
    if (known) { parsed.delete(ref.sha256); parsed.set(ref.sha256, known); stats.hits++; return known }
    const budget = { values: 0 }, value = parseBoundedJson(block.bytes, budget)
    stats.parses++
    if (canonicalJson(value) !== new TextDecoder('utf-8', { fatal: true }).decode(block.bytes)) throw new Error('noncanonical JSON')
    const result = { value: freezeJson(value), nodes: budget.values, estimated: block.bytes.length * 2 + budget.values * 32 + 160 }
    if (blockBytes + result.estimated <= maximum) {
      while (retained + result.estimated > maximum && parsed.size) {
        const first = parsed.keys().next().value; retained -= parsed.get(first).estimated; parsed.delete(first); stats.evictions++
      }
      parsed.set(ref.sha256, result); retained += result.estimated
    }
    stats.retainedPeak = Math.max(stats.retainedPeak, retained)
    return result
  }
  return Object.freeze({ stats, materialize(input) {
    if (closed) throw new Error('closed context')
    const manifest = validateProjectBlockManifest(input), output = {}, distinct = new Set()
    let values = 0
    for (const field of manifest.fields) {
      const entries = field.blocks.map(ref => {
        const result = entry(ref)
        // Exactly the original per-manifest distinct-block parse budget.
        if (!distinct.has(ref.sha256)) { distinct.add(ref.sha256); values += result.nodes }
        if (values > valueLimit) throw new Error('per-manifest cumulative node budget')
        return result.value
      })
      let result = entries[0]
      if (field.mode === 'record') {
        result = {}
        for (const rows of entries) {
          if (!rows || typeof rows !== 'object' || Array.isArray(rows)) throw new Error('record block shape')
          for (const [key, value] of Object.entries(rows)) {
            if (!key || key === '__proto__' || Object.hasOwn(result, key)) throw new Error('duplicate or unsafe merged key')
            own(result, key, value)
          }
        }
      }
      result = cloneJson(result)
      if (field.path.length === 1) own(output, field.path[0], result)
      else {
        if (!Object.hasOwn(output, field.path[0])) own(output, field.path[0], {})
        own(output[field.path[0]], field.path[1], result)
      }
    }
    const bytes = encodeUtf8(canonicalProjectCoordinates(output)); stats.projectHashes++
    if (bytes.length !== manifest.byteLength || sha256Bytes(bytes) !== manifest.contentHash) throw new Error('complete project hash or length')
    stats.projects++
    return output
  }, close() { closed = true; blocks.clear(); parsed.clear() } })
}

export async function hydrate(raw, strategy = 'original', yieldPage = false, maximum) {
  const context = strategy === 'shared' ? makeContext(raw.blocks, maximum) : null
  const blocks = context ? null : new Map(raw.blocks.map(row => { const block = checkedContentBlock(row); return [block.sha256, block] }))
  const manifests = new Map(), versions = [], stats = { materializations: 0, originalBlockReads: 0 }
  let sliceStart = performance.now()
  try {
    for (const row of raw.versions) {
      let checkpoint = row.checkpoint
      if (checkpoint !== null && isProjectBlockManifest(checkpoint)) {
        const key = canonicalJson(checkpoint)
        if (manifests.has(key)) checkpoint = manifests.get(key)
        else {
          checkpoint = context ? context.materialize(checkpoint) : await materializeProjectContent(checkpoint, async hash => { stats.originalBlockReads++; return blocks.get(hash) })
          if (checkpoint.document.aggregateCoordinates?.encoding === 'local') checkpoint = decodeProjectCoordinates(checkpoint)
          manifests.set(key, checkpoint); stats.materializations++
        }
      }
      versions.push({ ...row, checkpoint })
      if (yieldPage && performance.now() - sliceStart >= 12) { await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = performance.now() }
    }
    return { graph: { owner: raw.owner, head: raw.head, versions, pins: raw.pins }, stats: { ...stats, ...context?.stats } }
  } finally { context?.close() }
}

export async function workerJob(data) {
  const start = performance.now(), receivedAt = performance.timeOrigin + start
  let graph = data.graph, hydrationMs = 0, stats
  if (data.raw) { const t = performance.now(), hydrated = await hydrate(data.raw, 'shared'); hydrationMs = performance.now() - t; graph = hydrated.graph; stats = hydrated.stats }
  const t = performance.now(), result = auditHistoryRecords(graph.owner, graph.head, graph.versions, graph.pins)
  return { result, receivedAt, hydrationMs, auditMs: performance.now() - t, computeMs: performance.now() - start, stats }
}

export async function measureBoundary(raw, arm) {
  const start = performance.now(), longTasks = [], observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(row => ({ startTime: row.startTime, duration: row.duration }))))
  observer.observe({ type: 'longtask' })
  let preparationMs = 0, stats, data, transfer = [], bytesCopied = 0, byteArrays = 0
  if (arm === 'original' || arm === 'shared-page') {
    const t = performance.now(), hydrated = await hydrate(raw, arm === 'original' ? 'original' : 'shared', true)
    preparationMs = performance.now() - t; stats = hydrated.stats; data = { graph: hydrated.graph }
  } else {
    // Keep the original native bytes for final confirmation. Only a fresh copy
    // may be detached. Image resource bytes are not included in raw.blocks.
    const t = performance.now()
    const required = new Set(raw.versions.flatMap(row => isProjectBlockManifest(row.checkpoint) ? row.checkpoint.fields.flatMap(field => field.blocks.map(ref => ref.sha256)) : []))
    const selected = []
    for (const block of raw.blocks) {
      if (required.has(block.sha256)) selected.push(block)
      else checkedContentBlock(block) // Unreferenced actual blocks remain checked.
    }
    const payload = { ...raw, blocks: selected.map(block => { const bytes = block.bytes.slice(); bytesCopied += bytes.length; byteArrays++; return { sha256: block.sha256, bytes } }) }
    data = { raw: payload }; if (arm === 'compact-transfer') transfer = payload.blocks.map(block => block.bytes.buffer)
    preparationMs = performance.now() - t
  }
  const creationAt = performance.timeOrigin + performance.now(), worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const postStart = performance.now()
  const answer = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('research worker timeout')) }, 120000)
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)) }
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); event.data.ok ? resolve(event.data.value) : reject(new Error(event.data.error)) }
    worker.postMessage(data, transfer)
    globalThis.__researchPostMs = performance.now() - postStart
  })
  const wallMs = performance.now() - start, now = performance.now()
  await new Promise(resolve => setTimeout(resolve, 30)); observer.disconnect()
  return { arm, wallMs, preparationMs, postMs: globalThis.__researchPostMs, creationToReceivedMs: answer.receivedAt - creationAt,
    worker: answer, pageStats: stats, byteArrays, bytesCopied, originalBytesIntact: raw.blocks.every(b => b.bytes.length > 0),
    longestPageTaskMs: Math.max(0, ...longTasks.filter(e => e.startTime < now).map(e => e.duration)) }
}

// Stage 3: private, independently validated immutable endpoints and their own
// exact complete encodings. This function is a research consumer, not an app API.
export function prepareDelta(beforeSnapshot, afterSnapshot, mode) {
  if (!beforeSnapshot || !afterSnapshot) return null
  const left = beforeSnapshot.project, right = afterSnapshot.project
  const a = getOwnedProjectEncoding(beforeSnapshot.encoded, left), b = getOwnedProjectEncoding(afterSnapshot.encoded, right)
  if (!a || !b || ownedEncodedSnapshot(left) !== beforeSnapshot || ownedEncodedSnapshot(right) !== afterSnapshot) throw new Error('private encoding owner missing')
  let delta
  if (mode === 'move-only') delta = createProjectDelta(left, right)
  else {
    const changes = [], visit = (l, r, path) => {
      if (l === r) return
      const record = v => v !== null && typeof v === 'object' && !Array.isArray(v)
      if (record(l) && record(r)) {
        for (const key of [...new Set([...Object.keys(l), ...Object.keys(r)])].sort()) {
          const x = Object.hasOwn(l, key), y = Object.hasOwn(r, key)
          if (x && y) visit(l[key], r[key], [...path, key])
          else changes.push({ path: [...path, key], before: x ? { present: true, value: cloneJson(l[key]) } : { present: false }, after: y ? { present: true, value: cloneJson(r[key]) } : { present: false } })
        }
      } else if (!equalOwnedJson(l, r)) changes.push({ path, before: { present: true, value: cloneJson(l) }, after: { present: true, value: cloneJson(r) } })
    }
    visit(a.stored, b.stored, [])
    delta = validateProjectDelta({ format: 'sceneweave-project-delta', version: 1, beforeHash: a.contentHash, afterHash: b.contentHash, changes })
  }
  const owned = freezeJson(delta)
  return Object.freeze({ consume(previous, current) {
    // Check raw complete world values before any normalizing transformation.
    const x = previous === left ? left : captureJson(previous), y = current === right ? right : captureJson(current)
    if (!equalOwnedJson(x, left) || !equalOwnedJson(y, right)) return
    return owned
  }, json: canonicalJson(delta) })
}

export function probeDeltaOwnership(beforeSnapshot, afterSnapshot) {
  const prepared = prepareDelta(beforeSnapshot, afterSnapshot, 'reuse'), expected = canonicalJson(createProjectDelta(beforeSnapshot.project, afterSnapshot.project))
  if (prepared.json !== expected) throw new Error('prepared delta differs from full original')
  const before = cloneJson(beforeSnapshot.project), after = cloneJson(afterSnapshot.project)
  if (!prepared.consume(before, after)) throw new Error('equal detached endpoint missed')
  after.document.title += ' stale'; if (prepared.consume(before, after)) throw new Error('changed after endpoint accepted')
  before.document.title += ' changed'; if (prepared.consume(before, afterSnapshot.project)) throw new Error('changed baseline accepted')
  const getter = cloneJson(afterSnapshot.project); Object.defineProperty(getter.document, 'title', { enumerable: true, get() { throw new Error('must not execute') } })
  let rejected = false; try { prepared.consume(beforeSnapshot.project, getter) } catch { rejected = true }
  if (!rejected) throw new Error('accessor accepted')
  return { originalBytesEqual: true, changedBeforeRejected: true, changedAfterRejected: true, accessorRejected: true }
}

export async function probeMaterialization(raw) {
  const manifest = raw.versions.find(row => isProjectBlockManifest(row.checkpoint)).checkpoint
  const context = makeContext(raw.blocks)
  const first = context.materialize(manifest), second = context.materialize(manifest)
  const expected = canonicalProjectCoordinates(first); first.document.title += ' edited'
  if (canonicalProjectCoordinates(second) !== expected) throw new Error('cross-result alias')
  const tests = { independentOutputs: true, fullHashChecked: true }
  const rejects = (name, fn) => { let rejected = false; try { fn() } catch { rejected = true }; if (!rejected) throw new Error(name+' not rejected'); tests[name] = true }
  const ref = manifest.fields[0].blocks[0], badLength = cloneJson(manifest); badLength.fields[0].blocks[0].byteLength++
  rejects('badReferenceLength', () => context.materialize(badLength))
  const badHash = cloneJson(manifest); badHash.contentHash = '0'.repeat(64); rejects('badCompleteHash', () => context.materialize(badHash))
  const mutable = raw.blocks.map(row => ({ sha256: row.sha256, bytes: row.bytes.slice() })); const owned = makeContext(mutable)
  mutable.find(b => b.sha256 === ref.sha256).bytes.fill(0)
  if (canonicalProjectCoordinates(owned.materialize(manifest)) !== expected) throw new Error('owned bytes mutated')
  tests.independentByteClosure = true; owned.close()
  rejects('closedContext', () => owned.materialize(manifest))
  rejects('corruptBlock', () => makeContext(mutable))
  const small = makeContext(raw.blocks, 0), smallOutput = small.materialize(manifest)
  if (canonicalProjectCoordinates(smallOutput) !== expected || small.stats.hits) throw new Error('cache zero fallback differs')
  tests.zeroCacheFallbackEqual = true; small.close()
  const lowBudget = makeContext(raw.blocks, undefined, 1)
  rejects('manifestBudgetInitial', () => lowBudget.materialize(manifest))
  rejects('manifestBudgetEvenOnHit', () => lowBudget.materialize(manifest))
  if (!lowBudget.stats.hits) throw new Error('budget test did not exercise a cached block')
  lowBudget.close()
  const duplicated = cloneJson(manifest), field = duplicated.fields.find(f => f.mode === 'record')
  const extra = { a: 1 }, b = encodeUtf8('{"a":1,"a":2}'), duplicateBlock = { sha256: sha256Bytes(b), bytes: b }
  const malformedContext = makeContext([...raw.blocks, duplicateBlock])
  const bad = cloneJson(manifest); bad.fields[0] = { path: bad.fields[0].path, mode: 'value', blocks: [{ sha256: duplicateBlock.sha256, byteLength: b.length }] }
  rejects('duplicateJsonKeys', () => malformedContext.materialize(bad)); malformedContext.close()
  if (field) {
    const firstBlock = raw.blocks.find(b => b.sha256 === field.blocks[0].sha256), v = JSON.parse(new TextDecoder().decode(firstBlock.bytes))
    const key = Object.keys(v)[0], body = encodeUtf8(canonicalJson({ [key]: extra })), duplicate = { sha256: sha256Bytes(body), bytes: body }
    field.blocks.push({ sha256: duplicate.sha256, byteLength: body.length })
    const merged = makeContext([...raw.blocks, duplicate]); rejects('duplicateMergedRecordKey', () => merged.materialize(duplicated)); merged.close()
  }
  context.close(); return tests
}
