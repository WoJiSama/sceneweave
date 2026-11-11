import { z } from 'zod'
import { id, int, nonnegative, point, positive } from '../validation/primitives.js'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const cardinal = z.object({ x: z.number().int().min(-1).max(1), y: z.number().int().min(-1).max(1) }).strict()
  .refine(value => Math.abs(value.x) + Math.abs(value.y) === 1, '门口外法向须为明确正交单位方向')
const port = z.object({ openingId: id, roomId: id, floorId: id,
  supportRef: z.object({ kind: z.literal('terrainArea'), id }).strict(), elevationMm: int, positionMm: point,
  directionDeg: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), insideMm: point, outsideMm: point, widthMm: positive }).strict()

/** Consistency geometry; persisted identity proofs live in the separate fields
 * below and are compared to the real identity owner at content boundaries. */
export const pathAttachmentAnchorSchema = z.object({ version: z.literal(1), pathId: id, openingId: id, end: z.enum(['start', 'end']),
  wallId: id, wallVertexIds: z.tuple([id, id]), referenceVertexId: id, roomId: id, roomBoundaryVertexIds: z.array(id).min(3).max(256),
  outwardNormal: cardinal, port, leadLengthMm: positive, centerlineHash: digest, pointCount: z.number().int().min(3).max(128),
  supportRefsHash: digest, preservedTailHash: digest, preservedTailCount: z.number().int().min(1).max(126) }).strict()
export type PathAttachmentAnchorWitness = z.infer<typeof pathAttachmentAnchorSchema>
const proof = z.object({ birthToken: id, topologyToken: id }).strict()
export const pathAttachmentSchema = z.object({ id, version: z.literal(1), floorId: id, pathId: id, openingId: id,
  end: z.enum(['start', 'end']), leadLengthMm: positive, maxDisplacementMm: nonnegative, editLocked: z.boolean(), anchor: pathAttachmentAnchorSchema,
  proofs: z.object({ lineageId: id, path: proof, opening: proof, wall: proof, room: proof }).strict(),
}).strict()
export type PathAttachment = z.infer<typeof pathAttachmentSchema>
export const pathAttachmentRecordSchema = z.record(id, pathAttachmentSchema)
