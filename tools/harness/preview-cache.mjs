import fs from 'node:fs/promises'
import path from 'node:path'
import { assert, digest, installArtifact, readBounded } from './io.mjs'

export const PREVIEW_CACHE_BYTES = 64 * 1024 * 1024
const maxEntries = 128
const markerName = 'sceneweave-preview-cache'
const shaPattern = /^[a-f0-9]{64}$/
const entryPattern = /^[a-f0-9]{64}\.png$/

export const describePreview = (file, bytes, storage) => ({ file, byteLength: bytes.length, sha256: digest(bytes), ...(storage ? { storage } : {}) })

async function cacheFolder(parent, folderName, create = false) {
  const directory = path.join(await fs.realpath(parent), '.' + folderName)
  const marker = Buffer.from(folderName + '\n')
  let created = false
  if (create) created = await fs.mkdir(directory, { mode: 0o700 }).then(() => true, error => {
    if (error.code !== 'EEXIST') throw error
    return false
  })
  assert((await fs.lstat(directory)).isDirectory() && await fs.realpath(directory) === directory, '预览缓存须使用本机目录。')
  const mark = path.join(directory, markerName)
  if (created) await installArtifact(mark, marker)
  for (let attempt = 0; ; attempt++) {
    try {
      assert((await fs.lstat(mark)).isFile() && (await readBounded(mark, marker.length)).equals(marker), '预览缓存目录缺少有效标记。')
      break
    } catch (error) {
      // A concurrent invocation may be between creating the managed folder
      // and publishing its version marker.
      if (error.code !== 'ENOENT' || !create || attempt >= 5) throw error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  return directory
}

async function readPreview(directory, record) {
  assert(shaPattern.test(record.sha256 ?? '') && Number.isSafeInteger(record.byteLength)
    && record.byteLength > 0 && record.byteLength <= PREVIEW_CACHE_BYTES, '预览缓存摘要或长度不正确。')
  const file = path.join(directory, record.sha256 + '.png')
  const stat = await fs.lstat(file)
  assert(stat.isFile() && await fs.realpath(file) === file, '预览缓存文件须位于缓存目录内。')
  const bytes = stat.size === record.byteLength ? await readBounded(file, record.byteLength) : undefined
  if (!bytes || record.byteLength !== bytes.length || record.sha256 !== digest(bytes)) {
    throw Object.assign(new Error(`候选文件与回执不符：${record.file}。`), { code: 'preview_cache_corrupt' })
  }
  return { bytes, path: file, record }
}

async function trimCache(directory, keep, ceiling) {
  const oldest = []
  let bytes = 0, entries = 0, reclaimedBytes = 0
  for (const name of await fs.readdir(directory)) {
    if (/^\.artifact-[a-f0-9-]{36}$/.test(name)) {
      const staging = path.join(directory, name)
      const stat = await fs.lstat(staging).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (stat?.isFile() && Date.now() - stat.mtimeMs > 10 * 60_000) {
        await fs.unlink(staging).then(() => { reclaimedBytes += stat.size },
          error => { if (error.code !== 'ENOENT') throw error })
      }
    }
    if (!entryPattern.test(name)) continue
    const file = path.join(directory, name)
    const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!stat?.isFile()) continue
    bytes += stat.size
    entries++
    if (!keep.has(name)) oldest.push({ file, stat })
  }
  oldest.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs || a.file.localeCompare(b.file))
  for (const { file, stat } of oldest) {
    if (bytes <= ceiling && entries <= maxEntries) break
    await fs.unlink(file).then(() => { reclaimedBytes += stat.size },
      error => { if (error.code !== 'ENOENT') throw error })
    bytes -= stat.size
    entries--
  }
  return reclaimedBytes
}

export async function readCachedPreview(parent, folderName, record) {
  return readPreview(await cacheFolder(parent, folderName), record)
}

/** Eviction only touches regenerable, hash-named files in this managed cache. */
export async function cachePreviews(parent, folderName, images, ceiling = PREVIEW_CACHE_BYTES) {
  const records = Object.entries(images).filter(([, bytes]) => bytes).map(([key, bytes]) => ({
    key, bytes, record: describePreview(key + '.png', bytes, 'cache'),
  }))
  const unique = new Map(records.map(({ record }) => [record.sha256 + '.png', record.byteLength]))
  assert(ceiling > 0 && ceiling <= PREVIEW_CACHE_BYTES && unique.size <= maxEntries
    && [...unique.values()].reduce((sum, size) => sum + size, 0) <= ceiling, '预览与诊断超出缓存预算。')
  const directory = await cacheFolder(parent, folderName, true)
  let addedBytes = 0, reusedBytes = 0, reclaimedBytes = 0
  const result = {}
  try {
    for (const { key, bytes, record } of records) {
      const file = path.join(directory, record.sha256 + '.png')
      let current, damaged = false
      try { current = await readPreview(directory, record) }
      catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'preview_cache_corrupt') throw error
        damaged = error.code === 'preview_cache_corrupt'
      }
      if (current) {
        reusedBytes += bytes.length
        const now = new Date()
        await fs.utimes(file, now, now).catch(error => { if (error.code !== 'ENOENT') throw error })
      } else {
        if (await installArtifact(file, bytes, damaged)) addedBytes += bytes.length
        else reusedBytes += bytes.length
        current = await readPreview(directory, record)
      }
      result[key] = current
    }
  } finally {
    reclaimedBytes = await trimCache(directory, new Set(unique.keys()), ceiling)
  }
  return { images: result, addedBytes, reusedBytes, reclaimedBytes }
}
