import { describe, expect, it } from 'vitest'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import type { VisualBoundary, VisualEdgeLook } from '../../../shared/visual/types.js'
import { grassEdgeRings } from './grass-edge.js'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'

const source: VisualBoundary = { id: 'arbitrary-edge', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
  closed: false, sampleSpacingMm: 100, toleranceMm: 10, binding: { kind: 'decoration' },
  segments: [{ id: 'line', start: { x: 0, y: 0 }, control1: { x: 1000, y: 0 }, control2: { x: 2000, y: 0 }, end: { x: 3000, y: 0 } }] }
const look: VisualEdgeLook = { ...source, id: 'grass', boundaryId: source.id, kind: 'grass', side: 'left', widthMm: 500,
  color: '#63855A', accentColor: '#B6C785', opacity: .8, intensity: .7, seed: 'world-phase', repeatMm: 240, enabled: true }
const boundary = () => ({ id: source.id, ...sampleVisualBoundary(source), terrainAreaIds: [] })

describe('world-space grass seam', () => {
  it('varies reach within the saved side and width without changing source geometry', () => {
    const input = boundary(), before = structuredClone(input)
    const rings = grassEdgeRings(input, look, 1, .85)
    expect(rings).toEqual(grassEdgeRings(input, look, 1, .85))
    const outer = rings[0].slice(input.points.length)
    expect(new Set(outer.map(point => Math.round(point.y))).size).toBeGreaterThan(4)
    expect(outer.every(point => point.x >= 0 && point.x <= 3000 && point.y > 0 && point.y <= look.widthMm * .85)).toBe(true)
    expect(input).toEqual(before)
    const opposite = grassEdgeRings(input, look, -1, .85)[0].slice(input.points.length)
    expect(opposite).toEqual(outer.map(point => ({ x: point.x, y: -point.y })))
  })

  it.each([-1, 1])('keeps narrow closed bands on their declared side at coarse repeats (%s)', side => {
    const corners = [{x:0,y:0},{x:3000,y:0},{x:3000,y:3000},{x:0,y:3000}]
    const loop = { ...source, closed:true, sampleSpacingMm:20000,
      segments:corners.map((start,i) => ({id:`side-${i}`,start,control1:start,control2:corners[(i+1)%4],end:corners[(i+1)%4]})) }
    const closed = { id:loop.id,...sampleVisualBoundary(loop),terrainAreaIds:[] }
    const rings = grassEdgeRings(closed, { ...look, widthMm:20,repeatMm:2000 }, side, .85)
    expect(rings).toHaveLength(2)
    expect(rings[0]).toEqual(closed.points)
    expect(rings[1].length).toBeLessThanOrEqual((1024 + 512) * 2)
    expect(rings[1].flatMap(point => [point.x, point.y]).every(Number.isFinite)).toBe(true)
    // Check entire straight edges as well as vertices: a chord skipping a
    // corner could have outward endpoints and still cut deeply inside.
    for (let i=0;i<rings[1].length;i++) {
      const a=rings[1][i],b=rings[1][(i+1)%rings[1].length]
      for (const t of [0,.25,.5,.75]) expect(pointInPolygon({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},corners,false)).toBe(side>0)
    }
  })
})
