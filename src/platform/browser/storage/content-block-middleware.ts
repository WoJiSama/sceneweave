import Dexie, { type DBCore, type DBCoreCursor, type DBCoreTransaction, type Middleware } from 'dexie'
import { checkedContentBlock, isProjectBlockManifest, materializeProjectContent, partitionProjectContent, validateProjectBlockManifest, type ProjectContentBlock } from './content-blocks.js'
import { canonicalJson, cloneJson, encodeUtf8, freezeJson } from '../../../shared/validation/json.js'
import type { ProjectData } from '../../../shared/model/project.js'
import { exactEncodedSnapshot, matchingEncodedSnapshot, snapshotContentPartition, transactionEncodedSnapshots } from './content-context.js'

export const CONTENT_PAYLOAD_FIELDS: Readonly<Record<string, 'project' | 'checkpoint'>> = Object.freeze({
  projects: 'project', automaticSnapshots: 'project', snapshots: 'project', importedSnapshots: 'project', historyVersions: 'checkpoint',
})
export const CONTENT_BLOCK_STORE = 'projectContentBlocks'
export interface ContentBlockWrite { blocks: number; bytes: number; reused: number; recordBytes: number }

/** Below Dexie hooks: callers still read/write complete projects; native rows
 * contain one bounded manifest. Blocks and visible rows share the native CAS tx. */
