import { z } from 'zod'

const id = z.string().min(1).max(120).refine(value => value !== '__proto__')
const mm = z.number().int().safe(), positive = mm.positive()
const point = z.object({ x: mm, y: mm }).strict()
const ref = z.object({ id: z.string().min(1).max(256).refine(value => value !== '__proto__'), version: positive }).strict()
const ring = z.array(point).min(3).max(128)
export const forestPaletteRoleSchema = z.enum(['tree', 'shrub', 'grass'])
export const forestSupportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('generated-ground') }).strict(),
  z.object({ kind: z.literal('terrainArea'), id: ref.shape.id }).strict(),
])
export const forestVegetationSchema = z.object({
  role: forestPaletteRoleSchema, coveragePpm: mm.min(0).max(1_000_000),
  spacingMm: positive.max(100_000), clusterRadiusMm: positive.max(100_000), clearanceMm: positive.max(10_000),
  palette: z.array(z.object({ key: id, definitionRef: ref, kind: z.enum(['prop', 'decoration']), weight: positive.max(1000) }).strict()).min(1).max(8),
}).strict()
export const forestParametersSchema = z.object({
  floorId: ref.shape.id, layerId: ref.shape.id,
  boundsMm: z.object({ x: mm, y: mm, width: positive.max(1_000_000), height: positive.max(1_000_000) }).strict(),
  ground: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('new'), elevationMm: mm.min(-100_000).max(100_000), materialRef: ref.nullable() }).strict(),
    z.object({ kind: z.literal('existing') }).strict(),
  ]),
  zones: z.array(z.object({ id, supportRef: forestSupportSchema, boundaryMm: ring, vegetation: z.array(forestVegetationSchema).min(1).max(3) }).strict()).min(1).max(8),
  clearings: z.array(z.object({ id, supportRef: forestSupportSchema, boundaryMm: ring, anchorMm: point, clearanceMm: mm.min(0).max(10_000) }).strict()).max(16),
  entrances: z.array(z.object({ id, supportRef: forestSupportSchema, positionMm: point, directionDeg: z.number().finite().min(0).lt(360), widthMm: positive.max(10_000) }).strict()).max(16),
  routes: z.array(z.object({ id, fromEntranceId: id, toClearingId: id, viaMm: z.array(point).max(16), widthMm: positive.max(10_000), materialRef: ref.nullable() }).strict()).max(16),
}).strict()
/** Algorithm 1 retains canonical materialization order; algorithm 2 places
 * trees before shrubs and grass without changing normalization or geometry. */
export const forestGenerationInputSchema = z.object({ version: z.literal(1), algorithmVersion: z.union([z.literal(1), z.literal(2)]), seed: z.string().min(1).max(128), parameters: forestParametersSchema }).strict()
export type ForestGenerationInput = z.infer<typeof forestGenerationInputSchema>
export type ForestParameters = z.infer<typeof forestParametersSchema>
export type ForestSupport = z.infer<typeof forestSupportSchema>
export type ForestVegetation = z.infer<typeof forestVegetationSchema>
export type ForestPaletteRole = z.infer<typeof forestPaletteRoleSchema>

export type ForestFailureCode = 'invalid-input' | 'unsupported' | 'contradiction' | 'search-exhausted' | 'budget-exceeded' | 'cancelled'
export class ForestGenerationError extends Error {
  constructor(readonly code: ForestFailureCode, message: string) { super(message); this.name = 'ForestGenerationError' }
}
