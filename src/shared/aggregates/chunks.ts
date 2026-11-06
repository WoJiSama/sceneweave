import type { AggregateChunkKey } from '../model/aggregate.js'
import type { BoundsMm, PointMm } from '../model/scene.js'
import { canonicalJson, captureJson, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'

export const AGGREGATE_CHUNK_ALGORITHM = 'aggregate-spatial-chunks@1' as const
export const DEFAULT_AGGREGATE_CHUNK_SIZE_MM = 8000
const MAX_CHUNKS = 16384, MAX_REFERENCES = 131072
export interface AggregateChunkEntry {
  /** Scene entity IDs are globally unique, including nested point IDs. */
  id: string; floorId: string; boundsMm: BoundsMm | null
  /** Semantic ownership is deliberately absent from spatial addresses. */
  dependencies?: string[]
}
export interface AggregateChunkManifest {
  algorithm: typeof AGGREGATE_CHUNK_ALGORITHM
  chunkSizeMm: number; sourceHash: string
  entries: readonly AggregateChunkEntry[]
  chunks: readonly { key: AggregateChunkKey; contentState: 'planned' | 'generated' | 'modified'; entityIds: readonly string[] }[]
  /** No finite independent envelope, or too many intersected cells: never omit. */
  broadEntityIds: readonly string[]
}
export interface AggregateChunkLoadPlan {
  sourceHash: string; keys: readonly AggregateChunkKey[]; entityIds: readonly string[]
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export const aggregateChunkAddress = (key: AggregateChunkKey): string => canonicalJson([key.floorId, key.x, key.y])
const validText = (text: string) => typeof text === 'string' && text.length > 0 && text.length <= 256
const validBounds = (bounds: BoundsMm) => bounds && [bounds.x, bounds.y, bounds.width, bounds.height, bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite) && bounds.width >= 0 && bounds.height >= 0
const overlaps = (a: BoundsMm, b: BoundsMm) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
const range = (bounds: BoundsMm, size: number) => {
  const x0 = Math.floor(bounds.x / size), x1 = Math.floor((bounds.x + bounds.width) / size)
  const y0 = Math.floor(bounds.y / size), y1 = Math.floor((bounds.y + bounds.height) / size)
  const count = (x1 - x0 + 1) * (y1 - y0 + 1)
  return { x0, x1, y0, y1, count, safe: [x0, x1, y0, y1, count].every(Number.isSafeInteger) && count > 0 }
}

/** One canonical entity row; intersecting cells contain references only.
 * Bounds may be conservative. Residency does not certify geometry or resources.
 * The caller owns audience filtering before constructing this GM/session index.
 */
export function buildAggregateChunkManifest(input: readonly AggregateChunkEntry[], options: {
  chunkSizeMm?: number; modifiedEntityIds?: readonly string[]; plannedKeys?: readonly AggregateChunkKey[]; modifiedKeys?: readonly AggregateChunkKey[]
} = {}): AggregateChunkManifest {
  const entries = captureJson(input) as AggregateChunkEntry[], settings = captureJson(options)
  if (Object.keys(settings).some(key => !['chunkSizeMm', 'modifiedEntityIds', 'plannedKeys', 'modifiedKeys'].includes(key))
    || [settings.modifiedEntityIds, settings.plannedKeys, settings.modifiedKeys].some(value => value !== undefined && !Array.isArray(value))) throw new Error('区块构建选项无效。')
  const chunkSizeMm = settings.chunkSizeMm ?? DEFAULT_AGGREGATE_CHUNK_SIZE_MM
  if (!Number.isSafeInteger(chunkSizeMm) || chunkSizeMm < 1) throw new Error('区块边长必须为正安全整数毫米。')
  if (!Array.isArray(entries) || entries.length > MAX_REFERENCES) throw new Error('区块实体清单无效或超过保护预算。')
  const byId = new Map<string, AggregateChunkEntry>()
  for (const entry of entries) {
    if (!entry || Object.keys(entry).some(key => !['id', 'floorId', 'boundsMm', 'dependencies'].includes(key)) || !validText(entry.id) || !validText(entry.floorId)
      || entry.boundsMm !== null && !validBounds(entry.boundsMm) || entry.dependencies !== undefined && (!Array.isArray(entry.dependencies) || entry.dependencies.some(id => !validText(id)))) throw new Error('区块实体清单含无效字段。')
    if (byId.has(entry.id)) throw new Error(`区块实体清单重复：${entry.id}。`)
    entry.dependencies = [...new Set(entry.dependencies ?? [])].sort(compare)
    byId.set(entry.id, entry)
  }
  for (const entry of entries) for (const id of entry.dependencies ?? []) if (!byId.has(id)) throw new Error(`区块依赖缺失：${id}。`)
  const chunks = new Map<string, { key: AggregateChunkKey; contentState: 'planned' | 'generated' | 'modified'; entityIds: string[] }>()
  const modified = new Set(settings.modifiedEntityIds ?? [])
  for (const id of modified) if (!byId.has(id)) throw new Error(`修改区块引用缺失实体：${id}。`)
  const ensure = (key: AggregateChunkKey) => {
    if (!validText(key.floorId) || !Number.isSafeInteger(key.x) || !Number.isSafeInteger(key.y)) throw new Error('区块地址无效。')
    const address = aggregateChunkAddress(key)
    if (!chunks.has(address)) {
      if (chunks.size >= MAX_CHUNKS) throw new Error('空间区块超过保护预算。')
      chunks.set(address, { key, contentState: 'planned', entityIds: [] })
    }
    return chunks.get(address)!
  }
  for (const key of settings.plannedKeys ?? []) ensure(key)
  // An emptied cell can still carry an actual deletion/exit; empty does not
  // imply ungenerated. The content owner supplies those explicit changed keys.
  for (const key of settings.modifiedKeys ?? []) ensure(key).contentState = 'modified'
  const broadEntityIds: string[] = []; let references = 0
  for (const entry of entries.sort((a, b) => compare(a.id, b.id))) {
    const cells = entry.boundsMm && range(entry.boundsMm, chunkSizeMm)
    if (!cells || !cells.safe || cells.count > 4096 || references + cells.count > MAX_REFERENCES || chunks.size + cells.count > MAX_CHUNKS) { broadEntityIds.push(entry.id); continue }
    references += cells.count
    for (let x = cells.x0; x <= cells.x1; x++) for (let y = cells.y0; y <= cells.y1; y++) {
      const chunk = ensure({ floorId: entry.floorId, x, y })
      chunk.entityIds.push(entry.id)
      if (modified.has(entry.id)) chunk.contentState = 'modified'
      else if (chunk.contentState === 'planned') chunk.contentState = 'generated'
    }
  }
  const content = { algorithm: AGGREGATE_CHUNK_ALGORITHM, chunkSizeMm, entries, chunks: [...chunks.values()].sort((a, b) => compare(aggregateChunkAddress(a.key), aggregateChunkAddress(b.key))), broadEntityIds }
  return freezeJson({ ...content, sourceHash: sha256Text(canonicalJson(content)) })
}

/** Demand includes full dependency distance, not merely eight neighboring cells.
 * Entity IDs deduplicate both spanning shapes and overlapping requests.
 */
export function planAggregateChunks(manifest: AggregateChunkManifest, input: {
  floorId?: string; boundsMm?: BoundsMm; marginMm?: number; selectedIds?: readonly string[]
}): AggregateChunkLoadPlan {
  const query = captureJson(input), byId = new Map(manifest.entries.map(entry => [entry.id, entry]))
  if (Object.keys(query).some(key => !['floorId', 'boundsMm', 'marginMm', 'selectedIds'].includes(key))
    || query.selectedIds !== undefined && (!Array.isArray(query.selectedIds) || query.selectedIds.some(id => !validText(id)))) throw new Error('区块需求选项无效。')
  const margin = query.marginMm ?? 0
  if (!Number.isFinite(margin) || margin < 0 || query.boundsMm !== undefined && !validBounds(query.boundsMm)) throw new Error('区块查询范围或邻接带无效。')
  if (query.boundsMm && !validText(query.floorId!)) throw new Error('区块视口须指定Floor。')
  const bounds = query.boundsMm && { x: query.boundsMm.x - margin, y: query.boundsMm.y - margin, width: query.boundsMm.width + margin * 2, height: query.boundsMm.height + margin * 2 }
  if (bounds && !validBounds(bounds)) throw new Error('区块邻接带范围必须有限。')
  const selected = new Set<string>(query.selectedIds ?? [])
  for (const id of selected) if (!byId.has(id)) throw new Error(`显式选择的区块实体不存在：${id}。`)
  const keys = new Map<string, AggregateChunkKey>()
  for (const chunk of manifest.chunks) if (bounds && chunk.key.floorId === query.floorId && overlaps(bounds, { x: chunk.key.x * manifest.chunkSizeMm, y: chunk.key.y * manifest.chunkSizeMm, width: manifest.chunkSizeMm, height: manifest.chunkSizeMm })) {
    keys.set(aggregateChunkAddress(chunk.key), chunk.key)
    for (const id of chunk.entityIds) selected.add(id)
  }
  for (const id of manifest.broadEntityIds) {
    const entry = byId.get(id)!
    if (bounds && entry.floorId === query.floorId && (!entry.boundsMm || overlaps(entry.boundsMm, bounds))) selected.add(id)
  }
  const pending = [...selected]
  for (let i = 0; i < pending.length; i++) for (const id of byId.get(pending[i])!.dependencies ?? []) if (!selected.has(id)) { selected.add(id); pending.push(id) }
  for (const chunk of manifest.chunks) if (chunk.entityIds.some(id => selected.has(id))) keys.set(aggregateChunkAddress(chunk.key), chunk.key)
  return freezeJson({ sourceHash: manifest.sourceHash, keys: [...keys.values()].sort((a, b) => compare(aggregateChunkAddress(a), aggregateChunkAddress(b))), entityIds: [...selected].sort(compare) })
}

export interface AggregatePartitionGenerationInput {
  algorithm: 'aggregate-partition-stream@1'; seed: string
  domainAlgorithm: { id: string; version: number }; recipe: { id: string; version: number }
  logicalRegionKey: string; chunk: AggregateChunkKey; channel: string
}
/** New sampling identity only. Existing domain algorithms and replay vectors are
 * never routed here implicitly; instance/group IDs cannot affect this stream.
 */
export function aggregatePartitionSeed(input: AggregatePartitionGenerationInput): string {
  const value = captureJson(input)
  if (!value || Object.keys(value).sort().join(',') !== 'algorithm,channel,chunk,domainAlgorithm,logicalRegionKey,recipe,seed' || value.algorithm !== 'aggregate-partition-stream@1'
    || ![value.seed, value.logicalRegionKey, value.channel, value.domainAlgorithm?.id, value.recipe?.id, value.chunk?.floorId].every(validText)
    || Object.keys(value.domainAlgorithm).sort().join(',') !== 'id,version' || Object.keys(value.recipe).sort().join(',') !== 'id,version' || Object.keys(value.chunk).sort().join(',') !== 'floorId,x,y'
    || ![value.domainAlgorithm?.version, value.recipe?.version].every(version => Number.isSafeInteger(version) && version >= 1)
    || ![value.chunk.x, value.chunk.y].every(Number.isSafeInteger)) throw new Error('分区随机流须绑定明确算法、配方及稳定逻辑区域键。')
  return sha256Text(canonicalJson(value))
}
export function aggregatePartitionPointOwner(floorId: string, point: PointMm, chunkSizeMm = DEFAULT_AGGREGATE_CHUNK_SIZE_MM): AggregateChunkKey {
  if (!validText(floorId) || !Number.isSafeInteger(chunkSizeMm) || chunkSizeMm < 1 || ![point.x, point.y].every(Number.isSafeInteger)) throw new Error('分区点归属无效。')
  const key = { floorId, x: Math.floor(point.x / chunkSizeMm), y: Math.floor(point.y / chunkSizeMm) }
  if (![key.x, key.y].every(Number.isSafeInteger)) throw new Error('分区地址超出安全范围。')
  return key
}

/** Explicit new lattice sampler, independent of all existing domain replay.
 * A logical sample cell has the same stream in either neighbor's halo. The
 * half-open point owner emits it once; halo candidates remain read-only inputs
 * for the domain's real clearance/support solver, not adopted content.
 */
export function generateAggregatePartitionPoints(input: AggregatePartitionGenerationInput & {
  chunkSizeMm: number; spacingMm: number; jitterMm: number; haloMm: number
}): { owned: { key: string; positionMm: PointMm }[]; halo: { key: string; positionMm: PointMm }[] } {
  const value = captureJson(input)
  const { chunkSizeMm, spacingMm, jitterMm, haloMm, ...stream } = value
  aggregatePartitionSeed(stream)
  if (![chunkSizeMm, spacingMm].every(number => Number.isSafeInteger(number) && number > 0)
    || ![jitterMm, haloMm].every(number => Number.isSafeInteger(number) && number >= 0) || jitterMm * 2 > spacingMm) throw new Error('分区采样须提供有限正间距及有界邻接带。')
  const chunk = stream.chunk, bounds = { x: chunk.x * chunkSizeMm - haloMm, y: chunk.y * chunkSizeMm - haloMm, width: chunkSizeMm + haloMm * 2, height: chunkSizeMm + haloMm * 2 }
  if (!validBounds(bounds) || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger)) throw new Error('分区采样范围超出安全整数。')
  const x0 = Math.floor((bounds.x - jitterMm) / spacingMm), x1 = Math.ceil((bounds.x + bounds.width + jitterMm) / spacingMm)
  const y0 = Math.floor((bounds.y - jitterMm) / spacingMm), y1 = Math.ceil((bounds.y + bounds.height + jitterMm) / spacingMm)
  if (![x0, x1, y0, y1].every(Number.isSafeInteger) || (x1 - x0 + 1) * (y1 - y0 + 1) > 65536) throw new Error('分区采样超过保护预算。')
  const owned: { key: string; positionMm: PointMm }[] = [], halo: typeof owned = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const seed = aggregatePartitionSeed({ ...stream, chunk: { floorId: chunk.floorId, x, y } })
    const offset = (part: string) => jitterMm === 0 ? 0 : Number.parseInt(part, 16) % (jitterMm * 2 + 1) - jitterMm
    const positionMm = { x: x * spacingMm + offset(seed.slice(0, 8)), y: y * spacingMm + offset(seed.slice(8, 16)) }
    if (![positionMm.x, positionMm.y].every(Number.isSafeInteger) || positionMm.x < bounds.x || positionMm.y < bounds.y || positionMm.x > bounds.x + bounds.width || positionMm.y > bounds.y + bounds.height) continue
    const candidate = { key: sha256Text(canonicalJson([stream.algorithm, stream.logicalRegionKey, stream.channel, x, y, seed])), positionMm }
    const owner = aggregatePartitionPointOwner(chunk.floorId, positionMm, chunkSizeMm)
    ;(owner.x === chunk.x && owner.y === chunk.y ? owned : halo).push(candidate)
  }
  return { owned, halo }
}
