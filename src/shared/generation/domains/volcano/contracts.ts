import { z } from 'zod'

const mm = z.number().int().safe(), positive = mm.positive()
const id = z.string().min(1).max(120).refine(value => value !== '__proto__')
const point = z.object({ x: mm, y: mm }).strict()
const ring = z.array(point).min(3).max(64)
const ref = z.object({ id: z.string().min(1).max(256).refine(value => value !== '__proto__'), version: positive }).strict()
const movement = { blocksMovement: z.boolean(), movementCostMultiplier: z.number().finite().min(1).max(100) }
const connection = z.object({ kind: z.enum(['stairs', 'ramp']), fromMm: point, toMm: point }).strict()
export const volcanoSideSchema = z.enum(['west', 'east', 'north', 'south'])
export const volcanoShapeSchema = z.enum(['natural', 'terrace'])
export const volcanoBreachSchema = z.union([volcanoSideSchema, z.literal('none')])
export const volcanoPercentSchema = z.number().gt(0).lt(100)
export const volcanoWidthSchema = positive
export const VOLCANO_DEFAULTS = Object.freeze({
  widthMm: 40000, heightMm: 32000, seed: 'sceneweave', mountainElevationMm: 2000, craterElevationMm: 500,
  craterWidthPercent: 32, craterHeightPercent: 36, craterCenterYPercent: 50,
  routeWidthMm: 1500, connectionKind: 'stairs', shape: 'natural', entranceSide: 'west', breachSide: 'east',
  craterHazard: true, craterBlocksMovement: false, craterMovementCostMultiplier: 2,
  flowEnabled: true, flowWidthMm: 1800, lavaAppearance: 'hot', flowHazard: true,
  flowBlocksMovement: true, flowMovementCostMultiplier: 3,
} as const)
export const VOLCANO_CALDERA_VERSION = 2
export const volcanoParametersSchema = z.object({
  floorId: ref.shape.id, layerId: ref.shape.id,
  relief: z.literal('caldera-v1').optional(),
  boundsMm: z.object({ x: mm, y: mm, width: positive.max(1_000_000), height: positive.max(1_000_000) }).strict(),
  groundElevationMm: mm.min(-100_000).max(100_000),
  mountain: z.object({ boundaryMm: ring, elevationMm: mm.min(-100_000).max(100_000) }).strict(),
  crater: z.object({ boundaryMm: ring, elevationMm: mm.min(-100_000).max(100_000), hazard: z.boolean(), ...movement }).strict(),
  platform: z.object({ boundaryMm: ring, anchorMm: point }).strict(),
  entrance: z.object({ positionMm: point, directionDeg: z.number().finite().min(0).lt(360) }).strict(),
  ascent: connection, descent: connection,
  route: z.object({ widthMm: positive.max(10_000), toPlatformViaMm: z.array(point).max(16), toCraterViaMm: z.array(point).max(16),
    boundaryBlendMm: mm.min(0).max(10000).optional() }).strict(),
  flow: z.object({ centerlineMm: z.array(point).min(2).max(16), widthMm: positive.max(10_000), hazard: z.boolean(), ...movement }).strict().nullable(),
  regions: z.array(z.object({ id, boundaryMm: ring, hazard: z.boolean(), ...movement }).strict()).max(8),
  materials: z.object({ ground: ref, mountain: ref, crater: ref, platform: ref, flow: ref, route: ref }).strict(),
}).strict()
export const volcanoParametersV2Schema = volcanoParametersSchema.extend({
  breachSide: volcanoSideSchema.optional(), route: volcanoParametersSchema.shape.route.extend({ widthMm: volcanoWidthSchema }),
  flow: volcanoParametersSchema.shape.flow.unwrap().extend({ widthMm: volcanoWidthSchema }).nullable(),
}).strict()
export const volcanoDesignSchema = z.object({
  shape: volcanoShapeSchema, entranceSide: volcanoSideSchema, breachSide: volcanoBreachSchema,
  craterWidthPercent: volcanoPercentSchema, craterHeightPercent: volcanoPercentSchema, craterCenterYPercent: volcanoPercentSchema,
  fixedPlatform: z.literal(true).optional(),
}).strict()
const volcanoInput = z.object({ version: z.literal(1), seed: z.string().min(1).max(128) }).strict()
export const volcanoGenerationInputSchema = z.discriminatedUnion('algorithmVersion', [
  volcanoInput.extend({ algorithmVersion: z.literal(1), parameters: volcanoParametersSchema }),
  volcanoInput.extend({ algorithmVersion: z.literal(VOLCANO_CALDERA_VERSION), parameters: volcanoParametersV2Schema, design: volcanoDesignSchema.optional() }),
])
export type VolcanoGenerationInput = z.infer<typeof volcanoGenerationInputSchema>
export type VolcanoParameters = z.infer<typeof volcanoParametersSchema>
export type VolcanoParametersV2 = z.infer<typeof volcanoParametersV2Schema>
export type VolcanoDesign = z.infer<typeof volcanoDesignSchema>
export type VolcanoSide = z.infer<typeof volcanoSideSchema>
export type VolcanoFailureCode = 'invalid-input' | 'unsupported' | 'contradiction' | 'budget-exceeded' | 'cancelled'
export class VolcanoGenerationError extends Error {
  constructor(readonly code: VolcanoFailureCode, message: string) { super(message); this.name = 'VolcanoGenerationError' }
}
