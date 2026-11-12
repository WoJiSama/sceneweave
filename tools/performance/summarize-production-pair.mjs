import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { check, readPackage, comparablePackage, sha, auditPng, summarizePair } from './production-pair-audit.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('node tools/performance/summarize-production-pair.mjs ABS_RESULT_DIRECTORY [--output ABS_NEW_JSON_FILE]')
  console.log('Reopens actual final packages and 4K PNGs, verifies their hashes and actual RGBA and cross-run equality, and derives a diagnostic summary. Refuses incomplete/failed manifests and never repairs old failures into passes. The original input comparison is retained by the runner; this command audits retained final outputs.')
  process.exit(0)
}
const directory = args[0], output = args.includes('--output') ? args[args.indexOf('--output') + 1] : null
check(directory && path.isAbsolute(directory) && (!output || path.isAbsolute(output)), 'Expected absolute paths')
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
check(manifest.format === 'sceneweave-production-single-optimization-pair' && manifest.status === 'complete', 'Only complete pair manifests may be summarized')
check(manifest.runs.length === manifest.pairs * 2 && manifest.runs.every(row => row.status === 'complete'), 'Incomplete pair count')
const safeFile = name => { const file = path.resolve(directory, name); check(file.startsWith(`${directory}${path.sep}`), 'Invalid retained artifact path'); return file }
const comparables = [], pixels = { gm: [], player: [] }
for (const run of manifest.runs) {
  check(run.metrics.samples.length === (manifest.config.historyDepth ?? 2) + 6 && run.metrics.samples.every(row => row.status === 'complete' && row.sample?.intent?.trusted), 'Missing trusted operation samples')
  check(run.metrics.clockGaps.length === 0 && run.metrics.resources.errors.length === 0 && Object.values(run.metrics.audit).every(rows => rows.length === 0), 'Retained clock/resource/product audit failure')
  const data = readPackage(await fs.readFile(safeFile(run.package.file)))
  check(data.sha256 === run.package.sha256 && data.byteLength === run.package.byteLength && sha(JSON.stringify(comparablePackage(data))) === run.package.comparableSha256, 'Final package audit drift')
  comparables.push(run.package.comparableSha256)
  for (const png of run.pngs) {
    const audit = auditPng(await fs.readFile(safeFile(png.file)), data.scene.exportBoundsMm)
    check(isDeepStrictEqual(audit, { width: png.width, height: png.height, rgbaSha256: png.rgbaSha256, sha256: png.sha256, byteLength: png.byteLength, chunks: png.chunks }), 'Actual PNG audit drift')
    check(pixels[png.audience], 'Unexpected audience'); pixels[png.audience].push(audit.rgbaSha256)
  }
}
check(new Set(comparables).size === 1 && Object.values(pixels).every(values => values.length === manifest.runs.length && new Set(values).size === 1), 'Cross-run package/pixel mismatch')
const summary = summarizePair(manifest)
if (output) await fs.writeFile(output, JSON.stringify(summary, null, 2), { flag: 'wx' })
else console.log(JSON.stringify(summary, null, 2))
