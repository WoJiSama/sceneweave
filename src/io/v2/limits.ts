/** Candidate protections, not a measured capacity claim. See docs/06. */
export const PROJECT_LIMITS_V2 = Object.freeze({
  compressedBytes: 100 * 1024 * 1024,
  expandedBytes: 300 * 1024 * 1024,
  manifestBytes: 1024 * 1024,
  sceneBytes: 20 * 1024 * 1024,
  licenseBytes: 256 * 1024,
  entries: 3000,
  jsonDepth: 128,
  jsonValues: 600_000,
  imageBytes: 20 * 1024 * 1024,
  imageSide: 8192,
  imagePixels: 32_000_000,
  uniqueImages: 256,
  totalImagePixels: 64_000_000,
})

export function failV2(message: string): never { throw new Error(`M1 工程无效：${message}`) }
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('操作已取消。', 'AbortError')
}

export function hasExactKeys(value: unknown, keys: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && keys.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => keys.includes(key) || optional.includes(key))
}

export const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

export const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
