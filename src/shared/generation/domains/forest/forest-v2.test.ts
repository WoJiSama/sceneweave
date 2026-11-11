import { describe, expect, it } from 'vitest'
import { domainExecutionFixture } from '../../../../../tools/testing/domain-execution-fixtures.js'
import { createCompositionContent } from '../../../appearance/graph.js'
import { applyCompositionCommands } from '../../../appearance/commands.js'
import { bindTerrainVariantPresentations, bindTerrainVariantV2Presentations } from '../../../visual/terrain-variant-presentations.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { polygonInside, propFootprint, supportedPolygon } from '../../../geometry/geometry.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { decorationAsProp } from '../../../decorations/geometry.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { forestGenerationRecipeSchema, generationRecipeSchema } from '../../../terrain-generation/contracts.js'
import type { SceneDocument } from '../../../model/scene.js'
import { createDomainExecutionRequest, executeDomainExecutionRequest } from '../../execution.js'
import { regenerateForestZone } from '../../local-forest.js'
import { forestGenerationInputSchema, normalizeForestInput, runForestGeneration, type ForestGenerationInput } from './index.js'

const options = { profile: domainExecutionFixture('forest').profile, nowMilliseconds: () => 0 }
function fixture(algorithmVersion: ForestGenerationInput['algorithmVersion']) {
  const { base, input } = domainExecutionFixture('forest')
  input.algorithmVersion = algorithmVersion
  input.parameters.zones[0].vegetation.push({ role: 'shrub', coveragePpm: 5000, spacingMm: 800, clusterRadiusMm: 4500, clearanceMm: 100,
    palette: [{ key: 'shrub', kind: 'decoration', definitionRef: { id: 'terrain-variants-v1-prop-shrub-heath-mound', version: 1 }, weight: 1 }] })
  return { base, input }
}

