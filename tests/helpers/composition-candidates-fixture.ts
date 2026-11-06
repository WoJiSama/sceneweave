import { toCurrentSceneDocument } from '../../src/shared/model/current-scene.js'
import native from '../../src/platform/browser/content/scenes-data.json'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import type { SceneDocument } from '../../src/shared/model/scene.js'
import { cloneJson } from '../../src/shared/validation/json.js'
import { emptyVisualSystem } from '../../src/shared/visual/types.js'
import { validateProjectData } from '../../src/shared/project/validate.js'
import type { AuthoringStartV4 as AuthoringStart } from '../../src/shared/ai/authoring-protocol-v4.js'
import { createCurrentAuthoringStartV4 } from '../../src/shared/ai/current-authoring.js'
import { authoringProjectHash } from '../../src/shared/ai/authoring.js'
import { svgProjectFixture } from './m24-svg-fixtures.js'

export function compositionCandidateFixture(): AuthoringStart {
  const image = cloneJson(svgProjectFixture().bundle.project), document = toCurrentSceneDocument(cloneJson(native.scenes.blank.document) as never)
  document.format = 'sceneweave-scene'; document.schemaVersion = 1; document.title = 'PRIVATE_COMPOSITION_PROJECT_TITLE'
  document.assets = image.document.assets; document.propDefinitions = image.document.propDefinitions; document.materials = {}; document.prefabDefinitions = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const definition = document.propDefinitions.definition
  definition.defaultVisualBoundsMm = { x: -500, y: -350, width: 1000, height: 700 }; definition.defaultFootprintMm = { width: 600, height: 400 }; definition.defaultBlocksMovement = true
  document.propDefinitions.alternate = { ...cloneJson(definition), id: 'alternate', catalogId: 'test.composition.alternate', defaultAppearance: { kind: 'symbol', symbol: 'shelf', tint: null, opacity: 1 } }
  const baseBinding = image.licenseBindings.find(value => value.subjectKind === 'propDefinition')!
  image.licenseBindings.push({ ...baseBinding, subjectId: 'alternate' })
  document.materials.tile = { id: 'tile', catalogId: 'test.composition.tile', version: 1, licenseRef: definition.licenseRef, origin: definition.origin,
    name: 'test tile', tags: [], textureAssetId: 'image', defaultTileSizeMm: { width: 1600, height: 800 }, applicableSurfaces: ['terrain', 'room', 'wall', 'path'] }
  image.licenseBindings.push({ ...baseBinding, subjectKind: 'material', subjectId: 'tile' })
  const floorId = Object.keys(document.floors)[0], layerId = Object.keys(document.userLayers)[0]
  document.floors[floorId].boundsMm = { x: 0, y: 0, width: 24000, height: 18000 }; document.exportBoundsMm = { ...document.floors[floorId].boundsMm }
  let counter = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `composition-fixture-${++counter}` }, clock: { now: () => '2026-10-26T00:00:00.000Z' } })
  const project = validateProjectData({ ...image, ...content, schemaVersion: 1 })
  return cloneJson(createCurrentAuthoringStartV4({ project, flowId: 'composition-candidate-test', preservation: { sceneId: project.document.sceneId, revision: project.document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 }, seed: 'b9f1f3bd-f028-43b8-865c-b09b0ea4357d', preparedAt: '2026-10-26T00:00:00.000Z',
    skill: { id: 'sceneweave-scene-authoring', version: 1 },
    scope: { targetIds: [], operations: [], placement: null,
      scene: { floorId, layerId, boundsMm: document.floors[floorId].boundsMm, entityIds: [], definitionIds: ['definition', 'alternate'], materialIds: ['tile'], prefabDefinitionIds: [],
        operations: ['room', 'opening', 'entrance', 'terrain', 'connection', 'furnish'] },
      visual: { floorId, layerId, boundsMm: document.floors[floorId].boundsMm, entityIds: [], definitionIds: ['definition', 'alternate'], materialIds: ['tile'],
        operations: ['visualSurface', 'visualEnvironment'], allowGlobalEnvironment: true } },
    brief: { recipe: 'island', requirements: ['asymmetric tiers and usable space'], style: { palette: ['#49644C', '#A9BA8B'], lineWeightMm: 20, textureScaleMm: 3200, detailDensity: .5, lightDirectionDeg: 65 } } }))
}
