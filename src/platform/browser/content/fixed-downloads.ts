import manifest from 'virtual:sceneweave-fixed-downloads'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { currentDatabaseNames } from '../storage/current-databases.js'
import type { StoredBytes } from '../storage/database.js'
import { fixedImageChanges, openFixedImageCache, storedFixedHashes, storeFixedImage } from './fixed-image-cache.js'
import { CONTENT_FETCH_CONCURRENCY, loadFixedResources } from './load-resources.js'

export { manifest }
interface DownloadState {
  available: ReadonlySet<string> | null
  inventoryError: string
  running: boolean
  total: number
  finished: number
  failures: ReadonlyMap<string, string>
}
let state: DownloadState = { available: null, inventoryError: '', running: false, total: 0, finished: 0, failures: new Map() }
const listeners = new Set<() => void>()
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
export const downloadSnapshot = () => state
export function subscribeDownloads(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function update(change: Partial<DownloadState>) {
  state = { ...state, ...change }
  for (const listener of listeners) listener()
}

let inspecting: Promise<void> | undefined
const changesDuringInspection = new Map<string, boolean>()
function onImageChange(event: Event) {
  const hash = (event as CustomEvent<string>).detail
  if (!Object.hasOwn(manifest.assets, hash)) return
  const stored = event.type === 'stored'
  if (inspecting) changesDuringInspection.set(hash, stored)
  if (!state.available || state.available.has(hash) === stored) return
  const available = new Set(state.available)
  if (stored) available.add(hash)
  else available.delete(hash)
  update({ available })
}
fixedImageChanges.addEventListener('stored', onImageChange)
fixedImageChanges.addEventListener('removed', onImageChange)

async function readSavedImages(hashes: string[]) {
  const name = currentDatabaseNames().projects
  if (indexedDB.databases && !(await indexedDB.databases()).some(db => db.name === name)) return []
  // Opening without a version declaration uses Dexie's existing-schema mode.
  // Inspecting downloads must never create or upgrade the project database.
  const { default: Dexie } = await import('dexie')
  const existing = new Dexie(name, { autoOpen: false })
  try {
    await existing.open()
    return await existing.table<StoredBytes, string>('resources').bulkGet(hashes)
  } finally { existing.close() }
}

async function inspectDownloads() {
  const cache = await openFixedImageCache()
  const available = await storedFixedHashes(cache)
  const missing = Object.keys(manifest.assets).filter(hash => !available.has(hash))
  if (missing.length) {
    // Older saves, imported maps and the blank starter ZIP may already contain
    // the exact public images. Only look up hashes from the shipped manifest.
    const rows = await readSavedImages(missing).catch(() => [])
    for (const [i, row] of rows.entries()) {
      const hash = missing[i]
      if (row?.bytes instanceof Uint8Array && row.bytes.byteLength === manifest.assets[hash].sizeBytes && sha256Bytes(row.bytes) === hash) {
        await storeFixedImage(cache, hash, row.bytes)
        available.add(hash)
      }
    }
  }
  for (const [hash, stored] of changesDuringInspection) {
    if (stored) available.add(hash)
    else available.delete(hash)
  }
  update({ available, inventoryError: '' })
}

export function refreshDownloads() {
  if (!inspecting) {
    changesDuringInspection.clear()
    inspecting = inspectDownloads().catch(error => update({ available: null, inventoryError: errorText(error) }))
      .finally(() => { inspecting = undefined })
  }
  return inspecting
}

/** One bounded queue per tab. Closing the picker or navigating between pages keeps the transfer alive. */
export async function downloadImages(requested: Iterable<string>) {
  const { available } = state
  if (state.running || !available) return
  const hashes = [...new Set(requested)].filter(hash => Object.hasOwn(manifest.assets, hash) && !available.has(hash))
  if (!hashes.length) return
  update({ running: true, total: hashes.length, finished: 0, failures: new Map() })
  const queue = hashes.values()
  async function worker() {
    for (const hash of queue) {
      try {
        await loadFixedResources({ [hash]: manifest.assets[hash] }, manifest.paths, {}, { requireStored: true })
        // Cache hits from another tab do not emit a local write event.
        if (!state.available?.has(hash)) update({ available: new Set(state.available).add(hash) })
      } catch (error) {
        update({ failures: new Map(state.failures).set(hash, errorText(error)) })
      }
      update({ finished: state.finished + 1 })
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(CONTENT_FETCH_CONCURRENCY, hashes.length) }, worker)) }
  finally { update({ running: false }) }
}
