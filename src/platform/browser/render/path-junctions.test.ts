import { describe, expect, it } from 'vitest'
import type { Path, PointMm, SurfaceStyle } from '../../../shared/model/scene.js'
import type { ProjectedPath, ProjectedSurface, Projection } from '../../../shared/projection/types.js'
import { createRefinedBlankDocument } from '../content/refined-blank.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import { pathPolygon, pointInPolygon } from '../../../shared/geometry/geometry.js'
import { pathJunctionOutlines } from './path-junctions.js'

const p = (x: number, y: number) => ({ x, y })
const edgeStyle = { color: '#554433', strokeWidthMm: 20, bandWidthMm: 100 }
const projected = (id: string, points: PointMm[]): ProjectedPath => ({ id, points, style: null, edgeStyle: { ...edgeStyle } })
const path = (id: string, points: PointMm[], widthMm: number) => projected(id, pathPolygon({ centerlineMm: points, widthMm } as Path))
const totalLength = (segments: [PointMm, PointMm][]) => segments.reduce((sum, [a, b]) => sum + Math.hypot(a.x - b.x, a.y - b.y), 0)
const containsPoint = (segments: [PointMm, PointMm][], point: PointMm) => segments.some(([a, b]) => {
  const dx = b.x - a.x, dy = b.y - a.y, qx = point.x - a.x, qy = point.y - a.y
  return Math.abs(dx * qy - dy * qx) < .001 && qx * dx + qy * dy >= 0 && qx * dx + qy * dy <= dx * dx + dy * dy
})

