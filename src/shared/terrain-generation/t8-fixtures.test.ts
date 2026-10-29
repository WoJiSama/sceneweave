import { getLegacyGeneration } from './composition-contracts.js'
import { describe, expect, it } from 'vitest'
import { createT8SampleDocument, T8_SAMPLE_KINDS, T8_SAMPLE_SPECS } from '../../../tools/testing/terrain-t8-fixtures.js'
import { validateSceneDocument } from '../validation/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { terrainPoints, polygonsOverlap, polygonDistance, supportedPolygon, propFootprint } from '../geometry/geometry.js'
import { terrainCommandCost } from './cost.js'
import { emptyVisualSystem } from '../visual/types.js'

describe('T8 explicit-coordinate reference fixtures', () => {
  it.each(T8_SAMPLE_KINDS)('%s keeps the same physical scene with and without bounded effects', kind => {
    const neutral = createT8SampleDocument(kind, 'neutral'), effect = createT8SampleDocument(kind, 'effect')
    expect(validateSceneDocument(neutral).ok).toBe(true)
    expect(validateSceneDocument(effect).ok).toBe(true)
    expect(canonicalJson(createT8SampleDocument(kind, 'effect'))).toBe(canonicalJson(effect))
    for (const key of ['terrainAreas', 'terrainConnections', 'paths', 'props', 'materials', 'assets', 'entityLayers'] as const) expect(neutral[key]).toEqual(effect[key])
    expect(effect).toMatchObject({ schemaVersion: 3, mapMode: 'scene', visual: { version: 2 }, regional: null })
    const blank = cloneJson(effect)
    blank.terrainAreas = {}; blank.terrainConnections = {}; blank.props = {}; blank.entityLayers = {}; blank.visual = { version: 2, base: emptyVisualSystem(), materializedEdges: {} }
    expect(terrainCommandCost(blank, effect).total).toBeLessThanOrEqual(256)
    for (const prop of Object.values(effect.props)) {
      expect(supportedPolygon(effect, propFootprint(prop), prop.supportRef, prop.floorId)).toBe(true)
      expect(prop.footprintMm).toEqual(effect.propDefinitions[prop.definitionRef!.id].defaultFootprintMm)
    }
  })
  it('has three disjoint physical islands, measurable water separation and no fake generation provenance', () => {
    const document = createT8SampleDocument('archipelago-coast')
    const land = Object.values(document.terrainAreas).filter(area => !area.blocksMovement)
    expect(land).toHaveLength(T8_SAMPLE_SPECS['archipelago-coast'].landComponents)
    for (let i = 0; i < land.length; i++) for (let j = i + 1; j < land.length; j++) {
      expect(polygonsOverlap(terrainPoints(land[i]), terrainPoints(land[j]))).toBe(false)
      expect(polygonDistance(terrainPoints(land[i]), terrainPoints(land[j]))).toBeGreaterThanOrEqual(4000)
    }
    expect(getLegacyGeneration(document)?.rules).toEqual({})
    expect(getLegacyGeneration(document)?.recipes).toEqual({})
  })
  it('keeps actual river obstruction and a physical highland ramp', () => {
    const river = createT8SampleDocument('forest-valley')
    expect(river.terrainAreas['t8-river']).toMatchObject({ blocksMovement: true, groundElevationMm: 0 })
    const hill = createT8SampleDocument('grass-rock-hills')
    expect(hill.terrainAreas['t8-highland'].groundElevationMm - hill.terrainAreas['t8-ground'].groundElevationMm).toBe(1800)
    expect(hill.terrainConnections['t8-highland-ramp']).toMatchObject({ kind: 'ramp', widthMm: 1600, blocksMovement: false })
  })
  it('rejects unknown sample and mode instead of silently falling back', () => {
    expect(() => createT8SampleDocument('unknown' as never)).toThrow('Unknown T8 sample kind')
    expect(() => createT8SampleDocument('forest-valley', 'unknown' as never)).toThrow('Unknown T8 sample mode')
  })
})
