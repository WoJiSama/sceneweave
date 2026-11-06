import { z } from 'zod'
import {
  AGGREGATE_CONTRACT, AGGREGATE_ENTITY_COLLECTIONS, AGGREGATE_LIMITS,
  type AggregateContract, type AggregateDependency, type AggregateEntityRef, type AggregateMemberState,
  type AggregatePort, type AggregatePortGeometry, type AggregateSceneSource,
} from '../model/aggregate.js'
import type { EntityKind, Issue, SceneDocument } from '../model/scene.js'
import { entityEditLockBlockerIds } from '../commands/base.js'
import { geometryDocumentForValidation } from '../commands/domain.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { canonicalJson, freezeJson, inspectJsonInput } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { id, int, nonnegative, point, positive } from '../validation/primitives.js'
import { validateSceneDocument } from '../validation/scene.js'
import { aggregateEntityRelations } from './relations.js'
import { deriveAggregatePortGeometry } from './ports.js'
import { aggregateFrameSchema } from './schema.js'
export { aggregateFrameSchema } from './schema.js'

const entityRef = z.object({ kind: z.enum(Object.keys(AGGREGATE_ENTITY_COLLECTIONS) as EntityKind[]), id }).strict()
type AggregateEntity = SceneDocument[(typeof AGGREGATE_ENTITY_COLLECTIONS)[EntityKind]][string]
const refs = z.array(entityRef).max(AGGREGATE_LIMITS.references)
const chunkKey = z.object({ floorId: id, x: int, y: int }).strict()
export const aggregatePortSchema = z.object({ id, groupId: id, endpoint: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('opening'), id }).strict(),
  z.object({ kind: z.literal('path'), id, end: z.enum(['start', 'end']) }).strict(),
  z.object({ kind: z.literal('terrainConnection'), id, end: z.enum(['from', 'to']) }).strict(),
]) }).strict()
export const aggregateChunkResidencySchema = z.discriminatedUnion('state', [
  z.object({ key: chunkKey, state: z.literal('unloaded') }).strict(),
  z.object({ key: chunkKey, state: z.literal('loading') }).strict(),
  z.object({ key: chunkKey, state: z.literal('resident') }).strict(),
  z.object({ key: chunkKey, state: z.literal('failed'), reason: z.string().min(1).max(1024) }).strict(),
])
export const aggregateContractSchema = z.object({
  contract: z.literal(AGGREGATE_CONTRACT),
  source: z.object({ sceneId: id, revision: nonnegative, contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  groups: z.record(id, z.object({ id, floorId: id, parentId: id.nullable(), frame: aggregateFrameSchema, members: refs, editLocked: z.boolean() }).strict())
    .refine(value => Object.keys(value).length <= AGGREGATE_LIMITS.groups, '聚合体数量超过保护限制。'),
  ports: z.record(id, aggregatePortSchema).refine(value => Object.keys(value).length <= AGGREGATE_LIMITS.ports, '端口数量超过保护限制。'),
  chunkSizeMm: positive,
  chunks: z.array(z.object({ key: chunkKey, contentState: z.enum(['planned', 'generated', 'modified']), entities: refs }).strict()).max(AGGREGATE_LIMITS.chunks),
}).strict().refine(value => Object.values(value.groups).reduce((n, group) => n + group.members.length, 0)
  + value.chunks.reduce((n, chunk) => n + chunk.entities.length, 0) <= AGGREGATE_LIMITS.references, '聚合与区块引用总数超过保护限制。')

export interface AggregateInspection {
  /** GM-only diagnostic; must never be passed to player rendering or export. */
  audience: 'gm'; contract: AggregateContract
  members: AggregateMemberState[]; crossGroupDependencies: AggregateDependency[]
  ports: { port: AggregatePort; geometry: AggregatePortGeometry; sourceHash: string; role: 'door' | 'window' | 'path' | 'stairs' | 'ramp' }[]
  ungrouped: AggregateEntityRef[]; unindexed: AggregateEntityRef[]
}
export type AggregateInspectionResult = { ok: true; inspection: AggregateInspection } | { ok: false; errors: Issue[] }
export const aggregateEntityKey = (ref: AggregateEntityRef): string => JSON.stringify([ref.kind, ref.id])
const sourceOf = (scene: SceneDocument): AggregateSceneSource => ({ sceneId: scene.sceneId, revision: scene.revision, contentHash: sha256Text(canonicalJson(scene)) })

export function aggregateSceneSource(input: unknown): AggregateSceneSource {
  const result = validateSceneDocument(input)
  if (!result.ok) throw new Error('聚合体来源须为合法完整场景。')
  return sourceOf(result.document)
}

/** Strict read-only contract inspection. It grants no transform, spatial,
 * persistence, port-geometry, identity-continuity or proof-reuse capability. */
export function inspectAggregateContract(sceneInput: unknown, input: unknown): AggregateInspectionResult {
  const jsonIssue = inspectJsonInput(input)
  if (jsonIssue) return { ok: false, errors: [jsonIssue] }
  const parsed = aggregateContractSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => ({ code: 'AGGREGATE_SCHEMA', message: `${issue.path.join('.')}: ${issue.message}` })) }
  const validated = validateSceneDocument(sceneInput)
  if (!validated.ok) return { ok: false, errors: validated.errors }
  const scene = validated.document, contract: AggregateContract = parsed.data, errors: Issue[] = []
  const error = (code: string, message: string, entityId?: string) => errors.push({ code, message, ...(entityId === undefined ? {} : { entityId }) })
  if (canonicalJson(contract.source) !== canonicalJson(sourceOf(scene))) return { ok: false, errors: [{ code: 'AGGREGATE_STALE_SOURCE', message: '聚合合同须绑定确切场景、revision与完整内容。' }] }
  const groups = contract.groups, ancestors = new Map<string, string[]>(), owners = new Map<string, string>()
  const entities = new Map<string, { ref: AggregateEntityRef; value: AggregateEntity }>()
  for (const [kind, collection] of Object.entries(AGGREGATE_ENTITY_COLLECTIONS)) for (const value of Object.values(scene[collection])) {
    const ref = { kind: kind as EntityKind, id: value.id }
    entities.set(aggregateEntityKey(ref), { ref, value })
  }
  const getGroup = (groupId: string) => Object.hasOwn(groups, groupId) ? groups[groupId] : undefined
  for (const [key, group] of Object.entries(groups)) {
    if (key !== group.id) error('AGGREGATE_ID_KEY', '聚合体集合键须等于id。', key)
    if (!Object.hasOwn(scene.floors, group.floorId)) error('AGGREGATE_FLOOR', '聚合体Floor不存在。', group.id)
    const chain: string[] = [], visited = new Set<string>()
    let next: string | null = key
    while (next !== null) {
      if (visited.has(next)) { error('AGGREGATE_CYCLE', '聚合体父级不能成环。', group.id); break }
      visited.add(next)
      const parent = getGroup(next)
      if (!parent) { error('AGGREGATE_PARENT', '聚合体父级不存在。', group.id); break }
      if (parent.floorId !== group.floorId) error('AGGREGATE_CROSS_FLOOR', '聚合体父子必须同Floor。', group.id)
      chain.push(next)
      if (chain.length > AGGREGATE_LIMITS.depth) { error('AGGREGATE_DEPTH', '聚合体层级超过保护限制。', group.id); break }
      next = parent.parentId
    }
    ancestors.set(key, chain)
    for (const ref of group.members) {
      const memberKey = aggregateEntityKey(ref), member = entities.get(memberKey)
      if (!member) error('AGGREGATE_MEMBER', '聚合体成员须引用现存实体。', ref.id)
      else if (member.value.floorId !== group.floorId) error('AGGREGATE_CROSS_FLOOR', '成员与聚合体须同Floor。', ref.id)
      if (owners.has(memberKey)) error('AGGREGATE_DUPLICATE_OWNER', '实体只能有一个直接聚合所有者。', ref.id)
      else owners.set(memberKey, key)
    }
  }
  if (errors.length) return { ok: false, errors }
  const ownerOf = (ref: AggregateEntityRef | { kind: 'floor'; id: string }) => ref.kind === 'floor' ? null : owners.get(aggregateEntityKey(ref)) ?? null
  const relations = aggregateEntityRelations(scene)
  const sharedWalls = new Map<string, string[]>()
  for (const edge of relations) if (edge.from.kind === 'room' && edge.to.kind === 'wall') {
    sharedWalls.set(edge.to.id, [...(sharedWalls.get(edge.to.id) ?? []), edge.from.id])
  }
  for (const [wallId, rooms] of sharedWalls) if (rooms.length > 1) {
    const roomOwners = rooms.map(roomId => ownerOf({ kind: 'room', id: roomId }))
    const first = roomOwners[0], commonOwner = first === null ? null : (ancestors.get(first) ?? []).find(candidate => roomOwners.every(owner => owner !== null && ancestors.get(owner)!.includes(candidate))) ?? null
    if (ownerOf({ kind: 'wall', id: wallId }) !== commonOwner) error('AGGREGATE_SHARED_WALL_OWNER', '共享墙须由房间的最近共同所有者持有；无共同组时留在世界层。', wallId)
  }
  const inspectedPorts: AggregateInspection['ports'] = [], endpoints = new Set<string>()
  for (const [key, port] of Object.entries(contract.ports)) {
    if (key !== port.id) error('AGGREGATE_ID_KEY', '端口集合键须等于id。', key)
    const group = getGroup(port.groupId), ref: AggregateEntityRef = { kind: port.endpoint.kind, id: port.endpoint.id }
    const member = entities.get(aggregateEntityKey(ref)), owner = ownerOf(ref)
    if (!group || !member || owner === null || !ancestors.get(owner)!.includes(port.groupId)) {
      error('AGGREGATE_PORT_BINDING', '端口须绑定本组或子组的实际开口、路径或高差连接。', port.id); continue
    }
    const endpointKey = canonicalJson([port.groupId, port.endpoint])
    if (endpoints.has(endpointKey)) error('AGGREGATE_DUPLICATE_PORT', '同组不能重复暴露同一端点。', port.id)
    endpoints.add(endpointKey)
    const endpoint = port.endpoint
    const role = endpoint.kind === 'opening' ? scene.openings[endpoint.id].kind : endpoint.kind === 'path' ? 'path' : scene.terrainConnections[endpoint.id].kind
    try {
      const geometryGroups = Object.fromEntries(Object.entries(contract.groups).map(([id, group]) => [id, { ...group, editLocked: false }]))
      const portScene: SceneDocument = { ...scene, aggregateCoordinates: { encoding: 'world', groups: geometryGroups } }
      const geometry = deriveAggregatePortGeometry(portScene, port)
      inspectedPorts.push({ port, geometry, sourceHash: sha256Text(canonicalJson({ endpoint: member.value, geometry })), role })
    } catch (cause) {
      error('AGGREGATE_PORT_GEOMETRY', cause instanceof Error ? cause.message : String(cause), port.id)
    }
  }
  const chunks = new Set<string>(), indexed = new Set<string>()
  for (const chunk of contract.chunks) {
    const key = canonicalJson(chunk.key), floor = Object.hasOwn(scene.floors, chunk.key.floorId)
    if (!floor) error('AGGREGATE_CHUNK_FLOOR', '区块Floor不存在。')
    if (chunks.has(key)) error('AGGREGATE_DUPLICATE_CHUNK', '空间区块键不能重复。')
    chunks.add(key)
    // Both edges of the half-open cell must remain exact integer millimetres.
    if (![chunk.key.x, chunk.key.y].every(axis => Number.isSafeInteger(axis * contract.chunkSizeMm) && Number.isSafeInteger((axis + 1) * contract.chunkSizeMm))) error('AGGREGATE_CHUNK_RANGE', '区块边界须可精确表示为整数毫米。')
    if (chunk.contentState === 'planned' && chunk.entities.length) error('AGGREGATE_PLANNED_CONTENT', '未生成区块不能声称包含已生成实体。')
    const local = new Set<string>()
    for (const ref of chunk.entities) {
      const refKey = aggregateEntityKey(ref), member = entities.get(refKey)
      if (!member || member.value.floorId !== chunk.key.floorId) error('AGGREGATE_CHUNK_MEMBER', '区块只能索引同Floor的实际实体。', ref.id)
      if (local.has(refKey)) error('AGGREGATE_DUPLICATE_CHUNK_MEMBER', '单一区块不能重复索引同一实体。', ref.id)
      local.add(refKey); indexed.add(refKey)
    }
  }
  if (errors.length) return { ok: false, errors }
  const visible = createPublicVisibility(scene)
  const isPublic = (ref: AggregateEntityRef): boolean | 'unresolved' => {
    switch (ref.kind) {
      case 'room': return visible.room(ref.id)
      case 'wall': return visible.wall(ref.id)
      case 'opening': return visible.opening(ref.id)
      case 'prop': return visible.prop(scene.props[ref.id])
      case 'terrainArea': return visible.terrainArea(ref.id)
      case 'terrainEdge': return visible.terrainEdge(ref.id)
      case 'terrainConnection': return visible.terrainConnection(ref.id)
      case 'path': return visible.path(ref.id)
      case 'prefabInstance': return scene.prefabInstances[ref.id].visibility === 'public'
      case 'scatterGroup': return visible.scatterGroup(ref.id)
      case 'decoration': return visible.decoration(scene.decorations[ref.id])
      case 'decorationCluster': return visible.decorationCluster(ref.id)
      case 'surfaceRule': { const rule = scene.surfaceRules[ref.id]; return rule.visibility === 'public' && visible.surface(rule.supportRef) }
      // Notes/vertices need recursive audience closure. Until c projects that
      // closure, keep them private in this GM diagnostic rather than guess.
      case 'note': case 'vertex': return 'unresolved'
      case 'region': return scene.regions[ref.id].visibility === 'public'
    }
  }
  const byId = new Map([...entities.values()].map(member => [member.ref.id, member]))
  const lockView = geometryDocumentForValidation(scene, true)
  const members = [...entities.values()].map(({ ref, value }): AggregateMemberState => {
    const ownerId = ownerOf(ref), lockSources: AggregateMemberState['lockSources'] = []
    for (const groupId of ownerId === null ? [] : ancestors.get(ownerId)!) if (groups[groupId].editLocked) lockSources.push({ kind: 'group', id: groupId })
    // Keep the same recursive annotation, structure, support and container
    // blockers as current selection. This diagnostic grants no command proof.
    for (const blockerId of new Set(entityEditLockBlockerIds(lockView, value.id))) {
      const blocker = byId.get(blockerId)
      if (!blocker) continue
      if (blocker.value.editLocked) lockSources.push({ kind: blockerId === value.id ? 'entity'
        : ['prefabInstance', 'scatterGroup', 'decorationCluster'].includes(blocker.ref.kind) ? 'container' : 'dependency', id: blockerId })
      const layerId = scene.entityLayers[blockerId]
      if (scene.userLayers[layerId]?.editLocked && !lockSources.some(source => source.kind === 'layer' && source.id === layerId)) lockSources.push({ kind: 'layer', id: layerId })
    }
    const publicState = isPublic(ref)
    return { entity: ref, ownerId, lockSources, visibility: publicState === 'unresolved' ? 'unresolved' : publicState ? 'public' : 'gm' }
  })
  const crossGroupDependencies = relations.flatMap(edge => {
    const fromOwnerId = ownerOf(edge.from), toOwnerId = ownerOf(edge.to)
    return fromOwnerId === toOwnerId ? [] : [{ ...edge, fromOwnerId, toOwnerId }]
  })
  return { ok: true, inspection: freezeJson({ audience: 'gm', contract, members, crossGroupDependencies, ports: inspectedPorts,
    ungrouped: members.filter(member => member.ownerId === null).map(member => member.entity),
    unindexed: [...entities.entries()].filter(([key]) => !indexed.has(key)).map(([, member]) => member.ref),
  }) }
}
