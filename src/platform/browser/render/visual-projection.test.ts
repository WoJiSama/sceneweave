import { describe, expect, it } from 'vitest'
import { createBlankDocumentV2 } from '../../../editor/v2/blank-project'
import { migrateSceneV2 } from '../../../core/v3/migration'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import { projectVisualSystem, projectedWallFootprints } from '../../../shared/visual/projection.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import type { VisualBoundary, VisualFilter, VisualLight } from '../../../shared/visual/types.js'
import { createVisualSampleDocument } from '../content/visual-samples'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { createEmptyGeneration, type MaterializedEdge } from '../../../shared/terrain-generation/contracts.js'
import { materializedBoundaryHash } from '../../../shared/terrain-generation/integrity.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'

function fixture() {
  const old = createBlankDocumentV2({ title: 'visual projection', widthMm: 10000, heightMm: 8000, preset: 'investigation', sceneId: 'visual-projection', now: '2026-10-25T00:00:00.000Z' })
  const scene: SceneDocument = { ...migrateSceneV2(old, { sceneId: 'visual-projection-native', now: old.updatedAt }), format: 'sceneweave-scene', schemaVersion: 1 }
  const projection = projectScene(scene, 'player'), layerId = Object.keys(scene.userLayers)[0]
  const entity = { floorId: Object.keys(scene.floors)[0], layerId, visibility: 'public' as const, editLocked: false }
  const boundary: VisualBoundary = { ...entity, id: 'coast', closed: false, binding: { kind: 'decoration' }, sampleSpacingMm: 500, toleranceMm: 10,
    segments: [{ id: 'curve', start: { x: 1000, y: 1000 }, control1: { x: 1500, y: 1000 }, control2: { x: 2500, y: 1000 }, end: { x: 3000, y: 1000 } }] }
  const light: VisualLight = { ...entity, id: 'light', positionMm: { x: 1000, y: 1000 }, radiusMm: 500, color: '#FFEABB', intensity: .5, wallOcclusion: true, enabled: true }
  const filter: VisualFilter = { ...entity, id: 'filter', target: { kind: 'scene' }, preset: 'warm', exposure: 1, saturation: 1, contrast: 1, vignette: .1, grain: .1, seed: 'filter', enabled: true }
  const visual = emptyVisualSystem(); visual.boundaries.coast = boundary; visual.lights.light = light; visual.filters.filter = filter
  return { scene, projection, visual, entity, boundary, light, filter }
}

function materializedFixture() {
  const original = fixture(), { scene, boundary, entity, projection } = original
  const visual = { version: 2 as const, base: emptyVisualSystem(), materializedEdges: {} as Record<string, MaterializedEdge> }
  scene.schemaVersion = 3; scene.mapMode = 'scene'; scene.generation = createEmptyGeneration(); scene.regional = null; scene.visual = visual
  visual.base.boundaries.coast = boundary
  scene.userLayers['edge-layer'] = { id: 'edge-layer', floorId: entity.floorId, name: 'Edge details', order: Object.keys(scene.userLayers).length, editLocked: false }
  const edge: MaterializedEdge = { ...entity, id: 'materialized-shore', layerId: 'edge-layer', boundaryId: boundary.id,
    inputHash: materializedBoundaryHash(boundary), kind: 'shore', polygons: [[{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }, { x: 3000, y: 1250 }, { x: 1000, y: 1250 }]],
    strokes: [{ id: 'foam-stroke', pointsMm: [{ x: 1000, y: 1200 }, { x: 3000, y: 1200 }], widthMm: 30, color: '#FFFFFF', opacity: .5 }],
    materialRef: null, fillColor: '#DDCCAA', opacity: .8 }
  visual.materializedEdges[edge.id] = edge
  return { scene, boundary, entity, projection, visual, edge }
}