describe('compatible visible path junction paint', () => {
  it.each([
    [path('east', [p(0, 0), p(3000, 0)], 1000), path('north', [p(0, 0), p(0, -3000)], 1200)],
    [path('east', [p(-3000, 0), p(3000, 0)], 1000), path('north', [p(0, 0), p(0, -3000)], 1200)],
    [path('east', [p(-3000, 0), p(3000, 0)], 1000), path('north', [p(0, -3000), p(0, 3000)], 1200)],
  ])('removes interior caps at elbows, T joins and crossings while preserving physical bands', (a, b) => {
    const paths = [a, b], before = JSON.stringify(paths), outlines = pathJunctionOutlines({ paths, pathJoinGroups: [[a.id, b.id]] })
    expect(JSON.stringify(paths)).toBe(before)
    expect(outlines.size).toBe(2)
    for (const current of paths) {
      const segments = outlines.get(current.id)!, other = current === a ? b : a
      expect(totalLength(segments)).toBeGreaterThan(0)
      expect(totalLength(segments)).toBeLessThan(totalLength(current.points.map((a, i) => [a, current.points[(i + 1) % current.points.length]])))
      for (const [a, b] of segments) expect(pointInPolygon(p((a.x + b.x) / 2, (a.y + b.y) / 2), other.points, false)).toBe(false)
    }
  })

  it('owns coincident exterior edges once and retains holes in a ring of roads', () => {
    const rect = (id: string, x: number, y: number, w: number, h: number) => projected(id, [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)])
    const paths = [rect('top', 0, 0, 4000, 1000), rect('bottom', 0, 3000, 4000, 1000), rect('left', 0, 0, 1000, 4000), rect('right', 3000, 0, 1000, 4000)]
    const outlines = pathJunctionOutlines({ paths, pathJoinGroups: [paths.map(path => path.id)] })
    expect([...outlines.values()].reduce((sum, segments) => sum + totalLength(segments), 0)).toBe(24000)
    const duplicates = pathJunctionOutlines({ paths: [paths[0], { ...paths[0], id: 'copy' }], pathJoinGroups: [['top', 'copy']] })
    expect(totalLength(duplicates.get('top')!)).toBe(0)
    expect(totalLength(duplicates.get('copy')!)).toBe(10000)
  })

  it('keeps incompatible paints, isolated groups and entity filters independent', () => {
    const a = path('a', [p(0, 0), p(3000, 0)], 1000), b = path('b', [p(0, 0), p(0, -3000)], 1000)
    expect(pathJunctionOutlines({ paths: [a, b], pathJoinGroups: [['a'], ['b']] }).size).toBe(0)
    expect(pathJunctionOutlines({ paths: [a, { ...b, edgeStyle: { ...edgeStyle, color: '#665544' } }], pathJoinGroups: [['a', 'b']] }).size).toBe(0)
    const style: SurfaceStyle = { base: { materialRef: { id: 'road', version: 1 }, tileSizeMm: { width: 1000, height: 1000 },
      rotationDeg: 0, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] }
    expect(pathJunctionOutlines({ paths: [{ ...a, style }, { ...b, style: { ...style, base: { ...style.base, rotationDeg: 90 } } }], pathJoinGroups: [['a', 'b']] }).size).toBe(0)
    expect(pathJunctionOutlines({ paths: [{ ...a, style }, { ...b, style: { ...style, base: { ...style.base, opacity: .5 } } }], pathJoinGroups: [['a', 'b']] }).size).toBe(0)
    const visual = { filters: [{ sourceEntityIds: ['b'] }] } as Projection['visual']
    expect(pathJunctionOutlines({ paths: [a, b], pathJoinGroups: [['a', 'b']], visual }).size).toBe(0)
  })

  it.each(['different paint', 'transparent paint', 'entity filter', 'different height'] as const)('keeps a compatible seam through a public %s road painted between peers', change => {
    const same: SurfaceStyle = { base: { materialRef: { id: 'road', version: 1 }, tileSizeMm: { width: 1000, height: 1000 },
      rotationDeg: 0, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] }
    const different: SurfaceStyle = { ...same, base: { ...same.base, ...(change === 'transparent paint' ? { opacity: .5 }
      : change === 'different paint' ? { tint: '#8899AA' } : {}) } }
    const rect = (id: string, left: number, top: number, width: number, height: number, style: SurfaceStyle): ProjectedPath => ({
      id, points: [p(left, top), p(left + width, top), p(left + width, top + height), p(left, top + height)], style, edgeStyle: { ...edgeStyle },
    })
    const under = rect('under', -3000, -500, 6000, 1000, same)
    const overlay = rect('overlay', 0, -250, 3000, 500, different)
    const crossing = rect('crossing', -500, -3000, 1000, 6000, same)
    const projection = { paths: [under, overlay, crossing], pathJoinGroups: [change === 'different height' ? ['under', 'crossing'] : ['under', 'overlay', 'crossing']],
      pathJoinPaintOrder: ['under', 'overlay', 'crossing'],
      ...(change === 'entity filter' ? { visual: { filters: [{ sourceEntityIds: ['overlay'] }] } as Projection['visual'] } : {}) }
    const outlines = pathJunctionOutlines(projection)
    const crossingEdges = outlines.get('crossing')!
    expect(containsPoint(crossingEdges, p(-500, 0))).toBe(false)
    expect(containsPoint(crossingEdges, p(500, 0))).toBe(true)
    expect(containsPoint(crossingEdges, p(500, 400))).toBe(false)
    // Splitting includes the incompatible cover's endpoints; the remainder of
    // the same road still has its ordinary visible exterior.
    expect(containsPoint(crossingEdges, p(500, 1000))).toBe(true)
    const camp: ProjectedSurface = { id: 'camp', points: [p(-4000, -4000), p(4000, -4000), p(4000, 4000), p(-4000, 4000)],
      style: same, elevationMm: 0, priority: 1 }
    const withCamp = { ...projection, terrain: [camp], rooms: [], pathTerrainJoins: { terrainPaintOrder: ['camp'], roomIds: [], paths: [{ pathId: crossing.id, terrainIds: ['camp'] }] } }
    expect(containsPoint(pathJunctionOutlines(withCamp).get('crossing')!, p(500, 0))).toBe(true)
  })

  it('does not let private roads change public seams, and fails closed on a missing public paint owner', () => {
    const under = path('under', [p(-3000, 0), p(3000, 0)], 1000)
    const crossing = path('crossing', [p(0, -3000), p(0, 3000)], 1000)
    const projection = { paths: [under, crossing], pathJoinGroups: [['under', 'crossing']], pathJoinPaintOrder: ['under', 'crossing'] }
    const original = pathJunctionOutlines(projection)
    projection.paths.splice(1, 0, { ...path('private', [p(-3000, 0), p(3000, 0)], 1000), edgeStyle: { ...edgeStyle, color: '#AB3344' } })
    expect(pathJunctionOutlines(projection)).toEqual(original)
    projection.paths[1].points = path('private', [p(1000, -1000), p(1000, 1000)], 800).points
    expect(pathJunctionOutlines(projection)).toEqual(original)
    projection.pathJoinPaintOrder.push('missing-public-path')
    expect(pathJunctionOutlines(projection).size).toBe(0)
  })
})

