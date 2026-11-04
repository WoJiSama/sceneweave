import { describe, expect, it } from 'vitest'
import { snapSubgridPoint } from './subgrid.js'

describe('subgrid snapping', () => {
  it('uses the world-origin lattice without mutating its integer world coordinates', () => {
    const settings = { divisions: 4 as const, anchor: 'intersection' as const }
    const point = { x: 2860, y: -1620 }
    const original = { ...point }
    expect(snapSubgridPoint(point, 1000, settings)).toEqual({ x: 2750, y: -1500 })
    expect(point).toEqual(original)
  })

  it('rounds negative half-anchor ties away from the origin', () => {
    const settings = { divisions: 1 as const, anchor: 'intersection' as const }
    expect(snapSubgridPoint({ x: 500, y: -500 }, 1000, settings)).toEqual({ x: 1000, y: -1000 })
  })

  it('snaps to cell centers and sends the zero tie toward the positive center', () => {
    const settings = { divisions: 2 as const, anchor: 'center' as const }
    expect(snapSubgridPoint({ x: 0, y: -1 }, 1000, settings)).toEqual({ x: 250, y: -250 })
    expect(snapSubgridPoint({ x: 500, y: -500 }, 1000, settings)).toEqual({ x: 750, y: -750 })
  })

  it('quantizes exact odd-grid anchors once without accumulating rounded-step drift', () => {
    const settings = { divisions: 2 as const, anchor: 'intersection' as const }
    expect(snapSubgridPoint({ x: 1499, y: 1501 }, 3001, settings)).toEqual({ x: 1501, y: 1501 })
    expect(snapSubgridPoint({ x: 4500, y: 4500 }, 3001, settings)).toEqual({ x: 4502, y: 4502 })
  })

  it('rejects invalid, unsafe, and duplicate-anchor configurations', () => {
    const settings = { divisions: 8 as const, anchor: 'intersection' as const }
    expect(() => snapSubgridPoint({ x: Number.MAX_SAFE_INTEGER + 1, y: 0 }, 1000, settings)).toThrow(/安全整数/)
    expect(() => snapSubgridPoint({ x: Number.MAX_SAFE_INTEGER, y: 0 }, 4_600_000_000_000_000, { divisions: 1, anchor: 'intersection' })).toThrow(/安全整数毫米/)
    expect(() => snapSubgridPoint({ x: 0, y: 0 }, 7, settings)).toThrow(/重复锚点/)
    expect(() => snapSubgridPoint({ x: 0, y: 0 }, 0, settings)).toThrow(/正整数毫米/)
  })
})
