import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../model/scene.js'
import { visualBase } from '../visual/base.js'
import { emptyVisualSystem } from '../visual/types.js'
import { connectionFootprint } from '../geometry/geometry.js'
import { refineTerrainVisualV7, terrainVisualPhysicalFingerprint } from './v7-visual-helper.js'

function fixture(version: 6 | 7): SceneDocument {
  const visual = emptyVisualSystem()
  visual.edgeLooks.cliff = { id: 'terrain-high-curve-cliff', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
    boundaryId: 'terrain-high-curve', kind: 'cliff', side: 'right', widthMm: 700, color: '#91816A', accentColor: '#D8C7A5', opacity: .82,
    intensity: .85, seed: 'v7-cliff', repeatMm: 320, enabled: true }
  visual.edgeLooks.grass = { ...visual.edgeLooks.cliff, id: 'terrain-high-curve-grass', boundaryId: 'terrain-high-curve', kind: 'grass', widthMm: 380, opacity: .82 }
  const recipe = { id: 'recipe', recipeVersion: version, algorithmId: 'terrain-scene' as const, algorithmVersion: version,
    mapMode: 'scene' as const, seed: 'fixed', parameters: { terrainKind: 'island' } }
  const rule = { id: 'rule', kind: 'terrain' as const, state: 'active' as const, visibility: 'public' as const, recipeRef: { id: 'recipe', version }, outputs: [] }
  const scene = { schemaVersion: 1, exportBoundsMm: { x: 0, y: 0, width: 24000, height: 18000 },
    floors: {}, userLayers: {}, entityLayers: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: { stairs: { id: 'stairs', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
      kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: 'low' }, positionMm: { x: 1000, y: 1000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 3000, y: 1000 } }, widthMm: 800, openingId: null,
      blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null } }, paths: {}, props: {}, regions: {}, visual,
    generation: { version: 1, recipes: { recipe }, rules: { rule } } } as unknown as SceneDocument
  return scene
}

describe('v7 target-island visual closure', () => {
  it('narrows cliff paint and softens highland grass while preserving physical fields', () => {
    const before = fixture(7), after = refineTerrainVisualV7(before)
    expect(terrainVisualPhysicalFingerprint(after)).toBe(terrainVisualPhysicalFingerprint(before))
    const looks = visualBase(after)!.edgeLooks
    expect(looks.cliff.widthMm).toBe(504)
    expect(looks.cliff.opacity).toBeCloseTo(.738)
    expect(looks.grass.widthMm).toBe(520)
    expect(looks.grass.opacity).toBeCloseTo(.6724)
  })

  it('keeps v6 replay and non-island results outside the new helper', () => {
    expect(() => refineTerrainVisualV7(fixture(6))).toThrow(/视觉v7/)
    const coast = fixture(7)
    ;(coast.generation as any).recipes.recipe.parameters.terrainKind = 'coast'
    expect(() => refineTerrainVisualV7(coast)).toThrow(/视觉v7/)
  })

  it('allocates a deterministic route identity that avoids existing geometry IDs', () => {
    const before = fixture(7), connection = before.terrainConnections.stairs
    visualBase(before)!.edgeLooks.collision = { ...visualBase(before)!.edgeLooks.cliff!, id: `${connection.id}-terrain-route-v7` }
    const first = refineTerrainVisualV7(before), second = refineTerrainVisualV7(before)
    const route = first.terrainConnections.stairs.route!
    expect(route.segments[0]!.id).toBe(`${connection.id}-terrain-route-v7-1`)
    expect(route.segments[0]!.id).toBe(second.terrainConnections.stairs.route!.segments[0]!.id)
    const footprint = (value: typeof connection) => connectionFootprint(value).map(point => `${point.x}:${point.y}`).sort()
    expect(footprint(first.terrainConnections.stairs)).toEqual(footprint(connection))
  })
})
