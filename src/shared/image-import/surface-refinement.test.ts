import { describe, expect, it } from 'vitest'
import { previewImageImportSurface, validateImageSurfaceRefinement, type ImageSurfaceRefinement } from './surface-refinement.js'
import { encodeSelectionMask } from './selection-mask.js'
import { replayImageLayers } from './layer-replay.js'
import type { ImageImportLayer } from './recipe.js'
import type { ImageRepairSurface } from './surfaces.js'

const rect = (x: number, y: number, width: number, height: number) => encodeSelectionMask({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
function fixture() {
  const width = 96, height = 80, data = new Uint8ClampedArray(width * height * 4)
  const truth = data.slice()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, seam = y === 40 && x >= 14 && x <= 80
    const color = seam ? [40, 64, 70] : [95, 119, 123]
    truth.set([...color, 255], at)
    const shade = x >= 32 && x <= 70 && y >= 30 && y <= 50 ? 16 : 0
    data.set([...color.map(v => v - shade), 255], at)
    if (x >= 40 && x < 52 && y >= 32 && y < 48) data.set([190, 70, 20, 255], at)
  }
  const chair: ImageImportLayer = { id: 'chair', name: 'Chair', renderLayer: 'object', blocksMovement: false,
    polygon: [{ x: 40, y: 32 }, { x: 52, y: 32 }, { x: 52, y: 48 }, { x: 40, y: 48 }], donor: { x: 80, y: 12, width: 6, height: 6 },
    selectionMask: rect(40, 32, 12, 16), removalMask: rect(36, 30, 24, 20), appearanceSource: 'original', repair: 'tile' }
  const rug: ImageImportLayer = { id: 'rug', name: 'Cloth', renderLayer: 'ground', blocksMovement: false,
    polygon: [{ x: 8, y: 8 }, { x: 88, y: 8 }, { x: 88, y: 72 }, { x: 8, y: 72 }], donor: { x: 1, y: 1, width: 5, height: 5 },
    selectionMask: rect(8, 8, 80, 64), appearanceSource: 'working', repair: 'tile' }
  const refinement: ImageSurfaceRefinement = { method: 'cloth-surface-v1', materialSurfaceId: 'cloth', donor: { x: 12, y: 12, width: 8, height: 8 }, seed: 1,
    reason: 'Known flat cloth with one visible seam and a cast shadow.', strokes: [{ role: 'visible-cloth-seam', axis: 'horizontal',
      points: [{ x: 14, y: 40 }, { x: 80, y: 40 }], crossPx: 13, bridgeMaxPx: 32, reason: 'Same visible seam on both sides of the opaque chair.' }] }
  const surfaces: ImageRepairSurface[] = [{ id: 'cloth', name: 'Cloth', kind: 'soft', mask: rect(8, 8, 80, 64), donor: refinement.donor }]
  return { source: { width, height, data }, truth, layers: [chair, rug], refinement, surfaces }
}

describe('explicit cloth surface appearance', () => {
  it('reduces a known shadow without erasing visible original seam; bridges only the occluded short run', () => {
    const f = fixture(), result = previewImageImportSurface(f.source, f.layers, f.surfaces, 'rug', f.refinement)
    expect(result.metrics.inferredStrokeWrites).toBeGreaterThan(0)
    expect(result.reports[0].inferredRuns).toHaveLength(1)
    const at = (x: number, y: number) => ((y - 8) * 80 + x - 8) * 4
    expect(result.pixels.data[at(30, 40)]).toBeLessThan(50)
    expect(result.pixels.data[at(46, 40)]).toBeLessThan(55)
    expect(result.pixels.data[at(65, 35)]).toBeGreaterThan(90)
    let before = 0, after = 0
    for (let y = 23; y <= 57; y++) for (let x = 24; x <= 71; x++) for (let c = 0; c < 3; c++) {
      const original = f.truth[(y * f.source.width + x) * 4 + c]
      before += Math.abs(result.original.data[at(x, y) + c] - original)
      after += Math.abs(result.pixels.data[at(x, y) + c] - original)
    }
    expect(after).toBeLessThan(before * .5)
    expect(result.sourceRoles.strokes).toBe('explicit-visible-original-may-be-shaded')
  })

  it('keeps nonempty protection, alpha and the three-pixel border byte-exact; leaves baseline/background intact', () => {
    const f = fixture(), original = f.source.data.slice(), protectedScope = rect(24, 24, 5, 5)
    const baseline = replayImageLayers(f.source, f.layers), result = previewImageImportSurface(f.source, f.layers, f.surfaces, 'rug', { ...f.refinement, protectionMask: protectedScope })
    for (let y = 0; y < 64; y++) for (let x = 0; x < 80; x++) {
      const i = (y * 80 + x) * 4
      expect(result.pixels.data[i + 3]).toBe(result.original.data[i + 3])
      if (x < 3 || y < 3 || x >= 77 || y >= 61 || x >= 16 && x < 21 && y >= 16 && y < 21) expect([...result.pixels.data.slice(i, i + 4)]).toEqual([...result.original.data.slice(i, i + 4)])
    }
    expect(f.source.data).toEqual(original)
    expect(replayImageLayers(f.source, f.layers).remaining.data).toEqual(baseline.remaining.data)
  })

  it('does not read opaque neighbour RGB even when a stroke crosses it, and rejects cast-shadow donors', () => {
    const f = fixture(), original = previewImageImportSurface(f.source, f.layers, f.surfaces, 'rug', f.refinement)
    const changed = { ...f.source, data: f.source.data.slice() }
    for (let y = 32; y < 48; y++) for (let x = 40; x < 52; x++) changed.data.set([7, 240, 90], (y * changed.width + x) * 4)
    expect(previewImageImportSurface(changed, f.layers, f.surfaces, 'rug', f.refinement).pixels.data).toEqual(original.pixels.data)
    expect(() => previewImageImportSurface(f.source, f.layers, f.surfaces, 'rug', { ...f.refinement, donor: { x: 36, y: 30, width: 5, height: 5 } })).toThrow('移除')
  })

  it('does not bridge a genuine visible ink gap and gives a local unresolved range', () => {
    const f = fixture()
    for (let x = 65; x < 69; x++) f.source.data.set([79, 103, 107, 255], (40 * f.source.width + x) * 4)
    const result = previewImageImportSurface(f.source, f.layers, f.surfaces, 'rug', f.refinement)
    expect(result.reports[0].unresolvedRuns.some(r => r.x <= 65 && r.x + r.width >= 69)).toBe(true)
    expect(result.pixels.data[((40 - 8) * 80 + 66 - 8) * 4]).toBeGreaterThan(85)
  })

  it('rejects non-cloth/ambiguous geometry, overlong donor, backwards guides and hidden stitch extrapolation', () => {
    const f = fixture()
    expect(() => previewImageImportSurface(f.source, f.layers, f.surfaces, 'chair', f.refinement)).toThrow('地面')
    expect(() => validateImageSurfaceRefinement(f.source, { ...f.refinement, donor: { x: 10, y: 10, width: 80, height: 60 } })).toThrow('4096')
    expect(() => validateImageSurfaceRefinement(f.source, { ...f.refinement, strokes: [{ ...f.refinement.strokes[0], points: [{ x: 80, y: 40 }, { x: 14, y: 40 }] }] })).toThrow('单调')
    expect(() => validateImageSurfaceRefinement(f.source, { ...f.refinement, strokes: [{ ...f.refinement.strokes[0], role: 'visible-cloth-stitch' }] })).toThrow('针脚')
  })

  it('rejects a cloth declaration that covers only the donor but leaves other target materials unqualified', () => {
    const f = fixture()
    const partial = [{ ...f.surfaces[0], mask: rect(8, 8, 30, 64) }]
    expect(() => previewImageImportSurface(f.source, f.layers, partial, 'rug', f.refinement)).toThrow('完整选区')
  })
})
