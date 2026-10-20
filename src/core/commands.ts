import { z } from 'zod'
import type { CommandBatch, Editable, Issue, Operation, PointMm, SceneDocument, TransactionResult } from './types'
import { cloneScene, collectionFor } from './types'
import { wallLength } from './geometry'
import { inspectJsonInput, validateScene } from './schema'

const id = z.string().min(1).max(256)
const integer = z.number().finite().refine(Number.isSafeInteger)
const nonnegative = integer.refine(value => value >= 0)
const positive = integer.refine(value => value > 0)
const point = z.object({ x: integer, y: integer }).strict()
const entityKind = z.enum(['vertex', 'room', 'wall', 'opening', 'prop', 'region', 'note'])
const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('moveProp'), id, positionMm: point }).strict(),
  z.object({ type: z.literal('updateProp'), id, changes: z.object({ rotationDeg: z.number().finite().min(0).lt(360).optional(), visibility: z.enum(['public', 'gm']).optional(), blocksMovement: z.boolean().optional(), blocksSight: z.boolean().optional() }).strict() }).strict(),
  z.object({ type: z.literal('moveVertices'), positions: z.record(z.string(), point).refine(value => Object.keys(value).length > 0, '至少需要移动一个顶点') }).strict(),
  z.object({ type: z.literal('moveOpening'), id, offsetMm: nonnegative }).strict(),
  z.object({ type: z.literal('updateOpening'), id, changes: z.object({ state: z.enum(['open', 'closed']).optional(), locked: z.boolean().optional(), secret: z.boolean().optional(), revealed: z.boolean().optional(), widthMm: positive.optional() }).strict() }).strict(),
  z.object({ type: z.literal('reverseWall'), id }).strict(),
  z.object({ type: z.literal('splitWall'), id, atMm: positive, vertexId: id, newWallId: id }).strict(),
  z.object({ type: z.literal('updateNote'), id, changes: z.object({ text: z.string().optional(), title: z.string().optional(), visibility: z.enum(['public', 'gm']).optional(), discovered: z.boolean().optional() }).strict() }).strict(),
  z.object({ type: z.literal('updateRoom'), id, changes: z.object({ visibility: z.enum(['public', 'gm']).optional(), purpose: z.string().optional(), accessExpectation: z.enum(['unspecified', 'required', 'intentionalIsolation']).optional() }).strict() }).strict(),
  z.object({ type: z.literal('setEditLock'), entityKind, id, locked: z.boolean() }).strict(),
])
const batchSchema = z.object({
  batchId: id, sceneId: id, baseRevision: nonnegative, source: z.enum(['manual', 'ai', 'import', 'history', 'migration']),
  origin: z.object({ requestId: id.optional(), proposalId: id.optional() }).strict().optional(),
  scope: z.object({ entityIds: z.array(id).nullable() }).strict(), operations: z.array(operationSchema).min(1), label: z.string().min(1),
}).strict()

