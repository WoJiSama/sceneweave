import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const check = (condition, message) => { if (!condition) throw new Error(`Visual-v2 fixture rejected: ${message}`) }
const names = ['study-500', 'study-2000', 'island-500', 'island-2000']

/** Byte/hash and strict container identity checks; the normal native importer fully validates every measured cold import. */
export function inspectVisualV2Fixture(bytes, item) {
  check(bytes.length > 0 && bytes.length <= 100 * 1024 * 1024, 'compressed package budget')
  let total = 0
  const files = unzipSync(bytes, { filter: entry => {
    check(entry.originalSize <= 20 * 1024 * 1024 && (total += entry.originalSize) <= 300 * 1024 * 1024, 'expanded entry/package budget')
    return true
  } })
  const json = name => { check(files[name], `missing ${name}`); return JSON.parse(new TextDecoder().decode(files[name])) }
  const manifest = json('manifest.json'), scene = json('scene.json'), identity = json('identity.json'), sources = json('sources.json')
  check(manifest.format === 'sceneweave-complete-project' && manifest.schemaVersion === 2 && manifest.packageMode === 'complete' && scene.format === 'sceneweave-scene' && scene.schemaVersion === 2 && scene.visual?.version === 1 && identity.version === 1, 'expected complete-v2/scene2/visual1, not a converted legacy package')
  check(scene.sceneId === `performance-visual-v2-${item.name}` && scene.sceneId === manifest.sceneId && scene.revision === 0 && manifest.revision === 0, 'scene identity/revision')
  check(Array.isArray(manifest.entries) && new Set(manifest.entries.map(entry => entry.path)).size === manifest.entries.length && Object.keys(files).length === manifest.entries.length + 1, 'undeclared/missing/duplicate entries')
  for (const entry of manifest.entries) check(files[entry.path]?.length === entry.sizeBytes && hash(files[entry.path]) === entry.sha256, `entry hash/size ${entry.path}`)
  const summary = item.summary, expectedCount = Number(item.name.split('-')[1]), sample = item.name.split('-')[0]
  check(summary?.fixtureVersion === 'visual-v2-refined-load-v1' && summary.sample === sample && summary.propCount === expectedCount && summary.originalPropCount > 0 && summary.addedPropCount + summary.originalPropCount === expectedCount, 'summary identity/count')
  check(Object.keys(scene.props).length === expectedCount && ['x', 'y', 'width', 'height'].every(key => summary.worldBoundsMm?.[key] === scene.exportBoundsMm?.[key]), 'scene count/extent')
  check(JSON.stringify(scene.props[summary.editablePropId]?.positionMm) === JSON.stringify(summary.selectionPointMm) && scene.props[summary.editablePropId].appearance.kind === 'image', 'ordinary editable image marker')
  check(!Object.values(scene.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === summary.editablePropId)) && !Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === summary.editablePropId)), 'marker must be independent')
  for (const [field, key] of Object.entries({ assetReferenceCount: 'assets', materialDefinitionCount: 'materials', propDefinitionCount: 'propDefinitions', prefabDefinitionCount: 'prefabDefinitions', prefabInstanceCount: 'prefabInstances', scatterGroupCount: 'scatterGroups' })) check(summary[field] === Object.keys(scene[key]).length, `summary ${field}`)
  check(summary.sourceCount === Object.keys(sources).length && summary.sourceCount > 0 && summary.curveCount === Object.keys(scene.visual.boundaries).length && summary.edgeLookCount === Object.keys(scene.visual.edgeLooks).length, 'original sources and curve/edge workload')
  const imageRecords = Object.values(manifest.assetRecords)
  check(summary.documentSha256 === hash(files['scene.json']) && summary.authoringSourcesSha256 === hash(files['sources.json'])
    && summary.uniqueImageCount === imageRecords.length && summary.uniqueImagePixels === imageRecords.reduce((n, asset) => n + asset.pixelWidth * asset.pixelHeight, 0)
    && summary.uniqueImageEncodedBytes === imageRecords.reduce((n, asset) => n + asset.sizeBytes, 0) && summary.licenseBindings === manifest.licenseBindings.length, 'actual original source/image/license workload hashes')
  for (const [field, key] of Object.entries({ lightCount: 'lights', fogCount: 'fogs', filterCount: 'filters' })) check(summary[field] === Object.keys(scene.visual[key]).length, `summary ${field}`)
  const curve = scene.visual.boundaries[summary.curveEdit?.boundaryId]
  check(curve && curve.segments[summary.curveEdit.segment]?.[summary.curveEdit.handle] && curve.binding.kind === summary.curveEdit.binding
    && Number.isSafeInteger(summary.curveEdit.expandedWriteCost) && summary.curveEdit.expandedWriteCost > 0 && summary.curveEdit.expandedWriteCost <= 256
    && Array.isArray(summary.curveEdit.expectedAffectedIds) && new Set(summary.curveEdit.expectedAffectedIds).size === summary.curveEdit.expectedAffectedIds.length
    && summary.curveEdit.expectedAffectedIds.includes(curve.id) && summary.curveEdit.expectedChangedIds.includes(curve.id), 'declared exact UI curve edit and actual expanded write budget')
  return { manifest, scene, files }
}

