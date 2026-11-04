import Dexie, { type Table } from 'dexie'
import type { LicenseTextRecord, ProjectData } from '../../../shared/model/project.js'
import { checkCancelled, type ResourceOptions } from '../../../shared/ports/resources.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { projectResourceRecords } from '../../../shared/project/source-resources.js'
import { projectContentHash, validateProjectData } from '../../../shared/project/validate.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { PROJECT_TABLES, type ProjectDatabase, type StoredBytes } from './database.js'
import { captureHistoryGraph, historyGraphProjects } from './incremental-history.js'
import type { NativeUpgradeContext, StoredNativeUpgradeCapsule } from './native-upgrade.js'

export type HistoryMaintenanceChecks = Pick<NativeUpgradeContext, 'assertCurrent' | 'assertAutomatic' | 'assertSnapshot'> & {
  /** Full capsule capture/hash/graph/reference validation, without native image decoding. */
  assertCapsule(row: StoredNativeUpgradeCapsule): void
}
export interface UnusedResourceCollection {
  resourceCount: number
  resourceBytes: number
  licenseCount: number
  licenseBytes: number
}

function exact(input: unknown, fields: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('历史维护记录须为普通数据对象。')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== fields.length || !fields.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('历史维护记录含未知、缺失或非数据字段。')
}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function resourceBytes(input: StoredBytes): Uint8Array {
  exact(input, ['sha256', 'bytes'])
  if (!hash(input.sha256)) throw new Error('历史维护资源hash无效。')
  const bytes = captureBytes(input.bytes, PACKAGE_LIMITS.imageBytes)
  if (!bytes.length || sha256Bytes(bytes) !== input.sha256) throw new Error('历史维护实际资源字节hash损坏。')
  return bytes
}
function licenseBytes(input: LicenseTextRecord): number {
  exact(input, ['sha256', 'text'])
  if (!hash(input.sha256) || typeof input.text !== 'string') throw new Error('历史维护许可正文格式无效。')
  const bytes = encodeUtf8(input.text)
  if (!bytes.length || bytes.length > PACKAGE_LIMITS.licenseBytes || sha256Bytes(bytes) !== input.sha256) throw new Error('历史维护许可正文hash或预算损坏。')
  return bytes.length
}
function scanRows<T>(table: Pick<Table<T>, 'each'>, inspect: (row: T) => void): Promise<void> {
  let failed = false, failure: unknown
  return table.each(row => {
    if (failed) return
    try { inspect(row) } catch (error) { failed = true; failure = error }
  }).then(() => { if (failed) throw failure })
}
function assertCapsuleAncestors(rows: StoredNativeUpgradeCapsule[]): void {
  const byId = new Map(rows.map(row => [row.capsuleId, row]))
  for (const root of rows) {
    const path = new Set<string>(), ancestors = new Set<string>(), visitedDepth = new Map<string, number>()
    const visit = (row: StoredNativeUpgradeCapsule, depth: number) => {
      if (depth > 16 || path.has(row.capsuleId)) throw new Error('历史维护原件保全来源链循环或超限。')
      if ((visitedDepth.get(row.capsuleId) ?? 0) >= depth) return
      visitedDepth.set(row.capsuleId, depth)
      path.add(row.capsuleId)
      for (const id of row.parentCapsuleIds) {
        const parent = byId.get(id)
        if (!parent || parent.targetSceneId !== row.sourceSceneId || parent.sourceSceneId === row.targetSceneId
          || parent.targetInitialProject.historyIdentity.lineageId !== row.family.current.project.historyIdentity.lineageId) throw new Error('历史维护原件保全祖先缺失或归属损坏。')
        ancestors.add(id)
        if (ancestors.size > 64) throw new Error('历史维护原件保全祖先数量超限。')
        visit(parent, depth + 1)
      }
      path.delete(row.capsuleId)
    }
    visit(root, 1)
  }
}

/**
 * The caller owns the full-library audit, accounting receipt and epoch CAS in
 * the same transaction. This routine never prunes versions, pins or originals.
 * Every retained document and every candidate byte row is checked before the
 * first deletion; image decoding deliberately stays outside IDB transactions.
 */
