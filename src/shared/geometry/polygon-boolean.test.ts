import { describe, expect, it } from 'vitest'
import { polygonBoolean } from './polygon-boolean.js'
import type { PointMm } from '../model/scene.js'

const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]

describe('strict polygon booleans', () => {
  it('keeps disconnected solids and produces deterministic ordering', () => {
    const first = polygonBoolean({ operation: 'union', subject: [rect(20, 0, 10, 10), rect(0, 0, 10, 10)], clip: [] })
    const second = polygonBoolean({ operation: 'union', subject: [rect(0, 0, 10, 10), rect(20, 0, 10, 10)], clip: [] })
    expect(first).toEqual(second)
    expect(first.polygons).toHaveLength(2)
    expect(first.vertexCount).toBe(8)
  })

  it('unions overlapping solids, subtracts a punch and intersects a split', () => {
    expect(polygonBoolean({ operation: 'union', subject: [rect(0, 0, 10, 10), rect(5, 0, 10, 10)], clip: [] }).polygons[0].outer).toHaveLength(4)
    const punched = polygonBoolean({ operation: 'difference', subject: [rect(0, 0, 20, 20)], clip: [rect(5, 5, 10, 10)] })
    expect(punched.polygons).toHaveLength(1)
    expect(punched.polygons[0].holes).toHaveLength(1)
    const split = polygonBoolean({ operation: 'intersection', subject: [rect(0, 0, 10, 10)], clip: [rect(-5, 0, 6, 10), rect(4, 0, 6, 10)] })
    expect(split.polygons.length).toBe(2)
    expect(polygonBoolean({ operation: 'difference', subject: [rect(0, 0, 10, 10)], clip: [rect(20, 20, 2, 2)] }).polygons).toHaveLength(1)
  })

  it('unions subject and clip without losing their non-overlapping extents', () => {
    const result = polygonBoolean({ operation: 'union', subject: [rect(0, 0, 10, 10)], clip: [rect(5, 0, 10, 10)] })
    expect(result).toEqual({ polygons: [{ outer: rect(0, 0, 15, 10), holes: [] }], vertexCount: 4 })
  })

  it('intersects every disconnected clip component without joining the gap', () => {
    const result = polygonBoolean({ operation: 'intersection', subject: [rect(0, 0, 30, 20)], clip: [rect(20, -5, 5, 30), rect(5, -5, 5, 30)] })
    expect(result).toEqual({ polygons: [
      { outer: rect(5, 0, 5, 20), holes: [] },
      { outer: rect(20, 0, 5, 20), holes: [] },
    ], vertexCount: 8 })
  })

  it('rounds fractional crossings only when the integer result remains valid', () => {
    const result = polygonBoolean({ operation: 'intersection', subject: [rect(0, 0, 10, 10)], clip: [[{ x: 3, y: -3 }, { x: 13, y: 7 }, { x: 3, y: 17 }, { x: -7, y: 7 }]] })
    expect(result.vertexCount).toBeGreaterThanOrEqual(4)
    expect(result.polygons[0].outer.every(point => Number.isInteger(point.x) && Number.isInteger(point.y))).toBe(true)
  })

  it('rejects malformed, self-crossing, touching and budget-excess inputs', () => {
    expect(() => polygonBoolean({ operation: 'union', subject: [[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }]], clip: [] })).toThrow()
    expect(() => polygonBoolean({ operation: 'union', subject: [rect(0, 0, 10, 10)], clip: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]] })).toThrow()
    const getter = Object.defineProperty({ y: 0 }, 'x', { get: () => { throw new Error('getter invoked') }, enumerable: true })
    expect(() => polygonBoolean({ operation: 'union', subject: [[getter, { x: 10, y: 0 }, { x: 0, y: 10 }]], clip: [] })).toThrow()
    const tooMany = Array.from({ length: 129 }, (_, i) => rect(i * 20, 0, 10, 10))
    expect(() => polygonBoolean({ operation: 'union', subject: tooMany, clip: [] })).toThrow()
  })

  it('returns an empty result for empty intersections and preserves extreme coordinates', () => {
    expect(polygonBoolean({ operation: 'intersection', subject: [rect(0, 0, 2, 2)], clip: [] })).toEqual({ polygons: [], vertexCount: 0 })
    expect(polygonBoolean({ operation: 'union', subject: [], clip: [] })).toEqual({ polygons: [], vertexCount: 0 })
    expect(polygonBoolean({ operation: 'union', subject: [rect(-1_000_000_000, -1_000_000_000, 10, 10)], clip: [] }).vertexCount).toBe(4)
  })
})
