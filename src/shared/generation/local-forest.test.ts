import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createCompositionContent, syncAppearanceGraph } from '../appearance/graph.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { bindTerrainVariantPresentations, bindTerrainVariantV2Presentations } from '../visual/terrain-variant-presentations.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { forestEntityId, forestRectangle, runForestGeneration, type ForestGenerationInput } from './domains/forest/index.js'
import { regenerateForestZone } from './local-forest.js'

const stamp = '2026-11-05T00:00:00.000Z', profile = taskBudgetProfile('standard')
function runtime() { let next = 0; return { clock: { now: () => stamp }, ids: { nextId: () => `forest-local-test-${++next}` } } }
function fixture(algorithmVersion: ForestGenerationInput['algorithmVersion']) {
  const base = createShoreBlankDocument('island', { sceneId: 'forest-local', title: '局部森林', now: stamp, widthMm: 32000, heightMm: 24000, preset: 'narrative' }, true, true)
  const floorId = Object.keys(base.floors)[0], layerId = Object.keys(base.userLayers)[0], seed = 'local-forest'
  const input: ForestGenerationInput = { version: 1, algorithmVersion, seed, parameters: {
    floorId, layerId, boundsMm: { x: 0, y: 0, width: 32000, height: 24000 }, ground: { kind: 'new', elevationMm: 0, materialRef: null },
    zones: [{ id: 'woods', supportRef: { kind: 'generated-ground' }, boundaryMm: forestRectangle({ x: 1000, y: 1000, width: 30000, height: 22000 }), vegetation: [
      { role: 'tree', coveragePpm: 20000, spacingMm: 1000, clusterRadiusMm: 6000, clearanceMm: 200, palette: [{ key: 'tree', definitionRef: { id: 'terrain-variants-v2-prop-tree-highland-copse', version: 1 }, kind: 'prop', weight: 1 }] },
    ] }], clearings: [], entrances: [], routes: [],
  } }
  const result = runForestGeneration(base, input, { profile, nowMilliseconds: () => 0 })
  const context = runtime()
  const content = bindTerrainVariantV2Presentations(bindTerrainVariantPresentations(createCompositionContent(result.candidate.document as typeof base, context)))
  return { content, context, recipeId: forestEntityId(base.sceneId, seed, 'recipe'), clusterId: forestEntityId(base.sceneId, seed, 'cluster:woods:trees') }
}
describe('selected forest channel regeneration', () => {
  it.each([1, 2] as const)('algorithm %s changes only managed members while preserving moved, deleted, locked and detached slots', algorithmVersion => {
    const f = fixture(algorithmVersion), trees = Object.values(f.content.document.props)
    expect(trees.length).toBeGreaterThanOrEqual(4)
    let content = applyCompositionCommands(f.content, [
      { type: 'updateProp', id: trees[0].id, changes: { positionMm: { x: trees[0].positionMm.x + 100, y: trees[0].positionMm.y } } },
      { type: 'deleteProp', id: trees[1].id },
      { type: 'detachDecorationMember', clusterId: f.clusterId, entityId: trees[3].id },
    ], f.context)
    content = applyCompositionCommands(content, [{ type: 'setEditLock', kind: 'prop', id: trees[2].id, locked: true }], f.context)
    const before = canonicalJson(content), priorCluster = content.document.decorationClusters[f.clusterId]
    const result = regenerateForestZone(content, { recipeId: f.recipeId, zoneId: 'woods', role: 'tree', coveragePpm: 30000 }, f.context, { profile, checkCancelled() {} })
    expect(canonicalJson(content)).toBe(before)
    for (const index of [0, 2, 3]) expect(result.document.props[trees[index].id]).toEqual(content.document.props[trees[index].id])
    expect(result.document.props[trees[1].id]).toBeUndefined()
    for (const [key, member] of Object.entries(priorCluster.members)) if (member.state !== 'managed' || member.entityId === trees[2].id) expect(result.document.decorationClusters[f.clusterId].members[key]).toEqual(member)
    expect(result.writes.some(row => row.kind === 'surfaceRule')).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(getLegacyGeneration(result.document)!.recipes[f.recipeId]).toEqual(getLegacyGeneration(content.document)!.recipes[f.recipeId])
    const historyIdentity = advanceHistoryIdentity(content.historyIdentity, content.document, result.document, f.context)
    const after = syncAppearanceGraph({ document: result.document, historyIdentity, appearance: content.appearance }, content.document, result.commands ?? [])
    const cost = terrainCommandCost(content.document, after.document, { before: content, after })
    expect(cost.total).toBeGreaterThan(0)
    expect(cost.total).toBeLessThanOrEqual(256)
  }, 30000)
  it.each([1, 2] as const)('algorithm %s rejects a manually adjusted rule or cancellation without changing the source', algorithmVersion => {
    const f = fixture(algorithmVersion), ruleId = forestEntityId(f.content.document.sceneId, 'local-forest', 'surface:woods:trees')
    const content = applyCompositionCommands(f.content, [{ type: 'updateSurfaceVegetation', id: ruleId, coveragePpm: 25000 }], f.context), before = canonicalJson(content)
    expect(() => regenerateForestZone(content, { recipeId: f.recipeId, zoneId: 'woods', role: 'tree', coveragePpm: 30000 }, f.context, { profile, checkCancelled() {} })).toThrow(/人工/)
    expect(canonicalJson(content)).toBe(before)
    expect(() => regenerateForestZone(f.content, { recipeId: f.recipeId, zoneId: 'woods', role: 'tree', coveragePpm: 30000 }, f.context, { profile, checkCancelled() { throw new Error('cancelled') } })).toThrow('cancelled')
  }, 30000)
})
