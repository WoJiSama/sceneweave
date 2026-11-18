import { checkTerrainRoute, checkTerrainTravel, type TerrainRouteRequest, type TerrainTravelResult } from '../../../geometry/terrain-travel.js'
import type { PointMm, Room, SceneDocument, Wall } from '../../../model/scene.js'

export function roomOwnsInteriorWall(room: Room, wall: Wall): boolean {
  return room.boundaryVertexIds.some((id, index, ids) => {
    const next = ids[(index + 1) % ids.length]
    return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
  })
}

/** In a floor-only plan, the outer face of a perimeter wall can be the map edge.
 * An exterior route there starts at the actual threshold on the Floor boundary. */
export function floorEdgeDoorStart(document: SceneDocument, room: Room, wall: Wall, inside: PointMm): PointMm | undefined {
  if (room.supportRef.kind !== 'floor') return undefined
  const a = document.vertices[wall.startVertexId], b = document.vertices[wall.endVertexId]
  const axis = a.xMm === b.xMm ? 'x' : a.yMm === b.yMm ? 'y' : undefined
  if (!axis) return undefined
  const bounds = document.floors[room.floorId].boundsMm
  const line = axis === 'x' ? a.xMm : a.yMm
  const edge = inside[axis] > line ? bounds[axis] : bounds[axis] + (axis === 'x' ? bounds.width : bounds.height)
  if (Math.abs(edge - line) !== Math.ceil(wall.thicknessMm / 2)) return undefined
  return { ...inside, [axis]: edge }
}

/** The first leg is perpendicular to the threshold. Inset its square cap by
 * half the full width so that it covers the wall down to the Floor boundary.
 * For odd widths a straight band also checks the remaining half millimetre. */
export function checkFloorEdgeDoorRoute(document: SceneDocument, request: TerrainRouteRequest, inside: PointMm): TerrainTravelResult {
  const [edge, next] = request.pointsMm
  const axis = edge.x === inside.x ? 'y' : 'x', along = axis === 'x' ? 'y' : 'x'
  const direction = Math.sign(inside[axis] - edge[axis]), inset = Math.ceil(request.widthMm / 2)
  if (next[along] !== edge[along] || (next[axis] - edge[axis]) * direction <= inset) {
    return { ok: false, issues: [{ code: 'INTERIOR_EDGE_APPROACH', message: '入口净宽带须从地图边缘正向穿过外门。' }] }
  }
  const start = { ...edge, [axis]: edge[axis] + direction * inset }
  const inward = checkTerrainRoute(document, { ...request, pointsMm: [start, ...request.pointsMm.slice(1)] })
  if (!inward.ok || request.widthMm % 2 === 0) return inward
  return checkTerrainTravel(document, { floorId: request.floorId, from: edge, to: start, widthMm: request.widthMm })
}
