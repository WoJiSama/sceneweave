import { z } from 'zod'
import type { CompositionContent } from '../model/appearance.js'
import type { PreparationContext } from '../ports/runtime.js'
import type { TaskBudgetProfile } from '../budget/task-budget.js'
import { validateSceneDocument } from '../validation/scene.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { hashGenerationValue } from './contracts.js'
import { regenerateVolcanoSurface } from './local-volcano.js'
import { regenerateForestZone } from './local-forest.js'
import { regenerateRoomFurniture } from './local-interior.js'
import type { LocalDomainResult } from './local-common.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const point = z.object({ x: z.number().int().safe(), y: z.number().int().safe() }).strict()
const common = { version: z.literal(1), recipeId: id }
export const localGenerationRequestSchema = z.discriminatedUnion('operation', [
  z.object({ ...common, operation: z.literal('volcano-material'), areaId: id, materialRef: z.object({ id, version: z.number().int().positive().safe() }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('volcano-boundary'), areaId: id, positionsMm: z.array(point).min(3).max(64) }).strict(),
  z.object({ ...common, operation: z.literal('forest-density'), zoneId: id, role: z.enum(['tree', 'shrub', 'grass']), coveragePpm: z.number().int().min(0).max(1_000_000) }).strict(),
  z.object({ ...common, operation: z.literal('interior-furniture'), roomId: id, variation: z.string().min(1).max(128) }).strict(),
])
export type LocalGenerationRequest = z.infer<typeof localGenerationRequestSchema>
export function runLocalGeneration(content: CompositionContent, raw: unknown, runtime: PreparationContext, options: { profile: TaskBudgetProfile; checkCancelled: () => void }) {
  options.checkCancelled()
  const request = localGenerationRequestSchema.parse(captureJson(raw)), checked = validateSceneDocument(content.document)
  if (!checked.ok || content.document.mapMode !== 'scene') throw new Error('局部生成需要完整合法场景工程。')
  let result: LocalDomainResult
  if (request.operation === 'volcano-material' || request.operation === 'volcano-boundary') result = regenerateVolcanoSurface(content, request, runtime, options.checkCancelled)
  else if (request.operation === 'forest-density') result = regenerateForestZone(content, request, runtime, options)
  else result = regenerateRoomFurniture(content, request, runtime, options)
  options.checkCancelled()
  const after = validateSceneDocument(result.document)
  if (!after.ok) throw new Error(`局部生成未采用：${after.errors.map(issue => issue.message).join('；')}`)
  return freezeJson({ request, ...result, resultHash: hashGenerationValue({ request, ...result }) })
}
