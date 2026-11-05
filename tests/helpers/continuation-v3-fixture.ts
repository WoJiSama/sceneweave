import { visualBase } from '../../src/shared/visual/base.js'
import { compositionOutputHash } from '../../src/shared/terrain-generation/composition-integrity.js'
import { createRefinedBlankDocument } from '../../src/platform/browser/content/refined-blank.js'
import { createCompositionContent, resolveAppearance } from '../../src/shared/appearance/graph.js'
import { inspectDependencies } from '../../src/shared/commands/dependencies.js'
import { validateProjectData } from '../../src/shared/project/validate.js'
import { composeTerrainDocument } from '../../src/shared/terrain-generation/compose.js'
import { getLegacyGeneration } from '../../src/shared/terrain-generation/composition-contracts.js'
import { constraintInputHash, generationInputHash, managedOutputHash } from '../../src/shared/terrain-generation/integrity.js'
import { prepareBaseMapRequestV3, executeBaseMapRequestV3 } from '../../src/shared/terrain-generation/base-map-v3.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import { createContinuationPolicyV2 } from '../../src/shared/ai/budget-policy.js'
import { TASK_BUDGET_PROFILES, type TaskBudgetProfileId } from '../../src/shared/budget/task-budget.js'
import { authoringProjectHash } from '../../src/shared/ai/authoring.js'
import { baseMapResourceClosureHash } from '../../src/shared/ai/continuation.js'
import { bindTerrainVariantPresentations } from '../../src/shared/visual/terrain-variant-presentations.js'
import { captureBaseMapSourceV3 } from '../../src/shared/ai/continuation-v3.js'
import type { AuthoringStartV3, BaseMapSourceV3 } from '../../src/shared/ai/continuation-protocol-v3.js'

const now = '2026-10-30T00:00:00.000Z'
/** Metadata/replay fixture. No actual resource-byte or pixel evidence. */
export function continuationFixtureV3(profileId: TaskBudgetProfileId = 'small', mode: 'terrain' | 'composition' = 'terrain'): AuthoringStartV3 {
  const profile = TASK_BUDGET_PROFILES[profileId], policy = createContinuationPolicyV2(profile)
  const document = createRefinedBlankDocument('island', { sceneId: 'continuation-map', title: '底图', widthMm: 24000, heightMm: 18000, preset: 'narrative', now })
  let blankId = 0
  const empty = createCompositionContent(document, { ids: { nextId: () => `blank-${++blankId}` }, clock: { now: () => now } })
  const text = 'MIT metadata fixture only', licenseHash = sha256Text(text), dependencies = inspectDependencies(empty.document)
  const blank = validateProjectData({ ...empty, format: 'sceneweave-complete-project', schemaVersion: 1,
    assets: Object.fromEntries(dependencies.assetIds.map(id => { const row = document.assets[id]; return [row.sha256, { sha256: row.sha256, mimeType: row.mimeType, sizeBytes: 1, pixelWidth: row.pixelWidth, pixelHeight: row.pixelHeight }] })),
    licenses: { [licenseHash]: { sha256: licenseHash, text } }, licenseBindings: dependencies.subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })), authoringSources: {} })
  const generation = mode === 'terrain' ? { kind: 'terrain' as const, input: { sceneId: document.sceneId, kind: 'island', seed: 'terrain-v1-0', algorithmVersion: 4, budgetProfileId: profileId, quality: 'standard' } }
    : { kind: 'composition' as const, input: { sceneId: document.sceneId, preset: 'archipelago', seed: 'terrain-v1-0', recipeVersion: 4, budgetProfileId: profileId, quality: 'standard', widthMm: 24000, heightMm: 18000 } }
  const request = prepareBaseMapRequestV3({ requestId: 'continuation-request', workspaceSceneId: 'original-main', checkpoint: 8, operationEpoch: 3,
    flowId: 'continuation-flow', profile, base: document, generation })
  const response = executeBaseMapRequestV3(request)
  const identityAllocation: string[] = [], runtime = { ids: { nextId: () => { const id = `source-${identityAllocation.length}`; identityAllocation.push(id); return id } }, clock: { now: () => now } }
  let generated = response.result.kind === 'terrain'
    ? response.result.terrain.input.algorithmVersion === 6 ? response.result.terrain.document : composeTerrainDocument(document, response.result.terrain as Parameters<typeof composeTerrainDocument>[1], runtime.ids.nextId(), profile).document
    : response.result.document
  if (response.result.kind === 'terrain') generated.title = `岩岛 · ${response.result.terrain.skeleton.name}`
  let content = response.result.kind==='terrain'&&response.result.terrain.input.algorithmVersion===6
    || request.generation.kind==='composition'&&request.generation.input.recipeVersion===6
    ? bindTerrainVariantPresentations(createCompositionContent(generated, runtime))
    : createCompositionContent(generated, runtime)
  if (content.document.generation?.version === 5) {
    for (const row of Object.values(content.document.generation.compositions)) row.outputHash = compositionOutputHash(content.document, row, content.historyIdentity)
  }
  content = resolveAppearance(content)
  if (content.document.generation?.version !== 5) {
    for (const rule of Object.values(getLegacyGeneration(content.document)!.rules)) { rule.inputHash = generationInputHash(content.document, rule); rule.managedOutputHash = managedOutputHash(content.document, rule) }
    for (const check of Object.values(getLegacyGeneration(content.document)!.checks)) check.inputHash = constraintInputHash(content.document, check.constraintId)
  }
  const project = validateProjectData({ ...blank, ...content, schemaVersion: content.document.schemaVersion })
  const source: BaseMapSourceV3 = { version: 3, flowId: request.flowId, blank,
    preservation: { sceneId: 'original-main', revision: 7, contentHash: 'a'.repeat(64), checkpoint: 8 }, request, response, preparedAt: now,
    identityAllocation, project, projectHash: authoringProjectHash(project), resourceClosureHash: baseMapResourceClosureHash(project),
    execution: { executor: 'worker', startedAt: now, completedAt: now, activeRuntimeMs: 1, generationCalls: 1, materializationCalls: 1 } }
  return { schemaVersion: 3, policy, source: captureBaseMapSourceV3(source), project, baseContentHash: authoringProjectHash(project),
    preparedAt: now, seed: '9d979366-7500-4bbe-96ef-5ea9a654b132', skill: { id: 'sceneweave-scene-authoring', version: 1 }, disclosure: 'complete-metadata/public-model',
    scope: { targetIds: Object.keys(project.document.props), operations: ['opacity'], placement: null, scene: {
      floorId: 'visual-floor', layerId: 'visual-layer-ground', generationLayerIds: Object.keys(project.document.userLayers), boundsMm: project.document.exportBoundsMm,
      entityIds: [...Object.keys(project.document.terrainAreas), ...Object.keys(project.document.terrainEdges), ...Object.keys(project.document.terrainConnections), ...Object.keys(project.document.paths), ...Object.keys(project.document.props), ...Object.keys(visualBase(project.document)?.boundaries ?? {}), ...Object.keys(visualBase(project.document)?.edgeLooks ?? {}), ...Object.keys(project.document.visual?.version === 3 ? project.document.visual.transitions : {})], definitionIds: Object.keys(project.document.propDefinitions), prefabDefinitionIds: [], materialIds: Object.keys(project.document.materials), operations: ['terrainUpdate'] } } }
}
