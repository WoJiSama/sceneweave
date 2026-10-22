import { z } from 'zod'
import { geometryIdentityIdsV3 } from './domain'
import { orderedLayersV3 } from './layers'
import type { AnchorV2, BoundsMm, Editable, NoteV2, SceneDocumentV3 } from './types'

export type AnnotationCommandV3 =
  | { type: 'createNote'; id: string; floorId: string; anchor: AnchorV2; kind: NoteV2['kind']; title?: string; text: string; visibility: NoteV2['visibility']; discovered?: boolean; layerId?: string }
  | { type: 'updateNote'; id: string; changes: Partial<Pick<NoteV2, 'anchor' | 'kind' | 'title' | 'text' | 'visibility' | 'discovered'>> }
  | { type: 'deleteNote'; id: string }
  | { type: 'upsertManualMask'; id: string; floorId: string; boundsMm: BoundsMm; layerId?: string }
  | { type: 'deleteManualMask'; id: string }

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const int = z.number().finite().refine(Number.isSafeInteger, '坐标必须是安全整数毫米')
const point = z.object({ x: int, y: int }).strict()
const anchor = z.discriminatedUnion('type', [
  z.object({ type: z.literal('point'), positionMm: point }).strict(),
  z.object({ type: z.literal('entity'), entityKind: z.enum(['vertex', 'room', 'wall', 'opening', 'prop', 'region', 'note', 'terrainArea', 'terrainEdge', 'terrainConnection', 'path', 'prefabInstance', 'scatterGroup']), entityId: id }).strict(),
])
const content = { anchor, kind: z.enum(['note', 'clue', 'label']), title: z.string().max(500), text: z.string().max(100_000), visibility: z.enum(['public', 'gm']), discovered: z.boolean() }
export const annotationCommandSchemasV3 = [
  z.object({ type: z.literal('createNote'), id, floorId: id, ...content, title: content.title.optional(), discovered: content.discovered.optional(), layerId: id.optional() }).strict(),
  z.object({ type: z.literal('updateNote'), id, changes: z.object(content).partial().strict() }).strict(),
  z.object({ type: z.literal('deleteNote'), id }).strict(),
  z.object({ type: z.literal('upsertManualMask'), id, floorId: id, boundsMm: z.object({ x: int, y: int, width: int.positive(), height: int.positive() }).strict(), layerId: id.optional() }).strict(),
  z.object({ type: z.literal('deleteManualMask'), id }).strict(),
] as const

export function isAnnotationCommandV3(command: { type: string }): command is AnnotationCommandV3 {
  return ['createNote', 'updateNote', 'deleteNote', 'upsertManualMask', 'deleteManualMask'].includes(command.type)
}
const collections = { vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', prop: 'props', region: 'regions', note: 'notes', terrainArea: 'terrainAreas', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections', path: 'paths', prefabInstance: 'prefabInstances', scatterGroup: 'scatterGroups' } as const
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined

