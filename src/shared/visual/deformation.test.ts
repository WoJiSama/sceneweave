import { describe, expect, it } from 'vitest'
import type { PointMm, SceneDocument } from '../model/scene.js'
import type { VisualBoundary } from './types.js'
import { emptyVisualSystem } from './types.js'
import { sampleVisualBoundary } from './geometry.js'
import { boundaryDeformationCommand, deformMaterializedEdge, deformVisualBoundary } from './deformation.js'
import { materializedBoundaryHash } from '../terrain-generation/integrity.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { materializeTerrainTransition, validateTerrainTransitions } from './transition.js'
import { applyVisualCommand, inspectVisualChanges } from './commands.js'
import { validateSceneDocument } from '../validation/scene.js'
import { sampleConnectionRoute, type ConnectionRoute } from '../geometry/connection-route.js'
import { applyCommands } from '../commands/commands.js'
import { inspectScene5TransitionChanges, refreshScene5TransitionsAfterPhysicalEdit } from './derived-transitions.js'

const point = (x: number, y: number): PointMm => ({ x, y })
const line = (id: string, start: PointMm, end: PointMm) => ({ id, start, control1: { ...start }, control2: { ...end }, end })
const curve = (): VisualBoundary => ({ id: 'curve', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
  closed: false, sampleSpacingMm: 2000, toleranceMm: 100, binding: { kind: 'decoration' },
  segments: [line('segment-a', point(2000, 4000), point(4000, 4000)), line('segment-b', point(4000, 4000), point(6000, 4000))] })
