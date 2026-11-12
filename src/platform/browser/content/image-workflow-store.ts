import Dexie, { type Table } from 'dexie'
import { readImageWorkPackage, IMAGE_WORK_LIMITS, type ImageWorkPackage } from '../../../shared/image-import/workflow.js'
import { captureBytes } from '../../../shared/project/binary.js'
import { checkCancelled, ImageCapabilityError, type CancellationSignal, type ImageProcessingPort } from '../../../shared/ports/resources.js'
import { createBrowserImagePort } from '../images/adapter.js'

export const IMAGE_WORKFLOW_DATABASE = 'sceneweave-image-workflows'
interface StoredWork { id: string; revision: number; updatedAt: number; package: Uint8Array }

class WorkDatabase extends Dexie {
  entries!: Table<StoredWork, string>
  constructor(name: string) {
    super(name, { autoOpen: false })
    this.version(1).stores({ entries: 'id,revision,updatedAt' }).upgrade(() => {
      throw new Error('不支持升级既有图片工作数据库，原数据保持。')
    })
  }
}

/** Inspect without creating or upgrading a database with an unrelated meaning. */
function inspectDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false, settled = false
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error) } }
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort() }
    request.onerror = () => {
      if (absent && request.error?.name === 'AbortError') { settled = true; resolve() }
      else fail(request.error ?? new Error('无法检查图片工作数据库。'))
    }
    request.onblocked = () => fail(new Error('图片工作数据库被其他连接阻塞。'))
    request.onsuccess = () => {
      const db = request.result
      try {
        if (settled) return
        if (db.version !== 10 || [...db.objectStoreNames].join() !== 'entries') throw new Error('不支持的图片工作数据库结构，原数据保持。')
        const store = db.transaction('entries', 'readonly').objectStore('entries')
        if (store.autoIncrement || store.keyPath !== 'id' || [...store.indexNames].sort().join() !== 'revision,updatedAt') throw new Error('图片工作数据库表结构不同，原数据保持。')
        for (const name of ['revision', 'updatedAt']) {
          const index = store.index(name)
          if (index.keyPath !== name || index.unique || index.multiEntry) throw new Error('图片工作数据库索引不同，原数据保持。')
        }
        settled = true; resolve()
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
  private async open(): Promise<void> {
    if (this.database.isOpen()) return
    await inspectDatabase(this.database.name)
    await this.database.open()
  }
  async save(input: Uint8Array, expectedRevision: number | null, signal?: CancellationSignal): Promise<{ id: string; revision: number }> {
    checkCancelled(signal)
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error('图片工作基线版本无效。')
    const bytes = captureBytes(input, IMAGE_WORK_LIMITS.packageBytes)
    const work = await readBrowserImageWorkPackage(bytes, signal, this.images)
    checkCancelled(signal)
    await this.open()
    return this.database.transaction('rw', this.database.entries, async () => {
      checkCancelled(signal)
      const current = await this.database.entries.get(work.state.id)
      if (current ? current.revision !== expectedRevision : expectedRevision !== null) throw new ImageWorkflowConflictError()
      if (current && work.state.revision <= current.revision) throw new ImageWorkflowConflictError()
      const previous = await this.database.entries.orderBy('updatedAt').last()
      const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
      if (!Number.isSafeInteger(updatedAt)) throw new Error('图片工作保存次序超出范围。')
      await this.database.entries.put({ id: work.state.id, revision: work.state.revision, updatedAt, package: bytes })
      checkCancelled(signal)
      // Force a real read in the same transaction; a failure aborts the write.
      const captured = await this.database.entries.get(work.state.id)
      if (!captured || captured.revision !== work.state.revision || captured.package.length !== bytes.length
        || captured.package.some((byte, index) => byte !== bytes[index])) throw new Error('图片工作写后读取不一致，保存未发布。')
      checkCancelled(signal)
      return { id: work.state.id, revision: work.state.revision }
    })
  }
  async loadLatest(signal?: CancellationSignal): Promise<ImageWorkPackage | null> {
    checkCancelled(signal)
    await this.open()
    const record = await this.database.entries.orderBy('updatedAt').last()
    checkCancelled(signal)
    if (!record) return null
    const work = await readBrowserImageWorkPackage(record.package, signal, this.images)
    if (record.id !== work.state.id || record.revision !== work.state.revision) throw new Error('图片工作数据库记录与工作包身份不一致。')
    return work
  }
  close(): void { this.database.close() }
}
