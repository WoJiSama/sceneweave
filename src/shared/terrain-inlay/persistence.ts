import { z } from 'zod'
import { connectionRouteSchema } from '../geometry/connection-route.js'
import { editable, visibility, surfaceRef, point, positive, id, movementCost, style } from '../validation/primitives.js'
import { terrainInlayRequestSchema } from './contracts.js'

/** Exact, inactive source connection. It is evidence and is never dispatched as
 * a second live route. Its coordinates retain their original world frame. */
export const terrainInlayOriginalSchema = z.object({ ...editable, visibility, kind: z.enum(['stairs', 'ramp']),
  from: z.object({ surfaceRef, positionMm: point }).strict(), to: z.object({ surfaceRef, positionMm: point }).strict(),
  widthMm: positive, openingId: id.nullable(), blocksMovement: z.boolean(), movementCostMultiplier: movementCost,
  surfaceStyle: style, route: connectionRouteSchema.optional(),
}).strict()
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const sourceProof = z.object({ areaId: id, birthToken: id, topologyToken: id, topologyHash: hash, geometryHash: hash }).strict()
/** Surface treatment over the saved continuous physical slope. Steps are a
 * drawn stone finish; they do not replace its support mesh or grant access. */
export const terrainInlayFinishSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slope') }).strict(),
  z.object({ kind: z.literal('steps'), treadDepthMm: z.number().int().min(50).max(2000) }).strict(),
])
export type TerrainInlayFinish = z.infer<typeof terrainInlayFinishSchema>
export const terrainInlaySchema = z.object({
  algorithmId: z.literal('terrain-inlay1'), algorithmVersion: z.literal(1),
  /** Explicit paint intent. Omission retains the saved independent road style. */
  appearance: z.literal('source-ground').optional(),
  finish: terrainInlayFinishSchema.optional(),
  geometry: terrainInlayRequestSchema,
  centerlineVertexIds: z.array(id).min(2).max(256),
  originalConnection: terrainInlayOriginalSchema,
  originalConnectionHash: hash, connectionBirthToken: id, lineageId: id,
  sourceProofs: z.array(sourceProof).length(2),
}).strict()
export type TerrainInlay = z.infer<typeof terrainInlaySchema>
