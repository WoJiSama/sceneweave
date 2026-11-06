import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createTerrainVariantCatalogDocument } from '../../platform/browser/content/terrain-variant-catalog.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument, sceneDocumentSchema } from '../validation/scene.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { getLegacyGeneration } from './composition-contracts.js'
import { generateTerrainDocumentV5, terrainGenerationInputV5Schema } from './surface-generation.js'
import { generateTerrainDocumentV6, terrainGenerationInputV6Schema, terrainGenerationResultV6Schema,
  compositionPresetV6, compositionPresetV6Schema, materializeTerrainCompositionV6 } from './surface-rule-generation.js'

const raw = (algorithmVersion: 5 | 6) => ({ sceneId: 'recipe6-island', seed: 'recipe6-fixed-seed', kind: 'island', widthMm: 24000, heightMm: 18000,
  algorithmVersion, budgetProfileId: 'standard', quality: 'standard' })
function base(palette: 'island' | 'coast' = 'island') {
  const scene = createShoreBlankDocument(palette, { sceneId: 'recipe6-island', title: '算法6测试', now: '2026-11-03T00:00:00.000Z',
    widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const catalogue = createTerrainVariantCatalogDocument()
  for (const key of ['tree-wind-oak', 'shrub-heath-mound', 'grass-sedge-fan']) {
    const id = `terrain-variants-v1-prop-${key}`, definition = catalogue.propDefinitions[id]
    scene.propDefinitions[id] = cloneJson(definition)
    scene.assets[definition.defaultAppearance.kind === 'image' ? definition.defaultAppearance.assetId : 'missing'] =
      cloneJson(catalogue.assets[definition.defaultAppearance.kind === 'image' ? definition.defaultAppearance.assetId : 'missing'])
  }
  return scene
}

describe('automatic terrain surface rules6', () => {
  it('keeps v5 replay unchanged and emits deterministic, fully validated native scene8 output', () => {
    const source = base(), before = canonicalJson(source), oldInput = raw(5)
    const old = generateTerrainDocumentV5(source, oldInput), oldBytes = canonicalJson(old)
    const request = raw(6), result = generateTerrainDocumentV6(source, request, 'recipe6-birth')
    const replay = generateTerrainDocumentV6(source, request, 'recipe6-birth')
    expect(canonicalJson(result)).toBe(canonicalJson(replay))
    expect(canonicalJson(source)).toBe(before)
    expect(canonicalJson(generateTerrainDocumentV5(source, oldInput))).toBe(oldBytes)
    expect(result.document.schemaVersion).toBe(1)
    expect(sceneDocumentSchema.safeParse(result.document).success).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(Object.values(result.document.surfaceRules!).some(rule => rule.field === 'trees')).toBe(true)
    expect(Object.values(result.document.surfaceRules!).some(rule => rule.field === 'shrubs')).toBe(true)
    expect(Object.values(result.document.surfaceRules!).some(rule => rule.field === 'grass')).toBe(true)
    expect(Object.values(result.document.decorationClusters!).length).toBeGreaterThan(0)
    expect(Object.values(result.document.decorationClusters!).every(cluster => Object.keys(cluster.members).length <= 64)).toBe(true)
    expect(result.usage.semanticTargets).toBe(result.cost.total)
    expect(result.usage.intersectionPairs).toBeGreaterThan(result.executionUsage.intersectionPairs)
    expect(result.executionUsage.intersectionPairs).toBeGreaterThan(old.executionUsage!.intersectionPairs)
    expect(Object.fromEntries(Object.entries(result.document.terrainAreas).map(([id, area]) => [id, area.surfaceStyle])))
      .toEqual(Object.fromEntries(Object.entries(old.document.terrainAreas).map(([id, area]) => [id, area.surfaceStyle])))
    const generation = getLegacyGeneration(result.document)!
    expect(generation.recipes['terrain-recipe']).toMatchObject({ recipeVersion: 6, algorithmVersion: 6 })
    expect(generation.rules['terrain-rule'].recipeRef.version).toBe(6)
    expect(Object.values(generation.ownership).every(owner => !Object.values(result.document.surfaceRules!).some(rule => rule.id === owner.target.entityId))).toBe(true)
    expect(terrainGenerationInputV5Schema.safeParse(request).success).toBe(false)
    expect(terrainGenerationInputV6Schema.safeParse(oldInput).success).toBe(false)
    const tampered = cloneJson(result); tampered.cost.total++
    expect(terrainGenerationResultV6Schema.safeParse(tampered).success).toBe(false)
  })

  it.each(['coast', 'river', 'lake', 'forest', 'hill', 'mixed'] as const)('supports automatic surface generation for %s', kind => {
    const source = base(kind === 'coast' ? 'coast' : 'island'), result = generateTerrainDocumentV6(source, { ...raw(6), kind, seed: `recipe6-${kind}` }, `recipe6-${kind}-birth`)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(Object.values(result.document.surfaceRules!).some(rule => rule.field === 'trees')).toBe(true)
    expect(Object.values(result.document.surfaceRules!).some(rule => rule.field === 'grass')).toBe(true)
  })

  it('versions composition presets independently and rejects v5 reinterpretation', () => {
    const source = base()
    const request = { sceneId: 'recipe6-island', seed: 'composition6-fixed-seed', preset: 'archipelago', widthMm: 24000, heightMm: 18000,
      recipeVersion: 6, budgetProfileId: 'standard', quality: 'standard' }
    const preset = compositionPresetV6(request)
    expect(preset.request.recipeVersion).toBe(6)
    expect(compositionPresetV6Schema.safeParse(request).success).toBe(true)
    expect(compositionPresetV6Schema.safeParse({ ...request, recipeVersion: 5 }).success).toBe(false)
    expect(preset.requirements.length).toBeGreaterThan(0)
    const result = materializeTerrainCompositionV6(source, preset.input, preset.requirements, preset.name, 'plain', 6, taskBudgetProfile('standard'))
    expect(result.document.schemaVersion).toBe(1)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(result.document.generation?.version).toBe(5)
    expect(Object.values(result.document.surfaceRules!).some(rule => rule.field === 'grass')).toBe(true)
    expect(result.usage.semanticTargets).toBe(result.cost.total)
  })

  it.each(['forestValley', 'grassRidge', 'tidalCoast'] as const)('materializes composition recipe6 for %s', presetName => {
    const source = base(), request = { sceneId: source.sceneId, seed: `composition6-${presetName}`, preset: presetName, widthMm: 24000, heightMm: 18000,
      recipeVersion: 6, budgetProfileId: 'standard', quality: 'standard' }
    const preset = compositionPresetV6(request), profile = presetName === 'tidalCoast' ? 'tidal-v2' : 'plain'
    const result = materializeTerrainCompositionV6(source, preset.input, preset.requirements, preset.name, profile, 6, taskBudgetProfile('standard'))
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(Object.values(result.document.surfaceRules!).some(rule => rule.field === 'trees')).toBe(true)
    expect(Object.values(result.document.surfaceRules!).some(rule => rule.field === 'grass')).toBe(true)
  })
})
