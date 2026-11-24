import { createPrefabTransform } from '../commands/base.js'
import type { SceneCommand } from '../commands/commands.js'
import { scenePresentation } from '../appearance/presentation.js'
import { propFootprint } from '../geometry/geometry.js'
import { furnitureRoom, sameFurniturePlacement, type FurnitureRoomQuery } from '../geometry/furniture-room.js'
import type { SceneDocument } from '../model/scene.js'

/** Plain in-room moves retain the existing position-only command and fast path. */
export function planFurnitureMove(scene: SceneDocument, command: SceneCommand, query: FurnitureRoomQuery): SceneCommand {
  if (command.type !== 'updateProp' && command.type !== 'transformPrefab') return command
  const group = command.type === 'transformPrefab' ? scene.prefabInstances[command.id] : undefined
  const props = group ? Object.values(group.members).flatMap(m => m.propId ? [scene.props[m.propId]] : []) : [scene.props[command.id]]
  const first = props[0]
  if (!first) return command
  const positionMm = command.type === 'updateProp' ? command.changes.positionMm : command.anchorMm
  const rotationDeg = command.type === 'updateProp' ? command.changes.rotationDeg : command.rotationDeg
  const start = group?.anchorMm ?? first.positionMm, end = positionMm ?? start
  if (start.x === end.x && start.y === end.y && (rotationDeg === undefined || rotationDeg === (group?.rotationDeg ?? first.rotationDeg))) return command
  const pose = group && createPrefabTransform(group, end, rotationDeg ?? group.rotationDeg)
  const footprints = props.map(prop => propFootprint({ ...prop, ...(pose
    ? pose(prop, scenePresentation(scene, prop.id)?.mode === 'nearSide')
    : { positionMm: end, rotationDeg: rotationDeg ?? prop.rotationDeg }) }))
  const placement = query(footprints, first)
  const uniform = props.every(prop => sameFurniturePlacement(prop, first))
  if (uniform) {
    if (sameFurniturePlacement(placement, first)) return command
    if (!furnitureRoom(first) && placement.roomId && query(props.map(propFootprint), first).roomId === placement.roomId) return command
  } else {
    // A set assembled by hand can start on several surfaces. Rehome the
    // whole set only when those original placements agree on the destination.
    const checked = new Set<string>()
    for (const prop of props) {
      if (sameFurniturePlacement(prop, first)) continue
      const key = JSON.stringify([prop.supportRef.kind, prop.supportRef.id, furnitureRoom(prop)])
      if (checked.has(key)) continue
      if (!sameFurniturePlacement(query(footprints, prop), placement)) return command
      checked.add(key)
    }
  }
  // A local adjustment on a tabletop or wall face keeps that anchor and
  // room. The attachment validator checks that the new pose still fits.
  if (!group && Object.values(scene.attachments ?? {}).some(row => row.child.kind === 'prop' && row.child.id === first.id)) return command
  return { type: 'moveRoomFurniture', id: command.id, positionMm: end, ...(rotationDeg !== undefined ? { rotationDeg } : {}), ...placement }
}
