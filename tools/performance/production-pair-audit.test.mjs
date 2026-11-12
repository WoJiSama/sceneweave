import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync, zlibSync } from 'fflate'
import { sha, readPackage, assertJourney, comparablePackage, auditPng, summarizePair } from './production-pair-audit.mjs'

function project({ sceneId = 'source', revision = 0, secret = 'keep' } = {}) {
  const scene = { schemaVersion: 1, sceneId, revision, createdAt: sceneId, updatedAt: sceneId, props: { private: { secret } } }
  const entries = { 'scene.json': Buffer.from(JSON.stringify(scene)), 'identity.json': Buffer.from('{"birth":"original"}'), 'licenses/license.txt': Buffer.from('original license') }
  const manifest = { schemaVersion: 1, sceneId, revision, entries: Object.entries(entries).map(([path, bytes]) => ({ path, sha256: sha(bytes), sizeBytes: bytes.length })) }
  return zipSync({ ...entries, 'manifest.json': Buffer.from(JSON.stringify(manifest)) })
}
test('full-package comparison permits only the import root/clocks and exact revision count', () => {
  const input = readPackage(project()), result = readPackage(project({ sceneId: 'local', revision: 4 }))
  assertJourney(input, result, 4)
  assert.throws(() => assertJourney(input, result, 3), /revision/)
  assert.throws(() => assertJourney(input, readPackage(project({ sceneId: 'local', revision: 4, secret: 'lost' })), 4), /changed content/)
  result.entries['licenses/license.txt'][0] ^= 1
  assert.throws(() => assertJourney(input, result, 4), /changed content/)
  assert.notDeepEqual(comparablePackage(input), comparablePackage(result))
})
test('package entry set and actual bytes must match the manifest', () => {
  assert.throws(() => readPackage(zipSync({ 'manifest.json': Buffer.from('{"schemaVersion":1,"entries":[]}'), 'unexpected': Buffer.from('x') })), /entry set/)
})
function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0) }; return (value ^ 0xffffffff) >>> 0 }
function chunk(type, data) { const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(type, 4); result.set(data, 8); result.writeUInt32BE(crc(result.subarray(4, -4)), result.length - 4); return result }
function png(filter) {
  const width = 4096, height = 2, stride = width * 4
  const pixels = Buffer.from(Array.from({ length: stride * height }, (_, index) => (index * 37 + Math.floor(index / stride) * 19) % 256))
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0, b = y ? pixels[(y - 1) * stride + x] : 0, c = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const predict = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]
      raw[y * (stride + 1) + x + 1] = (pixels[y * stride + x] - predict) & 255
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return { pixels, bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', Buffer.alloc(0))]) }
}
test('all five PNG filter modes decode to the actual RGBA digest after browser exit', () => {
  const hashes = []
  for (let filter = 0; filter <= 4; filter++) {
    const sample = png(filter), audit = auditPng(sample.bytes, { width: 4096, height: 2 })
    assert.equal(audit.rgbaSha256, sha(sample.pixels)); hashes.push(audit.rgbaSha256)
  }
  assert.equal(new Set(hashes).size, 1)
  const corrupt = png(0).bytes; corrupt[40] ^= 1
  assert.throws(() => auditPng(corrupt, { width: 4096, height: 2 }), /CRC/)
  assert.throws(() => auditPng(png(0).bytes, { width: 1, height: 1 }), /dimensions/)
})
test('a failed pair remains incomplete and missing resource values are not converted to zero', () => {
  const summary = summarizePair({ pairs: 1, status: 'failed', runs: [{ status: 'failed' }], limitations: ['RSS unavailable'] })
  assert.equal(summary.completedRuns, 0); assert.equal(summary.failedRuns, 1); assert.equal(summary.equality, null)
  assert.deepEqual(summary.resources, [])
})
