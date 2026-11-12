import Dexie from 'dexie'
import { CancelledOperationError, checkCancelled, type CancellationSignal } from '../../../shared/ports/resources.js'
import type { ProjectDatabase } from './database.js'
import type { StorageTotals } from './storage-accounting.js'

// Bounded operation-local evidence, never a persisted counter or certificate.
// This is a conservative data estimate, not a claim about actual JS heap/RSS.
export const STORAGE_AUDIT_LIMITS = Object.freeze({ retainedBytes: 64 * 1024 * 1024, values: 2_000_000 })
export class StorageAuditConflictError extends Error {
  constructor() { super('完整核账期间本地数据库内容已变化；本次保存未采用，请重新保存。'); this.name = 'StorageAuditConflictError' }
}
export interface StorageAuditPreparation {
  /** Re-read every native row/byte in this final transaction before consuming. */
  confirm(transaction: IDBTransaction, signal?: CancellationSignal): Promise<StorageTotals>
  release(): void
}
type Rows = ReadonlyMap<string, readonly unknown[]>

function estimate(value: unknown, budget: { bytes: number; values: number }, ancestors = new Set<object>(), depth = 0): boolean {
  if (++budget.values > STORAGE_AUDIT_LIMITS.values || depth > 128) return false
  if (typeof value === 'string') budget.bytes += value.length * 2 + 16
  else if (value instanceof Uint8Array && Object.getPrototypeOf(value) === Uint8Array.prototype) budget.bytes += value.byteLength + 64
  else if (value && typeof value === 'object') {
    if (ancestors.has(value) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) return false
    ancestors.add(value); budget.bytes += 64
    for (const key of Object.keys(value)) {
      budget.bytes += key.length * 2 + 16
      if (!estimate((value as Record<string, unknown>)[key], budget, ancestors, depth + 1)) return false
    }
    ancestors.delete(value)
  } else if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) budget.bytes += 16
  else return false
  return budget.bytes <= STORAGE_AUDIT_LIMITS.retainedBytes
}
function equalNative(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
    return true
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) if (!Object.hasOwn(right, key) || !equalNative((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) return false
  return !Array.isArray(left) || left.length === (right as unknown[]).length
}
/** All cursors share a native snapshot. Overflow only declines optional
 * preparation; the caller falls back to the original in-transaction audit. */
async function capture(database: ProjectDatabase, signal?: CancellationSignal): Promise<Map<string, unknown[]> | null> {
  checkCancelled(signal)
  const names = database.tables.map(table => table.name), native = database.backendDB().transaction(names, 'readonly')
  return new Promise((resolve, reject) => {
    const rows = new Map(names.map(name => [name, [] as unknown[]])), budget = { bytes: 0, values: 0 }
    let overflow = false, failure: unknown
    const cancel = () => { failure = new CancelledOperationError(); try { native.abort() } catch { /* already settled */ } }
    signal?.addEventListener?.('abort', cancel, { once: true })
    const cleanup = () => signal?.removeEventListener?.('abort', cancel)
    native.oncomplete = () => { cleanup(); resolve(rows) }
    native.onabort = () => { cleanup(); rows.clear(); if (overflow) resolve(null); else reject(failure ?? native.error ?? new CancelledOperationError()) }
    for (const name of names) {
      const request = native.objectStore(name).openCursor()
      request.onerror = () => { failure = request.error }
      request.onsuccess = () => {
        try {
          checkCancelled(signal)
          const cursor = request.result
          if (!cursor) return
          if (!estimate(cursor.value, budget)) { overflow = true; native.abort(); return }
          rows.get(name)!.push(cursor.value); cursor.continue()
        } catch (error) { failure = error; try { native.abort() } catch { /* already settled */ } }
      }
    }
  })
}

/** Capture first and let that readonly transaction finish before any expensive
 * audit begins. Only repository-owned validation composes this internal helper;
 * no save option accepts a preparation or caller-provided validation callback. */
export async function prepareStorageAudit(database: ProjectDatabase, audit: (rows: Rows) => Promise<StorageTotals>, signal?: CancellationSignal): Promise<StorageAuditPreparation | undefined> {
  const rows = await capture(database, signal)
  if (!rows) return
  try {
    const totals = await audit(rows); checkCancelled(signal)
    let released = false
    return Object.freeze({
      async confirm(transaction: IDBTransaction, currentSignal?: CancellationSignal): Promise<StorageTotals> {
        if (released || transaction.db !== database.backendDB()) throw new StorageAuditConflictError()
        const cancellation = currentSignal ?? signal
        checkCancelled(cancellation)
        // Dexie's Promise binds the continuation to the existing transaction.
        // Native cursor reads themselves keep it alive; no worker/spin wait.
        await Dexie.Promise.all([...rows].map(([name, expected]) => new Dexie.Promise<void>((resolve, reject) => {
          let index = 0
          const request = transaction.objectStore(name).openCursor()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            try {
              checkCancelled(cancellation)
              if (released) throw new StorageAuditConflictError()
              const cursor = request.result
              if (!cursor) { if (index !== expected.length) throw new StorageAuditConflictError(); resolve(); return }
              if (index >= expected.length || !equalNative(cursor.value, expected[index++])) throw new StorageAuditConflictError()
              cursor.continue()
            } catch (error) { reject(error) }
          }
        })))
        return { ...totals }
      },
      release(): void { released = true; rows.clear() },
    })
  } catch (error) { rows.clear(); throw error }
}
