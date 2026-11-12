import { describe, expect, it } from 'vitest'
import { imageRepairSurfaceSchema, repairImageSurfaces, validateImageRepairSurfaces, type ImageRepairSurface } from './surfaces.js'
import type { ImagePixelMask, ImagePixels } from './pixels.js'
import { encodeSelectionMask } from './selection-mask.js'
import { replayImageLayers } from './layer-replay.js'
import { analyzeImageImportRepair } from './neighborhood-analysis.js'
import { parseImageImportRecipe, imageImportToolArguments } from './recipe.js'

const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const guide = { points: [{ x: 28, y: 30 }, { x: 48, y: 30 }], reference: { x: 6, y: 27, width: 12, height: 7 }, axis: 'horizontal' as const, reason: '可见细缝水平延伸；只推断遮挡部分。' }
const surface = (): ImageRepairSurface => ({ id: 'wood', name: '水平木板', kind: 'guided', mask: encodeSelectionMask(box(0, 0, 80, 64)), donor: { x: 4, y: 4, width: 16, height: 16 }, guided: { orientation: 'horizontal', guides: [structuredClone(guide)] } })
function fixture(): ImagePixels {
  const width = 80, height = 64, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shift = y === 30 ? -54 : 0
    data.set([156 + shift + (x % 3), 125 + shift + (x % 3), 93 + shift + (x % 3), 255], (y * width + x) * 4)
  }
  return { width, height, data }
}
const layer = { id: 'chair', name: '椅', polygon: rectangle(28, 24, 20, 16), donor: { x: 4, y: 4, width: 16, height: 16 }, renderLayer: 'object' as const, blocksMovement: true, repair: 'surfaces' as const, repairSurfaceIds: ['wood'], selectionMask: encodeSelectionMask(box(28, 24, 20, 16)) }

