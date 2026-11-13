import type { ProjectBundle, ProjectData } from '../../../shared/model/project.js'
import { getVerifiedProjectBundle } from '../../../shared/project/resources.js'
import { DeltaSizeError, tryCreateVerifiedProjectDelta, type JsonDelta } from '../../../shared/project/delta.js'
import { captureJson, equalOwnedJson, freezeJson } from '../../../shared/validation/json.js'
import { encodeProjectContent, partitionEncodedProjectContent, prepareEncodedProjectContent, prepareLocalProjectContent, type EncodedProjectContent, type ProjectContentPartition } from './content-blocks.js'

/** A private operation result. Encoding identity and actual IDB freshness are
 * deliberately separate: this handle never certifies a persisted row/block. */
export interface EncodedSnapshot {
  readonly project: ProjectData
  readonly encoded: EncodedProjectContent
}
const snapshots = new WeakSet<EncodedSnapshot>()
const partitionSizes = new WeakMap<EncodedSnapshot, number>()
const ownedProjects = new WeakMap<ProjectData, EncodedSnapshot>()
export function prepareEncodedSnapshot(bundle: ProjectBundle, localInput?: ProjectBundle, baseline?: EncodedSnapshot): EncodedSnapshot {
  const verified = getVerifiedProjectBundle(bundle)
  if (!verified) throw new Error('保存编码须来自本次不可变工程校验结果。')
  const source = getVerifiedProjectBundle(localInput)?.project
  // Public save still fully validates a detached copy. Preserve the original
  // validator-owned immutable endpoint only after complete raw equality, before
  // coordinate conversion could normalize a different world representation.
  const encodingSource = source && equalOwnedJson(source, verified.project)
    ? source : verified.project
  // Each operation owns an independent lease; one concurrent repository save
  // cannot release another save's prepared state for the same project object.
  const encoded = encodeProjectContent(encodingSource)
  if (source) prepareLocalProjectContent(source, verified.project, encoded, baseline && snapshots.has(baseline) ? baseline.encoded : undefined)
  const snapshot = Object.freeze({ project: encodingSource, encoded })
  partitionSizes.set(snapshot, prepareEncodedProjectContent(encoded))
  snapshots.add(snapshot); ownedProjects.set(snapshot.project, snapshot); ownedProjects.set(encoded.stored, snapshot)
  return snapshot
}
/** Typed-array elements cannot be frozen. Never publish the private closure. */
export function snapshotContentPartition(snapshot: EncodedSnapshot): ProjectContentPartition {
  if (!snapshots.has(snapshot)) throw new Error('编码快照的私有内容块已失效。')
  return partitionEncodedProjectContent(snapshot.encoded)
}
export function ownedEncodedSnapshot(project: ProjectData): EncodedSnapshot | undefined { return ownedProjects.get(project) }
/** Optional inter-save retention is bounded; required in-flight endpoints are
 * still owned by their operation even when this optional lease cannot fit. */
export function canRetainEncodedSnapshot(snapshot: EncodedSnapshot): boolean {
  const size = partitionSizes.get(snapshot)
  return size !== undefined && size <= 64 * 1024 * 1024
}
export function releaseEncodedSnapshot(snapshot: EncodedSnapshot): void {
  if (ownedProjects.get(snapshot.project) === snapshot) ownedProjects.delete(snapshot.project)
  if (ownedProjects.get(snapshot.encoded.stored) === snapshot) ownedProjects.delete(snapshot.encoded.stored)
}

/** An operation-local speculative delta, never an assertion about DB state. */
export interface PreparedProjectDelta { readonly kind: 'prepared-project-delta' }
const preparedDeltas = new WeakMap<PreparedProjectDelta, { before: EncodedSnapshot; after: EncodedSnapshot; delta: JsonDelta | null }>()
export function prepareEncodedProjectDelta(before: EncodedSnapshot, after: EncodedSnapshot): PreparedProjectDelta | undefined {
  if (!snapshots.has(before) || !snapshots.has(after)) return
  let delta: JsonDelta | undefined | null
  try { delta = tryCreateVerifiedProjectDelta(before.project, after.project, { before: before.encoded, after: after.encoded }) }
  catch (error) { if (!(error instanceof DeltaSizeError)) throw error; delta = null }
  if (delta === undefined) return
  const handle = Object.freeze({ kind: 'prepared-project-delta' as const })
  preparedDeltas.set(handle, { before, after, delta: delta && freezeJson(delta) })
  return handle
}
/** Called only after fresh actual blocks and all parent/CAS checks. Complete
 * raw endpoint matching precedes any coordinate normalization. A stale plan
 * simply declines and the full generic implementation remains authoritative. */
export function consumeEncodedProjectDelta(transaction: IDBTransaction, handle: PreparedProjectDelta | undefined,
  before: ProjectData, after: ProjectData): { delta: JsonDelta | null } | undefined {
  const plan = handle && preparedDeltas.get(handle)
  if (!plan || matchingEncodedSnapshot(transaction, before) !== plan.before || matchingEncodedSnapshot(transaction, after) !== plan.after) return
  return { delta: plan.delta }
}

export type ContentSlot = 'result' | 'baseline' | 'branch'
interface TransactionContent {
  slots: Map<ContentSlot, EncodedSnapshot>
}
const transactions = new WeakMap<IDBTransaction, TransactionContent>()
export function pinEncodedSnapshot(transaction: IDBTransaction, slot: ContentSlot, snapshot: EncodedSnapshot): void {
  if (!snapshots.has(snapshot)) throw new Error('事务内容快照不是本仓库的私有编码结果。')
  let content = transactions.get(transaction)
  if (!content) {
    content = { slots: new Map() }; transactions.set(transaction, content)
    const release = () => transactions.delete(transaction)
    transaction.addEventListener('complete', release, { once: true }); transaction.addEventListener('abort', release, { once: true })
  }
  content.slots.set(slot, snapshot)
}
/** Exact complete owned JSON equality, never a caller's ID/hash/frozen marker. Raw
 * middleware must still read and compare every referenced actual block. */
export function matchingEncodedSnapshot(transaction: IDBTransaction, project: ProjectData): EncodedSnapshot | undefined {
  const content = transactions.get(transaction)
  if (!content) return
  const own = exactEncodedSnapshot(transaction, project)
  if (own) return own
  // Capture every descriptor once before comparison. Mutable caller objects,
  // including Proxies, cannot swap a checked value during serialization.
  const captured = captureJson(project)
  for (const snapshot of content.slots.values()) {
    if (equalOwnedJson(captured, snapshot.encoded.stored) || equalOwnedJson(captured, snapshot.project)) return snapshot
  }
}
/** Exact immutable references only. Middleware uses this after its complete
 * native byte comparison; mutable public read views never gain this identity. */
export function exactEncodedSnapshot(transaction: IDBTransaction, project: ProjectData): EncodedSnapshot | undefined {
  for (const snapshot of transactions.get(transaction)?.slots.values() ?? []) {
    if (project === snapshot.project || project === snapshot.encoded.stored) return snapshot
  }
}
export function transactionEncodedSnapshots(transaction: IDBTransaction): Iterable<EncodedSnapshot> {
  return transactions.get(transaction)?.slots.values() ?? []
}
