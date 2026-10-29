import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../model/scene.js'
import { emptyVisualSystem, type VisualBoundary } from './types.js'
import { createTerrainDistanceField, materializeTerrainTransition, validateTerrainTransition, validateTerrainTransitions, hitTerrainTransition, transitionBounds, terrainTransitionStrokePolygon, refreshTerrainTransitionsLocal } from './transition.js'
import { createEmptyGeneration5, type VisualSystem3 } from '../terrain-generation/composition-contracts.js'

const hash = 'a'.repeat(64)
const bounds = { x: 0, y: 0, width: 8000, height: 8000 }
const material = (id: string, tags: string[]) => ({ id, catalogId: id, version: 1, name: id, tags, licenseRef: 'lic', origin: { kind: 'original' as const, attribution: 'fixture', canEmbed: true }, textureAssetId: 'asset', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain' as const] })
const area = (id: string, points: { x: number; y: number }[], materialId: string, elevationMm: number) => ({ id, floorId: 'floor', editLocked: false, visibility: 'public' as const, boundaryMm: points.map((positionMm, i) => ({ id: `${id}-p${i}`, segmentId: `${id}-s${i}`, positionMm })), groundElevationMm: elevationMm, coveragePriority: 1, surfaceStyle: { base: { materialRef: { id: materialId, version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }, blocksMovement: materialId.includes('water'), blocksSight: false, movementCostMultiplier: 1 })
function fixture(): SceneDocument {
  const boundary: VisualBoundary = { id: 'coast', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false, closed: false,
    segments: [{ id: 'coast-segment-0', start: { x: 2000, y: 4000 }, control1: { x: 2000, y: 4000 }, control2: { x: 4000, y: 4000 }, end: { x: 4000, y: 4000 } }, { id: 'coast-segment-1', start: { x: 4000, y: 4000 }, control1: { x: 4000, y: 4000 }, control2: { x: 6000, y: 4000 }, end: { x: 6000, y: 4000 } }], sampleSpacingMm: 2000, toleranceMm: 100,
    binding: { kind: 'terrain', sides: [{ areaId: 'sand', startPointId: 'sand-p0', endPointId: 'sand-p2', reverse: false }, { areaId: 'water', startPointId: 'water-p2', endPointId: 'water-p4', reverse: true }] } }
  const sand = area('sand', [{ x: 2000, y: 4000 }, { x: 4000, y: 4000 }, { x: 6000, y: 4000 }, { x: 6000, y: 8000 }, { x: 2000, y: 8000 }], 'sand-material', 100)
  const water = area('water', [{ x: 2000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 4000, y: 4000 }, { x: 2000, y: 4000 }], 'water-material', 0)
  return { format: 'sceneweave-scene', schemaVersion: 4, sceneId: 'transition-fixture', revision: 1, title: 'transition', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
  floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: { 'sand-material': material('sand-material', ['sand']), 'water-material': material('water-material', ['water']) }, terrainAreas: { sand, water }, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {}, presetSnapshot: { presetId: 'fixture', presetVersion: 1, distanceMode: 'metric', source: 'fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] }, mapMode: 'scene', regional: null, generation: createEmptyGeneration5(), visual: { version: 3, base: { version: 2, base: { ...emptyVisualSystem(), boundaries: { coast: boundary } }, materializedEdges: {} }, transitions: {} } }
}
function closedFixture(): SceneDocument {
  const scene = fixture(), p = (x: number, y: number) => ({ x, y })
  scene.terrainAreas.sand.boundaryMm = [p(2000, 2000), p(6000, 2000), p(6000, 6000), p(2000, 6000)].map((positionMm, i) => ({ id: `sand-p${i}`, segmentId: `sand-s${i}`, positionMm }))
  scene.terrainAreas.sand.coveragePriority = 2
  scene.terrainAreas.water.boundaryMm = [p(0, 0), p(8000, 0), p(8000, 8000), p(0, 8000)].map((positionMm, i) => ({ id: `water-p${i}`, segmentId: `water-s${i}`, positionMm }))
  const points = [p(2000, 2000), p(6000, 2000), p(6000, 6000), p(2000, 6000)]
  const segments = points.map((start, i) => { const end = points[(i + 1) % points.length]; return { id: `closed-${i}`, start, control1: start, control2: end, end } })
  const boundary: VisualBoundary = { id: 'closed-coast', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false, closed: true, segments, sampleSpacingMm: 4000, toleranceMm: 1,
    binding: { kind: 'terrain', sides: [{ areaId: 'sand', startPointId: 'sand-p0', endPointId: 'sand-p0', reverse: false }] } }
  if (scene.visual?.version !== 3) throw new Error('closed fixture requires visual3')
  scene.visual.base.base.boundaries[boundary.id] = boundary
  return scene
}

describe('T10 terrain transitions', () => {
  it('materializes strict source-derived shore geometry and replays it', () => {
    const scene = fixture(), row = materializeTerrainTransition(scene, { id: 'shore-transition', boundaryId: 'coast', kind: 'shore', side: 'both', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
    expect(row.leftSurface).toBe('sand'); expect(row.rightSurface).toBe('water'); expect(row.leftElevationMm).toBe(100); expect(row.rightElevationMm).toBe(0)
    expect(row.polygons.length).toBeGreaterThan(0); expect(validateTerrainTransition(scene, row)).toEqual([])
    ;(scene.visual as VisualSystem3).transitions[row.id] = row; expect(validateTerrainTransitions(scene)).toEqual([])
    expect(hitTerrainTransition(row, { x: 3000, y: 4200 })).toBe(true); expect(hitTerrainTransition(row, { x: 3000, y: 6000 })).toBe(false)
    expect(transitionBounds(row).width).toBeGreaterThan(0)
  })
  it('keeps the physical source independent from visual output and rejects stale hashes', () => {
    const scene = fixture(), row = materializeTerrainTransition(scene, { id: 'shore-transition', boundaryId: 'coast', kind: 'shore', side: 'left', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
    const stale = { ...row, outputHash: hash }; expect(validateTerrainTransition(scene, stale).some(issue => issue.code === 'TRANSITION_OUTPUT_HASH')).toBe(true)
    expect(scene.terrainAreas.sand.blocksMovement).toBe(false); expect(scene.terrainAreas.water.blocksMovement).toBe(true)
  })
  it('rejects a private physical dependency for a public transition', () => {
    const scene = fixture(); scene.props.tree = { id: 'tree', floorId: 'floor', editLocked: false, visibility: 'gm', definitionRef: null, appearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 }, visualBoundsMm: { x: 2800, y: 3900, width: 400, height: 400 }, positionMm: { x: 3000, y: 4100 }, rotationDeg: 0, footprintMm: { width: 400, height: 400 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: false, supportRef: { kind: 'terrainArea', id: 'sand' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
    expect(() => materializeTerrainTransition(scene, { id: 'private', boundaryId: 'coast', kind: 'shore', side: 'left', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })).toThrow(/GM/)
  })
  it('uses the same stroke outline for hit testing callers and local refresh', () => {
    const stroke = terrainTransitionStrokePolygon([{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }, { x: 3000, y: 2000 }], 200); expect(stroke.length).toBeGreaterThan(3)
    const scene = fixture(), row = materializeTerrainTransition(scene, { id: 'shore-transition', boundaryId: 'coast', kind: 'shore', side: 'left', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } }); (scene.visual as VisualSystem3).transitions[row.id] = row
    const local = refreshTerrainTransitionsLocal(scene, { scopeMm: { x: 0, y: 0, width: 500, height: 500 } }); expect(local.changedIds).toEqual([]); expect(local.transitions[row.id]).toEqual(row)
  })
  it('closes the distance field seam and reuses it for a closed boundary band', () => {
    const scene = closedFixture(), request = { id: 'closed-shore', boundaryId: 'closed-coast', kind: 'shore' as const, side: 'left' as const, widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } }
    const field = createTerrainDistanceField(scene, request), row = materializeTerrainTransition(scene, request)
    expect(field.sampled.closed).toBe(true); expect(field.distanceAt({ x: 2000, y: 2000 })).toBe(0); expect(field.distanceAt({ x: 2000, y: 6000 })).toBe(0)
    expect(row.polygons.length).toBeGreaterThan(0); expect(hitTerrainTransition(row, { x: 2000, y: 2200 })).toBe(true); expect(validateTerrainTransition(scene, row)).toEqual([])
  })
  it('keeps a materialized transition on its source floor and layer', () => {
    const scene = fixture()
    expect(() => materializeTerrainTransition(scene, { id: 'wrong-floor', floorId: 'other-floor', boundaryId: 'coast', kind: 'shore', side: 'left', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })).toThrow(/Floor/)
    expect(() => materializeTerrainTransition(scene, { id: 'wrong-layer', layerId: 'missing-layer', boundaryId: 'coast', kind: 'shore', side: 'left', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })).toThrow(/图层/)
  })
  it('rejects a private road source for a public transition', () => {
    const scene = fixture()
    scene.paths.road = { id: 'road', floorId: 'floor', editLocked: false, visibility: 'gm', centerlineMm: [{ x: 2000, y: 4000 }, { x: 6000, y: 4000 }], widthMm: 600, supportRefs: [{ kind: 'terrainArea', id: 'sand' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    ;(scene.visual as VisualSystem3).base.base.boundaries.coast.binding = { kind: 'path', pathId: 'road' }
    expect(() => materializeTerrainTransition(scene, { id: 'private-road', boundaryId: 'coast', kind: 'pathShoulder', side: 'right', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })).toThrow(/私密道路/)
  })
})
