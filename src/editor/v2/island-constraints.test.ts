import { describe, expect, it } from 'vitest'
import { terrainFixtureV2, testPropV2 } from '../../core/v2/b3.test-helpers'
import { applyCommandsV2 } from '../../core/v2/commands'
import { ISLAND_PRESET_ID, validateIslandEditsV2 } from './island-constraints'

const enabled = () => { const scene = terrainFixtureV2(); scene.presetSnapshot.presetId = ISLAND_PRESET_ID; scene.presetSnapshot.presetVersion = 1; return scene }

describe('persisted finite VIS-02 required connection guard', () => {
  it('uses versioned preset opt-in and follows restored scene data rather than title/scene ID', () => {
    const scene = enabled(); scene.sceneId = 'imported-independent-copy'; scene.title = 'renamed island'
    expect(() => validateIslandEditsV2(scene)).not.toThrow()
    const removed = applyCommandsV2(scene, [{ type: 'removeTerrainConnection', id: 'island-stairs' }])
    expect(() => validateIslandEditsV2(removed)).toThrow(/required/)
    removed.presetSnapshot.presetId = 'ordinary-draft'; expect(() => validateIslandEditsV2(removed)).not.toThrow()
    removed.presetSnapshot.presetId = ISLAND_PRESET_ID; removed.presetSnapshot.presetVersion = 2; expect(() => validateIslandEditsV2(removed)).not.toThrow()
  })
  it('rejects blocked stairs and a blocker in either two-metre approach', () => {
    const scene = enabled()
    const blocked = applyCommandsV2(scene, [{ type: 'setConnectionBlocked', id: 'island-stairs', blocksMovement: true }])
    expect(() => validateIslandEditsV2(blocked)).toThrow(/接入区/)
    scene.props.tree = testPropV2('tree', 7000, 10000)
    expect(() => validateIslandEditsV2(scene)).toThrow(/旋转占地/)
    scene.props.tree.positionMm = { x: 13000, y: 10000 }; scene.props.tree.supportRef = { kind: 'terrainArea', id: 'island-high' }
    expect(() => validateIslandEditsV2(scene)).toThrow(/旋转占地/)
  })
})
