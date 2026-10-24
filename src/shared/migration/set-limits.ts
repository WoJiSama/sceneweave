/** Migration file protections, not a promise of storage capacity. */
export const MIGRATION_SET_LIMITS = Object.freeze({
  indexBytes: 16 * 1024 * 1024,
  manifestBytes: 1024 * 1024,
  compressedBytes: 33 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  chunkBytes: 8 * 1024 * 1024,
  entries: 3000,
  volumes: 512,
  jsonDepth: 128,
  jsonValues: 600_000,
})

export function failMigrationSet(message: string): never { throw new Error(`迁移保全set无效：${message}`) }
