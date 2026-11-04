import { validateAuthoringStartV4, replayAuthoringV4, applyAuthoringStepV4, checkAuthoringStateV4, legacyAuthoringStartV4, authoringAssetPageV4, publicAuthoringContextV4 } from './current-authoring.js'
import type { AuthoringStartV4, AuthoringStateV4, DraftStampV4 } from './authoring-protocol-v4.js'
import type { AuthoringCloseoutV4 } from './authoring-closeout.js'
export { applyAuthoringStageV4, createCurrentAuthoringStartV4, createGeneratedAuthoringStartV4, authoringExecutionWorkLimits, authoringOperationWorkLimits, currentAuthoringCreatedIds, publicAuthoringBudgetV4, isGeneratedAuthoringV4 } from './current-authoring.js'
import { isClassifiedAuthoring, isClassifiedAuthoringState, isClassifiedVersion } from './authoring-protocol.js'
export { isClassifiedAuthoring, isClassifiedAuthoringState, isClassifiedVersion } from './authoring-protocol.js'
import { validateAuthoringStartV3, replayAuthoringV3, applyAuthoringStepV3, checkAuthoringStateV3, legacyAuthoringStartV3 } from './continuation-v3.js'
import type { AuthoringStartV3, AuthoringStateV3, DraftStampV3 } from './continuation-protocol-v3.js'
import * as legacy from './authoring-v1.js'
import { AuthoringSummarySchema, DraftStampSchema, type AuthoringOperation, type AuthoringStart, type AuthoringState,
  type AuthoringStep, type AuthoringSummary, type DraftLease } from './authoring-protocol.js'
import type { AuthoringPlanState } from './plan.js'
import type { AuthoringStart as LegacyStart, AuthoringState as LegacyState, DraftStamp as LegacyDraftStamp, AuthoringStep as LegacyStep, AuthoringOperation as LegacyOperation } from './authoring-protocol-v1.js'
import type { AuthoringStartV2, AuthoringStateV2, BudgetIdentity, DraftStampV2 } from './continuation-protocol.js'
import { canonicalJson, captureJson } from '../validation/json.js'
import { validateAuthoringStartV2, replayAuthoringV2, applyAuthoringStepV2, checkAuthoringStateV2, legacyAuthoringStart } from './continuation.js'
export { AUTHORING_SKILL, SCENE_AUTHORING_SKILL, AuthoringOperationError, authoringProjectHash } from './authoring-v1.js'
export type ReplayedAuthoring = ReturnType<typeof replayAuthoring>

