import { afterEach, describe, expect, it, vi } from 'vitest'
import { drawSurfaceRuleMask } from './canvas-renderer.js'

afterEach(() => vi.unstubAllGlobals())

describe('native v8 surface-rule material mask', () => {
  it('fills every component with even-odd holes, world coordinates and the stored feather width', () => {
    class PathMock {
      rings: number[][] = []
      moveTo(x: number, y: number) { this.rings.push([x, y]) }
      lineTo(x: number, y: number) { this.rings.push([x, y]) }
      closePath() { this.rings.push([-1, -1]) }
    }
    vi.stubGlobal('Path2D', PathMock)
    const calls: unknown[][] = [], state = { fillStyle: '', filter: '' }
    const ctx = Object.assign(state, {
      setTransform: vi.fn(), fill: vi.fn((...args: unknown[]) => calls.push(args)),
    }) as unknown as CanvasRenderingContext2D
    drawSurfaceRuleMask(ctx, { x: 100, y: 200, width: 1000, height: 500 }, 200, 100, [
      { outerMm: [{ x: 100, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 500 }], holesMm: [[{ x: 200, y: 250 }, { x: 250, y: 250 }, { x: 250, y: 300 }]] },
      { outerMm: [{ x: 600, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 500 }], holesMm: [] },
    ], 20)
    expect(ctx.setTransform).toHaveBeenCalledWith(.2, 0, 0, .2, -20, -40)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBeInstanceOf(PathMock)
    expect(calls[0][1]).toBe('evenodd')
    expect((calls[0][0] as PathMock).rings.filter(point => point[0] === -1)).toHaveLength(3)
    expect(state.fillStyle).toBe('#fff')
    expect(state.filter).toBe('none')
  })
})
