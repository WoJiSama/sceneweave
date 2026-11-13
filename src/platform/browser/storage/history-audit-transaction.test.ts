import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { auditHistoryMessage, type HistoryAuditMessage } from './history-audit-message.js'
import { disposeHistoryAudits } from './history-audit-client.js'
import { ProjectRepository } from './repository.js'
import * as storageAudit from './storage-audit.js'
import { canonicalJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { isProjectBlockManifest } from './content-blocks.js'
import * as contentBlocks from './content-blocks.js'
import * as historyRecords from './history-records.js'

class AuditingWorker {
  static instances: AuditingWorker[] = []
  static release: (() => void) | undefined
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  stopped = false
  message?: HistoryAuditMessage
  terminate = vi.fn(() => { this.stopped = true })
  constructor() { AuditingWorker.instances.push(this) }
  postMessage(value: HistoryAuditMessage) {
    const captured = structuredClone(value)
    this.message = captured
    AuditingWorker.release = async () => {
      if (this.stopped) return
      try { this.onmessage?.({ data: { ok: true, ...await auditHistoryMessage(captured) } }) }
      catch (error) { this.onmessage?.({ data: { ok: false, message: String(error) } }) }
    }
  }
}
const repositories: ProjectRepository[] = [], names = new Set<string>()
function repository(name = `history-audit-${crypto.randomUUID()}`) {
  const repo = new ProjectRepository({ name, validation, runtime }); repositories.push(repo); names.add(name); return repo
}
function revision(bundle: ProjectBundle, number: number): ProjectBundle {
  const project = cloneJson(bundle.project); project.document.revision = number; project.document.title = `revision ${number}`
  return { project, resources: bundle.resources }
}
const started = () => expect.poll(() => AuditingWorker.instances.length).toBe(1)
afterEach(async () => {
  disposeHistoryAudits(); vi.unstubAllGlobals(); vi.restoreAllMocks(); AuditingWorker.instances = []; AuditingWorker.release = undefined
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

it('rechecks changed preflight content before mutation and preserves cross-connection CAS', async () => {
  const repo = repository(), input = fixture(); await repo.save(input, null)
  repo.close(); await repo.open()
  const other = repository(repo.database.name); await other.open()
  vi.stubGlobal('Worker', AuditingWorker)
  const first = repo.save(revision(input, 1), 0); await started()
  const stale = other.save(revision(input, 2), 0), rejected = expect(stale).rejects.toMatchObject({ name: 'ProjectConflictError' })
  AuditingWorker.release!(); await first
  await expect.poll(() => AuditingWorker.instances.length).toBe(2)
  AuditingWorker.release!(); await rejected
  expect((await repo.database.projects.get(input.project.document.sceneId))!.revision).toBe(1)
  expect(AuditingWorker.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true)
})

it('rejects a corrupt retained ancestor through the asynchronous read-only audit without hanging or changing data', async () => {
  const repo = repository(), input = fixture(), owner = input.project.document.sceneId
  await repo.save(input, null)
  for (let n = 1; n <= 5; n++) await repo.save(revision(input, n), n - 1)
  const ancestor = (await repo.database.historyVersions.where('ownerSceneId').equals(owner).toArray()).find(row => row.revision === 0)!
  const corrupt = cloneJson(ancestor); corrupt.checkpoint!.document.title = 'corrupt outside the latest checkpoint chain'
  await repo.database.historyVersions.put(corrupt)
  vi.stubGlobal('Worker', AuditingWorker)
  const pending = repo.usage(owner), rejected = expect(pending).rejects.toThrow(/hash/)
  await started(); AuditingWorker.release!(); await rejected
  expect((await repo.database.projects.get(owner))!.revision).toBe(5)
  expect(await repo.database.historyVersions.get([owner, ancestor.id])).toEqual(corrupt)
})

it('resumes read-only accounting in its owning transaction after a successful background audit', async () => {
  const repo = repository(), input = fixture(), owner = input.project.document.sceneId
  await repo.save(input, null); repo.close(); await repo.open()
  vi.stubGlobal('Worker', AuditingWorker)
  const pending = repo.usage(owner)
  await started(); AuditingWorker.release!()
  const usage = await pending
  expect(usage.documentBytes).toBeGreaterThan(0)
  expect(AuditingWorker.instances[0].terminate).toHaveBeenCalledOnce()
  const second = await repo.usage(owner)
  expect(second).toEqual(usage)
  expect(AuditingWorker.instances).toHaveLength(1)
})

it.each(['save', 'usage'] as const)('observes native transaction abort during fallback %s and cannot publish a late successful audit', async operation => {
  const repo = repository(), input = fixture(); await repo.save(input, null); repo.close()
  // Oversized preparations retain the original transaction-bound audit path.
  vi.spyOn(storageAudit, 'prepareStorageAudit').mockResolvedValue(undefined)
  vi.stubGlobal('Worker', AuditingWorker)
  const transact = IDBDatabase.prototype.transaction
  let writing: IDBTransaction | undefined
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
    const tx = transact.apply(this, args)
    if (args[1] === (operation === 'save' ? 'readwrite' : 'readonly')) writing = tx
    return tx
  })
  const pending = operation === 'save' ? repo.save(revision(input, 1), 0) : repo.usage(input.project.document.sceneId)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await started(); writing!.abort(); await rejected
  await expect.poll(() => AuditingWorker.instances[0].terminate.mock.calls.length).toBe(1)
  AuditingWorker.release!()
  expect((await repo.database.projects.get(input.project.document.sceneId))!.revision).toBe(0)
  expect(await repo.database.historyVersions.count()).toBe(1)
})

it.each(['save', 'usage'] as const)('aborts final native %s confirmation after the independent audit without adopting its receipt', async operation => {
  const repo = repository(), input = fixture(); await repo.save(input, null); repo.close()
  vi.stubGlobal('Worker', AuditingWorker)
  const pending = operation === 'save' ? repo.save(revision(input, 1), 0) : repo.usage(input.project.document.sceneId)
  const rejected = expect(pending).rejects.toThrow()
  await started()
  let aborted = false
  const cursor = IDBObjectStore.prototype.openCursor
  vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['openCursor']>) {
    const request = cursor.apply(this, args)
    if (!aborted && this.transaction.mode === (operation === 'save' ? 'readwrite' : 'readonly')) {
      const tx = this.transaction
      request.addEventListener('success', () => { if (!aborted) { aborted = true; tx.abort() } }, { once: true })
    }
    return request
  })
  AuditingWorker.release!(); await rejected
  expect(aborted).toBe(true)
  expect(AuditingWorker.instances[0].terminate).toHaveBeenCalledOnce()
  expect((await repo.database.projects.get(input.project.document.sceneId))!.revision).toBe(0)
  expect(await repo.database.historyVersions.count()).toBe(1)
})

