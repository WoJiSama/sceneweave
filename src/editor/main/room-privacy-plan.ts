import type { AppearanceGraph } from '../../shared/model/appearance.js'
import type { Room, SceneDocument } from '../../shared/model/scene.js'
import type { SceneCommand } from '../../shared/commands/commands.js'
import { cloneJson } from '../../shared/validation/json.js'
import { roomPoints, pointInPolygon } from '../../shared/geometry/geometry.js'
import { getPlayerCoverageDiagnostics } from '../../shared/projection/projection.js'
import { coverageMaskCommands } from './privacy-mask-plan.js'

export interface RoomPrivacyPlanOptions {
  scene: SceneDocument
  appearance?: AppearanceGraph
  roomId: string
  purpose?: string
  accessExpectation?: Room['accessExpectation']
  secretOpeningIds: readonly string[]
  privateNoteIds: readonly string[]
  nextMaskId: () => string
  layerId?: string
  preservePublicRooms?: boolean
}

const roomWallIds = (scene: SceneDocument, room: Room): Set<string> => new Set(Object.values(scene.walls).filter(wall => room.boundaryVertexIds.some((a, i, ids) => {
  const b = ids[(i + 1) % ids.length]
  return a === wall.startVertexId && b === wall.endVertexId || a === wall.endVertexId && b === wall.startVertexId
})).map(wall => wall.id))

/** Lists available choices; membership never grants authority to modify one. */
export function roomPrivacyChoices(scene: SceneDocument, roomId: string) {
  const room = scene.rooms[roomId]
  if (!room) throw new Error('待设密的房间不存在。')
  const walls = roomWallIds(scene, room), boundary = roomPoints(scene, room)
  const openings = Object.values(scene.openings).filter(opening => opening.floorId === room.floorId && walls.has(opening.wallId))
    .map(opening => ({ id: opening.id, label: `${opening.kind === 'door' ? '门' : '窗'} · ${opening.id}` }))
  const associated = new Set([room.id, ...walls, ...openings.map(opening => opening.id), ...Object.values(scene.props).filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === room.id).map(prop => prop.id)])
  const related = (id: string, seen = new Set<string>()): boolean => {
    const note = scene.notes[id]
    if (!note || note.floorId !== room.floorId || seen.has(id)) return false
    if (note.anchor.type === 'point') return pointInPolygon(note.anchor.positionMm, boundary, true)
    if (note.anchor.entityKind !== 'note') return associated.has(note.anchor.entityId)
    return related(note.anchor.entityId, new Set([...seen, id]))
  }
  const notes = Object.values(scene.notes).filter(note => related(note.id)).map(note => ({ id: note.id, label: note.title || note.text.slice(0, 80) || note.id }))
  return { openings, notes }
}

/** Plans one normal atomic command batch; the workspace remains responsible
 * for complete candidate validation, locks, budgets, baseline and adoption. */
export function planRoomPrivacy(options: RoomPrivacyPlanOptions) {
  const { scene, appearance, roomId, nextMaskId, layerId } = options, room = scene.rooms[roomId]
  if (!room) throw new Error('待设密的房间不存在。')
  const choices = roomPrivacyChoices(scene, roomId)
  const checkChoices = (ids: readonly string[], allowed: { id: string }[], label: string) => {
    if (new Set(ids).size !== ids.length || ids.some(id => !allowed.some(row => row.id === id))) throw new Error(`只能明确选择本房间关联的${label}。`)
  }
  checkChoices(options.secretOpeningIds, choices.openings, '门窗')
  checkChoices(options.privateNoteIds, choices.notes, '注记')
  // Do not silently repair unrelated invalid content while changing one room.
  const priorIssues = getPlayerCoverageDiagnostics(scene, appearance, { floorId: room.floorId })
  if (priorIssues.length) throw new Error('本楼层已有未覆盖的私密内容，请先修复原有覆盖，再设置此房间。')
  const changes = { purpose: options.purpose ?? room.purpose, accessExpectation: options.accessExpectation ?? room.accessExpectation, visibility: 'gm' as const }
  const commands: SceneCommand[] = [{ type: 'updateRoom', id: roomId, changes }]
  const draft = cloneJson(scene)
  Object.assign(draft.rooms[roomId], changes)
  for (const id of options.secretOpeningIds) {
    commands.push({ type: 'updateOpening', id, changes: { secret: true, revealed: false } })
    Object.assign(draft.openings[id], { secret: true, revealed: false })
  }
  for (const id of options.privateNoteIds) {
    commands.push({ type: 'updateNote', id, changes: { visibility: 'gm' } })
    draft.notes[id].visibility = 'gm'
  }
  const coverageIssues = getPlayerCoverageDiagnostics(draft, appearance, { floorId: room.floorId })
  const masks = coverageMaskCommands(coverageIssues, room.floorId, layerId, nextMaskId, undefined, options.preservePublicRooms ?? true)
  const maskIds = new Set(masks.map(mask => mask.id))
  if (maskIds.size !== masks.length || [...maskIds].some(id => !id || Object.hasOwn(scene.entityLayers, id))) {
    throw new Error('新增遮罩须使用未占用的新对象编号。')
  }
  return { commands: [...commands, ...masks], coverageIssues, description: '设置秘密房间与选定的入口和线索，补齐玩家遮罩' }
}
