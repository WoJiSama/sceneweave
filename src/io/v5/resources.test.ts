import { describe, expect, it } from 'vitest'
import { transformRgbaV5 } from './resources'

describe('C3 sRGB parameter operation', () => {
  it('transforms color channels with clipping and preserves alpha including transparent pixels', () => {
    const pixels = new Uint8ClampedArray([100, 150, 200, 255, 200, 240, 255, 128, 99, 88, 77, 0])
    expect([...transformRgbaV5(pixels, '#80FF00', 1.5)]).toEqual([75, 225, 0, 255, 151, 255, 0, 128, 0, 0, 0, 0])
    expect([...pixels]).toEqual([100, 150, 200, 255, 200, 240, 255, 128, 99, 88, 77, 0])
  })
  it('rejects unsupported parameters before any image allocation', () => {
    for (const brightness of [NaN, Infinity, .24, 2.01]) expect(() => transformRgbaV5(new Uint8ClampedArray(4), null, brightness)).toThrow()
    expect(() => transformRgbaV5(new Uint8ClampedArray(4), 'red', 1)).toThrow()
    expect(() => transformRgbaV5(new Uint8ClampedArray(3), null, 1)).toThrow()
  })
})
