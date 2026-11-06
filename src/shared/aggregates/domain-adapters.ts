import { buildingAggregateMembers, inspectAggregateBuilding } from '../commands/building.js'
import { AGGREGATE_ENTITY_COLLECTIONS, type AggregateEntityRef, type AggregateFrame, type AggregateRelationRef } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { cloneJson } from '../validation/json.js'
import { aggregateAffectedClosure, aggregateEntityRelations } from './relations.js'
import { aggregateWorldFrames } from './state.js'

export type AggregateDomainId = 'building' | 'natural'
export interface AggregateDomainScope {
  domain: AggregateDomainId
  seedRefs: AggregateEntityRef[]
  members: AggregateEntityRef[]
  groupIds: string[]
  frame: AggregateFrame
  /** Read-only references remain outside ownership and must still be checked. */
  readDependencies: AggregateRelationRef[]
}
export interface AggregateDomainAdapter {
  domain: AggregateDomainId
  seedKinds: readonly AggregateEntityRef['kind'][]
  capabilities: { translation: true; quarterTurns: true; completeGeometryValidation: true; arbitraryRotation: false; crossFloor: false }
  members(scene: SceneDocument, seeds: readonly AggregateEntityRef[]): AggregateEntityRef[]
  inspect(scene: SceneDocument, groupId: string): AggregateDomainScope
}
const key = (ref: AggregateRelationRef) => JSON.stringify([ref.kind, ref.id])
const sorted = <T extends AggregateRelationRef>(refs: readonly T[]): T[] => [...refs].sort((a, b) => key(a).localeCompare(key(b)))
const capabilities = Object.freeze({ translation: true, quarterTurns: true, completeGeometryValidation: true, arbitraryRotation: false, crossFloor: false } as const)

function subtree(scene: SceneDocument, groupId: string) {
  const state = scene.aggregateCoordinates
  if (!state || state.encoding !== 'world' || !Object.hasOwn(state.groups, groupId)) throw new Error('请选择现存聚合组。')
  const frames = aggregateWorldFrames(state), groupIds = new Set([groupId])
  for (let changed = true; changed;) {
    changed = false
    for (const row of Object.values(state.groups)) if (row.parentId !== null && groupIds.has(row.parentId) && !groupIds.has(row.id)) {
      groupIds.add(row.id); changed = true
    }
  }
  return { frame: frames.get(groupId)!, groupIds: [...groupIds].sort(), members: [...groupIds].flatMap(id => state.groups[id].members) }
}
function readDependencies(scene: SceneDocument, members: readonly AggregateEntityRef[]): AggregateRelationRef[] {
  const owned = new Set(members.map(key)), reads = new Map<string, AggregateRelationRef>()
  for (const member of members) {
    const floorId = aggregateDomainEntity(scene, member)?.floorId
    if (floorId) reads.set(key({ kind: 'floor', id: floorId }), { kind: 'floor', id: floorId })
  }
  for (const relation of aggregateEntityRelations(scene)) if (owned.has(key(relation.from)) && !owned.has(key(relation.to))) reads.set(key(relation.to), relation.to)
  return sorted([...reads.values()])
}

/** Regions have no support reference. Only an explicit live generation owner
 * can associate one with a natural group. A recipe's terrain outputs must all
 * be selected before adopting its unpartitioned region output; no position or
 * thematic name is used to infer membership. Frozen provenance is never moved. */
function ownedRegions(scene: SceneDocument, terrainAreaIds: ReadonlySet<string>): AggregateEntityRef[] {
  const generation = getLegacyGeneration(scene)
  if (!generation) return []
  const live = Object.values(generation.ownership).filter(row => row.state === 'managed' || row.state === 'manual')
  const recipeIds = new Set(live.filter(row => row.target.kind === 'terrainArea' && terrainAreaIds.has(row.target.entityId))
    .flatMap(row => generation.rules[row.ruleId]?.recipeRef.id ?? []))
  const regions = live.filter(row => row.target.kind === 'region' && recipeIds.has(generation.rules[row.ruleId]?.recipeRef.id ?? ''))
  for (const region of regions) {
    const recipeId = generation.rules[region.ruleId].recipeRef.id
    if (live.some(row => row.target.kind === 'terrainArea' && generation.rules[row.ruleId]?.recipeRef.id === recipeId
      && Object.hasOwn(scene.terrainAreas, row.target.entityId) && !terrainAreaIds.has(row.target.entityId))) {
      throw new Error('自然组中的生成区域尚不能独立分割；请明确选择该来源的完整地形面。')
    }
  }
  return regions.filter(row => Object.hasOwn(scene.regions, row.target.entityId)).map(row => ({ kind: 'region', id: row.target.entityId }))
}

