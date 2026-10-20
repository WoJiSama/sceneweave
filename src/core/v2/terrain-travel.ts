import { wallMovementPolygonsV2 } from './doorway-clearance'
import { corridor, coveredEverywhere, pointInPolygonV2, polygonsOverlapV2, propFootprintV2, segmentCuts, supportSurfaceAtV2, terrainPointsV2, validateGeometryV2 } from './geometry'
import type { Issue, PointMm, SceneDocumentV2, SurfaceRef, TerrainConnection } from './types'

export interface TerrainTravelRequestV2 { floorId: string; from: PointMm; to: PointMm; widthMm: number }
export interface TerrainTravelResultV2 { ok: boolean; issues: Issue[] }
const EPS = 1e-7
const at = (a: PointMm, b: PointMm, t: number): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const edges = (polygon: PointMm[]): [PointMm, PointMm][] => polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]])
const groundRef = (scene: SceneDocumentV2, ref: SurfaceRef): SurfaceRef => ref.kind === 'room' ? scene.rooms[ref.id].supportRef : ref
const sameRef = (a: SurfaceRef | null, b: SurfaceRef | null): boolean => !!a && !!b && a.kind === b.kind && a.id === b.id
const elevation = (scene: SceneDocumentV2, ref: SurfaceRef) => ref.kind === 'floor' ? 0 : ref.kind === 'room' ? scene.rooms[ref.id]?.groundElevationMm : scene.terrainAreas[ref.id]?.groundElevationMm
const isWalkable = (scene: SceneDocumentV2, p: PointMm, floorId: string): boolean => {
  const support = supportSurfaceAtV2(scene, p, floorId)
  return !!support && (support.kind !== 'terrainArea' || !scene.terrainAreas[support.id].blocksMovement)
}
function connectionOpen(scene: SceneDocumentV2, connection: TerrainConnection): boolean {
  if (connection.blocksMovement) return false
  if (connection.openingId === null) return true
  const opening = scene.openings[connection.openingId]
  return !!opening && opening.kind === 'door' && opening.state === 'open' && !opening.locked
}

/**
 * Checks one explicit straight full-width route in an already valid single-Floor scene.
 * It resolves current support, water, exposed boundaries, connections and actual rotated
 * blockers. It does not search for an alternative route or claim whole-map reachability.
 */
