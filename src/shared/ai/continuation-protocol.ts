import { z } from 'zod'
import { projectDataSchema } from '../project/validate.js'
import { BaseMapRequestV2Schema, BaseMapResponseV2Schema } from '../terrain-generation/base-map-v2.js'
import { BudgetPolicySchema } from './budget-policy.js'
import { AuthoringStartSchema, AuthoringStateSchema, AuthoringSummarySchema,
  DraftStampSchema, DraftClaimSchema, DraftLeaseSchema, DraftAppliedSchema, DraftValidationSchema } from './authoring-protocol-v1.js'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const ids = (limit: number) => z.array(id).max(limit).refine(values => new Set(values).size === values.length)
export const BudgetIdentitySchema = z.object({ policyHash: hash, sourceHash: hash, ledgerHeadHash: hash, budgetStateHash: hash }).strict()
export type BudgetIdentity = z.infer<typeof BudgetIdentitySchema>
export const BaseMapSourceSchema = z.object({
  version: z.literal(2), flowId: id, blank: projectDataSchema,
  preservation: z.object({ sceneId: id.nullable(), revision: count.nullable(), contentHash: hash.nullable(), checkpoint: count }).strict(),
  request: BaseMapRequestV2Schema, response: BaseMapResponseV2Schema,
  preparedAt: z.string().datetime(), identityAllocation: ids(8192), project: projectDataSchema, projectHash: hash,
  resourceClosureHash: hash,
  execution: z.object({ executor: z.enum(['worker', 'server']), startedAt: z.string().datetime(), completedAt: z.string().datetime(),
    activeRuntimeMs: count, generationCalls: count.min(1), materializationCalls: count.min(1) }).strict(),
}).strict()
export type BaseMapSource = z.infer<typeof BaseMapSourceSchema>
export const AuthoringStartV2Schema = AuthoringStartSchema.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal(2), policy: BudgetPolicySchema, source: BaseMapSourceSchema,
}).strict()
export type AuthoringStartV2 = z.infer<typeof AuthoringStartV2Schema>
export const BudgetStateSchema = z.object({ generationCost: count.max(256), aiCost: count.max(256),
  finalAdoptionCost: count.max(512), complexityCost: count.max(131072) }).strict()
export type BudgetState = z.infer<typeof BudgetStateSchema>
export const LedgerEntrySchema = z.object({ sequence: count.min(1).max(4097), operationId: id,
  category: z.enum(['generation', 'ai']), operationHash: hash, beforeHash: hash, afterHash: hash,
  targets: z.array(z.string().min(1).max(512)).max(512).refine(values => new Set(values).size === values.length), semanticCost: count.max(256), complexityCost: count.max(256),
  previousHash: hash, entryHash: hash,
}).strict()
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>
export const AuthoringStateV2Schema = AuthoringStateSchema.omit({ schemaVersion: true, operationCost: true, changedIds: true, readIds: true, writeIds: true }).extend({
  schemaVersion: z.literal(2), operationCost: count.max(512), changedIds: ids(8192), readIds: ids(16384), writeIds: ids(8192),
  ...BudgetIdentitySchema.shape, budget: BudgetStateSchema, ledger: z.array(LedgerEntrySchema).min(1).max(4097),
}).strict()
export type AuthoringStateV2 = z.infer<typeof AuthoringStateV2Schema>
export const AuthoringDraftV2Schema = z.object({ schemaVersion: z.literal(2), taskId: z.string().min(1).max(128), generation: count.min(1),
  start: AuthoringStartV2Schema, state: AuthoringStateV2Schema }).strict()
export const DraftStampV2Schema = DraftStampSchema.extend({ schemaVersion: z.literal(2), ...BudgetIdentitySchema.shape }).strict()
export const DraftClaimV2Schema = DraftClaimSchema.extend({ schemaVersion: z.literal(2), ...BudgetIdentitySchema.shape }).strict()
export const DraftValidationV2Schema = DraftValidationSchema.extend({ schemaVersion: z.literal(2), ...BudgetIdentitySchema.shape }).strict()
export const DraftLeaseV2Schema = DraftLeaseSchema.extend({ schemaVersion: z.literal(2), ...BudgetIdentitySchema.shape }).strict()
export const DraftAppliedV2Schema = DraftAppliedSchema.extend({ schemaVersion: z.literal(2), ...BudgetIdentitySchema.shape }).strict()
export const AuthoringSummaryV2Schema = AuthoringSummarySchema.omit({ operationCost: true, changedIds: true, claim: true }).extend({
  schemaVersion: z.literal(2), operationCost: count.max(512), changedIds: ids(8192), claim: DraftLeaseV2Schema.nullable(),
  ...BudgetIdentitySchema.shape, budget: BudgetStateSchema,
}).strict()
export type AuthoringDraftV2 = z.infer<typeof AuthoringDraftV2Schema>
export type DraftStampV2 = z.infer<typeof DraftStampV2Schema>
export type DraftClaimV2 = z.infer<typeof DraftClaimV2Schema>
export type DraftLeaseV2 = z.infer<typeof DraftLeaseV2Schema>
export type AuthoringSummaryV2 = z.infer<typeof AuthoringSummaryV2Schema>
