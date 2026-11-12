import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artworkValidation } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { encodeSourcePng } from '../../../shared/project/png-rgba.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { inspectImageBytes } from '../../../shared/project/image-bytes.js'
import { readImageWorkPackage, writeImageWorkPackage, type ImageWorkState } from '../../../shared/image-import/workflow.js'
import { ImageWorkflowStore, ImageWorkflowConflictError, IMAGE_WORKFLOW_DATABASE, readBrowserImageWorkPackage } from './image-workflow-store.js'
import type { ImageProcessingPort } from '../../../shared/ports/resources.js'

const png = encodeSourcePng({ width: 1, height: 1, rgba: new Uint8ClampedArray([32, 64, 96, 255]) })
function state(id = 'room', revision = 0, normalized = png): ImageWorkState {
  return { format: 'sceneweave-image-work', version: 1, id, revision,
    image: { sha256: sha256Bytes(normalized), pixelWidth: 1, pixelHeight: 1 },
    original: { sha256: sha256Bytes(png), sizeBytes: png.length, name: 'room.png', mimeType: 'image/png' },
    rights: { licenseText: '', attribution: '', canEmbed: false }, draft: { title: 'Room', calibration: null, roomPointsPx: [], layers: [] },
    notes: '', nextAction: 'Mark object', scaleStatus: 'provisional', journal: [], reviews: [] }
}
function imagePort(): ImageProcessingPort {
  const images = artworkValidation().images
  images.normalizeImport = async bytes => {
    const header = inspectImageBytes(bytes, false)
    const record = { sha256: sha256Bytes(bytes), mimeType: header.mimeType, sizeBytes: bytes.length, pixelWidth: header.width, pixelHeight: header.height }
    await images.decode(bytes, record)
    return { bytes: bytes.slice(), record }
  }
  return images
}
const names = new Set<string>(), repos: ImageWorkflowStore[] = []
function repository(name = IMAGE_WORKFLOW_DATABASE + '-' + crypto.randomUUID(), images = imagePort()): ImageWorkflowStore {
  const repo = new ImageWorkflowStore({ name, images }); repos.push(repo); names.add(name); return repo
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repos.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('independent image-workflow storage', () => {
  it('cold loads exact work and rechecks actual image pixels, without storing in the scene database', async () => {
    const images = imagePort(), decode = vi.spyOn(images, 'decode'), repo = repository(undefined, images)
    expect((await indexedDB.databases()).map(row => row.name)).not.toContain(repo.database.name)
    const bytes = await writeImageWorkPackage(state(), png, png)
    await repo.save(bytes, null)
    expect(repo.database.tables.map(table => table.name)).toEqual(['entries'])
    expect(decode).toHaveBeenCalledTimes(3)
    repo.close()
    const cold = repository(repo.database.name, images)
    const work = await cold.loadLatest()
    expect(work?.state).toEqual(state()); expect(work?.original).toEqual(png)
    expect(decode).toHaveBeenCalledTimes(6)
  })

  it('uses revision CAS across two connections and preserves the winning task', async () => {
    const first = repository(), second = repository(first.database.name)
    await first.save(await writeImageWorkPackage(state(), png, png), null)
    const updated = state('room', 1); updated.notes = 'winning edits'
    await second.save(await writeImageWorkPackage(updated, png, png), 0)
    await expect(first.save(await writeImageWorkPackage(state('room', 2), png, png), 0)).rejects.toBeInstanceOf(ImageWorkflowConflictError)
    await expect(first.save(await writeImageWorkPackage(state('room', 1), png, png), 1)).rejects.toBeInstanceOf(ImageWorkflowConflictError)
    await expect(first.save(await writeImageWorkPackage(state('room', 2), png, png), null)).rejects.toBeInstanceOf(ImageWorkflowConflictError)
    expect((await first.loadLatest())?.state.notes).toBe('winning edits')
  })

  it('returns the most recently saved task independently of its revision number and keeps other tasks', async () => {
    const repo = repository()
    expect(await repo.loadLatest()).toBeNull()
    await repo.save(await writeImageWorkPackage(state('old-task', 8), png, png), null)
    await repo.save(await writeImageWorkPackage(state('new-task', 0), png, png), null)
    expect((await repo.loadLatest())?.state.id).toBe('new-task')
    expect(await repo.database.entries.count()).toBe(2)
  })

  it('refuses a byte-valid package whose normalized pixels are unrelated to the original', async () => {
    const wrong = encodeSourcePng({ width: 1, height: 1, rgba: new Uint8ClampedArray([200, 10, 55, 255]) })
    const bytes = await writeImageWorkPackage(state('mismatch', 0, wrong), png, wrong)
    expect((await readImageWorkPackage(bytes)).state.image.sha256).toBe(sha256Bytes(wrong))
    const repo = repository()
    await expect(repo.save(bytes, null)).rejects.toThrow(/实际像素不一致/)
    expect((await indexedDB.databases()).map(row => row.name)).not.toContain(repo.database.name)
  })

  it('does not publish when cancelled during decoding, and rolls back cancellation after a database write', async () => {
    const bytes = await writeImageWorkPackage(state(), png, png), signal = { aborted: false }, images = imagePort()
    const normalize = images.normalizeImport!
    images.normalizeImport = async (...args) => { const value = await normalize(...args); signal.aborted = true; return value }
    const cancelled = repository(undefined, images)
    await expect(cancelled.save(bytes, null, signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect((await indexedDB.databases()).map(row => row.name)).not.toContain(cancelled.database.name)
    const repo = repository()
    await repo.loadLatest()
    signal.aborted = false
    repo.database.entries.hook('creating', () => { signal.aborted = true })
    await expect(repo.save(bytes, null, signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await repo.database.entries.count()).toBe(0)
  })

  it('refuses a foreign database without changing its schema or contents', async () => {
    const repo = repository(), foreign = new Dexie(repo.database.name)
    foreign.version(2).stores({ unrelated: 'id' })
    await foreign.open(); await foreign.table('unrelated').add({ id: 'preserved', value: 'source' }); foreign.close()
    await expect(repo.loadLatest()).rejects.toThrow(/结构/)
    const read = new Dexie(repo.database.name)
    await read.open()
    expect(read.verno).toBe(2); expect(await read.table('unrelated').toArray()).toEqual([{ id: 'preserved', value: 'source' }])
    read.close()
    expect(() => new ImageWorkflowStore({ name: 'sceneweave-projects' })).toThrow(/独立/)
  })

  it('rejects a corrupt stored package and never treats a valid metadata row as a successful cold read', async () => {
    const repo = repository(), bytes = await writeImageWorkPackage(state(), png, png)
    await repo.save(bytes, null)
    await repo.database.entries.update('room', { package: new Uint8Array([1, 2, 3]) })
    await expect(repo.loadLatest()).rejects.toThrow()
    expect(await repo.database.entries.count()).toBe(1)
    await expect(readBrowserImageWorkPackage(bytes, { aborted: true }, imagePort())).rejects.toMatchObject({ name: 'AbortError' })
  })
})
