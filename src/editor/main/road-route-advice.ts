import type { Issue, PointMm, SceneDocument, SurfaceRef } from '../../shared/model/scene.js'
import { checkTerrainRoute, searchTerrainRoute, TERRAIN_ROUTE_LIMITS, type TerrainRouteResult } from '../../shared/geometry/terrain-travel.js'

export interface RoadRouteAdviceRequest {
  floorId: string
  pointsMm: readonly PointMm[]
  widthMm: number
  supportRefs: readonly SurfaceRef[]
  gridMm?: number
  /** One total expansion budget across all original waypoint pairs. */
  maxNodes?: number
}
export interface RoadRouteAdvice extends TerrainRouteResult {
  status: 'checked' | 'found' | 'not-found' | 'budget' | 'invalid'
  pointsMm: PointMm[]
  expandedNodes: number
  supportChanged: boolean
}
const supportKey = (refs: readonly SurfaceRef[]) => [...new Set(refs.map(ref => `${ref.kind}:${ref.id}`))].sort().join('\n')
const failure = (status: RoadRouteAdvice['status'], issues: Issue[], expandedNodes = 0): RoadRouteAdvice => ({ ok: false, status, pointsMm: [],
  expandedNodes, issues, lengthMm: 0, movementCostMm: 0, supportRefs: [], connectionIds: [], supportChanged: false })
const result = (checked: TerrainRouteResult, request: RoadRouteAdviceRequest, points: readonly PointMm[], status: RoadRouteAdvice['status'], expandedNodes: number): RoadRouteAdvice => ({ ...checked,
  status, pointsMm: checked.ok ? points.map(point => ({ ...point })) : [], expandedNodes, supportChanged: checked.ok && supportKey(request.supportRefs) !== supportKey(checked.supportRefs) })

/** Explicit read-only check. Ordinary path drafts retain their own geometric
 * validity rules; a failed travel check does not turn into a createPath guard. */
export function checkRoadRouteAdvice(scene: SceneDocument, request: RoadRouteAdviceRequest): RoadRouteAdvice {
  return result(checkTerrainRoute(scene, request), request, request.pointsMm, 'checked', 0)
}

/** Keep every user waypoint as an exact leg endpoint, then recheck the joined
 * square-cap/miter band. No scene, support selection or draft is changed here. */
export function suggestRoadRoute(scene: SceneDocument, request: RoadRouteAdviceRequest): RoadRouteAdvice {
  const maxNodes = request.maxNodes ?? 512, gridMm = request.gridMm ?? Math.min(1000, Math.max(100, Math.round(request.widthMm / 2)))
  if (!Number.isSafeInteger(maxNodes) || maxNodes <= 0 || maxNodes > TERRAIN_ROUTE_LIMITS.nodes || !Number.isSafeInteger(gridMm) || gridMm <= 0 || gridMm > TERRAIN_ROUTE_LIMITS.gridMm
    || !scene.floors[request.floorId] || !Number.isSafeInteger(request.widthMm) || request.widthMm <= 0
    || request.pointsMm.length < 2 || request.pointsMm.length > TERRAIN_ROUTE_LIMITS.points || request.pointsMm.some(point => ![point.x, point.y].every(Number.isSafeInteger))) {
    return failure('invalid', [{ code: 'INVALID_ROAD_ADVICE', message: '绕行建议需要同 Floor 的2–128个整数经由点、正整数净宽与有限网格/节点预算。' }])
  }
  const direct = checkTerrainRoute(scene, request)
  if (direct.ok) return result(direct, request, request.pointsMm, 'found', 0)
  let expandedNodes = 0
  const points: PointMm[] = [{ ...request.pointsMm[0] }]
  for (let index = 1; index < request.pointsMm.length; index++) {
    const remaining = maxNodes - expandedNodes
    if (remaining <= 0 || points.length >= TERRAIN_ROUTE_LIMITS.points) return failure('budget', [{ code: 'ROAD_ADVICE_BUDGET', message: `绕行建议达到本次共${maxNodes}个节点或128个点预算，原经由点和草稿保持。` }], expandedNodes)
    const leg = searchTerrainRoute(scene, { floorId: request.floorId, from: request.pointsMm[index - 1], to: request.pointsMm[index], widthMm: request.widthMm,
      gridMm, maxNodes: remaining, maxSegments: TERRAIN_ROUTE_LIMITS.points - points.length })
    expandedNodes += leg.expandedNodes
    if (!leg.ok) return failure(leg.status, leg.issues, expandedNodes)
    points.push(...leg.points.slice(1).map(point => ({ ...point })))
    if (points.length > TERRAIN_ROUTE_LIMITS.points) return failure('budget', [{ code: 'ROAD_ADVICE_POINT_LIMIT', message: '保留经由点后的建议超过128个点保护上限；未替换草稿。' }], expandedNodes)
  }
  const checked = checkTerrainRoute(scene, { floorId: request.floorId, pointsMm: points, widthMm: request.widthMm })
  return result(checked, request, points, checked.ok ? 'found' : 'not-found', expandedNodes)
}
