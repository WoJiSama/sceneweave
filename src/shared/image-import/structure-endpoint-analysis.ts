import type { ImagePixelMask, PixelBounds } from './pixels.js'
import type { ImageSurfaceStructureGuide } from './guided-surface-repair.js'
import type { ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { maskCoverage } from './repair-scope.js'

export interface StructureEndpointObservation {
  algorithm: 'structure-endpoint-observations-v1'
  guideIndex: number
  endpoint: 'start' | 'end'
  positionPx: { x: number; y: number }
  boundsPx: PixelBounds
  /** Rounded ray distance through this step's actual writable mask, not RGB evidence. */
  writableContinuationPx: number
  scanLimitPx: 32
  /** Distance to the last material sample if its edge was reached within the scan. */
  materialGapPx?: number
  reason: string
  instruction: string
}

/** Geometry-only, bounded observations. A path ending inside a hole can be an
 * intentional board head. Never extends a line or reads hidden source colours. */
export function inspectImageStructureEndpoints(guides: readonly ImageSurfaceStructureGuide[], surface: ImagePixelMask, writable: ImagePixelMask,
  image: { width: number; height: number }, signal?: ImageNeighborhoodSignal): StructureEndpointObservation[] {
  const cancel = () => { signal?.throwIfAborted?.(); if (signal?.aborted) throw new Error('结构端点检查已取消。') }
  cancel()
  if (![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192 || guides.length > 32) throw new Error('结构端点检查需要有界原图与最多32条引导。')
  for (const mask of [surface, writable]) {
    const b = mask.boundsPx
    if (![b.x, b.y, b.width, b.height].every(Number.isSafeInteger) || b.x < 0 || b.y < 0 || b.width < 1 || b.height < 1 || b.x + b.width > image.width || b.y + b.height > image.height
      || mask.width !== b.width || mask.height !== b.height || mask.width * mask.height > 1_000_000 || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height) throw new Error('结构端点检查需要原图内完整有界蒙版。')
  }
  const observations: StructureEndpointObservation[] = []
  for (const [guideIndex, guide] of guides.entries()) {
    cancel()
    if (guide.points.length < 2 || guide.points.length > 16 || guide.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height)) throw new Error('结构端点检查需要2至16个有效原图点。')
    for (const endpoint of ['start', 'end'] as const) {
      const position = guide.points[endpoint === 'start' ? 0 : guide.points.length - 1]
      // Repeated terminal points have no direction; find the first nonzero tangent.
      const adjacent = (endpoint === 'start' ? guide.points.slice(1) : guide.points.slice(0, -1).reverse()).find(p => Math.hypot(p.x - position.x, p.y - position.y) > .001)
      if (!adjacent) continue
      const px = Math.round(position.x), py = Math.round(position.y)
      if (!maskCoverage(surface, px, py) || !maskCoverage(writable, px, py)) continue
      const distance = Math.hypot(position.x - adjacent.x, position.y - adjacent.y), dx = (position.x - adjacent.x) / distance, dy = (position.y - adjacent.y) / distance
      let continuation = 0, materialGap: number | undefined, endedWritable = false
      for (let step = 1; step <= 32; step++) {
        cancel()
        const x = Math.round(position.x + dx * step), y = Math.round(position.y + dy * step)
        if (!maskCoverage(surface, x, y)) { materialGap = step - 1; break }
        if (!maskCoverage(writable, x, y)) endedWritable = true
        if (!endedWritable) continuation = step
      }
      if (continuation < 3) continue
      const x = Math.max(0, px - 4), y = Math.max(0, py - 4)
      observations.push({ algorithm: 'structure-endpoint-observations-v1', guideIndex, endpoint, positionPx: { ...position },
        boundsPx: { x, y, width: Math.min(image.width, px + 5) - x, height: Math.min(image.height, py + 5) - y }, writableContinuationPx: continuation, scanLimitPx: 32,
        ...(materialGap !== undefined ? { materialGapPx: materialGap } : {}), reason: guide.reason,
        instruction: `路径在本次可写补区内停止，沿末段方向仍有${continuation === 32 ? '至少' : ''}${continuation}px连续可写底材${materialGap !== undefined ? `；距声明底材边缘约${materialGap}px` : '；32px内尚未到声明底材边缘'}。请对照可见线端，判断这里是板头、应接到边界，还是需短距收尾；隐藏走向仍属推断，不自动延长，也不扩大移除范围。`,
      })
    }
  }
  cancel()
  return observations
}
