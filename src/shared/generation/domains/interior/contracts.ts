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
/** Explicit replay selectors: v2 keeps legacy identity-sensitive ordering;
 * v3 separates layout choices from entity identities; v4 adds finite oriented
 * furniture and functional seating candidates; v5 reserves complete functional
 * seats and their rear use space before accepting a work/table anchor; v6
 * fulfils fixed seat reservations and joins finite kitchen work groups; v7
 * preserves usable bedside access and suggests nearby storage; v8 connects
 * functional use strips to actual open doors with full-width obstacle routing;
 * v9 schedules complete bedroom/kitchen units and tries full bed/storage envelopes;
 * v10 ranks finite room proportions and compares full/shortened corridor families;
 * v11 diversifies root groups and composes complete furniture functions;
 * v12 retains the v11 layout family and aligns complete dining groups.
 * v13 explicitly enables a bounded graph built from reached intersections;
 * v14 ranks group and fallback table poses by the same actual long axis.
 * v15 plans full-depth parallel kitchen runs and places pending worktops before optional storage.
 * v16 conservatively prunes impossible partial room contacts within the same search budget.
 * v17 replans obstructed structural routes at the same full width, door and endpoints.
 * v18 plans complete dining seats against fitting edges and prioritizes kitchen functions.
 * v19 proposes complete seated office/reception units with single-sided work seats. */
export const interiorGenerationInputSchema = z.object({ version: z.literal(1), algorithmVersion: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.literal(12), z.literal(13), z.literal(14), z.literal(15), z.literal(16), z.literal(17), z.literal(18), z.literal(19)]), seed: z.string().min(1).max(128), parameters: interiorLayoutParametersSchema }).strict()
/** A separate replay contract adds real terrain support without changing the
 * original floor-only interior-layout@2 parameters or deterministic results. */
export const supportedInteriorParametersSchema = interiorLayoutParametersSchema.extend({
  supportRef: z.object({ kind: z.literal('terrainArea'), id }).strict(),
}).strict()
export const buildingEntranceApproachSchema = z.object({ fromMm: z.object({ x: integer, y: integer }).strict(), viaMm: z.array(z.object({ x: integer, y: integer }).strict()).max(16), widthMm: positive.max(5000) }).strict()
export type BuildingEntranceApproach = z.infer<typeof buildingEntranceApproachSchema>
export const approachedInteriorParametersSchema = supportedInteriorParametersSchema.extend({ entranceApproach: buildingEntranceApproachSchema }).strict()
const legacySupportedInteriorGenerationInputSchema = z.object({ version: z.literal(1), algorithmVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9)]), seed: z.string().min(1).max(128), parameters: supportedInteriorParametersSchema }).strict()
export const supportedInteriorGenerationInputSchema = z.union([legacySupportedInteriorGenerationInputSchema, z.object({ version: z.literal(1), algorithmVersion: z.literal(10), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(11), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(12), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(13), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(14), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(15), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(16), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(17), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(18), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict(), z.object({ version: z.literal(1), algorithmVersion: z.literal(19), seed: z.string().min(1).max(128), parameters: approachedInteriorParametersSchema }).strict()])
export type InteriorLayoutParameters = z.infer<typeof interiorLayoutParametersSchema>
export type InteriorGenerationInput = z.infer<typeof interiorGenerationInputSchema>
export type SupportedInteriorGenerationInput = z.infer<typeof supportedInteriorGenerationInputSchema>
const supportedInteriorLayoutVersions = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14, 15: 15, 16: 16, 17: 17, 18: 18, 19: 19 } as const
export const supportedInteriorLayoutVersion = (version: SupportedInteriorGenerationInput['algorithmVersion']) => supportedInteriorLayoutVersions[version]
export type InteriorRoomRequirement = InteriorLayoutParameters['rooms'][number]
export interface InteriorRectangle { x: number; y: number; width: number; height: number }
export interface InteriorLayout {
  readonly rooms: readonly { readonly requirementId: string; readonly roomId: string; readonly boundsMm: InteriorRectangle; readonly clearAreaMm2: number }[]
  readonly corridors: readonly { readonly roomId: string; readonly boundsMm: InteriorRectangle }[]
}
