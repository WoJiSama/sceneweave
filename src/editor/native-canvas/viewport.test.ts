import { describe, expect, it } from 'vitest'
import { constrainViewportV2, FIT_VIEWPORT_V2, fittedMapSizeV2, resizeViewportV2, viewportMapRectV2, viewportToWorldV2, zoomViewportV2 } from './viewport'

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
  it('retains world center and actual scale through panel resizing and collapse round trips', () => {
    const original = { zoom: 1.7, panX: 137, panY: -69 }
    const center = viewportToWorldV2({ x: size.width / 2, y: size.height / 2 }, original, size, bounds)
    const originalScale = viewportMapRectV2(original, size, bounds).width / bounds.width
    let previous = size, view = original
    for (const next of [{ width: 440, height: 700 }, { width: 1290, height: 640 }, { width: 900, height: 860 }, size]) {
      view = resizeViewportV2(view, previous, next, bounds)
      const actual = viewportToWorldV2({ x: next.width / 2, y: next.height / 2 }, view, next, bounds)
      expect(actual.x).toBeCloseTo(center.x, 8); expect(actual.y).toBeCloseTo(center.y, 8)
      expect(viewportMapRectV2(view, next, bounds).width / bounds.width).toBeCloseTo(originalScale, 12)
      previous = next
    }
    expect(view.zoom).toBeCloseTo(original.zoom, 12)
    expect(view.panX).toBeCloseTo(original.panX, 10); expect(view.panY).toBeCloseTo(original.panY, 10)
  })
  it('keeps the same world center when a resize reaches a zoom limit within pan bounds', () => {
    const original = { zoom: 8, panX: 80, panY: -24 }, next = { width: 500, height: 700 }
    const center = viewportToWorldV2({ x: size.width / 2, y: size.height / 2 }, original, size, bounds)
    const resized = resizeViewportV2(original, size, next, bounds)
    const actual = viewportToWorldV2({ x: next.width / 2, y: next.height / 2 }, resized, next, bounds)
    expect(resized.zoom).toBe(8)
    expect(actual.x).toBeCloseTo(center.x, 8); expect(actual.y).toBeCloseTo(center.y, 8)
    expect(viewportMapRectV2(resized, next, bounds).width).toBeLessThan(viewportMapRectV2(original, size, bounds).width)
  })
})
