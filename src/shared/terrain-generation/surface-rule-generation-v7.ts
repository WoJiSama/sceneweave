import { z } from 'zod'
import type { SceneDocument } from '../model/scene.js'
import { BUDGET_DIMENSIONS, BudgetUsageSchema, assertTaskBudget, captureExecutionBudget, emptyBudgetUsage,
  measureTaskBudget, taskBudgetProfile, taskSemanticTargets, type BudgetUsage, type TaskBudgetProfile } from '../budget/task-budget.js'
import { captureJson, cloneJson, canonicalJson } from '../validation/json.js'
import { sceneDocumentSchema, validateSceneDocument } from '../validation/scene.js'
import { addAutomaticSurfaceRules7, AUTOMATIC_SURFACE_RECIPE7 } from '../surface-rules/automatic-v7.js'
import { terrainVariantDefinitionId } from '../visual/terrain-variant-specs.js'
import { terrainVariantV2DefinitionId } from '../visual/terrain-variant-v2-specs.js'
import { refineTerrainVisualV7 } from './v7-visual-helper.js'
import { terrainGenerationInputV5Schema, terrainGenerationResultV5Schema, generateTerrainDocumentV5,
  compositionPresetV5Schema, compositionPresetV5, materializeTerrainCompositionV5 } from './surface-generation.js'
import { composeTerrainDocument } from './compose.js'
import { emptyCompositionDocument } from './composition-materialize.js'
import { getLegacyGeneration, type TerrainRequirement } from './composition-contracts.js'
import type { TerrainCompositionInput } from './composition-field.js'
import { generationInputHash, managedOutputHash, constraintInputHash } from './integrity.js'
import { compositionInputHash, compositionOutputHash, dependencyInputHash, terrainRequirementInputHash } from './composition-integrity.js'
import { evaluateTerrainRequirement } from './composition-requirements.js'

export const terrainGenerationInputV7Schema = z.object({ ...terrainGenerationInputV5Schema.shape, algorithmVersion: z.literal(7) }).strict()
  .refine(value => value.widthMm / value.heightMm >= 1 && value.widthMm / value.heightMm <= 1.8, '首批地形范围宽高比须为1–1.8。')
export type TerrainGenerationInputV7 = z.infer<typeof terrainGenerationInputV7Schema>
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const costSchema = z.object({ items: z.record(z.string(), z.literal(1)), total: count, limit: z.union([z.literal(512), z.literal(1024), z.literal(2048)]) }).strict()
/** Unlike earlier raw terrain results this is already the complete current scene, complete
 * with constraints and persistent rule/member ownership. Never compose again. */
export const terrainGenerationResultV7Schema = z.object({ document: sceneDocumentSchema, input: terrainGenerationInputV7Schema,
  skeleton: terrainGenerationResultV5Schema.shape.skeleton, activity: terrainGenerationResultV5Schema.shape.activity,
  route: terrainGenerationResultV5Schema.shape.route, executionUsage: BudgetUsageSchema, cost: costSchema, usage: BudgetUsageSchema,
}).strict().superRefine((result, context) => {
  const checked = validateSceneDocument(result.document)
  if (!checked.ok) for (const issue of checked.errors) context.addIssue({ code: 'custom', path: ['document'], message: issue.message })
  if (result.document.sceneId !== result.input.sceneId) context.addIssue({ code: 'custom', path: ['document', 'sceneId'], message: '自动地表候选身份不同。' })
  if (result.cost.total !== Object.keys(result.cost.items).length || result.cost.total !== result.usage.semanticTargets || result.cost.limit !== taskBudgetProfile(result.input.budgetProfileId).semanticTargets) {
    context.addIssue({ code: 'custom', path: ['cost'], message: '自动地表候选的实际语义成本不一致。' })
  }
  try { assertTaskBudget(taskBudgetProfile(result.input.budgetProfileId), result.usage) }
  catch (error) { context.addIssue({ code: 'custom', path: ['usage'], message: error instanceof Error ? error.message : '自动地表预算无效。' }) }
})
export type TerrainGenerationResultV7 = z.infer<typeof terrainGenerationResultV7Schema>
export const compositionPresetV7Schema = z.object({ ...compositionPresetV5Schema.shape, recipeVersion: z.literal(7) }).strict()
  .refine(value => value.widthMm / value.heightMm >= 1 && value.widthMm / value.heightMm <= 1.8, '宽高比须为1–1.8。')
