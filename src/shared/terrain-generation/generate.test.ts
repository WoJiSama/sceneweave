import { visualBase } from '../visual/base.js'
import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { validateSceneDocument } from '../validation/scene.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { visualCommandCost } from '../visual/commands.js'
import { sampleVisualBoundary, signedVisualArea, terrainBoundaryChain } from '../visual/geometry.js'
import { corridor, polygonDistance, propFootprint, supportedPolygon } from '../geometry/geometry.js'
import { generateTerrainDocument, TERRAIN_FIXED_SEEDS, TERRAIN_GENERATOR_VERSION, terrainGenerationInputSchema, terrainGenerationResultSchema } from './generate.js'
import { extractTerrainContours, simplifyTerrainContour, terrainHash32, terrainRandomUnit, terrainValueNoise } from './field.js'

const options = { title: '地形生成固定向量', sceneId: 'terrain-core-test', now: '2026-10-26T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' as const }
const blank = (kind: 'island' | 'coast') => createRefinedBlankDocument(kind, options)
const generate = (kind: 'island' | 'coast', seed: string) => generateTerrainDocument(blank(kind), { sceneId: options.sceneId, kind, seed })
const generateT3 = (kind: 'river' | 'lake' | 'forest' | 'hill' | 'mixed', seed = TERRAIN_FIXED_SEEDS[0]) => {
  const palette = kind === 'river' || kind === 'lake' || kind === 'forest' || kind === 'hill' || kind === 'mixed' ? 'island' : 'island'
  return generateTerrainDocument(blank(palette), { sceneId: options.sceneId, kind, seed })
}

