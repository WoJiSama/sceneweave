import type { SceneDocument } from './scene.js'
import type { HistoryIdentity } from './history.js'
import type { AppearanceGraph } from './appearance.js'
import type { SvgRasterProcessor } from '../ai/svg.js'
import type { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION } from '../project/format.js'

export interface AssetRecord {
  sha256: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  sizeBytes: number
  pixelWidth: number
  pixelHeight: number
}
export interface LicenseTextRecord { sha256: string; text: string }
export type LicenseSubjectKind = 'asset' | 'material' | 'propDefinition' | 'prefabDefinition' | 'styleTheme' | 'regionalSymbolDefinition'
export interface LicenseBinding {
  subjectKind: LicenseSubjectKind
  subjectId: string
  licenseRef: string
  licensePath: string
  embedding: 'allowed'
}
interface SvgSourceRecords {
  kind: 'svg'
  sourceSha256: string
  normalizedSha256: string
  sourceSizeBytes: number
  normalizedSizeBytes: number
  rasterSha256: string
}
export type SvgAuthoringSource = SvgSourceRecords & SvgRasterProcessor

/** GM-owned text, identified by publisher/package. Only its owner interprets the payload. */
export type ProjectExtensions = Record<string, { schemaVersion: number; data: string }>

/** Persistable JSON only. Metadata validation does not certify resource bytes. */
export interface ProjectData {
  format: typeof PROJECT_FORMAT
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  document: SceneDocument
  historyIdentity: HistoryIdentity
  appearance: AppearanceGraph
  assets: Record<string, AssetRecord>
  licenses: Record<string, LicenseTextRecord>
  licenseBindings: LicenseBinding[]
  authoringSources: Record<string, SvgAuthoringSource>
  extensions?: ProjectExtensions
}

const requiredProjectFields = Object.freeze(['format', 'schemaVersion', 'document', 'historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'] as const)
/** Optional branches preserve absence in strict wrappers, content hashes and old files. */
export function projectDataFields(project: object): readonly (keyof ProjectData)[] {
  return Object.hasOwn(project, 'extensions') ? [...requiredProjectFields, 'extensions'] : requiredProjectFields
}

/** An adapter supplies independently capturable bytes, never a validated flag. */
export interface ResourceBytePort { read(sha256: string): Promise<Uint8Array> }
export interface ProjectBundle { project: ProjectData; resources: ResourceBytePort }

export interface SnapshotSummary {
  id: string
  ownerSceneId: string
  lineageId: string
  sourceRevision: number
  name: string
  kind: 'named' | 'protection' | 'imported-auto'
  createdAt: string
  contentHash: string
}