describe('explicit guided repair surfaces', () => {
  it('uses one strict v1 schema for surfaces, recipes and MCP and rejects mismatched or excessive guidance', () => {
    const declared = surface()
    expect(imageRepairSurfaceSchema.parse(declared)).toEqual(declared)
    expect(imageImportToolArguments.image_import_set_surfaces.parse({ generation: 0, surfaces: [declared] })).toEqual({ generation: 0, surfaces: [declared] })
    const recipe = parseImageImportRecipe({ format: 'sceneweave-image-import-recipe', version: 1, image: { sha256: 'a'.repeat(64), pixelWidth: 80, pixelHeight: 64 }, title: 'guided', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 }, roomPointsPx: rectangle(0, 0, 80, 64), layers: [layer], repairSurfaces: [declared] })
    expect(recipe.version).toBe(1)
    expect(recipe.repairSurfaces![0].guided).toEqual(declared.guided)
    expect(() => imageRepairSurfaceSchema.parse({ ...declared, guided: undefined })).toThrow(/guided/)
    expect(() => imageRepairSurfaceSchema.parse({ ...declared, kind: 'soft' })).toThrow(/guided/)
    expect(() => imageRepairSurfaceSchema.parse({ ...declared, guided: { ...declared.guided, guides: Array.from({ length: 33 }, () => guide) } })).toThrow()
    expect(() => imageRepairSurfaceSchema.parse({ ...declared, guided: { ...declared.guided, guides: [{ ...guide, points: guide.points.slice(0, 1) }] } })).toThrow()
    expect(() => imageRepairSurfaceSchema.parse({ ...declared, guided: { ...declared.guided, guides: [{ ...guide, points: Array.from({ length: 17 }, () => guide.points[0]) }] } })).toThrow()
    expect(() => imageRepairSurfaceSchema.parse({ ...declared, guided: { ...declared.guided, guides: [{ ...guide, reason: ' '.repeat(5) }] } })).toThrow()
    expect(() => imageRepairSurfaceSchema.parse({ ...declared, guided: { ...declared.guided, guides: [{ ...guide, reason: 'x'.repeat(401) }] } })).toThrow()
  })

  it('checks every reference pixel and all point coordinates against the declared surface', () => {
    const image = fixture(), declared = surface()
    expect(() => validateImageRepairSurfaces(image, [declared])).not.toThrow()
    expect(() => validateImageRepairSurfaces(image, [{ ...declared, excludedEvidenceMask: encodeSelectionMask(box(8, 29, 1, 1)) }])).toThrow(/参考整块/)
    expect(() => validateImageRepairSurfaces(image, [{ ...declared, guided: { orientation: 'horizontal', guides: [{ ...guide, points: [{ x: 28, y: 24 }, { x: 80, y: 24 }] }] } }])).toThrow(/坐标/)
    expect(() => validateImageRepairSurfaces(image, [{ ...declared, guided: { orientation: 'horizontal', guides: [{ ...guide, reference: { x: 6, y: 27, width: 12, height: 4 } }] } }])).toThrow(/参考/)
  })

  it('replays explicit structure through the shared path and labels its analysis as inference', () => {
    const image = fixture(), before = image.data.slice(), declared = surface()
    const result = replayImageLayers(image, [layer], [declared])
    const centre = (30 * image.width + 38) * 4, adjacent = (34 * image.width + 38) * 4
    expect(result.remaining.data[centre]).toBeLessThan(result.remaining.data[adjacent] - 20)
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (x < 28 || x >= 48 || y < 24 || y >= 40) expect(result.remaining.data.slice((y * image.width + x) * 4, (y * image.width + x + 1) * 4)).toEqual(image.data.slice((y * image.width + x) * 4, (y * image.width + x + 1) * 4))
    expect(image.data).toEqual(before)
    const analysis = analyzeImageImportRepair(image, [layer], [declared], layer.id)
    expect(analysis.surfaces[0].report.pattern).toBe('planks')
    expect(analysis.summary.join('')).toContain('改变隐藏区域的推断结构')
    expect(analysis.surfaces[0].report.limitations.join('')).toContain('不能授予视觉通过')
  })

  it('locates an engine reference rejection by surface identity and reference bounds without disguising cancellation', () => {
    const image = fixture(), declared = surface(), before = image.data.slice()
    declared.guided!.guides[0].reference = { x: 6, y: 8, width: 12, height: 7 }
    expect(() => repairImageSurfaces(image, box(28, 24, 20, 16), [declared])).toThrow(/表面“水平木板”（wood）.*参考\[1:\(6, 8\) 12×7px horizontal\].*结构线参考中没有独立窄线/)
    expect(image.data).toEqual(before)
    const cancelled = new Error('保留原取消异常'); cancelled.name = 'AbortError'
    try {
      repairImageSurfaces(image, box(28, 24, 20, 16), [declared], undefined, { signal: { aborted: true, throwIfAborted() { throw cancelled } } })
      throw new Error('Expected cancellation')
    } catch (error) { expect(error).toBe(cancelled) }
  })

  it.each(['removal', 'protection', 'future', 'prior', 'transparent'] as const)('rejects a %s pixel anywhere in a structure reference before returning modified output', kind => {
    const image = fixture(), declared = surface(), repair = box(28, 24, 20, 16), bad = box(8, 29, 1, 1)
    const priorInference = new Uint8Array(image.width * image.height)
    if (kind === 'prior') priorInference[29 * image.width + 8] = 1
    if (kind === 'transparent') image.data[(29 * image.width + 8) * 4 + 3] = 0
    if (kind === 'removal') { const full = box(8, 24, 40, 16); repair.boundsPx = full.boundsPx; repair.width = full.width; repair.height = full.height; repair.data = full.data }
    const before = image.data.slice()
    expect(() => repairImageSurfaces(image, repair, [declared], kind === 'protection' ? bad : undefined, { priorInference, objectEvidence: kind === 'future' ? [bad] : undefined })).toThrow(/结构参考|可信原图/)
    expect(image.data).toEqual(before)
  })
})
