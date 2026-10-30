import { createRefinedBlankDocument } from '../../src/platform/browser/content/refined-blank.js'
import { createCompositionContent, resolveAppearance } from '../../src/shared/appearance/graph.js'
import { inspectDependencies } from '../../src/shared/commands/dependencies.js'
import { validateProjectData } from '../../src/shared/project/validate.js'
import { composeTerrainDocument } from '../../src/shared/terrain-generation/compose.js'
import { getLegacyGeneration } from '../../src/shared/terrain-generation/composition-contracts.js'
import { constraintInputHash, generationInputHash, managedOutputHash } from '../../src/shared/terrain-generation/integrity.js'
import { prepareBaseMapRequestV2, executeBaseMapRequestV2 } from '../../src/shared/terrain-generation/base-map-v2.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import { CONTINUATION_POLICY } from '../../src/shared/ai/budget-policy.js'
import { authoringProjectHash } from '../../src/shared/ai/authoring.js'
import { captureBaseMapSource, baseMapResourceClosureHash } from '../../src/shared/ai/continuation.js'
import type { AuthoringStartV2, BaseMapSource } from '../../src/shared/ai/continuation-protocol.js'

const now = '2026-10-30T00:00:00.000Z'
/** Metadata/replay fixture. No actual resource-byte or pixel evidence. */
export function continuationFixture(): AuthoringStartV2 {
  const document = createRefinedBlankDocument('island', { sceneId: 'continuation-map', title: '底图', widthMm: 24000, heightMm: 18000, preset: 'narrative', now })
  let blankId = 0
  const empty = createCompositionContent(document, { ids: { nextId: () => `blank-${++blankId}` }, clock: { now: () => now } })
  const text = 'MIT metadata fixture only', licenseHash = sha256Text(text), dependencies = inspectDependencies(empty.document)
  const blank = validateProjectData({ ...empty, format: 'sceneweave-complete-project', schemaVersion: 2,
    assets: Object.fromEntries(dependencies.assetIds.map(id => { const row = document.assets[id]; return [row.sha256, { sha256: row.sha256, mimeType: row.mimeType, sizeBytes: 1, pixelWidth: row.pixelWidth, pixelHeight: row.pixelHeight }] })),
    licenses: { [licenseHash]: { sha256: licenseHash, text } }, licenseBindings: dependencies.subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })), authoringSources: {} })
  const request = prepareBaseMapRequestV2({ requestId: 'continuation-request', workspaceSceneId: 'original-main', checkpoint: 8, operationEpoch: 3,
    flowId: 'continuation-flow', policy: CONTINUATION_POLICY, base: document, generation: { kind: 'terrain', input: { sceneId: document.sceneId, kind: 'island', seed: 'terrain-v1-0' } } })
  const response = executeBaseMapRequestV2(request)
  if (response.result.kind !== 'terrain') throw new Error('fixture shape')
  const identityAllocation: string[] = [], runtime = { ids: { nextId: () => { const id = `source-${identityAllocation.length}`; identityAllocation.push(id); return id } }, clock: { now: () => now } }
  const generated = composeTerrainDocument(document, response.result.terrain, runtime.ids.nextId())
  generated.document.title = `岩岛 · ${response.result.terrain.skeleton.name}`
  const content = resolveAppearance(createCompositionContent(generated.document, runtime))
  for (const rule of Object.values(getLegacyGeneration(content.document)!.rules)) { rule.inputHash = generationInputHash(content.document, rule); rule.managedOutputHash = managedOutputHash(content.document, rule) }
  for (const check of Object.values(content.document.generation!.checks)) check.inputHash = constraintInputHash(content.document, check.constraintId)
  const project = validateProjectData({ ...blank, ...content, schemaVersion: 3 })
  const source: BaseMapSource = { version: 2, flowId: request.flowId, blank,
    preservation: { sceneId: 'original-main', revision: 7, contentHash: 'a'.repeat(64), checkpoint: 8 }, request, response, preparedAt: now,
    identityAllocation, project, projectHash: authoringProjectHash(project), resourceClosureHash: baseMapResourceClosureHash(project),
    execution: { executor: 'worker', startedAt: now, completedAt: now, activeRuntimeMs: 1, generationCalls: 1, materializationCalls: 1 } }
  return { schemaVersion: 2, policy: CONTINUATION_POLICY, source: captureBaseMapSource(source), project, baseContentHash: authoringProjectHash(project),
    preparedAt: now, seed: '9d979366-7500-4bbe-96ef-5ea9a654b132', skill: { id: 'sceneweave-scene-authoring', version: 1 }, disclosure: 'complete-metadata/public-model',
    scope: { targetIds: Object.keys(project.document.props), operations: ['opacity'], placement: null, scene: {
      floorId: 'visual-floor', layerId: 'visual-layer-ground', generationLayerIds: Object.keys(project.document.userLayers), boundsMm: project.document.exportBoundsMm,
      entityIds: [...Object.keys(project.document.terrainAreas), ...Object.keys(project.document.terrainEdges), ...Object.keys(project.document.terrainConnections), ...Object.keys(project.document.paths), ...Object.keys(project.document.props)], definitionIds: Object.keys(project.document.propDefinitions), prefabDefinitionIds: [], materialIds: Object.keys(project.document.materials), operations: ['terrainUpdate'] } } }
}