/** Copy exact new complete-v2 bytes. No B5 reader, preservation conversion or package regeneration is used. */
export async function copyVisualV2Fixtures({ sourceDirectory, outputDirectory, requestedCases }) {
  check(path.isAbsolute(sourceDirectory) && path.isAbsolute(outputDirectory), 'absolute fixture/output paths required')
  const source = await fs.realpath(sourceDirectory), destination = await fs.realpath(outputDirectory), relative = path.relative(source, destination)
  check(relative && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'output must be independent from fixture directory')
  const manifestBytes = await fs.readFile(path.join(source, 'manifest.json'))
  check(manifestBytes.length <= 5 * 1024 * 1024, 'fixture manifest exceeds 5MiB')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  check(manifest.format === 'sceneweave-visual-v2-performance-fixtures' && manifest.version === 1 && manifest.status === 'complete' && /^[a-f0-9]{40}$/.test(manifest.sourceRevision) && Array.isArray(manifest.cases) && new Set(manifest.cases.map(item => item.name)).size === manifest.cases.length, 'completed fixture manifest required')
  const copied = []
  for (const name of requestedCases) {
    check(names.includes(name), `unsupported ${name}`)
    const item = manifest.cases.find(item => item.name === name), relativePath = `fixtures/${name}.sceneweave`
    check(item?.artifact?.path === relativePath && /^[a-f0-9]{64}$/.test(item.artifact.sha256), `artifact declaration ${name}`)
    const sourcePath = await fs.realpath(path.join(source, relativePath)); check(sourcePath.startsWith(`${source}${path.sep}`), 'fixture path escapes source')
    const bytes = await fs.readFile(sourcePath)
    check(bytes.length === item.artifact.sizeBytes && hash(bytes) === item.artifact.sha256, `${name} original package hash/size`)
    inspectVisualV2Fixture(bytes, item)
    await fs.mkdir(path.join(destination, 'fixtures'), { recursive: true })
    const target = path.join(destination, relativePath)
    await fs.writeFile(target, bytes, { flag: 'wx' }); check((await fs.readFile(target)).equals(bytes), `${name} disk reread`)
    copied.push({ name, summary: item.summary, artifact: { ...item.artifact }, nativeArtifact: { ...item.artifact }, sourceSummarySha256: hash(JSON.stringify(item.summary)) })
  }
  return { cases: copied, provenance: { mode: 'exact-native-visual-v2-bytes', sourceManifestSha256: hash(manifestBytes), sourceManifestSizeBytes: manifestBytes.length, sourceRevision: manifest.sourceRevision, sourceFinishedAt: manifest.finishedAt,
    verification: 'Exact independent complete-v2 fixture bytes copied and disk-reread with every ZIP entry hash, scene2/visual1 identity, full source/image references, marker and actual workload counts checked. Full normal product package/source/PNG-pixel/license validation occurs during each measured native cold import; no legacy/B5 conversion.' } }
}

async function fingerprint(root, relative = 'src') {
  const records = []
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) records.push(...await fingerprint(root, name))
    else if (entry.isFile()) { const bytes = await fs.readFile(path.join(root, name)); records.push({ path: name, sizeBytes: bytes.length, sha256: hash(bytes) }) }
  }
  return records.sort((a, b) => a.path.localeCompare(b.path))
}

