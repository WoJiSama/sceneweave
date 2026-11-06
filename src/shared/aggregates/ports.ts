import { z } from 'zod'
import type { AggregateEntityRef, AggregatePort, AggregatePortGeometry } from '../model/aggregate.js'
import type { PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import { openingEndpoints, pointOnSurface } from '../geometry/geometry.js'
import { connectionCenterline } from '../geometry/connection-route.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
export const aggregatePortEndpointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('opening'), id }).strict(),
  z.object({ kind: z.literal('path'), id, end: z.enum(['start', 'end']) }).strict(),
  z.object({ kind: z.literal('terrainConnection'), id, end: z.enum(['from', 'to']) }).strict(),
])
export const aggregatePortGeometryRequestSchema = z.object({
  id, groupId: id, endpoint: aggregatePortEndpointSchema,
}).strict()

type CheckedEndpoint = z.infer<typeof aggregatePortEndpointSchema>
type CheckedPort = AggregatePort
const key = (ref: AggregateEntityRef) => JSON.stringify([ref.kind, ref.id])
const owns = <T>(rows: Record<string, T>, id: string): boolean => Object.hasOwn(rows, id)
const normalizeDegrees = (degrees: number): number => (degrees % 360 + 360) % 360
function directionDegrees(from: PointMm, to: PointMm): number {
  if (from.x === to.x && from.y === to.y) throw new Error('端口方向缺少非零实际切线。')
  return normalizeDegrees(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI)
}
function surfaceElevation(scene: SceneDocument, ref: SurfaceRef): number {
  if (ref.kind === 'floor') {
    if (!owns(scene.floors, ref.id)) throw new Error(`端口支撑Floor不存在：${ref.id}。`)
    return 0
  }
  const surface = ref.kind === 'room'
    ? owns(scene.rooms, ref.id) ? scene.rooms[ref.id] : undefined
    : owns(scene.terrainAreas, ref.id) ? scene.terrainAreas[ref.id] : undefined
  if (!surface) throw new Error(`端口支撑面不存在：${ref.id}。`)
  return surface.groundElevationMm
}
function sameSurface(a: SurfaceRef, b: SurfaceRef): boolean { return a.kind === b.kind && a.id === b.id }

function portGroupMember(scene: SceneDocument, port: CheckedPort, kind: AggregateEntityRef['kind'], entityId: string): void {
  const state = scene.aggregateCoordinates
  if (!state || state.encoding !== 'world') throw new Error('派生端口须使用具有聚合归属的完整世界场景。')
  const groups = state.groups
  if (!owns(groups, port.groupId)) throw new Error(`端口所属聚合体不存在：${port.groupId}。`)
  const visited = new Set<string>(), descendants = new Set<string>(), pending = [port.groupId]
  while (pending.length) {
    const groupId = pending.pop()!
    if (visited.has(groupId)) throw new Error('端口所属聚合体存在环。')
    visited.add(groupId); descendants.add(groupId)
    for (const group of Object.values(groups)) if (group.parentId === groupId) pending.push(group.id)
  }
  const ref = { kind, id: entityId }, owners: string[] = []
  for (const group of Object.values(groups)) if (group.members.some(member => key(member) === key(ref))) owners.push(group.id)
  if (owners.length !== 1 || !descendants.has(owners[0])) throw new Error('端口端点须是本组或子组唯一持有的实际实体。')
}

function adjacentRoomDirection(scene: SceneDocument, groupId: string, wallId: string): { directionDeg: number; roomId: string } {
  const groups = scene.aggregateCoordinates!.groups, descendants = new Set<string>(), pending = [groupId]
  while (pending.length) {
    const id = pending.pop()!
    if (descendants.has(id)) continue
    descendants.add(id)
    for (const group of Object.values(groups)) if (group.parentId === id) pending.push(group.id)
  }
  const wall = scene.walls[wallId], wallEnds = new Set([wall.startVertexId, wall.endVertexId])
  const candidates = Object.values(scene.rooms).flatMap(room => {
    const roomOwner = Object.values(groups).find(group => group.members.some(member => member.kind === 'room' && member.id === room.id))
    if (!roomOwner || !descendants.has(roomOwner.id)) return []
    const index = room.boundaryVertexIds.findIndex((vertexId, i, ring) => wallEnds.has(vertexId) && wallEnds.has(ring[(i + 1) % ring.length]) && vertexId !== ring[(i + 1) % ring.length])
    if (index < 0) return []
    const a = room.boundaryVertexIds[index], b = room.boundaryVertexIds[(index + 1) % room.boundaryVertexIds.length]
    return [{ room, sameDirection: a === wall.startVertexId && b === wall.endVertexId }]
  })
  if (candidates.length !== 1) throw new Error('开口端口必须有且仅有一个本聚合内相邻房间，以确定朝外方向与高程。')
  // Valid room rings are consistently wound. Their interior is on the left;
  // orient the exit normal from the stable wall direction, never a rounded centroid.
  const { room, sameDirection } = candidates[0]
  const start = scene.vertices[wall.startVertexId], end = scene.vertices[wall.endVertexId]
  const dx = end.xMm - start.xMm, dy = end.yMm - start.yMm, length = Math.hypot(dx, dy)
  if (!length) throw new Error('开口端口附着墙为零长。')
  const interiorLeft = sameDirection
  const outward = interiorLeft ? { x: dy, y: -dx } : { x: -dy, y: dx }
  return { directionDeg: directionDegrees({ x: 0, y: 0 }, outward), roomId: room.id }
}

