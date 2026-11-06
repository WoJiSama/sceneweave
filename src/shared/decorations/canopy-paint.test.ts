import { toCurrentSceneDocument } from '../model/current-scene.js'
import { describe, expect, it } from 'vitest'
import { applyCompositionCommands } from '../appearance/commands.js'
import { addPropAppearanceSource, createCompositionContent } from '../appearance/graph.js'
import { propPaintPolygon, propPresentation } from '../appearance/presentation.js'
import { applyCommands } from '../commands/commands.js'
import { pointInPolygon, polygonDistance, polygonInside, propFootprint, supportedPolygon } from '../geometry/geometry.js'
import type { CompositionContent } from '../model/appearance.js'
import type { PointMm, PropDefinition, SceneDocument } from '../model/scene.js'
import { projectScene } from '../projection/projection.js'
import { createEmptyGeneration5, getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { cloneJson } from '../validation/json.js'
import { TERRAIN_VARIANT_ART } from '../visual/terrain-variant-art.js'
import { emptyVisualSystem } from '../visual/types.js'
import type { SurfaceRuleCommand } from '../surface-rules/commands.js'
import { decorationProtectedGeometry } from './generate.js'
import { conservativePropPaintEnvelope } from './geometry.js'

const point = (x: number, y: number): PointMm => ({ x, y })
const rectangle = (x: number, y: number, width: number, height: number) => [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)]
let nextId = 0
const runtime = () => ({ ids: { nextId: () => `canopy-paint-${++nextId}` }, clock: { now: () => '2026-11-02T00:00:00.000Z' } })
const art = TERRAIN_VARIANT_ART.find(row => row.key === 'tree-wind-oak')!

