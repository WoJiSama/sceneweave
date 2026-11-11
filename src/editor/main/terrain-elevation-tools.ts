import type { SceneCommand } from '../../shared/commands/commands'
import { outdoorDependencies, previewOutdoorCommands } from '../../shared/commands/outdoor'
import { decorationFootprint } from '../../shared/decorations/geometry'
import { corridor, pathPolygon, polygonDistance, supportSurfaceAt, terrainPoints } from '../../shared/geometry/geometry'
import { COMMAND_LIMIT, type GroundSurfaceRef, type PointMm, type SceneDocument } from '../../shared/model/scene'
import { visualBase } from '../../shared/visual/base'

/** Session parameters only. Wheel/sample input never writes the document. */
export interface TerrainElevationToolState {
  mode: 'idle' | 'elevate' | 'sample'
  targetElevationMm: number
  stepMm: number
}
export interface TerrainElevationBlocker { entityId: string | null; message: string }
export interface TerrainElevationSelection {
  areaIds: string[]
  floorId: string | null
  currentElevationMm: number | null
  affectedIds: string[]
  blockers: TerrainElevationBlocker[]
  reason: string | null
}
const own = <T>(values: Record<string, T>, id: string): T | undefined => Object.hasOwn(values, id) ? values[id] : undefined

