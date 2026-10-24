import { createC3ProjectV5, c3ImageBlob } from '../c3-fixtures'
import { createHistoryIdentityV6 } from '../../src/core/v6/identity'
import { prepareCompositionCommandsV5 } from '../../src/io/v5/prepare'
import { sha256Bytes } from '../../src/io/v6/resources'
import { createMemoryResources } from '../../src/shared/project/resources'
import { validateProjectData } from '../../src/shared/project/validate'
import type { AssetRecord, ProjectBundle, ProjectData } from '../../src/shared/model/project'
import type { CompleteProjectV5 } from '../../src/io/v5/types'

/** Small original browser images. No user storage, network asset, or decoder double. */
export async function fixtureImage(type: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png', color?: string): Promise<Uint8Array> {
  if (!color) return new Uint8Array(await (await c3ImageBlob(type)).arrayBuffer())
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
  try {
    const context = canvas.getContext('2d', { colorSpace: 'srgb' })!
    context.fillStyle = color; context.fillRect(0, 0, 8, 8)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Browser fixture encode failed')), type, .95))
    if (blob.type !== type) throw new Error(`Browser did not encode ${type}`)
    return new Uint8Array(await blob.arrayBuffer())
  } finally { canvas.width = canvas.height = 0 }
}

const concatenate = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

/**
 * Chrome adds redundant ICC metadata even to this explicitly sRGB Canvas.
 * Native resources require profile-free static JPEG/WebP. Remove only that
 * encoder profile; retain the actual compressed pixel stream byte for byte.
 */
function profileFreeCanvasBytes(bytes: Uint8Array, type: 'image/jpeg' | 'image/webp'): Uint8Array {
  if (type === 'image/jpeg') {
    const parts = [bytes.subarray(0, 2)]
    let cursor = 2
    while (cursor < bytes.length) {
      if (bytes[cursor] !== 0xff) throw new Error('Unexpected Canvas JPEG marker')
      const marker = bytes[cursor + 1]
      if (marker === 0xda) { parts.push(bytes.subarray(cursor)); return concatenate(parts) }
      const size = bytes[cursor + 2] * 256 + bytes[cursor + 3], end = cursor + size + 2
      if (size < 2 || end > bytes.length) throw new Error('Unexpected Canvas JPEG segment')
      const prefix = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 16))
      if (!(marker === 0xe2 && prefix === 'ICC_PROFILE\0')) parts.push(bytes.subarray(cursor, end))
      cursor = end
    }
    throw new Error('Canvas JPEG has no compressed scan')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [bytes.slice(0, 12)]
  let cursor = 12
  while (cursor < bytes.length) {
    const size = view.getUint32(cursor + 4, true), end = cursor + 8 + size + size % 2
    if (end > bytes.length) throw new Error('Unexpected Canvas WebP chunk')
    const kind = String.fromCharCode(...bytes.subarray(cursor, cursor + 4))
    if (kind !== 'ICCP') {
      const chunk = bytes.slice(cursor, end)
      if (kind === 'VP8X') chunk[8] &= ~0x20
      parts.push(chunk)
    }
    cursor = end
  }
  const result = concatenate(parts); new DataView(result.buffer).setUint32(4, result.length - 8, true)
  return result
}

/** Test-only fixture adaptation. Production legacy conversion belongs to M2-0d. */
async function nativeBundle(legacy: CompleteProjectV5): Promise<ProjectBundle> {
  const bytes: Record<string, Uint8Array> = {}, assets: Record<string, AssetRecord> = {}
  for (const [hash, { blob, ...record }] of Object.entries(legacy.assets)) {
    assets[hash] = record; bytes[hash] = new Uint8Array(await blob.arrayBuffer())
  }
  const project: ProjectData = {
    format: 'sceneweave-complete-project', schemaVersion: 1,
    document: { ...structuredClone(legacy.document), format: 'sceneweave-scene', schemaVersion: 1 },
    historyIdentity: { ...createHistoryIdentityV6(legacy.document), version: 1 }, appearance: structuredClone(legacy.appearance),
    assets, licenses: structuredClone(legacy.licenses), licenseBindings: structuredClone(legacy.licenseBindings), authoringSources: {},
  }
  return { project: validateProjectData(project), resources: createMemoryResources(bytes) }
}

/** Three fixed, licensed definitions keep PNG/JPEG/WebP in the exact closure. */
export async function realImageBundle(): Promise<ProjectBundle> {
  const legacy = await createC3ProjectV5({ title: 'M2-0c actual byte fixture' })
  const source = Object.values(legacy.document.assets)[0], definition = Object.values(legacy.document.propDefinitions)[0]
  const sourceBinding = legacy.licenseBindings.find(binding => binding.subjectKind === 'asset' && binding.subjectId === source.id)!
  for (const [index, mimeType] of (['image/jpeg', 'image/webp'] as const).entries()) {
    const bytes = profileFreeCanvasBytes(await fixtureImage(mimeType), mimeType), sha256 = await sha256Bytes(bytes)
    const assetId = `m20c-format-image-${index}`, definitionId = `m20c-format-definition-${index}`
    legacy.assets[sha256] = { sha256, mimeType, sizeBytes: bytes.length, pixelWidth: 8, pixelHeight: 8, blob: new Blob([bytes.slice().buffer], { type: mimeType }) }
    legacy.document.assets[assetId] = { ...structuredClone(source), id: assetId, sha256, mimeType }
    legacy.document.propDefinitions[definitionId] = { ...structuredClone(definition), id: definitionId, catalogId: definitionId, name: `Original ${mimeType} fixture`,
      defaultAppearance: { ...definition.defaultAppearance, kind: 'image', assetId } }
    legacy.licenseBindings.push({ ...sourceBinding, subjectId: assetId }, { ...sourceBinding, subjectKind: 'propDefinition', subjectId: definitionId })
  }
  return nativeBundle(legacy)
}

/** The old pipeline supplies an independently established real parameter output. */
export async function realDerivedBundle(): Promise<ProjectBundle> {
  const source = await createC3ProjectV5({ title: 'M2-0c actual parameter pixels' })
  const derived = await prepareCompositionCommandsV5(source, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] },
    adjustment: { id: 'm20c-brightness', kind: 'brightness', value: .5, enabled: true } }])
  return nativeBundle(derived)
}

export async function resourceBytes(bundle: ProjectBundle): Promise<Record<string, Uint8Array>> {
  return Object.fromEntries(await Promise.all(Object.keys(bundle.project.assets).map(async hash => [hash, await bundle.resources.read(hash)] as const)))
}

export async function databaseInventory() {
  return (await indexedDB.databases()).map(item => ({ name: item.name, version: item.version })).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}
