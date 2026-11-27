import { HISTORY_LIMITS } from '../../../shared/model/history.js'

const projectMarker = 'sceneweave-has-local-projects'

export function hadLocalProjects(): boolean {
  try { return localStorage.getItem(projectMarker) === '1' } catch { return false }
}

export function rememberLocalProjects(present = true) {
  try {
    if (present) localStorage.setItem(projectMarker, '1')
    else localStorage.removeItem(projectMarker)
  } catch { /* A disabled browser preference must not affect saving. */ }
}

export type BrowserStorageStatus = { persistent?: boolean; used?: number; quota?: number; requestable: boolean }
export function storageBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`
  if (Math.abs(bytes) < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (Math.abs(bytes) >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}

export function storageDelta(bytes: number): string {
  return bytes > 0 ? `新增 ${storageBytes(bytes)}` : bytes < 0 ? `减少 ${storageBytes(-bytes)}` : '变化 0 B'
}
export function nearProjectStorageLimit(usage: { resourceBytes: number; documentBytes: number } | undefined): boolean {
  return !!usage && (usage.resourceBytes >= HISTORY_LIMITS.storedResourceBytes * .85 || usage.documentBytes >= HISTORY_LIMITS.storedDocumentBytes * .85)
}

export async function browserStorageStatus(request?: boolean): Promise<BrowserStorageStatus> {
  const manager = navigator.storage
  const requestable = typeof manager?.persist === 'function'
  let persistent: boolean | undefined, estimate: StorageEstimate | undefined
  try { persistent = request && requestable ? await manager.persist() : await manager?.persisted?.() } catch { /* permission is owned by the browser */ }
  try { estimate = await manager?.estimate?.() } catch { /* browser usage is optional */ }
  return { persistent, used: estimate?.usage, quota: estimate?.quota, requestable }
}
