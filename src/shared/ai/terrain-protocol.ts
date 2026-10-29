import { z } from 'zod'
import { terrainGenerationInputSchema } from '../terrain-generation/generate.js'
import { terrainEditRequestSchema } from '../terrain-generation/edit.js'
import { regionalAuthoringRequestSchema, regionalEditRequestSchema, regionalDrillDownRequestSchema } from '../terrain-generation/regional-authoring.js'
import { terrainLocalRefreshRequestSchema } from '../terrain-generation/local.js'

export const TERRAIN_AUTHORING_KINDS = ['terrainGenerate', 'terrainEdit', 'terrainLocal', 'regionalGenerate', 'regionalEdit'] as const
/** These recipes carry complete strict inputs, never server-supplied replacement documents. */
export const TerrainAuthoringOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('terrainGenerate'), request: terrainGenerationInputSchema }).strict(),
  z.object({ kind: z.literal('terrainEdit'), request: terrainEditRequestSchema }).strict(),
  z.object({ kind: z.literal('terrainLocal'), request: terrainLocalRefreshRequestSchema }).strict(),
  z.object({ kind: z.literal('regionalGenerate'), request: regionalAuthoringRequestSchema }).strict(),
  z.object({ kind: z.literal('regionalEdit'), request: regionalEditRequestSchema }).strict(),
])
export type TerrainAuthoringOperation = z.infer<typeof TerrainAuthoringOperationSchema>
export function isTerrainAuthoringOperation(value: { kind: string }): value is TerrainAuthoringOperation {
  return (TERRAIN_AUTHORING_KINDS as readonly string[]).includes(value.kind)
}
export const TerrainCandidatesArgumentsSchema = z.object({ operations: z.array(TerrainAuthoringOperationSchema).min(1).max(3) }).strict()
export const TerrainApplyArgumentsSchema = z.object({ candidateId: z.string().min(1).max(128), candidateHash: z.string().regex(/^[a-f0-9]{64}$/), atContentHash: z.string().regex(/^[a-f0-9]{64}$/), atDraftRevision: z.number().int().nonnegative() }).strict()
export const RegionSceneCandidateArgumentsSchema = z.object({ request: regionalDrillDownRequestSchema }).strict()
