import { describe, expect, it } from 'vitest'
import { analyzeImageRepairNeighborhood, repairImageNeighborhood } from './neighborhood-repair.js'
import type { ImagePixelMask, ImagePixels } from './pixels.js'
import { maskCoverage } from './repair-scope.js'

const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
function fixture(width = 96, height = 80): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ink = y % 13 < 2, grain = (x * 7 + y * 3) % 9
    data.set(ink ? [40, 35, 30, 255] : [118 + grain, 103 + grain, 87 + grain, 255], (y * width + x) * 4)
  }
  return { width, height, data }
}
const removal = box(26, 22, 24, 34), donor = { x: 54, y: 8, width: 35, height: 60 }, surfaceMask = box(5, 4, 84, 68)
const rgba = (image: ImagePixels, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]

describe('original-only neighborhood repair and explanation', () => {
  it('never reads hidden, protected, excluded, out-of-surface or prior-inference RGB; writes only the authorized hole', () => {
    const a = fixture(), b = fixture(), protectionMask = box(42, 25, 8, 15), excludedEvidenceMask = box(8, 20, 8, 40)
    const priorInference = new Uint8Array(a.width * a.height)
    for (let y = 30; y < 44; y++) for (let x = 18; x < 23; x++) priorInference[y * a.width + x] = 3
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      if (!maskCoverage(surfaceMask, x, y) || maskCoverage(removal, x, y) || maskCoverage(excludedEvidenceMask, x, y) || priorInference[y * a.width + x]) {
        a.data.set([255, 0, 255, 17], (y * a.width + x) * 4)
        b.data.set([0, 255, 0, 255], (y * a.width + x) * 4)
      }
    }
    const options = { surfaceMask, protectionMask, excludedEvidenceMask, priorInference, pattern: 'planks' as const }
    const before = a.data.slice(), left = repairImageNeighborhood(a, removal, donor, options), right = repairImageNeighborhood(b, removal, donor, options)
    expect(left.report).toEqual(right.report)
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      if (maskCoverage(removal, x, y) && !maskCoverage(protectionMask, x, y)) expect(rgba(left.pixels, x, y)).toEqual(rgba(right.pixels, x, y))
      else expect(rgba(left.pixels, x, y)).toEqual(rgba(a, x, y))
    }
    for (const site of left.report.sites) for (const candidate of site.candidates) {
      const s = candidate.sourceBoundsPx
      for (let y = s.y; y < s.y + s.height; y++) for (let x = s.x; x < s.x + s.width; x++) {
        expect(maskCoverage(surfaceMask, x, y)).toBe(255)
        expect(maskCoverage(removal, x, y) + maskCoverage(protectionMask, x, y) + maskCoverage(excludedEvidenceMask, x, y) + priorInference[y * a.width + x]).toBe(0)
      }
    }
    expect(left.report.counts.excludedInferencePixels).toBe(70)
    expect(a.data).toEqual(before)
    expect(repairImageNeighborhood(a, removal, donor, options)).toEqual(left)
  })

  it('returns traceable source choices, component differences and local guidance without granting acceptance', () => {
    const result = repairImageNeighborhood(fixture(), box(18, 18, 36, 42), donor, { surfaceMask, pattern: 'planks' })
    expect(result.report.scoreMeaning).toBe('lower-is-better-diagnostic-not-probability')
    expect(result.report.sites.length).toBeGreaterThan(1)
    for (const site of result.report.sites) {
      expect(site.candidates[0].sourceBoundsPx).toEqual(site.chosenSourceBoundsPx)
      expect(site.candidates[0].reasons.join(' ')).toContain('相邻拼接差')
      for (const candidate of site.candidates) {
        expect(Number.isFinite(candidate.score)).toBe(true)
        expect(Number.isFinite(candidate.neighborCompatibilityError)).toBe(true)
        expect(Object.values(candidate.metrics).every(Number.isFinite)).toBe(true)
      }
    }
    expect(result.report.status).toBe('needs-guidance')
    expect(result.report.conflicts.some(c => c.kind === 'unsupported-structure' && c.action === 'confirm-structure')).toBe(true)
    expect(result.report.conflicts.every(c => c.boundsPx.width <= 12 && c.boundsPx.height <= 12)).toBe(true)
    expect(result.report.limitations.join(' ')).toContain('不是成功概率')
  })

  it('assesses an existing flat repair and an actual internal discontinuity without changing either input', () => {
    const image = fixture(), flat = fixture(), split = fixture()
    for (let y = removal.boundsPx.y; y < removal.boundsPx.y + removal.height; y++) for (let x = removal.boundsPx.x; x < removal.boundsPx.x + removal.width; x++) {
      flat.data.set([123, 108, 92, 255], (y * image.width + x) * 4)
      split.data.set(x < 38 ? [95, 85, 75, 255] : [225, 215, 205, 255], (y * image.width + x) * 4)
    }
    const before = flat.data.slice(), options = { surfaceMask, pattern: 'planks' as const }
    const a = analyzeImageRepairNeighborhood(image, flat, removal, donor, options), b = analyzeImageRepairNeighborhood(image, split, removal, donor, options)
    expect(a.analysisMode).toBe('assessment')
    expect(a.conflicts.some(c => c.kind === 'too-flat')).toBe(true)
    expect(b.conflicts.some(c => c.kind === 'edge-discontinuity' && c.message.includes('拼接处'))).toBe(true)
    expect(flat.data).toEqual(before)
  })

  it('localizes insufficient evidence in analysis and rejects the same repair atomically', () => {
    const image = fixture(), before = image.data.slice(), excludedEvidenceMask = box(57, 11, 1, 1)
    const options = { surfaceMask, excludedEvidenceMask, pattern: 'soft' as const }
    const report = analyzeImageRepairNeighborhood(image, image, removal, donor, options)
    expect(report.status).toBe('needs-guidance')
    expect(report.sites).toEqual([])
    expect(report.counts.candidatePatches).toBe(0)
    expect(report.conflicts[0]).toMatchObject({ kind: 'insufficient-evidence', action: 'choose-sample', boundsPx: { x: 57, y: 11 } })
    expect(report.conflicts[0].boundsPx.width).toBeLessThanOrEqual(12)
    expect(() => repairImageNeighborhood(image, removal, donor, options)).toThrow('可信样本')
    expect(image.data).toEqual(before)
  })

  it('bounds diagnostics for larger holes and returns no visual pass even without an alert', () => {
    const image = fixture(230, 190), largeRemoval = box(12, 12, 132, 120)
    const result = repairImageNeighborhood(image, largeRemoval, { x: 160, y: 8, width: 55, height: 170 }, { surfaceMask: box(4, 4, 220, 180), pattern: 'soft' })
    expect(result.report.counts.analyzedSites).toBeGreaterThan(96)
    expect(result.report.sites.length).toBeLessThanOrEqual(96)
    expect(result.report.conflicts.length).toBeLessThanOrEqual(24)
    expect(['needs-review', 'needs-guidance']).toContain(result.report.status)
    expect(JSON.stringify(result.report).length).toBeLessThan(400_000)
  })

  it('rejects malformed inputs and cancellation before returning a changed image', () => {
    const image = fixture(), before = image.data.slice(), options = { surfaceMask, pattern: 'soft' as const }
    expect(() => repairImageNeighborhood(image, { ...removal, data: new Uint8Array(2) }, donor, options)).toThrow('二值')
    expect(() => analyzeImageRepairNeighborhood(image, image, removal, { ...donor, x: 90 }, options)).toThrow('干净底材')
    expect(() => analyzeImageRepairNeighborhood(image, { ...image, data: new Uint8ClampedArray(4) }, removal, donor, options)).toThrow('同一完整原图')
    expect(() => repairImageNeighborhood(image, removal, donor, { ...options, priorInference: new Uint8Array(4) })).toThrow('逐原图像素')
    expect(() => repairImageNeighborhood(image, removal, donor, { ...options, signal: { aborted: true } })).toThrow('已取消')
    expect(image.data).toEqual(before)
  })
})
