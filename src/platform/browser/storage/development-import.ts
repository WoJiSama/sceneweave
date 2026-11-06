import Dexie from 'dexie'
/** Explicit one-time migration; source databases are opened through native readonly transactions. */
import type { ProjectData } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { convertDevelopmentProject, legacyDevelopmentProjectHash, readLegacyDevelopmentProject } from '../../../shared/migration/development-project.js'
import { readDevelopmentCapsule } from '../../../shared/migration/development-capsule.js'
import { createMemoryResources, validateProjectBundle } from '../../../shared/project/resources.js'
import { projectSourceRecords } from '../../../shared/project/source-resources.js'
import { createProjectDelta, projectDeltaBytes, validateProjectDelta, DeltaSizeError, type DeltaValue } from '../../../shared/project/delta.js'
import { validateCatalogItem } from '../../../shared/library/metadata.js'
import { captureLibraryEntry, prepareLibraryEntry } from '../../../shared/library/content.js'
import { ProjectDatabase, PROJECT_TABLES, inspectProjectDatabase, LEGACY_DEVELOPMENT_PROJECT_DATABASE } from './database.js'
import { LibraryDatabase, LIBRARY_TABLES, inspectLibraryDatabase, LEGACY_DEVELOPMENT_LIBRARY_DATABASE, type StoredEntry } from '../library/database.js'
import { ProjectRepository, PROJECT_STORAGE_LIMITS, assertCurrent, assertAutomatic, assertSnapshot } from './repository.js'
import { LibraryRepository } from '../library/repository.js'
import { captureHistoryGraph, historyGraphProjects, captureHistoryVersionEnvelope, captureHistoryHeadEnvelope, captureHistoryPinEnvelope, sealHistoryRecord, type HistoryGraph, type HistoryVersion } from './incremental-history.js'
import { CURRENT_DATABASE_SELECTION_KEY, currentDatabaseNames, type CurrentDatabaseNames } from './current-databases.js'
import { CONTENT_PAYLOAD_FIELDS, CONTENT_BLOCK_STORE } from './content-block-middleware.js'
import { partitionProjectContent, type ProjectContentBlock } from './content-blocks.js'

type Row = Record<string, unknown>
interface CapturedDatabase { version: number; rows: Record<string, Row[]> }
export interface DevelopmentImportPreview { sourceFingerprint: string; projectCount: number; historyVersionCount: number; libraryEntryCount: number; target: CurrentDatabaseNames }
export interface DevelopmentImportOptions { validation: CompleteValidationOptions; storage?: Pick<Storage, 'getItem' | 'setItem'>; source?: CurrentDatabaseNames; locks?: Pick<LockManager, 'request'> }
const digest = (value: unknown) => sha256Bytes(encodeUtf8(canonicalJson(value)))
const asRows = (snapshot: CapturedDatabase, table: string) => snapshot.rows[table] ?? []
const equal = (left: unknown, right: unknown) => left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right)

async function captureDatabase(name: string, kind: 'projects' | 'library', signal: CompleteValidationOptions['signal']): Promise<CapturedDatabase> {
  checkCancelled(signal)
  if (kind === 'projects') await inspectProjectDatabase(name); else await inspectLibraryDatabase(name)
  checkCancelled(signal)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort() }
    request.onerror = () => absent ? resolve({ version: 0, rows: {} }) : reject(request.error)
    request.onblocked = () => reject(new Error('旧数据被其他标签占用，请关闭旧标签后重试。'))
    request.onsuccess = () => {
      const db = request.result, rows: Record<string, Row[]> = {}
      const tx = db.transaction([...db.objectStoreNames], 'readonly')
      for (const name of db.objectStoreNames) {
        const read = tx.objectStore(name).getAll()
        read.onsuccess = () => { rows[name] = read.result }
      }
      tx.oncomplete = () => { db.close(); try { checkCancelled(signal); resolve({ version: db.version, rows }) } catch (error) { reject(error) } }
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('旧数据只读捕获失败。')) }
    }
  })
}
/** Native IDB owns these clones. Merkle hashing bounds each row independently,
 * including nested capsule bytes and deltas with their separate aggregate budget. */
