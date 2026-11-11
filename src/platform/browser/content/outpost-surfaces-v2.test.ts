import { describe, expect, it } from 'vitest'
import { polygonInside, terrainPoints } from '../../../shared/geometry/geometry.js'
import { checkTerrainRoute } from '../../../shared/geometry/terrain-travel.js'
import { resolveBuildingEntrancePort } from '../../../shared/generation/building-port.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { MANUAL_TRANSACTION_BUDGET, assertCommandBudget, measureCommandBudget } from '../../../shared/budget/command-budget.js'
import { createThemePackSampleDocument } from './theme-pack-catalog.js'
import { applyOutpostSurfaceTransitionsV2, OUTPOST_SURFACE_V2_PREFIX } from './outpost-surfaces-v2.js'

const originalPrefix = 'outpost-transition-'
const fixture = () => createThemePackSampleDocument('wilderness', 0)
const transitions = (scene: ReturnType<typeof fixture>) => scene.terrainAreas['sample-ground'].surfaceStyle!.overlays.filter(overlay => overlay.id.startsWith(originalPrefix))

describe('second saved outpost surface recipe', () => {
  it.each(['sparse', 'balanced', 'dense'] as const)('preserves all fixed/physical and managed member fields for %s while returning detached valid paint', density => {
    const source = createThemePackSampleDocument('wilderness', 0, { outpostVegetation: density }), before = structuredClone(source)
    const result = applyOutpostSurfaceTransitionsV2(source), physical = structuredClone(result)
    physical.terrainAreas['sample-ground'].surfaceStyle = before.terrainAreas['sample-ground'].surfaceStyle
    expect(physical).toEqual(before); expect(source).toEqual(before)
    expect(result).not.toBe(source); expect(result.terrainAreas['sample-ground']).not.toBe(source.terrainAreas['sample-ground'])
    expect(validateSceneDocument(result).ok).toBe(true)
    expect(result.terrainAreas['sample-ground'].surfaceStyle!.overlays.filter(overlay => !overlay.id.startsWith(originalPrefix)))
      .toEqual(source.terrainAreas['sample-ground'].surfaceStyle!.overlays.filter(overlay => !overlay.id.startsWith(originalPrefix)))
  })

  it('saves deterministic integer rings with curved end caps, distinct blending and unchanged complete world paint', () => {
    const source = fixture(), first = applyOutpostSurfaceTransitionsV2(source), second = applyOutpostSurfaceTransitionsV2(source)
    expect(canonicalJson(first)).toBe(canonicalJson(second))
    const paint = transitions(source)[0].paint, ground = first.terrainAreas['sample-ground'], overlays = transitions(first)
    expect(overlays).toHaveLength(8)
    expect(overlays.every(overlay => overlay.id.startsWith(OUTPOST_SURFACE_V2_PREFIX))).toBe(true)
    expect(new Set(overlays.map(overlay => overlay.blendWidthMm)).size).toBeGreaterThan(4)
    for (const overlay of overlays) {
      expect(overlay.paint).toEqual(paint)
      expect(polygonInside(overlay.boundaryMm, terrainPoints(ground))).toBe(true)
      expect(overlay.boundaryMm.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
      expect(new Set(overlay.boundaryMm.map(point => `${point.x}/${point.y}`)).size).toBe(overlay.boundaryMm.length)
    }
    for (const id of ['theme-sample-path-1', 'theme-sample-path-2', 'sample-camp', 'sample-abandoned-camp']) {
      const old = transitions(source).find(overlay => overlay.id === `${originalPrefix}${id}`)!, next = overlays.find(overlay => overlay.id === `${OUTPOST_SURFACE_V2_PREFIX}${id}`)!
      expect(next.boundaryMm).not.toEqual(old.boundaryMm)
    }
    const oldStart = source.paths['theme-sample-path-1'].centerlineMm[0]
    const cap = overlays.find(overlay => overlay.id === `${OUTPOST_SURFACE_V2_PREFIX}theme-sample-path-1`)!.boundaryMm
    // The new appearance actually reaches behind the physical start in a
    // rounded silhouette, rather than keeping the old short straight cap.
    expect(cap.some(point => point.y > oldStart.y + 900)).toBe(true)
    expect(JSON.parse(canonicalJson(first)).terrainAreas['sample-ground'].surfaceStyle).toEqual(ground.surfaceStyle)
  })

  it('keeps actual door/road support and full-width routes exactly as before', () => {
    const source = fixture(), result = applyOutpostSurfaceTransitionsV2(source)
    expect(resolveBuildingEntrancePort(result, 'watch-entrance', 1400)).toEqual(resolveBuildingEntrancePort(source, 'watch-entrance', 1400))
    for (const road of Object.values(source.paths)) {
      const request = { floorId: road.floorId, pointsMm: road.centerlineMm, widthMm: road.widthMm }
      expect(checkTerrainRoute(result, request)).toEqual(checkTerrainRoute(source, request))
      expect(checkTerrainRoute(result, request).ok).toBe(true)
    }
  })

  it('creates complete appearance and overlay birth records within the real ordinary transaction budget', () => {
    const source = fixture(), result = applyOutpostSurfaceTransitionsV2(source)
    let sequence = 0
    const runtime = { ids: { nextId: () => `outpost-surface-witness-${++sequence}` }, clock: { now: () => source.updatedAt } }
    const content = createCompositionContent(result, runtime)
    for (const overlay of transitions(result)) expect(content.historyIdentity.presentationTokens![overlay.id]).toMatchObject({ kind: 'surfaceOverlay' })
    expect(content.appearance.surfaceSources['sample-ground']).toBeTruthy()
    const usage = assertCommandBudget(MANUAL_TRANSACTION_BUDGET, measureCommandBudget(source, result, undefined, { semanticTargets: 1 + transitions(source).length + transitions(result).length }))
    expect(usage.semanticTargets).toBe(15); expect(usage.semanticTargets).toBeLessThanOrEqual(256)
  })

  it.each(['tint', 'boundary', 'order', 'road', 'camp', 'camp-paint', 'ground-paint', 'revision', 'locked-ground', 'locked-prop-layer', 'private-road', 'door-lock'] as const)('refuses modified %s baselines without touching any input', change => {
    const source = fixture(), old = transitions(source)[0]
    if (change === 'tint') old.paint.tint = '#CCA377'
    if (change === 'boundary') old.boundaryMm[0].x += 30
    if (change === 'order') old.renderOrder += 1
    if (change === 'road') source.paths['theme-sample-path-1'].centerlineMm[1].x += 100
    if (change === 'camp') source.terrainAreas['sample-camp'].boundaryMm[0].positionMm.x += 30
    if (change === 'camp-paint') source.terrainAreas['sample-camp'].surfaceStyle!.base.tint = '#CCA377'
    if (change === 'ground-paint') source.terrainAreas['sample-ground'].surfaceStyle!.base.rotationDeg = 15
    if (change === 'revision') source.revision = 1
    if (change === 'locked-ground') source.terrainAreas['sample-ground'].editLocked = true
    if (change === 'locked-prop-layer') source.userLayers['theme-pack-props'].editLocked = true
    if (change === 'private-road') source.paths['theme-sample-path-1'].visibility = 'gm'
    if (change === 'door-lock') source.openings['watch-entrance'].locked = true
    const before = canonicalJson(source)
    expect(() => applyOutpostSurfaceTransitionsV2(source)).toThrow()
    expect(canonicalJson(source)).toBe(before)
  })

  it('accepts the explicit unchanged daylight construction, and refuses duplicate application or the mountain layout', () => {
    const daylight = createThemePackSampleDocument('wilderness', 0, { outpostAtmosphere: 'daylight' })
    expect(validateSceneDocument(applyOutpostSurfaceTransitionsV2(daylight)).ok).toBe(true)
    const first = applyOutpostSurfaceTransitionsV2(fixture()), before = canonicalJson(first)
    expect(() => applyOutpostSurfaceTransitionsV2(first)).toThrow(/编排1基线/)
    expect(canonicalJson(first)).toBe(before)
    expect(() => applyOutpostSurfaceTransitionsV2(createThemePackSampleDocument('wilderness', 1))).toThrow(/基线/)
  })

  it('preserves the whole source after a late new-overlay identity collision', () => {
    const source = fixture(), id = `${OUTPOST_SURFACE_V2_PREFIX}abandoned-approach-wear`
    source.notes[id] = { id, floorId: 'theme-pack-floor', editLocked: false, visibility: 'gm', kind: 'note', anchor: { type: 'point', positionMm: { x: 500, y: 500 } }, text: 'pre-existing note' }
    source.entityLayers[id] = 'theme-pack-props'
    expect(validateSceneDocument(source).ok).toBe(true)
    const before = canonicalJson(source)
    expect(() => applyOutpostSurfaceTransitionsV2(source)).toThrow(/身份已被占用/)
    expect(canonicalJson(source)).toBe(before)
  })
})