export function validateAuthoringStart(input: LegacyStart): LegacyStart
export function validateAuthoringStart(input: AuthoringStartV2): AuthoringStartV2
export function validateAuthoringStart(input: AuthoringStartV3): AuthoringStartV3
export function validateAuthoringStart(input: AuthoringStartV4): AuthoringStartV4
export function validateAuthoringStart(input: AuthoringStart): AuthoringStart
export function validateAuthoringStart(input: AuthoringStart): AuthoringStart {
  const owned = captureJson(input)
  return owned.schemaVersion === 4 ? validateAuthoringStartV4(owned) : owned.schemaVersion === 3 ? validateAuthoringStartV3(owned) : owned.schemaVersion === 2 ? validateAuthoringStartV2(owned) : legacy.validateAuthoringStart(owned)
}
export function replayAuthoring(input: LegacyStart, steps: readonly AuthoringStep[]): legacy.ReplayedAuthoring
export function replayAuthoring(input: AuthoringStartV2, steps: readonly AuthoringStep[]): ReturnType<typeof replayAuthoringV2>
export function replayAuthoring(input: AuthoringStartV3, steps: readonly AuthoringStep[]): ReturnType<typeof replayAuthoringV3>
export function replayAuthoring(input: AuthoringStartV4, steps: readonly AuthoringStep[]): ReturnType<typeof replayAuthoringV4>
export function replayAuthoring(input: AuthoringStart, steps: readonly AuthoringStep[]): legacy.ReplayedAuthoring | ReturnType<typeof replayAuthoringV2> | ReturnType<typeof replayAuthoringV3> | ReturnType<typeof replayAuthoringV4>
export function replayAuthoring(input: AuthoringStart, steps: readonly AuthoringStep[]) {
  const owned = captureJson(input), capturedSteps = captureJson(steps)
  return owned.schemaVersion === 4 ? replayAuthoringV4(owned, capturedSteps) : owned.schemaVersion === 3 ? replayAuthoringV3(owned, capturedSteps as LegacyStep[]) : owned.schemaVersion === 2 ? replayAuthoringV2(owned, capturedSteps as LegacyStep[]) : legacy.replayAuthoring(owned, capturedSteps as LegacyStep[])
}
export function applyAuthoringStep(input: LegacyStart, state: LegacyState, operations: AuthoringOperation[], stepId: string): legacy.ReplayedAuthoring
export function applyAuthoringStep(input: AuthoringStartV2, state: AuthoringStateV2, operations: AuthoringOperation[], stepId: string): ReturnType<typeof replayAuthoringV2>
export function applyAuthoringStep(input: AuthoringStartV3, state: AuthoringStateV3, operations: AuthoringOperation[], stepId: string): ReturnType<typeof replayAuthoringV3>
export function applyAuthoringStep(input: AuthoringStartV4, state: AuthoringStateV4, operations: AuthoringOperation[], stepId: string): ReturnType<typeof replayAuthoringV4>
export function applyAuthoringStep(input: AuthoringStart, state: AuthoringState, operations: AuthoringOperation[], stepId: string): legacy.ReplayedAuthoring | ReturnType<typeof replayAuthoringV2> | ReturnType<typeof replayAuthoringV3> | ReturnType<typeof replayAuthoringV4>
export function applyAuthoringStep(input: AuthoringStart, state: AuthoringState, operations: AuthoringOperation[], stepId: string) {
  input = captureJson(input); state = captureJson(state); operations = captureJson(operations)
  if (input.schemaVersion !== state.schemaVersion) throw new Error('任务与草稿协议版本不同。')
  return input.schemaVersion === 4 && state.schemaVersion === 4 ? applyAuthoringStepV4(input, state, operations, stepId)
    : input.schemaVersion === 3 && state.schemaVersion === 3 ? applyAuthoringStepV3(input, state, operations as LegacyOperation[], stepId)
    : input.schemaVersion === 2 && state.schemaVersion === 2 ? applyAuthoringStepV2(input, state, operations as LegacyOperation[], stepId)
    : legacy.applyAuthoringStep(input as import('./authoring-protocol-v1.js').AuthoringStart, state as import('./authoring-protocol-v1.js').AuthoringState, operations as LegacyOperation[], stepId)
}
export function checkAuthoringDraft(input: AuthoringStart, state: AuthoringState) {
  input = captureJson(input); state = captureJson(state)
  if (input.schemaVersion !== state.schemaVersion) throw new Error('任务与草稿协议版本不同。')
  if (!isClassifiedAuthoring(input) || !isClassifiedAuthoringState(state)) return legacy.checkAuthoringDraft(input as import('./authoring-protocol-v1.js').AuthoringStart, state as import('./authoring-protocol-v1.js').AuthoringState)
  const checked = input.schemaVersion === 4 && state.schemaVersion === 4 ? checkAuthoringStateV4(input, state).state
    : input.schemaVersion === 3 && state.schemaVersion === 3 ? checkAuthoringStateV3(input, state).state
    : checkAuthoringStateV2(input as AuthoringStartV2, state as AuthoringStateV2).state
  return { valid: true as const, operationCost: checked.operationCost, changedIds: [...checked.changedIds], readIds: [...checked.readIds], writeIds: [...checked.writeIds],
    ...authoringBudgetIdentity(checked), budget: checked.budget }
}
export function authoringSkill(input: AuthoringStart) {
  const skill = legacy.authoringSkill(input.schemaVersion === 4 ? legacyAuthoringStartV4(input) : input.schemaVersion === 3 ? legacyAuthoringStartV3(input) : input.schemaVersion === 2 ? legacyAuthoringStart(input) : input)
  if (input.schemaVersion === 4) return { ...skill, instructions: skill.instructions
    .replace('the whole draft has a 256-operation limit', input.policy.policyVersion === 2 ? `the draft has ${input.policy.aiTargets} AI semantic targets under its frozen registered profile` : 'the whole draft has a 256-operation limit')
    .replace('existing geometry, lock, dependency and 256-command rules', input.policy.policyVersion === 2 ? 'registered independent geometry/work/resource budgets and complete lock/dependency rules' : 'existing geometry, lock, dependency and 256-command rules')
    .replace('an explicitly saved scene-v2 copy', 'the explicit current-authoring@1 capability for the exact complete version')
    + ` Authoring4 has AI allowance ${input.policy.aiTargets}; final adoption is ${input.policy.policyVersion === 1 ? 256 : input.policy.finalAdoptionTargets}. Authoring4 only uses the frozen starting resource closure. SVG and resource creation are unsupported. Exact version capabilities apply: terrainGenerate/terrainEdit/regionalGenerate/regionalEdit complete3 only; terrainLocal complete4 only; connectionRoute/connectionRouteUpdate complete5–7; decorationCluster/decorationRegenerate/decorationUpdate/decorationDelete/decorationDetach/decorationClusterDelete complete6–7. Canopy region rules have no AI recipe. Curves use full sampled route and actual width; cluster palettes use exact definitionRef versions and persist all real members/manual/deleted records. Ordinary current-baseline tasks keep 256 actual expanded commands for the whole task; only verified source3 tasks use their declared registered profile. Stages contain at most64 recipes in internal16-recipe steps and install atomically. Read the current draft and exact stamp before staging. Preserve one final request and explain pending requirements honestly. A PNG can be reviewed only when explicitly supplied and bound to the current stamp; no image means needs_human_review. Final appearance confirmation belongs to the user.` }
  if (input.schemaVersion === 3) return { ...skill, instructions: skill.instructions
    .replace('the whole draft has a 256-operation limit', `the AI draft has ${input.policy.aiTargets} semantic targets`)
    .replace('existing geometry, lock, dependency and 256-command rules', 'registered independent geometry/work/resource budgets and complete lock/dependency rules')
    + ` Generated-map authoring3 policy ${input.policy.policyHash}; profile ${input.policy.profile.profileId}. Generation has ${input.policy.generationTargets} targets, AI has ${input.policy.aiTargets}, final adoption has ${input.policy.finalAdoptionTargets}. Repeated/no-op operations cost at least one semantic target. Separate per-operation and cumulative usage vectors are returned in context. The model request/tool/time allowances are unchanged at 16/64/300000ms. Visual grants and deferred artwork are unsupported. Review once and adopt after protection.` }
  return input.schemaVersion === 2 ? { ...skill, instructions: skill.instructions + ' This is a generated-map continuation under the fixed versioned policy. '
    + 'Generation targets are accounted separately and remain in the immutable ledger. AI edits have 256 semantic targets; repeated and no-op operations cost at least one. '
    + 'Visual authoring grants and deferred artwork are unsupported in this continuation policy; only the explicitly granted existing scene/prop operations are executable. '
    + 'Each operation retains the original finite geometry/expansion guards. Only the reviewed final result is adopted once after protection.' } : skill
}
export function authoringAssetPage(input: AuthoringStart, query: string, limit: number, offset = 0) {
  const start = validateAuthoringStart(input)
  return start.schemaVersion === 4 ? authoringAssetPageV4(start, query, limit, offset) : start.schemaVersion === 3 ? legacy.authoringAssetPageProfiled(legacyAuthoringStartV3(start), start.policy.profile, query, limit, offset)
    : start.schemaVersion === 2 ? legacy.authoringAssetPageExpanded(legacyAuthoringStart(start), query, limit, offset)
    : legacy.authoringAssetPage(start, query, limit, offset)
}
export const findAuthoringAssets = (input: AuthoringStart, query: string, limit: number) => authoringAssetPage(input, query, limit).assets
export function publicAuthoringContext(input: AuthoringStart, state: AuthoringState): unknown {
  input = captureJson(input); state = captureJson(state)
  if (input.schemaVersion !== state.schemaVersion) throw new Error('任务与草稿协议版本不同。')
  if (input.schemaVersion === 4 && state.schemaVersion === 4) return publicAuthoringContextV4(input, state)
  if (!isClassifiedAuthoring(input) || !isClassifiedAuthoringState(state)) return legacy.publicAuthoringContext(input as LegacyStart, state as LegacyState)
  const replayed = input.schemaVersion === 3 && state.schemaVersion === 3 ? checkAuthoringStateV3(input, state)
    : checkAuthoringStateV2(input as AuthoringStartV2, state as AuthoringStateV2)
  const base = input.schemaVersion === 3 ? legacyAuthoringStartV3(input) : legacyAuthoringStart(input as AuthoringStartV2)
  const context = legacy.publicAuthoringContextForReplay(base, { ...replayed, state: { ...replayed.state, schemaVersion: 1 } }) as Record<string, unknown>
  return { ...context, operationCost: replayed.state.operationCost, remainingOperations: input.policy.aiTargets - replayed.state.budget.aiCost,
    ...authoringBudgetIdentity(replayed.state), budget: replayed.state.budget, ...(input.schemaVersion === 3 ? { policy: input.policy } : {}) }

}
export function authoringBudgetIdentity(state: AuthoringStateV2 | AuthoringStateV3 | AuthoringStateV4): BudgetIdentity
export function authoringBudgetIdentity(state: LegacyState): Record<string, never>
export function authoringBudgetIdentity(state: AuthoringState): BudgetIdentity | Record<string, never>
export function authoringBudgetIdentity(state: AuthoringState): BudgetIdentity | Record<string, never> {
  return isClassifiedAuthoringState(state) ? { policyHash: state.policyHash, sourceHash: state.sourceHash,
    ledgerHeadHash: state.ledgerHeadHash, budgetStateHash: state.budgetStateHash } : {}
}
export function authoringDraftStamp(state: LegacyState, generation: number): LegacyDraftStamp
export function authoringDraftStamp(state: AuthoringStateV2, generation: number): DraftStampV2
export function authoringDraftStamp(state: AuthoringStateV3, generation: number): DraftStampV3
export function authoringDraftStamp(state: AuthoringStateV4, generation: number): DraftStampV4
export function authoringDraftStamp(state: AuthoringState, generation: number): LegacyDraftStamp | DraftStampV2 | DraftStampV3 | DraftStampV4
export function authoringDraftStamp(state: AuthoringState, generation: number): LegacyDraftStamp | DraftStampV2 | DraftStampV3 | DraftStampV4 {
  return DraftStampSchema.parse({ expectedGeneration: generation, draftRevision: state.draftRevision, contentHash: state.contentHash,
    ...(isClassifiedAuthoringState(state) ? { schemaVersion: state.schemaVersion, ...authoringBudgetIdentity(state) } : {}) })
}
export function authoringSummary(start: AuthoringStart, state: AuthoringState, claim: DraftLease | null, plan?: AuthoringPlanState, closeout?: AuthoringCloseoutV4): AuthoringSummary {
  if (start.schemaVersion !== state.schemaVersion || claim && claim.schemaVersion !== state.schemaVersion) throw new Error('任务、草稿及租约协议版本不同。')
  return AuthoringSummarySchema.parse({ draftRevision: state.draftRevision, contentHash: state.contentHash, operationCost: state.operationCost,
    changedIds: state.changedIds, skill: start.skill, claim, ...(plan ? { plan } : {}), ...(state.schemaVersion === 4 && closeout ? { closeout } : {}),
    ...(isClassifiedAuthoringState(state) ? { schemaVersion: state.schemaVersion, ...authoringBudgetIdentity(state), budget: state.budget } : {}) })
}
export const remainingAuthoringOperations = (start: AuthoringStart, state: AuthoringState) => isClassifiedAuthoring(start) && isClassifiedAuthoringState(state)
  ? start.policy.aiTargets - state.budget.aiCost : 256 - state.operationCost
export function sameAuthoringBudgetIdentity(a: AuthoringState, b: AuthoringState): boolean {
  return a.schemaVersion === b.schemaVersion && canonicalJson(authoringBudgetIdentity(a)) === canonicalJson(authoringBudgetIdentity(b))
}
