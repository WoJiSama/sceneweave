import { z } from 'zod'
import { isEntityEditLocked } from '../commands/base.js'
import { geometryDocumentForValidation, geometryIdentityIds } from '../commands/domain.js'
import { AGGREGATE_LIMITS, type AggregateCoordinates, type AggregateEntityRef, type AggregateGroup } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { captureJson, cloneJson } from '../validation/json.js'
import { id } from '../validation/primitives.js'
import { aggregateCoordinatesSchema, aggregateEntityRefSchema, aggregateGroupSchema } from './schema.js'
import { aggregateWorldFrames, validateAggregateCoordinates, WORLD_FRAME } from './state.js'
import { reparentAggregateFrame } from './coordinates.js'
import { encodeSceneCoordinates } from './scene-coordinates.js'

export type AggregateRepresentationCommand =
  | { type: 'createAggregateGroup'; group: AggregateGroup }
  | { type: 'reparentAggregateGroup'; id: string; parentId: string | null }
  | { type: 'dissolveAggregateGroup'; id: string }
  | { type: 'splitAggregateGroup'; id: string; parts: { id: string; members: AggregateEntityRef[]; childGroupIds: string[] }[] }
  | { type: 'mergeAggregateGroups'; ids: string[]; newId: string }

const uniqueIds = z.array(id).max(AGGREGATE_LIMITS.groups).refine(ids => new Set(ids).size === ids.length, '组ID不能重复')

export const aggregateRepresentationCommandSchemas = [
  z.object({ type: z.literal('createAggregateGroup'), group: aggregateGroupSchema }).strict(),
  z.object({ type: z.literal('reparentAggregateGroup'), id, parentId: id.nullable() }).strict(),
  z.object({ type: z.literal('dissolveAggregateGroup'), id }).strict(),
  z.object({ type: z.literal('splitAggregateGroup'), id, parts: z.array(z.object({ id,
    members: z.array(aggregateEntityRefSchema).max(AGGREGATE_LIMITS.references), childGroupIds: uniqueIds,
  }).strict()).min(2).max(AGGREGATE_LIMITS.groups) }).strict(),
  z.object({ type: z.literal('mergeAggregateGroups'), ids: uniqueIds.refine(ids => ids.length >= 2, '合并至少选择两个组'), newId: id }).strict(),
] as const
const commandSchema = z.discriminatedUnion('type', aggregateRepresentationCommandSchemas)

export function isAggregateRepresentationCommand(command: { type: string }): command is AggregateRepresentationCommand {
  return ['createAggregateGroup', 'reparentAggregateGroup', 'dissolveAggregateGroup', 'splitAggregateGroup', 'mergeAggregateGroups'].includes(command.type)
}

const ownGroup = (state: AggregateCoordinates, groupId: string): AggregateGroup => {
  if (!Object.hasOwn(state.groups, groupId)) throw new Error(`聚合体不存在：${groupId}。`)
  return state.groups[groupId]
}

function subtree(state: AggregateCoordinates, groupId: string): AggregateGroup[] {
  const result: AggregateGroup[] = [], pending = [groupId], seen = new Set<string>()
  while (pending.length) {
    const next = pending.pop()!
    if (seen.has(next)) throw new Error('聚合体父级不能成环。')
    seen.add(next)
    result.push(ownGroup(state, next))
    for (const group of Object.values(state.groups)) if (group.parentId === next) pending.push(group.id)
  }
  return result
}

/** Representation-only operation on a detached command draft. Member geometry,
 * Floor, visibility and identity are unchanged; no aggregate movement is granted.
 * Commit the metadata only after ownership, locks and exact storage roundtrip pass.
 */
