import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { TASK_BUDGET_PROFILES, assertTaskBudget, measureTaskBudget, taskSemanticTargets } from '../budget/task-budget.js'
import { generateTerrainDocumentV4, TERRAIN_FIXED_SEEDS, terrainGenerationInputSchema, terrainGenerationResultV4Schema } from './generate.js'
import { composeTerrainDocument } from './compose.js'
import { compositionPresetV4, compositionPresetSchema } from './composition-presets.js'
import { materializeTerrainComposition } from './composition-materialize.js'
import { executeBaseMapRequestV3, prepareBaseMapRequestV3, parseBaseMapResponseV3, parseBaseMapRequestV3 } from './base-map-v3.js'

const blank = (kind: 'island' | 'coast' = 'island', widthMm = 24000) => createRefinedBlankDocument(kind, {
  sceneId: 'budget-v4', title: '预算分维度开发探针', now: '2026-10-30T00:00:00.000Z', widthMm, heightMm: widthMm * .75, preset: 'narrative',
})
const input = (kind = 'island', seed = TERRAIN_FIXED_SEEDS[0]) => ({ sceneId: 'budget-v4', seed, kind,
  widthMm: 24000, heightMm: 18000, algorithmVersion: 4, budgetProfileId: 'small', quality: 'standard' })

describe('explicit generation 4 and independent budget dimensions', () => {
  it.each(TERRAIN_FIXED_SEEDS)('keeps fixed precision and restores scenery for %s', seed => {
    const base = blank(), request = input('island', seed), result = generateTerrainDocumentV4(base, request)
    const composed = composeTerrainDocument(base, result, 'new-budget-birth', TASK_BUDGET_PROFILES.small)
    expect(result.cost.total).toBeGreaterThan(256)
    expect(Object.keys(result.document.props)).toHaveLength(8)
    expect(result.skeleton.gridColumns).toBe(64)
    expect(result.document.visual?.version === 1 && result.document.visual.boundaries['terrain-coast-curve'].sampleSpacingMm).toBe(1200)
    expect(validateSceneDocument(composed.document).ok).toBe(true)
    expect(composed.cost.total).toBe(taskSemanticTargets(base, composed.document).length)
    expect(composed.cost.limit).toBe(512)
    expect(composed.usage?.geometryPoints).toBeGreaterThan(composed.cost.total)
    expect(terrainGenerationResultV4Schema.safeParse(result).success).toBe(true)
    expect(canonicalJson(generateTerrainDocumentV4(base, request))).toBe(canonicalJson(result))
  })

  it.each(['coast', 'river', 'lake', 'forest', 'hill', 'mixed'])('supports existing terrain kind %s in explicit 4', kind => {
    const base = blank(kind === 'coast' ? 'coast' : 'island')
    const result = generateTerrainDocumentV4(base, input(kind)), composed = composeTerrainDocument(base, result, 'kind-birth', TASK_BUDGET_PROFILES.small)
    expect(validateSceneDocument(composed.document).ok).toBe(true)
    expect(composed.cost.total).toBeLessThanOrEqual(512)
    expect(result.input.algorithmVersion).toBe(4)
  })

  it('keeps the detailed expanded profile deterministic and rejects a downgrade into old parsers', () => {
    const request = { ...input(), budgetProfileId: 'expanded', quality: 'detailed' }, base = blank()
    const result = generateTerrainDocumentV4(base, request)
    expect(result.skeleton.gridColumns).toBe(160)
    expect(result.document.visual?.version === 1 && result.document.visual.boundaries['terrain-coast-curve'].sampleSpacingMm).toBe(700)
    expect(terrainGenerationInputSchema.safeParse(request).success).toBe(false)
    expect(compositionPresetSchema.safeParse({ sceneId: base.sceneId, seed: 'same', widthMm: 24000, heightMm: 18000,
      preset: 'archipelago', recipeVersion: 4, budgetProfileId: 'small', quality: 'standard' }).success).toBe(false)
  })

  it.each(['archipelago', 'forestValley', 'grassRidge', 'tidalCoast'] as const)('materializes recipe 4 %s under the separate vector', preset => {
    const base = blank(), generated = compositionPresetV4({ sceneId: base.sceneId, seed: 'composition-v4-fixed', preset,
      widthMm: 24000, heightMm: 18000, recipeVersion: 4, budgetProfileId: 'small', quality: 'standard' })
    const output = materializeTerrainComposition(base, generated.input, generated.requirements, generated.name,
      preset === 'tidalCoast' ? 'tidal-v2' : 'plain', 4, TASK_BUDGET_PROFILES.small)
    expect(validateSceneDocument(output.document).ok).toBe(true)
    const usage = assertTaskBudget(TASK_BUDGET_PROFILES.small, measureTaskBudget(base, output.document, undefined, output.executionUsage))
    expect(usage.fieldEvaluations).toBeGreaterThan(0)
    expect(usage.metadataRecords).toBeGreaterThan(0)
    expect(output.document.generation?.version === 5 && output.document.generation.legacy.recipes['t9-recipe'].recipeVersion).toBe(4)
  })

  for (const profile of Object.values(TASK_BUDGET_PROFILES)) {
    it.each(['archipelago', 'forestValley', 'grassRidge', 'tidalCoast'] as const)(`keeps detailed recipe 4 %s exact at ${profile.profileId}`, preset => {
      const base = blank(), generated = compositionPresetV4({ sceneId: base.sceneId, seed: 'detailed-v4-fixed', preset,
        widthMm: 24000, heightMm: 18000, recipeVersion: 4, budgetProfileId: profile.profileId, quality: 'detailed' })
      const output = materializeTerrainComposition(base, generated.input, generated.requirements, generated.name,
        preset === 'tidalCoast' ? 'tidal-v2' : 'plain', 4, profile)
      expect(validateSceneDocument(output.document).ok).toBe(true)
      expect(output.plan.input.precision).toEqual(generated.input.precision)
      expect(assertTaskBudget(profile, measureTaskBudget(base, output.document, undefined, output.executionUsage)).gridNodes).toBeGreaterThan(0)
    })
  }

  it('replays a complete v3 response and refuses profile, flow, usage and geometry forgery', () => {
    const request = prepareBaseMapRequestV3({ requestId: 'request-3', workspaceSceneId: 'workspace', checkpoint: 0, operationEpoch: 1,
      flowId: 'flow-3', profile: TASK_BUDGET_PROFILES.small, base: blank(), generation: { kind: 'terrain', input: input() } })
    const response = executeBaseMapRequestV3(request)
    expect(parseBaseMapResponseV3(request, response)).toEqual(response)
    expect(response.result.kind === 'terrain' && response.result.terrain.cost.total).toBeGreaterThan(256)
    expect(response.generationBudget.semanticCost).toBe(response.domainCost.total)
    expect(response.generationBudget.usage.geometryPoints).toBeGreaterThan(response.domainCost.total)
    expect(() => parseBaseMapRequestV3({ ...request, profileHash: '0'.repeat(64) })).toThrow()
    expect(() => parseBaseMapResponseV3(request, { ...response, flowId: 'other' })).toThrow()
    expect(() => parseBaseMapResponseV3(request, { ...response, generationBudget: { ...response.generationBudget,
      usage: { ...response.generationBudget.usage, geometryPoints: 0 } } })).toThrow()
    const changed = structuredClone(response)
    if (changed.result.kind === 'terrain') changed.result.terrain.document.terrainAreas['terrain-low'].boundaryMm[0].positionMm.x++
    expect(() => parseBaseMapResponseV3(request, changed)).toThrow()
  })
})
