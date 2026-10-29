import type { SceneDocument } from './scene.js'
import type { HistoryIdentity } from './history.js'
import type { AppearanceGraph } from './appearance.js'

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
export interface SvgAuthoringSource {
  kind: 'svg'
  sourceSha256: string
  normalizedSha256: string
  sourceSizeBytes: number
  normalizedSizeBytes: number
  rasterSha256: string
  processorId: 'sceneweave-static-svg'
  processorVersion: 1
}

/** Persistable JSON only. Metadata validation does not certify resource bytes. */
export interface ProjectData {
  format: 'sceneweave-complete-project'
  /** v2 carries a strict scene-v2 visual system; v1 remains read without added fields. */
  schemaVersion: 1 | 2 | 3 | 4
  document: SceneDocument
  historyIdentity: HistoryIdentity
  appearance: AppearanceGraph
  assets: Record<string, AssetRecord>
  licenses: Record<string, LicenseTextRecord>
  licenseBindings: LicenseBinding[]
  authoringSources: Record<string, SvgAuthoringSource>
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
