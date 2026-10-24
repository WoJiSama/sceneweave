export { sha256Bytes } from '../validation/hash.js'

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Intrinsics read the real view rather than caller-supplied getters/species. */
export function captureBytes(input: Uint8Array, maximumBytes = Number.MAX_SAFE_INTEGER): Uint8Array {
  if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype) throw new Error('资源字节须为原生Uint8Array。')
  const prototype = Object.getPrototypeOf(Uint8Array.prototype) as object
  const size = Object.getOwnPropertyDescriptor(prototype, 'byteLength')!.get!.call(input) as number
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || size > maximumBytes) throw new Error('实际字节超过读取保护预算。')
  const buffer = Object.getOwnPropertyDescriptor(prototype, 'buffer')!.get!.call(input) as unknown
  if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype) throw new Error('不接受共享或外来字节缓冲区。')
  const captured = new Uint8Array(size)
  Uint8Array.prototype.set.call(captured, input)
  return captured
}

/** Fatal UTF-8 decoding; overlong, surrogate and out-of-range sequences fail. */
export function decodeUtf8(bytes: Uint8Array): string {
  const chunks: string[] = []; let chunk = ''
  const invalid = (): never => { throw new Error('文本必须为有效UTF-8。') }
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++]; let cp: number, count: number, minimum: number
    if (first < 0x80) { cp = first; count = 0; minimum = 0 }
    else if (first >= 0xc2 && first <= 0xdf) { cp = first & 31; count = 1; minimum = 0x80 }
    else if (first >= 0xe0 && first <= 0xef) { cp = first & 15; count = 2; minimum = 0x800 }
    else if (first >= 0xf0 && first <= 0xf4) { cp = first & 7; count = 3; minimum = 0x10000 }
    else return invalid()
    if (i + count > bytes.length) return invalid()
    for (let offset = 0; offset < count; offset++) {
      const next = bytes[i++]
      if ((next & 0xc0) !== 0x80) return invalid()
      cp = (cp << 6) | (next & 63)
    }
    if (cp < minimum || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff) return invalid()
    chunk += cp <= 0xffff ? String.fromCharCode(cp) : String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 1023))
    if (chunk.length >= 8192) { chunks.push(chunk); chunk = '' }
  }
  chunks.push(chunk)
  return chunks.join('')
}