export function assertTerrainElevation(value: number, label = '目标高程'): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须是安全整数毫米。`)
}
export function assertTerrainElevationStep(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('升降步长必须是正的安全整数毫米。')
}
export function createTerrainElevationToolState(scene: SceneDocument, selectedIds: readonly string[] = []): TerrainElevationToolState {
  const first = selectedIds.length === 1 ? own(scene.terrainAreas, selectedIds[0]) : undefined
  return { mode: 'idle', targetElevationMm: first?.groundElevationMm ?? 0, stepMm: 100 }
}
export function stepTerrainElevation(state: TerrainElevationToolState, direction: -1 | 1): TerrainElevationToolState {
  if (state.mode !== 'elevate') throw new Error('请先启用整面升降工具。')
  if (direction !== -1 && direction !== 1) throw new Error('升降方向必须为上升或下降。')
  assertTerrainElevation(state.targetElevationMm); assertTerrainElevationStep(state.stepMm)
  const targetElevationMm = state.targetElevationMm + direction * state.stepMm
  assertTerrainElevation(targetElevationMm, '升降后的高程')
  return { ...state, targetElevationMm }
}

/** Reads physical ground priority, including the uncovered Floor at zero. */
export function sampleTerrainElevation(scene: SceneDocument, floorId: string, pointMm: PointMm): { surfaceRef: GroundSurfaceRef; elevationMm: number } {
  if (scene.mapMode !== 'scene') throw new Error('区域地图没有可取高的场景地面。')
  if (!own(scene.floors, floorId)) throw new Error('取高的楼层不存在。')
  if (!Number.isSafeInteger(pointMm.x) || !Number.isSafeInteger(pointMm.y)) throw new Error('取高位置必须是安全整数毫米。')
  const surfaceRef = supportSurfaceAt(scene, pointMm, floorId)
  if (!surfaceRef) throw new Error('取高位置超出当前楼层地面。')
  const elevationMm = surfaceRef.kind === 'floor' ? 0 : scene.terrainAreas[surfaceRef.id].groundElevationMm
  assertTerrainElevation(elevationMm, '支撑面高程')
  return { surfaceRef, elevationMm }
}

/** Whole surfaces may retain XY-only material overlays; physical dependants never follow implicitly. */
export function inspectTerrainElevationSelection(scene: SceneDocument, selectedIds: readonly string[]): TerrainElevationSelection {
  const result: TerrainElevationSelection = { areaIds: [], floorId: null, currentElevationMm: null, affectedIds: [], blockers: [], reason: null }
  const keys = new Set<string>()
  const block = (entityId: string | null, message: string) => {
    const key = JSON.stringify([entityId, message]); if (keys.has(key)) return
    keys.add(key); result.blockers.push({ entityId, message }); result.reason ??= message
  }
  if (scene.mapMode !== 'scene') { block(null, '整面高程工具只支持场景地图。'); return result }
  const ids = [...new Set(selectedIds)]
  if (!ids.length) { block(null, '请先明确选择一个或多个完整地形面。'); return result }
  if (ids.length > COMMAND_LIMIT) { block(null, `所选地形超过单次 ${COMMAND_LIMIT} 项，请缩小选择范围。`); return result }
  for (const id of ids) {
    const area = own(scene.terrainAreas, id)
    if (!area) { block(id, `所选对象不是完整地形面：${id}。请只选择地形。`); continue }
    result.areaIds.push(id)
    if (!own(scene.floors, area.floorId)) block(id, `地形 ${id} 的楼层不存在。`)
    if (result.floorId !== null && result.floorId !== area.floorId) block(id, '一次升降或平整只能处理同一楼层的地形。')
    result.floorId ??= area.floorId
    if (!Number.isSafeInteger(area.groundElevationMm)) block(id, `地形 ${id} 的当前高程不是安全整数毫米。`)
    const layer = own(scene.userLayers, scene.entityLayers[id])
    if (!layer || layer.floorId !== area.floorId) block(id, `地形 ${id} 缺少同楼层的有效图层。`)
    else if (layer.editLocked) block(id, `地形所在图层「${layer.name}」已锁定，请先单独解锁。`)
    if (area.editLocked) block(id, `地形 ${id} 已锁定，请先单独解锁。`)
  }
  if (result.blockers.length) return result
  const selected = new Set(result.areaIds), areas = result.areaIds.map(id => scene.terrainAreas[id])
  const heights = new Set(areas.map(area => area.groundElevationMm))
  result.currentElevationMm = heights.size === 1 ? areas[0].groundElevationMm : null
  result.affectedIds = outdoorDependencies(scene, result.areaIds)
  const affected = new Set(result.affectedIds)
  const intersects = (floorId: string, ring: PointMm[]) => ring.length >= 3 && areas.some(area => area.floorId === floorId && polygonDistance(terrainPoints(area), ring) < 1e-7)
  const dependentKinds = [
    ['rooms', '房间'], ['walls', '墙体'], ['openings', '门窗'], ['paths', '道路'],
    ['terrainConnections', '楼梯或坡道'], ['props', '物件'], ['prefabInstances', '组合'], ['scatterGroups', '散布组'],
  ] as const
  for (const [collection, label] of dependentKinds) for (const item of Object.values(scene[collection])) {
    if (affected.has(item.id)) block(item.id, `高程影响范围包含${label} ${item.id}，当前工具不会自动跟随或重绑；请先处理依赖。`)
  }
  // Unreferenced independent walls and path shoulders can cross an affected area.
  for (const wall of Object.values(scene.walls)) {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    if (a && b && intersects(wall.floorId, corridor({ x: a.xMm, y: a.yMm }, { x: b.xMm, y: b.yMm }, wall.thicknessMm, true))) {
      block(wall.id, `地形范围接触墙体 ${wall.id}，当前工具不能改变建筑支撑高程。`)
    }
  }
  for (const path of Object.values(scene.paths)) if (intersects(path.floorId, pathPolygon(path))) {
    block(path.id, `地形范围接触道路 ${path.id} 的完整宽度，当前工具不会自动补坡或重绑道路。`)
  }
  for (const edge of Object.values(scene.terrainEdges)) if (selected.has(edge.source.areaId) || edge.neighborAreaId !== null && selected.has(edge.neighborAreaId)) {
    block(edge.id, `地形边缘 ${edge.id} 需要重新核对高差与阻挡，请先通过室外属性处理边缘。`)
  }
  for (const id of result.affectedIds) {
    const item = scene.terrainAreas[id] ?? scene.notes[id]
    if (!item) continue
    const layer = own(scene.userLayers, scene.entityLayers[id])
    if (item.editLocked || layer?.editLocked) block(id, `必要依赖 ${id}${layer?.editLocked ? ` 所在图层「${layer.name}」` : ''}已锁定，请先单独处理。`)
  }
  for (const [collection, label] of [['decorations', '装饰'], ['decorationClusters', '植物簇'], ['surfaceRules', '地表规则']] as const) {
    for (const item of Object.values(scene[collection])) if (item.supportRef.kind === 'terrainArea' && selected.has(item.supportRef.id)) {
      block(item.id, `地形仍支撑${label} ${item.id}，当前工具不隐式改写布景或覆盖规则。`)
    }
  }
  for (const item of Object.values(scene.decorations)) {
    if (item.floorId !== result.floorId || item.supportRef.kind === 'terrainArea' && selected.has(item.supportRef.id)) continue
    try {
      if (intersects(item.floorId, decorationFootprint(scene, item))) block(item.id, `地形范围接触装饰 ${item.id} 的真实占地，当前工具不隐式改写布景支撑。`)
    } catch {
      block(item.id, `装饰 ${item.id} 缺少有效固定定义，无法核对高程影响范围。`)
    }
  }
  for (const boundary of Object.values(visualBase(scene)?.boundaries ?? {})) if (boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => selected.has(side.areaId))) {
    block(boundary.id, `地形绑定视觉曲线 ${boundary.id}，当前工具尚不处理曲线与边带的高程联动。`)
  }
  return result
}

/** Only a command proposal; the owning Workspace still checks resources, baseline, CAS and history. */
export function terrainElevationCommands(scene: SceneDocument, selectedIds: readonly string[], targetElevationMm: number): SceneCommand[] {
  assertTerrainElevation(targetElevationMm)
  const selection = inspectTerrainElevationSelection(scene, selectedIds)
  if (selection.reason) throw new Error(selection.reason)
  for (const area of Object.values(scene.terrainAreas)) if (area.floorId === selection.floorId && !selection.areaIds.includes(area.id)) {
    if (!Number.isSafeInteger(targetElevationMm - area.groundElevationMm)) throw new Error(`目标高程与地形 ${area.id} 的高差超出安全整数范围。`)
  }
  const commands = selection.areaIds.filter(id => scene.terrainAreas[id].groundElevationMm !== targetElevationMm)
    .map(id => ({ type: 'updateTerrainArea' as const, id, changes: { groundElevationMm: targetElevationMm } }))
  if (!commands.length) return []
  const preview = previewOutdoorCommands(scene, commands, {
    ids: { nextId: () => { throw new Error('整面高程候选不能隐式创建新实体。') } }, clock: { now: () => scene.updatedAt },
  })
  if (preview.reason) throw new Error(preview.reason)
  return commands
}
