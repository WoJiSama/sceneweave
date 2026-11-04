import { z } from 'zod'
import * as v1 from './authoring-protocol-v1.js'
import * as v2 from './continuation-protocol.js'
import * as v3 from './continuation-protocol-v3.js'
import * as v4 from './authoring-protocol-v4.js'
export * from './authoring-protocol-v1.js'
export * from './continuation-protocol.js'
export * from './continuation-protocol-v3.js'
export * from './budget-policy.js'
export * from './authoring-protocol-v4.js'
export * from './authoring-closeout.js'
export * from './current-authoring-capability.js'
export type AuthoringScope = v1.AuthoringScope | v4.CurrentAuthoringScope
export const AuthoringOperationSchema = v4.AuthoringOperationV4Schema
export type AuthoringOperation = v4.AuthoringOperationV4
export const AuthoringStepSchema = v4.AuthoringStepV4Schema
export type AuthoringStep = v4.AuthoringStepV4
export const AuthoringStartSchema = z.union([v1.AuthoringStartSchema, v2.AuthoringStartV2Schema, v3.AuthoringStartV3Schema, v4.AuthoringStartV4Schema])
export type AuthoringStart = z.infer<typeof AuthoringStartSchema>
export const AuthoringStateSchema = z.union([v1.AuthoringStateSchema, v2.AuthoringStateV2Schema, v3.AuthoringStateV3Schema, v4.AuthoringStateV4Schema])
export type AuthoringState = z.infer<typeof AuthoringStateSchema>
export const AuthoringDraftSchema = z.union([v1.AuthoringDraftSchema, v2.AuthoringDraftV2Schema, v3.AuthoringDraftV3Schema, v4.AuthoringDraftV4Schema])
export type AuthoringDraft = z.infer<typeof AuthoringDraftSchema>
export const AuthoringSummarySchema = z.union([v1.AuthoringSummarySchema, v2.AuthoringSummaryV2Schema, v3.AuthoringSummaryV3Schema, v4.AuthoringSummaryV4Schema])
export type AuthoringSummary = z.infer<typeof AuthoringSummarySchema>
export const DraftStampSchema = z.union([v1.DraftStampSchema, v2.DraftStampV2Schema, v3.DraftStampV3Schema, v4.DraftStampV4Schema])
export type DraftStamp = z.infer<typeof DraftStampSchema>
export const DraftClaimSchema = z.union([v1.DraftClaimSchema, v2.DraftClaimV2Schema, v3.DraftClaimV3Schema, v4.DraftClaimV4Schema])
export type DraftClaim = z.infer<typeof DraftClaimSchema>
export const DraftValidationSchema = z.union([v1.DraftValidationSchema, v2.DraftValidationV2Schema, v3.DraftValidationV3Schema, v4.DraftValidationV4Schema])
export const DraftLeaseSchema = z.union([v1.DraftLeaseSchema, v2.DraftLeaseV2Schema, v3.DraftLeaseV3Schema, v4.DraftLeaseV4Schema])
export type DraftLease = z.infer<typeof DraftLeaseSchema>
export const DraftAppliedSchema = z.union([v1.DraftAppliedSchema, v2.DraftAppliedV2Schema, v3.DraftAppliedV3Schema, v4.DraftAppliedV4Schema])

export const isClassifiedVersion = (value: unknown): value is 2 | 3 | 4 => value === 2 || value === 3 || value === 4
export const isClassifiedAuthoring = (value: unknown): value is v2.AuthoringStartV2 | v3.AuthoringStartV3 | v4.AuthoringStartV4 => !!value && typeof value === 'object' && 'schemaVersion' in value && isClassifiedVersion(value.schemaVersion)
export const isClassifiedAuthoringState = (value: unknown): value is v2.AuthoringStateV2 | v3.AuthoringStateV3 | v4.AuthoringStateV4 => !!value && typeof value === 'object' && 'schemaVersion' in value && isClassifiedVersion(value.schemaVersion)
