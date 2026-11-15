import { describe, expect, it } from 'vitest'
import { ImageImportToolSession, encodeImageImportPixels, type ImageImportSource } from './image-import-session.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { encodeSelectionMask } from '../../../shared/image-import/selection-mask.js'
import { readImageWorkPackage } from '../../../shared/image-import/workflow.js'
import type { ImageSurfaceRefinement } from '../../../shared/image-import/surface-refinement.js'

const rights = { attribution: 'Synthetic cloth workflow', licenseText: 'Original synthetic test pixels; embedding permitted.' }
type Preview = { inputHash: string; itemSha256: string; backgroundSha256: string }
type Candidates = { inputHash: string; candidates: Array<{ recipe: ImageSurfaceRefinement; pngSha256: string; bytes: Uint8Array }> }
async function fixture() {
  const width = 64, height = 64, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([95 - (x > 26 && y > 26 ? 16 : 0), 119, 123, 255], (y * width + x) * 4)
  const pixels = { width, height, data }, bytes = await encodeImageImportPixels(pixels)
  const source: ImageImportSource = { pixels, image: { pixelWidth: width, pixelHeight: height, sha256: sha256Bytes(bytes) },
    originalBytes: bytes, normalizedBytes: bytes, originalName: 'cloth.png', originalMime: 'image/png' }
  const session = new ImageImportToolSession(source, rights)
  const selectionMask = encodeSelectionMask({ width: 40, height: 40, boundsPx: { x: 10, y: 10, width: 40, height: 40 }, data: new Uint8Array(1600).fill(255) })
  await session.execute('image_import_extract_item', { generation: 0, id: 'cloth', name: 'Cloth', renderLayer: 'ground', blocksMovement: false,
    polygon: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }], donor: { x: 1, y: 1, width: 6, height: 6 }, selectionMask })
  const refinement: ImageSurfaceRefinement = { method: 'cloth-surface-v1', materialSurfaceId: 'cloth-material', donor: { x: 16, y: 16, width: 6, height: 6 }, seed: 3,
    reason: 'Known cloth colour with a local shadow.', strokes: [] }
  await session.execute('image_import_set_surfaces', { generation: 1, surfaces: [{ id: 'cloth-material', name: 'Cloth material', kind: 'soft', mask: selectionMask, donor: refinement.donor }] })
  return { source, session, refinement }
}

describe('cloth appearance session', () => {
  it('previews read-only, adopts exactly, cold-replays bytes and restores original appearance without changing background', async () => {
    const { source, session, refinement } = await fixture(), state = session.captureWorkState()
    const original = await session.execute('image_import_item_preview', { target: 'cloth' }) as Preview
    const candidates = await session.execute('image_import_surface_candidate', { target: 'cloth', refinement }) as Candidates
    expect(session.captureWorkState()).toEqual(state)
    expect(candidates.candidates[0].pngSha256).not.toBe(original.itemSha256)
    await session.execute('image_import_set_surface_refinement', { generation: 2, target: 'cloth', inputHash: candidates.inputHash, refinement })
    const adopted = await session.execute('image_import_item_preview', { target: 'cloth' }) as Preview
    expect(adopted.itemSha256).toBe(candidates.candidates[0].pngSha256)
    expect(adopted.backgroundSha256).toBe(original.backgroundSha256)
    const cold = new ImageImportToolSession(source, rights)
    cold.restoreWork((await readImageWorkPackage(await session.exportWork())).state)
    expect(await cold.execute('image_import_item_preview', { target: 'cloth' })).toMatchObject({ inputHash: adopted.inputHash, itemSha256: adopted.itemSha256, backgroundSha256: adopted.backgroundSha256 })
    await session.execute('image_import_undo', { generation: 3 })
    expect(await session.execute('image_import_item_preview', { target: 'cloth' })).toMatchObject({ inputHash: original.inputHash, itemSha256: original.itemSha256, backgroundSha256: original.backgroundSha256 })
    await cold.execute('image_import_set_surface_refinement', { generation: cold.inspect().generation, target: 'cloth', inputHash: adopted.inputHash, refinement: null })
    expect((await cold.execute('image_import_item_preview', { target: 'cloth' }) as Preview).itemSha256).toBe(original.itemSha256)
  })

  it('rejects stale adoption and invalid same-material evidence atomically', async () => {
    const { session, refinement } = await fixture()
    const candidate = await session.execute('image_import_surface_candidate', { target: 'cloth', refinement }) as Candidates
    const before = session.captureWorkState()
    await expect(session.execute('image_import_set_surface_refinement', { generation: 2, target: 'cloth', inputHash: candidate.inputHash,
      refinement: { ...refinement, materialSurfaceId: 'missing' } })).rejects.toThrow('同材质')
    expect(session.captureWorkState()).toEqual(before)
    await session.execute('image_import_set_surface_refinement', { generation: 2, target: 'cloth', inputHash: candidate.inputHash, refinement })
    const adopted = session.captureWorkState()
    await expect(session.execute('image_import_set_surface_refinement', { generation: 3, target: 'cloth', inputHash: candidate.inputHash, refinement: null })).rejects.toThrow('旧输入')
    expect(session.captureWorkState()).toEqual(adopted)
  })
})
