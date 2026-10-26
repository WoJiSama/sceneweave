import { z } from 'zod'
import { visualBoundarySchema, visualEdgeLookSchema, visualEnvironmentSchema, visualFilterSchema, visualFogSchema, visualLightSchema } from '../visual/schema.js'
import { paint, overlay } from '../validation/primitives.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const point = z.object({ x: integer, y: integer }).strict()
const ids = z.array(id).max(256).refine(values => new Set(values).size === values.length)
// Tint/brightness require adopted real bitmap variants. This metadata-only
// recipe changes tiling/overlays; finite visual filters provide local grading.
const visualPaint = paint.extend({ tint: z.null() })
export const VisualAuthoringKindSchema = z.enum(['visualBoundary', 'visualEdge', 'visualLight', 'visualFog', 'visualFilter', 'visualEnvironment', 'visualSurface', 'furnishAlong', 'visualRemove'])
export const VisualAuthoringScopeSchema = z.object({ floorId: id, layerId: id,
  boundsMm: z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict(),
  entityIds: ids, definitionIds: ids, materialIds: ids,
  operations: z.array(VisualAuthoringKindSchema).min(1).max(9).refine(values => new Set(values).size === values.length),
  allowGlobalEnvironment: z.boolean().optional(),
}).strict()
export type VisualAuthoringScope = z.infer<typeof VisualAuthoringScopeSchema>
/** Read-only construction query; it is not a ledger operation or extra grant. */
export const TerrainBoundaryProposalSchema = z.object({ areaId: id, boundaryId: id,
  startPointId: id.optional(), smoothness: z.number().finite().min(0).max(1).optional(),
  sampleSpacingMm: integer.min(100).max(20_000).optional(), toleranceMm: integer.min(1).max(1000).optional(),
  reserveOperations: z.number().int().min(0).max(128).optional(),
}).strict()
export type TerrainBoundaryProposal = z.infer<typeof TerrainBoundaryProposalSchema>
export const VisualAuthoringOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('visualBoundary'), ...visualBoundarySchema.omit({ floorId: true, layerId: true, visibility: true, editLocked: true }).shape }).strict(),
  z.object({ kind: z.literal('visualEdge'), ...visualEdgeLookSchema.omit({ floorId: true, layerId: true, visibility: true, editLocked: true, kind: true }).shape,
    edgeKind: visualEdgeLookSchema.shape.kind }).strict(),
  z.object({ kind: z.literal('visualLight'), ...visualLightSchema.omit({ floorId: true, layerId: true, visibility: true, editLocked: true }).shape }).strict(),
  z.object({ kind: z.literal('visualFog'), ...visualFogSchema.omit({ floorId: true, layerId: true, visibility: true, editLocked: true }).shape }).strict(),
  z.object({ kind: z.literal('visualFilter'), ...visualFilterSchema.omit({ floorId: true, layerId: true, visibility: true, editLocked: true }).shape }).strict(),
  z.object({ kind: z.literal('visualEnvironment'), environment: visualEnvironmentSchema }).strict(),
  z.object({ kind: z.literal('visualRemove'), id, effectKind: z.enum(['edgeLook', 'light', 'fog', 'filter', 'boundary']), detach: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('visualSurface'), id, surfaceKind: z.enum(['room', 'terrainArea', 'wall', 'path', 'terrainEdge', 'terrainConnection']),
    style: z.object({ base: visualPaint.extend({ opacity: z.literal(1) }),
      overlays: z.array(overlay.extend({ boundaryMm: z.array(point).min(3).max(128), paint: visualPaint })).max(8)
        .refine(values => new Set(values.map(value => value.id)).size === values.length),
    }).strict().nullable(),
  }).strict(),
  z.object({ kind: z.literal('furnishAlong'), source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('boundary'), id }).strict(), z.object({ kind: z.literal('wall'), id }).strict(),
  ]), definitionId: id, supportRef: z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict(),
    count: z.number().int().min(1).max(16), startDistanceMm: integer.nonnegative(), spacingMm: integer.positive(), offsetMm: integer,
    rotationOffsetDeg: z.number().finite().min(-360).max(360).optional(),
  }).strict(),
])
export type VisualAuthoringOperation = z.infer<typeof VisualAuthoringOperationSchema>
export function isVisualAuthoringOperation(operation: { kind: string }): operation is VisualAuthoringOperation {
  return VisualAuthoringKindSchema.options.includes(operation.kind as z.infer<typeof VisualAuthoringKindSchema>)
}
