import { describe, expect, it } from 'vitest'
import { applyCommandsV3, applySnapshotCommandsV3, type SceneCommandV3 } from './commands'
import type { SceneDisplayCommandV3 } from './scene-display'
import { layerSceneV3 } from './test-fixtures'
import { validateSceneSnapshotV3 } from './snapshots'
import { applyCompositionCommandsV6 } from '../v6/commands'
import { createCompositionContentV6 } from '../v6/graph'
import { formatDistanceMm } from '../../editor/v4/building-session'

const tactical: SceneDisplayCommandV3 = { type: 'setSceneDisplay', display: 'ft', distanceMode: 'grid', gridSizeMm: 1524, snapMm: 254, gridVisible: true }

describe('scene display preferences through native atomic commands', () => {
  it('preserves physical dimensions, fixed preset provenance, locks and appearance/history identities', () => {
    const scene = applyCommandsV3(layerSceneV3(), [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: true }])
    scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-scn04', presetVersion: 1, source: 'SCN-04 finite fixture guard' }
    scene.userLayers[scene.entityLayers.item].editLocked = true
    const content = createCompositionContentV6(scene), before = structuredClone(content)
    const changed = applyCompositionCommandsV6(content, [tactical])
    expect(changed.document.units).toEqual({ world: 'mm', display: 'ft', gridSizeMm: 1524, snapMm: 254, gridVisible: true })
    expect(changed.document.presetSnapshot).toEqual({ ...before.document.presetSnapshot, distanceMode: 'grid', gridSizeMm: 1524 })
    const { units: _units, presetSnapshot: _preset, ...physical } = changed.document
    const { units: _originalUnits, presetSnapshot: _originalPreset, ...originalPhysical } = before.document
    expect(physical).toEqual(originalPhysical)
    expect(changed.historyIdentity).toEqual(before.historyIdentity)
    expect(changed.appearance).toEqual(before.appearance)
    expect(content).toEqual(before)
    expect(formatDistanceMm(1524, 'ft')).toBe('5.000 ft')
    expect(formatDistanceMm(1524, 'm')).toBe('1.524 m')
  })

  it('retains no-op snapshot identity and rejects malformed or mixed operations atomically', () => {
    const scene = layerSceneV3(), before = structuredClone(scene)
    const checked = validateSceneSnapshotV3(applyCommandsV3(scene, [tactical]))
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    expect(applySnapshotCommandsV3(checked.document, [tactical])).toBe(checked.document)
    const invalid = [
      { ...tactical, gridSizeMm: 0 }, { ...tactical, snapMm: 1.5 }, { ...tactical, snapMm: Number.MAX_SAFE_INTEGER + 1 },
      { ...tactical, world: 'ft' }, { ...tactical, presetId: 'bypass-guard' }, { ...tactical, positionMm: { x: 0, y: 0 } },
    ]
    for (const command of invalid) expect(() => applyCommandsV3(scene, [command as SceneCommandV3])).toThrow(/指令无效/)
    expect(() => applyCommandsV3(scene, [tactical, { type: 'updateProp', id: 'item', changes: { rotationDeg: 45 } }])).toThrow(/须分别独立提交/)
    expect(() => applyCommandsV3(scene, Array.from({ length: 257 }, () => tactical))).toThrow(/256/)
    expect(scene).toEqual(before)
  })
})