export function checkTerrainTravelV2(scene: SceneDocumentV2, request: TerrainTravelRequestV2): TerrainTravelResultV2 {
  const issues: Issue[] = [], issue = (code: string, message: string, entityId?: string) => {
    if (!issues.some(existing => existing.code === code && existing.entityId === entityId)) issues.push({ code, message, ...(entityId ? { entityId } : {}) })
  }
  const { floorId, from, to, widthMm } = request
  if (![from.x, from.y, to.x, to.y, widthMm].every(Number.isSafeInteger) || widthMm <= 0 || from.x === to.x && from.y === to.y || !scene.floors[floorId]) {
    return { ok: false, issues: [{ code: 'INVALID_TERRAIN_TRAVEL', message: '有限通行检查需要同 Floor 的非零直线与正整数净宽。' }] }
  }
  const geometry = validateGeometryV2(scene)
  if (geometry.errors.length) return { ok: false, issues: geometry.errors }
  const band = corridor(from, to, widthMm)
  const areas = Object.values(scene.terrainAreas).filter(area => area.floorId === floorId), boundaries = areas.map(terrainPointsV2)
  if (!coveredEverywhere(band, boundaries, p => isWalkable(scene, p, floorId))) issue('TERRAIN_NOT_WALKABLE', '整条净宽带必须留在世界内的可步行有效支撑面；水面或阻挡地形不能普通穿越。')
  for (const prop of Object.values(scene.props)) if (prop.floorId === floorId && prop.blocksMovement && polygonsOverlapV2(band, propFootprintV2(prop))) issue('TERRAIN_TRAVEL_OBSTACLE', '有限通行净宽被物件的真实旋转占地阻挡。', prop.id)
  for (const region of Object.values(scene.regions)) if (region.floorId === floorId && region.blocksMovement && polygonsOverlapV2(band, region.boundaryMm)) issue('TERRAIN_TRAVEL_OBSTACLE', '有限通行净宽被阻挡区域侵入。', region.id)
  for (const wall of wallMovementPolygonsV2(scene, true)) if (wall.floorId === floorId && polygonsOverlapV2(band, wall.polygon)) issue('TERRAIN_TRAVEL_WALL', '有限通行净宽被实际墙体、转角或未打开的门窗阻挡。', wall.entityId)
  const usable = Object.values(scene.terrainConnections).filter(connection => connection.floorId === floorId && connection.widthMm >= widthMm && connectionOpen(scene, connection)).map(connection => ({ connection, polygon: corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm) }))
  const allBoundaries = [...boundaries, band, ...usable.map(item => item.polygon)]
  const allEdges = allBoundaries.flatMap(edges)
  for (const area of areas) for (let index = 0; index < area.boundaryMm.length; index++) {
    const a = area.boundaryMm[index].positionMm, b = area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm, length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    const cuts = segmentCuts(a, b, allEdges)
    for (let i = 1; i < cuts.length; i++) {
      const point = at(a, b, (cuts[i - 1] + cuts[i]) / 2)
      if (!pointInPolygonV2(point, band, false)) continue
      const offset = Math.min(0.01, length * (cuts[i] - cuts[i - 1]) / 10)
      const inside = supportSurfaceAtV2(scene, { x: point.x - (b.y - a.y) / length * offset, y: point.y + (b.x - a.x) / length * offset }, floorId)
      const outside = supportSurfaceAtV2(scene, { x: point.x + (b.y - a.y) / length * offset, y: point.y - (b.x - a.x) / length * offset }, floorId)
      if (!inside || !outside || sameRef(inside, outside)) continue
      const heightChange = elevation(scene, inside) !== elevation(scene, outside)
      const declared = Object.values(scene.terrainEdges).find(edge => edge.source.areaId === area.id && edge.source.segmentId === area.boundaryMm[index].segmentId || edge.source.areaId === outside.id && edge.neighborAreaId === area.id && (() => {
        const source = scene.terrainAreas[edge.source.areaId], sourceIndex = source?.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId) ?? -1
        return !!source && sourceIndex >= 0 && pointInPolygonV2(point, corridor(source.boundaryMm[sourceIndex].positionMm, source.boundaryMm[(sourceIndex + 1) % source.boundaryMm.length].positionMm, 0.001))
      })())
      if (!heightChange && !declared?.blocksMovement) continue
      const allowed = heightChange && usable.some(item => pointInPolygonV2(point, item.polygon) && [inside, outside].every(ref => sameRef(ref, groundRef(scene, item.connection.from.surfaceRef)) || sameRef(ref, groundRef(scene, item.connection.to.surfaceRef))))
      if (!allowed) issue(heightChange ? 'TERRAIN_HEIGHT_CONNECTION' : 'TERRAIN_EDGE_BLOCKED', heightChange ? '跨高差的完整净宽必须经过有效、未阻挡且足宽的台阶或坡道。' : '当前显式地形边缘阻挡移动。', declared?.id ?? area.id)
    }
  }
  return { ok: !issues.length, issues }
}

export interface TerrainConnectionFixtureV2 { connectionId: string; minWidthMm: number; approachDepthMm: number }
/** Finite opt-in hard constraints for a named connection and both straight approaches. */
export function assertTerrainConnectionClearancesV2(scene: SceneDocumentV2, fixtures: readonly TerrainConnectionFixtureV2[]): void {
  if (fixtures.length > 64) throw new Error('单次有限台阶检查最多指定 64 处连接。')
  const ids = new Set<string>()
  for (const fixture of fixtures) {
    if (!fixture.connectionId || ids.has(fixture.connectionId) || !Number.isSafeInteger(fixture.minWidthMm) || fixture.minWidthMm <= 0 || !Number.isSafeInteger(fixture.approachDepthMm) || fixture.approachDepthMm <= 0) throw new Error('台阶净空配置需要唯一连接 ID、正整数净宽与接入深度。')
    ids.add(fixture.connectionId)
    const connection = scene.terrainConnections[fixture.connectionId]
    if (!connection) throw new Error(`声明 required 的地形连接不存在：${fixture.connectionId}。`)
    if (connection.widthMm < fixture.minWidthMm) throw new Error(`连接 ${connection.id} 净宽不足 ${fixture.minWidthMm} mm。`)
    const a = connection.from.positionMm, b = connection.to.positionMm, length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) throw new Error(`连接 ${connection.id} 不能为零长。`)
    const dx = (b.x - a.x) / length * fixture.approachDepthMm, dy = (b.y - a.y) / length * fixture.approachDepthMm
    // The fixture uses integer endpoints. Refuse an unrepresentable extension rather
    // than silently quantizing a narrower/shorter promised approach corridor.
    const from = { x: a.x - dx, y: a.y - dy }, to = { x: b.x + dx, y: b.y + dy }
    if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger)) throw new Error(`连接 ${connection.id} 的有限接入区需要可精确表达的整数端点。`)
    const check = checkTerrainTravelV2(scene, { floorId: connection.floorId, from, to, widthMm: connection.widthMm })
    if (!check.ok) throw new Error(`连接 ${connection.id} 的 ${connection.widthMm} mm 净宽及两端 ${fixture.approachDepthMm} mm 接入区未通过：${check.issues.map(item => item.message).join('；')}`)
  }
}
