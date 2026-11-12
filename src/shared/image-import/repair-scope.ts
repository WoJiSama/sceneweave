import type { ImagePixelMask, ImagePixels } from './pixels.js'
import { decodeSelectionMask, type ImageSelectionMask } from './selection-mask.js'

export function maskCoverage(mask: ImagePixelMask | undefined, x: number, y: number): number {
  if (!mask) return 0
  const mx = x - mask.boundsPx.x, my = y - mask.boundsPx.y
  return mx >= 0 && my >= 0 && mx < mask.width && my < mask.height ? mask.data[my * mask.width + mx] : 0
}

/** Explicit scopes are binary permissions. They never change the extracted object. */
export function imageRepairScope(image: ImagePixels, selection: ImagePixelMask, fallback: ImagePixelMask,
  removal?: ImageSelectionMask, protection?: ImageSelectionMask): { repairMask: ImagePixelMask; protectionMask?: ImagePixelMask } {
  const requested = removal ? decodeSelectionMask(removal, image) : fallback
  const protectedMask = protection ? decodeSelectionMask(protection, image) : undefined
  if (removal) {
    const box = selection.boundsPx
    for (let y = 0; y < requested.height; y++) for (let x = 0; x < requested.width; x++) {
      if (!requested.data[y * requested.width + x]) continue
      const sx = x + requested.boundsPx.x, sy = y + requested.boundsPx.y
      if (sx < box.x - 32 || sy < box.y - 32 || sx >= box.x + box.width + 32 || sy >= box.y + box.height + 32) {
        throw new Error('独立移除范围超出物件图框32像素，请拆分处理；不能豁免任意原画。')
      }
    }
  }
  for (const mask of [removal ? requested : undefined, protectedMask]) {
    if (mask?.data.some(value => value !== 0 && value !== 255)) throw new Error('独立移除和保护范围必须使用0或255的二值覆盖。')
  }
  for (let y = 0; y < selection.height; y++) for (let x = 0; x < selection.width; x++) {
    if (!selection.data[y * selection.width + x]) continue
    const sx = selection.boundsPx.x + x, sy = selection.boundsPx.y + y
    if (!maskCoverage(requested, sx, sy)) throw new Error('移除范围必须包含全部物件选区，避免留下原物件。')
    if (maskCoverage(protectedMask, sx, sy)) throw new Error('保护范围与物件选区冲突，请先修正选区或保护范围。')
  }
  const data = requested.data.slice()
  for (let y = 0; y < requested.height; y++) for (let x = 0; x < requested.width; x++) {
    if (maskCoverage(protectedMask, x + requested.boundsPx.x, y + requested.boundsPx.y)) data[y * requested.width + x] = 0
  }
  return { repairMask: { ...requested, data }, ...(protectedMask ? { protectionMask: protectedMask } : {}) }
}
