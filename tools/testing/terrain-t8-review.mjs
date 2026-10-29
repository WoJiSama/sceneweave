import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

// Bounded development capacity observations and reference fixtures, never a
// formal performance run, paid model request, or art acceptance.
const output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? 'work/terrain-t8')
assert(output.startsWith(path.resolve('work') + path.sep), 'Evidence must stay in ignored work/.')
const mode = process.argv[2] ?? 'capacity'
assert(['capacity', 'samples'].includes(mode), 'Use capacity or samples.')
await mkdir(output, { recursive: true })
const port = Number(process.env.SCENEWEAVE_T8_PORT ?? 5186), origin = `http://127.0.0.1:${port}`
const report = { mode, startedAt: new Date().toISOString(), status: 'running', automaticModelRequests: 0,
  method: 'One serial observation per input in a fresh Chromium profile against Vite development modules. Same page and resource cache reused. Worker time includes transport/validation; preparation replays and validates actual resources; preview includes full validation at 1024px. Main-page CDP heap sampled every 75ms, excluding Worker/GPU/process memory; no peak-memory or formal p95 claim. No forced GC.',
  device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version }, rows: [], pageErrors: [], consoleErrors: [], failedHttp: [], blocked: [] }
const save = () => writeFile(path.join(output, `${mode}.json`), JSON.stringify(report, null, 2) + '\n')
let server, browser
try {
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' })
  await server.listen()
  browser = await chromium.launch({ headless: true })
  report.browser = browser.version()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(origin + '/') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue()
    report.blocked.push(url); return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
  page.on('response', response => { if (response.status() >= 400) report.failedHttp.push({ url: response.url(), status: response.status() }) })
  await page.goto(origin)
  const cdp = await context.newCDPSession(page)
  if (mode === 'capacity') {
    const sizes = [[24000, 18000], [36000, 20000], [36000, 36000], [48000, 36000], [120000, 90000], [24000, 24000], [120000, 66667], [37123, 23456]]
    for (const [widthMm, heightMm] of sizes) for (const kind of ['island', 'coast', 'river', 'lake', 'forest', 'hill', 'mixed']) {
      const heaps = [], before = await cdp.send('Runtime.getHeapUsage')
      let sampling = true
      const sampler = (async () => { while (sampling) { heaps.push((await cdp.send('Runtime.getHeapUsage')).usedSize); await new Promise(resolve => setTimeout(resolve, 75)) } })()
      const row = await page.evaluate(async input => {
        const { createRefinedBlankProject } = await import('/src/platform/browser/content/refined-blank.ts')
        const { createTerrainGenerationClient } = await import('/src/platform/browser/terrain-generation/client.ts')
        const { prepareTerrainProject } = await import('/src/application/workspace/terrain.ts')
        const { renderEditorProject } = await import('/src/platform/browser/render/renderer.ts')
        const { validation } = await import('/src/platform/browser/runtime.ts')
        const { toBundle } = await import('/src/application/workspace/project.ts')
        const { canonicalJson } = await import('/src/shared/validation/json.ts')
        const { projectContentHash } = await import('/src/shared/project/validate.ts')
        const client = createTerrainGenerationClient(), timings = {}, start = performance.now()
        try {
          const base = await createRefinedBlankProject(input.kind === 'coast' ? 'coast' : 'island', { sceneId: input.sceneId, title: 'T8容量样片', preset: 'narrative', widthMm: input.widthMm, heightMm: input.heightMm, now: '2026-10-28T00:00:00.000Z' })
          timings.baseMs = performance.now() - start
          let time = performance.now()
          const result = await client.generate({ sceneId: input.sceneId, checkpoint: 0, operationEpoch: 1, base: base.document, input })
          timings.workerMs = performance.now() - time
          let id = 0
          time = performance.now()
          const prepared = await prepareTerrainProject(base, input, { validation, result, runtime: { ids: { nextId: () => `t8-capacity-${++id}` }, clock: { now: () => '2026-10-28T00:00:00.000Z' } } })
          timings.prepareMs = performance.now() - time
          const bundle = toBundle(prepared.project)
          time = performance.now()
          const canvas = await renderEditorProject(bundle, { audience: 'gm', longEdgePx: 1024 })
          timings.previewMs = performance.now() - time
          const bytes = new TextEncoder().encode(canonicalJson(bundle.project)).byteLength
          const shape = result.skeleton, fieldGridApplied = input.kind === 'island' || input.kind === 'coast'
          return { input, status: 'passed', timings, cost: prepared.cost, coreCost: result.cost, skeleton: shape,
            grid: { columns: shape.gridColumns, rows: shape.gridRows, nodes: fieldGridApplied ? (shape.gridColumns + 1) * (shape.gridRows + 1) : 0, fieldGridApplied, note: fieldGridApplied ? 'Two contour fields sampled sequentially; each grid Float64 values only, other allocations excluded.' : 'T3 uses explicit recipe geometry; skeleton grid metadata is not a sampled field.' },
            minimumFieldValueBytes: fieldGridApplied ? (shape.gridColumns + 1) * (shape.gridRows + 1) * 8 : 0,
            counts: { terrainAreas: Object.keys(bundle.project.document.terrainAreas).length, terrainPoints: result.cost.terrainPoints, curveSegments: result.cost.curveSegments, pathPoints: result.cost.pathPoints, props: Object.keys(bundle.project.document.props).length, rules: Object.keys(bundle.project.document.generation.rules).length, ownership: Object.keys(bundle.project.document.generation.ownership).length },
            projectJsonBytes: bytes, assets: Object.keys(bundle.project.assets).length,
            resourceBytes: Object.values(bundle.project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0),
            hash: projectContentHash(bundle.project), canvas: { width: canvas.width, height: canvas.height } }
        } catch (error) { return { input, status: 'rejected', timings, error: error instanceof Error ? error.message : 'unknown' } }
        finally { client.dispose() }
      }, { sceneId: `t8-capacity-${kind}-${widthMm}-${heightMm}`, kind, seed: 'terrain-v1-0', widthMm, heightMm })
      sampling = false; await sampler
      const after = await cdp.send('Runtime.getHeapUsage')
      row.mainPageHeap = { beforeBytes: before.usedSize, afterBytes: after.usedSize, maxObservedBytes: Math.max(before.usedSize, after.usedSize, ...heaps), observations: heaps.length }
      report.rows.push(row); await save()
      console.log(`${row.status} ${kind} ${widthMm / 1000}x${heightMm / 1000} cost=${row.cost?.total ?? 'rejected'}`)
    }
  } else {
    for (const kind of ['archipelago-coast', 'forest-valley', 'grass-rock-hills']) {
      const sample = await page.evaluate(async kind => {
        const { createT8Sample, T8_SAMPLE_SPECS } = await import('/tools/testing/terrain-t8-fixtures.ts')
        const { toBundle } = await import('/src/application/workspace/project.ts')
        const { exportProject, importProject } = await import('/src/shared/project/file.ts')
        const { exportPng } = await import('/src/platform/browser/render/renderer.ts')
        const { validation, runtime } = await import('/src/platform/browser/runtime.ts')
        const { ProjectRepository } = await import('/src/platform/browser/storage/repository.ts')
        const { projectContentHash } = await import('/src/shared/project/validate.ts')
        const encode = bytes => { let text = ''; for (let index = 0; index < bytes.length; index += 32768) text += String.fromCharCode(...bytes.subarray(index, index + 32768)); return btoa(text) }
        const outputs = []
        for (const mode of ['neutral', 'effect']) {
          const project = await createT8Sample(kind, mode), bundle = toBundle(project), bytes = await exportProject(bundle, validation), cold = await importProject(bytes, validation)
          const hash = projectContentHash(bundle.project)
          if (projectContentHash(cold.project) !== hash) throw new Error('T8 complete package changed on import')
          const repository = new ProjectRepository({ name: `t8-reference-${kind}-${mode}`, runtime, validation })
          try {
            await repository.save(bundle, null)
            if (projectContentHash((await repository.load(project.document.sceneId)).project) !== hash) throw new Error('T8 cold storage changed')
          } finally { repository.close() }
          const gm = await exportPng(cold, { audience: 'gm', longEdgePx: 2048 }), player = await exportPng(cold, { audience: 'player', longEdgePx: 2048 })
          outputs.push({ mode, hash, bytes: encode(bytes), gm: encode(new Uint8Array(await gm.arrayBuffer())), player: encode(new Uint8Array(await player.arrayBuffer())), schemaVersion: cold.project.schemaVersion, sceneId: project.document.sceneId })
        }
        return { kind, spec: T8_SAMPLE_SPECS[kind], outputs }
      }, kind)
      for (const entry of sample.outputs) {
        await writeFile(path.join(output, `${kind}-${entry.mode}.sceneweave`), Buffer.from(entry.bytes, 'base64'))
        await writeFile(path.join(output, `${kind}-${entry.mode}-gm.png`), Buffer.from(entry.gm, 'base64'))
        await writeFile(path.join(output, `${kind}-${entry.mode}-player.png`), Buffer.from(entry.player, 'base64'))
        delete entry.bytes; delete entry.gm; delete entry.player
      }
      report.rows.push(sample); await save(); console.log(`passed reference ${kind}`)
    }
  }
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.failedHttp, []); assert.deepEqual(report.blocked, [])
  report.status = report.rows.some(row => row.status === 'rejected') ? 'bounded-rejections' : 'passed'
  const sources = ['src/shared/terrain-generation/generate.ts', 'src/shared/terrain-generation/compose.ts', 'src/editor/main/TerrainGenerationPanel.tsx', 'tools/testing/terrain-t8-review.mjs']
  if (mode === 'samples') sources.push('tools/testing/terrain-t8-fixtures.ts')
  report.sources = Object.fromEntries(await Promise.all(sources.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
} catch (error) { report.status = 'failed'; report.error = error.stack; process.exitCode = 1 }
finally { report.finishedAt = new Date().toISOString(); await save(); await browser?.close(); await server?.close() }
