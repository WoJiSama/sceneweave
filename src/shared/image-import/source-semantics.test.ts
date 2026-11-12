import { describe, expect, it } from 'vitest'
import { sha256Bytes } from '../project/binary.js'
import { encodeSourcePng } from '../project/png-rgba.js'
import { replayImageLayers } from './layer-replay.js'
import { reconstructSourceLayers } from './reconstruction.js'
import { parseImageImportRecipe, type ImageImportRecipe } from './recipe.js'
import { type ImagePixels } from './pixels.js'
import { parseImageWorkState, readImageWorkPackage, writeImageWorkPackage, type ImageWorkState } from './workflow.js'
import type { ImageRepairSurface } from './surfaces.js'

const box = (x: number, y: number, width: number, height: number) =>
  [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const rgba = (image: ImagePixels, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
function fixture() {
  const width = 64, height = 48, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const colour = x >= 24 && x < 28 && y >= 20 && y < 24 ? [220, 40, 60, 255]
      : x >= 16 && x < 44 && y >= 12 && y < 36 ? [80, 120, 130, 255] : [110, 100, 90, 255]
    data.set(colour, (y * width + x) * 4)
  }
  const source = { width, height, data }, png = encodeSourcePng({ width, height, rgba: data })
  const repairSurface: ImageRepairSurface = { id: 'floor', name: '地板', kind: 'soft',
    mask: { x: 0, y: 0, width, height, runs: [width * height, 255] }, donor: { x: 2, y: 2, width: 12, height: 8 } }
  const recipe: ImageImportRecipe = { format: 'sceneweave-image-import-recipe', version: 1,
    image: { sha256: sha256Bytes(png), pixelWidth: width, pixelHeight: height }, title: '合成来源测试',
    calibration: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, distanceMm: 1000 },
    roomPointsPx: box(0, 0, width, height), repairSurfaces: [repairSurface],
    layers: [{ id: 'piano', name: '琴', polygon: box(24, 20, 4, 4), donor: { x: 16, y: 12, width: 4, height: 4 },
      renderLayer: 'object', blocksMovement: true },
    { id: 'rug', name: '毯', polygon: box(16, 12, 28, 24), donor: { x: 20, y: 16, width: 2, height: 2 },
      repair: 'surfaces', repairSurfaceIds: ['floor'], renderLayer: 'ground', blocksMovement: false }] }
  return { source, png, recipe }
}
function workState(recipe: ImageImportRecipe, png: Uint8Array): ImageWorkState {
  return { format: 'sceneweave-image-work', version: 1, id: 'synthetic-surfaces', revision: 3, image: recipe.image,
    original: { sha256: sha256Bytes(png), sizeBytes: png.length, name: 'synthetic.png', mimeType: 'image/png' },
    rights: { licenseText: 'synthetic test', attribution: '', canEmbed: true },
    draft: { title: recipe.title, calibration: recipe.calibration, roomPointsPx: recipe.roomPointsPx,
      layers: recipe.layers, repairSurfaces: recipe.repairSurfaces },
    active: { name: '未完成', polygon: [], donor: [], renderLayer: 'object', blocksMovement: false,
      repair: 'surfaces', repairSurfaceIds: ['floor'], appearanceSource: 'original' },
    notes: '', nextAction: '继续合成测试', scaleStatus: 'measured', journal: [], reviews: [] }
}

