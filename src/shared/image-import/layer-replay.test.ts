import { describe, expect, it } from 'vitest'
import { replayImageLayers, type ImageReplayLayer } from './layer-replay.js'
import { extractImageLayer, type ImagePixels, type PixelBounds } from './pixels.js'
import { encodeSelectionMask } from './selection-mask.js'

const box = ({ x, y, width, height }: PixelBounds) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const layer = (id: string, bounds: PixelBounds, options: Partial<ImageReplayLayer> = {}): ImageReplayLayer =>
  ({ id, polygon: box(bounds), donor: { x: 0, y: 0, width: 2, height: 2 }, ...options })
const rgba = (image: ImagePixels, x: number, y: number) => image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)
function source(width = 24, height = 20): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([x * 7, y * 9, (x + y) * 3, 255], (y * width + x) * 4)
  return { width, height, data }
}

/** Deliberately scans every donor pixel, independently of the production block summaries. */
function naiveReplay(image: ImagePixels, definitions: readonly ImageReplayLayer[]) {
  const provenance = new Uint8Array(image.width * image.height)
  let remaining = image, repairPixels = 0, extractedInferencePixels = 0, declaredDonorPriorInferencePixels = 0
  const layers = definitions.map((definition, index) => {
    const extracted = extractImageLayer(remaining, definition.polygon, definition.donor, definition), prior = new Set<number>()
    const declaredDonors = [definition.donor, ...(definition.fills ?? []).map(fill => fill.donor)].map((boundsPx, donorIndex) => {
      let priorInferencePixels = 0
      for (let y = boundsPx.y; y < boundsPx.y + boundsPx.height; y++) for (let x = boundsPx.x; x < boundsPx.x + boundsPx.width; x++) {
        const producer = provenance[y * image.width + x]
        if (producer) { priorInferencePixels++; prior.add(producer) }
      }
      declaredDonorPriorInferencePixels += priorInferencePixels
      return { index: donorIndex, boundsPx, priorInferencePixels }
    })
    let extractedCount = 0, repairCount = 0
    for (let y = 0; y < extracted.mask.height; y++) for (let x = 0; x < extracted.mask.width; x++) {
      if (!extracted.mask.data[y * extracted.mask.width + x]) continue
      const producer = provenance[(y + extracted.mask.boundsPx.y) * image.width + x + extracted.mask.boundsPx.x]
      if (producer) { extractedCount++; prior.add(producer) }
    }
    for (let y = 0; y < extracted.repairMask.height; y++) for (let x = 0; x < extracted.repairMask.width; x++) {
      if (!extracted.repairMask.data[y * extracted.repairMask.width + x]) continue
      provenance[(y + extracted.repairMask.boundsPx.y) * image.width + x + extracted.repairMask.boundsPx.x] = index + 1
      repairCount++
    }
    repairPixels += repairCount; extractedInferencePixels += extractedCount; remaining = extracted.remaining
    return { layerId: definition.id, declaredDonors, extractedInferencePixels: extractedCount, repairPixels: repairCount,
      priorLayerIds: [...prior].sort((a, b) => a - b).map(producer => definitions[producer - 1].id),
      actualSampledInferencePixels: 'notMeasured', boundaryInferencePixels: 'notMeasured' }
  })
  const inferredPixels = provenance.reduce((total, producer) => total + (producer ? 1 : 0), 0)
  return { remaining, provenance, sourceReport: { totalPixels: provenance.length,
    capturedSourcePixels: provenance.length - inferredPixels, inferredPixels, layerCount: definitions.length,
    repairPixels, extractedInferencePixels, declaredDonorPriorInferencePixels,
    actualSampledInferencePixels: 'notMeasured', boundaryInferencePixels: 'notMeasured', layers } }
}