const fail = (code: string, message: string, entityId?: string): TransactionResult => ({ ok: false, errors: [{ code, message, ...(entityId ? { entityId } : {}) }] })
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const findEntity = (scene: SceneDocument, targetId: string): Editable | undefined => {
  for (const collection of Object.values(collectionFor)) if (Object.hasOwn(scene[collection], targetId)) return scene[collection][targetId]
  return undefined
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** Include dependencies whose geometry/anchoring changes indirectly; locks on shared structures are never bypassed. */
function affectedBy(scene: SceneDocument, operation: Operation): Set<string> {
  const affected = new Set<string>()
  if (operation.type === 'setEditLock') return new Set([operation.id])
  const structuralWalls = new Set<string>(), geometryRooms = new Set<string>()
  if (operation.type === 'moveVertices') {
    for (const id of Object.keys(operation.positions)) affected.add(id)
    for (const wall of Object.values(scene.walls)) if (affected.has(wall.startVertexId) || affected.has(wall.endVertexId)) structuralWalls.add(wall.id)
    for (const room of Object.values(scene.rooms)) if (room.boundaryVertexIds.some(id => affected.has(id))) geometryRooms.add(room.id)
  } else {
    affected.add(operation.id)
    if (operation.type === 'moveOpening' || operation.type === 'updateOpening') {
      const opening = own(scene.openings, operation.id)
      if (opening) structuralWalls.add(opening.wallId)
    }
    if (operation.type === 'reverseWall' || operation.type === 'splitWall') structuralWalls.add(operation.id)
    if (operation.type === 'splitWall') { affected.add(operation.vertexId); affected.add(operation.newWallId) }
  }
  for (const wallId of structuralWalls) {
    affected.add(wallId)
    const wall = own(scene.walls, wallId)
    if (!wall) continue
    affected.add(wall.startVertexId); affected.add(wall.endVertexId)
    for (const room of Object.values(scene.rooms)) {
      const ids = room.boundaryVertexIds
      if (ids.some((id, i) => (id === wall.startVertexId && ids[(i + 1) % ids.length] === wall.endVertexId) || (id === wall.endVertexId && ids[(i + 1) % ids.length] === wall.startVertexId))) geometryRooms.add(room.id)
    }
  }
  for (const opening of Object.values(scene.openings)) if (structuralWalls.has(opening.wallId)) affected.add(opening.id)
  for (const roomId of geometryRooms) affected.add(roomId)
  for (const prop of Object.values(scene.props)) if (prop.roomId && geometryRooms.has(prop.roomId)) affected.add(prop.id)
  // Anchor chains are valid and acyclic. A fixed point also handles a note anchored to another note.
  let changed = true
  while (changed) {
    changed = false
    for (const note of Object.values(scene.notes)) if (!affected.has(note.id) && note.anchor.type === 'entity' && affected.has(note.anchor.entityId)) { affected.add(note.id); changed = true }
  }
  return affected
}

function apply(scene: SceneDocument, operation: Operation): Issue | undefined {
  const absent = (id: string): Issue => ({ code: 'MISSING_ENTITY', message: '操作对象不存在。', entityId: id })
  switch (operation.type) {
    case 'moveProp': {
      const prop = own(scene.props, operation.id)
      if (!prop) return absent(operation.id)
      prop.positionMm = operation.positionMm
      break
    }
    case 'updateProp': {
      const prop = own(scene.props, operation.id)
      if (!prop) return absent(operation.id)
      Object.assign(prop, operation.changes)
      break
    }
    case 'moveVertices': {
      for (const [id, position] of Object.entries(operation.positions)) {
        const vertex = own(scene.vertices, id)
        if (!vertex) return absent(id)
        vertex.xMm = position.x; vertex.yMm = position.y
      }
      break
    }
    case 'moveOpening': {
      const opening = own(scene.openings, operation.id)
      if (!opening) return absent(operation.id)
      opening.offsetMm = operation.offsetMm
      break
    }
    case 'updateOpening': {
      const opening = own(scene.openings, operation.id)
      if (!opening) return absent(operation.id)
      Object.assign(opening, operation.changes)
      break
    }
    case 'reverseWall': {
      const wall = own(scene.walls, operation.id)
      if (!wall) return absent(operation.id)
      const length = wallLength(scene, wall)
      for (const opening of Object.values(scene.openings)) if (opening.wallId === wall.id) opening.offsetMm = length - opening.offsetMm - opening.widthMm
      const start = wall.startVertexId; wall.startVertexId = wall.endVertexId; wall.endVertexId = start
      break
    }
    case 'splitWall': {
      const wall = own(scene.walls, operation.id)
      if (!wall) return absent(operation.id)
      if (operation.vertexId === operation.newWallId || [operation.vertexId, operation.newWallId].some(id => findEntity(scene, id) || own(scene.floors, id) || own(scene.assets, id))) return { code: 'ID_IN_USE', message: '拆分创建的顶点和墙必须使用全新且不同的 ID。' }
      const length = wallLength(scene, wall)
      if (operation.atMm >= length) return { code: 'INVALID_SPLIT', message: '拆分点必须位于墙的内部。', entityId: wall.id }
      const openings = Object.values(scene.openings).filter(o => o.wallId === wall.id)
      if (openings.some(o => o.offsetMm < operation.atMm && o.offsetMm + o.widthMm > operation.atMm)) return { code: 'OPENING_STRADDLES_SPLIT', message: '门窗跨过拆分点，不能拆分该墙。', entityId: wall.id }
      const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
      const position: PointMm = { x: a.xMm + (b.xMm - a.xMm) / length * operation.atMm, y: a.yMm + (b.yMm - a.yMm) / length * operation.atMm }
      scene.vertices[operation.vertexId] = { id: operation.vertexId, floorId: wall.floorId, editLocked: false, xMm: position.x, yMm: position.y }
      scene.walls[operation.newWallId] = { ...wall, id: operation.newWallId, startVertexId: operation.vertexId }
      for (const room of Object.values(scene.rooms)) {
        const ids = room.boundaryVertexIds, next: string[] = []
        for (let i = 0; i < ids.length; i++) {
          const current = ids[i], following = ids[(i + 1) % ids.length]
          next.push(current)
          if ((current === wall.startVertexId && following === wall.endVertexId) || (current === wall.endVertexId && following === wall.startVertexId)) next.push(operation.vertexId)
        }
        room.boundaryVertexIds = next
      }
      wall.endVertexId = operation.vertexId
      for (const opening of openings) if (opening.offsetMm >= operation.atMm) { opening.wallId = operation.newWallId; opening.offsetMm -= operation.atMm }
      break
    }
    case 'updateNote': {
      const note = own(scene.notes, operation.id)
      if (!note) return absent(operation.id)
      Object.assign(note, operation.changes)
      break
    }
    case 'updateRoom': {
      const room = own(scene.rooms, operation.id)
      if (!room) return absent(operation.id)
      Object.assign(room, operation.changes)
      break
    }
    case 'setEditLock': {
      const entity = own<Editable>(scene[collectionFor[operation.entityKind]], operation.id)
      if (!entity) return absent(operation.id)
      entity.editLocked = operation.locked
      break
    }
  }
}

interface HistoryEntry { before: SceneDocument; after: SceneDocument; label: string; affectedIds: string[] }
export class SceneHistory {
  private current: SceneDocument
  private undoEntries: HistoryEntry[] = []
  private redoEntries: HistoryEntry[] = []
  private appliedBatchIds = new Set<string>()

  constructor(document: SceneDocument) {
    const validation = validateScene(document)
    if (!validation.ok) throw new Error(`Cannot open invalid SceneDocument: ${validation.errors.map(error => `${error.code}: ${error.message}`).join('; ')}`)
    this.current = deepFreeze(validation.document)
  }
  get document(): SceneDocument { return this.current }
  get canUndo(): boolean { return this.undoEntries.length > 0 }
  get canRedo(): boolean { return this.redoEntries.length > 0 }
  get undoLabel(): string | undefined { return this.undoEntries.at(-1)?.label }
  get redoLabel(): string | undefined { return this.redoEntries.at(-1)?.label }

  execute(batch: CommandBatch): TransactionResult {
    const started = performance.now()
    const inputIssue = inspectJsonInput(batch)
    if (inputIssue) return { ok: false, errors: [inputIssue] }
    const parsed = batchSchema.safeParse(batch)
    if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => ({ code: 'COMMAND_SCHEMA', message: `${issue.path.join('.') || 'batch'}: ${issue.message}` })) }
    const command = parsed.data as CommandBatch
    if (command.sceneId !== this.current.sceneId) return fail('SCENE_MISMATCH', '事务不属于当前场景。')
    if (this.appliedBatchIds.has(command.batchId)) return fail('DUPLICATE_BATCH', '该事务已经成功应用，不能重复采用。')
    if (command.baseRevision !== this.current.revision) return fail('STALE_REVISION', '事务基线已经过期，请基于当前修订重新预览。')
    if (this.current.revision >= Number.MAX_SAFE_INTEGER) return fail('REVISION_EXHAUSTED', '修订号已达到安全整数上限。')
    if (command.source === 'ai') return fail('AI_DISABLED', 'M0 尚未启用 AI 提案，不能通过命令伪装采用。')
    if (command.source === 'history') return fail('RESERVED_SOURCE', '历史重放仅允许由当前历史的 undo/redo 调用。')
    const lockOperations = command.operations.filter(operation => operation.type === 'setEditLock')
    if (lockOperations.length && (command.source !== 'manual' || lockOperations.length !== command.operations.length)) return fail('LOCK_BATCH_REQUIRED', '锁定或解锁必须是主持人单独提交的事务，不能同时修改内容。')
    if (command.scope.entityIds && new Set(command.scope.entityIds).size !== command.scope.entityIds.length) return fail('DUPLICATE_SCOPE', '事务范围不能含重复实体。')
    const candidate = cloneScene(this.current), affected = new Set<string>()
    for (const operation of command.operations) {
      const operationAffected = affectedBy(candidate, operation)
      if (operation.type !== 'setEditLock') {
        for (const id of operationAffected) if (findEntity(candidate, id)?.editLocked) return fail('EDIT_LOCKED', '操作会间接修改或移动编辑锁保护的实体。', id)
      }
      for (const id of operationAffected) affected.add(id)
      const issue = apply(candidate, operation)
      if (issue) return { ok: false, errors: [issue] }
    }
    candidate.revision = this.current.revision + 1
    candidate.updatedAt = new Date().toISOString()
    const validation = validateScene(candidate)
    if (!validation.ok) return { ok: false, errors: validation.errors }
    const next = deepFreeze(validation.document), affectedIds = [...affected]
    this.undoEntries.push({ before: this.current, after: next, label: command.label, affectedIds })
    this.redoEntries = []
    this.current = next
    this.appliedBatchIds.add(command.batchId)
    return { ok: true, document: next, affectedIds, elapsedMs: performance.now() - started }
  }

  undo(): TransactionResult { return this.restore('undo') }
  redo(): TransactionResult { return this.restore('redo') }
  private restore(direction: 'undo' | 'redo'): TransactionResult {
    const started = performance.now(), from = direction === 'undo' ? this.undoEntries : this.redoEntries, to = direction === 'undo' ? this.redoEntries : this.undoEntries
    const entry = from.at(-1)
    if (!entry) return fail('HISTORY_EMPTY', direction === 'undo' ? '没有可以撤销的事务。' : '没有可以重做的事务。')
    if (this.current.revision >= Number.MAX_SAFE_INTEGER) return fail('REVISION_EXHAUSTED', '修订号已达到安全整数上限。')
    const candidate = cloneScene(direction === 'undo' ? entry.before : entry.after)
    candidate.revision = this.current.revision + 1
    candidate.updatedAt = new Date().toISOString()
    const validation = validateScene(candidate)
    if (!validation.ok) return { ok: false, errors: validation.errors }
    this.current = deepFreeze(validation.document)
    from.pop(); to.push(entry)
    return { ok: true, document: this.current, affectedIds: entry.affectedIds, elapsedMs: performance.now() - started }
  }
}
