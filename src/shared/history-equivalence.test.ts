import { describe, expect, it } from 'vitest'
import { scatterLayerSceneV3, symbolPropV3 } from '../core/v3/test-fixtures.js'
import type { SceneDocumentV3 } from '../core/v3/types.js'
import { createHistoryIdentityV4 } from '../core/v4/identity.js'
import { StructureContinuitySessionV4 } from '../core/v4/structure-continuity.js'
import { buildStructureRestorePlanV4 } from '../core/v4/structure-restore.js'
import { applyCompositionCommandsV6 } from '../core/v6/commands.js'
import { createCompositionContentV6, inspectAppearanceScopeV6, listRequiredVariantsV6, resolveAppearanceV6 } from '../core/v6/graph.js'
import { advanceHistoryIdentityV6, createHistoryIdentityTraceV6, outdoorIdentityDescriptorsV6 } from '../core/v6/identity.js'
import { buildRestorePlanV6 } from '../core/v6/restore.js'
import { compositionFixtureV6, imageFixtureV6, prefabFixtureV6, surfaceFixtureV6 } from '../core/v6/test-fixtures.js'
import type { CompositionCommandV6, CompositionContentV6 } from '../core/v6/types.js'
import { applyCompositionCommands } from './appearance/commands.js'
import { createAppearanceGraph, createCompositionContent, inspectAppearanceScope, listRequiredVariants, resolveAppearance } from './appearance/graph.js'
import { advanceHistoryIdentity, assertOutdoorContinuity, createHistoryIdentity, createHistoryIdentityTrace, mergeIdentityRecords, outdoorIdentityDescriptors, validateHistoryIdentity } from './history/identity.js'
import { buildRestorePlan } from './history/restore.js'
import { StructureContinuitySession } from './history/structure-continuity.js'
import { buildStructureRestorePlan } from './history/structure-restore.js'
import type { CompositionCommand, CompositionContent } from './model/appearance.js'
import type { SceneDocument } from './model/scene.js'
import type { PreparationContext } from './ports/runtime.js'
import { certifyCompositionContent, getCertifiedCompositionContent, reviseCompositionContent, validateAppearanceGraph, validateCompositionContent } from './validation/content.js'
import { cloneJson, inspectJsonInput } from './validation/json.js'

const stamp = '2026-10-24T00:00:00.000Z'
// Differential fixtures contain only commands supported by both historical and current contracts.
type EquivalenceCommand = CompositionCommand & CompositionCommandV6
const context = (): PreparationContext => {
  let allocated = 0
  return { ids: { nextId: () => `native-test-${++allocated}` }, clock: { now: () => stamp } }
}
/** Test-only discriminator adapter; production conversion is a later slice. */
const nativeScene = (document: SceneDocumentV3): SceneDocument => ({ ...cloneJson(document), format: 'sceneweave-scene', schemaVersion: 1 })
const native = (input: CompositionContentV6): CompositionContent => ({ document: nativeScene(input.document), historyIdentity: { ...cloneJson(input.historyIdentity), version: 1 }, appearance: cloneJson(input.appearance) })
const triad = (input: CompositionContent): CompositionContent => ({ document: input.document, historyIdentity: input.historyIdentity, appearance: input.appearance })
function legacy(input: CompositionContent): CompositionContentV6 {
  const copy = cloneJson(triad(input)), { format: _format, ...document } = copy.document
  if (copy.appearance.version !== 1) throw new Error('Legacy equivalence fixture only accepts appearance1.')
  return { document: { ...document, format: 'sceneweave', schemaVersion: 3 }, historyIdentity: { ...copy.historyIdentity, version: 3 }, appearance: { ...copy.appearance, version: 1 } }
}
const compare = (actual: CompositionContent, expected: CompositionContentV6) => expect(legacy(actual)).toEqual({ document: expected.document, historyIdentity: expected.historyIdentity, appearance: expected.appearance })

