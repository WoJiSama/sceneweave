import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { TASK_BUDGET_PROFILES } from '../budget/task-budget.js'
import { cloneJson } from '../validation/json.js'
import { composeTerrainDocument } from './compose.js'
import { generateTerrainDocument, generateTerrainDocumentV4 } from './generate.js'
import { getLegacyGeneration } from './composition-contracts.js'

const blank = () => createRefinedBlankDocument('island', { sceneId: 'recipe-order', title: 'recipe order', now: '2026-10-30T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
const usedMaterialIds = (result: ReturnType<typeof generateTerrainDocument>) => Object.values(result.document.materials).filter(material => Object.values(result.document.terrainAreas).some(area => area.surfaceStyle?.base.materialRef.id === material.id)).map(row => row.id)
const usedDefinitionIds = (result: ReturnType<typeof generateTerrainDocument>) => [...new Set(Object.values(result.document.props).flatMap(prop => prop.definitionRef ? [prop.definitionRef.id] : []))]
describe('versioned recipe array order', () => {
  it.each([1,2,3] as const)('preserves declared recipe material and prop order for legacy algorithm %i', algorithmVersion => {
    const base = blank(), result = cloneJson(generateTerrainDocument(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', algorithmVersion }))
    result.document.materials = Object.fromEntries(Object.entries(result.document.materials).reverse())
    result.document.props = Object.fromEntries(Object.entries(result.document.props).reverse())
    const document = composeTerrainDocument(base, result, 'legacy-birth').document, recipe = getLegacyGeneration(document)!.recipes['terrain-recipe']
    expect(recipe.materials.map(row => row.ref.id)).toEqual(usedMaterialIds(result))
    expect(recipe.props.map(row => row.ref.id)).toEqual(usedDefinitionIds(result))
  })
  it('gives new4 the same recipe arrays under reversed JSON map insertion order', () => {
    const base = blank(), profile = TASK_BUDGET_PROFILES.small, result = generateTerrainDocumentV4(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', algorithmVersion: 4, budgetProfileId: 'small', quality: 'standard' })
    const reversed = cloneJson(result)
    reversed.document.materials = Object.fromEntries(Object.entries(reversed.document.materials).reverse())
    reversed.document.props = Object.fromEntries(Object.entries(reversed.document.props).reverse())
    const first = getLegacyGeneration(composeTerrainDocument(base, result, 'new4-birth', profile).document)!.recipes['terrain-recipe']
    const second = getLegacyGeneration(composeTerrainDocument(base, reversed, 'new4-birth', profile).document)!.recipes['terrain-recipe']
    expect(first.materials).toEqual(second.materials); expect(first.props).toEqual(second.props)
    expect(first.materials.map(row => row.ref.id)).toEqual(usedMaterialIds(result).sort())
    expect(first.props.map(row => row.ref.id)).toEqual(usedDefinitionIds(result).sort())
  })
})
