import type { BoundsMm, SceneDocumentV2 } from '../../core/v2/types'
import { readSelectionSummaryV2 } from './selection'

export interface SelectionSummaryV2 {
  /** The exact operation units, in the supplied order with duplicates removed. */
  ids: string[]
  count: number
  typeCounts: Record<string, number>
  effectiveLockedCount: number
  boundsMm: BoundsMm | null
  overCommandBudget: boolean
}

/**
 * Computes the small set of values needed by a multi-selection inspector.
 * It deliberately does not inspect full prop attributes or build operation
 * reasons. Those are deferred until the user requests a concrete action.
 */
export function summarizeSelectionV2(scene: SceneDocumentV2, ids: readonly string[], memberMode = false): SelectionSummaryV2 {
  return readSelectionSummaryV2(scene, ids, memberMode)
}
