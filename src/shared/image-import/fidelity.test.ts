import { describe, expect, it } from 'vitest'
import { assertSourcePreservingRecipe, compareImageFidelity, IMAGE_IMPORT_FIDELITY_RULES, ImageFidelityError } from './fidelity.js'
import type { ImagePixels } from './pixels.js'

function image(width: number, height: number, color: (x: number, y: number) => number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4)
  return { width, height, data }
}
const copy = (source: ImagePixels): ImagePixels => ({ ...source, data: source.data.slice() })
const paintedWood = () => image(12, 8, (x, y) => {
  const seam = x < 4 ? 2 : x < 9 ? 3 : 1
  return y === seam || y > 5 && x === (y * 3 + 1) % 12 ? [35 + x % 3, 29, 24, 255]
    : [118 + (x * 7 + y * 3) % 11, 97 + y % 3, 74 + x % 4, 255]
})

describe('source-image fidelity rules and same-coordinate pixel evidence', () => {
  it('verifies an independent exact RGBA copy without modifying either input', () => {
    const source = paintedWood(), candidate = copy(source), before = source.data.slice()
    const report = compareImageFidelity(source, candidate)
    expect(report).toMatchObject({ verified: true, passed: true, status: 'passed', comparisonKind: 'source', verificationScope: 'source-visible',
      comparedPixels: 96, changedPixels: 0, inferredPixels: 0, maxChannelError: 0, meanChannelError: 0, issues: [] })
    expect(source.data).toEqual(before)
    expect(candidate.data).toEqual(before)
    expect(candidate.data).not.toBe(source.data)
  })

  it('rejects palette reduction and straight-board replacement of original irregular strokes', () => {
    const source = paintedWood(), reduced = copy(source), before = source.data.slice()
    for (let offset = 0; offset < reduced.data.length; offset += 4) for (let channel = 0; channel < 3; channel++) {
      reduced.data[offset + channel] = Math.round(reduced.data[offset + channel] / 32) * 32
    }
    const template = image(12, 8, (_x, y) => y % 3 === 0 ? [35, 29, 24, 255] : [122, 98, 76, 255])
    for (const candidate of [reduced, template]) {
      const report = compareImageFidelity(source, candidate)
      expect(report.verified).toBe(true)
      expect(report.passed).toBe(false)
      expect(report.changedPixels).toBeGreaterThan(0)
      expect(report.maxChannelError).toBeGreaterThan(0)
      expect(report.meanChannelError).toBeGreaterThan(0)
      expect(report.issues.map(issue => issue.code)).toContain('visible-pixels-changed')
    }
    expect(source.data).toEqual(before)
  })

  it('detects the loss of a one-pixel irregular line and reports exact channel errors', () => {
    const source = image(8, 8, (x, y) => x === (y * 3 + 1) % 8 ? [20, 30, 40, 255] : [120, 110, 100, 255])
    const candidate = image(8, 8, () => [120, 110, 100, 255])
    const report = compareImageFidelity(source, candidate)
    expect(report).toMatchObject({ verified: true, passed: false, status: 'failed', comparedPixels: 64, changedPixels: 8,
      maxChannelError: 100, meanChannelError: 7.5, alphaChangedPixels: 0 })
    expect(report.firstDifferences?.[0]).toEqual({ x: 1, y: 0, maxChannelError: 100, kind: 'visible' })
    expect(report.firstDifferences).toHaveLength(8)
  })

  it('keeps a successful file roundtrip separate from a failed comparison against the original painting', () => {
    const source = paintedWood(), recolored = copy(source)
    recolored.data[0] += 10
    const reopened = copy(recolored)
    const roundtrip = compareImageFidelity(recolored, reopened, { comparisonKind: 'roundtrip' })
    expect(roundtrip).toMatchObject({ verified: false, passed: false, status: 'unverified', changedPixels: 0, verificationScope: 'unverified' })
    expect(roundtrip.issues.map(issue => issue.code)).toContain('roundtrip-not-fidelity')
    expect(compareImageFidelity(source, reopened)).toMatchObject({ verified: true, passed: false, changedPixels: 1 })
  })

  it('counts host-declared occlusion separately and refuses changes outside scope even when inference marks them', () => {
    const source = image(6, 4, () => [110, 100, 90, 255]), candidate = copy(source)
    const scopeMask = new Uint8Array(24), allowedInferenceMask = new Uint8Array(24)
    for (const index of [7, 8, 9, 10, 13, 14, 15, 16]) scopeMask[index] = 255
    allowedInferenceMask[8] = 255
    allowedInferenceMask[0] = 255
    candidate.data[8 * 4] = 60
    candidate.data[0] = 60
    const sourceBefore = source.data.slice(), scopeBefore = scopeMask.slice(), inferenceBefore = allowedInferenceMask.slice()
    const report = compareImageFidelity(source, candidate, { scopeMask, allowedInferenceMask })
    expect(report).toMatchObject({ verified: true, passed: false, verificationScope: 'source-outside-inference', comparedPixels: 7,
      changedPixels: 0, inferredPixels: 1, inferenceChangedPixels: 1, outsideScopeChangedPixels: 1 })
    expect(report.issues.map(issue => issue.code)).toContain('outside-scope-changed')
    expect(report.firstDifferences).toEqual([{ x: 0, y: 0, maxChannelError: 50, kind: 'outside-scope' }])
    candidate.data[0] = source.data[0]
    const onlyOcclusion = compareImageFidelity(source, candidate, { scopeMask, allowedInferenceMask })
    expect(onlyOcclusion).toMatchObject({ passed: true, verificationScope: 'source-outside-inference', inferredPixels: 1, inferenceChangedPixels: 1 })
    expect(onlyOcclusion.issues.map(issue => issue.code)).toContain('inference-unverified')
    expect(source.data).toEqual(sourceBefore)
    expect(scopeMask).toEqual(scopeBefore)
    expect(allowedInferenceMask).toEqual(inferenceBefore)
  })

  it('keeps empty scopes and complete inference exemptions unverified and refuses implicit coordinate alignment', () => {
    const source = paintedWood(), candidate = copy(source)
    for (const options of [{ scopeMask: new Uint8Array(96) }, { allowedInferenceMask: new Uint8Array(96).fill(255) }]) {
      const report = compareImageFidelity(source, candidate, options)
      expect(report).toMatchObject({ verified: false, passed: false, status: 'unverified', comparedPixels: 0 })
      expect(report.issues.map(issue => issue.code)).toContain('insufficient-reference')
    }
    expect(() => compareImageFidelity(source, { ...candidate, width: 8, height: 12 })).toThrowError(expect.objectContaining({ code: 'unaligned-images' }))
    expect(() => compareImageFidelity(source, candidate, { scopeMask: new Uint8Array(95) })).toThrowError(expect.objectContaining({ code: 'invalid-mask' }))
  })

  it('distinguishes alpha loss and added visible coverage from ordinary color changes', () => {
    const source = image(4, 1, x => x === 2 ? [0, 0, 0, 0] : [100, 90, 80, x === 1 ? 128 : 255]), candidate = copy(source)
    candidate.data[3] = 0
    candidate.data[7] = 64
    candidate.data[11] = 128
    const report = compareImageFidelity(source, candidate)
    expect(report).toMatchObject({ verified: true, passed: false, comparedPixels: 4, changedPixels: 3, alphaChangedPixels: 3,
      missingCoveragePixels: 2, addedCoveragePixels: 1, maxChannelError: 255, meanChannelError: 447 / 16 })
  })

  it('gives every entry point stable failures for lossy tracing or material templates and immutable rule descriptions', () => {
    expect(() => assertSourcePreservingRecipe({ layers: [{}] })).not.toThrow()
    for (const [kind, code] of [['trace', 'palette-loss'], ['wood', 'material-replacement'], ['rug', 'material-replacement']]) {
      for (const recipe of [{ floorVector: { kind }, layers: [] }, { layers: [{ vector: { kind } }] }]) {
        expect(() => assertSourcePreservingRecipe(recipe)).toThrowError(expect.objectContaining({ code, name: 'ImageFidelityError' }))
      }
    }
    expect(new ImageFidelityError('visible-pixels-changed', 'fixture')).toBeInstanceOf(Error)
    expect(IMAGE_IMPORT_FIDELITY_RULES.map(rule => rule.code)).toEqual(expect.arrayContaining([
      'palette-loss', 'material-replacement', 'theme-override', 'roundtrip-not-fidelity', 'visible-pixels-changed', 'outside-scope-changed', 'inference-unverified',
    ]))
    expect(Object.isFrozen(IMAGE_IMPORT_FIDELITY_RULES)).toBe(true)
    expect(IMAGE_IMPORT_FIDELITY_RULES.every(Object.isFrozen)).toBe(true)
  })
})