/** Follow actual reverse support/attachment relations and live container
 * membership. Read-only Floor/other terrain are not silently absorbed. */
export function naturalAggregateMembers(scene: SceneDocument, terrainAreaIds: readonly string[]): AggregateEntityRef[] {
  if (!terrainAreaIds.length || new Set(terrainAreaIds).size !== terrainAreaIds.length) throw new Error('自然组须明确选择不重复的现存地形面。')
  const areas = terrainAreaIds.map(id => {
    if (!Object.hasOwn(scene.terrainAreas, id)) throw new Error(`自然组地形面不存在：${id}。`)
    return scene.terrainAreas[id]
  })
  if (new Set(areas.map(area => area.floorId)).size !== 1) throw new Error('自然组地形必须位于同一Floor。')
  const seeds: AggregateEntityRef[] = [...areas.map(area => ({ kind: 'terrainArea' as const, id: area.id })), ...ownedRegions(scene, new Set(terrainAreaIds))]
  const closure = aggregateAffectedClosure(scene, seeds)
  if (closure.unknownTargets.length || closure.unresolvedReferences.length) throw new Error('自然组存在缺失或跨Floor依赖，不能推断完整移动范围。')
  return sorted(closure.affected.filter((ref): ref is AggregateEntityRef => ref.kind !== 'floor'))
}
function inspectNatural(scene: SceneDocument, groupId: string): AggregateDomainScope {
  const tree = subtree(scene, groupId), terrainAreaIds = tree.members.filter(ref => ref.kind === 'terrainArea').map(ref => ref.id)
  const members = naturalAggregateMembers(scene, terrainAreaIds), actual = new Set(tree.members.map(key))
  if (actual.size !== tree.members.length || members.length !== actual.size || members.some(ref => !actual.has(key(ref)))) {
    throw new Error('自然组须完整拥有地形支撑、随动道路/连接/容器/规则与注记；缺少、额外或后增依赖不能自动收编。')
  }
  return { domain: 'natural', seedRefs: sorted(terrainAreaIds.map(id => ({ kind: 'terrainArea', id }))),
    members: cloneJson(members), groupIds: tree.groupIds, frame: tree.frame, readDependencies: readDependencies(scene, members) }
}
function inspectBuilding(scene: SceneDocument, groupId: string): AggregateDomainScope {
  const scope = inspectAggregateBuilding(scene, groupId)
  return { domain: 'building', seedRefs: [{ kind: 'room', id: scope.seedId }], ...scope, readDependencies: readDependencies(scene, scope.members) }
}
export const AGGREGATE_DOMAIN_ADAPTERS: Readonly<Record<AggregateDomainId, AggregateDomainAdapter>> = Object.freeze({
  building: Object.freeze({ domain: 'building', seedKinds: ['room', 'wall'] as const, capabilities,
    members: (scene: SceneDocument, seeds: readonly AggregateEntityRef[]) => {
      if (seeds.length !== 1 || !['room', 'wall'].includes(seeds[0].kind)) throw new Error('建筑适配器须明确选择一个房间或墙种子。')
      return buildingAggregateMembers(scene, seeds[0].id)
    }, inspect: inspectBuilding }),
  natural: Object.freeze({ domain: 'natural', seedKinds: ['terrainArea'] as const, capabilities,
    members: (scene: SceneDocument, seeds: readonly AggregateEntityRef[]) => {
      if (seeds.some(seed => seed.kind !== 'terrainArea')) throw new Error('自然适配器只接受明确地形面种子。')
      return naturalAggregateMembers(scene, seeds.map(seed => seed.id))
    }, inspect: inspectNatural }),
})
export function inspectAggregateDomain(scene: SceneDocument, groupId: string, domain?: AggregateDomainId): AggregateDomainScope {
  const resolved = domain ?? (subtree(scene, groupId).members.some(ref => ref.kind === 'terrainArea') ? 'natural' : 'building')
  return AGGREGATE_DOMAIN_ADAPTERS[resolved].inspect(scene, groupId)
}
/** Exact surfaces whose fixed appearance sources follow this world transform. */
export function naturalTransformSurfaceIds(scope: AggregateDomainScope): string[] {
  return scope.members.filter(ref => ['room', 'wall', 'terrainArea', 'terrainEdge', 'terrainConnection', 'path'].includes(ref.kind)).map(ref => ref.id).sort()
}

/** Current physical entities only; no recipe, resource or proof record is a
 * movable entity merely because it contains coordinates. */
export function aggregateDomainEntity(scene: SceneDocument, ref: AggregateEntityRef) {
  const record = scene[AGGREGATE_ENTITY_COLLECTIONS[ref.kind]]
  return Object.hasOwn(record, ref.id) ? record[ref.id] : undefined
}
