import { describe, expect, it } from 'vitest'
import type { PointMm, Prop, SceneDocument } from '../../../shared/model/scene.js'
import { buildScatterRegeneration } from '../../../shared/geometry/scatter.js'
import { pathPolygon, polygonInside, polygonsOverlap, propFootprint, supportedPolygon, terrainPoints } from '../../../shared/geometry/geometry.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { createThemePackCatalogDocument, createThemePackSampleDocument } from './theme-pack-catalog.js'
import { applyOutpostVegetation, OUTPOST_VEGETATION_GROUP_IDS, type OutpostVegetationDensity } from './outpost-vegetation.js'

const rectangle = (left: number, top: number, right: number, bottom: number): PointMm[] => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
function fixture(): SceneDocument {
  const scene = createThemePackCatalogDocument('wilderness')
  for (const [id, ring, priority] of [['sample-ground', rectangle(0, 0, 36000, 28000), 0],
    ['sample-camp', rectangle(18000, 15000, 27000, 21500), 1],
    ['sample-abandoned-camp', rectangle(24000, 23000, 33000, 27000), 2]] as const) {
    scene.terrainAreas[id] = { id, floorId: 'theme-pack-floor', editLocked: false, visibility: 'public',
      boundaryMm: ring.map((positionMm, i) => ({ id: `${id}-p-${i}`, segmentId: `${id}-s-${i}`, positionMm })),
      groundElevationMm: 0, coveragePriority: priority, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.entityLayers[id] = 'theme-pack-structure'
  }
  const id = 'sample-path'
  scene.paths[id] = { id, floorId: 'theme-pack-floor', editLocked: false, visibility: 'public',
    centerlineMm: [{ x: 2500, y: 26000 }, { x: 11500, y: 20000 }, { x: 17000, y: 13000 }, { x: 32000, y: 6000 }],
    widthMm: 1800, supportRefs: [{ kind: 'terrainArea', id: 'sample-ground' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  scene.entityLayers[id] = 'theme-pack-structure'
  return scene
}
const population = (scene: SceneDocument) => OUTPOST_VEGETATION_GROUP_IDS.map(id => Object.values(scene.scatterGroups[id].members).filter(member => member.propId).length)

describe('new outpost woodland composition', () => {
  it('keeps the actual doorway, room and camp layout clear in all three sample presets', () => {
    const totals: number[] = []
    for (const density of ['sparse', 'balanced', 'dense'] as const) {
      const scene = createThemePackSampleDocument('wilderness', 0, { outpostVegetation: density })
      const counts = population(scene); totals.push(counts.reduce((sum, count) => sum + count, 0))
      const checked = validateSceneDocument(scene)
      expect(checked.ok ? [] : checked.errors).toEqual([])
      for (const id of OUTPOST_VEGETATION_GROUP_IDS) for (const member of Object.values(scene.scatterGroups[id].members)) {
        const prop = scene.props[member.propId!], footprint = propFootprint(prop)
        expect(supportedPolygon(scene, footprint, prop.supportRef, prop.floorId)).toBe(true)
        expect(Object.values(scene.paths).some(path => polygonsOverlap(footprint, pathPolygon(path)))).toBe(false)
      }
    }
    expect(totals[0]).toBeLessThan(totals[1]); expect(totals[1]).toBeLessThan(totals[2])
  })

  it('persists deterministic trees, shrubs and grass with explicit sparse, balanced and dense populations', () => {
    const results = (['sparse', 'balanced', 'dense'] as OutpostVegetationDensity[]).map(density => {
      const a = fixture(), b = fixture()
      applyOutpostVegetation(a, density); applyOutpostVegetation(b, density)
      expect(canonicalJson(a)).toBe(canonicalJson(b))
      const counts = population(a)
      expect(counts.every(count => count > 0)).toBe(true)
      expect(counts.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(180)
      for (const id of OUTPOST_VEGETATION_GROUP_IDS) {
        expect(a.scatterGroups[id].algorithmVersion).toBe('scatter-cell-v2')
        expect(a.scatterGroups[id].domain).toEqual({ kind: 'area', areaId: 'sample-ground' })
        expect(Object.values(a.scatterGroups[id].members).every(member => member.state === 'managed' && member.overrideFields.length === 0)).toBe(true)
      }
      const checked = validateSceneDocument(a)
      expect(checked.ok ? [] : checked.errors).toEqual([])
      return counts
    })
    expect(results[0].reduce((sum, count) => sum + count, 0)).toBeLessThan(results[1].reduce((sum, count) => sum + count, 0))
    expect(results[1].reduce((sum, count) => sum + count, 0)).toBeLessThan(results[2].reduce((sum, count) => sum + count, 0))
  })

  it('keeps every real footprint off full roads, camps and activity clearings on its declared support', () => {
    const scene = fixture(); applyOutpostVegetation(scene, 'dense')
    for (const id of OUTPOST_VEGETATION_GROUP_IDS) for (const member of Object.values(scene.scatterGroups[id].members)) {
      const prop = scene.props[member.propId!], footprint = propFootprint(prop)
      expect(supportedPolygon(scene, footprint, prop.supportRef, prop.floorId)).toBe(true)
      expect(polygonInside(footprint, terrainPoints(scene.terrainAreas['sample-ground']))).toBe(true)
      expect(polygonsOverlap(footprint, pathPolygon(scene.paths['sample-path']))).toBe(false)
      expect(polygonsOverlap(footprint, terrainPoints(scene.terrainAreas['sample-camp']))).toBe(false)
      expect(polygonsOverlap(footprint, terrainPoints(scene.terrainAreas['sample-abandoned-camp']))).toBe(false)
      expect(polygonsOverlap(footprint, scene.scatterGroups[id].exclusions[0].boundaryMm)).toBe(false)
    }
  })

  it('retains caller sources and existing locked props, and refuses a second creation without partial writes', () => {
    const scene = fixture(), definition = Object.values(scene.propDefinitions).find(definition => definition.catalogId.endsWith('.fallen-log'))!
    const prop: Prop = { id: 'manual-locked-log', floorId: 'theme-pack-floor', editLocked: true, visibility: 'public', definitionRef: { id: definition.id, version: definition.version },
      appearance: cloneJson(definition.defaultAppearance), positionMm: { x: 3200, y: 8500 }, rotationDeg: 31,
      visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm), footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm),
      blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight,
      renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null,
      supportRef: { kind: 'terrainArea', id: 'sample-ground' } }
    scene.props[prop.id] = prop; scene.entityLayers[prop.id] = 'theme-pack-props'
    const sources = canonicalJson({ assets: scene.assets, definitions: scene.propDefinitions, materials: scene.materials, rules: scene.surfaceRules })
    applyOutpostVegetation(scene)
    expect(scene.props[prop.id]).toEqual(prop)
    expect(canonicalJson({ assets: scene.assets, definitions: scene.propDefinitions, materials: scene.materials, rules: scene.surfaceRules })).toBe(sources)
    const before = canonicalJson(scene)
    expect(() => applyOutpostVegetation(scene, 'dense')).toThrow(/已存在/)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('leaves the source untouched when a later group cannot resolve its fixed definition', () => {
    const scene = fixture()
    for (const definition of Object.values(scene.propDefinitions).filter(definition => definition.catalogId.endsWith('.grass-tuft'))) delete scene.propDefinitions[definition.id]
    const before = canonicalJson(scene)
    expect(() => applyOutpostVegetation(scene)).toThrow(/grass-tuft/)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('rejects a reserved group identity occupied by another entity and locked support layers', () => {
    const scene = fixture(), id = OUTPOST_VEGETATION_GROUP_IDS[0]
    scene.notes[id] = { id, floorId: 'theme-pack-floor', editLocked: false, anchor: { type: 'point', positionMm: { x: 15000, y: 15000 } }, kind: 'clue', visibility: 'gm', text: 'Existing independent content' }
    scene.entityLayers[id] = 'theme-pack-props'
    const before = canonicalJson(scene)
    expect(() => applyOutpostVegetation(scene)).toThrow(/已存在/)
    expect(canonicalJson(scene)).toBe(before)
    const locked = fixture(); locked.userLayers['theme-pack-structure'].editLocked = true
    const lockedBefore = canonicalJson(locked)
    expect(() => applyOutpostVegetation(locked)).toThrow(/未锁定/)
    expect(canonicalJson(locked)).toBe(lockedBefore)
  })

  it('ordinary regeneration retains saved manual, deleted and locked members', () => {
    const scene = fixture(); applyOutpostVegetation(scene)
    const id = OUTPOST_VEGETATION_GROUP_IDS[0], group = scene.scatterGroups[id]
    const [[manualKey, manual], [deletedKey, deleted], [, locked]] = Object.entries(group.members)
    group.members[manualKey] = { ...manual, state: 'manual', overrideFields: ['rotationDeg'] }
    scene.props[manual.propId!].rotationDeg = 42
    delete scene.props[deleted.propId!]; delete scene.entityLayers[deleted.propId!]
    group.members[deletedKey] = { propId: null, state: 'deleted', overrideFields: [] }
    scene.props[locked.propId!].editLocked = true
    const before = cloneJson(scene)
    const next = buildScatterRegeneration(scene, id, 1)
    expect(next.group.members[manualKey]).toEqual(before.scatterGroups[id].members[manualKey])
    expect(next.group.members[deletedKey]).toEqual(before.scatterGroups[id].members[deletedKey])
    expect(next.props.some(prop => prop.id === deleted.propId)).toBe(false)
    expect(next.removePropIds).not.toContain(manual.propId)
    expect(next.removePropIds).not.toContain(locked.propId)
    expect(scene.props[manual.propId!]).toEqual(before.props[manual.propId!])
    expect(scene.props[locked.propId!]).toEqual(before.props[locked.propId!])
  })
})
