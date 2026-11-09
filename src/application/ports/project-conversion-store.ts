import type { ProjectBundle } from '../../shared/model/project.js'
import type { ConversionJob, ConvertedFamily } from '../../shared/migration/types.js'
import type { ResourceOptions } from '../../shared/ports/resources.js'

export interface ReserveConversionJob {
  sourceRepository: string
  scopeId: string
  sourceFingerprint: string
  snapshotKeys: string[]
  sourceContentHashes: Record<string, string>
}

/** Durable conversion stages; the adapter owns atomic journal/target CAS. */
export interface ProjectConversionStore {
  getJob(jobId: string): Promise<ConversionJob | null>
  reserveJob(input: ReserveConversionJob, options?: ResourceOptions): Promise<ConversionJob>
  advanceJob(jobId: string, expectedVersion: number, stage: 'backup-verified' | 'failed' | 'cancelled',
    patch?: { backupReceipt?: unknown; failure?: string }, options?: ResourceOptions): Promise<ConversionJob>
  prepareConversion(jobId: string, expectedVersion: number, input: ConvertedFamily, options?: ResourceOptions): Promise<ConversionJob>
  commitConversion(jobId: string, expectedVersion: number, input: ConvertedFamily, options?: ResourceOptions): Promise<ConversionJob>
  publishConversion(jobId: string, expectedVersion: number, options?: ResourceOptions): Promise<ProjectBundle>
  retryJob(jobId: string, expectedVersion: number, options?: ResourceOptions): Promise<ConversionJob>
  load(sceneId: string, options?: ResourceOptions): Promise<ProjectBundle | null>
}
