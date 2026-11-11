import { describe, expect, it } from 'vitest'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { cloneJson } from '../validation/json.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCommands, createPlacedProp } from '../commands/commands.js'
import { validateCompositionContent } from '../validation/content.js'
import { resolveFloorOutput } from './output.js'

const runtime = () => { let sequence = 0; return { ids: { nextId: () => `floor-place-${++sequence}` }, clock: { now: () => '2026-11-10T00:00:00.000Z' } } }
function source() {
  const scene = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' }), prop = scene.props.item
  scene.propDefinitions.chair = { id: 'chair', version: 1, catalogId: 'test.floor-place', licenseRef: 'MIT', origin: { kind: 'original', attribution: 'test', canEmbed: true }, name: '测试椅', tags: [],
    defaultAppearance: prop.appearance, defaultVisualBoundsMm: prop.visualBoundsMm, defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm,
    defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  return scene
}
describe('ordinary finite placement and current structure initialization', () => {
  it('places on the explicitly selected Floor/layer and refuses an ambiguous or conflicting target', () => {
    const context = runtime(), initial = createCompositionContent(source(), context), bounds = { x: 0, y: 0, width: 12000, height: 15000 }
    const current = applyCompositionCommands(initial, [{ type: 'createFloor', id: 'B', name: 'B', boundsMm: bounds, outputBoundsMm: bounds, newLayerId: 'B-layer', layerName: 'B地面' }], context)
    const prop = createPlacedProp(current.document, 'chair', { x: 2000, y: 3000 }, context, { layerId: 'B-layer' })
    expect(prop.floorId).toBe('B'); expect(prop.supportRef).toEqual({ kind: 'floor', id: 'B' })
    expect(() => createPlacedProp(current.document, 'chair', { x: 2000, y: 3000 }, context)).toThrow(/明确/)
    expect(() => createPlacedProp(current.document, 'chair', { x: 2000, y: 3000 }, context, { floorId: 'blank-floor', layerId: 'B-layer' })).toThrow(/不一致/)
    const before = resolveFloorOutput(current.document, 'blank-floor')
    const changed = applyCommands(current.document, [{ type: 'setCanvasBounds', floorId: 'B', floorBoundsMm: bounds, exportBoundsMm: { x: 1000, y: 1000, width: 9000, height: 13000 } }], context)
    expect(resolveFloorOutput(changed, 'blank-floor')).toEqual(before)
    expect(resolveFloorOutput(changed, 'B').boundsMm.width).toBe(9000)
  })
  it('initializes the current structures explicitly without changing geometry or inventing historic witnesses', () => {
    const context = runtime(), legacy = createCompositionContent(source(), context)
    delete legacy.historyIdentity.structureTokens
    expect(validateCompositionContent(legacy).historyIdentity.structureTokens).toBeUndefined()
    const next = applyCompositionCommands(legacy, [{ type: 'initializeStructureIdentity' }], context)
    expect(next.document).toEqual(legacy.document)
    expect(next.historyIdentity.structureTokens!['blank-floor'].kind).toBe('floor')
    expect(legacy.historyIdentity.structureTokens).toBeUndefined()
    expect(() => applyCommands(legacy.document, [{ type: 'initializeStructureIdentity' }], context)).toThrow(/完整工程/)
    expect(() => applyCompositionCommands(legacy, [{ type: 'initializeStructureIdentity' }, { type: 'deleteProp', id: 'item' }], context)).toThrow(/独立/)
  })
})
