import { visualBase } from './base.js'
import { describe, expect, it } from 'vitest'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { validateSceneDocument, sceneDocumentSchema } from '../validation/scene.js'
import { sceneCommandSchema } from '../commands/commands.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { sampleVisualBoundary, visualSampleAtDistance, terrainBoundaryChain } from './geometry.js'
import { emptyVisualSystem, type CubicSegment, type VisualBoundary, type VisualEdgeLook, type VisualLight } from './types.js'
import { inspectVisualPixelBudget } from './diagnostics.js'
import { createEmptyGeneration, type MaterializedEdge } from '../terrain-generation/contracts.js'
import { materializedBoundaryHash } from '../terrain-generation/integrity.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const context = (): PreparationContext => { let id = 0; return { ids: { nextId: () => `curve-new-${id++}` }, clock: { now: () => '2026-10-25T00:00:00.000Z' } } }
function blank(): SceneDocument {
  return { format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'visual-fixture', revision: 0, title: '24×18m coastal visual fixture', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z',
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: true }, exportBoundsMm: { x: 0, y: 0, width: 24000, height: 18000 },
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: { x: 0, y: 0, width: 24000, height: 18000 } } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } }
}
const common = { floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public' as const }
function boundary(segments: CubicSegment[], closed = false): VisualBoundary {
  return { ...common, id: 'coast-curve', closed, segments, sampleSpacingMm: 1500, toleranceMm: 30, binding: { kind: 'decoration' } }
}
function coast(): VisualBoundary {
  return boundary([{ id: 'coast-cubic', start: p(12000, 1000), control1: p(11000, 6000), control2: p(13000, 12000), end: p(12000, 17000) }])
}
function sharedFixture(): { document: SceneDocument; curve: VisualBoundary } {
  const document = applyCommands(blank(), [
    { type: 'createTerrainArea', id: 'sand', floorId: 'floor', layerId: 'layer', boundaryMm: [p(1000, 1000), p(12000, 1000), p(12000, 17000), p(1000, 17000)] },
    { type: 'createTerrainArea', id: 'water', floorId: 'floor', layerId: 'layer', boundaryMm: [p(12000, 1000), p(23000, 1000), p(23000, 17000), p(12000, 17000)] },
  ], context())
  const curve = coast()
  curve.binding = { kind: 'terrain', sides: [
    { areaId: 'sand', startPointId: 'sand:point:1', endPointId: 'sand:point:2', reverse: false },
    { areaId: 'water', startPointId: 'water:point:3', endPointId: 'water:point:0', reverse: true },
  ] }
  return { document, curve }
}
const apply = (document: SceneDocument, ...commands: SceneCommand[]) => applyCommands(document, commands, context())
function edgeLook(id = 'shore-look'): VisualEdgeLook { return { ...common, id, boundaryId: 'coast-curve', kind: 'shore', side: 'right', widthMm: 400, color: '#E8E2B7', accentColor: '#FFFFFF', opacity: .8, intensity: 1, seed: 'test-coast', repeatMm: 1000, enabled: true } }
function light(): VisualLight { return { ...common, id: 'warm-light', positionMm: p(3000, 5000), radiusMm: 2500, color: '#FFD080', intensity: .4, wallOcclusion: true, enabled: true } }

describe('strict visual-v2 model and deterministic curve geometry', () => {
  it('keeps v1 strict and requires visual on v2, including direct schema parsing', () => {
    const source = blank()
    expect(validateSceneDocument(source).ok).toBe(true)
    expect(sceneDocumentSchema.safeParse({ ...source, visual: emptyVisualSystem() }).success).toBe(false)
    expect(sceneDocumentSchema.safeParse({ ...source, schemaVersion: 2 }).success).toBe(false)
    expect(validateSceneDocument({ ...source, schemaVersion: 2, visual: emptyVisualSystem() }).ok).toBe(true)
    expect(sceneDocumentSchema.shape.props).toBeDefined()
  })
  it('samples integer world coordinates with continuous arc length, independent of callers', () => {
    const curve = coast(), result = sampleVisualBoundary(curve), repeated = sampleVisualBoundary(structuredClone(curve))
    expect(result).toEqual(repeated)
    expect(result.points.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
    expect(result.points[0]).toEqual(curve.segments[0].start)
    expect(result.points.at(-1)).toEqual(curve.segments[0].end)
    expect(result.lengthMm).toBeGreaterThan(16000)
    expect(result.samples.every((sample, i, all) => !i || sample.distanceMm > all[i - 1].distanceMm)).toBe(true)
    const middle = visualSampleAtDistance(result, result.lengthMm / 2)
    expect(middle.positionMm.x).toBeCloseTo(12000, 0)
    expect(Math.hypot(middle.normal.x, middle.normal.y)).toBeCloseTo(1, 10)
    expect(middle.normal.x * middle.tangent.x + middle.normal.y * middle.tangent.y).toBeCloseTo(0, 10)
    expect(result.points).toHaveLength(17)
  })
  it('rejects disconnected, noninteger, closing-marker mismatch, folds and self-intersection curves', () => {
    const original = coast()
    const disconnected = structuredClone(original); disconnected.segments.push({ ...disconnected.segments[0], id: 'other', start: p(1, 1) })
    expect(() => sampleVisualBoundary(disconnected)).toThrow(/端点/)
    const fractional = structuredClone(original); fractional.segments[0].control1.x += .5
    expect(() => sampleVisualBoundary(fractional)).toThrow(/整数/)
    expect(() => sampleVisualBoundary({ ...original, closed: true })).toThrow(/闭合/)
    const folded = boundary([{ id: 'fold', start: p(1000, 1000), control1: p(10000, 1000), control2: p(-1000, 1000), end: p(2000, 1000) }])
    expect(() => sampleVisualBoundary(folded)).toThrow(/折返|重复|自交/)
    const crossing = boundary([
      { id: 'one', start: p(1000, 1000), control1: p(2000, 2000), control2: p(4000, 4000), end: p(5000, 5000) },
      { id: 'two', start: p(5000, 5000), control1: p(3000, 5000), control2: p(2000, 5000), end: p(1000, 5000) },
      { id: 'three', start: p(1000, 5000), control1: p(2000, 4000), control2: p(4000, 2000), end: p(5000, 1000) },
    ])
    expect(() => sampleVisualBoundary(crossing)).toThrow(/自交|重复/)
  })
  it('rejects unknown script fields, unsupported filter target kinds and oversized coordinates', () => {
    const source = blank(), l = light()
    expect(sceneCommandSchema.safeParse({ type: 'upsertVisualLight', light: { ...l, script: 'window.x=1' } }).success).toBe(false)
    const curve = coast(); curve.segments[0].control1.x = Number.MAX_SAFE_INTEGER
    expect(() => apply(source, { type: 'upsertVisualBoundary', boundary: curve })).toThrow(/控制点|范围/)
    const v2 = apply(source, { type: 'upsertVisualLight', light: l })
    expect(v2.schemaVersion).toBe(2); expect(source.schemaVersion).toBe(1); expect(source.visual).toBeUndefined()
    const bad = structuredClone(v2); (visualBase(bad)!.lights[l.id] as unknown as Record<string, unknown>).style = {}
    expect(validateSceneDocument(bad).ok).toBe(false)
  })
})

describe('atomic shared boundary, curve/path binding and physical invariants', () => {
  it('updates both coast sides from one source, preserving endpoint IDs and the untouched outer ring', () => {
    const { document, curve } = sharedFixture(), before = structuredClone(document)
    const next = apply(document, { type: 'upsertVisualBoundary', boundary: curve })
    expect(validateSceneDocument(next).ok).toBe(true)
    expect(next.revision).toBe(document.revision)
    expect(document).toEqual(before)
    const sides = curve.binding.kind === 'terrain' ? curve.binding.sides : []
    const left = terrainBoundaryChain(next.terrainAreas.sand, sides[0], false), right = terrainBoundaryChain(next.terrainAreas.water, sides[1], false)
    expect(left.map(point => point.positionMm)).toEqual(right.map(point => point.positionMm).reverse())
    expect(left[0].id).toBe('sand:point:1'); expect(left.at(-1)!.id).toBe('sand:point:2')
    expect(next.terrainAreas.sand.boundaryMm.find(point => point.id === 'sand:point:0')).toEqual(document.terrainAreas.sand.boundaryMm[0])
    expect(apply(next, { type: 'upsertVisualBoundary', boundary: curve })).toEqual(next)
  })
  it('rejects direct sampled-point edits and incomplete one-sided changes without changing the input', () => {
    const { document, curve } = sharedFixture(), next = apply(document, { type: 'upsertVisualBoundary', boundary: curve }), before = structuredClone(next)
    expect(() => apply(next, { type: 'moveTerrainPoint', areaId: 'sand', pointId: 'sand:point:1', positionMm: p(12500, 1000) })).toThrow(/曲线|相交|共边/)
    expect(next).toEqual(before)
    const forged = structuredClone(next); forged.terrainAreas.sand.boundaryMm[2].positionMm.x += 100
    expect(validateSceneDocument(forged).ok).toBe(false)
  })
  it('honors both side locks and recursive note dependencies before any physical change', () => {
    const { document, curve } = sharedFixture(), before = structuredClone(document)
    document.terrainAreas.water.editLocked = true
    expect(() => apply(document, { type: 'upsertVisualBoundary', boundary: curve })).toThrow(/锁定/)
    expect(document.terrainAreas.sand).toEqual(before.terrainAreas.sand)
    document.terrainAreas.water.editLocked = false
    document.notes.note = { id: 'note', floorId: 'floor', editLocked: true, anchor: { type: 'entity', entityKind: 'terrainArea', entityId: 'water' }, kind: 'note', text: 'manual dependency', visibility: 'gm' }; document.entityLayers.note = 'layer'
    expect(() => apply(document, { type: 'upsertVisualBoundary', boundary: curve })).toThrow(/note/)
  })
  it('creates a closed editable island from its unique control source and rejects physical drift', () => {
    let source = apply(blank(), { type: 'createTerrainArea', id: 'island', floorId: 'floor', layerId: 'layer', boundaryMm: [p(12000, 4000), p(17000, 9000), p(12000, 14000), p(7000, 9000)] })
    const k = 2761, curve = boundary([
      { id: 'northeast', start: p(12000, 4000), control1: p(12000 + k, 4000), control2: p(17000, 9000 - k), end: p(17000, 9000) },
      { id: 'southeast', start: p(17000, 9000), control1: p(17000, 9000 + k), control2: p(12000 + k, 14000), end: p(12000, 14000) },
      { id: 'southwest', start: p(12000, 14000), control1: p(12000 - k, 14000), control2: p(7000, 9000 + k), end: p(7000, 9000) },
      { id: 'northwest', start: p(7000, 9000), control1: p(7000, 9000 - k), control2: p(12000 - k, 4000), end: p(12000, 4000) },
    ], true)
    curve.binding = { kind: 'terrain', sides: [{ areaId: 'island', startPointId: 'island:point:0', endPointId: 'island:point:0', reverse: false }] }
    source = apply(source, { type: 'upsertVisualBoundary', boundary: curve })
    expect(validateSceneDocument(source).ok).toBe(true)
    expect(source.terrainAreas.island.boundaryMm[0].id).toBe('island:point:0')
    expect(source.terrainAreas.island.boundaryMm.map(point => point.positionMm)).toEqual(sampleVisualBoundary(curve).points)
    const sample = sampleVisualBoundary(curve)
    expect(sample.samples.at(-1)!.positionMm).toEqual(sample.points[0]); expect(sample.samples.at(-1)!.distanceMm).toBe(sample.lengthMm)
    expect(visualSampleAtDistance(sample, sample.lengthMm + 100)).toEqual(visualSampleAtDistance(sample, 100))
  })
  it('binds a curved road without changing width/support or implying a high-difference crossing', () => {
    const source = apply(blank(), { type: 'createPath', id: 'path', floorId: 'floor', centerlineMm: [p(12000, 1000), p(12000, 17000)], widthMm: 300, supportRefs: [{ kind: 'floor', id: 'floor' }] })
    const curve = coast(); curve.binding = { kind: 'path', pathId: 'path' }
    const next = apply(source, { type: 'upsertVisualBoundary', boundary: curve })
    expect(next.paths.path.centerlineMm).toEqual(sampleVisualBoundary(curve).points)
    expect(next.paths.path.widthMm).toBe(300); expect(next.paths.path.supportRefs).toEqual(source.paths.path.supportRefs)
    expect(() => apply(next, { type: 'updatePath', id: 'path', changes: { centerlineMm: [p(12000, 1000), p(12000, 17000)] } })).toThrow(/曲线采样/)
  })
  it('requires explicit detach, preserves the materialized geometry, and refuses dangling edge looks', () => {
    const { document, curve } = sharedFixture()
    let next = apply(document, { type: 'upsertVisualBoundary', boundary: curve }, { type: 'upsertVisualEdgeLook', edgeLook: edgeLook() })
    const geometry = structuredClone(next.terrainAreas)
    expect(() => apply(next, { type: 'removeVisualBoundary', id: curve.id, detach: false })).toThrow(/detach/)
    expect(() => apply(next, { type: 'removeVisualBoundary', id: curve.id, detach: true })).toThrow(/外观/)
    next = apply(next, { type: 'removeVisualEffect', kind: 'edgeLook', id: 'shore-look' }, { type: 'removeVisualBoundary', id: curve.id, detach: true })
    expect(next.terrainAreas).toEqual(geometry); expect(visualBase(next)!.boundaries).toEqual({})
  })
  it('counts actual point/segment/control expansion and rejects an overbudget shared transaction atomically', () => {
    const { document, curve } = sharedFixture(), before = structuredClone(document)
    curve.sampleSpacingMm = 250; curve.toleranceMm = 1
    expect(() => apply(document, { type: 'upsertVisualBoundary', boundary: curve })).toThrow(/256/)
    expect(document).toEqual(before)
  })
  it('makes every visual geometry step observable to irreversible topology continuity', () => {
    const { document, curve } = sharedFixture(), seen: SceneDocument[] = []
    const result = applyCommands(document, [{ type: 'upsertVisualBoundary', boundary: curve }, { type: 'removeVisualBoundary', id: curve.id, detach: true }], context(), { onOutdoorDraft: draft => seen.push(structuredClone(draft)) })
    expect(seen).toHaveLength(2); expect(visualBase(seen[0])!.boundaries[curve.id]).toEqual(curve); expect(visualBase(seen[1])!.boundaries[curve.id]).toBeUndefined()
    expect(result.terrainAreas.sand.boundaryMm.length).toBeGreaterThan(4)
    const content = createCompositionContent(document, context()), adopted = applyCompositionCommands(content, [{ type: 'upsertVisualBoundary', boundary: curve }], context())
    expect(adopted.historyIdentity.outdoorTokens.sand.topologyToken).not.toBe(content.historyIdentity.outdoorTokens.sand.topologyToken)
  })
})

describe('visual effect safety and bounded workloads', () => {
  it('validates light/fog/filter payloads and preserves physical fields', () => {
    const source = blank(), next = apply(source, { type: 'upsertVisualLight', light: light() }, { type: 'setVisualEnvironment', environment: { ...emptyVisualSystem().environment, ambientColor: '#88AACC', ambientOpacity: .2 } })
    expect(next.floors).toEqual(source.floors); expect(next.walls).toEqual(source.walls); expect(next.props).toEqual(source.props)
    expect(visualBase(next)!.lights['warm-light'].wallOcclusion).toBe(true)
    const filter = { ...common, id: 'grade', target: { kind: 'entities' as const, ids: ['missing'] }, preset: 'warm' as const, exposure: 1, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 'grade', enabled: true }
    expect(() => apply(next, { type: 'upsertVisualFilter', filter })).toThrow(/目标/)
    expect(() => apply(next, { type: 'upsertVisualFog', fog: { ...common, id: 'too-dense', boundaryMm: [p(0, 0), p(24000, 0), p(24000, 18000), p(0, 18000)], color: '#FFFFFF', opacity: .2, directionDeg: 30, scaleMm: 50, seed: 'fog', enabled: true } })).toThrow(/16384/)
  })
  it('checks layer/effect locks, global scope locks and unknown visual identifiers', () => {
    const source = apply(blank(), { type: 'upsertVisualLight', light: light() })
    visualBase(source)!.lights['warm-light'].editLocked = true
    expect(() => apply(source, { type: 'upsertVisualLight', light: light() })).toThrow(/锁定/)
    expect(() => apply(source, { type: 'removeVisualEffect', kind: 'light', id: 'warm-light' })).toThrow(/锁定/)
    const duplicate = structuredClone(source); visualBase(duplicate)!.lights['warm-light'].id = 'not-record-key'
    expect(validateSceneDocument(duplicate).ok).toBe(false)
    const layerLocked = blank(); layerLocked.userLayers.layer.editLocked = true
    expect(() => apply(layerLocked, { type: 'upsertVisualLight', light: light() })).toThrow(/锁定/)
  })
  it('rejects duplicate/shared ownership and draw repetition budget excess', () => {
    const source = apply(blank(), { type: 'upsertVisualBoundary', boundary: coast() })
    const look = edgeLook(); look.repeatMm = 20
    const long = coast(); long.segments[0].start = p(1000, 1000); long.segments[0].end = p(23000, 17000)
    const next = apply(blank(), { type: 'upsertVisualBoundary', boundary: long })
    expect(() => apply(next, { type: 'upsertVisualEdgeLook', edgeLook: look })).toThrow(/1024/)
    const duplicate = structuredClone(source); visualBase(duplicate)!.boundaries.another = { ...structuredClone(coast()), id: 'another' }
    expect(validateSceneDocument(duplicate).ok).toBe(false)
    expect(inspectVisualPixelBudget(source, 4096, 3072).ok).toBe(true)
    expect(inspectVisualPixelBudget(source, 8192, 8192).ok).toBe(false)
  })
})

describe('native visual2 wrapper and persisted edge dependencies', () => {
  const native = (): SceneDocument => ({ ...blank(), schemaVersion: 3, mapMode: 'scene', generation: createEmptyGeneration(), regional: null,
    visual: { version: 2, base: emptyVisualSystem(), materializedEdges: {} } })
  const materialized = (): { scene: SceneDocument; edge: MaterializedEdge } => {
    const scene = native(), curve = coast()
    const edge: MaterializedEdge = { ...common, id: 'materialized-shore', boundaryId: curve.id, inputHash: materializedBoundaryHash(curve), kind: 'shore',
      polygons: [[p(11500, 1000), p(12500, 1000), p(12500, 17000), p(11500, 17000)]], strokes: [], materialRef: null, fillColor: '#AE916A', opacity: .8 }
    if (scene.visual?.version !== 2) throw new Error('Expected native visual2 fixture')
    scene.visual.base.boundaries[curve.id] = curve; scene.visual.materializedEdges[edge.id] = edge
    return { scene, edge }
  }

  it('edits base effects without dropping the native wrapper or generation records', () => {
    const source = native(), before = structuredClone(source)
    const next = apply(source, { type: 'upsertVisualLight', light: light() },
      { type: 'setVisualEnvironment', environment: { ...emptyVisualSystem().environment, ambientOpacity: .2 } })
    expect(next.schemaVersion).toBe(3)
    expect(next.visual).toMatchObject({ version: 2, materializedEdges: {}, base: { version: 1, environment: { ambientOpacity: .2 } } })
    expect(visualBase(next)!.lights['warm-light']).toEqual(light())
    expect(next.generation).toEqual(source.generation); expect(next.mapMode).toBe('scene'); expect(next.regional).toBeNull()
    expect(validateSceneDocument(next).ok).toBe(true); expect(source).toEqual(before)
  })

  it('respects materialized edge locks and rejects source changes without rematerialization', () => {
    const { scene, edge } = materialized()
    expect(validateSceneDocument(scene).ok).toBe(true)
    const curve = structuredClone(visualBase(scene)!.boundaries[edge.boundaryId]); curve.segments[0].control1.x += 100
    edge.editLocked = true
    expect(() => apply(scene, { type: 'upsertVisualBoundary', boundary: curve })).toThrow(/锁定/)
    expect(() => apply(scene, { type: 'setVisualEnvironment', environment: emptyVisualSystem().environment })).toThrow(/锁定/)
    edge.editLocked = false
    const before = structuredClone(scene)
    expect(() => apply(scene, { type: 'upsertVisualBoundary', boundary: curve })).toThrow(/物化边缘/)
    expect(() => apply(scene, { type: 'removeVisualBoundary', id: curve.id, detach: true })).toThrow(/物化边缘/)
    expect(scene).toEqual(before)
  })

  it('rejects a materialized identity that aliases a base visual identity', () => {
    const { scene, edge } = materialized()
    if (scene.visual?.version !== 2) throw new Error('Expected native visual2 fixture')
    delete scene.visual.materializedEdges[edge.id]
    scene.visual.materializedEdges[edge.boundaryId] = { ...edge, id: edge.boundaryId }
    expect(validateSceneDocument(scene).ok).toBe(false)
  })
})
