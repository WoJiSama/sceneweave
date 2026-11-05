import { createRefinedBlankDocument } from '../../src/platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { inspectDependencies } from '../../src/shared/commands/dependencies.js'
import { emptyTerrainDocument, composeTerrainDocument } from '../../src/shared/terrain-generation/compose.js'
import { generateTerrainDocument } from '../../src/shared/terrain-generation/generate.js'
import { validateProjectData } from '../../src/shared/project/validate.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import { authoringProjectHash } from '../../src/shared/ai/authoring.js'
import type { AuthoringStartV4 as AuthoringStart } from '../../src/shared/ai/authoring-protocol-v4.js'
import { createCurrentAuthoringStartV4 } from '../../src/shared/ai/current-authoring.js'
import { cloneJson } from '../../src/shared/validation/json.js'
import { visualBase } from '../../src/shared/visual/base.js'

/** Metadata/replay fixture only: it deliberately provides no resource-byte or image evidence. */
export function terrainAuthoringFixture(generated = false, regionalSize = false): AuthoringStart {
  const blank = createRefinedBlankDocument('island', { sceneId: 'terrain-ai-fixture', title: 'PRIVATE_TITLE', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-10-27T00:00:00.000Z' })
  if (regionalSize) { blank.exportBoundsMm = { x: 0, y: 0, width: 1_000_000, height: 800_000 }; blank.floors['visual-floor'].boundsMm = { ...blank.exportBoundsMm } }
  const document = generated ? composeTerrainDocument(blank, generateTerrainDocument(blank, { sceneId: blank.sceneId, seed: 'terrain-v1-0', kind: 'island' }), 'terrain-fixture').document : emptyTerrainDocument(blank)
  let sequence = 0
  const runtime = { ids: { nextId: () => `terrain-ai-fixture-${++sequence}` }, clock: { now: () => blank.createdAt } }, content = createCompositionContent(document, runtime)
  const licenseText = 'Sceneweave test-only metadata license', licenseHash = sha256Text(licenseText), dependencies = inspectDependencies(content.document)
  const assets = Object.fromEntries(dependencies.assetIds.map(id => { const asset = document.assets[id]; return [asset.sha256, { sha256: asset.sha256, mimeType: asset.mimeType, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight, sizeBytes: 1 }] }))
  const project = validateProjectData({ ...content, format: 'sceneweave-complete-project', schemaVersion: 1, assets, licenses: { [licenseHash]: { sha256: licenseHash, text: licenseText } },
    licenseBindings: dependencies.subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })), authoringSources: {} })
  const visual = visualBase(document) ?? { boundaries: {}, edgeLooks: {} }
  return cloneJson(createCurrentAuthoringStartV4({ project, flowId: 'terrain-authoring-test', preservation: { sceneId: project.document.sceneId, revision: project.document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 }, seed: '9d979366-7500-4bbe-96ef-5ea9a654b132', preparedAt: blank.createdAt,
    skill: { id: 'sceneweave-scene-authoring', version: 1 }, scope: { targetIds: [], operations: [], placement: null, scene: {
      floorId: 'visual-floor', layerId: 'visual-layer-ground', generationLayerIds: Object.keys(document.userLayers), boundsMm: document.exportBoundsMm,
      entityIds: [...Object.keys(document.terrainAreas), ...Object.keys(document.terrainConnections), ...Object.keys(document.props), ...Object.keys(document.paths), ...Object.keys(visual.boundaries), ...Object.keys(visual.edgeLooks)],
      definitionIds: Object.keys(document.propDefinitions), materialIds: Object.keys(document.materials), prefabDefinitionIds: [], operations: ['terrainGenerate', 'terrainEdit', 'regionalGenerate', 'regionalEdit'] } } }))
}

/** A new test authorization after deliberately constructing another valid baseline. */
export function reauthorizeTerrainFixture(start: AuthoringStart): AuthoringStart {
  const project = start.project
  return cloneJson(createCurrentAuthoringStartV4({ project, scope: start.scope, seed: start.seed, preparedAt: start.preparedAt, flowId: 'terrain-authoring-test',
    preservation: { sceneId: project.document.sceneId, revision: project.document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 }, brief: start.brief, skill: start.skill }))
}
