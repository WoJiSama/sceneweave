import type { ProjectBundle, ProjectData } from '../../../shared/model/project.js'
import { getVerifiedProjectBundle } from '../../../shared/project/resources.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { encodeProjectContent, partitionEncodedProjectContent, prepareLocalProjectContent, type EncodedProjectContent, type ProjectContentPartition } from './content-blocks.js'

/** A private operation result. Encoding identity and actual IDB freshness are
 * deliberately separate: this handle never certifies a persisted row/block. */
export interface EncodedSnapshot {
  readonly project: ProjectData
  readonly encoded: EncodedProjectContent
}
const snapshots = new WeakSet<EncodedSnapshot>()
const partitions = new WeakMap<EncodedSnapshot, ProjectContentPartition>()
const ownedProjects = new WeakMap<ProjectData, EncodedSnapshot>()
const worldJson = new WeakMap<EncodedSnapshot, string>()
export function prepareEncodedSnapshot(bundle: ProjectBundle, localSource?: ProjectData, baseline?: EncodedSnapshot): EncodedSnapshot {
  const verified = getVerifiedProjectBundle(bundle)
  if (!verified) throw new Error('保存编码须来自本次不可变工程校验结果。')
  // Each operation owns an independent lease; one concurrent repository save
  // cannot release another save's prepared state for the same project object.
  const encoded = encodeProjectContent(verified.project)
  if (localSource) prepareLocalProjectContent(localSource, verified.project, encoded, baseline && snapshots.has(baseline) ? baseline.encoded : undefined)
  const snapshot = Object.freeze({ project: verified.project, encoded })
  partitions.set(snapshot, partitionEncodedProjectContent(encoded))
  snapshots.add(snapshot); ownedProjects.set(snapshot.project, snapshot); ownedProjects.set(encoded.stored, snapshot)
  return snapshot
}
/** Typed-array elements cannot be frozen. Never publish the private closure. */
export function snapshotContentPartition(snapshot: EncodedSnapshot): ProjectContentPartition {
  const partition = partitions.get(snapshot)
  if (!partition) throw new Error('编码快照的私有内容块已失效。')
  return { manifest: cloneJson(partition.manifest), blocks: partition.blocks.map(block => ({ sha256: block.sha256, bytes: block.bytes.slice() })) }
}
export function ownedEncodedSnapshot(project: ProjectData): EncodedSnapshot | undefined { return ownedProjects.get(project) }
/** Optional inter-save retention is bounded; required in-flight endpoints are
 * still owned by their operation even when this optional lease cannot fit. */
export function canRetainEncodedSnapshot(snapshot: EncodedSnapshot): boolean {
  const partition = partitions.get(snapshot)
  return !!partition && snapshot.encoded.canonical.length * 4
    + partition.blocks.reduce((sum, block) => sum + block.bytes.length, 0)
    + JSON.stringify(partition.manifest).length * 2 <= 64 * 1024 * 1024
}
export function releaseEncodedSnapshot(snapshot: EncodedSnapshot): void {
  if (ownedProjects.get(snapshot.project) === snapshot) ownedProjects.delete(snapshot.project)
  if (ownedProjects.get(snapshot.encoded.stored) === snapshot) ownedProjects.delete(snapshot.encoded.stored)
  worldJson.delete(snapshot)
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
/** Exact complete text equality, never a caller's ID/hash/frozen marker. Raw
 * middleware must still read and compare every referenced actual block. */
export function matchingEncodedSnapshot(transaction: IDBTransaction, project: ProjectData): EncodedSnapshot | undefined {
  const content = transactions.get(transaction)
  if (!content) return
  const own = exactEncodedSnapshot(transaction, project)
  if (own) return own
  const json = canonicalJson(project)
  for (const snapshot of content.slots.values()) {
    if (json === snapshot.encoded.canonical) return snapshot
    let world = worldJson.get(snapshot)
    if (world === undefined) { world = canonicalJson(snapshot.project); worldJson.set(snapshot, world) }
    if (json === world) return snapshot
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
