import { z } from 'zod'
import { inspectJsonInput, cloneJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import type { SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { COMPOSITION_LIMITS } from '../model/appearance.js'
import type { HistoryIdentity, OutdoorIdentityKind, OutdoorIdentityToken } from '../model/history.js'


const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留 ID')
const outdoorToken = z.object({ kind: z.enum(['terrainArea', 'terrainPoint', 'terrainSegment', 'terrainEdge', 'terrainConnection', 'path', 'scatterGroup', 'scatterExclusion']), token: id, topologyToken: id, topologyHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const historyIdentitySchema = z.object({ version: z.literal(1), lineageId: id, rootSceneId: id, propTokens: z.record(id, id), prefabTokens: z.record(id, id), outdoorTokens: z.record(id, outdoorToken) }).strict()
// A converted v6 identity retains its exact topology hash; do not substitute
// the new package's canonical serialization for this existing identity domain.
const canonical = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
interface Descriptor { kind: OutdoorIdentityKind; topologyHash: string }
/** Coordinates and business/appearance fields do not determine birth or topology continuity. */
export function outdoorIdentityDescriptors(document: Readonly<SceneDocument>): Record<string, Descriptor> {
  const result: Record<string, Descriptor> = {}
  const add = (id: string, kind: OutdoorIdentityKind, topology: unknown) => { if (Object.hasOwn(result, id)) throw new Error(`室外身份重复：${id}。`); result[id] = { kind, topologyHash: sha256Text(canonical(topology)) } }
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
const newToken = (descriptor: Descriptor, context: PreparationContext): OutdoorIdentityToken => ({ kind: descriptor.kind, topologyHash: descriptor.topologyHash, token: context.ids.nextId(), topologyToken: context.ids.nextId() })
export function validateHistoryIdentityShape(input: unknown): HistoryIdentity {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`室外历史身份无效：${issue.message}`)
  const parsed = historyIdentitySchema.safeParse(input)
  if (!parsed.success) throw new Error(`室外历史身份字段无效：${parsed.error.issues.map(issue => issue.message).join('；')}`)
  const identity = parsed.data, ids = [...Object.keys(identity.propTokens), ...Object.keys(identity.prefabTokens), ...Object.keys(identity.outdoorTokens)]
  const births = [...Object.values(identity.propTokens), ...Object.values(identity.prefabTokens), ...Object.values(identity.outdoorTokens).map(value => value.token)]
  const topologies = Object.values(identity.outdoorTokens).map(value => value.topologyToken)
  if (ids.length > COMPOSITION_LIMITS.identities || new Set(ids).size !== ids.length) throw new Error('物件、组合及室外出生身份/墓碑合计超过65536或ID重复。')
  if (new Set([...births, ...topologies]).size !== births.length + topologies.length) throw new Error('出生及拓扑令牌必须全局唯一。')
  return identity
}
export function validateHistoryIdentity(input: unknown, document: SceneDocument): HistoryIdentity {
  const identity = validateHistoryIdentityShape(input), checked = validateSceneSnapshot(document)
  if (!checked.ok) throw new Error(`历史身份对应场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const occupiedBirths = geometryIdentityIds(checked.document)
  for (const layerId of Object.keys(checked.document.userLayers)) occupiedBirths.add(layerId)
  for (const [collection, field] of [['props', 'propTokens'], ['prefabInstances', 'prefabTokens']] as const) {
    for (const liveId of Object.keys(checked.document[collection])) {
      if (!Object.hasOwn(identity[field], liveId)) throw new Error(`当前物件/组合缺少身份 token：${liveId}。`)
      occupiedBirths.delete(liveId)
    }
  }
  for (const allocatedId of [...Object.keys(identity.propTokens), ...Object.keys(identity.prefabTokens)]) {
    if (occupiedBirths.has(allocatedId)) throw new Error(`已分配历史 ID 与其他场景身份冲突：${allocatedId}。`)
  }
  const descriptors = outdoorIdentityDescriptors(checked.document), occupied = geometryIdentityIds(checked.document)
  for (const layerId of Object.keys(checked.document.userLayers)) occupied.add(layerId)
  for (const [id, descriptor] of Object.entries(descriptors)) {
    const record = identity.outdoorTokens[id]
    if (!record || record.kind !== descriptor.kind || record.topologyHash !== descriptor.topologyHash) throw new Error(`室外对象缺少有效出生/拓扑身份：${id}。`)
    occupied.delete(id)
  }
  for (const id of Object.keys(identity.outdoorTokens)) if (occupied.has(id)) throw new Error(`已分配室外ID与其他身份冲突：${id}。`)
  return identity
}
export function createHistoryIdentity(inputDocument: SceneDocument, context: PreparationContext): HistoryIdentity {
  const checked = validateSceneSnapshot(inputDocument)
  if (!checked.ok) throw new Error(`历史身份对应场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const document = checked.document
  return validateHistoryIdentity({ version: 1, lineageId: context.ids.nextId(), rootSceneId: document.sceneId,
    propTokens: Object.fromEntries(Object.keys(document.props).map(id => [id, context.ids.nextId()])),
    prefabTokens: Object.fromEntries(Object.keys(document.prefabInstances).map(id => [id, context.ids.nextId()])),
    outdoorTokens: Object.fromEntries(Object.entries(outdoorIdentityDescriptors(document)).map(([id, descriptor]) => [id, newToken(descriptor, context)])),
  }, document)
}
export interface AdvanceHistoryIdentityOptions { allowResurrection?: boolean }
export interface HistoryIdentityTrace {
  /** Extract identities synchronously; the caller retains ownership of the mutable draft. */
  observe(document: Readonly<SceneDocument>): void
  finish(document: SceneDocument): HistoryIdentity
}
/**
 * Track the actual native drafts without requiring each intermediate dependency graph to be valid.
 * A topology changed and changed back in one atomic batch still receives a new continuity marker.
 */
export function createHistoryIdentityTrace(input: HistoryIdentity, previousDocument: SceneDocument, context: PreparationContext, options: AdvanceHistoryIdentityOptions = {}): HistoryIdentityTrace {
  const identity = validateHistoryIdentity(input, previousDocument)
  const result = cloneJson(identity)
  let previousProps = new Set(Object.keys(previousDocument.props)), previousPrefabs = new Set(Object.keys(previousDocument.prefabInstances)), previousOutdoor = outdoorIdentityDescriptors(previousDocument)
  const observe = (next: Readonly<SceneDocument>) => {
    if (previousDocument.sceneId !== next.sceneId) throw new Error('身份只能推进同一场景的修订。')
    const nextProps = new Set(Object.keys(next.props)), nextPrefabs = new Set(Object.keys(next.prefabInstances)), nextOutdoor = outdoorIdentityDescriptors(next)
    for (const [present, previous, field] of [[nextProps, previousProps, 'propTokens'], [nextPrefabs, previousPrefabs, 'prefabTokens']] as const) for (const id of present) {
      if (Object.hasOwn(result[field], id)) { if (!previous.has(id) && !options.allowResurrection) throw new Error(`普通编辑不能复用已分配的物件/组合 ID：${id}。`) }
      else { if (Object.hasOwn(result.outdoorTokens, id) || Object.hasOwn(result[field === 'propTokens' ? 'prefabTokens' : 'propTokens'], id)) throw new Error(`新出生ID与已分配身份冲突：${id}。`); result[field][id] = context.ids.nextId() }
    }
    for (const [id, descriptor] of Object.entries(nextOutdoor)) {
      const record = result.outdoorTokens[id]
      if (record) {
        if (record.kind !== descriptor.kind || !previousOutdoor[id] && !options.allowResurrection) throw new Error(`普通编辑不能复用已分配的室外 ID：${id}。`)
        if (!previousOutdoor[id] || record.topologyHash !== descriptor.topologyHash) result.outdoorTokens[id] = { ...record, kind: descriptor.kind, topologyHash: descriptor.topologyHash, topologyToken: context.ids.nextId() }
      } else {
        if (Object.hasOwn(result.propTokens, id) || Object.hasOwn(result.prefabTokens, id)) throw new Error(`新室外ID与已分配身份冲突：${id}。`)
        result.outdoorTokens[id] = newToken(descriptor, context)
      }
    }
    previousProps = nextProps; previousPrefabs = nextPrefabs; previousOutdoor = nextOutdoor
  }
  return { observe, finish: next => { observe(next); return validateHistoryIdentity(result, next) } }
}
export function advanceHistoryIdentity(input: HistoryIdentity, previousDocument: SceneDocument, next: SceneDocument, context: PreparationContext, options: AdvanceHistoryIdentityOptions = {}): HistoryIdentity {
  return createHistoryIdentityTrace(input, previousDocument, context, options).finish(next)
}
/** Merges births/tombstones; today's live topology markers always win. */
export function mergeIdentityRecords(currentInput: unknown, others: readonly unknown[]): HistoryIdentity {
  const current = validateHistoryIdentityShape(currentInput)
  for (const historicInput of others) {
    const historic = validateHistoryIdentityShape(historicInput)
    if (current.lineageId !== historic.lineageId || current.rootSceneId !== historic.rootSceneId) throw new Error('历史不是同一lineage/root，不能恢复。')
    for (const field of ['propTokens', 'prefabTokens'] as const) for (const [id, token] of Object.entries(historic[field])) { if (Object.hasOwn(current[field], id) && current[field][id] !== token) throw new Error(`历史身份token冲突：${id}。`); current[field][id] = token }
    for (const [id, record] of Object.entries(historic.outdoorTokens)) {
      const prior = current.outdoorTokens[id]
      if (prior && (prior.kind !== record.kind || prior.token !== record.token)) throw new Error(`历史室外出生身份冲突：${id}。`)
      if (!prior) current.outdoorTokens[id] = record
    }
  }
  return validateHistoryIdentityShape(current)
}
export function mergeHistoryIdentities(currentInput: unknown, currentDocument: SceneDocument, historicInput: unknown, historicDocument: SceneDocument): HistoryIdentity {
  validateHistoryIdentity(currentInput, currentDocument); validateHistoryIdentity(historicInput, historicDocument)
  return validateHistoryIdentity(mergeIdentityRecords(currentInput, [historicInput]), currentDocument)
}
export function assertOutdoorContinuity(current: HistoryIdentity, historic: HistoryIdentity, ids: readonly string[]): void {
  for (const id of ids) {
    const before = historic.outdoorTokens[id], after = current.outdoorTokens[id]
    if (!before || !after || before.kind !== after.kind || before.token !== after.token || before.topologyToken !== after.topologyToken || before.topologyHash !== after.topologyHash) throw new Error(`室外出生或拓扑连续性不足，旧快照不可恢复：${id}。`)
  }
}
