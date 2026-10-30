import * as legacy from './authoring-v1.js'
import { AuthoringSummarySchema, DraftStampSchema, type AuthoringOperation, type AuthoringStart, type AuthoringState,
  type AuthoringStep, type AuthoringSummary, type DraftLease } from './authoring-protocol.js'
import type { AuthoringPlanState } from './plan.js'
import type { AuthoringStart as LegacyStart, AuthoringState as LegacyState, DraftStamp as LegacyDraftStamp } from './authoring-protocol-v1.js'
import type { AuthoringStartV2, AuthoringStateV2, BudgetIdentity, DraftStampV2 } from './continuation-protocol.js'
import { canonicalJson, captureJson } from '../validation/json.js'
import { validateAuthoringStartV2, replayAuthoringV2, applyAuthoringStepV2, checkAuthoringStateV2, legacyAuthoringStart } from './continuation.js'
export { AUTHORING_SKILL, SCENE_AUTHORING_SKILL, AuthoringOperationError, authoringProjectHash } from './authoring-v1.js'
export type ReplayedAuthoring = ReturnType<typeof replayAuthoring>

export function validateAuthoringStart(input: LegacyStart): LegacyStart
export function validateAuthoringStart(input: AuthoringStartV2): AuthoringStartV2
export function validateAuthoringStart(input: AuthoringStart): AuthoringStart
export function validateAuthoringStart(input: AuthoringStart): AuthoringStart {
  const owned = captureJson(input)
  return owned.schemaVersion === 2 ? validateAuthoringStartV2(owned) : legacy.validateAuthoringStart(owned)
}
export function replayAuthoring(input: LegacyStart, steps: readonly AuthoringStep[]): legacy.ReplayedAuthoring
export function replayAuthoring(input: AuthoringStartV2, steps: readonly AuthoringStep[]): ReturnType<typeof replayAuthoringV2>
export function replayAuthoring(input: AuthoringStart, steps: readonly AuthoringStep[]): legacy.ReplayedAuthoring | ReturnType<typeof replayAuthoringV2>
export function replayAuthoring(input: AuthoringStart, steps: readonly AuthoringStep[]) {
  const owned = captureJson(input), capturedSteps = captureJson(steps)
  return owned.schemaVersion === 2 ? replayAuthoringV2(owned, capturedSteps) : legacy.replayAuthoring(owned, capturedSteps)
}
export function applyAuthoringStep(input: LegacyStart, state: LegacyState, operations: AuthoringOperation[], stepId: string): legacy.ReplayedAuthoring
export function applyAuthoringStep(input: AuthoringStartV2, state: AuthoringStateV2, operations: AuthoringOperation[], stepId: string): ReturnType<typeof replayAuthoringV2>
export function applyAuthoringStep(input: AuthoringStart, state: AuthoringState, operations: AuthoringOperation[], stepId: string): legacy.ReplayedAuthoring | ReturnType<typeof replayAuthoringV2>
export function applyAuthoringStep(input: AuthoringStart, state: AuthoringState, operations: AuthoringOperation[], stepId: string) {
  input = captureJson(input); state = captureJson(state); operations = captureJson(operations)
  if (input.schemaVersion !== state.schemaVersion) throw new Error('任务与草稿协议版本不同。')
  return input.schemaVersion === 2 && state.schemaVersion === 2 ? applyAuthoringStepV2(input, state, operations, stepId)
    : legacy.applyAuthoringStep(input as import('./authoring-protocol-v1.js').AuthoringStart, state as import('./authoring-protocol-v1.js').AuthoringState, operations, stepId)
}
export function checkAuthoringDraft(input: AuthoringStart, state: AuthoringState) {
  input = captureJson(input); state = captureJson(state)
  if (input.schemaVersion !== state.schemaVersion) throw new Error('任务与草稿协议版本不同。')
  if (input.schemaVersion !== 2 || state.schemaVersion !== 2) return legacy.checkAuthoringDraft(input as import('./authoring-protocol-v1.js').AuthoringStart, state as import('./authoring-protocol-v1.js').AuthoringState)
  const checked = checkAuthoringStateV2(input, state).state
  return { valid: true as const, operationCost: checked.operationCost, changedIds: [...checked.changedIds], readIds: [...checked.readIds], writeIds: [...checked.writeIds],
    ...authoringBudgetIdentity(checked), budget: checked.budget }
}
export function authoringSkill(input: AuthoringStart) {
  const skill = legacy.authoringSkill(input.schemaVersion === 2 ? legacyAuthoringStart(input) : input)
  return input.schemaVersion === 2 ? { ...skill, instructions: skill.instructions + ' This is a generated-map continuation under the fixed versioned policy. '
    + 'Generation targets are accounted separately and remain in the immutable ledger. AI edits have 256 semantic targets; repeated and no-op operations cost at least one. '
    + 'Visual authoring grants and deferred artwork are unsupported in this continuation policy; only the explicitly granted existing scene/prop operations are executable. '
    + 'Each operation retains the original finite geometry/expansion guards. Only the reviewed final result is adopted once after protection.' } : skill
}
export function authoringAssetPage(input: AuthoringStart, query: string, limit: number, offset = 0) {
  const start = validateAuthoringStart(input)
  return start.schemaVersion === 2 ? legacy.authoringAssetPageExpanded(legacyAuthoringStart(start), query, limit, offset)
    : legacy.authoringAssetPage(start, query, limit, offset)
}
export const findAuthoringAssets = (input: AuthoringStart, query: string, limit: number) => authoringAssetPage(input, query, limit).assets
export function publicAuthoringContext(input: AuthoringStart, state: AuthoringState): unknown {
  input = captureJson(input); state = captureJson(state)
  if (input.schemaVersion !== state.schemaVersion) throw new Error('任务与草稿协议版本不同。')
  if (input.schemaVersion !== 2 || state.schemaVersion !== 2) return legacy.publicAuthoringContext(input as import('./authoring-protocol-v1.js').AuthoringStart, state as import('./authoring-protocol-v1.js').AuthoringState)
  const replayed = checkAuthoringStateV2(input, state), expanded = legacy.replayAuthoringExpanded(legacyAuthoringStart(input), replayed.state.steps)
  const context = legacy.publicAuthoringContextForReplay(legacyAuthoringStart(input), expanded) as Record<string, unknown>
  return { ...context, operationCost: replayed.state.operationCost, remainingOperations: input.policy.aiTargets - replayed.state.budget.aiCost,
    ...authoringBudgetIdentity(replayed.state), budget: replayed.state.budget }
}
export function authoringBudgetIdentity(state: AuthoringStateV2): BudgetIdentity
export function authoringBudgetIdentity(state: LegacyState): Record<string, never>
export function authoringBudgetIdentity(state: AuthoringState): BudgetIdentity | Record<string, never>
export function authoringBudgetIdentity(state: AuthoringState): BudgetIdentity | Record<string, never> {
  return state.schemaVersion === 2 ? { policyHash: state.policyHash, sourceHash: state.sourceHash,
    ledgerHeadHash: state.ledgerHeadHash, budgetStateHash: state.budgetStateHash } : {}
}
export function authoringDraftStamp(state: LegacyState, generation: number): LegacyDraftStamp
export function authoringDraftStamp(state: AuthoringStateV2, generation: number): DraftStampV2
export function authoringDraftStamp(state: AuthoringState, generation: number): LegacyDraftStamp | DraftStampV2
export function authoringDraftStamp(state: AuthoringState, generation: number): LegacyDraftStamp | DraftStampV2 {
  return DraftStampSchema.parse({ expectedGeneration: generation, draftRevision: state.draftRevision, contentHash: state.contentHash,
    ...(state.schemaVersion === 2 ? { schemaVersion: 2, ...authoringBudgetIdentity(state) } : {}) })
}
export function authoringSummary(start: AuthoringStart, state: AuthoringState, claim: DraftLease | null, plan?: AuthoringPlanState): AuthoringSummary {
  if (start.schemaVersion !== state.schemaVersion || claim && claim.schemaVersion !== state.schemaVersion) throw new Error('任务、草稿及租约协议版本不同。')
  return AuthoringSummarySchema.parse({ draftRevision: state.draftRevision, contentHash: state.contentHash, operationCost: state.operationCost,
    changedIds: state.changedIds, skill: start.skill, claim, ...(plan ? { plan } : {}),
    ...(state.schemaVersion === 2 ? { schemaVersion: 2, ...authoringBudgetIdentity(state), budget: state.budget } : {}) })
}
export const remainingAuthoringOperations = (start: AuthoringStart, state: AuthoringState) => start.schemaVersion === 2 && state.schemaVersion === 2
  ? start.policy.aiTargets - state.budget.aiCost : 256 - state.operationCost
export function sameAuthoringBudgetIdentity(a: AuthoringState, b: AuthoringState): boolean {
  return a.schemaVersion === b.schemaVersion && canonicalJson(authoringBudgetIdentity(a)) === canonicalJson(authoringBudgetIdentity(b))
}
