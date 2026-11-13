import { describe, expect, it } from 'vitest'
import type { ImagePixelMask, ImagePixels } from './pixels.js'
import { inspectImageStructureMotifs } from './structure-motif-analysis.js'

const mask = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
const image = (): ImagePixels => ({ width: 64, height: 48, data: new Uint8ClampedArray(Array.from({ length: 64 * 48 * 4 }, (_, i) => i % 4 === 3 ? 255 : 150)) })
const paint = (im: ImagePixels, x: number, y: number, w: number, h: number, v = 65) => {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) im.data.set([v, v, v, 255], (yy * im.width + xx) * 4)
}
const surface = mask(0, 0, 64, 48), write = mask(12, 8, 40, 32)

describe('candidate structure motifs and original anchors', () => {
  it('does not let an inferred side branch inherit the original anchors of a long seam', () => {
    const source = image(), result = image()
    paint(source, 9, 30, 46, 1); paint(result, 9, 30, 46, 1)
    paint(result, 30, 24, 2, 6)
    const r = inspectImageStructureMotifs(source, result, surface, write, () => true, 'horizontal')
    expect(r.counts.anchoredComponents).toBe(1)
    expect(r.counts.branchComponents).toBeGreaterThan(0)
    expect(r.sites[0].kind).toBe('branch'); expect(r.sites[0].originalDarkPixels).toBe(0)
    expect(r.sites[0].instruction).toContain('不借主线锚点')
    const changed = { ...source, data: source.data.slice() }
    for (let y = 8; y < 40; y++) for (let x = 12; x < 52; x++) changed.data.set([x * 13 % 256, y * 17 % 256, 235, 255], (y * 64 + x) * 4)
    expect(inspectImageStructureMotifs(changed, result, surface, write, () => true, 'horizontal')).toEqual(r)
  })
  it('locates isolated compact and crosswise strokes without assigning semantic roles or changing pixels', () => {
    const source = image(), result = image()
    paint(result, 21, 17, 2, 2); paint(result, 35, 14, 1, 16)
    const before = result.data.slice(), r = inspectImageStructureMotifs(source, result, surface, write, () => true, 'horizontal')
    expect(r.counts).toMatchObject({ components: 2, uncertainComponents: 2, uncertainPixels: 20, anchoredComponents: 0 })
    expect(r.sites.map(s => s.extent)).toEqual(['across', 'compact'])
    expect(r.sites.every(s => s.originalDarkPixels === 0 && s.instruction.includes('局部判断'))).toBe(true)
    expect(r.sites[1].boundsPx).toEqual({ x: 21, y: 17, width: 2, height: 2 })
    expect(result.data).toEqual(before)
    expect(r.limitation).toContain('完全隐藏且未生成的原板头')
  })
  it('counts permitted original continuation and keeps short or absent anchors uncertain', () => {
    const source = image(), result = image()
    paint(source, 9, 18, 12, 1); paint(result, 9, 18, 12, 1)
    const anchored = inspectImageStructureMotifs(source, result, surface, write, () => true, 'horizontal')
    expect(anchored.counts).toMatchObject({ components: 1, anchoredComponents: 1, uncertainComponents: 0 })
    const blocked = inspectImageStructureMotifs(source, result, surface, write, (x, y) => !(x < 12 && y === 18), 'horizontal')
    expect(blocked.counts.uncertainComponents).toBe(1); expect(blocked.sites[0].originalDarkPixels).toBe(0)
    expect(inspectImageStructureMotifs(source, result, surface, write, x => x !== 9, 'horizontal').sites[0].originalDarkPixels).toBe(2)
  })
  it('has no hidden original RGB, forbidden evidence, or non-writable repaired-context dependency', () => {
    const source = image(), result = image(), changed = image(), changedResult = image()
    paint(result, 21, 17, 2, 2); paint(changedResult, 21, 17, 2, 2)
    const trusted = (x: number, y: number) => x !== 11 && y !== 7
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
      const writing = x >= 12 && x < 52 && y >= 8 && y < 40
      if (writing || !trusted(x, y)) changed.data.set([x * 17 % 256, y * 31 % 256, (x + y) * 13 % 256, 255], (y * 64 + x) * 4)
      if (!writing) changedResult.data.set([0, 245, 255, 255], (y * 64 + x) * 4)
    }
    expect(inspectImageStructureMotifs(changed, changedResult, surface, write, trusted, 'horizontal')).toEqual(inspectImageStructureMotifs(source, result, surface, write, trusted, 'horizontal'))
  })
  it('keeps full counts after six sites and is transpose-equivalent for vertical orientation', () => {
    const source = image(), result = image()
    for (const y of [14, 24]) for (const x of [17, 25, 33, 41]) paint(result, x, y, 2, 2)
    const r = inspectImageStructureMotifs(source, result, surface, write, () => true, 'horizontal')
    expect(r.sites).toHaveLength(6)
    expect(r.counts).toMatchObject({ uncertainComponents: 8, uncertainPixels: 32, unlistedComponents: 2, unlistedPixels: 8 })
    const transpose = (im: ImagePixels): ImagePixels => {
      const out = { width: im.height, height: im.width, data: im.data.slice() }
      for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) out.data.set(im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4), (x * im.height + y) * 4)
      return out
    }
    const transposed = inspectImageStructureMotifs(transpose(source), transpose(result), mask(0, 0, 48, 64), mask(8, 12, 32, 40), () => true, 'vertical')
    expect(transposed.counts).toEqual(r.counts)
    expect(transposed.sites.map(s => s.extent)).toEqual(r.sites.map(s => s.extent))
  })
  it('excludes transparent original anchors and a protected/non-writable repaired island', () => {
    const source = image(), result = image(), actual = mask(12, 8, 40, 32)
    paint(source, 9, 18, 12, 1); paint(result, 9, 18, 12, 1)
    for (let x = 9; x < 12; x++) source.data[(18 * 64 + x) * 4 + 3] = 0
    expect(inspectImageStructureMotifs(source, result, surface, actual, () => true, 'horizontal').counts.uncertainComponents).toBe(1)
    paint(result, 35, 26, 2, 2)
    for (let y = 26; y < 28; y++) for (let x = 35; x < 37; x++) actual.data[(y - 8) * 40 + x - 12] = 0
    const r = inspectImageStructureMotifs(source, result, surface, actual, (x, y) => x < 35 || x >= 37 || y < 26 || y >= 28, 'horizontal')
    expect(r.counts.uncertainComponents).toBe(1)
  })
  it('rejects malformed/nonbinary permissions and cancels without returning a partial report', () => {
    const source = image()
    expect(() => inspectImageStructureMotifs(source, source, surface, { ...write, data: new Uint8Array([255]) }, () => true, 'horizontal')).toThrow('二值范围')
    const nonbinary = { ...write, data: write.data.slice() }; nonbinary.data[0] = 50
    expect(() => inspectImageStructureMotifs(source, source, surface, nonbinary, () => true, 'horizontal')).toThrow('二值范围')
    let checked = 0
    expect(() => inspectImageStructureMotifs(source, source, surface, write, () => true, 'horizontal', { aborted: false, throwIfAborted() { if (++checked > 8) throw new Error('cancelled') } })).toThrow('cancelled')
  })
})
