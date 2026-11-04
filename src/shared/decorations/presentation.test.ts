import { describe, expect, it } from 'vitest'
import { createTerrainVariantCatalogDocument, TERRAIN_VARIANT_SPECS, terrainVariantDefinitionId } from '../../platform/browser/content/terrain-variant-catalog.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { addPropAppearanceSource } from '../appearance/graph.js'
import { associateScenePresentations, validatePresentations } from '../appearance/presentation.js'
import type { AppearanceGraph } from '../model/appearance.js'
import type { DecorationCluster, SceneDocument } from '../model/scene.js'
import { validateSceneDocument } from '../validation/scene.js'
import { projectEditorScene, projectScene } from '../projection/projection.js'
import { selectionGeometry, hitTestAll, selectInBounds, normalizeSelection } from '../../editor/native-canvas/selection.js'
import { hiddenDependentsV3, hitTestLayersV3, selectionGeometryLayersV3 } from '../../editor/native-canvas/layer-selection.js'
import { selectionScene } from '../../editor/native-canvas/selection-scene.js'
import { decorationPaintGeometry, decorationPaintPolygon } from './presentation.js'
import { visualBase } from '../visual/base.js'
import { inspectDependencies } from '../commands/dependencies.js'
import { createPublicVisibility, publicTerrainView } from '../geometry/visibility.js'

const floorId = 'terrain-variants-v1-floor', layerId = 'terrain-variants-v1-layer'
function fixture() {
  // Synchronous metadata only. Actual PNG/resource/Canvas evidence is separate.
  const scene = emptyCompositionDocument(createTerrainVariantCatalogDocument())
  scene.schemaVersion = 6; scene.decorations = {}; scene.decorationClusters = {}
  for (const [id, key, x] of [['grass', 'grass-sedge-fan', 6000], ['shrub', 'shrub-heath-mound', 10000]] as const) {
    scene.decorations[id] = { id, floorId, editLocked: false, visibility: 'public', definitionRef: { id: terrainVariantDefinitionId(key), version: 1 },
      supportRef: { kind: 'floor', id: floorId }, positionMm: { x, y: 7000 }, rotationDeg: 0, scalePpm: 750000, renderOrder: 0 }
    scene.entityLayers[id] = layerId
  }
  const graph: AppearanceGraph = { version: 2, presentations: {}, sources: {}, propSources: {}, surfaceSources: {}, instanceAdjustments: {}, layerAdjustments: {}, variants: {}, prefabAppearanceTemplates: {} }
  for (const spec of TERRAIN_VARIANT_SPECS) {
    const definition = scene.propDefinitions[spec.definitionId]
    addPropAppearanceSource(graph, { definitionRef: { id: definition.id, version: definition.version }, appearance: structuredClone(definition.defaultAppearance), visualBoundsMm: structuredClone(definition.defaultVisualBoundsMm), shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, spec.presentation)
  }
  associateScenePresentations(scene, graph)
  return { scene, graph }
}
function addCluster(scene: SceneDocument): DecorationCluster {
  const group: DecorationCluster = { id: 'cluster', floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'floor', id: floorId },
    boundsMm: { x: 3000, y: 3000, width: 10000, height: 7000 }, seed: 'compact-paint', algorithmVersion: 'cluster-v1',
    palette: Object.values(scene.decorations!).map(value => ({ key: value.id, kind: 'decoration', definitionRef: { ...value.definitionRef }, weight: 1 })),
    maxInstances: 2, spacingMm: 500, clusterRadiusMm: 1000, clearanceMm: 200,
    members: Object.fromEntries(Object.keys(scene.decorations!).map((id, index) => [String(index + 1).repeat(64), { kind: 'decoration', entityId: id, state: 'manual' }])) }
  scene.decorationClusters!.cluster = group; scene.entityLayers.cluster = layerId
  return group
}
function mask(scene: SceneDocument) {
  scene.regions.mask = { id: 'mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1,
    boundaryMm: [{ x: 2000, y: 2000 }, { x: 14000, y: 2000 }, { x: 14000, y: 11000 }, { x: 2000, y: 11000 }] }
  scene.entityLayers.mask = layerId
}

