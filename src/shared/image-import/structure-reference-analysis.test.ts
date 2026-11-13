import { describe, expect, it } from 'vitest'
import { inspectImageStructureReferences } from './structure-reference-analysis.js'
import type { ImagePixels } from './pixels.js'
import type { ImageSurfaceStructureGuide } from './guided-surface-repair.js'

const guide: ImageSurfaceStructureGuide = { points: [{ x: 3, y: 20 }, { x: 25, y: 20 }], reference: { x: 5, y: 4, width: 15, height: 17 }, axis: 'horizontal', reason: '人工推断路径，原图参考仍需看图。' }
function fixture(centres: number[], widths: number[] = centres.map(() => 2)): ImagePixels {
  const image = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) }
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) image.data.set([130 + (x + y) % 3, 115 + (x + y) % 3, 95 + (x + y) % 3, 255], (y * 32 + x) * 4)
  for (let u = 0; u < centres.length; u++) for (let v = 0; v < widths[u]; v++) image.data.set([70, 55, 40, 255], ((4 + centres[u] + v) * 32 + 5 + u) * 4)
  return image
}

describe('original structure reference observations', () => {
  it('keeps a narrow mildly wandering original stroke as review-only and never infers visual acceptance', () => {
    const image = fixture(Array.from({ length: 15 }, (_, i) => 7 + i % 2)), before = image.data.slice()
    const [r] = inspectImageStructureReferences(image, [guide], () => true)
    expect(r.metrics).toMatchObject({ peakDisplacementPx: 1, widthRangePx: 0, medianWidthPx: 2 })
    expect(r.status).toBe('needs-review'); expect(r.warnings).toEqual([])
    expect(r.sampledPixels).toBe(255); expect(r.referenceBoundsPx).toEqual(guide.reference)
    expect(image.data).toEqual(before)
    r.referenceBoundsPx.x = 0
    expect(guide.reference.x).toBe(5)
  })

  it('reports a curved reference and a crossing as different measurable ambiguities instead of classifying the material', () => {
    const curve = fixture(Array.from({ length: 15 }, (_, i) => 3 + Math.floor(i / 2)))
    const [curved] = inspectImageStructureReferences(curve, [guide], () => true)
    expect(curved.metrics!.peakDisplacementPx).toBe(7)
    expect(curved.warnings.join('')).toContain('曲线、斜线或相邻线')
    const crossing = fixture(Array(15).fill(6), Array.from({ length: 15 }, (_, i) => i === 7 ? 7 : 2))
    const [crossed] = inspectImageStructureReferences(crossing, [guide], () => true)
    expect(crossed.metrics!.widthRangePx).toBe(5)
    expect(crossed.warnings.join('')).toContain('交叉线、装饰或阴影')
    expect(curved.status).toBe('needs-judgment'); expect(crossed.status).toBe('needs-judgment')
  })

  it('keeps vertical and horizontal observations equivalent and independent of inferred path reversal', () => {
    const image = fixture(Array.from({ length: 15 }, (_, i) => 3 + Math.floor(i / 2))), transposed = { ...image, data: image.data.slice() }
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) transposed.data.set(image.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4), (x * 32 + y) * 4)
    const vertical = { ...guide, axis: 'vertical' as const, reference: { x: 4, y: 5, width: 17, height: 15 } }
    const a = inspectImageStructureReferences(image, [guide], () => true)[0]
    const b = inspectImageStructureReferences(transposed, [vertical], () => true)[0]
    expect(b.metrics).toEqual(a.metrics); expect(b.warnings).toEqual(a.warnings)
    expect(inspectImageStructureReferences(image, [{ ...guide, points: [...guide.points].reverse() }], () => true)).toEqual([a])
  })

  it('does not measure any part of an unavailable or transparent reference, regardless of its hidden RGB', () => {
    const image = fixture(Array(15).fill(7)), changed = { ...image, data: image.data.slice() }
    for (let i = 0; i < changed.data.length; i += 4) changed.data.set([255, 0, 240, 255], i)
    const available = (x: number, y: number) => x !== 12 || y !== 11
    const a = inspectImageStructureReferences(image, [guide], available)
    expect(inspectImageStructureReferences(changed, [guide], available)).toEqual(a)
    expect(a[0].sampledPixels).toBe(0); expect(a[0].metrics).toBeUndefined(); expect(a[0].status).toBe('unavailable')
    image.data[(11 * 32 + 12) * 4 + 3] = 0
    expect(inspectImageStructureReferences(image, [guide], () => true)[0].status).toBe('unavailable')
  })

  it('reports broad, clipped and weak source strokes without modifying or rejecting the repair recipe', () => {
    const broad = fixture(Array(15).fill(5), Array(15).fill(7))
    expect(inspectImageStructureReferences(broad, [guide], () => true)[0].warnings.join('')).toContain('中位数为7px')
    const clipped = fixture(Array(15).fill(0), Array(15).fill(2))
    expect(inspectImageStructureReferences(clipped, [guide], () => true)[0].warnings.join('')).toContain('参考边缘')
    const flat = fixture([])
    expect(inspectImageStructureReferences(flat, [guide], () => true)[0].warnings.join('')).toContain('不足5级')
  })

  it('enforces bounded reference reads and cancellation before producing a report', () => {
    const image = fixture(Array(15).fill(7))
    expect(() => inspectImageStructureReferences(image, Array(33).fill(guide), () => true)).toThrow('最多32')
    expect(() => inspectImageStructureReferences(image, [{ ...guide, reference: { x: 30, y: 4, width: 15, height: 17 } }], () => true)).toThrow('原图内')
    let checked = 0
    expect(() => inspectImageStructureReferences(image, [guide], () => true, { aborted: false, throwIfAborted() { if (++checked > 5) throw new Error('cancelled') } })).toThrow('cancelled')
  })
})
