import { z } from 'zod'
import { projectDataSchema } from '../project/validate.js'
import { AuthoringBriefSchema, AuthoringPlanStateSchema } from './plan.js'
import { VisualAuthoringScopeSchema, VisualAuthoringOperationSchema } from './visual-protocol.js'

export const AUTHORING_LIMITS = Object.freeze({ metadataBytes: 4 * 1024 * 1024, requestBytes: 5 * 1024 * 1024,
  operations: 256, operationsPerStep: 16, steps: 256, modelRequests: 16, toolCalls: 64, maxOutputTokensPerRequest: 8192, executionMs: 300_000, claimMs: 30_000 })
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const point = z.object({ x: integer, y: integer }).strict()
const angle = z.number().finite().min(0).lt(360)
const ids = z.array(id).max(256).refine(values => new Set(values).size === values.length)
const bounds = z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict()
const surfaceRef = z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict()

/** A skill narrows capability; content names never select a skill or add scope. */
export const AuthoringSkillSchema = z.union([
  z.object({ id: z.literal('sceneweave-prop-authoring'), version: z.literal(1) }).strict(),
  z.object({ id: z.literal('sceneweave-scene-authoring'), version: z.literal(1) }).strict(),
  z.object({ id: z.literal('sceneweave-artwork-authoring'), version: z.literal(1) }).strict(),
])
export type AuthoringSkill = z.infer<typeof AuthoringSkillSchema>

export const SceneAuthoringOperationKindSchema = z.enum(['room', 'wall', 'vertex', 'opening', 'entrance', 'terrain', 'terrainUpdate', 'edge', 'connection', 'region', 'path', 'pathUpdate', 'scatter', 'scatterRegenerate', 'prefab', 'furnish', 'gmNote', 'gmNoteUpdate'])
export type SceneAuthoringOperationKind = z.infer<typeof SceneAuthoringOperationKindSchema>
export const SceneAuthoringScopeSchema = z.object({
  floorId: id,
  layerId: id,
  boundsMm: bounds,
  /** Existing public entities explicitly available as supports or anchors. */
  entityIds: ids,
  /** Fixed definitions/materials are capability grants, never an unrestricted search. */
  definitionIds: ids,
  prefabDefinitionIds: ids,
  materialIds: ids,
  operations: z.array(SceneAuthoringOperationKindSchema).min(1).max(18).refine(values => new Set(values).size === values.length),
}).strict()
export type SceneAuthoringScope = z.infer<typeof SceneAuthoringScopeSchema>
export const ArtworkScopeSchema = z.object({ mode: z.enum(['single', 'prefab', 'range']), targetIds: ids,
  operations: z.array(z.enum(['svg', 'style'])).min(1).max(2).refine(values => new Set(values).size === values.length),
  boundsMm: bounds.optional(),
  includeNewProps: z.boolean().optional(),
}).strict()
export const AuthoringScopeSchema = z.object({ targetIds: ids,
  placement: z.object({ floorId: id, layerId: id, supportRef: surfaceRef, boundsMm: bounds, definitionIds: ids }).strict().nullable(),
  operations: z.array(z.enum(['place', 'transform', 'opacity', 'delete'])).max(4).refine(values => new Set(values).size === values.length),
  scene: SceneAuthoringScopeSchema.nullable().optional(),
  artwork: ArtworkScopeSchema.nullable().optional(),
  visual: VisualAuthoringScopeSchema.nullable().optional(),
}).strict()
export type AuthoringScope = z.infer<typeof AuthoringScopeSchema>

