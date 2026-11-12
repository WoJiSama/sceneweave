import Dexie from 'dexie'
import type { HistoryVersionSummary } from '../../../application/ports/project-store.js'
export type { HistoryVersionSummary } from '../../../application/ports/project-store.js'
import type { ProjectData, SnapshotSummary } from '../../../shared/model/project.js'
import { applyProjectDelta, createProjectDeltaReplay, validateProjectDelta, projectDeltaBytes, projectDeltaJson, type JsonDelta } from '../../../shared/project/delta.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { canonicalProjectCoordinates, decodeProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8, freezeJson } from '../../../shared/validation/json.js'
import type { StoredAutomatic, StoredProject, StoredSnapshot } from './database.js'
import { createFixedProjectFamilyCheck, validateSnapshotSummary } from '../../../shared/project/history.js'
import { matchingEncodedSnapshot } from './content-context.js'

export const INCREMENTAL_HISTORY_LIMITS = Object.freeze({ chainLength: 4, versions: 65_536 })

export interface HistoryVersion {
  format: 'sceneweave-history-version'
  version: 1
  ownerSceneId: string
  id: string
  revision: number
  savedAt: string
  contentHash: string
  parentId: string | null
  parentHash: string | null
  checkpoint: ProjectData | null
  delta: JsonDelta | null
  depth: number
  chainBytes: number
  automatic: boolean
  recordHash: string
}
export interface HistoryMigration {
  currentHash: string
  revision: number
  metadataVersion: number
  sourceManifestHash: string
}
export interface HistoryHead {
  format: 'sceneweave-history-head'
  version: 1
  ownerSceneId: string
  status: 'staged' | 'ready'
  activeVersionId: string
  savedRevision: number
  contentHash: string
  migration: HistoryMigration | null
  recordHash: string
}
export interface HistoryPin extends SnapshotSummary {
  format: 'sceneweave-history-pin'
  version: 1
  versionId: string
  recordHash: string
}
export interface HistoryGraph { head: HistoryHead; versions: HistoryVersion[]; pins: HistoryPin[] }
/** Opaque proof lifetime for one repository restoration; never a persisted cache. */
export interface HistoryReadSession { close(): void }
export interface HistoryReadState {
  closed: boolean
  busy: boolean
  cached: { records: string[]; project: ProjectData } | null
}
export interface HistoryReadRecords { values: string[]; characters: number; overflow: boolean }
export const READ_CHARACTER_LIMIT = 4 * 1024 * 1024
const HASH = /^[a-f0-9]{64}$/
const VERSION_FIELDS = ['format', 'version', 'ownerSceneId', 'id', 'revision', 'savedAt', 'contentHash', 'parentId', 'parentHash', 'checkpoint', 'delta', 'depth', 'chainBytes', 'automatic', 'recordHash'] as const
const HEAD_FIELDS = ['format', 'version', 'ownerSceneId', 'status', 'activeVersionId', 'savedRevision', 'contentHash', 'migration', 'recordHash'] as const
const PIN_FIELDS = ['format', 'version', 'versionId', 'id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'recordHash'] as const
const MIGRATION_FIELDS = ['currentHash', 'revision', 'metadataVersion', 'sourceManifestHash'] as const
export const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '__proto__'
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && HASH.test(value)
export const validTime = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
function exact(input: unknown, fields: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('增量历史须为普通数据记录。')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== fields.length || !fields.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('增量历史含未知、缺失、访问器、隐藏或Symbol字段。')
}
/** The complete project and each delta have independent JSON input budgets. */
function recordFields(input: object, includeHash = true): [string, string][] {
  return Object.entries(input).filter(([key]) => includeHash || key !== 'recordHash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => [key, `${JSON.stringify(key)}:${key === 'delta' && value !== null ? projectDeltaJson(value) : key === 'checkpoint' && value !== null ? checkpointJson(value as ProjectData) : canonicalJson(value)}`])
}
function checkpointJson(project: ProjectData): string {
  const transaction = Dexie.currentTransaction
  return transaction && matchingEncodedSnapshot(transaction.idbtrans, project)?.encoded.canonical || canonicalProjectCoordinates(project)
}
/** Pure byte/hash memoization only, scoped to one native tx. Every incoming row
 * is still serialized in full and its declared recordHash compared below. */
const recordDigests = new WeakMap<IDBTransaction, { body: string; hash: string }[]>()
function digestBody(body: string): string {
  const transaction = Dexie.currentTransaction?.idbtrans
  let entries = transaction && recordDigests.get(transaction)
  const known = entries?.find(entry => entry.body === body)
  if (known) return known.hash
  const hash = sha256Bytes(encodeUtf8(body))
  if (transaction && body.length * 2 <= 16 * 1024 * 1024) {
    if (!entries) {
      entries = []; recordDigests.set(transaction, entries)
      const clear = () => recordDigests.delete(transaction)
      transaction.addEventListener('complete', clear, { once: true }); transaction.addEventListener('abort', clear, { once: true })
    }
    while (entries.length >= 4 || entries.reduce((sum, entry) => sum + entry.body.length * 2, body.length * 2) > 16 * 1024 * 1024) entries.shift()
    entries.push({ body, hash })
  }
  return hash
}
function recordJson(input: object, includeHash = true): string { return `{${recordFields(input, includeHash).map(([, value]) => value).join(',')}}` }
const digest = (input: object) => digestBody(recordJson(input, false))
export const seal = <T extends object>(input: T): T & { recordHash: string } => ({ ...input, recordHash: digest(input) })
function assertDigest(input: { recordHash: string }): string {
  const fields = recordFields(input), body = `{${fields.filter(([key]) => key !== 'recordHash').map(([, value]) => value).join(',')}}`
  if (!hash(input.recordHash) || digestBody(body) !== input.recordHash) throw new Error('增量历史记录hash损坏。')
  return `{${fields.map(([, value]) => value).join(',')}}`
}
/** Strict wire/envelope checks. Only readVersion may defer checkpoint metadata
 * to its immediately following strict chain reconstruction. Never exported. */
export function checkVersionRecord(input: unknown, owner?: string): { row: HistoryVersion; json: string } {
  exact(input, VERSION_FIELDS)
  if (input.format !== 'sceneweave-history-version' || input.version !== 1 || !validId(input.ownerSceneId) || owner !== undefined && input.ownerSceneId !== owner
    || !validId(input.id) || !integer(input.revision) || !validTime(input.savedAt) || !hash(input.contentHash) || !integer(input.depth)
    || input.depth >= INCREMENTAL_HISTORY_LIMITS.chainLength || !integer(input.chainBytes) || typeof input.automatic !== 'boolean'
    || input.parentId !== null && !validId(input.parentId) || input.parentHash !== null && !hash(input.parentHash)
    || (input.parentId === null) !== (input.parentHash === null) || input.parentId === input.id
    || (input.checkpoint === null) === (input.delta === null)) throw new Error('增量历史版本身份、父版本或payload损坏。')
  if (input.checkpoint !== null) {
    if (input.depth !== 0 || input.chainBytes !== 0) throw new Error('增量历史完整检查点hash或链长损坏。')
  } else {
    const delta = validateProjectDelta(input.delta)
    if (input.parentId === null || delta.beforeHash !== input.parentHash || delta.afterHash !== input.contentHash || input.depth === 0) throw new Error('增量历史差异与前后hash不符。')
  }
  const row = input as unknown as HistoryVersion, json = assertDigest(row)
  // record serialization has now rejected accessors and other non-JSON values.
  if (row.checkpoint !== null && row.checkpoint.document?.revision !== row.revision) throw new Error('增量历史完整检查点修订损坏。')
  return { row, json }
}
export function assertCheckpoint(row: HistoryVersion, hashContent: (project: ProjectData) => string): void {
  if (row.checkpoint !== null && hashContent(row.checkpoint) !== row.contentHash) throw new Error('增量历史完整检查点hash或链长损坏。')
}
export function checkedVersionJson(input: unknown, hashContent: (project: ProjectData) => string = projectContentHash): string {
  const { row, json } = checkVersionRecord(input)
  assertCheckpoint(row, hashContent)
  return json
}
export function assertVersion(input: unknown, owner?: string, hashContent: (project: ProjectData) => string = projectContentHash): asserts input is HistoryVersion {
  const { row } = checkVersionRecord(input, owner)
  assertCheckpoint(row, hashContent)
}
export function assertHead(input: unknown, owner: string): asserts input is HistoryHead {
  exact(input, HEAD_FIELDS)
  if (input.format !== 'sceneweave-history-head' || input.version !== 1 || input.ownerSceneId !== owner || !validId(owner)
    || !['staged', 'ready'].includes(input.status as string) || !validId(input.activeVersionId) || !integer(input.savedRevision) || !hash(input.contentHash)) throw new Error('增量历史活动版本损坏。')
  if (input.migration !== null) {
    exact(input.migration, MIGRATION_FIELDS)
    if (!hash(input.migration.currentHash) || !integer(input.migration.revision) || !integer(input.migration.metadataVersion) || !hash(input.migration.sourceManifestHash)) throw new Error('增量历史迁移摘要损坏。')
  }
  if (input.status === 'staged' && input.migration === null) throw new Error('增量历史私有暂存缺少来源摘要。')
  assertDigest(input as unknown as HistoryHead)
}
export function summary(input: SnapshotSummary): SnapshotSummary {
  return { id: input.id, ownerSceneId: input.ownerSceneId, lineageId: input.lineageId, sourceRevision: input.sourceRevision,
    name: input.name, kind: input.kind, createdAt: input.createdAt, contentHash: input.contentHash }
}
export function assertPin(input: unknown, owner: string): asserts input is HistoryPin {
  exact(input, PIN_FIELDS)
  const row = input as unknown as HistoryPin
  if (row.format !== 'sceneweave-history-pin' || row.version !== 1 || row.ownerSceneId !== owner || !validId(row.versionId)) throw new Error('增量历史快照引用身份损坏。')
  validateSnapshotSummary(summary(row)); assertDigest(row)
}
export function historyVersionBytes(input: unknown): number {
  return encodeUtf8(checkedVersionJson(input)).length
}
export function versionByteLength(input: HistoryVersion, json: string): number {
  const transaction = Dexie.currentTransaction
  const snapshot = input.checkpoint && transaction && matchingEncodedSnapshot(transaction.idbtrans, input.checkpoint)
  return snapshot ? encodeUtf8(recordJson({ ...input, checkpoint: null })).length - 4 + snapshot.encoded.byteLength : encodeUtf8(json).length
}
export function historyHeadBytes(input: unknown): number {
  exact(input, HEAD_FIELDS)
  if (!validId(input.ownerSceneId)) throw new Error('增量历史工程ID无效。')
  assertHead(input, input.ownerSceneId)
  return encodeUtf8(recordJson(input)).length
}
export function historyPinBytes(input: unknown): number {
  exact(input, PIN_FIELDS)
  if (!validId(input.ownerSceneId)) throw new Error('增量历史工程ID无效。')
  assertPin(input, input.ownerSceneId)
  return encodeUtf8(recordJson(input)).length
}
export function historyVersionJson(input: unknown): string { assertVersion(input); return recordJson(input) }
export function historyGraphJson(graph: HistoryGraph): string {
  return `{"head":${recordJson(graph.head)},"pins":[${graph.pins.map(pin => recordJson(pin)).join(',')}],"versions":[${graph.versions.map(version => recordJson(version)).join(',')}]}`
}
function captureRows<T>(input: unknown, maximum: number, read: (row: unknown) => T): T[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum || Reflect.ownKeys(input).length !== input.length + 1) throw new Error('增量历史图数组超过范围或含额外字段。')
  return Array.from({ length: input.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i))
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('增量历史图数组含访问器或空洞。')
    return read(descriptor.value)
  })
}
/** One operation owns these independently reconstructed frozen projects. */
export class ReconstructionCache {
  private readonly entries = new Map<string, { project: ProjectData; bytes: number }>()
  private bytes = 0
  get(id: string): ProjectData | undefined {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id); this.entries.set(id, entry)
    return entry.project
  }
  remember(id: string, project: ProjectData): void {
    // Three bytes per UTF-16 code unit conservatively bounds its UTF-8 JSON.
    // Native stringify avoids another canonical sort of the strict owned data.
    const bytes = JSON.stringify(project).length * 3, maximum = 16 * 1024 * 1024
    if (bytes > maximum) return
    const previous = this.entries.get(id)
    if (previous) { this.entries.delete(id); this.bytes -= previous.bytes }
    while (this.entries.size >= 4 || this.bytes + bytes > maximum) {
      const oldest = this.entries.keys().next().value!
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest)
    }
    this.entries.set(id, { project: freezeJson(project), bytes }); this.bytes += bytes
  }
  clear(): void { this.entries.clear(); this.bytes = 0 }
}
export const orderedVersions = (versions: HistoryVersion[]): HistoryVersion[] => [...versions].sort((a, b) => a.revision - b.revision || a.id.localeCompare(b.id))
/** Public history JSON carries the sole local storage representation. Capture
 * before inspecting its marker; the caller validates the decoded root once. */
