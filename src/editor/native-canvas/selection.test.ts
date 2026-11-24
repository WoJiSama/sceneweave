import { toCurrentSceneDocument } from '../../shared/model/current-scene.js'
import { describe, expect, it } from 'vitest'
import { groupLayerSceneV3, layerSceneV3 } from '../../core/v3/test-fixtures'
import type { SceneDocument } from '../../shared/model/scene.js'
import { validateSceneSnapshot } from '../../shared/validation/snapshots.js'
import { selectionScene } from './selection-scene'
import { hitTestAll, normalizeSelection, selectInBounds, selectionGeometry } from './selection'
import { summarizeSelection } from './selection-summary'
import { selectionActionReason, selectionCommands } from './selection-actions'
import { manualTransactionBudget } from '../../shared/budget/command-budget'
import { taskBudgetProfile } from '../../shared/budget/task-budget'
import { fixture, runtime } from '../../application/workspace/test-fixtures'
import { createCompositionContent } from '../../shared/appearance/graph'
import { applyCompositionCommands } from '../../shared/appearance/commands'
import { createFurnitureRoomQuery } from '../../shared/geometry/furniture-room'
import { planFurnitureMove } from '../../shared/furnishing/room-move'

const native = (scene = layerSceneV3()): SceneDocument => toCurrentSceneDocument({ ...structuredClone(scene), format: 'sceneweave-scene', schemaVersion: 1 })

