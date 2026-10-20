import { createStudyProject, STUDY_IDS } from '../src/editor/v2/study-sample'
import { createIslandProject, ISLAND_IDS } from '../src/editor/v2/island-sample'
import { validateSceneV2 } from '../src/core/v2/schema'
import type { Appearance, PointMm, PrefabDefinition, PropTemplate, PropV2, SceneDocumentV2, SurfaceRef, TerrainArea } from '../src/core/v2/types'
import type { CompleteProjectV2 } from '../src/io/v2/types'
import { projectSceneV2 } from '../src/render/v2/projection'
import { exportPngV2, renderProjectV2 } from '../src/render/v2/renderer'

export type PrivacyCaseB4 = 'VIS-01-S01' | 'VIS-02-S01' | 'VIS-02-S02'
type Variant = 'a' | 'b'
const stamp = '2026-10-20T00:00:00.000Z'
const rectangle = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const hashBytes = async (bytes: ArrayBuffer | Uint8ClampedArray<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
const sourceMarker = (variant: Variant) => `PRIVATE-SOURCE-PROMPT-B4-${variant.toUpperCase()}`

export interface PrivacyPairB4 {
  name: PrivacyCaseB4
  a: CompleteProjectV2
  b: CompleteProjectV2
  secretAssetIds: string[]
  originalPropIds: string[]
  publicRelocations: { id: string; from: PointMm; to: PointMm; reason: string }[]
  sentinelStrings: string[]
}

function bind(project: CompleteProjectV2, kind: 'asset' | 'material' | 'propDefinition' | 'prefabDefinition', id: string) {
  const original = project.licenseBindings.find(item => item.licenseRef === 'MIT')
  if (!original) throw new Error('隐私副本需要原样板 MIT 许可文本。')
  project.licenseBindings.push({ ...original, subjectKind: kind, subjectId: id })
}

async function secretRaster(project: CompleteProjectV2, id: string, variant: Variant, texture: boolean) {
  const image = document.createElement('canvas')
  image.width = variant === 'a' ? 64 : 96; image.height = variant === 'a' ? 64 : 48
  const ctx = image.getContext('2d')!
  if (texture) {
    ctx.fillStyle = variant === 'a' ? '#A15E42' : '#476C9C'; ctx.fillRect(0, 0, image.width, image.height)
    ctx.fillStyle = variant === 'a' ? '#E4B879' : '#9AC0B8'
    for (let x = 0; x < image.width; x += 12) ctx.fillRect(x, 0, 5, image.height)
  } else {
    ctx.fillStyle = variant === 'a' ? '#C47A41' : '#435A9F'; ctx.fillRect(7, 9, image.width - 18, image.height - 20)
    ctx.clearRect(17, 16, 11, 13); ctx.fillStyle = '#E7D3A2'; ctx.fillRect(image.width / 2, 17, 9, image.height - 25)
  }
  const blob = await new Promise<Blob>((resolve, reject) => image.toBlob(value => value ? resolve(value) : reject(new Error('隐私测试位图编码失败。')), 'image/png'))
  const pixelWidth = image.width, pixelHeight = image.height; image.width = image.height = 0
  const sha256 = await hashBytes(await blob.arrayBuffer())
  const first = Object.values(project.document.assets)[0]
  project.document.assets[id] = { ...first, id, sha256, pixelWidth, pixelHeight, logicalSizeMm: { width: 1000, height: 1000 }, origin: { kind: 'original', attribution: sourceMarker(variant), canEmbed: true } }
  project.assets[sha256] = { sha256, blob, pixelWidth, pixelHeight, mimeType: 'image/png', sizeBytes: blob.size }
  bind(project, 'asset', id)
}

function smallProp(id: string, floorId: string, supportRef: SurfaceRef, positionMm: PointMm, appearance: Appearance, variant: Variant): PropV2 {
  return { id, floorId, editLocked: false, definitionRef: { id: 'b4-private-prop-definition', version: 1 }, appearance: structuredClone(appearance),
    positionMm, rotationDeg: variant === 'a' ? 0 : 47, visualBoundsMm: { x: -180, y: -130, width: 360, height: 260 },
    footprintMm: { width: 120, height: 100 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false,
    visibility: 'gm', supportRef: { ...supportRef }, renderLayer: 'object', renderOrder: 40, shadowClass: 'furniture',
    shadowOverride: { directionDeg: 45, offsetMm: variant === 'a' ? 60 : 120, blurMm: variant === 'a' ? 20 : 30, opacity: variant === 'a' ? .3 : .45, color: '#24313A' } }
}

function template(prop: PropV2): PropTemplate {
  const { definitionRef, appearance, positionMm, rotationDeg, visualBoundsMm, footprintMm, footprintOffsetMm, blocksMovement, blocksSight, renderLayer, renderOrder, shadowClass, shadowOverride } = prop
  return structuredClone({ definitionRef, appearance, positionMm, rotationDeg, visualBoundsMm, footprintMm, footprintOffsetMm, blocksMovement, blocksSight, renderLayer, renderOrder, shadowClass, shadowOverride })
}

function addPrefab(project: CompleteProjectV2, id: string, props: PropV2[], visibility: 'public' | 'gm') {
  const scene = project.document, definitionId = `${id}-definition`
  const definition: PrefabDefinition = { id: definitionId, catalogId: definitionId, version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'B4 original privacy fixture', canEmbed: true }, name: id, tags: [], members: props.map((prop, i) => ({ key: `member-${i}`, propTemplate: template(prop) })) }
  scene.prefabDefinitions[definitionId] = definition; bind(project, 'prefabDefinition', definitionId)
  scene.prefabInstances[id] = { id, floorId: props[0].floorId, editLocked: false, visibility, definitionRef: { id: definitionId, version: 1 }, anchorMm: { ...props[0].positionMm }, rotationDeg: 0, members: {} }
  for (const [i, prop] of props.entries()) { scene.props[prop.id] = prop; scene.prefabInstances[id].members[`member-${i}`] = { propId: prop.id, overrideFields: [] } }
}

function hiddenNotes(scene: SceneDocumentV2, floorId: string, variant: Variant) {
  scene.notes['b4-secret-note'] = { id: 'b4-secret-note', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: 'b4-secret-object' }, kind: 'clue', title: `SECRET-B4-${variant.toUpperCase()}`, text: `${sourceMarker(variant)} private notes only`, visibility: 'gm' }
  scene.notes['b4-dependent-public-note'] = { id: 'b4-dependent-public-note', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prefabInstance', entityId: 'b4-hidden-prefab' }, kind: 'label', text: `SECRET-DEP-${variant}`, visibility: 'public' }
  scene.notes['b4-nested-public-note'] = { id: 'b4-nested-public-note', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'note', entityId: 'b4-dependent-public-note' }, kind: 'label', text: `SECRET-NESTED-${variant}`, visibility: 'public' }
  scene.generationMetadata = { generatorVersion: 'b4-privacy-fixture-v1', seed: `PRIVATE-SEED-${variant}`, summary: sourceMarker(variant), adoptedAt: stamp }
}