export function readCheckpoint(input: unknown): ProjectData {
  const captured = captureJson(input) as ProjectData
  return captured?.document?.aggregateCoordinates?.encoding === 'local' ? decodeProjectCoordinates(captured) : captured
}
export function rebuildFromMap(byId: Map<string, HistoryVersion>, id: string, cache?: ReconstructionCache,
  replay?: ReturnType<typeof createProjectDeltaReplay>): ProjectData {
  const leaf = byId.get(id)
  if (!leaf) throw new Error('增量历史图版本缺失。')
  let current = leaf
  const chain: HistoryVersion[] = [], visited = new Set<string>()
  let cached: ProjectData | undefined
  while (true) {
    if (visited.has(current.id) || chain.length >= INCREMENTAL_HISTORY_LIMITS.chainLength) throw new Error('增量历史图链循环或超过检查点边界。')
    visited.add(current.id)
    cached = cache?.get(current.id)
    if (cached) break
    chain.push(current)
    if (current.parentId !== null) {
      const parent = byId.get(current.parentId)
      if (!parent || parent.contentHash !== current.parentHash || parent.revision >= current.revision) throw new Error('增量历史图父版本缺失、hash或顺序损坏。')
      if (current.checkpoint === null) { current = parent; continue }
    }
    break
  }
  // All rows were strictly checked before entering this private reconstruction.
  let project = cached ?? (replay ? replay.capture(readCheckpoint(current.checkpoint), current.contentHash) : readCheckpoint(current.checkpoint)), depth = cached ? current.depth : 0, bytes = cached ? current.chainBytes : 0
  if (!cached) {
    cache?.remember(current.id, project)
  }
  for (const version of chain.reverse().slice(cached ? 0 : 1)) {
    depth++; bytes += projectDeltaBytes(version.delta)
    if (version.depth !== depth || version.chainBytes !== bytes) throw new Error('增量历史图链长或累计字节不符。')
    project = replay ? replay.apply(project, version.delta) : applyProjectDelta(project, version.delta, 'forward')
    // applyProjectDelta verifies the complete result hash; assertVersion binds
    // that delta.afterHash to this immutable row's contentHash.
    if (project.document.revision !== version.revision) throw new Error('增量历史图重建修订不符。')
    cache?.remember(version.id, project)
  }
  return project
}
/** Portable preservation uses every version, including branches outside the latest automatic list. */
export function* historyGraphProjects(graph: HistoryGraph): Generator<ProjectData> {
  // Detach before yielding control to a consumer that can mutate its graph.
  const versions = graph.versions.map(version => {
    assertVersion(version, graph.head.ownerSceneId)
    return { ...version, checkpoint: version.checkpoint === null ? null : readCheckpoint(version.checkpoint),
      delta: version.delta === null ? null : validateProjectDelta(version.delta) }
  })
  const byId = new Map(versions.map(version => [version.id, version])), cache = new ReconstructionCache()
  try {
    for (const version of orderedVersions(versions)) yield cloneJson(rebuildFromMap(byId, version.id, cache))
  } finally { cache.clear() }
}
export function readHistoryGraphVersion(graph: HistoryGraph, id: string): ProjectData {
  const byId = new Map(graph.versions.map(version => [version.id, version])), visited = new Set<string>()
  let current = byId.get(id)
  if (!current) throw new Error('增量历史图版本缺失。')
  while (true) {
    if (visited.has(current.id) || visited.size >= INCREMENTAL_HISTORY_LIMITS.chainLength) throw new Error('增量历史图链循环或超过检查点边界。')
    visited.add(current.id); assertVersion(current, graph.head.ownerSceneId)
    if (current.parentId === null) break
    const parent = byId.get(current.parentId)
    if (!parent || parent.contentHash !== current.parentHash || parent.revision >= current.revision) throw new Error('增量历史图父版本缺失、hash或顺序损坏。')
    if (current.checkpoint !== null) { assertVersion(parent, graph.head.ownerSceneId); break }
    current = parent
  }
  return rebuildFromMap(byId, id)
}
/** Detached strict graph capture; never trusts stored IDs, statistics or hashes without reconstruction. */
export function captureHistoryGraph(input: unknown): HistoryGraph {
  exact(input, ['head', 'versions', 'pins'])
  exact(input.head, HEAD_FIELDS)
  if (!validId(input.head.ownerSceneId)) throw new Error('增量历史图工程ID无效。')
  const owner = input.head.ownerSceneId
  assertHead(input.head, owner)
  const head = captureJson(input.head) as unknown as HistoryHead
  if (head.status !== 'ready') throw new Error('暂存增量历史图尚不可保全导出。')
  const ids = new Set<string>(), versions = captureRows(input.versions, INCREMENTAL_HISTORY_LIMITS.versions, row => {
    assertVersion(row, owner)
    if (ids.has(row.id)) throw new Error('增量历史图版本ID重复。')
    ids.add(row.id)
    return { ...row, checkpoint: row.checkpoint === null ? null : readCheckpoint(row.checkpoint), delta: row.delta === null ? null : validateProjectDelta(row.delta) }
  })
  const pinIds = new Set<string>(), pins = captureRows(input.pins, 84, row => {
    assertPin(row, owner)
    if (pinIds.has(row.id)) throw new Error('增量历史图快照ID重复。')
    pinIds.add(row.id); return captureJson(row)
  })
  const graph = { head, versions, pins }, byId = new Map(versions.map(version => [version.id, version]))
  let bytes = historyHeadBytes(head)
  const automaticRevisions = new Set<number>()
  const includeFixedMeanings = createFixedProjectFamilyCheck()
  const cache = new ReconstructionCache()
  try {
    for (const version of orderedVersions(versions)) {
      bytes += historyVersionBytes(version)
      if (bytes > 128 * 1024 * 1024) throw new Error('增量历史图文档超过128MiB保全预算。')
      const project = rebuildFromMap(byId, version.id, cache)
      includeFixedMeanings(project)
      if (version.automatic) {
        if (version.revision > head.savedRevision || project.document.sceneId !== owner || automaticRevisions.has(version.revision)) throw new Error('增量历史图自动版本归属、修订或唯一性损坏。')
        automaticRevisions.add(version.revision)
      }
    }
    const counts = { named: 0, protection: 0, 'imported-auto': 0 }
    for (const pin of pins) {
      counts[pin.kind]++
      if (counts.named > 32 || counts.protection > 32 || counts['imported-auto'] > 20) throw new Error('增量历史图快照类别超过保留上限。')
      bytes += historyPinBytes(pin)
      if (bytes > 128 * 1024 * 1024) throw new Error('增量历史图文档超过128MiB保全预算。')
      const project = rebuildFromMap(byId, pin.versionId, cache)
      if (byId.get(pin.versionId)!.contentHash !== pin.contentHash || project.document.revision !== pin.sourceRevision || project.historyIdentity.lineageId !== pin.lineageId) throw new Error('增量历史图快照归属或内容损坏。')
    }
    const active = byId.get(head.activeVersionId)
    if (!active || !active.automatic || active.contentHash !== head.contentHash || active.revision !== head.savedRevision) throw new Error('增量历史图活动版本损坏。')
    return graph
  } finally { cache.clear() }
}
export function assertProject(row: StoredProject, hashContent: (project: ProjectData) => string = projectContentHash): void {
  if (!validId(row.sceneId) || !integer(row.revision) || !validTime(row.savedAt) || row.project.document.sceneId !== row.sceneId
    || row.project.document.revision !== row.revision || hashContent(row.project) !== row.contentHash) throw new Error('增量历史当前工程内容或身份损坏。')
}
export function versionSummary(row: HistoryVersion): HistoryVersionSummary {
  return { id: row.id, ownerSceneId: row.ownerSceneId, revision: row.revision, savedAt: row.savedAt, contentHash: row.contentHash,
    parentId: row.parentId, checkpoint: row.checkpoint !== null, automatic: row.automatic }
}
/** The repository validates complete source rows and bindings before using this manifest in its final CAS. */
export function migrationManifest(current: StoredProject, automatic: StoredAutomatic[], snapshots: StoredSnapshot[], imported: StoredSnapshot[], metadataVersion: number): string {
  if (!integer(metadataVersion)) throw new Error('增量历史迁移元数据版本无效。')
  return sha256Bytes(encodeUtf8(canonicalJson({ current: { sceneId: current.sceneId, revision: current.revision, savedAt: current.savedAt,
    contentHash: current.contentHash, actualHash: projectContentHash(current.project), status: current.status, conversionJobId: current.conversionJobId }, metadataVersion,
  automatic: automatic.map(row => ({ ownerSceneId: row.ownerSceneId, revision: row.revision, savedAt: row.savedAt, contentHash: row.contentHash,
    actualHash: projectContentHash(row.project) })).sort((a, b) => a.revision - b.revision),
  snapshots: snapshots.map(row => ({ ...summary(row), actualHash: projectContentHash(row.project) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  imported: imported.map(row => ({ ...summary(row), actualHash: projectContentHash(row.project) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) })))
}

/** Complete graph validation over one transaction's actual captured rows.
 * The worker and the nonbrowser fallback run this exact implementation. No
 * declared digest, persisted byte count or active-branch shortcut is trusted. */
export function auditHistoryRecords(owner: string, head: HistoryHead | null, rows: HistoryVersion[], pins: HistoryPin[]): { documentBytes: number } {
  if (!validId(owner)) throw new Error('增量历史工程ID无效。')
  if (!head) {
    if (rows.length || pins.length) throw new Error('增量历史存在无活动根的孤立记录。')
    return { documentBytes: 0 }
  }
  assertHead(head, owner)
  if (!rows.length || rows.length > INCREMENTAL_HISTORY_LIMITS.versions || pins.length > 84) throw new Error('增量历史版本数、快照数量或根损坏。')
  let documentBytes = historyHeadBytes(head)
  const includeFixedMeanings = createFixedProjectFamilyCheck(), byteLengths = new Map<string, number>()
  for (const row of rows) {
    const checked = checkVersionRecord(row, owner)
    if (byteLengths.has(row.id)) throw new Error('增量历史图版本ID重复。')
    byteLengths.set(row.id, encodeUtf8(checked.json).length)
  }
  const byId = new Map(rows.map(row => [row.id, row])), cache = new ReconstructionCache(), replay = createProjectDeltaReplay()
  try {
    const automaticRevisions = new Set<number>()
    for (const row of orderedVersions(rows)) {
      const project = rebuildFromMap(byId, row.id, cache, replay)
      if (row.automatic) {
        if (row.revision > head.savedRevision || project.document.sceneId !== owner || automaticRevisions.has(row.revision)) throw new Error('增量历史图自动版本归属、修订或唯一性损坏。')
        automaticRevisions.add(row.revision)
      }
      includeFixedMeanings(project)
      documentBytes += byteLengths.get(row.id)!
    }
    const ids = new Set<string>(), counts = { named: 0, protection: 0, 'imported-auto': 0 }
    for (const pin of pins) {
      assertPin(pin, owner)
      if (ids.has(pin.id)) throw new Error('增量历史图快照ID重复。')
      ids.add(pin.id); counts[pin.kind]++
      if (counts.named > 32 || counts.protection > 32 || counts['imported-auto'] > 20) throw new Error('增量历史图快照类别超过保留上限。')
      const project = rebuildFromMap(byId, pin.versionId, cache, replay)
      if (byId.get(pin.versionId)!.contentHash !== pin.contentHash || project.document.revision !== pin.sourceRevision
        || project.historyIdentity.lineageId !== pin.lineageId) throw new Error('增量历史快照在审计时内容或身份不符。')
      documentBytes += historyPinBytes(pin)
    }
    const active = byId.get(head.activeVersionId)
    if (!active || active.contentHash !== head.contentHash || active.revision !== head.savedRevision || !active.automatic) throw new Error('增量历史活动根与持久修订不符。')
    return { documentBytes }
  } finally { cache.clear(); replay.clear() }
}

