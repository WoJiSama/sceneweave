import { z } from 'zod'

const mm = z.number().int().safe(), positive = mm.positive()
const id = z.string().min(1).max(120).refine(value => value !== '__proto__')
const point = z.object({ x: mm, y: mm }).strict()
const ring = z.array(point).min(3).max(64)
const ref = z.object({ id: z.string().min(1).max(256).refine(value => value !== '__proto__'), version: positive }).strict()
const movement = { blocksMovement: z.boolean(), movementCostMultiplier: z.number().finite().min(1).max(100) }
const connection = z.object({ kind: z.enum(['stairs', 'ramp']), fromMm: point, toMm: point }).strict()
export const volcanoParametersSchema = z.object({
  floorId: ref.shape.id, layerId: ref.shape.id,
  boundsMm: z.object({ x: mm, y: mm, width: positive.max(1_000_000), height: positive.max(1_000_000) }).strict(),
  groundElevationMm: mm.min(-100_000).max(100_000),
  mountain: z.object({ boundaryMm: ring, elevationMm: mm.min(-100_000).max(100_000) }).strict(),
  crater: z.object({ boundaryMm: ring, elevationMm: mm.min(-100_000).max(100_000), hazard: z.boolean(), ...movement }).strict(),
  platform: z.object({ boundaryMm: ring, anchorMm: point }).strict(),
  entrance: z.object({ positionMm: point, directionDeg: z.number().finite().min(0).lt(360) }).strict(),
  ascent: connection, descent: connection,
  route: z.object({ widthMm: positive.max(10_000), toPlatformViaMm: z.array(point).max(16), toCraterViaMm: z.array(point).max(16) }).strict(),
  flow: z.object({ centerlineMm: z.array(point).min(2).max(16), widthMm: positive.max(10_000), hazard: z.boolean(), ...movement }).strict().nullable(),
  regions: z.array(z.object({ id, boundaryMm: ring, hazard: z.boolean(), ...movement }).strict()).max(8),
  materials: z.object({ ground: ref, mountain: ref, crater: ref, platform: ref, flow: ref, route: ref }).strict(),
}).strict()
export const volcanoGenerationInputSchema = z.object({ version: z.literal(1), algorithmVersion: z.literal(1), seed: z.string().min(1).max(128), parameters: volcanoParametersSchema }).strict()
export type VolcanoGenerationInput = z.infer<typeof volcanoGenerationInputSchema>
export type VolcanoParameters = z.infer<typeof volcanoParametersSchema>
export type VolcanoFailureCode = 'invalid-input' | 'unsupported' | 'contradiction' | 'budget-exceeded' | 'cancelled'
export class VolcanoGenerationError extends Error {
  constructor(readonly code: VolcanoFailureCode, message: string) { super(message); this.name = 'VolcanoGenerationError' }
}
