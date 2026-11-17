import { describe, expect, it, vi } from 'vitest'
import { createOceanDocument } from './ocean-sample.js'
import { applyCommands, applySnapshotCommands } from '../../../shared/commands/commands.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import { propPresentationEnvelope } from '../../../shared/projection/presentation-contract.js'
import { oceanWaves, waveGrid } from '../../../shared/ocean/waves.js'
import { WATER_PRESETS, waterSurfaceSchema } from '../../../shared/ocean/contracts.js'

vi.mock('../runtime.js', () => ({ runtime: { ids: { nextId: () => 'ocean-unit' }, clock: { now: () => '2026-11-17T00:00:00.000Z' } }, validation: {} }))
const context = { ids: { nextId: () => 'unused' }, clock: { now: () => '2026-11-17T00:00:00.000Z' } }
function mask(scene: ReturnType<typeof createOceanDocument>) {
  scene.regions['private-test-mask'] = { id: 'private-test-mask', floorId: 'collection-floor', editLocked: false, visibility: 'gm', kind: 'manualMask',
    boundaryMm: [{ x: 0, y: 0 }, { x: 40000, y: 0 }, { x: 40000, y: 30000 }, { x: 0, y: 30000 }], blocksMovement: false, movementCostMultiplier: 1 }
  scene.entityLayers['private-test-mask'] = 'collection-structure'
}

describe('static ocean scene domain and authoring', () => {
  it('provides two real water supports and individually editable ships and six marine designs', () => {
    const scene = createOceanDocument()
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(Object.keys(scene.props)).toHaveLength(8)
    expect(Object.values(scene.props).every(prop => !!scene.terrainAreas[prop.supportRef.id]?.waterSurface)).toBe(true)
    expect(new Set(Object.values(scene.props).map(prop => prop.waterAppearance?.mode))).toEqual(new Set(['surface', 'submerged', 'partial']))
    expect(scene.terrainAreas['ocean-open-water'].blocksMovement).toBe(true)
    expect(Object.values(scene.props).filter(prop => prop.waterAppearance?.mode !== 'surface').every(prop => !prop.blocksMovement && !prop.blocksSight)).toBe(true)
  })
  it('changes only water appearance, preserves physical facts, and refuses dependent removal atomically', () => {
    const before = createOceanDocument(), settings = { ...before.terrainAreas['ocean-open-water'].waterSurface!, color: '#224466', clarity: .25 }
    const after = applyCommands(before, [{ type: 'setWaterSurface', id: 'ocean-open-water', settings }], context)
    expect(after.props).toEqual(before.props)
    const restored = cloneJson(after); restored.terrainAreas['ocean-open-water'].waterSurface = before.terrainAreas['ocean-open-water'].waterSurface
    expect(restored).toEqual(before)
    expect(() => applyCommands(before, [{ type: 'setWaterSurface', id: 'ocean-open-water', settings: null }], context)).toThrow(/移除水面/)
    expect(before.terrainAreas['ocean-open-water'].waterSurface!.color).not.toBe('#224466')
    const look = applyCommands(before, [{ type: 'setPropWaterAppearance', id: 'ocean-shark', settings: { mode: 'partial', depth: .7, submergedFraction: .4 } }], context)
    const unchanged = cloneJson(look); unchanged.props['ocean-shark'].waterAppearance = before.props['ocean-shark'].waterAppearance
    expect(unchanged).toEqual(before)
  })
  it('checks support and dependent locks and the same strict constraints on the snapshot path', () => {
    const locked = createOceanDocument(); locked.props['ocean-shark'].editLocked = true
    expect(() => applyCommands(locked, [{ type: 'setWaterSurface', id: 'ocean-open-water', settings: { ...WATER_PRESETS.rough } }], context)).toThrow(/锁定/)
    const layer = createOceanDocument(); layer.userLayers['collection-structure'].editLocked = true
    expect(() => applyCommands(layer, [{ type: 'setPropWaterAppearance', id: 'ocean-shark', settings: { mode: 'surface' } }], context)).toThrow(/锁定/)
    expect(() => applySnapshotCommands(createOceanDocument(), [{ type: 'setPropWaterAppearance', id: 'ocean-cutter', settings: { mode: 'submerged', depth: .5 } }], context)).toThrow(/阻挡/)
  })
  it('rejects stale/nonwater support, incorrect render band, blocking underwater scenery and unbounded waves', () => {
    const invalid = [
      (scene: ReturnType<typeof createOceanDocument>) => { delete scene.terrainAreas['ocean-open-water'].waterSurface },
      (scene: ReturnType<typeof createOceanDocument>) => { scene.props['ocean-shark'].renderLayer = 'canopy' },
      (scene: ReturnType<typeof createOceanDocument>) => { scene.props['ocean-shark'].blocksSight = true },
      (scene: ReturnType<typeof createOceanDocument>) => { scene.terrainAreas['ocean-open-water'].waterSurface!.waveSpacingMm = 600 },
    ]
    for (const change of invalid) { const scene = createOceanDocument(); change(scene); expect(validateSceneDocument(scene).ok).toBe(false) }
    expect(waterSurfaceSchema.safeParse({ ...WATER_PRESETS.calm, waveDirectionDeg: 360 }).success).toBe(false)
    expect(waterSurfaceSchema.safeParse({ ...WATER_PRESETS.calm, animated: true }).success).toBe(false)
  })
  it('copies and rotates one partially submerged prop without splitting or losing the saved waterline', () => {
    const scene = createOceanDocument()
    const command = { type: 'copyProp' as const, id: 'ocean-kraken', newId: 'ocean-kraken-copy', offsetMm: { x: 6000, y: -5000 } }
    let serial = 0
    const copied = applyCommands(scene, [command], { ...context, ids: { nextId: () => `water-copy-${++serial}` } })
    const extra = Object.values(copied.props).find(prop => !scene.props[prop.id])!
    expect(extra.waterAppearance).toEqual(scene.props['ocean-kraken'].waterAppearance)
    const rotated = applySnapshotCommands(copied, [{ type: 'updateProp', id: extra.id, changes: { rotationDeg: 90 } }], context)
    expect(rotated.props[extra.id].waterAppearance).toEqual(extra.waterAppearance)
    expect(rotated.props[extra.id].rotationDeg).toBe(90)
  })
})