describe('pure bounded terrain generation T0/T1', () => {
  it.each(['river', 'lake', 'forest', 'hill', 'mixed'] as const)('generates deterministic %s terrain with explicit supports and real constraints', kind => {
    const first = generateT3(kind), second = generateT3(kind)
    expect(canonicalJson(second)).toBe(canonicalJson(first))
    expect(validateSceneDocument(first.document).ok).toBe(true)
    expect(terrainGenerationResultSchema.safeParse(first).success).toBe(true)
    expect(first.document.generation).toBeUndefined()
    const expectedAreas = { hill: 2, lake: 4, forest: 3, river: 5, mixed: 6 } as const
    expect(Object.keys(first.document.terrainAreas).length).toBe(expectedAreas[kind])
    expect(Object.keys(first.document.props).length).toBeGreaterThanOrEqual(4)
    expect(first.cost.total).toBeLessThanOrEqual(256)
    expect(first.activity.supportRef.kind).toBe('terrainArea')
    expect(supportedPolygon(first.document, first.activity.boundaryMm, first.activity.supportRef, 'visual-floor')).toBe(true)
    if (kind === 'river' || kind === 'mixed') {
      expect(first.document.terrainAreas['terrain-water-north'].blocksMovement).toBe(true)
      expect(first.document.terrainAreas['terrain-shallow'].blocksMovement).toBe(false)
      expect(Object.values(first.document.terrainConnections).some(connection => connection.kind === 'ramp')).toBe(true)
    }
    if (kind === 'lake') expect(first.document.terrainAreas['terrain-lake'].blocksMovement).toBe(true)
    if (kind === 'forest' || kind === 'mixed') expect(first.document.terrainAreas['terrain-forest'].movementCostMultiplier).toBeGreaterThan(1)
  })

  it.each(['island', 'coast'] as const)('keeps all five independent %s candidates with honest expanded budgets and real stairs', kind => {
    const results = TERRAIN_FIXED_SEEDS.map(seed => generate(kind, seed))
    expect(new Set(results.map(result => result.skeleton.variant)).size).toBe(5)
    expect(new Set(results.map(result => canonicalJson(result.document.terrainAreas['terrain-low'].boundaryMm.map(point => point.positionMm)))).size).toBe(5)
    for (const result of results) {
      const { document, activity, cost } = result, stairs = document.terrainConnections['terrain-stairs']
      expect(validateSceneDocument(document).ok).toBe(true)
      expect(terrainGenerationResultSchema.safeParse(result).success).toBe(true)
      expect(document.terrainAreas['terrain-low'].groundElevationMm).toBe(800)
      expect(document.terrainAreas['terrain-high'].groundElevationMm).toBe(2600)
      expect(stairs).toMatchObject({ kind: 'stairs', widthMm: 1500, blocksMovement: false,
        from: { surfaceRef: { kind: 'terrainArea', id: 'terrain-low' } }, to: { surfaceRef: { kind: 'terrainArea', id: 'terrain-high' } } })
      expect(supportedPolygon(document, activity.boundaryMm, activity.supportRef, 'visual-floor')).toBe(true)
      expect(polygonDistance(corridor(stairs.from.positionMm, stairs.to.positionMm, stairs.widthMm), activity.boundaryMm)).toBeGreaterThanOrEqual(100)
      expect(cost.legacyTotal).toBe(visualCommandCost(blank(kind), document))
      expect(cost.terrainPoints).toBe(Object.values(document.terrainAreas).reduce((sum, area) => sum + area.boundaryMm.length, 0))
      expect(cost.terrainSegments).toBe(cost.terrainPoints)
      expect(cost.legacyTotal).toBe(cost.physicalEntities + cost.terrainPoints + cost.terrainSegments + cost.visualEntities + cost.curveSegments + cost.overlays)
      expect(cost.recommendedGenerationRecords).toBe(1 + (1 + 2) + (1 + result.managedTargets.length) + result.managedTargets.length + (1 + 4 * 2) + 1)
      expect(cost.total).toBe(cost.legacyTotal + cost.recommendedGenerationRecords)
      expect(cost.total).toBeLessThanOrEqual(256)
      expect(Object.keys(document.props).length).toBeGreaterThanOrEqual(4)
      expect(Object.keys(document.props).length).toBeLessThanOrEqual(8)
      for (const prop of Object.values(document.props)) {
        expect(polygonDistance(propFootprint(prop), activity.boundaryMm)).toBeGreaterThanOrEqual(300)
        if (prop.definitionRef!.id.includes('tree-')) expect(prop.rotationDeg).toBe(0)
      }
      expect(visualBase(document)!.environment).toEqual(visualBase(blank(kind))!.environment)
      expect(visualBase(document)!.fogs).toEqual({}); expect(visualBase(document)!.filters).toEqual({})
    }
  })

  it('owns exact shared coast samples on both physical sides rather than independent near curves', () => {
    const { document } = generate('coast', TERRAIN_FIXED_SEEDS[0]), curve = visualBase(document)!.boundaries['terrain-coast-curve']
    expect(curve.closed).toBe(false); expect(curve.binding.kind).toBe('terrain')
    if (curve.binding.kind !== 'terrain') throw new Error('test expected terrain binding')
    expect(curve.binding.sides).toHaveLength(2)
    const samples = sampleVisualBoundary(curve).points
    for (const side of curve.binding.sides) {
      const chain = terrainBoundaryChain(document.terrainAreas[side.areaId], side, false).map(point => point.positionMm)
      expect(chain).toEqual(side.reverse ? [...samples].reverse() : samples)
    }
  })

  it('uses exact sampled island and highland boundaries and positive rings', () => {
    const { document } = generate('island', TERRAIN_FIXED_SEEDS[2])
    for (const curve of Object.values(visualBase(document)!.boundaries)) {
      if (curve.binding.kind !== 'terrain') throw new Error('test expected terrain binding')
      const side = curve.binding.sides[0], area = document.terrainAreas[side.areaId]
      expect(area.boundaryMm.map(point => point.positionMm)).toEqual(sampleVisualBoundary(curve).points)
      expect(signedVisualArea(area.boundaryMm.map(point => point.positionMm))).toBeGreaterThan(0)
    }
  })

  it.each(['island', 'coast'] as const)('retains five nonround %s ridge shoulders with finer shared physical samples', kind => {
    const relativeRings = []
    for (const seed of TERRAIN_FIXED_SEEDS) {
      const result = generate(kind, seed), ring = result.document.terrainAreas['terrain-high'].boundaryMm.map(point => point.positionMm)
      const xs = ring.map(point => point.x), ys = ring.map(point => point.y), width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys)
      expect(Math.max(width, height) / Math.min(width, height)).toBeGreaterThan(1.25)
      relativeRings.push(canonicalJson(ring.map(point => ({ x: point.x - result.skeleton.plateauCenterMm.x, y: point.y - result.skeleton.plateauCenterMm.y }))))
      if (kind === 'island') expect(Math.hypot(result.skeleton.plateauCenterMm.x - 12000, result.skeleton.plateauCenterMm.y - 9000)).toBeGreaterThan(1500)
      const boundaries = visualBase(result.document)!.boundaries
      expect(boundaries['terrain-coast-curve'].sampleSpacingMm).toBe(1800)
      expect(boundaries['terrain-high-curve'].sampleSpacingMm).toBe(1600)
      for (const curve of Object.values(boundaries)) expect(curve.toleranceMm).toBe(90)
    }
    expect(new Set(relativeRings).size).toBe(5)
  })

  it('is deterministic after JSON cold read and independent of metadata, time and scene IDs', () => {
    const base = blank('island'), before = canonicalJson(base), result = generateTerrainDocument(base, { sceneId: options.sceneId, kind: 'island', seed: TERRAIN_FIXED_SEEDS[1] })
    expect(canonicalJson(generateTerrainDocument(JSON.parse(before), result.input))).toBe(canonicalJson(result))
    expect(canonicalJson(base)).toBe(before)
    expect(validateSceneDocument(JSON.parse(canonicalJson(result.document))).ok).toBe(true)
    const secondBase = cloneJson(base); secondBase.sceneId = 'another-scene'; secondBase.updatedAt = '2026-10-27T00:00:00.000Z'
    const second = generateTerrainDocument(secondBase, { ...result.input, sceneId: 'another-scene' })
    expect(second.document.terrainAreas).toEqual(result.document.terrainAreas)
    expect(second.document.props).toEqual(result.document.props)
    expect(second.document.visual).toEqual(result.document.visual)
    expect(TERRAIN_GENERATOR_VERSION).toBe('terrain-scene-v1')
  })

  it('rejects old baselines, populated scenes, locks and unknown input without mutating the branch', () => {
    const base = blank('island'), input = { sceneId: base.sceneId, kind: 'island', seed: 'valid' }
    expect(() => generateTerrainDocument(base, { ...input, unsupported: true })).toThrow()
    expect(() => generateTerrainDocument(base, { ...input, widthMm: 0 })).toThrow()
    expect(() => generateTerrainDocument(base, { ...input, sceneId: 'wrong' })).toThrow()
    const locked = cloneJson(base); locked.userLayers['visual-layer-ground'].editLocked = true
    expect(() => generateTerrainDocument(locked, input)).toThrow(/图层/)
    const v1 = cloneJson(base); v1.schemaVersion = 1; delete v1.visual
    expect(() => generateTerrainDocument(v1, input)).toThrow()
    const generated = generateTerrainDocument(base, input).document, before = canonicalJson(generated)
    expect(() => generateTerrainDocument(generated, input)).toThrow(/空白/)
    expect(canonicalJson(generated)).toBe(before)
  })

  it('inspects input descriptors before parsing without invoking accessors', () => {
    let reads = 0
    const input = { sceneId: options.sceneId, kind: 'island', get seed() { reads++; return 'getter' } }
    expect(() => generateTerrainDocument(blank('island'), input)).toThrow(/访问器/)
    expect(reads).toBe(0)
    expect(terrainGenerationInputSchema.safeParse({ sceneId: options.sceneId, seed: 'x', kind: 'island', widthMm: 120000, heightMm: 18000 }).success).toBe(false)
  })

  it('rejects tampered result budgets, missing managed targets and unknown receipt fields', () => {
    const result = generate('island', TERRAIN_FIXED_SEEDS[0])
    expect(terrainGenerationResultSchema.safeParse({ ...result, cost: { ...result.cost, total: result.cost.total - 1 } }).success).toBe(false)
    expect(terrainGenerationResultSchema.safeParse({ ...result, managedTargets: result.managedTargets.slice(1) }).success).toBe(false)
    expect(terrainGenerationResultSchema.safeParse({ ...result, forged: true }).success).toBe(false)
  })
})

