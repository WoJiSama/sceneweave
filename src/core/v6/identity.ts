import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { sha256TextV2 } from '../v2/scatter'
import { geometryIdentityIdsV3 } from '../v3/domain'
import { validateSceneSnapshotV3 } from '../v3/snapshots'
import type { SceneDocumentV3 } from '../v3/types'
import { validateHistoryIdentityV4 } from '../v4/identity'
import type { HistoryIdentityV4 } from '../v4/types'
import { validateHistoryIdentityV5 } from '../v5/identity'
import type { HistoryIdentityV5 } from '../v5/types'
import { COMPOSITION_LIMITS_V6, type HistoryIdentityV6, type OutdoorIdentityKindV6, type OutdoorIdentityTokenV6 } from './types'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留 ID')
const outdoorToken = z.object({ kind: z.enum(['terrainArea', 'terrainPoint', 'terrainSegment', 'terrainEdge', 'terrainConnection', 'path', 'scatterGroup', 'scatterExclusion']), token: id, topologyToken: id, topologyHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const historyIdentitySchemaV6 = z.object({ version: z.literal(3), lineageId: id, rootSceneId: id, propTokens: z.record(id, id), prefabTokens: z.record(id, id), outdoorTokens: z.record(id, outdoorToken) }).strict()
const canonical = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
interface Descriptor { kind: OutdoorIdentityKindV6; topologyHash: string }
/** Coordinates and business/appearance fields do not determine birth or topology continuity. */
export function outdoorIdentityDescriptorsV6(document: Readonly<SceneDocumentV3>): Record<string, Descriptor> {
  const result: Record<string, Descriptor> = {}
  const add = (id: string, kind: OutdoorIdentityKindV6, topology: unknown) => { if (Object.hasOwn(result, id)) throw new Error(`室外身份重复：${id}。`); result[id] = { kind, topologyHash: sha256TextV2(canonical(topology)) } }
  for (const area of Object.values(document.terrainAreas)) {
    // A ring has no first vertex. Keep its directed adjacency while ignoring a
    // cyclic change of the coordinate editor's first row.
    const ring = area.boundaryMm.map(point => [point.id, point.segmentId])
    const first = ring.reduce((best, point, i) => point[0] < ring[best][0] ? i : best, 0)
    add(area.id, 'terrainArea', [area.floorId, [...ring.slice(first), ...ring.slice(0, first)]])
    area.boundaryMm.forEach((point, i) => { add(point.id, 'terrainPoint', [area.id, area.floorId]); add(point.segmentId, 'terrainSegment', [area.id, area.floorId, point.id, area.boundaryMm[(i + 1) % area.boundaryMm.length].id]) })
  }
  for (const edge of Object.values(document.terrainEdges)) add(edge.id, 'terrainEdge', [edge.floorId, edge.source, edge.neighborAreaId])
  for (const connection of Object.values(document.terrainConnections)) add(connection.id, 'terrainConnection', [connection.floorId, connection.from.surfaceRef, connection.to.surfaceRef, connection.openingId])
  for (const path of Object.values(document.paths)) add(path.id, 'path', [path.floorId, path.supportRefs])
  for (const group of Object.values(document.scatterGroups)) {
    add(group.id, 'scatterGroup', [group.floorId, group.domain, group.seed, group.algorithmVersion])
    for (const exclusion of group.exclusions) add(exclusion.id, 'scatterExclusion', [group.id, exclusion.reason, exclusion.sourceCandidateKey])
  }
  return result
}
const newToken = (descriptor: Descriptor): OutdoorIdentityTokenV6 => ({ kind: descriptor.kind, topologyHash: descriptor.topologyHash, token: crypto.randomUUID(), topologyToken: crypto.randomUUID() })
export function validateHistoryIdentityShapeV6(input: unknown): HistoryIdentityV6 {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`室外历史身份无效：${issue.message}`)
  const parsed = historyIdentitySchemaV6.safeParse(input)
  if (!parsed.success) throw new Error(`室外历史身份字段无效：${parsed.error.issues.map(issue => issue.message).join('；')}`)
  const identity = parsed.data, ids = [...Object.keys(identity.propTokens), ...Object.keys(identity.prefabTokens), ...Object.keys(identity.outdoorTokens)]
  const births = [...Object.values(identity.propTokens), ...Object.values(identity.prefabTokens), ...Object.values(identity.outdoorTokens).map(value => value.token)]
  const topologies = Object.values(identity.outdoorTokens).map(value => value.topologyToken)
  if (ids.length > COMPOSITION_LIMITS_V6.identities || new Set(ids).size !== ids.length) throw new Error('物件、组合及室外出生身份/墓碑合计超过65536或ID重复。')
  if (new Set([...births, ...topologies]).size !== births.length + topologies.length) throw new Error('出生及拓扑令牌必须全局唯一。')
  return identity
}
export function validateHistoryIdentityV6(input: unknown, document: SceneDocumentV3): HistoryIdentityV6 {
  const identity = validateHistoryIdentityShapeV6(input), checked = validateSceneSnapshotV3(document)
  if (!checked.ok) throw new Error(`历史身份对应场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  validateHistoryIdentityV5({ version: 2, lineageId: identity.lineageId, rootSceneId: identity.rootSceneId, propTokens: identity.propTokens, prefabTokens: identity.prefabTokens }, checked.document)
  const descriptors = outdoorIdentityDescriptorsV6(checked.document), occupied = geometryIdentityIdsV3(checked.document)
  for (const layerId of Object.keys(checked.document.userLayers)) occupied.add(layerId)
  for (const [id, descriptor] of Object.entries(descriptors)) {
    const record = identity.outdoorTokens[id]
    if (!record || record.kind !== descriptor.kind || record.topologyHash !== descriptor.topologyHash) throw new Error(`室外对象缺少有效出生/拓扑身份：${id}。`)
    occupied.delete(id)
  }
  for (const id of Object.keys(identity.outdoorTokens)) if (occupied.has(id)) throw new Error(`已分配室外ID与其他身份冲突：${id}。`)
  return identity
}
export function createHistoryIdentityV6(document: SceneDocumentV3): HistoryIdentityV6 {
  return validateHistoryIdentityV6({ version: 3, lineageId: crypto.randomUUID(), rootSceneId: document.sceneId,
    propTokens: Object.fromEntries(Object.keys(document.props).map(id => [id, crypto.randomUUID()])),
    prefabTokens: Object.fromEntries(Object.keys(document.prefabInstances).map(id => [id, crypto.randomUUID()])),
    outdoorTokens: Object.fromEntries(Object.entries(outdoorIdentityDescriptorsV6(document)).map(([id, descriptor]) => [id, newToken(descriptor)])),
  }, document)
}
export function migrateHistoryIdentityV5ToV6(input: HistoryIdentityV5, document: SceneDocumentV3): HistoryIdentityV6 {
  const previous = validateHistoryIdentityV5(input, document)
  return validateHistoryIdentityV6({ ...previous, version: 3, outdoorTokens: Object.fromEntries(Object.entries(outdoorIdentityDescriptorsV6(document)).map(([id, descriptor]) => [id, newToken(descriptor)])) }, document)
}
/** Explicit validated compatibility view; never a persisted V6 replacement. */
export function toHistoryIdentityV4(input: HistoryIdentityV6, document: SceneDocumentV3): HistoryIdentityV4 {
  const identity = validateHistoryIdentityV6(input, document)
  return validateHistoryIdentityV4({ version: 1, lineageId: identity.lineageId, rootSceneId: identity.rootSceneId, propTokens: identity.propTokens }, document)
}
export interface AdvanceHistoryIdentityOptionsV6 { allowResurrection?: boolean }
export interface HistoryIdentityTraceV6 {
  /** Extract identities synchronously; the caller retains ownership of the mutable draft. */
  observe(document: Readonly<SceneDocumentV3>): void
  finish(document: SceneDocumentV3): HistoryIdentityV6
}
/**
 * Track the actual native drafts without requiring each intermediate dependency graph to be valid.
 * A topology changed and changed back in one atomic batch still receives a new continuity marker.
 */
export function createHistoryIdentityTraceV6(input: HistoryIdentityV6, previousDocument: SceneDocumentV3, options: AdvanceHistoryIdentityOptionsV6 = {}): HistoryIdentityTraceV6 {
  const identity = validateHistoryIdentityV6(input, previousDocument)
  const result = structuredClone(identity)
  let previousProps = new Set(Object.keys(previousDocument.props)), previousPrefabs = new Set(Object.keys(previousDocument.prefabInstances)), previousOutdoor = outdoorIdentityDescriptorsV6(previousDocument)
  const observe = (next: Readonly<SceneDocumentV3>) => {
    if (previousDocument.sceneId !== next.sceneId) throw new Error('身份只能推进同一场景的修订。')
    const nextProps = new Set(Object.keys(next.props)), nextPrefabs = new Set(Object.keys(next.prefabInstances)), nextOutdoor = outdoorIdentityDescriptorsV6(next)
    for (const [present, previous, field] of [[nextProps, previousProps, 'propTokens'], [nextPrefabs, previousPrefabs, 'prefabTokens']] as const) for (const id of present) {
      if (Object.hasOwn(result[field], id)) { if (!previous.has(id) && !options.allowResurrection) throw new Error(`普通编辑不能复用已分配的物件/组合 ID：${id}。`) }
      else { if (Object.hasOwn(result.outdoorTokens, id) || Object.hasOwn(result[field === 'propTokens' ? 'prefabTokens' : 'propTokens'], id)) throw new Error(`新出生ID与已分配身份冲突：${id}。`); result[field][id] = crypto.randomUUID() }
    }
    for (const [id, descriptor] of Object.entries(nextOutdoor)) {
      const record = result.outdoorTokens[id]
      if (record) {
        if (record.kind !== descriptor.kind || !previousOutdoor[id] && !options.allowResurrection) throw new Error(`普通编辑不能复用已分配的室外 ID：${id}。`)
        if (!previousOutdoor[id] || record.topologyHash !== descriptor.topologyHash) result.outdoorTokens[id] = { ...record, kind: descriptor.kind, topologyHash: descriptor.topologyHash, topologyToken: crypto.randomUUID() }
      } else {
        if (Object.hasOwn(result.propTokens, id) || Object.hasOwn(result.prefabTokens, id)) throw new Error(`新室外ID与已分配身份冲突：${id}。`)
        result.outdoorTokens[id] = newToken(descriptor)
      }
    }
    previousProps = nextProps; previousPrefabs = nextPrefabs; previousOutdoor = nextOutdoor
  }
  return { observe, finish: next => { observe(next); return validateHistoryIdentityV6(result, next) } }
}
export function advanceHistoryIdentityV6(input: HistoryIdentityV6, previousDocument: SceneDocumentV3, next: SceneDocumentV3, options: AdvanceHistoryIdentityOptionsV6 = {}): HistoryIdentityV6 {
  return createHistoryIdentityTraceV6(input, previousDocument, options).finish(next)
}
/** Merges births/tombstones; today's live topology markers always win. */
export function mergeIdentityRecordsV6(currentInput: unknown, others: readonly unknown[]): HistoryIdentityV6 {
  const current = validateHistoryIdentityShapeV6(currentInput)
  for (const historicInput of others) {
    const historic = validateHistoryIdentityShapeV6(historicInput)
    if (current.lineageId !== historic.lineageId || current.rootSceneId !== historic.rootSceneId) throw new Error('历史不是同一lineage/root，不能恢复。')
    for (const field of ['propTokens', 'prefabTokens'] as const) for (const [id, token] of Object.entries(historic[field])) { if (Object.hasOwn(current[field], id) && current[field][id] !== token) throw new Error(`历史身份token冲突：${id}。`); current[field][id] = token }
    for (const [id, record] of Object.entries(historic.outdoorTokens)) {
      const prior = current.outdoorTokens[id]
      if (prior && (prior.kind !== record.kind || prior.token !== record.token)) throw new Error(`历史室外出生身份冲突：${id}。`)
      if (!prior) current.outdoorTokens[id] = record
    }
  }
  return validateHistoryIdentityShapeV6(current)
}
export function mergeHistoryIdentitiesV6(currentInput: unknown, currentDocument: SceneDocumentV3, historicInput: unknown, historicDocument: SceneDocumentV3): HistoryIdentityV6 {
  validateHistoryIdentityV6(currentInput, currentDocument); validateHistoryIdentityV6(historicInput, historicDocument)
  return validateHistoryIdentityV6(mergeIdentityRecordsV6(currentInput, [historicInput]), currentDocument)
}
export function assertOutdoorContinuityV6(current: HistoryIdentityV6, historic: HistoryIdentityV6, ids: readonly string[]): void {
  for (const id of ids) {
    const before = historic.outdoorTokens[id], after = current.outdoorTokens[id]
    if (!before || !after || before.kind !== after.kind || before.token !== after.token || before.topologyToken !== after.topologyToken || before.topologyHash !== after.topologyHash) throw new Error(`室外出生或拓扑连续性不足，旧快照不可恢复：${id}。`)
  }
}
