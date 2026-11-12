import { describe, expect, it } from 'vitest'
import { extractImageLayer, type ImagePixels, type PixelBounds } from './pixels.js'
import { encodeSelectionMask } from './selection-mask.js'

const box = (x: number, y: number, width: number, height: number): PixelBounds => ({ x, y, width, height })
const polygon = (b: PixelBounds) => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
const mask = (b: PixelBounds, value = 255) => encodeSelectionMask({ width: b.width, height: b.height, boundsPx: b, data: new Uint8Array(b.width * b.height).fill(value) })
const object = box(55, 24, 8, 12), removal = box(52, 20, 16, 20), protectedArea = box(66, 20, 4, 20), donor = box(4, 8, 36, 56)
const rgba = (i: ImagePixels, x: number, y: number) => i.data.slice((y * i.width + x) * 4, (y * i.width + x) * 4 + 4)
function image(): ImagePixels {
  const data = new Uint8ClampedArray(96 * 80 * 4)
  for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) data.set(y % 10 === 0 ? [30, 26, 22, 255] : [100 + x % 4, 85 + y % 10, 70, 255], (y * 96 + x) * 4)
  return { width: 96, height: 80, data }
}
const options = { repair: 'context' as const, removalMask: mask(removal), protectionMask: mask(protectedArea) }

describe('independent removal and protected context', () => {
  it('keeps exact object appearance while removing a separate shadow and preserving protected/exterior bytes', () => {
    const source = image(), legacy = extractImageLayer(source, polygon(object), donor)
    const result = extractImageLayer(source, polygon(object), donor, options)
    expect(result.layer).toEqual(legacy.layer)
    expect(result.mask).toEqual(legacy.mask)
    expect(result.repairMask.data.reduce((s, v) => s + +(v > 0), 0)).toBe(14 * 20)
    for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) {
      if (x < 52 || x >= 66 || y < 20 || y >= 40) expect(rgba(result.remaining, x, y)).toEqual(rgba(source, x, y))
    }
  })
  it('restores a known periodic wood control without reading hidden or protected colors', () => {
    const truth = image(), damaged = image(), other = image()
    for (let y = 20; y < 40; y++) for (let x = 52; x < 70; x++) {
      damaged.data.set(x < 66 ? [255, 0, 255, 255] : [0, 0, 0, 255], (y * 96 + x) * 4)
      other.data.set(x < 66 ? [0, 255, 0, 40] : [255, 255, 255, 255], (y * 96 + x) * 4)
    }
    const a = extractImageLayer(damaged, polygon(object), donor, options).remaining
    const b = extractImageLayer(other, polygon(object), donor, options).remaining
    for (let y = 20; y < 40; y++) for (let x = 52; x < 66; x++) {
      expect(rgba(a, x, y)).toEqual(rgba(truth, x, y))
      expect(rgba(a, x, y)).toEqual(rgba(b, x, y))
    }
    expect([...rgba(a, 66, 25)]).toEqual([0, 0, 0, 255])
    expect([...rgba(b, 66, 25)]).toEqual([255, 255, 255, 255])
  })
  it('rejects contradictory or unbounded scopes and unusable donors before returning pixels', () => {
    const source = image(), run = (extra: Partial<typeof options> & { cleanupPx?: number } = {}, sample = donor) => extractImageLayer(source, polygon(object), sample, { ...options, ...extra })
    expect(() => run({ removalMask: mask(box(56, 24, 7, 12)) })).toThrow('全部物件')
    expect(() => run({ protectionMask: mask(object) })).toThrow('冲突')
    expect(() => run({ removalMask: mask(removal, 128) })).toThrow('二值')
    expect(() => run({ cleanupPx: 1 })).toThrow('外扩')
    expect(() => run({ removalMask: mask(box(0, 0, 68, 50)) })).toThrow('32像素')
    expect(() => run({}, box(65, 20, 25, 30))).toThrow()
    expect(() => run({}, box(0, 0, 8, 8))).toThrow('各多4像素')
  })
  it.each(['tile', 'texture', 'seamless', 'aligned'] as const)('excludes protected boundary colours with legacy %s repair too', repair => {
    const source = image(), other = image()
    for (let y = 20; y < 40; y++) for (let x = 66; x < 70; x++) {
      source.data.set([0, 0, 0, 255], (y * 96 + x) * 4)
      other.data.set([255, 255, 255, 255], (y * 96 + x) * 4)
    }
    const a = extractImageLayer(source, polygon(object), donor, { ...options, repair }).remaining
    const b = extractImageLayer(other, polygon(object), donor, { ...options, repair }).remaining
    for (let y = 20; y < 40; y++) for (let x = 52; x < 66; x++) expect(rgba(a, x, y)).toEqual(rgba(b, x, y))
    expect([...rgba(a, 66, 25)]).toEqual([0, 0, 0, 255])
    expect([...rgba(b, 66, 25)]).toEqual([255, 255, 255, 255])
  })
})
