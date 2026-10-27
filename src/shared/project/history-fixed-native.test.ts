import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { ProjectData } from '../model/project.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { emptyVisualSystem } from '../visual/types.js'
import { createEmptyGeneration, createEmptyRegional } from '../terrain-generation/contracts.js'
import { assertFixedProjectCompatible } from './history.js'

let sequence = 0
function fixture(): ProjectData {
  const document: SceneDocument = { ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 3, mapMode: 'scene',
    generation: createEmptyGeneration(), regional: null, visual: { version: 2, base: emptyVisualSystem(), materializedEdges: {} } }
  const content = createCompositionContent(document, { ids: { nextId: () => `history-fixed-${++sequence}` }, clock: { now: () => '2026-10-26T00:00:00.000Z' } })
  return { format: 'sceneweave-complete-project', schemaVersion: 3, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }
}

describe('fixed native-v3 definitions retain exact historical meaning', () => {
  it('rejects changed presentation metadata under the same fixed appearance source', () => {
    const source = fixture(), sourceId = Object.keys(source.appearance.sources)[0]
    source.appearance.presentations![sourceId] = { mode: 'topDown', rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround', groundShadowMm: null }
    const same = cloneJson(source)
    expect(() => assertFixedProjectCompatible(source, same)).not.toThrow()
    same.appearance.presentations![sourceId].rootAnchorMm.x = 100
    expect(() => assertFixedProjectCompatible(source, same)).toThrow(/固定来源/)
    const removed = cloneJson(source); delete removed.appearance.presentations![sourceId]
    expect(() => assertFixedProjectCompatible(source, removed)).toThrow(/不可添加或移除/)
    expect(() => assertFixedProjectCompatible(removed, source)).toThrow(/不可添加或移除/)
    const freshSource = cloneJson(source)
    freshSource.appearance.presentations!['new-fixed-source'] = { mode: 'topDown', rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround', groundShadowMm: null }
    expect(() => assertFixedProjectCompatible(source, freshSource)).not.toThrow()
  })
  it('rejects fixed regional symbol image, anchor, license or version redefinition under the same definition id', () => {
    const source = fixture(); source.document.regional = createEmptyRegional()
    source.document.regional.symbolDefinitions.tree = { id: 'tree', catalogId: 'test.regional.tree', version: 1, name: 'Regional tree', assetId: 'tree-image',
      licenseRef: 'test-license', origin: { kind: 'original', attribution: 'Test original', canEmbed: true },
      visualBoundsMm: { x: -100, y: -200, width: 200, height: 200 }, rootAnchorMm: { x: 0, y: 0 }, orientation: 'upright' }
    for (const mutate of [
      (copy: ProjectData) => { copy.document.regional!.symbolDefinitions.tree.assetId = 'different-image' },
      (copy: ProjectData) => { copy.document.regional!.symbolDefinitions.tree.rootAnchorMm.y = 10 },
      (copy: ProjectData) => { copy.document.regional!.symbolDefinitions.tree.licenseRef = 'different-license' },
      (copy: ProjectData) => { copy.document.regional!.symbolDefinitions.tree.version = 2 },
    ]) {
      const changed = cloneJson(source); mutate(changed)
      expect(() => assertFixedProjectCompatible(source, changed)).toThrow(/固定来源/)
    }
    const fresh = cloneJson(source)
    fresh.document.regional!.symbolDefinitions['new-tree'] = { ...fresh.document.regional!.symbolDefinitions.tree, id: 'new-tree', version: 2 }
    expect(() => assertFixedProjectCompatible(source, fresh)).not.toThrow()
  })
  it('requires a fresh cartographic profile version for explicit style changes', () => {
    const source = fixture(); source.document.regional = createEmptyRegional()
    const changed = cloneJson(source); changed.document.regional!.profile.landColor = '#FFFFFF'
    expect(() => assertFixedProjectCompatible(source, changed)).toThrow(/固定制图样式版本/)
    expect(() => assertFixedProjectCompatible(changed, source)).toThrow(/固定制图样式版本/)
    changed.document.regional!.profile.version++
    expect(() => assertFixedProjectCompatible(source, changed)).not.toThrow()
    changed.document.regional!.profile.id = 'independent-profile'
    expect(() => assertFixedProjectCompatible(source, changed)).not.toThrow()
  })
  it('keeps generation recipes immutable while ordinary intent records remain editable', () => {
    const source = fixture()
    source.document.generation!.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'terrain-scene', algorithmVersion: 1,
      mapMode: 'scene', seed: 'fixed-seed', parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 800,
        plateauElevationMm: 2000, roughness: .2, densityFactor: .2, baySide: 'south' }, materials: [], props: [],
      precision: { sampleSpacingMm: 1000, toleranceMm: 20, noiseCellMm: 4000 } }
    const changed = cloneJson(source); changed.document.generation!.recipes.recipe.seed = 'different-seed'
    expect(() => assertFixedProjectCompatible(source, changed)).toThrow(/固定来源/)
    changed.document.generation!.recipes.recipe = cloneJson(source.document.generation!.recipes.recipe)
    changed.document.generation!.intents.intent = { id: 'intent', floorId: 'blank-floor', visibility: 'public', boundsMm: cloneJson(source.document.exportBoundsMm), skeleton: [], constraintIds: [], preserveIds: [] }
    expect(() => assertFixedProjectCompatible(source, changed)).not.toThrow()
  })
})
