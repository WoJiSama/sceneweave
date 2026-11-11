import { previewOutdoorCommands, type OutdoorCommand } from '../../shared/commands/outdoor'
import { polygonBoolean, polygonBooleanExact, POLYGON_BOOLEAN_LIMITS } from '../../shared/geometry/polygon-boolean'
import { pointInPolygon, polygonDistance, polygonsOverlap, terrainPoints } from '../../shared/geometry/geometry'
import { sha256Text } from '../../shared/geometry/scatter'
import { COMPOSITION_LIMITS, type AppearanceSource, type CompositionContent } from '../../shared/model/appearance'
import type { PointMm, SceneDocument, SurfaceStyle } from '../../shared/model/scene'
import { canonicalJson, cloneJson, inspectJsonInput } from '../../shared/validation/json'
import { assertTerrainElevation, inspectTerrainElevationSelection, type TerrainElevationBlocker } from './terrain-elevation-tools'

export type TerrainSculptProject = Pick<CompositionContent, 'document' | 'appearance'>
export interface TerrainSculptToolState {
  mode: 'idle' | 'polygon'
  points: PointMm[]
  cursor: PointMm | null
  targetElevationMm: number
}
export interface TerrainSculptSelection {
  areaId: string | null
  floorId: string | null
  currentElevationMm: number | null
  reason: string | null
  blockers: TerrainElevationBlocker[]
}
export const TERRAIN_SCULPT_MAX_POINTS = 48
const own = <T>(values: Record<string, T>, id: string): T | undefined => Object.hasOwn(values, id) ? values[id] : undefined
const samePoint = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
function sameOutline(left: PointMm[], right: PointMm[]): boolean {
  const corners = (ring: PointMm[]) => ring.filter((b, index) => {
    const a = ring[(index + ring.length - 1) % ring.length], c = ring[(index + 1) % ring.length]
    return (BigInt(b.x) - BigInt(a.x)) * (BigInt(c.y) - BigInt(b.y)) !== (BigInt(b.y) - BigInt(a.y)) * (BigInt(c.x) - BigInt(b.x))
  })
  const a = corners(left), b = corners(right)
  if (a.length !== b.length) return false
  const start = b.findIndex(point => samePoint(point, a[0]))
  return start >= 0 && [1, -1].some(direction => a.every((point, index) => samePoint(point, b[(start + direction * index + b.length) % b.length])))
}

export function createTerrainSculptToolState(scene: SceneDocument, selectedIds: readonly string[] = []): TerrainSculptToolState {
  const area = selectedIds.length === 1 ? own(scene.terrainAreas, selectedIds[0]) : undefined
  return { mode: 'idle', points: [], cursor: null, targetElevationMm: area?.groundElevationMm ?? 0 }
}