describe('shared ordered image-layer replay and source provenance', () => {
  it('reports an unfinished empty draft without requiring room or calibration', () => {
    const image = source(), result = replayImageLayers(image, [])
    expect(result.remaining).toBe(image)
    expect(result.provenance).toEqual(new Uint8Array(image.width * image.height))
    expect(result.sourceReport).toEqual({ totalPixels: 480, capturedSourcePixels: 480, inferredPixels: 0, layerCount: 0,
      repairPixels: 0, extractedInferencePixels: 0, declaredDonorPriorInferencePixels: 0,
      actualSampledInferencePixels: 'notMeasured', boundaryInferencePixels: 'notMeasured', layers: [] })
  })

  it('distinguishes declared donor overlap from actual tile sampling and keeps fill declaration indexes', () => {
    const image = source(), first = layer('first', { x: 2, y: 2, width: 1, height: 1 })
    const donor = { x: 2, y: 2, width: 4, height: 4 }, second = layer('second', { x: 12, y: 8, width: 1, height: 1 }, { donor })
    const result = replayImageLayers(image, [first, second]), report = result.layers[1].diagnostics
    // The declared donor contains (2,2), but this tile actually uses original (4,4).
    expect(rgba(result.remaining, 12, 8)).toEqual(rgba(image, 4, 4))
    expect(report.declaredDonors).toEqual([{ index: 0, boundsPx: donor, priorInferencePixels: 1 }])
    expect(report.priorLayerIds).toEqual(['first'])
    expect(report.extractedInferencePixels).toBe(0)
    expect(report.actualSampledInferencePixels).toBe('notMeasured')
    expect(report.boundaryInferencePixels).toBe('notMeasured')
    const fill = replayImageLayers(image, [first, { ...second, donor: { x: 0, y: 0, width: 2, height: 2 },
      fills: [{ polygon: second.polygon, donor }] }])
    expect(fill.layers[1].diagnostics.declaredDonors.map(value => [value.index, value.priorInferencePixels])).toEqual([[0, 0], [1, 1]])
    expect(fill.sourceReport.declaredDonorPriorInferencePixels).toBe(1)
  })

  it('marks repaired pixels as inferred even when their RGBA bytes are unchanged', () => {
    const image = source()
    image.data.fill(100)
    const result = replayImageLayers(image, [layer('same-bytes', { x: 5, y: 5, width: 2, height: 2 })])
    expect(result.remaining.data).toEqual(image.data)
    expect(result.sourceReport.inferredPixels).toBe(4)
    expect(result.sourceReport.capturedSourcePixels).toBe(476)
    expect(result.provenance[5 * image.width + 5]).toBe(1)
    expect(result.layers[0].diagnostics.repairPixels).toBe(4)
  })

  it('counts nonzero selection coverage, preserves holes, and includes only an explicit cleanup halo', () => {
    const image = source(), boundsPx = { x: 5, y: 5, width: 5, height: 5 }, data = new Uint8Array(25).fill(255)
    data[0] = 1; data[12] = 0
    const selectionMask = encodeSelectionMask({ width: 5, height: 5, boundsPx, data })
    const definition = layer('with-hole', boundsPx, { selectionMask }), plain = replayImageLayers(image, [definition])
    expect(plain.sourceReport.inferredPixels).toBe(24)
    expect(plain.provenance[5 * image.width + 5]).toBe(1)
    expect(plain.provenance[7 * image.width + 7]).toBe(0)
    expect(rgba(plain.remaining, 7, 7)).toEqual(rgba(image, 7, 7))
    const cleanup = replayImageLayers(image, [{ ...definition, cleanupPx: 1 }])
    expect(cleanup.sourceReport.inferredPixels).toBe(49)
    expect(cleanup.layers[0].extracted.mask.data[12]).toBe(0)
    expect(cleanup.provenance[7 * image.width + 7]).toBe(1)
    expect(cleanup.provenance[4 * image.width + 4]).toBe(1)
    expect(cleanup.provenance[3 * image.width + 3]).toBe(0)
  })

  it('tracks extracted prior inference and the last repair producer without including unrelated layers', () => {
    const image = source(), first = layer('piano', { x: 4, y: 4, width: 2, height: 2 })
    const second = layer('rug', { x: 3, y: 3, width: 4, height: 4 }, { donor: { x: 12, y: 0, width: 2, height: 2 } })
    const third = layer('unrelated', { x: 20, y: 14, width: 1, height: 1 }, { donor: { x: 0, y: 12, width: 2, height: 2 } })
    const result = replayImageLayers(image, [first, second, third])
    expect(result.layers[1].diagnostics.extractedInferencePixels).toBe(4)
    expect(result.layers[1].diagnostics.priorLayerIds).toEqual(['piano'])
    expect(result.layers[2].diagnostics.priorLayerIds).toEqual([])
    expect(result.provenance[4 * image.width + 4]).toBe(2)
    expect(result.provenance[14 * image.width + 20]).toBe(3)
    expect(result.sourceReport.inferredPixels).toBe(17)
    expect(result.sourceReport.repairPixels).toBe(21)
    expect(result.sourceReport.extractedInferencePixels).toBe(4)
    expect(result.sourceReport.layers).toEqual(result.layers.map(value => value.diagnostics))
    expect('remaining' in result.layers[0].extracted).toBe(false)
    expect('provenance' in result.layers[0]).toBe(false)
  })

  it('does not describe merely overwritten prior repair pixels as a read dependency', () => {
    const image = source(), result = replayImageLayers(image, [layer('old-fill', { x: 6, y: 6, width: 1, height: 1 }),
      layer('cleanup', { x: 8, y: 6, width: 1, height: 1 }, { cleanupPx: 2 })])
    expect(result.provenance[6 * image.width + 6]).toBe(2)
    expect(result.layers[1].diagnostics.priorLayerIds).toEqual([])
    expect(result.layers[1].diagnostics.extractedInferencePixels).toBe(0)
  })

  it('rebuilds independent provenance after reorder and undo-style replay', () => {
    const image = source(), first = layer('first', { x: 2, y: 2, width: 1, height: 1 })
    const second = layer('second', { x: 12, y: 8, width: 1, height: 1 }, { donor: { x: 2, y: 2, width: 4, height: 4 } })
    const ordered = replayImageLayers(image, [first, second]), before = ordered.provenance.slice()
    const reversed = replayImageLayers(image, [second, first]), undone = replayImageLayers(image, [first])
    expect(ordered.layers[1].diagnostics.priorLayerIds).toEqual(['first'])
    expect(reversed.layers.every(value => value.diagnostics.priorLayerIds.length === 0)).toBe(true)
    expect(reversed.provenance[2 * image.width + 2]).toBe(2)
    expect(undone.provenance[8 * image.width + 12]).toBe(0)
    expect(undone.sourceReport.inferredPixels).toBe(1)
    expect(replayImageLayers(image, [first, second]).remaining).toEqual(ordered.remaining)
    expect(ordered.provenance).toEqual(before)
    expect(reversed.provenance).not.toBe(ordered.provenance)
  })

  it('matches naive rectangle scans across block boundaries, cleanup, overlapping repairs and partial image-edge blocks', () => {
    const image = source(131, 101)
    const definitions = [
      layer('cross-block', { x: 28, y: 29, width: 12, height: 10 }, { cleanupPx: 1 }),
      layer('image-edge', { x: 129, y: 33, width: 1, height: 2 }),
      layer('overlap', { x: 30, y: 31, width: 12, height: 8 }, { donor: { x: 0, y: 0, width: 64, height: 24 },
        fills: [{ polygon: box({ x: 30, y: 31, width: 12, height: 8 }), donor: { x: 28, y: 29, width: 2, height: 2 } }] }),
      layer('mixed-donors', { x: 100, y: 75, width: 4, height: 4 }, { cleanupPx: 2, donor: { x: 20, y: 20, width: 55, height: 30 },
        fills: [{ polygon: box({ x: 102, y: 75, width: 2, height: 4 }), donor: { x: 0, y: 70, width: 65, height: 30 } }] }),
      layer('wide-donor', { x: 96, y: 24, width: 12, height: 13 }, { donor: { x: 0, y: 0, width: 90, height: 70 } }),
      layer('edge-donor', { x: 120, y: 95, width: 3, height: 3 }, { donor: { x: 0, y: 0, width: 131, height: 90 } }),
    ]
    const expected = naiveReplay(image, definitions), result = replayImageLayers(image, definitions)
    expect(result.sourceReport).toEqual(expected.sourceReport)
    expect(result.provenance).toEqual(expected.provenance)
    expect(result.remaining).toEqual(expected.remaining)
  })

  it('clears overwritten producer bits while retaining producer 32 and the upper-word producers', () => {
    const image = source(128, 96)
    const definitions = Array.from({ length: 63 }, (_, index) => layer(`item-${index + 1}`,
      { x: index === 31 ? 36 : 34, y: 34, width: 1, height: 1 }))
    definitions.push(layer('item-64', { x: 110, y: 80, width: 1, height: 1 }, { donor: { x: 0, y: 0, width: 96, height: 64 } }))
    const expected = naiveReplay(image, definitions), result = replayImageLayers(image, definitions)
    expect(result.sourceReport).toEqual(expected.sourceReport)
    expect(result.provenance).toEqual(expected.provenance)
    expect(result.layers[63].diagnostics.priorLayerIds).toEqual(['item-32', 'item-63'])
    expect(result.layers[63].diagnostics.declaredDonors[0].priorInferencePixels).toBe(2)
    expect(result.provenance[80 * image.width + 110]).toBe(64)
  })

  it.each(['tile', 'seamless', 'aligned'] as const)('preserves the previous manual %s replay RGBA, masks and source bytes', repair => {
    const image = source(32, 24), before = image.data.slice()
    const definitions = [layer('inner', { x: 10, y: 8, width: 4, height: 4 }, { repair, cleanupPx: 1,
      fills: [{ polygon: box({ x: 12, y: 8, width: 2, height: 4 }), donor: { x: 28, y: 0, width: 4, height: 4 } }] }),
    layer('outer', { x: 8, y: 6, width: 9, height: 9 }, { repair, donor: { x: 0, y: 16, width: 4, height: 4 } })]
    let remaining = image
    const manual = definitions.map(definition => {
      const result = extractImageLayer(remaining, definition.polygon, definition.donor, definition)
      remaining = result.remaining
      return { layer: result.layer, mask: result.mask, repairMask: result.repairMask }
    })
    const result = replayImageLayers(image, definitions)
    expect(result.remaining).toEqual(remaining)
    expect(result.layers.map(value => value.extracted)).toEqual(manual)
    expect(image.data).toEqual(before)
  })

  it('uses values 1 through 64 and rejects duplicate identities, oversized drafts and invalid source bytes', () => {
    const image = source(), definition = layer('item', { x: 4, y: 4, width: 1, height: 1 })
    const definitions = Array.from({ length: 64 }, (_, index) => ({ ...definition, id: `item-${index}` }))
    const result = replayImageLayers(image, definitions)
    expect(result.provenance[4 * image.width + 4]).toBe(64)
    expect(result.layers[63].diagnostics.priorLayerIds).toEqual(['item-62'])
    expect(result.sourceReport.layerCount).toBe(64)
    expect(result.sourceReport.inferredPixels).toBe(1)
    expect(() => replayImageLayers(image, [...definitions, { ...definition, id: 'extra' }])).toThrow('最多64层')
    expect(() => replayImageLayers(image, [definition, definition])).toThrow('身份重复')
    expect(() => replayImageLayers({ ...image, data: new Uint8ClampedArray(1) }, [])).toThrow('完整RGBA')
  })
})
