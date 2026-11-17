import type { Page } from '@playwright/test'

/** Read-only observation while the normal export UI is guarded by a candidate.
 * This checks preservation, not project validity; actual candidate cold reads
 * and subsequent normal-UI backups exercise the full validation boundary. */
export async function forestSourceStorage(page: Page, sceneId: string) {
  return page.evaluate(async id => {
    const selected = localStorage.getItem('sceneweave-current-development-storage')
    const name = selected ? JSON.parse(selected).projects : 'sceneweave-projects-dev-v1'
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onupgradeneeded = () => request.transaction!.abort()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = db.transaction(['projects', 'projectContentBlocks'], 'readonly')
      const read = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      const [project, blocks] = await Promise.all([
        read(transaction.objectStore('projects').get(id)),
        read(transaction.objectStore('projectContentBlocks').getAll()),
      ])
      const actualBlocks = await Promise.all(blocks.map(async block => ({
        sha256: block.sha256,
        actualSha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', block.bytes))).map(byte => byte.toString(16).padStart(2, '0')).join(''),
      })))
      return { project, blocks: actualBlocks }
    } finally { db.close() }
  }, sceneId)
}
