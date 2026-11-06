import { z } from 'zod'
import { geometryDocumentForValidation, geometryIdentityIds } from '../commands/domain.js'
import { isEntityEditLocked } from '../commands/base.js'
import type { SceneCommand } from '../commands/commands.js'
import type { AggregateEntityRef, AggregateGroup, AggregateRelationRef } from '../model/aggregate.js'
import { COMMAND_LIMIT, type PointMm, type SceneDocument } from '../model/scene.js'
import { captureJson, cloneJson } from '../validation/json.js'
import { id, point } from '../validation/primitives.js'
import { aggregateEntityRefSchema } from './schema.js'
import { aggregateWorldFrames, validateAggregateCoordinates } from './state.js'

export interface AggregateCopyScope {
  groupIds: string[]
  members: AggregateEntityRef[]
  /** Same-project copies preserve only these explicitly reviewed references. */
  externalRefs: AggregateRelationRef[]
}
export interface AggregateCopyOptions {
  offsetMm: PointMm
  /** Exact fresh identity for every live member and every copied group. */
  idMap: Record<string, string>
  externalRefs: AggregateRelationRef[]
}
const externalRef = z.union([aggregateEntityRefSchema, z.object({ kind: z.literal('floor'), id }).strict()])
const optionsSchema = z.object({ offsetMm: point, idMap: z.record(id, id), externalRefs: z.array(externalRef) }).strict()
const key = (ref: AggregateRelationRef) => JSON.stringify([ref.kind, ref.id])
const sameSet = (left: string[], right: string[]) => left.length === right.length && new Set(left).size === left.length
  && new Set(right).size === right.length && left.every(value => right.includes(value))

/** Bounded copy adapter. Physical structure, scatter and decoration regeneration
 * need their own explicit reference/identity adapters and are rejected here.
 * No seed is replayed and the source scene is never mutated.
 */
export function inspectAggregateCopy(scene: SceneDocument, groupId: string): AggregateCopyScope {
  const state = scene.aggregateCoordinates
  if (!state || !Object.hasOwn(state.groups, groupId)) throw new Error('请选择现存组。')
  const errors = validateAggregateCoordinates(scene)
  if (errors.length) throw new Error(errors.map(issue => issue.message).join('；'))
  const groups: AggregateGroup[] = [], pending = [groupId]
  while (pending.length) {
    const group = state.groups[pending.shift()!]
    groups.push(group)
    pending.push(...Object.values(state.groups).filter(child => child.parentId === group.id).map(child => child.id))
  }
  const lockIds = new Set(groups.map(group => group.id))
  let ancestor = state.groups[groupId]
  while (ancestor.parentId !== null) { ancestor = state.groups[ancestor.parentId]; lockIds.add(ancestor.id) }
  if ([...lockIds].some(id => state.groups[id].editLocked)) throw new Error('复制涉及锁定的组、子组或祖先组。')
  const members = groups.flatMap(group => cloneJson(group.members)), memberIds = new Set(members.map(member => member.id))
  if (!members.length || members.some(member => !['prop', 'note'].includes(member.kind))) {
    throw new Error('此复制入口仅支持独立物件和注记；固定组合、建筑、地形、散布及布景请继续使用原对象或领域专用命令。')
  }
  const lockedView = geometryDocumentForValidation(scene, true)
  for (const member of members) if (isEntityEditLocked(lockedView, member.id)) throw new Error(`复制涉及锁定成员、图层或依赖：${member.id}。`)
  for (const group of Object.values(scene.prefabInstances)) {
    const live = Object.values(group.members).flatMap(member => member.propId ?? [])
    if (memberIds.has(group.id) || live.some(id => memberIds.has(id))) throw new Error('此入口不复制固定组合及其成员；请使用固定组合专用复制，不能拆批绕过原子事务。')
  }
  for (const group of Object.values(scene.scatterGroups)) if (Object.values(group.members).some(member => member.propId !== null && memberIds.has(member.propId))) {
    throw new Error('散布人工、退出及删除记录不能隐式转为独立副本；此入口暂不复制散布成员。')
  }
  for (const cluster of Object.values(scene.decorationClusters ?? {})) if (Object.values(cluster.members).some(member => member.entityId !== null && memberIds.has(member.entityId))) {
    throw new Error('此入口暂不复制带布景簇成员记录的物件。')
  }
  const external = new Map<string, AggregateRelationRef>()
  const reference = (ref: AggregateRelationRef) => { if (!memberIds.has(ref.id)) external.set(key(ref), cloneJson(ref)) }
  for (const member of members) {
    if (member.kind === 'prop') {
      const prop = scene.props[member.id]
      reference(prop.supportRef)
      if (prop.roomId !== undefined) reference({ kind: 'room', id: prop.roomId })
    } else if (member.kind === 'note') {
      const anchor = scene.notes[member.id].anchor
      if (anchor.type === 'entity') reference({ kind: anchor.entityKind, id: anchor.entityId })
    }
  }
  return { groupIds: groups.map(group => group.id), members, externalRefs: [...external.values()].sort((a, b) => key(a).localeCompare(key(b))) }
}