const context = () => { let i = 0; return { ids: { nextId: () => `deformation-${++i}` }, clock: { now: () => '2026-10-31T00:00:00.000Z' } } }
function fixture(): SceneDocument {
  const bounds = { x: 0, y: 0, width: 8000, height: 8000 }, origin = { kind: 'original' as const, attribution: 'geometry fixture', canEmbed: true }
  const material = (id: string, tag: string) => ({ id, catalogId: id, version: 1, name: id, tags: [tag], licenseRef: 'lic', origin,
    textureAssetId: 'asset', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain' as const] })
  const area = (id: string, points: PointMm[], materialId: string, elevation: number) => ({ id, floorId: 'floor', editLocked: false, visibility: 'public' as const,
    boundaryMm: points.map((positionMm, index) => ({ id: `${id}-p${index}`, segmentId: `${id}-s${index}`, positionMm })), groundElevationMm: elevation, coveragePriority: 1,
    surfaceStyle: { base: { materialRef: { id: materialId, version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world' as const, originMm: point(0, 0), tint: null, opacity: 1 }, overlays: [] },
    blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 })
  const sand = area('sand', [point(2000, 4000), point(4000, 4000), point(6000, 4000), point(6000, 8000), point(2000, 8000)], 'sand-material', 100)
  const water = area('water', [point(2000, 0), point(6000, 0), point(6000, 4000), point(4000, 4000), point(2000, 4000)], 'water-material', 0)
  const boundary = curve(); boundary.binding = { kind: 'terrain', sides: [{ areaId: 'sand', startPointId: 'sand-p0', endPointId: 'sand-p2', reverse: false }, { areaId: 'water', startPointId: 'water-p2', endPointId: 'water-p4', reverse: true }] }
  return { format: 'sceneweave-scene', schemaVersion: 5, sceneId: 'deformation-fixture', revision: 0, title: 'deformation', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {},
    assets: { asset: { id: 'asset', sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'lic', origin } },
    propDefinitions: {}, materials: { 'sand-material': material('sand-material', 'sand'), 'water-material': material('water-material', 'water') }, terrainAreas: { sand, water }, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false }, derived: { id: 'derived', floorId: 'floor', name: 'Derived', order: 1, editLocked: false } }, entityLayers: { sand: 'layer', water: 'layer' },
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'geometry fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] },
    mapMode: 'scene', regional: null, generation: createEmptyGeneration5(), visual: { version: 3, base: { version: 2, base: { ...emptyVisualSystem(), boundaries: { curve: boundary } }, materializedEdges: {} }, transitions: {} } }
}

describe('bounded component control-point deformation', () => {
  it('bends selected controls in world millimetres without modifying source data, endpoints or IDs', () => {
    const before = curve(), original = structuredClone(before)
    const command = boundaryDeformationCommand(before, { kind: 'bend', segmentIds: ['segment-a'], offsetMm: 150 })
    expect(before).toEqual(original); expect(command.type).toBe('upsertVisualBoundary')
    expect(command.boundary.segments[0]).toMatchObject({ id: 'segment-a', start: before.segments[0].start, end: before.segments[0].end, control1: point(2000, 4200), control2: point(4000, 4200) })
    expect(command.boundary.segments[1]).toEqual(before.segments[1]); expect(command.boundary.binding).toEqual(before.binding)
    expect(sampleVisualBoundary(command.boundary).points.some(p => p.y > 4000)).toBe(true)
  })
  it('stretches a local segment and moves the adjacent shared anchor/handle while preserving its far endpoint', () => {
    const before = curve(), next = deformVisualBoundary(before, { kind: 'stretch', segmentIds: ['segment-a'], factor: 1.5, axis: 'tangent', anchor: 'start' })
    expect(next.segments[0].end).toEqual(point(5000, 4000)); expect(next.segments[1].start).toEqual(point(5000, 4000)); expect(next.segments[1].control1).toEqual(point(5000, 4000))
    expect(next.segments[1].end).toEqual(before.segments[1].end); expect(next.segments[1].control2).toEqual(before.segments[1].control2)
    expect(next.segments.map(s => s.id)).toEqual(before.segments.map(s => s.id))
  })
  it('uses an explicit world axis for a closed component and keeps the closing anchor shared', () => {
    const before = curve(), points = [point(1000, 1000), point(3000, 1000), point(3000, 3000), point(1000, 3000)]
    before.closed = true; before.segments = points.map((p, i) => line(`ring-${i}`, p, points[(i + 1) % points.length]))
    const next = deformVisualBoundary(before, { kind: 'stretch', segmentIds: before.segments.map(s => s.id), factor: 2, axis: 'x', anchor: 'center' })
    expect(next.segments[0].start).toEqual(point(0, 1000)); expect(next.segments.at(-1)!.end).toEqual(next.segments[0].start)
    expect(() => deformVisualBoundary(before, { kind: 'stretch', segmentIds: before.segments.map(s => s.id), factor: 2, axis: 'tangent', anchor: 'center' })).toThrow(/世界X或Y/)
  })
  it('rejects stale selections, non-JSON getters and invalid factors before touching input', () => {
    const before = curve(), original = structuredClone(before)
    expect(() => deformVisualBoundary(before, { kind: 'bend', segmentIds: ['gone'], offsetMm: 100 })).toThrow(/仍存在/)
    expect(() => deformVisualBoundary(before, { kind: 'stretch', segmentIds: ['segment-a'], factor: 0, axis: 'x', anchor: 'start' })).toThrow()
    let reads = 0; const bad = Object.defineProperty({ kind: 'bend', segmentIds: ['segment-a'] }, 'offsetMm', { enumerable: true, get() { reads++; return 100 } })
    expect(() => deformVisualBoundary(before, bad as any)).toThrow(/访问器/); expect(reads).toBe(0); expect(before).toEqual(original)
  })
  it('remaps materialized actual geometry and its source hash while retaining fixed paint and world stroke width', () => {
    const before = curve(), after = deformVisualBoundary(before, { kind: 'bend', segmentIds: ['segment-a'], offsetMm: 150 })
    const edge = { id: 'edge', floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public' as const, boundaryId: before.id, inputHash: materializedBoundaryHash(before), kind: 'shore' as const,
      polygons: [], strokes: [{ id: 'edge-stroke', pointsMm: [point(2200, 3900), point(3000, 3900), point(3800, 3900)], widthMm: 60, color: '#112233', opacity: .5 }], materialRef: null, fillColor: '#AABBCC', opacity: .6 }
    const next = deformMaterializedEdge(edge, before, after)
    expect(next.inputHash).toBe(materializedBoundaryHash(after)); expect(next.strokes[0].pointsMm).not.toEqual(edge.strokes[0].pointsMm)
    expect(next.strokes[0]).toMatchObject({ id: 'edge-stroke', widthMm: 60, color: '#112233', opacity: .5 }); expect(next.materialRef).toBe(edge.materialRef)
    expect(() => deformMaterializedEdge({ ...edge, inputHash: '0'.repeat(64) }, before, after)).toThrow(/过期/)
  })
  it('updates terrain samples and a complete transition in one scene5 command with exact reported scope', () => {
    const scene = fixture(); expect(validateSceneDocument(scene).ok).toBe(true)
    if (scene.visual?.version !== 3) throw new Error('Expected visual3')
    scene.visual.transitions.transition = materializeTerrainTransition(scene, { id: 'transition', layerId: 'derived', boundaryId: 'curve', kind: 'shore', side: 'both', widthMm: 200, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
    const old = structuredClone(scene), boundary = scene.visual.base.base.boundaries.curve
    const command = boundaryDeformationCommand(boundary, { kind: 'bend', segmentIds: ['segment-a'], offsetMm: 100 })
    const impact = applyVisualCommand(scene, command, context())
    expect(scene.terrainAreas.sand.boundaryMm).not.toEqual(old.terrainAreas.sand.boundaryMm)
    expect(scene.visual.transitions.transition.inputHash).not.toBe(old.visual?.version === 3 ? old.visual.transitions.transition.inputHash : null)
    expect(validateTerrainTransitions(scene)).toEqual([]); expect(validateSceneDocument(scene).ok).toBe(true)
    expect(impact.changedIds).toEqual(expect.arrayContaining(['curve', 'sand', 'water', 'transition'])); expect(impact.layerIds).toContain('derived')
    expect(inspectVisualChanges(old, scene, [command]).affectedIds).toContain('transition')
  })
  it('honors a transition entity lock and a separate derived layer lock', () => {
    for (const lock of ['entity', 'layer'] as const) {
      const scene = fixture(); if (scene.visual?.version !== 3) throw new Error('Expected visual3')
      const transition = materializeTerrainTransition(scene, { id: 'transition', layerId: 'derived', boundaryId: 'curve', kind: 'shore', side: 'both', widthMm: 200, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
      if (lock === 'entity') transition.editLocked = true; else scene.userLayers.derived.editLocked = true
      scene.visual.transitions.transition = transition
      const command = boundaryDeformationCommand(scene.visual.base.base.boundaries.curve, { kind: 'bend', segmentIds: ['segment-a'], offsetMm: 100 })
      expect(() => applyVisualCommand(scene, command, context())).toThrow(/锁定/)
    }
  })
  it('remaps actual materialized output atomically and counts all expanded points against 256', () => {
    const scene = fixture(); if (scene.visual?.version !== 3) throw new Error('Expected visual3')
    const boundary = scene.visual.base.base.boundaries.curve
    const edge = { id: 'materialized', floorId: 'floor', layerId: 'derived', editLocked: false, visibility: 'public' as const, boundaryId: boundary.id, inputHash: materializedBoundaryHash(boundary), kind: 'shore' as const,
      polygons: [[point(2100, 3900), point(5900, 3900), point(5900, 3950), point(2100, 3950)]], strokes: [], materialRef: null, fillColor: '#AABBCC', opacity: .6 }
    scene.visual.base.materializedEdges[edge.id] = edge
    const before = structuredClone(scene), command = boundaryDeformationCommand(boundary, { kind: 'bend', segmentIds: ['segment-a'], offsetMm: 100 })
    const impact = applyVisualCommand(scene, command, context())
    expect(scene.visual.base.materializedEdges.materialized.inputHash).toBe(materializedBoundaryHash(command.boundary))
    expect(scene.visual.base.materializedEdges.materialized.polygons).not.toEqual(edge.polygons)
    expect(validateSceneDocument(scene).ok).toBe(true); expect(impact.changedIds).toContain('materialized'); expect(impact.layerIds).toContain('derived')
    if (before.visual?.version !== 3) throw new Error('Expected visual3')
    before.visual.base.materializedEdges.materialized.polygons = []
    before.visual.base.materializedEdges.materialized.strokes = [{ id: 'dense-stroke', widthMm: 20, color: '#112233', opacity: .5,
      pointsMm: Array.from({ length: 300 }, (_, index) => point(2200 + index * 4, 3900)) }]
    expect(() => applyVisualCommand(before, command, context())).toThrow(/256/)
  })
  it('refreshes a different transition whose complete shared terrain source changed and checks its lock', () => {
    for (const locked of [false, true]) {
      const scene = fixture(); if (scene.visual?.version !== 3) throw new Error('Expected visual3')
      const first = scene.visual.base.base.boundaries.curve
      first.segments = [first.segments[0]]
      first.binding = { kind: 'terrain', sides: [{ areaId: 'sand', startPointId: 'sand-p0', endPointId: 'sand-p1', reverse: false }, { areaId: 'water', startPointId: 'water-p3', endPointId: 'water-p4', reverse: true }] }
      const other: VisualBoundary = { ...curve(), id: 'other-curve', segments: [line('other-segment', point(4000, 4000), point(6000, 4000))],
        binding: { kind: 'terrain', sides: [{ areaId: 'sand', startPointId: 'sand-p1', endPointId: 'sand-p2', reverse: false }, { areaId: 'water', startPointId: 'water-p2', endPointId: 'water-p3', reverse: true }] } }
      scene.visual.base.base.boundaries[other.id] = other
      for (const [id, boundaryId] of [['transition', first.id], ['other-transition', other.id]]) scene.visual.transitions[id] = materializeTerrainTransition(scene, { id, layerId: 'derived', boundaryId, kind: 'shore', side: 'both', widthMm: 100, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
      const beforeHash = scene.visual.transitions['other-transition'].inputHash
      scene.visual.transitions['other-transition'].editLocked = locked
      const command = boundaryDeformationCommand(first, { kind: 'bend', segmentIds: ['segment-a'], offsetMm: 50 })
      if (locked) expect(() => applyVisualCommand(scene, command, context())).toThrow(/锁定/)
      else {
        const impact = applyVisualCommand(scene, command, context())
        expect(scene.visual.transitions['other-transition'].inputHash).not.toBe(beforeHash)
        expect(impact.changedIds).toContain('other-transition'); expect(impact.affectedIds).toContain('other-curve')
        expect(scene.visual.base.base.boundaries['other-curve']).toEqual(other); expect(validateSceneDocument(scene).ok).toBe(true)
      }
    }
  })
  it('exposes and repairs a real saved-transition counterexample when a new routed opening changes its complete source', () => {
    const before = fixture(); if (before.visual?.version !== 3) throw new Error('Expected visual3')
    before.visual.transitions.transition = materializeTerrainTransition(before, { id: 'transition', layerId: 'derived', boundaryId: 'curve', kind: 'shore', side: 'both', widthMm: 200, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
    const after = structuredClone(before), start = point(3000, 3000), end = point(3000, 5000)
    const controls = { version: 1 as const, kind: 'polyline' as const, segments: [line('route-segment', start, end)], sampleSpacingMm: 1000, toleranceMm: 20, stairStyle: 'stone' as const, treadDepthMm: 250 }
    const route: ConnectionRoute = { ...controls, centerlineMm: sampleConnectionRoute(controls) }
    after.terrainConnections.connection = { id: 'connection', floorId: 'floor', editLocked: false, visibility: 'public', kind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: 'water' }, positionMm: start }, to: { surfaceRef: { kind: 'terrainArea', id: 'sand' }, positionMm: end },
      widthMm: 600, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null, route }
    after.entityLayers.connection = 'layer'
    expect(validateTerrainTransitions(after).some(issue => /HASH|SOURCE/.test(issue.code))).toBe(true)
    const result = refreshScene5TransitionsAfterPhysicalEdit(before, after)
    expect(result.changedIds).toEqual(['transition']); expect(result.affectedIds).toEqual(expect.arrayContaining(['curve', 'sand', 'water', 'connection']))
    expect(result.layerIds).toContain('derived'); expect(result.commandCost).toBeGreaterThan(1)
    expect(validateTerrainTransitions(after)).toEqual([]); expect(validateSceneDocument(after).ok).toBe(true)
    // Opening subtraction belongs to the renderer's filtered connection band;
    // the stored surface geometry stays the same, but its source proof changes.
    expect(after.visual?.version === 3 && after.visual.transitions.transition.inputHash).not.toBe(before.visual.transitions.transition.inputHash)
    expect(after.visual?.version === 3 && after.visual.transitions.transition.outputHash).toBe(before.visual.transitions.transition.outputHash)
    const preserved = JSON.stringify(after)
    expect(inspectScene5TransitionChanges(before, after)).toEqual(result); expect(JSON.stringify(after)).toBe(preserved)
    const priorLock = structuredClone(after)
    if (after.visual?.version !== 3) throw new Error('Expected visual3')
    after.visual.base.base.boundaries.curve.editLocked = true
    expect(() => refreshScene5TransitionsAfterPhysicalEdit(priorLock, after)).not.toThrow()
    expect(validateTerrainTransitions(after)).toEqual([])
    const lockedBefore = structuredClone(before)
    if (lockedBefore.visual?.version !== 3) throw new Error('Expected visual3')
    lockedBefore.visual.base.base.boundaries.curve.editLocked = true
    lockedBefore.visual.transitions.transition = materializeTerrainTransition(lockedBefore, { id: 'transition', layerId: 'derived', boundaryId: 'curve', editLocked: false, kind: 'shore', side: 'both', widthMm: 200, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
    const lockedAfter = structuredClone(lockedBefore)
    lockedAfter.terrainConnections.connection = structuredClone(after.terrainConnections.connection); lockedAfter.entityLayers.connection = 'layer'
    const savedRows = JSON.stringify(lockedAfter.visual)
    expect(() => refreshScene5TransitionsAfterPhysicalEdit(lockedBefore, lockedAfter)).toThrow(/锁定的过渡来源/)
    expect(JSON.stringify(lockedAfter.visual)).toBe(savedRows)
  })
  it('keeps a nonempty transition current across routed connection create, width/route edits and deletion', () => {
    const original = fixture(); if (original.visual?.version !== 3) throw new Error('Expected visual3')
    original.visual.transitions.transition = materializeTerrainTransition(original, { id: 'transition', layerId: 'derived', boundaryId: 'curve', kind: 'shore', side: 'both', widthMm: 200, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
    const initialHash = original.visual.transitions.transition.inputHash, start = point(3000, 3000), end = point(3000, 5000)
    const controls = { version: 1 as const, kind: 'polyline' as const, segments: [line('route-segment', start, end)], sampleSpacingMm: 1000, toleranceMm: 20, stairStyle: 'stone' as const, treadDepthMm: 250 }
    const route: ConnectionRoute = { ...controls, centerlineMm: sampleConnectionRoute(controls) }
    let current = applyCommands(original, [{ type: 'createTerrainConnection', id: 'connection', floorId: 'floor', layerId: 'layer', kind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: 'water' }, positionMm: start }, to: { surfaceRef: { kind: 'terrainArea', id: 'sand' }, positionMm: end }, widthMm: 600, route }], context())
    const transition = (scene: SceneDocument) => { if (scene.visual?.version !== 3) throw new Error('Expected visual3'); return scene.visual.transitions.transition }
    expect(validateTerrainTransitions(current)).toEqual([]); expect(transition(current).inputHash).not.toBe(initialHash)
    const createdHash = transition(current).inputHash
    current = applyCommands(current, [{ type: 'updateTerrainConnection', id: 'connection', changes: { widthMm: 800 } }], context())
    expect(validateTerrainTransitions(current)).toEqual([]); expect(transition(current).inputHash).not.toBe(createdHash)
    const curved = { ...controls, kind: 'cubic' as const, segments: [{ id: 'route-segment', start, control1: point(4500, 3300), control2: point(4500, 4700), end }] }
    const previousHash = transition(current).inputHash
    current = applyCommands(current, [{ type: 'updateTerrainConnection', id: 'connection', changes: { route: { ...curved, centerlineMm: sampleConnectionRoute(curved) } } }], context())
    expect(validateTerrainTransitions(current)).toEqual([]); expect(transition(current).inputHash).not.toBe(previousHash)
    current = applyCommands(current, [{ type: 'deleteOutdoorEntity', kind: 'terrainConnection', id: 'connection' }], context())
    expect(validateTerrainTransitions(current)).toEqual([]); expect(transition(current).inputHash).toBe(initialHash)
    expect(original.terrainConnections).toEqual({}); expect(original.visual.transitions.transition.inputHash).toBe(initialHash)
  })
})
