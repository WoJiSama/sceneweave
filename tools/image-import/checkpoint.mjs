import fs from 'node:fs/promises'
import path from 'node:path'
import { assert, digest, installArtifact, readBounded } from '../harness/io.mjs'

const folderName = '.sceneweave-image-checkpoints-v1'
const format = 'sceneweave-local-image-checkpoint'
export const imageCheckpointSuffix = '.sceneweave-image-checkpoint'
const maxImageBytes = 49 * 1024 * 1024
const maxReceiptBytes = 16 * 1024 * 1024

async function imageDirectory(output, create = false) {
  const directory = path.join(await fs.realpath(output), folderName)
  if (create) await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  assert((await fs.lstat(directory)).isDirectory() && await fs.realpath(directory) === directory, '图片断点资源须位于本机断点目录。')
  return directory
}

function imagePath(folder, sha256) {
  assert(typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256), '图片断点的资源摘要不正确。')
  return path.join(folder, sha256 + '.bin')
}

async function readRegularFile(file, limit) {
  assert((await fs.lstat(file)).isFile() && await fs.realpath(file) === file, '图片断点须使用本机普通文件。')
  return readBounded(file, limit)
}

async function assemble(output, storage, archive) {
  storage.draftArchiveSizes(archive)
  const folder = await imageDirectory(output)
  const images = new Map()
  for (const { sha256, byteLength } of archive.images) {
    if (!images.has(sha256)) images.set(sha256, await readRegularFile(imagePath(folder, sha256), byteLength))
  }
  return storage.assembleDraftArchive(archive, images)
}

export async function readImageCheckpoint(file, storage, assertBinding) {
  const output = await fs.realpath(path.dirname(file))
  const bytes = await readRegularFile(path.join(output, path.basename(file)), maxReceiptBytes)
  const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  assert(record.format === format && record.version === 1 && Number.isSafeInteger(record.generation) && record.generation >= 0
    && Array.isArray(record.archive?.framing) && record.archive.framing.length === 3
    && record.archive.framing.every(part => typeof part === 'string'), '图片断点回执损坏。')
  const binding = assertBinding(record.workflow)
  const archive = { ...record.archive, framing: record.archive.framing.map(part => Buffer.from(part, 'base64')) }
  return { bytes: await assemble(output, storage, archive), generation: record.generation, binding, status: 'bound' }
}

/** Automatic checkpoints retain every saved state. Their image bytes are
 * immutable and shared within the output directory. Export stays portable. */
export async function saveImageCheckpoint(output, bytes, workflow, generation, storage, assertBinding) {
  assertBinding(workflow)
  assert(Number.isSafeInteger(generation) && generation >= 0, '图片断点代次不正确。')
  const { archive, images } = storage.splitDraftArchive(Uint8Array.from(bytes))
  const root = await fs.realpath(output)
  const folder = await imageDirectory(root, true)
  const receipt = Buffer.from(JSON.stringify({
    format, version: 1, workflow, generation,
    archive: { ...archive, framing: archive.framing.map(part => Buffer.from(part).toString('base64')) },
  }) + '\n')
  assert(receipt.length <= maxReceiptBytes, '图片断点回执超过存储预算，请导出独立工作包。')
  let writtenBytes = 0, reusedBytes = 0
  for (const [sha256, image] of images) {
    const file = imagePath(folder, sha256)
    try {
      const original = await readRegularFile(file, maxImageBytes)
      assert(original.equals(image), '图片断点中已有的共享图片字节不符。')
      reusedBytes += image.length
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (await installArtifact(file, image)) writtenBytes += image.length
      else reusedBytes += image.length
    }
  }
  assert(Buffer.from(await assemble(root, storage, archive)).equals(bytes), '图片断点写后读取不一致。')
  const file = path.join(root, `work-${generation}-${digest(receipt)}${imageCheckpointSuffix}`)
  if (await fs.lstat(file).then(() => false, error => { if (error.code !== 'ENOENT') throw error; return true })
    && await installArtifact(file, receipt)) writtenBytes += receipt.length
  else reusedBytes += receipt.length
  assert((await readRegularFile(file, maxReceiptBytes)).equals(receipt), '图片断点回执写后读取不一致。')
  return { path: file, sha256: archive.sha256, generation, workflow, storage: { writtenBytes, reusedBytes } }
}
