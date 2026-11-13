import { describe, expect, it } from 'vitest'
import { ImageImportToolSession, encodeImageImportPixels, prepareImageImportFidelityPreview, type ImageImportSource } from './image-import-session.js'
import { decodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { readImageWorkPackage } from '../../../shared/image-import/workflow.js'
import { previewImageImportSubject, replayImageSubjectLayers, type ImageSubjectRefinement } from '../../../shared/image-import/subject-refinement.js'
import { replayImageLayers } from '../../../shared/image-import/layer-replay.js'
import { encodeSelectionMask } from '../../../shared/image-import/selection-mask.js'

const rights = { attribution: 'Synthetic subject workflow', licenseText: 'Original synthetic pixels; embedding permitted.' }
async function fixture() {
  const width = 48, height = 48, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= 12 && x < 36 && y >= 12 && y < 36, edge = inside && (x === 12 || x === 35 || y === 12 || y === 35), a = inside ? edge ? .6 : 1 : 0
    data.set([...[25, 40, 65].map((v, c) => Math.round(a * v + (1 - a) * [90, 135, 160][c])), 255], (y * width + x) * 4)
  }
  const pixels = { width, height, data }, bytes = await encodeImageImportPixels(pixels)
  const source: ImageImportSource = { pixels, image: { pixelWidth: width, pixelHeight: height, sha256: sha256Bytes(bytes) }, originalBytes: bytes, normalizedBytes: bytes, originalName: 'subject.png', originalMime: 'image/png' }
  const session = new ImageImportToolSession(source, rights)
  await session.execute('image_import_extract_item', { generation: 0, id: 'subject', name: '主体', polygon: [{ x: 12, y: 12 }, { x: 36, y: 12 }, { x: 36, y: 36 }, { x: 12, y: 36 }],
    selectionMask: { x: 12, y: 12, width: 24, height: 24, runs: [576, 255] }, donor: { x: 2, y: 2, width: 6, height: 6 }, renderLayer: 'object', blocksMovement: false, appearanceSource: 'original' })
  return { source, session }
}
type Preview = { inputHash: string; itemSha256: string; backgroundSha256: string }
type Candidates = { inputHash: string; sourceItemSha256: string; sourceBytes: Uint8Array; candidates: Array<{ recipe: ImageSubjectRefinement; bytes: Uint8Array; coverageBytes: Uint8Array; pngSha256: string; coverageSha256: string; metrics: { alphaChangedPixels: number; rgbChangedPixels: number } }> }

