import { describe, expect, it } from 'vitest'
import { inspectImageRepairBoundaryEvidence } from './repair-boundary-evidence.js'
import type { ImagePixelMask } from './pixels.js'

const mask = (x: number, y: number, width: number, height: number, points?: readonly [number, number][]): ImagePixelMask => {
  const data = new Uint8Array(width * height)
  if (points) for (const [px, py] of points) data[(py - y) * width + px - x] = 255
  else data.fill(255)
  return { width, height, boundsPx: { x, y, width, height }, data }
}
const image = { width: 64, height: 64 }

describe('actual repair boundary evidence', () => {
  it('counts each external neighbour once, including a hole inside a disconnected write', () => {
    const write = mask(10, 10, 3, 3); write.data[4] = 0
    const result = inspectImageRepairBoundaryEvidence(image, mask(0, 0, 64, 64), write)
    expect(result.counts.boundaryPixels).toBe(13)
    expect(result.counts.unmarkedOriginalPixels).toBe(13)
    expect(result.inferenceSites).toEqual([])
    expect(result.limitation).toContain('未标记不证明')
  })

  it('keeps disjoint categories and reports the exact earlier producer without reading RGB', () => {
    const prior = new Uint8Array(64 * 64)
    prior[9 * 64 + 10] = 7; prior[9 * 64 + 11] = 3
    prior[10 * 64 + 9] = 4 // protection takes precedence
    prior[12 * 64 + 10] = 5 // other current removal takes precedence
    const result = inspectImageRepairBoundaryEvidence(image, mask(0, 0, 64, 64), mask(10, 10, 2, 2), {
      priorInference: prior, protectionMask: mask(9, 10, 1, 1), removalMask: mask(10, 12, 1, 1), excludedEvidenceMask: mask(12, 10, 1, 1),
    })
    expect(result.counts).toEqual({ boundaryPixels: 8, unmarkedOriginalPixels: 3, priorInferencePixels: 2, protectionPixels: 1, otherRemovalPixels: 1, excludedPixels: 1, outsideMaterialPixels: 0, outsideImagePixels: 0 })
    expect(result.inferenceSites).toEqual([{ boundsPx: { x: 10, y: 9, width: 2, height: 1 }, pixels: 2, producers: [{ step: 3, pixels: 1 }, { step: 7, pixels: 1 }] }])
    expect(result.unlistedInferencePixels).toBe(0)
  })

  it('uses only the actual writable intersection after material and protection restrictions', () => {
    const write = mask(0, 0, 3, 3), surface = mask(0, 0, 2, 3), protection = mask(0, 1, 1, 1)
    const result = inspectImageRepairBoundaryEvidence(image, surface, write, { protectionMask: protection })
    expect(result.counts.boundaryPixels).toBe(Object.values(result.counts).slice(1).reduce((a, b) => a + b, 0))
    expect(result.counts.outsideImagePixels).toBe(4)
    expect(result.counts.outsideMaterialPixels).toBe(5)
    expect(result.counts.protectionPixels).toBe(1)
    expect(result.counts.unmarkedOriginalPixels).toBe(0)
  })

  it('keeps complete counts when only six local sites fit and does not mutate input arrays', () => {
    const wide = { width: 160, height: 40 }, surface = mask(0, 0, 160, 40), write = mask(0, 10, 160, 2), prior = new Uint8Array(160 * 40)
    for (let x = 0; x < 160; x++) { prior[9 * 160 + x] = 2; prior[12 * 160 + x] = 4 }
    const before = prior.slice(), dataBefore = write.data.slice()
    const result = inspectImageRepairBoundaryEvidence(wide, surface, write, { priorInference: prior })
    expect(result.counts.priorInferencePixels).toBe(320)
    expect(result.inferenceSites).toHaveLength(6)
    expect(result.unlistedInferencePixels).toBe(320 - result.inferenceSites.reduce((n, s) => n + s.pixels, 0))
    expect(result.unlistedInferencePixels).toBeGreaterThan(0)
    expect(prior).toEqual(before); expect(write.data).toEqual(dataBefore)
  })

  it('rejects malformed masks, oversized writes and mismatched provenance, and honours cancellation', () => {
    const surface = mask(0, 0, 64, 64), write = mask(10, 10, 2, 2)
    const bad = { ...write, data: new Uint8Array([128, 255, 0, 0]) }
    expect(() => inspectImageRepairBoundaryEvidence(image, surface, bad)).toThrow('二值')
    expect(() => inspectImageRepairBoundaryEvidence(image, surface, write, { priorInference: new Uint8Array(10) })).toThrow('逐原图')
    expect(() => inspectImageRepairBoundaryEvidence({ width: 9000, height: 10 }, surface, write)).toThrow('有界')
    expect(() => inspectImageRepairBoundaryEvidence({ width: 501, height: 501 }, mask(0, 0, 501, 501), mask(0, 0, 501, 501))).toThrow('25万')
    const controller = new AbortController(); controller.abort()
    expect(() => inspectImageRepairBoundaryEvidence(image, surface, write, { signal: controller.signal })).toThrow()
    expect(inspectImageRepairBoundaryEvidence(image, surface, mask(10, 10, 2, 2, [])).counts.boundaryPixels).toBe(0)
  })
})
