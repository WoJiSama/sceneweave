import { describe, expect, it } from 'vitest'
import { refineImageSubjectReferences } from './subject-reference.js'
import type { ImagePixelMask } from '../image-import/pixels.js'

const mask = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height,
  boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
function fixture() {
  const width = 44, height = 40, data = new Uint8ClampedArray(width * height * 4), F = [18, 30, 42], B = [100, 130, 150]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= 10 && x < 34 && y >= 9 && y < 31, edge = inside && (x === 10 || x === 33 || y === 9 || y === 30)
    const a = inside ? edge ? .55 : 1 : 0
    data.set([...F.map((v, c) => Math.round(v * a + B[c] * (1 - a))), 255], (y * width + x) * 4)
  }
  const source = { width, height, data }, selection = mask(10, 9, 24, 22), baseline = { ...selection, data: new Uint8ClampedArray(24 * 22 * 4) }
  for (let y = 0; y < 22; y++) for (let x = 0; x < 24; x++) baseline.data.set(data.subarray(((y + 9) * width + x + 10) * 4, ((y + 9) * width + x + 10) * 4 + 4), (y * 24 + x) * 4)
  const options = { foreground: mask(13, 13, 3, 1), background: mask(6, 13, 3, 1), mixed: mask(10, 14, 1, 8), bandPx: 1 as const, strength: 'strong' as const }
  return { source, selection, baseline, options, F, B }
}
describe('explicit original colour references and bounded edge role guidance', () => {
  it('jointly reconstructs foreground and coverage only in the confirmed edge and recomposes the captured colour', () => {
    const f = fixture(), original = f.source.data.slice(), result = refineImageSubjectReferences(f.source, f.selection, f.baseline, f.options)
    expect(result.metrics.estimatedPixels).toBe(8)
    for (let y = 0; y < 22; y++) for (let x = 0; x < 24; x++) {
      const at = (y * 24 + x) * 4
      if (x !== 0 || y < 5 || y >= 13) expect(result.pixels.data.slice(at, at + 4)).toEqual(f.baseline.data.slice(at, at + 4))
      else {
        expect(result.pixels.data[at + 3]).toBeGreaterThan(130); expect(result.pixels.data[at + 3]).toBeLessThan(150)
        const a = result.pixels.data[at + 3] / 255
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(result.pixels.data[at + c] - f.F[c])).toBeLessThan(3)
          expect(Math.abs(result.pixels.data[at + c] * a + f.B[c] * (1 - a) - f.baseline.data[at + c])).toBeLessThan(1)
        }
      }
    }
    expect(result.metrics.unconfirmedPixels).toBeGreaterThan(0); expect(result.issues.some(issue => issue.reason === 'unconfirmed-role')).toBe(true)
    expect(result.metrics.uncertainPixels).toBeLessThan(result.metrics.unconfirmedPixels)
    for (const issue of result.issues.filter(issue => issue.reason === 'unconfirmed-role')) {
      expect(issue.boundsPx.y).toBeGreaterThanOrEqual(12); expect(issue.boundsPx.y + issue.boundsPx.height).toBeLessThanOrEqual(24)
    }
    expect(f.source.data).toEqual(original)
  })
  it('keeps unmarked one-pixel solid grey trim and protected confirmed edges exactly', () => {
    const f = fixture()
    // Same captured colour as a mixture is now declared a genuine opaque trim.
    // Omission from mixed scope is deliberate role guidance, not automatic detection.
    f.options.mixed = mask(33, 14, 1, 8)
    const result = refineImageSubjectReferences(f.source, f.selection, f.baseline, { ...f.options, foregroundProtectionMask: mask(33, 14, 1, 4) })
    for (let y = 0; y < 22; y++) expect(result.pixels.data.slice(y * 24 * 4, y * 24 * 4 + 4)).toEqual(f.baseline.data.slice(y * 24 * 4, y * 24 * 4 + 4))
    for (let y = 5; y < 9; y++) expect(result.pixels.data.slice((y * 24 + 23) * 4, (y * 24 + 24) * 4)).toEqual(f.baseline.data.slice((y * 24 + 23) * 4, (y * 24 + 24) * 4))
    expect(result.metrics.estimatedPixels).toBe(4)
  })
  it('reads only the confirmed captured edge and explicit references, and rejects unavailable reference evidence', () => {
    const f = fixture(), before = refineImageSubjectReferences(f.source, f.selection, f.baseline, f.options), changed = f.source.data.slice()
    for (let y = 0; y < f.source.height; y++) for (let x = 0; x < f.source.width; x++) {
      const allowed = x === 10 && y >= 14 && y < 22 || y === 13 && (x >= 13 && x < 16 || x >= 6 && x < 9)
      if (!allowed) changed.set([x * 5 % 256, y * 11 % 256, (x + y) * 7 % 256], (y * f.source.width + x) * 4)
    }
    const after = refineImageSubjectReferences({ ...f.source, data: changed }, f.selection, f.baseline, f.options)
    expect(after.pixels).toEqual(before.pixels); expect(after.uncertaintyMask).toEqual(before.uncertaintyMask)
    expect(() => refineImageSubjectReferences(f.source, f.selection, f.baseline, { ...f.options, excludedEvidenceMask: mask(13, 13, 1, 1) })).toThrow('主体色参考')
    expect(() => refineImageSubjectReferences(f.source, f.selection, f.baseline, { ...f.options, removalMask: mask(6, 13, 1, 1) })).toThrow('背景色参考')
    expect(() => refineImageSubjectReferences(f.source, f.selection, f.baseline, { ...f.options, foreground: mask(13, 13, 2, 1) })).toThrow('至少需要3')
    expect(() => refineImageSubjectReferences(f.source, f.selection, f.baseline, f.options, { aborted: true })).toThrow('已取消')
  })
  it('retains an enclosed hole edge and a disconnected one-pixel rod even if marked as mixed', () => {
    const f = fixture(), selected = f.selection.data.slice(), baseline = { ...f.baseline, data: f.baseline.data.slice() }
    // An enclosed 3x3 hole; marked pixel directly touches this hole.
    for (let y = 8; y < 11; y++) for (let x = 8; x < 11; x++) { selected[y * 24 + x] = 0; baseline.data[(y * 24 + x) * 4 + 3] = 0 }
    // Separate rod on the left with a full zero column between it and the body.
    for (let y = 0; y < 22; y++) { selected[y * 24 + 1] = 0; baseline.data[(y * 24 + 1) * 4 + 3] = 0 }
    const selection = { ...f.selection, data: selected }
    const rod = refineImageSubjectReferences(f.source, selection, baseline, { ...f.options, mixed: mask(10, 17, 1, 3) })
    expect(rod.metrics.estimatedPixels).toBe(0)
    const hole = refineImageSubjectReferences(f.source, selection, baseline, { ...f.options, mixed: mask(17, 17, 1, 3), bandPx: 2 })
    expect(hole.metrics.estimatedPixels).toBe(0)
    expect(hole.pixels.data).toEqual(baseline.data)
  })
})
