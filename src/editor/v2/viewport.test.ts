import { describe, expect, it } from 'vitest'
import { constrainViewportV2, FIT_VIEWPORT_V2, fittedMapSizeV2, viewportMapRectV2, viewportToWorldV2, zoomViewportV2 } from './viewport'

const bounds = { x: -3500, y: 2400, width: 14000, height: 10000 }, size = { width: 900, height: 700 }
describe('v2 view coordinates stay separate from integer world geometry', () => {
  it('fits both landscape and portrait views without stretching or losing nonzero origins', () => {
    for (const viewport of [size, { width: 370, height: 800 }]) {
      const fit = fittedMapSizeV2(viewport, bounds), rect = viewportMapRectV2(FIT_VIEWPORT_V2, viewport, bounds)
      expect(fit.width / fit.height).toBeCloseTo(bounds.width / bounds.height)
      expect(rect.width).toBeLessThanOrEqual(viewport.width); expect(rect.height).toBeLessThanOrEqual(viewport.height)
      expect(viewportToWorldV2({ x: rect.x, y: rect.y }, FIT_VIEWPORT_V2, viewport, bounds)).toEqual({ x: bounds.x, y: bounds.y })
    }
  })
  it('keeps the pointer world position invariant through repeated zoom and pan', () => {
    let view = { zoom: 1, panX: 70, panY: -25 }
    const pointer = { x: 370, y: 230 }, original = viewportToWorldV2(pointer, view, size, bounds)
    for (const factor of [1.2, 1.5, .8, 1.3, .7]) {
      view = zoomViewportV2(view, factor, pointer, size, bounds)
      const actual = viewportToWorldV2(pointer, view, size, bounds)
      expect(actual.x).toBeCloseTo(original.x, 8); expect(actual.y).toBeCloseTo(original.y, 8)
    }
  })
  it('bounds extreme inputs and leaves a reachable map at every supported scale', () => {
    for (const zoom of [.0001, 10000, NaN]) {
      const view = constrainViewportV2({ zoom, panX: 10000, panY: -10000 }, size, bounds)
      expect(view.zoom).toBeGreaterThanOrEqual(.25); expect(view.zoom).toBeLessThanOrEqual(8)
      const rect = viewportMapRectV2(view, size, bounds)
      expect(rect.x).toBeLessThanOrEqual(size.width - 32)
      expect(rect.y + rect.height).toBeGreaterThanOrEqual(32)
    }
    expect(constrainViewportV2({ zoom: Infinity, panX: NaN, panY: Infinity }, size, bounds)).toEqual(FIT_VIEWPORT_V2)
  })
})