function rowFingerprint(input: unknown): string {
  let count = 0
  const visit = (value: unknown, depth: number): unknown => {
    if (++count > 1_300_000 || depth > 128) throw new Error('旧记录超过独立捕获保护预算。')
    if (value instanceof Uint8Array) return ['bytes', value.length, sha256Bytes(new Uint8Array(value))]
    if (value === null || typeof value !== 'object') {
      if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || typeof value === 'number' && !Number.isFinite(value)) throw new Error('旧记录含非JSON值。')
      return ['json', value]
    }
    if (![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value))) throw new Error('旧记录包含不支持的数据。')
    if (Array.isArray(value)) return ['array', value.map(child => visit(child, depth + 1))]
    return ['record', Object.keys(value).sort().map(key => [key, visit((value as Row)[key], depth + 1)])]
  }
  return sha256Bytes(encodeUtf8(JSON.stringify(visit(input, 0))))
}
function databaseFingerprint(value: CapturedDatabase): string {
  const tables = Object.entries(value.rows).sort(([a], [b]) => a.localeCompare(b)).map(([table, rows]) => [table, rows.map(row => {
    if (row.bytes instanceof Uint8Array && row.sha256 !== sha256Bytes(row.bytes)) throw new Error('旧资源或原件字节hash损坏。')
    return rowFingerprint(row)
  }).sort()])
  return digest({ version: value.version, tables })
}
async function capture(options: DevelopmentImportOptions) {
  const source = options.source ?? { projects: LEGACY_DEVELOPMENT_PROJECT_DATABASE, library: LEGACY_DEVELOPMENT_LIBRARY_DATABASE }
  const [projects, library] = await Promise.all([captureDatabase(source.projects, 'projects', options.validation.signal), captureDatabase(source.library, 'library', options.validation.signal)])
  checkCancelled(options.validation.signal)
  const sourceFingerprint = digest([source, databaseFingerprint(projects), databaseFingerprint(library)])
  checkCancelled(options.validation.signal)
  return { source, projects, library, sourceFingerprint }
}
const targetNames = (fingerprint: string): CurrentDatabaseNames => ({ projects: `sceneweave-projects-dev-v1-${fingerprint}`, library: `sceneweave-library-dev-v1-${fingerprint}` })
export async function inspectLocalDevelopmentImport(options: DevelopmentImportOptions): Promise<DevelopmentImportPreview> {
  const source = await capture(options)
  return { sourceFingerprint: source.sourceFingerprint, projectCount: asRows(source.projects, 'projects').length,
    historyVersionCount: asRows(source.projects, 'historyVersions').length, libraryEntryCount: asRows(source.library, 'entries').length, target: targetNames(source.sourceFingerprint) }
}

