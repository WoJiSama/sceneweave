import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { groupLayerSceneV3, scatterLayerSceneV3 } from '../../core/v3/test-fixtures.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { cloneJson } from '../validation/json.js'
import { entityEditLockBlockerIds, isEntityEditLocked } from './base.js'
import { applyCommands } from './commands.js'
import { effectiveEditLocked, entityEditLockSources } from './layers.js'

describe('selection edit-lock sources', () => {
  it('distinguishes own locks from shared layer locks without modifying the scene', () => {
    const scene = fixture().project.document, layerId = scene.entityLayers.item
    scene.props.item.editLocked = true; scene.userLayers[layerId].editLocked = true
    const before = cloneJson(scene)
    expect(entityEditLockSources(scene, 'item')).toEqual({ entityIds: ['item'], layerIds: [layerId] })
    expect(entityEditLockSources(scene, 'other')).toEqual({ entityIds: [], layerIds: [layerId] })
    expect(isEntityEditLocked(scene, 'other')).toBe(false)
    expect(effectiveEditLocked(scene, 'other')).toBe(true)
    expect(scene).toEqual(before)
  })

  it('identifies both parent and member locks, while each independent unlock preserves the other', () => {
    const scene = toCurrentSceneDocument({ ...groupLayerSceneV3(), format: 'sceneweave-scene' })
    scene.prefabInstances.group.editLocked = true; scene.props.left.editLocked = true
    expect(entityEditLockBlockerIds(scene, 'left')).toEqual(['left', 'group'])
    expect(new Set(entityEditLockSources(scene, 'group').entityIds)).toEqual(new Set(['left', 'group']))
    expect(() => applyCommands(scene, [{ type: 'setEditLock', kind: 'prop', id: 'left', locked: false }], runtime)).toThrow(/组合/)
    const parentUnlocked = applyCommands(scene, [{ type: 'setEditLock', kind: 'prefabInstance', id: 'group', locked: false }], runtime)
    expect(parentUnlocked.props.left.editLocked).toBe(true)
    expect(entityEditLockSources(parentUnlocked, 'left')).toEqual({ entityIds: ['left'], layerIds: [] })
    const unlocked = applyCommands(parentUnlocked, [{ type: 'setEditLock', kind: 'prop', id: 'left', locked: false }], runtime)
    expect(effectiveEditLocked(unlocked, 'group')).toBe(false)
  })

  it('reports recursive locked notes and lets an independent object unlock leave their protection intact', () => {
    const scene = fixture().project.document, layerId = scene.entityLayers.item
    scene.props.item.editLocked = true
    scene.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' }, kind: 'note', text: 'first', visibility: 'gm' }
    scene.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: true, anchor: { type: 'entity', entityKind: 'note', entityId: 'first' }, kind: 'note', text: 'second', visibility: 'gm' }
    scene.entityLayers.first = layerId; scene.entityLayers.second = layerId
    expect(new Set(entityEditLockSources(scene, 'item').entityIds)).toEqual(new Set(['item', 'second']))
    const unlocked = applyCommands(scene, [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: false }], runtime)
    expect(entityEditLockSources(unlocked, 'item')).toEqual({ entityIds: ['second'], layerIds: [] })
    expect(effectiveEditLocked(unlocked, 'item')).toBe(true)
  })

  it('reports structural dependants in other layers', () => {
    const scene = fixture({ building: true }).project.document
    scene.userLayers.protected = { id: 'protected', floorId: 'blank-floor', name: '保护内容', order: 1, editLocked: true }
    scene.entityLayers.other = 'protected'; scene.props.other.supportRef = { kind: 'room', id: 'room' }; scene.props.other.roomId = 'room'
    expect(entityEditLockSources(scene, 'wall-0')).toEqual({ entityIds: [], layerIds: ['protected'] })
    expect(effectiveEditLocked(scene, 'wall-0')).toBe(true)
  })

  it('uses the actual terrain closure without inventing a prop support lock', () => {
    const scene = toCurrentSceneDocument({ ...scatterLayerSceneV3(1), format: 'sceneweave-scene' })
    scene.terrainAreas.domain.editLocked = true
    expect(entityEditLockSources(scene, 'item')).toEqual({ entityIds: [], layerIds: [] })
    expect(entityEditLockSources(scene, 'domain-point-0')).toEqual({ entityIds: ['domain'], layerIds: [] })
    scene.props['scatter-item-0'].editLocked = true
    expect(new Set(entityEditLockSources(scene, 'domain').entityIds)).toEqual(new Set(['domain', 'scatter-item-0']))
    expect(entityEditLockSources(scene, 'missing')).toEqual({ entityIds: [], layerIds: [] })
  })
})
