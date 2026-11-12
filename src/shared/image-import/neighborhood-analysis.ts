import type { ImagePixels, PixelBounds } from './pixels.js'
import { replayImageLayers, type ImageReplayLayer } from './layer-replay.js'
import { decodeSelectionMask } from './selection-mask.js'
import { maskCoverage } from './repair-scope.js'
import type { ImageRepairSurface } from './surfaces.js'
import { analyzeImageRepairNeighborhood, type NeighborhoodRepairReport } from './neighborhood-repair.js'
import { imageNeighborhoodExcludedEvidence, imageNeighborhoodObjectEvidence, type ImageNeighborhoodSignal } from './neighborhood-evidence.js'

/** Read-only analysis of the actual input and output at one replay step. Earlier
 * repairs remain inference; later object silhouettes remain unavailable evidence. */
export function analyzeImageImportRepair(source: ImagePixels, layers: readonly ImageReplayLayer[], surfaces: readonly ImageRepairSurface[], target: string, signal?: ImageNeighborhoodSignal): {
  target: string; surfaces: Array<{ surfaceId: string; surfaceName: string; report: NeighborhoodRepairReport }>;
  unassignedBoundsPx?: PixelBounds; summary: string[]
} {
  signal?.throwIfAborted()
  const index = layers.findIndex(layer => layer.id === target)
  if (index < 0) throw new Error('补底分析目标不存在，请先拆出物件。')
  const context = { evidenceLayers: layers, signal }
  const before = replayImageLayers(source, layers.slice(0, index), surfaces, context)
  const after = replayImageLayers(source, layers.slice(0, index + 1), surfaces, context)
  const layer = layers[index], repair = after.layers[index].extracted.repairMask
  const protection = layer.protectionMask && decodeSelectionMask(layer.protectionMask, source)
  const objects = imageNeighborhoodObjectEvidence(source, layers.slice(index + 1))
  const covered = new Uint8Array(repair.data.length), results: Array<{ surfaceId: string; surfaceName: string; report: NeighborhoodRepairReport }> = []
  for (const id of layer.repairSurfaceIds ?? []) {
    signal?.throwIfAborted()
    const surface = surfaces.find(candidate => candidate.id === id)
    if (!surface) throw new Error('物件引用了不存在的补底表面。')
    const mask = decodeSelectionMask(surface.mask, source), data = new Uint8Array(repair.data.length)
    let count = 0
    for (let y = 0; y < repair.height; y++) for (let x = 0; x < repair.width; x++) {
      const at = y * repair.width + x
      if (repair.data[at] && !covered[at] && maskCoverage(mask, x + repair.boundsPx.x, y + repair.boundsPx.y)) { data[at] = 255; covered[at] = 1; count++ }
    }
    if (!count) continue
    const excluded = surface.excludedEvidenceMask && decodeSelectionMask(surface.excludedEvidenceMask, source)
    const report = analyzeImageRepairNeighborhood(before.remaining, after.remaining,
      { ...repair, data }, surface.donor, { surfaceMask: mask, protectionMask: protection || undefined,
        excludedEvidenceMask: imageNeighborhoodExcludedEvidence(mask.boundsPx, [repair, excluded, ...objects]),
        priorInference: before.provenance, pattern: surface.kind === 'planks' || surface.kind === 'neighbors-planks' || surface.kind === 'guided' && surface.guided?.orientation !== 'soft' ? 'planks' : 'soft', signal })
    if (surface.kind === 'guided') {
      report.summary = [`此表面显式使用结构辅助（${surface.guided!.orientation}，${surface.guided!.guides.length}条引导）；它会改变隐藏区域的推断结构。`, ...report.summary]
      report.limitations = [...report.limitations, '结构辅助是人工指定的推断路径；邻域比较分数不能确认引导正确，也不能授予视觉通过。']
    }
    results.push({ surfaceId: id, surfaceName: surface.name, report })
  }
  let x0 = source.width, y0 = source.height, x1 = 0, y1 = 0
  for (let y = 0; y < repair.height; y++) for (let x = 0; x < repair.width; x++) if (repair.data[y * repair.width + x] && !covered[y * repair.width + x]) {
    const sx = x + repair.boundsPx.x, sy = y + repair.boundsPx.y
    x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx + 1); y1 = Math.max(y1, sy + 1)
  }
  const unassignedBoundsPx = x1 > x0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined
  signal?.throwIfAborted()
  return { target, surfaces: results, ...(unassignedBoundsPx ? { unassignedBoundsPx } : {}), summary: [
    ...(unassignedBoundsPx ? ['高亮移除区尚未声明下层材质；请先圈同材质范围及干净取样，再分析附近来源。'] : []),
    ...results.flatMap(result => result.report.summary.map(message => `${result.surfaceName}：${message}`)),
    '候选分数用于比较已声明同组来源，不是视觉通过率；遮挡内真实结构仍需人工复核。',
    '已排除当前全部移除区、保护区、声明取证排除、前序推断和后续未移走物件；地面类item可作为显式选择的下层材质，未标出的家具与阴影仍须补排除范围。',
  ] }
}
