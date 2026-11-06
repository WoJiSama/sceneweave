import type { AggregateEntityRef } from '../model/aggregate.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { corridor, openingEndpoints, pathPolygon, polygonsOverlap, propFootprint, roomPoints } from '../geometry/geometry.js'
import { wallMovementPolygons } from '../geometry/doorway-clearance.js'

interface Shape { entityId: string; floorId: string; polygon: PointMm[] }

/** Finite cross-boundary checks on the detached, transformed complete scene.
 * The command owner must first prove the exact connected-building membership,
 * including that no wall endpoint is shared with a wall outside this subtree.
 * Internal arrangements retain their existing semantics. This neither certifies
 * the scene nor claims a general path search or whole-map movement result. */
export function assertAggregateBuildingClearance(scene: SceneDocument, members: readonly AggregateEntityRef[]): void {
  const owned = new Map<AggregateEntityRef['kind'], Set<string>>()
  for (const member of members) {
    const ids = owned.get(member.kind) ?? new Set<string>()
    ids.add(member.id); owned.set(member.kind, ids)
  }
  const includes = (kind: AggregateEntityRef['kind'], id: string) => owned.get(kind)?.has(id) ?? false
  const walls = (moving: boolean): Shape[] => wallMovementPolygons({ ...scene,
    walls: Object.fromEntries(Object.entries(scene.walls).filter(([id]) => includes('wall', id) === moving)),
  }, false)
  // Joins must be constructed before collision tests, with every same-side
  // neighbour present. Structural mode retains each actual door aperture even
  // when its current leaf is closed/locked; the operation never changes state.
  const movedWalls = walls(true), staticWalls = walls(false)
  const movedRooms: Shape[] = Object.values(scene.rooms).filter(room => includes('room', room.id))
    .map(room => ({ entityId: room.id, floorId: room.floorId, polygon: roomPoints(scene, room) }))
  const propShapes = (moving: boolean): Shape[] => Object.values(scene.props)
    .filter(prop => prop.blocksMovement && includes('prop', prop.id) === moving)
    .map(prop => ({ entityId: prop.id, floorId: prop.floorId, polygon: propFootprint(prop) }))
  const movedProps = propShapes(true), staticProps = propShapes(false)
  const staticRegions: Shape[] = Object.values(scene.regions).filter(region => region.blocksMovement && !includes('region', region.id))
    .map(region => ({ entityId: region.id, floorId: region.floorId, polygon: region.boundaryMm }))
  const staticBlockers = [...staticProps, ...staticRegions, ...staticWalls]
  const rejectOverlap = (subject: Shape, obstacle: Shape, subjectLabel: string) => {
    if (subject.floorId === obstacle.floorId && polygonsOverlap(subject.polygon, obstacle.polygon)) {
      throw new Error(`整栋变换的${subjectLabel} ${subject.entityId} 与外部对象 ${obstacle.entityId} 的实际带区或阻挡占地冲突。`)
    }
  }
  for (const subject of [...movedRooms, ...movedWalls, ...movedProps]) {
    for (const obstacle of staticBlockers) rejectOverlap(subject, obstacle, '成员')
  }
  for (const path of Object.values(scene.paths)) {
    const shape = { entityId: path.id, floorId: path.floorId, polygon: pathPolygon(path) }
    const moving = includes('path', path.id)
    for (const obstacle of moving ? staticBlockers : [...movedWalls, ...movedProps]) {
      rejectOverlap(shape, obstacle, moving ? '路线' : '外部路线')
    }
  }
  // The finite approach is identical to the supported building entrance depth:
  // full wall half-thickness plus one half-door width and one millimetre. Only
  // outside blockers are examined, so existing interior furnishing is retained.
  for (const opening of Object.values(scene.openings)) {
    if (opening.kind !== 'door' || !includes('opening', opening.id)) continue
    const wall = scene.walls[opening.wallId], [start, end] = openingEndpoints(scene, opening)
    const depth = Math.ceil(wall.thicknessMm / 2) + Math.ceil(opening.widthMm / 2) + 1
    const approach = { entityId: opening.id, floorId: opening.floorId, polygon: corridor(start, end, depth * 2) }
    for (const obstacle of staticBlockers) rejectOverlap(approach, obstacle, '门前净空')
  }
}