async function main() {
  const args = process.argv.slice(2), argument = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
  if (args.includes('--help')) { console.log('node tools/performance/visual-v2-fixtures.mjs --output ABS_EMPTY [--cases study-500,study-2000,island-500,island-2000] [--channel chrome]'); return }
  const output = argument('--output', null), cases = argument('--cases', names.join(',')).split(','), channel = argument('--channel', 'chrome'), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  check(output && path.isAbsolute(output), '--output ABS_EMPTY required')
  check(cases.length && new Set(cases).size === cases.length && cases.every(name => names.includes(name)), 'unique known cases required')
  try { check((await fs.readdir(output)).length === 0, 'output must be empty') } catch (error) { if (error.code !== 'ENOENT') throw error }
  await fs.mkdir(path.join(output, 'fixtures'), { recursive: true }); await fs.mkdir(path.join(output, 'benchmarks'), { recursive: true })
  const before = await fingerprint(root), manifest = { format: 'sceneweave-visual-v2-performance-fixtures', version: 1, status: 'running', startedAt: new Date().toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceFingerprint: hash(JSON.stringify(before)), source: before,
    method: 'Separate tooling-only Vite/browser. Original Q1/Q2 full SVG/real PNG/license closure is materialized, original benchmarks saved independently, then explicit synthetic independent objects persisted into new fixed complete-v2 packages. Every package is strictly reimported with actual browser pixel validation. No measured product/API, model calls or performance result.', cases: [], benchmarks: [], failures: [] }
  const write = () => fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await write()
  const tooling = await startNativeFixtureTooling({ root }); let browser
  try {
    browser = await chromium.launch({ channel, headless: true }); const page = await browser.newPage(); page.setDefaultTimeout(180_000)
    manifest.browser = browser.version(); const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(tooling.url)
    for (const name of cases) {
      console.log(`Preparing complete-v2 visual fixture ${name}`)
      const prepared = await page.evaluate(async name => { const module = await import('/tools/performance/visual-v2-fixtures-browser.ts'); return module.prepareVisualV2Fixture(name) }, name)
      check(errors.length === 0, 'tooling page emitted errors')
      const bytes = Buffer.from(prepared.fixture.base64, 'base64'), item = { name, summary: prepared.fixture.summary, artifact: { path: `fixtures/${name}.sceneweave`, sizeBytes: bytes.length, sha256: hash(bytes) } }
      check(bytes.length === prepared.fixture.sizeBytes && hash(bytes) === prepared.fixture.sha256, 'serialized fixture bytes differ')
      inspectVisualV2Fixture(bytes, item)
      await fs.writeFile(path.join(output, item.artifact.path), bytes, { flag: 'wx' })
      check((await fs.readFile(path.join(output, item.artifact.path))).equals(bytes), 'fixture disk reread differs')
      const benchmarkBytes = Buffer.from(prepared.benchmark.base64, 'base64'), benchmarkPath = `benchmarks/${name}.sceneweave`
      check(hash(benchmarkBytes) === prepared.benchmark.sha256, 'benchmark preservation hash')
      await fs.writeFile(path.join(output, benchmarkPath), benchmarkBytes, { flag: 'wx' })
      manifest.benchmarks.push({ sample: prepared.benchmark.sample, path: benchmarkPath, sizeBytes: benchmarkBytes.length, sha256: hash(benchmarkBytes) })
      manifest.cases.push(item); await write(); console.log(`Prepared ${name}: ${item.summary.propCount} props, ${item.summary.curveSegmentCount} cubic segments, ${bytes.length} bytes`)
    }
    check(JSON.stringify(await fingerprint(root)) === JSON.stringify(before), 'source changed while preparing fixtures; regenerate after source freeze')
    manifest.sourceUnchangedAfterPreparation = true; manifest.status = 'complete'; manifest.finishedAt = new Date().toISOString(); await write()
  } catch (error) { manifest.status = 'failed'; manifest.failures.push(String(error)); await write(); throw error }
  finally { await browser?.close(); await tooling.close() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
