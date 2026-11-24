import { furnitureRoom } from '../geometry/furniture-room.js'
import type { SceneDocument } from '../model/scene.js'
import { isCertifiedSceneSnapshot } from '../validation/snapshots.js'

const indexes = new WeakMap<SceneDocument, Map<string, string[]>>()

/** Only an exact validator-owned snapshot can share its room index across reads. */
export function roomFurnitureIds(scene: SceneDocument, rooms: ReadonlySet<string>): string[] {
  if (!rooms.size) return []
  const canReuseIndex: boolean = isCertifiedSceneSnapshot(scene)
  if (!canReuseIndex) {
    const ids: string[] = []
    for (const prop of Object.values(scene.props)) {
      const room = furnitureRoom(prop)
      if (room && rooms.has(room)) ids.push(prop.id)
    }
    return ids
  }
  let index = indexes.get(scene)
  if (!index) {
    index = new Map()
    for (const prop of Object.values(scene.props)) {
      const room = furnitureRoom(prop)
      if (!room) continue
      const ids = index.get(room)
      if (ids) ids.push(prop.id)
      else index.set(room, [prop.id])
    }
    indexes.set(scene, index)
  }
  return [...rooms].flatMap(room => index.get(room) ?? [])
}
