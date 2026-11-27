import Dexie, { type Collection, type Table } from 'dexie'
import { readImageWorkPackage, IMAGE_WORK_LIMITS, type ImageWorkPackage } from '../../../shared/image-import/workflow.js'
import { captureBytes } from '../../../shared/project/binary.js'
import { checkCancelled, ImageCapabilityError, type CancellationSignal, type ImageProcessingPort } from '../../../shared/ports/resources.js'
import { createBrowserImagePort } from '../images/adapter.js'
import { assembleDraftArchive, draftArchiveSizes, splitDraftArchive, type DraftArchive } from '../../../shared/image-import/work-archive-storage.js'

export const IMAGE_WORKFLOW_DATABASE = 'sceneweave-image-workflows'
export const IMAGE_WORK_STORAGE_LIMITS = Object.freeze({ drafts: 64, bytes: 256 * 1024 * 1024 })
const draftPageSize = 12
interface DraftImage { sha256: string; bytes: Blob }
interface StoredWork {
  id: string
  revision: number
  updatedAt: number
  package?: Uint8Array
  archive?: DraftArchive
  title?: string
  nextAction?: string
}

export interface ImageDraftUsage {
  drafts: number
  legacyDrafts: number
  draftBytes: number
  sharedImageBytes: number
  bytes: number
  lastChange?: { action: 'save' | 'remove' | 'compact'; bytes: number }
}

const lastChanges = new Map<string, NonNullable<ImageDraftUsage['lastChange']>>()
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && !a.some((byte, index) => byte !== b[index])
const legacyStores = { entries: 'id,revision,updatedAt' }

export interface LocalImageDraft {
  id: string
  revision: number
  updatedAt: number
  byteLength: number
  title?: string
  nextAction?: string
}

export interface LocalImageDraftPage {
  drafts: LocalImageDraft[]
  total: number
  nextOffset: number | null
}

function storedByteLength(record: StoredWork): number {
  if (record.archive !== undefined && record.package === undefined) return draftArchiveSizes(record.archive).packageBytes
  if (record.archive !== undefined) throw new Error('本机制作草稿的存储表示损坏。')
  if (!(record.package instanceof Uint8Array) || !record.package.byteLength) throw new Error('本机制作草稿的工作包字节损坏。')
  return record.package.byteLength
}

function localDraft(record: StoredWork): LocalImageDraft {
  return { id: record.id, revision: record.revision, updatedAt: record.updatedAt, byteLength: storedByteLength(record),
    title: record.title, nextAction: record.nextAction }
}

async function scanDrafts(rows: Collection<StoredWork, string>, inspect: (row: StoredWork) => void): Promise<void> {
  // Reject from the transaction body since Dexie wraps cursor callbacks.
  let failed = false, failure: unknown
  await rows.until(() => failed).each(row => {
    try { inspect(row) }
    catch (error) { failed = true; failure = error }
  })
  if (failed) throw failure
}

class WorkDatabase extends Dexie {
  entries!: Table<StoredWork, string>
  images!: Table<DraftImage, string>
  constructor(name: string) {
    super(name, { autoOpen: false })
    this.version(1).stores(legacyStores)
    this.version(2).stores({ ...legacyStores, images: 'sha256' })
  }
}

/** Inspect without creating or upgrading a database with an unrelated meaning. */
function inspectDatabase(name: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false, settled = false
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error) } }
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort() }
    request.onerror = () => {
      if (absent && request.error?.name === 'AbortError') { settled = true; resolve(false) }
      else fail(request.error ?? new Error('无法检查图片工作数据库。'))
    }
    request.onblocked = () => fail(new Error('图片工作数据库被其他连接阻塞。'))
    request.onsuccess = () => {
      const db = request.result
      try {
        if (settled) return
        const expected = db.version === 10 ? 'entries' : db.version === 20 ? 'entries,images' : undefined
        if ([...db.objectStoreNames].join() !== expected) throw new Error('不支持的图片工作数据库结构，原数据保持。')
        const store = db.transaction('entries', 'readonly').objectStore('entries')
        if (store.autoIncrement || store.keyPath !== 'id' || [...store.indexNames].sort().join() !== 'revision,updatedAt') throw new Error('图片工作数据库表结构不同，原数据保持。')
        for (const name of ['revision', 'updatedAt']) {
          const index = store.index(name)
          if (index.keyPath !== name || index.unique || index.multiEntry) throw new Error('图片工作数据库索引不同，原数据保持。')
        }
        if (db.version === 20) {
          const images = db.transaction('images', 'readonly').objectStore('images')
          if (images.autoIncrement || images.keyPath !== 'sha256' || images.indexNames.length) throw new Error('图片工作数据库图像表结构不同，原数据保持。')
        }
        settled = true; resolve(true)
      } catch (error) { fail(error) } finally { db.close() }
    }
  })
}

