import { describe, expect, it } from 'vitest'
import { scatterLayerSceneV3, symbolPropV3 } from '../core/v3/test-fixtures.js'
import { createCompositionContentV6 } from '../core/v6/graph.js'
import { compositionFixtureV6, imageFixtureV6 } from '../core/v6/test-fixtures.js'
import type { CompositionContentV6 } from '../core/v6/types.js'
import { applyCompositionCommands, applyCompositionDraftCommands } from './appearance/commands.js'
import { createCompositionContent, resolveAppearance, syncAppearanceGraph, syncAppearanceGraphSnapshot } from './appearance/graph.js'
import { applySnapshotCommands } from './commands/commands.js'
import { assertOutdoorContinuity } from './history/identity.js'
import type { CompositionCommand, CompositionContent } from './model/appearance.js'
import type { SceneDocument } from './model/scene.js'
import type { PreparationContext } from './ports/runtime.js'
import { certifyCompositionContent, certifyCompositionDraft, getCertifiedCompositionContent, getCertifiedCompositionDraft, validateCompositionContent, validateCompositionDraft } from './validation/content.js'
import { cloneJson } from './validation/json.js'
import { isCertifiedSceneSnapshot } from './validation/snapshots.js'
import { emptyTerrainDocument } from './terrain-generation/compose.js'
import { emptyCompositionDocument } from './terrain-generation/composition-materialize.js'
import { emptyVisualSystem } from './visual/types.js'

const context = (): PreparationContext => {
  let allocated = 0
  return { ids: { nextId: () => `draft-proof-${++allocated}` }, clock: { now: () => '2026-10-25T00:00:00.000Z' } }
}
const native = (input: CompositionContentV6): CompositionContent => ({
  document: { ...cloneJson(input.document), format: 'sceneweave-scene', schemaVersion: 1 },
  historyIdentity: { ...cloneJson(input.historyIdentity), version: 1 }, appearance: cloneJson(input.appearance),
})
const sourceContent = () => certifyCompositionContent(native(compositionFixtureV6()))
const change: CompositionCommand[] = [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 35 } }]

function versionedSource(version: 1 | 2 | 3 | 4): CompositionContent {
  const source = native(compositionFixtureV6())
  let document: SceneDocument
  if (version === 1) document = source.document
  else {
    source.document.schemaVersion = 2
    source.document.visual = emptyVisualSystem()
    document = version === 2 ? source.document : emptyTerrainDocument(source.document)
    if (version === 4) document = emptyCompositionDocument(document)
  }
  return certifyCompositionContent(createCompositionContent(document, context()))
}

