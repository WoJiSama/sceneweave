import type { SceneDocumentV3, PropV2 } from '../v3/types'

/** V4 versions the project/history envelope; the intact scene remains strict v3. */
export interface HistoryIdentityV4 {
  version: 1
  lineageId: string
  rootSceneId: string
  /** Allocated identities, including deleted props; tokens are never reassigned. */
  propTokens: Record<string, string>
}

export type RestoreModeV4 = 'appearance' | 'transform' | 'entity'
export interface RestoreRequestV4 { ids: string[]; mode: RestoreModeV4 }
export interface RestoreChangeV4 {
  id: string
  name: string
  action: 'update' | 'recreate'
  layerId: string
  /** Current layer for an existing prop; null when the historical prop was deleted. */
  beforeLayerId: string | null
  /** Historical lock is review context only; restore never changes edit locks. */
  historicalEditLocked?: boolean
  before: Partial<PropV2> | null
  after: Partial<PropV2>
}
export interface RestorePlanV4 {
  request: RestoreRequestV4
  /** Current identity plus the historical tombstones required by this plan. */
  historyIdentity: HistoryIdentityV4
  document: SceneDocumentV3
  changes: RestoreChangeV4[]
  changed: boolean
}

export const HISTORY_LIMITS_V4 = Object.freeze({
  namedPerScene: 32,
  protectionPerScene: 32,
  archiveSnapshots: 64,
  identityProps: 65_536,
  storedResourceBytes: 256 * 1024 * 1024,
  storedDocumentBytes: 128 * 1024 * 1024,
  storedOriginalBytes: 128 * 1024 * 1024,
  archiveDocumentBytes: 128 * 1024 * 1024,
})