describe('staged source-aware subject workflow', () => {
  it('adopts geometric coverage with inferred outer pixels and cold-replays expanded raster coordinates', async () => {
    const { source, session } = await fixture(), state = session.captureWorkState()
    const boundsPx = { x: 10, y: 11, width: 28, height: 27 }, data = new Uint8Array(boundsPx.width * boundsPx.height)
    for (let y = 0; y < boundsPx.height; y++) for (let x = 0; x < boundsPx.width; x++) if (x + y >= 9) data[y * boundsPx.width + x] = 255
    const pixelData = source.pixels.data.slice()
    for (let y = 0; y < source.pixels.height; y++) for (let x = 0; x < source.pixels.width; x++) {
      const lx = x - boundsPx.x, ly = y - boundsPx.y, inside = lx >= 0 && ly >= 0 && lx < boundsPx.width && ly < boundsPx.height && data[ly * boundsPx.width + lx] > 0
      pixelData.set(inside ? [18, 24, 30, 255] : [120, 150, 170, 255], (y * source.pixels.width + x) * 4)
    }
    const pixels = { ...source.pixels, data: pixelData }, bytes = await encodeImageImportPixels(pixels)
    const contourSource: ImageImportSource = { ...source, pixels, image: { ...source.image, sha256: sha256Bytes(bytes) }, originalBytes: bytes, normalizedBytes: bytes }
    const layer = { ...state.draft.layers[0], selectionMask: encodeSelectionMask({ width: boundsPx.width, height: boundsPx.height, boundsPx, data }), polygon: [
      { x: 10, y: 11 }, { x: 38, y: 11 }, { x: 38, y: 38 }, { x: 10, y: 38 }], blocksMovement: true }
    const calibrated = { first: { x: 0, y: 0 }, second: { x: 48, y: 0 }, distanceMm: 731 }
    const draft = { ...state.draft, calibration: calibrated, roomPointsPx: [{ x: 1, y: 1 }, { x: 47, y: 1 }, { x: 47, y: 47 }, { x: 1, y: 47 }], layers: [layer] }
    const s = new ImageImportToolSession(contourSource, rights)
    s.restoreWork({ ...state, image: contourSource.image, original: { ...state.original, sha256: sha256Bytes(bytes), sizeBytes: bytes.length }, draft })
    const original = await s.execute('image_import_item_preview', { target: 'subject' }) as Preview, before = s.captureWorkState()
    const candidates = await s.execute('image_import_subject_candidates', { target: 'subject', method: 'subject-contour-v1', count: 3, bandPx: 1 }) as Candidates
    expect(s.captureWorkState()).toEqual(before)
    const picked = candidates.candidates[2], result = previewImageImportSubject(pixels, [layer], [], 'subject', picked.recipe)
    expect(result.method).toBe('subject-contour-v1')
    expect(result.pixels.boundsPx).toEqual({ x: 9, y: 10, width: 30, height: 29 })
    expect(result.coveragePixels).toBe(result.pixels)
    if (result.method !== 'subject-contour-v1') throw new Error('Expected geometric coverage')
    expect(result.metrics.areaDeltaPx).toBe(0); expect(result.metrics.outerSupportAddedPixels).toBeGreaterThan(0)
    expect(result.outerRgbSources.length).toBe(result.metrics.outerSupportAddedPixels)
    await s.execute('image_import_set_subject_refinement', { target: 'subject', generation: s.inspect().generation, inputHash: candidates.inputHash, refinement: picked.recipe })
    const adopted = s.captureWorkState()
    const preview = await s.execute('image_import_item_preview', { target: 'subject' }) as Preview
    expect(preview.itemSha256).toBe(picked.pngSha256); expect(preview.backgroundSha256).toBe(original.backgroundSha256)
    const cold = new ImageImportToolSession(contourSource, rights); cold.restoreWork((await readImageWorkPackage(await s.exportWork())).state)
    expect((await cold.execute('image_import_item_preview', { target: 'subject' }) as Preview).itemSha256).toBe(picked.pngSha256)
    await expect(s.execute('image_import_subject_candidates', { target: 'subject', method: 'subject-contour-v1', count: 2, bandPx: 2 })).rejects.toThrow('1原像素')
    expect(s.captureWorkState()).toEqual(adopted)
  })
  it('is read-only until exact-input adoption, keeps the source reconstruction/repair unchanged, and cold-replays derived bytes', async () => {
    const { source, session } = await fixture(), before = session.captureWorkState()
    const original = await session.execute('image_import_item_preview', { target: 'subject' }) as Preview
    const candidates = await session.execute('image_import_subject_candidates', { target: 'subject', count: 3, bandPx: 1 }) as Candidates
    expect(session.captureWorkState()).toEqual(before)
    expect(candidates.sourceItemSha256).toBe(original.itemSha256)
    const candidate = candidates.candidates[2]
    expect(candidate.metrics.alphaChangedPixels).toBeGreaterThan(20); expect(candidate.metrics.rgbChangedPixels).toBeGreaterThan(20)
    expect(sha256Bytes(candidate.bytes)).toBe(candidate.pngSha256); expect(sha256Bytes(candidate.coverageBytes)).toBe(candidate.coverageSha256)
    const alpha = decodeCanonicalPng(candidate.coverageBytes), color = decodeCanonicalPng(candidate.bytes), raw = decodeCanonicalPng(candidates.sourceBytes)
    for (let i = 0; i < raw.rgba.length; i += 4) {
      expect([...alpha.rgba.slice(i, i + 3)]).toEqual([...raw.rgba.slice(i, i + 3)])
      expect(alpha.rgba[i + 3]).toBe(color.rgba[i + 3])
    }
    await session.execute('image_import_set_subject_refinement', { generation: 1, target: 'subject', inputHash: candidates.inputHash, refinement: candidate.recipe })
    const adopted = session.captureWorkState(), preview = await session.execute('image_import_item_preview', { target: 'subject' }) as Preview
    expect(preview.itemSha256).toBe(candidate.pngSha256); expect(preview.inputHash).not.toBe(original.inputHash)
    expect(preview.backgroundSha256).toBe(original.backgroundSha256)
    expect(adopted.draft.layers[0].selectionMask).toEqual(before.draft.layers[0].selectionMask)
    const baseline = replayImageLayers(source.pixels, adopted.draft.layers), derived = replayImageSubjectLayers(source.pixels, adopted.draft.layers)
    expect(baseline.remaining).toEqual(derived.remaining)
    expect(sha256Bytes(await encodeImageImportPixels(baseline.layers[0].extracted.layer))).toBe(original.itemSha256)
    expect(derived.layers[0].sourceExtracted).toEqual(baseline.layers[0].extracted)
    const details = await session.execute('image_import_enhancement_candidates', { target: 'subject', count: 2, direction: 'clarity', scale: 1 }) as { sourceItemSha256: string; sourceBytes: Uint8Array }
    expect(details.sourceItemSha256).toBe(candidate.pngSha256)
    expect(details.sourceBytes).toEqual(candidate.bytes)
    const cold = new ImageImportToolSession(source, rights); cold.restoreWork((await readImageWorkPackage(await session.exportWork())).state)
    const repeated = await cold.execute('image_import_item_preview', { target: 'subject' }) as Preview
    expect(repeated).toMatchObject({ itemSha256: preview.itemSha256, inputHash: preview.inputHash, backgroundSha256: preview.backgroundSha256 })
    await session.execute('image_import_undo', { generation: 2 })
    expect((await session.execute('image_import_item_preview', { target: 'subject' }) as Preview).itemSha256).toBe(original.itemSha256)
  })

  it('rejects stale adoption and invalid evidence atomically, and restores the exact original on removal', async () => {
    const { session } = await fixture(), original = await session.execute('image_import_item_preview', { target: 'subject' }) as Preview
    const candidates = await session.execute('image_import_subject_candidates', { target: 'subject', count: 2, bandPx: 1 }) as Candidates
    const before = session.captureWorkState(), refinement = candidates.candidates[1].recipe
    await expect(session.execute('image_import_set_subject_refinement', { generation: 1, target: 'subject', inputHash: original.inputHash, refinement: { ...refinement, excludedEvidenceMask: { x: 46, y: 0, width: 6, height: 2, runs: [12, 255] } } })).rejects.toThrow()
    expect(session.captureWorkState()).toEqual(before)
    await session.execute('image_import_set_subject_refinement', { generation: 1, target: 'subject', inputHash: original.inputHash, refinement })
    const adopted = session.captureWorkState()
    await expect(session.execute('image_import_set_subject_refinement', { generation: 2, target: 'subject', inputHash: original.inputHash, refinement })).rejects.toThrow('旧输入')
    expect(session.captureWorkState()).toEqual(adopted)
    const changed = await session.execute('image_import_item_preview', { target: 'subject' }) as Preview
    await session.execute('image_import_set_subject_refinement', { generation: 2, target: 'subject', inputHash: changed.inputHash, refinement: null })
    expect((await session.execute('image_import_item_preview', { target: 'subject' }) as Preview).itemSha256).toBe(original.itemSha256)
  })

  it('previews new protection and its explicit removal without adopting either input', async () => {
    const { session } = await fixture(), before = session.captureWorkState()
    const protection = { x: 12, y: 17, width: 1, height: 14, runs: [14, 255] }
    const candidates = await session.execute('image_import_subject_candidates', { target: 'subject', count: 2, bandPx: 1, foregroundProtectionMask: protection }) as Candidates
    expect(session.captureWorkState()).toEqual(before)
    const chosen = candidates.candidates[1], original = decodeCanonicalPng(candidates.sourceBytes), protectedPixels = decodeCanonicalPng(chosen.bytes)
    expect(chosen.recipe.foregroundProtectionMask).toEqual(protection)
    for (let y = 5; y < 19; y++) expect([...protectedPixels.rgba.slice(y * 24 * 4, y * 24 * 4 + 4)]).toEqual([...original.rgba.slice(y * 24 * 4, y * 24 * 4 + 4)])
    await session.execute('image_import_set_subject_refinement', { target: 'subject', generation: 1, inputHash: candidates.inputHash, refinement: chosen.recipe })
    const adopted = session.captureWorkState()
    const removed = await session.execute('image_import_subject_candidates', { target: 'subject', count: 2, bandPx: 1, foregroundProtectionMask: null }) as Candidates
    expect(removed.candidates[1].recipe.foregroundProtectionMask).toBeUndefined()
    expect(session.captureWorkState()).toEqual(adopted)
    expect(removed.candidates[1].pngSha256).not.toBe(chosen.pngSha256)
    await expect(session.execute('image_import_subject_candidates', { target: 'subject', count: 2, foregroundProtectionMask: { ...protection, x: 49 } })).rejects.toThrow()
    expect(session.captureWorkState()).toEqual(adopted)
  })

  it('binds all object evidence to review identity and leaves the baseline fidelity gate independent', async () => {
    const { source, session } = await fixture(), before = await session.execute('image_import_item_preview', { target: 'subject' }) as Preview
    const refinement: ImageSubjectRefinement = { method: 'subject-matte-v1', bandPx: 1, strength: 'strong' }
    await session.execute('image_import_set_subject_refinement', { generation: 1, target: 'subject', inputHash: before.inputHash, refinement })
    const adopted = await session.execute('image_import_item_preview', { target: 'subject' }) as Preview
    await session.execute('image_import_extract_item', { generation: 2, id: 'neighbor', name: '邻物', polygon: [{ x: 37, y: 16 }, { x: 40, y: 16 }, { x: 40, y: 30 }, { x: 37, y: 30 }], donor: { x: 2, y: 2, width: 6, height: 6 }, renderLayer: 'object', blocksMovement: false })
    expect((await session.execute('image_import_item_preview', { target: 'subject' }) as Preview).inputHash).not.toBe(adopted.inputHash)
    const layer = session.inspect().draft.layers[0]
    const result = previewImageImportSubject(source.pixels, [layer], [], 'subject', refinement)
    expect(result.originalSourcePreserved).toBe(true); expect(result.visualQualityPassed).toBe(false)
    const recipe = { format: 'sceneweave-image-import-recipe', version: 1, image: source.image, title: 'fixture', calibration: { first: { x: 0, y: 0 }, second: { x: 48, y: 0 }, distanceMm: 960 }, roomPointsPx: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }, { x: 0, y: 48 }], layers: [layer] }
    const assessment = await prepareImageImportFidelityPreview(source, recipe)
    expect(assessment.report.passed).toBe(true)
    expect(result.metrics.alphaChangedPixels).toBeGreaterThan(0)
  })

  it('accepts an empty optional outline from a page work package without accepting an incomplete drawn outline', async () => {
    const { session } = await fixture(), state = session.captureWorkState()
    const draft = { ...state.draft, calibration: { first: { x: 0, y: 0 }, second: { x: 48, y: 0 }, distanceMm: 960 },
      roomPointsPx: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }, { x: 0, y: 48 }], sourceBoundaryPx: [] }
    session.restoreWork({ ...state, draft })
    await expect(session.execute('image_import_assess_fidelity', {})).resolves.toMatchObject({ report: { passed: true } })
    expect(session.captureWorkState().draft.sourceBoundaryPx).toEqual([])
    session.restoreWork({ ...state, draft: { ...draft, sourceBoundaryPx: [{ x: 1, y: 1 }, { x: 47, y: 1 }] } })
    await expect(session.execute('image_import_assess_fidelity', {})).rejects.toThrow()
  })
})
