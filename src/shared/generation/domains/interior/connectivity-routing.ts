import type { PointMm, SceneDocument } from '../../../model/scene.js'
import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { wallMovementPolygons } from '../../../geometry/doorway-clearance.js'
import { propFootprint, roomPoints } from '../../../geometry/geometry.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { furnitureBoundsPolygon } from './furnishing-poses.js'
import { findFurnitureAccess } from './furnishing-circulation.js'

/** A bounded alternative from one exact doorway anchor to the original room
 * endpoint. It retains width, room and actual movement blockers; the
 * caller independently checks the joined route through the same opening. */
export function replanInteriorRoomRoute(document: SceneDocument, input: {
  roomId: string; openingId: string; start: PointMm; end: PointMm; widthMm: number
}, options: { profile: TaskBudgetProfile; checkCancelled: () => void; avoidPaintedBodies?: boolean }): PointMm[] | undefined {
  const room = document.rooms[input.roomId], meter = captureExecutionBudget(options.profile)
  options.checkCancelled()
  if (!room) return undefined
  meter.charge({ fieldEvaluations: Object.keys(document.walls).length + Object.keys(document.props).length + Object.keys(document.regions).length + room.boundaryVertexIds.length })
  const blockers = [...wallMovementPolygons(document, true).filter(row => row.floorId === room.floorId).map(row => row.polygon),
    // New furniture placement can prefer routes around complete painted bodies.
    // Read-only inspection uses actual physical travel, as checkTerrainRoute does.
    ...Object.values(document.props).filter(prop => prop.floorId === room.floorId && prop.blocksMovement)
      .flatMap(prop => [propFootprint(prop), ...(options.avoidPaintedBodies !== false && prop.renderLayer !== 'ground' ? [furnitureBoundsPolygon(prop.visualBoundsMm, prop)] : [])]),
    ...Object.values(document.regions).filter(region => region.floorId === room.floorId && region.blocksMovement).map(region => region.boundaryMm)]
  const route = findFurnitureAccess({ roomPolygon: roomPoints(document, room), blockers,
    ports: [{ openingId: input.openingId, pointMm: input.start }], targetMm: input.end, widthMm: input.widthMm,
    graphMode: 'bounded-lazy', checkCancelled: options.checkCancelled,
    chargeNode: () => meter.charge({ gridNodes: 1, fieldEvaluations: 1 }),
    chargePair: () => meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 }),
    checkNative: (pointsMm, widthMm) => {
      options.checkCancelled()
      meter.charge({ fieldEvaluations: Object.keys(document.walls).length + Object.keys(document.props).length + pointsMm.length })
      return checkTerrainRoute(document, { floorId: room.floorId, pointsMm, widthMm }).ok
    } })
  return route?.pointsMm
}
