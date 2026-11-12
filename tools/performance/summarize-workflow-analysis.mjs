import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const sha = value => createHash('sha256').update(value).digest('hex')
const sorted = rows => [...rows.values()].sort((a, b) => b.sampledMs - a.sampledMs)

/** Exclusive leaf weights partition the sampled interval. Inclusive sources do
 * not: a source is charged at most once per sample, even with recursion. */
export function summarizeCpuProfile(profile, resolveFrame = () => null) {
  check(profile.samples.length === profile.timeDeltas.length, 'Sample/delta length mismatch')
  check(Number.isFinite(profile.startTime) && profile.endTime >= profile.startTime, 'Invalid profile interval')
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), parents = new Map(), frames = new Map()
  check(nodes.size === profile.nodes.length, 'Duplicate CPU node')
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      check(nodes.has(child) && !parents.has(child), 'Missing child or multiple CPU parents')
      parents.set(child, node.id)
    }
    const frame = node.callFrame, mapped = resolveFrame(frame)
    const source = mapped?.source ?? (frame.url?.startsWith('wasm:') ? frame.url
      : frame.url ? `unmapped:${frame.url}` : frame.lineNumber >= 0 ? 'unmapped-script' : frame.functionName || 'unknown-native')
    frames.set(node.id, { source, line: mapped?.line ?? frame.lineNumber + 1,
      column: mapped?.column ?? frame.columnNumber, name: mapped?.name || frame.functionName,
      mapped: Boolean(mapped?.source), url: frame.url })
  }
  const selfSources = new Map(), selfFrames = new Map(), inclusiveSources = new Map(), shaCallers = new Map()
  const add = (map, key, row, sampledMs) => {
    const entry = map.get(key) ?? { ...row, samples: 0, sampledMs: 0 }
    entry.samples++; entry.sampledMs += sampledMs; map.set(key, entry)
  }
  let sampledMs = 0
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i], delta = profile.timeDeltas[i]
    check(nodes.has(id) && Number.isFinite(delta) && delta >= 0, 'Invalid CPU sample/delta')
    const weight = delta / 1000, leaf = frames.get(id), ancestors = [], seen = new Set()
    sampledMs += weight
    add(selfSources, leaf.source, { source: leaf.source }, weight)
    add(selfFrames, JSON.stringify(leaf), leaf, weight)
    for (let current = id; current !== undefined; current = parents.get(current)) {
      check(!seen.has(current), 'Cycle in CPU profile')
      seen.add(current); ancestors.push(frames.get(current))
    }
    for (const source of new Set(ancestors.map(frame => frame.source))) add(inclusiveSources, source, { source }, weight)
    if (leaf.source === 'src/shared/validation/hash.ts') {
      const caller = ancestors.find(frame => frame.source !== leaf.source && frame.source.startsWith('src/'))
      if (caller) add(shaCallers, JSON.stringify(caller), caller, weight)
    }
  }
  const windowMs = (profile.endTime - profile.startTime) / 1000
  return { windowMs, sampledMs, uncoveredMs: windowMs - sampledMs, sampleCount: profile.samples.length,
    selfSources: sorted(selfSources), selfFrames: sorted(selfFrames), inclusiveSources: sorted(inclusiveSources), shaCallers: sorted(shaCallers),
    limitations: ['Sample weights are elapsed sample intervals, not exact CPU work. Native frames can include blocking/flush work.',
      'Only exclusive self rows partition the interval. Inclusive sources overlap and must not be added.',
      'Target main thread only; no browser service, worker or GPU attribution. Unmapped and runtime samples remain explicit.',
      'SHA caller rows partition only hash.ts leaf weights; they do not count hash calls or prove duplicate work.'] }
}

async function listFiles(directory, prefix = '') {
  const rows = []
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const file = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) rows.push(...await listFiles(directory, file))
    else if (entry.isFile()) rows.push(file)
  }
  return rows.sort()
}

