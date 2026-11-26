import { zlibSync } from 'fflate'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { applyCommands } from '../../src/shared/commands/commands.js'
import type { AssetRecord, ProjectBundle, ProjectData } from '../../src/shared/model/project.js'
import type { Prop, SceneDocument } from '../../src/shared/model/scene.js'
import type { PreparationContext } from '../../src/shared/ports/runtime.js'
import { crc32, sha256Bytes } from '../../src/shared/project/binary.js'
import { createMemoryResources } from '../../src/shared/project/resources.js'
import { encodeUtf8 } from '../../src/shared/validation/json.js'
import scenes from '../../src/platform/browser/content/scenes-data.json'

export const FIXTURE_STAMP = '2026-10-21T00:00:00.000Z'
const FLOOR = 'blank-floor', LAYER = 'layer-default-0'
const origin = { kind: 'original' as const, attribution: 'Sceneweave test fixture', canEmbed: true }

export function fixtureRuntime(): PreparationContext {
  let sequence = 0
  return { ids: { nextId: () => `test-fixture-${++sequence}` }, clock: { now: () => FIXTURE_STAMP } }
}

export function blankScene({ title = '图层测试', widthMm = 20_000, heightMm = 20_000, sceneId = 'layer-copy', now = FIXTURE_STAMP } = {}): SceneDocument {
  const scene = structuredClone(scenes.scenes.blank.document) as unknown as SceneDocument
  const bounds = { x: 0, y: 0, width: widthMm, height: heightMm }
  // A small fixed prop palette is enough for tests that replace an appearance.
  const definition = scene.propDefinitions['b2-p-03']
  const appearance = definition.defaultAppearance
  if (appearance.kind !== 'image') throw new Error('Fixture prop is missing its source image')
  return { ...scene, sceneId, title, createdAt: now, updatedAt: now, exportBoundsMm: bounds,
    floors: { [FLOOR]: { ...scene.floors[FLOOR], boundsMm: { ...bounds } } },
    assets: { [appearance.assetId]: scene.assets[appearance.assetId] }, propDefinitions: { [definition.id]: definition },
    materials: {}, prefabDefinitions: {}, styleThemes: {}, activeStyleThemeRef: null }
}

export function sampleScene(kind: 'study' | 'island'): SceneDocument {
  return structuredClone(scenes.scenes[kind].document) as unknown as SceneDocument
}

export function symbolProp(id: string, x = 4000, y = 4000): Prop {
  return { id, floorId: FLOOR, editLocked: false, definitionRef: null,
    appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
    visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 },
    positionMm: { x, y }, rotationDeg: 0, footprintMm: { width: 200, height: 200 }, footprintOffsetMm: { x: 0, y: 0 },
    blocksMovement: false, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: FLOOR },
    renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
}

export function layerScene(): SceneDocument {
  const scene = blankScene()
  scene.props.item = symbolProp('item')
  scene.entityLayers.item = LAYER
  return scene
}

export function groupLayerScene(): SceneDocument {
  const scene = layerScene()
  scene.sceneId = 'group-layer-copy'
  scene.props.left = symbolProp('left', 6000, 4000)
  scene.props.right = symbolProp('right', 8000, 4000)
  const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, supportRef: _support, ...template } = scene.props.left
  scene.prefabDefinitions.definition = { id: 'definition', catalogId: 'test.layers-group', version: 1, licenseRef: 'MIT',
    origin, name: '测试组合', tags: [], members: ['left', 'right', 'removed'].map(key => ({ key, propTemplate: template })) }
  scene.prefabInstances.group = { id: 'group', floorId: FLOOR, editLocked: false, visibility: 'gm',
    definitionRef: { id: 'definition', version: 1 }, anchorMm: { x: 7000, y: 4000 }, rotationDeg: 0,
    members: { left: { propId: 'left', overrideFields: ['positionMm'] }, right: { propId: 'right', overrideFields: [] },
      removed: { propId: null, overrideFields: ['rotationDeg'] } } }
  Object.assign(scene.entityLayers, { left: LAYER, right: LAYER, group: LAYER })
  return scene
}

