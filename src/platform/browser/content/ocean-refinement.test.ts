import { describe, expect, it, vi } from 'vitest'
import { createOceanDocument } from './ocean-sample.js'
import { createNearshoreBattleDocument } from './nearshore-battle.js'
import { createShipInteriorDocument, SHIP_FLOORS } from './ship-interior.js'
import { applyCommands } from '../../../shared/commands/commands.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { propPresentationEnvelope } from '../../../shared/projection/presentation-contract.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { terrainPoints } from '../../../shared/geometry/geometry.js'
import { visualBase } from '../../../shared/visual/base.js'

vi.mock('../runtime.js', () => ({ runtime: { ids: { nextId: () => 'ocean-refinement-unit' }, clock: { now: () => '2026-11-17T00:00:00.000Z' } }, validation: {} }))
const context = { ids: { nextId: () => 'ocean-unit-unused' }, clock: { now: () => '2026-11-17T00:00:00.000Z' } }

describe('terrain reuse, marine surface effects and multi-Floor ships', () => {
  it('changes ordinary terrain feather through the same command without changing physics or water settings', () => {
    const before = createOceanDocument(), id = 'ocean-shallows'
    const after = applyCommands(before, [{ type: 'updateTerrainArea', id, changes: { boundaryBlendMm: 1300 } }], context)
    expect({ ...after.terrainAreas[id], boundaryBlendMm: before.terrainAreas[id].boundaryBlendMm }).toEqual(before.terrainAreas[id])
    expect(after.props).toEqual(before.props)
    expect(projectScene(after, 'gm').terrain.find(area => area.id === id)?.boundaryBlendMm).toBe(1300)
    expect(() => applyCommands(before, [{ type: 'updateTerrainArea', id, changes: { boundaryBlendMm: -1 } }], context)).toThrow()
    const locked = structuredClone(before); locked.userLayers[locked.entityLayers[id]].editLocked = true
    expect(() => applyCommands(locked, [{ type: 'updateTerrainArea', id, changes: { boundaryBlendMm: 1300 } }], context)).toThrow(/锁/)
  })
  it('includes rotated wake extent in secret masks and retains physical footprint', () => {
    const before = createOceanDocument(), id = 'ocean-cutter'
    const after = applyCommands(before, [{ type: 'setPropWaterAppearance', id, settings: { mode: 'surface', surfaceEffects: { ripples: .7, wakeLengthMm: 5000 } } }], context)
    const a = propPresentationEnvelope(projectScene(before, 'gm'), before.props[id]), b = propPresentationEnvelope(projectScene(after, 'gm'), after.props[id])
    expect(b.boundsMm.width).toBeGreaterThan(a.boundsMm.width)
    expect(b.boundsMm.height).toBeGreaterThan(a.boundsMm.height)
    expect(after.props[id].footprintMm).toEqual(before.props[id].footprintMm)
    after.props[id].visibility = 'gm'
    expect(() => projectScene(after, 'player')).toThrow(/固定遮罩/)
    expect(() => applyCommands(before, [{ type: 'setPropWaterAppearance', id, settings: { mode: 'surface', surfaceEffects: { ripples: 1, wakeLengthMm: 10001 } } }], context)).toThrow()
  })
  it('builds the nearshore scene with the existing material, shore boundary and feather contracts', () => {
    const scene = createNearshoreBattleDocument()
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(scene.terrainAreas['battle-sandy-islet'].boundaryBlendMm).toBeGreaterThan(0)
    expect(Object.values(scene.terrainAreas).some(area => !!area.surfaceStyle?.overlays.length)).toBe(true)
    expect(Object.values(visualBase(scene)!.edgeLooks).some(look => look.kind === 'shore')).toBe(true)
    expect(scene.props['ocean-cutter'].waterAppearance).toMatchObject({ surfaceEffects: { wakeLengthMm: 4200 } })
    expect(projectScene(scene, 'player').props).toHaveLength(8)
  })
  it('uses aligned ordinary Floors, actual rooms and doors, with matching staircase markers', () => {
    const scene = createShipInteriorDocument()
    expect(validateSceneDocument(scene).ok).toBe(true)
    const hulls = SHIP_FLOORS.map(floor => terrainPoints(scene.terrainAreas[`${floor.id}-hull-surface`]))
    expect(hulls[1]).toEqual(hulls[0]); expect(hulls[2]).toEqual(hulls[0])
    expect(scene.props['ship-deck-ladder-a'].positionMm).toEqual(scene.props['ship-cabin-ladder-a'].positionMm)
    expect(scene.props['ship-cabin-ladder-b'].positionMm).toEqual(scene.props['ship-hold-ladder-b'].positionMm)
    expect(Object.keys(scene.rooms)).toHaveLength(5); expect(Object.keys(scene.openings)).toHaveLength(3)
    for (const floor of SHIP_FLOORS) {
      const projection = projectScene(scene, 'player', undefined, { floorId: floor.id })
      expect(projection.terrain).toHaveLength(1)
      expect(projection.props.every(prop => prop.floorId === floor.id)).toBe(true)
      expect(projection.bounds).toEqual(scene.floors[floor.id].outputBoundsMm)
    }
  })
})
