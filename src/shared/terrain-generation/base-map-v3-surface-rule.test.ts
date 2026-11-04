import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createTerrainVariantCatalogDocument } from '../../platform/browser/content/terrain-variant-catalog.js'
import { cloneJson } from '../validation/json.js'
import { sceneDocument8Schema } from '../validation/scene.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { executeBaseMapRequestV3, parseBaseMapResponseV3, prepareBaseMapRequestV3 } from './base-map-v3.js'

function base() {
  const scene = createShoreBlankDocument('island', { sceneId: 'base-map-v3-surface-rule', title: '底图协议6', now: '2026-11-03T00:00:00.000Z',
    widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const catalogue = createTerrainVariantCatalogDocument()
  for (const key of ['tree-wind-oak', 'shrub-heath-mound', 'grass-sedge-fan']) {
    const id = `terrain-variants-v1-prop-${key}`, definition = catalogue.propDefinitions[id]
    scene.propDefinitions[id] = cloneJson(definition)
    if (definition.defaultAppearance.kind === 'image') scene.assets[definition.defaultAppearance.assetId] = cloneJson(catalogue.assets[definition.defaultAppearance.assetId])
  }
  return scene
}

function request(generation: unknown) {
  return prepareBaseMapRequestV3({ requestId: 'surface-rule-request', flowId: 'surface-rule-flow', workspaceSceneId: 'surface-rule-workspace',
    checkpoint: 2, operationEpoch: 1, profile: taskBudgetProfile('standard'), base: base(), generation })
}

describe('base map v3 surface recipe6 protocol', () => {
  it('executes, validates, and independently replays terrain algorithm6', () => {
    const prepared = request({ kind: 'terrain', input: { sceneId: 'base-map-v3-surface-rule', seed: 'protocol6-island', kind: 'island',
      widthMm: 24000, heightMm: 18000, algorithmVersion: 6, budgetProfileId: 'standard', quality: 'standard' } })
    expect(prepared.algorithm).toEqual({ id: 'terrain-scene', version: 6, recipeVersion: 6 })
    const response = executeBaseMapRequestV3(prepared)
    expect(response.result.kind).toBe('terrain')
    if (response.result.kind !== 'terrain') throw new Error('expected terrain result')
    const document = sceneDocument8Schema.parse(response.result.terrain.document)
    expect(document.schemaVersion).toBe(8)
    expect(Object.values(document.surfaceRules).some(rule => rule.field === 'grass')).toBe(true)
    expect(parseBaseMapResponseV3(prepared, response)).toEqual(response)
    const changed = cloneJson(response); changed.domainCost.total++
    expect(() => parseBaseMapResponseV3(prepared, changed)).toThrow()
  })

  it('executes and replays composition recipe6 while retaining the version3 envelope', () => {
    const prepared = request({ kind: 'composition', input: { sceneId: 'base-map-v3-surface-rule', seed: 'protocol6-composition',
      preset: 'forestValley', widthMm: 24000, heightMm: 18000, recipeVersion: 6, budgetProfileId: 'standard', quality: 'standard' } })
    expect(prepared.algorithm).toEqual({ id: 'terrain-compose', version: 1, recipeVersion: 6 })
    const response = executeBaseMapRequestV3(prepared)
    expect(response.result.kind).toBe('composition')
    if (response.result.kind !== 'composition') throw new Error('expected composition result')
    const document = sceneDocument8Schema.parse(response.result.document)
    expect(document.schemaVersion).toBe(8)
    expect(Object.values(document.surfaceRules).some(rule => rule.field === 'trees')).toBe(true)
    expect(parseBaseMapResponseV3(prepared, response)).toEqual(response)
  })
})
