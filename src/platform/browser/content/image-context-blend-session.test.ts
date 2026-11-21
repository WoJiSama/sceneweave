import { describe, expect, it } from 'vitest'
import { encodeImageImportPixels, ImageImportToolSession, type ImageImportSource } from './image-import-session.js'
import { readImageWorkPackage } from '../../../shared/image-import/workflow.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { decodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { replayImageLayers } from '../../../shared/image-import/layer-replay.js'

async function fixture() {
  const pixels = { width: 96, height: 80, data: new Uint8ClampedArray(96 * 80 * 4) }
  for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) pixels.data.set(y % 10 === 0
    ? [30, 26, 22, 255] : [100 + x % 4, 85 + y % 10, 70, 255], (y * 96 + x) * 4)
  const bytes = await encodeImageImportPixels(pixels)
  const source: ImageImportSource = { pixels, image: { pixelWidth: 96, pixelHeight: 80, sha256: sha256Bytes(bytes) }, originalBytes: bytes, normalizedBytes: bytes }
  const rights = { attribution: 'Synthetic boundary test', licenseText: 'Independent synthetic pixels. Embedding allowed.' }
  const session = new ImageImportToolSession(source, rights)
  await session.execute('image_import_extract_item', { generation: 0, id: 'stool', name: '方凳',
    polygon: [{ x: 55, y: 24 }, { x: 63, y: 24 }, { x: 63, y: 36 }, { x: 55, y: 36 }],
    donor: { x: 4, y: 8, width: 36, height: 56 }, renderLayer: 'object', appearanceSource: 'original', blocksMovement: false,
    repair: 'context-blend', removalMask: { x: 52, y: 20, width: 16, height: 20, runs: [320, 255] },
    protectionMask: { x: 66, y: 20, width: 4, height: 20, runs: [80, 255] } })
  return { source, session, rights }
}
type Preview = { inputHash: string; itemSha256: string; backgroundSha256: string; bytes: Uint8Array }

describe('explicit complete patch boundary blending session', () => {
  it('binds later exclusions to review identity and preserves old state on invalid adoption', async () => {
    const { session } = await fixture()
    const first = await session.execute('image_import_item_preview', { target: 'stool' }) as Preview
    await session.execute('image_import_review_item', { generation: 1, target: 'stool', inputHash: first.inputHash, verdict: 'needs-work', note: 'Synthetic only, not visual sign-off.' })
    await session.execute('image_import_extract_item', { generation: 2, id: 'lamp', name: '灯',
      polygon: [{ x: 72, y: 24 }, { x: 76, y: 24 }, { x: 76, y: 30 }, { x: 72, y: 30 }],
      donor: { x: 0, y: 0, width: 3, height: 3 }, renderLayer: 'object', blocksMovement: false })
    const changed = await session.execute('image_import_item_preview', { target: 'stool' }) as Preview
    expect(changed.inputHash).not.toBe(first.inputHash)
    expect(changed.itemSha256).toBe(first.itemSha256)
    const state = session.captureWorkState()
    await expect(session.execute('image_import_review_item', { generation: 3, target: 'stool', inputHash: first.inputHash, verdict: 'reviewed', note: 'Must reject stale context.' })).rejects.toThrow('旧候选')
    expect(session.captureWorkState()).toEqual(state)
    // The new declared donor overlaps an object that remains visible when the stool is removed.
    await expect(session.execute('image_import_set_repair_scope', { generation: 3, target: 'stool',
      removalMask: state.draft.layers[0].removalMask!, protectionMask: state.draft.layers[0].protectionMask!,
      donor: { x: 70, y: 18, width: 24, height: 28 }, repair: 'context-blend' })).rejects.toThrow(/可信|取样/)
    expect(session.captureWorkState()).toEqual(state)
  })

  it.each(['context-blend', 'context-blend-v2'] as const)('cold-replays %s work bytes and continues editing with undo', async repair => {
    const { source, session, rights } = await fixture()
    const layer = session.inspect().draft.layers[0]
    const scope = { removalMask: layer.removalMask!, protectionMask: layer.protectionMask! }
    const initial = await session.execute('image_import_item_preview', { target: 'stool' }) as Preview
    if (repair !== layer.repair) await session.execute('image_import_set_repair_scope', { generation: session.inspect().generation, target: 'stool', ...scope, repair })
    const firstState = session.inspect(), first = await session.execute('image_import_item_preview', { target: 'stool' }) as Preview
    expect(firstState.draft.layers[0].repair).toBe(repair)
    expect(first.itemSha256).toBe(initial.itemSha256)
    if (repair !== layer.repair) expect(first.inputHash).not.toBe(initial.inputHash)
    await session.execute('image_import_set_repair_scope', { generation: session.inspect().generation, target: 'stool', ...scope, repair: 'context' })
    expect(session.inspect().draft.layers[0].repair).toBe('context')
    await session.execute('image_import_undo', { generation: session.inspect().generation })
    expect(session.inspect().draft).toEqual(firstState.draft)
    const work = await readImageWorkPackage(await session.exportWork())
    expect(work.state.version).toBe(1)
    const decoded = decodeCanonicalPng(work.normalized)
    expect(decoded.rgba).toEqual(source.pixels.data)
    const coldSource = { ...source, pixels: { width: decoded.width, height: decoded.height, data: decoded.rgba }, originalBytes: work.original, normalizedBytes: work.normalized }
    const cold = new ImageImportToolSession(coldSource, rights)
    cold.restoreWork(work.state)
    const repeated = await cold.execute('image_import_item_preview', { target: 'stool' }) as Preview
    for (const key of ['inputHash', 'itemSha256', 'backgroundSha256'] as const) expect(repeated[key]).toBe(first[key])
    expect(repeated.bytes).toEqual(first.bytes)
    expect(cold.inspect().draft).toEqual(session.inspect().draft)
    const draft = cold.inspect().draft
    const a = replayImageLayers(source.pixels, draft.layers), b = replayImageLayers(coldSource.pixels, draft.layers)
    expect(a.remaining).toEqual(b.remaining)
    expect(a.layers[0].extracted.layer).toEqual(b.layers[0].extracted.layer)
    await cold.execute('image_import_set_repair_scope', { generation: cold.inspect().generation, target: 'stool', ...scope, repair: 'context' })
    await cold.execute('image_import_undo', { generation: cold.inspect().generation })
    expect(cold.inspect().draft).toEqual(draft)
  })
})