const scatterDomain = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('area'), areaId: id }).strict(),
  z.object({ kind: z.literal('path'), pathId: id }).strict(),
  z.object({ kind: z.literal('edgeBand'), edgeId: id, widthMm: integer.positive() }).strict(),
])
const noteAnchor = z.discriminatedUnion('type', [
  z.object({ type: z.literal('point'), positionMm: point }).strict(),
  z.object({ type: z.literal('entity'), entityKind: z.enum(['vertex', 'room', 'wall', 'opening', 'prop', 'terrainArea', 'terrainEdge', 'terrainConnection', 'region', 'path', 'prefabInstance', 'scatterGroup', 'note']), entityId: id }).strict(),
])
const connectionEnd = z.object({ surfaceRef, positionMm: point }).strict()
export const SceneAuthoringOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('room'), id, boundaryMm: z.array(point).min(3).max(64), thicknessMm: integer.positive(), purpose: z.string().trim().min(1).max(1000).optional(), supportRef: z.object({ kind: z.enum(['floor', 'terrainArea']), id }).strict().optional(), materialId: id.optional() }).strict(),
  z.object({ kind: z.literal('wall'), id, thicknessMm: integer.positive().optional(), materialId: id.optional() }).strict()
    .refine(value => value.thicknessMm !== undefined || value.materialId !== undefined),
  z.object({ kind: z.literal('vertex'), id, positionMm: point }).strict(),
  z.object({ kind: z.literal('opening'), id, wallId: id, offsetReferenceVertexId: id, offsetMm: integer.nonnegative(), widthMm: integer.positive(), openingKind: z.enum(['door', 'window']), state: z.enum(['open', 'closed']).optional() }).strict(),
  z.object({ kind: z.literal('entrance'), openingIds: ids.min(1) }).strict(),
  z.object({ kind: z.literal('terrain'), id, boundaryMm: z.array(point).min(3).max(256), groundElevationMm: integer, coveragePriority: integer.min(0).max(1_000_000).optional(), materialId: id.optional(), blocksMovement: z.boolean().optional(), blocksSight: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('terrainUpdate'), id, boundaryMm: z.array(point).min(3).max(256).optional(), groundElevationMm: integer.optional(), coveragePriority: integer.min(0).max(1_000_000).optional(), materialId: id.optional(), blocksMovement: z.boolean().optional(), blocksSight: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 2),
  z.object({ kind: z.literal('edge'), id, areaId: id, segmentId: id, edgeKind: z.enum(['shore', 'cliff', 'materialTransition']), shoreline: z.boolean().optional(), blocksMovement: z.boolean().optional(), blocksSight: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('connection'), id, connectionKind: z.enum(['stairs', 'ramp']), from: connectionEnd, to: connectionEnd, widthMm: integer.positive(), openingId: id.optional(), blocksMovement: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('region'), id, boundaryMm: z.array(point).min(3).max(256), regionKind: z.enum(['terrain', 'hazard']), blocksMovement: z.boolean().optional(), movementCostMultiplier: z.number().finite().min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('path'), id, centerlineMm: z.array(point).min(2).max(64), widthMm: integer.positive(), supportRefs: z.array(surfaceRef).min(1).max(16).refine(values => new Set(values.map(value => `${value.kind}:${value.id}`)).size === values.length), materialId: id.optional() }).strict(),
  z.object({ kind: z.literal('pathUpdate'), id, centerlineMm: z.array(point).min(2).max(64).optional(), widthMm: integer.positive().optional(), supportRefs: z.array(surfaceRef).min(1).max(16).refine(values => new Set(values.map(value => `${value.kind}:${value.id}`)).size === values.length).optional(), materialId: id.optional() }).strict().refine(value => Object.keys(value).length > 2),
  z.object({ kind: z.literal('scatter'), id, domain: scatterDomain, palette: z.array(z.object({ definitionId: id, weight: z.number().finite().positive() }).strict()).min(1).max(32).refine(values => new Set(values.map(value => value.definitionId)).size === values.length), seed: z.string().min(1).max(128), cellSizeMm: integer.positive(), densityFactor: z.number().finite().min(0).max(1).optional(), minDistanceMm: integer.positive(), rotationMinDeg: angle.optional(), rotationMaxDeg: angle.optional() }).strict().refine(value => (value.rotationMinDeg ?? 0) <= (value.rotationMaxDeg ?? 359)),
  z.object({ kind: z.literal('scatterRegenerate'), id, densityFactor: z.number().finite().min(0).max(1).optional() }).strict(),
  z.object({ kind: z.literal('prefab'), id, definitionId: id, anchorMm: point, rotationDeg: angle.optional(), supportRef: surfaceRef }).strict(),
  z.object({ kind: z.literal('furnish'), id, definitionId: id, positionMm: point, rotationDeg: angle.optional(), supportRef: surfaceRef }).strict(),
  z.object({ kind: z.literal('gmNote'), id, anchor: noteAnchor, noteKind: z.enum(['note', 'clue', 'label']), title: z.string().trim().min(1).max(500).optional(), text: z.string().min(1).max(100_000) }).strict(),
  z.object({ kind: z.literal('gmNoteUpdate'), id, title: z.string().trim().min(1).max(500).optional(), text: z.string().min(1).max(100_000).optional() }).strict().refine(value => value.title !== undefined || value.text !== undefined),
])
export type SceneAuthoringOperation = z.infer<typeof SceneAuthoringOperationSchema>
export const ArtworkOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('svg'), id, sourceSvg: z.string().min(1).max(1024 * 1024), longEdgePx: z.number().int().min(16).max(1024), name: z.string().trim().min(1).max(120) }).strict(),
  z.object({ kind: z.literal('style'), ids: ids.min(1), tint: z.string().regex(/^#[a-f0-9]{6}$/i).nullable().optional(), brightness: z.number().finite().min(.25).max(2).optional(), opacity: z.number().finite().min(0).max(1).optional() }).strict()
    .refine(value => value.tint !== undefined || value.brightness !== undefined || value.opacity !== undefined),
])
export type ArtworkOperation = z.infer<typeof ArtworkOperationSchema>
export const AuthoringOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('place'), definitionId: id, positionMm: point, rotationDeg: angle.optional() }).strict(),
  z.object({ kind: z.literal('transform'), id, positionMm: point.optional(), rotationDeg: angle.optional() }).strict().refine(value => value.positionMm !== undefined || value.rotationDeg !== undefined),
  z.object({ kind: z.literal('opacity'), id, value: z.number().finite().min(0).max(1) }).strict(),
  z.object({ kind: z.literal('delete'), id }).strict(),
  ...SceneAuthoringOperationSchema.options,
  ...ArtworkOperationSchema.options,
  ...VisualAuthoringOperationSchema.options,
])
export type AuthoringOperation = z.infer<typeof AuthoringOperationSchema>
export const AuthoringStartSchema = z.object({ schemaVersion: z.literal(1), project: projectDataSchema, baseContentHash: hash,
  scope: AuthoringScopeSchema, seed: z.string().uuid(), preparedAt: z.string().datetime(),
  skill: AuthoringSkillSchema,
  disclosure: z.literal('complete-metadata/public-model'),
  brief: AuthoringBriefSchema.optional(),
}).strict()
export type AuthoringStart = z.infer<typeof AuthoringStartSchema>
export const AuthoringStepSchema = z.object({ index: z.number().int().positive().max(AUTHORING_LIMITS.steps), stepId: id,
  operations: z.array(AuthoringOperationSchema).min(1).max(AUTHORING_LIMITS.operationsPerStep) }).strict()
