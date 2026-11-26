import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { checkCoastalTrail, COASTAL_TRAIL_IDS } from './generate.js'
import { generateTerrainDocumentV10, generateTerrainDocumentV11, generateTerrainDocumentV12, generateTerrainDocumentV13, terrainGenerationResultV12Schema } from './coastal-generation.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { requiredBaseMapSelector } from '../ai/protocol.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { defaultTerrainAlgorithmVersion, executeBaseMapRequestV3, parseBaseMapResponseV3, prepareBaseMapRequestV3 } from './base-map-v3.js'
import { runNaturalGeneration } from '../generation/natural-adapter.js'
import { pointInPolygon, polygonDistance, polygonInside, polygonsOverlap, propFootprint, pathPolygon, terrainPoints, transformBounds } from '../geometry/geometry.js'
import { visualBase } from '../visual/base.js'
import { reliefBounds, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import { NATURAL_STONE_SHAPES, naturalStoneDefinitionId, type NaturalStoneKey } from '../visual/natural-stone-shapes.js'

describe('initial coastal ascent', () => {
  it.each([
    ['island', 'terrain-v1-0', 24000, 18000], ['coast', 'terrain-v1-0', 24000, 18000],
    ['island', 'ocean-final-1', 36000, 20000], ['coast', 'tideline-headland-65', 48000, 36000],
    ['island', 'island-large', 120000, 90000], ['coast', 'coast-large', 120000, 90000],
    ['coast', 'ocean-final-2', 36000, 20000], ['coast', 'harbour-grass', 36000, 36000, 'detailed'],
    ['island', 'bedrock-bay', 36000, 36000, 'detailed'], ['island', 'wind-cut', 32000, 18000],
    ['coast', 'wind-cut', 24000, 18000], ['island', 'reef-rim', 90000, 90000, 'detailed'],
    ['island', 'blind-5', 32400, 18000], ['coast', 'blind-6', 24000, 18000, 'detailed'],
    ['island', 'blind-11', 24000, 24000], ['coast', 'blind-12', 32400, 18000, 'detailed'],
  ] as const)('builds a connected route over real terrain in %s / %s', (kind, seed, widthMm, heightMm, quality: 'standard' | 'detailed' = 'standard') => {
    const sceneId = `coastal-generation-${seed}`
    const input = { kind, seed, widthMm, heightMm, sceneId, quality, budgetProfileId: 'standard', algorithmVersion: 12 }
    const base = createShoreBlankDocument(kind, { sceneId, widthMm, heightMm, title: '登高路线', preset: 'narrative', now: '2026-11-24T00:00:00.000Z' }, false, false, 'naturalStone')
    const { document } = terrainGenerationResultV12Schema.parse(generateTerrainDocumentV12(base, input))
    expect(checkCoastalTrail(document).connectionIds).toEqual(['terrain-stairs', 'terrain-summit-stairs'])
    expect(document.terrainAreas['terrain-high'].relief?.offsetsMm.some(offset => offset > 100)).toBe(true)
    const trails = COASTAL_TRAIL_IDS.map(id => document.paths[id])
    expect(Object.values(document.props).length).toBeGreaterThanOrEqual(4)
    expect(Object.values(document.terrainConnections).every(row => row.route?.renderProfile === 'naturalRockSteps9')).toBe(true)
    expect(trails[0].centerlineMm[0].y - trails[2].centerlineMm.at(-1)!.y).toBeGreaterThan(heightMm * .38)
    for (const trail of trails) {
      const support = document.terrainAreas[trail.supportRefs[0].id]
      expect(support.surfaceStyle?.overlays.find(overlay => overlay.id === `${trail.id}-grass`)?.paint.materialRef.id).toBe(SHORE_MATERIAL_IDS.grass)
    }
  }, 30000)
  it.each([10, 11, 12, 13])('selects and replays the complete v%s candidate across a base-map transport', version => {
    const sceneId = 'coastal-ascent-transport', widthMm = 24000, heightMm = 18000
    const base = createShoreBlankDocument('island', { sceneId, widthMm, heightMm, title: '登高路线', preset: 'narrative', now: '2026-11-24T00:00:00.000Z' }, false, false,
      version >= 12 ? 'naturalStone' : false)
    const input = { kind: 'island' as const, seed: 'terrain-v1-0', widthMm, heightMm, sceneId, quality: 'standard',
      budgetProfileId: 'standard', algorithmVersion: version === 13 ? defaultTerrainAlgorithmVersion('island') : version }
    const request = prepareBaseMapRequestV3({ base, profile: taskBudgetProfile('standard'), generation: { kind: 'terrain', input },
      requestId: 'first-ascent', flowId: 'ascent', workspaceSceneId: 'blank', checkpoint: 0, operationEpoch: 1 })
    expect(requiredBaseMapSelector(request.generation)).toEqual(`terrain-scene-v${version}`)
    const response = executeBaseMapRequestV3(request)
    expect(runNaturalGeneration(request, { nowMilliseconds: () => 0 }).response.resultHash).toEqual(response.resultHash)
    expect(parseBaseMapResponseV3(request, JSON.parse(JSON.stringify(response))).resultHash).toEqual(response.resultHash)
  })
  it.each([['coast', 'harbour-grass', 36000, 20000], ['coast', 'tideline-headland-65', 48000, 36000], ['island', 'terrain-v1-0', 24000, 18000]] as const)(
    'creates both cuts and slopes along the approaches of %s / %s', (kind, seed, widthMm, heightMm) => {
      const sceneId = `eroded-${seed}`
      const base = createShoreBlankDocument(kind, { sceneId, widthMm, heightMm, title: '风化山路', preset: 'narrative', now: '2026-11-25T00:00:00.000Z' }, false, false, 'naturalStone')
      const input = { kind, seed, widthMm, heightMm, sceneId, quality: 'standard', budgetProfileId: 'standard', algorithmVersion: 13 }
      const { document } = generateTerrainDocumentV13(base, input)
      const bench = document.terrainAreas['terrain-bench'], low = document.terrainAreas['terrain-low']
      const outline = terrainPoints(bench), bounds = reliefBounds(outline), rise = bench.groundElevationMm - low.groundElevationMm
      const shore = terrainPoints(low), lowBounds = reliefBounds(shore)
      const lowHeight = (point: typeof shore[number]) => sampleTerrainRelief(low.relief!, lowBounds, point).offsetMm
      expect(Math.max(...low.relief!.offsetsMm)).toBeGreaterThan(200)
      expect(shore.every(point => lowHeight(point) === 0)).toBe(true)
      expect(document.paths[COASTAL_TRAIL_IDS[0]].centerlineMm.every(point => lowHeight(point) === 0)).toBe(true)
      const drops = outline.map(p => rise + sampleTerrainRelief(bench.relief!, bounds, p).offsetMm)
      expect(drops.filter(height => height < rise * .55).length).toBeGreaterThan(2)
      expect(drops.filter(height => height > rise * .87).length).toBeGreaterThan(2)
      for (const stair of Object.values(document.terrainConnections)) {
        expect(stair.route?.renderProfile).toBe('naturalRockSteps10')
        expect(stair.route?.segments).toHaveLength(2)
      }
      expect(Object.values(visualBase(document)!.edgeLooks).find(look => look.boundaryId === 'terrain-bench-curve' && look.kind === 'cliff')?.renderProfile).toBe('rockRelief12')
      expect(checkCoastalTrail(document).connectionIds).toEqual(['terrain-stairs', 'terrain-summit-stairs'])
    })
  it('keeps the sandy coastline and places only supported, appropriately sized dry-land or strand dressing', () => {
    const sceneId = 'coastal-dressing', kind = 'coast', seed = 'tideline-headland-65', widthMm = 48000, heightMm = 36000
    const options = { sceneId, widthMm, heightMm, title: '登高路线', preset: 'narrative' as const, now: '2026-11-24T00:00:00.000Z' }
    const input = { sceneId, kind, seed, widthMm, heightMm, budgetProfileId: 'standard', quality: 'standard' }
    const old = generateTerrainDocumentV10(createShoreBlankDocument(kind, options), { ...input, algorithmVersion: 10 }).document
    const next = generateTerrainDocumentV11(createShoreBlankDocument(kind, options, false, false, true), { ...input, algorithmVersion: 11 }).document
    expect(next.terrainAreas['terrain-water']).toEqual(old.terrainAreas['terrain-water'])
    expect(next.terrainAreas['terrain-low'].boundaryMm).toEqual(old.terrainAreas['terrain-low'].boundaryMm)
    expect(visualBase(next)!.edgeLooks['terrain-coast-curve-shore']).toEqual(visualBase(old)!.edgeLooks['terrain-coast-curve-shore'])
    expect(visualBase(next)!.edgeLooks['terrain-high-curve-cliff'].renderProfile).toBe('rockRelief11')
    expect(Object.values(old.terrainConnections).every(row => row.route?.renderProfile === 'naturalRockSteps8')).toBe(true)
    const inland = next.terrainAreas['terrain-low'].surfaceStyle!.overlays.find(row => row.id === 'terrain-coast-inland-cover')!.boundaryMm
    const paths = Object.values(next.paths).map(pathPolygon)
    let foundBeach = false, foundDry = false
    for (const prop of Object.values(next.props)) {
      const key = prop.definitionRef!.id, footprint = propFootprint(prop)
      expect(prop.visualBoundsMm.width).toBeLessThanOrEqual(next.propDefinitions[key].defaultVisualBoundsMm.width * 1.29)
      expect(paths.every(path => polygonDistance(path, transformBounds(prop.visualBoundsMm, prop.positionMm, prop.rotationDeg)) >= 125)).toBe(true)
      if (key.startsWith('refined-prop-coast-')) {
        foundBeach = true
        expect(key).toMatch(/-(pebbles|driftwood|wrack)$/)
        expect(polygonsOverlap(footprint, inland)).toBe(false)
      } else {
        foundDry = true
        expect(key).toMatch(/-coastal-(shrub-|debris-scree)/)
        if (prop.supportRef.id === 'terrain-low') expect(polygonInside(footprint, inland)).toBe(true)
      }
    }
    expect(foundBeach && foundDry).toBe(true)
  })
  it('keeps real trails, uses the same stone family on sand and scree, and leaves the previous rock recipe replayable', () => {
    const sceneId = 'coastal-stone-closure', kind = 'coast', seed = 'tideline-headland-65', widthMm = 48000, heightMm = 36000
    const options = { sceneId, widthMm, heightMm, title: '自然石头', preset: 'narrative' as const, now: '2026-11-25T00:00:00.000Z' }
    const input = { sceneId, kind, seed, widthMm, heightMm, budgetProfileId: 'standard', quality: 'standard' }
    const earlier = generateTerrainDocumentV11(createShoreBlankDocument(kind, options, false, false, true), { ...input, algorithmVersion: 11 }).document
    const next = generateTerrainDocumentV12(createShoreBlankDocument(kind, options, false, false, 'naturalStone'), { ...input, algorithmVersion: 12 }).document
    expect(next.paths).toEqual(earlier.paths)
    expect(next.terrainConnections).toEqual(earlier.terrainConnections)
    expect(next.terrainAreas['terrain-water']).toEqual(earlier.terrainAreas['terrain-water'])
    expect(Object.values(earlier.props).some(prop => prop.definitionRef?.id.includes('debris-scree'))).toBe(true)
    const inland = next.terrainAreas['terrain-low'].surfaceStyle!.overlays.find(row => row.id === 'terrain-coast-inland-cover')!.boundaryMm
    const reviewed = new Map((Object.keys(NATURAL_STONE_SHAPES) as NaturalStoneKey[]).map(key => [naturalStoneDefinitionId(key), NATURAL_STONE_SHAPES[key]]))
    const used = new Set<string>(), contexts = new Set<string>(), trail = Object.values(next.paths).map(pathPolygon)
    for (const prop of Object.values(next.props)) {
      const id = prop.definitionRef!.id, stone = reviewed.get(id)
      expect(id).not.toMatch(/debris-scree|scree-sedge|reef-|pebbles|wrack/)
      if (!stone) continue
      used.add(id); contexts.add(stone.setting)
      expect(prop.visualBoundsMm.width).toBeLessThanOrEqual(Math.round(stone.sizeMm[0] * 1.08))
      expect(prop.blocksMovement || prop.blocksSight).toBe(false)
      expect(trail.every(path => polygonDistance(path, propFootprint(prop)) >= 125)).toBe(true)
      if (stone.setting === 'strand') {
        expect(prop.supportRef.id).toBe('terrain-low')
        expect(pointInPolygon(prop.positionMm, inland)).toBe(false)
      } else if (prop.supportRef.id === 'terrain-low') expect(pointInPolygon(prop.positionMm, inland)).toBe(true)
    }
    expect(used.size).toBeGreaterThanOrEqual(3)
    expect(contexts).toEqual(new Set(['strand', 'scree']))
  })
  it('builds separate, shallow relief on weathered island reefs with the real water and passage intact', () => {
    const kind = 'island', sceneId = 'island-stone', widthMm = 24000, heightMm = 18000
    const base = createShoreBlankDocument(kind, { sceneId, widthMm, heightMm, title: '自然石头', preset: 'narrative', now: '2026-11-25T00:00:00.000Z' }, false, false, 'naturalStone')
    const { document } = generateTerrainDocumentV12(base, { kind, sceneId, widthMm, heightMm, seed: 'terrain-v1-0', quality: 'standard', budgetProfileId: 'standard', algorithmVersion: 12 })
    const reefs = Object.values(document.terrainAreas).filter(area => area.id.startsWith('terrain-reef-'))
    expect(reefs).toHaveLength(5)
    for (const [index, reef] of reefs.entries()) {
      const outline = terrainPoints(reef), water = document.terrainAreas['terrain-water']
      expect(outline.length).toBeGreaterThan(8)
      expect(polygonDistance(outline, terrainPoints(document.terrainAreas['terrain-low']))).toBeGreaterThan(0)
      expect(reefs.slice(0, index).every(other => polygonDistance(outline, terrainPoints(other)) > 0)).toBe(true)
      expect(reef.groundElevationMm + Math.min(...reef.relief!.offsetsMm)).toBeGreaterThan(water.groundElevationMm)
      const edge = Object.values(visualBase(document)!.boundaries).find(boundary => boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => side.areaId === reef.id))!
      expect(Object.values(visualBase(document)!.edgeLooks).find(look => look.boundaryId === edge.id && look.kind === 'cliff')?.renderProfile).toBe('rockRelief11')
    }
    expect(checkCoastalTrail(document).ok).toBe(true)
  })
})
