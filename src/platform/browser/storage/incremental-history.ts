import type { ProjectData, SnapshotSummary } from '../../../shared/model/project.js'
import { createProjectDelta, applyProjectDelta, applyProjectDeltaChain, validateProjectDelta, projectDeltaBytes, projectDeltaJson, DeltaSizeError, type JsonDelta } from '../../../shared/project/delta.js'
import { projectContentHash, validateProjectData } from '../../../shared/project/validate.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8, freezeJson } from '../../../shared/validation/json.js'
import type { ProjectDatabase, StoredAutomatic, StoredProject, StoredSnapshot } from './database.js'
import { assertFixedProjectCompatible, createFixedProjectFamilyCheck, hasAddedFixedProjectDefinitions, validateSnapshotSummary } from '../../../shared/project/history.js'

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
export interface HistoryVersionSummary {
  id: string
  ownerSceneId: string
  revision: number
  savedAt: string
  contentHash: string
  parentId: string | null
  checkpoint: boolean
  automatic: boolean
}
export interface HistoryGraph { head: HistoryHead; versions: HistoryVersion[]; pins: HistoryPin[] }
/** Opaque proof lifetime for one repository restoration; never a persisted cache. */
export interface HistoryReadSession { close(): void }
interface HistoryReadState {
  closed: boolean
  busy: boolean
  cached: { records: string[]; project: ProjectData } | null
}
interface HistoryReadRecords { values: string[]; characters: number; overflow: boolean }
const READ_CHARACTER_LIMIT = 4 * 1024 * 1024
const HASH = /^[a-f0-9]{64}$/
const VERSION_FIELDS = ['format', 'version', 'ownerSceneId', 'id', 'revision', 'savedAt', 'contentHash', 'parentId', 'parentHash', 'checkpoint', 'delta', 'depth', 'chainBytes', 'automatic', 'recordHash'] as const
const HEAD_FIELDS = ['format', 'version', 'ownerSceneId', 'status', 'activeVersionId', 'savedRevision', 'contentHash', 'migration', 'recordHash'] as const
const PIN_FIELDS = ['format', 'version', 'versionId', 'id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'recordHash'] as const
const MIGRATION_FIELDS = ['currentHash', 'revision', 'metadataVersion', 'sourceManifestHash'] as const
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '__proto__'
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && HASH.test(value)
const validTime = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
function exact(input: unknown, fields: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('增量历史须为普通数据记录。')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== fields.length || !fields.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('增量历史含未知、缺失、访问器、隐藏或Symbol字段。')
}
/** The complete project and each delta have independent JSON input budgets. */
function recordFields(input: object, includeHash = true): [string, string][] {
  return Object.entries(input).filter(([key]) => includeHash || key !== 'recordHash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => [key, `${JSON.stringify(key)}:${key === 'delta' && value !== null ? projectDeltaJson(value) : canonicalJson(value)}`])
}
function recordJson(input: object, includeHash = true): string { return `{${recordFields(input, includeHash).map(([, value]) => value).join(',')}}` }
const digest = (input: object) => sha256Bytes(encodeUtf8(recordJson(input, false)))
const seal = <T extends object>(input: T): T & { recordHash: string } => ({ ...input, recordHash: digest(input) })
function assertDigest(input: { recordHash: string }): string {
  const fields = recordFields(input), body = `{${fields.filter(([key]) => key !== 'recordHash').map(([, value]) => value).join(',')}}`
  if (!hash(input.recordHash) || sha256Bytes(encodeUtf8(body)) !== input.recordHash) throw new Error('增量历史记录hash损坏。')
  return `{${fields.map(([, value]) => value).join(',')}}`
}
/** Strict wire/envelope checks. Only readVersion may defer checkpoint metadata
 * to its immediately following strict chain reconstruction. Never exported. */
function checkVersionRecord(input: unknown, owner?: string): { row: HistoryVersion; json: string } {
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
function assertCheckpoint(row: HistoryVersion, hashContent: (project: ProjectData) => string): void {
  if (row.checkpoint !== null && hashContent(row.checkpoint) !== row.contentHash) throw new Error('增量历史完整检查点hash或链长损坏。')
}
function checkedVersionJson(input: unknown, hashContent: (project: ProjectData) => string = projectContentHash): string {
  const { row, json } = checkVersionRecord(input)
  assertCheckpoint(row, hashContent)
  return json
}
function assertVersion(input: unknown, owner?: string, hashContent: (project: ProjectData) => string = projectContentHash): asserts input is HistoryVersion {
  const { row } = checkVersionRecord(input, owner)
  assertCheckpoint(row, hashContent)
}
function assertHead(input: unknown, owner: string): asserts input is HistoryHead {
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
function summary(input: SnapshotSummary): SnapshotSummary {
  return { id: input.id, ownerSceneId: input.ownerSceneId, lineageId: input.lineageId, sourceRevision: input.sourceRevision,
    name: input.name, kind: input.kind, createdAt: input.createdAt, contentHash: input.contentHash }
}
function assertPin(input: unknown, owner: string): asserts input is HistoryPin {
  exact(input, PIN_FIELDS)
  const row = input as unknown as HistoryPin
  if (row.format !== 'sceneweave-history-pin' || row.version !== 1 || row.ownerSceneId !== owner || !validId(row.versionId)) throw new Error('增量历史快照引用身份损坏。')
  validateSnapshotSummary(summary(row)); assertDigest(row)
}
export function historyVersionBytes(input: unknown): number {
  return encodeUtf8(checkedVersionJson(input)).length
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
class ReconstructionCache {
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
const orderedVersions = (versions: HistoryVersion[]): HistoryVersion[] => [...versions].sort((a, b) => a.revision - b.revision || a.id.localeCompare(b.id))
function rebuildFromMap(byId: Map<string, HistoryVersion>, id: string, cache?: ReconstructionCache): ProjectData {
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
  let project = cached ?? cloneJson(current.checkpoint!), depth = cached ? current.depth : 0, bytes = cached ? current.chainBytes : 0
  if (!cached) {
    cache?.remember(current.id, project)
  }
  for (const version of chain.reverse().slice(cached ? 0 : 1)) {
    depth++; bytes += projectDeltaBytes(version.delta)
    if (version.depth !== depth || version.chainBytes !== bytes) throw new Error('增量历史图链长或累计字节不符。')
    project = applyProjectDelta(project, version.delta, 'forward')
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
    return { ...version, checkpoint: version.checkpoint === null ? null : validateProjectData(version.checkpoint),
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
    return { ...row, checkpoint: row.checkpoint === null ? null : validateProjectData(row.checkpoint), delta: row.delta === null ? null : validateProjectDelta(row.delta) }
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
function assertProject(row: StoredProject, hashContent: (project: ProjectData) => string = projectContentHash): void {
  if (!validId(row.sceneId) || !integer(row.revision) || !validTime(row.savedAt) || row.project.document.sceneId !== row.sceneId
    || row.project.document.revision !== row.revision || hashContent(row.project) !== row.contentHash) throw new Error('增量历史当前工程内容或身份损坏。')
}
function versionSummary(row: HistoryVersion): HistoryVersionSummary {
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

/** Transaction-local graph operations. Resource verification and publication CAS remain repository-owned. */
export class IncrementalHistory {
  private readonly reads = new WeakMap<HistoryReadSession, HistoryReadState>()
  constructor(private readonly database: ProjectDatabase, private readonly hashContent: (project: ProjectData) => string = projectContentHash,
    private readonly reconstructed?: (project: ProjectData, contentHash: string) => void) {}
  beginRead(): HistoryReadSession {
    const state: HistoryReadState = { closed: false, busy: false, cached: null }
    const session = Object.freeze({ close() { state.closed = true; state.cached = null } })
    this.reads.set(session, state)
    return session
  }
  private readState(session: HistoryReadSession): HistoryReadState {
    const state = this.reads.get(session)
    if (!state || state.closed) throw new Error('增量历史重建会话无效或已关闭。')
    return state
  }
  /** Uses only this repository's transaction-bound exact-content checker. */
  versionBytes(input: unknown): number { return encodeUtf8(checkedVersionJson(input, this.hashContent)).length }
  async head(owner: string): Promise<HistoryHead | null> {
    if (!validId(owner)) throw new Error('增量历史工程ID无效。')
    const row = await this.database.historyHeads.get(owner)
    if (!row) return null
    assertHead(row, owner); return row
  }
  private async versionRecord(owner: string, id: string, records?: HistoryReadRecords): Promise<HistoryVersion | null> {
    if (!validId(owner) || !validId(id)) throw new Error('增量历史版本ID无效。')
    const row = await this.database.historyVersions.get([owner, id])
    if (!row) return null
    const checked = checkVersionRecord(row, owner)
    if (row.id !== id) throw new Error('增量历史版本主键不符。')
    if (records && !records.overflow) {
      if (records.characters + checked.json.length > READ_CHARACTER_LIMIT) {
        records.values = []; records.characters = 0; records.overflow = true
      } else { records.values.push(checked.json); records.characters += checked.json.length }
    }
    return row
  }
  private async version(owner: string, id: string, records?: HistoryReadRecords): Promise<HistoryVersion | null> {
    const row = await this.versionRecord(owner, id, records)
    if (row) assertCheckpoint(row, this.hashContent)
    return row
  }
  async readVersion(owner: string, id: string, session?: HistoryReadSession): Promise<{ version: HistoryVersion; project: ProjectData } | null> {
    const state = session && this.readState(session)
    if (state?.busy) { session!.close(); throw new Error('增量历史重建会话不能并发使用。') }
    if (state) state.busy = true
    try { return await this.readVersionChecked(owner, id, session) }
    catch (error) { session?.close(); throw error }
    finally { if (state) state.busy = false }
  }
  private async readVersionChecked(owner: string, id: string, session?: HistoryReadSession): Promise<{ version: HistoryVersion; project: ProjectData } | null> {
    const records: HistoryReadRecords | undefined = session ? { values: [], characters: 0, overflow: false } : undefined
    const leaf = await this.versionRecord(owner, id, records)
    if (!leaf) { if (session) this.readState(session).cached = null; return null }
    const chain: HistoryVersion[] = [], seen = new Set<string>()
    let cursor = leaf
    while (true) {
      if (seen.has(cursor.id) || chain.length >= INCREMENTAL_HISTORY_LIMITS.chainLength) throw new Error('增量历史差异链循环或超过检查点边界。')
      seen.add(cursor.id); chain.push(cursor)
      if (cursor.parentId !== null) {
        const parent = cursor.checkpoint === null ? await this.versionRecord(owner, cursor.parentId, records) : await this.version(owner, cursor.parentId, records)
        if (!parent || parent.contentHash !== cursor.parentHash || parent.revision >= cursor.revision) throw new Error('增量历史父版本缺失、hash或修订顺序损坏。')
        if (cursor.checkpoint === null) { cursor = parent; continue }
      }
      break
    }
    const steps = chain.reverse().slice(1)
    let depth = 0, chainBytes = 0
    for (const row of steps) {
      if (row.delta === null) throw new Error('增量历史重建缺少双向差异。')
      depth++; chainBytes += projectDeltaBytes(row.delta)
      if (row.depth !== depth || row.chainBytes !== chainBytes) throw new Error('增量历史链长或累计字节声明不符。')
    }
    const state = session && this.readState(session), cached = state?.cached
    // Every row, including the checkpoint's immediate parent, was freshly read
    // and strictly checked. Compare complete wire bodies, never declared hashes.
    const same = cached && records && !records.overflow && records.values.length === cached.records.length
      && records.values.every((json, index) => json === cached.records[index])
    const project = same ? cloneJson(cached.project) : this.reconstructVersion(cursor, steps)
    if (project.document.revision !== leaf.revision) throw new Error('增量历史重建修订不符。')
    // The repository may register this successful strict result only in its
    // current transaction's bounded exact-JSON metadata table.
    this.reconstructed?.(project, leaf.contentHash)
    if (state && !same) {
      state.cached = records && !records.overflow && JSON.stringify(project).length <= READ_CHARACTER_LIMIT
        ? { records: records.values, project: freezeJson(cloneJson(project)) } : null
    }
    return { version: leaf, project }
  }
  private reconstructVersion(cursor: HistoryVersion, steps: HistoryVersion[]): ProjectData {
    // Empty chains also strictly validate/hash their complete checkpoint.
    const rebuilt = applyProjectDeltaChain(cursor.checkpoint!, steps.map(row => row.delta!), cursor.contentHash)
    for (const [index, row] of steps.entries()) {
      const state = rebuilt.states[index]
      if (state.contentHash !== row.contentHash || state.revision !== row.revision) throw new Error('增量历史重建完整hash或修订不符。')
    }
    return rebuilt.project
  }
  async initialize(current: StoredProject, automatic: StoredAutomatic[], snapshots: StoredSnapshot[], imported: StoredSnapshot[], metadataVersion: number): Promise<void> {
    assertProject(current, this.hashContent)
    const owner = current.sceneId
    if (await this.head(owner) || await this.database.historyVersions.where('ownerSceneId').equals(owner).count()
      || await this.database.historyPins.where('ownerSceneId').equals(owner).count()) throw new Error('增量历史暂存身份已占用；不会覆盖。')
    if (automatic.length > 20 || snapshots.length > 64 || imported.length > 20) throw new Error('增量历史迁移来源超出旧合同保护值。')
    const roots = new Map<string, HistoryVersion>()
    const includeFixedMeanings = createFixedProjectFamilyCheck()
    const add = (project: ProjectData, contentHash: string, savedAt: string, isAutomatic: boolean) => {
      if (projectContentHash(project) !== contentHash || !validTime(savedAt)) throw new Error('增量历史迁移来源内容hash或时间损坏。')
      includeFixedMeanings(project)
      const existing = roots.get(contentHash)
      if (existing) {
        if (isAutomatic && !existing.automatic) roots.set(contentHash, seal({ ...existing, automatic: true }))
        return `root:${contentHash}`
      }
      const row: HistoryVersion = seal({ format: 'sceneweave-history-version' as const, version: 1 as const, ownerSceneId: owner,
        id: `root:${contentHash}`, revision: project.document.revision, savedAt, contentHash, parentId: null, parentHash: null,
        checkpoint: validateProjectData(project), delta: null, depth: 0, chainBytes: 0, automatic: isAutomatic })
      roots.set(contentHash, row); return row.id
    }
    const currentId = add(current.project, current.contentHash, current.savedAt, true)
    for (const row of automatic) {
      if (row.ownerSceneId !== owner || row.revision !== row.project.document.revision || row.project.document.sceneId !== owner) throw new Error('增量历史迁移自动历史归属损坏。')
      add(row.project, row.contentHash, row.savedAt, true)
    }
    const ids = new Set<string>()
    for (const [rows, isImported] of [[snapshots, false], [imported, true]] as const) for (const row of rows) {
      validateSnapshotSummary(summary(row))
      if (row.ownerSceneId !== owner || ids.has(row.id) || (row.kind === 'imported-auto') !== isImported
        || row.sourceRevision !== row.project.document.revision || row.lineageId !== row.project.historyIdentity.lineageId) throw new Error('增量历史迁移历史归属、类别或ID冲突。')
      ids.add(row.id)
      const versionId = add(row.project, row.contentHash, row.createdAt, false)
      await this.database.historyPins.add(seal({ ...summary(row), format: 'sceneweave-history-pin' as const, version: 1 as const, versionId }))
    }
    await this.database.historyVersions.bulkAdd([...roots.values()])
    await this.database.historyHeads.add(seal({ format: 'sceneweave-history-head' as const, version: 1 as const, ownerSceneId: owner, status: 'staged' as const,
      activeVersionId: currentId, savedRevision: current.revision, contentHash: current.contentHash,
      migration: { currentHash: current.contentHash, revision: current.revision, metadataVersion,
        sourceManifestHash: migrationManifest(current, automatic, snapshots, imported, metadataVersion) } }))
  }
  async activate(owner: string, currentHash: string, revision: number, metadataVersion: number): Promise<void> {
    const head = await this.head(owner)
    if (!head || head.status !== 'staged' || !head.migration || head.migration.currentHash !== currentHash || head.migration.revision !== revision
      || head.migration.metadataVersion !== metadataVersion || head.contentHash !== currentHash || head.savedRevision !== revision) throw new Error('增量历史迁移基线变化；暂存未发布。')
    const active = await this.readVersion(owner, head.activeVersionId)
    if (!active || active.version.contentHash !== currentHash) throw new Error('增量历史迁移当前版本冷读不符。')
    await this.database.historyHeads.put(seal({ ...head, status: 'ready' as const }))
  }
  async append(current: StoredProject, previous: StoredProject | null, versionId: string, parentId?: string): Promise<HistoryVersion> {
    assertProject(current, this.hashContent)
    if (!validId(versionId)) throw new Error('增量历史新版本ID无效。')
    const owner = current.sceneId, head = await this.head(owner)
    let row: HistoryVersion
    if (!previous) {
      if (head || parentId !== undefined || await this.database.historyVersions.where('ownerSceneId').equals(owner).count()
        || await this.database.historyPins.where('ownerSceneId').equals(owner).count()) throw new Error('增量历史新工程身份已占用。')
      row = seal({ format: 'sceneweave-history-version' as const, version: 1 as const, ownerSceneId: owner, id: versionId,
        revision: current.revision, savedAt: current.savedAt, contentHash: current.contentHash, parentId: null, parentHash: null,
        checkpoint: validateProjectData(current.project), delta: null, depth: 0, chainBytes: 0, automatic: true })
    } else {
      assertProject(previous, this.hashContent)
      if (!head || head.status !== 'ready' || previous.sceneId !== owner || head.savedRevision !== previous.revision || head.contentHash !== previous.contentHash
        || current.revision <= previous.revision) throw new Error('增量历史保存基线冲突；原分支保留。')
      const active = await this.version(owner, head.activeVersionId)
      if (!active || active.contentHash !== previous.contentHash || active.revision !== previous.revision) throw new Error('增量历史活动版本与当前保存不符。')
      assertFixedProjectCompatible(previous.project, current.project)
      if (hasAddedFixedProjectDefinitions(previous.project, current.project)) {
        const includeFixedMeanings = createFixedProjectFamilyCheck()
        includeFixedMeanings(current.project)
        const versions = await this.database.historyVersions.where('ownerSceneId').equals(owner).toArray()
        for (const version of versions) assertVersion(version, owner)
        const byId = new Map(versions.map(version => [version.id, version])), cache = new ReconstructionCache()
        try { for (const version of orderedVersions(versions)) includeFixedMeanings(rebuildFromMap(byId, version.id, cache)) }
        finally { cache.clear() }
      }
      const parent = parentId === undefined || parentId === head.activeVersionId
        ? { version: active, project: previous.project }
        : await this.readVersion(owner, parentId)
      if (!parent || parent.version.revision >= current.revision || !parent.version.automatic) throw new Error('增量历史分支父版本无效。')
      const depth = parent.version.depth + 1
      let delta: JsonDelta | null = null
      let checkpoint = depth >= INCREMENTAL_HISTORY_LIMITS.chainLength, chainBytes = 0
      if (!checkpoint) {
        try { delta = createProjectDelta(parent.project, current.project) }
        catch (error) { if (!(error instanceof DeltaSizeError)) throw error }
        checkpoint = delta === null
        if (delta !== null) {
          const deltaBytes = projectDeltaBytes(delta), fullBytes = encodeUtf8(canonicalJson(current.project)).length
          chainBytes = parent.version.chainBytes + deltaBytes
          checkpoint = deltaBytes >= fullBytes || chainBytes >= fullBytes
        }
      }
      row = seal({ format: 'sceneweave-history-version' as const, version: 1 as const, ownerSceneId: owner, id: versionId,
        revision: current.revision, savedAt: current.savedAt, contentHash: current.contentHash, parentId: parent.version.id, parentHash: parent.version.contentHash,
        checkpoint: checkpoint ? validateProjectData(current.project) : null, delta: checkpoint ? null : delta,
        depth: checkpoint ? 0 : depth, chainBytes: checkpoint ? 0 : chainBytes, automatic: true })
    }
    if (await this.database.historyVersions.where('ownerSceneId').equals(owner).count() >= INCREMENTAL_HISTORY_LIMITS.versions) throw new Error('增量历史版本数达到保护上限；未回收分支或保护数据。')
    await this.database.historyVersions.add(row)
    await this.database.historyHeads.put(seal({ format: 'sceneweave-history-head' as const, version: 1 as const, ownerSceneId: owner,
      status: 'ready' as const, activeVersionId: row.id, savedRevision: row.revision, contentHash: row.contentHash, migration: head?.migration ?? null }))
    return row
  }
  async versions(owner: string): Promise<HistoryVersionSummary[]> {
    const rows = await this.database.historyVersions.where('ownerSceneId').equals(owner).toArray()
    for (const row of rows) assertVersion(row, owner)
    return rows.map(versionSummary).sort((a, b) => b.revision - a.revision || a.id.localeCompare(b.id))
  }
  async pins(owner: string): Promise<HistoryPin[]> {
    const rows = await this.database.historyPins.where('ownerSceneId').equals(owner).toArray()
    const checked = new Map<string, HistoryVersion>()
    try {
      for (const row of rows) {
        assertPin(row, owner)
        let version = checked.get(row.versionId)
        if (!version) {
          version = await this.version(owner, row.versionId) ?? undefined
          if (version) checked.set(row.versionId, version)
        }
        if (!version || version.contentHash !== row.contentHash || version.revision !== row.sourceRevision) throw new Error('增量历史快照引用断链。')
      }
      return rows
    } finally { checked.clear() }
  }
  async pin(input: SnapshotSummary, savedProject?: ProjectData): Promise<void> {
    const value = validateSnapshotSummary(captureJson(input)), head = await this.head(value.ownerSceneId)
    if (!head || head.status !== 'ready' || head.contentHash !== value.contentHash || head.savedRevision !== value.sourceRevision) throw new Error('增量历史保护点须引用已成功保存的活动版本。')
    if (await this.database.historyPins.get([value.ownerSceneId, value.id])) throw new Error('增量历史快照ID已占用。')
    // Check and detach synchronously before the next database await.
    const saved = savedProject ? { contentHash: this.hashContent(savedProject), project: cloneJson(savedProject) } : undefined
    const active = saved
      ? { version: await this.version(value.ownerSceneId, head.activeVersionId), project: saved.project }
      : await this.readVersion(value.ownerSceneId, head.activeVersionId)
    if (!active || !active.version || active.version.contentHash !== value.contentHash || active.version.revision !== value.sourceRevision
      || active.project.document.revision !== value.sourceRevision || saved && saved.contentHash !== value.contentHash
      || active.project.historyIdentity.lineageId !== value.lineageId) throw new Error('增量历史快照lineage或已保存内容不符。')
    await this.database.historyPins.add(seal({ ...value, format: 'sceneweave-history-pin' as const, version: 1 as const, versionId: head.activeVersionId }))
  }
  async readPin(owner: string, id: string, current?: StoredProject, session?: HistoryReadSession): Promise<StoredSnapshot | null> {
    const pin = await this.database.historyPins.get([owner, id])
    if (!pin) return null
    assertPin(pin, owner)
    let version: { version: HistoryVersion; project: ProjectData } | null
    if (current && current.sceneId === owner && current.revision === pin.sourceRevision && current.contentHash === pin.contentHash) {
      assertProject(current, this.hashContent)
      const project = cloneJson(current.project)
      const head = await this.head(owner), active = await this.version(owner, pin.versionId)
      if (!head || head.status !== 'ready' || head.activeVersionId !== pin.versionId || head.contentHash !== current.contentHash
        || head.savedRevision !== current.revision || !active) throw new Error('增量历史保护引用与当前保存不符。')
      version = { version: active, project }
    } else version = await this.readVersion(owner, pin.versionId, session)
    if (!version || version.version.contentHash !== pin.contentHash || version.project.document.revision !== pin.sourceRevision
      || version.project.historyIdentity.lineageId !== pin.lineageId) throw new Error('增量历史快照重建hash或身份不符。')
    return { ...summary(pin), project: version.project }
  }
  async renamePin(owner: string, id: string, name: string): Promise<void> {
    const pin = await this.database.historyPins.get([owner, id])
    if (!pin) throw new Error('增量历史快照引用缺失。')
    assertPin(pin, owner)
    if (pin.kind !== 'named') throw new Error('只可重命名命名快照。')
    const renamed = { ...pin, name }; validateSnapshotSummary(summary(renamed))
    await this.database.historyPins.put(seal(renamed))
  }
  async deletePin(owner: string, id: string): Promise<void> {
    const pin = await this.database.historyPins.get([owner, id])
    if (!pin) throw new Error('增量历史快照引用缺失。')
    assertPin(pin, owner)
    await this.database.historyPins.delete([owner, id])
    // Versions and their resources remain reachable from retained branch heads.
    // Removing a bookmark never deletes ancestors or another branch's data.
  }
  async audit(owner: string): Promise<{ documentBytes: number }> {
    const head = await this.head(owner), rows = await this.database.historyVersions.where('ownerSceneId').equals(owner).toArray()
    const pins = await this.pins(owner)
    if (!head) {
      if (rows.length || pins.length) throw new Error('增量历史存在无活动根的孤立记录。')
      return { documentBytes: 0 }
    }
    if (!rows.length || rows.length > INCREMENTAL_HISTORY_LIMITS.versions) throw new Error('增量历史版本数或根损坏。')
    let documentBytes = historyHeadBytes(head)
    const includeFixedMeanings = createFixedProjectFamilyCheck()
    for (const row of rows) assertVersion(row, owner)
    const byId = new Map(rows.map(row => [row.id, row])), cache = new ReconstructionCache()
    try {
      for (const row of orderedVersions(rows)) {
        includeFixedMeanings(rebuildFromMap(byId, row.id, cache))
        documentBytes += historyVersionBytes(row)
      }
      for (const pin of pins) {
        const project = rebuildFromMap(byId, pin.versionId, cache)
        if (byId.get(pin.versionId)!.contentHash !== pin.contentHash || project.document.revision !== pin.sourceRevision
          || project.historyIdentity.lineageId !== pin.lineageId) throw new Error('增量历史快照在审计时内容或身份不符。')
        documentBytes += historyPinBytes(pin)
      }
      const active = byId.get(head.activeVersionId)
      if (!active || active.contentHash !== head.contentHash || active.revision !== head.savedRevision || !active.automatic) throw new Error('增量历史活动根与持久修订不符。')
      return { documentBytes }
    } finally { cache.clear() }
  }
}

/** Wire-only capture for the isolated one-time importer. It confers no project validity. */
export function captureHistoryVersionEnvelope(input: unknown, owner: string): HistoryVersion {
  const { row } = checkVersionRecord(input, owner)
  return { ...row, checkpoint: row.checkpoint === null ? null : cloneJson(row.checkpoint), delta: row.delta === null ? null : validateProjectDelta(row.delta) }
}
export function captureHistoryHeadEnvelope(input: unknown, owner: string): HistoryHead { assertHead(input, owner); return captureJson(input) }
export function captureHistoryPinEnvelope(input: unknown, owner: string): HistoryPin { assertPin(input, owner); return captureJson(input) }
export const sealHistoryRecord = seal
