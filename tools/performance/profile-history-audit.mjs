// Profile the unmodified algorithm over an actual-read synthetic history graph.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen } from './frozen-input.mjs'

const args = process.argv.slice(2), arg = key => args[args.indexOf(key) + 1]
if (args.includes('--help')) {
  console.log('node tools/performance/profile-history-audit.mjs --source ABS_FROZEN --graph ABS_ACTUAL_READ_SYNTHETIC_JSON --output ABS_NEW')
  console.log('Three sequential original worker audits and a separate original synchronous page CPU profile. No product transforms or database transactions. Component attribution, never production save timing.'); process.exit(0)
}
const source = arg('--source'), graph = arg('--graph'), output = arg('--output')
if (![source, graph, output].every(v => v && path.isAbsolute(v))) throw new Error('Use absolute paths')
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw new Error('Use a new empty output')
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), sha = b => createHash('sha256').update(b).digest('hex')
const paths = ['src', 'package.json', 'package-lock.json'], toolPaths = ['tools/performance/profile-history-audit.mjs', 'tools/performance/prepare-native-m2-fixture.mjs', 'tools/performance/frozen-input.mjs']
const fingerprint = async () => ({ source: await fingerprintPaths(source, paths), tools: await fingerprintPaths(toolRoot, toolPaths), graph: sha(await fs.readFile(graph)) })
const frozen = await fingerprint(), text = await fs.readFile(graph, 'utf8')
const report = { format: 'sceneweave-original-history-audit-profile', version: 1, status: 'running', startedAt: new Date().toISOString(), source, frozen,
  graph: { sha256: sha(text), byteLength: Buffer.byteLength(text) }, device: { platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  limitations: ['Unmodified source modules, identical synthetic graph; no DB transaction, resources or UI save.', 'Worker elapsed time includes start/module loading/structured clone; not pure computation.', 'CPU profile covers one separate synchronous page audit, not worker/native/GPU CPU. Profiler and scheduling affect time.', 'Leaf sample durations are exclusive; file or function inclusive totals overlap and must not be summed.', 'No exclusive system-load guard or formal distribution.'], workers: [], events: [] }
const write = () => fs.writeFile(path.join(output, 'analysis.json'), JSON.stringify(report, null, 2)); await write()
let tooling, browser
try {
  tooling = await startNativeFixtureTooling({ root: source }); browser = await chromium.launch({ channel: 'chrome', headless: true }); report.browser = browser.version()
  const context = await browser.newContext(), page = await context.newPage()
  page.on('pageerror', e => report.events.push({ type: 'pageerror', message: e.message }))
  page.on('console', e => { if (e.type() === 'error') report.events.push({ type: 'console-error', message: e.text() }) })
  await page.goto(tooling.url)
  report.graph.versions = await page.evaluate(async text => {
    globalThis.__actualGraph = JSON.parse(text)
    globalThis.__audit = await import('/src/platform/browser/storage/history-audit-client.ts')
    globalThis.__records = await import('/src/platform/browser/storage/history-records.ts')
    return globalThis.__actualGraph.versions.length
  }, text)
  for (let i = 0; i < 3; i++) {
    console.log(`Original standalone worker ${i + 1}/3`)
    report.workers.push(await page.evaluate(async () => { const g = globalThis.__actualGraph, start = performance.now(); const result = await globalThis.__audit.auditHistoryInWorker(g.owner, g.head, g.versions, g.pins); return { ms: performance.now() - start, result } })); await write()
  }
  console.log('Original synchronous CPU profile')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start')
  report.directPageAudit = await page.evaluate(() => { const g = globalThis.__actualGraph, start = performance.now(); const result = globalThis.__records.auditHistoryRecords(g.owner, g.head, g.versions, g.pins); return { ms: performance.now() - start, result } })
  const { profile } = await cdp.send('Profiler.stop'); await fs.writeFile(path.join(output, 'original-page.cpuprofile'), JSON.stringify(profile), { flag: 'wx' })
  const nodes = new Map(profile.nodes.map(n => [n.id, n])), functions = new Map(), files = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    const frame = nodes.get(profile.samples[i]).callFrame, ms = profile.timeDeltas[i] / 1000
    // Retain the original URL in the raw profile; summary strips ephemeral origin.
    const file = frame.url.replace(/^https?:\/\/[^/]+/, ''), key = JSON.stringify([file, frame.functionName])
    const row = functions.get(key) ?? { file, name: frame.functionName, selfMs: 0, samples: 0 }; row.selfMs += ms; row.samples++; functions.set(key, row)
    files.set(file, (files.get(file) ?? 0) + ms)
  }
  report.cpu = { wallMs: (profile.endTime - profile.startTime) / 1000, sampledMs: profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000,
    functions: [...functions.values()].sort((a, b) => b.selfMs - a.selfMs), files: [...files].map(([file, selfMs]) => ({ file, selfMs })).sort((a, b) => b.selfMs - a.selfMs) }
  report.outputConsistency = [...report.workers.map(r => r.result.documentBytes), report.directPageAudit.result.documentBytes]
  if (new Set(report.outputConsistency).size !== 1) throw new Error('Validated graph byte counts differ')
  const finalGraph = await page.evaluate(() => JSON.stringify(globalThis.__actualGraph))
  if (sha(finalGraph) !== report.graph.sha256) throw new Error('Actual-read graph changed during profiling')
  report.graph.unchangedAfterRun = true
  if (report.events.length) throw new Error('Unexpected page/console error; inspect retained events')
  assertFrozen(frozen, await fingerprint(), 'original source/graph/tools after profiling')
  report.status = 'complete'; await context.close()
} catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally { await browser?.close(); await tooling?.close(); report.endedAt = new Date().toISOString(); await write() }