describe('visual projection audience and editor isolation', () => {
  it('keeps shared-room paint order identical after canonical v2 file serialization', () => {
    const scene = createVisualSampleDocument('interior')
    const imported = JSON.parse(canonicalJson(scene)) as SceneDocument
    expect(Object.keys(scene.rooms)).not.toEqual(Object.keys(imported.rooms))
    for (const audience of ['gm', 'player'] as const) {
      expect(projectScene(imported, audience)).toEqual(projectScene(scene, audience))
    }
  })
  it('drops private or disabled effects before making drawable geometry', () => {
    const { scene, projection, visual, light } = fixture()
    visual.lights.secret = { ...light, id: 'secret', visibility: 'gm' }; visual.lights.disabled = { ...light, id: 'disabled', enabled: false }
    visual.boundaries.coast.visibility = 'gm'; visual.filters.filter.visibility = 'gm'
    const player = projectVisualSystem(scene, visual, projection, 'player')
    expect(player.boundaries).toEqual([]); expect(player.filters).toEqual([]); expect(player.lights.map(l => l.id)).toEqual(['light'])
    expect(projectVisualSystem(scene, visual, projection, 'gm').lights.map(l => l.id)).toEqual(['light', 'secret'])
  })
  it('omits hidden-layer effects and lights within final opaque player masks', () => {
    const { scene, projection, visual, entity } = fixture()
    expect(projectVisualSystem(scene, visual, projection, 'gm', new Set([entity.layerId])).lights).toEqual([])
    projection.masks = [[{ x: 500, y: 500 }, { x: 1500, y: 500 }, { x: 1500, y: 1500 }, { x: 500, y: 1500 }]]
    expect(projectVisualSystem(scene, visual, projection, 'player').lights).toEqual([])
    expect(projectVisualSystem(scene, visual, projection, 'gm').lights).toHaveLength(1)
  })
  it('does not sample a shared boundary if any supporting terrain is private or hidden', () => {
    const { scene, projection, visual, boundary } = fixture()
    boundary.binding = { kind: 'terrain', sides: [{ areaId: 'public', startPointId: 'a', endPointId: 'b', reverse: false }, { areaId: 'private', startPointId: 'c', endPointId: 'd', reverse: true }] }
    projection.terrain = [{ id: 'public', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], style: null, elevationMm: 0, priority: 0 }]
    expect(projectVisualSystem(scene, visual, projection, 'player').boundaries).toEqual([])
  })
  it('freezes selective filters to currently visible targets and drops empty private targets', () => {
    const { scene, projection, visual, filter, entity } = fixture()
    projection.terrain = [{ id: 'visible', points: [{ x: 100, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 800 }], style: null, elevationMm: 0, priority: 0 }]
    scene.entityLayers.visible = entity.layerId
    filter.target = { kind: 'entities', ids: ['private', 'visible'] }
    const result = projectVisualSystem(scene, visual, projection, 'player')
    expect(result.filters[0].targetRings).toEqual([projection.terrain[0].points])
    expect(result.filters[0].targetBoundsMm).toEqual({ x: 100, y: 200, width: 500, height: 600 })
    filter.target = { kind: 'entities', ids: ['private'] }
    expect(projectVisualSystem(scene, visual, projection, 'player').filters).toEqual([])
    filter.target = { kind: 'layer', layerId: entity.layerId }
    expect(projectVisualSystem(scene, visual, projection, 'player').filters).toHaveLength(1)
    expect(projectVisualSystem(scene, visual, projection, 'player').filters[0].regionFeatherMm).toBeUndefined()
    filter.target = { kind: 'region', boundaryMm: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 0, y: 2000 }] }
    expect(projectVisualSystem(scene, visual, projection, 'player').filters[0].regionFeatherMm).toBe(320)
  })
  it('computes physical wall occluders with open gaps and closed doors', () => {
    const { projection } = fixture()
    projection.walls = [{ id: 'wall', sourceIds: [], start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, thicknessMm: 100, style: null, blocksLight: true, openings: [{ id: 'door', start: { x: 300, y: 0 }, end: { x: 700, y: 0 }, widthMm: 400, kind: 'door', state: 'open', secret: false }] }]
    expect(projectedWallFootprints(projection)).toHaveLength(2)
    projection.walls[0].openings[0].state = 'closed'
    expect(projectedWallFootprints(projection)).toHaveLength(1)
    projection.walls[0].blocksLight = false
    expect(projectedWallFootprints(projection)).toEqual([])
  })
  it('returns independent disposable geometry and leaves source effects unchanged', () => {
    const { scene, projection, visual } = fixture(), before = structuredClone(visual)
    const result = projectVisualSystem(scene, visual, projection, 'player')
    result.lights[0].positionMm.x = 99999; result.boundaries[0].points[0].x = 99999; result.environment.exposure = 2
    expect(visual).toEqual(before)
    expect(result.boundsMm).toEqual(scene.exportBoundsMm)
  })
})

