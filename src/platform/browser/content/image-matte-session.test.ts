import { describe, expect, it } from 'vitest'
import { ImageImportToolSession, encodeImageImportPixels, type ImageImportSource } from './image-import-session.js'
import { encodeSelectionMask } from '../../../shared/image-import/selection-mask.js'
import { readImageWorkPackage } from '../../../shared/image-import/workflow.js'
import { decodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { IMAGE_IMPORT_TOOLS } from '../../../shared/image-import/recipe.js'

async function fixture(binary = false) {
  const width = 40, height = 40, data = new Uint8ClampedArray(width * height * 4), mask = new Uint8Array(18 * 18)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= 10 && x < 28 && y >= 10 && y < 28
    const a = inside ? binary || x > 10 && x < 27 && y > 10 && y < 27 ? 255 : 144 : 0
    data.set([...[28, 55, 84].map((v, c) => Math.round(v * a / 255 + [190, 170, 150][c] * (1 - a / 255))), 255], (y * width + x) * 4)
    if (inside) mask[(y - 10) * 18 + x - 10] = a
  }
  const pixels = { width, height, data }, bytes = await encodeImageImportPixels(pixels)
  const source: ImageImportSource = { pixels, image: { sha256: sha256Bytes(bytes), pixelWidth: width, pixelHeight: height }, originalBytes: bytes, normalizedBytes: bytes, originalName: 'known-edge.png', originalMime: 'image/png' }
  const layer = { id: 'chair', name: '边带真值椅', polygon: [{ x: 10, y: 10 }, { x: 28, y: 10 }, { x: 28, y: 28 }, { x: 10, y: 28 }],
    donor: { x: 1, y: 1, width: 5, height: 5 }, renderLayer: 'object' as const, blocksMovement: true, appearanceSource: 'original' as const,
    selectionMask: encodeSelectionMask({ width: 18, height: 18, boundsPx: { x: 10, y: 10, width: 18, height: 18 }, data: mask }) }
  return { source, layer }
}
const rights = { attribution: 'Synthetic edge test', licenseText: 'Independent synthetic fixture, embedding permitted.' }
interface Result {
  method: string; sourceItemSha256: string; inputHash: string; adopted: boolean; sourceChanged: boolean;
  evidence: { source: string; excludedEvidencePixels: number; alphaIsEstimated: boolean; hiddenBackgroundRecovered: boolean };
  candidates: { bytes: Uint8Array; pngSha256: string; reviewBytes: Uint8Array; duplicateOf?: string; noVisibleChangeClaim: boolean;
    recipe: { method: string; inputHash: string; sourceItemSha256: string; evidenceSha256: string; selectionSha256: string; strength: string };
    metrics: { changedPixels: number; alphaChangedPixels: number }; matteMetrics: { reconstructedPixels: number; uncertainPixels: number } }[]
}
describe('source-aware read-only matte candidate tools', () => {
  it('discovers the bounded tool and exports source-bound fractional candidates without changing reviews or work state', async () => {
    const { source, layer } = await fixture(), session = new ImageImportToolSession(source, rights)
    expect(IMAGE_IMPORT_TOOLS.find(tool => tool.name === 'image_import_matte_candidates')).toBeDefined()
    await session.execute('image_import_extract_item', { generation: 0, ...layer })
    const preview = await session.execute('image_import_item_preview', { target: 'chair' }) as { inputHash: string; itemSha256: string }
    await session.execute('image_import_review_item', { generation: 1, target: 'chair', inputHash: preview.inputHash, verdict: 'reviewed', note: 'Synthetic control only.' })
    const before = session.captureWorkState()
    const result = await session.execute('image_import_matte_candidates', { target: 'chair', count: 3, bandPx: 1 }) as Result
    expect(result).toMatchObject({ method: 'matte-edge-v1', inputHash: preview.inputHash, sourceItemSha256: preview.itemSha256, adopted: false, sourceChanged: false,
      evidence: { source: 'captured-original', excludedEvidencePixels: 0, alphaIsEstimated: true, hiddenBackgroundRecovered: false } })
    expect(result.candidates).toHaveLength(3)
    for (const candidate of result.candidates) {
      const image = decodeCanonicalPng(candidate.bytes)
      expect(candidate.recipe).toMatchObject({ method: 'matte-edge-v1', inputHash: preview.inputHash, sourceItemSha256: preview.itemSha256 })
      expect(candidate.recipe.evidenceSha256).toMatch(/^[a-f0-9]{64}$/); expect(candidate.recipe.selectionSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(sha256Bytes(candidate.bytes)).toBe(candidate.pngSha256)
      expect(candidate.metrics.changedPixels).toBeGreaterThan(0); expect(candidate.metrics.alphaChangedPixels).toBe(0)
      expect(image.rgba[3]).toBe(144); expect(image.rgba[(8 * 18 + 8) * 4 + 3]).toBe(255)
      expect(decodeCanonicalPng(candidate.reviewBytes).width).toBeGreaterThan(image.width)
    }
    expect(session.captureWorkState()).toEqual(before)
    const fresh = new ImageImportToolSession(source, rights); fresh.restoreWork((await readImageWorkPackage(await session.exportWork())).state)
    const cold = await fresh.execute('image_import_matte_candidates', { target: 'chair', count: 3 }) as Result
    expect(cold.candidates.map(c => c.pngSha256)).toEqual(result.candidates.map(c => c.pngSha256))
  })
  it('labels binary no-op/duplicates rather than claiming improved colour and rejects invalid requests atomically', async () => {
    const { source, layer } = await fixture(true), session = new ImageImportToolSession(source, rights)
    await session.execute('image_import_extract_item', { generation: 0, ...layer })
    const before = session.captureWorkState(), result = await session.execute('image_import_matte_candidates', { target: 'chair', count: 2 }) as Result
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.every(c => c.metrics.changedPixels === 0 && c.noVisibleChangeClaim)).toBe(true)
    expect(result.candidates[1].duplicateOf).toBe('matte-gentle-1x')
    expect(result.candidates[0].pngSha256).toBe(result.sourceItemSha256)
    await expect(session.execute('image_import_matte_candidates', { target: 'chair', count: 1 })).rejects.toThrow()
    await expect(session.execute('image_import_matte_candidates', { target: 'chair', count: 2, background: {} })).rejects.toThrow()
    await expect(session.execute('image_import_matte_candidates', { target: 'missing', count: 2 })).rejects.toThrow('目标不存在')
    expect(session.captureWorkState()).toEqual(before)
  })
  it('excludes prior inferred or protected outside pixels from matte evidence', async () => {
    const { source, layer } = await fixture(), session = new ImageImportToolSession(source, rights)
    await session.execute('image_import_extract_item', { generation: 0, id: 'prior', name: '前序移除', polygon: [{ x: 8, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 28 }, { x: 8, y: 28 }],
      donor: layer.donor, renderLayer: 'object', blocksMovement: true })
    await session.execute('image_import_extract_item', { generation: 1, ...layer, appearanceSource: 'working', protectionMask: { x: 28, y: 10, width: 2, height: 18, runs: [36, 255] } })
    const result = await session.execute('image_import_matte_candidates', { target: 'chair', count: 2 }) as Result
    expect(result.evidence).toMatchObject({ source: 'working-with-inference-excluded', excludedEvidencePixels: 72, hiddenBackgroundRecovered: false })
    expect(result.candidates[0].recipe.evidenceSha256).not.toBe(source.image.sha256)
  })
})
