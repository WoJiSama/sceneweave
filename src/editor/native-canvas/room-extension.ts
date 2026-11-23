import { roomMoveParts, roomOwnsWall } from '../../shared/commands/building'
import { effectiveLayerLocked } from '../../shared/commands/layers'
import { distanceToSegment } from '../../shared/geometry/geometry'
import type { PointMm, SceneDocument } from '../../shared/model/scene'

export interface ExtensionWall {
  id: string
  label: string
  start: PointMm
  end: PointMm
  outward: PointMm
  thicknessMm: number
}

export interface RoomExtensionDraft {
  kind: 'extension'
  document: SceneDocument
  layerId: string
  roomId: string
  walls: ExtensionWall[]
  wall: ExtensionWall | null
  depthMm: number
  purpose: string
}

export function startRoomExtension(scene: SceneDocument, selected: string, hidden: ReadonlySet<string>, layerId = scene.entityLayers[selected]): RoomExtensionDraft {
  const selectedWall = scene.walls[selected]
  const owners = selectedWall ? Object.values(scene.rooms).filter(room => room.floorId === selectedWall.floorId && roomOwnsWall(room, selectedWall)) : []
  const room = selectedWall ? owners.length === 1 ? owners[0] : undefined : scene.rooms[selected]
  if (!room) throw new Error('请从一间房的外墙扩建。共墙两侧已经有房间。')
  if (hidden.has(room.id) || room.editLocked || effectiveLayerLocked(scene, room.id)) throw new Error('请先显示房间并解除房间和图层的编辑锁。')
  const parts = roomMoveParts(scene, room.id)
  const shared = new Set(parts.sharedWalls.map(wall => wall.id))
  const walls: ExtensionWall[] = []
  // Validated room boundaries have positive winding. Follow the room even when
  // the stored wall endpoints run in the opposite direction.
  for (const [index, from] of room.boundaryVertexIds.entries()) {
    const to = room.boundaryVertexIds[(index + 1) % room.boundaryVertexIds.length]
    const wall = parts.walls.find(row => (row.startVertexId === from && row.endVertexId === to) || (row.startVertexId === to && row.endVertexId === from))
    if (!wall || shared.has(wall.id) || hidden.has(wall.id) || wall.editLocked || effectiveLayerLocked(scene, wall.id)) continue
    const a = scene.vertices[from], b = scene.vertices[to]
    const dx = b.xMm - a.xMm, dy = b.yMm - a.yMm, length = Math.hypot(dx, dy)
    const outward = { x: dy / length, y: -dx / length }
    const side = Math.abs(outward.x) > Math.abs(outward.y) ? (outward.x > 0 ? '右' : '左') : (outward.y > 0 ? '下' : '上')
    walls.push({ id: wall.id, label: `${side}侧外墙 · 第 ${index + 1} 段`, start: { x: a.xMm, y: a.yMm }, end: { x: b.xMm, y: b.yMm }, outward, thicknessMm: wall.thicknessMm })
  }
  const wall = walls.find(row => row.id === selected) ?? null
  if (!walls.length || (selectedWall && !wall)) throw new Error('请选一段可见、可编辑的外墙。')
  return { kind: 'extension', document: scene, layerId, roomId: room.id, walls, wall, depthMm: 3000, purpose: '相邻房间' }
}

export function extensionWallAt(walls: ExtensionWall[], point: PointMm, toleranceMm: number): ExtensionWall | undefined {
  let nearest: ExtensionWall | undefined, best = Infinity
  for (const wall of walls) {
    const distance = distanceToSegment(point, wall.start, wall.end)
    if (distance <= Math.max(toleranceMm, wall.thicknessMm / 2) && distance < best) { nearest = wall; best = distance }
  }
  return nearest
}

export function extensionDepth(wall: ExtensionWall, point: PointMm, snapMm: number): number {
  const distance = (point.x - wall.start.x) * wall.outward.x + (point.y - wall.start.y) * wall.outward.y
  return Math.max(0, Math.round(distance / snapMm) * snapMm)
}

export function extensionBoundary(wall: ExtensionWall, depthMm: number): PointMm[] {
  const dx = Math.round(wall.outward.x * depthMm), dy = Math.round(wall.outward.y * depthMm)
  return [wall.end, wall.start, { x: wall.start.x + dx, y: wall.start.y + dy }, { x: wall.end.x + dx, y: wall.end.y + dy }]
}
