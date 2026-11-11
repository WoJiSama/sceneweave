import { describe, expect, it } from 'vitest'
import type { ImageImportRecipe } from '../../../shared/image-import/recipe.js'
import { encodeImageImportPixels, ImageImportToolSession, type ImageImportSource } from './image-import-session.js'
import { decodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { inspectImageBytes } from '../../../shared/project/image-bytes.js'
import { unzlibSync } from 'fflate'
import { decodeSelectionMask } from '../../../shared/image-import/selection-mask.js'

function source(): ImageImportSource {
  const data = new Uint8ClampedArray(8 * 8 * 4)
  for (let index = 0; index < data.length; index += 4) data.set([80, 120, 160, 255], index)
  return { image: { sha256: 'a'.repeat(64), pixelWidth: 8, pixelHeight: 8 }, pixels: { width: 8, height: 8, data } }
}
const rights = { licenseText: 'Independent synthetic test pixels. Embedding allowed.', attribution: 'Session test' }
const scale = { first: { x: 0, y: 0 }, second: { x: 4, y: 0 }, distanceMm: 1000 }
const room = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }]
const item: ImageImportRecipe['layers'][number] = { id: 'piano', name: '钢琴',
  polygon: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
  donor: { x: 5, y: 5, width: 2, height: 2 }, renderLayer: 'object', blocksMovement: true }
function recipe(): ImageImportRecipe {
  return { format: 'sceneweave-image-import-recipe', version: 1, image: source().image,
    title: '合成琴房', calibration: structuredClone(scale), roomPointsPx: structuredClone(room), layers: [structuredClone(item)] }
}

