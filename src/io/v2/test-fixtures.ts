import { zlibSync } from 'fflate'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { crc32 } from './limits'
import { sha256Bytes } from './resources'
import type { AssetBlobRecord, CompleteProjectV2 } from './types'

export function pngChunk(name: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  result.set(new TextEncoder().encode(name), 4); result.set(data, 8)
  view.setUint32(result.length - 4, crc32(result.subarray(4, result.length - 4)))
  return result
}
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
/** An original 1x1 RGBA PNG. The Node tests stub browser decode, not bytes or hashes. */
export function pixelPng(extra: Uint8Array[] = [], width = 1, height = 1): Uint8Array {
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6
  return concatBytes([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), ...extra,
    pngChunk('IDAT', zlibSync(new Uint8Array([0, 20, 50, 80, 200]))), pngChunk('IEND', new Uint8Array())])
}
export function emptyProject(): CompleteProjectV2 {
  return { document: migrateSceneV1(createHouse('package-source'), { sceneId: 'package-v2', now: '2026-10-20T00:00:00.000Z' }), assets: {}, licenses: {}, licenseBindings: [] }
}
export async function imageRecord(bytes = pixelPng()): Promise<AssetBlobRecord> {
  const sha256 = await sha256Bytes(bytes)
  return { sha256, blob: new Blob([bytes.slice().buffer], { type: 'image/png' }), mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 }
}
export async function imageProject(): Promise<CompleteProjectV2> {
  const project = emptyProject(), image = await imageRecord()
  const text = 'Sceneweave original test pixel and material. CC0-1.0.'
  const sha256 = await sha256Bytes(new TextEncoder().encode(text)), licenseRef = 'test-original-cc0'
  const origin = { kind: 'original' as const, attribution: 'Sceneweave test fixture', canEmbed: true }
  project.document.assets['test-image'] = { id: 'test-image', sha256: image.sha256, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 1000, height: 1000 }, licenseRef, origin }
  project.document.materials['test-material'] = { id: 'test-material', catalogId: 'test.material', version: 1, licenseRef, origin, name: 'Original pixel', tags: [], textureAssetId: 'test-image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
  project.assets[image.sha256] = image
  project.licenses[sha256] = { sha256, text }
  project.licenseBindings = [
    { subjectKind: 'asset', subjectId: 'test-image', licenseRef, licensePath: `licenses/${sha256}.txt`, embedding: 'allowed' },
    { subjectKind: 'material', subjectId: 'test-material', licenseRef, licensePath: `licenses/${sha256}.txt`, embedding: 'allowed' },
  ]
  return project
}