describe('layer appearance source and surface persistence', () => {
  it('extracts captured original pixels independently of the working repair and its provenance', () => {
    const { source, recipe } = fixture(), before = source.data.slice()
    recipe.layers[1].appearanceSource = 'original'
    const original = replayImageLayers(source, recipe.layers, recipe.repairSurfaces)
    recipe.layers[1].appearanceSource = 'working'
    const working = replayImageLayers(source, recipe.layers, recipe.repairSurfaces)
    for (let y = 0; y < 24; y++) for (let x = 0; x < 28; x++) {
      expect(rgba(original.layers[1].extracted.layer, x, y)).toEqual(rgba(source, x + 16, y + 12))
    }
    expect(rgba(original.layers[1].extracted.layer, 8, 8)).toEqual([220, 40, 60, 255])
    expect(rgba(working.layers[1].extracted.layer, 8, 8)).toEqual([80, 120, 130, 255])
    expect(original.layers[1].diagnostics.extractedInferencePixels).toBe(0)
    expect(working.layers[1].diagnostics.extractedInferencePixels).toBe(16)
    expect(original.sourceReport.extractedInferencePixels).toBe(0)
    expect(working.sourceReport.extractedInferencePixels).toBe(16)
    expect(original.sourceReport.inferredPixels).toBe(28 * 24)
    expect(original.sourceReport.repairPixels).toBe(28 * 24 + 16)
    expect(original.remaining).toEqual(working.remaining)
    expect(original.provenance).toEqual(working.provenance)
    expect(original.provenance[20 * source.width + 24]).toBe(2)
    expect(source.data).toEqual(before)
  })

  it('preserves the default working appearance for recipes that omit the source field', () => {
    const { source, recipe } = fixture()
    const implicit = reconstructSourceLayers(source, recipe)
    recipe.layers.forEach(layer => { layer.appearanceSource = 'working' })
    const explicit = reconstructSourceLayers(source, recipe)
    expect(implicit.layers.map(layer => layer.pixels)).toEqual(explicit.layers.map(layer => layer.pixels))
    expect(implicit.remaining).toEqual(explicit.remaining)
    expect(implicit.sourceReport).toEqual(explicit.sourceReport)
    expect(implicit.sourceReport.extractedInferencePixels).toBe(16)
    expect(implicit.composite.data).toEqual(implicit.source.data)
  })

  it('reports the donors actually used by surfaces instead of the unused legacy donor', () => {
    const { source, recipe } = fixture()
    const result = replayImageLayers(source, recipe.layers, recipe.repairSurfaces)
    expect(result.layers[1].diagnostics.declaredDonors.map(d => d.boundsPx)).toEqual([recipe.repairSurfaces![0].donor])
  })

  it('keeps surfaces, source choice and references through strict recipe JSON cold parsing', () => {
    const { recipe } = fixture()
    recipe.layers[1].appearanceSource = 'original'
    recipe.repairSurfaces![0].excludedEvidenceMask = { x: 50, y: 40, width: 4, height: 4, runs: [16, 255] }
    const parsed = parseImageImportRecipe(JSON.parse(JSON.stringify(recipe)))
    expect(parsed).toEqual(recipe)
    expect(Object.isFrozen(parsed.repairSurfaces![0].mask.runs)).toBe(true)
    expect(Object.isFrozen(parsed.layers[1].repairSurfaceIds)).toBe(true)
    recipe.repairSurfaces![0].name = 'later mutation'; recipe.layers[1].repairSurfaceIds![0] = 'missing'
    expect(parsed.repairSurfaces![0].name).toBe('地板')
    expect(parsed.layers[1].repairSurfaceIds).toEqual(['floor'])
    expect(() => parseImageImportRecipe({ ...parsed, layers: [{ ...parsed.layers[0], appearanceSource: 'invented' }] })).toThrow()
  })

  it('carries draft and active source/surface fields through a real work-package write and cold read', async () => {
    const { png, recipe } = fixture()
    recipe.layers[1].appearanceSource = 'original'
    const input = workState(recipe, png), bytes = await writeImageWorkPackage(input, png, png)
    input.draft.repairSurfaces![0].name = 'later mutation'; input.active!.repairSurfaceIds![0] = 'missing'
    const restored = await readImageWorkPackage(bytes)
    expect(restored.state.draft.repairSurfaces![0].name).toBe('地板')
    expect(restored.state.draft.layers[1]).toMatchObject({ appearanceSource: 'original', repairSurfaceIds: ['floor'], repair: 'surfaces' })
    expect(restored.state.active).toMatchObject({ appearanceSource: 'original', repairSurfaceIds: ['floor'], repair: 'surfaces' })
    expect(Object.isFrozen(restored.state.draft.repairSurfaces![0].mask.runs)).toBe(true)
    expect(restored.original).toEqual(png)
    expect(restored.normalized).toEqual(png)
  })

  it.each([{ ids: ['missing'] }, { ids: ['floor', 'floor'] }])('rejects invalid surface references $ids in recipes, drafts, active work and direct replay', ({ ids }) => {
    const { source, png, recipe } = fixture()
    recipe.layers[1].repairSurfaceIds = ids
    expect(() => parseImageImportRecipe(recipe)).toThrow(/不存在|重复/)
    expect(() => parseImageWorkState(workState(recipe, png))).toThrow(/不存在|重复/)
    expect(() => replayImageLayers(source, recipe.layers, recipe.repairSurfaces)).toThrow(/不存在|重复/)
    recipe.layers[1].repairSurfaceIds = ['floor']
    const active = workState(recipe, png); active.active!.repairSurfaceIds = ids
    expect(() => parseImageWorkState(active)).toThrow(/不存在|重复/)
  })

  it('rejects surfaces mode without references or combined with legacy fills', () => {
    const { source, recipe } = fixture()
    delete recipe.layers[1].repairSurfaceIds
    expect(() => parseImageImportRecipe(recipe)).toThrow(/指定表面身份/)
    expect(() => replayImageLayers(source, recipe.layers, recipe.repairSurfaces)).toThrow(/指定表面身份/)
    recipe.layers[1].repairSurfaceIds = ['floor']
    recipe.layers[1].fills = [{ polygon: box(16, 12, 28, 24), donor: { x: 2, y: 2, width: 8, height: 8 } }]
    expect(() => parseImageImportRecipe(recipe)).toThrow(/fills/)
    expect(() => replayImageLayers(source, recipe.layers, recipe.repairSurfaces)).toThrow(/fills/)
  })

  it('applies one total mask budget to saved surfaces and an unfinished active selection', () => {
    const { png, recipe } = fixture(), input = workState(recipe, png)
    input.image = { ...input.image, pixelWidth: 1000, pixelHeight: 1000 }
    input.draft.layers = []
    input.draft.repairSurfaces = Array.from({ length: 8 }, (_, i) => ({ id: `surface-${i}`, name: `surface-${i}`, kind: 'soft',
      mask: { x: 0, y: 0, width: 1000, height: 1000, runs: [1_000_000, 255] }, donor: { x: 0, y: 0, width: 3, height: 3 } }))
    input.active!.repairSurfaceIds = ['surface-0']
    expect(() => parseImageWorkState(input)).not.toThrow()
    input.active!.selectionMask = { x: 5, y: 5, width: 1, height: 1, runs: [1, 255] }
    expect(() => parseImageWorkState(input)).toThrow(/累计超过800万/)
  })

  it('counts surface masks together with completed layer masks in the recipe budget', () => {
    const { recipe } = fixture()
    recipe.image = { ...recipe.image, pixelWidth: 1000, pixelHeight: 1000 }
    recipe.layers = [recipe.layers[0]]
    recipe.repairSurfaces = Array.from({ length: 8 }, (_, i) => ({ id: `surface-${i}`, name: `surface-${i}`, kind: 'soft',
      mask: { x: 0, y: 0, width: 1000, height: 1000, runs: [1_000_000, 255] }, donor: { x: 0, y: 0, width: 3, height: 3 } }))
    expect(() => parseImageImportRecipe(recipe)).not.toThrow()
    recipe.layers[0].selectionMask = { x: 24, y: 20, width: 4, height: 4, runs: [16, 255] }
    expect(() => parseImageImportRecipe(recipe)).toThrow(/累计超过800万/)
  })
})
