export type CatalogKind = 'prop' | 'material' | 'prefab'
export interface CatalogSelector { kind: CatalogKind; definitionId: string }
export interface CatalogIdentity {
  namespace: string
  kind: CatalogKind
  catalogId: string
  fixedVersion: number
  contentHash: string
  logicalKey: string
  key: string
}
export interface CatalogItem {
  identity: CatalogIdentity
  selector: CatalogSelector
  name: string
  publisherTags: string[]
  widthMm: number
  heightMm: number
  originLabel: string
  licenseRefs: string[]
  thumbnailAssetIds: string[]
  visibility: 'public' | 'gm'
}
export const CATALOG_COLORS = ['红', '橙', '黄', '绿', '青', '蓝', '紫', '粉', '棕', '黑', '白', '灰'] as const
export type CatalogColor = typeof CATALOG_COLORS[number]
export interface CatalogOrganization { tags: string[]; colors: CatalogColor[]; favorite: boolean }
export const EMPTY_CATALOG_ORGANIZATION: CatalogOrganization = { tags: [], colors: [], favorite: false }
/** Native complete-v1 neutral fixed-closure capsule; actual bytes are rechecked on every external read. */
export interface PreparedLibraryEntry { item: CatalogItem; capsule: Uint8Array; capsuleSha256: string }
export interface LibraryEntrySummary { item: CatalogItem; capsuleSha256: string; sizeBytes: number }
export interface LibrarySnapshot {
  revision: number
  entries: LibraryEntrySummary[]
  organizations: Record<string, CatalogOrganization>
}
export interface LibraryMutation {
  put?: PreparedLibraryEntry[]
  organization?: { key: string; value: CatalogOrganization }[]
  remove?: string[]
}
export interface LibraryBackup { entries: PreparedLibraryEntry[]; organizations: Record<string, CatalogOrganization> }
export const LIBRARY_LIMITS = Object.freeze({
  entries: 512, organizationRecords: 2048, batch: 64, tags: 32, tagCodePoints: 40, colors: 8,
  capsuleBytes: 32 * 1024 * 1024, storedCapsuleBytes: 128 * 1024 * 1024,
  backupBytes: 64 * 1024 * 1024, backupPayloadBytes: 47 * 1024 * 1024,
  adoptionOperations: 256,
})