/** One unoverlapped surface, with exact world-aligned paint fragments and no implicit dependency rebinding. */
export function inspectTerrainSculptSelection(project: TerrainSculptProject, selectedIds: readonly string[], excludedIds?: ReadonlySet<string>): TerrainSculptSelection {
  const scene = project.document
  const result: TerrainSculptSelection = { areaId: null, floorId: null, currentElevationMm: null, reason: null, blockers: [] }
  const block = (entityId: string | null, message: string) => { result.blockers.push({ entityId, message }); result.reason ??= message }
  if (selectedIds.length !== 1) { block(null, '局部台地或洼地须明确选择一个完整地形面。'); return result }
  const base = inspectTerrainElevationSelection(scene, selectedIds)
  for (const item of base.blockers) block(item.entityId, item.message)
  const id = selectedIds[0], area = own(scene.terrainAreas, id)
  if (!area) return result
  result.areaId = id; result.floorId = area.floorId; result.currentElevationMm = area.groundElevationMm
  if (excludedIds?.has(id)) block(id, '所选地形在隐藏、独显或当前图层选择范围之外，请先恢复可见范围。')
  const layerId = scene.entityLayers[id], shape = terrainPoints(area)
  if (area.coveragePriority >= 10000) block(id, '地形覆盖优先级已达上限，不能在其内部新增局部高程面。')
  for (const other of Object.values(scene.terrainAreas)) if (other.id !== id && other.floorId === area.floorId && polygonsOverlap(shape, terrainPoints(other))) {
    block(other.id, `所选地形与 ${other.id} 叠加，首轮局部塑形只支持无叠加的单一裸面。`)
  }
  for (const noteId of base.affectedIds) if (own(scene.notes, noteId)) block(noteId, `地形关联注记 ${noteId}，当前工具不隐式改写人工附着。`)
  for (const region of Object.values(scene.regions)) if (region.floorId === area.floorId && polygonDistance(shape, region.boundaryMm) < 1e-7) {
    block(region.id, `地形接触区域 ${region.id}，请先明确处理遮罩或活动范围。`)
  }
  for (const group of Object.values(scene.aggregateCoordinates?.groups ?? {})) if (group.members.some(member => member.kind === 'terrainArea' && member.id === id)) {
    block(group.id, `地形属于自然组 ${group.id}，当前工具不隐式改变组的成员与边界。`)
  }
  const generation = scene.generation
  // No generation prerequisite: a normal hand-drawn empty surface has no managed rules.
  for (const rule of Object.values(generation?.legacy.rules ?? {})) if (rule.floorId === area.floorId) {
    block(rule.id, `当前楼层仍有生成规则 ${rule.id}，首轮塑形不改写生成来源与人工保护记录。`)
  }
  for (const row of Object.values(generation?.compositions ?? {})) if (row.floorId === area.floorId && row.state !== 'detached') {
    block(row.id, `当前楼层仍有地貌组合 ${row.id}，请先明确处理来源与依赖。`)
  }
  if ((project.appearance.layerAdjustments[layerId] ?? []).some(row => row.enabled)
    || (project.appearance.instanceAdjustments[id] ?? []).some(row => row.enabled)) {
    block(id, '所选地形或其图层仍有启用的外观调整，当前工具不重复求值或隐式复制这些覆盖。')
  }
  if (area.surfaceStyle) {
    if ([area.surfaceStyle.base, ...area.surfaceStyle.overlays.map(row => row.paint)].some(paint => paint.alignment !== 'world')) {
      block(id, '局部塑形的底材与全部覆盖须为世界对齐；请先明确转换表面对齐材质，避免改变纹理相位。')
    }
    const sourceId = own(project.appearance.surfaceSources, id), source = sourceId && own(project.appearance.sources, sourceId)
    if (!source || source.kind !== 'surface' || canonicalJson(source.snapshot) !== canonicalJson(area.surfaceStyle)) {
      block(id, '地形当前材质与固定表面源不一致，无法保全原有材质参数。')
    } else {
      // A raw fixed snapshot already contains complete literal paint fields.
      // Preserve every ancestor; no effective layer/instance value is baked.
      const visited = new Set<string>()
      let ancestor: string | null = source.id
      while (ancestor !== null) {
        const record: AppearanceSource | undefined = own(project.appearance.sources, ancestor)
        if (visited.has(ancestor) || visited.size >= COMPOSITION_LIMITS.sourceDepth || !record || record.kind !== 'surface') {
          block(id, '固定表面来源链缺失、循环、类型不符或超过16层，不能保全局部材质。'); break
        }
        visited.add(ancestor); ancestor = record.parentSourceId
      }
    }
  }
  return result
}

/** Keep the original style untouched; every clipped component has its own new
 * embedded identity and enters the normal immutable appearance source graph. */
function sculptSurfaceStyle(style: SurfaceStyle | null, ring: PointMm[], prefix: string): SurfaceStyle | null {
  if (!style) return null
  const next = cloneJson(style)
  next.overlays = []
  for (const overlay of style.overlays) {
    const result = polygonBooleanExact({ operation: 'intersection', subject: [overlay.boundaryMm], clip: [ring] })
    for (const [part, polygon] of result.polygons.entries()) {
      if (polygon.holes.length) throw new Error(`覆盖 ${overlay.id} 裁切后含孔洞，当前局部覆盖不能隐式填洞。`)
      next.overlays.push({ ...cloneJson(overlay), id: `${prefix}-overlay-${sha256Text(JSON.stringify([overlay.id, part])).slice(0, 20)}`,
        boundaryMm: polygon.outer })
    }
  }
  return next
}