export type CompositionPresetInputV7 = z.infer<typeof compositionPresetV7Schema>
export function compositionPresetV7(raw: unknown) {
  const request = compositionPresetV7Schema.parse(captureJson(raw))
  return { ...compositionPresetV5({ ...request, recipeVersion: 5 }), request }
}
function sumUsage(first: BudgetUsage | undefined, second: BudgetUsage): BudgetUsage {
  const sum = emptyBudgetUsage()
  for (const key of BUDGET_DIMENSIONS) sum[key] = (first?.[key] ?? 0) + second[key]
  return BudgetUsageSchema.parse(sum)
}
function refreshGeneration7(document: SceneDocument, meter: ReturnType<typeof captureExecutionBudget>, targetIsland = false): SceneDocument {
  let legacy = getLegacyGeneration(document)!
  for (const recipe of Object.values(legacy.recipes)) {
    if ('domain' in recipe) continue
    recipe.recipeVersion = 7
    if (recipe.algorithmId === 'terrain-scene' || recipe.algorithmId === 'terrain-scene-t3') recipe.algorithmVersion = 7
    const materials = new Set(recipe.materials.map(row => row.ref.id))
    for (const rule of Object.values(document.surfaceRules!)) if (rule.field === 'material' && !materials.has(rule.paint.materialRef.id)) {
      const material = document.materials[rule.paint.materialRef.id]
      recipe.materials.push({ role: material.tags.includes('water') ? 'water' : material.tags.includes('grass') ? 'grass' : material.tags.includes('sand') ? 'sand' : 'rock', ref: cloneJson(rule.paint.materialRef) })
      materials.add(rule.paint.materialRef.id)
    }
    recipe.props = recipe.props.filter(row => !document.propDefinitions[row.ref.id]?.tags.some(tag => /^(tree|grass|shrub)$/.test(tag)))
    for (const spec of AUTOMATIC_SURFACE_RECIPE7) recipe.props.push({ role: spec.field === 'trees' ? 'tree' : 'shrub', ref: { id: spec.field === 'trees' ? terrainVariantV2DefinitionId(spec.key) : terrainVariantDefinitionId(spec.key), version: 1 } })
    recipe.materials.sort((a, b) => a.ref.id.localeCompare(b.ref.id)); recipe.props.sort((a, b) => a.ref.id.localeCompare(b.ref.id))
  }
  for (const rule of Object.values(legacy.rules)) rule.recipeRef.version = 7
  if (targetIsland) {
    document = refineTerrainVisualV7(document)
    legacy = getLegacyGeneration(document)!
  }
  for (const rule of Object.values(legacy.rules)) { rule.inputHash = generationInputHash(document, rule); rule.managedOutputHash = managedOutputHash(document, rule) }
  for (const check of Object.values(legacy.checks)) {
    if (check.algorithmId === 'terrain-scene' || check.algorithmId === 'terrain-scene-t3') check.algorithmVersion = 7
    check.inputHash = constraintInputHash(document, check.constraintId)
  }
  const system = document.generation
  if (system?.version !== 5) throw new Error('自动地表7缺少完整组合系统。')
  for (const composition of Object.values(system.compositions)) {
    composition.recipeRef.version = 7
    for (const dependency of Object.values(system.dependencies).filter(row => row.compositionId === composition.id)) dependency.inputHash = dependencyInputHash(document, dependency)
    for (const check of Object.values(system.checks).filter(row => composition.requirementIds.includes(row.requirementId))) {
      const requirement = system.requirements[check.requirementId], evaluated = evaluateTerrainRequirement(document, requirement, meter)
      if (evaluated.state !== 'passed') throw new Error(`自动地表7不能侵入硬要求：${evaluated.issues.map(row => row.message).join('；')}`)
      Object.assign(check, evaluated, { inputHash: terrainRequirementInputHash(document, requirement) })
    }
    composition.inputHash = compositionInputHash(document, composition); composition.outputHash = compositionOutputHash(document, composition)
  }
  return document
}
function finish(base: SceneDocument, original: SceneDocument, seed: string, profile: TaskBudgetProfile, previous?: BudgetUsage, targetIsland = false) {
  const meter = captureExecutionBudget(profile), document = addAutomaticSurfaceRules7(original, seed, meter)
  const refreshed = refreshGeneration7(document, meter, targetIsland)
  const checked = validateSceneDocument(refreshed)
  if (!checked.ok) throw new Error(`自动地表7完整校验失败：${checked.errors.map(row => `${row.entityId ?? ''}:${row.code}:${row.message}`).join('；')}`)
  const executionUsage = sumUsage(previous, meter.snapshot()), usage = assertTaskBudget(profile, measureTaskBudget(base, checked.document, undefined, executionUsage))
  const targets = taskSemanticTargets(base, checked.document)
  return { document: checked.document, executionUsage, usage, cost: { items: Object.fromEntries(targets.map(target => [target, 1 as const])), total: targets.length, limit: profile.semanticTargets } }
}
export function generateTerrainDocumentV7(base: SceneDocument, raw: unknown, birthToken = 'surface-recipe7-birth'): TerrainGenerationResultV7 {
  const input = terrainGenerationInputV7Schema.parse(captureJson(raw)), profile = taskBudgetProfile(input.budgetProfileId)
  const physical = generateTerrainDocumentV5(base, { ...input, algorithmVersion: 5 })
  const native = composeTerrainDocument(base, physical, birthToken, profile).document
  const result = finish(base, emptyCompositionDocument(native), input.seed, profile, physical.executionUsage, input.kind === 'island')
  return terrainGenerationResultV7Schema.parse({ ...result, input, skeleton: physical.skeleton, activity: physical.activity, ...(physical.route ? { route: physical.route } : {}) })
}
export function materializeTerrainCompositionV7(base: SceneDocument, input: TerrainCompositionInput, requirements: TerrainRequirement[], title: string,
  profile: 'plain' | 'tidal' | 'tidal-v2' = 'plain', recipeVersion: 7 = 7, budget?: TaskBudgetProfile) {
  if (recipeVersion !== 7 || !budget) throw new Error('自动地表组合7需要显式版本7与注册预算。')
  const physical = materializeTerrainCompositionV5(base, input, requirements, title, profile, 5, budget)
  return { ...finish(base, physical.document, input.seed, budget, physical.executionUsage), plan: physical.plan }
}