describe('M2-0b native history, appearance and finite restore equivalence', () => {
  it('validates the full native identity1 and retains exact pre-existing topology hashes', () => {
    const old = createCompositionContentV6(scatterLayerSceneV3(2)), current = native(old)
    expect(validateHistoryIdentity(current.historyIdentity, current.document)).toEqual(current.historyIdentity)
    expect(outdoorIdentityDescriptors(current.document)).toEqual(outdoorIdentityDescriptorsV6(old.document))
    expect(createHistoryIdentity(current.document, context())).toEqual(createHistoryIdentity(current.document, context()))
    expect(createCompositionContent(current.document, context()).appearance).toEqual(current.appearance)
    expect(() => validateHistoryIdentity({ ...current.historyIdentity, version: 3 }, current.document)).toThrow(/字段/)
    const missing = cloneJson(current.historyIdentity); delete missing.propTokens.item
    expect(() => validateHistoryIdentity(missing, current.document)).toThrow(/缺少/)
    const aliased = cloneJson(current.historyIdentity); aliased.outdoorTokens.domain.topologyToken = aliased.propTokens.item
    expect(() => validateHistoryIdentity(aliased, current.document)).toThrow(/全局唯一/)
  })

  it('observes a topology change and change-back inside one draft and never restores the old continuity token', () => {
    const old = createCompositionContentV6(scatterLayerSceneV3(0)), current = native(old)
    const changed = cloneJson(current.document); changed.scatterGroups.scatter.seed = 'another-seed'
    const oldChanged = cloneJson(old.document); oldChanged.scatterGroups.scatter.seed = 'another-seed'
    const trace = createHistoryIdentityTrace(current.historyIdentity, current.document, context())
    const oldTrace = createHistoryIdentityTraceV6(old.historyIdentity, old.document)
    trace.observe(changed); oldTrace.observe(oldChanged)
    const result = trace.finish(current.document), expected = oldTrace.finish(old.document)
    expect(result.outdoorTokens.scatter.topologyHash).toBe(expected.outdoorTokens.scatter.topologyHash)
    expect(result.outdoorTokens.scatter.token).toBe(current.historyIdentity.outdoorTokens.scatter.token)
    expect(result.outdoorTokens.scatter.topologyToken).not.toBe(current.historyIdentity.outdoorTokens.scatter.topologyToken)
    expect(expected.outdoorTokens.scatter.topologyToken).not.toBe(old.historyIdentity.outdoorTokens.scatter.topologyToken)
    expect(() => assertOutdoorContinuity(result, current.historyIdentity, ['scatter'])).toThrow(/连续性/)
    expect(result.outdoorTokens.domain).toEqual(current.historyIdentity.outdoorTokens.domain)
  })

  it('keeps tombstones, refuses ordinary resurrection and merges branch births without replacing current topology', () => {
    const old = createCompositionContentV6(scatterLayerSceneV3(0)), current = native(old), removed = cloneJson(current.document)
    delete removed.scatterGroups.scatter; delete removed.entityLayers.scatter
    const identity = advanceHistoryIdentity(current.historyIdentity, current.document, removed, context())
    const oldRemoved = legacy({ ...current, document: removed }).document
    const expected = advanceHistoryIdentityV6(old.historyIdentity, old.document, oldRemoved)
    expect(identity.outdoorTokens.scatter).toEqual(expected.outdoorTokens.scatter)
    expect(() => advanceHistoryIdentity(identity, removed, current.document, context())).toThrow(/不能复用/)
    const undo = advanceHistoryIdentity(identity, removed, current.document, context(), { allowResurrection: true })
    expect(undo.outdoorTokens.scatter.token).toBe(identity.outdoorTokens.scatter.token)
    expect(undo.outdoorTokens.scatter.topologyToken).not.toBe(identity.outdoorTokens.scatter.topologyToken)
    const branch = cloneJson(identity); branch.propTokens.deleted = 'branch-deleted-birth'; branch.outdoorTokens.scatter.topologyToken = 'branch-topology'
    const merged = mergeIdentityRecords(identity, [branch])
    expect(merged.propTokens.deleted).toBe('branch-deleted-birth')
    expect(merged.outdoorTokens.scatter).toEqual(identity.outdoorTokens.scatter)
    expect(identity.propTokens.deleted).toBeUndefined()
    branch.outdoorTokens.scatter.token = 'conflicting-birth'
    expect(() => mergeIdentityRecords(identity, [branch])).toThrow(/出生身份冲突/)
  })

  it('matches source → layer → instance opacity including zero and respects current edit locks', () => {
    const old = compositionFixtureV6(), current = native(old), layerId = current.document.entityLayers.item
    const commands: EquivalenceCommand[] = [
      { type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId }, adjustment: { id: 'layer-opacity', kind: 'opacity', enabled: true, value: .4 } },
      { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'item-opacity', kind: 'opacity', enabled: true, value: 0 } },
    ]
    const result = validateCompositionContent(resolveAppearance(applyCompositionCommands(current, commands, context())))
    const expected = resolveAppearanceV6(applyCompositionCommandsV6(old, commands))
    compare(result, expected)
    expect(result.document.props.item.appearance.opacity).toBe(0)
    expect(result.document.props.other.appearance.opacity).toBe(.4)
    const locked = cloneJson(current); locked.document.userLayers[layerId].editLocked = true
    expect(() => applyCompositionCommands(locked, commands, context())).toThrow(/锁定/)
    expect(current.document.props.item.appearance.opacity).toBe(1)
  })

  it('retains fixed bitmap-source and variant IDs, rejects missing actual outputs and detects corrupt ancestors', () => {
    const old = imageFixtureV6(), current = native(old)
    expect(createAppearanceGraph(current.document)).toEqual(old.appearance)
    const commands: EquivalenceCommand[] = [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'tint', kind: 'tint', value: '#aA8844', enabled: true } }]
    const pending = applyCompositionCommands(current, commands, context()), oldPending = applyCompositionCommandsV6(old, commands)
    expect(listRequiredVariants(pending)).toEqual(listRequiredVariantsV6(oldPending))
    expect(() => resolveAppearance(pending)).toThrow(/尚未完整采用/)
    expect(() => resolveAppearanceV6(oldPending)).toThrow(/尚未完整采用/)
    const cycle = cloneJson(current.appearance), sourceId = cycle.propSources.item
    cycle.sources[sourceId].parentSourceId = sourceId
    expect(() => validateAppearanceGraph(cycle, current.document)).toThrow(/循环/)
  })

  it('preserves private fixed prefab templates and deduplicates whole-group plus member scope', () => {
    const old = prefabFixtureV6(), current = native(old), scope = { kind: 'targets' as const, ids: ['group', 'left'] }
    expect(createAppearanceGraph(current.document)).toEqual(old.appearance)
    expect(current.appearance.prefabAppearanceTemplates.definition.visibility).toBe('gm')
    expect(inspectAppearanceScope(current, scope)).toEqual(inspectAppearanceScopeV6(old, scope))
    expect(inspectAppearanceScope(current, scope).targetIds.sort()).toEqual(['left', 'right'])
    const locked = cloneJson(current); locked.document.prefabInstances.group.editLocked = true
    expect(() => inspectAppearanceScope(locked, scope)).toThrow(/锁定/)
  })

  it('keeps mixed command families separate and charges the real expanded layer scope against 256', () => {
    const old = compositionFixtureV6(), current = native(old)
    const mixed: EquivalenceCommand[] = [
      { type: 'updateProp', id: 'item', changes: { rotationDeg: 10 } },
      { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'opacity', kind: 'opacity', enabled: true, value: .5 } },
    ]
    expect(() => applyCompositionCommands(current, mixed, context())).toThrow(/不能混批/)
    expect(() => applyCompositionCommandsV6(old, mixed)).toThrow(/不能混批/)
    const document = cloneJson(old.document), layerId = document.entityLayers.item
    for (let index = 0; index < 255; index++) {
      const id = `extra-${index}`; document.props[id] = symbolPropV3(id, 8000 + index, 8000); document.entityLayers[id] = layerId
    }
    const largeOld = createCompositionContentV6(document), large = native(largeOld)
    const commands: EquivalenceCommand[] = [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId }, adjustment: { id: 'too-wide', kind: 'opacity', enabled: true, value: .5 } }]
    expect(() => applyCompositionCommands(large, commands, context())).toThrow(/256/)
    expect(() => applyCompositionCommandsV6(largeOld, commands)).toThrow(/256/)
  })

  it('restores one prop transform while preserving newer fields and outside edits exactly', () => {
    const oldHistoric = compositionFixtureV6(), oldCurrent = cloneJson(oldHistoric)
    oldCurrent.document.props.item.positionMm.x += 400
    oldCurrent.document.props.other.rotationDeg = 27
    oldCurrent.document.notes.later = { id: 'later', floorId: 'blank-floor', editLocked: false, anchor: { type: 'point', positionMm: { x: 15000, y: 15000 } }, kind: 'note', text: 'outside edit', visibility: 'gm' }
    oldCurrent.document.entityLayers.later = oldCurrent.document.entityLayers.item
    const historic = native(oldHistoric), current = native(oldCurrent), before = cloneJson(current)
    const result = buildRestorePlan(current, historic, { ids: ['item'], mode: 'transform' })
    const expected = buildRestorePlanV6(oldCurrent, oldHistoric, { ids: ['item'], mode: 'transform' })
    compare(result, expected)
    expect(result.changes).toEqual(expected.changes)
    expect(result.document.props.item.positionMm).toEqual(historic.document.props.item.positionMm)
    expect(result.document.props.other).toEqual(current.document.props.other)
    expect(result.document.notes).toEqual(current.document.notes)
    expect(current).toEqual(before)
  })

  it('restores persisted outdoor geometry, preserving later notes, objects and paint with the same dependency cost', () => {
    const oldHistoric = surfaceFixtureV6(), oldCurrent = cloneJson(oldHistoric)
    oldCurrent.document.terrainAreas.domain.boundaryMm[0].positionMm.x = 900
    oldCurrent.document.terrainAreas.domain.groundElevationMm = 300
    oldCurrent.document.props.item.rotationDeg = 25
    oldCurrent.document.notes.later = { id: 'later', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' }, kind: 'note', text: 'later', visibility: 'gm' }
    oldCurrent.document.entityLayers.later = oldCurrent.document.entityLayers.item
    const current = native(oldCurrent), result = buildRestorePlan(current, native(oldHistoric), { ids: ['domain'], mode: 'outdoorGeometry' })
    const expected = buildRestorePlanV6(oldCurrent, oldHistoric, { ids: ['domain'], mode: 'outdoorGeometry' })
    compare(result, expected)
    expect(result.affectedIds).toEqual(expected.affectedIds)
    expect(result.commandCost).toBe(1)
    expect(result.document.notes).toEqual(current.document.notes)
    expect(result.document.props).toEqual(current.document.props)
    expect(result.document.terrainAreas.domain.surfaceStyle).toEqual(current.document.terrainAreas.domain.surfaceStyle)
    const locked = cloneJson(current); locked.document.notes.later.editLocked = true
    expect(() => buildRestorePlan(locked, native(oldHistoric), { ids: ['domain'], mode: 'outdoorGeometry' })).toThrow(/已锁定：domain/)
    expect(() => buildRestorePlanV6(legacy(locked), oldHistoric, { ids: ['domain'], mode: 'outdoorGeometry' })).toThrow(/已锁定：domain/)
  })

  it('rebuilds only the explicit historical scatter birth and keeps other deletions and manual exclusions', () => {
    const document = scatterLayerSceneV3(3); document.scatterGroups.scatter.visibility = 'public'
    const oldHistoric = createCompositionContentV6(document), historic = native(oldHistoric)
    const commands: EquivalenceCommand[] = [
      { type: 'deleteProp', id: 'scatter-item-0' }, { type: 'deleteProp', id: 'scatter-item-1' },
      { type: 'upsertScatterExclusion', groupId: 'scatter', exclusion: { id: 'later-entrance', boundaryMm: [{ x: 10000, y: 10000 }, { x: 10600, y: 10000 }, { x: 10600, y: 10600 }, { x: 10000, y: 10600 }], reason: 'entrance' } },
    ]
    const actualCommands = applyCompositionCommands(historic, commands, context()), oldCurrent = applyCompositionCommandsV6(oldHistoric, commands)
    expect(actualCommands.document).toEqual(nativeScene(oldCurrent.document))
    expect(actualCommands.appearance).toEqual(oldCurrent.appearance)
    // New exclusion births use each runtime's allocator. Restore the same saved
    // input on both cores to compare the complete persisted result exactly.
    const current = native(oldCurrent)
    expect(() => buildRestorePlan(current, historic, { ids: ['scatter-item-0'], mode: 'appearance' })).toThrow(/显式/)
    const result = buildRestorePlan(current, historic, { ids: ['scatter-item-0'], mode: 'scatterMembers' })
    const expected = buildRestorePlanV6(oldCurrent, oldHistoric, { ids: ['scatter-item-0'], mode: 'scatterMembers' })
    compare(result, expected)
    expect(result.document.props['scatter-item-1']).toBeUndefined()
    expect(result.historyIdentity.propTokens['scatter-item-0']).toBe(historic.historyIdentity.propTokens['scatter-item-0'])
    expect(result.document.scatterGroups.scatter.exclusions.some(item => item.id === 'later-entrance')).toBe(true)
    expect(result.commandCost).toBe(expected.commandCost)
  })

  it('issues certificates only for the exact owned immutable triad and rejects frozen, accessor and mixed forgeries', () => {
    const input = native(compositionFixtureV6()), certified = certifyCompositionContent(input)
    expect(certified.document).not.toBe(input.document)
    expect(Object.isFrozen(certified.document.props.item.positionMm)).toBe(true)
    expect(Object.isFrozen(certified.historyIdentity.propTokens)).toBe(true)
    expect(validateCompositionContent({ ...certified })).toBe(certified)
    input.document.props.item.rotationDeg = 34
    expect(certified.document.props.item.rotationDeg).toBe(0)
    const fake = cloneJson(certified); fake.document.props.item.appearance.opacity = .25; Object.freeze(fake)
    expect(getCertifiedCompositionContent(fake)).toBeUndefined()
    expect(() => certifyCompositionContent(fake)).toThrow(/不一致/)
    let reads = 0
    const accessor = Object.defineProperty({ ...certified }, 'appearance', { enumerable: true, get: () => { reads++; return certified.appearance } })
    expect(() => validateCompositionContent(accessor)).toThrow(/访问器/)
    expect(() => buildRestorePlan(accessor, certified, { ids: ['item'], mode: 'transform' })).toThrow(/访问器/)
    expect(reads).toBe(0)
    expect(() => validateCompositionContent({ ...certified, [Symbol('extra')]: true })).toThrow()
    const identity = cloneJson(certified.historyIdentity); delete identity.propTokens.item
    expect(() => validateCompositionContent({ ...certified, historyIdentity: identity })).toThrow(/身份/)
    const revised = reviseCompositionContent(certified, certified.document.revision + 1, stamp)
    expect(revised.appearance).toBe(certified.appearance)
    expect(revised.document.props).toBe(certified.document.props)
    expect(() => reviseCompositionContent(certified, -1, stamp)).toThrow()
  })

  it('keeps C2 evidence ephemeral, restores optional note fields as JSON and rejects deletion/recreation even after undo', () => {
    const oldDocument = compositionFixtureV6().document, layerId = oldDocument.entityLayers.item
    oldDocument.notes.point = { id: 'point', floorId: 'blank-floor', editLocked: false, anchor: { type: 'point', positionMm: { x: 12000, y: 12000 } }, kind: 'note', text: 'historical', visibility: 'gm' }
    oldDocument.entityLayers.point = layerId
    const oldHistoric = createCompositionContentV6(oldDocument), historic = native(oldHistoric), current = cloneJson(historic)
    current.document.notes.point.anchor = { type: 'point', positionMm: { x: 13000, y: 13000 } }
    current.document.notes.point.title = 'later title'; current.document.notes.point.discovered = true; current.document.notes.point.text = 'later text'
    const session = new StructureContinuitySession()
    session.reset(historic.document); session.recordSnapshot('source', 'hash', historic.document); session.advance(historic.document, current.document)
    const proof = session.prove('source', 'hash', current.document, historic.document), request = { ids: ['point'], mode: 'properties' as const }
    const result = buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, proof)
    const oldCurrent = legacy(current).document, oldIdentity = createHistoryIdentityV4(oldDocument), oldSession = new StructureContinuitySessionV4()
    oldSession.reset(oldDocument); oldSession.recordSnapshot('source', 'hash', oldDocument); oldSession.advance(oldDocument, oldCurrent)
    const expected = buildStructureRestorePlanV4(oldCurrent, oldIdentity, oldDocument, oldIdentity, request, oldSession.prove('source', 'hash', oldCurrent, oldDocument))
    expect(result.document).toEqual(nativeScene(expected.document))
    expect(result.document.notes.point).toEqual(historic.document.notes.point)
    expect(inspectJsonInput(result.document)).toBeUndefined()
    expect(result.commandCost).toBe(expected.commandCost)
    expect(() => buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, { snapshotId: 'source' })).toThrow(/连续性证据/)
    const deleted = cloneJson(current.document); delete deleted.notes.point; delete deleted.entityLayers.point
    session.advance(current.document, deleted); session.advance(deleted, current.document)
    const recreated = session.prove('source', 'hash', current.document, historic.document)
    expect(() => buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, recreated)).toThrow(/曾删除、重建/)
    session.reset(current.document)
    expect(() => session.prove('source', 'hash', current.document, historic.document)).toThrow(/本会话/)
  })
})