describe('forest algorithm 2 with explicit algorithm 1 replay', () => {
  it('retains the same normalization for both algorithms and rejects unknown selectors', () => {
    const { input } = fixture(1), before = canonicalJson(input), next = cloneJson(input)
    next.algorithmVersion = 2
    const legacy = normalizeForestInput(input), current = normalizeForestInput(next)
    expect(current.parameters).toEqual(legacy.parameters)
    next.parameters.zones[0].vegetation.reverse()
    expect(normalizeForestInput(next)).toEqual(current)
    expect(canonicalJson(input)).toBe(before)
    for (const algorithmVersion of [0, 3, '2', undefined]) expect(forestGenerationInputSchema.safeParse({ ...input, algorithmVersion }).success).toBe(false)
  })

  it.each([1, 2] as const)('persists paired algorithm/recipe %s with real supported members and full-width routes', algorithmVersion => {
    const { base, input } = fixture(algorithmVersion), before = canonicalJson(base)
    const result = runForestGeneration(base, input, options), document = cloneJson(result.candidate.document) as SceneDocument
    const generation = getLegacyGeneration(document)!, recipes = Object.values(generation.recipes)
    const recipe = recipes.find(row => 'domain' in row && row.domain === 'forest')!
    expect(recipe).toMatchObject({ domain: 'forest', algorithmId: 'forest-layout', recipeVersion: algorithmVersion, algorithmVersion })
    expect(forestGenerationRecipeSchema.safeParse(recipe).success).toBe(true)
    for (const schema of [forestGenerationRecipeSchema, generationRecipeSchema]) {
      expect(schema.safeParse({ ...recipe, recipeVersion: algorithmVersion === 1 ? 2 : 1 }).success).toBe(false)
      expect(schema.safeParse({ ...recipe, algorithmVersion: algorithmVersion === 1 ? 2 : 1 }).success).toBe(false)
    }
    expect(Object.values(generation.rules).filter(rule => rule.kind === 'forest').every(rule => rule.recipeRef.id === recipe.id && rule.recipeRef.version === algorithmVersion)).toBe(true)
    expect(result.candidate.stages.map(stage => stage.operator)).toEqual([
      { id: 'forest-ground', version: algorithmVersion }, { id: 'forest-routes', version: algorithmVersion }, { id: 'forest-vegetation', version: algorithmVersion },
    ])
    expect(result.report.vegetation.map(row => row.role)).toEqual(algorithmVersion === 1
      ? result.input.parameters.zones[0].vegetation.map(row => row.role) : ['tree', 'shrub', 'grass'])
    expect(result.report.propIds.length).toBeGreaterThan(0)
    for (const row of result.report.vegetation) {
      const zone = result.input.parameters.zones.find(zone => zone.id === row.zoneId)!, cluster = document.decorationClusters[row.clusterId]
      expect(row.placed).toBeLessThanOrEqual(row.requested)
      for (const member of Object.values(cluster.members)) if (member.entityId) {
        const prop = member.kind === 'prop' ? document.props[member.entityId] : decorationAsProp(document, document.decorations[member.entityId])
        expect(polygonInside(propFootprint(prop), zone.boundaryMm)).toBe(true)
        expect(supportedPolygon(document, propFootprint(prop), cluster.supportRef, prop.floorId)).toBe(true)
      }
    }
    for (const pathId of result.report.pathIds) {
      const path = document.paths[pathId]
      expect(checkTerrainRoute(document, { floorId: path.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).ok).toBe(true)
    }
    expect(validateSceneDocument(JSON.parse(JSON.stringify(document))).ok).toBe(true)
    expect(canonicalJson(base)).toBe(before)
  }, 30000)

  it('replays algorithm 2 through the shared protocol with its own derived cluster seeds', () => {
    const { base, input } = fixture(2), direct = runForestGeneration(base, input, options), legacyInput = cloneJson(input)
    legacyInput.algorithmVersion = 1
    const legacy = runForestGeneration(base, legacyInput, options)
    const treeCluster = (result: typeof direct) => result.candidate.document.decorationClusters[result.report.vegetation.find(row => row.role === 'tree')!.clusterId]
    expect(treeCluster(direct).seed).not.toBe(treeCluster(legacy).seed)
    const reordered = cloneJson(input)
    reordered.parameters.zones[0].vegetation.reverse()
    expect(runForestGeneration(base, reordered, options)).toEqual(direct)
    const request = createDomainExecutionRequest({ requestId: 'forest-v2-replay', context: { workspaceId: 'forest-v2', checkpoint: 0, epoch: 1 },
      domain: 'forest', base, input, profile: options.profile })
    const response = executeDomainExecutionRequest(request, { nowMilliseconds: () => 0 })
    expect(response.result.resultHash).toBe(direct.resultHash)
    expect(response.result.candidate.document).toEqual(direct.candidate.document)
    expect(response.result.report).toEqual(direct.report)
    expect(response.result.candidate.stages).toEqual(direct.candidate.stages)
  }, 30000)

  it('keeps moved and deleted v2 slots during a selected-channel density edit', () => {
    const { base, input } = fixture(2), result = runForestGeneration(base, input, options)
    let nextId = 0
    const runtime = { ids: { nextId: () => `forest-v2-local-${++nextId}` }, clock: { now: () => '2026-11-11T00:00:00.000Z' } }
    const initial = bindTerrainVariantV2Presentations(bindTerrainVariantPresentations(createCompositionContent(result.candidate.document as SceneDocument, runtime)))
    const trees = result.report.propIds
    expect(trees.length).toBeGreaterThan(1)
    const movedId = trees[0], deletedId = trees[1], moved = initial.document.props[movedId]
    const edited = applyCompositionCommands(initial, [
      { type: 'updateProp', id: movedId, changes: { positionMm: { x: moved.positionMm.x + 1, y: moved.positionMm.y } } },
      { type: 'deleteProp', id: deletedId },
    ], runtime)
    const before = canonicalJson(edited), recipe = Object.values(getLegacyGeneration(edited.document)!.recipes).find(row => 'domain' in row && row.domain === 'forest')!
    const local = regenerateForestZone(edited, { recipeId: recipe.id, zoneId: 'woods', role: 'tree', coveragePpm: 90000 }, runtime,
      { profile: options.profile, checkCancelled() {} })
    expect(local.document.props[movedId]).toEqual(edited.document.props[movedId])
    expect(local.document.props[deletedId]).toBeUndefined()
    expect(local.document.decorations).toEqual(edited.document.decorations)
    expect(getLegacyGeneration(local.document)!.recipes[recipe.id]).toEqual(recipe)
    expect(local.document.paths).toEqual(edited.document.paths)
    expect(validateSceneDocument(local.document).ok).toBe(true)
    expect(canonicalJson(edited)).toBe(before)
  }, 30000)
})