/** Platform publication boundary: metadata and ZIP integrity alone cannot certify real image pixels. */
export async function readBrowserImageWorkPackage(bytes: Uint8Array, signal?: CancellationSignal,
  images: ImageProcessingPort = createBrowserImagePort()): Promise<ImageWorkPackage> {
  const work = await readImageWorkPackage(bytes, signal)
  checkCancelled(signal)
  if (!images.normalizeImport) throw new ImageCapabilityError()
  const original = await images.normalizeImport(work.original, work.state.original.mimeType, { signal })
  checkCancelled(signal)
  const source = await images.decode(original.bytes, original.record, { signal })
  checkCancelled(signal)
  const normalized = await images.decode(work.normalized, { sha256: work.state.image.sha256, mimeType: 'image/png',
    sizeBytes: work.normalized.length, pixelWidth: work.state.image.pixelWidth, pixelHeight: work.state.image.pixelHeight }, { signal })
  checkCancelled(signal)
  if (source.width !== work.state.image.pixelWidth || source.height !== work.state.image.pixelHeight || normalized.width !== source.width
    || normalized.height !== source.height || source.rgba.length !== source.width * source.height * 4
    || normalized.rgba.length !== source.rgba.length || source.rgba.some((channel, index) => channel !== normalized.rgba[index])) {
    throw new Error('工作包规范化图片与原始图片的实际像素不一致。')
  }
  return work
}

export class ImageWorkflowConflictError extends Error {
  readonly code = 'image-workflow-conflict'
  constructor() { super('图片工作已在其他窗口变化；当前成果保留，请导出副本或重新打开后继续。'); this.name = 'ImageWorkflowConflictError' }
}

