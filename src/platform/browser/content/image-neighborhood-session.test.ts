import { describe, expect, it } from 'vitest'
import { ImageImportToolSession, encodeImageImportPixels, type ImageImportSource } from './image-import-session.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { decodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { readImageWorkPackage } from '../../../shared/image-import/workflow.js'
import { IMAGE_IMPORT_TOOLS } from '../../../shared/image-import/recipe.js'
import { replayImageLayers } from '../../../shared/image-import/layer-replay.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import type { ImageRepairSurface } from '../../../shared/image-import/surfaces.js'

async function fixture(kind: 'neighbors-soft' | 'guided' = 'neighbors-soft') {
  const pixels = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels.data.set([95 + x % 5, 110 + y % 7, 145, 255], (y * 64 + x) * 4)
  const bytes = await encodeImageImportPixels(pixels)
  const source: ImageImportSource = { pixels, image: { pixelWidth: 64, pixelHeight: 64, sha256: sha256Bytes(bytes) }, originalBytes: bytes, normalizedBytes: bytes }
  const session = new ImageImportToolSession(source, { attribution: 'synthetic', licenseText: 'Synthetic test pixels; embedding allowed.' })
  const surface: ImageRepairSurface = { id: 'rug', name: '蓝毯', kind, mask: { x: 0, y: 0, width: 64, height: 64, runs: [4096, 255] }, donor: { x: 2, y: 2, width: 20, height: 20 },
    ...(kind === 'guided' ? { guided: { orientation: 'soft' as const, guides: [] } } : {}) }
  await session.execute('image_import_set_surfaces', { generation: 0, surfaces: [surface] })
  await session.execute('image_import_extract_item', { generation: 1, id: 'chair', name: '椅子', polygon: [{ x: 26, y: 26 }, { x: 38, y: 26 }, { x: 38, y: 38 }, { x: 26, y: 38 }],
    selectionMask: { x: 26, y: 26, width: 12, height: 12, runs: [144, 255] }, donor: surface.donor, renderLayer: 'object', blocksMovement: true, repair: 'surfaces', repairSurfaceIds: ['rug'] })
  return { source, session, surface }
}
type Analysis = { bytes: Uint8Array; inputHash: string; analysisInputHash: string; reportHash: string; reviewSha256: string; backgroundSha256: string; readOnly: boolean; visualQualityPassed: boolean; report: { surfaces: unknown[] } }

