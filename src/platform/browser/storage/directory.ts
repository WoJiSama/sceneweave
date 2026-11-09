import type { HistoryDirectory, ProjectDirectoryEntry, ProjectDirectoryPage, ProjectDirectoryQuery } from '../../../application/ports/project-directory.js'
import type { HistoryVersionSummary } from '../../../application/ports/project-store.js'
import type { SnapshotSummary } from '../../../shared/model/project.js'
import { validateSnapshotSummary } from '../../../shared/project/history.js'
import { parseBoundedJson } from '../../../shared/project/json.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { captureJson } from '../../../shared/validation/json.js'
import { nativeSceneSchema } from '../../../shared/validation/scene.js'
import { checkedContentBlock, isProjectBlockManifest, validateProjectBlockManifest } from './content-blocks.js'
import { captureHistoryHeadEnvelope, captureHistoryPinEnvelope } from './incremental-history.js'
import type { ProjectDatabase } from './database.js'

const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '__proto__'
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const time = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('目录记录须为普通数据对象。')
  return value as Record<string, any>
}
function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  const row = record(value)
  if (Reflect.ownKeys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw new Error('目录记录字段缺失或未知。')
  return row
}
const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure)
function ownerKey(key: IDBValidKey, owner: string, id: string): void {
  if (!Array.isArray(key) || key.length !== 2 || key[0] !== owner || key[1] !== id) throw new Error('历史目录主键与记录身份不符。')
}
const currentFields = ['sceneId', 'revision', 'savedAt', 'contentHash', 'status', 'conversionJobId', 'project']
function currentEnvelope(value: unknown, owner?: string) {
  const row = exact(value, currentFields)
  if (!identifier(row.sceneId) || owner !== undefined && row.sceneId !== owner || !integer(row.revision) || !time(row.savedAt) || !hash(row.contentHash)
    || !['ready', 'preparing'].includes(row.status) || row.conversionJobId !== null && !identifier(row.conversionJobId)
    || row.status === 'preparing' && row.conversionJobId === null) throw new Error('工程目录身份、修订或发布状态损坏。')
  if (isProjectBlockManifest(row.project)) {
    if (validateProjectBlockManifest(row.project).contentHash !== row.contentHash) throw new Error('工程目录与内容清单摘要不符。')
  } else {
    const project = record(row.project), document = record(project.document)
    if (project.format !== 'sceneweave-complete-project' || project.schemaVersion !== 1 || document.sceneId !== row.sceneId || document.revision !== row.revision) throw new Error('工程目录与内联内容身份不符。')
  }
  return row
}

const titleSchema = nativeSceneSchema.shape.title
/** Read only the actual title block; this does not validate the other blocks. */
async function titleOf(database: ProjectDatabase, project: unknown): Promise<string> {
  let title: unknown
  if (isProjectBlockManifest(project)) {
    const manifest = validateProjectBlockManifest(project), field = manifest.fields.find(value => value.path.length === 2 && value.path[0] === 'document' && value.path[1] === 'title')
    if (!field || field.mode !== 'value' || field.blocks.length !== 1) throw new Error('工程目录缺少唯一标题。')
    const ref = field.blocks[0]
    if (ref.byteLength > PACKAGE_LIMITS.sceneBytes) throw new Error('工程目录标题超过场景JSON保护值。')
    const block = checkedContentBlock(await database.projectContentBlocks.get(ref.sha256), ref)
    if (block.bytes.length !== ref.byteLength) throw new Error('工程目录标题块长度不符。')
    title = parseBoundedJson(block.bytes)
  } else title = record(record(project).document).title
  const checked = titleSchema.safeParse(title)
  if (!checked.success) throw new Error('工程目录标题无效。')
  return checked.data
}
const keyOf = (entry: ProjectDirectoryEntry) => ({ savedAt: entry.summary?.savedAt ?? '', sceneId: entry.sceneId })
const compare = (a: { savedAt: string; sceneId: string }, b: { savedAt: string; sceneId: string }) => b.savedAt.localeCompare(a.savedAt) || a.sceneId.localeCompare(b.sceneId)

/** Stable saved-at/ID cursor; search covers metadata, never materialized maps. */
export async function readProjectDirectory(database: ProjectDatabase, input: ProjectDirectoryQuery = {}): Promise<ProjectDirectoryPage> {
  const query = captureJson(input), limit = query.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || query.query !== undefined && (typeof query.query !== 'string' || query.query.length > 1024)
    || query.after !== undefined && (!identifier(query.after.sceneId) || query.after.savedAt !== '' && !time(query.after.savedAt))) throw new Error('工程目录分页或搜索参数无效。')
  const search = (query.query ?? '').trim().toLocaleLowerCase(), entries: ProjectDirectoryEntry[] = []
  for (const item of await database.rawJsonRows('projects')) {
    const sceneId = typeof item.key === 'string' ? item.key : JSON.stringify(item.key)
    try {
      const row = currentEnvelope(item.value, sceneId)
      if (row.status === 'preparing') continue
      const title = await titleOf(database, row.project)
      if (search && !`${title} ${sceneId}`.toLocaleLowerCase().includes(search)) continue
      entries.push({ sceneId, summary: { sceneId, title, revision: row.revision, savedAt: row.savedAt, conversionJobId: row.conversionJobId }, issue: null, contentStatus: 'not-checked' })
    } catch (failure) {
      // Bad entries remain visible even during text search: an unreadable title
      // cannot establish that the user's requested project does not match.
      entries.push({ sceneId, summary: null, issue: message(failure), contentStatus: 'not-checked' })
    }
  }
  entries.sort((a, b) => compare(keyOf(a), keyOf(b)))
  const remaining = query.after ? entries.filter(entry => compare(keyOf(entry), query.after!) > 0) : entries
  const page = remaining.slice(0, limit)
  return { entries: page, next: remaining.length > limit ? keyOf(page.at(-1)!) : null, total: entries.length }
}

