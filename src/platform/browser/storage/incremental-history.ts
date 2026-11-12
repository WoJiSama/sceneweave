import { READ_CHARACTER_LIMIT, ReconstructionCache, assertCheckpoint, assertHead, assertPin, assertProject, assertVersion, checkVersionRecord, checkedVersionJson, migrationManifest, orderedVersions, readCheckpoint, rebuildFromMap, seal, summary, validId, validTime, versionByteLength, versionSummary, INCREMENTAL_HISTORY_LIMITS, type HistoryHead, type HistoryPin, type HistoryReadRecords, type HistoryReadSession, type HistoryReadState, type HistoryVersion } from './history-records.js'
export { INCREMENTAL_HISTORY_LIMITS, historyVersionBytes, historyHeadBytes, historyPinBytes, historyVersionJson, historyGraphJson, historyGraphProjects, readHistoryGraphVersion, captureHistoryGraph, migrationManifest, type HistoryGraph, type HistoryHead, type HistoryMigration, type HistoryPin, type HistoryReadSession, type HistoryVersion } from './history-records.js'
import Dexie, { type Transaction } from 'dexie'
import type { HistoryVersionSummary } from '../../../application/ports/project-store.js'
export type { HistoryVersionSummary } from '../../../application/ports/project-store.js'
import type { ProjectData, SnapshotSummary } from '../../../shared/model/project.js'
import { createProjectDelta, tryCreateLocalProjectDelta, applyProjectDeltaChain, validateProjectDelta, projectDeltaBytes, DeltaSizeError, type JsonDelta } from '../../../shared/project/delta.js'
import { getProjectLocalTransaction, getProjectTransactionReceipt, projectContentHash, validateProjectData } from '../../../shared/project/validate.js'
import { canonicalProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { captureJson, cloneJson, encodeUtf8, freezeJson } from '../../../shared/validation/json.js'
import type { ProjectDatabase, StoredAutomatic, StoredProject, StoredSnapshot } from './database.js'
import { assertFixedProjectCompatible, createFixedProjectFamilyCheck, FixedProjectFamilyIndex, hasAddedFixedProjectDefinitions, validateSnapshotSummary } from '../../../shared/project/history.js'
import { matchingEncodedSnapshot } from './content-context.js'
import type { CancellationSignal } from '../../../shared/ports/resources.js'
import { auditHistoryInWorker } from './history-audit-client.js'
import { waitForStorageTransaction } from './transaction-lifetime.js'

export const FIXED_HISTORY_INDEX_LIMITS = Object.freeze({ owners: 4, retainedCharacters: 4 * 1024 * 1024 })
interface FixedHistoryIndex { meanings: FixedProjectFamilyIndex; versions: Map<string, string> }
interface FixedHistoryState { owners: Map<string, FixedHistoryIndex>; pending: WeakMap<Transaction, Map<string, FixedHistoryIndex | null>> }
const fixedHistoryStates = new WeakMap<ProjectDatabase, FixedHistoryState>()
const fixedIndexSize = (value: FixedHistoryIndex) => value.meanings.retainedCharacters
  + [...value.versions].reduce((sum, [id, hash]) => sum + id.length + hash.length + 64, 0)
function fixedHistoryState(database: ProjectDatabase): FixedHistoryState {
  let state = fixedHistoryStates.get(database)
  if (!state) {
    state = { owners: new Map(), pending: new WeakMap() }; fixedHistoryStates.set(database, state)
    database.on('close', () => fixedHistoryStates.delete(database))
  }
  return state
}
function knownFixedIndex(database: ProjectDatabase, owner: string): FixedHistoryIndex | undefined {
  const state = fixedHistoryState(database), transaction = Dexie.currentTransaction, pending = transaction && state.pending.get(transaction)
  return pending?.has(owner) ? pending.get(owner) ?? undefined : state.owners.get(owner)
}
function forkFixedIndex(value: FixedHistoryIndex): FixedHistoryIndex {
  return { meanings: value.meanings.fork(), versions: new Map(value.versions) }
}
/** A private acceleration index, never a persisted integrity claim. Only a
 * completed native transaction publishes a new version of this evidence. */
function stageFixedIndex(database: ProjectDatabase, owner: string, value: FixedHistoryIndex | null): void {
  const transaction = Dexie.currentTransaction
  if (!transaction) throw new Error('固定历史身份索引须绑定当前事务。')
  const state = fixedHistoryState(database)
  let pending = state.pending.get(transaction)
  if (!pending) {
    pending = new Map(); state.pending.set(transaction, pending)
    const changes = pending
    transaction.on('complete', () => {
      for (const [key, next] of changes) {
        state.owners.delete(key)
        if (!next) continue
        const size = fixedIndexSize(next)
        if (size > FIXED_HISTORY_INDEX_LIMITS.retainedCharacters) continue
        while (state.owners.size >= FIXED_HISTORY_INDEX_LIMITS.owners
          || [...state.owners.values()].reduce((sum, entry) => sum + fixedIndexSize(entry), size) > FIXED_HISTORY_INDEX_LIMITS.retainedCharacters) state.owners.delete(state.owners.keys().next().value!)
        state.owners.set(key, next)
      }
      state.pending.delete(transaction)
    })
    transaction.on('abort', () => { state.pending.delete(transaction) })
  }
  pending.set(owner, value && fixedIndexSize(value) <= FIXED_HISTORY_INDEX_LIMITS.retainedCharacters ? value : null)
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
  versionBytes(input: unknown): number { const json = checkedVersionJson(input, this.hashContent); return versionByteLength(input as HistoryVersion, json) }
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
    const rebuilt = applyProjectDeltaChain(readCheckpoint(cursor.checkpoint), steps.map(row => row.delta!), cursor.contentHash)
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
  async append(current: StoredProject, previous: StoredProject | null, versionId: string, parentId?: string, localSource?: ProjectData): Promise<HistoryVersion> {
    assertProject(current, this.hashContent)
    const snapshot = Dexie.currentTransaction && matchingEncodedSnapshot(Dexie.currentTransaction.idbtrans, current.project)
    const checkpointProject = () => snapshot?.project ?? validateProjectData(current.project)
    if (!validId(versionId)) throw new Error('增量历史新版本ID无效。')
    const owner = current.sceneId, head = await this.head(owner)
    let row: HistoryVersion
    let fixedIndex: FixedHistoryIndex | undefined
    if (!previous) {
      if (head || parentId !== undefined || await this.database.historyVersions.where('ownerSceneId').equals(owner).count()
        || await this.database.historyPins.where('ownerSceneId').equals(owner).count()) throw new Error('增量历史新工程身份已占用。')
      row = seal({ format: 'sceneweave-history-version' as const, version: 1 as const, ownerSceneId: owner, id: versionId,
        revision: current.revision, savedAt: current.savedAt, contentHash: current.contentHash, parentId: null, parentHash: null,
        checkpoint: checkpointProject(), delta: null, depth: 0, chainBytes: 0, automatic: true })
      fixedIndex = { meanings: new FixedProjectFamilyIndex(), versions: new Map() }
      fixedIndex.meanings.include(current.project)
    } else {
      assertProject(previous, this.hashContent)
      if (!head || head.status !== 'ready' || previous.sceneId !== owner || head.savedRevision !== previous.revision || head.contentHash !== previous.contentHash
        || current.revision <= previous.revision) throw new Error('增量历史保存基线冲突；原分支保留。')
      const active = await this.version(owner, head.activeVersionId)
      if (!active || active.contentHash !== previous.contentHash || active.revision !== previous.revision) throw new Error('增量历史活动版本与当前保存不符。')
      assertFixedProjectCompatible(previous.project, current.project)
      if (hasAddedFixedProjectDefinitions(previous.project, current.project)) {
        const versions = await this.database.historyVersions.where('ownerSceneId').equals(owner).toArray()
        // Fresh table reads hydrate and hash-check actual referenced blocks.
        // Recompute every record body, including inline checkpoints and deltas;
        // a stored recordHash or storage epoch alone never authorizes reuse.
        for (const version of versions) assertVersion(version, owner)
        const known = knownFixedIndex(this.database, owner)
        if (known && known.versions.size === versions.length && versions.every(version => known.versions.get(version.id) === version.recordHash)) fixedIndex = forkFixedIndex(known)
        else {
          fixedIndex = { meanings: new FixedProjectFamilyIndex(), versions: new Map(versions.map(version => [version.id, version.recordHash])) }
          const byId = new Map(versions.map(version => [version.id, version])), cache = new ReconstructionCache()
          try { for (const version of orderedVersions(versions)) fixedIndex.meanings.include(rebuildFromMap(byId, version.id, cache)) }
          finally { cache.clear() }
        }
        fixedIndex.meanings.include(current.project)
      } else {
        // Ordinary saves retain the adjacent path and do not scan old branches.
        // Before any later index lookup, the entire actual record set is checked
        // again, so an external write cannot inherit this speculative extension.
        const known = knownFixedIndex(this.database, owner)
        if (known) fixedIndex = { meanings: known.meanings, versions: new Map(known.versions) }
      }
      const parent = parentId === undefined || parentId === head.activeVersionId
        ? { version: active, project: previous.project }
        : await this.readVersion(owner, parentId)
      if (!parent || parent.version.revision >= current.revision || !parent.version.automatic) throw new Error('增量历史分支父版本无效。')
      const depth = parent.version.depth + 1
      let delta: JsonDelta | null = null
      let checkpoint = depth >= INCREMENTAL_HISTORY_LIMITS.chainLength, chainBytes = 0
      if (!checkpoint) {
        const hasLocalEvidence = localSource && (getProjectLocalTransaction(localSource) || getProjectTransactionReceipt(localSource))
        const baselineSnapshot = hasLocalEvidence && Dexie.currentTransaction && matchingEncodedSnapshot(Dexie.currentTransaction.idbtrans, parent.project)
        const encodings = baselineSnapshot && snapshot ? { before: baselineSnapshot.encoded, after: snapshot.encoded } : undefined
        try { delta = (localSource ? tryCreateLocalProjectDelta(parent.project, current.project, localSource, encodings) : undefined)
          ?? createProjectDelta(parent.project, current.project) }
        catch (error) { if (!(error instanceof DeltaSizeError)) throw error }
        checkpoint = delta === null
        if (delta !== null) {
          const deltaBytes = projectDeltaBytes(delta), fullBytes = snapshot?.encoded.byteLength ?? encodeUtf8(canonicalProjectCoordinates(current.project)).length
          chainBytes = parent.version.chainBytes + deltaBytes
          checkpoint = deltaBytes >= fullBytes || chainBytes >= fullBytes
        }
      }
      row = seal({ format: 'sceneweave-history-version' as const, version: 1 as const, ownerSceneId: owner, id: versionId,
        revision: current.revision, savedAt: current.savedAt, contentHash: current.contentHash, parentId: parent.version.id, parentHash: parent.version.contentHash,
        checkpoint: checkpoint ? checkpointProject() : null, delta: checkpoint ? null : delta,
        depth: checkpoint ? 0 : depth, chainBytes: checkpoint ? 0 : chainBytes, automatic: true })
    }
    if (await this.database.historyVersions.where('ownerSceneId').equals(owner).count() >= INCREMENTAL_HISTORY_LIMITS.versions) throw new Error('增量历史版本数达到保护上限；未回收分支或保护数据。')
    await this.database.historyVersions.add(row)
    await this.database.historyHeads.put(seal({ format: 'sceneweave-history-head' as const, version: 1 as const, ownerSceneId: owner,
      status: 'ready' as const, activeVersionId: row.id, savedRevision: row.revision, contentHash: row.contentHash, migration: head?.migration ?? null }))
    if (fixedIndex) {
      fixedIndex.versions.set(row.id, row.recordHash)
      stageFixedIndex(this.database, owner, fixedIndex)
    }
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
  async audit(owner: string, signal?: CancellationSignal, keepAlive = true): Promise<{ documentBytes: number }> {
    const head = await this.head(owner), rows = await this.database.historyVersions.where('ownerSceneId').equals(owner).toArray()
    const pins = await this.pins(owner)
    const transaction = Dexie.currentTransaction?.idbtrans, controller = new AbortController()
    const aborted = () => controller.abort()
    transaction?.addEventListener('abort', aborted, { once: true })
    const cancellation: CancellationSignal = { get aborted() { return controller.signal.aborted || signal?.aborted === true } }
    try {
      // Keep the exact native transaction alive while its captured graph is
      // checked. No lock is released and no result is reused by another tx.
      const compute = () => auditHistoryInWorker(owner, head, rows, pins, cancellation)
      if (typeof Worker === 'undefined') return await compute()
      // Queue promises and worker events must be created outside Dexie's PSD;
      // only waitFor's continuation belongs to the original transaction.
      const pending = Dexie.ignoreTransaction(compute)
      return await (keepAlive ? waitForStorageTransaction(pending, 125_000) : pending)
    } finally { transaction?.removeEventListener('abort', aborted) }
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
