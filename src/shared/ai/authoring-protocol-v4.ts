import { z } from 'zod'
import { projectDataSchema } from '../project/validate.js'
import { connectionRouteSchema } from '../geometry/connection-route.js'
import { decorationClusterSchema, decorationSchema } from '../decorations/contracts.js'
import * as v1 from './authoring-protocol-v1.js'
import { BaseMapSourceV3Schema, BudgetStateV3Schema, LedgerEntryV3Schema } from './continuation-protocol-v3.js'
import { BudgetIdentitySchema } from './continuation-protocol.js'
import { BudgetPolicySchema, BudgetPolicyV2Schema } from './budget-policy.js'
import { ProfiledSceneAuthoringScopeSchema } from './authoring-profile.js'
import { CURRENT_AUTHORING_CAPABILITY } from './current-authoring-capability.js'
import { AuthoringCloseoutV4Schema } from './authoring-closeout.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const ids = (limit: number) => z.array(id).max(limit).refine(values => new Set(values).size === values.length)
const coordinate = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const point = z.object({ x: coordinate, y: coordinate }).strict()
const end = z.object({ surfaceRef: z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict(), positionMm: point }).strict()
const connection = z.object({ kind: z.literal('connection'), id, connectionKind: z.enum(['stairs', 'ramp']), from: end, to: end, widthMm: coordinate.positive(), openingId: id.optional(), blocksMovement: z.boolean().optional() }).strict()
export const CurrentSceneAuthoringOperationKindSchema = z.enum([...v1.SceneAuthoringOperationKindSchema.options,
  'connectionRoute', 'connectionRouteUpdate', 'decorationCluster', 'decorationRegenerate', 'decorationUpdate', 'decorationDelete', 'decorationDetach', 'decorationClusterDelete'])