async function main() {
  const args = process.argv.slice(2), arg = key => args[args.indexOf(key) + 1]
  if (args.includes('--help')) {
    console.log('node tools/performance/summarize-workflow-analysis.mjs --analysis ABS_JSON --output ABS_NEW_JSON [--maps ABS_DIST --reference-dist ABS_NORMAL_DIST]')
    return
  }
  const filename = arg('--analysis'), output = arg('--output')
  check(args.includes('--analysis') && args.includes('--output') && [filename, output].every(value => value && path.isAbsolute(value)), 'Absolute analysis/output required')
  const inputBytes = await fs.readFile(filename), input = JSON.parse(inputBytes)
  check(input.format === 'sceneweave-workflow-attribution' && input.status === 'complete', 'Complete workflow analysis required')
  const summary = { format: 'sceneweave-workflow-attribution-summary', version: 1, mode: input.mode,
    analysisSha256: sha(inputBytes), device: input.device, browser: input.browser, input: input.input, operations: [] }
  let resolveFrame
  if (input.mode === 'cpu') {
    const mapped = arg('--maps'), reference = arg('--reference-dist')
    check(args.includes('--maps') && args.includes('--reference-dist') && [mapped, reference].every(value => value && path.isAbsolute(value)), 'CPU requires maps and normal reference dist')
    const originalFiles = await listFiles(reference), mappedFiles = await listFiles(mapped)
    const extras = mappedFiles.filter(file => !originalFiles.includes(file))
    check(extras.length > 0 && extras.every(file => file.endsWith('.map')), 'Only hidden map additions allowed')
    const proof = []
    for (const file of originalFiles) {
      const a = await fs.readFile(path.join(reference, file)), b = await fs.readFile(path.join(mapped, file))
      check(a.equals(b), `Mapped code differs: ${file}`)
      proof.push({ file, sha256: sha(a) })
    }
    for (const frozen of input.frozen.build) check(sha(await fs.readFile(path.join(mapped, frozen.file))) === frozen.sha256, `Profile build drift: ${frozen.file}`)
    const { TraceMap, originalPositionFor } = await import('@jridgewell/trace-mapping'), maps = new Map(), mapProof = []
    for (const file of extras) {
      const bytes = await fs.readFile(path.join(mapped, file))
      maps.set(file.slice(0, -4), new TraceMap(JSON.parse(bytes))); mapProof.push({ file, sha256: sha(bytes) })
    }
    resolveFrame = frame => {
      if (!frame.url || frame.lineNumber < 0 || frame.columnNumber < 0) return null
      let file
      try { file = new URL(frame.url).pathname.split('/assets/')[1] } catch { return null }
      const map = maps.get(`assets/${file}`)
      if (!map) return null
      const original = originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber })
      return original.source ? { ...original, source: original.source.replace(/^.*\/(src|node_modules)\//, '$1/') } : null
    }
    summary.mapping = { byteIdenticalFiles: proof, extraHiddenMaps: mapProof }
  }
  for (const operation of input.operations) {
    check(operation.status === 'complete', 'Incomplete operation')
    const sample = operation.observation.sample
    const row = { name: operation.name, ui: Object.fromEntries(Object.entries(sample).filter(([key]) => key.startsWith('intentTo'))),
      tailDrainNodeMs: operation.tailDrainNodeMs }
    if (operation.stages) {
      check(!operation.stages.dropped && !operation.stages.openAtEnd.length, 'Invalid stage window')
      Object.assign(row, { diagnosticWindowMs: operation.stages.endedAtMs - operation.stages.startedAtMs,
        inclusiveFunctions: operation.stages.aggregates, renderMetrics: operation.stages.renderMetrics, pngMetrics: operation.stages.pngMetrics ?? [],
        filteredSmallSpans: operation.stages.filteredSmallSpans })
    } else {
      const profileFile = path.resolve(path.dirname(filename), operation.profile)
      check(path.dirname(profileFile) === path.dirname(filename), 'Unsafe CPU profile path')
      const bytes = await fs.readFile(profileFile)
      row.cpu = { profile: operation.profile, sha256: sha(bytes), ...summarizeCpuProfile(JSON.parse(bytes), resolveFrame) }
    }
    summary.operations.push(row)
  }
  await fs.writeFile(output, JSON.stringify(summary, null, 2), { flag: 'wx' })
  console.log(`${input.mode}: ${summary.operations.length} operations; summary ${output}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