it('releases the capture transaction before the worker so an independent native writer can finish', async () => {
  const repo = repository(), input = fixture(); await repo.save(input, null); repo.close(); await repo.open()
  vi.stubGlobal('Worker', AuditingWorker)
  const pending = repo.save(revision(input, 1), 0)
  await started()
  // A readwrite transaction on another connection completes while the worker
  // remains paused. It performs no mutation, so confirmation stays valid.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(repo.database.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['storageState'], 'readwrite'); tx.objectStore('storageState').get('epoch')
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
  }); db.close()
  expect(AuditingWorker.instances[0].terminate).not.toHaveBeenCalled()
  AuditingWorker.release!(); await pending
  expect((await repo.database.projects.get(input.project.document.sceneId))!.revision).toBe(1)
})

it('services cancellation between captured records before starting the history worker', async () => {
  const repo = repository(), input = fixture(); await repo.save(input, null)
  const rows = await new Promise<Map<string, unknown[]>>((resolve, reject) => {
    const names = repo.database.tables.map(table => table.name), captured = new Map<string, unknown[]>()
    const tx = repo.database.backendDB().transaction(names, 'readonly')
    for (const name of names) {
      const request = tx.objectStore(name).getAll()
      request.onsuccess = () => { captured.set(name, request.result) }
    }
    tx.oncomplete = () => resolve(captured); tx.onabort = () => reject(tx.error)
  })
  vi.stubGlobal('Worker', AuditingWorker)
  let elapsed = 0
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed += 13)
  const controller = new AbortController()
  // A browser task must run between records, rather than only promise jobs.
  const cancellation = setTimeout(() => controller.abort(), 0)
  try {
    const auditing = repo as unknown as { auditCapturedTotals(rows: ReadonlyMap<string, readonly unknown[]>, signal: AbortSignal): Promise<unknown> }
    await expect(auditing.auditCapturedTotals(rows, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(AuditingWorker.instances).toHaveLength(0)
    expect((await repo.database.projects.get(input.project.document.sceneId))!.revision).toBe(0)
  } finally { clearTimeout(cancellation) }
})

it('re-reads actual block bytes even when a native writer keeps every declared hash and epoch unchanged', async () => {
  const repo = repository(), input = fixture(); await repo.save(input, null); repo.close(); await repo.open()
  vi.stubGlobal('Worker', AuditingWorker)
  const pending = repo.save(revision(input, 1), 0), rejected = expect(pending).rejects.toThrow(/hash/)
  await started()
  const before = await repo.database.storageState.get('epoch')
  await new Promise<void>((resolve, reject) => {
    const tx = repo.database.backendDB().transaction(['projectContentBlocks'], 'readwrite'), store = tx.objectStore('projectContentBlocks')
    const request = store.openCursor()
    request.onsuccess = () => {
      const row = request.result!.value; row.bytes[0] ^= 1; store.put(row)
    }
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
  })
  AuditingWorker.release!(); await rejected
  expect(await repo.database.storageState.get('epoch')).toEqual(before)
  expect(await repo.database.projects.count()).toBe(1); expect(await repo.database.historyVersions.count()).toBe(1)
  expect(AuditingWorker.instances).toHaveLength(1)
})

it('cancels an independent preflight when its repository closes and never starts a final write', async () => {
  const repo = repository(), input = fixture(); await repo.save(input, null); repo.close(); await repo.open()
  vi.stubGlobal('Worker', AuditingWorker)
  const pending = repo.save(revision(input, 1), 0), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await started(); repo.close(); await rejected
  expect(AuditingWorker.instances[0].terminate).toHaveBeenCalledOnce()
  const cold = repository(repo.database.name)
  expect((await cold.load(input.project.document.sceneId))!.project.document.revision).toBe(0)
})

it('cancels an admitted full audit, rolls back the atomic save and terminates its worker', async () => {
  const repo = repository(), input = fixture(); await repo.save(input, null); repo.close(); await repo.open()
  vi.stubGlobal('Worker', AuditingWorker)
  const controller = new AbortController(), pending = repo.save(revision(input, 1), 0, { signal: controller.signal })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await started(); controller.abort(); await rejected
  expect(AuditingWorker.instances[0].terminate).toHaveBeenCalledOnce()
  expect((await repo.database.projects.get(input.project.document.sceneId))!.revision).toBe(0)
  expect(await repo.database.historyVersions.count()).toBe(1)
})

it('sends all owners, branches and pins compactly, omits unreferenced blocks and agrees with the no-Worker fallback', async () => {
  const repo = repository(), input = fixture(), owner = input.project.document.sceneId
  await repo.save(input, null)
  const root = (await repo.listHistoryVersions(owner)).versions[0]
  await repo.createSnapshot(input, 'named root', { expectedRevision: 0, expectedMetadataVersion: 0 })
  await repo.createSnapshot(input, 'protected root', { kind: 'protection', expectedRevision: 0, expectedMetadataVersion: 1 })
  for (let n = 1; n <= 5; n++) await repo.save(revision(input, n), n - 1)
  await repo.save(revision(input, 6), 5, { historyParentId: root.id, historyParentHash: root.contentHash })
  const second = { ...input, project: cloneJson(input.project) }; second.project.document.sceneId += '-other'
  await repo.save(second, null); await repo.save(revision(second, 1), 0)
  await repo.createSnapshot(revision(second, 1), 'other pin', { expectedRevision: 1, expectedMetadataVersion: 0 })
  const bytes = encodeUtf8('{"unused":true}'), unused = { sha256: sha256Bytes(bytes), bytes }
  await repo.database.projectContentBlocks.put(unused)
  const expected = await repo.usage(owner)
  repo.close(); await repo.open(); vi.stubGlobal('Worker', AuditingWorker)
  const contexts: { closed: boolean }[] = [], createMaterializer = contentBlocks.createProjectMaterializer
  vi.spyOn(contentBlocks, 'createProjectMaterializer').mockImplementation((...args) => {
    const actual = createMaterializer(...args), state = { closed: false }; contexts.push(state)
    return { materialize: actual.materialize, close() { state.closed = true; actual.close() } }
  })
  const audit = historyRecords.auditHistoryRecords, auditClosures: boolean[] = []
  vi.spyOn(historyRecords, 'auditHistoryRecords').mockImplementation((...args) => {
    auditClosures.push(contexts.at(-1)!.closed)
    return audit(...args)
  })
  const pending = repo.usage(owner); await started()
  // The real background boundary is paused here. Page parsing must already
  // be released without losing the original captured bytes used by confirm.
  expect(contexts).toHaveLength(1); expect(contexts[0].closed).toBe(true)
  const message = AuditingWorker.instances[0].message!
  expect('kind' in message && message.kind).toBe('captured-history')
  if (!('kind' in message)) throw new Error('expected native compact message')
  expect(message.heads).toHaveLength(2); expect(message.versions).toHaveLength(9); expect(message.pins).toHaveLength(3)
  const manifests = message.versions.filter(row => isProjectBlockManifest(row.checkpoint))
  expect(manifests.length).toBeGreaterThan(1)
  const required = new Set(manifests.flatMap(row => isProjectBlockManifest(row.checkpoint) ? row.checkpoint.fields.flatMap(field => field.blocks.map(ref => ref.sha256)) : []))
  expect(new Set(message.blocks.map(block => block.sha256))).toEqual(required)
  expect(message.blocks.some(block => block.sha256 === unused.sha256)).toBe(false)
  AuditingWorker.release!(); expect(await pending).toEqual(expected)
  expect(auditClosures).toEqual([false, true]) // Keep reuse until the last owner.
  expect(contexts.every(context => context.closed)).toBe(true)
  expect((await repo.database.projectContentBlocks.get(unused.sha256))!.bytes).toEqual(bytes)
  expect((await repo.loadHistoryVersion(owner, root.id))!.project).toEqual(input.project)
  vi.unstubAllGlobals(); repo.close(); expect(await repo.usage(owner)).toEqual(expected)
})

it.each(['inactive branch', 'pin target'] as const)('rejects resealed %s corruption in the compact full graph', async kind => {
  const repo = repository(), input = fixture(), owner = input.project.document.sceneId
  await repo.save(input, null)
  const root = (await repo.listHistoryVersions(owner)).versions[0]
  await repo.save(revision(input, 1), 0)
  await repo.createSnapshot(revision(input, 1), 'retained branch', { expectedRevision: 1, expectedMetadataVersion: 0 })
  await repo.save(revision(input, 2), 1, { historyParentId: root.id, historyParentHash: root.contentHash })
  const reseal = <T extends { recordHash: string }>(row: T): T => {
    const { recordHash: _old, ...payload } = row
    return { ...row, recordHash: sha256Bytes(encodeUtf8(canonicalJson(payload))) }
  }
  if (kind === 'inactive branch') {
    const old = (await repo.database.historyVersions.toArray()).find(row => row.revision === 1)!
    old.delta!.afterHash = '0'.repeat(64)
    await repo.database.historyVersions.put(reseal(old))
  } else {
    const pin = (await repo.database.historyPins.toArray())[0]; pin.sourceRevision = 0
    await repo.database.historyPins.put(reseal(pin))
  }
  repo.close(); await repo.open(); vi.stubGlobal('Worker', AuditingWorker)
  const pending = repo.save(revision(input, 3), 2), rejected = expect(pending).rejects.toThrow()
  await started(); AuditingWorker.release!(); await rejected
  expect((await repo.database.projects.get(owner))!.revision).toBe(2)
  expect(await repo.database.historyVersions.count()).toBe(3)
})
