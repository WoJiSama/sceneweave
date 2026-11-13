import { describe, expect, it } from 'vitest'
import { repairGuidedImageSurface } from './guided-surface-repair.js'
import type { ImageSurfaceDetailPatch } from './guided-detail-patches.js'
import { imageSurfaceGuidanceSchema, repairImageSurfaces, validateImageRepairSurfaces, type ImageRepairSurface } from './surfaces.js'
import { encodeSelectionMask } from './selection-mask.js'
import type { ImagePixelMask, ImagePixels } from './pixels.js'
import { maskCoverage } from './repair-scope.js'

const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
const removal = box(42, 28, 30, 30), surfaceMask = box(0, 0, 96, 80), donor = { x: 4, y: 4, width: 14, height: 14 }
const patch: ImageSurfaceDetailPatch = { role: 'nails', reference: { x: 4, y: 30, width: 20, height: 20 }, target: { x: 44, y: 30 }, reason: '只补两处原图笔触，保留目标长缝；隐藏位置为人工推断。' }
function fixture(): ImagePixels {
  const image = { width: 96, height: 80, data: new Uint8ClampedArray(96 * 80 * 4) }
  for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) image.data.set([154 + x % 2, 125 + x % 2, 93 + x % 2, 255], (y * 96 + x) * 4)
  // Distinct 2D shapes, one with an absent corner. Their gaps must remain gaps.
  for (const [x, y] of [[9, 36], [10, 36], [9, 37], [18, 37], [18, 38]]) image.data.set([80, 63, 46, 255], (y * 96 + x) * 4)
  for (let x = 76; x < 92; x++) image.data.set([80, 63, 46, 255], (11 * 96 + x) * 4)
  return image
}
const options = { surfaceMask, pattern: 'soft' as const, orientation: 'soft' as const,
  guides: [{ points: [{ x: 42, y: 46 }, { x: 72, y: 46 }], reference: { x: 76, y: 8, width: 16, height: 7 }, axis: 'horizontal' as const, reason: '保留已有长缝。' }] }
const rgb = (im: ImagePixels, x: number, y: number) => [...im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)]
const surface = (): ImageRepairSurface => ({ id: 'wood', name: 'wood', kind: 'guided', mask: encodeSelectionMask(surfaceMask), donor,
  guided: { orientation: 'soft', guides: options.guides, detailPatches: [patch] } })