describe('host-owned image import tool session', () => {
  it('stores exact source RGB at fractional edge alpha without Canvas premultiplication', async () => {
    const data = new Uint8ClampedArray([25, 31, 35, 73, 50, 110, 150, 128, 90, 80, 70, 0])
    const bytes = await encodeImageImportPixels({ width: 3, height: 1, data })
    expect(decodeCanonicalPng(bytes).rgba).toEqual(data)
    const abort = new AbortController(); abort.abort()
    await expect(encodeImageImportPixels({ width: 3, height: 1, data }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('keeps the existing image-import side budget beyond the fixed SVG limit', async () => {
    const width = 8192, height = 1, data = new Uint8ClampedArray(width * height * 4)
    for (let x = 0; x < width; x++) data.set([x % 256, 31, 35, 73], x * 4)
    const bytes = await encodeImageImportPixels({ width, height, data })
    expect(inspectImageBytes(bytes)).toEqual({ mimeType: 'image/png', width, height })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 8, compressed: Uint8Array | undefined
    while (offset < bytes.length) {
      const length = view.getUint32(offset)
      if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') compressed = bytes.subarray(offset + 8, offset + 8 + length)
      offset += length + 12
    }
    expect(compressed).toBeDefined()
    expect(unzlibSync(compressed!).subarray(1)).toEqual(new Uint8Array(data.buffer))
    await expect(encodeImageImportPixels({ width: 8193, height: 1, data: new Uint8ClampedArray(8193 * 4) })).rejects.toThrow('图片保护预算')
    await expect(encodeImageImportPixels({ width: 8192, height: 4096, data: new Uint8ClampedArray(0) })).rejects.toThrow('图片保护预算')
  })

  it('returns the same hole-preserving source mask for a model region suggestion', async () => {
    const input = source()
    input.pixels.data.set([240, 30, 20, 255], (3 * 8 + 3) * 4)
    const session = new ImageImportToolSession(input, rights), before = session.inspect()
    const result = await session.execute('image_import_suggest_region', { seed: { x: 0, y: 0 }, tolerance: 0 }) as {
      selectionMask: NonNullable<ImageImportRecipe['layers'][number]['selectionMask']>; generation: number
    }
    const mask = decodeSelectionMask(result.selectionMask, input.pixels)
    expect(mask.data[3 * mask.width + 3]).toBe(0)
    expect(mask.data[2 * mask.width + 3]).toBe(255)
    expect(session.inspect()).toEqual(before)
    expect(result.generation).toBe(before.generation)
  })

  it('captures image identity and returns independent frozen draft snapshots', async () => {
    const input = source(), session = new ImageImportToolSession(input, rights)
    input.image.sha256 = 'b'.repeat(64)
    const first = session.inspect(), second = session.inspect()
    expect(first.image.sha256).toBe('a'.repeat(64))
    expect(first.draft).not.toBe(second.draft)
    expect(first.draft.layers).not.toBe(second.draft.layers)
    expect(Object.isFrozen(first.draft.layers)).toBe(true)
    expect(() => { first.draft.title = '外部修改' }).toThrow()
    expect(await session.execute('image_import_inspect', {})).toEqual(first)
  })

  it('captures scale arguments and preserves the current draft after a rejected calibration', async () => {
    const session = new ImageImportToolSession(source(), rights), calibration = structuredClone(scale)
    await session.execute('image_import_set_scale', { generation: 0, ...calibration })
    calibration.second.x = 7
    expect(session.inspect()).toMatchObject({ generation: 1, draft: { calibration: scale } })
    const before = session.inspect()
    await expect(session.execute('image_import_set_scale', { generation: 1, ...scale, second: scale.first })).rejects.toThrow('两个不同的点')
    expect(session.inspect()).toEqual(before)
  })

  it('rejects old baselines after both forward edits and undo while keeping generations monotonic', async () => {
    const session = new ImageImportToolSession(source(), rights)
    await session.execute('image_import_set_scale', { generation: 0, ...scale })
    await session.execute('image_import_set_room', { generation: 1, points: room })
    await session.execute('image_import_undo', { generation: 2 })
    expect(session.inspect()).toMatchObject({ generation: 3, draft: { calibration: scale, roomPointsPx: [] } })
    const before = session.inspect()
    await expect(session.execute('image_import_set_room', { generation: 1, points: room })).rejects.toThrow('代次')
    expect(session.inspect()).toEqual(before)
    await session.execute('image_import_undo', { generation: 3 })
    expect(session.inspect()).toMatchObject({ generation: 4, draft: { calibration: null } })
  })

  it('keeps failed donor extraction atomic and records only successful extraction in undo history', async () => {
    const session = new ImageImportToolSession(source(), rights), before = session.inspect()
    await expect(session.execute('image_import_extract_item', { generation: 0, ...item,
      donor: { x: 1, y: 1, width: 1, height: 1 } })).rejects.toThrow('重叠')
    await expect(session.execute('image_import_extract_item', { generation: 0, ...item,
      footprintPx: { x: 7, y: 1, width: 2, height: 1 } })).rejects.toThrow('范围')
    expect(session.inspect()).toEqual(before)
    await expect(session.execute('image_import_undo', { generation: 0 })).rejects.toThrow('没有可撤销')
    await session.execute('image_import_extract_item', { generation: 0, ...item })
    expect(session.inspect()).toMatchObject({ generation: 1, draft: { layers: [item] } })
    await session.execute('image_import_undo', { generation: 1 })
    expect(session.inspect()).toMatchObject({ generation: 2, draft: { layers: [] } })
  })

  it('replays explicit aligned repair through the same model schema and keeps invalid settings atomic', async () => {
    const session = new ImageImportToolSession(source(), rights)
    await session.execute('image_import_set_scale', { generation: 0, ...scale })
    await session.execute('image_import_set_room', { generation: 1, points: room })
    await session.execute('image_import_extract_item', { generation: 2, ...item, repair: 'aligned' })
    const before = session.inspect()
    expect(before.draft.layers[0].repair).toBe('aligned')
    const input = { ...recipe(), layers: [{ ...item, repair: 'aligned' }] }
    await session.execute('image_import_apply_recipe', { generation: 3, recipe: input })
    expect(session.inspect().draft.layers[0].repair).toBe('aligned')
    const after = session.inspect()
    await expect(session.execute('image_import_extract_item', { generation: 4, ...item, id: 'other', repair: 'arbitrary' })).rejects.toThrow()
    expect(session.inspect()).toEqual(after)
    await expect(session.execute('image_import_extract_item', { generation: 4, ...item, id: 'other', repair: 'aligned',
      donor: { x: 1, y: 1, width: 1, height: 1 } })).rejects.toThrow('重叠')
    expect(session.inspect()).toEqual(after)
  })

  it('rejects a recipe for another image before replacing the current draft', async () => {
    const session = new ImageImportToolSession(source(), rights)
    await session.execute('image_import_set_scale', { generation: 0, ...scale })
    const before = session.inspect(), wrongImage = recipe()
    wrongImage.image.sha256 = 'b'.repeat(64)
    await expect(session.execute('image_import_apply_recipe', { generation: 1, recipe: wrongImage })).rejects.toThrow('身份或尺寸不符')
    expect(session.inspect()).toEqual(before)
    await session.execute('image_import_apply_recipe', { generation: 1, recipe: recipe() })
    expect(session.inspect()).toMatchObject({ generation: 2, draft: { title: '合成琴房', layers: [item], roomPointsPx: room } })
    await session.execute('image_import_undo', { generation: 2 })
    expect(session.inspect()).toMatchObject({ generation: 3, draft: before.draft })
  })

  it('does not grant arguments the ability to inject source paths or embedding permissions', async () => {
    const session = new ImageImportToolSession(source(), rights), before = session.inspect()
    await expect(session.execute('image_import_extract_item', { generation: 0, ...item, path: '/private/image.png', canEmbed: true })).rejects.toThrow()
    const abort = new AbortController(); abort.abort()
    await expect(session.execute('image_import_set_room', { generation: 0, points: room }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.inspect()).toEqual(before)
  })

  it('rejects style-changing proposals atomically for program and model entry points', async () => {
    const session = new ImageImportToolSession(source(), rights), withBody = recipe()
    withBody.layers[0].footprintPx = { x: 1.5, y: 1.5, width: 1, height: 1 }
    await session.execute('image_import_apply_recipe', { generation: 0, recipe: withBody })
    const before = session.inspect()
    await expect(session.execute('image_import_set_vector', { generation: 1, target: 'piano', options: { kind: 'trace' } })).rejects.toMatchObject({ code: 'palette-loss' })
    await expect(session.execute('image_import_set_vector', { generation: 1, target: 'floor', options: { kind: 'wood' } })).rejects.toMatchObject({ code: 'material-replacement' })
    const bad = recipe(); bad.floorVector = { kind: 'rug', colors: 24, simplifyPx: .35, direction: 'horizontal', seed: 1, smoothingRadius: 0, longEdgePx: 1024, woodZones: [] }
    await expect(session.execute('image_import_apply_recipe', { generation: 1, recipe: bad })).rejects.toMatchObject({ code: 'material-replacement' })
    expect(session.inspect()).toEqual(before)
    expect(before.fidelityRules.some(rule => rule.code === 'roundtrip-not-fidelity')).toBe(true)
    const assessment = await session.execute('image_import_assess_fidelity', {})
    expect(assessment).toMatchObject({ generation: 1, report: { passed: true, comparisonKind: 'source', background: { passed: true }, inferenceIsUnverified: true } })
  })

  it('records the source artwork boundary and output scale with the same atomic undo semantics', async () => {
    const session = new ImageImportToolSession(source(), rights)
    await session.execute('image_import_apply_recipe', { generation: 0, recipe: recipe() })
    await session.execute('image_import_set_source_boundary', { generation: 1, points: room })
    await session.execute('image_import_set_output_scale', { generation: 2, scale: 2 })
    expect(session.inspect()).toMatchObject({ generation: 3, draft: { sourceBoundaryPx: room, outputScale: 2 } })
    await expect(session.execute('image_import_set_output_scale', { generation: 2, scale: 4 })).rejects.toThrow('代次')
    await session.execute('image_import_undo', { generation: 3 })
    expect(session.inspect().draft.outputScale).toBeUndefined()
    expect(session.inspect().draft.sourceBoundaryPx).toEqual(room)
  })

  it('uses the same fine-selection tools for model strokes and commits them as one undo step', async () => {
    const session = new ImageImportToolSession(source(), rights)
    await session.execute('image_import_apply_recipe', { generation: 0, recipe: recipe() })
    const before = session.inspect()
    await session.execute('image_import_refine_selection', { generation: 1, target: 'piano',
      strokes: [{ mode: 'remove', points: [{ x: 2, y: 2 }], radiusPx: .5 }] })
    const refined = session.inspect(), selected = refined.draft.layers[0].selectionMask!
    const decoded = decodeSelectionMask(selected, { width: 8, height: 8 })
    expect(decoded.data[(2 - decoded.boundsPx.y) * decoded.width + 2 - decoded.boundsPx.x]).toBeLessThan(255)
    expect(refined.draft.layers[0].polygon).toEqual(item.polygon)
    expect(refined.generation).toBe(2)
    await expect(session.execute('image_import_refine_selection', { generation: 1, target: 'piano', strokes: [] })).rejects.toThrow('代次')
    await session.execute('image_import_undo', { generation: 2 })
    expect(session.inspect().draft).toEqual(before.draft)
  })

  it('preserves draft and undo after invalid selection, donor overlap, unknown fields and cancellation', async () => {
    const session = new ImageImportToolSession(source(), rights)
    await session.execute('image_import_apply_recipe', { generation: 0, recipe: recipe() })
    const before = session.inspect()
    await expect(session.execute('image_import_refine_selection', { generation: 1, target: 'piano',
      strokes: [{ mode: 'keep', points: [{ x: 5, y: 5 }], radiusPx: 1 }] })).rejects.toThrow('重叠')
    await expect(session.execute('image_import_refine_selection', { generation: 1, target: 'piano',
      strokes: [], sourcePath: '/not-authorized.png' })).rejects.toThrow()
    const abort = new AbortController(); abort.abort()
    await expect(session.execute('image_import_refine_selection', { generation: 1, target: 'piano',
      strokes: [{ mode: 'remove', points: [{ x: 2, y: 2 }], radiusPx: .5 }] }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.inspect()).toEqual(before)
    await session.execute('image_import_undo', { generation: 1 })
    expect(session.inspect().draft.layers).toEqual([])
  })
})

describe('shared layered source evidence', () => {
  it('reports prior inference separately from unchanged pixels and recomputes it after undo', async () => {
    const input = source(), session = new ImageImportToolSession(input, rights), proposal = recipe()
    proposal.layers.push({ ...structuredClone(item), id: 'second', name: '第二层',
      polygon: [{ x: 2, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }, { x: 2, y: 3 }], donor: { x: 1, y: 1, width: 1, height: 2 } })
    await session.execute('image_import_apply_recipe', { generation: 0, recipe: proposal })
    const assessment = await session.execute('image_import_assess_fidelity', {})
    expect(assessment).toMatchObject({ report: { passed: true, sourceReport: {
      extractedInferencePixels: 2, declaredDonorPriorInferencePixels: 2,
      actualSampledInferencePixels: 'notMeasured', boundaryInferencePixels: 'notMeasured',
      layers: [{ layerId: 'piano', extractedInferencePixels: 0 },
        { layerId: 'second', extractedInferencePixels: 2, declaredDonors: [{ priorInferencePixels: 2 }], priorLayerIds: ['piano'] }],
    } } })
    const uniform = decodeCanonicalPng((await session.execute('image_import_preview', { view: 'remaining' }) as { bytes: Uint8Array }).bytes)
    expect(uniform.rgba).toEqual(input.pixels.data)
    await session.execute('image_import_undo', { generation: 1 })
    expect(session.inspect().draft.layers).toEqual([])
    await session.execute('image_import_apply_recipe', { generation: 2, recipe: recipe() })
    expect(await session.execute('image_import_assess_fidelity', {})).toMatchObject({ report: { sourceReport: {
      extractedInferencePixels: 0, declaredDonorPriorInferencePixels: 0, layerCount: 1,
    } } })
  })
})