/** Separate authoring repository. It never opens project/library databases and never deletes work automatically. */
export class ImageWorkflowStore {
  readonly database: WorkDatabase
  private readonly images: ImageProcessingPort
  constructor(options: { name?: string; images?: ImageProcessingPort } = {}) {
    const name = options.name ?? IMAGE_WORKFLOW_DATABASE
    if (name !== IMAGE_WORKFLOW_DATABASE && !name.startsWith(IMAGE_WORKFLOW_DATABASE + '-')) throw new Error('图片工作只能使用独立数据库名称。')
    this.database = new WorkDatabase(name)
    this.images = options.images ?? createBrowserImagePort()
  }
  private async open(create = true): Promise<boolean> {
    if (this.database.isOpen()) return true
    if (!await inspectDatabase(this.database.name) && !create) return false
    await this.database.open()
    return true
  }
  private async usageInTransaction(signal?: CancellationSignal): Promise<ImageDraftUsage> {
    const { entries, images } = this.database
    const usage: ImageDraftUsage = { drafts: 0, legacyDrafts: 0, draftBytes: 0, sharedImageBytes: 0, bytes: 0 }
    const expectedImages = new Map<string, number>()
    await scanDrafts(entries.toCollection(), row => {
      checkCancelled(signal)
      usage.drafts++
      const packageBytes = storedByteLength(row)
      if (!row.archive) { usage.legacyDrafts++; usage.draftBytes += packageBytes; return }
      usage.draftBytes += draftArchiveSizes(row.archive).draftBytes
      for (const ref of row.archive.images) {
        if (expectedImages.has(ref.sha256) && expectedImages.get(ref.sha256) !== ref.byteLength) throw new Error('图片工作数据库的图像长度不一致。')
        expectedImages.set(ref.sha256, ref.byteLength)
      }
    })
    for (const key of await images.toCollection().primaryKeys()) {
      checkCancelled(signal)
      const row = await images.get(key)
      const expected = expectedImages.get(key)
      if (!row || row.sha256 !== key || !(row.bytes instanceof Blob) || !row.bytes.size
        || expected !== undefined && row.bytes.size !== expected) throw new Error('图片工作数据库的图像长度不一致。')
      usage.sharedImageBytes += row.bytes.size
      expectedImages.delete(key)
    }
    if (expectedImages.size) throw new Error('图片工作数据库缺少图像。')
    usage.bytes = usage.draftBytes + usage.sharedImageBytes
    return usage
  }
  async usage(): Promise<ImageDraftUsage> {
    if (!await this.open(false)) return { drafts: 0, legacyDrafts: 0, draftBytes: 0, sharedImageBytes: 0, bytes: 0 }
    const usage = await this.database.transaction('r', this.database.entries, this.database.images, () => this.usageInTransaction())
    return { ...usage, lastChange: lastChanges.get(this.database.name) }
  }
  private async releaseImages(row: StoredWork | undefined, retained?: ReadonlyMap<string, Uint8Array>): Promise<number> {
    if (!row?.archive) return 0
    const { entries, images } = this.database
    const released = new Set(row.archive.images.map(ref => ref.sha256).filter(key => !retained?.has(key)))
    if (!released.size) return 0
    await scanDrafts(entries.toCollection(), current => {
      if (current.archive) for (const ref of current.archive.images) released.delete(ref.sha256)
    })
    const keys = [...released]
    const previous = await images.bulkGet(keys)
    await images.bulkDelete(keys)
    return previous.reduce((total, image) => total + (image?.bytes instanceof Blob ? image.bytes.size : 0), 0)
  }
  private async storeArchive(record: StoredWork, split: ReturnType<typeof splitDraftArchive>, bytes: Uint8Array, signal?: CancellationSignal) {
    const { entries, images } = this.database
    let addedBytes = draftArchiveSizes(split.archive).draftBytes
    for (const [key, image] of split.images) {
      checkCancelled(signal)
      if (await images.get(key)) continue
      await images.add({ sha256: key, bytes: new Blob([Uint8Array.from(image)]) })
      addedBytes += image.byteLength
    }
    await entries.put({ ...record, archive: split.archive })
    checkCancelled(signal)
    const saved = await entries.get(record.id)
    if (!saved?.archive || saved.revision !== record.revision || saved.updatedAt !== record.updatedAt
      || !sameBytes(await this.storedArchive(saved), bytes)) throw new Error('图片工作写后读取不一致，保存未发布。')
    checkCancelled(signal)
    return addedBytes
  }
  private async storedArchive(record: StoredWork): Promise<Uint8Array> {
    storedByteLength(record)
    if (!record.archive) return record.package!
    const archive = record.archive
    const keys = [...new Set(archive.images.map(ref => ref.sha256))]
    const rows = await this.database.images.bulkGet(keys)
    const read = async () => {
      const pairs = await Promise.all(keys.map(async (key, index): Promise<[string, Uint8Array]> => {
        const row = rows[index]
        if (!row || row.sha256 !== key || !(row.bytes instanceof Blob)) throw new Error('本机制作草稿的共享图像缺失或损坏。')
        return [key, new Uint8Array(await row.bytes.arrayBuffer())]
      }))
      return assembleDraftArchive(archive, new Map(pairs))
    }
    return Dexie.currentTransaction ? Dexie.waitFor(read()) : read()
  }
  async save(input: Uint8Array, expectedRevision: number | null, signal?: CancellationSignal): Promise<{ id: string; revision: number; storageDeltaBytes: number }> {
    checkCancelled(signal)
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error('图片工作基线版本无效。')
    const bytes = captureBytes(input, IMAGE_WORK_LIMITS.packageBytes)
    const work = await readBrowserImageWorkPackage(bytes, signal, this.images)
    const split = splitDraftArchive(bytes, signal)
    checkCancelled(signal)
    await this.open()
    const { entries, images } = this.database
    const result = await this.database.transaction('rw', entries, images, async () => {
      checkCancelled(signal)
      const current = await entries.get(work.state.id)
      if (current ? current.revision !== expectedRevision : expectedRevision !== null) throw new ImageWorkflowConflictError()
      if (current && work.state.revision <= current.revision) throw new ImageWorkflowConflictError()
      const full = () => new Error(`本次保存会超过本机制作草稿的累计上限（${IMAGE_WORK_STORAGE_LIMITS.drafts} 份或 ${IMAGE_WORK_STORAGE_LIMITS.bytes / 1024 ** 2} MiB）。可在「本机制作草稿」中整理旧草稿或移除已备份的草稿。`)
      if (!current && await entries.count() >= IMAGE_WORK_STORAGE_LIMITS.drafts) throw full()
      const before = await this.usageInTransaction(signal)
      const previous = await entries.orderBy('updatedAt').last()
      const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
      if (!Number.isSafeInteger(updatedAt)) throw new Error('图片工作保存次序超出范围。')
      const added = await this.storeArchive({ id: work.state.id, revision: work.state.revision, updatedAt,
        title: work.state.draft.title, nextAction: work.state.nextAction }, split, bytes, signal)
      const released = await this.releaseImages(current, split.images)
      const oldDraftBytes = current?.archive ? draftArchiveSizes(current.archive).draftBytes : current?.package?.byteLength ?? 0
      const storageDeltaBytes = added - released - oldDraftBytes
      if (before.bytes + storageDeltaBytes > IMAGE_WORK_STORAGE_LIMITS.bytes && (!current || storageDeltaBytes > 0)) throw full()
      checkCancelled(signal)
      return { id: work.state.id, revision: work.state.revision, storageDeltaBytes }
    })
    lastChanges.set(this.database.name, { action: 'save', bytes: result.storageDeltaBytes })
    return result
  }
  async loadLatest(signal?: CancellationSignal): Promise<ImageWorkPackage | null> {
    checkCancelled(signal)
    await this.open()
    const { entries, images } = this.database
    const saved = await this.database.transaction('r', entries, images, async () => {
      const record = await entries.orderBy('updatedAt').last()
      return record && { record, bytes: await this.storedArchive(record) }
    })
    checkCancelled(signal)
    return saved ? this.readStoredWork(saved.record, saved.bytes, signal) : null
  }
  async listLocalDrafts(offset = 0): Promise<LocalImageDraftPage> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('本机制作草稿页码无效。')
    await this.open()
    const { entries } = this.database
    return this.database.transaction('r', entries, async () => {
      const total = await entries.count(), drafts: LocalImageDraft[] = []
      await scanDrafts(entries.orderBy('updatedAt').reverse().offset(offset).limit(draftPageSize), row => { drafts.push(localDraft(row)) })
      return { drafts, total, nextOffset: drafts.length > 0 && offset + drafts.length < total ? offset + drafts.length : null }
    })
  }
  private async readDraft(reference: LocalImageDraft): Promise<StoredWork> {
    const row = await this.database.entries.get(reference.id)
    if (!row || row.revision !== reference.revision || row.updatedAt !== reference.updatedAt || storedByteLength(row) !== reference.byteLength) {
      throw new ImageWorkflowConflictError()
    }
    return row
  }
  async loadLocalDraft(reference: LocalImageDraft, signal?: CancellationSignal): Promise<{ work: ImageWorkPackage; bytes: Uint8Array }> {
    checkCancelled(signal)
    await this.open()
    const { entries, images } = this.database
    const { record, bytes } = await this.database.transaction('r', entries, images, async () => {
      const record = await this.readDraft(reference)
      return { record, bytes: await this.storedArchive(record) }
    })
    return { work: await this.readStoredWork(record, bytes, signal), bytes }
  }
  async removeLocalDraft(reference: LocalImageDraft): Promise<void> {
    await this.open()
    const { entries, images } = this.database
    const bytes = await this.database.transaction('rw', entries, images, async () => {
      const record = await this.readDraft(reference)
      const draftBytes = record.archive ? draftArchiveSizes(record.archive).draftBytes : record.package!.byteLength
      await entries.delete(record.id)
      return -(draftBytes + await this.releaseImages(record))
    })
    lastChanges.set(this.database.name, { action: 'remove', bytes })
  }
  async compactLegacyDrafts(signal?: CancellationSignal): Promise<{ drafts: number; bytesFreed: number; skipped: number }> {
    const result = { drafts: 0, bytesFreed: 0, skipped: 0 }
    if (!await this.open(false)) return result
    const { entries, images } = this.database
    for (const key of await entries.toCollection().primaryKeys()) {
      checkCancelled(signal)
      const old = await entries.get(key)
      if (!old || old.archive) continue
      const bytes = old.package
      try {
        if (!(bytes instanceof Uint8Array)) throw new Error('制作草稿缺少工作包。')
        await this.readStoredWork(old, bytes, signal)
        const split = splitDraftArchive(bytes, signal)
        const delta = await this.database.transaction('rw', entries, images, async () => {
          const current = await entries.get(key)
          if (!current?.package || current.archive || current.revision !== old.revision || current.updatedAt !== old.updatedAt
            || !sameBytes(current.package, bytes)) throw new ImageWorkflowConflictError()
          const { package: _legacy, ...metadata } = current
          const added = await this.storeArchive(metadata, split, bytes, signal)
          checkCancelled(signal)
          return bytes.length - added
        })
        result.drafts++
        result.bytesFreed += delta
        lastChanges.set(this.database.name, { action: 'compact', bytes: -result.bytesFreed })
      } catch {
        checkCancelled(signal)
        result.skipped++
      }
    }
    return result
  }
  private async readStoredWork(record: StoredWork, bytes: Uint8Array, signal?: CancellationSignal): Promise<ImageWorkPackage> {
    const work = await readBrowserImageWorkPackage(bytes, signal, this.images)
    if (record.id !== work.state.id || record.revision !== work.state.revision) throw new Error('图片工作数据库记录与工作包身份不一致。')
    return work
  }
  close(): void { this.database.close() }
}
