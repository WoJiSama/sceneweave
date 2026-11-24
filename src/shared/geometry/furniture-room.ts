import type { PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import { z } from 'zod'
import { id, angle, point, surfaceRef } from '../validation/primitives.js'
import { polygonInside, polygonsOverlap, roomPoints } from './geometry.js'

export interface FurniturePlacement { supportRef: SurfaceRef; roomId?: string }
export const moveRoomFurnitureSchema = z.object({ type: z.literal('moveRoomFurniture'), id, positionMm: point,
  rotationDeg: angle.optional(), supportRef: surfaceRef, roomId: id.optional() }).strict()
export type MoveRoomFurniture = z.infer<typeof moveRoomFurnitureSchema>

export function furnitureRoom(prop: FurniturePlacement): string | undefined {
  return prop.roomId ?? (prop.supportRef.kind === 'room' ? prop.supportRef.id : undefined)
}

export function sameFurniturePlacement(a: FurniturePlacement, b: FurniturePlacement): boolean {
  return a.supportRef.kind === b.supportRef.kind && a.supportRef.id === b.supportRef.id && furnitureRoom(a) === furnitureRoom(b)
}

/** Prepare room outlines once per floor/gesture. Only the moved footprints are queried. */
export function createFurnitureRoomQuery(scene: SceneDocument, floorId: string, excluded?: ReadonlySet<string>) {
  const rooms = Object.values(scene.rooms).filter(room => room.floorId === floorId && !excluded?.has(room.id)).map(room => {
    const polygon = roomPoints(scene, room)
    return { room, polygon, left: Math.min(...polygon.map(p => p.x)), right: Math.max(...polygon.map(p => p.x)),
      top: Math.min(...polygon.map(p => p.y)), bottom: Math.max(...polygon.map(p => p.y)) }
  })
  return (footprints: PointMm[][], previous: FurniturePlacement = { supportRef: { kind: 'floor', id: floorId } }): FurniturePlacement => {
    if (!footprints.length) return previous
    const oldRoom = furnitureRoom(previous), base = previous.supportRef.kind === 'room' ? scene.rooms[previous.supportRef.id].supportRef : previous.supportRef
    // A prop on a specific terrain surface (e.g. an upper deck) keeps that
    // physical surface when a room on another surface overlaps in plan.
    const matches = rooms.filter(({ room, polygon, left, right, top, bottom }) =>
      (previous.supportRef.kind !== 'terrainArea' || room.supportRef.kind === 'terrainArea' && room.supportRef.id === base.id)
      && footprints.every(shape => shape.every(p => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) && polygonInside(shape, polygon)))
    if (matches.length === 1) {
      const roomId = matches[0].room.id
      return { supportRef: { kind: 'room', id: roomId }, roomId }
    }
    if (matches.length > 1) return previous
    const previousRoom = oldRoom && scene.rooms[oldRoom]
    if (previousRoom) {
      const polygon = roomPoints(scene, previousRoom)
      if (excluded?.has(previousRoom.id) && footprints.every(shape => polygonInside(shape, polygon))) return previous
      // Across a threshold the floor carries the footprint; the old room still owns it.
      if (footprints.some(shape => polygonsOverlap(shape, polygon))) return { supportRef: base, roomId: previousRoom.id }
    }
    return { supportRef: base }
  }
}

export type FurnitureRoomQuery = ReturnType<typeof createFurnitureRoomQuery>