export function scatterLayerScene(memberCount = 1): SceneDocument {
  const scene = layerScene(), definitionId = 'scatter-definition'
  scene.sceneId = 'scatter-layer-copy'
  const prop = symbolProp('example')
  scene.propDefinitions[definitionId] = { id: definitionId, catalogId: 'test.layer-scatter', version: 1, licenseRef: 'MIT',
    origin, name: '散布测试', tags: [], defaultAppearance: prop.appearance, defaultVisualBoundsMm: prop.visualBoundsMm,
    defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false,
    defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  scene.terrainAreas.domain = { id: 'domain', floorId: FLOOR, editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 1000, y: 1000 }, { x: 19000, y: 1000 }, { x: 19000, y: 19000 }, { x: 1000, y: 19000 }]
      .map((positionMm, index) => ({ id: `domain-point-${index}`, segmentId: `domain-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.props.item.supportRef = { kind: 'terrainArea', id: 'domain' }
  scene.scatterGroups.scatter = { id: 'scatter', floorId: FLOOR, editLocked: false, visibility: 'gm', domain: { kind: 'area', areaId: 'domain' },
    palette: [{ key: 'symbol', propDefinitionRef: { id: definitionId, version: 1 }, weight: 1 }], seed: 'native-layer-scatter',
    algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 0, y: 0 }, cellSizeMm: 3000, densityFactor: .5, minDistanceMm: 100,
    rotationRangeDeg: { min: 0, max: 359 }, members: {}, exclusions: [] }
  Object.assign(scene.entityLayers, { domain: LAYER, scatter: LAYER })
  for (let index = 0; index < memberCount; index++) {
    const id = `scatter-item-${index}`, key = (index + 1).toString(16).padStart(64, '0')
    scene.props[id] = { ...symbolProp(id, 2000 + index % 32 * 500, 2000 + Math.floor(index / 32) * 500),
      definitionRef: { id: definitionId, version: 1 }, supportRef: { kind: 'terrainArea', id: 'domain' } }
    scene.entityLayers[id] = LAYER
    scene.scatterGroups.scatter.members[key] = { propId: id, state: 'manual', overrideFields: ['positionMm'] }
  }
  return scene
}

export function compositionFixture(document = layerScene()) {
  document.props.other = symbolProp('other', 7000, 4000)
  document.entityLayers.other = LAYER
  return createCompositionContent(document, fixtureRuntime())
}

export function imageCompositionFixture() {
  const { document } = compositionFixture()
  return createCompositionContent(applyCommands(document, [{ type: 'replacePropAppearance', id: 'item', definitionRef: { id: 'b2-p-03', version: 1 } }], fixtureRuntime()), fixtureRuntime())
}

export function imageRecord(bytes: Uint8Array): AssetRecord {
  return { sha256: sha256Bytes(bytes), mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 }
}

export function pngChunk(name: string, bytes: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(bytes.length + 12), view = new DataView(chunk.buffer)
  view.setUint32(0, bytes.length)
  chunk.set(encodeUtf8(name), 4)
  chunk.set(bytes, 8)
  view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)))
  return chunk
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}

export function pixelPng(rgba = [20, 50, 80, 200]): Uint8Array {
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6
  return concatBytes([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
    pngChunk('IDAT', zlibSync(new Uint8Array([0, ...rgba]))), pngChunk('IEND', new Uint8Array())])
}

export function emptyProject(): ProjectBundle {
  const document = blankScene({ sceneId: 'package-fixture', title: 'Project fixture' })
  document.assets = {}; document.propDefinitions = {}
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...createCompositionContent(document, fixtureRuntime()),
    assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources: createMemoryResources({}) }
}

export function imageProject(bytes = pixelPng()): ProjectBundle {
  const { project } = emptyProject(), document = project.document, asset = imageRecord(bytes)
  const text = 'Sceneweave original test pixel and material. CC0-1.0.', hash = sha256Bytes(encodeUtf8(text)), licenseRef = 'test-original-cc0'
  document.assets['test-image'] = { id: 'test-image', sha256: asset.sha256, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1,
    logicalSizeMm: { width: 1000, height: 1000 }, licenseRef, origin }
  document.materials['test-material'] = { id: 'test-material', catalogId: 'test.material', version: 1, licenseRef, origin,
    name: 'Original pixel', tags: [], textureAssetId: 'test-image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
  project.assets[asset.sha256] = asset
  project.licenses[hash] = { sha256: hash, text }
  const binding = { licenseRef, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' as const }
  project.licenseBindings = [{ ...binding, subjectKind: 'asset', subjectId: 'test-image' }, { ...binding, subjectKind: 'material', subjectId: 'test-material' }]
  return { project: { ...project, ...createCompositionContent(document, fixtureRuntime()) },
    resources: createMemoryResources(new Map([[asset.sha256, bytes]])) }
}

export function outdoorProject(memberCount = 2): ProjectBundle {
  const document = scatterLayerScene(memberCount)
  document.assets = {}
  document.propDefinitions = { 'scatter-definition': document.propDefinitions['scatter-definition'] }
  document.scatterGroups.scatter.visibility = 'public'
  const text = 'MIT\nCopyright Sceneweave test fixture. Permission is hereby granted to use, copy, modify and distribute this original test symbol.'
  const hash = sha256Bytes(encodeUtf8(text))
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 1, ...createCompositionContent(document, fixtureRuntime()),
    assets: {}, licenses: { [hash]: { sha256: hash, text } },
    licenseBindings: [{ subjectKind: 'propDefinition', subjectId: 'scatter-definition', licenseRef: 'MIT', licensePath: `licenses/${hash}.txt`, embedding: 'allowed' }],
    authoringSources: {} }
  return { project, resources: createMemoryResources({}) }
}
