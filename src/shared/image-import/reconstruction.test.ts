import { describe, expect, it } from 'vitest'
import { reconstructSourceLayers } from './reconstruction.js'
import type { ImageImportRecipe } from './recipe.js'
import { encodeSelectionMask } from './selection-mask.js'
import { compareImageFidelity } from './fidelity.js'

const box = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function fixture() {
  const source = { width: 40, height: 32, data: new Uint8ClampedArray(40 * 32 * 4) }
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const color = x >= 12 && x < 28 && y >= 8 && y < 24 ? x >= 18 && x < 24 && y >= 12 && y < 18 ? [22, 30, 38, 255] : [72, 116, 131, 255] : [110 + x % 5, 95 + y % 7, 83, 255]
    source.data.set(color, (y * source.width + x) * 4)
  }
  const recipe: ImageImportRecipe = { format: 'sceneweave-image-import-recipe', version: 1, image: { sha256: 'a'.repeat(64), pixelWidth: 40, pixelHeight: 32 },
    title: '原创保真测试', calibration: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, distanceMm: 1000 }, roomPointsPx: box(3, 3, 34, 26), sourceBoundaryPx: box(1, 1, 38, 30),
    layers: [{ id: 'piano', name: '琴', polygon: box(18, 12, 6, 6), donor: { x: 12, y: 8, width: 4, height: 4 }, renderLayer: 'object', blocksMovement: true },
      { id: 'rug', name: '毯', polygon: box(12, 8, 16, 16), donor: { x: 3, y: 3, width: 5, height: 5 }, renderLayer: 'ground', blocksMovement: false }] }
  return { source, recipe }
}
describe('source-preserving layered reconstruction', () => {
  it('recomposes every visible source RGBA exactly, preserves hand-drawn colour variation, and identifies hidden floor separately', () => {
    const { source, recipe } = fixture(), before = source.data.slice(), result = reconstructSourceLayers(source, recipe)
    expect(result.composite.data).toEqual(result.source.data)
    expect(result.floor.boundsPx).toEqual({ x: 1, y: 1, width: 38, height: 30 })
    expect(result.inferenceMask[15 * 40 + 20]).toBe(255)
    expect(result.scopeMask[5 * 40 + 5]).toBe(255)
    expect(result.inferenceMask[5 * 40 + 5]).toBe(0)
    for (let index = 0; index < result.inferenceMask.length; index++) if (!result.inferenceMask[index]) expect(result.remaining.data.slice(index * 4, index * 4 + 4)).toEqual(source.data.slice(index * 4, index * 4 + 4))
    expect(source.data).toEqual(before)
  })
  it('does not allow an art-preservation boundary to silently cut off selected object pixels', () => {
    const { source, recipe } = fixture()
    recipe.sourceBoundaryPx = box(19, 13, 4, 4)
    expect(() => reconstructSourceLayers(source, recipe)).toThrow('不能裁掉原画细节')
  })
  it('replays a fine selection with holes and exterior tips while retaining source comparison and repair scope', () => {
    const { source, recipe } = fixture()
    recipe.layers = [recipe.layers[0]]
    recipe.layers[0].selectionMask = encodeSelectionMask({ width: 8, height: 6, boundsPx: { x: 17, y: 12, width: 8, height: 6 },
      data: Uint8Array.from({ length: 48 }, (_, index) => index === 19 ? 0 : 255) })
    const result = reconstructSourceLayers(source, recipe)
    expect(result.layers[0].boundsPx).toEqual({ x: 17, y: 12, width: 8, height: 6 })
    expect(result.inferenceMask[14 * 40 + 20]).toBe(0)
    expect(result.inferenceMask[12 * 40 + 17]).toBe(255)
    expect(result.composite.data).toEqual(result.source.data)
  })
  it('does not let arbitrary partial-alpha interiors waive source fidelity', () => {
    const { source, recipe } = fixture()
    recipe.layers = [recipe.layers[0]]
    recipe.layers[0].selectionMask = { x: 18, y: 12, width: 6, height: 6, runs: [36, 128] }
    const result = reconstructSourceLayers(source, recipe)
    expect(result.edgeMask[14 * 40 + 20]).toBe(0)
    expect(compareImageFidelity(result.source, result.composite, { comparisonKind: 'source', scopeMask: result.scopeMask,
      allowedInferenceMask: result.edgeMask }).passed).toBe(false)
  })
})
