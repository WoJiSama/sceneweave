import type { ExecutionBudget } from '../../../budget/task-budget.js'
import { wallMovementPolygons } from '../../../geometry/doorway-clearance.js'
import { propFootprint, roomPoints } from '../../../geometry/geometry.js'
import { checkRouteOnValidScene } from '../../../geometry/terrain-travel.js'
import type { Prop, SceneDocument } from '../../../model/scene.js'
import { findFurnitureAccess, furnitureApproachPoint, roomDoorPorts } from './furnishing-circulation.js'
import { furnitureBoundsPolygon } from './furnishing-poses.js'

export function planSavedFurnitureAccess(document: SceneDocument, roomId: string, checkCancelled: () => void, meter: ExecutionBudget) {
  const room = document.rooms[roomId], floorId = room.floorId, roomPolygon = roomPoints(document, room)
  const ports = roomDoorPorts(document, roomId, 600, checkCancelled, work => meter.charge({ fieldEvaluations: work }), true)
  const walls = wallMovementPolygons(document, true).filter(wall => wall.floorId === floorId)
  const props = Object.values(document.props).filter(prop => prop.floorId === floorId && prop.blocksMovement)
  const regions = Object.values(document.regions).filter(region => region.floorId === floorId && region.blocksMovement)
  const blockers = [...walls.map(wall => wall.polygon), ...regions.map(region => region.boundaryMm),
    ...props.flatMap(prop => [propFootprint(prop), ...(prop.renderLayer === 'ground' ? [] : [furnitureBoundsPolygon(prop.visualBoundsMm, prop)])])]
  return (prop: Prop, rear: boolean) => findFurnitureAccess({ roomPolygon, blockers, ports, targetMm: furnitureApproachPoint(prop, prop, rear), graphMode: 'bounded-lazy', checkCancelled,
    chargeNode: () => meter.charge({ fieldEvaluations: 1, gridNodes: 1 }), chargePair: () => meter.charge({ fieldEvaluations: 1, intersectionPairs: 1 }),
    checkNative: (pointsMm, widthMm) => {
      meter.charge({ fieldEvaluations: walls.length + props.length + regions.length + pointsMm.length })
      return checkRouteOnValidScene(document, { floorId, pointsMm, widthMm }).ok
    },
  })
}
