import { Zip, ZipDeflate } from 'fflate'
import { failPackage, PACKAGE_LIMITS } from '../../../shared/project/limits.js'

const chunkSize = 256 * 1024

/** The worker receives independently owned entries from complete archive preparation. */
export function zipProjectArchive(files: Record<string, Uint8Array>, limit: number = PACKAGE_LIMITS.compressedBytes): Blob {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  const zip = new Zip((error, chunk) => {
    if (error) throw error
    size += chunk.length
    if (size > limit) failPackage('压缩工程超过100MiB。')
    chunks.push(chunk)
  })
  const mtime = new Date(2000, 0, 1, 0, 0, 0)
  for (const [path, bytes] of Object.entries(files)) {
    const entry = new ZipDeflate(path, { level: 6 })
    entry.mtime = mtime
    zip.add(entry)
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, bytes.length)
      entry.push(bytes.subarray(offset, end), end === bytes.length)
    }
  }
  zip.end()
  return new Blob(chunks, { type: 'application/octet-stream' })
}
