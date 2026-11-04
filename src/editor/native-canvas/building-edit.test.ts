import { describe, expect, it } from 'vitest'
import { finishOrthogonalBoundary, normalizeSketchPoint, wallDragOffset } from './building-session.js'

describe('orthogonal room drawing', () => {
  it('snaps first, then locks each next point to its dominant world axis without changing the draft', () => {
    const points = [{ x: 1000, y: -1000 }], tool = { kind: 'orthogonal' as const, points, snapMm: 100 }
    expect(normalizeSketchPoint(tool, { x: 2640, y: -540 })).toEqual({ x: 2600, y: -1000 })
    expect(normalizeSketchPoint(tool, { x: 1450, y: 1850 })).toEqual({ x: 1000, y: 1900 })
    expect(normalizeSketchPoint(tool, { x: 1500, y: -500 })).toEqual({ x: 1500, y: -1000 })
    expect(points).toEqual([{ x: 1000, y: -1000 }])
  })

  it('preserves free polygons and snaps the first orthogonal point normally', () => {
    expect(normalizeSketchPoint({ kind: 'orthogonal', points: [], snapMm: 100 }, { x: -150, y: 250 })).toEqual({ x: -200, y: 300 })
    expect(normalizeSketchPoint({ kind: 'polygon', points: [{ x: 100, y: 100 }], snapMm: 100 }, { x: 255, y: 355 })).toEqual({ x: 300, y: 400 })
  })

  it('closes three vertices by one explicit perpendicular turn, preserving drawn coordinates', () => {
    const points = [{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 4000 }]
    expect(finishOrthogonalBoundary(points)).toEqual([...points, { x: 1000, y: 4000 }])
    expect(points).toHaveLength(3)
    expect(finishOrthogonalBoundary([{ x: 1000, y: 1000 }, { x: 1000, y: 4000 }, { x: 5000, y: 4000 }])).toEqual([
      { x: 1000, y: 1000 }, { x: 1000, y: 4000 }, { x: 5000, y: 4000 }, { x: 5000, y: 1000 },
    ])
  })

  it('preserves an already orthogonal closure and accepts a repeated terminal start only once', () => {
    const points = [{ x: -4000, y: -3000 }, { x: 0, y: -3000 }, { x: 0, y: 0 }, { x: -4000, y: 0 }]
    expect(finishOrthogonalBoundary(points)).toEqual(points)
    expect(finishOrthogonalBoundary([...points, points[0]])).toEqual(points)
  })

  it('rejects diagonal, repeated, backtracking and self-crossing boundaries instead of repairing them silently', () => {
    expect(() => finishOrthogonalBoundary([{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }])).toThrow(/水平或垂直/)
    expect(() => finishOrthogonalBoundary([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }])).toThrow(/重复顶点/)
    expect(() => finishOrthogonalBoundary([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: -1000, y: 0 }, { x: -1000, y: 1000 }])).toThrow(/折返/)
    expect(() => finishOrthogonalBoundary([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 2000, y: 4000 }, { x: 2000, y: -1000 }, { x: 0, y: -1000 }])).toThrow(/自交|自接触/)
  })
})

describe('wall drag displacement', () => {
  it('quantizes the gesture from its original pointer in integer millimetres without accumulating intermediate steps', () => {
    const original = { x: 3351, y: -4000 }
    expect(wallDragOffset(original, { x: 3500, y: -4050 }, 100)).toEqual({ x: 100, y: -100 })
    expect(wallDragOffset(original, { x: 3600, y: -3850 }, 100)).toEqual({ x: 200, y: 200 })
    expect(original).toEqual({ x: 3351, y: -4000 })
  })

  it('rejects unsafe coordinates, differences and steps before producing a drag candidate', () => {
    expect(() => wallDragOffset({ x: Number.MAX_SAFE_INTEGER + 1, y: 0 }, { x: 0, y: 0 }, 100)).toThrow(/安全整数/)
    expect(() => wallDragOffset({ x: -Number.MAX_SAFE_INTEGER, y: 0 }, { x: Number.MAX_SAFE_INTEGER, y: 0 }, 100)).toThrow(/超出安全整数/)
    expect(() => wallDragOffset({ x: 0, y: 0 }, { x: 1, y: 1 }, 0)).toThrow(/正整数/)
  })
})