describe('finite original 2D ink assistance', () => {
  it('retains source shape, unpainted gaps and existing seams instead of replacing a rectangle or extruding a profile', () => {
    const image = fixture(), before = image.data.slice(), base = repairGuidedImageSurface(image, removal, donor, options)
    const out = repairGuidedImageSurface(image, removal, donor, { ...options, detailPatches: [patch] })
    expect(repairGuidedImageSurface(image, removal, donor, { ...options, detailPatches: [] })).toEqual(base)
    expect(rgb(out, 49, 36)[0]).toBeLessThan(rgb(base, 49, 36)[0] - 40)
    expect(rgb(out, 50, 37)).toEqual(rgb(base, 50, 37))
    expect(rgb(out, 55, 36)).toEqual(rgb(base, 55, 36))
    for (let x = 42; x < 72; x++) expect(rgb(out, x, 46)).toEqual(rgb(base, x, 46))
    let changed = 0
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const a = rgb(base, x, y), b = rgb(out, x, y)
      if (a.some((v, c) => v !== b[c])) { changed++; expect(maskCoverage(removal, x, y)).toBe(255) }
      for (let c = 0; c < 3; c++) expect(b[c]).toBeLessThanOrEqual(a[c])
      expect(b[3]).toBe(a[3])
    }
    expect(changed).toBe(5)
    expect(image.data).toEqual(before)
  })

  it('does not read forbidden source or target context RGB and clips writes at protection', () => {
    const image = fixture(), changed = fixture(), protectionMask = box(49, 36, 1, 1), excludedEvidenceMask = box(72, 30, 2, 24), priorInference = new Uint8Array(96 * 80)
    priorInference[26 * 96 + 46] = 1
    for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) if (maskCoverage(removal, x, y) || maskCoverage(protectionMask, x, y) || maskCoverage(excludedEvidenceMask, x, y) || priorInference[y * 96 + x]) {
      image.data.set([255, 0, 255, 255], (y * 96 + x) * 4); changed.data.set([0, 255, 0, 255], (y * 96 + x) * 4)
    }
    const extra = { ...options, protectionMask, excludedEvidenceMask, priorInference, detailPatches: [patch] }
    const a = repairGuidedImageSurface(image, removal, donor, extra), b = repairGuidedImageSurface(changed, removal, donor, extra)
    for (let y = 28; y < 58; y++) for (let x = 42; x < 72; x++) if (!maskCoverage(protectionMask, x, y)) expect(rgb(a, x, y)).toEqual(rgb(b, x, y))
    expect(rgb(a, 49, 36)).toEqual(rgb(image, 49, 36))
    const base = repairGuidedImageSurface(image, removal, donor, { ...extra, detailPatches: [] })
    expect(rgb(a, 58, 37)[0]).toBeLessThan(rgb(base, 58, 37)[0] - 40)
  })

  it('explicitly replaces generated ink with a source gap while retaining the separately inferred paper and fine grain', () => {
    const image = fixture(), before = image.data.slice(), base = repairGuidedImageSurface(image, removal, donor, options)
    const replacement: ImageSurfaceDetailPatch = { role: 'gap', mode: 'replace-ink', reference: donor, target: { x: 48, y: 40 }, reason: '在已确认小处留断口；仅替换本次生成墨迹，不复制参考底色。' }
    const out = repairGuidedImageSurface(image, removal, donor, { ...options, detailPatches: [replacement] })
    const paperOnly = repairGuidedImageSurface(image, removal, donor, { ...options, guides: [] })
    let removedInk = 0
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const inside = x >= 48 && x < 62 && y >= 40 && y < 54
      expect(rgb(out, x, y)).toEqual(rgb(inside ? paperOnly : base, x, y))
      if (inside && rgb(out, x, y)[0] > rgb(base, x, y)[0] + 20) removedInk++
    }
    expect(removedInk).toBeGreaterThan(10)
    expect(image.data).toEqual(before)
    expect(imageSurfaceGuidanceSchema.parse({ orientation: 'soft', guides: [], detailPatches: [replacement] }).detailPatches).toEqual([replacement])
    expect(() => imageSurfaceGuidanceSchema.parse({ orientation: 'soft', guides: [], detailPatches: [{ ...replacement, mode: undefined }] })).toThrow(/断口/)
  })

  it('replaces a conflicting generated seam with a 2D board end, clips protection, and never uses hidden target RGB', () => {
    const a = fixture(), b = fixture(), protectionMask = box(49, 36, 1, 1)
    // Source L differs from the generated horizontal line at target y46.
    for (let y = 36; y <= 44; y++) for (const im of [a, b]) im.data.set([80, 63, 46, 255], (y * 96 + 9) * 4)
    const replacement: ImageSurfaceDetailPatch = { ...patch, role: 'board-end', mode: 'replace-ink' }
    for (let y = 28; y < 58; y++) for (let x = 42; x < 72; x++) {
      a.data.set([255, 0, 255, 255], (y * 96 + x) * 4); b.data.set([0, 255, 0, 255], (y * 96 + x) * 4)
    }
    const extra = { ...options, protectionMask, detailPatches: [replacement] }, left = repairGuidedImageSurface(a, removal, donor, extra), right = repairGuidedImageSurface(b, removal, donor, extra)
    const noInk = repairGuidedImageSurface(a, removal, donor, { ...options, protectionMask, guides: [] })
    expect(rgb(left, 49, 36)).toEqual(rgb(a, 49, 36))
    expect(rgb(left, 49, 40)[0]).toBeLessThan(rgb(noInk, 49, 40)[0] - 30)
    expect(rgb(left, 55, 46)).toEqual(rgb(noInk, 55, 46))
    for (let y = 28; y < 58; y++) for (let x = 42; x < 72; x++) if (!maskCoverage(protectionMask, x, y)) expect(rgb(left, x, y)).toEqual(rgb(right, x, y))
    const declared = surface(); declared.guided!.detailPatches = [replacement]
    expect(() => repairImageSurfaces(a, removal, [declared], box(9, 40, 1, 1))).toThrow(/二维笔迹参考.*可信/)
  })

  it('checks complete original references against every current evidence exclusion, even outside this step', () => {
    const image = fixture(), declared = surface(), before = image.data.slice(), forbidden = box(9, 36, 1, 1)
    expect(() => repairImageSurfaces(image, removal, [declared], forbidden)).toThrow(/二维笔迹参考.*可信/)
    expect(() => repairImageSurfaces(image, removal, [declared], undefined, { objectEvidence: [forbidden] })).toThrow(/二维笔迹参考.*可信/)
    const priorInference = new Uint8Array(96 * 80); priorInference[36 * 96 + 9] = 1
    expect(() => repairImageSurfaces(image, removal, [declared], undefined, { priorInference })).toThrow(/二维笔迹参考.*可信/)
    expect(() => validateImageRepairSurfaces(image, [{ ...declared, excludedEvidenceMask: encodeSelectionMask(forbidden) }])).toThrow(/二维笔迹参考/)
    const moved = { ...declared, guided: { ...declared.guided!, detailPatches: [{ ...patch, target: { x: 74, y: 50 } }] } }
    expect(() => repairImageSurfaces(image, removal, [moved], forbidden)).toThrow(/二维笔迹参考.*可信/)
    expect(image.data).toEqual(before)
  })

  it('transitions generated ink at the permitted edge, keeps source-gap core and respects a protected hole without reading its RGB', () => {
    const a = fixture(), b = fixture(), protectionMask = box(51, 46, 1, 1)
    const replacement: ImageSurfaceDetailPatch = { role: 'gap', mode: 'replace-ink', blendPx: 3, reference: donor, target: { x: 48, y: 40 }, reason: '在不动底色细纹的前提下衔接原有生成墨迹；过渡不作原图取证。' }
    for (let y = 28; y < 58; y++) for (let x = 42; x < 72; x++) {
      a.data.set([255, 0, 255, 255], (y * 96 + x) * 4); b.data.set([0, 255, 0, 255], (y * 96 + x) * 4)
    }
    const extra = { ...options, protectionMask }, base = repairGuidedImageSurface(a, removal, donor, extra)
    const left = repairGuidedImageSurface(a, removal, donor, { ...extra, detailPatches: [replacement] }), right = repairGuidedImageSurface(b, removal, donor, { ...extra, detailPatches: [replacement] })
    const paperOnly = repairGuidedImageSurface(a, removal, donor, { ...extra, guides: [] })
    expect(rgb(left, 48, 46)).toEqual(rgb(base, 48, 46))
    expect(rgb(left, 61, 46)).toEqual(rgb(base, 61, 46))
    expect(rgb(left, 50, 46)).toEqual(rgb(base, 50, 46)) // immediately beside protection
    expect(rgb(left, 55, 46)).toEqual(rgb(paperOnly, 55, 46))
    expect(rgb(left, 59, 46)[0]).toBeGreaterThan(rgb(base, 59, 46)[0])
    expect(rgb(left, 59, 46)[0]).toBeLessThan(rgb(paperOnly, 59, 46)[0])
    expect(rgb(left, 51, 46)).toEqual(rgb(a, 51, 46))
    for (let y = 28; y < 58; y++) for (let x = 42; x < 72; x++) if (!maskCoverage(protectionMask, x, y)) expect(rgb(left, x, y)).toEqual(rgb(right, x, y))
    const raw = { orientation: 'soft', guides: [], detailPatches: [replacement] }
    expect(imageSurfaceGuidanceSchema.parse(raw).detailPatches).toEqual([replacement])
    for (const invalid of [{ ...replacement, mode: undefined }, { ...replacement, blendPx: 5 }, { ...replacement, reference: { ...donor, width: 8 } }]) {
      expect(() => imageSurfaceGuidanceSchema.parse({ ...raw, detailPatches: [invalid] })).toThrow()
      expect(() => repairGuidedImageSurface(a, removal, donor, { ...extra, detailPatches: [invalid] as ImageSurfaceDetailPatch[] })).toThrow()
    }
  })

  it('rejects flat sources, overlapping or out-of-material targets, unknown operations and budgets without changing the input', () => {
    const image = fixture(), before = image.data.slice()
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, detailPatches: [{ ...patch, reference: donor }] })).toThrow(/没有足够/)
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, detailPatches: [patch, patch] })).toThrow(/不能重叠/)
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, guides: [], surfaceMask: box(0, 0, 73, 79), detailPatches: [{ ...patch, target: { x: 70, y: 30 } }] })).toThrow(/底材范围/)
    const parsed = imageSurfaceGuidanceSchema.parse(surface().guided)
    expect(parsed.detailPatches).toEqual([patch])
    expect(() => imageSurfaceGuidanceSchema.parse({ ...parsed, detailPatches: Array(17).fill(patch) })).toThrow()
    expect(() => imageSurfaceGuidanceSchema.parse({ ...parsed, guides: Array(32).fill(options.guides[0]) })).toThrow(/合计/)
    expect(() => imageSurfaceGuidanceSchema.parse({ ...parsed, detailPatches: [{ ...patch, mode: 'clear' }] })).toThrow()
    expect(() => validateImageRepairSurfaces(image, [{ ...surface(), guided: { ...parsed, detailPatches: [patch, patch] } }])).toThrow(/不能重叠/)
    expect(image.data).toEqual(before)
  })
})
