import { describe, expect, it } from 'vitest'
import { applyCommands } from '../commands/commands.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { validateSceneDocument } from '../validation/scene.js'
import { naturalContourSegments, naturalizeVisualBoundary, roadContourSegments, joinRoadContourEndpoints } from './natural-contours.js'
import { assertSimpleVisualPolyline, sampleVisualBoundary, signedVisualArea } from './geometry.js'
import { pointInPolygon, polylineBand } from '../geometry/geometry.js'
import type { VisualBoundary } from './types.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const context = () => { let serial = 0; return { ids: { nextId: () => `natural-${++serial}` }, clock: { now: () => '2026-11-12T00:00:00.000Z' } } }
const sample = (points: PointMm[], closed: boolean, kind: 'smooth' | 'natural' = 'smooth') => {
  const segments = naturalContourSegments(points, { closed, kind, seed: 'fixed-coast', idPrefix: 'shore', strength: .85 })
  return { segments, ...sampleVisualBoundary({ segments, closed, sampleSpacingMm: 1000, toleranceMm: 20 }) }
}
const boundary = (points: PointMm[], closed = false): VisualBoundary => ({ id: 'boundary', floorId: 'floor', layerId: 'layer',
  visibility: 'public', editLocked: false, closed, segments: naturalContourSegments(points, { closed, kind: 'smooth', strength: 0 }),
  sampleSpacingMm: 2000, toleranceMm: 40, binding: { kind: 'decoration' } })
function blank(): SceneDocument {
  return toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'natural-fixture', revision: 0, title: 'Natural contours',
    createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z', units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false },
    exportBoundsMm: { x: 0, y: 0, width: 24000, height: 18000 }, floors: { floor: { id: 'floor', name: 'Ground', boundsMm: { x: 0, y: 0, width: 24000, height: 18000 } } },
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {}, vertices: {}, walls: {}, rooms: {}, props: {},
    openings: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } })
}

