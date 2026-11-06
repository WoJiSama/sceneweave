import { z } from 'zod'

const id = z.string().min(1).max(120).refine(value => value !== '__proto__', '保留需求ID')
const integer = z.number().int().safe()
const positive = integer.positive()
const ref = z.object({ id, version: positive }).strict()
const bounds = z.object({ x: integer, y: integer, width: positive.max(1_000_000), height: positive.max(1_000_000) }).strict()
export const interiorFurnitureRoleSchema = z.enum(['bed', 'seat', 'table', 'storage', 'work', 'hearth', 'shelf'])
export type InteriorFurnitureRole = z.infer<typeof interiorFurnitureRoleSchema>
/** Native integer millimetres and square millimetres. This schema has no runtime
 * dependency on the scene/parser/generator, so persisted recipes can reuse it. */
export const interiorLayoutParametersSchema = z.object({ floorId: id, layerId: id, boundsMm: bounds,
  wallThicknessMm: positive.max(2000),
  rooms: z.array(z.object({ id, purpose: z.string().min(1).max(120), minAreaMm2: positive.max(1_000_000_000_000), maxAreaMm2: positive.max(1_000_000_000_000), minClearSideMm: positive.max(1_000_000) }).strict()).min(1).max(24),
  relations: z.array(z.object({ a: id, b: id, kind: z.enum(['adjacent', 'separate', 'no-direct-connection']), minimumSharedWallMm: integer.nonnegative().max(1_000_000) }).strict()).max(256),
  corridor: z.object({ axis: z.enum(['none', 'horizontal', 'vertical']), clearWidthMm: positive.max(1_000_000) }).strict(),
  materials: z.object({ floor: ref.nullable(), wall: ref.nullable() }).strict(),
  arrangement: z.object({ doors: z.boolean(), entrance: z.boolean(), furniture: z.boolean(), doorWidthMm: positive.max(5000), clearWidthMm: positive.max(5000),
    palette: z.array(z.object({ role: interiorFurnitureRoleSchema, ref }).strict()).max(64),
  }).strict(),
}).strict()
export const interiorGenerationInputSchema = z.object({ version: z.literal(1), algorithmVersion: z.literal(2), seed: z.string().min(1).max(128), parameters: interiorLayoutParametersSchema }).strict()
/** A separate replay contract adds real terrain support without changing the
 * original floor-only interior-layout@2 parameters or deterministic results. */
export const supportedInteriorParametersSchema = interiorLayoutParametersSchema.extend({
  supportRef: z.object({ kind: z.literal('terrainArea'), id }).strict(),
}).strict()
export const supportedInteriorGenerationInputSchema = z.object({ version: z.literal(1), algorithmVersion: z.literal(1), seed: z.string().min(1).max(128), parameters: supportedInteriorParametersSchema }).strict()
export type InteriorLayoutParameters = z.infer<typeof interiorLayoutParametersSchema>
export type InteriorGenerationInput = z.infer<typeof interiorGenerationInputSchema>
export type SupportedInteriorGenerationInput = z.infer<typeof supportedInteriorGenerationInputSchema>
export type InteriorRoomRequirement = InteriorLayoutParameters['rooms'][number]
export interface InteriorRectangle { x: number; y: number; width: number; height: number }
export interface InteriorLayout {
  readonly rooms: readonly { readonly requirementId: string; readonly roomId: string; readonly boundsMm: InteriorRectangle; readonly clearAreaMm2: number }[]
  readonly corridors: readonly { readonly roomId: string; readonly boundsMm: InteriorRectangle }[]
}
