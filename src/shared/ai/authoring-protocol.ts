import { z } from 'zod'
import * as v1 from './authoring-protocol-v1.js'
import * as v2 from './continuation-protocol.js'
export * from './authoring-protocol-v1.js'
export * from './continuation-protocol.js'
export { CONTINUATION_POLICY, BudgetPolicySchema, type BudgetPolicy } from './budget-policy.js'
export const AuthoringStartSchema = z.union([v1.AuthoringStartSchema, v2.AuthoringStartV2Schema])
export type AuthoringStart = z.infer<typeof AuthoringStartSchema>
export const AuthoringStateSchema = z.union([v1.AuthoringStateSchema, v2.AuthoringStateV2Schema])
export type AuthoringState = z.infer<typeof AuthoringStateSchema>
export const AuthoringDraftSchema = z.union([v1.AuthoringDraftSchema, v2.AuthoringDraftV2Schema])
export type AuthoringDraft = z.infer<typeof AuthoringDraftSchema>
export const AuthoringSummarySchema = z.union([v1.AuthoringSummarySchema, v2.AuthoringSummaryV2Schema])
export type AuthoringSummary = z.infer<typeof AuthoringSummarySchema>
export const DraftStampSchema = z.union([v1.DraftStampSchema, v2.DraftStampV2Schema])
export type DraftStamp = z.infer<typeof DraftStampSchema>
export const DraftClaimSchema = z.union([v1.DraftClaimSchema, v2.DraftClaimV2Schema])
export type DraftClaim = z.infer<typeof DraftClaimSchema>
export const DraftValidationSchema = z.union([v1.DraftValidationSchema, v2.DraftValidationV2Schema])
export const DraftLeaseSchema = z.union([v1.DraftLeaseSchema, v2.DraftLeaseV2Schema])
export type DraftLease = z.infer<typeof DraftLeaseSchema>
export const DraftAppliedSchema = z.union([v1.DraftAppliedSchema, v2.DraftAppliedV2Schema])