describe('compact decoration audience paint and exact selection', () => {
  it('derives scaled and fixed-root paint without turning compact records into physical Props', () => {
    const { scene, graph } = fixture(), before = structuredClone(scene), shrub = scene.decorations!.shrub
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(() => validatePresentations(graph, scene)).not.toThrow()
    const projection = projectScene(scene, 'gm', graph), paint = projection.decorations!.find(value => value.id === shrub.id)!
    const spec = TERRAIN_VARIANT_SPECS.find(value => value.key === 'shrub-heath-mound')!
    expect(paint.visualBoundsMm).toEqual({ x: -spec.widthMm / 2 * .75, y: (-spec.heightMm / 2 - spec.presentation.rootAnchorMm.y) * .75, width: spec.widthMm * .75, height: spec.heightMm * .75 })
    expect(projection.props).toEqual([])
    expect(paint).not.toHaveProperty('supportRef'); expect(paint).not.toHaveProperty('definitionRef'); expect(paint).not.toHaveProperty('blocksMovement')
    expect(projection.visual!.occluderRings).toEqual([]); expect(projection.visual!.contactRings).toEqual([])
    shrub.rotationDeg = 20
    expect(() => validatePresentations(graph, scene)).toThrow(/零旋转/)
    shrub.rotationDeg = 0; expect(scene).toEqual(before)
  })

  it('picks actual rotated image geometry, keeps cluster/member units independent, and carries source roots through layer views', () => {
    const { scene } = fixture(); scene.decorations!.grass.rotationDeg = 45
    addCluster(scene)
    const grass = decorationPaintGeometry(scene, scene.decorations!.grass), polygon = decorationPaintPolygon(grass)
    expect(selectionGeometry(scene, 'grass')).toEqual([polygon])
    expect(hitTestAll(scene, scene.decorations!.grass.positionMm, 0)).toContain('grass')
    const bounds = { x: 5500, y: 6500, width: 1000, height: 1000 }
    expect(selectInBounds(scene, bounds, 'contain').ids).toContain('grass')
    expect(normalizeSelection(scene, ['cluster', 'grass', 'shrub'])).toEqual(['cluster'])
    const view = selectionScene(scene, { effectiveLocks: true, layerOrder: true })
    expect(selectionGeometry(view, 'shrub')).toEqual(selectionGeometry(scene, 'shrub'))
    expect(selectionGeometry(scene, 'cluster')).toHaveLength(2)
    expect(hitTestLayersV3(scene)(scene, scene.decorations!.shrub.positionMm, 0)).toContain('shrub')
    expect(hiddenDependentsV3(scene, new Set(['cluster']))).toEqual(new Set(['cluster', 'grass', 'shrub']))
    expect(hitTestLayersV3(scene, new Set(['cluster']))(scene, scene.decorations!.grass.positionMm, 0)).not.toContain('grass')
  })

  it('keeps detached members independent when their own layer is hidden and reordered', () => {
    const { scene, graph } = fixture(), cluster = addCluster(scene), shrubPoint = scene.decorations!.shrub.positionMm
    cluster.members['1'.repeat(64)].state = 'detached'
    const clusterGeometry = selectionGeometry(scene, 'cluster')
    expect(clusterGeometry).toEqual(selectionGeometry(scene, 'shrub'))
    expect(normalizeSelection(scene, ['cluster', 'grass', 'shrub'])).toEqual(['cluster', 'grass'])
    const beforeHits = hitTestLayersV3(scene)(scene, shrubPoint, 0)
    const privateLayer = 'detached-only-layer'
    scene.userLayers[privateLayer] = { id: privateLayer, floorId, name: 'Detached only', order: 1, editLocked: false }
    scene.entityLayers.grass = privateLayer
    const hidden = hiddenDependentsV3(scene, new Set(['grass']))
    expect(hidden).toEqual(new Set(['grass']))
    expect(selectionGeometryLayersV3(scene, hidden)(scene, 'cluster')).toEqual(clusterGeometry)
    expect(hitTestLayersV3(scene, hidden)(scene, shrubPoint, 0)).toEqual(beforeHits)
    expect(projectEditorScene(scene, { hiddenLayerIds: new Set([privateLayer]) }, graph).decorations!.map(value => value.id)).toEqual(['shrub'])
    scene.userLayers[privateLayer].order = 0; scene.userLayers[layerId].order = 1
    expect(selectionGeometryLayersV3(scene, hidden)(scene, 'cluster')).toEqual(clusterGeometry)
    expect(hitTestLayersV3(scene, hidden)(scene, shrubPoint, 0)).toEqual(beforeHits)
    expect(normalizeSelection(scene, ['grass', 'cluster', 'shrub'])).toEqual(['grass', 'cluster'])
    cluster.visibility = 'gm'
    scene.decorations!.grass.positionMm.x = 18000
    scene.decorationClusters!['new-cluster'] = { ...structuredClone(cluster), id: 'new-cluster', visibility: 'public', seed: 'explicit-new-owner', maxInstances: 1,
      boundsMm: { x: 14000, y: 3000, width: 8000, height: 7000 }, palette: [structuredClone(cluster.palette[0])],
      members: { ['4'.repeat(64)]: { kind: 'decoration', entityId: 'grass', state: 'manual' } } }
    scene.entityLayers['new-cluster'] = privateLayer
    expect(inspectDependencies(scene).errors).toEqual([])
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(normalizeSelection(scene, ['cluster', 'grass', 'new-cluster'])).toEqual(['cluster', 'new-cluster'])
    expect(createPublicVisibility(scene).decoration(scene.decorations!.grass)).toBe(true)
    expect(createPublicVisibility(scene).decoration(scene.decorations!.shrub)).toBe(false)
    mask(scene)
    expect(projectScene(scene, 'player', graph).decorations!.map(value => value.id)).toEqual(['grass'])
    const missing = structuredClone(scene)
    delete missing.decorationClusters!['new-cluster']; delete missing.entityLayers['new-cluster']; delete missing.decorations!.grass; delete missing.entityLayers.grass
    expect(inspectDependencies(missing).errors.some(value => value.code === 'MISSING_MEMBER' && value.entityId === 'cluster')).toBe(true)
  })

  it('filters private cluster members, image resources and filter geometry before player projection, requiring a full fixed mask', () => {
    const { scene, graph } = fixture(), cluster = addCluster(scene)
    const definition = scene.propDefinitions[terrainVariantDefinitionId('tree-wind-oak')]
    scene.props.tree = { id: 'tree', floorId, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: definition.version },
      appearance: structuredClone(definition.defaultAppearance), visualBoundsMm: structuredClone(definition.defaultVisualBoundsMm), footprintMm: structuredClone(definition.defaultFootprintMm), footprintOffsetMm: structuredClone(definition.defaultFootprintOffsetMm),
      blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, renderLayer: definition.defaultRenderLayer, shadowClass: definition.defaultShadowClass, shadowOverride: null,
      supportRef: { kind: 'floor', id: floorId }, positionMm: { x: 8000, y: 7000 }, rotationDeg: 0, renderOrder: 0 }
    scene.entityLayers.tree = layerId
    graph.propSources.tree = Object.values(graph.sources).find(value => value.kind === 'prop' && value.snapshot.definitionRef?.id === definition.id)!.id
    cluster.members['3'.repeat(64)] = { kind: 'prop', entityId: 'tree', state: 'manual' }; cluster.maxInstances = 3
    cluster.palette.push({ key: 'tree', kind: 'prop', definitionRef: { id: definition.id, version: definition.version }, weight: 1 })
    visualBase(scene)!.filters.filter = { id: 'filter', floorId, layerId, editLocked: false, visibility: 'public', enabled: true,
      target: { kind: 'entities', ids: ['cluster'] }, preset: 'warm', exposure: 1, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 'paint-filter' }
    const publicProjection = projectScene(scene, 'player', graph)
    expect(publicProjection.decorations).toHaveLength(2); expect(publicProjection.props).toHaveLength(1)
    expect(publicProjection.visual!.filters[0].sourceEntityIds).toEqual(['grass', 'shrub', 'tree'])
    cluster.visibility = 'gm'
    expect(() => projectScene(scene, 'player', graph)).toThrow(/固定遮罩未覆盖/)
    mask(scene)
    const hidden = projectScene(scene, 'player', graph)
    expect(hidden.decorations).toBeUndefined(); expect(hidden.props).toEqual([]); expect(hidden.visual!.filters).toEqual([])
    expect(hidden.visual!.occluderRings).toEqual([]); expect(hidden.visual!.contactRings).toEqual([])
    expect(createPublicVisibility(scene).prop(scene.props.tree)).toBe(false)
    expect(createPublicVisibility(scene).decoration(scene.decorations!.shrub)).toBe(false)
    expect(publicTerrainView(scene).props).toEqual({}); expect(publicTerrainView(scene).decorations).toEqual({})
    expect(hidden.assetIds).not.toContain(decorationPaintGeometry(scene, scene.decorations!.shrub).assetId)
    scene.decorations!.shrub.positionMm.x += 100
    expect(projectScene(scene, 'player', graph)).toEqual(hidden)
  })

  it('uses real support/layer and global fixed-definition dependencies without changing old projection shapes', () => {
    const { scene, graph } = fixture(), hidden = 'hidden'
    scene.userLayers[hidden] = { id: hidden, floorId, name: 'Editor only', order: 1, editLocked: false }
    scene.entityLayers.grass = hidden
    expect(projectEditorScene(scene, { hiddenLayerIds: new Set([hidden]) }, graph).decorations!.map(value => value.id)).toEqual(['shrub'])
    scene.decorations!.grass.definitionRef.version++
    expect(inspectDependencies(scene).errors.some(value => value.code === 'DEFINITION_VERSION')).toBe(true)
    scene.decorations!.grass.definitionRef.version--
    scene.decorations!.grass.supportRef.id = 'missing-floor'
    expect(inspectDependencies(scene).errors.some(value => value.code === 'MISSING_SUPPORT')).toBe(true)
    const old = emptyCompositionDocument(createTerrainVariantCatalogDocument()); old.schemaVersion = 5
    expect(projectScene(old, 'gm')).not.toHaveProperty('decorations'); expect(projectScene(old, 'gm')).not.toHaveProperty('spritePaintOrder')
  })
})
