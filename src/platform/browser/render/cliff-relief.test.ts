import { describe, expect, it } from 'vitest'
import type { VisualBoundary } from '../../../shared/visual/types.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import { cliffRelief, naturalRockTreads } from './cliff-relief'

function boundary() {
  const source: VisualBoundary = {
    id: 'cliff', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
    closed: false, sampleSpacingMm: 100, toleranceMm: 10, binding: { kind: 'decoration' },
    segments: [{ id: 'segment', start: { x: 100, y: 200 }, control1: { x: 1300, y: 180 }, control2: { x: 2700, y: 225 }, end: { x: 3900, y: 200 } }],
  }
  return { id: source.id, ...sampleVisualBoundary(source), terrainAreaIds: [] }
}

const look = { id: 'cliff-look', floorId: 'floor', layerId: 'layer', visibility: 'public' as const, editLocked: false,
  boundaryId: 'cliff', kind: 'cliff' as const, side: 'right' as const, widthMm: 900, color: '#65706F', accentColor: '#D3C49A',
  opacity: .94, intensity: .72, seed: 'fixed-island-seed', repeatMm: 320, enabled: true }

describe('deterministic cliff relief', () => {
  it('keeps the original face boundary and derives varied relief from world-space inputs', () => {
    const source = boundary(), first = cliffRelief(source, look, 1), second = cliffRelief(source, look, 1)
    expect(first).toEqual(second)
    expect(first.face.slice(0, source.points.length)).toEqual(source.points)
    expect(first.strata).toHaveLength(4)
    expect(first.facets.length).toBeGreaterThan(first.strata.length)
    expect(first.fractures.length).toBeGreaterThan(0)
    expect(first.erosion.length).toBeGreaterThan(0)
    expect(first.outer.length).toBeGreaterThanOrEqual(source.points.length)
    // The natural face can vary in thickness, but must remain inside its
    // declared paint envelope rather than widening the physical plateau.
    for (const point of first.outer) expect(Math.min(...source.points.map(p => Math.hypot(p.x - point.x, p.y - point.y)))).toBeLessThan(look.widthMm)
  })

  it('keeps every corner of a closed plateau surrounded by a joined face', () => {
    const points = [{x:0,y:0},{x:3000,y:0},{x:3000,y:3000},{x:0,y:3000}]
    const source: VisualBoundary = { id:'closed',floorId:'floor',layerId:'layer',visibility:'public',editLocked:false,closed:true,sampleSpacingMm:100,toleranceMm:10,binding:{kind:'decoration'},
      segments: points.map((start,i) => ({id:`side-${i}`,start,control1:start,control2:points[(i+1)%4],end:points[(i+1)%4]})) }
    const sampled = {...sampleVisualBoundary(source),id:source.id,terrainAreaIds:[]}
    const relief = cliffRelief(sampled,look,-1)
    expect(relief.faceRings).toHaveLength(2)
    expect(relief.faceRings[0]).toEqual(sampled.points)
    // Outward offsets must surround the complete original loop, including the
    // closing side; coarse normal sampling previously cut through corners.
    expect(points.every(point => pointInPolygon(point,relief.outer))).toBe(true)
  })

  it('keeps irregular natural-rock treads inside the route band', () => {
    const width = 1200, length = 4000, frame = { length, at: (distance: number, lateral = 0) => ({ x: distance, y: lateral }) }
    const treads = naturalRockTreads(frame, width, 'stair-seed', 8)
    expect(treads).toHaveLength(8)
    expect(new Set(treads.map(tread => Math.round(tread.lengthMm))).size).toBeGreaterThan(1)
    expect(new Set(treads.map(tread => Math.round(tread.angleRad * 10000))).size).toBeGreaterThan(1)
    for (const tread of treads) for (const point of tread.polygon) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(length)
      expect(Math.abs(point.y)).toBeLessThanOrEqual(width / 2)
    }
    expect(treads.every(tread => tread.polygon.length > 4 && tread.upperEdge.length === 2)).toBe(true)
  })
})