describe('explicit natural contour authoring', () => {
  it('turns a right-angle road into a sampled curve while preserving both endpoint directions and anchors', () => {
    const original = [p(2000, 3000), p(8000, 3000), p(8000, 9000)], before = structuredClone(original)
    const result = sample(original, false)
    expect(original).toEqual(before)
    expect(result.points[0]).toEqual(original[0]); expect(result.points.at(-1)).toEqual(original.at(-1))
    expect(result.segments[0].control1.y).toBe(original[0].y)
    expect(result.segments.at(-1)!.control2.x).toBe(original.at(-1)!.x)
    expect(result.points.some(point => point.y < 3000)).toBe(true)
    expect(result.points.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
    // Source corner now has one continuous tangent, instead of two perpendicular ones.
    const a = result.segments[0], b = result.segments[1]
    const va = p(a.end.x - a.control2.x, a.end.y - a.control2.y), vb = p(b.control1.x - b.start.x, b.control1.y - b.start.y)
    expect(va.x * vb.y - va.y * vb.x).toBe(0)
  })
  it('adds deterministic bounded intermediate shoreline rhythm rather than more collinear polygon points', () => {
    const ring = [p(4000, 3000), p(15000, 2500), p(18000, 9000), p(12000, 14000), p(3000, 11000)]
    const a = sample(ring, true, 'natural'), b = sample(ring, true, 'natural')
    expect(a).toEqual(b); expect(a.segments.length).toBeGreaterThan(ring.length)
    expect(Math.sign(signedVisualArea(a.points))).toBe(Math.sign(signedVisualArea(ring)))
    const different = naturalContourSegments(ring, { closed: true, kind: 'natural', seed: 'another' })
    expect(different).not.toEqual(a.segments)
    expect(a.segments.filter(segment => !ring.some(point => point.x === segment.start.x && point.y === segment.start.y)).length).toBeGreaterThan(0)
  })
  it('preserves existing stable segment IDs, endpoints and bindings during a draft change', () => {
    const original = boundary([p(5000, 3000), p(9000, 6000), p(5000, 13000)])
    original.binding = { kind: 'terrain', sides: [{ areaId: 'shore', startPointId: 'point-a', endPointId: 'point-b', reverse: false }] }
    const before = structuredClone(original), after = naturalizeVisualBoundary(original, { kind: 'natural', seed: 'fixed' })
    expect(original).toEqual(before); expect(after.binding).toEqual(original.binding)
    expect(after.segments.map(({ id, start, end }) => ({ id, start, end }))).toEqual(original.segments.map(({ id, start, end }) => ({ id, start, end })))
    expect(after.segments.map(segment => segment.control1)).not.toEqual(original.segments.map(segment => segment.control1))
    expect(sampleVisualBoundary(after).points).not.toEqual(sampleVisualBoundary(original).points)
  })
  it('uses the normal bound-path transaction and honors locks without mutating its baseline', () => {
    const points = [p(3000, 4000), p(9000, 4000), p(9000, 10000)]
    const source = applyCommands(blank(), [{ type: 'createPath', id: 'road', floorId: 'floor', layerId: 'layer', centerlineMm: points,
      widthMm: 1000, supportRefs: [{ kind: 'floor', id: 'floor' }] }], context())
    const curve = boundary(points); curve.binding = { kind: 'path', pathId: 'road' }
    const draft = naturalizeVisualBoundary(curve, { kind: 'smooth', strength: .8 }), before = structuredClone(source)
    const after = applyCommands(source, [{ type: 'upsertVisualBoundary', boundary: draft }], context())
    expect(validateSceneDocument(after).ok).toBe(true)
    expect(after.paths.road.centerlineMm).toEqual(sampleVisualBoundary(draft).points)
    expect(after.paths.road.widthMm).toBe(source.paths.road.widthMm)
    expect(after.paths.road.supportRefs).toEqual(source.paths.road.supportRefs)
    expect(source).toEqual(before)
    source.paths.road.editLocked = true
    expect(() => applyCommands(source, [{ type: 'upsertVisualBoundary', boundary: draft }], context())).toThrow(/锁定/)
    expect(source.paths.road.centerlineMm).toEqual(points)
  })
  it('does not repair folds, self-intersections, invalid coordinates or oversized requests silently', () => {
    expect(() => sample([p(0, 0), p(4000, 4000), p(0, 4000), p(4000, 0)], false)).toThrow(/自交/)
    expect(() => sample([p(0, 0), p(4000, 0), p(1000, 0)], false)).toThrow(/折返|自交/)
    expect(() => sample([p(0, 0), p(4000.5, 0)], false)).toThrow(/整数/)
    expect(() => naturalContourSegments([p(0, 0), p(2000, 0)], { closed: false, kind: 'smooth', strength: 2 })).toThrow(/强度/)
    const tooMany = Array.from({ length: 34 }, (_, index) => p(index * 1000, 1000))
    expect(() => sample(tooMany, false)).toThrow(/32/)
  })
  it('rounds short real-width road corners with circular fillets instead of a through-anchor cusp', () => {
    const points = [p(19674, 18201), p(19674, 19601), p(26000, 22600)]
    const unsafe = naturalContourSegments(points, { closed: false, kind: 'smooth', strength: .92 })
    const oldSamples = sampleVisualBoundary({ segments: unsafe, closed: false, sampleSpacingMm: 900, toleranceMm: 20 }).points
    expect(() => assertSimpleVisualPolyline(polylineBand(oldSamples, 1400, true), true)).toThrow()
    const segments = roadContourSegments(points, { widthMm: 1400, idPrefix: 'fillet' })
    const samples = sampleVisualBoundary({ segments, closed: false, sampleSpacingMm: 900, toleranceMm: 20 }).points
    expect(() => assertSimpleVisualPolyline(polylineBand(samples, 1400, true), true)).not.toThrow()
    expect(segments[0].start).toEqual(points[0]); expect(segments.at(-1)!.end).toEqual(points.at(-1))
    expect(segments[0].control1.x).toBe(points[0].x)
    expect(segments.some(segment => segment.start.x === points[1].x && segment.start.y === points[1].y)).toBe(false)
    expect(() => roadContourSegments([p(0,0),p(600,0),p(600,3000)], { widthMm: 1600 })).toThrow(/净宽/)
  })
  it('joins two shared road ends in one tangent corner while retaining unrelated controls and both bindings', () => {
    const a = boundary([p(5200,31000),p(10900,28500),p(20200,25900),p(26000,22600)])
    const b = boundary([p(19674,18201),p(19674,19601),p(26000,22600)])
    a.id = 'road-a'; a.binding = { kind: 'path', pathId: 'path-a' }
    b.id = 'road-b'; b.binding = { kind: 'path', pathId: 'path-b' }
    a.segments = roadContourSegments(a.segments.map(segment => segment.start).concat([a.segments.at(-1)!.end]), { widthMm: 1700, idPrefix: 'a' })
    b.segments = roadContourSegments(b.segments.map(segment => segment.start).concat([b.segments.at(-1)!.end]), { widthMm: 1400, idPrefix: 'b' })
    a.sampleSpacingMm = 900; a.toleranceMm = 20; b.sampleSpacingMm = 900; b.toleranceMm = 20
    const beforeA = structuredClone(a), beforeB = structuredClone(b)
    const result = joinRoadContourEndpoints(a, b, { widthMm: 1700, secondWidthMm: 1400, idPrefix: 'join' })
    expect(a).toEqual(beforeA); expect(b).toEqual(beforeB)
    expect(result.first.binding).toEqual(a.binding); expect(result.second.binding).toEqual(b.binding)
    expect(result.first.segments.slice(0,-3)).toEqual(a.segments.slice(0,-2))
    expect(result.first.segments[0]).toEqual(a.segments[0])
    expect(result.first.segments.at(-1)!.end).toEqual(result.second.segments.at(-1)!.end)
    expect(result.junctionMm).not.toEqual(p(26000,22600))
    const sa = sampleVisualBoundary(result.first).points, sb = sampleVisualBoundary(result.second).points
    expect(() => assertSimpleVisualPolyline(polylineBand(sa, 1700, true), true)).not.toThrow()
    expect(() => assertSimpleVisualPolyline(polylineBand(sb, 1400, true), true)).not.toThrow()
    const all = [...sa, ...sb.slice(0,-1).reverse()]
    expect(() => assertSimpleVisualPolyline(polylineBand(all, 1700, true), true)).not.toThrow()
    const detached = structuredClone(b); detached.segments.at(-1)!.end.x++
    expect(() => joinRoadContourEndpoints(a, detached, {widthMm:1700,secondWidthMm:1400})).toThrow(/相接/)
  })
  it('adopts both joined physical roads atomically and rejects a locked partner without changing either road', () => {
    const pointsA = [p(3000,3000),p(10000,3000)], pointsB = [p(10000,10000),p(10000,3000)]
    const source = applyCommands(blank(), [{ type: 'createPath', id: 'path-a', floorId: 'floor', layerId: 'layer', centerlineMm: pointsA,
      widthMm: 1000, supportRefs: [{kind:'floor',id:'floor'}] }, { type: 'createPath', id: 'path-b', floorId: 'floor', layerId: 'layer', centerlineMm: pointsB,
      widthMm: 1200, supportRefs: [{kind:'floor',id:'floor'}] }], context())
    const a = boundary(pointsA), b = boundary(pointsB)
    b.segments.forEach(segment => { segment.id = `b-${segment.id}` })
    a.id = 'curve-a'; a.binding = {kind:'path',pathId:'path-a'}; b.id = 'curve-b'; b.binding = {kind:'path',pathId:'path-b'}
    const draft = joinRoadContourEndpoints(a, b, {widthMm:1000,secondWidthMm:1200,idPrefix:'joined'})
    const commands = [{type:'upsertVisualBoundary' as const,boundary:draft.first},{type:'upsertVisualBoundary' as const,boundary:draft.second}]
    const after = applyCommands(source, commands, context())
    expect(validateSceneDocument(after).ok).toBe(true)
    expect(after.paths['path-a'].centerlineMm.at(-1)).toEqual(after.paths['path-b'].centerlineMm.at(-1))
    for (const id of ['path-a','path-b']) {
      expect(after.paths[id].widthMm).toBe(source.paths[id].widthMm); expect(after.paths[id].supportRefs).toEqual(source.paths[id].supportRefs)
    }
    source.paths['path-b'].editLocked = true; const before = structuredClone(source)
    expect(() => applyCommands(source, commands, context())).toThrow(/锁定/)
    expect(source).toEqual(before)
  })
  it.each([
    { name: 'diagonal creek approach', a: [p(5200,31000),p(10900,28500),p(20200,25900),p(26000,22600)], b: [p(19674,18201),p(19674,19601),p(26000,22600)], secondEnd: 'end' as const, clearanceWidthMm: 1700 },
    { name: 'short coastal access', a: [p(1400,27200),p(6000,26750),p(11100,24400),p(16400,23800),p(20700,23200),p(24000,21500)], b: [p(24000,21500),p(24000,20000),p(23900,18700)], secondEnd: 'start' as const, clearanceWidthMm: 1800 },
  ])('puts both actual equal-width square caps inside the opposite road for $name', ({ a: pointsA, b: pointsB, secondEnd, clearanceWidthMm }) => {
    const widthMm = 1400, a = boundary(pointsA), b = boundary(pointsB)
    a.id = 'cap-a'; b.id = 'cap-b'; a.binding = {kind:'path',pathId:'path-a'}; b.binding = {kind:'path',pathId:'path-b'}
    a.segments = roadContourSegments(pointsA, {widthMm, strength:1, idPrefix:'a'})
    b.segments = roadContourSegments(pointsB, {widthMm, strength:1, idPrefix:'b'})
    a.sampleSpacingMm = b.sampleSpacingMm = 900; a.toleranceMm = b.toleranceMm = 20
    const result = joinRoadContourEndpoints(a, b, {widthMm,secondWidthMm:widthMm,secondEnd,clearanceWidthMm,idPrefix:'caps'})
    const sa = sampleVisualBoundary(result.first).points, rawB = sampleVisualBoundary(result.second).points
    const sb = secondEnd === 'start' ? rawB.slice().reverse() : rawB
    const va = p(sa.at(-1)!.x-sa.at(-2)!.x,sa.at(-1)!.y-sa.at(-2)!.y), vb = p(sb.at(-1)!.x-sb.at(-2)!.x,sb.at(-1)!.y-sb.at(-2)!.y)
    expect(va.x*vb.y-va.y*vb.x).toBe(0); expect(va.x*vb.x+va.y*vb.y).toBeLessThan(0)
    expect(Math.hypot(va.x,va.y)).toBeGreaterThan(widthMm/2+40)
    const cap = (points: PointMm[]) => {
      const end = points.at(-1)!, previous = points.at(-2)!, length = Math.hypot(end.x-previous.x,end.y-previous.y)
      const dx = (end.x-previous.x)/length, dy = (end.y-previous.y)/length, r = widthMm/2
      return [0,r/2,r].flatMap(along => [-r,0,r].map(across => p(end.x+dx*along-dy*across,end.y+dy*along+dx*across)))
    }
    expect(cap(sa).every(point => pointInPolygon(point,polylineBand(sb,widthMm,true)))).toBe(true)
    expect(cap(sb).every(point => pointInPolygon(point,polylineBand(sa,widthMm,true)))).toBe(true)
    expect(() => assertSimpleVisualPolyline(polylineBand(sa,clearanceWidthMm,true),true)).not.toThrow()
    expect(() => assertSimpleVisualPolyline(polylineBand(sb,clearanceWidthMm,true),true)).not.toThrow()
    expect(() => joinRoadContourEndpoints(a,b,{widthMm,secondWidthMm:widthMm,secondEnd,clearanceWidthMm:1000})).toThrow(/净空/)
    expect(result.first.segments[0].start).toEqual(a.segments[0].start)
    expect(secondEnd === 'start' ? result.second.segments.at(-1)!.end : result.second.segments[0].start)
      .toEqual(secondEnd === 'start' ? b.segments.at(-1)!.end : b.segments[0].start)
    expect(result.first.segments[0].control1.x-result.first.segments[0].start.x).toBe(a.segments[0].control1.x-a.segments[0].start.x)
  })
})
