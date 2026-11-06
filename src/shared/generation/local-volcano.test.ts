import { describe, expect, it } from 'vitest'
import data from '../../platform/browser/content/scenes-data.json'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { sceneSchema, validateSceneDocument } from '../validation/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { createCompositionContent, syncAppearanceGraph } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import { defaultVolcanoInput, runVolcanoGeneration, volcanoEntityId } from './domains/volcano/index.js'
import { regenerateVolcanoSurface } from './local-volcano.js'
import { localOwner } from './local-common.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import type { CompositionContent } from '../model/appearance.js'

const stamp = '2026-11-05T00:00:00.000Z', profile = taskBudgetProfile('standard'), checkCancelled = () => {}
const runtime = () => { let sequence = 0; return { clock: { now: () => stamp }, ids: { nextId: () => `d6-volcano-${++sequence}` } } }
function fixture() {
  const base = createShoreBlankDocument('island', { sceneId: 'local-volcano-test', title: '火山局改', now: stamp, widthMm: 40000, heightMm: 32000, preset: 'narrative' })
  for (const id of ['content-m-basalt', 'content-m-volcanic-ash', 'content-m-lava', 'content-m-lava-hot']) {
    const material = data.scenes.volcano.document.materials[id as keyof typeof data.scenes.volcano.document.materials]
    base.materials[id] = sceneSchema.shape.materials.valueType.parse(material)
    base.assets[material.textureAssetId] = sceneSchema.shape.assets.valueType.parse(data.scenes.volcano.document.assets[material.textureAssetId as keyof typeof data.scenes.volcano.document.assets])
  }
  const input = defaultVolcanoInput(base), generated = runVolcanoGeneration(base, input, { profile, nowMilliseconds: () => 0 })
  const content = createCompositionContent(cloneJson(generated.candidate.document) as typeof base, runtime())
  const recipeId = volcanoEntityId(base.sceneId, input.seed, 'recipe')
  return { content, input, generated, recipeId }
}
function complete(before: CompositionContent, document: CompositionContent['document'], commands: Parameters<typeof syncAppearanceGraph>[2] = []) {
  return syncAppearanceGraph({ document, appearance: before.appearance, historyIdentity: advanceHistoryIdentity(before.historyIdentity, before.document, document, runtime()) }, before.document, commands)
}

describe('selected generated volcanic surface edits', () => {
  it('adjusts same-topology crater and managed hazard outline while keeping real connection anchors, other geometry and birth', () => {
    const { content, generated, recipeId } = fixture(), before = canonicalJson(content), areaId = generated.report.craterAreaId
    const positionsMm = content.document.terrainAreas[areaId].boundaryMm.map(row => ({ ...row.positionMm }))
    positionsMm[0].y += 500; positionsMm[1].y += 500
    const request = { operation: 'volcano-boundary' as const, recipeId, areaId, positionsMm }
    const result = regenerateVolcanoSurface(content, request, runtime(), checkCancelled), after = complete(content, result.document, result.commands)
    expect(canonicalJson(content)).toBe(before)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(result.document.terrainConnections).toEqual(content.document.terrainConnections)
    expect(result.document.paths).toEqual(content.document.paths)
    expect(result.document.terrainAreas[areaId].boundaryMm.map(row => [row.id, row.segmentId])).toEqual(content.document.terrainAreas[areaId].boundaryMm.map(row => [row.id, row.segmentId]))
    expect(after.historyIdentity.outdoorTokens[areaId]).toEqual(content.historyIdentity.outdoorTokens[areaId])
    expect(result.document.regions[volcanoEntityId(content.document.sceneId, 'volcano-1', 'region:crater')].boundaryMm).toEqual(positionsMm)
    expect(localOwner(result.document, 'terrainArea', areaId).managedFields).toContain('geometry')
    expect(terrainCommandCost(content.document, after.document, { before: content, after }).total).toBeLessThanOrEqual(256)
    expect(result.readIds).toContain(generated.report.connectionIds[1])
  })
  it('changes only material and preserves independent region/physical policy and outside manual edits', () => {
    const { content: original, generated, recipeId } = fixture(), areaId = generated.report.flowAreaId!
    const content = applyCompositionCommands(original, [{ type: 'updateRegion', id: generated.report.regionIds[0], changes: { kind: 'terrain', movementCostMultiplier: 7 } }], runtime())
    const result = regenerateVolcanoSurface(content, { operation: 'volcano-material', recipeId, areaId, materialRef: { id: 'content-m-lava', version: 1 } }, runtime(), checkCancelled)
    expect(result.document.regions).toEqual(content.document.regions)
    expect(result.document.terrainAreas[areaId].boundaryMm).toEqual(content.document.terrainAreas[areaId].boundaryMm)
    const after = complete(content, result.document, result.commands)
    expect(after.appearance.surfaceSources[areaId]).not.toBe(content.appearance.surfaceSources[areaId])
    expect(after.document.terrainAreas[areaId].surfaceStyle?.base.materialRef).toEqual({ id: 'content-m-lava', version: 1 })
    expect(getLegacyGeneration(after.document)!.recipes).toEqual(getLegacyGeneration(content.document)!.recipes)
  })
  it('refuses support/connection conflict, manual geometry, locked layers and a changed topology without touching the source', () => {
    const { content, generated, recipeId } = fixture(), areaId = generated.report.craterAreaId, before = canonicalJson(content)
    const positionsMm = content.document.terrainAreas[areaId].boundaryMm.map(row => ({ ...row.positionMm }))
    positionsMm[0].x += 3000; positionsMm[3].x += 3000
    expect(() => regenerateVolcanoSurface(content, { operation: 'volcano-boundary', recipeId, areaId, positionsMm }, runtime(), checkCancelled)).toThrow()
    expect(() => regenerateVolcanoSurface(content, { operation: 'volcano-boundary', recipeId, areaId, positionsMm: positionsMm.slice(1) }, runtime(), checkCancelled)).toThrow(/拓扑/)
    const locked = applyCompositionCommands(content, [{ type: 'setEditLock', kind: 'terrainArea', id: areaId, locked: true }], runtime())
    expect(() => regenerateVolcanoSurface(locked, { operation: 'volcano-boundary', recipeId, areaId, positionsMm }, runtime(), checkCancelled)).toThrow(/锁/)
    const moved = applyCompositionCommands(content, [{ type: 'moveTerrainPoint', areaId, pointId: content.document.terrainAreas[areaId].boundaryMm[0].id, positionMm: { x: positionsMm[0].x - 3000, y: positionsMm[0].y + 100 } }], runtime())
    expect(() => regenerateVolcanoSurface(moved, { operation: 'volcano-boundary', recipeId, areaId, positionsMm }, runtime(), checkCancelled)).toThrow(/人工/)
    expect(canonicalJson(content)).toBe(before)
  })
})
