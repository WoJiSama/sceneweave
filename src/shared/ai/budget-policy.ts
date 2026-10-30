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
