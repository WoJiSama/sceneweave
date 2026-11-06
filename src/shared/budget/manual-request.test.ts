import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { visualBase } from '../visual/base.js'
import { planManualCommandWork, selectManualCommandBudget } from './manual-request.js'

function populated(count: number): SceneDocument {
  const document = fixture().project.document, prop = document.props.item, layerId = document.entityLayers.item
  document.props = {}; document.entityLayers = {}
  for (let index = 0; index < count; index++) {
    const id = `item-${index}`
    document.props[id] = { ...cloneJson(prop), id }; document.entityLayers[id] = layerId
  }
  return document
}
function group(document: SceneDocument, count: number) {
  document.aggregateCoordinates = { encoding: 'world', groups: { root: { id: 'root', parentId: null,
    floorId: 'blank-floor', editLocked: false, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 },
    members: Array.from({ length: count }, (_, index) => ({ kind: 'prop', id: `item-${index}` })) } } }
}
const transform: CompositionCommand = { type: 'transformAggregateNatural', id: 'root', offsetMm: { x: 100, y: 0 },
  pivotMm: { x: 0, y: 0 }, quarterTurns: 0 }

describe('manual request admission planning', () => {
  it.each([256, 257, 512, 513, 1024])('selects the tier for a single command requesting %i actual layer members', count => {
    const document = populated(count), commands: CompositionCommand[] = [{ type: 'moveEntitiesToLayer', ids: Object.keys(document.props), layerId: 'target' }]
    expect(planManualCommandWork(document, commands)).toEqual({ semanticTargets: count, groupMembers: 0 })
    expect(selectManualCommandBudget(document, commands).semanticTargets).toBe(count <= 256 ? 256 : count <= 512 ? 512 : 1024)
  })

  it('plans a layer appearance scope and a selected prefab using real expanded targets', () => {
    const document = populated(800), layerId = Object.values(document.entityLayers)[0]
    const adjustment = { id: 'fade', kind: 'opacity' as const, value: .5, enabled: true }
    expect(selectManualCommandBudget(document, [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId }, adjustment }]).semanticTargets).toBe(1024)
    document.prefabInstances.pack = { id: 'pack', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      definitionRef: { id: 'definition', version: 1 }, anchorMm: { x: 0, y: 0 }, rotationDeg: 0,
      members: Object.fromEntries(Object.keys(document.props).map(id => [id, { propId: id, overrideFields: [] }])) }
    expect(planManualCommandWork(document, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['pack'] }, adjustment }]).semanticTargets).toBe(800)
    expect(selectManualCommandBudget(document, [{ type: 'moveEntitiesToLayer', ids: ['pack'], layerId: 'target' }]).semanticTargets).toBe(1024)
  })

  it('does not charge unpainted structure or internal vertices as layer appearance targets', () => {
    const document = fixture({ building: true }).project.document, layerId = document.entityLayers.item
    expect(planManualCommandWork(document, [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId },
      adjustment: { id: 'fade', kind: 'opacity', value: .5, enabled: true } }]).semanticTargets).toBe(2)
  })

  it('selects before large small-scene creation and counts each new prefab container', () => {
    const document = populated(1), memberIds = Object.fromEntries(Array.from({ length: 1023 }, (_, index) => [`slot-${index}`, `copy-${index}`]))
    const command: CompositionCommand = { type: 'instantiatePrefab', id: 'new-pack', definitionRef: { id: 'definition', version: 1 },
      memberIds, anchorMm: { x: 0, y: 0 }, layerId: 'layer', supportRef: { kind: 'floor', id: 'blank-floor' } }
    expect(planManualCommandWork(document, [command]).semanticTargets).toBe(1024)
    expect(selectManualCommandBudget(document, [command]).semanticTargets).toBe(1024)
    command.memberIds.extra = 'one-too-many'
    expect(() => selectManualCommandBudget(document, [command])).toThrow(/semanticTargets.*1025\/1024/)
    expect(() => selectManualCommandBudget(document, [{ type: 'duplicatePrefab', id: 'pack', newId: 'new-pack', memberIds: command.memberIds, offsetMm: { x: 100, y: 0 } }])).toThrow(/1025\/1024/)
  })

  it('counts a genuine core request separately from members and nested group containers without mutating inputs', () => {
    const document = populated(1); group(document, 2000)
    const root = document.aggregateCoordinates!.groups.root
    document.aggregateCoordinates!.groups.child = { ...cloneJson(root), id: 'child', parentId: root.id, members: root.members.splice(1000) }
    const before = canonicalJson(document), commands = [transform], request = canonicalJson(commands)
    expect(planManualCommandWork(document, commands)).toEqual({ semanticTargets: 1, groupMembers: 2001 })
    expect(canonicalJson(document)).toBe(before); expect(canonicalJson(commands)).toBe(request)
    expect(selectManualCommandBudget(document, commands).semanticTargets).toBe(256)
  })

  it.each([{ count: 4096, tier: 256 }, { count: 4097, tier: 512 }, { count: 16384, tier: 512 }, { count: 16385, tier: 1024 }, { count: 65536, tier: 1024 }])('selects the closure envelope for $count members', ({ count, tier }) => {
    const document = populated(1); group(document, count)
    expect(selectManualCommandBudget(document, [transform]).semanticTargets).toBe(tier)
  })

  it('refuses over-max closure and raw command requests before candidate work', () => {
    const document = populated(1); group(document, 65537)
    expect(() => selectManualCommandBudget(document, [transform])).toThrow(/groupMembers.*65537\/65536/)
    expect(() => selectManualCommandBudget(document, Array.from({ length: 1025 }, () => ({ type: 'renameScene', title: 'same' })))).toThrow(/semanticTargets.*1025\/1024/)
  })

  it('charges changed ownership, splitting and copying at member granularity', () => {
    const document = populated(800); group(document, 800)
    expect(planManualCommandWork(document, [{ type: 'reparentAggregateGroup', id: 'root', parentId: null }]).semanticTargets).toBe(801)
    expect(planManualCommandWork(document, [{ type: 'dissolveAggregateGroup', id: 'root' }]).semanticTargets).toBe(801)
    const members = document.aggregateCoordinates!.groups.root.members
    const split: CompositionCommand = { type: 'splitAggregateGroup', id: 'root', parts: [
      { id: 'part-a', members: members.slice(0, 400), childGroupIds: [] }, { id: 'part-b', members: members.slice(400), childGroupIds: [] },
    ] }
    expect(planManualCommandWork(document, [split]).semanticTargets).toBe(803)
    const copies: CompositionCommand[] = Object.keys(document.props).map(id => ({ type: 'copyProp', id, newId: `copy-${id}`, offsetMm: { x: 100, y: 0 } }))
    copies.push({ type: 'createAggregateGroup', group: { ...cloneJson(document.aggregateCoordinates!.groups.root), id: 'copy-root',
      members: members.map(ref => ({ ...ref, id: `copy-${ref.id}` })) } })
    expect(planManualCommandWork(document, copies)).toEqual({ semanticTargets: 801, groupMembers: 0 })
    expect(selectManualCommandBudget(document, copies).semanticTargets).toBe(1024)
  })

  it('does not grant core-only admission to a mixed member edit or ownership change', () => {
    const document = populated(2000); group(document, 2000)
    const commands: CompositionCommand[] = [transform, { type: 'updateProp', id: 'item-0', changes: { rotationDeg: 90 } }]
    expect(planManualCommandWork(document, commands).semanticTargets).toBe(2001)
    expect(() => selectManualCommandBudget(document, commands)).toThrow(/semanticTargets/)
    expect(() => selectManualCommandBudget(document, [transform, { type: 'dissolveAggregateGroup', id: 'root' }])).toThrow(/semanticTargets/)
  })

  it('selects the actual finite filter target union for create, replace and remove', () => {
    const document = populated(800), ids = Object.keys(document.props), layerId = document.entityLayers[ids[0]]
    const filter = { id: 'filter', floorId: 'blank-floor', layerId, editLocked: false, visibility: 'public' as const,
      target: { kind: 'entities' as const, ids }, preset: 'neutral' as const, exposure: 0, saturation: 1, contrast: 1,
      vignette: 0, grain: 0, seed: 'filter', enabled: true }
    expect(planManualCommandWork(document, [{ type: 'upsertVisualFilter', filter }]).semanticTargets).toBe(800)
    expect(selectManualCommandBudget(document, [{ type: 'upsertVisualFilter', filter }]).semanticTargets).toBe(1024)
    visualBase(document)!.filters.filter = filter
    expect(planManualCommandWork(document, [{ type: 'upsertVisualFilter', filter: { ...filter, target: { kind: 'entities', ids: ids.slice(0, 1) } } }]).semanticTargets).toBe(800)
    expect(selectManualCommandBudget(document, [{ type: 'removeVisualEffect', kind: 'filter', id: filter.id }]).semanticTargets).toBe(1024)
  })

  it('does not count members of unchanged layers during a reorder', () => {
    const document = populated(2000), occupied = document.entityLayers['item-0'], floorId = document.userLayers[occupied].floorId
    document.userLayers[occupied].order = 0
    document.userLayers.emptyA = { id: 'emptyA', floorId, name: 'A', order: 1, editLocked: false }
    document.userLayers.emptyB = { id: 'emptyB', floorId, name: 'B', order: 2, editLocked: false }
    const commands: CompositionCommand[] = [{ type: 'reorderLayers', floorId, ids: [occupied, 'emptyB', 'emptyA'] }]
    expect(planManualCommandWork(document, commands).semanticTargets).toBe(3)
    expect(() => selectManualCommandBudget(document, commands)).not.toThrow()
  })

  it('counts later-layer order changes when removing an empty earlier layer', () => {
    const document = populated(800), occupied = document.entityLayers['item-0'], layer = document.userLayers[occupied]
    layer.order = 1
    document.userLayers.empty = { id: 'empty', floorId: layer.floorId, name: 'empty', order: 0, editLocked: false }
    const commands: CompositionCommand[] = [{ type: 'removeLayer', id: 'empty', targetLayerId: occupied }]
    expect(planManualCommandWork(document, commands).semanticTargets).toBe(801)
    expect(selectManualCommandBudget(document, commands).semanticTargets).toBe(1024)
  })

  it('expands actual live members removed by one decoration-cluster command', () => {
    const document = populated(800), id = 'cluster'
    document.decorationClusters[id] = { id, floorId: 'blank-floor', visibility: 'public', editLocked: false,
      supportRef: { kind: 'floor', id: 'blank-floor' }, boundsMm: { x: 0, y: 0, width: 1000, height: 1000 },
      seed: 'cluster', algorithmVersion: 'cluster-v1', palette: [], maxInstances: 800, spacingMm: 1, clusterRadiusMm: 1, clearanceMm: 1,
      members: Object.fromEntries(Object.keys(document.props).map(entityId => [entityId, { kind: 'prop', entityId, state: 'managed' }])) }
    document.decorationClusters[id].members.ignored = { kind: 'prop', entityId: 'detached', state: 'detached' }
    expect(planManualCommandWork(document, [{ type: 'deleteDecorationCluster', id }]).semanticTargets).toBe(801)
    expect(selectManualCommandBudget(document, [{ type: 'deleteDecorationCluster', id }]).semanticTargets).toBe(1024)
  })

  it('plans a new group referenced later in the same batch without a baseline lookup refusal', () => {
    const document = populated(2)
    const commands: CompositionCommand[] = [
      { type: 'createAggregateGroup', group: { id: 'new', parentId: null, floorId: 'blank-floor', editLocked: false,
        frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [{ kind: 'prop', id: 'item-0' }] } },
      { type: 'reparentAggregateGroup', id: 'new', parentId: null },
    ]
    expect(selectManualCommandBudget(document, commands).semanticTargets).toBe(1024)
  })
})
