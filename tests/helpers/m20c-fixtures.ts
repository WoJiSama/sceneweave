import { emptyProject, fixtureRuntime } from './current-project-fixtures.js'
import { fromBundle, toBundle } from '../../src/application/workspace/project.js'
import { prepareAssetImport, prepareCompositionCommands } from '../../src/application/workspace/prepare.js'
import { createBrowserImagePort } from '../../src/platform/browser/images/index.js'
import { sha256Bytes } from '../../src/shared/project/binary.js'
import { createMemoryResources } from '../../src/shared/project/resources.js'
import { validateProjectData } from '../../src/shared/project/validate.js'
import type { ProjectBundle } from '../../src/shared/model/project.js'

/** Small original browser images. No user storage, network asset, or decoder double. */
export async function fixtureImage(type: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png', color?: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
  try {
    const context = canvas.getContext('2d', { colorSpace: 'srgb' })!
    context.fillStyle = color ?? 'rgb(200,100,50)'; context.fillRect(0, 0, 8, 8)
    if (!color) {
      context.clearRect(0, 0, 2, 8); context.clearRect(6, 0, 2, 8)
      context.fillStyle = 'rgba(100,200,50,0.5)'; context.fillRect(6, 0, 2, 8)
    }
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

async function pngProject(title: string) {
  const bundle = emptyProject(), runtime = fixtureRuntime(), validation = { images: createBrowserImagePort() }
  bundle.project.document.title = title
  bundle.project.document.sceneId = crypto.randomUUID()
  bundle.project.historyIdentity.rootSceneId = bundle.project.document.sceneId
  const source = await fromBundle(bundle, validation), bytes = await fixtureImage()
  const imported = await prepareAssetImport(source, { file: new Blob([bytes.slice().buffer], { type: 'image/png' }), name: '原创测试叶片', kind: 'prop',
    widthMm: 1400, heightMm: 1400, footprintWidthMm: 1000, footprintHeightMm: 1000, blocksMovement: false, blocksSight: false,
    licenseText: 'CC0-1.0. Original Sceneweave test artwork.', attribution: 'Sceneweave browser fixture', canEmbed: true }, { validation, runtime })
  const definition = Object.values(imported.document.propDefinitions)[0]
  const project = await prepareCompositionCommands(imported, ['c3-left', 'c3-right', 'c3-secret'].map((id, index) => ({ type: 'addProp', id,
    floorId: 'blank-floor', layerId: 'layer-default-0', definitionRef: { id: definition.id, version: 1 }, positionMm: { x: 4000 + index * 2000, y: 4000 },
    supportRef: { kind: 'floor', id: 'blank-floor' } })), { validation, runtime })
  return { project, runtime, validation }
}

/** Three original encoded image types with complete fixed-resource bindings. */
export async function realImageBundle(): Promise<ProjectBundle> {
  const { project: initial } = await pngProject('Actual image formats'), bundle = toBundle(initial)
  const project = structuredClone(bundle.project), document = project.document
  document.props['c3-secret'].visibility = 'gm'
  document.regions['c3-private-mask'] = { id: 'c3-private-mask', floorId: 'blank-floor', editLocked: false, kind: 'manualMask',
    visibility: 'gm', boundaryMm: [{ x: 7000, y: 1000 }, { x: 12000, y: 1000 }, { x: 12000, y: 7500 }, { x: 7000, y: 7500 }],
    blocksMovement: false, movementCostMultiplier: 1 }
  document.entityLayers['c3-private-mask'] = 'layer-default-0'
  const source = Object.values(document.assets)[0], definition = Object.values(document.propDefinitions)[0]
  const sourceBinding = project.licenseBindings.find(binding => binding.subjectKind === 'asset' && binding.subjectId === source.id)!
  const resources = await resourceBytes(bundle)
  for (const [index, mimeType] of (['image/jpeg', 'image/webp'] as const).entries()) {
    const bytes = profileFreeCanvasBytes(await fixtureImage(mimeType), mimeType), sha256 = sha256Bytes(bytes)
    const assetId = 'format-image-' + index, definitionId = 'format-definition-' + index
    resources[sha256] = bytes
    project.assets[sha256] = { sha256, mimeType, sizeBytes: bytes.length, pixelWidth: 8, pixelHeight: 8 }
    document.assets[assetId] = { ...source, id: assetId, sha256, mimeType }
    document.propDefinitions[definitionId] = { ...definition, id: definitionId, catalogId: definitionId, name: 'Original ' + mimeType + ' fixture',
      defaultAppearance: { ...definition.defaultAppearance, kind: 'image', assetId } }
    project.licenseBindings.push({ ...sourceBinding, subjectId: assetId }, { ...sourceBinding, subjectKind: 'propDefinition', subjectId: definitionId })
  }
  return { project: validateProjectData(project), resources: createMemoryResources(resources) }
}

export async function realDerivedBundle(): Promise<ProjectBundle> {
  const { project, runtime, validation } = await pngProject('Actual parameter pixels')
  return toBundle(await prepareCompositionCommands(project, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] },
    adjustment: { id: 'brightness', kind: 'brightness', value: .5, enabled: true } }], { runtime, validation }))
}

export async function resourceBytes(bundle: ProjectBundle): Promise<Record<string, Uint8Array>> {
  return Object.fromEntries(await Promise.all(Object.keys(bundle.project.assets).map(async hash => [hash, await bundle.resources.read(hash)] as const)))
}

export async function databaseInventory() {
  return (await indexedDB.databases()).map(item => ({ name: item.name, version: item.version })).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}