/** Apply an old strict reversible delta without sending its payload through the current project parser. */
function applyLegacyDelta(input: unknown, raw: unknown): unknown {
  const result = captureJson(input) as Row, delta = validateProjectDelta(raw)
  if (legacyDevelopmentProjectHash(result) !== delta.beforeHash) throw new Error('旧历史增量基线hash不符。')
  for (const change of delta.changes) {
    let parent = result as Record<string, DeltaValue>
    for (const segment of change.path.slice(0, -1)) {
      if (!Object.hasOwn(parent, segment) || !parent[segment] || typeof parent[segment] !== 'object' || Array.isArray(parent[segment])) throw new Error('旧历史增量路径缺失。')
      parent = parent[segment] as Record<string, DeltaValue>
    }
    const key = change.path.at(-1)!, exists = Object.hasOwn(parent, key)
    if (exists !== change.before.present || change.before.present && !equal(parent[key], change.before.value)) throw new Error('旧历史增量前置值不符。')
    if (change.after.present) Object.defineProperty(parent, key, { value: cloneJson(change.after.value), enumerable: true, writable: true, configurable: true })
    else delete parent[key]
  }
  if (legacyDevelopmentProjectHash(result) !== delta.afterHash) throw new Error('旧历史增量结果hash不符。')
  return result
}
function oldProject(input: unknown, expectedHash?: unknown) {
  const project = readLegacyDevelopmentProject(input)
  if (typeof expectedHash !== 'string' || legacyDevelopmentProjectHash(project) !== expectedHash) throw new Error('旧工程实际内容hash不符。')
  return project
}
function convertGraph(headInput: unknown, versionsInput: Row[], pinsInput: Row[]): { graph: HistoryGraph; projects: ProjectData[]; legacyProjects: Map<string, unknown> } {
  const owner = String((headInput as Row).ownerSceneId), head = captureHistoryHeadEnvelope(headInput, owner)
  if (head.status !== 'ready') throw new Error('旧历史仍在暂存，不能迁入。')
  const versions = versionsInput.map(row => captureHistoryVersionEnvelope(row, owner)), byId = new Map(versions.map(row => [row.id, row]))
  if (byId.size !== versions.length) throw new Error('旧历史版本重复。')
  const rawProjects = new Map<string, unknown>(), projects = new Map<string, ProjectData>(), converted: HistoryVersion[] = []
  const pending = new Set(versions.map(row => row.id))
  while (pending.size) {
    let progressed = false
    for (const id of pending) {
      const row = byId.get(id)!, parent = row.parentId === null ? null : byId.get(row.parentId)
      if (row.parentId !== null && (!parent || parent.contentHash !== row.parentHash || parent.revision >= row.revision)) throw new Error('旧历史父版本缺失或修订/hash无效。')
      if (parent && !rawProjects.has(parent.id)) continue
      if (row.checkpoint === null && (row.depth !== parent!.depth + 1 || row.chainBytes !== parent!.chainBytes + projectDeltaBytes(row.delta))) throw new Error('旧历史累计增量字节或深度损坏。')
      const raw = row.checkpoint === null ? applyLegacyDelta(rawProjects.get(parent!.id), row.delta) : oldProject(row.checkpoint, row.contentHash)
      const legacy = oldProject(raw, row.contentHash)
      if (legacy.document.sceneId !== owner || legacy.document.revision !== row.revision) throw new Error('旧历史修订不匹配。')
      const project = convertDevelopmentProject(legacy), parentProject = parent ? projects.get(parent.id)! : null
      let delta = null
      if (parentProject) {
        try { delta = createProjectDelta(parentProject, project) }
        catch (error) { if (!(error instanceof DeltaSizeError)) throw error }
      }
      const parentConverted = parent ? converted.find(item => item.id === parent.id)! : null
      const depth = parentConverted ? parentConverted.depth + 1 : 0
      if (!parent || row.checkpoint !== null || depth >= 4) delta = null
      const next = sealHistoryRecord({ ...row, contentHash: projectContentHash(project), parentHash: parentProject ? projectContentHash(parentProject) : null,
        checkpoint: delta === null ? project : null, delta, depth: delta === null ? 0 : depth,
        chainBytes: delta === null ? 0 : (parentConverted?.chainBytes ?? 0) + projectDeltaBytes(delta) })
      rawProjects.set(id, legacy); projects.set(id, project); converted.push(next); pending.delete(id); progressed = true
    }
    if (!progressed) throw new Error('旧历史包含循环父链。')
  }
  const pins = pinsInput.map(input => {
    const pin = captureHistoryPinEnvelope(input, owner), version = projects.get(pin.versionId), oldVersion = byId.get(pin.versionId)
    if (!version || pin.contentHash !== oldVersion?.contentHash || pin.sourceRevision !== version.document.revision || pin.lineageId !== version.historyIdentity.lineageId) throw new Error('旧历史快照引用损坏。')
    return sealHistoryRecord({ ...pin, contentHash: projectContentHash(version) })
  })
  const active = projects.get(head.activeVersionId), oldActive = byId.get(head.activeVersionId)
  if (!active || head.contentHash !== oldActive?.contentHash || head.savedRevision !== active.document.revision) throw new Error('旧历史当前分支损坏。')
  const graph = captureHistoryGraph({ head: sealHistoryRecord({ ...head, contentHash: projectContentHash(active), migration: null }), versions: converted, pins })
  return { graph, projects: [...projects.values()], legacyProjects: rawProjects }
}