describe('fixed value noise, marching squares and bounded contour simplification', () => {
  it('has independent named streams and continuous lattice values', () => {
    expect(terrainHash32('repeat')).toBe(terrainHash32('repeat'))
    expect(terrainRandomUnit('seed', 'coast')).not.toBe(terrainRandomUnit('seed', 'props'))
    expect(terrainValueNoise('seed', 'test', .999999, .4)).toBeCloseTo(terrainValueNoise('seed', 'test', 1, .4), 5)
    for (let x = 0; x < 12; x++) expect(Math.abs(terrainValueNoise('seed', 'test', x / 7, x / 11))).toBeLessThanOrEqual(1)
  })
  it('keeps distinct components, stable saddle decisions and actual open ports', () => {
    const grid = { widthMm: 12000, heightMm: 12000, columns: 24, rows: 24 }
    const two = extractTerrainContours(grid, (x, y) => Math.max(1473 ** 2 - (x - 3000) ** 2 - (y - 6000) ** 2, 1473 ** 2 - (x - 9000) ** 2 - (y - 6000) ** 2))
    expect(two).toHaveLength(2); expect(two.every(contour => contour.closed)).toBe(true)
    const open = extractTerrainContours(grid, (x, y) => y - 4537 - x * .1)
    expect(open).toHaveLength(1); expect(open[0].closed).toBe(false)
    const simplified = simplifyTerrainContour(open[0], 50)
    expect(simplified[0].x).toBe(0); expect(simplified.at(-1)!.x).toBe(12000)
    const saddle = () => extractTerrainContours({ widthMm: 2000, heightMm: 2000, columns: 2, rows: 2 }, (x, y) => (x - 1100) * (y - 900))
    expect(canonicalJson(saddle())).toBe(canonicalJson(saddle()))
    expect(() => extractTerrainContours({ ...grid, columns: 512 }, () => 0)).toThrow(/格网/)
    expect(() => extractTerrainContours(grid, () => Infinity)).toThrow(/非有限/)
  })
})