export async function collectUnusedResources(database: ProjectDatabase, checks: HistoryMaintenanceChecks, options: ResourceOptions = {}): Promise<UnusedResourceCollection> {
  const transaction = Dexie.currentTransaction
  if (!transaction?.active || transaction.db !== database || transaction.mode !== 'readwrite'
    || PROJECT_TABLES.some(table => !transaction.storeNames.includes(table))) throw new Error('历史维护须在完整工程库读写事务中执行。')
  checkCancelled(options.signal)
  const resources = new Map<string, number>(), licenses = new Map<string, string>()
  const addProject = (input: ProjectData, expectedHash?: string) => {
    checkCancelled(options.signal)
    const project = validateProjectData(input)
    if (expectedHash !== undefined && projectContentHash(project) !== expectedHash) throw new Error('历史维护完整工程内容hash损坏。')
    for (const [id, size] of projectResourceRecords(project)) {
      if (resources.has(id) && resources.get(id) !== size) throw new Error('历史维护同hash资源长度冲突。')
      resources.set(id, size)
    }
    for (const [id, row] of Object.entries(project.licenses)) {
      if (licenses.has(id) && licenses.get(id) !== row.text) throw new Error('历史维护同hash许可正文冲突。')
      licenses.set(id, row.text)
    }
  }
  const current = new Map<string, { revision: number; contentHash: string }>()
  await scanRows(database.projects, row => {
    checks.assertCurrent(row); addProject(row.project, row.contentHash)
    current.set(row.sceneId, { revision: row.revision, contentHash: row.contentHash })
  })
  await scanRows(database.automaticSnapshots, row => { checks.assertAutomatic(row); addProject(row.project, row.contentHash) })
  await scanRows(database.snapshots, row => { checks.assertSnapshot(row, false); addProject(row.project, row.contentHash) })
  await scanRows(database.importedSnapshots, row => { checks.assertSnapshot(row, true); addProject(row.project, row.contentHash) })

  const heads = await database.historyHeads.toArray(), owners = new Set(heads.map(row => row.ownerSceneId))
  for (const head of heads) {
    checkCancelled(options.signal)
    const graph = captureHistoryGraph({ head,
      versions: await database.historyVersions.where('ownerSceneId').equals(head.ownerSceneId).toArray(),
      pins: await database.historyPins.where('ownerSceneId').equals(head.ownerSceneId).toArray() })
    const saved = current.get(head.ownerSceneId)
    if (!saved || saved.revision !== head.savedRevision || saved.contentHash !== head.contentHash) throw new Error('历史维护活动版本与当前完整工程不符。')
    // The detached graph is read once. Its iterator shares a bounded,
    // operation-local reconstruction cache across every retained branch.
    for (const project of historyGraphProjects(graph)) addProject(project)
  }
  // An orphaned row is corruption, not permission to reclaim its resources.
  await scanRows(database.historyVersions, row => { if (!owners.has(row.ownerSceneId)) throw new Error('历史维护增量历史缺少活动分支。') })
  await scanRows(database.historyPins, row => { if (!owners.has(row.ownerSceneId)) throw new Error('历史维护增量快照缺少活动分支。') })

  const capsules = await database.nativeUpgradeCapsules.toArray()
  for (const capsule of capsules) {
    checkCancelled(options.signal); checks.assertCapsule(capsule)
    addProject(capsule.family.current.project, capsule.family.current.contentHash)
    for (const row of [...capsule.family.automatic, ...capsule.family.snapshots, ...capsule.family.importedSnapshots]) addProject(row.project, row.contentHash)
    if (capsule.version === 2) for (const project of historyGraphProjects(capsule.historyGraph)) addProject(project)
    addProject(capsule.targetInitialProject, capsule.targetInitialContentHash)
  }
  assertCapsuleAncestors(capsules)

  const unusedResources: string[] = [], unusedLicenses: string[] = []
  const result: UnusedResourceCollection = { resourceCount: 0, resourceBytes: 0, licenseCount: 0, licenseBytes: 0 }
  await scanRows(database.resources, row => {
    checkCancelled(options.signal)
    const bytes = resourceBytes(row), expected = resources.get(row.sha256)
    if (expected !== undefined) {
      if (expected !== bytes.length) throw new Error('历史维护引用资源实际长度不符。')
      resources.delete(row.sha256)
    } else { unusedResources.push(row.sha256); result.resourceCount++; result.resourceBytes += bytes.length }
  })
  await scanRows(database.licenseTexts, row => {
    checkCancelled(options.signal)
    const size = licenseBytes(row), expected = licenses.get(row.sha256)
    if (expected !== undefined) {
      if (expected !== row.text) throw new Error('历史维护引用许可实际正文不符。')
      licenses.delete(row.sha256)
    } else { unusedLicenses.push(row.sha256); result.licenseCount++; result.licenseBytes += size }
  })
  if (resources.size || licenses.size) throw new Error('历史维护引用的实际资源字节或许可正文缺失；没有清理。')
  checkCancelled(options.signal)
  if (unusedResources.length) await database.resources.bulkDelete(unusedResources)
  checkCancelled(options.signal)
  if (unusedLicenses.length) await database.licenseTexts.bulkDelete(unusedLicenses)
  checkCancelled(options.signal)
  return result
}
