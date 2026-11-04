import { ProfiledAuthoringScopeSchema } from './authoring-profile.js'
import { z } from 'zod'
import { projectDataSchema } from '../project/validate.js'
import { BaseMapRequestV3Schema, BaseMapResponseV3Schema } from '../terrain-generation/base-map-v3.js'
import { BudgetPolicyV2Schema } from './budget-policy.js'
import { BudgetUsageSchema } from '../budget/task-budget.js'
import { AuthoringStartSchema, AuthoringStateSchema, AuthoringSummarySchema,
  DraftStampSchema, DraftClaimSchema, DraftLeaseSchema, DraftAppliedSchema, DraftValidationSchema } from './authoring-protocol-v1.js'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const ids = (limit: number) => z.array(id).max(limit).refine(values => new Set(values).size === values.length)
import { BudgetIdentitySchema } from './continuation-protocol.js'
export const BaseMapSourceV3Schema = z.object({
  version: z.literal(3), flowId: id, blank: projectDataSchema,
  preservation: z.object({ sceneId: id.nullable(), revision: count.nullable(), contentHash: hash.nullable(), checkpoint: count }).strict(),
  request: BaseMapRequestV3Schema, response: BaseMapResponseV3Schema,
  preparedAt: z.string().datetime(), identityAllocation: ids(8192), project: projectDataSchema, projectHash: hash,
  resourceClosureHash: hash,
  execution: z.object({ executor: z.enum(['worker', 'server']), startedAt: z.string().datetime(), completedAt: z.string().datetime(),
    activeRuntimeMs: count, generationCalls: count.min(1), materializationCalls: count.min(1) }).strict(),
}).strict()
export type BaseMapSourceV3 = z.infer<typeof BaseMapSourceV3Schema>
export const AuthoringStartV3Schema = AuthoringStartSchema.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal(3), scope: ProfiledAuthoringScopeSchema, policy: BudgetPolicyV2Schema, source: BaseMapSourceV3Schema,
}).strict()
export type AuthoringStartV3 = z.infer<typeof AuthoringStartV3Schema>
export const BudgetStateV3Schema = z.object({ generationCost: count.max(2048), aiCost: count.max(2048),
  finalAdoptionCost: count.max(4096), usage: BudgetUsageSchema }).strict()
export type BudgetStateV3 = z.infer<typeof BudgetStateV3Schema>
export const LedgerEntryV3Schema = z.object({ sequence: count.min(1).max(4097), operationId: id,
  category: z.enum(['generation', 'ai']), operationHash: hash, beforeHash: hash, afterHash: hash,
  targets: z.array(z.string().min(1).max(512)).max(4096).refine(values => new Set(values).size === values.length), semanticCost: count.max(2048), usage: BudgetUsageSchema,
  previousHash: hash, entryHash: hash,
}).strict()
export type LedgerEntryV3 = z.infer<typeof LedgerEntryV3Schema>
export const AuthoringStateV3Schema = AuthoringStateSchema.omit({ schemaVersion: true, operationCost: true, changedIds: true, readIds: true, writeIds: true }).extend({
  schemaVersion: z.literal(3), operationCost: count.max(4096), changedIds: ids(8192), readIds: ids(16384), writeIds: ids(8192),
  ...BudgetIdentitySchema.shape, budget: BudgetStateV3Schema, ledger: z.array(LedgerEntryV3Schema).min(1).max(4097),
}).strict()
export type AuthoringStateV3 = z.infer<typeof AuthoringStateV3Schema>
export const AuthoringDraftV3Schema = z.object({ schemaVersion: z.literal(3), taskId: z.string().min(1).max(128), generation: count.min(1),
  start: AuthoringStartV3Schema, state: AuthoringStateV3Schema }).strict()
export const DraftStampV3Schema = DraftStampSchema.extend({ schemaVersion: z.literal(3), ...BudgetIdentitySchema.shape }).strict()
export const DraftClaimV3Schema = DraftClaimSchema.extend({ schemaVersion: z.literal(3), ...BudgetIdentitySchema.shape }).strict()
export const DraftValidationV3Schema = DraftValidationSchema.extend({ schemaVersion: z.literal(3), ...BudgetIdentitySchema.shape }).strict()
export const DraftLeaseV3Schema = DraftLeaseSchema.extend({ schemaVersion: z.literal(3), ...BudgetIdentitySchema.shape }).strict()
export const DraftAppliedV3Schema = DraftAppliedSchema.extend({ schemaVersion: z.literal(3), ...BudgetIdentitySchema.shape }).strict()
export const AuthoringSummaryV3Schema = AuthoringSummarySchema.omit({ operationCost: true, changedIds: true, claim: true }).extend({
  schemaVersion: z.literal(3), operationCost: count.max(4096), changedIds: ids(8192), claim: DraftLeaseV3Schema.nullable(),
  ...BudgetIdentitySchema.shape, budget: BudgetStateV3Schema,
}).strict()
export type AuthoringDraftV3 = z.infer<typeof AuthoringDraftV3Schema>
export type DraftStampV3 = z.infer<typeof DraftStampV3Schema>
export type DraftClaimV3 = z.infer<typeof DraftClaimV3Schema>
export type DraftLeaseV3 = z.infer<typeof DraftLeaseV3Schema>
export type AuthoringSummaryV3 = z.infer<typeof AuthoringSummaryV3Schema>
