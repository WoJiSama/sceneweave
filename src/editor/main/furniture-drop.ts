import { propTopSnap } from '../../shared/attachments/prop-top-snap'
import type { FurnitureRoomQuery } from '../../shared/geometry/furniture-room'
import { propFootprint, roomPoints } from '../../shared/geometry/geometry'
import type { PointMm, Prop, SceneDocument } from '../../shared/model/scene'

export function furnitureDrop(scene: SceneDocument, source: Prop, positionMm: PointMm, automatic: boolean, query: FurnitureRoomQuery, excluded: ReadonlySet<string>) {
  const prop = { ...source, positionMm }
  const support = automatic ? query([propFootprint(prop)]).supportRef : prop.supportRef
  const top = automatic && Object.keys(scene.attachmentSurfaces ?? {}).length
    ? propTopSnap(scene, prop, positionMm, excluded, support.kind === 'room' ? support : undefined) : undefined
  prop.supportRef = top?.supportRef ?? support
  if (prop.supportRef.kind === 'room') prop.roomId = prop.supportRef.id
  else delete prop.roomId
  if (top) prop.positionMm = top.positionMm
  return { prop, top, roomOutline: prop.roomId ? roomPoints(scene, scene.rooms[prop.roomId]) : undefined }
}