function fixture(protectedAreas = false): CompositionContent {
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const origin = { kind: 'original' as const, attribution: 'Fixed tree dimensions and root geometry fixture; no decoded pixel proof.', canEmbed: true }
  const definition: PropDefinition = { id: 'wind-oak', catalogId: 'wind-oak', version: 1, name: art.name, tags: art.tags!, licenseRef: 'fixture-license', origin,
    defaultAppearance: { kind: 'image', assetId: 'tree-image', tint: null, opacity: 1 },
    defaultVisualBoundsMm: { x: -art.widthMm / 2, y: -art.heightMm / 2, width: art.widthMm, height: art.heightMm },
    defaultFootprintMm: cloneJson(art.footprintMm!), defaultFootprintOffsetMm: point(0, 0), defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  const document: SceneDocument = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'canopy-paint', revision: 0, title: 'Canopy paint geometry', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {},
    assets: { 'tree-image': { id: 'tree-image', sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512, logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: 'fixture-license', origin } },
    propDefinitions: { 'wind-oak': definition }, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'geometry only', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] },
    mapMode: 'scene', regional: null, generation: createEmptyGeneration5(), visual: { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }, decorations: {}, decorationClusters: {} })
  document.terrainAreas.ground = { id: 'ground', floorId: 'floor', editLocked: false, visibility: 'public', boundaryMm: rectangle(0, 0, 24000, 18000).map((positionMm, i) => ({ id: `ground-p${i}`, segmentId: `ground-s${i}`, positionMm })),
    groundElevationMm: 300, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  document.entityLayers.ground = 'layer'
  if (protectedAreas) {
    document.paths.road = { id: 'road', floorId: 'floor', editLocked: false, visibility: 'public', centerlineMm: [point(10000, 1000), point(10000, 16000)], widthMm: 1200,
      supportRefs: [{ kind: 'terrainArea', id: 'ground' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    document.entityLayers.road = 'layer'
    document.terrainAreas.high = { ...cloneJson(document.terrainAreas.ground), id: 'high', groundElevationMm: 1400, coveragePriority: 2,
      boundaryMm: rectangle(19000, 8000, 4000, 6000).map((positionMm, i) => ({ id: `high-p${i}`, segmentId: `high-s${i}`, positionMm })) }
    document.entityLayers.high = 'layer'
    document.terrainConnections.stair = { id: 'stair', floorId: 'floor', editLocked: false, visibility: 'public', kind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: 'ground' }, positionMm: point(16000, 11000) }, to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: point(21000, 11000) },
      widthMm: 1500, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    document.entityLayers.stair = 'layer'
    getLegacyGeneration(document)!.constraints.activity = { id: 'activity', floorId: 'floor', visibility: 'public', strength: 'hard', kind: 'activityArea', boundaryMm: rectangle(2500, 5500, 4000, 3500), clearanceMm: 250 }
  }
  const content = createCompositionContent(document, runtime())
  addPropAppearanceSource(content.appearance, { definitionRef: { id: definition.id, version: 1 }, appearance: definition.defaultAppearance, visualBoundsMm: definition.defaultVisualBoundsMm, shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, art.presentation)
  return content
}

function command(rings = [rectangle(4000, 4000, 3200, 4000)]): Extract<SurfaceRuleCommand, { type: 'paintSurfaceVegetation' }> {
  return { type: 'paintSurfaceVegetation', id: 'canopy-rule', clusterId:'canopy',field:'trees', floorId: 'floor', layerId: 'layer', visibility: 'public', supportRef: { kind: 'terrainArea', id: 'ground' }, regionsMm:rings.map(outerMm=>({outerMm,holesMm:[]})),
    palette:[{key:'tree',definitionRef:{id:'wind-oak',version:1},kind:'prop',weight:1}], seed: 'fixed-root-small-region', coveragePpm: 500000, spacingMm: 350, clusterRadiusMm: 2200, clearanceMm: 300 }
}

describe('canopy generation uses complete fixed paint geometry', () => {
  it('plants a real fixed near-side tree in a small region that cannot fit the fallback envelope', () => {
    const before = fixture(), create = command(), baseline = cloneJson(before)
    const bare = applyCommands(before.document, [create], runtime())
    expect(Object.keys(bare.props)).toHaveLength(1)
    const after = applyCompositionCommands(before, [create], runtime()), trees = Object.values(after.document.props)
    expect(trees).toHaveLength(1)
    expect(before).toEqual(baseline)
    for (const tree of trees) {
      const presentation = propPresentation(after.appearance, tree.id)
      expect(presentation).toEqual(art.presentation)
      expect(presentation?.rootAnchorMm.y).toBeGreaterThan(0)
      const paint = propPaintPolygon(tree, presentation)
      expect(pointInPolygon(tree.positionMm, create.regionsMm[0].outerMm)).toBe(true)
      expect(polygonInside(conservativePropPaintEnvelope(tree), create.regionsMm[0].outerMm)).toBe(false)
      expect(Math.min(...paint.map(row => row.y))).toBe(tree.positionMm.y + tree.visualBoundsMm.y - art.presentation.rootAnchorMm.y)
      expect(supportedPolygon(after.document, propFootprint(tree), create.supportRef, 'floor')).toBe(true)
      expect(after.historyIdentity.propTokens[tree.id]).toBeTruthy()
    }
  })

  it('keeps exact root-anchored tree paint outside roads, activity space and real stair clearances', () => {
    const before = fixture(true), create = { ...command([rectangle(1000, 1000, 17000, 15000)]), coveragePpm: 300000 }
    const after = applyCompositionCommands(before, [create], runtime()), trees = Object.values(after.document.props)
    expect(trees.length).toBeGreaterThan(2)
    const protections = decorationProtectedGeometry(after.document, after.document.decorationClusters!.canopy)
    expect(new Set(protections.map(row => row.id))).toEqual(new Set(['road', 'stair', 'activity']))
    for (const tree of trees) {
      const paint = propPaintPolygon(tree, propPresentation(after.appearance, tree.id))
      expect(pointInPolygon(tree.positionMm, create.regionsMm[0].outerMm)).toBe(true)
      for (const protection of protections) expect(polygonDistance(paint, protection.polygon)).toBeGreaterThanOrEqual(protection.marginMm)
    }
    expect(after.document.paths).toEqual(before.document.paths)
    expect(after.document.terrainConnections).toEqual(before.document.terrainConnections)
    expect(after.document.terrainAreas).toEqual(before.document.terrainAreas)
  })

  it('preserves locked trees while density grows and rejects locked support or layers atomically', () => {
    const before = fixture(), planted = applyCompositionCommands(before, [command()], runtime()), tree = Object.values(planted.document.props)[0]
    expect(tree).toBeDefined()
    const locked = applyCompositionCommands(planted, [{ type: 'setEditLock', kind: 'prop', id: tree.id, locked: true }], runtime())
    const grown = applyCompositionCommands(locked, [{ type: 'updateSurfaceVegetation', id: 'canopy-rule', coveragePpm: 900000 }], runtime())
    expect(grown.document.props[tree.id]).toEqual(locked.document.props[tree.id])
    for (const kind of ['support', 'layer'] as const) {
      const source = fixture()
      if (kind === 'support') source.document.terrainAreas.ground.editLocked = true
      else source.document.userLayers.layer.editLocked = true
      const original = cloneJson(source)
      expect(() => applyCompositionCommands(source, [command()], runtime())).toThrow(/锁/)
      expect(source).toEqual(original)
    }
  })

  it('does not let an overlapping private locked canopy rule suppress or block public trees', () => {
    const before = fixture(), create = command()
    const publicOnly = applyCompositionCommands(before, [create], runtime())
    const hidden = applyCompositionCommands(before, [{ ...create, id: 'private-rule', clusterId:'private-cluster', visibility: 'gm', coveragePpm: 0 }], runtime())
    const privateLocked = applyCompositionCommands(hidden, [{ type: 'setEditLock', kind: 'decorationCluster', id: 'private-cluster', locked: true }], runtime())
    const publicAfter = applyCompositionCommands(privateLocked, [create], runtime())
    const geometry = (content: CompositionContent) => Object.values(content.document.props).filter(row => row.visibility === 'public').map(row => ({ positionMm: row.positionMm, definitionRef: row.definitionRef, visualBoundsMm: row.visualBoundsMm }))
    expect(geometry(publicAfter)).toEqual(geometry(publicOnly))
    expect(geometry(publicAfter)).toHaveLength(1)
    expect(publicAfter.document.decorationClusters!['private-cluster']).toEqual(privateLocked.document.decorationClusters!['private-cluster'])
    const player = JSON.stringify(projectScene(publicAfter.document, 'player'))
    expect(player).not.toContain('private-rule')
    expect(player).not.toContain('canopyRule')
  })
})
