import { z } from 'zod'

/** Explicit authoring4 service capabilities; legacy task contracts stay strict. */
export const AUTHORING_V4_LIMITS = Object.freeze({ stageOperations: 64, operationsPerStep: 16, closeoutReserveMs: 2000 })
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const coordinate = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
export const AuthoringStageV4Schema = z.enum(['layout', 'surfaces', 'boundaries', 'furnishing', 'atmosphere', 'review'])
export const CurrentDraftStampV4Schema = z.object({ schemaVersion: z.literal(4), expectedGeneration: count.positive(),
  draftRevision: count.max(256), contentHash: hash, policyHash: hash, sourceHash: hash, ledgerHeadHash: hash, budgetStateHash: hash }).strict()
export const PublicScreenshotRefV4Schema = z.object({ taskId: id, generation: count.positive(), sha256: hash,
  sceneId: id, revision: count, width: count.positive().max(1024), height: count.positive().max(1024),
  boundsMm: z.object({ x: coordinate, y: coordinate, width: coordinate.positive(), height: coordinate.positive() }).strict(),
  draft: CurrentDraftStampV4Schema }).strict()
export type PublicScreenshotRefV4 = z.infer<typeof PublicScreenshotRefV4Schema>
export const AuthoringCloseoutV4Schema = z.object({
  reason: z.enum(['time', 'request_budget', 'tool_budget', 'operation_budget', 'work_budget', 'completed', 'cancelled']),
  draftRevision: count.max(256), contentHash: hash, reviewable: z.boolean(),
  requestOutcome: z.enum(['not_sent', 'finished', 'unknown']), remainingOperations: count,
  remainingModelRequests: count, remainingToolCalls: count, remainingExecutionMs: count,
  requirements: z.array(z.object({ index: count.max(15), status: z.enum(['pending', 'claimed', 'unsupported', 'needs_human_review']) }).strict()).max(16),
  appearanceReview: z.literal('unconfirmed'),
}).strict()
export type AuthoringCloseoutV4 = z.infer<typeof AuthoringCloseoutV4Schema>
