import Dexie from 'dexie'
import type { ResourceOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { isProjectBlockManifest, validateProjectBlockManifest } from './content-blocks.js'
import { CONTENT_PAYLOAD_FIELDS } from './content-block-middleware.js'
import type { ProjectDatabase } from './database.js'
import { captureHistoryGraph, readHistoryGraphVersion, seal } from './history-records.js'

const perOwner = ['automaticSnapshots', 'snapshots', 'importedSnapshots', 'resourceBindings', 'historyPins', 'historyVersions'] as const
const ownerRecord = ['projects', 'historyMetadata', 'historyHeads'] as const

function deleteKeys(table: string, rejectKey: (key: IDBValidKey) => boolean, signal?: ResourceOptions['signal'], owner?: string): Promise<number> {
  const transaction = Dexie.currentTransaction
  if (!transaction?.active || transaction.mode !== 'readwrite') throw new Error('移除须在有效工程事务中执行。')
  const store = transaction.idbtrans.objectStore(table)
  return new Dexie.Promise((resolve, reject) => {
    let removed = 0
    const request = owner === undefined ? store.openKeyCursor() : store.index('ownerSceneId').openKeyCursor(IDBKeyRange.only(owner))
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      try {
        checkCancelled(signal)
        const cursor = request.result
        if (!cursor) { resolve(removed); return }
        if (rejectKey(cursor.primaryKey)) {
          const deletion = store.delete(cursor.primaryKey)
          deletion.onerror = () => reject(deletion.error)
          removed++
        }
        cursor.continue()
      } catch (error) { reject(error) }
    }
  })
}

/** Scope removal to the exact compound key. Content middleware would try to
 * materialize a damaged checkpoint if it were removed through a normal hook. */
export async function removeOwnedProject(owner: string, signal?: ResourceOptions['signal']): Promise<void> {
  for (const table of perOwner) await deleteKeys(table, key => Array.isArray(key) && key[0] === owner, signal, owner)
  for (const table of ownerRecord) {
    checkCancelled(signal)
    const store = Dexie.currentTransaction!.idbtrans.objectStore(table)
    await new Dexie.Promise<void>((resolve, reject) => {
      const request = store.delete(owner)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

/** The caller has already proved all retained content, including inline
 * records. IDs come from their manifests, independently of the actual block. */
export async function collectUnusedContentBlocks(database: ProjectDatabase, signal?: ResourceOptions['signal']): Promise<number> {
  const retained = new Set<string>()
  for (const [table, field] of Object.entries(CONTENT_PAYLOAD_FIELDS)) {
    for (const { value } of await database.rawJsonRows(table)) {
      checkCancelled(signal)
      const payload = (value as Record<string, unknown>)[field]
      if (!isProjectBlockManifest(payload)) continue
      for (const section of validateProjectBlockManifest(payload).fields) for (const block of section.blocks) retained.add(block.sha256)
    }
  }
  return deleteKeys('projectContentBlocks', key => typeof key === 'string' && !retained.has(key), signal)
}

/** Keep the existing active and pinned versions with their exact contents.
 * Clearing intervening records cuts their parent link instead of inventing one. */
export async function discardAutomaticHistory(database: ProjectDatabase, owner: string, signal?: ResourceOptions['signal']): Promise<number> {
  const head = await database.historyHeads.get(owner)
  if (head?.status !== 'ready' || await database.automaticSnapshots.where('ownerSceneId').equals(owner).count()
    || await database.snapshots.where('ownerSceneId').equals(owner).count()) throw new Error('此工程仍含旧来源历史，暂不能整理自动版本。')
  const graph = captureHistoryGraph({ head,
    versions: await database.historyVersions.where('ownerSceneId').equals(owner).toArray(),
    pins: await database.historyPins.where('ownerSceneId').equals(owner).toArray(),
  })
  const retained = new Set([head.activeVersionId, ...graph.pins.map(pin => pin.versionId)])
  const obsolete = graph.versions.filter(row => !retained.has(row.id))
  if (!obsolete.length) return 0
  for (const row of graph.versions) {
    checkCancelled(signal)
    if (!retained.has(row.id)) continue
    if (row.checkpoint && row.parentId === null) continue
    const checkpoint = readHistoryGraphVersion(graph, row.id)
    await database.historyVersions.put(seal({ ...row, checkpoint, delta: null, chainBytes: 0, depth: 0, parentId: null, parentHash: null }))
  }
  await database.historyVersions.bulkDelete(obsolete.map(row => [owner, row.id]))
  return obsolete.length
}
