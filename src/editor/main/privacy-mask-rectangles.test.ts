import { describe, expect, it } from 'vitest'
import { privacyMaskRectangles } from './privacy-mask-rectangles.js'
import { boundsCovered } from '../../shared/projection/projection.js'

describe('minimal disjoint mask union', () => {
  it('keeps separated requirements separate instead of blanking the corridor between them', () => {
    const boxes = [{ x: 1000, y: 1000, width: 2000, height: 2000 }, { x: 6000, y: 1000, width: 2000, height: 2000 }]
    expect(privacyMaskRectangles(boxes)).toEqual(boxes)
    expect(boundsCovered({ x: 4000, y: 1500, width: 500, height: 500 }, privacyMaskRectangles(boxes))).toBe(false)
  })
  it('merges overlap without filling the missing corner and rounds outward at integer millimetres', () => {
    const boxes = [{ x: -1.2, y: 2.1, width: 11.2, height: 7.9 }, { x: 5, y: 5, width: 10, height: 10 }]
    const union = privacyMaskRectangles(boxes)
    for (const box of boxes) expect(boundsCovered(box, union)).toBe(true)
    expect(union.reduce((sum, box) => sum + box.width * box.height, 0)).toBe(96 + 100 - 25)
    expect(boundsCovered({ x: 11, y: 3, width: 1, height: 1 }, union)).toBe(false)
    expect(privacyMaskRectangles([...boxes, ...boxes])).toEqual(union)
    expect(privacyMaskRectangles([])).toEqual([])
  })
})
