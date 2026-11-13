import type { ImagePixelMask, PixelBounds } from './pixels.js'
import type { ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { maskCoverage } from './repair-scope.js'

export interface RepairBoundaryEvidence {
  algorithm: 'repair-boundary-evidence-v1'
  counts: {
    boundaryPixels: number
    unmarkedOriginalPixels: number
    priorInferencePixels: number
    protectionPixels: number
    otherRemovalPixels: number
    excludedPixels: number
    outsideMaterialPixels: number
    outsideImagePixels: number
  }
  /** At most six 16px grid sites. Counts cover the entire actual boundary. */
  inferenceSites: Array<{ boundsPx: PixelBounds; pixels: number; producers: Array<{ step: number; pixels: number }> }>
  unlistedInferencePixels: number
  limitation: string
}

/** Pure mask/provenance observations. No RGB or alpha is accepted: an unmarked
 * neighbour is only a place to inspect, never proof of material or source truth.
 * Each four-neighbour pixel outside this surface's actual write is counted once. */
export function inspectImageRepairBoundaryEvidence(image: { width: number; height: number }, surface: ImagePixelMask, writable: ImagePixelMask,
  options: { priorInference?: Uint8Array; protectionMask?: ImagePixelMask; removalMask?: ImagePixelMask; excludedEvidenceMask?: ImagePixelMask; signal?: ImageNeighborhoodSignal } = {}): RepairBoundaryEvidence {
  const cancel = () => { options.signal?.throwIfAborted?.(); if (options.signal?.aborted) throw new Error('补区接头依据检查已取消。') }
  cancel()
  if (![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192 || image.width * image.height > 32_000_000) throw new Error('补区接头依据检查需要完整有界原图尺寸。')
  for (const mask of [surface, writable, options.protectionMask, options.removalMask, options.excludedEvidenceMask]) if (mask) {
    const b = mask.boundsPx
    if (![b.x, b.y, b.width, b.height].every(Number.isSafeInteger) || b.x < 0 || b.y < 0 || b.width < 1 || b.height < 1 || b.x + b.width > image.width || b.y + b.height > image.height
      || mask.width !== b.width || mask.height !== b.height || mask.width * mask.height > 1_000_000 || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height || mask.data.some(v => v !== 0 && v !== 255)) throw new Error('补区接头依据检查需要原图内完整二值蒙版。')
  }
  if (writable.width * writable.height > 250_000) throw new Error('补区接头依据检查的移除图框最多25万像素。')
  if (options.priorInference && (!(options.priorInference instanceof Uint8Array) || options.priorInference.length !== image.width * image.height)) throw new Error('补区接头前序来源须逐原图像素绑定。')
  const counts: RepairBoundaryEvidence['counts'] = { boundaryPixels: 0, unmarkedOriginalPixels: 0, priorInferencePixels: 0, protectionPixels: 0, otherRemovalPixels: 0, excludedPixels: 0, outsideMaterialPixels: 0, outsideImagePixels: 0 }
  const bounds = writable.boundsPx, pitch = bounds.width + 2, seen = new Uint8Array(pitch * (bounds.height + 2))
  const cells = new Map<number, { x0: number; y0: number; x1: number; y1: number; pixels: number; producers: Map<number, number> }>(), columns = Math.ceil(image.width / 16)
  const actualWrite = (x: number, y: number) => !!maskCoverage(writable, x, y) && !!maskCoverage(surface, x, y) && !maskCoverage(options.protectionMask, x, y)
  for (let y = 0; y < bounds.height; y++) {
    cancel()
    for (let x = 0; x < bounds.width; x++) {
      const sx = x + bounds.x, sy = y + bounds.y
      if (!actualWrite(sx, sy)) continue
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = sx + dx, ny = sy + dy, index = (y + dy + 1) * pitch + x + dx + 1
        if (actualWrite(nx, ny) || seen[index]) continue
        seen[index] = 1; counts.boundaryPixels++
        // Categories are disjoint in this order. A protected or still-removed
        // pixel never becomes an apparent original just because provenance=0.
        if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) { counts.outsideImagePixels++; continue }
        if (!maskCoverage(surface, nx, ny)) { counts.outsideMaterialPixels++; continue }
        if (maskCoverage(options.protectionMask, nx, ny)) { counts.protectionPixels++; continue }
        if (maskCoverage(options.removalMask, nx, ny)) { counts.otherRemovalPixels++; continue }
        const producer = options.priorInference?.[ny * image.width + nx]
        if (producer) {
          counts.priorInferencePixels++
          const key = Math.floor(ny / 16) * columns + Math.floor(nx / 16)
          let cell = cells.get(key)
          if (!cell) { cell = { x0: nx, y0: ny, x1: nx + 1, y1: ny + 1, pixels: 0, producers: new Map() }; cells.set(key, cell) }
          cell.x0 = Math.min(cell.x0, nx); cell.y0 = Math.min(cell.y0, ny); cell.x1 = Math.max(cell.x1, nx + 1); cell.y1 = Math.max(cell.y1, ny + 1); cell.pixels++
          cell.producers.set(producer, (cell.producers.get(producer) ?? 0) + 1)
          continue
        }
        if (maskCoverage(options.excludedEvidenceMask, nx, ny)) { counts.excludedPixels++; continue }
        counts.unmarkedOriginalPixels++
      }
    }
  }
  const inferenceSites = [...cells.values()].sort((a, b) => b.pixels - a.pixels || a.y0 - b.y0 || a.x0 - b.x0).slice(0, 6).map(cell => ({
    boundsPx: { x: cell.x0, y: cell.y0, width: cell.x1 - cell.x0, height: cell.y1 - cell.y0 }, pixels: cell.pixels,
    producers: [...cell.producers.entries()].sort(([a], [b]) => a - b).map(([step, pixels]) => ({ step, pixels })),
  }))
  cancel()
  return { algorithm: 'repair-boundary-evidence-v1', counts, inferenceSites, unlistedInferencePixels: counts.priorInferencePixels - inferenceSites.reduce((sum, site) => sum + site.pixels, 0),
    limitation: '只统计本次实际可写补区外的一圈邻界，按像素去重；先区分画框／材质之外、保护和本次其他移除，再列前序推断、取证排除及未标记原图。未标记不证明颜色、透明度或材质正确；不读颜色、不判定板头、不自动修改范围或重算。' }
}
