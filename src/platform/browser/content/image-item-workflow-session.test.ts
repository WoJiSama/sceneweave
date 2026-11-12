import { describe, expect, it } from 'vitest'
import { ImageImportToolSession, encodeImageImportPixels, loadImageImportWorkSource, type ImageImportSource } from './image-import-session.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { readImageWorkPackage } from '../../../shared/image-import/workflow.js'
import { decodeSelectionMask } from '../../../shared/image-import/selection-mask.js'
import { artworkValidation, encodeFixtureRaster } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { inspectImageBytes } from '../../../shared/project/image-bytes.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import type { ImageSelectionOrigin } from '../../../shared/image-import/selection-origin.js'
import { decodeCanonicalPng } from '../../../shared/project/png-rgba.js'

async function source(): Promise<ImageImportSource> {
  const data = new Uint8ClampedArray(12 * 12 * 4)
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) data.set(x >= 3 && x < 8 && y >= 3 && y < 8 ? [20, 30, 40, 255] : [80, 130, 170, 255], (y * 12 + x) * 4)
  const pixels = { width: 12, height: 12, data }, bytes = await encodeImageImportPixels(pixels)
  return { pixels, image: { sha256: sha256Bytes(bytes), pixelWidth: 12, pixelHeight: 12 }, originalBytes: bytes, normalizedBytes: bytes, originalName: 'fixture.png', originalMime: 'image/png' }
}
const rights = { attribution: 'Synthetic source', licenseText: 'Synthetic pixels, embedding permitted.' }
const guide = { bounds: { x: 1, y: 1, width: 9, height: 9 }, foreground: [{ points: [{ x: 5, y: 5 }], radiusPx: 1 }], background: [{ points: [{ x: 2, y: 2 }], radiusPx: 1 }] }
const item = { id: 'chair', name: '椅', polygon: [{ x: 1, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 10 }, { x: 1, y: 10 }], donor: { x: 10, y: 0, width: 2, height: 2 }, renderLayer: 'object', blocksMovement: true, guidedSelection: guide }

