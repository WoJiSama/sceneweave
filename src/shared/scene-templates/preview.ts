import type { PointMm, SceneDocument } from '../model/scene.js'
import { polygonsOverlap, propFootprint, roomPoints, terrainPoints } from '../geometry/geometry.js'
import { wallEnvelopePolygons } from '../geometry/doorway-clearance.js'
import type { SceneTemplatePlacement } from './content.js'

export interface SceneTemplateSketch {
  rooms: { purpose: string; points: PointMm[] }[]
  props: PointMm[][]
  walls: PointMm[][]
  bridgeDecks?: PointMm[][]
  widthMm: number; heightMm: number
}
/** Display metadata derives from the actual cold-validated template, never from
 * a caller label, embedded thumbnail or a future authority to adopt it. */
export function describeSceneTemplate(scene: SceneDocument): SceneTemplateSketch {
  const rooms = Object.values(scene.rooms).map(room => ({ purpose: room.purpose, points: roomPoints(scene, room) }))
  const bridgeDecks = Object.values(scene.paths).flatMap(path => path.assembly?.bridge ? [terrainPoints(scene.terrainAreas[path.assembly.bridge.deckId])] : [])
  const points = [...rooms.flatMap(room => room.points), ...bridgeDecks.flat()]
  return { rooms, props: Object.values(scene.props).filter(prop => prop.blocksMovement).map(propFootprint), walls: wallEnvelopePolygons(scene).map(row => row.polygon),
    ...(bridgeDecks.length ? { bridgeDecks } : {}),
    widthMm: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), heightMm: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) }
}
export function sceneTemplatePlacementSketch(scene: SceneDocument, source: SceneTemplateSketch, placement: SceneTemplatePlacement) {
  const transform = (p: PointMm) => {
    const x = p.x - 5000, y = p.y - 5000, turns = placement.quarterTurns
    return { x: placement.anchorMm.x + (turns === 0 ? x : turns === 1 ? -y : turns === 2 ? -x : y), y: placement.anchorMm.y + (turns === 0 ? y : turns === 1 ? x : turns === 2 ? -y : -x) }
  }
  const rooms = source.rooms.map(room => room.points.map(transform)), props = source.props.map(poly => poly.map(transform)), walls = source.walls.map(poly => poly.map(transform)), issues: string[] = []
  const decks = source.bridgeDecks?.map(poly => poly.map(transform)) ?? [], polygons = [...rooms, ...decks]
  const floor = scene.floors[placement.floorId], layer = scene.userLayers[placement.layerId]
  if (!floor || !layer || layer.floorId !== placement.floorId || layer.editLocked) issues.push('目标楼层或图层不可用／已锁定。')
  if (floor && polygons.flat().some(p => p.x < floor.boundsMm.x || p.y < floor.boundsMm.y || p.x > floor.boundsMm.x + floor.boundsMm.width || p.y > floor.boundsMm.y + floor.boundsMm.height)) issues.push(decks.length ? '桥面超出当前楼层范围。' : '房间超出当前楼层范围。')
  const existingRooms = Object.values(scene.rooms).filter(room => room.floorId === placement.floorId).map(room => roomPoints(scene, room))
  if (rooms.some(poly => existingRooms.some(other => polygonsOverlap(poly, other)))) issues.push('与现有房间重叠。')
  const existingProps = Object.values(scene.props).filter(prop => prop.floorId === placement.floorId && prop.blocksMovement).map(propFootprint)
  const existingWalls = wallEnvelopePolygons(scene).filter(row => row.floorId === placement.floorId).map(row => row.polygon)
  if ([...props, ...walls].some(poly => existingProps.some(other => polygonsOverlap(poly, other))) || props.some(poly => existingWalls.some(other => polygonsOverlap(poly, other)))) issues.push('家具或墙与现有阻挡对象冲突。')
  return { polygons, issues }
}
