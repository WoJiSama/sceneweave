import Dexie, { type Transaction } from 'dexie'
import type { ProjectDatabase } from './database.js'

export interface StorageTotals { documentBytes: number; resourceBytes: number; legacyBytes: number }
type Cost = { kind: keyof StorageTotals; bytes: number } | null
interface Receipt { totals: StorageTotals; epoch: number; generation: number }
const generations = new Map<string, number>()
const generation = (name: string) => generations.get(name) ?? 0
const advance = (name: string) => generations.set(name, generation(name) + 1)

/** Session evidence follows a full scan, never a persisted byte counter. All owned writes are measured before commit. */
export class StorageAccounting {
  private receipt: Receipt | null = null
  private readonly pending = new WeakMap<Transaction, StorageTotals>()
  private readonly foreign = new WeakSet<Transaction>()
  constructor(private readonly db: ProjectDatabase, private readonly scan: () => Promise<StorageTotals>,
    private readonly measure: (table: string, value: unknown) => Cost) {
    for (const table of db.tables) {
      const name = table.name
      table.hook('creating', (_key, value, tx) => { this.changed(tx, name, undefined, value) })
      table.hook('deleting', (_key, value, tx) => { this.changed(tx, name, value, undefined) })
      table.hook('updating', (changes, _key, value, tx) => {
        // Dexie supplies a detached old record and dotted-path updates. Preserve it
        // while independently measuring the exact value Dexie will persist.
        if (!this.pending.has(tx)) { this.changed(tx, name, undefined, undefined); return }
        const next = structuredClone(value)
        for (const [path, update] of Object.entries(changes)) Dexie.setByKeyPath(next, path, update)
        this.changed(tx, name, value, next)
      })
    }
  }
  invalidate(): void { this.receipt = null }
  private changed(tx: Transaction, table: string, before: unknown, after: unknown): void {
    advance(this.db.name)
    const totals = this.pending.get(tx)
    if (totals) {
      for (const [value, sign] of [[before, -1], [after, 1]] as const) if (value !== undefined) {
        const cost = this.measure(table, value)
        if (cost) {
          totals[cost.kind] += sign * cost.bytes
          if (!Number.isSafeInteger(totals[cost.kind]) || totals[cost.kind] < 0) throw new Error('存储预算增量统计不一致；事务未采用。')
        }
      }
      return
    }
    this.invalidate()
    // Other repository consumers (for example original-family preservation)
    // use their own transactions. Signal those writes to every other tab too.
    if (table !== 'storageState' && !this.foreign.has(tx) && tx.storeNames.includes('storageState')) {
      this.foreign.add(tx)
      void tx.table('storageState').get('epoch').then(row => {
        const epoch = this.checkedEpoch(row)
        if (epoch === Number.MAX_SAFE_INTEGER) throw new Error('存储事务版本已耗尽。')
        return tx.table('storageState').put({ key: 'epoch', epoch: epoch + 1 })
      }).catch(() => {
        // This promise is created by a hook rather than returned by the caller's
        // transaction body. Fail closed explicitly, including epoch exhaustion.
        this.invalidate()
        try { tx.abort() } catch { /* the transaction has already aborted */ }
      })
    }
  }
  private checkedEpoch(value: unknown): number {
    if (value === undefined) return 0
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'key') || !Object.hasOwn(value, 'epoch')
      || (value as { key: unknown }).key !== 'epoch' || !Number.isSafeInteger((value as { epoch: number }).epoch) || (value as { epoch: number }).epoch < 0) throw new Error('存储事务版本损坏。')
    return (value as { epoch: number }).epoch
  }
  async totals(): Promise<StorageTotals> {
    const tx = Dexie.currentTransaction
    if (!tx) throw new Error('预算检查必须位于存储事务中。')
    const pending = this.pending.get(tx)
    if (pending) return { ...pending }
    const epoch = this.checkedEpoch(await this.db.storageState.get('epoch')), current = generation(this.db.name)
    if (this.receipt && this.receipt.epoch === epoch && this.receipt.generation === current) return { ...this.receipt.totals }
    const totals = await this.scan()
    const receipt = { totals: { ...totals }, epoch, generation: current }
    tx.on('complete', () => { if (generation(this.db.name) === current) this.receipt = receipt })
    return totals
  }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const tx = Dexie.currentTransaction
    if (!tx) throw new Error('预算记账必须绑定当前原子写事务。')
    if (this.pending.has(tx)) return operation()
    const epoch = this.checkedEpoch(await this.db.storageState.get('epoch'))
    if (epoch === Number.MAX_SAFE_INTEGER) throw new Error('存储事务版本已耗尽。')
    const totals = await this.totals()
    this.pending.set(tx, totals)
    try {
      const result = await operation()
      await this.db.storageState.put({ key: 'epoch', epoch: epoch + 1 })
      const current = generation(this.db.name), receipt = { totals: { ...totals }, epoch: epoch + 1, generation: current }
      tx.on('complete', () => { if (generation(this.db.name) === current) this.receipt = receipt })
      tx.on('abort', () => { this.invalidate() })
      return result
    } finally { this.pending.delete(tx) }
  }
}