describe('model-neutral resumable image workflow', () => {
  it('changes only repair scope atomically, invalidates old reviews, and replays exact bytes after undo and cold resume', async () => {
    const input = await source(), session = new ImageImportToolSession(input, rights)
    const selectionMask = { x: 3, y: 3, width: 5, height: 5, runs: [25, 255] }
    await session.execute('image_import_extract_item', { generation: 0, ...item, selectionMask })
    const initial = session.captureWorkState(), before = await session.execute('image_import_item_preview', { target: 'chair' }) as { inputHash: string; itemSha256: string; backgroundSha256: string }
    await session.execute('image_import_review_item', { generation: 1, target: 'chair', inputHash: before.inputHash, verdict: 'needs-work', note: 'Baseline' })
    const args = { generation: 2, target: 'chair', removalMask: { x: 2, y: 2, width: 7, height: 7, runs: [49, 255] }, protectionMask: { x: 8, y: 2, width: 1, height: 7, runs: [7, 255] } }
    const valid = session.captureWorkState()
    await expect(session.execute('image_import_set_repair_scope', { ...args, protectionMask: selectionMask })).rejects.toThrow('冲突')
    expect(session.captureWorkState()).toEqual(valid)
    await session.execute('image_import_set_repair_scope', args)
    const changed = await session.execute('image_import_item_preview', { target: 'chair' }) as typeof before
    expect(changed.itemSha256).toBe(before.itemSha256)
    expect(changed.inputHash).not.toBe(before.inputHash)
    expect(session.captureWorkState().draft.layers[0].selectionMask).toEqual(selectionMask)
    const after = session.captureWorkState()
    await expect(session.execute('image_import_set_repair_scope', args)).rejects.toThrow()
    await expect(session.execute('image_import_review_item', { generation: 3, target: 'chair', inputHash: before.inputHash, verdict: 'reviewed', note: 'Stale' })).rejects.toThrow()
    expect(session.captureWorkState()).toEqual(after)
    const fresh = new ImageImportToolSession(input, rights)
    fresh.restoreWork((await readImageWorkPackage(await session.exportWork())).state)
    const cold = await fresh.execute('image_import_item_preview', { target: 'chair' }) as typeof before
    expect(cold.itemSha256).toBe(changed.itemSha256); expect(cold.backgroundSha256).toBe(changed.backgroundSha256)
    await session.execute('image_import_undo', { generation: 3 })
    expect(session.captureWorkState().draft.layers).toEqual(initial.draft.layers)
    expect((await session.execute('image_import_item_preview', { target: 'chair' }) as typeof before).backgroundSha256).toBe(before.backgroundSha256)
  })
  it('exports deterministic post-cut candidates while preserving the original mask, state and review identity', async () => {
    const session = new ImageImportToolSession(await source(), rights)
    await session.execute('image_import_extract_item', { generation: 0, ...item })
    const before = session.captureWorkState(), preview = await session.execute('image_import_item_preview', { target: 'chair' }) as { inputHash: string; itemSha256: string }
    const result = await session.execute('image_import_enhancement_candidates', { target: 'chair', direction: 'clarity', count: 3 }) as {
      inputHash: string; sourceItemSha256: string; sourceBytes: Uint8Array; adopted: boolean; sourceChanged: boolean;
      candidates: { bytes: Uint8Array; reviewBytes: Uint8Array; pngSha256: string; pixelWidth: number; pixelHeight: number; recipe: { scale: number }; previewScale: number }[] }
    expect(result).toMatchObject({ inputHash: preview.inputHash, sourceItemSha256: preview.itemSha256, adopted: false, sourceChanged: false })
    expect(sha256Bytes(result.sourceBytes)).toBe(preview.itemSha256)
    expect(result.candidates).toHaveLength(3)
    const original = decodeCanonicalPng(result.sourceBytes)
    for (const candidate of result.candidates) {
      const pixels = decodeCanonicalPng(candidate.bytes)
      expect(candidate.recipe.scale).toBe(2)
      expect(pixels.width).toBe(original.width * 2); expect(pixels.height).toBe(original.height * 2)
      expect(sha256Bytes(candidate.bytes)).toBe(candidate.pngSha256)
      expect(decodeCanonicalPng(candidate.reviewBytes).width).toBeGreaterThan(pixels.width)
    }
    expect(session.captureWorkState()).toEqual(before)
    const cold = new ImageImportToolSession(await source(), rights)
    cold.restoreWork((await readImageWorkPackage(await session.exportWork())).state)
    const repeated = await cold.execute('image_import_enhancement_candidates', { target: 'chair', direction: 'clarity', count: 3 }) as typeof result
    expect(repeated.candidates.map(c => c.pngSha256)).toEqual(result.candidates.map(c => c.pngSha256))
    await expect(session.execute('image_import_enhancement_candidates', { target: 'missing', direction: 'clarity', count: 3 })).rejects.toThrow('目标不存在')
    expect(session.captureWorkState()).toEqual(before)
  })
  it('adopts an offline model mask only on its exact source and prior layer baseline, then preserves provenance through edits and cold resume', async () => {
    const input = await source(), session = new ImageImportToolSession(input, rights)
    const selectionMask = { x: 3, y: 3, width: 5, height: 5, runs: [25, 255] }
    const selectionOrigin: ImageSelectionOrigin = { method: 'local-slimsam', sourceSha256: input.image.sha256,
      inputSha256: input.image.sha256, priorLayersHash: sha256Text(canonicalJson([])), modelId: 'Xenova/slimsam-77-uniform',
      modelRevision: 'a'.repeat(40), modelFiles: [{ name: 'vision_encoder.onnx', sha256: 'b'.repeat(64) }, { name: 'prompt_encoder_mask_decoder.onnx', sha256: 'c'.repeat(64) }],
      contextBounds: { x: 0, y: 0, width: 12, height: 12 }, targetBounds: { x: 2, y: 2, width: 7, height: 7 },
      points: [{ x: 5, y: 5, label: 1 }], candidateIndex: 1, cleanup: { fillHoles: 4, removeIslands: 0 } }
    const before = session.captureWorkState()
    await expect(session.execute('image_import_extract_item', { generation: 0, ...item, selectionMask,
      selectionOrigin: { ...selectionOrigin, sourceSha256: 'd'.repeat(64) } })).rejects.toThrow('另一份原图')
    await expect(session.execute('image_import_extract_item', { generation: 0, ...item, selectionMask,
      selectionOrigin: { ...selectionOrigin, inputSha256: 'd'.repeat(64) } })).rejects.toThrow('输入像素摘要')
    expect(session.captureWorkState()).toEqual(before)
    await session.execute('image_import_extract_item', { generation: 0, ...item, selectionMask, selectionOrigin })
    const adopted = session.captureWorkState()
    await expect(session.execute('image_import_set_selection', { generation: 1, target: 'chair', selectionMask,
      selectionOrigin: { ...selectionOrigin, priorLayersHash: 'd'.repeat(64) } })).rejects.toThrow('先前拆分')
    expect(session.captureWorkState()).toEqual(adopted)
    await session.execute('image_import_set_selection', { generation: 1, target: 'chair', selectionMask, selectionOrigin })
    expect(session.inspect().draft.layers[0].guidedSelection).toBeUndefined()
    await session.execute('image_import_refine_selection', { generation: 2, target: 'chair', strokes: [{ mode: 'remove', points: [{ x: 5.5, y: 5.5 }], radiusPx: .5 }] })
    const pack = await readImageWorkPackage(await session.exportWork()), fresh = new ImageImportToolSession(input, rights)
    fresh.restoreWork(pack.state)
    expect(fresh.inspect().draft.layers[0].selectionOrigin).toEqual(selectionOrigin)
    expect(fresh.inspect().draft.layers[0].selectionMask).not.toEqual(selectionMask)
    expect(input.image.sha256).toBe(sha256Bytes(input.normalizedBytes!))
  })

  it('rejects out-of-scope extraction before adopting an item and preserves the last valid task', async () => {
    const session = new ImageImportToolSession(await source(), rights)
    const box = (right: number) => [{ x: 0, y: 0 }, { x: right, y: 0 }, { x: right, y: 12 }, { x: 0, y: 12 }]
    await session.execute('image_import_set_scale', { generation: 0, first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, distanceMm: 200 })
    await session.execute('image_import_set_room', { generation: 1, points: box(6) })
    const before = session.captureWorkState()
    await expect(session.execute('image_import_extract_item', { generation: 2, ...item })).rejects.toThrow('原图保留范围')
    expect(session.captureWorkState()).toEqual(before)
    await session.execute('image_import_set_source_boundary', { generation: 2, points: box(12) })
    await session.execute('image_import_extract_item', { generation: 3, ...item })
    const valid = session.captureWorkState()
    await expect(session.execute('image_import_set_source_boundary', { generation: 4, points: box(6) })).rejects.toThrow('家具最外沿')
    expect(session.captureWorkState()).toEqual(valid)
  })

  it('retains saved normalized bytes when a new platform encodes the same source pixels differently', async () => {
    const input = await source(), session = new ImageImportToolSession(input, rights)
    const normalized = encodeFixtureRaster({ width: input.pixels.width, height: input.pixels.height, rgba: input.pixels.data })
    expect(sha256Bytes(normalized)).not.toBe(input.image.sha256)
    const state = { ...session.captureWorkState(), image: { ...input.image, sha256: sha256Bytes(normalized) } }
    const images = artworkValidation().images
    images.normalizeImport = async () => {
      const bytes = input.normalizedBytes!, header = inspectImageBytes(bytes)
      return { bytes, record: { sha256: sha256Bytes(bytes), mimeType: header.mimeType, sizeBytes: bytes.length,
        pixelWidth: header.width, pixelHeight: header.height } }
    }
    const restored = await loadImageImportWorkSource({ state, original: input.originalBytes!, normalized }, undefined, images)
    expect(restored.image).toEqual(state.image)
    expect(restored.normalizedBytes).toEqual(normalized)
    expect(restored.pixels).toEqual(input.pixels)
    const fresh = new ImageImportToolSession(restored, rights)
    fresh.restoreWork(state)
    expect(fresh.captureWorkState().image).toEqual(state.image)
  })

  it('discovers instructions, generates a read-only guided candidate, and preserves source/records across a new session', async () => {
    const input = await source(), session = new ImageImportToolSession(input, rights)
    const workflow = await session.execute('image_import_workflow', {}) as { workflow: { instructions: string }; generation: number }
    expect(workflow.workflow.instructions).toContain('前景/背景')
    const candidate = await session.execute('image_import_guided_selection', { generation: 0, guide }) as { selectionMask: Parameters<typeof decodeSelectionMask>[0]; guide: { algorithmVersion: number; edgeCoverage: string } }
    expect(candidate.guide).toMatchObject({ algorithmVersion: 2, edgeCoverage: 'boundary' })
    expect(session.inspect().generation).toBe(0)
    const mask = decodeSelectionMask(candidate.selectionMask, input.pixels)
    expect(mask.data[(5 - 1) * 9 + 5 - 1]).toBe(255)
    expect(mask.data[(2 - 1) * 9 + 2 - 1]).toBe(0)
    await session.execute('image_import_extract_item', { generation: 0, ...item })
    await session.execute('image_import_set_checkpoint', { generation: 1, notes: '孔洞待核对', nextAction: '检查白底', scaleStatus: 'provisional' })
    const bytes = await session.exportWork(), work = await readImageWorkPackage(bytes)
    expect(work.state.journal).toHaveLength(2)
    expect(JSON.parse(work.state.journal[0].paramsJson!)).toMatchObject({ guidedSelection: guide })
    const fresh = new ImageImportToolSession(input, rights)
    fresh.restoreWork(work.state)
    expect(fresh.inspect().generation).toBeGreaterThan(work.state.revision)
    expect(fresh.captureWorkState()).toMatchObject({ id: work.state.id, notes: '孔洞待核对', nextAction: '检查白底', draft: { layers: [item] } })
    const before = fresh.inspect()
    await expect(fresh.execute('image_import_set_room', { generation: 0, points: item.polygon })).rejects.toThrow('已变化')
    expect(fresh.inspect()).toEqual(before)
    expect(await readImageWorkPackage(await fresh.exportWork())).toMatchObject({ original: input.originalBytes })
  })

  it('binds review to actual PNGs, refuses stale review and invalidates changed input', async () => {
    const session = new ImageImportToolSession(await source(), rights)
    await session.execute('image_import_extract_item', { generation: 0, ...item })
    const preview = await session.execute('image_import_item_preview', { target: 'chair' }) as { inputHash: string; itemSha256: string; backgroundSha256: string; bytes: Uint8Array }
    expect(preview.bytes.length).toBeGreaterThan(0)
    const before = session.inspect()
    await expect(session.execute('image_import_review_item', { generation: 1, target: 'chair', inputHash: 'a'.repeat(64), verdict: 'reviewed', note: '实际看图' })).rejects.toThrow('旧候选')
    expect(session.inspect()).toEqual(before)
    await session.execute('image_import_review_item', { generation: 1, target: 'chair', inputHash: preview.inputHash, verdict: 'needs-work', note: '边缘需修改' })
    expect(session.captureWorkState().reviews[0]).toMatchObject({ itemSha256: preview.itemSha256, backgroundSha256: preview.backgroundSha256, reviewer: 'assistant' })
    await session.execute('image_import_refine_selection', { generation: 2, target: 'chair', strokes: [{ mode: 'remove', points: [{ x: 5, y: 5 }], radiusPx: .5 }] })
    const result = await session.execute('image_import_workflow', {}) as { reviews: Array<{ matchesInput: boolean }> }
    expect(result.reviews[0].matchesInput).toBe(false)
  })

  it('refines the actual guided result rather than replacing it with the coarse polygon', async () => {
    const input = await source(), session = new ImageImportToolSession(input, rights)
    await session.execute('image_import_extract_item', { generation: 0, ...item, guidedSelection: { ...guide, algorithmVersion: 2 } })
    expect(session.inspect().draft.layers[0].selectionMask).toBeUndefined()
    await session.execute('image_import_refine_selection', { generation: 1, target: 'chair',
      strokes: [{ mode: 'remove', points: [{ x: 5.5, y: 5.5 }], radiusPx: .5 }] })
    const layer = session.inspect().draft.layers[0], mask = decodeSelectionMask(layer.selectionMask!, input.pixels)
    const at = (x: number, y: number) => mask.data[(y - mask.boundsPx.y) * mask.width + x - mask.boundsPx.x]
    expect(at(2, 2)).toBe(0)
    expect(at(7, 7)).toBe(255)
    expect(at(5, 5)).toBe(0)
  })

  it('restores incomplete UI marks and does not turn unconfirmed embedding into permission', async () => {
    const input = await source(), session = new ImageImportToolSession(input, rights)
    const work = session.captureWorkState()
    const incomplete = { ...work, rights: { ...work.rights, canEmbed: false }, active: { name: '未完成', polygon: [], donor: [], renderLayer: 'object', blocksMovement: true } }
    session.restoreWork(incomplete)
    expect(session.captureWorkState().active?.name).toBe('未完成')
    await expect(session.execute('image_import_build_project', { generation: session.inspect().generation })).rejects.toThrow('许可')
  })
})
