import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyVisualV2Fixtures } from './visual-v2-fixtures.mjs'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { startResourceSampling } from './resources.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureNames = ['study-500', 'study-2000', 'island-500', 'island-2000']
const check = (condition, message) => { if (!condition) throw new Error(message) }
const toolPaths = ['interaction-capacity.mjs', 'interaction-capacity-browser.ts', 'visual-v2-fixtures.mjs', 'prepare-native-m2-fixture.mjs', 'resources.mjs', 'close-browser.mjs'].map(name => `tools/performance/${name}`)

async function fingerprint(relative = 'src') {
  const records = []
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) records.push(...await fingerprint(name))
    else if (entry.isFile()) { const bytes = await fs.readFile(path.join(root, name)); records.push({ path: name, sizeBytes: bytes.length, sha256: hash(bytes) }) }
  }
  return records.sort((a, b) => a.path.localeCompare(b.path))
}
async function toolFingerprint() {
  return Promise.all(toolPaths.map(async name => { const bytes = await fs.readFile(path.join(root, name)); return { path: name, sizeBytes: bytes.length, sha256: hash(bytes) } }))
}
function summary(values) {
  if (!values.length) return { count: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  return { count: values.length, minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1), meanMs: values.reduce((sum, value) => sum + value, 0) / values.length }
}