export type AuthoringStep = z.infer<typeof AuthoringStepSchema>
export const AuthoringStateSchema = z.object({ schemaVersion: z.literal(1), draftRevision: z.number().int().min(0).max(AUTHORING_LIMITS.steps),
  contentHash: hash, operationCost: z.number().int().min(0).max(256), changedIds: ids, readIds: z.array(id).max(4096), writeIds: ids,
  steps: z.array(AuthoringStepSchema).max(AUTHORING_LIMITS.steps) }).strict()
export type AuthoringState = z.infer<typeof AuthoringStateSchema>
export const AuthoringDraftSchema = z.object({ schemaVersion: z.literal(1), taskId: z.string().min(1).max(128), generation: z.number().int().positive(),
  start: AuthoringStartSchema, state: AuthoringStateSchema }).strict()
export type AuthoringDraft = z.infer<typeof AuthoringDraftSchema>
export const DraftStampSchema = z.object({ expectedGeneration: z.number().int().positive(), draftRevision: z.number().int().min(0), contentHash: hash }).strict()
export type DraftStamp = z.infer<typeof DraftStampSchema>
export const DraftValidationSchema = DraftStampSchema.extend({ valid: z.boolean() }).strict()
export const DraftClaimSchema = DraftStampSchema.extend({ claimId: z.string().uuid() }).strict()
export type DraftClaim = z.infer<typeof DraftClaimSchema>
export const DraftLeaseSchema = z.object({ schemaVersion: z.literal(1), taskId: z.string().min(1).max(128), generation: z.number().int().positive(),
  draftRevision: z.number().int().min(0), contentHash: hash, claimId: z.string().uuid(), serverNow: z.number().int().min(0), expiresAt: z.number().int().min(0) }).strict()
export type DraftLease = z.infer<typeof DraftLeaseSchema>
export const DraftAppliedSchema = DraftClaimSchema.extend({ sceneId: id, revision: z.number().int().min(0) }).strict()
export const AuthoringSummarySchema = z.object({ draftRevision: z.number().int().min(0), contentHash: hash, operationCost: z.number().int().min(0).max(256),
  changedIds: ids, skill: AuthoringSkillSchema, claim: DraftLeaseSchema.nullable(), plan: AuthoringPlanStateSchema.optional() }).strict()
export type AuthoringSummary = z.infer<typeof AuthoringSummarySchema>
