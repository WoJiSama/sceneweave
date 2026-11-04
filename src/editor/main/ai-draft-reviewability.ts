interface DraftHead {
  schemaVersion?: number
  draftRevision: number
  budget?: { generationCost: number }
}

/** Generation is already a real ledger change in authoring4. This UI gate
 * grants no authority: exact replay, resources and protected adoption still run.
 */
export function hasReviewableDraftRevision(value: DraftHead | null | undefined): boolean {
  return !!value && (value.draftRevision > 0 || value.schemaVersion === 4 && (value.budget?.generationCost ?? 0) > 0)
}