export type CurrentSceneAuthoringOperationKind = z.infer<typeof CurrentSceneAuthoringOperationKindSchema>
export const CurrentSceneAuthoringScopeSchema = ProfiledSceneAuthoringScopeSchema.extend({
  operations: z.array(CurrentSceneAuthoringOperationKindSchema).min(1).max(64).refine(values => new Set(values).size === values.length),
}).strict()
export type CurrentSceneAuthoringScope = z.infer<typeof CurrentSceneAuthoringScopeSchema>
export const CurrentAuthoringScopeSchema = v1.AuthoringScopeSchema.extend({ targetIds: ids(2048),
  scene: CurrentSceneAuthoringScopeSchema.nullable().optional(), artwork: z.null().optional(),
}).strict()
export type CurrentAuthoringScope = z.infer<typeof CurrentAuthoringScopeSchema>
export const CurrentExtraOperationSchema = z.discriminatedUnion('kind', [
  connection.extend({ kind: z.literal('connectionRoute'), route: connectionRouteSchema }).strict(),
  z.object({ kind: z.literal('connectionRouteUpdate'), id, route: connectionRouteSchema.nullable() }).strict(),
  decorationClusterSchema.omit({ floorId: true, visibility: true, editLocked: true, algorithmVersion: true, members: true })
    .extend({ kind: z.literal('decorationCluster') }).strict(),
  z.object({ kind: z.literal('decorationRegenerate'), id }).strict(),
  z.object({ kind: z.literal('decorationUpdate'), id,
    changes: decorationSchema.pick({ positionMm: true, rotationDeg: true, scalePpm: true, renderOrder: true, supportRef: true }).partial().strict()
      .refine(value => Object.keys(value).length > 0) }).strict(),
  z.object({ kind: z.literal('decorationDelete'), id }).strict(),
  z.object({ kind: z.literal('decorationDetach'), clusterId: id, entityId: id }).strict(),
  z.object({ kind: z.literal('decorationClusterDelete'), id }).strict(),
])
export type CurrentExtraOperation = z.infer<typeof CurrentExtraOperationSchema>
/** Old schemas stay closed: only this explicit protocol admits the new commands. */
export const AuthoringOperationV4Schema = z.union([v1.AuthoringOperationSchema, CurrentExtraOperationSchema])
export type AuthoringOperationV4 = z.infer<typeof AuthoringOperationV4Schema>
export const AuthoringStepV4Schema = v1.AuthoringStepSchema.extend({ operations: z.array(AuthoringOperationV4Schema).min(1).max(16) }).strict()
export type AuthoringStepV4 = z.infer<typeof AuthoringStepV4Schema>
export const CurrentBaselineSourceV4Schema = z.object({ version: z.literal(4), kind: z.literal('current-baseline'), flowId: id,
  preservation: z.object({ sceneId: id, revision: count, contentHash: hash, checkpoint: count }).strict(),
  project: projectDataSchema, projectHash: hash, resourceClosureHash: hash,
}).strict()
export type CurrentBaselineSourceV4 = z.infer<typeof CurrentBaselineSourceV4Schema>
export const AuthoringStartV4Schema = v1.AuthoringStartSchema.omit({ schemaVersion: true, scope: true }).extend({
  schemaVersion: z.literal(4), capability: z.literal(CURRENT_AUTHORING_CAPABILITY), scope: CurrentAuthoringScopeSchema,
  policy: z.union([BudgetPolicySchema, BudgetPolicyV2Schema]), source: z.union([CurrentBaselineSourceV4Schema, BaseMapSourceV3Schema]),
}).strict()
export type AuthoringStartV4 = z.infer<typeof AuthoringStartV4Schema>
export const LedgerEntryV4Schema = LedgerEntryV3Schema.extend({ category: z.enum(['baseline', 'generation', 'ai']) }).strict()
export type LedgerEntryV4 = z.infer<typeof LedgerEntryV4Schema>
export const AuthoringStateV4Schema = v1.AuthoringStateSchema.omit({ schemaVersion: true, operationCost: true, changedIds: true, readIds: true, writeIds: true, steps: true }).extend({
  schemaVersion: z.literal(4), operationCost: count.max(4096), changedIds: ids(8192), readIds: ids(16384), writeIds: ids(8192),
  steps: z.array(AuthoringStepV4Schema).max(256), ...BudgetIdentitySchema.shape,
  budget: BudgetStateV3Schema, ledger: z.array(LedgerEntryV4Schema).min(1).max(4097),
}).strict()
export type AuthoringStateV4 = z.infer<typeof AuthoringStateV4Schema>
export const AuthoringDraftV4Schema = z.object({ schemaVersion: z.literal(4), taskId: z.string().min(1).max(128), generation: count.min(1), start: AuthoringStartV4Schema, state: AuthoringStateV4Schema }).strict()
export const DraftStampV4Schema = v1.DraftStampSchema.extend({ schemaVersion: z.literal(4), ...BudgetIdentitySchema.shape }).strict()
export const DraftClaimV4Schema = v1.DraftClaimSchema.extend({ schemaVersion: z.literal(4), ...BudgetIdentitySchema.shape }).strict()
export const DraftValidationV4Schema = v1.DraftValidationSchema.extend({ schemaVersion: z.literal(4), ...BudgetIdentitySchema.shape }).strict()
export const DraftLeaseV4Schema = v1.DraftLeaseSchema.extend({ schemaVersion: z.literal(4), ...BudgetIdentitySchema.shape }).strict()
export const DraftAppliedV4Schema = v1.DraftAppliedSchema.extend({ schemaVersion: z.literal(4), ...BudgetIdentitySchema.shape }).strict()
export const AuthoringSummaryV4Schema = v1.AuthoringSummarySchema.omit({ operationCost: true, changedIds: true, claim: true }).extend({
  schemaVersion: z.literal(4), operationCost: count.max(4096), changedIds: ids(8192), claim: DraftLeaseV4Schema.nullable(),
  ...BudgetIdentitySchema.shape, budget: BudgetStateV3Schema, closeout: AuthoringCloseoutV4Schema.optional(),
}).strict()
export type AuthoringDraftV4 = z.infer<typeof AuthoringDraftV4Schema>
export type DraftStampV4 = z.infer<typeof DraftStampV4Schema>
export type DraftClaimV4 = z.infer<typeof DraftClaimV4Schema>
export type DraftLeaseV4 = z.infer<typeof DraftLeaseV4Schema>
export type AuthoringSummaryV4 = z.infer<typeof AuthoringSummaryV4Schema>
export const isGeneratedAuthoringV4 = (start: AuthoringStartV4): start is AuthoringStartV4 & { source: z.infer<typeof BaseMapSourceV3Schema> } => start.source.version === 3

export const CurrentAuthoringScopeV4Schema = CurrentAuthoringScopeSchema
export type CurrentAuthoringScopeV4 = CurrentAuthoringScope
