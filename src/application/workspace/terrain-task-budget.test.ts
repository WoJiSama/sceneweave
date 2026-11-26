import { expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { taskBudgetProfile } from '../../shared/budget/task-budget.js'
import { generateTerrainDocumentV13 } from '../../shared/terrain-generation/coastal-generation.js'
import { composeTerrainDocument } from '../../shared/terrain-generation/compose.js'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import { finalizeTerrainEditDocument } from '../../shared/terrain-generation/edit.js'
import { managedOutputHash } from '../../shared/terrain-generation/integrity.js'
import { selectTerrainEditBudget } from './terrain-task-budget.js'

it('edits a v13 coastal output with the selected budget and still refuses changes to the stored rule input', () => {
  const size = { sceneId: 'coastal-local-edit', widthMm: 24000, heightMm: 18000 }
  const base = createShoreBlankDocument('island', { ...size, title: '岩岛', preset: 'narrative', now: '2026-11-25T00:00:00.000Z' }, false, false, 'naturalStone')
  const generated = generateTerrainDocumentV13(base, { ...size, kind: 'island', seed: 'terrain-v1-0', quality: 'standard', budgetProfileId: 'standard', algorithmVersion: 13 })
  const { document } = composeTerrainDocument(base, generated, 'coastal-edit-birth')
  expect(selectTerrainEditBudget(document)?.profileId).toBe('standard')
  const requested = taskBudgetProfile('standard')
  expect(selectTerrainEditBudget(document, requested)).toEqual(requested)
  const next = structuredClone(document), generation = getLegacyGeneration(next)!
  const rule = generation.rules['terrain-rule']
  next.terrainAreas['terrain-low'].groundElevationMm++
  const updatedHash = managedOutputHash(next, rule)
  expect(updatedHash).not.toBe(rule.managedOutputHash)
  expect(() => finalizeTerrainEditDocument(next, document)).toThrow(/当前局部编辑不支持/)
  finalizeTerrainEditDocument(next, document, requested)
  expect(rule.managedOutputHash).toBe(updatedHash)
  rule.parameters.roughness += .01
  expect(() => finalizeTerrainEditDocument(next, document, requested)).toThrow(/须独立重算/)
})
