import type { PointMm, SceneDocument } from '../model/scene.js'
import { pathPolygon, pointInPolygon, roomPoints, supportedPolygon } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { validateSceneDocument } from '../validation/scene.js'

export interface BuildingEntrancePort {
  openingId: string; roomId: string; floorId: string
  supportRef: { kind: 'terrainArea'; id: string }
  elevationMm: number; positionMm: PointMm; directionDeg: number
  insideMm: PointMm; outsideMm: PointMm; widthMm: number
}

/** Adapt one actual exterior doorway to a finite outdoor port. This is a
 * read-only geometry fact, never a persistent requirement to retain the door. */
export function resolveBuildingEntrancePort(document: SceneDocument, openingId: string, widthMm: number): BuildingEntrancePort {
  if (!Number.isSafeInteger(widthMm) || widthMm <= 0) throw new Error('建筑入口净宽须为正整数毫米。')
  if (!validateSceneDocument(document).ok) throw new Error('建筑入口须来自合法完整场景。')
  const opening = document.openings[openingId], visible = createPublicVisibility(document)
  if (!opening || opening.kind !== 'door' || opening.state !== 'open' || opening.locked || !visible.opening(openingId)) throw new Error('建筑入口须为真实、公开可见、已打开且未上锁的门。')
  if (opening.widthMm < widthMm) throw new Error('建筑实际门洞净宽不足。')
  const wall = document.walls[opening.wallId]
  const attached = Object.values(document.rooms).flatMap(room => room.boundaryVertexIds.flatMap((id, index, ring) => {
    const next = ring[(index + 1) % ring.length]
    return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId ? [{ room, index }] : []
  }))
  if (attached.length !== 1) throw new Error('建筑外门须恰好附着一个实际房间。')
  const { room, index } = attached[0], ref = room.supportRef
  if (!visible.room(room.id) || ref.kind !== 'terrainArea') throw new Error('建筑外门须使用明确公开的真实地形支撑。')
  const support = document.terrainAreas[ref.id]
  if (!support || support.floorId !== opening.floorId || support.blocksMovement || support.visibility !== 'public' || room.groundElevationMm !== support.groundElevationMm) throw new Error('建筑内外须使用同Floor同高程的可步行地形支撑。')
  const boundary = roomPoints(document, room), a = boundary[index], b = boundary[(index + 1) % boundary.length]
  if (a.x !== b.x && a.y !== b.y) throw new Error('建筑外门端口当前仅支持正交墙。')
  const reference = document.vertices[opening.offsetReferenceVertexId], other = document.vertices[wall.startVertexId === reference.id ? wall.endVertexId : wall.startVertexId]
  const tangent = { x: Math.sign(other.xMm - reference.xMm), y: Math.sign(other.yMm - reference.yMm) }
  // Preserve the exact midpoint; a half-millimetre location cannot be silently
  // rounded into the integer anchors promised by the route contract.
  const distance = opening.offsetMm + opening.widthMm / 2
  const positionMm = { x: reference.xMm + tangent.x * distance, y: reference.yMm + tangent.y * distance }
  const area = boundary.reduce((sum, point, i) => { const next = boundary[(i + 1) % boundary.length]; return sum + BigInt(point.x) * BigInt(next.y) - BigInt(next.x) * BigInt(point.y) }, 0n)
  const sign = area > 0n ? 1 : -1
  const normal = { x: sign * Math.sign(b.y - a.y), y: -sign * Math.sign(b.x - a.x) }
  const depth = Math.ceil(wall.thicknessMm / 2) + Math.ceil(widthMm / 2) + 1
  const outsideMm = { x: positionMm.x + normal.x * depth, y: positionMm.y + normal.y * depth }
  const insideMm = { x: positionMm.x - normal.x * depth, y: positionMm.y - normal.y * depth }
  if (![positionMm, outsideMm, insideMm].every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))) throw new Error('建筑门中点及接入锚点须可精确表达为整数毫米。')
  if (!pointInPolygon(insideMm, boundary, false) || pointInPolygon(outsideMm, boundary)) throw new Error('建筑门前接入深度没有真实室内外落点。')
  const band = pathPolygon({ id: 'building-entrance-check', floorId: opening.floorId, editLocked: false, visibility: 'public', centerlineMm: [outsideMm, insideMm], widthMm,
    supportRefs: [ref], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 })
  if (!supportedPolygon(document, band, ref, opening.floorId)) throw new Error('建筑门前完整净宽须由同一真实地形面支撑，不能跨越其他支撑。')
  return { openingId, roomId: room.id, floorId: opening.floorId, supportRef: { kind: 'terrainArea', id: ref.id }, elevationMm: room.groundElevationMm, positionMm,
    directionDeg: (Math.atan2(normal.y, normal.x) * 180 / Math.PI + 360) % 360, insideMm, outsideMm, widthMm }
}
