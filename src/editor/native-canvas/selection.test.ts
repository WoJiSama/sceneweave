import { describe, expect, it } from 'vitest'
import { groupLayerSceneV3, layerSceneV3 } from '../../core/v3/test-fixtures'
import type { SceneDocument } from '../../shared/model/scene.js'
import { validateSceneSnapshot } from '../../shared/validation/snapshots.js'
import { selectionScene } from './selection-scene'
import { hitTestAll, normalizeSelection, selectInBounds, selectionGeometry } from './selection'
import { summarizeSelection } from './selection-summary'
import { selectionActionReason, selectionCommands } from './selection-actions'

const native = (scene = layerSceneV3()): SceneDocument => ({ ...structuredClone(scene), format: 'sceneweave-scene', schemaVersion: 1 })

describe('native complete-v1 member and batch selection', () => {
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
    expect(selectionActionReason(scene, Array.from({ length: 257 }, () => 'left'), 'move')).toMatch(/256/)
    expect(scene.prefabInstances.group).toEqual(original)
  })
})
