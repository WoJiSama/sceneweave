import { describe, expect, it } from 'vitest'
import { polygonBoolean, polygonBooleanWithHoles, POLYGON_BOOLEAN_LIMITS, POLYGON_BOOLEAN_WITH_HOLES_LIMITS } from './polygon-boolean.js'
import type { PointMm } from '../model/scene.js'
import { captureExecutionBudget, TASK_BUDGET_PROFILES } from '../budget/task-budget.js'

const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const donut = () => ({ outer: rect(0, 0, 30, 30), holes: [rect(10, 10, 10, 10)] })

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

describe('strict polygon booleans with explicit holes', () => {
  it('preserves hole semantics for union, difference, and intersection', () => {
    const clipped = polygonBooleanWithHoles({ operation: 'intersection', subject: [{ outer: rect(0, 0, 30, 30), holes: [] }], clip: [donut()] })
    expect(clipped.polygons).toHaveLength(1)
    expect(clipped.polygons[0].outer).toEqual(rect(0, 0, 30, 30))
    expect(clipped.polygons[0].holes).toHaveLength(1)

    const filled = polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(0, 0, 30, 30), holes: [] }], clip: [donut()] })
    expect(filled).toEqual({ polygons: [{ outer: rect(0, 0, 30, 30), holes: [] }], vertexCount: 4 })

    const holeRemainder = polygonBooleanWithHoles({ operation: 'difference', subject: [{ outer: rect(0, 0, 30, 30), holes: [] }], clip: [donut()] })
    expect(holeRemainder).toEqual({ polygons: [{ outer: rect(10, 10, 10, 10), holes: [] }], vertexCount: 4 })
  })

  it('allows a disconnected solid inside another component hole', () => {
    const result = polygonBooleanWithHoles({ operation: 'union', subject: [donut(), { outer: rect(12, 12, 6, 6), holes: [] }], clip: [] })
    expect(result.polygons).toHaveLength(2)
    expect(result.polygons[0].holes).toHaveLength(1)
    expect(result.polygons[1]).toEqual({ outer: rect(12, 12, 6, 6), holes: [] })
    expect(result.vertexCount).toBe(12)
  })

  it('normalizes winding and starting vertices without mutating either operand', () => {
    const source = donut()
    const reverseAndRotate = (ring: PointMm[]) => ring.slice(2).concat(ring.slice(0, 2)).reverse()
    const changed = { outer: reverseAndRotate(source.outer), holes: source.holes.map(reverseAndRotate) }
    const request = { operation: 'union', subject: [changed], clip: [] }
    const before = structuredClone(request)
    expect(polygonBooleanWithHoles(request)).toEqual(polygonBooleanWithHoles({ operation: 'union', subject: [source], clip: [] }))
    expect(request).toEqual(before)
  })

  it('allows boundaries from opposite operands to meet', () => {
    const subject = [{ outer: rect(0, 0, 10, 10), holes: [] }], clip = [{ outer: rect(10, 0, 10, 10), holes: [] }]
    expect(polygonBooleanWithHoles({ operation: 'union', subject, clip })).toEqual({ polygons: [{ outer: rect(0, 0, 20, 10), holes: [] }], vertexCount: 4 })
    expect(polygonBooleanWithHoles({ operation: 'intersection', subject, clip })).toEqual({ polygons: [], vertexCount: 0 })
  })

  it('rejects holes outside, touching, or overlapping their containing component', () => {
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(0, 0, 10, 10), holes: [rect(20, 20, 2, 2)] }], clip: [] })).toThrow()
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(0, 0, 10, 10), holes: [rect(0, 2, 2, 2)] }], clip: [] })).toThrow()
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(0, 0, 30, 30), holes: [rect(5, 5, 10, 10), rect(10, 10, 10, 10)] }], clip: [] })).toThrow()
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [donut(), { outer: rect(5, 5, 10, 10), holes: [] }], clip: [] })).toThrow()
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [donut(), { outer: rect(12, 12, 6, 6), holes: [] }, { outer: rect(18, 12, 4, 6), holes: [] }], clip: [] })).toThrow()
  })

  it('rejects excessive total ring count before validating each ring', () => {
    const tooManyHoles = Array.from({ length: POLYGON_BOOLEAN_WITH_HOLES_LIMITS.maxRings }, () => [])
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(0, 0, 10, 10), holes: tooManyHoles }], clip: [] })).toThrow(/输入环数/)
    expect(() => polygonBoolean({ operation: 'union', subject: Array.from({ length: POLYGON_BOOLEAN_LIMITS.maxRings + 1 }, (_, i) => rect(i * 20, 0, 10, 10)), clip: [] })).toThrow(/输入环数/)
  })

  it('admits a full 128-ring rule clipped by support and two full rule operands', () => {
    const holes = Array.from({ length: 127 }, (_, index) => rect(20 + index % 20 * 10, 20 + Math.floor(index / 20) * 10, 2, 2))
    const rule = { outer: rect(0, 0, 5000, 5000), holes }
    const support = { outer: rect(-100, -100, 5200, 5200), holes: [] }
    const clipped = polygonBooleanWithHoles({ operation: 'intersection', subject: [rule], clip: [support] })
    expect(clipped.polygons).toHaveLength(1)
    expect(clipped.polygons[0].holes).toHaveLength(127)
    expect(polygonBooleanWithHoles({ operation: 'intersection', subject: [rule], clip: [structuredClone(rule)] }).polygons[0].holes).toHaveLength(127)
    expect(POLYGON_BOOLEAN_WITH_HOLES_LIMITS).toMatchObject({ maxRings: 256, maxPoints: 16_384, maxOutputPoints: 16_384 })
  })

  it('rejects structured point totals above 16384 before ring geometry validation', () => {
    const oversized = Array.from({ length: 5 }, (_, ringIndex) => Array.from({ length: 3277 }, (_, pointIndex) => ({
      x: ringIndex * 4000 + pointIndex % 3277,
      y: 0,
    })))
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: oversized[0], holes: oversized.slice(1) }], clip: [] })).toThrow(/输入顶点总数不能超过16384/)
  })

  it('rejects malformed structured records and accessor input', () => {
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(0, 0, 10, 10) }], clip: [] })).toThrow()
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(0, 0, 10, 10), holes: [], extra: true }], clip: [] })).toThrow()
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: [{ x: 0.5, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], holes: [] }], clip: [] })).toThrow()
    const getter = Object.defineProperty({ y: 0 }, 'x', { get: () => { throw new Error('getter invoked') }, enumerable: true })
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: [getter, { x: 10, y: 0 }, { x: 0, y: 10 }], holes: [] }], clip: [] })).toThrow()
  })

  it('returns integer-millimetre output and meters geometric validation work', () => {
    const meter = captureExecutionBudget(TASK_BUDGET_PROFILES.small)
    const result = polygonBooleanWithHoles({
      operation: 'intersection',
      subject: [{ outer: rect(0, 0, 10, 10), holes: [] }],
      clip: [{ outer: [{ x: 3, y: -3 }, { x: 13, y: 7 }, { x: 3, y: 17 }, { x: -7, y: 7 }], holes: [] }],
    }, meter)
    expect(result.vertexCount).toBeGreaterThanOrEqual(4)
    expect(result.polygons.flatMap(polygon => [polygon.outer, ...polygon.holes]).flat().every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
    expect(meter.snapshot().intersectionPairs).toBeGreaterThan(0)

    const failingMeter = captureExecutionBudget(TASK_BUDGET_PROFILES.small)
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(0, 0, 10, 10), holes: [rect(0, 2, 2, 2)] }], clip: [] }, failingMeter)).toThrow()
    expect(failingMeter.snapshot().intersectionPairs).toBeGreaterThan(0)
  })

  it('rejects results that collapse during millimetre quantization', () => {
    expect(() => polygonBooleanWithHoles({ operation: 'intersection', subject: [{ outer: [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 0, y: 1 }], holes: [] }], clip: [{ outer: rect(9, 0, 1, 1), holes: [] }] })).toThrow(/毫米量化/)
  })

  it('rejects exhausted execution budgets without returning a partial result', () => {
    const meter = captureExecutionBudget(TASK_BUDGET_PROFILES.small)
    meter.charge({ intersectionPairs: TASK_BUDGET_PROFILES.small.limits.intersectionPairs })
    expect(() => polygonBooleanWithHoles({ operation: 'union', subject: [donut()], clip: [] }, meter)).toThrow(/任务预算超限\[intersectionPairs\]/)
    expect(meter.snapshot().intersectionPairs).toBe(TASK_BUDGET_PROFILES.small.limits.intersectionPairs)
  })
})
