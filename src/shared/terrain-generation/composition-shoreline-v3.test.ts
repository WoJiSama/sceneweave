import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../appearance/graph.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { validateSceneDocument } from '../validation/scene.js'
import { signedVisualArea } from '../visual/geometry.js'
import { compositionPreset, compositionPresetSchema } from './composition-presets.js'
import { materializeTerrainComposition } from './composition-materialize.js'
import { terrainCommandCost } from './cost.js'
import { evaluateTerrainRequirement } from './composition-requirements.js'
import { recomputeCompositionThreshold } from './composition-field.js'
import { distanceToTerrainSegment } from './field.js'
import type { PointMm } from '../model/scene.js'

const stamp = '2026-10-30T00:00:00.000Z'
const request = (seed = 'terrain-compose-0', islandCount = 3, widthMm = 48000, heightMm = widthMm * .75) => ({
  sceneId: 'island-composition-v3', preset: 'archipelago' as const, seed, islandCount, widthMm, heightMm, recipeVersion: 3,
})
function blank(widthMm: number, heightMm: number) {
  return createRefinedBlankDocument('island', { sceneId: 'island-composition-v3', title: '原创主岛与礁石',
    now: stamp, widthMm, heightMm, preset: 'narrative' })
}
function runtime() {
  let sequence = 0
  return { ids: { nextId: () => `island-v3-${++sequence}` }, clock: { now: () => stamp } }
}
function convexHull(points: PointMm[]): PointMm[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y), lower: PointMm[] = [], upper: PointMm[] = []
  const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  for (const p of sorted) { while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p) }
  for (const p of sorted.slice().reverse()) { while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

describe('versioned dominant-island composition recipe', () => {
  it('keeps legacy omitted selector and frozen original field input', () => {
    const raw = request()
    const { recipeVersion: _version, ...old } = raw
    expect(compositionPresetSchema.parse(old)).not.toHaveProperty('recipeVersion')
    const legacy = compositionPreset(old)
    expect(sha256Text(canonicalJson(legacy.input))).toBe('88621bc33beae4a6dbb370695f7dbb85a3651801ed3b11616d6204d69a4fcd93')
    expect(compositionPreset({ ...old, recipeVersion: 1 }).input).toEqual(legacy.input)
    const previous = compositionPreset({ ...old, recipeVersion: 2 })
    expect(previous.input.precision).toEqual({ sampleSpacingMm: 1000, toleranceMm: 800, noiseCellMm: 5000 })
    expect(previous.input.features['v2-main-channel'].shape).toEqual({ kind: 'corridor',
      pointsMm: [{ x: 24000, y: 0 }, { x: 24000, y: 36000 }], widthMm: 8000 })
    expect(previous.requirements.find(row => row.kind === 'channelWidth')).toMatchObject({
      pointsMm: [{ x: 24000, y: 4320 }, { x: 24000, y: 30960 }], minWidthMm: 1800 })
  })

  it('accepts recipe 3 only for its explicit archipelago branch', () => {
    for (const preset of ['tidalCoast', 'forestValley', 'grassRidge'] as const) {
      expect(() => compositionPreset({ ...request(), preset })).toThrow(/配方3仅支持群岛/)
    }
    expect(compositionPresetSchema.safeParse({ ...request(), recipeVersion: 4 }).success).toBe(false)
  })

  for (const widthMm of [24000, 48000]) for (const islandCount of [2, 3]) {
    it.each(['terrain-compose-0', 'terrain-compose-1', 'terrain-compose-2', 'composition-fixed'])(
      `preserves ${islandCount} real components and the full bent channel at ${widthMm}mm: %s`, seed => {
        const input = request(seed, islandCount, widthMm), preset = compositionPreset(input), source = blank(input.widthMm, input.heightMm)
        const before = canonicalJson(source), clock = runtime(), baseline = createCompositionContent(source, clock)
        const result = materializeTerrainComposition(source, preset.input, preset.requirements, preset.name, 'plain', 3)
        expect(validateSceneDocument(result.document).ok).toBe(true)
        expect(result.plan.fields.land.polygons).toHaveLength(islandCount)
        const areas = result.plan.fields.land.polygons.map(poly => Math.abs(signedVisualArea(poly.outer))).sort((a, b) => b - a)
        expect(areas[0]).toBeGreaterThan(areas[1] * (islandCount === 3 ? 2 : 1.3))
        expect(areas.at(-1)).toBeGreaterThanOrEqual(input.widthMm * input.heightMm * .017)
        const main = [...result.plan.fields.land.polygons].sort((a, b) => Math.abs(signedVisualArea(b.outer)) - Math.abs(signedVisualArea(a.outer)))[0].outer
        const hull = convexHull(main)
        expect(Math.abs(signedVisualArea(main)) / Math.abs(signedVisualArea(hull))).toBeLessThan(.97)
        const bayDepth = Math.max(...main.map(point => Math.min(...hull.map((a, index) => distanceToTerrainSegment(point, a, hull[(index + 1) % hull.length])))))
        expect(bayDepth).toBeGreaterThan(widthMm * .025)
        const water = preset.requirements.find(row => row.kind === 'channelWidth')!
        expect(water).toMatchObject({ minWidthMm: 1800 * widthMm / 48000 })
        if (water.kind !== 'channelWidth') throw new Error('Expected explicit channel requirement')
        expect(water.pointsMm).toHaveLength(3)
        for (const required of preset.requirements) expect(evaluateTerrainRequirement(result.document, required).state).toBe('passed')
        for (const threshold of Object.values(result.plan.thresholds)) {
          expect(recomputeCompositionThreshold(threshold.sourceInput, threshold.field, threshold.targetCoveragePpm, threshold.grid)).toBe(threshold.valueQ)
        }
        const after = createCompositionContent(result.document, clock)
        const cost = terrainCommandCost(baseline.document, after.document, { before: baseline, after })
        expect(cost.total).toBeLessThanOrEqual(256)
        expect(cost.total).toBe(Object.values(cost.items).reduce((sum, item) => sum + item, 0))
        expect(result.document.generation?.version === 5 && result.document.generation.legacy.recipes['t9-recipe']).toMatchObject({
          recipeVersion: 3, algorithmId: 'terrain-compose', algorithmVersion: 1 })
        // The renderer receives exactly the persisted physical ring, rather than
        // a second independently smoothed contour that can hide collisions.
        expect(result.document.terrainAreas['t9-land-0'].boundaryMm.map(point => point.positionMm)).toEqual(
          [...result.plan.fields.land.polygons].sort((a, b) => Math.abs(signedVisualArea(b.outer)) - Math.abs(signedVisualArea(a.outer)))[0].outer)
        expect(canonicalJson(source)).toBe(before)
      })
  }

  it('rejects an obstructed bent-channel corner and an impossible component area', () => {
    const input = request(), preset = compositionPreset(input), source = blank(input.widthMm, input.heightMm)
    const result = materializeTerrainComposition(source, preset.input, preset.requirements, preset.name, 'plain', 3)
    const channel = preset.requirements.find(row => row.kind === 'channelWidth')!
    if (channel.kind !== 'channelWidth') throw new Error('Expected channel')
    const corner = channel.pointsMm[1]
    result.document.regions['corner-obstacle'] = { id: 'corner-obstacle', floorId: 'visual-floor', editLocked: false,
      visibility: 'public', kind: 'hazard', blocksMovement: true, movementCostMultiplier: 1,
      boundaryMm: [{ x: corner.x - 100, y: corner.y - 100 }, { x: corner.x + 100, y: corner.y - 100 },
        { x: corner.x + 100, y: corner.y + 100 }, { x: corner.x - 100, y: corner.y + 100 }] }
    expect(evaluateTerrainRequirement(result.document, channel).state).toBe('failed')
    const area = preset.requirements.find(row => row.kind === 'minimumComponentArea')!
    if (area.kind !== 'minimumComponentArea') throw new Error('Expected area')
    expect(evaluateTerrainRequirement(result.document, { ...area, minAreaMm2: input.widthMm * input.heightMm }).state).toBe('failed')
  })
})
