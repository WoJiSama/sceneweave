import { describe, expect, it } from 'vitest'
import { repairExemplarSurface } from './exemplar-repair.js'
import type { ImagePixelMask, ImagePixels } from './pixels.js'
const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
function fixture(): ImagePixels {
  const data = new Uint8ClampedArray(120 * 90 * 4)
  for (let y = 0; y < 90; y++) for (let x = 0; x < 120; x++) {
    const ink = y % 15 < 2 || x % 30 === 0 && y % 15 < 9, grain = (x * 7 + y * 3) % 5
    data.set(ink ? [35, 30, 25, 255] : [112 + grain, 99 + grain, 84 + grain, 255], (y * 120 + x) * 4)
  }
  return { width: 120, height: 90, data }
}
const rgba = (i: ImagePixels, x: number, y: number) => [...i.data.subarray((y * i.width + x) * 4, (y * i.width + x) * 4 + 4)]

describe('original-scale exemplar quilting', () => {
  it('retains source ink and grain across a hole larger than the donor without changing exterior bytes', () => {
    const source = fixture(), mask = box(8, 8, 52, 74), donor = { x: 65, y: 10, width: 45, height: 65 }
    for (let y = 8; y < 82; y++) for (let x = 8; x < 60; x++) source.data.set([255, 0, 255, 255], (y * 120 + x) * 4)
    const before = source.data.slice()
    const result = repairExemplarSurface(source, mask, donor)
    let ink = 0, paper = 0
    for (let y = 0; y < 90; y++) for (let x = 0; x < 120; x++) {
      if (x >= 8 && x < 60 && y >= 8 && y < 82) { if (rgba(result, x, y)[0] < 65) ink++; if (rgba(result, x, y)[0] > 90) paper++ }
      else expect(rgba(result, x, y)).toEqual(rgba(source, x, y))
    }
    expect(ink).toBeGreaterThan(100); expect(paper).toBeGreaterThan(1000)
    expect(rgba(source, 20, 30)).toEqual([255, 0, 255, 255])
    expect(repairExemplarSurface(source, mask, donor)).toEqual(result)
    expect(source.data).toEqual(before)
  })
  it('does not read hidden, protected, excluded or outside-surface RGB, and does not write outside material permission', () => {
    const a = fixture(), b = fixture(), mask = box(12, 20, 38, 55), surfaceMask = box(6, 6, 108, 78), protectionMask = box(40, 25, 10, 30), excludedEvidenceMask = box(8, 20, 4, 55)
    for (let y = 0; y < 90; y++) for (let x = 0; x < 120; x++) if (x < 6 || y < 6 || x >= 114 || y >= 84 || x >= 8 && x < 50 && y >= 20 && y < 75) {
      a.data.set([255, 0, 255, 255], (y * 120 + x) * 4); b.data.set([0, 255, 0, 20], (y * 120 + x) * 4)
    }
    const opts = { surfaceMask, protectionMask, excludedEvidenceMask }, donor = { x: 65, y: 10, width: 45, height: 65 }
    const initial = a.data.slice(), left = repairExemplarSurface(a, mask, donor, opts), right = repairExemplarSurface(b, mask, donor, opts)
    for (let y = 20; y < 75; y++) for (let x = 12; x < 50; x++) {
      if (x >= 40 && y >= 25 && y < 55) expect(rgba(left, x, y)).toEqual(rgba(a, x, y))
      else expect(rgba(left, x, y)).toEqual(rgba(right, x, y))
    }
    expect(a.data).toEqual(initial)
  })
  it('rejects untrusted donors and malformed scopes atomically', () => {
    const source = fixture(), mask = box(12, 20, 38, 55), donor = { x: 65, y: 10, width: 45, height: 65 }, before = source.data.slice()
    expect(() => repairExemplarSurface(source, mask, { x: 20, y: 22, width: 30, height: 30 })).toThrow('可信')
    expect(() => repairExemplarSurface(source, mask, donor, { excludedEvidenceMask: box(70, 20, 3, 4) })).toThrow('可信')
    expect(() => repairExemplarSurface(source, { ...mask, data: new Uint8Array(2) }, donor)).toThrow('二值')
    expect(() => repairExemplarSurface(source, mask, { ...donor, width: 4 })).toThrow('8×8')
    expect(source.data).toEqual(before)
  })
})
