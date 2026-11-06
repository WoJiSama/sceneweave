import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { addPropAppearanceSource, createCompositionContent } from '../appearance/graph.js'
import { buildingAggregateMembers } from '../commands/building.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { decodeSceneCoordinates, encodeSceneCoordinates } from '../aggregates/scene-coordinates.js'
import { naturalAggregateMembers } from '../aggregates/domain-adapters.js'
import { cloneJson } from '../validation/json.js'
import { emptyBudgetUsage, measureTaskBudget, taskBudgetProfile } from './task-budget.js'
import { MANUAL_TRANSACTION_BUDGET, assertCommandBudget, commandSelectionLimit, manualChangedTargets, manualTransactionBudget, measureCommandBudget, parseCommandBudgetProfile, selectManualTransactionBudget } from './command-budget.js'

describe('ordinary transaction admission', () => {
  it('selects registered ordinary tiers from retained and requested load without repricing task policies', () => {
    const scene = fixture().project.document
    expect(selectManualTransactionBudget(scene)).toBe(MANUAL_TRANSACTION_BUDGET)
    expect(selectManualTransactionBudget(scene, 257)).toBe(manualTransactionBudget('standard'))
    expect(selectManualTransactionBudget(scene, 513)).toBe(manualTransactionBudget('expanded'))
    expect(selectManualTransactionBudget(scene, 1, 4097)).toBe(manualTransactionBudget('standard'))
    expect(selectManualTransactionBudget(scene, 1, 16385)).toBe(manualTransactionBudget('expanded'))
    const source = scene.props.item
    for (let index = 0; index < 2000; index++) scene.props[`extra-${index}`] = { ...source, id: `extra-${index}` }
    expect(selectManualTransactionBudget(scene).semanticTargets).toBe(1024)
    for (const tier of ['compact', 'standard', 'expanded'] as const) {
      const profile = manualTransactionBudget(tier)
      expect(parseCommandBudgetProfile(profile)).toBe(profile)
      expect(commandSelectionLimit(profile)).toBe(profile.semanticTargets)
      expect(() => assertCommandBudget(profile, { ...emptyBudgetUsage(), semanticTargets: profile.semanticTargets + 1 })).toThrow(/semanticTargets/)
      expect(assertCommandBudget(profile, { ...emptyBudgetUsage(), groupMembers: profile.groupMemberLimit, externalDependencies: 3 }).groupMembers).toBe(profile.groupMemberLimit)
      expect(() => assertCommandBudget(profile, { ...emptyBudgetUsage(), groupMembers: profile.groupMemberLimit + 1 })).toThrow(/groupMembers/)
    }
    expect(commandSelectionLimit(taskBudgetProfile('expanded'))).toBe(256)
    expect(() => parseCommandBudgetProfile({ ...manualTransactionBudget('standard'), tierId: 'expanded' })).toThrow(/完整固定策略/)
  })

  it('separates a genuine 2000-member core move from all retained geometry and external relations', () => {
    const before = fixture().project.document, source = cloneJson(before.props.item), layer = before.entityLayers.item
    before.props = {}; before.entityLayers = {}
    for (let index = 0; index < 2000; index++) {
      const id = `carried-${index}`
      before.props[id] = { ...cloneJson(source), id, positionMm: { x: 1000 + index, y: 2000 } }
      before.entityLayers[id] = layer
    }
    before.aggregateCoordinates = { encoding: 'world', groups: {
      root: { id: 'root', floorId: 'blank-floor', parentId: null, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [], editLocked: false },
      child: { id: 'child', floorId: 'blank-floor', parentId: 'root', frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: Object.keys(before.props).map(id => ({ kind: 'prop', id })), editLocked: false },
    } }
    before.notes.read = { id: 'read', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'external reference', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'carried-0' } }
    before.entityLayers.read = layer
    const local = encodeSceneCoordinates(before)
    local.aggregateCoordinates!.groups.root.frame.translationMm.x = 100
    const after = decodeSceneCoordinates(local), usage = measureCommandBudget(before, after)
    expect(usage.semanticTargets).toBe(1)
    expect(usage.groupMembers).toBe(2001) // Every real member plus the nested container.
    expect(usage.externalDependencies).toBe(2) // Floor support and external note.
    expect(usage.geometrySegments).toBeGreaterThanOrEqual(8000)
    expect(usage.dependencyRefs).toBeGreaterThan(2000)
    expect(manualChangedTargets(before, after).length).toBeGreaterThan(2000)
    expect(measureCommandBudget(before, after, undefined, undefined, taskBudgetProfile('expanded')).groupMembers).toBeUndefined()
    for (const edit of ['local', 'ownership', 'frame-only'] as const) {
      const mixed = cloneJson(after)
      if (edit === 'local') mixed.props['carried-0'].positionMm.x++
      if (edit === 'ownership') mixed.aggregateCoordinates!.groups.child.parentId = null
      if (edit === 'frame-only') mixed.props = cloneJson(before.props)
      const fallback = measureCommandBudget(before, mixed)
      expect(fallback.semanticTargets, edit).toBe(manualChangedTargets(before, mixed).length)
      expect(fallback.groupMembers, edit).toBe(0)
    }
  })

  it('counts an actual rigid building transform as one core, including transformed immutable surface sources', () => {
    const scene = fixture({ building: true, image: true }).project.document, layer = scene.entityLayers.room
    Object.assign(scene.props.item, { positionMm: { x: 4500, y: 4500 }, roomId: 'room', supportRef: { kind: 'room', id: 'room' } })
    scene.props.other.positionMm = { x: 18000, y: 18000 }
    scene.materials.tile = { id: 'tile', catalogId: 'test.aggregate', version: 1, name: 'Tile', tags: [], licenseRef: 'fixture-license', origin: cloneJson(scene.assets.image.origin),
      textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
    scene.rooms.room.floorStyle = { base: { materialRef: { id: 'tile', version: 1 }, tint: null, opacity: 1, alignment: 'surface', originMm: { x: 4000, y: 4000 }, rotationDeg: 0, tileSizeMm: { width: 1000, height: 1000 } }, overlays: [] }
    scene.notes.clue = { id: 'clue', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'secret', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    scene.entityLayers.clue = layer
    const grouped = applyCommands(scene, [{ type: 'createAggregateGroup', group: { id: 'building', floorId: 'blank-floor', parentId: null,
      frame: { translationMm: { x: 6500, y: 6500 }, quarterTurns: 0 }, members: buildingAggregateMembers(scene, 'room'), editLocked: false } }], runtime)
    const before = createCompositionContent(grouped, runtime)
    const move: SceneCommand = { type: 'transformAggregateBuilding', id: 'building', offsetMm: { x: 1000, y: 300 }, pivotMm: { x: 6500, y: 6500 }, quarterTurns: 1 }
    const after = applyCompositionCommands(before, [move], runtime)
    expect(after.appearance.surfaceSources.room).not.toBe(before.appearance.surfaceSources.room)
    const usage = measureCommandBudget(before.document, after.document, { before, after })
    expect(usage.semanticTargets).toBe(1)
    expect(usage.groupMembers).toBe(grouped.aggregateCoordinates!.groups.building.members.length)
    expect(usage.geometrySegments).toBeGreaterThan(4)
    const changed = cloneJson(after)
    changed.document.props.item.rotationDeg++
    expect(measureCommandBudget(before.document, changed.document, { before, after: changed }).groupMembers).toBe(0)
    const forged = cloneJson(after)
    forged.appearance.sources[forged.appearance.surfaceSources.room].parentSourceId = null
    expect(measureCommandBudget(before.document, forged.document, { before, after: forged }).groupMembers).toBe(0)
  })

  it('charges new and removed live containers in addition to their real members', () => {
    const before = fixture().project.document, after = cloneJson(before)
    const member = cloneJson(after.props.item)
    member.id = 'copy'
    after.props.copy = member; after.entityLayers.copy = after.entityLayers.item
    after.prefabInstances.copyGroup = { id: 'copyGroup', floorId: 'blank-floor', definitionRef: { id: 'template', version: 1 }, anchorMm: { x: 0, y: 0 }, rotationDeg: 0,
      visibility: 'public', editLocked: false, members: { one: { propId: 'copy', overrideFields: [] } } }
    after.entityLayers.copyGroup = after.entityLayers.item
    expect(manualChangedTargets(before, after)).toEqual(['prefab:copyGroup', 'prop:copy'])
    expect(manualChangedTargets(after, before)).toEqual(['prefab:copyGroup', 'prop:copy'])
  })

  it.each([1, 1025])('compresses a real natural group quarter-turn with %i unchanged fixed upright sources', count => {
    const scene = fixture({ image: true }).project.document, layer = scene.entityLayers.item
    scene.props.item.positionMm = { x: 6000, y: 6000 }; scene.props.item.rotationDeg = 0
    scene.props.item.supportRef = { kind: 'terrainArea', id: 'ground' }; scene.props.other.positionMm = { x: 18000, y: 18000 }
    scene.terrainAreas.ground = { id: 'ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 3000, y: 3000 }, { x: 13000, y: 3000 }, { x: 13000, y: 13000 }, { x: 3000, y: 13000 }]
        .map((positionMm, i) => ({ id: `ground-p${i}`, segmentId: `ground-s${i}`, positionMm })), groundElevationMm: 0, coveragePriority: 1,
      surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.entityLayers.ground = layer
    scene.props.item.blocksMovement = false; scene.props.item.blocksSight = false
    for (let index = 1; index < count; index++) {
      const id = `near-${index}`
      scene.props[id] = { ...cloneJson(scene.props.item), id, positionMm: { x: 4000 + index % 50 * 100, y: 4000 + Math.floor(index / 50) * 100 } }
      scene.entityLayers[id] = layer
    }
    scene.aggregateCoordinates = { encoding: 'world', groups: { natural: { id: 'natural', floorId: 'blank-floor', parentId: null,
      frame: { translationMm: { x: 8000, y: 8000 }, quarterTurns: 0 }, members: naturalAggregateMembers(scene, ['ground']), editLocked: false } } }
    const before = createCompositionContent(scene, runtime), original = before.appearance.sources[before.appearance.propSources.item]
    if (original.kind !== 'prop') throw new Error('Expected prop source')
    const id = addPropAppearanceSource(before.appearance, original.snapshot, null, { mode: 'nearSide', rootAnchorMm: { x: 0, y: 0 },
      orientation: 'fixedUpright', fixedRotationDeg: 0, footprintAxes: 'world', groundShadowMm: null })
    const carried = Object.keys(before.document.props).filter(id => id !== 'other')
    for (const propId of carried) before.appearance.propSources[propId] = id
    const command: SceneCommand = { type: 'transformAggregateNatural', id: 'natural', offsetMm: { x: 1000, y: 500 }, pivotMm: { x: 8000, y: 8000 }, quarterTurns: 1 }
    const budget = manualTransactionBudget('expanded')
    const after = applyCompositionCommands(before, [command], runtime, { budget })
    expect(after.document.props.item.rotationDeg).toBe(0)
    expect(measureCommandBudget(before.document, after.document, { before, after })).toMatchObject({ semanticTargets: 1, groupMembers: count + 1 })
    if (count > 1024) {
      // A caller-provided upright set is insufficient evidence by itself.
      expect(() => applyCommands(before.document, [command], runtime, { budget, fixedUprightPropIds: new Set(carried) })).toThrow(/semanticTargets/)
      expect(() => applyCommands(before.document, [command], runtime, { budget, fixedUprightPropIds: new Set(carried), budgetContent: { before, after: () => before } })).toThrow(/实际场景变化不一致/)
    }
    const changed = cloneJson(after)
    changed.document.props.item.rotationDeg = 90
    expect(measureCommandBudget(before.document, changed.document, { before, after: changed }).groupMembers).toBe(0)
  }, 30_000)
  it('counts actual room and wall geometry affected by a vertex without charging the internal vertex again', () => {
    const before = fixture({ building: true }).project.document, after = cloneJson(before)
    after.vertices['vertex-0'].xMm += 100
    expect(manualChangedTargets(before, after)).toEqual(['room:room', 'wall:wall-0', 'wall:wall-3'])
    expect(measureCommandBudget(before, after).geometrySegments).toBeGreaterThanOrEqual(6)
    expect(measureCommandBudget(before, after, undefined, undefined, taskBudgetProfile('small'))).toEqual(measureTaskBudget(before, after))
  })

  it('counts scene settings, while identity and fixed record changes remain metadata', () => {
    const before = fixture().project, after = cloneJson(before)
    after.document.units.display = 'ft'
    expect(manualChangedTargets(before.document, after.document, { before, after })).toEqual(['scene:settings'])
    after.document.units.display = before.document.units.display
    after.historyIdentity.lineageId = 'new-lineage'
    expect(manualChangedTargets(before.document, after.document, { before, after })).toEqual([])
  })

  it('keeps geometry and resource protection independent from the editable object count', () => {
    expect(() => assertCommandBudget(MANUAL_TRANSACTION_BUDGET, { ...emptyBudgetUsage(), semanticTargets: 1, geometryPoints: 4097 })).toThrow(/geometryPoints/)
    expect(() => assertCommandBudget(MANUAL_TRANSACTION_BUDGET, { ...emptyBudgetUsage(), semanticTargets: 1, assetBytes: MANUAL_TRANSACTION_BUDGET.limits.assetBytes + 1 })).toThrow(/assetBytes/)
    expect(() => assertCommandBudget(MANUAL_TRANSACTION_BUDGET, { ...emptyBudgetUsage(), semanticTargets: 257 })).toThrow(/semanticTargets/)
    expect(() => parseCommandBudgetProfile({ ...MANUAL_TRANSACTION_BUDGET, semanticTargets: 512 } as never)).toThrow(/完整固定策略/)
  })

  it('meters only changed metadata, including removed records and their key bytes', () => {
    const before = fixture({ image: true }).project, after = cloneJson(before)
    expect(measureCommandBudget(before.document, after.document, { before, after }).metadataBytes).toBe(0)
    after.historyIdentity.lineageId = 'new-lineage'
    const changed = measureCommandBudget(before.document, after.document, { before, after })
    expect(changed.semanticTargets).toBe(0)
    expect(changed.metadataRecords).toBeGreaterThan(0)
    expect(changed.metadataBytes).toBeGreaterThan('new-lineage'.length + 'lineageId'.length)
    delete after.document.propDefinitions.definition
    const removed = measureCommandBudget(before.document, after.document, { before, after })
    expect(removed.metadataRecords).toBeGreaterThan(changed.metadataRecords)
    expect(removed.metadataBytes).toBeGreaterThan(changed.metadataBytes)
    expect(measureCommandBudget(before.document, before.document).metadataBytes).toBe(0)
  })
})
