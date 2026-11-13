import { describe, expect, it } from 'vitest'
import { refineImageContour } from './contour-coverage.js'
import type { ImagePixelMask, ImagePixels } from '../image-import/pixels.js'

function fixture(inside: (x: number, y: number) => boolean, width = 31, height = 29) {
  const source: ImagePixels = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const selection: ImagePixelMask = { width, height, boundsPx: { x: 0, y: 0, width, height }, data: new Uint8Array(width * height) }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, selected = inside(x, y)
    selection.data[i] = selected ? 255 : 0
    source.data.set(selected ? [24 + x % 3, 28 + y % 3, 32, 255] : [215, 80, 190, 255], i * 4)
  }
  return { source, selection }
}
const diagonal = () => fixture((x, y) => x >= 4 && y >= 4 && x <= 25 && y <= 24 && x + y >= 20)
const alpha = (result: ReturnType<typeof refineImageContour>, x: number, y: number) => {
  const { boundsPx: b, data, width } = result.pixels
  return data[((y - b.y) * width + x - b.x) * 4 + 3]
}

describe('area preserving geometric subject contour', () => {
  it('balances convex coverage with explicit outer inference, preserves RGB/core, and records captured colour sources', () => {
    const { source, selection } = diagonal(), before = source.data.slice(), maskBefore = selection.data.slice()
    const result = refineImageContour(source, selection, { strength: 'strong' })
    expect(result.method).toBe('subject-contour-v1')
    expect(result.pixels).toBe(result.coveragePixels)
    expect(result.metrics.areaPreserved).toBe(true)
    expect(result.metrics.areaDeltaPx).toBe(0)
    expect(result.metrics.outerSupportAddedPixels).toBeGreaterThan(0)
    expect(result.metrics.originalSupportRemovedPixels).toBe(0)
    expect(alpha(result, 20, 18)).toBe(255)
    for (let i = 0; i < selection.data.length; i++) if (selection.data[i]) {
      expect(result.pixels.data.subarray(i * 4, i * 4 + 3)).toEqual(source.data.subarray(i * 4, i * 4 + 3))
      expect(result.pixels.data[i * 4 + 3]).toBeGreaterThan(0)
    }
    for (const p of result.outerRgbSources) {
      expect(selection.data[p.y * source.width + p.x]).toBe(0)
      expect(selection.data[p.sourceY * source.width + p.sourceX]).toBe(255)
      expect(Math.max(Math.abs(p.x - p.sourceX), Math.abs(p.y - p.sourceY))).toBeLessThanOrEqual(1)
      const at = (p.y * source.width + p.x) * 4, from = (p.sourceY * source.width + p.sourceX) * 4
      expect(result.pixels.data.subarray(at, at + 3)).toEqual(source.data.subarray(from, from + 3))
      expect(result.uncertaintyMask.data[p.y * source.width + p.x]).toBe(255)
    }
    expect(result.issues.some(issue => issue.reason === 'inferred-outer-coverage')).toBe(true)
    expect(source.data).toEqual(before); expect(selection.data).toEqual(maskBefore)
  })

  it('keeps intentional square corners and straight edges exact and never blurs their colours', () => {
    const { source, selection } = fixture((x, y) => x >= 5 && x <= 24 && y >= 5 && y <= 22)
    const result = refineImageContour(source, selection, { strength: 'strong' })
    for (let i = 0; i < selection.data.length; i++) {
      expect([...result.pixels.data.subarray(i * 4, i * 4 + 3)]).toEqual(selection.data[i] ? [...source.data.subarray(i * 4, i * 4 + 3)] : [0, 0, 0])
      expect(result.pixels.data[i * 4 + 3]).toBe(selection.data[i])
    }
    expect(result.metrics.alphaChangedPixels).toBe(0)
  })

  it('keeps holes, thin rods and small isolated tips exact while fitting a separate thick diagonal', () => {
    const { source, selection } = fixture((x, y) => (x >= 5 && x <= 22 && y >= 4 && y <= 23 && x + y >= 17 && !(x >= 13 && x <= 15 && y >= 12 && y <= 14))
      || x === 27 && y >= 4 && y <= 23 || x === 2 && y === 2)
    const result = refineImageContour(source, selection, { strength: 'strong' })
    for (let y = 11; y <= 15; y++) for (let x = 12; x <= 16; x++) expect(alpha(result, x, y)).toBe(selection.data[y * source.width + x])
    for (let y = 3; y <= 24; y++) for (let x = 26; x <= 28; x++) expect(alpha(result, x, y)).toBe(selection.data[y * source.width + x])
    expect(alpha(result, 2, 2)).toBe(255)
    expect(result.metrics.holeChangedPixels).toBe(0); expect(result.metrics.thinChangedPixels).toBe(0)
    expect(result.metrics.alphaChangedPixels).toBeGreaterThan(0)
  })

  it('respects exact foreground and excluded neighbouring pixels, including inferred outer writes', () => {
    const { source, selection } = diagonal(), foreground = { ...selection, data: new Uint8Array(selection.data.length) }, excluded = { ...selection, data: new Uint8Array(selection.data.length) }
    foreground.data[10 * source.width + 10] = 255
    for (let y = 7; y <= 13; y++) for (let x = 7; x <= 13; x++) excluded.data[y * source.width + x] = 255
    const result = refineImageContour(source, selection, { strength: 'strong', foregroundProtectionMask: foreground, excludedEvidenceMask: excluded })
    for (let i = 0; i < selection.data.length; i++) if (foreground.data[i] || excluded.data[i]) {
      expect(result.pixels.data[i * 4 + 3]).toBe(selection.data[i])
      expect([...result.pixels.data.subarray(i * 4, i * 4 + 3)]).toEqual(selection.data[i] ? [...source.data.subarray(i * 4, i * 4 + 3)] : [0, 0, 0])
    }
    expect(result.outerRgbSources.every(p => !excluded.data[p.y * source.width + p.x] && !excluded.data[p.sourceY * source.width + p.sourceX])).toBe(true)
  })

  it('extends only a touching selection bbox by one source pixel, with stable global coordinates', () => {
    const { source, selection } = diagonal(), crop = { x: 4, y: 4, width: 22, height: 21 }, data = new Uint8Array(crop.width * crop.height)
    for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) data[y * crop.width + x] = selection.data[(y + crop.y) * source.width + x + crop.x]
    const result = refineImageContour(source, { width: crop.width, height: crop.height, boundsPx: crop, data }, { strength: 'strong' })
    expect(result.pixels.boundsPx).toEqual({ x: 3, y: 3, width: 24, height: 23 })
    expect(result.metrics.areaDeltaPx).toBe(0)
    expect(result.outerRgbSources.every(p => p.x >= 3 && p.x <= 26 && p.y >= 3 && p.y <= 25)).toBe(true)
    expect(alpha(result, 20, 18)).toBe(255)
  })

  it('rejects nonbinary selection or translucent captured foreground and does not read transparent RGB as foreground evidence', () => {
    const { source, selection } = diagonal(); selection.data[15 * source.width + 15] = 128
    expect(() => refineImageContour(source, selection, { strength: 'strong' })).toThrow('二值')
    selection.data[15 * source.width + 15] = 255; source.data[(15 * source.width + 15) * 4 + 3] = 128
    expect(() => refineImageContour(source, selection, { strength: 'strong' })).toThrow('不透明')
    source.data[(15 * source.width + 15) * 4 + 3] = 255
    for (let i = 0; i < selection.data.length; i++) if (!selection.data[i]) source.data.set([255, 0, 255, 0], i * 4)
    const result = refineImageContour(source, selection, { strength: 'strong' })
    expect(result.outerRgbSources.length).toBeGreaterThan(0)
    for (const p of result.outerRgbSources) expect(result.pixels.data[(p.y * source.width + p.x) * 4]).toBeLessThan(40)
  })

  it('does not read or serialize outside background RGB, including fully transparent output pixels', () => {
    const { source, selection } = diagonal(), changed = { ...source, data: source.data.slice() }
    for (let i = 0; i < selection.data.length; i++) if (!selection.data[i]) changed.data.set([i % 256, (i * 53) % 256, 255 - i % 256, 255], i * 4)
    const a = refineImageContour(source, selection, { strength: 'strong' }), b = refineImageContour(changed, selection, { strength: 'strong' })
    expect(b.pixels.data).toEqual(a.pixels.data)
    expect(b.outerRgbSources).toEqual(a.outerRgbSources)
    for (let i = 0; i < a.pixels.data.length; i += 4) if (!a.pixels.data[i + 3]) expect([...a.pixels.data.subarray(i, i + 4)]).toEqual([0, 0, 0, 0])
  })

  it('offers deterministic strength blends without losing total coverage or mutating another candidate', () => {
    const { source, selection } = diagonal()
    const results = (['gentle', 'balanced', 'strong'] as const).map(strength => refineImageContour(source, selection, { strength }))
    expect(results.every(r => r.metrics.areaPreserved && r.metrics.areaDeltaPx === 0)).toBe(true)
    expect(new Set(results.map(r => [...r.pixels.data].join(','))).size).toBe(3)
    expect(refineImageContour(source, selection, { strength: 'strong' }).pixels.data).toEqual(results[2].pixels.data)
    expect(results[0].metrics.outerCoverageAreaPx).toBeLessThan(results[1].metrics.outerCoverageAreaPx)
    expect(results[1].metrics.outerCoverageAreaPx).toBeLessThan(results[2].metrics.outerCoverageAreaPx)
  })

  it('rejects excessive contour work atomically and checks cancellation inside computation', () => {
    const { source, selection } = fixture((x, y) => x >= 5 && x < 250 && y >= 5 && y < 250 && (x % 9 < 6 || y >= 240), 256, 256)
    const before = selection.data.slice()
    expect(() => refineImageContour(source, selection, { strength: 'strong' })).toThrow(/预算|20万/)
    expect(selection.data).toEqual(before)
    const small = diagonal(); let checks = 0
    expect(() => refineImageContour(small.source, small.selection, { strength: 'strong' }, { get aborted() { return ++checks > 30 } })).toThrow('取消')
    expect(checks).toBeGreaterThan(30)
  })
})
