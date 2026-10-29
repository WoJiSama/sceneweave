import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../model/scene.js'
import { emptyVisualSystem, type VisualBoundary } from '../visual/types.js'
import { materializeTerrainTransition } from '../visual/transition.js'
import { createEmptyGeneration5, type VisualSystem3 } from './composition-contracts.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { inspectTerrainLocalDependencies, prepareTerrainLocalRefresh } from './local.js'

const bounds = { x: 0, y: 0, width: 8000, height: 8000 }
const material = (id: string, tags: string[]) => ({ id, catalogId: id, version: 1, name: id, tags, licenseRef: 'lic', origin: { kind: 'original' as const, attribution: 'fixture', canEmbed: true }, textureAssetId: 'asset', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain' as const] })
const area = (id: string, points: { x: number; y: number }[], materialId: string, elevationMm: number) => ({ id, floorId: 'floor', editLocked: false, visibility: 'public' as const, boundaryMm: points.map((positionMm, i) => ({ id: `${id}-p${i}`, segmentId: `${id}-s${i}`, positionMm })), groundElevationMm: elevationMm, coveragePriority: 1, surfaceStyle: { base: { materialRef: { id: materialId, version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }, blocksMovement: materialId.includes('water'), blocksSight: false, movementCostMultiplier: 1 })

function fixture(): SceneDocument {
  const boundary: VisualBoundary = { id: 'coast', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false, closed: false,
    segments: [{ id: 'segment-0', start: { x: 2000, y: 4000 }, control1: { x: 2000, y: 4000 }, control2: { x: 4000, y: 4000 }, end: { x: 4000, y: 4000 } }, { id: 'segment-1', start: { x: 4000, y: 4000 }, control1: { x: 4000, y: 4000 }, control2: { x: 6000, y: 4000 }, end: { x: 6000, y: 4000 } }], sampleSpacingMm: 2000, toleranceMm: 100,
    binding: { kind: 'terrain', sides: [{ areaId: 'sand', startPointId: 'sand-p0', endPointId: 'sand-p2', reverse: false }, { areaId: 'water', startPointId: 'water-p2', endPointId: 'water-p4', reverse: true }] }
  }
  const scene: SceneDocument = { format: 'sceneweave-scene', schemaVersion: 4, sceneId: 'local-fixture', revision: 2, title: 'local', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: { sand: material('sand', ['sand']), water: material('water', ['water']) }, terrainAreas: { sand: area('sand', [{ x: 2000, y: 4000 }, { x: 4000, y: 4000 }, { x: 6000, y: 4000 }, { x: 6000, y: 8000 }, { x: 2000, y: 8000 }], 'sand', 100), water: area('water', [{ x: 2000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 4000, y: 4000 }, { x: 2000, y: 4000 }], 'water', 0) }, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {}, presetSnapshot: { presetId: 'fixture', presetVersion: 1, distanceMode: 'metric', source: 'fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] }, mapMode: 'scene', regional: null,
    generation: createEmptyGeneration5(), visual: { version: 3, base: { version: 2, base: { ...emptyVisualSystem(), boundaries: { coast: boundary } }, materializedEdges: {} }, transitions: {} }
  }
  const row = materializeTerrainTransition(scene, { id: 'shore', boundaryId: 'coast', kind: 'shore', side: 'both', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
  ;(scene.visual as VisualSystem3).transitions[row.id] = row
  return scene
}

describe('T12 local terrain closure', () => {
  it('reports a stable read/write closure and refreshes only the selected transition', () => {
    const scene = fixture(), before = canonicalJson(scene), request = { sceneId: scene.sceneId, scopeMm: { x: 1800, y: 3600, width: 5000, height: 1200 }, transitionIds: ['shore'] as const }
    const dependencies = inspectTerrainLocalDependencies(scene, request), result = prepareTerrainLocalRefresh(scene, request)
    expect(dependencies.transitionIds).toEqual(['shore']); expect(dependencies.writeIds).toContain('shore'); expect(dependencies.haloMm).toBeGreaterThan(0)
    expect(result.changedIds).toEqual(['shore']); expect(result.document.visual?.version).toBe(3); expect(canonicalJson(scene)).toBe(before)
    expect(result.outputHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rejects an explicit transition outside the frozen scope instead of silently returning no work', () => {
    const scene = fixture()
    expect(() => inspectTerrainLocalDependencies(scene, { sceneId: scene.sceneId, scopeMm: { x: 0, y: 0, width: 200, height: 200 }, transitionIds: ['shore'] })).toThrow(/冻结范围/)
    expect(() => inspectTerrainLocalDependencies(scene, { sceneId: scene.sceneId, scopeMm: { x: 0, y: 0, width: 200, height: 200 }, transitionIds: ['missing'] })).toThrow(/不存在/)
  })
  it('selects a source/clip dependency even outside old output pixels and binds source changes', () => {
    const scene = fixture(), request = { sceneId: scene.sceneId, scopeMm: { x: 1100, y: 1100, width: 200, height: 200 } }
    const before = inspectTerrainLocalDependencies(scene, request)
    expect(before.transitionIds).toEqual(['shore'])
    expect(before.readIds).toEqual(expect.arrayContaining(['coast', 'sand', 'water', 'segment-0', 'sand-p0']))
    const next = cloneJson(scene); next.terrainAreas.sand.groundElevationMm += 100
    expect(inspectTerrainLocalDependencies(next, request).inputHash).not.toBe(before.inputHash)
  })
})
