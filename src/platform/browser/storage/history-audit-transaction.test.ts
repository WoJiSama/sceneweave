import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { auditHistoryRecords } from './history-records.js'
import { disposeHistoryAudits } from './history-audit-client.js'
import { ProjectRepository } from './repository.js'
import * as storageAudit from './storage-audit.js'

class AuditingWorker {
  static instances: AuditingWorker[] = []
  static release: (() => void) | undefined
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  stopped = false
  terminate = vi.fn(() => { this.stopped = true })
  constructor() { AuditingWorker.instances.push(this) }
  postMessage(value: Parameters<typeof auditHistoryInMessage>[0]) {
    const captured = structuredClone(value)
    AuditingWorker.release = () => {
      if (this.stopped) return
      try { this.onmessage?.({ data: { ok: true, ...auditHistoryInMessage(captured) } }) }
      catch (error) { this.onmessage?.({ data: { ok: false, message: String(error) } }) }
    }
  }
}
function auditHistoryInMessage(value: { owner: string; head: Parameters<typeof auditHistoryRecords>[1]; versions: Parameters<typeof auditHistoryRecords>[2]; pins: Parameters<typeof auditHistoryRecords>[3] }) {
  return auditHistoryRecords(value.owner, value.head, value.versions, value.pins)
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