describe('internal immutable composition draft ownership', () => {
  it.each([1, 2, 3, 4] as const)('keeps pure prop edits equivalent in strict scene version %i', version => {
    const source = versionedSource(version), original = cloneJson(source)
    const commands: CompositionCommand[] = [
      { type: 'updateProp', id: 'item', changes: { rotationDeg: 35 } },
      { type: 'updateProp', id: 'other', changes: { positionMm: { x: source.document.props.other.positionMm.x + 100, y: source.document.props.other.positionMm.y } } },
    ]
    const internal = applyCompositionDraftCommands(source, commands, context())
    const publicResult = applyCompositionCommands(source, commands, context())
    expect(internal).toEqual(publicResult)
    expect(internal.appearance).toEqual(source.appearance)
    expect(internal.document.props.item.rotationDeg).toBe(35)
    expect(internal.document.props.other.positionMm.x).toBe(source.document.props.other.positionMm.x + 100)
    expect(source).toEqual(original)
  })

  it('runs graph synchronization for mixed entity edits that create mappings', () => {
    const source = sourceContent()
    const commands: CompositionCommand[] = [
      { type: 'updateProp', id: 'item', changes: { rotationDeg: 35 } },
      { type: 'copyProp', id: 'item', newId: 'copied-item', offsetMm: { x: 100, y: 0 } },
    ]
    const internal = applyCompositionDraftCommands(source, commands, context())
    const publicResult = applyCompositionCommands(source, commands, context())
    expect(internal).toEqual(publicResult)
    expect(internal.appearance.propSources['copied-item']).toBe(internal.appearance.propSources.item)
  })

  it('preserves the actual parsed scene through graph sync and complete certification', () => {
    const source = sourceContent(), next = applyCompositionDraftCommands(source, change, context())
    expect(getCertifiedCompositionDraft(next)).toBe(next)
    expect(getCertifiedCompositionContent(next)).toBeUndefined()
    expect(isCertifiedSceneSnapshot(next.document)).toBe(true)
    expect(Object.isFrozen(next.document.props.item.positionMm)).toBe(true)
    const synced = syncAppearanceGraphSnapshot(next)
    expect(synced.document).toBe(next.document)
    const publicSync = syncAppearanceGraph(next)
    publicSync.document.props.item.rotationDeg = 99
    expect(next.document.props.item.rotationDeg).toBe(35)
    const complete = certifyCompositionContent(next)
    expect(complete.document).toBe(next.document)
    expect(getCertifiedCompositionContent(complete)).toBe(complete)
    expect(source.document.props.item.rotationDeg).toBe(0)
  })

  it('keeps public command/draft/content results mutable and detached from the new draft proof', () => {
    const source = sourceContent(), internal = applyCompositionDraftCommands(source, change, context())
    const publicCommand = applyCompositionCommands(source, change, context())
    const publicDraft = validateCompositionDraft(internal), publicContent = validateCompositionContent(internal)
    for (const candidate of [publicCommand, publicDraft, publicContent]) {
      expect(getCertifiedCompositionDraft(candidate)).toBeUndefined()
      expect(getCertifiedCompositionContent(candidate)).toBeUndefined()
      candidate.document.props.item.rotationDeg = 80
      candidate.historyIdentity.propTokens.item = 'public-mutable-birth'
      candidate.appearance.propSources.item = 'public-mutable-source'
    }
    expect(internal.document.props.item.rotationDeg).toBe(35)
    expect(internal.historyIdentity.propTokens.item).toBe(source.historyIdentity.propTokens.item)
    expect(internal.appearance.propSources.item).toBe(source.appearance.propSources.item)
    expect(applyCompositionCommands(source, [], context())).toBe(source)
    expect(applyCompositionDraftCommands(source, [], context())).toBe(source)
  })

  it('does not transfer proof to replacement branches or caller-frozen clones', () => {
    const draft = applyCompositionDraftCommands(sourceContent(), change, context())
    for (const key of ['document', 'historyIdentity', 'appearance'] as const) {
      const replaced = { ...draft, [key]: cloneJson(draft[key]) }
      expect(getCertifiedCompositionDraft(replaced)).toBeUndefined()
      expect(getCertifiedCompositionContent(replaced)).toBeUndefined()
    }
    const fake = Object.freeze(cloneJson(draft))
    expect(getCertifiedCompositionDraft(fake)).toBeUndefined()
    expect(certifyCompositionDraft(fake)).not.toBe(fake)
    const badIdentity = cloneJson(draft); delete badIdentity.historyIdentity.propTokens.item
    expect(() => certifyCompositionDraft(badIdentity)).toThrow(/身份|token/)
    const badGraph = cloneJson(draft); delete badGraph.appearance.propSources.item
    expect(() => certifyCompositionDraft(badGraph)).toThrow(/外观源/)
    const badScene = cloneJson(draft); badScene.document.props.item.positionMm.x = -100000
    expect(() => certifyCompositionDraft(badScene)).toThrow(/边界|占地/)
  })

  it('does not promote unresolved or inconsistent appearance to a full proof', () => {
    const source = sourceContent(), pending = applyCompositionDraftCommands(source, [{
      type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'draft-opacity', kind: 'opacity', enabled: true, value: .4 },
    }], context())
    expect(pending.document.props.item.appearance.opacity).toBe(1)
    expect(getCertifiedCompositionDraft(pending)).toBe(pending)
    expect(() => validateCompositionContent(pending)).toThrow(/不一致/)
    expect(() => certifyCompositionContent(pending)).toThrow(/不一致/)
    expect(getCertifiedCompositionContent(pending)).toBeUndefined()
    const mutableDraft = validateCompositionDraft(pending)
    mutableDraft.document.props.item.rotationDeg = 20
    expect(pending.document.props.item.rotationDeg).toBe(0)
    const resolved = certifyCompositionContent(resolveAppearance(pending))
    expect(resolved.document.props.item.appearance.opacity).toBe(.4)
    const imageSource = certifyCompositionContent(native(imageFixtureV6()))
    const missingRaster = applyCompositionDraftCommands(imageSource, [{
      type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'draft-tint', kind: 'tint', enabled: true, value: '#AA8844' },
    }], context())
    expect(() => certifyCompositionContent(missingRaster)).toThrow(/尚未完整采用/)
    expect(getCertifiedCompositionContent(missingRaster)).toBeUndefined()
  })

  it('looks up only the exact descriptor snapshot without evaluating getters or Proxy reads', () => {
    const draft = applyCompositionDraftCommands(sourceContent(), change, context())
    let reads = 0
    const proxy = new Proxy({ ...draft }, { get() { reads++; throw new Error('must not read proxy properties') } })
    expect(getCertifiedCompositionDraft(proxy)).toBe(draft)
    expect(certifyCompositionDraft(proxy)).toBe(draft)
    expect(reads).toBe(0)
    const swapped = cloneJson(draft)
    swapped.document.props.item.rotationDeg = 110
    const splitView = new Proxy({ ...draft }, {
      getOwnPropertyDescriptor(target, key) { return Reflect.getOwnPropertyDescriptor(target, key) },
      get(_target, key) { reads++; return Reflect.get(swapped, key) },
    })
    expect(getCertifiedCompositionDraft(splitView)).toBe(draft)
    expect(certifyCompositionDraft(splitView)).toBe(draft)
    expect(reads).toBe(0)
    const complete = certifyCompositionContent(draft)
    expect(getCertifiedCompositionContent(splitView)).toBe(complete)
    expect(complete.document.props.item.rotationDeg).toBe(35)
    expect(reads).toBe(0)
    const accessor = Object.defineProperty({ ...draft }, 'appearance', { enumerable: true, get() { reads++; return draft.appearance } })
    expect(getCertifiedCompositionDraft(accessor)).toBeUndefined()
    expect(() => certifyCompositionDraft(accessor)).toThrow(/访问器/)
    expect(reads).toBe(0)
    for (const invalid of [Object.assign({ ...draft }, { extra: true }), Object.defineProperty({ ...draft }, 'hidden', { value: true }), Object.assign({ ...draft }, { [Symbol('extra')]: true })]) {
      expect(getCertifiedCompositionDraft(invalid)).toBeUndefined()
      expect(() => certifyCompositionDraft(invalid)).toThrow()
    }
  })

  it('observes both topology steps even when the scene JSON returns to its original value', () => {
    const source = certifyCompositionContent(native(createCompositionContentV6(scatterLayerSceneV3(0))))
    const seed = source.document.scatterGroups.scatter.seed
    const next = applyCompositionDraftCommands(source, [
      { type: 'configureScatter', id: 'scatter', changes: { seed: `${seed}-changed` } },
      { type: 'configureScatter', id: 'scatter', changes: { seed } },
    ], context())
    expect(next.document).toEqual(source.document)
    expect(next.historyIdentity.outdoorTokens.scatter.topologyHash).toBe(source.historyIdentity.outdoorTokens.scatter.topologyHash)
    expect(next.historyIdentity.outdoorTokens.scatter.topologyToken).not.toBe(source.historyIdentity.outdoorTokens.scatter.topologyToken)
    expect(() => assertOutdoorContinuity(next.historyIdentity, source.historyIdentity, ['scatter'])).toThrow(/连续性/)
    expect(getCertifiedCompositionDraft(next)).toBe(next)
  })

  it('matches public changed-entity accounting for nested arrays, missing optional fields and equal numeric values', () => {
    const source = certifyCompositionContent(native(createCompositionContentV6(scatterLayerSceneV3(0))))
    const area = source.document.terrainAreas.domain, boundaryMm = [...area.boundaryMm.slice(1), area.boundaryMm[0]]
    const commands: CompositionCommand[] = [
      { type: 'updateTerrainArea', id: area.id, changes: { boundaryMm } },
      { type: 'createNote', id: 'optional-note', floorId: area.floorId, anchor: { type: 'point', positionMm: { y: 8000, x: 8000 } },
        kind: 'note', text: 'A clue', visibility: 'gm', layerId: source.document.entityLayers[area.id] },
    ]
    const internal = applyCompositionDraftCommands(source, commands, context())
    const external = applyCompositionCommands(source, commands, context())
    expect(internal).toEqual(external)
    expect(internal.document.terrainAreas.domain.boundaryMm).toEqual(boundaryMm)
    expect(Object.hasOwn(internal.document.notes['optional-note'], 'title')).toBe(false)
    expect(Object.hasOwn(internal.document.notes['optional-note'], 'discovered')).toBe(false)
    expect(source.document.props.item.rotationDeg).toBe(0)
    const noop: CompositionCommand[] = [{ type: 'updateProp', id: 'item', changes: { rotationDeg: -0 } }]
    expect(applyCompositionDraftCommands(source, noop, context())).toEqual(applyCompositionCommands(source, noop, context()))
  })

  it('keeps snapshot observers detached from the returned parsed scene and retains public no-op identity', () => {
    const source = certifyCompositionContent(native(createCompositionContentV6(scatterLayerSceneV3(0)))).document
    const seen: Readonly<SceneDocument>[] = [], seed = source.scatterGroups.scatter.seed
    const next = applySnapshotCommands(source, [{ type: 'configureScatter', id: 'scatter', changes: { seed: `${seed}-changed` } }], context(), { onOutdoorDraft: draft => seen.push(draft) })
    expect(seen).toHaveLength(1)
    expect(next).not.toBe(seen[0]); expect(Object.isFrozen(seen[0])).toBe(false)
    const retained = seen[0] as SceneDocument
    retained.scatterGroups.scatter.seed = 'observer-retained-mutation'
    expect(next.scatterGroups.scatter.seed).toBe(`${seed}-changed`)
    expect(source.scatterGroups.scatter.seed).toBe(seed)
    expect(isCertifiedSceneSnapshot(next)).toBe(true)
    const noops: Readonly<SceneDocument>[] = []
    const noOp = applySnapshotCommands(source, [
      { type: 'configureScatter', id: 'scatter', changes: { seed: `${seed}-changed` } },
      { type: 'configureScatter', id: 'scatter', changes: { seed } },
    ], context(), { onOutdoorDraft: draft => noops.push(draft) })
    expect(noOp).toBe(source); expect(noops).toHaveLength(2)
  })

  it('retains command budgets, edit locks and complete geometric dependencies', () => {
    const source = sourceContent(), commands: CompositionCommand[] = Array.from({ length: 257 }, () => change[0])
    expect(() => applyCompositionDraftCommands(source, commands, context())).toThrow(/256/)
    const largeInput = compositionFixtureV6(), layerId = largeInput.document.entityLayers.item
    for (let index = 0; index < 255; index++) {
      const id = `draft-budget-${index}`
      largeInput.document.props[id] = symbolPropV3(id, 8000 + index, 8000)
      largeInput.document.entityLayers[id] = layerId
    }
    const large = certifyCompositionContent(native(createCompositionContentV6(largeInput.document)))
    expect(() => applyCompositionDraftCommands(large, [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId },
      adjustment: { id: 'draft-expanded-budget', kind: 'opacity', enabled: true, value: .5 } }], context())).toThrow(/256/)
    const locked = cloneJson(source); locked.document.userLayers[locked.document.entityLayers.item].editLocked = true
    expect(() => applyCompositionDraftCommands(locked, change, context())).toThrow(/锁定/)
    expect(() => applyCompositionDraftCommands(source, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: -100000, y: -100000 } } }], context())).toThrow(/边界|占地/)
    const invalid = cloneJson(source); invalid.document.props.item.supportRef = { kind: 'room', id: 'missing-room' }
    expect(() => applyCompositionDraftCommands(invalid, change, context())).toThrow()
    expect(source.document.props.item.rotationDeg).toBe(0)
  })
})
