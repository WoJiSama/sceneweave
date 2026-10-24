/** File protections, not a measured capacity claim. See docs/06. */
export const PACKAGE_LIMITS = Object.freeze({
  compressedBytes: 100 * 1024 * 1024, expandedBytes: 300 * 1024 * 1024,
  manifestBytes: 1024 * 1024, sceneBytes: 20 * 1024 * 1024, sourcesBytes: 1024 * 1024,
  licenseBytes: 256 * 1024, sourceBytes: 1024 * 1024, totalSourceBytes: 32 * 1024 * 1024,
  entries: 3000, jsonDepth: 128, jsonValues: 600_000,
  imageBytes: 20 * 1024 * 1024, imageSide: 8192, imagePixels: 32_000_000,
  uniqueImages: 256, totalImagePixels: 64_000_000,
  archiveDocumentBytes: 128 * 1024 * 1024, archiveSnapshots: 64, namedPerScene: 32, protectionPerScene: 32,
})
export function failPackage(message: string): never { throw new Error(`完整v1工程无效：${message}`) }
export function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key))
}
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