async function main() {
  const args = process.argv.slice(2), argument = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
  if (args.includes('--help')) {
    console.log('node tools/performance/interaction-capacity.mjs --output ABS_NEW_EMPTY [--fixtures ABS_DIR] [--cases study-500,study-2000,island-500,island-2000] [--candidates 4000,10000,16000] [--repetitions 3] [--warm-queries 60] [--channel chrome]')
    return
  }
  const output = argument('--output', null), sourceDirectory = path.resolve(argument('--fixtures', path.join(root, 'work/q2q5/performance-fixtures-final')))
  const cases = argument('--cases', fixtureNames.join(',')).split(','), candidates = argument('--candidates', '4000,10000,16000').split(',').filter(Boolean).map(Number)
  const repetitions = Number(argument('--repetitions', '3')), warmQueries = Number(argument('--warm-queries', '60')), channel = argument('--channel', 'chrome')
  check(output && path.isAbsolute(output), '--output must be an absolute new empty independent directory')
  check(cases.length && new Set(cases).size === cases.length && cases.every(name => fixtureNames.includes(name)), '--cases must contain unique known fixture names')
  check(new Set(candidates).size === candidates.length && candidates.every(value => Number.isSafeInteger(value) && value > 2000 && value <= 32000), '--candidates must contain unique integers above 2000 and at most 32000')
  check(Number.isSafeInteger(repetitions) && repetitions >= 1 && repetitions <= 10 && Number.isSafeInteger(warmQueries) && warmQueries >= 1 && warmQueries <= 300, 'Invalid repetitions or warm query count')
  try { check((await fs.readdir(output)).length === 0, 'Output must be empty') } catch (error) { if (error.code !== 'ENOENT') throw error }
  await fs.mkdir(output, { recursive: true })
  const copied = await copyVisualV2Fixtures({ sourceDirectory, outputDirectory: output, requestedCases: cases })
  const before = await fingerprint(), beforeTools = await toolFingerprint()
  const manifest = { format: 'sceneweave-interaction-capacity-diagnostic', version: 1, status: 'running', startedAt: new Date().toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceFingerprint: hash(JSON.stringify(before)), source: before,
    tools: beforeTools, fixtureProvenance: copied.provenance, fixtures: copied.cases.map(item => ({ name: item.name, artifact: item.artifact })),
    config: { cases, candidates, repetitions, warmQueries, channel, headless: true, processSampleIntervalMs: 100, heapSampleIntervalMs: 200 },
    hardware: { platform: os.platform(), release: os.release(), architecture: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
    method: 'Serial separate tooling-only Vite pages; one fresh dedicated Chrome process per case. Exact complete-v2 fixture bytes are public-imported with real resources before synthesis. Public metadata and full-resource checks remain intact. Cold native selection builds distinct point/bounds indexes; warm calls reuse certified scene identity. Render-plan measurements perform culling/LOD planning only.',
    limitations: ['Development diagnosis, not formal performance or supported-capacity acceptance.', 'Higher candidates repeat nonblocking exact props at their original supports and deliberately increase overlap; these are offline synthetic loads, not product command/adoption budget changes.',
      'No UI event-to-paint, layer panel, raster draw, save/history cold-read, PNG/privacy export or large-map playability proof.', 'Timing includes tooling async/microtask overhead, cold module/JIT effects and resource sampling overhead. Per-call observations are retained; tiny samples do not establish p95.',
      'Process-tree RSS is sampled on macOS and may count shared mappings more than once; page CDP heap omits GPU/other pages. Short stages can have no phase sample.'], cases: [], failures: [] }
  const write = () => fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await write()
  let tooling
  try {
    tooling = await startNativeFixtureTooling({ root })
    const scheduled = copied.cases.map(item => ({ item, targetProps: null, name: item.name }))
    for (const item of copied.cases.filter(item => item.name.endsWith('-2000'))) for (const targetProps of candidates) scheduled.push({ item, targetProps, name: `${item.name.split('-')[0]}-${targetProps}` })
    for (const entry of scheduled) {
      console.log(`Interaction/capacity diagnostic ${entry.name}`)
      let server, browser, sampler, cdp
      const caseRecord = { name: entry.name, baseFixture: entry.item.name, targetProps: entry.targetProps, status: 'running' }
      manifest.cases.push(caseRecord); await write()
      try {
        server = await chromium.launchServer({ channel, headless: true })
        browser = await chromium.connect(server.wsEndpoint())
        caseRecord.browser = browser.version()
        const context = await browser.newContext(), bytes = await fs.readFile(path.join(output, entry.item.artifact.path))
        check(bytes.length === entry.item.artifact.sizeBytes && hash(bytes) === entry.item.artifact.sha256, 'Copied fixture changed before run')
        await context.route(`${tooling.origin}/__capacity_fixture.sceneweave`, route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes }))
        const page = await context.newPage(); page.setDefaultTimeout(240_000)
        const errors = []; page.on('pageerror', error => errors.push(error.message))
        cdp = await context.newCDPSession(page); await cdp.send('Performance.enable')
        sampler = startResourceSampling({ rootPid: server.process().pid, cdp, intervalMs: 100, heapIntervalMs: 200 })
        await page.exposeFunction('__sceneweaveCapacityPhase', name => { sampler.setPhase(name) })
        sampler.setPhase('tooling-initialization')
        await page.goto(tooling.url)
        await page.evaluate(async () => { await import('/tools/performance/interaction-capacity-browser.ts') })
        caseRecord.result = await page.evaluate(async config => {
          const module = await import('/tools/performance/interaction-capacity-browser.ts')
          return module.runInteractionCapacityDiagnostic(config)
        }, { fixtureUrl: `${tooling.origin}/__capacity_fixture.sceneweave`, sample: entry.item.name.split('-')[0], targetProps: entry.targetProps,
          markerId: entry.item.summary.editablePropId, markerPoint: entry.item.summary.selectionPointMm, repetitions, warmQueries })
        check(errors.length === 0, `Tooling page errors: ${errors.join('; ')}`)
        caseRecord.timingSummary = Object.fromEntries(Object.entries(caseRecord.result.timings).map(([name, values]) => [name, summary(values)]))
        caseRecord.status = caseRecord.result.status
      } catch (error) { caseRecord.status = 'failed'; caseRecord.error = String(error); throw error }
      finally {
        try {
          if (sampler) {
            sampler.setPhase('diagnostic-finished')
            const resources = await sampler.stop()
            caseRecord.resourceSummary = resources.summary
            const artifactPath = `resources-${entry.name}.json`, resourceBytes = Buffer.from(JSON.stringify(resources))
            await fs.writeFile(path.join(output, artifactPath), resourceBytes, { flag: 'wx' })
            caseRecord.resources = { path: artifactPath, sizeBytes: resourceBytes.length, sha256: hash(resourceBytes) }
          }
        } finally {
          try { await cdp?.detach() } finally { caseRecord.teardown = await closeMeasuredBrowser(server, browser) }
          await write()
        }
      }
      console.log(`${entry.name}: ${caseRecord.status}; ${caseRecord.result.projectShape.values} JSON values / ${caseRecord.result.documentShape.bytes} scene bytes`)
    }
    check(JSON.stringify(await fingerprint()) === JSON.stringify(before), 'Source changed during diagnosis; observations cannot share a source freeze')
    check(JSON.stringify(await toolFingerprint()) === JSON.stringify(beforeTools), 'Diagnostic tools changed during diagnosis')
    for (const item of copied.cases) {
      const current = await fs.readFile(path.join(sourceDirectory, item.artifact.path)), preserved = await fs.readFile(path.join(output, item.artifact.path))
      check(hash(current) === item.artifact.sha256 && hash(preserved) === item.artifact.sha256, 'Fixture bytes changed during diagnosis')
    }
    manifest.sourceUnchanged = true; manifest.toolsUnchanged = true; manifest.fixturesUnchanged = true
    manifest.status = 'complete'; manifest.finishedAt = new Date().toISOString(); await write()
  } catch (error) { manifest.status = 'failed'; manifest.failures.push(String(error)); manifest.finishedAt = new Date().toISOString(); await write(); throw error }
  finally { await tooling?.close() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
