import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { sceneSchemaV2 } from '../v2/schema'
import { validateGeometryV2 } from '../v2/geometry'
import type { Issue } from '../v2/types'
import { geometryDocumentForValidationV3 } from './domain'
import { inspectDependenciesV3 } from './dependencies'
import { USER_LAYER_LIMIT_V3, type SceneDocumentV3 } from './types'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留键不能用作 ID')
export const userLayerSchemaV3 = z.object({
  id, floorId: id, name: z.string().min(1).max(80).refine(value => value.trim() === value && value.length > 0, '图层名称须去除首尾空白且非空'),
  order: z.number().int().min(0).max(USER_LAYER_LIMIT_V3 - 1), editLocked: z.boolean(),
}).strict()

/** Native strict reader: v2 fields retain their exact schemas; v2 itself stays strict. */
export const sceneSchemaV3 = sceneSchemaV2.extend({
  schemaVersion: z.literal(3), userLayers: z.record(id, userLayerSchemaV3), entityLayers: z.record(id, id),
}).strict()

export type ValidationResultV3 = { ok: true; document: SceneDocumentV3; warnings: Issue[] } | { ok: false; errors: Issue[] }
export function validateSceneV3(input: unknown): ValidationResultV3 {
  let values = 0
  const budget = (value: unknown, depth = 0): boolean => {
    if (++values > 600000 || depth > 128) return false
    if (value !== null && typeof value === 'object') for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === 'length') continue
      if (!('value' in descriptor) || !budget(descriptor.value, depth + 1)) return false
    }
    return true
  }
  if (!budget(input)) return { ok: false, errors: [{ code: 'JSON_BUDGET', message: '文档超过 128 层/600000 值预算，或包含访问器。' }] }
  const jsonIssue = inspectJsonInput(input)
  if (jsonIssue) return { ok: false, errors: [jsonIssue] }
  const parsed = sceneSchemaV3.safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => ({ code: 'SCHEMA', message: `${issue.path.join('.') || 'document'}: ${issue.message}` })) }
  const document = parsed.data as SceneDocumentV3
  const dependencies = inspectDependenciesV3(document), geometry = validateGeometryV2(geometryDocumentForValidationV3(document))
  const errors = [...dependencies.errors, ...geometry.errors]
  return errors.length ? { ok: false, errors } : { ok: true, document, warnings: geometry.warnings }
}