/** Expands into the existing strict atomic command pipeline. Native
 * prop copy commands retain fixed appearance sources and effective privacy;
 * normal identity reconciliation allocates births. Container member records are
 * rejected rather than flattened, reset or silently restored.
 * Cross-project transfers are deliberately not inferred from these same-project
 * references: they require the complete resource/license import boundary.
 */
export function planAggregateCopy(scene: SceneDocument, groupId: string, input: AggregateCopyOptions): SceneCommand[] {
  const options = optionsSchema.parse(captureJson(input)), scope = inspectAggregateCopy(scene, groupId)
  const sourceIds = [...scope.groupIds, ...scope.members.map(member => member.id)]
  if (!sameSet(Object.keys(options.idMap), sourceIds)) throw new Error('复制须为全部实际成员及组逐项提供新ID，不能遗漏或添加范围外映射。')
  if (!sameSet(options.externalRefs.map(key), scope.externalRefs.map(key))) throw new Error('请明确确认全部外部支撑和锚点引用；不能隐式保留、删除或改挂。')
  const used = geometryIdentityIds(scene)
  for (const id of [...Object.keys(scene.floors), ...Object.keys(scene.userLayers)]) used.add(id)
  const destinations = Object.values(options.idMap)
  if (new Set(destinations).size !== destinations.length || destinations.some(id => used.has(id))) throw new Error('全部复制结果须使用互不重复且未占用的新ID。')
  const translate = (point: PointMm): PointMm => {
    const result = { x: point.x + options.offsetMm.x, y: point.y + options.offsetMm.y }
    if (!Number.isSafeInteger(result.x) || !Number.isSafeInteger(result.y)) throw new Error('复制偏移超出安全整数毫米范围。')
    return result
  }
  const commands: SceneCommand[] = []
  for (const member of scope.members.filter(member => member.kind === 'prop')) {
    translate(scene.props[member.id].positionMm)
    commands.push({ type: 'copyProp', id: member.id, newId: options.idMap[member.id], offsetMm: cloneJson(options.offsetMm) })
  }
  const pendingNotes = scope.members.filter(member => member.kind === 'note').map(member => scene.notes[member.id]), completedNotes = new Set<string>()
  while (pendingNotes.length) {
    const index = pendingNotes.findIndex(note => note.anchor.type !== 'entity' || note.anchor.entityKind !== 'note'
      || !Object.hasOwn(options.idMap, note.anchor.entityId) || completedNotes.has(note.anchor.entityId))
    if (index < 0) throw new Error('注记锚点不能形成循环。')
    const note = pendingNotes.splice(index, 1)[0], { editLocked: _locked, ...copy } = cloneJson(note)
    copy.id = options.idMap[note.id]
    if (copy.anchor.type === 'point') copy.anchor.positionMm = translate(copy.anchor.positionMm)
    else if (Object.hasOwn(options.idMap, copy.anchor.entityId)) copy.anchor.entityId = options.idMap[copy.anchor.entityId]
    commands.push({ type: 'createNote', ...copy, layerId: scene.entityLayers[note.id] })
    completedNotes.add(note.id)
  }
  const frames = aggregateWorldFrames(scene.aggregateCoordinates!)
  for (const id of scope.groupIds) {
    const group = cloneJson(scene.aggregateCoordinates!.groups[id]), root = id === groupId
    group.id = options.idMap[id]
    group.parentId = root ? null : options.idMap[group.parentId!]
    if (root) group.frame = { ...cloneJson(frames.get(id)!), translationMm: translate(frames.get(id)!.translationMm) }
    group.members = group.members.map(member => ({ kind: member.kind, id: options.idMap[member.id] }))
    commands.push({ type: 'createAggregateGroup', group })
  }
  if (commands.length > COMMAND_LIMIT) throw new Error(`完整组复制超过${COMMAND_LIMIT}条操作，不能拆批绕过；请缩小组范围。`)
  return commands
}