/** Validate a strictly interior polygon; never clip, round or silently redraw the user's scope. */
function sculptRing(scene: SceneDocument, areaId: string, rawPoints: readonly PointMm[]): PointMm[] {
  const issue = inspectJsonInput(rawPoints)
  if (issue) throw new Error(`局部范围无效：${issue.message}`)
  const points = cloneJson(rawPoints) as PointMm[]
  if (points.length > 3 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop()
  if (points.length < 3 || points.length > TERRAIN_SCULPT_MAX_POINTS) throw new Error(`局部范围须为 3–${TERRAIN_SCULPT_MAX_POINTS} 个整数毫米顶点。`)
  for (const point of points) if (![point.x, point.y].every(value => Number.isSafeInteger(value) && value >= POLYGON_BOOLEAN_LIMITS.minCoordinateMm && value <= POLYGON_BOOLEAN_LIMITS.maxCoordinateMm)) {
    throw new Error('局部范围须使用 ±1000000000 内的安全整数毫米坐标。')
  }
  const normalized = polygonBoolean({ operation: 'union', subject: [points], clip: [] })
  if (normalized.polygons.length !== 1 || normalized.polygons[0].holes.length) throw new Error('首轮局部范围只支持不含孔洞的单个简单轮廓。')
  const ring = normalized.polygons[0].outer, shape = terrainPoints(scene.terrainAreas[areaId])
  if (!sameOutline(points, ring)) throw new Error('局部范围规范化改变了原始轮廓，请调整坐标后重试；工具不会代替用户重画范围。')
  if (ring.some(point => !pointInPolygon(point, shape, false))) throw new Error('局部范围必须严格位于所选地形内部，不能触及或越过原面边界。')
  // Difference proves containment even for concave source areas. The second
  // difference also rejects a scope edge touching the source between its vertices.
  const outside = polygonBoolean({ operation: 'difference', subject: [ring], clip: [shape] })
  const remainder = polygonBoolean({ operation: 'difference', subject: [shape], clip: [ring] })
  if (outside.polygons.length || remainder.polygons.length !== 1 || remainder.polygons[0].holes.length !== 1) {
    throw new Error('局部范围须完整落在原面内部，不能穿越凹口、连接原边界或将原面切成多个区域。')
  }
  return ring
}

/** Real native terrain and cliff commands; the Workspace owns baseline, full resources and adoption. */
export function terrainSculptCommands(project: TerrainSculptProject, selectedIds: readonly string[], points: readonly PointMm[], targetElevationMm: number,
  operationId: string, excludedIds?: ReadonlySet<string>): { commands: OutdoorCommand[]; createdAreaId: string; overlayFragmentCount: number } {
  assertTerrainElevation(targetElevationMm)
  if (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 128 || operationId === '__proto__') throw new Error('局部塑形需要当前草稿的有效操作身份。')
  const selection = inspectTerrainSculptSelection(project, selectedIds, excludedIds)
  if (selection.reason || !selection.areaId) throw new Error(selection.reason ?? '请先选择完整地形面。')
  const scene = project.document, area = scene.terrainAreas[selection.areaId]
  if (targetElevationMm === area.groundElevationMm) throw new Error('目标高程与原面相同，请指定真实台地或洼地的高度。')
  if (!Number.isSafeInteger(targetElevationMm - area.groundElevationMm)) throw new Error('局部目标高程与原面的高差超出安全整数范围。')
  const ring = sculptRing(scene, area.id, points), prefix = `terrain-sculpt-${sha256Text(operationId).slice(0, 32)}`
  const createdAreaId = `${prefix}-area`, layerId = scene.entityLayers[area.id]
  const surfaceStyle = sculptSurfaceStyle(area.surfaceStyle, ring, prefix)
  const commands: OutdoorCommand[] = [{ type: 'createTerrainArea', id: createdAreaId, floorId: area.floorId, layerId,
    boundaryMm: ring, groundElevationMm: targetElevationMm, coveragePriority: area.coveragePriority + 1,
    visibility: area.visibility, surfaceStyle, blocksMovement: area.blocksMovement,
    blocksSight: area.blocksSight, movementCostMultiplier: area.movementCostMultiplier }]
  for (let index = 0; index < ring.length; index++) commands.push({ type: 'createTerrainEdge', id: `${prefix}-cliff-${index}`, layerId,
    source: { areaId: createdAreaId, segmentId: `${createdAreaId}:segment:${index}` },
    kind: 'cliff', visibility: area.visibility, shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: null, styleOverride: null })
  const preview = previewOutdoorCommands(scene, commands, { ids: { nextId: () => { throw new Error('局部塑形不能隐式分配未声明实体。') } }, clock: { now: () => scene.updatedAt } })
  if (preview.reason) throw new Error(preview.reason)
  if (preview.commandCost + (surfaceStyle?.overlays.length ?? 0) > 256) throw new Error('局部高程、边缘与材质片段实际展开超过256，不能拆批绕过。')
  return { commands, createdAreaId, overlayFragmentCount: surfaceStyle?.overlays.length ?? 0 }
}
