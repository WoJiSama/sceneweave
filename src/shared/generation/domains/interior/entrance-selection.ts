import type { PointMm, SceneDocument, Wall } from '../../../model/scene.js'
import { pathPolygon, polygonsOverlap, roomPoints } from '../../../geometry/geometry.js'
import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { planBuildingEntranceApproaches } from '../../entrance-approach.js'
import type { BuildingEntrancePort } from '../../building-port.js'
import type { BuildingEntranceApproach, InteriorRectangle } from './contracts.js'

export const EXTERIOR_ENTRANCE_LIMITS = Object.freeze({ offsetsPerWall: 2, fullChecks: 12 })
export const entranceRouteLength = (points: readonly PointMm[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0)
interface ExteriorWall { wall: Wall; rooms: readonly string[]; stableKey: string; length: number }
export interface ExteriorEntranceProposal { wall: Wall; offsetMm: number; pointsMm: PointMm[]; lengthMm: number; stableKey: string; variant: number }

/** Rank finite geometric suggestions, before furniture. These estimated ports
 * grant no travel permission: every adopted proposal still needs a real native
 * door, certified port, full road band and continuation into the actual room. */
export function rankExteriorEntranceProposals(document: SceneDocument, walls: readonly ExteriorWall[], boundsMm: InteriorRectangle,
  doorWidthMm: number, approach: BuildingEntranceApproach, options: { profile: TaskBudgetProfile; checkCancelled: () => void }): ExteriorEntranceProposal[] {
  const meter = captureExecutionBudget(options.profile), proposals: ExteriorEntranceProposal[] = []
  const arrival = approach.viaMm.at(-1) ?? approach.fromMm, b = boundsMm
  const building = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
  for (const row of walls) {
    options.checkCancelled(); meter.charge({ fieldEvaluations: 1 })
    if (row.rooms.length !== 1) continue
    const wall = row.wall, a = document.vertices[wall.startVertexId], end = document.vertices[wall.endVertexId]
    if (a.xMm !== end.xMm && a.yMm !== end.yMm) continue
    const room = document.rooms[row.rooms[0]], supportRef = room.supportRef
    if (supportRef.kind !== 'terrainArea') continue
    const clearance = Math.max(document.constraints.wallEndClearanceMm, Math.ceil(wall.thicknessMm / 2) + 1)
    if (doorWidthMm < (document.constraints.minDoorWidthMm ?? 1) || row.length < doorWidthMm + 2 * clearance) continue
    const tangent = { x: Math.sign(end.xMm - a.xMm), y: Math.sign(end.yMm - a.yMm) }
    const distance = (arrival.x - a.xMm) * tangent.x + (arrival.y - a.yMm) * tangent.y
    const projected = Math.max(clearance, Math.min(row.length - doorWidthMm - clearance, Math.round(distance - doorWidthMm / 2)))
    const offsets = [...new Set([projected, Math.floor((row.length - doorWidthMm) / 2)])]
    const polygon = roomPoints(document, room), center = {
      x: (Math.min(...polygon.map(p => p.x)) + Math.max(...polygon.map(p => p.x))) / 2,
      y: (Math.min(...polygon.map(p => p.y)) + Math.max(...polygon.map(p => p.y))) / 2,
    }
    for (const offsetMm of offsets) {
      const positionMm = { x: a.xMm + tangent.x * (offsetMm + doorWidthMm / 2), y: a.yMm + tangent.y * (offsetMm + doorWidthMm / 2) }
      if (!Number.isSafeInteger(positionMm.x) || !Number.isSafeInteger(positionMm.y)) continue
      const normal = tangent.x === 0 ? { x: Math.sign(positionMm.x - center.x), y: 0 } : { x: 0, y: Math.sign(positionMm.y - center.y) }
      const depth = Math.ceil(wall.thicknessMm / 2) + Math.ceil(approach.widthMm / 2) + 1
      const port: BuildingEntrancePort = { openingId: 'unverified-entrance', roomId: room.id, floorId: room.floorId, supportRef: { kind: 'terrainArea', id: supportRef.id },
        elevationMm: room.groundElevationMm, positionMm, widthMm: approach.widthMm,
        directionDeg: normal.x === 1 ? 0 : normal.x === -1 ? 180 : normal.y === 1 ? 90 : 270,
        outsideMm: { x: positionMm.x + normal.x * depth, y: positionMm.y + normal.y * depth },
        insideMm: { x: positionMm.x - normal.x * depth, y: positionMm.y - normal.y * depth } }
      const variants = planBuildingEntranceApproaches({ port, ...approach, buildingBoundsMm: boundsMm, wallThicknessMm: wall.thicknessMm }).variantsMm
      for (const [variant, pointsMm] of variants.entries()) {
        options.checkCancelled(); meter.charge({ gridNodes: 1, fieldEvaluations: pointsMm.length })
        const band = pathPolygon({ id: 'unverified-entrance-band', floorId: room.floorId, editLocked: false, visibility: 'public',
          centerlineMm: pointsMm, widthMm: approach.widthMm, supportRefs: [supportRef], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 })
        meter.charge({ intersectionPairs: 4 * band.length })
        if (!polygonsOverlap(band, building)) proposals.push({ wall, offsetMm, pointsMm, lengthMm: entranceRouteLength(pointsMm), stableKey: row.stableKey, variant })
      }
    }
  }
  return proposals.sort((a, b) => a.lengthMm - b.lengthMm || a.pointsMm.length - b.pointsMm.length
    || (a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0) || a.offsetMm - b.offsetMm || a.variant - b.variant)
    .slice(0, EXTERIOR_ENTRANCE_LIMITS.fullChecks)
}