function unlocked(scene: SceneDocumentV3, entities: Editable[]) {
  const affected = new Map(entities.map(entity => [entity.id, entity]))
  let extended = true
  while (extended) {
    extended = false
    for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && affected.has(note.anchor.entityId) && !affected.has(note.id)) { affected.set(note.id, note); extended = true }
    for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) if (!affected.has(group.id) && Object.values(group.members).some(member => member.propId !== null && affected.has(member.propId))) { affected.set(group.id, group); extended = true }
  }
  const locked = [...affected.values()].filter(entity => entity.editLocked || scene.userLayers[scene.entityLayers[entity.id]]?.editLocked)
  if (locked.length) throw new Error(`注记或遮罩涉及锁定实体/图层：${locked.map(entity => entity.id).join('、')}。`)
}
function anchorDependencies(scene: SceneDocumentV3, value: AnchorV2, floorId: string, noteId: string): Editable[] {
  const result: Editable[] = [], visited = new Set([noteId])
  let current = value
  while (current.type === 'entity') {
    if (visited.has(current.entityId)) throw new Error('注记锚点不能形成循环。')
    visited.add(current.entityId)
    const entity = own<Editable>(scene[collections[current.entityKind]], current.entityId)
    if (!entity || entity.floorId !== floorId) throw new Error('注记锚点须为同 Floor 的现存实体。')
    result.push(entity)
    if (current.entityKind !== 'note') break
    current = scene.notes[current.entityId].anchor
  }
  return result
}
function targetLayer(scene: SceneDocumentV3, floorId: string, layerId?: string): string {
  if (!Object.hasOwn(scene.floors, floorId)) throw new Error('注记或遮罩所在 Floor 不存在。')
  const layer = layerId === undefined ? orderedLayersV3(scene, floorId)[0] : own(scene.userLayers, layerId)
  if (!layer || layer.floorId !== floorId || layer.editLocked) throw new Error('请选择同 Floor 且未锁定的用户图层。')
  return layer.id
}
function unusedId(scene: SceneDocumentV3, id: string) {
  if (geometryIdentityIdsV3(scene).has(id) || Object.hasOwn(scene.userLayers, id)) throw new Error(`新增注记或遮罩 ID 已被占用：${id}。`)
}
function rejectReferenced(scene: SceneDocumentV3, id: string) {
  const references = Object.values(scene.notes).filter(note => note.anchor.type === 'entity' && note.anchor.entityId === id)
  if (references.length) throw new Error(`仍被注记引用，不能删除：${references.map(note => note.id).join('、')}。`)
}

/** Internal draft operation. The native command entry validates the complete batch before exposure. */
export function applyAnnotationCommandV3(scene: SceneDocumentV3, command: AnnotationCommandV3): void {
  switch (command.type) {
    case 'createNote': {
      unusedId(scene, command.id)
      const layerId = targetLayer(scene, command.floorId, command.layerId)
      unlocked(scene, anchorDependencies(scene, command.anchor, command.floorId, command.id))
      const { type: _type, layerId: _layerId, ...value } = command
      scene.notes[command.id] = { ...structuredClone(value), editLocked: false }
      scene.entityLayers[command.id] = layerId
      break
    }
    case 'updateNote': {
      const note = own(scene.notes, command.id)
      if (!note) throw new Error('待修改注记不存在。')
      const next = { ...note, ...structuredClone(command.changes) }
      unlocked(scene, [note, ...anchorDependencies(scene, note.anchor, note.floorId, note.id), ...anchorDependencies(scene, next.anchor, note.floorId, note.id)])
      Object.assign(note, command.changes)
      break
    }
    case 'deleteNote': {
      const note = own(scene.notes, command.id)
      if (!note) throw new Error('待删除注记不存在。')
      unlocked(scene, [note, ...anchorDependencies(scene, note.anchor, note.floorId, note.id)]); rejectReferenced(scene, note.id)
      delete scene.notes[note.id]; delete scene.entityLayers[note.id]
      break
    }
    case 'upsertManualMask': {
      const existing = own(scene.regions, command.id)
      if (existing && existing.kind !== 'manualMask') throw new Error('遮罩 ID 与其他区域冲突。')
      if (existing && (existing.floorId !== command.floorId || command.layerId !== undefined && command.layerId !== scene.entityLayers[existing.id])) throw new Error('修改遮罩不能隐式改变 Floor 或图层。')
      if (existing) unlocked(scene, [existing]); else unusedId(scene, command.id)
      const layerId = existing ? scene.entityLayers[existing.id] : targetLayer(scene, command.floorId, command.layerId)
      const b = command.boundsMm
      scene.regions[command.id] = { id: command.id, floorId: command.floorId, editLocked: existing?.editLocked ?? false,
        kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1,
        boundaryMm: [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }] }
      scene.entityLayers[command.id] = layerId
      break
    }
    case 'deleteManualMask': {
      const region = own(scene.regions, command.id)
      if (!region || region.kind !== 'manualMask') throw new Error('待删除固定遮罩不存在。')
      unlocked(scene, [region]); rejectReferenced(scene, region.id)
      delete scene.regions[region.id]; delete scene.entityLayers[region.id]
      break
    }
  }
}
