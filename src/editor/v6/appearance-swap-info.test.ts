import { describe, expect, it } from 'vitest'
import { applyCommandsV3 } from '../../core/v3/commands'
import { createOutdoorBlankDocument } from './blank-project'
import { appearanceSwapInfoV6 } from './appearance-swap-info'

describe('appearance replacement dimensions remain explicit', () => {
  it('reports wider source and actual rotated bounds while preserving occupancy, support and blocking', () => {
    let scene = createOutdoorBlankDocument({ title: '外观差异', widthMm: 20000, heightMm: 20000, preset: 'investigation' })
    scene = applyCommandsV3(scene, [{ type: 'addProp', id: 'shelf', floorId: 'blank-floor', definitionRef: { id: 'b2-p-06', version: 1 }, positionMm: { x: 6000, y: 6000 }, rotationDeg: 90 }])
    const before = scene.props.shelf, definition = scene.propDefinitions['m1d-p-02']
    const info = appearanceSwapInfoV6(before, definition)
    expect(info.visualDiffers).toBe(true)
    expect(info.sourceRotatedSizeMm).toEqual({ width: definition.defaultVisualBoundsMm.height, height: definition.defaultVisualBoundsMm.width })
    expect(info.message).toContain('物理占地')
    const after = applyCommandsV3(scene, [{ type: 'replacePropAppearance', id: before.id, definitionRef: { id: definition.id, version: definition.version } }]).props.shelf
    for (const key of ['footprintMm', 'footprintOffsetMm', 'visualBoundsMm', 'positionMm', 'rotationDeg', 'blocksMovement', 'blocksSight', 'supportRef', 'visibility'] as const) expect(after[key]).toEqual(before[key])
  })
  it('does not report a size difference for the unchanged fixed source', () => {
    let scene = createOutdoorBlankDocument({ title: '相同外观', widthMm: 20000, heightMm: 20000, preset: 'investigation' })
    scene = applyCommandsV3(scene, [{ type: 'addProp', id: 'desk', floorId: 'blank-floor', definitionRef: { id: 'b2-p-01', version: 1 }, positionMm: { x: 6000, y: 6000 } }])
    expect(appearanceSwapInfoV6(scene.props.desk, scene.propDefinitions['b2-p-01'])).toMatchObject({ visualDiffers: false, footprintDiffers: false })
  })
})
