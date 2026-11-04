import { z } from 'zod'
import { sha256Text } from '../validation/hash.js'
import { canonicalJson, captureJson, freezeJson } from '../validation/json.js'

/** Runtime policy, deliberately independent of complete-project file versions. */
const policy = {
  policyId: 'sceneweave-generated-authoring', policyVersion: 1, countingVersion: 1,
  generationTargets: 256, aiTargets: 256, finalAdoptionTargets: 512,
  operationComplexity: 256, cumulativeComplexity: 131072,
  steps: 256, operationsPerStep: 16, readIds: 16384, writeIds: 8192,
  sourceBytes: 16 * 1024 * 1024, requestBytes: 24 * 1024 * 1024,
  modelRequests: 16, toolCalls: 64, activeExecutionMs: 300000,
  applicability: 'program-base-map-public-scene', evidence: 'roadmap-capacity-diagnostic-20261030',
} as const
export const CONTINUATION_POLICY = freezeJson({ ...policy, policyHash: sha256Text(canonicalJson(policy)) })
export const BudgetPolicySchema = z.object({
  policyId: z.literal(policy.policyId), policyVersion: z.literal(1), countingVersion: z.literal(1),
  generationTargets: z.literal(256), aiTargets: z.literal(256), finalAdoptionTargets: z.literal(512),
  operationComplexity: z.literal(256), cumulativeComplexity: z.literal(131072),
  steps: z.literal(256), operationsPerStep: z.literal(16), readIds: z.literal(16384), writeIds: z.literal(8192),
  sourceBytes: z.literal(policy.sourceBytes), requestBytes: z.literal(policy.requestBytes),
  modelRequests: z.literal(16), toolCalls: z.literal(64), activeExecutionMs: z.literal(300000),
  applicability: z.literal(policy.applicability), evidence: z.literal(policy.evidence), policyHash: z.literal(CONTINUATION_POLICY.policyHash),
}).strict()
export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>
export const parseBudgetPolicy = (input: unknown): BudgetPolicy => freezeJson(BudgetPolicySchema.parse(captureJson(input)))

import { BUDGET_DIMENSIONS, BudgetUsageSchema, TASK_BUDGET_PROFILES, TaskBudgetProfileSchema, parseTaskBudgetProfile,
  type BudgetUsage, type TaskBudgetProfile } from '../budget/task-budget.js'

/** Counting 2 has separate dimensions. Retained closures are admitted at their
 * peak; actual work accumulates. Paid request/tool/time allowances stay fixed. */
export const CONTINUATION_RETAINED_DIMENSIONS = Object.freeze(['geometryPoints', 'geometrySegments', 'curveSegments',
  'metadataRecords', 'metadataBytes', 'assetBytes', 'decodePixels'] as const)
const retained = new Set<keyof BudgetUsage>(CONTINUATION_RETAINED_DIMENSIONS)
function policyV2(profileInput: TaskBudgetProfile) {
  const profile = parseTaskBudgetProfile(profileInput)
  const cumulativeLimits = Object.fromEntries(BUDGET_DIMENSIONS.map(key => [key,
    key === 'semanticTargets' ? profile.semanticTargets * 2 : key === 'activeExecutionMs' || retained.has(key) ? profile.limits[key] : profile.limits[key] * 64])) as BudgetUsage
  const body = { policyId: 'sceneweave-generated-authoring' as const, policyVersion: 2 as const, countingVersion: 2 as const,
    profile, generationTargets: profile.semanticTargets, aiTargets: profile.semanticTargets, finalAdoptionTargets: profile.semanticTargets * 2,
    operationLimits: profile.limits, cumulativeLimits, steps: 256 as const, operationsPerStep: 16 as const, readIds: 16384 as const, writeIds: 8192 as const,
    sourceBytes: 32 * 1024 * 1024, requestBytes: 48 * 1024 * 1024,
    modelRequests: 16 as const, toolCalls: 64 as const, activeExecutionMs: 300000 as const,
    applicability: 'program-base-map-public-scene' as const, evidence: 'registered-task-budget-counting-2' as const }
  return freezeJson({ ...body, policyHash: sha256Text(canonicalJson(body)) })
}
export const CONTINUATION_POLICIES_V2 = freezeJson(Object.values(TASK_BUDGET_PROFILES).map(policyV2))
const rawV2 = z.object({ policyId: z.literal('sceneweave-generated-authoring'), policyVersion: z.literal(2), countingVersion: z.literal(2),
  profile: TaskBudgetProfileSchema, generationTargets: z.number().int(), aiTargets: z.number().int(), finalAdoptionTargets: z.number().int(),
  operationLimits: BudgetUsageSchema, cumulativeLimits: BudgetUsageSchema,
  steps: z.literal(256), operationsPerStep: z.literal(16), readIds: z.literal(16384), writeIds: z.literal(8192),
  sourceBytes: z.literal(32 * 1024 * 1024), requestBytes: z.literal(48 * 1024 * 1024),
  modelRequests: z.literal(16), toolCalls: z.literal(64), activeExecutionMs: z.literal(300000),
  applicability: z.literal('program-base-map-public-scene'), evidence: z.literal('registered-task-budget-counting-2'), policyHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export const BudgetPolicyV2Schema = rawV2.superRefine((value, context) => {
  const expected = CONTINUATION_POLICIES_V2.find(row => row.profile.profileHash === value.profile.profileHash)
  if (!expected || canonicalJson(value) !== canonicalJson(expected)) context.addIssue({ code: 'custom', message: '创作策略必须与注册档位和hash完全一致。' })
})
export type BudgetPolicyV2 = z.infer<typeof BudgetPolicyV2Schema>
export const createContinuationPolicyV2 = (profile: TaskBudgetProfile): BudgetPolicyV2 => freezeJson(BudgetPolicyV2Schema.parse(policyV2(profile)))
export const BUDGET_POLICY_HASHES = freezeJson([CONTINUATION_POLICY.policyHash, ...CONTINUATION_POLICIES_V2.map(row => row.policyHash)])
export const getBudgetPolicyByHash = (hash: string): BudgetPolicy | BudgetPolicyV2 | undefined => hash === CONTINUATION_POLICY.policyHash
  ? CONTINUATION_POLICY : CONTINUATION_POLICIES_V2.find(row => row.policyHash === hash)
export function accumulateContinuationUsage(before: BudgetUsage, delta: BudgetUsage): BudgetUsage {
  return BudgetUsageSchema.parse(Object.fromEntries(BUDGET_DIMENSIONS.map(key => [key,
    retained.has(key) ? Math.max(before[key], delta[key]) : before[key] + delta[key]])))
}
export function assertContinuationUsage(policy: BudgetPolicyV2, usage: BudgetUsage): void {
  for (const key of BUDGET_DIMENSIONS) if (usage[key] > policy.cumulativeLimits[key]) throw new Error(`AI累计预算超限[${key}]：${usage[key]}/${policy.cumulativeLimits[key]}。`)
}