export function contentBlockMiddleware(
  onWrite: (measurement: ContentBlockWrite, transaction: DBCoreTransaction) => void,
  onStorageDelta: (bytes: number, transaction: DBCoreTransaction) => void,
): Middleware<DBCore> {
  return { stack: 'dbcore', name: 'complete-project-content-blocks', level: 1.5, create: down => {
    const blockTable = () => down.table(CONTENT_BLOCK_STORE)
    // Native transaction isolation makes one actual read sufficient until one
    // of our own writes changes that row. Returned objects never alias these.
    const reads = new WeakMap<DBCoreTransaction, { rows: Map<string, Map<string, any>>; pendingRows: Map<string, Map<string, Promise<any>>>; blocks: Map<string, ProjectContentBlock | undefined>; pendingBlocks: Map<string, Promise<ProjectContentBlock | undefined>>; hydrated: Map<string, ProjectData>; pendingHydrated: Map<string, Promise<ProjectData>>; retained: number }>()
    const limit = 64 * 1024 * 1024
    const state = (trans: DBCoreTransaction) => {
      let value = reads.get(trans)
      if (!value) {
        value = { rows: new Map(), pendingRows: new Map(), blocks: new Map(), pendingBlocks: new Map(), hydrated: new Map(), pendingHydrated: new Map(), retained: 0 }; reads.set(trans, value)
        const release = () => reads.delete(trans)
        ;(trans as IDBTransaction).addEventListener('complete', release, { once: true })
        ;(trans as IDBTransaction).addEventListener('abort', release, { once: true })
      }
      return value
    }
    const rawMany = (name: string, keys: any[], trans: DBCoreTransaction): Promise<any[]> => {
      const cached = state(trans), rows = cached.rows.get(name) ?? new Map<string, any>()
      const pending = cached.pendingRows.get(name) ?? new Map<string, Promise<any>>()
      cached.rows.set(name, rows); cached.pendingRows.set(name, pending)
      const missing = [...new Map(keys.filter(key => !rows.has(canonicalJson(key)) && !pending.has(canonicalJson(key))).map(key => [canonicalJson(key), key])).values()]
      if (missing.length) {
        const batch = Dexie.Promise.resolve(down.table(name).getMany({ trans, keys: missing }))
        missing.forEach((key, index) => {
          const k = canonicalJson(key), read = batch.then(values => {
            const value = values[index], owned = value === undefined ? undefined : cloneJson(value)
            const size = value === undefined ? 64 : encodeUtf8(canonicalJson(value)).length + 128
            if (cached.retained + size <= limit) { rows.set(k, owned); cached.retained += size }
            return owned
          }).finally(() => { pending.delete(k) })
          pending.set(k, read)
        })
      }
      return Dexie.Promise.all(keys.map(key => {
        const k = canonicalJson(key)
        return Dexie.Promise.resolve(rows.has(k) ? rows.get(k) : pending.get(k)).then(value => value === undefined ? undefined : cloneJson(value))
      }))
    }
    const readBlocks = (hashes: string[], trans: DBCoreTransaction): Promise<Map<string, ProjectContentBlock | undefined>> => {
      const cached = state(trans), store = (trans as IDBTransaction).objectStore(CONTENT_BLOCK_STORE)
      const read = (hash: string): Promise<ProjectContentBlock | undefined> => {
        if (cached.blocks.has(hash)) return Dexie.Promise.resolve(cached.blocks.get(hash))
        const pending = cached.pendingBlocks.get(hash)
        if (pending) return pending
        const request = new Dexie.Promise<ProjectContentBlock | undefined>((resolve, reject) => {
          const request = store.get(hash)
          request.onsuccess = () => { try { resolve(request.result === undefined ? undefined : checkedContentBlock(request.result, { sha256: hash, byteLength: request.result.bytes?.length })) } catch (error) { reject(error) } }
          request.onerror = () => reject(request.error)
        }).then(row => {
          if (cached.retained + (row?.bytes.length ?? 0) + 160 <= limit) {
            cached.blocks.set(hash, row); cached.retained += (row?.bytes.length ?? 0) + 160
          }
          return row
        }).finally(() => { cached.pendingBlocks.delete(hash) })
        cached.pendingBlocks.set(hash, request)
        return request
      }
      return Dexie.Promise.all(hashes.map(read)).then(rows => new Map(hashes.map((hash, index) => [hash, rows[index]])))
    }
    const invalidate = (trans: DBCoreTransaction, table: string) => {
      // Keep accounting conservative after invalidation rather than retaining
      // unbounded superseded objects during a large bulk transaction.
      const cached = reads.get(trans)
      if (!cached) return
      if (table === CONTENT_BLOCK_STORE) { reads.delete(trans); return }
      cached.rows.delete(table); cached.pendingRows.delete(table)
    }
    const readRow = (value: any, field: string, trans: DBCoreTransaction): Promise<any> => {
      if (!value || !isProjectBlockManifest(value[field])) return Dexie.Promise.resolve(value)
      const manifest = validateProjectBlockManifest(value[field]), key = canonicalJson(manifest)
      // Only an internal save pins these private immutable objects. All native
      // blocks have already been freshly checked before a project reaches this
      // view; normal public reads retain their independently mutable copies.
      const view = (project: ProjectData) => ({ ...value, [field]: exactEncodedSnapshot(trans as IDBTransaction, project) ? project : cloneJson(project) })
      const cached = state(trans), known = cached.hydrated.get(key)
      if (known) return Dexie.Promise.resolve(view(known))
      const pending = cached.pendingHydrated.get(key)
      if (pending) return pending.then(view)
      const hashes = [...new Set(manifest.fields.flatMap(field => field.blocks.map(ref => ref.sha256)))]
      const materialized = readBlocks(hashes, trans).then(blocks => {
        for (const part of manifest.fields) for (const ref of part.blocks) {
          const actual = blocks.get(ref.sha256)
          if (!actual || actual.bytes.length !== ref.byteLength) throw new Error('工程内容块实际字节hash或长度损坏。')
        }
        // A prepared snapshot only removes parsing after every actual byte has
        // been freshly read in this tx and matched to its owned block closure.
        for (const snapshot of transactionEncodedSnapshots(trans as IDBTransaction)) {
          const partition = snapshotContentPartition(snapshot)
          if (canonicalJson(partition.manifest) !== key) continue
          const expected = new Map(partition.blocks.map(block => [block.sha256, block.bytes]))
          for (const hash of hashes) {
            const actual = blocks.get(hash)!.bytes, bytes = expected.get(hash)
            if (!bytes || actual.length !== bytes.length || !actual.every((value, index) => value === bytes[index])) throw new Error('已有内容块与实际保存快照字节冲突。')
          }
          return snapshot.encoded.stored
        }
        return materializeProjectContent(manifest, async hash => blocks.get(hash))
      }).then(project => {
        const owned = freezeJson(project), size = manifest.byteLength * 3
        if (cached.retained + size <= limit) { cached.hydrated.set(key, owned); cached.retained += size }
        return owned
      }).finally(() => { cached.pendingHydrated.delete(key) })
      cached.pendingHydrated.set(key, materialized)
      return materialized.then(view)
    }
    const writeBlocks = (values: ProjectContentBlock[], trans: DBCoreTransaction) => {
      const unique = [...new Map(values.map(value => [value.sha256, value])).values()]
      if (!unique.length) return Dexie.Promise.resolve()
      return readBlocks(unique.map(value => value.sha256), trans).then(existing => {
        const fresh: ProjectContentBlock[] = []
        for (const expected of unique) {
          const actual = existing.get(expected.sha256)
          if (actual === undefined) fresh.push(expected)
          else if (actual.bytes.length !== expected.bytes.length || !actual.bytes.every((value, index) => value === expected.bytes[index])) throw new Error('相同内容块hash的已有实际字节冲突。')
        }
        const report = () => {
          const bytes = fresh.reduce((sum, row) => sum + row.bytes.length, 0)
          onStorageDelta(bytes, trans)
          onWrite({ blocks: fresh.length, bytes, reused: unique.length - fresh.length, recordBytes: 0 }, trans)
        }
        if (!fresh.length) { report(); return }
        return Dexie.Promise.resolve(blockTable().mutate({ type: 'add', trans, values: fresh })).then(result => {
          const cached = reads.get(trans)
          if (cached) for (const row of fresh) {
            cached.blocks.delete(row.sha256)
            for (const key of cached.hydrated.keys()) if (key.includes(row.sha256)) cached.hydrated.delete(key)
          }
          if (result.numFailures) { trans.abort(); throw new Error('不可变工程内容块写入失败；保存未提交。') }
          report()
        })
      })
    }
    const wrapCursor = (cursor: DBCoreCursor, field: string, trans: DBCoreTransaction): DBCoreCursor => {
      let value: unknown
      const refresh = async () => { value = await readRow(cursor.value, field, trans) }
      const wrapper: DBCoreCursor = {
        get trans() { return cursor.trans }, get key() { return cursor.key }, get primaryKey() { return cursor.primaryKey },
        get value() { return value }, get done() { return cursor.done },
        continue: key => cursor.continue(key), continuePrimaryKey: (key, primaryKey) => cursor.continuePrimaryKey(key, primaryKey),
        advance: count => cursor.advance(count), stop: result => cursor.stop(result), fail: error => cursor.fail(error),
        start: onNext => cursor.start(() => { void refresh().then(onNext, error => cursor.fail(error)) }),
        next: async () => { await cursor.next(); await refresh(); return wrapper },
      }
      return wrapper
    }
    return { ...down,
      transaction: (stores, mode, options) => down.transaction(stores.some(name => Object.hasOwn(CONTENT_PAYLOAD_FIELDS, name))
        ? [...new Set([...stores, CONTENT_BLOCK_STORE])] : stores, mode, options),
      table: name => {
        const table = down.table(name), field = CONTENT_PAYLOAD_FIELDS[name]
        if (name === CONTENT_BLOCK_STORE) return { ...table, mutate: request => {
          invalidate(request.trans, name)
          return table.mutate(request)
        } }
        if (!field) return table
        return { ...table,
          get: request => rawMany(name, [request.key], request.trans).then(values => readRow(values[0], field, request.trans)),
          getMany: request => rawMany(name, request.keys, request.trans).then(values => Dexie.Promise.all(values.map(value => readRow(value, field, request.trans)))),
          query: request => Dexie.Promise.resolve(table.query(request)).then(result => request.values === false ? result
            : Dexie.Promise.all(result.result.map(value => readRow(value, field, request.trans))).then(values => ({ ...result, result: values }))),
          openCursor: request => Dexie.Promise.resolve(table.openCursor(request)).then(cursor => cursor && request.values !== false ? wrapCursor(cursor, field, request.trans) : cursor),
          mutate: request => Dexie.Promise.resolve().then(() => {
            const rowBytes = (rows: readonly unknown[]) => rows.reduce<number>((sum, row) => sum + (row === undefined ? 0 : encodeUtf8(canonicalJson(row)).length), 0)
            // Read below hydration and hooks: measure the physical envelope,
            // including old inline rows. Repeated keys in one bulk write count
            // once, and immutable blocks are charged separately on insertion.
            const keys = request.type === 'deleteRange' ? [] : [...new Map((request.type === 'delete'
              ? request.keys : request.keys ?? request.values.map(value => table.schema.primaryKey.extractKey!(value)))
              .map(key => [canonicalJson(key), key])).values()]
            const before = request.type === 'deleteRange'
              ? Dexie.Promise.resolve(table.query({ trans: request.trans, values: true, query: { index: table.schema.primaryKey, range: request.range } })).then(result => result.result)
              : Dexie.Promise.resolve(table.getMany({ trans: request.trans, keys }))
            if (request.type === 'delete' || request.type === 'deleteRange') return before.then(rows => table.mutate(request).then(result => {
              invalidate(request.trans, name)
              if (result.numFailures) { request.trans.abort(); throw new Error('工程清单删除失败；保存未提交。') }
              onStorageDelta(-rowBytes(rows), request.trans)
              return result
            }))
            const blocks: ProjectContentBlock[] = [], values = request.values.map(value => {
              if (!value || value[field] === null) return value
              if (isProjectBlockManifest(value[field])) throw new Error('完整工程API不能写入调用方自报的区块清单。')
              const prepared = matchingEncodedSnapshot(request.trans as IDBTransaction, value[field] as ProjectData)
              const partition = prepared ? snapshotContentPartition(prepared) : partitionProjectContent(value[field] as ProjectData)
              blocks.push(...partition.blocks)
              return { ...value, [field]: partition.manifest }
            })
            return before.then(rows => writeBlocks(blocks, request.trans).then(() => table.mutate({ ...request, values })).then(result => {
              invalidate(request.trans, name)
              if (result.numFailures) { request.trans.abort(); throw new Error('工程清单写入失败；内容块及可见版本均未提交。') }
              return Dexie.Promise.resolve(table.getMany({ trans: request.trans, keys })).then(stored => {
                onStorageDelta(rowBytes(stored) - rowBytes(rows), request.trans)
                onWrite({ blocks: 0, bytes: 0, reused: 0, recordBytes: rowBytes(values) }, request.trans)
                return result
              })
            })).catch(error => {
              request.trans.abort(); throw error
            })
          }),
        }
      },
    }
  } }
}
