import { describe, expect, it } from 'vitest'
import { extractImageLayer, type ImagePixels } from './pixels.js'

function fixture(vertical = false, unilateral = false): ImagePixels {
  const data = new Uint8ClampedArray(80 * 80 * 4)
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
    const u = vertical ? y : x, v = vertical ? x : y
    const ink = v >= 37 && v < 40 && (!unilateral || u < 27)
    data.set(ink ? [35, 30, 25, 255] : [104, 92, 80, 255], (y * 80 + x) * 4)
  }
  return { width: 80, height: 80, data }
}
const mask = { x: 27, y: 25, width: 26, height: 30, runs: [780, 255] }
const selection = { x: 32, y: 29, width: 12, height: 20, runs: [240, 255] }
const polygon = [{ x: 32, y: 29 }, { x: 44, y: 29 }, { x: 44, y: 49 }, { x: 32, y: 49 }]
const donor = { x: 3, y: 5, width: 17, height: 64 }
const rgba = (i: ImagePixels, x: number, y: number) => [...i.data.subarray((y * 80 + x) * 4, (y * 80 + x) * 4 + 4)]
const options = { repair: 'structure' as const, removalMask: mask, selectionMask: selection }

describe('structured material repair', () => {
  it.each([false, true])('connects supported seams and preserves exact source outside the hole (vertical=%s)', vertical => {
    const truth = fixture(vertical), source = fixture(vertical)
    for (let y = 25; y < 55; y++) for (let x = 27; x < 53; x++) source.data.set([255, 0, 255, 20], (y * 80 + x) * 4)
    const sample = vertical ? { x: 5, y: 3, width: 64, height: 17 } : donor
    const result = extractImageLayer(source, polygon, sample, options)
    expect(rgba(result.remaining, 38, 38)[0]).toBeLessThan(45)
    expect(rgba(result.remaining, 32, 31)[0]).toBeGreaterThan(95)
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
      if (x < 27 || x >= 53 || y < 25 || y >= 55) expect(rgba(result.remaining, x, y)).toEqual(rgba(source, x, y))
    }
    expect(rgba(source, 38, 38)).toEqual([255, 0, 255, 20])
    expect(rgba(truth, 38, 38)[0]).toBe(35)
  })
  it('does not invent an across-hole joint from a unilateral visible stroke', () => {
    const result = extractImageLayer(fixture(false, true), polygon, donor, options)
    expect(rgba(result.remaining, 28, 38)[0]).toBeLessThan(65)
    expect(rgba(result.remaining, 40, 38)[0]).toBeGreaterThan(95)
  })
  it('ignores hidden and protected colours, keeps original item appearance, and replays deterministically', () => {
    const a = fixture(), b = fixture(), protect = { x: 53, y: 25, width: 6, height: 30, runs: [180, 255] }
    for (let y = 25; y < 55; y++) for (let x = 27; x < 59; x++) {
      a.data.set([255, 0, 255, 255], (y * 80 + x) * 4); b.data.set([0, 255, 0, 40], (y * 80 + x) * 4)
    }
    const left = extractImageLayer(a, polygon, donor, { ...options, protectionMask: protect })
    const right = extractImageLayer(b, polygon, donor, { ...options, protectionMask: protect })
    expect(left.layer).toEqual(extractImageLayer(a, polygon, donor, { selectionMask: selection }).layer)
    for (let y = 25; y < 55; y++) for (let x = 27; x < 53; x++) expect(rgba(left.remaining, x, y)).toEqual(rgba(right.remaining, x, y))
    expect(rgba(left.remaining, 54, 38)).toEqual([255, 0, 255, 255])
    expect(extractImageLayer(a, polygon, donor, { ...options, protectionMask: protect }).remaining.data).toEqual(left.remaining.data)
  })
  it('rejects translucent donors and mixed-surface inputs rather than guessing', () => {
    const source = fixture(); source.data[(6 * 80 + 6) * 4 + 3] = 0
    expect(() => extractImageLayer(source, polygon, donor, options)).toThrow('不透明')
    expect(() => extractImageLayer(fixture(), polygon, donor, { ...options, fills: [{ polygon, donor }] })).toThrow('单一底材')
  })
})
