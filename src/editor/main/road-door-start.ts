import type { PointMm, SceneDocument, SurfaceRef } from '../../shared/model/scene.js'
import { resolveBuildingEntrancePort } from '../../shared/generation/building-port.js'
import { createEntityLabeler } from './entity-label.js'

export interface RoadDoorStartRequest { document: SceneDocument; openingId: string; widthMm: number }
export interface RoadDoorStart {
  openingId: string
  floorId: string
  widthMm: number
  supportRefs: SurfaceRef[]
  visibility: 'public'
  point: PointMm
  directionDeg: number
  dependencyIds: string[]
}
export interface RoadDoorStartInput { id: string; document: SceneDocument; start: RoadDoorStart }

/** Read-only preparation. The workspace still owns its current checkpoint,
 * draft guard, target layer and one-time handoff to the ordinary road tool. */
export function prepareRoadDoorStart(document: SceneDocument, request: RoadDoorStartRequest, excludedEntityIds?: ReadonlySet<string>): RoadDoorStart {
  if (request.document !== document) throw new Error('接路所依据的工程已改变，请重新选择当前门口。')
  const port = resolveBuildingEntrancePort(document, request.openingId, request.widthMm)
  const opening = document.openings[port.openingId], wall = document.walls[opening.wallId], room = document.rooms[port.roomId]
  const dependencyIds = [...new Set([opening.id, wall.id, wall.startVertexId, wall.endVertexId, room.id, ...room.boundaryVertexIds, port.supportRef.id])]
  const name = createEntityLabeler(document)
  for (const id of dependencyIds) {
    if (excludedEntityIds?.has(id)) throw new Error(`门口接路涉及当前隐藏或不在编辑范围的${name(id)}，请先显示对应对象。`)
    const entity = document.openings[id] ?? document.walls[id] ?? document.vertices[id] ?? document.rooms[id] ?? document.terrainAreas[id]
    if (!entity || entity.floorId !== port.floorId) throw new Error('门口接路的实际支撑或建筑依赖已失效，请重新选择。')
    const layer = document.userLayers[document.entityLayers[id]]
    if (entity.editLocked || layer?.editLocked) throw new Error(`门口接路涉及已锁定的${name(id)}${layer?.editLocked ? `（图层 ${layer.name}）` : ''}，请先解除对应编辑锁。`)
  }
  return { openingId: opening.id, floorId: port.floorId, widthMm: port.widthMm, supportRefs: [{ ...port.supportRef }], visibility: 'public',
    point: { ...port.outsideMm }, directionDeg: port.directionDeg, dependencyIds }
}
