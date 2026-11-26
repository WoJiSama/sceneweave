import { describe, expect, it } from 'vitest'
import { compositionFixture, fixtureRuntime, groupLayerScene, imageCompositionFixture, scatterLayerScene, symbolProp } from '../../tests/helpers/current-project-fixtures.js'
import { applyCompositionCommands } from './appearance/commands.js'
import { createCompositionContent, inspectAppearanceScope, listRequiredVariants, resolveAppearance } from './appearance/graph.js'
import { advanceHistoryIdentity, assertOutdoorContinuity, createHistoryIdentity, createHistoryIdentityTrace, mergeIdentityRecords, outdoorIdentityDescriptors, validateHistoryIdentity } from './history/identity.js'
import { buildRestorePlan } from './history/restore.js'
import { StructureContinuitySession } from './history/structure-continuity.js'
import { buildStructureRestorePlan } from './history/structure-restore.js'
import type { CompositionCommand } from './model/appearance.js'
import type { PreparationContext } from './ports/runtime.js'
import { certifyCompositionContent, getCertifiedCompositionContent, reviseCompositionContent, validateAppearanceGraph, validateCompositionContent } from './validation/content.js'
import { cloneJson, inspectJsonInput } from './validation/json.js'

const stamp = '2026-10-24T00:00:00.000Z'
const context = (): PreparationContext => {
  let allocated = 0
  return { ids: { nextId: () => `native-test-${++allocated}` }, clock: { now: () => stamp } }
}
function surfaceCompositionFixture() {
  const document = scatterLayerScene(0), asset = Object.values(document.assets)[0]
  delete document.scatterGroups.scatter; delete document.entityLayers.scatter
  document.materials.material = { id: 'material', catalogId: 'test.material', version: 1, licenseRef: asset.licenseRef, origin: asset.origin,
    name: 'Test material', tags: [], textureAssetId: asset.id, defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain'] }
  const paint = { materialRef: { id: 'material', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0,
    alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
  document.terrainAreas.domain.surfaceStyle = { base: paint, overlays: [{ id: 'overlay', paint: { ...paint, opacity: .4 },
    boundaryMm: [{ x: 2000, y: 2000 }, { x: 4000, y: 2000 }, { x: 4000, y: 4000 }, { x: 2000, y: 4000 }], blendWidthMm: 0, renderOrder: 0 }] }
  return createCompositionContent(document, fixtureRuntime())
}

describe('M2-0b history, appearance and finite restore', () => {
  it('validates identity5 and binds the topology of outdoor entities', () => {
    const current = createCompositionContent(scatterLayerScene(2), fixtureRuntime())
    expect(validateHistoryIdentity(current.historyIdentity, current.document)).toEqual(current.historyIdentity)
    const descriptors = outdoorIdentityDescriptors(current.document)
    for (const [id, descriptor] of Object.entries(descriptors)) expect(current.historyIdentity.outdoorTokens[id]).toMatchObject(descriptor)
    expect(createHistoryIdentity(current.document, context())).toEqual(createHistoryIdentity(current.document, context()))
    expect(createCompositionContent(current.document, context()).appearance).toEqual(current.appearance)
    expect(() => validateHistoryIdentity({ ...current.historyIdentity, version: 3 }, current.document)).toThrow(/字段/)
    const missing = cloneJson(current.historyIdentity); delete missing.propTokens.item
    expect(() => validateHistoryIdentity(missing, current.document)).toThrow(/缺少/)
    const aliased = cloneJson(current.historyIdentity); aliased.outdoorTokens.domain.topologyToken = aliased.propTokens.item
    expect(() => validateHistoryIdentity(aliased, current.document)).toThrow(/全局唯一/)
  })

  it('observes a topology change and change-back inside one draft and never restores the old continuity token', () => {
    const current = createCompositionContent(scatterLayerScene(0), fixtureRuntime())
    const changed = cloneJson(current.document); changed.scatterGroups.scatter.seed = 'another-seed'
    const trace = createHistoryIdentityTrace(current.historyIdentity, current.document, context())
    trace.observe(changed)
    const result = trace.finish(current.document)
    expect(result.outdoorTokens.scatter.topologyHash).toBe(current.historyIdentity.outdoorTokens.scatter.topologyHash)
    expect(result.outdoorTokens.scatter.token).toBe(current.historyIdentity.outdoorTokens.scatter.token)
    expect(result.outdoorTokens.scatter.topologyToken).not.toBe(current.historyIdentity.outdoorTokens.scatter.topologyToken)
    expect(() => assertOutdoorContinuity(result, current.historyIdentity, ['scatter'])).toThrow(/连续性/)
    expect(result.outdoorTokens.domain).toEqual(current.historyIdentity.outdoorTokens.domain)
  })

  it('keeps tombstones, refuses ordinary resurrection and merges branch births without replacing current topology', () => {
    const current = createCompositionContent(scatterLayerScene(0), fixtureRuntime()), removed = cloneJson(current.document)
    delete removed.scatterGroups.scatter; delete removed.entityLayers.scatter
    const identity = advanceHistoryIdentity(current.historyIdentity, current.document, removed, context())
    expect(identity.outdoorTokens.scatter).toEqual(current.historyIdentity.outdoorTokens.scatter)
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
    const current = compositionFixture(), layerId = current.document.entityLayers.item
    const commands: CompositionCommand[] = [
      { type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId }, adjustment: { id: 'layer-opacity', kind: 'opacity', enabled: true, value: .4 } },
      { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'item-opacity', kind: 'opacity', enabled: true, value: 0 } },
    ]
    const result = validateCompositionContent(resolveAppearance(applyCompositionCommands(current, commands, context())))
    expect(result.document.props.item.appearance.opacity).toBe(0)
    expect(result.document.props.other.appearance.opacity).toBe(.4)
    const locked = cloneJson(current); locked.document.userLayers[layerId].editLocked = true
    expect(() => applyCompositionCommands(locked, commands, context())).toThrow(/锁定/)
    expect(current.document.props.item.appearance.opacity).toBe(1)
  })

  it('retains fixed bitmap-source and variant IDs, rejects missing actual outputs and detects corrupt ancestors', () => {
    const current = imageCompositionFixture()
    const commands: CompositionCommand[] = [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'tint', kind: 'tint', value: '#aA8844', enabled: true } }]
    const pending = applyCompositionCommands(current, commands, context())
    const variants = listRequiredVariants(pending)
    expect(variants).toHaveLength(1)
    expect(variants[0].tint?.toLowerCase()).toBe('#aa8844')
    expect(() => resolveAppearance(pending)).toThrow(/尚未完整采用/)
    const cycle = cloneJson(current.appearance), sourceId = cycle.propSources.item
    cycle.sources[sourceId].parentSourceId = sourceId
    expect(() => validateAppearanceGraph(cycle, current.document)).toThrow(/循环/)
  })

  it('preserves private fixed prefab templates and deduplicates whole-group plus member scope', () => {
    const current = createCompositionContent(groupLayerScene(), fixtureRuntime()), scope = { kind: 'targets' as const, ids: ['group', 'left'] }
    expect(current.appearance.prefabAppearanceTemplates.definition.visibility).toBe('gm')
    expect(inspectAppearanceScope(current, scope).targetIds.sort()).toEqual(['left', 'right'])
    const locked = cloneJson(current); locked.document.prefabInstances.group.editLocked = true
    expect(() => inspectAppearanceScope(locked, scope)).toThrow(/锁定/)
  })

  it('keeps mixed command families separate and charges the real expanded layer scope against 256', () => {
    const current = compositionFixture()
    const mixed: CompositionCommand[] = [
      { type: 'updateProp', id: 'item', changes: { rotationDeg: 10 } },
      { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'opacity', kind: 'opacity', enabled: true, value: .5 } },
    ]
    expect(() => applyCompositionCommands(current, mixed, context())).toThrow(/不能混批/)
    const document = cloneJson(current.document), layerId = document.entityLayers.item
    for (let index = 0; index < 255; index++) {
      const id = `extra-${index}`; document.props[id] = symbolProp(id, 8000 + index, 8000); document.entityLayers[id] = layerId
    }
    const large = createCompositionContent(document, fixtureRuntime())
    const commands: CompositionCommand[] = [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId }, adjustment: { id: 'too-wide', kind: 'opacity', enabled: true, value: .5 } }]
    expect(() => applyCompositionCommands(large, commands, context())).toThrow(/256/)
  })

  it('restores one prop transform while preserving newer fields and outside edits exactly', () => {
    const historic = compositionFixture(), current = cloneJson(historic)
    current.document.props.item.positionMm.x += 400
    current.document.props.other.rotationDeg = 27
    current.document.notes.later = { id: 'later', floorId: 'blank-floor', editLocked: false, anchor: { type: 'point', positionMm: { x: 15000, y: 15000 } }, kind: 'note', text: 'outside edit', visibility: 'gm' }
    current.document.entityLayers.later = current.document.entityLayers.item
    const before = cloneJson(current)
    const result = buildRestorePlan(current, historic, { ids: ['item'], mode: 'transform' })
    expect(result.document.props.item.positionMm).toEqual(historic.document.props.item.positionMm)
    expect(result.document.props.other).toEqual(current.document.props.other)
    expect(result.document.notes).toEqual(current.document.notes)
    expect(current).toEqual(before)
  })

  it('restores persisted outdoor geometry, preserving later notes, objects and paint with the same dependency cost', () => {
    const historic = surfaceCompositionFixture(), current = cloneJson(historic)
    current.document.terrainAreas.domain.boundaryMm[0].positionMm.x = 900
    current.document.terrainAreas.domain.groundElevationMm = 300
    current.document.props.item.rotationDeg = 25
    current.document.notes.later = { id: 'later', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' }, kind: 'note', text: 'later', visibility: 'gm' }
    current.document.entityLayers.later = current.document.entityLayers.item
    const result = buildRestorePlan(current, historic, { ids: ['domain'], mode: 'outdoorGeometry' })
    expect(result.commandCost).toBe(2)
    expect(result.document.notes).toEqual(current.document.notes)
    expect(result.document.props).toEqual(current.document.props)
    expect(result.document.terrainAreas.domain.surfaceStyle).toEqual(current.document.terrainAreas.domain.surfaceStyle)
    const locked = cloneJson(current); locked.document.notes.later.editLocked = true
    expect(() => buildRestorePlan(locked, historic, { ids: ['domain'], mode: 'outdoorGeometry' })).toThrow(/已锁定：domain/)
  })

  it('rebuilds only the explicit historical scatter birth and keeps other deletions and manual exclusions', () => {
    const document = scatterLayerScene(3); document.scatterGroups.scatter.visibility = 'public'
    const historic = createCompositionContent(document, fixtureRuntime())
    const commands: CompositionCommand[] = [
      { type: 'deleteProp', id: 'scatter-item-0' }, { type: 'deleteProp', id: 'scatter-item-1' },
      { type: 'upsertScatterExclusion', groupId: 'scatter', exclusion: { id: 'later-entrance', boundaryMm: [{ x: 10000, y: 10000 }, { x: 10600, y: 10000 }, { x: 10600, y: 10600 }, { x: 10000, y: 10600 }], reason: 'entrance' } },
    ]
    const current = applyCompositionCommands(historic, commands, context())
    expect(() => buildRestorePlan(current, historic, { ids: ['scatter-item-0'], mode: 'appearance' })).toThrow(/显式/)
    const result = buildRestorePlan(current, historic, { ids: ['scatter-item-0'], mode: 'scatterMembers' })
    expect(result.document.props['scatter-item-1']).toBeUndefined()
    expect(result.historyIdentity.propTokens['scatter-item-0']).toBe(historic.historyIdentity.propTokens['scatter-item-0'])
    expect(result.document.scatterGroups.scatter.exclusions.some(item => item.id === 'later-entrance')).toBe(true)
    // Current restore also accounts for the exact prop birth and removed exclusion.
    expect(result.commandCost).toBe(6)
  })

  it('issues certificates only for the exact owned immutable triad and rejects frozen, accessor and mixed forgeries', () => {
    const input = compositionFixture(), certified = certifyCompositionContent(input)
    expect(certified.document).not.toBe(input.document)
    expect(Object.isFrozen(certified.document.props.item.positionMm)).toBe(true)
    expect(Object.isFrozen(certified.historyIdentity.propTokens)).toBe(true)
    // Public validation parses again; only the internal certificate lookup
    // reuses the exact owned immutable triad.
    expect(validateCompositionContent({ ...certified })).toEqual(certified)
    expect(getCertifiedCompositionContent({ ...certified })).toBe(certified)
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
    const oldDocument = compositionFixture().document, layerId = oldDocument.entityLayers.item
    oldDocument.notes.point = { id: 'point', floorId: 'blank-floor', editLocked: false, anchor: { type: 'point', positionMm: { x: 12000, y: 12000 } }, kind: 'note', text: 'historical', visibility: 'gm' }
    oldDocument.entityLayers.point = layerId
    const historic = createCompositionContent(oldDocument, fixtureRuntime()), current = cloneJson(historic)
    current.document.notes.point.anchor = { type: 'point', positionMm: { x: 13000, y: 13000 } }
    current.document.notes.point.title = 'later title'; current.document.notes.point.discovered = true; current.document.notes.point.text = 'later text'
    const session = new StructureContinuitySession()
    session.reset(historic.document); session.recordSnapshot('source', 'hash', historic.document); session.advance(historic.document, current.document)
    const proof = session.prove('source', 'hash', current.document, historic.document), request = { ids: ['point'], mode: 'properties' as const }
    const result = buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, proof)
    expect(result.document.notes.point).toEqual(historic.document.notes.point)
    expect(inspectJsonInput(result.document)).toBeUndefined()
    expect(() => buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, { snapshotId: 'source' })).toThrow(/连续性证据/)
    const deleted = cloneJson(current.document); delete deleted.notes.point; delete deleted.entityLayers.point
    session.advance(current.document, deleted); session.advance(deleted, current.document)
    const recreated = session.prove('source', 'hash', current.document, historic.document)
    expect(() => buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, recreated)).toThrow(/曾删除、重建/)
    session.reset(current.document)
    expect(() => session.prove('source', 'hash', current.document, historic.document)).toThrow(/本会话/)
  })
})
