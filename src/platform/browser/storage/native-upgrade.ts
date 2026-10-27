import type { LicenseTextRecord, ProjectBundle, ProjectData } from '../../../shared/model/project.js'
import type { CompleteValidationOptions, ResourceOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import type { ConversionJob, LegacySource } from '../../../shared/migration/types.js'
import { assertFixedProjectCompatible } from '../../../shared/project/history.js'
import { captureProjectBundleInput, createMemoryResources, validateProjectBundle } from '../../../shared/project/resources.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { projectResourceRecords } from '../../../shared/project/source-resources.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { PROJECT_TABLES, type ProjectDatabase, type StoredAutomatic, type StoredBinding, type StoredBytes,
  type StoredHistoryMetadata, type StoredProject, type StoredSnapshot } from './database.js'

/** Source records stay in their original format and retain every native history scope. */
export interface NativeUpgradeFamily {
  current: StoredProject
  automatic: StoredAutomatic[]
  snapshots: StoredSnapshot[]
  importedSnapshots: StoredSnapshot[]
  bindings: StoredBinding[]
  metadata: StoredHistoryMetadata
  legacySources: LegacySource[]
  conversionJobs: ConversionJob[]
}
export interface StoredNativeUpgradeCapsule {
  format: 'sceneweave-native-upgrade-capsule'
  version: 1
  capsuleId: string
  sourceSceneId: string
  sourceContentHash: string
  targetSceneId: string
  targetInitialContentHash: string
  /** Exact initial target metadata makes the target binding verifiable after independent edits. */
  targetInitialProject: ProjectData
  createdAt: string
  family: NativeUpgradeFamily
  resourceHashes: string[]
  licenseHashes: string[]
  legacyHashes: string[]
  parentCapsuleIds: string[]
  contentHash: string
}
/** Portable original-family backup, independent of the selective history archive. */
export interface NativeUpgradeTransfer {
  format: 'sceneweave-native-upgrade-transfer'
  version: 1
  capsule: StoredNativeUpgradeCapsule
  ancestors: StoredNativeUpgradeCapsule[]
  resources: StoredBytes[]
  legacyBlobs: StoredBytes[]
  licenses: LicenseTextRecord[]
}
/** Discovery metadata only. Export still independently verifies every original and actual resource. */
export interface NativeUpgradeSummary {
  capsuleId: string
  sourceSceneId: string
  sourceTitle: string
  sourceSchemaVersion: 1 | 2
  sourceRevision: number
  sourceContentHash: string
  targetSceneId: string
  createdAt: string
  automaticCount: number
  namedCount: number
  protectionCount: number
  importedCount: number
  legacyOriginalCount: number
  parentCapsuleCount: number
}
export interface NativeUpgradeContext {
  database: ProjectDatabase
  open(): Promise<void>
  validation: CompleteValidationOptions
  now(): string
  assertCurrent(record: StoredProject): void
  assertAutomatic(record: StoredAutomatic): void
  assertSnapshot(record: StoredSnapshot, imported: boolean): void
  assertMetadata(record: StoredHistoryMetadata | undefined, owner: string): void
  assertBinding(record: StoredBinding | undefined, project: ProjectData, owner: string, kind: StoredBinding['kind'], recordId: string): void
  assertJob(record: ConversionJob): void
  assertLegacyNodes(nodes: LegacySource[], blobs: StoredBytes[], owner: string): void
  assertBudgets(owner: string): Promise<void>
}
const CAPSULE_FIELDS = ['format', 'version', 'capsuleId', 'sourceSceneId', 'sourceContentHash', 'targetSceneId', 'targetInitialContentHash', 'targetInitialProject',
  'createdAt', 'family', 'resourceHashes', 'licenseHashes', 'legacyHashes', 'parentCapsuleIds', 'contentHash'] as const
const FAMILY_FIELDS = ['current', 'automatic', 'snapshots', 'importedSnapshots', 'bindings', 'metadata', 'legacySources', 'conversionJobs'] as const
const MAX_DOCUMENT_BYTES = 128 * 1024 * 1024, MAX_RESOURCE_BYTES = 256 * 1024 * 1024, MAX_LEGACY_BYTES = 128 * 1024 * 1024
const MAX_ANCESTORS = 64, MAX_DEPTH = 16
function exact(input: unknown, fields: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('原件保全须为普通数据记录。')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== fields.length || !fields.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('原件保全含未知、缺失、访问器、隐藏或Symbol字段。')
}
function array<T>(input: unknown, maximum: number, capture: (value: unknown) => T): T[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum
    || Reflect.ownKeys(input).length !== input.length + 1) throw new Error('原件保全数组超过范围或含额外字段。')
  return Array.from({ length: input.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i))
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('原件保全数组含空洞或访问器。')
    return capture(descriptor.value)
  })
}
function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '__proto__' }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }
function validTime(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) }
const digest = (json: string) => sha256Bytes(encodeUtf8(json))
const jsonRecord = (entries: [string, string][]) => `{${entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}}`
const jsonArray = (entries: string[]) => `[${entries.join(',')}]`
/** Each document has its own JSON input budget; a complete family can exceed 600000 aggregate values. */
function projectRowJson(row: { project: ProjectData }): string {
  return jsonRecord(Object.entries(row).map(([key, value]) => [key, canonicalJson(value)]))
}
function familyJson(family: NativeUpgradeFamily): string {
  return jsonRecord(FAMILY_FIELDS.map(key => [key, key === 'current' ? projectRowJson(family.current)
    : key === 'automatic' || key === 'snapshots' || key === 'importedSnapshots' ? jsonArray(family[key].map(projectRowJson))
      : key === 'metadata' ? canonicalJson(family.metadata) : jsonArray(family[key].map(value => canonicalJson(value)))]))
}
function capsuleJson(capsule: StoredNativeUpgradeCapsule, includeHash: boolean): string {
  return jsonRecord(CAPSULE_FIELDS.filter(key => includeHash || key !== 'contentHash').map(key =>
    [key, key === 'family' ? familyJson(capsule.family) : canonicalJson(capsule[key])]))
}
function strings(input: unknown, maximum: number, predicate: (value: unknown) => value is string): string[] {
  const rows = array(input, maximum, value => { if (!predicate(value)) throw new Error('原件保全ID或hash无效。'); return value })
  if (new Set(rows).size !== rows.length || rows.some((value, i) => i > 0 && rows[i - 1] >= value)) throw new Error('原件保全引用须唯一且按序保存。')
  return rows
}
function projectRow<T extends { project: ProjectData }>(input: unknown, fields: readonly string[]): T {
  exact(input, fields)
  return Object.fromEntries(fields.map(key => [key, captureJson(input[key])])) as T
}
function captureFamily(input: unknown): NativeUpgradeFamily {
  exact(input, FAMILY_FIELDS)
  let bytes = 0
  const row = <T extends { project: ProjectData }>(value: unknown, fields: readonly string[]): T => {
    const owned = projectRow<T>(value, fields)
    if ((bytes += encodeUtf8(projectRowJson(owned)).length) > MAX_DOCUMENT_BYTES) throw new Error('源家族完整文档超过128MiB保全预算。')
    return owned
  }
  return {
    current: row<StoredProject>(input.current, ['sceneId', 'revision', 'savedAt', 'contentHash', 'status', 'conversionJobId', 'project']),
    automatic: array(input.automatic, 20, value => row<StoredAutomatic>(value, ['ownerSceneId', 'revision', 'savedAt', 'contentHash', 'project'])),
    snapshots: array(input.snapshots, 64, value => row<StoredSnapshot>(value, ['id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'project'])),
    importedSnapshots: array(input.importedSnapshots, 20, value => row<StoredSnapshot>(value, ['id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'project'])),
    bindings: array(input.bindings, 105, value => captureJson(value) as StoredBinding),
    metadata: captureJson(input.metadata) as StoredHistoryMetadata,
    legacySources: array(input.legacySources, 64, value => captureJson(value) as LegacySource),
    conversionJobs: array(input.conversionJobs, 64, value => captureJson(value) as ConversionJob),
  }
}
function familyProjects(family: NativeUpgradeFamily): ProjectData[] {
  return [family.current.project, ...family.automatic.map(row => row.project), ...family.snapshots.map(row => row.project), ...family.importedSnapshots.map(row => row.project)]
}
function familyReferences(family: NativeUpgradeFamily) {
  const resources = new Map<string, number>(), licenses = new Map<string, LicenseTextRecord>()
  for (const project of familyProjects(family)) {
    for (const [sha256, size] of projectResourceRecords(project)) {
      if (resources.has(sha256) && resources.get(sha256) !== size) throw new Error('保全历史的相同hash资源长度冲突。')
      resources.set(sha256, size)
    }
    for (const [sha256, license] of Object.entries(project.licenses)) {
      if (licenses.has(sha256) && licenses.get(sha256)!.text !== license.text) throw new Error('保全历史的相同hash许可冲突。')
      licenses.set(sha256, license)
    }
  }
  return { resources, licenses, legacy: [...new Set(family.legacySources.map(row => row.sourceHash))].sort() }
}
function assertFamily(family: NativeUpgradeFamily, context: NativeUpgradeContext): void {
  const { current } = family, owner = current.sceneId
  context.assertCurrent(current)
  if (current.status !== 'ready') throw new Error('只可保全已完整发布到本机的当前工程。')
  context.assertMetadata(family.metadata, owner)
  const keys = new Map<string, { project: ProjectData; kind: StoredBinding['kind']; id: string }>()
  const addBinding = (project: ProjectData, kind: StoredBinding['kind'], id: string) => {
    const key = canonicalJson([owner, kind, id])
    if (keys.has(key)) throw new Error('保全历史记录ID重复。')
    keys.set(key, { project, kind, id })
  }
  addBinding(current.project, 'current', 'current')
  let hasCurrentAutomatic = false
  for (const row of family.automatic) {
    context.assertAutomatic(row)
    if (row.ownerSceneId !== owner || row.revision > current.revision) throw new Error('自动历史归属或版本超出当前工程。')
    if (row.revision === current.revision && row.contentHash === current.contentHash) hasCurrentAutomatic = true
    addBinding(row.project, 'automatic', String(row.revision))
  }
  if (!hasCurrentAutomatic) throw new Error('保全源缺少当前修订的真实自动历史。')
  const snapshotIds = new Set<string>()
  for (const [rows, imported] of [[family.snapshots, false], [family.importedSnapshots, true]] as const) for (const row of rows) {
    context.assertSnapshot(row, imported)
    if (row.ownerSceneId !== owner || snapshotIds.has(row.id)) throw new Error('保全快照归属或跨类别ID冲突。')
    snapshotIds.add(row.id); addBinding(row.project, row.kind, row.id)
  }
  if (family.snapshots.filter(row => row.kind === 'named').length > 32 || family.snapshots.filter(row => row.kind === 'protection').length > 32) throw new Error('保全历史类别数量超过保护值。')
  for (const row of family.bindings) {
    const key = canonicalJson([row.ownerSceneId, row.kind, row.recordId]), expected = keys.get(key)
    if (!expected) throw new Error('保全源有多余、重复或不属于家族的资源绑定。')
    context.assertBinding(row, expected.project, owner, expected.kind, expected.id); keys.delete(key)
  }
  if (keys.size) throw new Error('保全源缺少完整历史资源绑定。')
  const jobs = new Set<string>()
  for (const job of family.conversionJobs) {
    context.assertJob(job)
    if (job.targetSceneId !== owner || jobs.has(job.jobId)) throw new Error('保全转换来源journal归属或ID冲突。')
    jobs.add(job.jobId)
  }
  if (current.conversionJobId !== null && !jobs.has(current.conversionJobId)) throw new Error('保全源缺少当前转换journal。')
  const projects = familyProjects(family)
  for (let i = 1; i < projects.length; i++) for (let j = 0; j < i; j++) assertFixedProjectCompatible(projects[j], projects[i])
  if (encodeUtf8(familyJson(family)).length > MAX_DOCUMENT_BYTES) throw new Error('源家族完整文档超过128MiB保全预算。')
}
function captureCapsule(input: unknown, context: NativeUpgradeContext): StoredNativeUpgradeCapsule {
  exact(input, CAPSULE_FIELDS)
  const result = { ...Object.fromEntries(CAPSULE_FIELDS.filter(key => key !== 'family').map(key => [key, captureJson(input[key])])),
    family: captureFamily(input.family) } as unknown as StoredNativeUpgradeCapsule
  if (result.format !== 'sceneweave-native-upgrade-capsule' || result.version !== 1 || !validId(result.capsuleId)
    || !validId(result.sourceSceneId) || !validId(result.targetSceneId) || result.sourceSceneId === result.targetSceneId
    || !hash(result.sourceContentHash) || !hash(result.targetInitialContentHash) || !hash(result.contentHash) || !validTime(result.createdAt)) throw new Error('原件保全格式、来源或目标身份损坏。')
  result.resourceHashes = strings(result.resourceHashes, 65_536, hash)
  result.licenseHashes = strings(result.licenseHashes, 65_536, hash)
  result.legacyHashes = strings(result.legacyHashes, 64, hash)
  result.parentCapsuleIds = strings(result.parentCapsuleIds, MAX_ANCESTORS, validId)
  assertFamily(result.family, context)
  if (result.family.current.sceneId !== result.sourceSceneId || result.family.current.contentHash !== result.sourceContentHash) throw new Error('原件保全来源与完整家族不一致。')
  const sourceVersion = result.family.current.project.schemaVersion, targetVersion = result.targetInitialProject.schemaVersion
  if (!(sourceVersion === 1 && targetVersion === 2 || sourceVersion === 2 && targetVersion === 3)
    || result.targetInitialProject.document.sceneId !== result.targetSceneId || result.targetInitialProject.document.revision !== 0
    || result.targetInitialProject.historyIdentity.lineageId === result.family.current.project.historyIdentity.lineageId
    || projectContentHash(result.targetInitialProject) !== result.targetInitialContentHash) throw new Error('原件保全须绑定相邻完整版本源及独立lineage、revision0的初始目标。')
  for (const field of ['assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) {
    if (canonicalJson(result.targetInitialProject[field]) !== canonicalJson(result.family.current.project[field])) throw new Error('格式副本升级须完整保留实际资源、许可和SVG来源闭包。')
  }
  const references = familyReferences(result.family)
  if (canonicalJson(result.resourceHashes) !== canonicalJson([...references.resources.keys()].sort())
    || canonicalJson(result.licenseHashes) !== canonicalJson([...references.licenses.keys()].sort())
    || canonicalJson(result.legacyHashes) !== canonicalJson(references.legacy)) throw new Error('原件保全字节闭包不完整或含多余记录。')
  if (result.capsuleId !== capsuleId(result) || result.contentHash !== digest(capsuleJson(result, false))) throw new Error('原件保全实际内容hash或固定身份损坏。')
  if (encodeUtf8(capsuleJson(result, true)).length > MAX_DOCUMENT_BYTES) throw new Error('原件保全文档超过128MiB预算。')
  return result
}
function capsuleId(capsule: Pick<StoredNativeUpgradeCapsule, 'family' | 'parentCapsuleIds' | 'targetSceneId' | 'targetInitialContentHash'>): string {
  return `native-upgrade-${digest(jsonRecord([
    ['family', familyJson(capsule.family)], ['parentCapsuleIds', canonicalJson(capsule.parentCapsuleIds)],
    ['targetSceneId', canonicalJson(capsule.targetSceneId)], ['targetInitialContentHash', canonicalJson(capsule.targetInitialContentHash)],
  ]))}`
}
function captureByteRow(input: unknown, maximum: number): StoredBytes {
  exact(input, ['sha256', 'bytes'])
  if (!hash(input.sha256)) throw new Error('保全实际字节hash无效。')
  const bytes = captureBytes(input.bytes as Uint8Array, maximum)
  if (!bytes.length || sha256Bytes(bytes) !== input.sha256) throw new Error('保全实际字节hash损坏。')
  return { sha256: input.sha256, bytes }
}
function captureTransfer(input: unknown, context: NativeUpgradeContext): NativeUpgradeTransfer {
  exact(input, ['format', 'version', 'capsule', 'ancestors', 'resources', 'legacyBlobs', 'licenses'])
  if (input.format !== 'sceneweave-native-upgrade-transfer' || input.version !== 1) throw new Error('不支持的原件保全传输格式。')
  // Capture every caller-owned byte before the first await.
  const capsule = captureCapsule(input.capsule, context)
  let documentBytes = encodeUtf8(capsuleJson(capsule, true)).length, resourceBytes = 0, legacyBytes = 0
  const ancestors = array(input.ancestors, MAX_ANCESTORS, row => {
    const captured = captureCapsule(row, context)
    documentBytes += encodeUtf8(capsuleJson(captured, true)).length
    if (documentBytes > MAX_DOCUMENT_BYTES) throw new Error('原件保全传输累计文档超过128MiB。')
    return captured
  })
  const resources = array(input.resources, 65_536, row => {
    const captured = captureByteRow(row, 20 * 1024 * 1024)
    if ((resourceBytes += captured.bytes.length) > MAX_RESOURCE_BYTES) throw new Error('原件保全传输累计资源超过256MiB。')
    return captured
  })
  const legacyBlobs = array(input.legacyBlobs, 64 * (MAX_ANCESTORS + 1), row => {
    const captured = captureByteRow(row, MAX_LEGACY_BYTES)
    if ((legacyBytes += captured.bytes.length) > MAX_LEGACY_BYTES) throw new Error('原件保全传输累计旧原件超过128MiB。')
    return captured
  })
  const licenses = array(input.licenses, 65_536, row => {
    exact(row, ['sha256', 'text'])
    if (!hash(row.sha256) || typeof row.text !== 'string' || !row.text.length || encodeUtf8(row.text).length > 256 * 1024 || digest(row.text) !== row.sha256) throw new Error('保全许可正文hash或预算损坏。')
    if ((resourceBytes += encodeUtf8(row.text).length) > MAX_RESOURCE_BYTES) throw new Error('原件保全传输许可与资源累计超过256MiB。')
    return { sha256: row.sha256, text: row.text }
  })
  return { format: input.format, version: input.version, capsule, ancestors, resources, legacyBlobs, licenses }
}
function uniqueRows<T extends { sha256: string }>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>()
  for (const row of rows) {
    if (result.has(row.sha256)) throw new Error('保全传输字节或许可记录重复。')
    result.set(row.sha256, row)
  }
  return result
}
function assertGraph(transfer: NativeUpgradeTransfer): StoredNativeUpgradeCapsule[] {
  const all = [transfer.capsule, ...transfer.ancestors], byId = new Map<string, StoredNativeUpgradeCapsule>()
  for (const row of all) {
    if (byId.has(row.capsuleId)) throw new Error('原件保全祖先重复。')
    byId.set(row.capsuleId, row)
  }
  const visited = new Set<string>(), path = new Set<string>()
  const visit = (row: StoredNativeUpgradeCapsule, depth: number) => {
    if (depth > MAX_DEPTH || path.has(row.capsuleId)) throw new Error('原件保全来源链循环或超过16层。')
    if (visited.has(row.capsuleId)) return
    path.add(row.capsuleId)
    for (const parentId of row.parentCapsuleIds) {
      const parent = byId.get(parentId)
      if (!parent || parent.targetSceneId !== row.sourceSceneId || parent.sourceSceneId === row.targetSceneId
        || parent.targetInitialProject.historyIdentity.lineageId !== row.family.current.project.historyIdentity.lineageId) throw new Error('原件保全祖先缺失或来源链归属无效。')
      visit(parent, depth + 1)
    }
    path.delete(row.capsuleId); visited.add(row.capsuleId)
  }
  visit(transfer.capsule, 1)
  if (visited.size !== all.length) throw new Error('原件保全传输包含无关联祖先。')
  return all
}
async function verifyTransfer(transfer: NativeUpgradeTransfer, context: NativeUpgradeContext, options: ResourceOptions): Promise<void> {
  checkCancelled(options.signal)
  const all = assertGraph(transfer), resources = uniqueRows(transfer.resources), legacy = uniqueRows(transfer.legacyBlobs), licenses = uniqueRows(transfer.licenses)
  const expectedResources = new Set<string>(), expectedLegacy = new Set<string>(), expectedLicenses = new Set<string>()
  for (const capsule of all) {
    const references = familyReferences(capsule.family)
    for (const [hash, size] of references.resources) {
      const row = resources.get(hash)
      if (!row || row.bytes.length !== size) throw new Error('保全传输缺少实际资源或长度不符。')
      expectedResources.add(hash)
    }
    for (const [hash, license] of references.licenses) {
      if (licenses.get(hash)?.text !== license.text) throw new Error('保全传输缺少实际许可正文。')
      expectedLicenses.add(hash)
    }
    for (const hash of references.legacy) {
      if (!legacy.has(hash)) throw new Error('保全传输缺少既有旧格式原件。')
      expectedLegacy.add(hash)
    }
    context.assertLegacyNodes(capsule.family.legacySources, references.legacy.map(hash => legacy.get(hash)!), capsule.sourceSceneId)
    // Validate each original independently: 20 automatic + 64 named/protection + 20 imported
    // can exceed the selective archive's batch limit of 85. No image work is inside IDB.
    for (const project of [...familyProjects(capsule.family), capsule.targetInitialProject]) {
      const resourcePort = createMemoryResources(new Map([...projectResourceRecords(project).keys()].map(hash => [hash, resources.get(hash)!.bytes])))
      await validateProjectBundle({ project, resources: resourcePort }, { ...context.validation, signal: options.signal ?? context.validation.signal })
    }
  }
  if (expectedResources.size !== resources.size || expectedLegacy.size !== legacy.size || expectedLicenses.size !== licenses.size) throw new Error('保全传输包含无来源的多余字节或许可。')
  checkCancelled(options.signal)
}
async function readFamily(context: NativeUpgradeContext, owner: string): Promise<NativeUpgradeFamily> {
  const db = context.database
  const [current, automatic, snapshots, importedSnapshots, bindings, metadata, legacySources, conversionJobs] = await Promise.all([
    db.projects.get(owner), db.automaticSnapshots.where('ownerSceneId').equals(owner).toArray(), db.snapshots.where('ownerSceneId').equals(owner).toArray(),
    db.importedSnapshots.where('ownerSceneId').equals(owner).toArray(), db.resourceBindings.where('ownerSceneId').equals(owner).toArray(),
    db.historyMetadata.get(owner), db.legacySources.where('ownerSceneId').equals(owner).toArray(), db.conversionJobs.where('targetSceneId').equals(owner).toArray(),
  ])
  if (!current || !metadata) throw new Error('原件保全源工程或历史元数据不存在。')
  const family = captureFamily({ current, automatic: automatic.sort((a, b) => a.revision - b.revision),
    snapshots: snapshots.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), importedSnapshots: importedSnapshots.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    bindings: bindings.sort((a, b) => { const left = canonicalJson([a.kind, a.recordId]), right = canonicalJson([b.kind, b.recordId]); return left < right ? -1 : left > right ? 1 : 0 }), metadata,
    legacySources: legacySources.sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0), conversionJobs: conversionJobs.sort((a, b) => a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0) })
  assertFamily(family, context); return family
}
async function readTransfer(context: NativeUpgradeContext, root: StoredNativeUpgradeCapsule): Promise<NativeUpgradeTransfer> {
  const db = context.database, capsule = captureCapsule(root, context), ancestors = new Map<string, StoredNativeUpgradeCapsule>(), path = new Set<string>()
  const walk = async (row: StoredNativeUpgradeCapsule, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || path.has(row.capsuleId)) throw new Error('原件保全来源链循环或超限。')
    path.add(row.capsuleId)
    for (const id of row.parentCapsuleIds) {
      if (ancestors.has(id)) continue
      const stored = await db.nativeUpgradeCapsules.get(id)
      if (!stored) throw new Error('既有原件保全祖先缺失。')
      const parent = captureCapsule(stored, context)
      if (ancestors.size >= MAX_ANCESTORS) throw new Error('既有原件保全祖先数量超限。')
      ancestors.set(id, parent); await walk(parent, depth + 1)
    }
    path.delete(row.capsuleId)
  }
  await walk(capsule, 1)
  const all = [capsule, ...ancestors.values()]
  const resourceHashes = [...new Set(all.flatMap(row => row.resourceHashes))].sort(), legacyHashes = [...new Set(all.flatMap(row => row.legacyHashes))].sort(), licenseHashes = [...new Set(all.flatMap(row => row.licenseHashes))].sort()
  const [resources, legacyBlobs, licenses] = await Promise.all([db.resources.bulkGet(resourceHashes), db.legacyBlobs.bulkGet(legacyHashes), db.licenseTexts.bulkGet(licenseHashes)])
  if (resources.some(row => !row) || legacyBlobs.some(row => !row) || licenses.some(row => !row)) throw new Error('原件保全实际资源、许可或旧原件缺失。')
  const transfer = captureTransfer({ format: 'sceneweave-native-upgrade-transfer', version: 1, capsule,
    ancestors: [...ancestors.values()].sort((a, b) => a.capsuleId < b.capsuleId ? -1 : 1), resources, legacyBlobs, licenses }, context)
  assertGraph(transfer); return transfer
}
async function assertFreshTarget(context: NativeUpgradeContext, target: string): Promise<void> {
  const db = context.database
  if (await db.projects.get(target) || await db.historyMetadata.get(target) || await db.automaticSnapshots.where('ownerSceneId').equals(target).count()
    || await db.snapshots.where('ownerSceneId').equals(target).count() || await db.importedSnapshots.where('ownerSceneId').equals(target).count()
    || await db.resourceBindings.where('ownerSceneId').equals(target).count() || await db.legacySources.where('ownerSceneId').equals(target).count()
    || await db.conversionJobs.where('targetSceneId').equals(target).count()) throw new Error('升级新目标身份已被工程、历史或来源journal占用。')
}
async function assertInstalledLineage(context: NativeUpgradeContext, capsule: StoredNativeUpgradeCapsule): Promise<void> {
  for (const expected of [capsule.family.current.project, capsule.targetInitialProject]) {
    const current = await context.database.projects.get(expected.document.sceneId)
    if (!current) continue
    context.assertCurrent(current)
    if (current.project.historyIdentity.lineageId !== expected.historyIdentity.lineageId || current.project.schemaVersion !== expected.schemaVersion) throw new Error('已有工程身份或lineage与原件保全归属冲突；没有重新指派。')
  }
}
/** Preserves originals and cold-reads them; the caller separately saves and cold-reads the new target. */
export async function preserveNativeUpgrade(context: NativeUpgradeContext, sourceInput: ProjectBundle, targetInput: ProjectBundle, options: ResourceOptions = {}): Promise<void> {
  const source = captureProjectBundleInput(sourceInput), target = captureProjectBundleInput(targetInput), createdAt = context.now()
  if (source.project.schemaVersion !== 2 || target.project.schemaVersion !== 3 || source.project.document.sceneId === target.project.document.sceneId
    || source.project.historyIdentity.lineageId === target.project.historyIdentity.lineageId || target.project.document.revision !== 0 || !validTime(createdAt)) throw new Error('升级须从完整v2创建独立身份、独立lineage且revision0的完整v3副本。')
  await validateProjectBundle(source, { ...context.validation, signal: options.signal ?? context.validation.signal })
  await validateProjectBundle(target, { ...context.validation, signal: options.signal ?? context.validation.signal })
  checkCancelled(options.signal); await context.open()
  const sourceSceneId = source.project.document.sceneId, targetSceneId = target.project.document.sceneId, sourceContentHash = projectContentHash(source.project), targetInitialContentHash = projectContentHash(target.project)
  const captured = await context.database.transaction('r', PROJECT_TABLES, async () => {
    await assertFreshTarget(context, targetSceneId)
    const family = await readFamily(context, sourceSceneId)
    if (family.current.contentHash !== sourceContentHash) throw new Error('升级源与本机当前完整修订不一致；请先保存。')
    const parentCapsuleIds = (await context.database.nativeUpgradeCapsules.where('targetSceneId').equals(sourceSceneId).primaryKeys()).sort()
    const skeleton: StoredNativeUpgradeCapsule = { format: 'sceneweave-native-upgrade-capsule', version: 1, capsuleId: '', sourceSceneId, sourceContentHash,
      targetSceneId, targetInitialContentHash, targetInitialProject: target.project, createdAt, family, resourceHashes: [], licenseHashes: [], legacyHashes: [], parentCapsuleIds, contentHash: '' }
    const references = familyReferences(family)
    skeleton.resourceHashes = [...references.resources.keys()].sort(); skeleton.licenseHashes = [...references.licenses.keys()].sort(); skeleton.legacyHashes = references.legacy
    skeleton.capsuleId = capsuleId(skeleton); skeleton.contentHash = digest(capsuleJson(skeleton, false))
    return readTransfer(context, skeleton)
  })
  await verifyTransfer(captured, context, options)
  await context.database.transaction('rw', PROJECT_TABLES, async () => {
    checkCancelled(options.signal); await assertFreshTarget(context, targetSceneId)
    const actualFamily = await readFamily(context, sourceSceneId), parentIds = (await context.database.nativeUpgradeCapsules.where('targetSceneId').equals(sourceSceneId).primaryKeys()).sort()
    if (familyJson(actualFamily) !== familyJson(captured.capsule.family) || canonicalJson(parentIds) !== canonicalJson(captured.capsule.parentCapsuleIds)) throw new Error('升级源当前、全部历史、元数据或原件来源已变化；未采用。')
    // Re-read actual byte/hash closure in the final transaction too; metadata hashes alone grant no trust.
    const actual = await readTransfer(context, captured.capsule)
    if (actual.ancestors.some(row => !captured.ancestors.some(before => row.capsuleId === before.capsuleId && row.contentHash === before.contentHash))) throw new Error('升级源既有原件保全已变化。')
    const existingTargets = await context.database.nativeUpgradeCapsules.where('targetSceneId').equals(targetSceneId).toArray()
    if (existingTargets.length > 1 || existingTargets.some(row => row.capsuleId !== captured.capsule.capsuleId)) throw new Error('此升级目标已绑定其他源家族；请使用新的目标身份。')
    const existing = existingTargets[0]
    if (existing) {
      const checked = captureCapsule(existing, context)
      if (checked.targetInitialContentHash !== targetInitialContentHash || familyJson(checked.family) !== familyJson(captured.capsule.family)
        || canonicalJson(checked.parentCapsuleIds) !== canonicalJson(parentIds)) throw new Error('已有原件保全与本次升级不一致。')
    } else await context.database.nativeUpgradeCapsules.add(captured.capsule)
    await context.assertBudgets(sourceSceneId); checkCancelled(options.signal)
  })
  const reread = await exportNativeUpgradeCapsule(context, targetSceneId, options)
  if (reread.capsule.capsuleId !== captured.capsule.capsuleId || reread.capsule.targetInitialContentHash !== targetInitialContentHash) throw new Error('升级原件冷读绑定不符；未切换工程。')
}
export async function exportNativeUpgradeCapsule(context: NativeUpgradeContext, targetSceneId: string, options: ResourceOptions = {}): Promise<NativeUpgradeTransfer> {
  if (!validId(targetSceneId)) throw new Error('原件保全目标工程ID无效。')
  checkCancelled(options.signal); await context.open()
  const transfer = await context.database.transaction('r', PROJECT_TABLES, async () => {
    const rows = await context.database.nativeUpgradeCapsules.where('targetSceneId').equals(targetSceneId).toArray()
    if (rows.length !== 1) throw new Error('目标工程没有唯一的完整升级原件保全。')
    const transfer = await readTransfer(context, rows[0])
    for (const row of [transfer.capsule, ...transfer.ancestors]) await assertInstalledLineage(context, row)
    return transfer
  })
  await verifyTransfer(transfer, context, options); return transfer
}
/** Does not read resource/original byte stores or decode images. Not a content-verification receipt. */
export async function listNativeUpgradeSummaries(context: NativeUpgradeContext, targetSceneId: string, options: ResourceOptions = {}): Promise<NativeUpgradeSummary[]> {
  if (!validId(targetSceneId)) throw new Error('原件保全目标工程ID无效。')
  checkCancelled(options.signal); await context.open()
  const rows = await context.database.nativeUpgradeCapsules.where('targetSceneId').equals(targetSceneId).toArray()
  checkCancelled(options.signal)
  if (rows.length > 1) throw new Error('目标工程没有唯一的完整升级原件保全。')
  return rows.map(input => {
    exact(input, CAPSULE_FIELDS); exact(input.family, FAMILY_FIELDS)
    const family = input.family
    exact(family.current, ['sceneId', 'revision', 'savedAt', 'contentHash', 'status', 'conversionJobId', 'project'])
    const current = family.current
    const field = (record: unknown, key: string): unknown => {
      if (!record || typeof record !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(record))) throw new Error('原件保全摘要须为普通数据记录。')
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('原件保全摘要字段缺失或含访问器。')
      return descriptor.value
    }
    const version = field(current.project, 'schemaVersion'), document = field(current.project, 'document')
    const title = field(document, 'title'), sceneId = field(document, 'sceneId'), revision = field(document, 'revision')
    if (input.format !== 'sceneweave-native-upgrade-capsule' || input.version !== 1 || !validId(input.capsuleId)
      || !validId(input.sourceSceneId) || input.targetSceneId !== targetSceneId || input.sourceSceneId === targetSceneId
      || !validTime(input.createdAt) || !hash(input.sourceContentHash) || !hash(input.contentHash)
      || current.status !== 'ready' || current.sceneId !== input.sourceSceneId || current.contentHash !== input.sourceContentHash
      || sceneId !== input.sourceSceneId || revision !== current.revision || !Number.isSafeInteger(revision) || Number(revision) < 0
      || version !== 1 && version !== 2 || typeof title !== 'string' || !title.length) throw new Error('原件保全摘要身份或版本损坏。')
    const automatic = array(family.automatic, 20, value => { field(value, 'revision'); return null })
    let namedCount = 0, protectionCount = 0
    array(family.snapshots, 64, value => {
      const kind = field(value, 'kind')
      if (kind === 'named') namedCount++
      else if (kind === 'protection') protectionCount++
      else throw new Error('原件保全摘要快照类别损坏。')
      return null
    })
    if (namedCount > 32 || protectionCount > 32) throw new Error('原件保全摘要快照类别超限。')
    const imported = array(family.importedSnapshots, 20, value => {
      if (field(value, 'kind') !== 'imported-auto') throw new Error('原件保全摘要导入历史类别损坏。')
      return null
    })
    const legacy = strings(input.legacyHashes, 64, hash), ancestors = strings(input.parentCapsuleIds, MAX_ANCESTORS, validId)
    return { capsuleId: input.capsuleId, sourceSceneId: input.sourceSceneId, sourceTitle: title,
      sourceSchemaVersion: version, sourceRevision: Number(revision), sourceContentHash: input.sourceContentHash,
      targetSceneId, createdAt: input.createdAt, automaticCount: automatic.length, namedCount, protectionCount,
      importedCount: imported.length, legacyOriginalCount: legacy.length, parentCapsuleCount: ancestors.length }
  })
}
/** Imports originals only; it never installs a current project, changes lineage or replaces existing rows. */
export async function importNativeUpgradeCapsule(context: NativeUpgradeContext, input: NativeUpgradeTransfer, options: ResourceOptions = {}): Promise<void> {
  const transfer = captureTransfer(input, context)
  await verifyTransfer(transfer, context, options); await context.open()
  await context.database.transaction('rw', PROJECT_TABLES, async () => {
    checkCancelled(options.signal)
    for (const row of [transfer.capsule, ...transfer.ancestors]) {
      await assertInstalledLineage(context, row)
      const existing = await context.database.nativeUpgradeCapsules.get(row.capsuleId)
      const sameTarget = await context.database.nativeUpgradeCapsules.where('targetSceneId').equals(row.targetSceneId).toArray()
      if (sameTarget.some(other => other.capsuleId !== row.capsuleId) || existing && capsuleJson(captureCapsule(existing, context), true) !== capsuleJson(row, true)) throw new Error('已有保全身份或目标绑定冲突；没有覆盖。')
      if (!existing) await context.database.nativeUpgradeCapsules.add(row)
    }
    const putBytes = async (rows: StoredBytes[], legacy: boolean) => {
      const table = legacy ? context.database.legacyBlobs : context.database.resources
      for (const row of rows) {
        const existing = await table.get(row.sha256)
        if (existing) {
          const checked = captureByteRow(existing, legacy ? MAX_LEGACY_BYTES : 20 * 1024 * 1024)
          if (checked.bytes.length !== row.bytes.length || checked.bytes.some((value, i) => value !== row.bytes[i])) throw new Error('已有资源或原件实际字节冲突；没有覆盖。')
        } else await table.add(row)
      }
    }
    await putBytes(transfer.resources, false); await putBytes(transfer.legacyBlobs, true)
    for (const row of transfer.licenses) {
      const existing = await context.database.licenseTexts.get(row.sha256)
      if (existing) { exact(existing, ['sha256', 'text']); if (existing.sha256 !== row.sha256 || existing.text !== row.text) throw new Error('已有许可正文冲突；没有覆盖。') }
      else await context.database.licenseTexts.add(row)
    }
    await context.assertBudgets(transfer.capsule.sourceSceneId); checkCancelled(options.signal)
  })
  const reread = await exportNativeUpgradeCapsule(context, transfer.capsule.targetSceneId, options)
  if (reread.capsule.contentHash !== transfer.capsule.contentHash) throw new Error('导入原件保全的冷读hash不符。')
}
/** Used by the repository's library-wide document budget scan. Rechecks all stored JSON, not a cached hash. */
export function nativeUpgradeCapsuleDocumentBytes(input: unknown, context: NativeUpgradeContext): number {
  return encodeUtf8(capsuleJson(captureCapsule(input, context), true)).length
}
