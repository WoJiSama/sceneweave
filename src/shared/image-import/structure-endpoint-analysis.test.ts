import { describe, expect, it } from 'vitest'
import { inspectImageStructureEndpoints } from './structure-endpoint-analysis.js'
import type { ImagePixelMask } from './pixels.js'
import type { ImageSurfaceStructureGuide } from './guided-surface-repair.js'

const image = { width: 96, height: 48 }
const mask = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
const guide: ImageSurfaceStructureGuide = { axis: 'horizontal', points: [{ x: 2, y: 24 }, { x: 79, y: 24 }], reference: { x: 4, y: 20, width: 3, height: 9 }, reason: '人工推断；须对照可见木缝。' }

describe('structure endpoint observations', () => {
  it('locates a six-pixel gap inside actual writes and clears the suspicion at the material edge without changing geometry', () => {
    const surface = mask(0, 0, 86, 48), writable = mask(50, 12, 36, 24), before = writable.data.slice()
    const [finding] = inspectImageStructureEndpoints([guide], surface, writable, image)
    expect(finding).toMatchObject({ guideIndex: 0, endpoint: 'end', positionPx: { x: 79, y: 24 }, writableContinuationPx: 6, materialGapPx: 6 })
    expect(finding.instruction).toContain('板头'); expect(finding.instruction).toContain('不自动延长')
    expect(inspectImageStructureEndpoints([{ ...guide, points: [{ x: 2, y: 24 }, { x: 85, y: 24 }] }], surface, writable, image)).toEqual([])
    expect(guide.points.at(-1)).toEqual({ x: 79, y: 24 }); expect(writable.data).toEqual(before)
  })

  it('respects protection and disjoint holes, so a distant writable island is not a continuation', () => {
    const surface = mask(0, 0, 86, 48), writable = mask(50, 12, 36, 24)
    writable.data[(24 - 12) * 36 + 81 - 50] = 0
    expect(inspectImageStructureEndpoints([guide], surface, writable, image)).toEqual([])
    writable.data[(24 - 12) * 36 + 79 - 50] = 0
    expect(inspectImageStructureEndpoints([guide], surface, writable, image)).toEqual([])
  })

  it('handles reversed and vertical paths, repeated terminal points and subpixel positions', () => {
    const surface = mask(0, 0, 86, 48), writable = mask(50, 12, 36, 24)
    const [a] = inspectImageStructureEndpoints([{ ...guide, points: [...guide.points].reverse() }], surface, writable, image)
    expect(a.endpoint).toBe('start'); expect(a.materialGapPx).toBe(6)
    const transpose = (m: ImagePixelMask): ImagePixelMask => { const b = m.boundsPx; return mask(b.y, b.x, b.height, b.width) }
    const points = [{ x: 24, y: 2 }, { x: 24, y: 79.2 }, { x: 24, y: 79.2 }]
    const [b] = inspectImageStructureEndpoints([{ ...guide, axis: 'vertical', points }], transpose(surface), transpose(writable), { width: 48, height: 96 })
    expect(b.materialGapPx).toBe(6); expect(b.writableContinuationPx).toBe(6)
    expect(inspectImageStructureEndpoints([{ ...guide, points: [{ x: 79, y: 24 }, { x: 79, y: 24 }] }], surface, writable, image)).toEqual([])
  })

  it('bounds open-ended scans, checks malformed masks and stops on cancellation', () => {
    const surface = mask(0, 0, 96, 48), writable = mask(0, 0, 96, 48), g = { ...guide, points: [{ x: 1, y: 24 }, { x: 20, y: 24 }] }
    const [r] = inspectImageStructureEndpoints([g], surface, writable, image)
    expect(r.writableContinuationPx).toBe(32); expect(r.materialGapPx).toBeUndefined()
    expect(() => inspectImageStructureEndpoints(Array(33).fill(g), surface, writable, image)).toThrow('最多32')
    expect(() => inspectImageStructureEndpoints([g], surface, { ...writable, data: new Uint8Array(2) }, image)).toThrow('完整有界')
    expect(() => inspectImageStructureEndpoints([g], surface, writable, image, { aborted: true, throwIfAborted() {} })).toThrow('已取消')
  })
})