describe('ocean projection and stable wave sampling', () => {
  it('filters secret creatures and hidden support layers before ocean rendering', () => {
    const scene = createOceanDocument(); scene.props['ocean-serpent'].visibility = 'gm'; mask(scene)
    const gm = projectScene(scene, 'gm'), player = projectScene(scene, 'player')
    expect(gm.props.some(prop => prop.id === 'ocean-serpent')).toBe(true)
    expect(player.props.some(prop => prop.id === 'ocean-serpent')).toBe(false)
    expect(player.terrain.find(area => area.id === 'ocean-open-water')?.waterSurface).toEqual(scene.terrainAreas['ocean-open-water'].waterSurface)
    const hidden = projectEditorScene(scene, { floorId: 'collection-floor', hiddenLayerIds: new Set(['collection-structure']) })
    expect(hidden.props).toHaveLength(0)
    expect(hidden.terrain).toHaveLength(0)
    const boat = propPresentationEnvelope(gm, gm.props.find(prop => prop.id === 'ocean-cutter')!)
    expect(boat.contact).toBe('none'); expect(boat.dependencies).toContain('ocean-open-water')
  })
  it('never discloses public fish supported by a private water area', () => {
    const scene = createOceanDocument(); scene.terrainAreas['ocean-shallows'].visibility = 'gm'
    expect(() => projectScene(scene, 'player')).toThrow(/固定遮罩/)
    mask(scene)
    const player = projectScene(scene, 'player')
    expect(player.props.some(prop => ['ocean-school', 'ocean-manta'].includes(prop.id))).toBe(false)
    expect(player.terrain.some(area => area.id === 'ocean-shallows')).toBe(false)
  })
  it('keeps ocean and dry maps at the same coordinates on independent Floors and rejects cross-Floor water support', () => {
    const scene = applyCommands(createOceanDocument(), [{ type: 'createFloor', id: 'upper-deck', name: '独立甲板',
      boundsMm: { x: 0, y: 0, width: 40000, height: 30000 }, outputBoundsMm: { x: 0, y: 0, width: 40000, height: 30000 },
      newLayerId: 'deck-layer', layerName: '甲板' }], context)
    const deck = projectScene(scene, 'gm', undefined, { floorId: 'upper-deck' })
    expect(deck.terrain).toHaveLength(0); expect(deck.props).toHaveLength(0)
    expect(projectScene(scene, 'gm', undefined, { floorId: 'collection-floor' }).props).toHaveLength(8)
    const invalid = cloneJson(scene); invalid.props['ocean-shark'].floorId = 'upper-deck'; invalid.entityLayers['ocean-shark'] = 'deck-layer'
    expect(validateSceneDocument(invalid).ok).toBe(false)
  })
  it('anchors seed and strokes to world coordinates independently of viewport cropping', () => {
    const scene = createOceanDocument(), area = scene.terrainAreas['ocean-open-water'], water = area.waterSurface!, points = area.boundaryMm.map(point => point.positionMm)
    const all = oceanWaves(points, water), crop = oceanWaves(points, water, { x: 10000, y: 10000, width: 10000, height: 10000 })
    expect(all.length).toBeGreaterThan(100); expect(crop.length).toBeLessThan(all.length)
    for (const wave of crop) expect(all).toContainEqual(wave)
    expect(oceanWaves(points, water)).toEqual(all)
    expect(oceanWaves(points, { ...water, seed: 'different' })).not.toEqual(all)
    expect(waveGrid(points, water).cells).toBeLessThan(4096)
  })
})
