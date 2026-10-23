import type { PointMm, SurfaceStyle } from '../src/core/v2/types'
import { migrateSceneV2 } from '../src/core/v3/migration'
import { sha256Bytes } from '../src/io/v2/resources'
import { imageProject } from '../src/io/v2/test-fixtures'
import type { CompleteProjectV3 } from '../src/io/v3/types'

export const C4_ROAD_LAYER = 'c4-road-layer'
export const C4_PRIVATE_ASSET = 'c4-private-texture'
export const c4Rect = (x: number, y: number, width: number, height: number): PointMm[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]

/** Original opaque test artwork, encoded by the real browser, with no decoder substitute. */
async function texture(colors: [string, string]): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16
  try {
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, 16, 16)
    ctx.fillStyle = colors[1]; ctx.fillRect(0, 0, 5, 16); ctx.fillRect(8, 0, 8, 5); ctx.fillRect(5, 11, 6, 5)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('C4 test texture encode failed')), 'image/png'))
  } finally { canvas.width = canvas.height = 0 }
}

/** The public reference is independently constructed without any private entities or assets. */
export async function createC4RenderProject(options: { includePrivate?: boolean; includeLabel?: boolean } = {}): Promise<CompleteProjectV3> {
  const project = await imageProject(), scene = project.document
  scene.title = 'C4 original browser road fixture'
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.props = {}; scene.notes = {}; scene.regions = {}
  scene.paths = {}; scene.terrainAreas = {}; scene.terrainEdges = {}; scene.terrainConnections = {}; scene.prefabInstances = {}; scene.scatterGroups = {}
  scene.constraints.entranceOpeningIds = []; scene.constraints.pathChecks = []; scene.units.gridVisible = false
  scene.exportBoundsMm = { x: 0, y: 0, width: 10000, height: 8000 }; scene.floors['f-a1'].boundsMm = { ...scene.exportBoundsMm }
  scene.assets = {}; scene.materials = {}; project.assets = {}; project.licenseBindings = []
  const license = Object.values(project.licenses)[0], licenseRef = 'test-original-cc0'
  const origin = { kind: 'original' as const, attribution: 'Sceneweave original C4 browser fixture', canEmbed: true }
  const addMaterial = async (id: string, colors: [string, string]) => {
    const blob = await texture(colors), sha256 = await sha256Bytes(new Uint8Array(await blob.arrayBuffer())), assetId = `${id}-texture`
    scene.assets[assetId] = { id: assetId, sha256, mimeType: 'image/png', pixelWidth: 16, pixelHeight: 16,
      logicalSizeMm: { width: 1000, height: 1000 }, licenseRef, origin }
    project.assets[sha256] = { sha256, blob, mimeType: 'image/png', sizeBytes: blob.size, pixelWidth: 16, pixelHeight: 16 }
    scene.materials[id] = { id, catalogId: `test.${id}`, version: 1, licenseRef, origin, name: `Original ${id}`, tags: ['C4', 'original'],
      textureAssetId: assetId, defaultTileSizeMm: { width: 700, height: 1100 }, applicableSurfaces: ['path'] }
    for (const [subjectKind, subjectId] of [['asset', assetId], ['material', id]] as const) project.licenseBindings.push({
      subjectKind, subjectId, licenseRef, licensePath: `licenses/${license.sha256}.txt`, embedding: 'allowed',
    })
  }
  await addMaterial('c4-base', ['#A46039', '#D9BD78'])
  await addMaterial('c4-overlay', ['#3B6B48', '#9BB556'])
  const style: SurfaceStyle = {
    base: { materialRef: { id: 'c4-base', version: 1 }, tileSizeMm: { width: 700, height: 1100 }, rotationDeg: 35,
      alignment: 'world', originMm: { x: -200, y: 125 }, opacity: 1, tint: null },
    overlays: [{ id: 'c4-road-overlay', boundaryMm: c4Rect(3000, 1500, 1500, 1000), blendWidthMm: 120, renderOrder: 0,
      paint: { materialRef: { id: 'c4-overlay', version: 1 }, tileSizeMm: { width: 900, height: 600 }, rotationDeg: 340,
        alignment: 'world', originMm: { x: 50, y: -100 }, opacity: .75, tint: null } }],
  }
  scene.paths['c4-road'] = { id: 'c4-road', floorId: 'f-a1', editLocked: false, visibility: 'public',
    centerlineMm: [{ x: 2000, y: 2000 }, { x: 7500, y: 2000 }, { x: 7500, y: 6000 }, { x: 2000, y: 6000 }], widthMm: 1000,
    supportRefs: [{ kind: 'floor', id: 'f-a1' }], surfaceStyle: style, movementCostMultiplier: 1, renderOrder: 0 }
  if (options.includeLabel !== false) scene.notes['c4-road-label'] = { id: 'c4-road-label', floorId: 'f-a1', editLocked: false,
    visibility: 'public', kind: 'label', text: 'U PATH', anchor: { type: 'entity', entityKind: 'path', entityId: 'c4-road' } }
  // The fixed mask is also present in the independent public reference.
  scene.regions['c4-private-mask'] = { id: 'c4-private-mask', floorId: 'f-a1', editLocked: false, kind: 'manualMask', visibility: 'gm',
    boundaryMm: c4Rect(3000, 3000, 3300, 2000), blocksMovement: false, movementCostMultiplier: 1 }
  if (options.includePrivate !== false) {
    await addMaterial('c4-private', ['#236B89', '#79DEDC'])
    const secretStyle = structuredClone(style); secretStyle.base.materialRef = { id: 'c4-private', version: 1 }; secretStyle.overlays = []
    scene.paths['c4-private-road'] = { id: 'c4-private-road', floorId: 'f-a1', editLocked: false, visibility: 'gm',
      centerlineMm: [{ x: 3600, y: 3600 }, { x: 5600, y: 3600 }, { x: 5600, y: 4300 }], widthMm: 400,
      supportRefs: [{ kind: 'floor', id: 'f-a1' }], surfaceStyle: secretStyle, movementCostMultiplier: 1, renderOrder: 1 }
    scene.notes['c4-private-label'] = { id: 'c4-private-label', floorId: 'f-a1', editLocked: false, visibility: 'public', kind: 'label',
      text: 'C4_PRIVATE_PATH_LABEL', anchor: { type: 'entity', entityKind: 'path', entityId: 'c4-private-road' } }
    scene.notes['c4-private-nested'] = { id: 'c4-private-nested', floorId: 'f-a1', editLocked: false, visibility: 'public', kind: 'label',
      text: 'C4_PRIVATE_NESTED_LABEL', anchor: { type: 'entity', entityKind: 'note', entityId: 'c4-private-label' } }
  }
  const document = migrateSceneV2(scene, { sceneId: 'c4-browser-road-copy', now: '2026-10-22T00:00:00.000Z' })
  document.userLayers[C4_ROAD_LAYER] = { id: C4_ROAD_LAYER, floorId: 'f-a1', name: 'C4 road layer', order: 1, editLocked: false }
  for (const id of Object.keys(document.paths)) document.entityLayers[id] = C4_ROAD_LAYER
  return { document, assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings }
}

export async function c4Hash(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
}
export interface C4Pixels { width: number; height: number; hash: string }
export async function c4Pixels(canvas: HTMLCanvasElement): Promise<C4Pixels> {
  try {
    const data = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data
    return { width: canvas.width, height: canvas.height, hash: await c4Hash(data.buffer) }
  } finally { canvas.width = canvas.height = 0 }
}
export async function c4PngPixels(blob: Blob): Promise<C4Pixels> {
  const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
  try { canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d', { colorSpace: 'srgb' })!.drawImage(bitmap, 0, 0) }
  finally { bitmap.close() }
  return c4Pixels(canvas)
}
export async function c4PngMetadata(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), chunks: string[] = []
  for (let offset = 8; offset < bytes.length;) {
    const size = view.getUint32(offset, false); chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset += size + 12
  }
  const text = new TextDecoder('latin1').decode(bytes)
  return { byteLength: bytes.length, chunks, privateMarkers: ['C4_PRIVATE_PATH_LABEL', 'C4_PRIVATE_NESTED_LABEL', 'c4-private-road', C4_PRIVATE_ASSET].filter(marker => text.includes(marker)) }
}
export function c4DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) })
}
