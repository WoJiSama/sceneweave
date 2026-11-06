import Dexie, { type DBCore, type DBCoreCursor, type DBCoreTransaction, type Middleware } from 'dexie'
import { checkedContentBlock, isProjectBlockManifest, materializeProjectContent, partitionProjectContent, validateProjectBlockManifest, type ProjectContentBlock } from './content-blocks.js'
import { canonicalJson, encodeUtf8 } from '../../../shared/validation/json.js'
import type { ProjectData } from '../../../shared/model/project.js'

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
    const readRow = (value: any, field: string, trans: DBCoreTransaction): Promise<any> => {
      if (!value || !isProjectBlockManifest(value[field])) return Dexie.Promise.resolve(value)
      const manifest = validateProjectBlockManifest(value[field])
      const hashes = [...new Set(manifest.fields.flatMap(field => field.blocks.map(ref => ref.sha256)))]
      // Cursor events may run outside Dexie's PSD. Use the owning native tx
      // directly for this bounded batch; immutable blocks need no live-query
      // mutation tracking. Every referenced byte is still verified below.
      const store = (trans as IDBTransaction).objectStore(CONTENT_BLOCK_STORE)
      return Dexie.Promise.all(hashes.map(hash => new Dexie.Promise<ProjectContentBlock | undefined>((resolve, reject) => {
        const request = store.get(hash)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }))).then(rows => {
        const blocks = new Map(hashes.map((hash, index) => [hash, rows[index]]))
        return Dexie.Promise.resolve(materializeProjectContent(manifest, async hash => blocks.get(hash)))
          .then(project => ({ ...value, [field]: project }))
      })
    }
    const writeBlocks = (values: ProjectContentBlock[], trans: DBCoreTransaction) => {
      const unique = [...new Map(values.map(value => [value.sha256, value])).values()]
      if (!unique.length) return Dexie.Promise.resolve()
      return Dexie.Promise.resolve(blockTable().getMany({ trans, keys: unique.map(value => value.sha256) })).then(existing => {
        const fresh: ProjectContentBlock[] = []
        for (let index = 0; index < unique.length; index++) {
          if (existing[index] === undefined) fresh.push(unique[index])
          else checkedContentBlock(existing[index], { sha256: unique[index].sha256, byteLength: unique[index].bytes.length })
        }
        const report = () => {
          const bytes = fresh.reduce((sum, row) => sum + row.bytes.length, 0)
          onStorageDelta(bytes, trans)
          onWrite({ blocks: fresh.length, bytes, reused: unique.length - fresh.length, recordBytes: 0 }, trans)
        }
        if (!fresh.length) { report(); return }
        return Dexie.Promise.resolve(blockTable().mutate({ type: 'add', trans, values: fresh })).then(result => {
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
        if (!field) return table
        return { ...table,
          get: request => Dexie.Promise.resolve(table.get(request)).then(value => readRow(value, field, request.trans)),
          getMany: request => Dexie.Promise.resolve(table.getMany(request)).then(values => Dexie.Promise.all(values.map(value => readRow(value, field, request.trans)))),
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
              if (result.numFailures) { request.trans.abort(); throw new Error('工程清单删除失败；保存未提交。') }
              onStorageDelta(-rowBytes(rows), request.trans)
              return result
            }))
            const blocks: ProjectContentBlock[] = [], values = request.values.map(value => {
              if (!value || value[field] === null) return value
              if (isProjectBlockManifest(value[field])) throw new Error('完整工程API不能写入调用方自报的区块清单。')
              const partition = partitionProjectContent(value[field] as ProjectData)
              blocks.push(...partition.blocks)
              return { ...value, [field]: partition.manifest }
            })
            return before.then(rows => writeBlocks(blocks, request.trans).then(() => table.mutate({ ...request, values })).then(result => {
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
