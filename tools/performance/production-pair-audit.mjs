import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { unzipSync, unzlibSync } from 'fflate'

export const check = (condition, message) => { if (!condition) throw new Error(message) }
export const sha = bytes => createHash('sha256').update(bytes).digest('hex')
/** A self-comparison must use the same actual source and build bytes. Labels,
 * paths or a caller's description do not establish an A/A control. */
export function assertSameBuildControl(before, after) {
  check(isDeepStrictEqual(before.source, after.source) && isDeepStrictEqual(before.build, after.build),
    'Same-build control requires identical source and build fingerprints')
}
export function readPackage(bytes) {
  const entries = unzipSync(new Uint8Array(bytes))
  const read = name => { check(entries[name], `Missing ${name}`); return JSON.parse(Buffer.from(entries[name]).toString('utf8')) }
  const manifest = read('manifest.json')
  check(manifest.schemaVersion === 1, 'Expected current complete-v1 package')
  const paths = manifest.entries.map(item => item.path)
  check(new Set(paths).size === paths.length && isDeepStrictEqual([...paths, 'manifest.json'].sort(), Object.keys(entries).sort()), 'Package entry set mismatch')
  for (const item of manifest.entries) check(entries[item.path]?.length === item.sizeBytes && sha(entries[item.path]) === item.sha256, `Package entry mismatch: ${item.path}`)
  const scene = read('scene.json')
  check(scene.schemaVersion === 1, 'Expected current scene v1')
  check(manifest.sceneId === scene.sceneId && manifest.revision === scene.revision, 'Package root/revision mismatch')
  return { scene, manifest, entries, sha256: sha(bytes), byteLength: bytes.length }
}
export function comparablePackage(data) {
  const { sceneId, createdAt, updatedAt, ...scene } = data.scene
  const manifest = { ...data.manifest, sceneId: '<local-root>', entries: data.manifest.entries.filter(row => row.path !== 'scene.json') }
  return { scene, manifest, payloads: Object.fromEntries(Object.entries(data.entries)
    .filter(([name]) => !['manifest.json', 'scene.json'].includes(name)).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, sha(bytes)])) }
}
export function assertJourney(source, actual, revisions) {
  check(actual.scene.sceneId !== source.scene.sceneId, 'Import must create a fresh local root')
  check(actual.scene.revision === source.scene.revision + revisions, 'Unexpected exact journey revision')
  const expected = comparablePackage(source)
  expected.scene.revision += revisions
  expected.manifest.revision += revisions
  check(isDeepStrictEqual(expected, comparablePackage(actual)), 'Complete journey changed content beyond expected root, clocks and revision')
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
// Node-only audit after the measured browser exits. Decode all actual RGBA8
// scanlines; IDAT/file hashes alone do not establish equal pixels.
export function auditPng(bytes, bounds) {
  check(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Not a PNG')
  const chunks = [], idat = []; let offset = 8, width, height
  while (offset < bytes.length) {
    check(offset + 12 <= bytes.length, 'Truncated PNG chunk')
    const size = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString('ascii'), end = offset + size + 12
    check(end <= bytes.length && crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG CRC/length mismatch')
    check(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB'].includes(type), `Unexpected metadata ${type}`)
    if (type === 'IHDR') {
      check(offset === 8 && size === 13, 'Invalid IHDR')
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12)
      check(bytes[offset + 16] === 8 && bytes[offset + 17] === 6 && bytes[offset + 18] === 0 && bytes[offset + 19] === 0 && bytes[offset + 20] === 0, 'Expected noninterlaced RGBA8 PNG')
    }
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, end - 4))
    chunks.push(type); offset = end
    if (type === 'IEND') { check(size === 0 && offset === bytes.length, 'Trailing PNG bytes'); break }
  }
  check(chunks.at(-1) === 'IEND', 'Missing IEND')
  const expectedWidth = bounds.width >= bounds.height ? 4096 : Math.round(4096 * bounds.width / bounds.height)
  const expectedHeight = bounds.width >= bounds.height ? Math.round(4096 * bounds.height / bounds.width) : 4096
  check(width === expectedWidth && height === expectedHeight, '4K dimensions/aspect mismatch')
  const raw = unzlibSync(Buffer.concat(idat)), stride = width * 4
  check(raw.length === (stride + 1) * height, 'PNG scanline length mismatch')
  let previous = new Uint8Array(stride), row = new Uint8Array(stride)
  const digest = createHash('sha256')
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1), filter = raw[start]
    check(filter <= 4, 'Unknown PNG filter')
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0, b = previous[x], c = x >= 4 ? previous[x - 4] : 0
      let predictor = 0
      if (filter === 1) predictor = a
      if (filter === 2) predictor = b
      if (filter === 3) predictor = Math.floor((a + b) / 2)
      if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      row[x] = (raw[start + 1 + x] + predictor) & 255
    }
    digest.update(row); [previous, row] = [row, previous]
  }
  return { width, height, rgbaSha256: digest.digest('hex'), sha256: sha(bytes), byteLength: bytes.length, chunks }
}

export function summarizePair(manifest) {
  const groups = manifest.runs.filter(row => row.status === 'complete')
  const phases = [...new Set(groups.flatMap(row => row.metrics.samples.map(sample => sample.kind)))]
  const timings = Object.fromEntries(phases.map(phase => [phase, Object.fromEntries(['before', 'after'].map(side => {
    const values = groups.filter(row => row.side === side).flatMap(row => row.metrics.samples.filter(sample => sample.kind === phase).map(row => row.sample))
    return [side, Object.fromEntries(['intentToDomainCommitMs', 'intentToSavedMs', 'intentToRasterReadyMs', 'intentToDisplayProxyMs'].map(key => [key, values.map(row => row[key])]))]
  }))]))
  return { measurementClass: 'diagnostic-only-no-formal-or-stable-benefit-claim', status: manifest.status,
    expectedRuns: manifest.pairs * 2, completedRuns: groups.length, failedRuns: manifest.runs.filter(row => row.status !== 'complete').length,
    timings, resources: groups.map(row => ({ pair: row.pair, side: row.side, ...row.productResources })),
    equality: manifest.equality ?? null, limitations: manifest.limitations }
}
