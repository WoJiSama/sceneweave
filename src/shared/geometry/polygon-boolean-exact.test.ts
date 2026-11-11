import { describe, expect, it } from 'vitest'
import { polygonBoolean, polygonBooleanExact } from './polygon-boolean.js'

const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
describe('exact integer polygon output', () => {
  it('preserves exact components, holes and canonical ordering without mutating the request', () => {
    for (const operation of ['union', 'intersection', 'difference'] as const) {
      const request = { operation, subject: [rect(-20, -20, 40, 40)], clip: [rect(-10, -10, 20, 20)] }, before = structuredClone(request)
      expect(polygonBooleanExact(request)).toEqual(polygonBoolean(request))
      expect(request).toEqual(before)
    }
    expect(polygonBooleanExact({ operation: 'intersection', subject: [rect(0, 0, 10, 10)], clip: [rect(20, 20, 10, 10)] }).polygons).toEqual([])
  })
  it('rejects fractional intersections before the existing quantization path can move them', () => {
    const request = { operation: 'intersection', subject: [[{ x: 0, y: 0 }, { x: 10, y: 3 }, { x: 0, y: 10 }]], clip: [rect(1, -1, 7, 12)] }
    expect(() => polygonBooleanExact(request)).toThrow(/非整数毫米交点/)
    expect(polygonBoolean(request).vertexCount).toBeGreaterThan(2)
  })
  it('retains strict input rejection before invoking accessors or repairing malformed rings', () => {
    const point = Object.defineProperty({ y: 0 }, 'x', { enumerable: true, get() { throw new Error('invoked') } })
    expect(() => polygonBooleanExact({ operation: 'union', subject: [[point, { x: 10, y: 0 }, { x: 0, y: 10 }]], clip: [] })).toThrow()
    expect(() => polygonBooleanExact({ operation: 'union', subject: [rect(.5, 0, 10, 10)], clip: [] })).toThrow(/整数/)
  })
})
