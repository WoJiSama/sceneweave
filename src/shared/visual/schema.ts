import { z } from 'zod'
import { angle, color, id, int, opacity, point, visibility } from '../validation/primitives.js'
import { VISUAL_LIMITS } from './types.js'

const finite = (min: number, max: number) => z.number().finite().min(min).max(max)
const mm = (min: number, max = 1_000_000) => int.refine(value => value >= min && value <= max, `毫米值须为${min}–${max}`)
const seed = z.string().min(1).max(128)
const entity = { id, floorId: id, layerId: id, visibility, editLocked: z.boolean() }
const region = z.array(point).min(3).max(VISUAL_LIMITS.regionPoints)
const limitedRecord = <T extends z.ZodType>(schema: T, maximum: number) => z.record(id, schema)
  .refine(value => Object.keys(value).length <= maximum, `记录数最多${maximum}`)
export const cubicSegmentSchema = z.object({ id, start: point, control1: point, control2: point, end: point }).strict()
export const terrainBoundarySideSchema = z.object({ areaId: id, startPointId: id, endPointId: id, reverse: z.boolean() }).strict()
export const visualBoundarySchema = z.object({ ...entity, closed: z.boolean(), segments: z.array(cubicSegmentSchema).min(1).max(VISUAL_LIMITS.segmentsPerBoundary),
  sampleSpacingMm: mm(4, 20_000), toleranceMm: mm(1, 1000), binding: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('terrain'), sides: z.array(terrainBoundarySideSchema).min(1).max(2) }).strict(),
    z.object({ kind: z.literal('path'), pathId: id }).strict(),
    z.object({ kind: z.literal('decoration') }).strict(),
  ]),
}).strict()
export const visualEdgeLookSchema = z.object({ ...entity, boundaryId: id, kind: z.enum(['shore', 'cliff', 'grass', 'path', 'fence']), side: z.enum(['left', 'right', 'both']),
  widthMm: mm(1, 5000), color, accentColor: color, opacity, intensity: finite(0, 2), seed, repeatMm: mm(20, 20_000), enabled: z.boolean(),
}).strict()
export const visualLightSchema = z.object({ ...entity, positionMm: point, radiusMm: mm(1, 50_000), color, intensity: finite(0, 2), wallOcclusion: z.boolean(), enabled: z.boolean() }).strict()
export const visualFogSchema = z.object({ ...entity, boundaryMm: region, color, opacity, directionDeg: angle, scaleMm: mm(50, 20_000), seed, enabled: z.boolean() }).strict()
export const visualFilterTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scene') }).strict(),
  z.object({ kind: z.literal('region'), boundaryMm: region }).strict(),
  z.object({ kind: z.literal('entities'), ids: z.array(id).min(1).max(256).refine(value => new Set(value).size === value.length, '滤镜目标不能重复') }).strict(),
  z.object({ kind: z.literal('layer'), layerId: id }).strict(),
])
export const visualFilterSchema = z.object({ ...entity, target: visualFilterTargetSchema, preset: z.enum(['neutral', 'warm', 'cool', 'aged', 'moonlight']),
  exposure: finite(.25, 2), saturation: finite(0, 2), contrast: finite(.25, 2), vignette: opacity, grain: finite(0, .2), seed, enabled: z.boolean(),
}).strict()
export const visualEnvironmentSchema = z.object({ ambientColor: color, ambientOpacity: finite(0, .85), exposure: finite(.25, 2), lightDirectionDeg: angle,
  contactShadowMm: mm(0, 1000), contactShadowOpacity: finite(0, .7),
}).strict()
export const visualSystemSchema = z.object({ version: z.literal(1),
  boundaries: limitedRecord(visualBoundarySchema, VISUAL_LIMITS.boundaries), edgeLooks: limitedRecord(visualEdgeLookSchema, VISUAL_LIMITS.edgeLooks),
  lights: limitedRecord(visualLightSchema, VISUAL_LIMITS.lights), fogs: limitedRecord(visualFogSchema, VISUAL_LIMITS.fogs), filters: limitedRecord(visualFilterSchema, VISUAL_LIMITS.filters),
  environment: visualEnvironmentSchema,
}).strict()
