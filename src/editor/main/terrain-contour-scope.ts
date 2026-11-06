import type { BoundsMm, PointMm } from '../../shared/model/scene'
import { sampleVisualBoundary } from '../../shared/visual/geometry'
import type { VisualBoundary, VisualEdgeLook } from '../../shared/visual/types'

type ContourEdgeLook = Pick<VisualEdgeLook, 'boundaryId' | 'enabled' | 'widthMm' | 'repeatMm'>

function assertBounds(bounds: BoundsMm, label: string): void {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(value => Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000_000)) {
    throw new Error(`${label}的坐标、宽和高须为范围内整数毫米（绝对值不超过 1000000000）。`)
  }
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error(`${label}的宽和高须大于零。`)
  if (![bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isSafeInteger)) throw new Error(`${label}的边界超出安全整数范围。`)
}

/** Suggest a conservative scope only; the preview still validates the complete write/dependency closure. */
export function expandTerrainContourScope(
  scopeMm: BoundsMm,
  original: VisualBoundary | undefined,
  draft: VisualBoundary,
  edgeLooks: readonly ContourEdgeLook[],
): BoundsMm {
  assertBounds(scopeMm, '当前可写范围')
  if (!original || original.id !== draft.id) throw new Error('找不到当前曲线的原始轮廓，请重新选择曲线。')
  let margin = 0
  for (const look of edgeLooks) {
    if (!look.enabled || look.boundaryId !== draft.id) continue
    if (![look.widthMm, look.repeatMm].every(value => Number.isSafeInteger(value) && value > 0)
      || !Number.isSafeInteger(look.widthMm * 3 + look.repeatMm)) {
      throw new Error('曲线边带的宽度或重复间距不是有效整数毫米，请检查边带设置。')
    }
    margin = Math.max(margin, look.widthMm * 3 + look.repeatMm)
  }
  let left = scopeMm.x, top = scopeMm.y, right = scopeMm.x + scopeMm.width, bottom = scopeMm.y + scopeMm.height
  const include = (point: PointMm, padding = 0) => {
    left = Math.min(left, Math.floor(point.x - padding))
    top = Math.min(top, Math.floor(point.y - padding))
    right = Math.max(right, Math.ceil(point.x + padding))
    bottom = Math.max(bottom, Math.ceil(point.y + padding))
  }
  for (const boundary of [original, draft]) {
    for (const point of sampleVisualBoundary(boundary).points) include(point, margin)
    for (const segment of boundary.segments) {
      for (const point of [segment.start, segment.control1, segment.control2, segment.end]) include(point)
    }
  }
  const result = { x: left, y: top, width: right - left, height: bottom - top }
  assertBounds(result, '扩大后的可写范围')
  return result
}
