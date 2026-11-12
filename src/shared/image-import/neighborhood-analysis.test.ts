import { describe, expect, it } from 'vitest'
import { analyzeImageImportRepair } from './neighborhood-analysis.js'
import { replayImageLayers, type ImageReplayLayer } from './layer-replay.js'
import type { ImageRepairSurface } from './surfaces.js'
import { encodeSelectionMask } from './selection-mask.js'
import type { ImagePixels, PixelBounds } from './pixels.js'

function mask(bounds: PixelBounds) { return encodeSelectionMask({ width: bounds.width, height: bounds.height, boundsPx: bounds, data: new Uint8Array(bounds.width * bounds.height).fill(255) }) }
function fixture() {
  const image: ImagePixels = { width: 80, height: 60, data: new Uint8ClampedArray(80 * 60 * 4) }
  for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) image.data.set([100 + x % 4, 110 + y % 3, 125 + (x + y) % 5, 255], (y * 80 + x) * 4)
  const surface: ImageRepairSurface = { id: 'rug', name: '蓝毯', kind: 'neighbors-soft', mask: mask({ x: 0, y: 0, width: 80, height: 60 }), donor: { x: 2, y: 2, width: 20, height: 20 } }
  const layer: ImageReplayLayer = { id: 'chair', polygon: [{ x: 30, y: 25 }, { x: 40, y: 25 }, { x: 40, y: 35 }, { x: 30, y: 35 }], selectionMask: mask({ x: 30, y: 25, width: 10, height: 10 }), donor: surface.donor, repair: 'surfaces', repairSurfaceIds: ['rug'], renderLayer: 'object' }
  const future: ImageReplayLayer = { id: 'cabinet', polygon: [{ x: 50, y: 20 }, { x: 65, y: 20 }, { x: 65, y: 40 }, { x: 50, y: 40 }], donor: surface.donor, renderLayer: 'object' }
  return { image, surface, layer, future }
}
function overlap(a: PixelBounds, b: PixelBounds) { return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height }

describe('same-material actual replay analysis', () => {
  it('excludes future unremoved objects throughout each source footprint and ignores their RGB', () => {
    const { image, surface, layer, future } = fixture(), layers = [layer, future]
    const before = analyzeImageImportRepair(image, layers, [surface], layer.id)
    const altered = { ...image, data: image.data.slice() }
    for (let y = 20; y < 40; y++) for (let x = 50; x < 65; x++) altered.data.set([255, 0, 245, 255], (y * image.width + x) * 4)
    expect(analyzeImageImportRepair(altered, layers, [surface], layer.id)).toEqual(before)
    for (const site of before.surfaces[0].report.sites) for (const candidate of site.candidates) {
      expect(overlap(candidate.sourceBoundsPx, { x: 50, y: 20, width: 15, height: 20 })).toBe(false)
    }
    const current = replayImageLayers(image, [layer], [surface], { evidenceLayers: layers })
    const changed = replayImageLayers(altered, [layer], [surface], { evidenceLayers: layers })
    for (let y = 25; y < 35; y++) for (let x = 30; x < 40; x++) {
      const at = (y * image.width + x) * 4
      expect(changed.remaining.data.slice(at, at + 4)).toEqual(current.remaining.data.slice(at, at + 4))
    }
  })
  it('requires declared material instead of fabricating a color group', () => {
    const { image, layer } = fixture()
    const result = analyzeImageImportRepair(image, [{ ...layer, repair: 'tile', repairSurfaceIds: undefined }], [], layer.id)
    expect(result.surfaces).toEqual([])
    expect(result.unassignedBoundsPx).toEqual({ x: 30, y: 25, width: 10, height: 10 })
    expect(result.summary.join('')).toContain('先圈同材质')
  })
  it('uses first surface wins for overlapping material scopes and never counts the hidden region twice', () => {
    const { image, surface, layer } = fixture()
    const first = { ...surface, id: 'left', mask: mask({ x: 0, y: 0, width: 35, height: 60 }) }
    const second = { ...surface, id: 'right' }
    const result = analyzeImageImportRepair(image, [{ ...layer, repairSurfaceIds: ['left', 'right'] }], [first, second], layer.id)
    expect(result.surfaces.map(value => value.report.counts.repairPixels)).toEqual([50, 50])
    expect(result.unassignedBoundsPx).toBeUndefined()
  })
  it('keeps old soft output independent of new automatic object evidence', () => {
    const { image, surface, layer, future } = fixture(), old = { ...surface, kind: 'soft' as const }
    expect(replayImageLayers(image, [layer], [old], { evidenceLayers: [layer, future] }).remaining)
      .toEqual(replayImageLayers(image, [layer], [old]).remaining)
    expect(() => analyzeImageImportRepair(image, [layer], [surface], 'missing')).toThrow('目标不存在')
    const controller = new AbortController(); controller.abort()
    expect(() => analyzeImageImportRepair(image, [layer], [surface], layer.id, controller.signal)).toThrow()
  })
})
