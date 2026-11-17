import { describe, expect, it, vi } from 'vitest'
import { createNearshoreBattleDocument } from './nearshore-battle.js'
import { createShipInteriorDocument, SHIP_FLOORS } from './ship-interior.js'
import { createOpenOceanDocument } from './open-ocean.js'
import { createShoreBlankDocument } from './shore-blank.js'
import { generateTerrainDocumentV5, terrainPhysicalProjection } from '../../../shared/terrain-generation/surface-generation.js'
import { applyShoreSurfaceRecipe } from '../../../shared/visual/shore-surfaces.js'
import { visualBase } from '../../../shared/visual/base.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { propFootprint, polygonInside, polygonsOverlap, supportedPolygon } from '../../../shared/geometry/geometry.js'

vi.mock('../runtime.js', () => ({ runtime: { ids: { nextId: () => 'ocean-finalization-unit' }, clock: { now: () => '2026-11-17T00:00:00.000Z' } }, validation: {} }))
const picture = (prop: ReturnType<typeof createOpenOceanDocument>['props'][string]) => {
  const b = prop.visualBoundsMm
  return propFootprint({ ...prop, footprintMm: { width: b.width, height: b.height }, footprintOffsetMm: { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
}
describe('shared coast authoring and complete marine encounter content', () => {
  it('authors natural shallow/land contours with actual persisted samples and common feather', () => {
    const scene = createNearshoreBattleDocument(), visual = visualBase(scene)!
    expect(validateSceneDocument(scene).ok).toBe(true)
    const shallow = visual.boundaries['battle-shallow-transition']
    expect(shallow.binding.kind).toBe('terrain')
    expect(shallow.segments.some(segment => segment.start.x !== segment.control1.x && segment.start.y !== segment.control1.y)).toBe(true)
    expect(sampleVisualBoundary(shallow).points.length).toBeGreaterThan(20)
    expect(scene.terrainAreas['ocean-shallows'].boundaryBlendMm).toBe(1100)
    expect(Object.values(scene.terrainAreas).some(area => area.surfaceStyle?.overlays.length)).toBe(true)
  })
  it('keeps the new shore profile deterministic, physically identical and separate from frozen legacy output', () => {
    const base = createShoreBlankDocument('coast', { sceneId: 'natural-shore', title: 'Natural shore', widthMm: 36000, heightMm: 24000, preset: 'narrative' })
    const raw = generateTerrainDocumentV5(base, { sceneId: base.sceneId, kind: 'coast', widthMm: 36000, heightMm: 24000,
      seed: 'terrain-v1-0', algorithmVersion: 5, quality: 'standard', budgetProfileId: 'standard' }).document
    for (const area of Object.values(raw.terrainAreas)) if (area.surfaceStyle) area.surfaceStyle.overlays = []
    const before = structuredClone(raw), old = applyShoreSurfaceRecipe(raw, 'authored-shore2'), natural = applyShoreSurfaceRecipe(raw, 'authored-shore2', { shoreProfile: 'natural2' })
    expect(raw).toEqual(before)
    expect(natural).toEqual(applyShoreSurfaceRecipe(raw, 'authored-shore2', { shoreProfile: 'natural2' }))
    expect(terrainPhysicalProjection(natural)).toEqual(terrainPhysicalProjection(old))
    expect(natural.terrainAreas['terrain-water'].surfaceStyle!.overlays).not.toEqual(old.terrainAreas['terrain-water'].surfaceStyle!.overlays)
  })
  it('fits every whole rotated giant, creature and boat at its fixed original size without intersections', () => {
    const scene = createOpenOceanDocument(), props = Object.values(scene.props), water = scene.terrainAreas['ocean-open-water']
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(props).toHaveLength(8)
    for (const [index, prop] of props.entries()) {
      const definition = scene.propDefinitions[prop.definitionRef!.id]
      expect(prop.visualBoundsMm).toEqual(definition.defaultVisualBoundsMm)
      expect(polygonInside(picture(prop), water.boundaryMm.map(point => point.positionMm))).toBe(true)
      expect(supportedPolygon(scene, picture(prop), prop.supportRef, prop.floorId)).toBe(true)
      for (const other of props.slice(index + 1)) expect(polygonsOverlap(picture(prop), picture(other))).toBe(false)
    }
    expect(scene.props['ocean-kraken'].visualBoundsMm.width).toBe(6500)
    expect(scene.props['ocean-serpent'].visualBoundsMm.height).toBe(7000)
  })
  it('keeps the ship ordinary, individually editable and independently projected on all Floors', () => {
    const scene = createShipInteriorDocument()
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(Object.keys(scene.props).length).toBeGreaterThan(55)
    for (const floor of SHIP_FLOORS) {
      const projected = projectScene(scene, 'player', undefined, { floorId: floor.id })
      expect(projected.props.every(prop => prop.floorId === floor.id)).toBe(true)
      expect(projected.props.length).toBeGreaterThan(8)
    }
    expect(scene.props['ship-deck-mast'].supportRef).toEqual({ kind: 'terrainArea', id: 'collection-floor-hull-surface' })
    expect(scene.floors['collection-floor'].links?.[0].fromMm).toEqual(scene.floors['collection-floor'].links?.[0].toMm)
  })
})
