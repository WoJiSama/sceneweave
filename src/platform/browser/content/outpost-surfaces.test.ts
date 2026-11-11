import { describe, expect, it } from 'vitest'
import { polygonInside, terrainPoints } from '../../../shared/geometry/geometry.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { createThemePackSampleDocument } from './theme-pack-catalog.js'
import { applyOutpostSurfaceTransitions } from './outpost-surfaces.js'

const prefix = 'outpost-transition-'
function fixture(): SceneDocument {
  const scene = createThemePackSampleDocument('wilderness', 0)
  // The provider integrates this construction step. Remove just its generated
  // records to inspect its effect on the remaining complete sample.
  const style = scene.terrainAreas['sample-ground'].surfaceStyle!
  style.overlays = style.overlays.filter(overlay => !overlay.id.startsWith(prefix))
  return scene
}

describe('saved outpost road and camp surface transitions', () => {
  it('changes only ground appearance while keeping the full physical and fixed-resource semantics', () => {
    const scene = fixture(), before = structuredClone(scene)
    applyOutpostSurfaceTransitions(scene)
    const physical = structuredClone(scene)
    physical.terrainAreas['sample-ground'].surfaceStyle = before.terrainAreas['sample-ground'].surfaceStyle
    expect(physical).toEqual(before)
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(scene.terrainAreas['sample-ground'].surfaceStyle!.overlays.slice(0, before.terrainAreas['sample-ground'].surfaceStyle!.overlays.length))
      .toEqual(before.terrainAreas['sample-ground'].surfaceStyle!.overlays)
  })

  it('persists deterministic integer contours, unequal world-size shoulders and world-aligned camp paint', () => {
    const scene = fixture(), second = fixture()
    applyOutpostSurfaceTransitions(scene); applyOutpostSurfaceTransitions(second)
    expect(canonicalJson(scene)).toBe(canonicalJson(second))
    const ground = scene.terrainAreas['sample-ground']
    const overlays = ground.surfaceStyle!.overlays.filter(overlay => overlay.id.startsWith(prefix))
    expect(overlays.length).toBeGreaterThan(Object.keys(scene.paths).length)
    expect(new Set(overlays.map(overlay => overlay.blendWidthMm)).size).toBeGreaterThan(2)
    for (const overlay of overlays) {
      expect(polygonInside(overlay.boundaryMm, terrainPoints(ground))).toBe(true)
      expect(overlay.boundaryMm.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
      expect(overlay.paint).toMatchObject({ materialRef: { id: 'theme-pack-wilderness-material-forest-loam-v2', version: 2 },
        alignment: 'world', originMm: { x: 0, y: 0 }, opacity: 1 })
    }
    for (const id of ['sample-camp', 'sample-abandoned-camp']) {
      const paint = scene.terrainAreas[id].surfaceStyle!.base
      expect(overlays.find(overlay => overlay.id === `${prefix}${id}`)!.paint).toEqual(paint)
    }
    const restored = JSON.parse(JSON.stringify(scene)) as SceneDocument
    expect(validateSceneDocument(restored).ok).toBe(true)
    expect(restored.terrainAreas['sample-ground'].surfaceStyle).toEqual(ground.surfaceStyle)
  })

  it.each(['private-road', 'locked-layer', 'different-height'] as const)('refuses %s without publishing partial coverage', kind => {
    const scene = fixture(), path = Object.values(scene.paths)[0]
    if (kind === 'private-road') path.visibility = 'gm'
    if (kind === 'locked-layer') scene.userLayers[scene.entityLayers[path.id]].editLocked = true
    if (kind === 'different-height') scene.terrainAreas['sample-camp'].groundElevationMm = 100
    const before = canonicalJson(scene)
    expect(() => applyOutpostSurfaceTransitions(scene)).toThrow('只用于新建')
    expect(canonicalJson(scene)).toBe(before)
  })

  it('preserves existing generated records and any later manual changes by refusing a second construction pass', () => {
    const scene = fixture(); applyOutpostSurfaceTransitions(scene)
    const overlay = scene.terrainAreas['sample-ground'].surfaceStyle!.overlays.find(overlay => overlay.id.startsWith(prefix))!
    overlay.paint.tint = '#CBA772'
    const before = canonicalJson(scene)
    expect(() => applyOutpostSurfaceTransitions(scene)).toThrow('不覆盖已有外观或人工修改')
    expect(canonicalJson(scene)).toBe(before)
  })

  it('does not apply the outpost-only construction to the mountain trail', () => {
    const scene = createThemePackSampleDocument('wilderness', 1), before = canonicalJson(scene)
    expect(() => applyOutpostSurfaceTransitions(scene)).toThrow('只用于新建')
    expect(canonicalJson(scene)).toBe(before)
  })
})