describe('path join projection ownership', () => {
  function scene() {
    const scene = createRefinedBlankDocument('island', { sceneId: 'path-join-test', title: 'Path joins', now: '2026-11-06T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
    const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
    for (const [id, end] of [['a', p(8000, 6000)], ['b', p(6000, 8000)]] as const) {
      scene.paths[id] = { id, floorId, editLocked: false, visibility: 'public', centerlineMm: [p(6000, 6000), end], widthMm: 1000,
        supportRefs: [{ kind: 'floor', id: floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
      scene.entityLayers[id] = layerId
    }
    return scene
  }

  it('joins same-height public roads across visible editing layers without changing saved bands', () => {
    const source = scene(), before = JSON.stringify(source), gm = projectScene(source, 'gm'), player = projectScene(source, 'player')
    expect(gm.pathJoinGroups).toEqual([['a', 'b']]); expect(player.pathJoinGroups).toEqual(gm.pathJoinGroups)
    expect(gm.paths.map(path => path.points)).toEqual(Object.values(source.paths).map(pathPolygon))
    expect(JSON.stringify(source)).toBe(before)
    const originalLayer = source.entityLayers.b, next = 'path-other-layer'
    const layer = source.userLayers[originalLayer]
    source.userLayers[next] = { ...layer, id: next, order: Object.values(source.userLayers).filter(candidate => candidate.floorId === layer.floorId).length }
    source.entityLayers.b = next
    expect(projectScene(source, 'gm').pathJoinGroups).toEqual([['a', 'b']])
    const joined = projectScene(source, 'player')
    expect(pathJunctionOutlines(joined).size).toBe(2)
    expect(joined.pathJoinPaintOrder).toEqual(['a', 'b'])
    expect(projectEditorScene(source, { hiddenLayerIds: new Set([next]) }).pathJoinGroups).toBeUndefined()
    expect(projectEditorScene(source, { hiddenLayerIds: new Set([next]) }).paths.map(path => path.id)).toEqual(['a'])
  })

  it('never lets a private path change public joins or leak a hidden ID/geometry', () => {
    const source = scene(), privateId = 'SECRET-ROAD-JUNCTION'
    source.paths[privateId] = { ...source.paths.b, id: privateId, visibility: 'gm', centerlineMm: [p(5000, 5000), p(9000, 5000)] }
    const publicLayer = source.userLayers[source.entityLayers.a]
    source.userLayers['private-road-layer'] = { ...publicLayer, id: 'private-road-layer', order: Object.values(source.userLayers).filter(layer => layer.floorId === publicLayer.floorId).length }
    source.entityLayers[privateId] = 'private-road-layer'
    source.regions.mask = { id: 'mask', floorId: source.paths.a.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: [p(0, 0), p(24000, 0), p(24000, 18000), p(0, 18000)], blocksMovement: false, movementCostMultiplier: 1 }
    source.entityLayers.mask = source.entityLayers.a
    const gm = projectScene(source, 'gm'), player = projectScene(source, 'player')
    expect(gm.pathJoinGroups).toEqual([['a', 'b']]); expect(player.pathJoinGroups).toEqual([['a', 'b']])
    expect(gm.pathJoinPaintOrder).toEqual(['a', 'b']); expect(player.pathJoinPaintOrder).toEqual(['a', 'b'])
    expect(JSON.stringify(player)).not.toContain(privateId)
    const before = JSON.stringify(player)
    source.paths[privateId].centerlineMm = [p(5000, 4000), p(9000, 4000)]
    expect(JSON.stringify(projectScene(source, 'player'))).toBe(before)
  })

  it('keeps different heights, graded paths and private supports out of public joins', () => {
    const source = scene(), floorId = source.paths.a.floorId, layerId = source.entityLayers.a
    source.terrainAreas['raised'] = { id: 'raised', floorId, editLocked: false, visibility: 'public',
      boundaryMm: [p(12000, 2000), p(20000, 2000), p(20000, 16000), p(12000, 16000)].map((point, index) => ({ id: `raised-point-${index}`, segmentId: `raised-segment-${index}`, positionMm: point })),
      groundElevationMm: 1200, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    source.entityLayers.raised = layerId
    source.paths.b.centerlineMm = [p(14000, 6000), p(14000, 8000)]
    source.paths.b.supportRefs = [{ kind: 'terrainArea', id: 'raised' }]
    expect(projectScene(source, 'player').pathJoinGroups).toBeUndefined()
    source.paths.b.supportRefs.push({ kind: 'floor', id: floorId })
    expect(projectScene(source, 'player').pathJoinGroups).toBeUndefined()
    source.terrainAreas.raised.groundElevationMm = 0
    expect(projectScene(source, 'player').pathJoinGroups).toEqual([['a', 'b']])
    source.terrainAreas.raised.visibility = 'gm'
    expect(projectScene(source, 'gm').pathJoinGroups).toBeUndefined()
    source.regions.mask = { id: 'mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: [p(11000, 1000), p(21000, 1000), p(21000, 17000), p(11000, 17000)], blocksMovement: false, movementCostMultiplier: 1 }
    source.entityLayers.mask = layerId
    const player = projectScene(source, 'player')
    expect(player.pathJoinGroups).toBeUndefined()
    expect(player.paths.map(path => path.id)).toEqual(['a'])
  })
})

describe('same-paint road and camp exterior', () => {
  const style: SurfaceStyle = { base: { materialRef: { id: 'loam', version: 2 }, tileSizeMm: { width: 2000, height: 2000 },
    rotationDeg: 0, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] }
  const rectangle = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
  function fixture() {
    const road = { ...path('road', [p(-3000, 0), p(2000, 0)], 1000), style: structuredClone(style) }
    const camp: ProjectedSurface = { id: 'camp', points: rectangle(0, -2000, 4000, 4000), style: structuredClone(style), elevationMm: 0, priority: 1 }
    return { paths: [road], terrain: [camp], rooms: [] as ProjectedSurface[], pathTerrainJoins: { terrainPaintOrder: ['camp'], roomIds: [] as string[], paths: [{ pathId: road.id, terrainIds: ['camp'] }] } }
  }
  it('removes the internal end cap and side lines while preserving road geometry and saved paint', () => {
    const projection = fixture(), before = JSON.stringify(projection), segments = pathJunctionOutlines(projection).get('road')!
    expect(segments).toBeTruthy()
    expect(totalLength(segments)).toBe(8000)
    expect(segments.every(([a, b]) => (a.x + b.x) / 2 <= 0)).toBe(true)
    expect(segments.some(([a, b]) => a.x === -3500 && b.x === -3500)).toBe(true)
    expect(JSON.stringify(projection)).toBe(before)
  })
  it('keeps edges exposed by an incompatible higher public surface and clips only the visible matching part', () => {
    const projection = fixture(), cover = { ...structuredClone(projection.terrain[0]), id: 'cover', points: rectangle(500, -2000, 3500, 4000), priority: 2,
      style: { ...structuredClone(style), base: { ...style.base, tint: '#BBAA88' } } }
    projection.terrain.push(cover); projection.pathTerrainJoins.terrainPaintOrder.push('cover')
    const segments = pathJunctionOutlines(projection).get('road')!
    expect(totalLength(segments)).toBe(13000)
    expect(segments.some(([a, b]) => a.x === 2500 && b.x === 2500)).toBe(true)
    expect(segments.some(([a, b]) => a.x === 0 && b.x === 500 || a.x === 500 && b.x === 0)).toBe(false)
  })
  it('requires the exact opaque world paint with no overlay or rule patch conflict', () => {
    const changes = [
      (value: ReturnType<typeof fixture>) => { value.paths[0].style.base.opacity = .8 },
      (value: ReturnType<typeof fixture>) => { value.terrain[0].style!.base.opacity = .8 },
      (value: ReturnType<typeof fixture>) => { value.paths[0].style.base.rotationDeg = 90 },
      (value: ReturnType<typeof fixture>) => { value.paths[0].style.base.originMm.x = 10 },
      (value: ReturnType<typeof fixture>) => { value.paths[0].style.base.alignment = 'surface' },
      (value: ReturnType<typeof fixture>) => { value.terrain[0].style!.overlays.push({ id: 'paint', paint: structuredClone(style.base), boundaryMm: rectangle(0, 0, 100, 100), blendWidthMm: 0, renderOrder: 0 }) },
      (value: ReturnType<typeof fixture>) => { value.paths[0].style.overlays.push({ id: 'paint', paint: structuredClone(style.base), boundaryMm: rectangle(0, 0, 100, 100), blendWidthMm: 0, renderOrder: 0 }) },
      (value: ReturnType<typeof fixture>) => { value.terrain[0].materialPatches = [{ regionsMm: [{ outerMm: rectangle(0, 0, 100, 100), holesMm: [] }], paint: structuredClone(style.base), blendWidthMm: 0 }] },
    ]
    for (const change of changes) {
      const projection = fixture(); change(projection)
      expect(pathJunctionOutlines(projection).size).toBe(0)
    }
    for (const id of ['road', 'camp']) {
      const projection = { ...fixture(), visual: { filters: [{ sourceEntityIds: [id] }] } as Projection['visual'] }
      expect(pathJunctionOutlines(projection).size).toBe(0)
    }
  })
  it('does not consume private or hidden terrain, and fails closed if a public cover was dropped downstream', () => {
    const projection = fixture(), original = pathJunctionOutlines(projection)
    projection.terrain.push({ ...structuredClone(projection.terrain[0]), id: 'private-or-hidden', points: rectangle(-4000, -3000, 8000, 6000), style: null, priority: 9 })
    expect(pathJunctionOutlines(projection)).toEqual(original)
    projection.pathTerrainJoins.terrainPaintOrder.push('missing-public-cover')
    expect(pathJunctionOutlines(projection).size).toBe(0)
  })
  it('does not erase through a room painted over the matching terrain', () => {
    const projection = fixture()
    projection.rooms.push({ ...structuredClone(projection.terrain[0]), id: 'room', points: rectangle(-100, -2500, 4500, 5000) })
    projection.pathTerrainJoins.roomIds.push('room')
    expect(pathJunctionOutlines(projection).size).toBe(0)
  })
})
