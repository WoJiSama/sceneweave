import { z } from 'zod'
import { angle, id, int, nonnegative, point, positive, unique } from '../validation/primitives.js'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const attachmentBirthProofSchema = z.object({ birthToken: id, topologyToken: id.optional(), topologyHash: digest.optional() }).strict()
  .refine(value => Boolean(value.topologyToken) === Boolean(value.topologyHash), '拓扑令牌与摘要须同时提供')
export type AttachmentBirthProof = z.infer<typeof attachmentBirthProofSchema>
export const attachmentOwnerSchema = z.object({ kind: z.enum(['prop', 'wall', 'terrainArea', 'terrainConnection']), id }).strict()
export type AttachmentOwner = z.infer<typeof attachmentOwnerSchema>
export const attachmentFeatureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('propTop'), polygonLocalMm: z.array(point).min(3).max(128), heightLocalMm: nonnegative }).strict(),
  z.object({ kind: z.literal('wallSide'), referenceVertexId: id, side: z.enum(['left', 'right']), startMm: nonnegative, endMm: positive, lowMm: int, highMm: int }).strict()
    .refine(value => value.endMm > value.startMm && value.highMm > value.lowMm, '墙侧面区间须为正长和正高'),
  z.object({ kind: z.literal('rockSourceFace'), sourceSegmentIds: z.array(id).min(1).max(128).refine(unique, '源边不能重复') }).strict(),
  z.object({ kind: z.literal('carvedWalk'), faceIds: z.array(id).min(1).max(512).refine(unique, '实际面片不能重复') }).strict(),
])
export type AttachmentFeature = z.infer<typeof attachmentFeatureSchema>
export const attachmentSurfaceIntentSchema = z.object({ id, owner: attachmentOwnerSchema, feature: attachmentFeatureSchema,
  capabilities: z.array(z.enum(['support', 'hang', 'embed', 'walk'])).min(1).max(4).refine(unique, '表面能力不能重复') }).strict()
export const attachmentSurfaceSchema = attachmentSurfaceIntentSchema.extend({ proofs: z.object({ lineageId: id, owner: attachmentBirthProofSchema }).strict() }).strict()
export type AttachmentSurface = z.infer<typeof attachmentSurfaceSchema>
export const attachmentAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('horizontal'), localMm: point, heightOffsetMm: int, rotationOffsetDeg: angle }).strict(),
  z.object({ kind: z.literal('vertical'), referenceVertexId: id, alongMm: nonnegative, heightMm: int, heightExtentMm: positive,
    normalOffsetMm: nonnegative, rotationOffsetDeg: angle }).strict(),
  z.object({ kind: z.literal('rockEdgeChain'), sourceSegmentIds: z.array(id).min(1).max(128).refine(unique, '源边不能重复'), cutSide: z.enum(['left', 'right']) }).strict(),
])
export type AttachmentAnchor = z.infer<typeof attachmentAnchorSchema>
const surfaceProof = attachmentBirthProofSchema.safeExtend({ surfaceId: id }).refine(value => Boolean(value.topologyToken), '表面须有独立拓扑证明')
export const attachmentProofsSchema = z.object({ lineageId: id, child: attachmentBirthProofSchema,
  surfaces: z.array(surfaceProof).min(1).max(128).refine(values => new Set(values.map(value => value.surfaceId)).size === values.length, '表面证明不能重复') }).strict()
const base = { id, follow: z.enum(['fixed', 'follow']), anchorState: z.enum(['managed', 'manual']), proofs: attachmentProofsSchema }
const propRelation = z.object({ ...base, mode: z.enum(['support', 'hang']), child: z.object({ kind: z.literal('prop'), id }).strict(),
  surfaceId: id, anchor: attachmentAnchorSchema, managedScope: z.literal('placement'),
  materialized: z.object({ contactElevationMm: int, childGeometryHash: digest, surfaceGeometryHash: digest }).strict() }).strict()
const embedRelation = z.object({ ...base, mode: z.literal('embed'), child: z.object({ kind: z.literal('terrainConnection'), id }).strict(),
  surfaceIds: z.array(id).min(1).max(128).refine(unique, '宿主面不能重复'),
  anchor: attachmentAnchorSchema.options[2], managedScope: z.enum(['wholeStrip', 'stripManagedStations']),
  materialized: z.object({ stripGeometryHash: digest, sourceGeometryHash: digest }).strict() }).strict()
export const attachmentSchema = z.union([propRelation, embedRelation])
export type Attachment = z.infer<typeof attachmentSchema>
export type PropAttachment = Extract<Attachment, { mode: 'support' | 'hang' }>
export type EmbedAttachment = Extract<Attachment, { mode: 'embed' }>
export const attachmentSurfaceRecordSchema = z.record(id, attachmentSurfaceSchema)
export const attachmentRecordSchema = z.record(id, attachmentSchema)
