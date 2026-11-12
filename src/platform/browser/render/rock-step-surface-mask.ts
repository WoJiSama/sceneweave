import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'

export const ROCK_STEP_SIDE_MASK_LIMITS = Object.freeze({ sourcePixels: 16_777_216, longEdge: 512, samples: 256 })
export interface RockStepSideMaskInput {
  bounds: BoundsMm
  width: number
  height: number
  centerlineMm: readonly PointMm[]
  widthMm: number
}
export interface RockStepSideMask { width: number; height: number; data: Uint8ClampedArray }

/** Paint-only side feather for the profile-4 base texture. The caller applies
 * it before painting stones and retains the original exact physical-band clip.
 * Nearest saved segment distance is continuous around bends and switchbacks;
 * neither endpoint fades nor a new world footprint are introduced here. */
export function planRockStepSideMask(input: RockStepSideMaskInput): RockStepSideMask {
  const { bounds, width, height, centerlineMm: points, widthMm } = input
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width * height > ROCK_STEP_SIDE_MASK_LIMITS.sourcePixels
    || !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height, widthMm].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || widthMm <= 0
    || !Array.isArray(points) || points.length < 2 || points.length > ROCK_STEP_SIDE_MASK_LIMITS.samples
    || points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('自然岩阶侧边蒙版需要有限范围、完整路线和16M以内局部图像。')
  }
  const scale = Math.min(1, ROCK_STEP_SIDE_MASK_LIMITS.longEdge / Math.max(width, height))
  const maskWidth = Math.max(1, Math.ceil(width * scale)), maskHeight = Math.max(1, Math.ceil(height * scale))
  const data = new Uint8ClampedArray(maskWidth * maskHeight * 4)
  const stepX = bounds.width / maskWidth, stepY = bounds.height / maskHeight, half = widthMm / 2, opaque = half * .62
  const alphaAtDistance = (distance: number): number => {
    const t = Math.max(0, Math.min(1, (half - distance) / (half - opaque)))
    return Math.round(t * t * (3 - 2 * t) * 255)
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy
    if (!(lengthSquared > 0) || !Number.isFinite(lengthSquared)) throw new Error('自然岩阶侧边蒙版不接受退化路线段。')
    const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - half - bounds.x) / stepX))
    const maxX = Math.min(maskWidth - 1, Math.ceil((Math.max(a.x, b.x) + half - bounds.x) / stepX))
    const minY = Math.max(0, Math.floor((Math.min(a.y, b.y) - half - bounds.y) / stepY))
    const maxY = Math.min(maskHeight - 1, Math.ceil((Math.max(a.y, b.y) + half - bounds.y) / stepY))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const offset = (y * maskWidth + x) * 4
      if (data[offset + 3] === 255) continue
      const px = bounds.x + (x + .5) * stepX - a.x, py = bounds.y + (y + .5) * stepY - a.y
      const along = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared))
      const alpha = alphaAtDistance(Math.hypot(px - along * dx, py - along * dy))
      if (alpha > data[offset + 3]) { data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255; data[offset + 3] = alpha }
    }
  }
  return { width: maskWidth, height: maskHeight, data }
}
