import { z } from 'zod'
import { domainGenerationCandidateSchema } from '../contracts.js'
import { normalizeInteriorInput, runInteriorGeneration } from './interior/index.js'
import { normalizeForestInput, runForestGeneration } from './forest/index.js'
import { normalizeVolcanoInput, runVolcanoGeneration } from './volcano/index.js'
import { normalizeMixedInput, runMixedGeneration, mixedReportSchema } from './mixed/index.js'
import { interiorFurnitureRoleSchema } from './interior/contracts.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const integer = z.number().int().safe(), count = integer.nonnegative()
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const ref = z.object({ id, version: integer.positive() }).strict()
const ids = z.array(id).max(8192), notes = z.array(z.string().max(5000)).max(8192)
const rectangle = z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict()
const layoutSchema = z.object({ rooms: z.array(z.object({ requirementId: id, roomId: id, boundsMm: rectangle, clearAreaMm2: count }).strict()).max(24),
  corridors: z.array(z.object({ roomId: id, boundsMm: rectangle }).strict()).max(24) }).strict()
const interiorReportSchema = z.object({ connectivity: z.object({ openingIds: ids, entranceOpeningId: id.nullable(), notes,
  routes: z.array(z.object({ id, fromRoomId: id.nullable(), toRoomId: id, openingId: id, from: point, to: point, pointsMm: z.array(point).max(4096), widthMm: integer.positive(), status: z.enum(['clear', 'unavailable']), notes }).strict()).max(8192) }).strict(),
  furnishing: z.object({ propIds: ids, notes, testedPlacements: count,
    rooms: z.array(z.object({ requirementId: id, roomId: id, recommended: z.array(interiorFurnitureRoleSchema).max(64),
      circulation: z.array(z.object({ propId: id, role: interiorFurnitureRoleSchema, openingId: id.nullable(), pointsMm: z.array(point).max(4096), widthMm: integer.positive(), status: z.enum(['clear', 'unavailable']), notes }).strict()).max(8192).optional(),
      placed: z.array(z.object({ propId: id, role: interiorFurnitureRoleSchema, definitionRef: ref }).strict()).max(8192), notes }).strict()).max(24) }).strict(), notes }).strict()
const forestReportSchema = z.object({ groundAreaId: id.nullable(), pathIds: ids, surfaceRuleIds: ids, propIds: ids, decorationIds: ids,
  vegetation: z.array(z.object({ zoneId: id, role: z.enum(['tree', 'shrub', 'grass']), requested: count, placed: count, ruleId: id, clusterId: id }).strict()).max(8192), notes }).strict()
const volcanoReportSchema = z.object({ groundAreaId: id, mountainAreaId: id, craterAreaId: id, platformAreaId: id, flowAreaId: id.nullable(), connectionIds: ids, pathIds: ids, regionIds: ids, notes }).strict()
const resultBase = { input: z.unknown(), candidate: domainGenerationCandidateSchema, resultHash: hash }

/** The one static domain composition root owns normalization, result contracts,
 * algorithms, local capability declarations and host presentation preparation.
 * Transport schemas and Workspace lifecycle derive their dispatch from here. */
export const generationDomains = Object.freeze({
  interior: Object.freeze({ algorithm: Object.freeze({ id: 'interior-layout', version: 10 }), normalize: normalizeInteriorInput, run: runInteriorGeneration,
    resultSchema: z.object({ ...resultBase, layout: layoutSchema, report: interiorReportSchema }).strict(),
    presentation: 'default', localOperations: Object.freeze(['interior-furniture']) }),
  forest: Object.freeze({ algorithm: Object.freeze({ id: 'forest-layout', version: 2 }), normalize: normalizeForestInput, run: runForestGeneration,
    resultSchema: z.object({ ...resultBase, report: forestReportSchema }).strict(),
    presentation: 'terrain-variants', localOperations: Object.freeze(['forest-density']) }),
  volcano: Object.freeze({ algorithm: Object.freeze({ id: 'volcano-layout', version: 1 }), normalize: normalizeVolcanoInput, run: runVolcanoGeneration,
    resultSchema: z.object({ ...resultBase, report: volcanoReportSchema }).strict(),
    presentation: 'terrain-variants', localOperations: Object.freeze(['volcano-material', 'volcano-boundary']) }),
  mixed: Object.freeze({ algorithm: Object.freeze({ id: 'mixed-layout', version: 9 }), normalize: normalizeMixedInput, run: runMixedGeneration,
    resultSchema: z.object({ ...resultBase, report: mixedReportSchema }).strict(),
    presentation: 'terrain-variants', localOperations: Object.freeze([]) }),
} as const)
export type DomainGenerationKind = keyof typeof generationDomains
export type DomainGenerationResults = { [K in DomainGenerationKind]: ReturnType<typeof generationDomains[K]['run']> }
export const domainGenerationKinds = Object.freeze(Object.keys(generationDomains) as DomainGenerationKind[])
