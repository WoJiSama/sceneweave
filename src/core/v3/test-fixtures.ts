import { createBlankDocumentV2 } from '../../editor/v2/blank-project'
import type { PropV2, SceneDocumentV2 } from '../v2/types'
import { migrateSceneV2 } from './migration'
import type { SceneDocumentV3 } from './types'

export const STAMP_V3 = '2026-10-21T00:00:00.000Z'
export function symbolPropV3(id: string, x = 4000, y = 4000): PropV2 {
  return { id, floorId: 'blank-floor', editLocked: false, definitionRef: null,
    appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 }, visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 },
    positionMm: { x, y }, rotationDeg: 0, footprintMm: { width: 200, height: 200 }, footprintOffsetMm: { x: 0, y: 0 },
    blocksMovement: false, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: 'blank-floor' },
    renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
}
export function layerSourceV2(): SceneDocumentV2 {
  const scene = createBlankDocumentV2({ title: '图层测试', widthMm: 20000, heightMm: 20000, preset: 'investigation', sceneId: 'layer-source', now: STAMP_V3 })
  scene.props.item = symbolPropV3('item')
  return scene
}
export function layerSceneV3(): SceneDocumentV3 {
  return migrateSceneV2(layerSourceV2(), { sceneId: 'layer-copy', now: STAMP_V3 })
}
export function groupLayerSceneV3(): SceneDocumentV3 {
  const source = layerSourceV2()
  source.props.left = symbolPropV3('left', 6000, 4000); source.props.right = symbolPropV3('right', 8000, 4000)
  const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, supportRef: _support, ...template } = source.props.left
  source.prefabDefinitions.definition = { id: 'definition', catalogId: 'test.layers-group', version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Sceneweave tests', canEmbed: true },
    name: '测试组合', tags: [], members: [{ key: 'left', propTemplate: template }, { key: 'right', propTemplate: template }, { key: 'removed', propTemplate: template }] }
  source.prefabInstances.group = { id: 'group', floorId: 'blank-floor', editLocked: false, visibility: 'gm', definitionRef: { id: 'definition', version: 1 }, anchorMm: { x: 7000, y: 4000 }, rotationDeg: 0,
    members: { left: { propId: 'left', overrideFields: ['positionMm'] }, right: { propId: 'right', overrideFields: [] }, removed: { propId: null, overrideFields: ['rotationDeg'] } } }
  return migrateSceneV2(source, { sceneId: 'group-layer-copy', now: STAMP_V3 })
}

/** Small physical symbol palette keeps regeneration assertions independent of bitmap assets. */
export function scatterLayerSceneV3(memberCount = 1): SceneDocumentV3 {
  const source = layerSourceV2(), definitionId = 'scatter-definition'
  const prop = symbolPropV3('scatter-item-0', 3000, 3000)
  source.propDefinitions[definitionId] = { id: definitionId, catalogId: 'test.layer-scatter', version: 1, licenseRef: 'MIT',
    origin: { kind: 'original', attribution: 'Sceneweave tests', canEmbed: true }, name: '散布测试', tags: [],
    defaultAppearance: prop.appearance, defaultVisualBoundsMm: prop.visualBoundsMm, defaultFootprintMm: prop.footprintMm,
    defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false,
    defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  source.terrainAreas.domain = { id: 'domain', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 1000, y: 1000 }, { x: 19000, y: 1000 }, { x: 19000, y: 19000 }, { x: 1000, y: 19000 }].map((positionMm, i) => ({ id: `domain-point-${i}`, segmentId: `domain-segment-${i}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  source.props.item.supportRef = { kind: 'terrainArea', id: 'domain' }
  source.scatterGroups.scatter = { id: 'scatter', floorId: 'blank-floor', editLocked: false, visibility: 'gm', domain: { kind: 'area', areaId: 'domain' },
    palette: [{ key: 'symbol', propDefinitionRef: { id: definitionId, version: 1 }, weight: 1 }],
    seed: 'native-layer-scatter', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 0, y: 0 }, cellSizeMm: 3000,
    densityFactor: .5, minDistanceMm: 100, rotationRangeDeg: { min: 0, max: 359 }, members: {}, exclusions: [] }
  for (let i = 0; i < memberCount; i++) {
    const id = `scatter-item-${i}`, key = (i + 1).toString(16).padStart(64, '0')
    source.props[id] = { ...symbolPropV3(id, 2000 + i % 32 * 500, 2000 + Math.floor(i / 32) * 500), definitionRef: { id: definitionId, version: 1 }, supportRef: { kind: 'terrainArea', id: 'domain' } }
    source.scatterGroups.scatter.members[key] = { propId: id, state: 'manual', overrideFields: ['positionMm'] }
  }
  return migrateSceneV2(source, { sceneId: 'scatter-layer-copy', now: STAMP_V3 })
}
