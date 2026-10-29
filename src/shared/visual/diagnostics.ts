import { visualBase } from './base.js'
import type { Issue, PointMm, SceneDocument, Editable } from '../model/scene.js'
import { sampleVisualBoundary, assertSimpleVisualPolyline, terrainBoundaryChain } from './geometry.js'
import { VISUAL_LIMITS, type VisualBoundary, type VisualEntity } from './types.js'
import { getLegacyVisual, legacyTerrainView } from '../terrain-generation/composition-contracts.js'

export const VISUAL_ENTITY_COLLECTIONS = ['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const
export const VISUAL_FILTER_TARGET_COLLECTIONS = ['rooms', 'terrainAreas', 'walls', 'paths', 'props', 'regions', 'terrainConnections', 'prefabInstances', 'scatterGroups'] as const
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
export function visualBindingEntityIds(boundary: VisualBoundary): string[] {
  return boundary.binding.kind === 'terrain' ? boundary.binding.sides.map(side => side.areaId) : boundary.binding.kind === 'path' ? [boundary.binding.pathId] : []
}
/** Strict graph/geometry consistency, on independently parsed JSON. It never repairs derived geometry. */
export function validateVisualSystem(scene: SceneDocument): Issue[] {
  const errors: Issue[] = []
  const add = (code: string, message: string, entityId?: string) => errors.push({ code, message, ...(entityId ? { entityId } : {}) })
  if (scene.schemaVersion === 1) { if (scene.visual !== undefined) add('VISUAL_VERSION', '原生v1不能携带visual字段；请显式升级。'); return errors }
  const visual = visualBase(scene)
  if (!visual || !scene.visual) { add('VISUAL_VERSION', '视觉工程必须携带完整视觉系统。'); return errors }
  if (scene.schemaVersion === 2 && scene.visual.version !== 1 || scene.schemaVersion === 3 && scene.visual.version !== 2 || scene.schemaVersion === 4 && scene.visual.version !== 3) {
    add('VISUAL_VERSION', '视觉系统版本与场景版本不一致，不能降级读取。'); return errors
  }
  const ids = new Set<string>([scene.sceneId])
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (!Array.isArray(value)) { const record = value as Record<string, unknown>; if (typeof record.id === 'string') ids.add(record.id); if (typeof record.segmentId === 'string') ids.add(record.segmentId) }
    for (const item of Object.values(value)) visit(item)
  }
  const { visual: _visual, ...rest } = legacyTerrainView(scene); visit(rest)
  // visual3 keeps visual2/materializedEdges inside its base; those records share the global identity space.
  visit(getLegacyVisual(scene)?.materializedEdges ?? {})
  for (const collection of VISUAL_ENTITY_COLLECTIONS) for (const [key, item] of Object.entries(visual[collection])) {
    if (key !== item.id || ids.has(item.id)) add('VISUAL_ID', '视觉实体ID须等于记录键且全局唯一。', item.id)
    ids.add(item.id)
    const floor = own(scene.floors, item.floorId), layer = own(scene.userLayers, item.layerId)
    if (!floor || !layer || layer.floorId !== item.floorId) add('VISUAL_LAYER', '视觉实体须引用同Floor现存用户图层。', item.id)
  }
  const inFloor = (item: VisualEntity, p: PointMm) => {
    const b = scene.floors[item.floorId]?.boundsMm
    if (!b || p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height) add('VISUAL_BOUNDS', '视觉控制点或区域必须位于所在Floor边界内。', item.id)
  }
  const region = (item: VisualEntity, points: PointMm[]) => {
    try { assertSimpleVisualPolyline(points, true) } catch (error) { add('VISUAL_REGION', error instanceof Error ? error.message : String(error), item.id) }
    points.forEach(p => inFloor(item, p))
  }
  let totalSamples = 0, totalSegments = 0, totalDecorations = 0
  const ownedTerrainSegments = new Set<string>(), ownedPaths = new Set<string>()
  for (const boundary of Object.values(visual.boundaries)) {
    try {
      totalSegments += boundary.segments.length
      for (const segment of boundary.segments) {
        if (ids.has(segment.id)) throw new Error('曲线控制段ID须与所有其他身份不同。')
        ids.add(segment.id)
        for (const p of [segment.start, segment.control1, segment.control2, segment.end]) inFloor(boundary, p)
      }
      const sampled = sampleVisualBoundary(boundary); totalSamples += sampled.points.length
      if (boundary.binding.kind === 'terrain') {
        const sides = boundary.binding.sides
        if (boundary.closed && sides.length !== 1) throw new Error('闭合地形曲线首版只绑定单个完整轮廓。')
        if (sides.length === 2 && (sides[0].areaId === sides[1].areaId || sides[0].reverse === sides[1].reverse)) throw new Error('共享曲线两侧须为不同地形且方向相反。')
        for (const side of sides) {
          const area = own(scene.terrainAreas, side.areaId)
          if (!area || area.floorId !== boundary.floorId) throw new Error('曲线地形绑定不存在或跨Floor。')
          if (boundary.visibility === 'public' && area.visibility !== 'public') throw new Error('公开曲线不能引用私密地形。')
          const chain = terrainBoundaryChain(area, side, boundary.closed), expected = side.reverse ? [...sampled.points].reverse() : sampled.points
          if (boundary.closed && side.reverse) { const first = expected.pop()!; expected.unshift(first) }
          if (chain.length !== expected.length || chain.some((p, i) => !same(p.positionMm, expected[i]))) throw new Error('曲线与持久地形采样不一致；只能编辑控制点或显式解除绑定。')
          for (const p of chain.slice(0, boundary.closed ? undefined : -1)) {
            const key = `${area.id}\0${p.segmentId}`
            if (ownedTerrainSegments.has(key)) throw new Error('同一地形边段只能由一条曲线控制。')
            ownedTerrainSegments.add(key)
          }
        }
      } else if (boundary.binding.kind === 'path') {
        const path = own(scene.paths, boundary.binding.pathId)
        if (!path || path.floorId !== boundary.floorId || boundary.closed) throw new Error('道路曲线须绑定同Floor现存开放道路。')
        if (boundary.visibility === 'public' && path.visibility !== 'public') throw new Error('公开曲线不能引用私密道路。')
        if (ownedPaths.has(path.id)) throw new Error('每条道路只能由一条曲线控制。')
        ownedPaths.add(path.id)
        if (sampled.points.length > 256 || path.centerlineMm.length !== sampled.points.length || path.centerlineMm.some((p, i) => !same(p, sampled.points[i]))) throw new Error('道路中心线与曲线采样不一致或超过256点。')
      }
    } catch (error) { add('VISUAL_BOUNDARY', error instanceof Error ? error.message : String(error), boundary.id) }
  }
  if (totalSamples > VISUAL_LIMITS.totalSamples || totalSegments > VISUAL_LIMITS.totalCurveSegments) add('VISUAL_BUDGET', '全图曲线超过4096采样点或256条控制段预算。')
  for (const edge of Object.values(visual.edgeLooks)) {
    const boundary = own(visual.boundaries, edge.boundaryId)
    if (!boundary || boundary.floorId !== edge.floorId || edge.visibility === 'public' && boundary.visibility !== 'public') { add('VISUAL_EDGE', '边缘外观须引用同Floor有效曲线，且不能公开私密曲线。', edge.id); continue }
    try {
      const sampled = sampleVisualBoundary(boundary), repeats = Math.ceil(sampled.lengthMm / edge.repeatMm)
      totalDecorations += repeats
      if (repeats > VISUAL_LIMITS.decorationsPerEdge) add('VISUAL_BUDGET', '单条边缘外观重复数超过1024，请增大间距。', edge.id)
      // Prevent unbounded offset loops and hairpin bands. Hard corners remain renderer-owned bevels.
      if (edge.widthMm > sampled.lengthMm / 2) add('VISUAL_EDGE', '边带宽度超过曲线长度的一半。', edge.id)
    } catch { /* Boundary diagnostics already report the cause. */ }
  }
  if (totalDecorations > 8192) add('VISUAL_BUDGET', '全图边缘装饰重复数超过8192。')
  for (const light of Object.values(visual.lights)) inFloor(light, light.positionMm)
  for (const fog of Object.values(visual.fogs)) {
    region(fog, fog.boundaryMm)
    const xs = fog.boundaryMm.map(p => p.x), ys = fog.boundaryMm.map(p => p.y)
    const cells = (Math.ceil(Math.max(...xs) / fog.scaleMm) - Math.floor(Math.min(...xs) / fog.scaleMm) + 7)
      * (Math.ceil(Math.max(...ys) / fog.scaleMm) - Math.floor(Math.min(...ys) / fog.scaleMm) + 7)
    if (cells > 16_384) add('VISUAL_BUDGET', '单个薄雾区域超过16384纹理单元，请增大scaleMm。', fog.id)
  }
  for (const filter of Object.values(visual.filters)) {
    if (filter.target.kind === 'region') region(filter, filter.target.boundaryMm)
    else if (filter.target.kind === 'layer') {
      const layer = own(scene.userLayers, filter.target.layerId)
      if (!layer || layer.floorId !== filter.floorId) add('VISUAL_FILTER', '滤镜目标图层不存在或跨Floor。', filter.id)
    } else if (filter.target.kind === 'entities') for (const id of filter.target.ids) {
      const target = VISUAL_FILTER_TARGET_COLLECTIONS.flatMap(collection => {
        const value = own(scene[collection] as Record<string, Editable>, id)
        return value && !(collection === 'regions' && scene.regions[id].kind === 'manualMask') ? [value] : []
      })[0]
      if (!target || target.floorId !== filter.floorId) add('VISUAL_FILTER', '滤镜实体目标不存在、跨Floor或类型尚未支持。', filter.id)
    }
  }
  return errors
}

/** Conservative bounded raster workload for the requested output, without allocating any pixels. */
export function inspectVisualPixelBudget(scene: SceneDocument, width: number, height: number): { ok: boolean; estimatedWorkingPixels: number; issues: Issue[] } {
  const pixels = width * height, issues: Issue[] = []
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 4096) || pixels > 16_777_216) issues.push({ code: 'VISUAL_PIXEL_BUDGET', message: '视觉输出须在4096长边/16M像素预算内。' })
  const visual = visualBase(scene)
  const enabled = visual ? [...Object.values(visual.fogs), ...Object.values(visual.filters), ...Object.values(visual.lights)].filter(value => value.enabled).length : 0
  // Renderer must process effects serially and release each layer; this is a simultaneous-buffer ceiling.
  const estimatedWorkingPixels = pixels * (enabled ? 8 : 5)
  if (estimatedWorkingPixels > 134_217_728) issues.push({ code: 'VISUAL_PIXEL_BUDGET', message: '视觉合成临时像素超过128M预算。' })
  return { ok: issues.length === 0, estimatedWorkingPixels, issues }
}
