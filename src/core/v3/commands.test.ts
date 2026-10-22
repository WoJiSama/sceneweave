import { describe, expect, it } from 'vitest'
import { applyCommandsV3, applySnapshotCommandsV3, createPlacedPropV3, type SceneCommandV3 } from './commands'
import { entitiesInLayerV3, previewLayerMoveV3, previewLayerRemovalV3 } from './layers'
import { groupLayerSceneV3, layerSceneV3, scatterLayerSceneV3, symbolPropV3 } from './test-fixtures'
import { validateSceneSnapshotV3 } from './snapshots'
import { validateSceneV3 } from './schema'
import type { SceneDocumentV3 } from './types'

const apply = (scene: SceneDocumentV3, ...commands: SceneCommandV3[]) => applyCommandsV3(scene, commands)
const withTarget = (scene = layerSceneV3()) => apply(scene, { type: 'createLayer', id: 'target', floorId: 'blank-floor', name: '目标层' })

describe('v3 atomic layer organization', () => {
  it('creates, trims, renames and reorders complete Floor layer lists without changing physical meaning', () => {
    const source = layerSceneV3(), oldId = source.entityLayers.item, before = structuredClone(source)
    const created = apply(source, { type: 'createLayer', id: 'target', floorId: 'blank-floor', name: '  道具层  ' })
    expect(created.userLayers.target).toEqual({ id: 'target', floorId: 'blank-floor', name: '道具层', order: 1, editLocked: false })
    const renamed = apply(created, { type: 'renameLayer', id: 'target', name: '新道具' })
    const reordered = apply(renamed, { type: 'reorderLayers', floorId: 'blank-floor', ids: ['target', oldId] })
    expect(reordered.userLayers.target.order).toBe(0); expect(reordered.userLayers[oldId].order).toBe(1)
    expect(reordered.props).toEqual(source.props); expect(reordered.floors).toEqual(source.floors)
    expect(reordered.revision).toBe(source.revision); expect(source).toEqual(before)
    expect(() => apply(created, { type: 'reorderLayers', floorId: 'blank-floor', ids: [oldId] })).toThrow(/全部/)
    expect(() => apply(created, { type: 'reorderLayers', floorId: 'blank-floor', ids: [oldId, oldId] })).toThrow(/重复/)
    expect(() => apply(created, { type: 'renameLayer', id: 'target', name: ' ' })).toThrow(/指令无效/)
  })

  it('protects identity, Floor and the 128-layer total before mutation', () => {
    let scene = layerSceneV3()
    expect(() => apply(scene, { type: 'createLayer', id: 'item', floorId: 'blank-floor', name: 'Bad' })).toThrow(/独立 ID/)
    expect(() => apply(scene, { type: 'createLayer', id: 'new', floorId: 'missing', name: 'Bad' })).toThrow(/Floor/)
    scene = apply(scene, ...Array.from({ length: 127 }, (_, i): SceneCommandV3 => ({ type: 'createLayer', id: `extra-${i}`, floorId: 'blank-floor', name: `Layer ${i}` })))
    expect(Object.keys(scene.userLayers)).toHaveLength(128)
    expect(() => apply(scene, { type: 'createLayer', id: 'overflow', floorId: 'blank-floor', name: 'Overflow' })).toThrow(/128/)
    expect(Object.keys(scene.userLayers)).toHaveLength(128)
  })

  it('expands a selected member to its container and all live siblings, retaining removed keys and overrides', () => {
    const scene = withTarget(groupLayerSceneV3()), before = structuredClone(scene)
    const preview = previewLayerMoveV3(scene, ['left'], 'target')
    expect(preview.reason).toBeNull(); expect(preview.expandedIds).toEqual(['group', 'left', 'right'])
    const next = apply(scene, { type: 'moveEntitiesToLayer', ids: ['left'], layerId: 'target' })
    expect(entitiesInLayerV3(next, 'target')).toEqual(expect.arrayContaining(['group', 'left', 'right']))
    expect(next.prefabInstances).toEqual(scene.prefabInstances); expect(next.props).toEqual(scene.props)
    expect(next.entityLayers.item).toBe(scene.entityLayers.item); expect(scene).toEqual(before)
  })

  it('previews a whole nonempty removal, requires its target and preserves every content record', () => {
    const scene = withTarget(), oldId = scene.entityLayers.item, before = structuredClone(scene)
    expect(previewLayerRemovalV3(scene, oldId).reason).toMatch(/迁移目标/)
    expect(() => apply(scene, { type: 'removeLayer', id: oldId })).toThrow(/迁移目标/)
    const preview = previewLayerRemovalV3(scene, oldId, 'target')
    expect(preview.expandedIds).toEqual(['item']); expect(preview.commandCost).toBe(2)
    const next = apply(scene, { type: 'removeLayer', id: oldId, targetLayerId: 'target' })
    expect(next.userLayers).toEqual({ target: { ...scene.userLayers.target, order: 0 } })
    expect(next.entityLayers.item).toBe('target'); expect(next.props).toEqual(scene.props)
    expect(next.assets).toEqual(scene.assets); expect(scene).toEqual(before)
    expect(() => apply(next, { type: 'removeLayer', id: 'target' })).toThrow(/至少/)
    expect(() => apply(scene, { type: 'removeLayer', id: oldId, targetLayerId: oldId })).toThrow(/自身/)
    const emptyRemoved = apply(scene, { type: 'removeLayer', id: 'target' })
    expect(Object.keys(emptyRemoved.userLayers)).toEqual([oldId])
  })

  it('rejects entity and dependent locks, target locks, order changes and mixed transactions as a whole', () => {
    const scene = withTarget(groupLayerSceneV3()), baseline = scene.entityLayers.item
    scene.props.right.editLocked = true
    expect(previewLayerMoveV3(scene, ['left'], 'target').blockedIds).toEqual(expect.arrayContaining(['group', 'right']))
    expect(() => apply(scene, { type: 'moveEntitiesToLayer', ids: ['left'], layerId: 'target' })).toThrow(/锁定/)
    expect(() => apply(scene, { type: 'reorderLayers', floorId: 'blank-floor', ids: ['target', baseline] })).toThrow(/锁定/)
    scene.props.right.editLocked = false; scene.userLayers.target.editLocked = true
    expect(() => apply(scene, { type: 'moveEntitiesToLayer', ids: ['item'], layerId: 'target' })).toThrow(/锁定/)
    expect(() => apply(scene, { type: 'setLayerLock', id: 'target', locked: false }, { type: 'moveEntitiesToLayer', ids: ['item'], layerId: 'target' })).toThrow(/独立/)
    expect(() => apply(scene, { type: 'setEditLock', kind: 'prop', id: 'item', locked: false }, { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } })).toThrow(/独立/)
    expect(() => apply(scene, { type: 'moveEntitiesToLayer', ids: ['item'], layerId: 'target' }, { type: 'deleteProp', id: 'item' })).toThrow(/独立/)
  })

  it('checks cross-layer recursive anchored locks and keeps actual flags separate from layer locks', () => {
    let scene = withTarget(), baseline = scene.entityLayers.item
    scene.notes.anchor = { id: 'anchor', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'note', text: 'anchor', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    scene.entityLayers.anchor = 'target'; scene.userLayers.target.editLocked = true
    expect(() => apply(scene, { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } })).toThrow(/锁定/)
    expect(() => apply(scene, { type: 'moveEntitiesToLayer', ids: ['item'], layerId: baseline })).toThrow(/锁定/)
    scene = apply(scene, { type: 'setLayerLock', id: 'target', locked: false })
    scene.props.item.editLocked = true
    const unlockedLayer = apply(scene, { type: 'setLayerLock', id: baseline, locked: false })
    expect(unlockedLayer.props.item.editLocked).toBe(true)
  })

  it('bounds both expanded member writes and a batch of individually legal moves to 256', () => {
    const scene = withTarget(), baseline = scene.entityLayers.item
    for (let i = 0; i < 256; i++) { scene.props[`many-${i}`] = symbolPropV3(`many-${i}`, 1000 + i % 32 * 500, 1000 + Math.floor(i / 32) * 500); scene.entityLayers[`many-${i}`] = baseline }
    const ids = Object.keys(scene.props), before = structuredClone(scene)
    const refused = previewLayerMoveV3(scene, ids, 'target')
    expect(refused.reason).toMatch(/256/); expect(refused.expandedIds).toHaveLength(257); expect(refused.commandCost).toBe(257)
    expect(() => apply(scene, { type: 'removeLayer', id: baseline, targetLayerId: 'target' })).toThrow(/256/)
    expect(() => apply(scene, { type: 'moveEntitiesToLayer', ids: ids.slice(0, 200), layerId: 'target' }, { type: 'moveEntitiesToLayer', ids: ids.slice(200), layerId: 'target' })).toThrow(/256/)
    expect(() => apply(scene, ...Array.from({ length: 257 }, (): SceneCommandV3 => ({ type: 'renameLayer', id: 'target', name: 'Name' })))).toThrow(/256/)
    expect(scene).toEqual(before)
  })

  it('refuses one selected scatter member when the complete live container exceeds 256 entities', () => {
    const scene = withTarget(scatterLayerSceneV3(256)), before = structuredClone(scene)
    const preview = previewLayerMoveV3(scene, ['scatter-item-0'], 'target')
    expect(preview.reason).toMatch(/257.*256/); expect(preview.expandedIds).toHaveLength(257)
    expect(preview.expandedIds).toEqual(expect.arrayContaining(['scatter', 'scatter-item-255']))
    expect(() => apply(scene, { type: 'moveEntitiesToLayer', ids: ['scatter-item-0'], layerId: 'target' })).toThrow(/257.*256/)
    expect(scene).toEqual(before)
  })

  it('charges removal itself in addition to every expanded entity and keeps the complete refusal scope', () => {
    const scene = withTarget(), baseline = scene.entityLayers.item
    for (let i = 0; i < 254; i++) { const id = `limit-${i}`; scene.props[id] = symbolPropV3(id); scene.entityLayers[id] = baseline }
    expect(previewLayerRemovalV3(scene, baseline, 'target').commandCost).toBe(256)
    expect(apply(scene, { type: 'removeLayer', id: baseline, targetLayerId: 'target' }).userLayers).not.toHaveProperty(baseline)
    scene.props.extra = symbolPropV3('extra'); scene.entityLayers.extra = baseline
    const refused = previewLayerRemovalV3(scene, baseline, 'target')
    expect(refused.reason).toMatch(/256/); expect(refused.ids).toHaveLength(256); expect(refused.commandCost).toBe(257)
    expect(() => apply(scene, { type: 'removeLayer', id: baseline, targetLayerId: 'target' })).toThrow(/256/)
  })
})

