import type { CatalogOrganization, LibrarySnapshot, PreparedLibraryEntry } from '../../shared/library/types.js'
import type { BackupReceiptSummary, ConversionStage, CONVERTER_VERSION } from '../../shared/migration/types.js'
import type { ResourceOptions } from '../../shared/ports/resources.js'

export const LIBRARY_TARGET_FORMAT = 'sceneweave-asset-library@1' as const
export type OrganizationPolicy = 'keep-local' | 'replace-selected'
export interface ReserveLibraryConversion {
  sourceRepository: string; scopeId: string; sourceFingerprint: string
  entryKeys: string[]; organizationKeys: string[]; sourceContentHashes: Record<string, string>
}
export interface LibraryConversionInput {
  entries: PreparedLibraryEntry[]; organizations: Record<string, CatalogOrganization>
  sourceContentHashes: Record<string, string>; organizationPolicy: OrganizationPolicy
}
export interface LibraryConversionJob extends ReserveLibraryConversion {
  jobId: string; jobKey: string; converterVersion: typeof CONVERTER_VERSION; targetFormat: typeof LIBRARY_TARGET_FORMAT
  stage: ConversionStage; jobVersion: number; createdAt: string; updatedAt: string
  backupReceipt: BackupReceiptSummary | null; targetRevision: number | null; targetHash: string | null
  targetContentHashes: Record<string, string>; organizationPolicy: OrganizationPolicy | null; failure: string | null
}

/** Complete-scope preservation and publication use the same durable journal. */
export interface LibraryConversionStore {
  read(options?: ResourceOptions): Promise<LibrarySnapshot>
  getJob(jobId: string): Promise<LibraryConversionJob | null>
  reserveConversion(input: ReserveLibraryConversion, options?: ResourceOptions): Promise<LibraryConversionJob>
  advanceConversion(jobId: string, expectedVersion: number, stage: 'backup-verified' | 'failed' | 'cancelled',
    patch?: { backupReceipt?: unknown; failure?: string }, options?: ResourceOptions): Promise<LibraryConversionJob>
  prepareConversion(jobId: string, expectedVersion: number, input: LibraryConversionInput, options?: ResourceOptions): Promise<LibraryConversionJob>
  commitConversion(jobId: string, expectedVersion: number, input: LibraryConversionInput, options?: ResourceOptions): Promise<LibraryConversionJob>
  publishConversion(jobId: string, expectedVersion: number, options?: ResourceOptions): Promise<LibrarySnapshot>
  retryConversion(jobId: string, expectedVersion: number, options?: ResourceOptions): Promise<LibraryConversionJob>
}
