import { IMAGE_WORK_LIMITS, inspectImageWorkZip } from './workflow.js'
import { sha256Bytes } from '../project/binary.js'
import type { CancellationSignal } from '../ports/resources.js'

type ImageRef = { sha256: string; byteLength: number }
export interface DraftArchive {
  sha256: string
  framing: [Uint8Array, Uint8Array, Uint8Array]
  images: [ImageRef, ImageRef]
}

const digestPattern = /^[0-9a-f]{64}$/
const damaged = () => new Error('本机制作草稿的工作包字节损坏。')

// Share the exact ZIP payloads. Headers, state, compression choices and file
// order remain part of the draft, so reopening or exporting yields its original
// portable v1 file byte for byte, including packages written by other clients.
export function splitDraftArchive(bytes: Uint8Array, signal?: CancellationSignal) {
  const { entries } = inspectImageWorkZip(bytes, signal)
  const [first, second] = [entries.get('original.bin')!, entries.get('normalized.png')!].sort((a, b) => a.dataStart - b.dataStart)
  const slice = (from: number, to?: number) => Uint8Array.from(bytes.subarray(from, to))
  const payload = (entry: typeof first) => {
    const data = slice(entry.dataStart, entry.dataStart + entry.compressed)
    return { ref: { sha256: sha256Bytes(data), byteLength: data.length }, data }
  }
  const a = payload(first), b = payload(second)
  const archive: DraftArchive = { sha256: sha256Bytes(bytes), images: [a.ref, b.ref],
    framing: [slice(0, first.dataStart), slice(first.dataStart + first.compressed, second.dataStart), slice(second.dataStart + second.compressed)] }
  return { archive, images: new Map([a, b].map(({ ref, data }) => [ref.sha256, data])) }
}

export function draftArchiveSizes(archive: DraftArchive) {
  if (!archive || typeof archive.sha256 !== 'string' || !digestPattern.test(archive.sha256) || !Array.isArray(archive.framing) || archive.framing.length !== 3
    || archive.framing.some(segment => !(segment instanceof Uint8Array) || !segment.length)
    || !Array.isArray(archive.images) || archive.images.length !== 2
    || archive.images.some(ref => !ref || typeof ref.sha256 !== 'string' || !digestPattern.test(ref.sha256)
      || !Number.isSafeInteger(ref.byteLength) || ref.byteLength <= 0)) throw damaged()
  const draftBytes = archive.framing.reduce((sum, part) => sum + part.byteLength, 0)
  const packageBytes = draftBytes + archive.images[0].byteLength + archive.images[1].byteLength
  if (!Number.isSafeInteger(packageBytes) || packageBytes > IMAGE_WORK_LIMITS.packageBytes) throw damaged()
  return { draftBytes, packageBytes }
}

export function assembleDraftArchive(archive: DraftArchive, images: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const { packageBytes } = draftArchiveSizes(archive)
  const [a, b] = archive.images.map(ref => {
    const bytes = images.get(ref.sha256)
    if (!(bytes instanceof Uint8Array) || bytes.length !== ref.byteLength || sha256Bytes(bytes) !== ref.sha256) throw damaged()
    return bytes
  })
  const bytes = new Uint8Array(packageBytes)
  let offset = 0
  for (const part of [archive.framing[0], a, archive.framing[1], b, archive.framing[2]]) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  if (sha256Bytes(bytes) !== archive.sha256) throw damaged()
  return bytes
}