describe('read-only explainable neighborhood tool', () => {
  it('exports actual reviewed pixels and hashes without changing draft, review or generation; cold reanalysis is identical', async () => {
    const { source, session } = await fixture(), state = session.captureWorkState()
    const result = await session.execute('image_import_analyze_repair', { target: 'chair' }) as Analysis
    expect(session.captureWorkState()).toEqual(state)
    expect(result.readOnly).toBe(true); expect(result.visualQualityPassed).toBe(false)
    expect(result.report.surfaces).toHaveLength(1)
    expect(sha256Bytes(result.bytes)).toBe(result.reviewSha256)
    expect(decodeCanonicalPng(result.bytes).width).toBeGreaterThan(128)
    const preview = await session.execute('image_import_item_preview', { target: 'chair' }) as Analysis
    expect(result.inputHash).toBe(preview.inputHash); expect(result.backgroundSha256).toBe(preview.backgroundSha256)
    const cold = new ImageImportToolSession(source, { attribution: 'synthetic', licenseText: 'Synthetic test pixels; embedding allowed.' })
    cold.restoreWork((await readImageWorkPackage(await session.exportWork())).state)
    const repeated = await cold.execute('image_import_analyze_repair', { target: 'chair' }) as Analysis
    for (const key of ['inputHash', 'analysisInputHash', 'reportHash', 'reviewSha256', 'backgroundSha256'] as const) expect(repeated[key]).toBe(result[key])
    expect(session.captureWorkState()).toEqual(state)
    expect(IMAGE_IMPORT_TOOLS.find(tool => tool.name === 'image_import_analyze_repair')?.description).toContain('只读')
  })
  it('binds later object exclusions to both analysis and original review identity, and rejects invalid repair atomically', async () => {
    const { session, surface } = await fixture()
    const before = await session.execute('image_import_analyze_repair', { target: 'chair' }) as Analysis
    await session.execute('image_import_extract_item', { generation: 2, id: 'lamp', name: '灯', polygon: [{ x: 45, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 35 }, { x: 45, y: 35 }], donor: surface.donor, renderLayer: 'object', blocksMovement: false })
    const after = await session.execute('image_import_analyze_repair', { target: 'chair' }) as Analysis
    expect(after.inputHash).not.toBe(before.inputHash); expect(after.analysisInputHash).not.toBe(before.analysisInputHash)
    const state = session.captureWorkState()
    await expect(session.execute('image_import_set_surfaces', { generation: 3, surfaces: [{ ...surface, donor: { x: 26, y: 26, width: 12, height: 12 } }] })).rejects.toThrow()
    expect(session.captureWorkState()).toEqual(state)
    await expect(session.execute('image_import_analyze_repair', { target: 'chair', unknown: true })).rejects.toThrow()
    expect(session.captureWorkState()).toEqual(state)
  })
  it('validates a working model input before changing the later silhouette that constrains an earlier neighborhood repair', async () => {
    const { session, surface, source } = await fixture()
    await session.execute('image_import_extract_item', { generation: 2, id: 'lamp', name: '灯', polygon: [{ x: 45, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 40 }, { x: 45, y: 40 }], donor: surface.donor,
      selectionMask: { x: 45, y: 20, width: 15, height: 20, runs: [300, 255] }, appearanceSource: 'working', renderLayer: 'object', blocksMovement: false })
    const draft = session.inspect().draft
    const input = replayImageLayers(source.pixels, draft.layers.slice(0, 1), draft.repairSurfaces, { evidenceLayers: draft.layers }).remaining
    const selectionOrigin = { method: 'local-slimsam', sourceSha256: source.image.sha256, inputSha256: sha256Bytes(await encodeImageImportPixels(input)), priorLayersHash: sha256Text(canonicalJson(draft.layers.slice(0, 1))),
      modelId: 'Xenova/slimsam-77-uniform', modelRevision: 'a'.repeat(40), modelFiles: [{ name: 'vision_encoder.onnx', sha256: 'b'.repeat(64) }, { name: 'prompt_encoder_mask_decoder.onnx', sha256: 'c'.repeat(64) }],
      contextBounds: { x: 0, y: 0, width: 64, height: 64 }, targetBounds: { x: 45, y: 20, width: 15, height: 20 }, points: [{ x: 47, y: 23, label: 1 }], candidateIndex: 0, cleanup: { fillHoles: 0, removeIslands: 0 } }
    await session.execute('image_import_set_selection', { generation: 3, target: 'lamp', selectionMask: { x: 45, y: 20, width: 5, height: 8, runs: [40, 255] }, selectionOrigin })
    expect(session.inspect().draft.layers[1].selectionMask).toMatchObject({ width: 5, height: 8 })
  })

  it('atomically executes guided surface updates, binds future silhouettes and cold-replays a complete portable package', async () => {
    const { session, surface } = await fixture('guided')
    const first = await session.execute('image_import_item_preview', { target: 'chair' }) as Analysis
    const changed: ImageRepairSurface = { ...surface, name: '蓝毯 · 显式结构辅助', donor: { x: 4, y: 2, width: 16, height: 20 }, guided: { orientation: 'soft', guides: [] } }
    await session.execute('image_import_set_surfaces', { generation: 2, surfaces: [changed] })
    expect(session.inspect().generation).toBe(3)
    expect(session.inspect().draft.repairSurfaces).toEqual([changed])
    const adopted = await session.execute('image_import_item_preview', { target: 'chair' }) as Analysis
    expect(adopted.inputHash).not.toBe(first.inputHash)
    await session.execute('image_import_review_item', { generation: 3, target: 'chair', inputHash: adopted.inputHash, verdict: 'needs-work', note: '仅记录当前输入；仍需视觉检查。' })
    await session.execute('image_import_extract_item', { generation: 4, id: 'lamp', name: '灯', polygon: [{ x: 45, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 35 }, { x: 45, y: 35 }],
      selectionMask: { x: 45, y: 20, width: 5, height: 15, runs: [75, 255] }, donor: changed.donor, renderLayer: 'object', blocksMovement: false })
    const withFuture = await session.execute('image_import_analyze_repair', { target: 'chair' }) as Analysis
    expect(withFuture.inputHash).not.toBe(adopted.inputHash)
    // Change an existing later object's exclusion geometry, not only the layer count.
    await session.execute('image_import_set_repair_scope', { generation: 5, target: 'lamp', removalMask: { x: 44, y: 19, width: 10, height: 17, runs: [170, 255] }, protectionMask: null })
    const afterGeometry = await session.execute('image_import_analyze_repair', { target: 'chair' }) as Analysis
    expect(afterGeometry.inputHash).not.toBe(withFuture.inputHash)
    expect(afterGeometry.analysisInputHash).not.toBe(withFuture.analysisInputHash)
    const preview = await session.execute('image_import_item_preview', { target: 'chair' }) as Analysis
    expect(preview.inputHash).toBe(afterGeometry.inputHash)
    expect(preview.backgroundSha256).toBe(afterGeometry.backgroundSha256)
    const state = session.captureWorkState()
    const invalid: ImageRepairSurface = { ...changed, guided: { orientation: 'soft', guides: [{ points: [{ x: 28, y: 28 }, { x: 36, y: 28 }],
      reference: { x: 45, y: 20, width: 5, height: 7 }, axis: 'horizontal', reason: '故意将后续未移走物件作为参考，必须拒绝。' }] } }
    await expect(session.execute('image_import_set_surfaces', { generation: 6, surfaces: [invalid] })).rejects.toThrow(/结构参考|可信原图/)
    expect(session.captureWorkState()).toEqual(state)
    await expect(session.execute('image_import_review_item', { generation: 6, target: 'chair', inputHash: adopted.inputHash, verdict: 'reviewed', note: '过期输入不得通过。' })).rejects.toThrow(/旧候选/)
    expect(session.captureWorkState()).toEqual(state)
    const unchanged = await session.execute('image_import_analyze_repair', { target: 'chair' }) as Analysis
    expect(unchanged.analysisInputHash).toBe(afterGeometry.analysisInputHash)
    expect(unchanged.backgroundSha256).toBe(afterGeometry.backgroundSha256)
    expect(session.captureWorkState()).toEqual(state)
    const work = await readImageWorkPackage(await session.exportWork())
    expect(work.state.version).toBe(1)
    expect(work.state.draft.repairSurfaces).toEqual([changed])
    const raster = decodeCanonicalPng(work.normalized)
    const coldSource: ImageImportSource = { image: work.state.image, pixels: { width: raster.width, height: raster.height, data: raster.rgba },
      originalBytes: work.original, normalizedBytes: work.normalized, originalName: work.state.original.name, originalMime: work.state.original.mimeType }
    const cold = new ImageImportToolSession(coldSource, work.state.rights)
    cold.restoreWork(work.state)
    const coldState = cold.captureWorkState(), repeated = await cold.execute('image_import_analyze_repair', { target: 'chair' }) as Analysis
    for (const key of ['inputHash', 'analysisInputHash', 'reportHash', 'reviewSha256', 'backgroundSha256'] as const) expect(repeated[key]).toBe(afterGeometry[key])
    expect(repeated.bytes).toEqual(afterGeometry.bytes)
    expect(cold.captureWorkState()).toEqual(coldState)
    expect(coldState.draft).toEqual(state.draft)
    expect(coldState.reviews).toEqual(state.reviews)
    expect(coldState.journal).toEqual(state.journal)
  })
})