describe('native complete-v1 member and batch selection', () => {
  it('moves a selected host and child across a room boundary once in either selection order', () => {
    const scene = fixture({ building: true }).project.document
    Object.assign(scene.props.item, { positionMm: { x: 1500, y: 5000 }, footprintMm: { width: 1500, height: 1000 } })
    scene.props.other.positionMm = { x: 1700, y: 5000 }
    const content = applyCompositionCommands(createCompositionContent(scene, runtime), [
      { type: 'addAttachmentSurface', id: 'top', owner: { kind: 'prop', id: 'item' }, capabilities: ['support'],
        feature: { kind: 'propTop', heightLocalMm: 800, polygonLocalMm: [{ x: -700, y: -400 }, { x: 700, y: -400 }, { x: 700, y: 400 }, { x: -700, y: 400 }] } },
      { type: 'bindPropAttachment', id: 'lamp', childId: 'other', surfaceId: 'top', mode: 'support', follow: 'follow', anchorState: 'manual',
        anchor: { kind: 'horizontal', localMm: { x: 200, y: 0 }, heightOffsetMm: 0, rotationOffsetDeg: 0 } },
    ], runtime)
    const query = createFurnitureRoomQuery(content.document, 'blank-floor')
    for (const ids of [['item', 'other'], ['other', 'item']]) {
      const commands = selectionCommands(content.document, ids, 'move', { dx: 5000 })
        .map(command => command.type === 'updateProp' ? planFurnitureMove(content.document, command, query) : command)
      expect(commands).toHaveLength(1)
      const moved = applyCompositionCommands(content, commands, runtime)
      expect(moved.document.props.other).toMatchObject({ roomId: 'room', positionMm: { x: 6700, y: 5000 } })
    }
  })
  it('hits actual member outlines and never a gap, collapses group/member duplicates and preserves explicit member mode', () => {
    const scene = native(groupLayerSceneV3())
    expect(hitTestAll(scene, { x: 7000, y: 4000 }, 3000)).not.toContain('group')
    expect(hitTestAll(scene, { x: 6000, y: 4000 }, 0)).toEqual(['group'])
    expect(hitTestAll(scene, { x: 6000, y: 4000 }, 0, { memberMode: true })).toEqual(['left'])
    expect(normalizeSelection(scene, ['left', 'group', 'right', 'left'], true)).toEqual(['group'])
    expect(normalizeSelection(scene, ['left', 'right'])).toEqual(['group'])
    expect(normalizeSelection(scene, ['left', 'right'], true)).toEqual(['left', 'right'])
    expect(selectionGeometry(scene, 'group')).toHaveLength(2)
  })

  it('uses rotated image geometry instead of footprint for exact hit and marquee predicates', () => {
    const scene = native(), prop = scene.props.item
    prop.rotationDeg = 45; prop.footprintMm = { width: 2000, height: 2000 }
    expect(hitTestAll(scene, { x: 4600, y: 4000 }, 10)).toEqual([])
    expect(hitTestAll(scene, { x: 4130, y: 4000 }, 0)).toEqual(['item'])
    expect(selectInBounds(scene, { x: 4120, y: 3990, width: 20, height: 20 }, 'intersect').ids).toEqual(['item'])
    expect(selectInBounds(scene, { x: 3900, y: 3900, width: 200, height: 200 }, 'contain').ids).toEqual([])
    const shapes = selectionGeometry(scene, 'item'); shapes[0][0].x = -999
    expect(selectionGeometry(scene, 'item')[0][0].x).not.toBe(-999)
  })

  it('retains layer membership, applies native layer locks to inspectors and leaves locked objects inspectable', () => {
    const input = native(groupLayerSceneV3()), layerId = input.entityLayers.group
    input.userLayers[layerId].editLocked = true
    const scene = selectionScene(input, { effectiveLocks: true, layerOrder: true })
    expect(scene.format).toBe('sceneweave-scene'); expect(scene.schemaVersion).toBe(1)
    expect(scene.entityLayers).toEqual(input.entityLayers)
    expect(hitTestAll(scene, { x: 6000, y: 4000 }, 0)).toContain('group')
    expect(selectInBounds(scene, scene.exportBoundsMm, 'contain').ids).toEqual([])
    expect(summarizeSelection(scene, ['group']).effectiveLockedCount).toBe(1)
    expect(selectionActionReason(scene, ['group'], 'move')).toMatch(/锁定/)
    expect(input.props.left.editLocked).toBe(false)
  })

  it('keeps batch commands bounded and refuses copying a member without changing its retained group record', () => {
    const input = native(groupLayerSceneV3()), checked = validateSceneSnapshot(input)
    if (!checked.ok) throw new Error('Native fixture must validate')
    const scene = checked.document, original = structuredClone(scene.prefabInstances.group)
    expect(() => selectionCommands(scene, ['left'], 'copy')).toThrow(/独立物件/)
    expect(selectionCommands(scene, ['left'], 'move', { dx: 25, dy: -50 })).toEqual([{ type: 'updateProp', id: 'left', changes: { positionMm: { x: 6025, y: 3950 } } }])
    expect(selectionCommands(scene, ['left'], 'delete')).toEqual([{ type: 'deleteProp', id: 'left' }])
    expect(selectionCommands(scene, ['group'], 'delete')).toEqual([{ type: 'deletePrefab', id: 'group', memberIds: ['left', 'right'] }])
    expect(selectionActionReason(scene, Array.from({ length: 257 }, () => 'left'), 'move')).toMatch(/256/)
    expect(scene.prefabInstances.group).toEqual(original)
  })

  it('uses an explicit ordinary tier for a large selection while preserving default and task limits', () => {
    const scene = native(), source = scene.props.item, layerId = scene.entityLayers.item
    scene.props = {}; scene.entityLayers = {}
    const ids = Array.from({ length: 300 }, (_, index) => `member-${index}`)
    for (const [index, id] of ids.entries()) {
      scene.props[id] = { ...structuredClone(source), id, positionMm: { x: 1000 + index * 10, y: 4000 } }
      scene.entityLayers[id] = layerId
    }
    const budget = manualTransactionBudget('standard')
    expect(selectionActionReason(scene, ids, 'move')).toMatch(/256/)
    expect(selectionActionReason(scene, ids, 'move', taskBudgetProfile('expanded'))).toMatch(/256/)
    expect(selectionActionReason(scene, ids, 'move', budget)).toBeNull()
    expect(summarizeSelection(scene, ids, true).overCommandBudget).toBe(true)
    expect(summarizeSelection(scene, ids, true, budget).overCommandBudget).toBe(false)
    const commands = selectionCommands(scene, ids, 'move', { dx: 25 }, budget)
    expect(commands).toHaveLength(300)
    expect(commands[299]).toEqual({ type: 'updateProp', id: 'member-299', changes: { positionMm: { x: 4015, y: 4000 } } })
    scene.props['member-299'].editLocked = true
    expect(selectionActionReason(scene, ids, 'move', budget)).toMatch(/锁定/)
  })
})
