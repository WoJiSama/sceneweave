import { describe, expect, it } from 'vitest'
import type { BoundsMm } from '../../shared/model/scene'
import { sampleVisualBoundary } from '../../shared/visual/geometry'
import type { VisualBoundary } from '../../shared/visual/types'
import { expandTerrainContourScope } from './terrain-contour-scope'

function boundary(offsetX = 0): VisualBoundary {
  return {
    id: 'shore', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
    closed: false, sampleSpacingMm: 200, toleranceMm: 5, binding: { kind: 'decoration' },
    segments: [{
      id: 'segment', start: { x: offsetX, y: 0 }, control1: { x: offsetX + 1000, y: -2000 },
      control2: { x: offsetX + 2000, y: -2000 }, end: { x: offsetX + 3000, y: 0 },
    }],
  }
}
const scope = { x: 0, y: 0, width: 100, height: 100 }

describe('explicit terrain contour scope expansion', () => {
  it('includes both complete curves and controls outside the sampled curve without changing inputs', () => {
    const original = boundary(), draft = boundary(4000)
    const before = structuredClone({ scope, original, draft })
    expect(Math.min(...sampleVisualBoundary(original).points.map(point => point.y))).toBeGreaterThan(-2000)
    const result = expandTerrainContourScope(scope, original, draft, [])
    expect(result).toEqual({ x: 0, y: -2000, width: 7000, height: 2100 })
    expect({ scope, original, draft }).toEqual(before)
  })

  it('covers the largest enabled band on old and draft samples, ignoring other and disabled bands', () => {
    const original = boundary(), draft = boundary(4000)
    const looks = [
      { boundaryId: 'shore', enabled: true, widthMm: 100, repeatMm: 20 },
      { boundaryId: 'shore', enabled: true, widthMm: 200, repeatMm: 100 },
      { boundaryId: 'shore', enabled: false, widthMm: 5000, repeatMm: 20000 },
      { boundaryId: 'other', enabled: true, widthMm: 5000, repeatMm: 20000 },
    ]
    const before = structuredClone(looks)
    const result = expandTerrainContourScope(scope, original, draft, looks)
    const samples = [original, draft].flatMap(value => sampleVisualBoundary(value).points)
    expect(result).toEqual({
      x: -700, y: Math.min(...samples.map(point => point.y)) - 700,
      width: 8400, height: 1400 - Math.min(...samples.map(point => point.y)),
    })
    expect(looks).toEqual(before)
  })

  it('unions the user scope with the contour instead of shrinking an existing larger scope', () => {
    const original = boundary(), draft = boundary(4000)
    const existing = { x: -12000, y: -9000, width: 15000, height: 11000 }
    expect(expandTerrainContourScope(existing, original, draft, [])).toEqual({ ...existing, width: 19000 })
    const larger = { ...existing, width: 20000 }
    expect(expandTerrainContourScope(larger, original, draft, [])).toEqual(larger)
  })

  it('rejects invalid scopes and oversized results rather than clipping them', () => {
    const original = boundary()
    for (const value of [
      { ...scope, x: .5 }, { ...scope, height: 0 }, { ...scope, width: -1 },
      { ...scope, x: -1_000_000_001 }, { ...scope, width: 1_000_000_001 },
    ]) expect(() => expandTerrainContourScope(value, original, original, [])).toThrow('当前可写范围')
    expect(() => expandTerrainContourScope({ x: -1_000_000_000, y: 0, width: 1, height: 1 }, original, original, [])).toThrow('扩大后的可写范围')
  })

  it('allows legal positive scope origins whose right edge exceeds the coordinate field limit', () => {
    const existing: BoundsMm = { x: 999_999_900, y: 0, width: 200, height: 100 }
    const translated = boundary(999_990_000)
    const result = expandTerrainContourScope(existing, translated, translated, [])
    expect(result).toEqual({ x: 999_990_000, y: -2000, width: 10100, height: 2100 })
  })

  it('keeps specific sampling failures and rejects a missing original or invalid active band', () => {
    const original = boundary(), draft = boundary()
    expect(() => expandTerrainContourScope(scope, undefined, draft, [])).toThrow('原始轮廓')
    expect(() => expandTerrainContourScope(scope, { ...original, id: 'other' }, draft, [])).toThrow('原始轮廓')
    draft.segments[0].control1.x = .5
    expect(() => expandTerrainContourScope(scope, original, draft, [])).toThrow('曲线控制点须为范围内整数毫米')
    expect(() => expandTerrainContourScope(scope, original, original, [{ boundaryId: 'shore', enabled: true, widthMm: -1, repeatMm: 100 }])).toThrow('边带的宽度或重复间距')
  })
})