export function applyAggregateRepresentationCommand(scene: SceneDocument, input: AggregateRepresentationCommand): { commandCost: number } {
  const command = commandSchema.parse(captureJson(input))
  const state = scene.aggregateCoordinates ? aggregateCoordinatesSchema.parse(captureJson(scene.aggregateCoordinates))
    : { encoding: 'world' as const, groups: {} }
  if (state.encoding !== 'world') throw new Error('聚合表示命令只接受完整世界视图。')
  const beforeErrors = validateAggregateCoordinates({ ...scene, aggregateCoordinates: state })
  if (beforeErrors.length) throw new Error(beforeErrors.map(issue => issue.message).join('；'))
  const frames = aggregateWorldFrames(state), affected = new Set<string>(), memberIds = new Set<string>()
  const include = (groups: AggregateGroup[]) => {
    for (const group of groups) {
      affected.add(group.id)
      for (const member of group.members) memberIds.add(member.id)
    }
  }
  const freshIds = new Set(geometryIdentityIds(scene))
  for (const id of [...Object.keys(scene.userLayers), ...Object.keys(scene.floors), ...Object.keys(state.groups)]) freshIds.add(id)
  const fresh = (id: string) => {
    if (freshIds.has(id)) throw new Error('聚合体ID已被现有内容使用；拆分、合并及复制须使用全新容器ID。')
    freshIds.add(id)
  }
  const memberKey = (member: AggregateEntityRef) => JSON.stringify([member.kind, member.id])
  if (command.type === 'createAggregateGroup') {
    fresh(command.group.id)
    include([command.group])
    if (command.group.parentId !== null) ownGroup(state, command.group.parentId)
    Object.defineProperty(state.groups, command.group.id, { value: cloneJson(command.group), enumerable: true, writable: true, configurable: true })
  } else if (command.type === 'mergeAggregateGroups') {
    fresh(command.newId)
    const groups = command.ids.map(id => ownGroup(state, id)), first = groups[0]
    if (groups.some(group => group.floorId !== first.floorId || group.parentId !== first.parentId)) throw new Error('合并只支持同Floor、同父级的组；请先明确换父级。')
    for (const group of groups) include(subtree(state, group.id))
    const merged = { ...cloneJson(first), id: command.newId, members: groups.flatMap(group => cloneJson(group.members)) }
    state.groups[merged.id] = merged
    for (const child of Object.values(state.groups)) if (child.parentId !== null && command.ids.includes(child.parentId)) {
      child.frame = reparentAggregateFrame(frames.get(child.id)!, frames.get(first.id)!)
      child.parentId = merged.id
    }
    for (const group of groups) delete state.groups[group.id]
    affected.add(merged.id)
  } else if (command.type === 'splitAggregateGroup') {
    const group = ownGroup(state, command.id)
    include(subtree(state, group.id))
    const children = Object.values(state.groups).filter(child => child.parentId === group.id)
    const expectedMembers = new Set(group.members.map(memberKey)), expectedChildren = new Set(children.map(child => child.id))
    const actualMembers = command.parts.flatMap(part => part.members.map(memberKey)), actualChildren = command.parts.flatMap(part => part.childGroupIds)
    if (actualMembers.length !== expectedMembers.size || new Set(actualMembers).size !== actualMembers.length
      || actualMembers.some(key => !expectedMembers.has(key)) || actualChildren.length !== expectedChildren.size
      || new Set(actualChildren).size !== actualChildren.length || actualChildren.some(id => !expectedChildren.has(id))) {
      throw new Error('拆分须将全部直接成员与直接子组完整分区一次，不能丢失、重复或吸收组外对象。')
    }
    for (const part of command.parts) {
      fresh(part.id)
      if (!part.members.length && !part.childGroupIds.length) throw new Error('拆分结果不能是空组。')
      state.groups[part.id] = { ...cloneJson(group), id: part.id, members: cloneJson(part.members) }
      affected.add(part.id)
      // Each part initially has the retired group's exact world frame. Existing
      // child frames therefore remain exact, with only their parent binding new.
      for (const childId of part.childGroupIds) state.groups[childId].parentId = part.id
    }
    delete state.groups[group.id]
  } else {
    const group = ownGroup(state, command.id)
    include(subtree(state, group.id))
    if (command.type === 'reparentAggregateGroup') {
      if (command.parentId !== null) {
        const parent = ownGroup(state, command.parentId)
        if (parent.floorId !== group.floorId) throw new Error('换父级不能改变Floor。')
        if (affected.has(parent.id)) throw new Error('聚合体父级不能成环。')
      }
      const parentFrame = command.parentId === null ? WORLD_FRAME : frames.get(command.parentId)!
      group.frame = reparentAggregateFrame(frames.get(group.id)!, parentFrame)
      group.parentId = command.parentId
    } else {
      const parent = group.parentId === null ? null : ownGroup(state, group.parentId)
      const parentFrame = parent === null ? WORLD_FRAME : frames.get(parent.id)!
      if (parent) parent.members.push(...cloneJson(group.members))
      for (const child of Object.values(state.groups)) if (child.parentId === group.id) {
        child.frame = reparentAggregateFrame(frames.get(child.id)!, parentFrame)
        child.parentId = group.parentId
      }
      delete state.groups[group.id]
    }
  }
  const lockedView = geometryDocumentForValidation(scene, true)
  for (const memberId of memberIds) if (isEntityEditLocked(lockedView, memberId)) throw new Error(`聚合表示涉及锁定的成员、图层或依赖：${memberId}。`)
  const next = { ...scene, aggregateCoordinates: state }
  const parsedState = aggregateCoordinatesSchema.parse(state)
  const errors = validateAggregateCoordinates(next)
  if (errors.length) throw new Error(errors.map(issue => issue.message).join('；'))
  // Fails before commit if a new frame cannot express any existing integer point.
  encodeSceneCoordinates(next)
  if (Object.keys(state.groups).length) scene.aggregateCoordinates = parsedState
  else delete scene.aggregateCoordinates
  return { commandCost: Math.max(1, affected.size + memberIds.size) }
}