function versionSummary(input: unknown, owner: string): HistoryVersionSummary {
  const row = exact(input, ['format', 'version', 'ownerSceneId', 'id', 'revision', 'savedAt', 'contentHash', 'parentId', 'parentHash', 'checkpoint', 'delta', 'depth', 'chainBytes', 'automatic', 'recordHash'])
  if (row.format !== 'sceneweave-history-version' || row.version !== 1 || row.ownerSceneId !== owner || !identifier(row.id) || !integer(row.revision)
    || !time(row.savedAt) || !hash(row.contentHash) || !hash(row.recordHash) || typeof row.automatic !== 'boolean'
    || row.parentId !== null && !identifier(row.parentId) || row.parentHash !== null && !hash(row.parentHash)
    || (row.parentId === null) !== (row.parentHash === null) || row.parentId === row.id || !integer(row.depth) || row.depth >= 4
    || !integer(row.chainBytes) || (row.checkpoint === null) === (row.delta === null)) throw new Error('历史目录版本身份、父引用或类型损坏。')
  if (row.checkpoint !== null) {
    if (row.depth !== 0 || row.chainBytes !== 0) throw new Error('历史目录检查点层级损坏。')
    if (isProjectBlockManifest(row.checkpoint)) {
      if (validateProjectBlockManifest(row.checkpoint).contentHash !== row.contentHash) throw new Error('历史目录检查点与清单摘要不符。')
    } else if (record(record(row.checkpoint).document).revision !== row.revision) throw new Error('历史目录内联检查点修订不符。')
  } else if (!row.parentId || row.depth === 0) throw new Error('历史目录差异缺少父引用。')
  // recordHash and delta/checkpoint contents are intentionally not certified.
  return { id: row.id, ownerSceneId: owner, revision: row.revision, savedAt: row.savedAt, contentHash: row.contentHash,
    parentId: row.parentId, checkpoint: row.checkpoint !== null, automatic: row.automatic }
}
function legacySnapshot(value: unknown, owner: string): SnapshotSummary {
  const row = record(value), { project: _project, ...summary } = row
  const checked = validateSnapshotSummary(summary)
  if (checked.ownerSceneId !== owner) throw new Error('历史目录快照归属不符。')
  return checked
}

export async function readHistoryDirectory(database: ProjectDatabase, owner: string): Promise<HistoryDirectory> {
  if (!identifier(owner)) throw new Error('历史目录工程ID无效。')
  const current = currentEnvelope(await database.rawJsonRecord('projects', owner), owner)
  if (current.status !== 'ready') throw new Error('工程尚未完成转换。')
  const metadata = exact(await database.historyMetadata.get(owner), ['ownerSceneId', 'metadataVersion'])
  if (metadata.ownerSceneId !== owner || !integer(metadata.metadataVersion)) throw new Error('历史目录元数据损坏。')
  const headValue = await database.historyHeads.get(owner), head = headValue && captureHistoryHeadEnvelope(headValue, owner)
  if (head && (head.status !== 'ready' || head.savedRevision !== current.revision || head.contentHash !== current.contentHash)) throw new Error('当前保存与历史目录活动版本不一致。')
  const result: HistoryDirectory = { contentStatus: 'not-checked', metadataVersion: metadata.metadataVersion, historyState: head ? 'ready' : 'legacy',
    snapshots: [], history: { activeVersionId: head?.activeVersionId ?? null, versions: [] }, issues: [] }
  const query = { index: 'ownerSceneId', key: owner }
  if (head) {
    for (const item of await database.rawJsonRows('historyVersions', query)) {
      try { const summary = versionSummary(item.value, owner); ownerKey(item.key, owner, summary.id); result.history.versions.push(summary) }
      catch (failure) { result.issues.push({ key: JSON.stringify(item.key), message: message(failure) }) }
    }
    const versions = new Map(result.history.versions.map(row => [row.id, row]))
    for (const row of versions.values()) if (row.parentId !== null) {
      const parent = versions.get(row.parentId)
      if (!parent || parent.revision >= row.revision) result.issues.push({ key: row.id, message: '父版本目录缺失、不可读或修订顺序损坏。' })
    }
    const active = versions.get(head.activeVersionId)
    if (!active || active.revision !== head.savedRevision || active.contentHash !== head.contentHash || !active.automatic) result.issues.push({ key: head.activeVersionId, message: '活动版本目录缺失或与当前保存不符。' })
    for (const item of await database.rawJsonRows('historyPins', query)) {
      try {
        const pin = captureHistoryPinEnvelope(item.value, owner), version = versions.get(pin.versionId)
        ownerKey(item.key, owner, pin.id)
        if (!version || version.revision !== pin.sourceRevision || version.contentHash !== pin.contentHash) throw new Error('快照目录引用缺失或与版本不符。')
        const { format: _format, version: _version, versionId: _versionId, recordHash: _hash, ...summary } = pin
        result.snapshots.push(summary)
      } catch (failure) { result.issues.push({ key: JSON.stringify(item.key), message: message(failure) }) }
    }
  } else {
    for (const table of ['snapshots', 'importedSnapshots']) for (const item of await database.rawJsonRows(table, query)) {
      try { const summary = legacySnapshot(item.value, owner); ownerKey(item.key, owner, summary.id); result.snapshots.push(summary) }
      catch (failure) { result.issues.push({ key: JSON.stringify(item.key), message: message(failure) }) }
    }
  }
  result.history.versions.sort((a, b) => b.revision - a.revision || a.id.localeCompare(b.id))
  result.snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  return result
}
