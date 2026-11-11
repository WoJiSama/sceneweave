import type { PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import { resolveBuildingEntrancePort } from './building-port.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'

export interface BuildingEntranceRoadPlan { pointsMm: PointMm[]; supportRefs: SurfaceRef[] }
export type BuildingEntranceRoadFailure = 'departure' | 'doorway-blocked' | 'route-blocked' | 'support'

/** Structured failure lets frozen sample adapters retain their established UI
 * wording without duplicating geometry or rewriting arbitrary error strings. */
export class BuildingEntranceRoadError extends Error {
  constructor(readonly code: BuildingEntranceRoadFailure, readonly details = '') {
    const messages: Record<BuildingEntranceRoadFailure, string> = {
      departure: '建筑入口道路首段须沿实际外门朝向离开门口，再连接明确经由点。',
      'doorway-blocked': `建筑门内外完整净宽不通：${details}`,
      'route-blocked': `建筑入口道路完整带区不通：${details}`,
      support: '建筑入口道路须保持同Floor、同高程的公开真实地形支撑。',
    }
    super(messages[code]); this.name = 'BuildingEntranceRoadError'
  }
}

/** Plan one explicit current route from any supported public exterior doorway.
 * This does not persist an attachment, reroute waypoints, move obstacles or
 * change a door state. Callers adopt the complete points/supports via an ordinary
 * path command and bind their own exact workspace baseline before that adoption. */
export function planBuildingEntranceRoad(document: SceneDocument, openingId: string, widthMm: number,
  joinMm: PointMm, viaMm: readonly PointMm[] = []): BuildingEntranceRoadPlan {
  const port = resolveBuildingEntrancePort(document, openingId, widthMm)
  const pointsMm = [port.outsideMm, ...viaMm, joinMm].map(point => ({ ...point }))
  const next = pointsMm[1], normal = { x: port.outsideMm.x - port.positionMm.x, y: port.outsideMm.y - port.positionMm.y }
  const delta = { x: next.x - port.outsideMm.x, y: next.y - port.outsideMm.y }
  if (delta.x * normal.y !== delta.y * normal.x || delta.x * normal.x + delta.y * normal.y <= 0) throw new BuildingEntranceRoadError('departure')
  const doorway = checkTerrainRoute(document, { floorId: port.floorId, pointsMm: [port.insideMm, port.outsideMm], widthMm })
  if (!doorway.ok) throw new BuildingEntranceRoadError('doorway-blocked', doorway.issues.map(issue => issue.message).join('；'))
  const route = checkTerrainRoute(document, { floorId: port.floorId, pointsMm, widthMm })
  if (!route.ok) throw new BuildingEntranceRoadError('route-blocked', route.issues.map(issue => issue.message).join('；'))
  for (const ref of route.supportRefs) {
    const area = ref.kind === 'terrainArea' ? document.terrainAreas[ref.id] : null
    if (!area || area.floorId !== port.floorId || area.visibility !== 'public' || area.groundElevationMm !== port.elevationMm) throw new BuildingEntranceRoadError('support')
  }
  return { pointsMm, supportRefs: route.supportRefs.map(ref => ({ ...ref })) }
}
