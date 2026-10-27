import { z } from 'zod'
import { SceneAuthoringScopeSchema } from './authoring-protocol.js'
import { regionalDrillDownRequestSchema } from '../terrain-generation/regional-authoring.js'
import { sourceRegionLinkSchema } from '../terrain-generation/contracts.js'
import { sceneDocument3Schema } from '../validation/scene.js'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const bounds = z.object({ x: z.number().int().safe(), y: z.number().int().safe(), width: z.number().int().positive().safe(), height: z.number().int().positive().safe() }).strict()
const cost = z.object({ items: z.record(z.string(), z.number().int().nonnegative()), total: z.number().int().nonnegative().max(256), limit: z.literal(256) }).strict()

export const RegionSceneCandidateQuerySchema = z.object({ candidateId: z.string().min(1).max(128), candidateHash: hash,
  atContentHash: hash, draftRevision: z.number().int().nonnegative(), scopeHash: hash }).strict()
export type RegionSceneCandidateQuery = z.infer<typeof RegionSceneCandidateQuerySchema>

/** Small tool output; the complete result remains a private server artifact. */
export const RegionSceneCandidateToolOutputSchema = z.object({ candidateId: z.string().min(1).max(128), candidateHash: hash,
  atContentHash: hash, atDraftRevision: z.number().int().nonnegative(), scopeHash: hash,
  sourceSceneId: z.string().min(1).max(256), sceneId: z.string().min(1).max(256), selectionMm: bounds,
  actualOperationCost: z.number().int().nonnegative().max(256), publicInputHash: hash, appearance: z.literal('unconfirmed'),
  disposition: z.literal('independent private candidate only; local create/switch, resource validation, protected preservation and save are still required') }).strict()

export const RegionSceneCandidateResultSchema = z.object({ request: regionalDrillDownRequestSchema, document: sceneDocument3Schema,
  sourceLink: sourceRegionLinkSchema, cost, hash }).strict()
export const RegionSceneCandidateResponseSchema = z.object({ schemaVersion: z.literal(1), taskId: z.string().min(1).max(128), generation: z.number().int().positive(),
  candidateId: z.string().min(1).max(128), candidateHash: hash, atContentHash: hash, draftRevision: z.number().int().nonnegative(), scopeHash: hash,
  scope: SceneAuthoringScopeSchema, result: RegionSceneCandidateResultSchema }).strict()
export type RegionSceneCandidateResponse = z.infer<typeof RegionSceneCandidateResponseSchema>
