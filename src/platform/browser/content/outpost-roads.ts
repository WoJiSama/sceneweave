import type { PointMm, SceneDocument, SurfaceRef } from '../../../shared/model/scene.js'
import { BuildingEntranceRoadError, planBuildingEntranceRoad } from '../../../shared/generation/building-entrance-road.js'

export interface OutpostEntranceRoad {
  pointsMm: PointMm[]
  supportRefs: SurfaceRef[]
}

/** Build a new sample route from a real doorway, with no persistent attachment
 * or changes to the door, furniture or supplied waypoints. */
export function planOutpostEntranceRoad(document: SceneDocument, openingId: string, widthMm: number,
  joinMm: PointMm, viaMm: readonly PointMm[] = []): OutpostEntranceRoad {
  try { return planBuildingEntranceRoad(document, openingId, widthMm, joinMm, viaMm) }
  catch (error) {
    if (!(error instanceof BuildingEntranceRoadError)) throw error
    const messages = {
      departure: '哨站入口道路首段须沿实际外门朝向离开门口，再连接明确经由点。',
      'doorway-blocked': `哨站门内外完整净宽不通：${error.details}`,
      'route-blocked': `哨站入口道路完整带区不通：${error.details}`,
      support: '哨站入口道路须保持同Floor、同高程的公开真实地形支撑。',
    }
    throw new Error(messages[error.code])
  }
}
