import { describe, expect, it } from 'vitest'
import { canopyRegionsFromStroke } from './canopy-brush.js'

const surface = [{ x: 0, y: 0 }, { x: 10_000, y: 0 }, { x: 10_000, y: 10_000 }, { x: 0, y: 10_000 }]

describe('canopy brush geometry', () => {
  it('clips a freehand stroke to the explicitly selected terrain surface', () => {
    const regions = canopyRegionsFromStroke([{ x: 9_800, y: 2_000 }, { x: 9_800, y: 8_000 }], 500, surface)
    expect(regions).toHaveLength(1)
    expect(regions[0].every(point => point.x <= 10_000 && point.x >= 0 && point.y >= 0 && point.y <= 10_000)).toBe(true)
    expect(Math.min(...regions[0].map(point => point.x))).toBeGreaterThan(9_000)
    expect(Math.max(...regions[0].map(point => point.x))).toBe(10_000)
  })

  it('creates a bounded round dab from a single click and rejects strokes outside the surface', () => {
    expect(canopyRegionsFromStroke([{ x: 5_000, y: 5_000 }], 500, surface)[0]).toHaveLength(24)
    expect(() => canopyRegionsFromStroke([{ x: 20_000, y: 20_000 }], 500, surface)).toThrow('没有覆盖选定的地形表面')
  })

  it('rejects invalid radii and clipped boundaries that cannot fit the strict v7 ring model', () => {
    expect(() => canopyRegionsFromStroke([{ x: 5_000, y: 5_000 }], 10, surface)).toThrow('100–10000')
    const concave = [{ x: 0, y: 0 }, { x: 10_000, y: 0 }, { x: 10_000, y: 2_000 }, { x: 2_000, y: 2_000 }, { x: 2_000, y: 10_000 }, { x: 0, y: 10_000 }]
    expect(canopyRegionsFromStroke([{ x: 1_000, y: 4_000 }, { x: 4_000, y: 1_000 }], 300, concave).length).toBeGreaterThan(0)
  })
})
