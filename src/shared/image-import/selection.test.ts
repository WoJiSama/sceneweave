import { describe, expect, it } from 'vitest'
import type { ImagePoint } from './calibration.js'
import type { ImagePixelMask, ImagePixels } from './pixels.js'
import { paintImageSelection, snapImageContour } from './selection.js'

function raster(width: number, height: number, pixel: (x: number, y: number) => number[] = () => [50, 110, 150, 255]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  return { width, height, data }
}

function mask(x: number, y: number, width: number, height: number, fill = 255): ImagePixelMask {
  return { width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(fill) }
}

function coverage(input: ImagePixelMask, x: number, y: number): number {
  const mx = x - input.boundsPx.x, my = y - input.boundsPx.y
  return mx >= 0 && my >= 0 && mx < input.width && my < input.height ? input.data[my * input.width + mx] : 0
}

describe('editable source-pixel selection brush', () => {
  it('removes blue background through an internal hole without damaging thin retained parts or source RGB', () => {
    const source = raster(18, 16), sourceBefore = source.data.slice(), original = mask(2, 2, 12, 11)
    original.data[0] = 96
    const before = original.data.slice(), points = [{ x: 5.5, y: 6.5 }, { x: 10.5, y: 6.5 }]
    const removed = paintImageSelection(source, original, { points, radiusPx: 1, mode: 'remove' })
    expect(coverage(removed, 8, 6)).toBe(0)
    expect(coverage(removed, 8, 3)).toBe(255)
    expect(coverage(removed, 2, 2)).toBe(96)
    expect(coverage(removed, 13, 12)).toBe(255)
    expect(original.data).toEqual(before)
    expect(source.data).toEqual(sourceBefore)
    expect(points).toEqual([{ x: 5.5, y: 6.5 }, { x: 10.5, y: 6.5 }])
    const restored = paintImageSelection(source, removed, { points, radiusPx: 1, mode: 'keep' })
    expect(coverage(restored, 8, 6)).toBe(255)
    expect(coverage(removed, 8, 6)).toBe(0)
  })

  it('paints continuous narrow diagonal leaf edges between sparse pointer samples', () => {
    const source = raster(32, 32), empty = mask(0, 0, 1, 1, 0)
    const selected = paintImageSelection(source, empty, { points: [{ x: 1.5, y: 1.5 }, { x: 29.5, y: 29.5 }], radiusPx: .5, mode: 'keep' })
    for (let value = 1; value <= 29; value++) expect(coverage(selected, value, value)).toBe(255)
    expect(coverage(selected, 4, 12)).toBe(0)
    expect(empty.data[0]).toBe(0)
  })

  it('keeps disconnected painted islands and original fractional coverage, clipping the brush at the image edge', () => {
    const source = raster(20, 12), original = mask(6, 5, 2, 2, 120)
    const selected = paintImageSelection(source, original, { points: [{ x: 0, y: 0 }], radiusPx: 2, mode: 'keep' })
    expect(selected.boundsPx.x).toBe(0)
    expect(selected.boundsPx.y).toBe(0)
    expect(coverage(selected, 0, 0)).toBe(255)
    expect(coverage(selected, 6, 5)).toBe(120)
    expect(coverage(selected, 4, 3)).toBe(0)
    expect(selected.data).not.toBe(original.data)
  })

  it('allows an all-zero draft after removal and does not expand it for an outside eraser stroke', () => {
    const source = raster(20, 12), original = mask(2, 2, 1, 1)
    const cleared = paintImageSelection(source, original, { points: [{ x: 2.5, y: 2.5 }], radiusPx: .5, mode: 'remove' })
    expect(cleared.data).toEqual(new Uint8Array([0]))
    const outside = paintImageSelection(source, cleared, { points: [{ x: 19, y: 11 }], radiusPx: 1, mode: 'remove' })
    expect(outside.boundsPx).toEqual(original.boundsPx)
    expect(outside.data).toEqual(cleared.data)
  })

  it('rejects malformed masks, out-of-image strokes and excessive work without mutating the prior state', () => {
    const source = raster(512, 512), original = mask(0, 0, 1, 1, 0), before = original.data.slice()
    expect(() => paintImageSelection(source, { ...original, data: new Uint8Array(2) }, { points: [{ x: 1, y: 1 }], radiusPx: 1, mode: 'keep' })).toThrow('选区无效')
    expect(() => paintImageSelection(source, original, { points: [{ x: -1, y: 0 }], radiusPx: 1, mode: 'keep' })).toThrow('超出')
    expect(() => paintImageSelection(source, original, { points: [{ x: 1, y: 1 }], radiusPx: Infinity, mode: 'keep' })).toThrow('半径')
    expect(() => paintImageSelection(source, original, { points: Array.from({ length: 4096 }, () => ({ x: 256, y: 256 })), radiusPx: 128, mode: 'keep' })).toThrow('预算')
    expect(original.data).toEqual(before)
  })

  it('rejects a selection whose crop exceeds the one-million-pixel mask budget', () => {
    const source = raster(1100, 1100), original = mask(0, 0, 1, 1)
    expect(() => paintImageSelection(source, original, { points: [{ x: 1099, y: 1099 }], radiusPx: 1, mode: 'keep' })).toThrow('100万')
  })
})