describe('native visual2 materialized edge projection', () => {
  it('projects complete drawable geometry with no generation/source metadata and owns its disposable copies', () => {
    const { scene, edge } = materializedFixture(), original = canonicalJson(scene), projected = projectScene(scene, 'player')
    expect(projected.visual?.materializedEdges).toEqual([{ id: edge.id, kind: edge.kind, polygons: edge.polygons, strokes: edge.strokes, fillColor: edge.fillColor, opacity: edge.opacity }])
    expect(projected.visual?.edgePaintOrder).toEqual([{ kind: 'materializedEdge', id: edge.id }])
    expect(projected.visual?.materializedEdges?.[0]).not.toHaveProperty('inputHash')
    expect(projected.visual?.materializedEdges?.[0]).not.toHaveProperty('layerId')
    expect(projected).not.toHaveProperty('generation')
    projected.visual!.materializedEdges![0].polygons[0][0].x += 500
    projected.visual!.materializedEdges![0].strokes[0].pointsMm[0].y += 500
    expect(canonicalJson(scene)).toBe(original)
  })

  it('filters private edges and source curves before they enter any paint ordering', () => {
    const { scene, visual, boundary, edge } = materializedFixture()
    edge.visibility = 'gm'
    expect(projectScene(scene, 'player').visual?.materializedEdges).toEqual([])
    expect(projectScene(scene, 'player').visual?.edgePaintOrder).toEqual([])
    expect(projectScene(scene, 'gm').visual?.materializedEdges).toHaveLength(1)
    const withoutPrivate = cloneJson(scene)
    if (withoutPrivate.visual?.version !== 2) throw new Error('fixture requires visual2')
    withoutPrivate.visual.materializedEdges = {}
    expect(projectScene(scene, 'player')).toEqual(projectScene(withoutPrivate, 'player'))
    boundary.visibility = 'gm'; edge.inputHash = materializedBoundaryHash(boundary)
    const privateSource = projectScene(scene, 'player')
    expect(privateSource.visual?.boundaries).toEqual([]); expect(privateSource.visual?.materializedEdges).toEqual([])
    edge.visibility = 'public'
    expect(() => projectScene(scene, 'player')).toThrow(/私密曲线/)
    expect(visual.materializedEdges[edge.id]).toBe(edge)
  })

  it('propagates editor hiding from the edge layer and its source layer while formal output remains unchanged', () => {
    const { scene, entity, edge } = materializedFixture(), formal = projectScene(scene, 'gm')
    expect(projectEditorScene(scene, { hiddenLayerIds: new Set([edge.layerId]) }).visual?.materializedEdges).toEqual([])
    expect(projectEditorScene(scene, { hiddenLayerIds: new Set([entity.layerId]) }).visual?.materializedEdges).toEqual([])
    expect(projectScene(scene, 'gm')).toEqual(formal)
    expect(projectScene(scene, 'player').visual?.materializedEdges).toHaveLength(1)
  })

  it('uses layer then stable ID order across legacy and materialized edges, including after canonical serialization', () => {
    const { scene, visual, entity, edge } = materializedFixture()
    visual.materializedEdges = {
      'z-low-edge': { ...cloneJson(edge), id: 'z-low-edge', layerId: entity.layerId, kind: 'grass', strokes: [] },
      'b-high-edge': { ...cloneJson(edge), id: 'b-high-edge', kind: 'path', strokes: [] },
      'a-high-edge': { ...cloneJson(edge), id: 'a-high-edge', kind: 'shore', strokes: [] },
    }
    visual.base.edgeLooks['a-low-look'] = { ...entity, id: 'a-low-look', boundaryId: edge.boundaryId, kind: 'cliff', side: 'right', widthMm: 200,
      color: '#334455', accentColor: '#DDEEFF', opacity: .8, intensity: .5, seed: 'edge-order', repeatMm: 500, enabled: true }
    const expected = [{ kind: 'edgeLook', id: 'a-low-look' }, { kind: 'materializedEdge', id: 'z-low-edge' },
      { kind: 'materializedEdge', id: 'a-high-edge' }, { kind: 'materializedEdge', id: 'b-high-edge' }]
    for (const audience of ['gm', 'player'] as const) {
      const projection = projectScene(scene, audience)
      expect(projection.visual?.edgePaintOrder).toEqual(expected)
      expect(projection.visual?.materializedEdges?.map(row => row.id)).toEqual(['z-low-edge', 'a-high-edge', 'b-high-edge'])
      expect(projectScene(JSON.parse(canonicalJson(scene)) as SceneDocument, audience)).toEqual(projection)
    }
    scene.userLayers[entity.layerId].order = 1; scene.userLayers['edge-layer'].order = 0
    expect(projectScene(scene, 'player').visual?.edgePaintOrder?.map(row => row.id)).toEqual(['a-high-edge', 'b-high-edge', 'a-low-look', 'z-low-edge'])
  })

  it('suppresses physical outline segments only for visible replacement edges', () => {
    const { scene, visual, boundary, edge, projection } = materializedFixture(), points = sampleVisualBoundary(boundary).points
    projection.edges = [{ id: 'physical-edge', start: points[0], end: points[1], sourceAreaId: 'land', neighborAreaId: null,
      elevationMm: 100, neighborElevationMm: 0, kind: 'cliff', shoreline: false, style: { color: '#334455', strokeWidthMm: 20, bandWidthMm: 100 }, surfaceStyle: null }]
    const project = (hidden?: ReadonlySet<string>) => projectVisualSystem(scene, visual.base, projection, 'player', hidden)
    expect(project().suppressedTerrainEdgeIds).toEqual(['physical-edge'])
    edge.visibility = 'gm'
    expect(project().suppressedTerrainEdgeIds).toEqual([])
    edge.visibility = 'public'
    expect(project(new Set([edge.layerId])).suppressedTerrainEdgeIds).toEqual([])
    boundary.binding = { kind: 'terrain', sides: [{ areaId: 'hidden-support', startPointId: 'first', endPointId: 'last', reverse: false }] }
    expect(project().materializedEdges).toEqual([]); expect(project().suppressedTerrainEdgeIds).toEqual([])
  })

  it('refuses same-purpose legacy and materialized decoration until the legacy look is disabled', () => {
    const { scene, visual, entity, edge } = materializedFixture()
    visual.base.edgeLooks.old = { ...entity, id: 'old', boundaryId: edge.boundaryId, kind: 'shore', side: 'right', widthMm: 200,
      color: '#334455', accentColor: '#DDEEFF', opacity: .8, intensity: .5, seed: 'edge-duplicate', repeatMm: 500, enabled: true }
    expect(() => projectScene(scene, 'gm')).toThrow(/同一曲线用途/)
    visual.base.edgeLooks.old.enabled = false
    expect(projectScene(scene, 'gm').visual?.edgeLooks).toEqual([])
    expect(projectScene(scene, 'gm').visual?.materializedEdges).toHaveLength(1)
  })

  it('rejects visible unsupported material edges without letting private data affect public success', () => {
    const { scene, visual, projection, edge } = materializedFixture()
    edge.materialRef = { id: 'future-material', version: 1 }
    expect(() => projectVisualSystem(scene, visual.base, projection, 'gm')).toThrow(/材质边缘尚未支持/)
    edge.visibility = 'gm'
    expect(projectVisualSystem(scene, visual.base, projection, 'player').materializedEdges).toEqual([])
    expect(projectVisualSystem(scene, visual.base, projection, 'gm', new Set([edge.layerId])).materializedEdges).toEqual([])
  })
})
