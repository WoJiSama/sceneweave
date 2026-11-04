import { describe, expect, it } from 'vitest'
import { hasReviewableDraftRevision } from './ai-draft-reviewability'

describe('AI draft revision review gate', () => {
  it('admits a generated authoring4 baseline before any AI edit', () => {
    expect(hasReviewableDraftRevision({ schemaVersion: 4, draftRevision: 0, budget: { generationCost: 12 } })).toBe(true)
  })

  it('keeps empty current-baseline4 and legacy zero-revision drafts closed', () => {
    expect(hasReviewableDraftRevision({ schemaVersion: 4, draftRevision: 0, budget: { generationCost: 0 } })).toBe(false)
    expect(hasReviewableDraftRevision({ schemaVersion: 4, draftRevision: 0 })).toBe(false)
    for (const schemaVersion of [undefined, 1, 2, 3]) {
      expect(hasReviewableDraftRevision({ schemaVersion, draftRevision: 0, budget: { generationCost: 12 } })).toBe(false)
    }
    expect(hasReviewableDraftRevision(null)).toBe(false)
  })

  it('preserves the existing positive-revision path for every supported protocol', () => {
    for (const schemaVersion of [undefined, 1, 2, 3, 4]) {
      expect(hasReviewableDraftRevision({ schemaVersion, draftRevision: 1, budget: { generationCost: 0 } })).toBe(true)
    }
  })
})
