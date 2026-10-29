import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

// Development observations and three bounded reference exports. This is not a
// formal performance run, model evaluation, or final visual acceptance.
const output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? 'work/terrain-t9')
assert(output.startsWith(path.resolve('work') + path.sep), 'Evidence must stay in ignored work/.')
const port = Number(process.env.SCENEWEAVE_T9_PORT ?? 5187), origin = `http://127.0.0.1:${port}`
const presets = ['archipelago', 'forestValley', 'grassRidge', 'tidalCoast'], seeds = ['terrain-compose-0', 'terrain-compose-1', 'terrain-compose-2']
const report = { startedAt: new Date().toISOString(), status: 'running', automaticModelRequests: 0,
  method: 'Twelve serial 48x36m development observations, four preset families by three fixed seeds. Real Worker plan, deterministic application replay, full expanded adoption cost, complete resource validation, then one successful representative per family exported as a full package and GM/player 1024px PNGs. Each representative uses a fresh isolated IndexedDB, closes and reopens it before hash comparison, then deletes that database. Elapsed times include development transport and validation; no percentile or formal performance claim. No external network or model calls.',
  device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version },
  rows: [], representatives: [], pageErrors: [], consoleErrors: [], failedHttp: [], blocked: [] }
await mkdir(output, { recursive: true })
const save = () => writeFile(path.join(output, 'review.json'), JSON.stringify(report, null, 2) + '\n')
let server, browser
try {
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' })
  await server.listen()
  browser = await chromium.launch({ headless: true }); report.browser = browser.version()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if ((url.origin === origin && !/^\/api(?:\/|$)/.test(url.pathname)) || ['blob:', 'data:'].includes(url.protocol)) return route.continue()
    report.blocked.push(url.href); return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
  page.on('response', response => { if (response.status() >= 400) report.failedHttp.push({ url: response.url(), status: response.status() }) })
  await page.goto(origin)
  for (const preset of presets) for (const seed of seeds) {
    const request = { sceneId: `t9-review-${preset}-${seed}`, preset, seed, widthMm: 48000, heightMm: 36000, islandCount: 3 }
    const row = await page.evaluate(async request => {
      const { createRefinedBlankProject } = await import('/src/platform/browser/content/refined-blank.ts')
      const { compositionPreset } = await import('/src/shared/terrain-generation/composition-presets.ts')
      const { computeTerrainComposition } = await import('/src/platform/browser/terrain-generation/composition-client.ts')
      const { materializeTerrainComposition } = await import('/src/shared/terrain-generation/composition-materialize.ts')
      const { terrainCommandCost } = await import('/src/shared/terrain-generation/cost.ts')
      const { prepareTerrainComposition } = await import('/src/application/workspace/terrain-composition.ts')
      const { validation } = await import('/src/platform/browser/runtime.ts')
      const { toBundle } = await import('/src/application/workspace/project.ts')
      const { canonicalJson } = await import('/src/shared/validation/json.ts')
      const { sha256Text } = await import('/src/shared/validation/hash.ts')
      const { projectContentHash } = await import('/src/shared/project/validate.ts')
      const start = performance.now(), timings = {}, observation = { request, status: 'rejected', timings }
      let stage = 'base', serial = 0
      try {
        const base = await createRefinedBlankProject('island', { sceneId: request.sceneId, widthMm: request.widthMm, heightMm: request.heightMm, title: 'T9容量样片', preset: 'narrative', now: '2026-10-29T00:00:00.000Z' })
        timings.baseMs = performance.now() - start
        const spec = compositionPreset(request), abort = new AbortController()
        let time = performance.now(); stage = 'worker'
        const plan = await computeTerrainComposition(spec.input, abort.signal)
        timings.workerMs = performance.now() - time
        Object.assign(observation, { planHash: sha256Text(canonicalJson(plan)), grid: plan.grid, geometryBudget: plan.geometryBudget,
          fields: Object.fromEntries(Object.entries(plan.fields).map(([field, value]) => [field, { polygons: value.polygons.length,
            rings: value.contours.length, points: value.vertexCount, areaMm2: value.areaMm2,
            sampledCoveragePpm: value.sampledCoveragePpm, coverageErrorPpm: value.coverageErrorPpm }])) })
        time = performance.now(); stage = 'materialize'
        const raw = materializeTerrainComposition(base.document, spec.input, spec.requirements, spec.name, request.preset === 'tidalCoast' ? 'tidal' : 'plain')
        timings.materializeMs = performance.now() - time
        Object.assign(observation, { cost: terrainCommandCost(base.document, raw.document),
          materializedPoints: Object.values(raw.document.terrainAreas).reduce((sum, area) => sum + area.boundaryMm.length, 0),
          terrainAreas: Object.keys(raw.document.terrainAreas).length })
        time = performance.now(); stage = 'prepare'
        const prepared = await prepareTerrainComposition(base, request, { validation, plan,
          runtime: { ids: { nextId: () => `t9-review-identity-${++serial}` }, clock: { now: () => '2026-10-29T00:00:00.000Z' } } })
        timings.prepareMs = performance.now() - time
        const bundle = toBundle(prepared.project), resourceRows = []
        for (const [hash, asset] of Object.entries(bundle.project.assets)) resourceRows.push({ hash, declaredBytes: asset.sizeBytes, actualBytes: (await bundle.resources.read(hash)).length })
        return { ...observation, status: 'passed', cost: prepared.cost, projectHash: projectContentHash(bundle.project),
          projectJsonBytes: new TextEncoder().encode(canonicalJson(bundle.project)).byteLength,
          resources: resourceRows, resourceBytes: resourceRows.reduce((sum, row) => sum + row.actualBytes, 0),
          schemaVersion: bundle.project.schemaVersion, elapsedMs: performance.now() - start }
      } catch (error) {
        return { ...observation, failedStage: stage, error: error instanceof Error ? error.message : String(error), elapsedMs: performance.now() - start }
      }
    }, request)
    report.rows.push(row); await save()
    console.log(`${row.status} ${preset} ${seed} cost=${row.cost?.total ?? 'unavailable'} points=${row.materializedPoints ?? row.geometryBudget?.points ?? 'unavailable'}`)
  }
  for (const preset of presets) {
    const representative = report.rows.find(row => row.request.preset === preset && row.status === 'passed')
    assert(representative, `No successful ${preset} representative; inspect the recorded rejections.`)
    const sample = await page.evaluate(async request => {
      const { createRefinedBlankProject } = await import('/src/platform/browser/content/refined-blank.ts')
      const { prepareTerrainComposition } = await import('/src/application/workspace/terrain-composition.ts')
      const { toBundle } = await import('/src/application/workspace/project.ts')
      const { exportProject, importProject } = await import('/src/shared/project/file.ts')
      const { exportPng } = await import('/src/platform/browser/render/renderer.ts')
      const { validation } = await import('/src/platform/browser/runtime.ts')
      const { ProjectRepository } = await import('/src/platform/browser/storage/repository.ts')
      const { projectContentHash } = await import('/src/shared/project/validate.ts')
      const { readActualPng } = await import('/tests/helpers/m2-joint-browser.ts')
      let serial = 0
      const runtime = { ids: { nextId: () => `t9-review-identity-${++serial}` }, clock: { now: () => '2026-10-29T00:00:00.000Z' } }
      const encode = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text) }
      const base = await createRefinedBlankProject('island', { sceneId: request.sceneId, widthMm: request.widthMm, heightMm: request.heightMm, title: 'T9容量样片', preset: 'narrative', now: '2026-10-29T00:00:00.000Z' })
      const prepared = await prepareTerrainComposition(base, request, { validation, runtime }), bundle = toBundle(prepared.project)
      const hash = projectContentHash(bundle.project), bytes = await exportProject(bundle, validation), imported = await importProject(bytes, validation)
      if (projectContentHash(imported.project) !== hash) throw new Error('T9 complete package hash changed on import')
      const databaseName = `t9-review-${request.preset}-${crypto.randomUUID()}`
      let repository = new ProjectRepository({ name: databaseName, runtime, validation }), coldHash
      try {
        await repository.save(bundle, null); repository.close()
        repository = new ProjectRepository({ name: databaseName, runtime, validation })
        const cold = await repository.load(bundle.project.document.sceneId)
        if (!cold) throw new Error('T9 isolated database cold load returned no project')
        coldHash = projectContentHash(cold.project)
        if (coldHash !== hash) throw new Error('T9 isolated database cold-load hash changed')
      } finally { repository.close(); await repository.database.delete() }
      const pngs = []
      for (const audience of ['gm', 'player']) {
        const blob = await exportPng(imported, { audience, longEdgePx: 1024 }), decoded = await readActualPng(blob)
        if (Math.max(decoded.width, decoded.height) !== 1024 || !decoded.pixels.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('T9 PNG has wrong dimensions or no visible pixels')
        if (/sceneweave-complete-project|generationMetadata/.test(decoded.rawText)) throw new Error('T9 PNG leaked engineering metadata')
        pngs.push({ audience, png: encode(new Uint8Array(await blob.arrayBuffer())), width: decoded.width, height: decoded.height,
          rgbaHash: decoded.rgbaHash, chunks: decoded.chunks, bytes: decoded.bytes })
      }
      return { preset: request.preset, seed: request.seed, hash, coldHash, schemaVersion: imported.project.schemaVersion,
        cost: prepared.cost, package: encode(bytes), packageBytes: bytes.length, pngs, isolatedDatabaseDeleted: true }
    }, representative.request)
    assert.equal(sample.hash, representative.projectHash, 'Representative replay must match its capacity observation.')
    await writeFile(path.join(output, `${preset}.sceneweave`), Buffer.from(sample.package, 'base64')); delete sample.package
    for (const png of sample.pngs) {
      await writeFile(path.join(output, `${preset}-${png.audience}-1024.png`), Buffer.from(png.png, 'base64')); delete png.png
      assert.deepEqual([...new Set(png.chunks)], ['IHDR', 'sRGB', 'IDAT', 'IEND'])
    }
    report.representatives.push(sample); await save(); console.log(`passed representative ${preset}`)
  }
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, [])
  assert.deepEqual(report.failedHttp, []); assert.deepEqual(report.blocked, [])
  const sources = ['src/shared/terrain-generation/composition-presets.ts', 'src/shared/terrain-generation/composition-field.ts',
    'src/shared/terrain-generation/composition-materialize.ts', 'src/shared/terrain-generation/composition-requirements.ts',
    'src/shared/terrain-generation/cost.ts', 'src/application/workspace/terrain-composition.ts',
    'src/platform/browser/terrain-generation/composition-client.ts', 'src/platform/browser/terrain-generation/composition-worker.ts',
    'src/editor/main/TerrainCompositionPanel.tsx', 'tools/testing/terrain-t9-review.mjs']
  report.sources = Object.fromEntries(await Promise.all(sources.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  report.status = report.rows.some(row => row.status === 'rejected') ? 'bounded-rejections' : 'passed'
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1 }
finally { report.finishedAt = new Date().toISOString(); await save(); await browser?.close(); await server?.close() }