function exactRow(row: Row, fields: string[]) {
  if (Object.keys(row).sort().join('\0') !== fields.sort().join('\0')) throw new Error('旧存档字段缺失或含未知字段。')
}
function validateSourceReferences(source: Awaited<ReturnType<typeof capture>>) {
  const expected = new Map<string, Row>(), key = (row: Row) => canonicalJson([row.ownerSceneId, row.kind, row.recordId])
  const owners = new Set(asRows(source.projects, 'projects').map(row => row.sceneId))
  const verifyOld = (project: ProjectData, hash: string) => { oldProject(project, hash) }
  for (const row of asRows(source.projects, 'projects')) assertCurrent(row as unknown as Parameters<typeof assertCurrent>[0], verifyOld)
  for (const row of asRows(source.projects, 'automaticSnapshots')) assertAutomatic(row as unknown as Parameters<typeof assertAutomatic>[0], verifyOld)
  for (const table of ['snapshots', 'importedSnapshots'] as const) for (const row of asRows(source.projects, table)) assertSnapshot(row as unknown as Parameters<typeof assertSnapshot>[0], table === 'importedSnapshots', verifyOld)
  for (const table of ['automaticSnapshots', 'snapshots', 'importedSnapshots', 'historyMetadata', 'legacySources'] as const) {
    for (const row of asRows(source.projects, table)) if (!owners.has(row.ownerSceneId)) throw new Error('旧存档记录缺少所属当前工程。')
  }
  const referencedOriginals = new Set(asRows(source.projects, 'legacySources').map(row => row.sourceHash))
  if (asRows(source.projects, 'legacyBlobs').some(row => !referencedOriginals.has(row.sha256))) throw new Error('旧原件字节缺少来源记录。')
  for (const table of ['projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots'] as const) {
    for (const row of asRows(source.projects, table)) {
      const project = oldProject(row.project, row.contentHash)
      const kind = table === 'projects' ? 'current' : table === 'automaticSnapshots' ? 'automatic' : table === 'importedSnapshots' ? 'imported-auto' : row.kind
      const recordId = String(table === 'projects' ? 'current' : table === 'automaticSnapshots' ? row.revision : row.id)
      const ownerSceneId = table === 'projects' ? row.sceneId : row.ownerSceneId
      const value = { ownerSceneId, kind, recordId, assetHashes: Object.keys(project.assets).sort(), sourceHashes: [...projectSourceRecords(project).keys()].sort(),
        licenseHashes: Object.keys(project.licenses).sort(), licenseBindings: project.licenseBindings }
      expected.set(key(value), value)
      if (table === 'projects') exactRow(row, ['sceneId', 'revision', 'savedAt', 'contentHash', 'status', 'conversionJobId', 'project'])
      else if (table === 'automaticSnapshots') exactRow(row, ['ownerSceneId', 'revision', 'savedAt', 'contentHash', 'project'])
      else exactRow(row, ['id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'project'])
    }
  }
  for (const head of asRows(source.projects, 'historyHeads')) {
    const converted = convertGraph(head, asRows(source.projects, 'historyVersions').filter(row => row.ownerSceneId === head.ownerSceneId), asRows(source.projects, 'historyPins').filter(row => row.ownerSceneId === head.ownerSceneId))
    for (const pin of converted.graph.pins) {
      const project = readLegacyDevelopmentProject(converted.legacyProjects.get(pin.versionId))
      const value = { ownerSceneId: pin.ownerSceneId, kind: pin.kind, recordId: pin.id, assetHashes: Object.keys(project.assets).sort(), sourceHashes: [...projectSourceRecords(project).keys()].sort(),
        licenseHashes: Object.keys(project.licenses).sort(), licenseBindings: project.licenseBindings }
      if (expected.has(key(value)) && !equal(expected.get(key(value)), value)) throw new Error('旧pin与快照资源绑定冲突。')
      expected.set(key(value), value)
    }
  }
  for (const row of asRows(source.projects, 'resourceBindings')) {
    if (!equal(expected.get(key(row)), row)) throw new Error('旧工程资源绑定缺失、孤立或与内容不符。')
    expected.delete(key(row))
  }
  if (expected.size) throw new Error('旧工程资源绑定缺失。')
  for (const row of asRows(source.projects, 'licenseTexts')) {
    exactRow(row, ['sha256', 'text'])
    if (typeof row.text !== 'string' || sha256Bytes(encodeUtf8(row.text)) !== row.sha256) throw new Error('旧许可正文hash损坏。')
  }
  for (const row of [...asRows(source.projects, 'resources'), ...asRows(source.projects, 'legacyBlobs')]) {
    exactRow(row, ['sha256', 'bytes'])
    if (!(row.bytes instanceof Uint8Array) || !row.bytes.length || sha256Bytes(row.bytes) !== row.sha256) throw new Error('旧实际资源或原件字节损坏。')
  }
  for (const projectRow of ['projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots'].flatMap(table => asRows(source.projects, table))) {
    const project = oldProject(projectRow.project, projectRow.contentHash)
    for (const license of Object.values(project.licenses)) if (!asRows(source.projects, 'licenseTexts').some(row => equal(row, license))) throw new Error('旧存储许可正文缺失或不一致。')
  }
}

interface PreservationRow { kind: 'projects' | 'library'; table: string; index: number; payload: Row }
class DevelopmentPreservation extends Dexie {
  constructor(fingerprint: string) { super(`sceneweave-development-originals-${fingerprint}`, { autoOpen: false }); this.version(1).stores({ records: '[kind+table+index]', state: 'key' }) }
}
async function preserveSource(source: Awaited<ReturnType<typeof capture>>) {
  const db = new DevelopmentPreservation(source.sourceFingerprint)
  try {
    await db.open()
    const existing = await db.table('state').get('import')
    if (existing && existing.sourceFingerprint !== source.sourceFingerprint) throw new Error('迁入原件来源冲突。')
    if (!existing) {
      const transactions = db as unknown as { transaction(mode: 'rw', tables: string[], body: () => Promise<void>): Promise<void> }
      await transactions.transaction('rw', ['records', 'state'], async () => {
        for (const kind of ['projects', 'library'] as const) for (const [table, rows] of Object.entries(source[kind].rows)) {
          const records: PreservationRow[] = rows.map((payload, index) => ({ kind, table, index, payload }))
          await db.table<PreservationRow>('records').bulkAdd(records)
        }
        await db.table('state').add({ key: 'import', sourceFingerprint: source.sourceFingerprint, source: source.source,
          versions: { projects: source.projects.version, library: source.library.version }, stage: 'captured' })
      })
    }
    db.close(); await db.open()
    const state = await db.table('state').get('import'), rows = await db.table('records').toArray() as PreservationRow[]
    if (!state || state.sourceFingerprint !== source.sourceFingerprint) throw new Error('迁入原件保全索引缺失。')
    const restored = { projects: { version: state.versions.projects, rows: {} as Record<string, Row[]> }, library: { version: state.versions.library, rows: {} as Record<string, Row[]> } }
    for (const kind of ['projects', 'library'] as const) for (const table of Object.keys(source[kind].rows)) restored[kind].rows[table] = []
    for (const row of rows.sort((a, b) => a.index - b.index)) {
      if (!['projects', 'library'].includes(row.kind) || !Object.hasOwn(restored[row.kind].rows, row.table) || restored[row.kind].rows[row.table].length !== row.index) throw new Error('迁入原件索引缺失或重复。')
      restored[row.kind].rows[row.table].push(row.payload)
    }
    if (digest([source.source, databaseFingerprint(restored.projects), databaseFingerprint(restored.library)]) !== source.sourceFingerprint) throw new Error('迁入原件独立冷读指纹不符。')
    return db
  } catch (error) { db.close(); throw error }
}

export async function importLocalDevelopmentData(options: DevelopmentImportOptions, expectedFingerprint: string): Promise<DevelopmentImportPreview> {
  const locks = options.locks ?? (typeof navigator === 'undefined' ? undefined : navigator.locks)
  if (!locks) throw new Error('一次性迁入需要浏览器的独占存储锁；请使用当前版本的Chrome或Edge。')
  return locks.request('sceneweave-development-import-publication', { mode: 'exclusive' }, () => importUnderLock(options, expectedFingerprint))
}
async function importUnderLock(options: DevelopmentImportOptions, expectedFingerprint: string): Promise<DevelopmentImportPreview> {
  const storage = options.storage ?? localStorage, selectedBefore = storage.getItem(CURRENT_DATABASE_SELECTION_KEY), source = await capture(options)
  if (source.sourceFingerprint !== expectedFingerprint) throw new Error('旧数据已变化，请重新检查迁入范围。')
  validateSourceReferences(source)
  const target = targetNames(source.sourceFingerprint)
  checkCancelled(options.validation.signal)
  const projectDb = new ProjectDatabase(target.projects), libraryDb = new LibraryDatabase(target.library)
  const preservation = await preserveSource(source)
  try {
  const journal = await preservation.table('state').get('import')
  const existing = await indexedDB.databases(), selected = currentDatabaseNames(storage).projects === target.projects
  const present = existing.some(row => row.name === target.projects || row.name === target.library)
  if (journal.stage === 'verified') {
    if (!existing.some(row => row.name === target.projects) || !existing.some(row => row.name === target.library)) throw new Error('已迁入存储缺失，保留当前选择。')
    await verifyColdTarget(target, options)
    if (!selected && await targetFingerprint(target, options) !== journal.targetFingerprint) throw new Error('尚未发布的迁入目标范围或内容已变化，未切换。')
    const finalSource = await capture(options)
    if (finalSource.sourceFingerprint !== source.sourceFingerprint) throw new Error('来源或当前存储选择已变化，暂存结果没有发布。')
    checkCancelled(options.validation.signal)
    if (storage.getItem(CURRENT_DATABASE_SELECTION_KEY) !== selectedBefore) throw new Error('当前存储选择已变化，未切换。')
    if (!selected) storage.setItem(CURRENT_DATABASE_SELECTION_KEY, JSON.stringify(target))
    return preview(source)
  }
  if (selected || present && journal.stage !== 'building') throw new Error('目标库已有独立成果，迁入不会覆盖。')
  // A private building target may contain a transaction committed before a crash.
  // Resume only exact rows below; never delete or overwrite an existing row.
  await preservation.table('state').put({ ...journal, stage: 'building', target })
  const resourceRows = asRows(source.projects, 'resources'), bytes = new Map(resourceRows.map(row => [String(row.sha256), new Uint8Array(row.bytes as Uint8Array)]))
  const resources = createMemoryResources(bytes), allProjects: ProjectData[] = []
  const transformed: Record<string, Row[]> = Object.fromEntries(PROJECT_TABLES.map(name => [name, []]))
  for (const table of ['projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots'] as const) {
    transformed[table] = asRows(source.projects, table).map(row => {
      const legacy = oldProject(row.project, row.contentHash), project = convertDevelopmentProject(legacy)
      if (table === 'projects' && (row.status !== 'ready' || row.sceneId !== legacy.document.sceneId || row.revision !== legacy.document.revision)) throw new Error('旧当前工程未就绪或归属无效。')
      if (table !== 'projects' && (row.sourceRevision ?? row.revision) !== legacy.document.revision) throw new Error('旧快照归属无效。')
      allProjects.push(project)
      return { ...captureJson(row), project, contentHash: projectContentHash(project), ...(table === 'projects' ? { conversionJobId: null } : {}) }
    })
  }
  const owners = new Set(transformed.projects.map(row => row.sceneId))
  for (const head of asRows(source.projects, 'historyHeads')) {
    if (!owners.has(head.ownerSceneId)) throw new Error('旧历史没有当前工程。')
    const converted = convertGraph(head, asRows(source.projects, 'historyVersions').filter(row => row.ownerSceneId === head.ownerSceneId), asRows(source.projects, 'historyPins').filter(row => row.ownerSceneId === head.ownerSceneId))
    const current = transformed.projects.find(row => row.sceneId === head.ownerSceneId)!
    if (converted.graph.head.contentHash !== current.contentHash) throw new Error('旧历史活动分支与当前工程不符。')
    transformed.historyHeads.push(converted.graph.head as unknown as Row); transformed.historyVersions.push(...converted.graph.versions as unknown as Row[]); transformed.historyPins.push(...converted.graph.pins as unknown as Row[])
    allProjects.push(...converted.projects)
  }
  for (const row of asRows(source.projects, 'historyVersions')) if (!asRows(source.projects, 'historyHeads').some(head => head.ownerSceneId === row.ownerSceneId)) throw new Error('旧历史版本缺少head。')
  for (const row of asRows(source.projects, 'historyPins')) if (!asRows(source.projects, 'historyHeads').some(head => head.ownerSceneId === row.ownerSceneId)) throw new Error('旧历史pin缺少head。')
  // Source originals and their references remain byte-for-byte. Old upgrade capsules
  // contain old projects and are retained in the independent preservation database.
  for (const name of ['resources', 'licenseTexts', 'legacyBlobs', 'legacySources', 'historyMetadata'] as const) transformed[name] = asRows(source.projects, name)
  transformed.storageState = [{ key: 'epoch', epoch: 0 }]
  const bind = (row: Row, kind: string, recordId: string) => {
    const project = row.project as ProjectData
    transformed.resourceBindings.push({ ownerSceneId: kind === 'current' ? row.sceneId : row.ownerSceneId, kind, recordId,
      assetHashes: Object.keys(project.assets).sort(), sourceHashes: [...projectSourceRecords(project).keys()].sort(), licenseHashes: Object.keys(project.licenses).sort(), licenseBindings: project.licenseBindings })
  }
  transformed.projects.forEach(row => bind(row, 'current', 'current'))
  transformed.automaticSnapshots.forEach(row => bind(row, 'automatic', String(row.revision)))
  transformed.snapshots.forEach(row => bind(row, String(row.kind), String(row.id)))
  transformed.importedSnapshots.forEach(row => bind(row, 'imported-auto', String(row.id)))
  for (const head of transformed.historyHeads) {
    const graph = captureHistoryGraph({ head, versions: transformed.historyVersions.filter(row => row.ownerSceneId === head.ownerSceneId), pins: transformed.historyPins.filter(row => row.ownerSceneId === head.ownerSceneId) })
    const byHash = new Map([...historyGraphProjects(graph)].map(project => [projectContentHash(project), project]))
    for (const pin of graph.pins) if (!transformed.resourceBindings.some(row => row.ownerSceneId === pin.ownerSceneId && row.kind === pin.kind && row.recordId === pin.id)) bind({ ownerSceneId: pin.ownerSceneId, project: byHash.get(pin.contentHash) }, pin.kind, pin.id)
  }
  for (const project of allProjects) {
    for (const license of Object.values(project.licenses)) if (!asRows(source.projects, 'licenseTexts').some(row => equal(row, license))) throw new Error('旧历史许可实际正文缺失。')
    checkCancelled(options.validation.signal); await validateProjectBundle({ project, resources }, options.validation) }

  const entries: StoredEntry[] = []
  for (const row of asRows(source.library, 'entries')) {
    const old = captureLibraryEntry(row.entry as Parameters<typeof captureLibraryEntry>[0]), item = validateCatalogItem(old.item)
    if (row.key !== item.identity.key || row.logicalKey !== item.identity.logicalKey) throw new Error('旧个人素材精确身份不一致。')
    const capsule = await readDevelopmentCapsule(old.capsule, options.validation), next = await prepareLibraryEntry(capsule, item.selector, options.validation)
    if (next.item.identity.key !== item.identity.key) throw new Error('个人素材固定身份在归一时发生变化；迁入已停止。')
    entries.push({ key: row.key, logicalKey: row.logicalKey, entry: next })
  }
  const orgs = asRows(source.library, 'organizations')
  // The middleware writes manifests and their exact immutable block closure in
  // this same transaction. Include those derived bytes in the strict installer,
  // and compare native cold rows against their physical storage representation.
  const expectedPhysical = physicalProjectRows(transformed)
  transformed[CONTENT_BLOCK_STORE] = expectedPhysical[CONTENT_BLOCK_STORE]
  try {
    await projectDb.open(); await libraryDb.open()
    await projectDb.transaction('rw', PROJECT_TABLES, async () => { for (const name of PROJECT_TABLES) await installExactRows(projectDb.table<Row>(name), transformed[name]) })
    await libraryDb.transaction('rw', LIBRARY_TABLES, async () => {
      await installExactRows(libraryDb.table<Row>('entries'), entries as unknown as Row[])
      await installExactRows(libraryDb.table<Row>('organizations'), orgs)
      await installExactRows(libraryDb.table<Row>('metadata'), asRows(source.library, 'metadata'))
    })
    projectDb.close(); libraryDb.close()
    await verifyColdTarget(target, options)
    // Cold reads may initialize independent history roots for pre-graph sources.
    // They must still retain every installed source row; enumerating only the
    // remaining owners would otherwise overlook a whole deleted project scope.
    await assertCopiedRows(target, expectedPhysical, entries as unknown as Row[], orgs, asRows(source.library, 'metadata'), options)
    const verifiedTargetFingerprint = await targetFingerprint(target, options)
    checkCancelled(options.validation.signal)
    // The durable ready journal precedes the single synchronous pair-pointer write.
    // A crash at either boundary can retry by cold-reading without rebuilding adopted data.
    await preservation.table('state').put({ ...journal, stage: 'verified', target, targetFingerprint: verifiedTargetFingerprint })
    const finalSource = await capture(options)
    if (finalSource.sourceFingerprint !== source.sourceFingerprint || storage.getItem(CURRENT_DATABASE_SELECTION_KEY) !== selectedBefore) throw new Error('来源或当前存储选择已变化，暂存结果没有发布。')
    checkCancelled(options.validation.signal)
    if (storage.getItem(CURRENT_DATABASE_SELECTION_KEY) !== selectedBefore) throw new Error('当前存储选择已变化，未发布。')
    storage.setItem(CURRENT_DATABASE_SELECTION_KEY, JSON.stringify(target))
    return preview(source)
  } finally { projectDb.close(); libraryDb.close() }
  } finally { preservation.close() }
}

async function targetFingerprint(target: CurrentDatabaseNames, options: DevelopmentImportOptions): Promise<string> {
  const [projects, library] = await Promise.all([captureDatabase(target.projects, 'projects', options.validation.signal), captureDatabase(target.library, 'library', options.validation.signal)])
  return digest([target, databaseFingerprint(projects), databaseFingerprint(library)])
}

/** Derive only the current schema's physical representation from already
 * validated complete rows. No source or target self-reported blocks are trusted. */
function physicalProjectRows(expected: Record<string, Row[]>): Record<string, Row[]> {
  const blocks = new Map<string, ProjectContentBlock>()
  const physical = Object.fromEntries(PROJECT_TABLES.map(table => [table, expected[table].map(row => {
    const field = CONTENT_PAYLOAD_FIELDS[table]
    if (!field || row[field] === null) return row
    const partition = partitionProjectContent(row[field] as ProjectData)
    for (const block of partition.blocks) blocks.set(block.sha256, block)
    return { ...row, [field]: partition.manifest }
  })]))
  physical[CONTENT_BLOCK_STORE] = [...blocks.values()] as unknown as Row[]
  return physical
}

async function assertCopiedRows(target: CurrentDatabaseNames, expected: Record<string, Row[]>, entries: Row[], organizations: Row[], metadata: Row[], options: DevelopmentImportOptions) {
  const [projects, library] = await Promise.all([captureDatabase(target.projects, 'projects', options.validation.signal), captureDatabase(target.library, 'library', options.validation.signal)])
  const assertRows = (actual: Row[], required: Row[], allowAdditional = false) => {
    const remaining = new Map(actual.map(row => [rowFingerprint(row), row]))
    for (const row of required) if (!remaining.delete(rowFingerprint(row))) throw new Error('迁入目标缺少已安装记录或内容已变化，未发布。')
    if (!allowAdditional && remaining.size) throw new Error('迁入目标含额外记录，未发布。')
  }
  const historyMayInitialize = new Set(['historyHeads', 'historyVersions', 'historyPins', 'resourceBindings'])
  for (const table of PROJECT_TABLES) {
    if (table === 'storageState') continue // Repository-owned epoch advances while initializing history.
    assertRows(asRows(projects, table), expected[table], historyMayInitialize.has(table))
  }
  assertRows(asRows(library, 'entries'), entries)
  assertRows(asRows(library, 'organizations'), organizations)
  assertRows(asRows(library, 'metadata'), metadata)
}

async function installExactRows(table: import('dexie').Table<Row>, expected: Row[]) {
  const keyPath = table.schema.primKey.keyPath
  const getKey = (row: Row) => Array.isArray(keyPath) ? keyPath.map(key => row[key]) : row[keyPath!] as import('dexie').IndexableType
  const existing = await table.toArray(), remaining = new Map(existing.map(row => [canonicalJson(getKey(row)), row]))
  for (const row of expected) {
    const key = canonicalJson(getKey(row)), prior = remaining.get(key)
    if (prior && rowFingerprint(prior) !== rowFingerprint(row)) throw new Error('目标迁入行已有不同成果，保留且不覆盖。')
    if (!prior) await table.add(row)
    remaining.delete(key)
  }
  if (remaining.size) throw new Error('目标迁入表已有额外成果，保留且不覆盖。')
}

function preview(source: Awaited<ReturnType<typeof capture>>): DevelopmentImportPreview {
  return { sourceFingerprint: source.sourceFingerprint, projectCount: asRows(source.projects, 'projects').length,
    historyVersionCount: asRows(source.projects, 'historyVersions').length, libraryEntryCount: asRows(source.library, 'entries').length, target: targetNames(source.sourceFingerprint) }
}
async function verifyColdTarget(target: CurrentDatabaseNames, options: DevelopmentImportOptions) {
  const runtime = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => new Date().toISOString() } }
  const projects = new ProjectRepository({ name: target.projects, runtime, validation: options.validation })
  const library = new LibraryRepository({ name: target.library, runtime, validation: options.validation })
  try {
    for (const summary of await projects.list()) {
      checkCancelled(options.validation.signal)
      if (!await projects.load(summary.sceneId, options.validation)) throw new Error('目标工程冷读缺失。')
      const overview = await projects.historyOverview(summary.sceneId)
      assertStoredUsage(await projects.usage(summary.sceneId))
      for (const row of overview.history.versions) { checkCancelled(options.validation.signal); await projects.loadHistoryVersion(summary.sceneId, row.id, options.validation) }
      for (const row of overview.snapshots) await projects.loadSnapshot(summary.sceneId, row.id, options.validation)
    }
    // Includes unused resources/originals and all retained table scopes, even
    // when the source has no current project. Reads never imply budget approval.
    assertStoredUsage(await projects.usage('development-import-budget-audit'))
    const snapshot = await library.read()
    for (const row of snapshot.entries) { checkCancelled(options.validation.signal); await library.load(row.item.identity.key, options.validation) }
  } finally { projects.close(); library.close() }
}
function assertStoredUsage(usage: Awaited<ReturnType<ProjectRepository['usage']>>) {
  if (usage.resourceBytes > PROJECT_STORAGE_LIMITS.resourceBytes || usage.documentBytes > PROJECT_STORAGE_LIMITS.documentBytes || usage.legacyBytes > PROJECT_STORAGE_LIMITS.legacyBytes
    || usage.namedCount > PROJECT_STORAGE_LIMITS.named || usage.protectionCount > PROJECT_STORAGE_LIMITS.protection || usage.importedCount > PROJECT_STORAGE_LIMITS.imported) throw new Error('迁入目标超过完整工程存储或历史保护预算，未发布。')
}
