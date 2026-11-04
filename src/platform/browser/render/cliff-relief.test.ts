import { describe, expect, it } from 'vitest'
import type { VisualBoundary } from '../../../shared/visual/types.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
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
    expect(first.outer).toHaveLength(Math.max(4, Math.ceil(source.lengthMm / (look.repeatMm * 2.5))) + 1)
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
  })
})
