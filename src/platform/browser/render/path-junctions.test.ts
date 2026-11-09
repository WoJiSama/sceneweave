import { describe, expect, it } from 'vitest'
import type { Path, PointMm, SurfaceStyle } from '../../../shared/model/scene.js'
import type { ProjectedPath, Projection } from '../../../shared/projection/types.js'
import { createRefinedBlankDocument } from '../content/refined-blank.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import { pathPolygon, pointInPolygon } from '../../../shared/geometry/geometry.js'
import { pathJunctionOutlines } from './path-junctions.js'

const p = (x: number, y: number) => ({ x, y })
const edgeStyle = { color: '#554433', strokeWidthMm: 20, bandWidthMm: 100 }
const projected = (id: string, points: PointMm[]): ProjectedPath => ({ id, points, style: null, edgeStyle: { ...edgeStyle } })
const path = (id: string, points: PointMm[], widthMm: number) => projected(id, pathPolygon({ centerlineMm: points, widthMm } as Path))
const totalLength = (segments: [PointMm, PointMm][]) => segments.reduce((sum, [a, b]) => sum + Math.hypot(a.x - b.x, a.y - b.y), 0)

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

  it('groups only same-layer visible paths and changes neither bands nor saved data', () => {
    const source = scene(), before = JSON.stringify(source), gm = projectScene(source, 'gm'), player = projectScene(source, 'player')
    expect(gm.pathJoinGroups).toEqual([['a', 'b']]); expect(player.pathJoinGroups).toEqual(gm.pathJoinGroups)
    expect(gm.paths.map(path => path.points)).toEqual(Object.values(source.paths).map(pathPolygon))
    expect(JSON.stringify(source)).toBe(before)
    const originalLayer = source.entityLayers.b, next = 'path-other-layer'
    const layer = source.userLayers[originalLayer]
    source.userLayers[next] = { ...layer, id: next, order: Object.values(source.userLayers).filter(candidate => candidate.floorId === layer.floorId).length }
    source.entityLayers.b = next
    expect(projectScene(source, 'gm').pathJoinGroups).toBeUndefined()
    expect(projectEditorScene(source, { hiddenLayerIds: new Set([next]) }).paths.map(path => path.id)).toEqual(['a'])
  })

  it('never lets a private path change public joins or leak a hidden ID/geometry', () => {
    const source = scene(), privateId = 'SECRET-ROAD-JUNCTION'
    source.paths[privateId] = { ...source.paths.b, id: privateId, visibility: 'gm', centerlineMm: [p(5000, 5000), p(9000, 5000)] }
    source.entityLayers[privateId] = source.entityLayers.a
    source.regions.mask = { id: 'mask', floorId: source.paths.a.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: [p(0, 0), p(24000, 0), p(24000, 18000), p(0, 18000)], blocksMovement: false, movementCostMultiplier: 1 }
    source.entityLayers.mask = source.entityLayers.a
    const gm = projectScene(source, 'gm'), player = projectScene(source, 'player')
    expect(gm.pathJoinGroups).toEqual([['a', 'b']]); expect(player.pathJoinGroups).toEqual([['a', 'b']])
    expect(JSON.stringify(player)).not.toContain(privateId)
    const before = JSON.stringify(player)
    source.paths[privateId].centerlineMm = [p(5000, 4000), p(9000, 4000)]
    expect(JSON.stringify(projectScene(source, 'player'))).toBe(before)
  })
})