describe('v3 content commands and membership maintenance', () => {
  it('cannot unlock a synthetic layer lock through setEditLock, including a nominal no-op unlock', () => {
    const scene = withTarget(), layerId = scene.entityLayers.item
    scene.userLayers[layerId].editLocked = true
    const before = structuredClone(scene)
    expect(() => apply(scene, { type: 'setEditLock', kind: 'prop', id: 'item', locked: false })).toThrow(/图层已锁定/)
    expect(() => apply(scene, { type: 'setEditLock', kind: 'prop', id: 'item', locked: true })).toThrow(/图层已锁定/)
    expect(() => apply(scene, { type: 'updateProp', id: 'item', changes: { rotationDeg: 45 } })).toThrow(/锁定/)
    expect(scene).toEqual(before)
  })

  it('restores actual flags for unrelated locked layers while applying content and explicit entity locks', () => {
    const scene = withTarget(), baseline = scene.entityLayers.item
    scene.props.other = symbolPropV3('other', 9000, 9000); scene.entityLayers.other = 'target'; scene.userLayers.target.editLocked = true
    const moved = apply(scene, { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } })
    expect(moved.props.item.rotationDeg).toBe(90); expect(moved.props.other.editLocked).toBe(false)
    expect(moved.userLayers.target.editLocked).toBe(true); expect(moved.entityLayers.item).toBe(baseline)
    const locked = apply(moved, { type: 'setEditLock', kind: 'prop', id: 'item', locked: true })
    expect(locked.props.item.editLocked).toBe(true); expect(locked.props.other.editLocked).toBe(false)
    expect(apply(locked, { type: 'setEditLock', kind: 'prop', id: 'item', locked: false }).props.item.editLocked).toBe(false)
  })

  it('places into an explicit layer, copies the source layer and removes only deleted entity memberships', () => {
    let scene = withTarget(), definition = Object.values(scene.propDefinitions)[0]
    const ghost = createPlacedPropV3(scene, definition.id, { x: 12000, y: 12000 }, { id: 'new', layerId: 'target' })
    expect(ghost.floorId).toBe(scene.userLayers.target.floorId)
    scene = apply(scene, { type: 'addProp', id: 'new', floorId: ghost.floorId, definitionRef: { id: definition.id, version: definition.version }, positionMm: ghost.positionMm, layerId: 'target' })
    expect(scene.entityLayers.new).toBe('target')
    const copied = apply(scene, { type: 'copyProp', id: 'new', newId: 'copy', offsetMm: { x: 300, y: 300 } })
    expect(copied.entityLayers.copy).toBe('target'); expect(copied.props.copy.appearance).toEqual(copied.props.new.appearance)
    const deleted = apply(copied, { type: 'deleteProp', id: 'new' })
    expect(deleted.entityLayers).not.toHaveProperty('new'); expect(deleted.entityLayers.copy).toBe('target')
    expect(deleted.propDefinitions).toEqual(scene.propDefinitions)
  })

  it.each(['upper-floor', '2'])('refuses unsupported additional Floor %s without fabricating a valid ghost domain', floorId => {
    const scene = withTarget(), definition = Object.values(scene.propDefinitions)[0]
    scene.floors['1'] = { id: '1', name: 'First numeric Floor', boundsMm: { ...scene.exportBoundsMm } }
    scene.floors[floorId] = { id: floorId, name: 'Upper Floor', boundsMm: { ...scene.exportBoundsMm } }
    scene.userLayers.firstFloor = { id: 'firstFloor', floorId: '1', name: 'First Floor', order: 0, editLocked: false }
    scene.userLayers.upper = { id: 'upper', floorId, name: 'Upper', order: 0, editLocked: false }
    const before = structuredClone(scene)
    expect(() => createPlacedPropV3(scene, definition.id, { x: 12000, y: 12000 }, { id: 'upper-prop', layerId: 'upper' })).toThrow(/恰好支持一个 Floor/)
    expect(previewLayerMoveV3(scene, ['item'], 'upper').reason).toMatch(/恰好支持一个 Floor/)
    expect(() => apply(scene, { type: 'addProp', id: 'bad-floor', floorId, definitionRef: { id: definition.id, version: definition.version }, positionMm: { x: 12000, y: 12000 }, layerId: 'upper' })).toThrow(/恰好支持一个 Floor/)
    expect(scene).toEqual(before)
  })

  it('keeps shared architectural and support layer locks in content validation', () => {
    let scene = withTarget()
    const baseline = scene.entityLayers.item, points = [{ x: 1000, y: 1000 }, { x: 9000, y: 1000 }, { x: 9000, y: 9000 }, { x: 1000, y: 9000 }]
    for (let i = 0; i < points.length; i++) {
      const id = `room-v${i}`, wallId = `room-w${i}`
      scene.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, xMm: points[i].x, yMm: points[i].y }
      scene.walls[wallId] = { id: wallId, floorId: 'blank-floor', editLocked: false, startVertexId: id, endVertexId: `room-v${(i + 1) % 4}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
      scene.entityLayers[id] = baseline; scene.entityLayers[wallId] = baseline
    }
    scene.rooms.room = { id: 'room', floorId: 'blank-floor', editLocked: false, boundaryVertexIds: points.map((_, i) => `room-v${i}`), purpose: 'Room', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: 'blank-floor' }, groundElevationMm: 0, floorStyle: null }
    scene.entityLayers.room = 'target'; scene.props.item.supportRef = { kind: 'room', id: 'room' }; scene.props.item.roomId = 'room'
    scene.userLayers.target.editLocked = true
    expect(validateSceneV3(scene).ok).toBe(true)
    expect(() => apply(scene, { type: 'setWallThickness', id: 'room-w0', thicknessMm: 300 })).toThrow(/锁定/)
    expect(() => apply(scene, { type: 'moveVertex', id: 'room-v0', positionMm: { x: 1200, y: 1200 } })).toThrow(/锁定/)
    const definition = Object.values(scene.propDefinitions)[0]
    expect(() => createPlacedPropV3(scene, definition.id, { x: 5000, y: 5000 }, { layerId: baseline, supportRef: { kind: 'room', id: 'room' } })).toThrow(/锁定/)
    scene = apply(scene, { type: 'setLayerLock', id: 'target', locked: false })
    const next = apply(scene, { type: 'setWallThickness', id: 'room-w0', thicknessMm: 300 })
    expect(next.rooms.room.editLocked).toBe(false); expect(next.props.item).toEqual(scene.props.item)
  })

  it('preserves scatter manual/deleted/detached records while maintaining layers through regeneration', () => {
    const source = withTarget(scatterLayerSceneV3(3)), baseline = source.entityLayers.item, before = structuredClone(source)
    const moved = apply(source, { type: 'moveEntitiesToLayer', ids: ['scatter-item-0'], layerId: 'target' })
    const deleted = apply(moved, { type: 'deleteProp', id: 'scatter-item-1' })
    const detached = apply(deleted, { type: 'detachScatterMember', groupId: 'scatter', propId: 'scatter-item-2' })
    const separated = apply(detached, { type: 'moveEntitiesToLayer', ids: ['scatter-item-2'], layerId: baseline })
    expect(separated.props['scatter-item-2'].visibility).toBe('gm')
    const regenerated = apply(separated, { type: 'regenerateScatter', id: 'scatter', densityFactor: 1 })
    expect(regenerated.scatterGroups.scatter.members).toMatchObject(separated.scatterGroups.scatter.members)
    expect(regenerated.scatterGroups.scatter.exclusions).toEqual(separated.scatterGroups.scatter.exclusions)
    expect(regenerated.props['scatter-item-0']).toEqual(source.props['scatter-item-0'])
    expect(regenerated.entityLayers['scatter-item-2']).toBe(baseline)
    expect(regenerated.entityLayers).not.toHaveProperty('scatter-item-1')
    const generatedIds = Object.values(regenerated.scatterGroups.scatter.members).filter(member => member.state === 'managed').map(member => member.propId!)
    expect(generatedIds.length).toBeGreaterThan(0)
    for (const id of generatedIds) expect(regenerated.entityLayers[id]).toBe('target')
    const thinned = apply(regenerated, { type: 'regenerateScatter', id: 'scatter', densityFactor: 0 })
    for (const id of generatedIds) { expect(thinned.props).not.toHaveProperty(id); expect(thinned.entityLayers).not.toHaveProperty(id) }
    expect(thinned.scatterGroups.scatter.members).toEqual(separated.scatterGroups.scatter.members)
    expect(thinned.entityLayers['scatter-item-0']).toBe('target'); expect(source).toEqual(before)
    const locked = apply(regenerated, { type: 'setLayerLock', id: 'target', locked: true })
    expect(() => apply(locked, { type: 'regenerateScatter', id: 'scatter', densityFactor: 0 })).toThrow(/锁定/)
  })

  it('preserves layers and artificial records on member deletion and unpacking', () => {
    const scene = withTarget(groupLayerSceneV3()), layerId = scene.entityLayers.group
    const deleted = apply(scene, { type: 'deleteProp', id: 'left' })
    expect(deleted.prefabInstances.group.members.left.propId).toBeNull()
    expect(deleted.prefabInstances.group.members.left.overrideFields).toEqual(['positionMm'])
    expect(deleted.entityLayers).not.toHaveProperty('left'); expect(deleted.entityLayers.group).toBe(layerId)
    const unpacked = apply(scene, { type: 'unpackPrefab', id: 'group' })
    expect(unpacked.entityLayers).not.toHaveProperty('group')
    expect(unpacked.entityLayers.left).toBe(layerId); expect(unpacked.entityLayers.right).toBe(layerId)
    expect(unpacked.props.left.visibility).toBe('gm'); expect(unpacked.props.right.visibility).toBe('gm')
  })

  it('assigns new split-wall entities to their source layer without duplicating shared structure', () => {
    const scene = withTarget()
    scene.vertices.a = { id: 'a', floorId: 'blank-floor', editLocked: false, xMm: 3000, yMm: 5000 }
    scene.vertices.b = { id: 'b', floorId: 'blank-floor', editLocked: false, xMm: 9000, yMm: 5000 }
    scene.walls.wall = { id: 'wall', floorId: 'blank-floor', editLocked: false, startVertexId: 'a', endVertexId: 'b', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    for (const id of ['a', 'b', 'wall']) scene.entityLayers[id] = 'target'
    const next = apply(scene, { type: 'splitWall', id: 'wall', positionMm: { x: 6000, y: 5000 }, newVertexId: 'split', newWallId: 'split-wall' })
    expect(next.entityLayers.split).toBe('target'); expect(next.entityLayers['split-wall']).toBe('target')
    expect(Object.keys(next.walls)).toHaveLength(2); expect(validateSceneV3(next).ok).toBe(true)
  })

  it('strictly rejects extra command fields and preserves certified no-op identities', () => {
    const scene = layerSceneV3(), checked = validateSceneSnapshotV3(scene)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    expect(applySnapshotCommandsV3(checked.document, [{ type: 'renameLayer', id: scene.entityLayers.item, name: '默认图层' }])).toBe(checked.document)
    expect(() => apply(scene, { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 }, layerId: 'injected' } as unknown as SceneCommandV3)).toThrow(/指令无效/)
  })
})