function addPrivateMaterial(project: CompleteProjectV2, textureId: string, variant: Variant) {
  const id = 'b4-private-material', scene = project.document
  scene.materials[id] = { id, catalogId: id, version: 1, name: sourceMarker(variant), tags: ['private'], licenseRef: 'MIT', origin: { kind: 'original', attribution: sourceMarker(variant), canEmbed: true }, textureAssetId: textureId, defaultTileSizeMm: { width: 500, height: 500 }, applicableSurfaces: ['terrain', 'wall'] }
  bind(project, 'material', id)
  return { base: { materialRef: { id, version: 1 }, tileSizeMm: { width: 500, height: 500 }, rotationDeg: variant === 'a' ? 0 : 90, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
}

function addStudyPrivateGeometry(project: CompleteProjectV2, variant: Variant) {
  const scene = project.document, floorId = STUDY_IDS.floor, support = { kind: 'room' as const, id: STUDY_IDS.room }, appearance: Appearance = { kind: 'image', assetId: 'b4-private-object-image', opacity: 1, tint: null }
  scene.regions['b4-fixed-mask'] = { id: 'b4-fixed-mask', floorId, editLocked: false, boundaryMm: rectangle(1800, 1400, 2400, 2600), kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
  scene.props['b4-secret-object'] = smallProp('b4-secret-object', floorId, support, variant === 'a' ? { x: 3000, y: 2800 } : { x: 3250, y: 2860 }, appearance, variant)
  const members = [smallProp('b4-inherited-member-0', floorId, support, { x: 2670, y: 2200 }, appearance, variant), smallProp('b4-inherited-member-1', floorId, support, { x: 3310, y: 2200 }, appearance, variant)]
  members.forEach(prop => { prop.visibility = 'public' }); addPrefab(project, 'b4-hidden-prefab', members, 'gm')
  addPrefab(project, 'b4-public-prefab', [smallProp('b4-private-member', floorId, support, { x: 3590, y: 3260 }, appearance, variant)], 'public')
  for (const [i, x] of [2700, 3250].entries()) scene.vertices[`b4-private-wall-v${i}`] = { id: `b4-private-wall-v${i}`, floorId, editLocked: false, xMm: x, yMm: 3350 }
  scene.walls['b4-private-wall'] = { id: 'b4-private-wall', floorId, editLocked: false, startVertexId: 'b4-private-wall-v0', endVertexId: 'b4-private-wall-v1', thicknessMm: 60, blocksMovement: false, blocksSight: false, topStyle: addPrivateMaterial(project, 'b4-private-texture-image', variant) }
  hiddenNotes(scene, floorId, variant)
}

function addIslandPrivateGeometry(project: CompleteProjectV2, variant: Variant, plateau: boolean) {
  const scene = project.document, floorId = ISLAND_IDS.floor, support = { kind: 'terrainArea' as const, id: ISLAND_IDS.high }, appearance: Appearance = { kind: 'image', assetId: 'b4-private-object-image', opacity: 1, tint: null }
  scene.regions['b4-fixed-mask'] = { id: 'b4-fixed-mask', floorId, editLocked: false, boundaryMm: rectangle(19000, 7000, 5500, 5000), kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
  scene.props['b4-secret-object'] = smallProp('b4-secret-object', floorId, plateau ? { kind: 'terrainArea', id: 'b4-private-plateau' } : support, variant === 'a' ? { x: 21200, y: 9400 } : { x: 21600, y: 9700 }, appearance, variant)
  const members = [smallProp('b4-inherited-member-0', floorId, support, { x: 22900, y: 9300 }, appearance, variant), smallProp('b4-inherited-member-1', floorId, support, { x: 23000, y: 10000 }, appearance, variant)]
  members.forEach(prop => { prop.visibility = 'public' }); addPrefab(project, 'b4-hidden-prefab', members, 'gm')
  addPrefab(project, 'b4-public-prefab', [smallProp('b4-private-member', floorId, support, { x: 23100, y: 10800 }, appearance, variant)], 'public')
  const scatter = structuredClone(scene.scatterGroups[ISLAND_IDS.scatterTrees]), scatterProp = smallProp('b4-inherited-scatter', floorId, support, { x: 22000, y: 11300 }, appearance, variant)
  scatterProp.visibility = 'public'; scene.props[scatterProp.id] = scatterProp
  scatter.id = 'b4-hidden-scatter'; scatter.visibility = 'gm'; scatter.seed = `PRIVATE-SCATTER-${variant}`; scatter.densityFactor = variant === 'a' ? .1 : .95
  scatter.exclusions = []
  scatter.palette = [{ key: 'private-prop', propDefinitionRef: { id: 'b4-private-prop-definition', version: 1 }, weight: 1 }]
  scatter.members = { ['a'.repeat(64)]: { propId: scatterProp.id, state: variant === 'a' ? 'managed' : 'manual', overrideFields: variant === 'a' ? [] : ['positionMm', 'appearance'] } }
  scene.scatterGroups[scatter.id] = scatter
  const style = addPrivateMaterial(project, 'b4-private-texture-image', variant)
  if (plateau) {
    const positions = variant === 'a' ? rectangle(20500, 8500, 1500, 2000) : [{ x: 20700, y: 8700 }, { x: 22400, y: 8600 }, { x: 22300, y: 10700 }, { x: 20500, y: 10400 }]
    const area: TerrainArea = { ...structuredClone(scene.terrainAreas[ISLAND_IDS.high]), id: 'b4-private-plateau', visibility: 'gm', groundElevationMm: variant === 'a' ? 3500 : 4300, coveragePriority: variant === 'a' ? 20 : 25, surfaceStyle: style,
      boundaryMm: positions.map((positionMm, i) => ({ id: `b4-private-plateau-v${i}`, segmentId: `b4-private-plateau-s${i}`, positionMm })) }
    scene.terrainAreas[area.id] = area
    scene.terrainEdges['b4-private-edge'] = { id: 'b4-private-edge', floorId, editLocked: false, visibility: 'gm', source: { areaId: area.id, segmentId: area.boundaryMm[0].segmentId }, neighborAreaId: ISLAND_IDS.high, kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: structuredClone(style), styleOverride: { strokeWidthMm: variant === 'a' ? 20 : 35, color: variant === 'a' ? '#54482C' : '#38526C', bandWidthMm: variant === 'a' ? 200 : 300 } }
  } else {
    // A small independent masked wall exercises a private material without changing public terrain/support.
    for (const [i, x] of [21600, 22200].entries()) scene.vertices[`b4-private-wall-v${i}`] = { id: `b4-private-wall-v${i}`, floorId, editLocked: false, xMm: x, yMm: 10800 }
    scene.walls['b4-private-wall'] = { id: 'b4-private-wall', floorId, editLocked: false, startVertexId: 'b4-private-wall-v0', endVertexId: 'b4-private-wall-v1', thicknessMm: 60, blocksMovement: false, blocksSight: false, topStyle: style }
  }
  hiddenNotes(scene, floorId, variant)
}

/** Explicit QA copies only. The production samples and their original 13/39 props remain intact. */
export async function createPrivacyPairB4(name: PrivacyCaseB4): Promise<PrivacyPairB4> {
  const original = await (name === 'VIS-01-S01' ? createStudyProject() : createIslandProject()), originalPropIds = Object.keys(original.document.props), publicRelocations: PrivacyPairB4['publicRelocations'] = []
  if (name === 'VIS-02-S02') {
    const tree = Object.values(original.document.props).find(prop => prop.positionMm.x === 20277 && prop.positionMm.y === 10303)
    if (!tree) throw new Error('S02 需要已记录的公开树摆位；不可隐式删除全部散布。')
    const from = { ...tree.positionMm }, to = { x: 19800, y: 10303 }; tree.positionMm = to
    publicRelocations.push({ id: tree.id, from, to, reason: '固定移动477mm，使公开树完整占地避开A/B私密小台地；两份公开布局相同，保留39件原实例。' })
  }
  const variants: Partial<Record<Variant, CompleteProjectV2>> = {}
  for (const variant of ['a', 'b'] as const) {
    const project: CompleteProjectV2 = { ...original, document: structuredClone(original.document), assets: { ...original.assets }, licenses: { ...original.licenses }, licenseBindings: structuredClone(original.licenseBindings) }
    project.document.sceneId = `b4-${name.toLowerCase()}-privacy-pair`; project.document.revision = 41; project.document.createdAt = stamp; project.document.updatedAt = stamp
    await secretRaster(project, 'b4-private-object-image', variant, false); await secretRaster(project, 'b4-private-texture-image', variant, true)
    project.document.propDefinitions['b4-private-prop-definition'] = { id: 'b4-private-prop-definition', catalogId: 'b4-private-prop-definition', version: 1, name: sourceMarker(variant), tags: [], licenseRef: 'MIT', origin: { kind: 'original', attribution: sourceMarker(variant), canEmbed: true },
      defaultAppearance: { kind: 'image', assetId: 'b4-private-object-image', opacity: 1, tint: null }, defaultVisualBoundsMm: { x: -180, y: -130, width: 360, height: 260 }, defaultFootprintMm: { width: 120, height: 100 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'furniture' }
    bind(project, 'propDefinition', 'b4-private-prop-definition')
    if (name === 'VIS-01-S01') addStudyPrivateGeometry(project, variant)
    else addIslandPrivateGeometry(project, variant, name === 'VIS-02-S02')
    const checked = validateSceneV2(project.document)
    if (!checked.ok) throw new Error(`${name}/${variant}: ${checked.errors.map(issue => `${issue.code} ${issue.entityId ?? ''}: ${issue.message}`).join('; ')}`)
    project.document = checked.document; variants[variant] = project
  }
  return { name, a: variants.a!, b: variants.b!, originalPropIds, publicRelocations, secretAssetIds: ['b4-private-object-image', 'b4-private-texture-image'], sentinelStrings: ['PRIVATE-SOURCE-PROMPT-B4-', 'SECRET-B4-', 'PRIVATE-SEED-', 'SECRET-DEP-', 'SECRET-NESTED-'] }
}

export interface PrivacyObservationB4 {
  label: string; audience: 'gm' | 'player'; variant: Variant; mode: 'preview' | 'png'; longEdgePx: number
  width: number; height: number; bytes: number; ms: number; rgbaHash: string; opaquePixels: number; pixels: number
  chunks: string[]; sourceRevision: number; assetIds: string[]; expectedDecodeHashes: string[]; actualDecodeHashes: string[]; closed: number
  hiddenAssetsRequested: string[]; sourceUnchanged: boolean; maskCenter: number[]; privateMetadataChunks: string[]; plaintextSentinelMatches: string[]
}

/** PNGs stay in the browser until Playwright saves them as file attachments; JSON contains no base64 bodies. */
export const privacyPngsB4: Record<string, Blob> = {}
export async function observePrivacyB4(pair: PrivacyPairB4, variant: Variant, audience: 'gm' | 'player', mode: 'preview' | 'png', label: string, longEdgePx: number): Promise<PrivacyObservationB4> {
  const project = pair[variant], before = JSON.stringify(project.document), projection = projectSceneV2(project.document, audience)
  const expectedDecodeHashes = [...new Set(projection.assetIds.map(id => project.document.assets[id].sha256))].sort(), actualDecodeHashes: string[] = [], original = window.createImageBitmap.bind(window)
  let closed = 0, png: Blob | undefined, canvas: HTMLCanvasElement | undefined
  const started = performance.now()
  window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
    if (!(source instanceof Blob)) throw new Error('预期渲染只解码入库Blob。')
    actualDecodeHashes.push(await hashBytes(await source.arrayBuffer()))
    const bitmap = await original(source, options), close = bitmap.close.bind(bitmap)
    bitmap.close = () => { closed++; close() }; return bitmap
  }) as typeof createImageBitmap
  try {
    if (mode === 'png') png = await exportPngV2(project, { audience, longEdgePx })
    else canvas = await renderProjectV2(project, { audience, longEdgePx })
  } finally { window.createImageBitmap = original }
  const ms = performance.now() - started
  if (png) {
    privacyPngsB4[label] = png; const bitmap = await original(png)
    canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d', { colorSpace: 'srgb' })!.drawImage(bitmap, 0, 0); bitmap.close()
  }
  if (!canvas) throw new Error('隐私渲染没有Canvas。')
  const width = canvas.width, height = canvas.height, data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
  let opaquePixels = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaquePixels++
  const rgbaHash = await hashBytes(data), mask = projection.masks[0], maskX = Math.floor((mask[0].x + mask[2].x) / 2 / projection.bounds.width * width), maskY = Math.floor((mask[0].y + mask[2].y) / 2 / projection.bounds.height * height), maskCenter = [...canvas.getContext('2d')!.getImageData(maskX, maskY, 1, 1).data]
  canvas.width = canvas.height = 0
  const chunks: string[] = [], plaintextSentinelMatches: string[] = []
  if (png) {
    const bytes = new Uint8Array(await png.arrayBuffer()); let offset = 8
    while (offset < bytes.length) { const length = new DataView(bytes.buffer, offset, 4).getUint32(0); chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset += length + 12 }
    const rawText = new TextDecoder().decode(bytes)
    plaintextSentinelMatches.push(...pair.sentinelStrings.filter(sentinel => rawText.includes(sentinel)))
  }
  return { label, audience, variant, mode, longEdgePx, width, height, bytes: png?.size ?? width * height * 4, ms, rgbaHash, opaquePixels, pixels: width * height, chunks, sourceRevision: projection.sourceRevision, assetIds: projection.assetIds,
    expectedDecodeHashes, actualDecodeHashes, closed, hiddenAssetsRequested: pair.secretAssetIds.filter(id => projection.assetIds.includes(id)), sourceUnchanged: before === JSON.stringify(project.document), maskCenter,
    privateMetadataChunks: chunks.filter(chunk => ['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(chunk)), plaintextSentinelMatches }
}
