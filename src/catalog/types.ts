import type { CompleteProjectV6 } from '../io/v6/types'

export type CatalogKindV1 = 'prop' | 'material' | 'prefab'
export interface CatalogSelectorV1 { kind: CatalogKindV1; definitionId: string }
export interface CatalogIdentityV1 {
  namespace: string
  kind: CatalogKindV1
  catalogId: string
  fixedVersion: number
  contentHash: string
  logicalKey: string
  key: string
}
export interface CatalogItemV1 {
  identity: CatalogIdentityV1
  selector: CatalogSelectorV1
  name: string
  publisherTags: string[]
  widthMm: number
  heightMm: number
  originLabel: string
  licenseRefs: string[]
  thumbnailAssetIds: string[]
  visibility: 'public' | 'gm'
}
export const CATALOG_COLORS_V1 = ['红', '橙', '黄', '绿', '青', '蓝', '紫', '粉', '棕', '黑', '白', '灰'] as const
export type CatalogColorV1 = typeof CATALOG_COLORS_V1[number]
export interface CatalogOrganizationV1 { tags: string[]; colors: CatalogColorV1[]; favorite: boolean }
export const EMPTY_CATALOG_ORGANIZATION_V1: CatalogOrganizationV1 = { tags: [], colors: [], favorite: false }
/** A detached native-v6 resource-only capsule. The root and its exact meaning are rechecked on every external read. */
export interface PreparedCatalogEntryV1 { item: CatalogItemV1; capsule: Blob; capsuleSha256: string }
export interface CatalogEntrySummaryV1 { item: CatalogItemV1; capsuleSha256: string; sizeBytes: number }
export interface CatalogSnapshotV1 {
  revision: number
  entries: CatalogEntrySummaryV1[]
  organizations: Record<string, CatalogOrganizationV1>
}
export interface CatalogMutationV1 {
  put?: PreparedCatalogEntryV1[]
  organization?: { key: string; value: CatalogOrganizationV1 }[]
  remove?: string[]
}
export interface CatalogBackupRecordV1 { entry: PreparedCatalogEntryV1; organization: CatalogOrganizationV1 }
export interface CatalogAdoptionV1 { project: CompleteProjectV6; addedDefinitionIds: string[]; operationCost: number }
export const CATALOG_LIMITS_V1 = {
  entries: 512, organizationRecords: 2048, batch: 64, tags: 32, tagCodePoints: 40, colors: 8,
  capsuleBytes: 32 * 1024 * 1024, storedCapsuleBytes: 128 * 1024 * 1024,
  backupBytes: 64 * 1024 * 1024, backupPayloadBytes: 47 * 1024 * 1024,
  adoptionOperations: 256,
} as const