function pathEndpoint(scene: SceneDocument, pathId: string, end: 'start' | 'end') {
  const path = scene.paths[pathId], index = end === 'start' ? 0 : path.centerlineMm.length - 1
  const adjacent = end === 'start' ? 1 : index - 1, positionMm = path.centerlineMm[index], interior = path.centerlineMm[adjacent]
  const directionDeg = directionDegrees(positionMm, { x: positionMm.x + (positionMm.x - interior.x), y: positionMm.y + (positionMm.y - interior.y) })
  const delta = { x: interior.x - positionMm.x, y: interior.y - positionMm.y }, length = Math.hypot(delta.x, delta.y)
  const probe = { x: positionMm.x + delta.x / length * Math.min(1, length / 2), y: positionMm.y + delta.y / length * Math.min(1, length / 2) }
  const supports = path.supportRefs.filter(ref => pointOnSurface(scene, probe, ref, path.floorId))
  if (supports.length !== 1) throw new Error('路径端口端点必须能从实际中心线唯一解析到一个有效支撑面。')
  const route = checkTerrainRoute(scene, { floorId: path.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm })
  return { positionMm, directionDeg, widthMm: path.widthMm, floorId: path.floorId, supportRefs: supports,
    elevationMm: surfaceElevation(scene, supports[0]), structuralConnection: true, currentlyPassable: route.ok }
}

function connectionEndpoint(scene: SceneDocument, connectionId: string, end: 'from' | 'to') {
  const connection = scene.terrainConnections[connectionId], points = connectionCenterline(connection)
  if (points.length < 2) throw new Error('高差连接端口缺少完整中心线。')
  const index = end === 'from' ? 0 : points.length - 1, tangentIndex = end === 'from' ? 1 : points.length - 2
  const positionMm = points[index], next = points[tangentIndex]
  // Both ends expose a direction away from the connector and into their surface.
  const directionDeg = directionDegrees(next, positionMm)
  const endpoint = connection[end], elevationMm = surfaceElevation(scene, endpoint.surfaceRef)
  const opposite = connection[end === 'from' ? 'to' : 'from']
  const oppositeElevation = surfaceElevation(scene, opposite.surfaceRef)
  if (elevationMm === oppositeElevation || sameSurface(endpoint.surfaceRef, opposite.surfaceRef)) throw new Error('高差连接端口要求两个不同且高程不同的真实支撑面。')
  const route = checkTerrainRoute(scene, { floorId: connection.floorId, pointsMm: points, widthMm: connection.widthMm })
  return { positionMm, directionDeg, widthMm: connection.widthMm, floorId: connection.floorId,
    supportRefs: [endpoint.surfaceRef], elevationMm, structuralConnection: true, currentlyPassable: route.ok }
}

/**
 * Derive an aggregate port from a detached, fully validated world scene and an
 * endpoint-only binding. Returned facts never come from caller geometry claims.
 * Passability is current local geometry/state for a path or height connection;
 * it does not claim whole-map reachability.
 */
export function deriveAggregatePortGeometry(sceneInput: unknown, portInput: unknown): AggregatePortGeometry {
  const sceneResult = validateSceneDocument(sceneInput)
  if (!sceneResult.ok) throw new Error(`端口来源场景无效：${sceneResult.errors.map(issue => issue.message).join('；')}`)
  const scene = sceneResult.document, port = aggregatePortGeometryRequestSchema.parse(captureJson(portInput)) as CheckedPort
  if (!scene.aggregateCoordinates) throw new Error('派生端口须绑定真实聚合体所有权。')
  let geometry: AggregatePortGeometry
  const endpoint: CheckedEndpoint = port.endpoint
  if (endpoint.kind === 'opening') {
    const opening = scene.openings[endpoint.id]
    if (!opening) throw new Error(`开口端口实体不存在：${endpoint.id}。`)
    portGroupMember(scene, port, 'opening', opening.id)
    const wall = scene.walls[opening.wallId]
    if (!wall) throw new Error('开口端口缺少真实附着墙。')
    const [start, finish] = openingEndpoints(scene, opening)
    const center = { x: (start.x + finish.x) / 2, y: (start.y + finish.y) / 2 }
    const orientation = adjacentRoomDirection(scene, port.groupId, wall.id)
    const room = scene.rooms[orientation.roomId]
    geometry = { floorId: opening.floorId, positionMm: center, directionDeg: orientation.directionDeg,
      widthMm: opening.widthMm, elevationMm: room.groundElevationMm, supportRefs: [{ kind: 'room', id: room.id }],
      structuralConnection: opening.kind === 'door', currentlyPassable: opening.kind === 'door' && opening.state === 'open' && !opening.locked }
  } else if (endpoint.kind === 'path') {
    const path = scene.paths[endpoint.id]
    if (!path) throw new Error(`路径端口实体不存在：${endpoint.id}。`)
    portGroupMember(scene, port, 'path', path.id)
    geometry = pathEndpoint(scene, path.id, endpoint.end)
  } else {
    const connection = scene.terrainConnections[endpoint.id]
    if (!connection) throw new Error(`高差连接端口实体不存在：${endpoint.id}。`)
    portGroupMember(scene, port, 'terrainConnection', connection.id)
    geometry = connectionEndpoint(scene, connection.id, endpoint.end)
  }
  return freezeJson(geometry)
}
