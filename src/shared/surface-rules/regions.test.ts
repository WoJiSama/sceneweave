import { describe, expect, it } from 'vitest'
import { polygonBooleanWithHoles } from '../geometry/polygon-boolean.js'
import { clipSurfaceRegions } from './regions.js'

const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const polygons = (regions: ReturnType<typeof clipSurfaceRegions>) => regions.map(region => ({ outer: region.outerMm, holes: region.holesMm }))
describe('strict integer surface clipping', () => {
  it('keeps rounded diagonal crossings inside and is stable through repeated command clipping', () => {
    const support = [{ x: 0, y: 0 }, { x: 10000, y: 3001 }, { x: 0, y: 10000 }]
    const input = [{ outerMm: rect(1000, 1000, 8000, 7000), holesMm: [rect(2000, 2000, 500, 500)] }]
    const raw = polygonBooleanWithHoles({ operation: 'intersection', subject: polygons(input), clip: [{ outer: support, holes: [] }] })
    expect(() => polygonBooleanWithHoles({ operation: 'difference', subject: raw.polygons, clip: [{ outer: support, holes: [] }] })).toThrow(/毫米量化/)
    const clipped = clipSurfaceRegions(input, support)
    expect(clipped).toHaveLength(1)
    expect(clipped[0].holesMm).toEqual([[{ x: 2000, y: 2000 }, { x: 2000, y: 2500 }, { x: 2500, y: 2500 }, { x: 2500, y: 2000 }]])
    expect(polygonBooleanWithHoles({ operation: 'difference', subject: polygons(clipped), clip: [{ outer: support, holes: [] }] }).polygons).toEqual([])
    expect(clipSurfaceRegions(clipped, support)).toEqual(clipped)
    expect(input[0].outerMm).toEqual(rect(1000, 1000, 8000, 7000))
  })

  it('retains separate components and holes without filling the gap', () => {
    const input = [{ outerMm: rect(0, 0, 3000, 3000), holesMm: [rect(500, 500, 500, 500)] }, { outerMm: rect(6000, 0, 3000, 3000), holesMm: [] }]
    const clipped = clipSurfaceRegions(input, rect(-1000, -1000, 11000, 5000))
    expect(clipped).toHaveLength(2)
    expect(clipped.map(region => region.holesMm.length)).toEqual([1, 0])
    expect(clipSurfaceRegions(clipped, rect(-1000, -1000, 11000, 5000))).toEqual(clipped)
  })

  it('keeps a corrected crossing within the painted region as well as the support', () => {
    const support = [{ x: 0, y: 0 }, { x: 10000, y: 3001 }, { x: 0, y: 10000 }]
    const input = [{ outerMm: rect(1000, 100, 1000, 1000), holesMm: [] }]
    const clipped = clipSurfaceRegions(input, support)
    expect(clipped[0].outerMm.every(point => point.x >= 1000 && point.x <= 2000 && point.y >= 100 && point.y <= 1100)).toBe(true)
    expect(polygonBooleanWithHoles({ operation: 'difference', subject: polygons(clipped), clip: polygons(input) }).polygons).toEqual([])
    expect(clipSurfaceRegions(clipped, support)).toEqual(clipped)
  })

  it('continues to reject self crossings, touching holes and collapsed millimetre rings', () => {
    const support = rect(0, 0, 10000, 10000)
    expect(() => clipSurfaceRegions([{ outerMm: [{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }, { x: 1000, y: 0 }], holesMm: [] }], support)).toThrow()
    expect(() => clipSurfaceRegions([{ outerMm: rect(0, 0, 1000, 1000), holesMm: [rect(0, 100, 500, 500)] }], support)).toThrow()
    expect(() => clipSurfaceRegions([{ outerMm: [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 0, y: 1 }], holesMm: [] }], rect(9, 0, 1, 1))).toThrow(/毫米量化/)
  })
})