describe('magnetic contour constrained to the user stroke', () => {
  it('follows a nearby object boundary instead of a distant stronger wood seam', () => {
    const source = raster(64, 64, x => x === 9 ? [255, 255, 255, 255] : x < 20 ? [20, 25, 30, 255] : [50, 110, 150, 255])
    const before = source.data.slice(), points = [{ x: 23, y: 4 }, { x: 23, y: 60 }]
    const snapped = snapImageContour(source, points, { radiusPx: 5, closed: false })
    expect(snapped.length).toBeGreaterThan(2)
    expect(Math.max(...snapped.map(point => Math.abs(point.x - 20)))).toBeLessThanOrEqual(1)
    expect(snapped.every(point => Math.abs(point.x - 23) <= 5)).toBe(true)
    expect(source.data).toEqual(before)
    expect(points).toEqual([{ x: 23, y: 4 }, { x: 23, y: 60 }])
  })

  it('improves a curved piano outline while resisting a stronger internal highlight ring', () => {
    const source = raster(96, 96, (x, y) => {
      const radius = Math.hypot(x + .5 - 48, y + .5 - 48)
      if (Math.abs(radius - 18) < .7) return [245, 245, 245, 255]
      return radius < 22 ? [20, 25, 30, 255] : [50, 110, 150, 255]
    })
    const rough: ImagePoint[] = Array.from({ length: 64 }, (_, index) => ({
      x: 48 + 25 * Math.cos(index * Math.PI / 32), y: 48 + 25 * Math.sin(index * Math.PI / 32),
    }))
    const snapped = snapImageContour(source, rough, { radiusPx: 8 })
    const error = snapped.reduce((sum, point) => sum + Math.abs(Math.hypot(point.x - 48, point.y - 48) - 22), 0) / snapped.length
    expect(error).toBeLessThan(1.25)
    expect(snapped.every(point => Math.hypot(point.x - 48, point.y - 48) > 20)).toBe(true)
    expect(snapped.length).toBeLessThanOrEqual(4096)
  })

  it('leaves a flat-image outline exactly where the user drew it', () => {
    const source = raster(32, 32), points = [{ x: 4, y: 4 }, { x: 22, y: 5 }, { x: 16, y: 25 }]
    const result = snapImageContour(source, points)
    expect(result).toEqual(points)
    expect(result).not.toBe(points)
    expect(result[0]).not.toBe(points[0])
  })

  it('does not create hairpins at a concave bench notch when nearby source edges move the normal offsets', () => {
    const rough = [{ x: 18, y: 8 }, { x: 56, y: 8 }, { x: 62, y: 14 }, { x: 62, y: 26 },
      { x: 54, y: 34 }, { x: 40, y: 36 }, { x: 34, y: 45 }, { x: 26, y: 50 }, { x: 18, y: 50 },
      { x: 15, y: 43 }, { x: 11, y: 43 }, { x: 7, y: 39 }, { x: 7, y: 22 }, { x: 10, y: 17 }, { x: 16, y: 17 }]
    const target = rough.map(point => ({ x: point.x - 2, y: point.y - 1 }))
    const inside = (x: number, y: number) => {
      let result = false
      for (let index = 0, previous = target.length - 1; index < target.length; previous = index++) {
        const a = target[index], b = target[previous]
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result
      }
      return result
    }
    const source = raster(72, 60, (x, y) => inside(x + .5, y + .5) ? [20, 25, 30, 255] : [50, 110, 150, 255])
    const before = source.data.slice()
    // Rotate the starting vertex to exercise both a normal interior notch and the closed seam.
    for (const shift of [0, 10, 14]) {
      const points = [...rough.slice(shift), ...rough.slice(0, shift)]
      const snapped = snapImageContour(source, points, { radiusPx: 3, closed: true })
      for (let index = 0; index < snapped.length; index++) {
        const a = snapped[(index + snapped.length - 1) % snapped.length], b = snapped[index], c = snapped[(index + 1) % snapped.length]
        const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y
        expect((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))).toBeGreaterThan(-.2)
      }
      const side = (a: ImagePoint, b: ImagePoint, c: ImagePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      for (let first = 0; first < snapped.length; first++) for (let second = first + 2; second < snapped.length; second++) {
        if (first === 0 && second === snapped.length - 1) continue
        const a = snapped[first], b = snapped[(first + 1) % snapped.length], c = snapped[second], d = snapped[(second + 1) % snapped.length]
        expect(side(a, b, c) * side(a, b, d) < -1e-8 && side(c, d, a) * side(c, d, b) < -1e-8).toBe(false)
      }
      expect(snapped.some(point => point.y < 7.5)).toBe(true)
    }
    expect(source.data).toEqual(before)
  })

  it('checks image bytes, radius, point and path budgets before returning any candidate', () => {
    const source = raster(64, 64), points = [{ x: 4, y: 4 }, { x: 22, y: 5 }, { x: 16, y: 25 }]
    expect(() => snapImageContour({ ...source, data: new Uint8ClampedArray(4) }, points)).toThrow('RGBA')
    expect(() => snapImageContour(source, points, { radiusPx: 33 })).toThrow('半径')
    expect(() => snapImageContour(source, [{ x: 0, y: 0 }, { x: NaN, y: 2 }, { x: 2, y: 2 }])).toThrow('超出')
    expect(() => snapImageContour(source, Array.from({ length: 4097 }, () => ({ x: 2, y: 2 })))).toThrow('4096')
    const long = raster(8192, 2)
    expect(() => snapImageContour(long, Array.from({ length: 10 }, (_, index) => ({ x: index % 2 ? 8191 : 0, y: 1 })))).toThrow('过长')
  })
})
