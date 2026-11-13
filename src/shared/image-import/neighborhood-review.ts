import type { ImagePixels, PixelBounds } from './pixels.js'
import type { analyzeImageImportRepair } from './neighborhood-analysis.js'

type Analysis = ReturnType<typeof analyzeImageImportRepair>
/** Two same-scale overviews, then up to six same-scale reference/current/candidate
 * rows. Labels and exact source-grid rectangles travel in reviewLayout. */
export function imageNeighborhoodReviewSheet(source: ImagePixels, repaired: ImagePixels, analysis: Analysis) {
  const scale = Math.min(1, 640 / Math.max(source.width, source.height))
  const w = Math.max(1, Math.ceil(source.width * scale)), h = Math.max(1, Math.ceil(source.height * scale)), gap = 8
  const sites = analysis.surfaces.flatMap(surface => surface.report.sites.map(site => ({ surfaceId: surface.surfaceId, ...site }))).slice(0, 6)
  const additionalToneFindings = analysis.surfaces.flatMap(surface => (surface.additionalToneFindings ?? []).map(finding => ({ surfaceId: surface.surfaceId, id: finding.id, boundsPx: finding.boundsPx })))
  const structureReferences = analysis.surfaces.flatMap(surface => (surface.structureReferences ?? []).map(reference => ({ surfaceId: surface.surfaceId, ...reference })))
  const structureEndpoints = analysis.surfaces.flatMap(surface => (surface.structureEndpoints ?? []).map(endpoint => ({ surfaceId: surface.surfaceId, ...endpoint })))
  const boundaryEvidence = analysis.surfaces.flatMap(surface => surface.boundaryEvidence ? [{ surfaceId: surface.surfaceId, ...surface.boundaryEvidence }] : [])
  const structureMotifs = analysis.surfaces.flatMap(surface => surface.structureMotifs ? [{ surfaceId: surface.surfaceId, ...surface.structureMotifs }] : [])
  const rowHeight = 92, width = Math.max(w * 2 + gap * 3, 600), height = h + gap * 2 + sites.length * rowHeight
  const data = new Uint8ClampedArray(width * height * 4)
  for (let at = 0; at < data.length; at += 4) data.set([238, 240, 244, 255], at)
  const blit = (image: ImagePixels, bounds: PixelBounds, left: number, top: number, ratio: number) => {
    for (let y = 0; y < Math.ceil(bounds.height * ratio); y++) for (let x = 0; x < Math.ceil(bounds.width * ratio); x++) {
      const sx = bounds.x + Math.floor(x / ratio), sy = bounds.y + Math.floor(y / ratio)
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height || left + x >= width || top + y >= height) continue
      const at = (sy * image.width + sx) * 4
      data.set(image.data.subarray(at, at + 4), ((top + y) * width + left + x) * 4)
    }
  }
  const full = { x: 0, y: 0, width: source.width, height: source.height }
  blit(source, full, gap, gap, scale); blit(repaired, full, w + gap * 2, gap, scale)
  const outline = (bounds: PixelBounds, left: number, color: number[]) => {
    const x0 = left + Math.floor(bounds.x * scale), y0 = gap + Math.floor(bounds.y * scale)
    const x1 = Math.min(width - 1, left + Math.ceil((bounds.x + bounds.width) * scale)), y1 = Math.min(height - 1, gap + Math.ceil((bounds.y + bounds.height) * scale))
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) data.set(color, (y * width + x) * 4)
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) data.set(color, (y * width + x) * 4)
  }
  for (const surface of analysis.surfaces) {
    outline(surface.report.boundsPx, w + gap * 2, [20, 100, 235, 255])
    for (const conflict of surface.report.conflicts) outline(conflict.boundsPx, w + gap * 2, [230, 65, 35, 255])
  }
  for (const finding of additionalToneFindings) outline(finding.boundsPx, gap, [220, 145, 20, 255])
  for (const reference of structureReferences) if (reference.status === 'needs-judgment') outline(reference.referenceBoundsPx, gap, [170, 70, 205, 255])
  for (const endpoint of structureEndpoints) outline(endpoint.boundsPx, w + gap * 2, [205, 70, 165, 255])
  for (const boundary of boundaryEvidence) for (const site of boundary.inferenceSites) outline(site.boundsPx, w + gap * 2, [20, 155, 175, 255])
  for (const motifs of structureMotifs) for (const site of motifs.sites) outline(site.boundsPx, w + gap * 2, [215, 125, 5, 255])
  const rows = sites.map((site, index) => {
    const top = h + gap * 2 + index * rowHeight
    const bounds = site.boundsPx, candidates = site.candidates.slice(0, 2)
    const sourceBounds = { x: bounds.x - 2, y: bounds.y - 2, width: bounds.width + 4, height: bounds.height + 4 }
    blit(source, sourceBounds, gap, top, 4); blit(repaired, sourceBounds, 150, top, 4)
    candidates.forEach((candidate, i) => { blit(source, candidate.sourceBoundsPx, 300 + i * 150, top, 4); outline(candidate.sourceBoundsPx, gap, [15, 160, 85, 255]) })
    return { row: index + 1, surfaceId: site.surfaceId, boundsPx: bounds, sourceBoundsPx: sourceBounds, candidates: candidates.map(candidate => candidate.sourceBoundsPx) }
  })
  return { pixels: { width, height, data }, layout: { overview: [`原图；绿框为可信候选来源${additionalToneFindings.length ? '，黄框为补充底色依据' : ''}${structureReferences.some(r => r.status === 'needs-judgment') ? '，紫框为结构参考疑点' : ''}`, `当前实际补底；蓝框为移除范围、红框为冲突${structureEndpoints.length ? '，粉框为结构端点' : ''}${boundaryEvidence.some(b => b.inferenceSites.length) ? '，青框为前序补底接头' : ''}${structureMotifs.some(m => m.sites.length) ? '，橙框为角色待判断笔迹' : ''}`],
    overviewScale: scale, detailScale: 4, detailColumns: ['原图目标（含遮挡，仅供查看）', '当前补底', '候选1（只读）', '候选2（只读）'], rows,
    ...(boundaryEvidence.length ? { boundaryEvidence, boundaryMarkMeaning: '青框为前序补底接头，不是原图取证' } : {}),
    ...(structureMotifs.length ? { structureMotifs, motifMarkMeaning: '橙框为原图锚点不足的补图笔迹，不代表笔迹错误或隐藏角色已识别' } : {}),
    ...(additionalToneFindings.length ? { additionalToneFindings } : {}), ...(structureReferences.length ? { structureReferences } : {}), ...(structureEndpoints.length ? { structureEndpoints } : {}), limitedToFirstSites: 6, candidateIsSuggestion: true } }
}
