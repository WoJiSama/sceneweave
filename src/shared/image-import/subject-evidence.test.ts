import { describe, expect, it } from 'vitest'
import { previewImageImportSubject, validateImageSubjectRefinement, type ImageSubjectLayer, type ImageSubjectRefinement } from './subject-refinement.js'
import { replayImageLayers } from './layer-replay.js'
import { maskCoverage } from './repair-scope.js'
import type { ImagePixels } from './pixels.js'

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, runs: [width * height, 255] })
const polygon = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function fixture() {
  const width = 128, height = 48, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= 12 && x < 36 && y >= 12 && y < 36
    const edge = inside && (x === 12 || x === 35 || y === 12 || y === 35), alpha = inside ? edge ? .6 : 1 : 0
    data.set([...[25, 40, 65].map((v, c) => Math.round(alpha * v + (1 - alpha) * [90, 135, 160][c])), 255], (y * width + x) * 4)
  }
  const source: ImagePixels = { width, height, data }
  const layer: ImageSubjectLayer = { id: 'subject', polygon: polygon(12, 12, 24, 24), donor: { x: 2, y: 2, width: 6, height: 6 },
    renderLayer: 'object', appearanceSource: 'original', selectionMask: rect(12, 12, 24, 24) }
  const options: ImageSubjectRefinement = { method: 'subject-reference-v1', strength: 'strong', bandPx: 1,
    referenceGuidance: { base: 'original', foreground: rect(16, 16, 3, 1), background: rect(75, 16, 3, 1), mixed: rect(35, 16, 1, 8) } }
  return { source, layer, options }
}

describe('explicit subject reference evidence beyond the automatic band', () => {
  it('accepts a trustworthy far reference, while rejecting neighboring objects, removal scopes, protections and exclusions at the same coordinates', () => {
    const { source, layer, options } = fixture()
    const valid = previewImageImportSubject(source, [layer], [], layer.id, options)
    expect(valid).toMatchObject({ method: 'subject-reference-v1', metrics: { estimatedPixels: 8 } })
    const neighbor = { ...layer, id: 'neighbor', polygon: polygon(75, 16, 3, 3), selectionMask: rect(75, 16, 3, 3) }
    const fartherNeighbor = { ...neighbor, polygon: polygon(80, 16, 3, 3), selectionMask: rect(80, 16, 3, 3), removalMask: rect(75, 16, 8, 3) }
    for (const other of [neighbor, fartherNeighbor]) expect(() => previewImageImportSubject(source, [layer, other], [], layer.id, options)).toThrow('原图参考(75,16)')
    expect(() => previewImageImportSubject(source, [{ ...layer, protectionMask: rect(75, 16, 3, 3) }], [], layer.id, options)).toThrow('原图参考(75,16)')
    expect(() => previewImageImportSubject(source, [layer], [], layer.id, { ...options, excludedEvidenceMask: rect(75, 16, 3, 3) })).toThrow('原图参考(75,16)')
    expect(() => previewImageImportSubject(source, [layer], [], layer.id, { ...options, foregroundProtectionMask: rect(75, 16, 3, 3) })).toThrow()
  })

  it('checks distant foreground references too and keeps the contour baseline independent of colour exclusions', () => {
    const { source, layer, options } = fixture()
    const right = { ...layer, polygon: polygon(12, 12, 84, 24), selectionMask: rect(12, 12, 84, 24) }
    // The explicit foreground is inside a wide target; its exclusion must not be
    // dropped just because the mixed scope is on the opposite side.
    const input = { ...options, referenceGuidance: { ...options.referenceGuidance!, foreground: rect(75, 16, 3, 1), background: rect(7, 16, 3, 1) }, excludedEvidenceMask: rect(75, 16, 3, 1) }
    expect(() => previewImageImportSubject(source, [right], [], right.id, input)).toThrow('原图参考(75,16)')
    const geometry = previewImageImportSubject(source, [layer], [], layer.id, { method: 'subject-contour-v1', strength: 'strong', bandPx: 1, excludedEvidenceMask: rect(75, 16, 3, 3) })
    expect(geometry.method).toBe('subject-contour-v1')
  })

  it('rejects an inferred far reference even when its producer is a ground layer excluded from the neighboring-object masks', () => {
    const { source, layer, options } = fixture()
    const prior: ImageSubjectLayer = { ...layer, id: 'prior-ground', renderLayer: 'ground', polygon: polygon(75, 16, 3, 3), selectionMask: rect(75, 16, 3, 3), repair: 'tile' }
    const replay = replayImageLayers(source, [prior])
    expect(replay.provenance[16 * source.width + 75]).toBeGreaterThan(0)
    expect(maskCoverage(replay.layers[0].extracted.repairMask, 75, 16)).toBe(255)
    expect(() => previewImageImportSubject(source, [prior, { ...layer, appearanceSource: 'working' }], [], layer.id, options)).toThrow('原图参考(75,16)')
    expect(previewImageImportSubject(source, [prior, layer], [], layer.id, options)).toMatchObject({ method: 'subject-reference-v1', metrics: { estimatedPixels: 8 } })
  })

  it('rejects oversized reference rectangles before decoding and retains the strict recipe budget', () => {
    const { source, options } = fixture()
    const oversized = { ...options, referenceGuidance: { ...options.referenceGuidance!, background: { x: 0, y: 0, width: 128, height: 48, runs: [3, 255, 6141, 0] } } }
    expect(() => validateImageSubjectRefinement(source, oversized)).toThrow('4096')
  })
})
