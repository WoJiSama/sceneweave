import { afterAll, describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { pointOnSurface, polygonDistance, propFootprint, supportedPolygon, validateGeometry } from '../geometry/geometry.js'
import { visualBase } from '../visual/base.js'
import { composeTerrainDocument } from './compose.js'
import { generateTerrainDocument, TERRAIN_FIXED_SEEDS, terrainGenerationResultSchema } from './generate.js'
import { prepareTerrainEdit } from './edit.js'

const kinds = ['river', 'lake', 'forest', 'hill', 'mixed'] as const
const sizes = [[24000, 18000], [36000, 20000], [36000, 36000], [48000, 36000], [120000, 90000]] as const
const cases = kinds.flatMap(kind => TERRAIN_FIXED_SEEDS.flatMap(seed => sizes.map(([widthMm, heightMm]) => ({ kind, seed, widthMm, heightMm }))))
const costs: Record<string, number[]> = {}
const blank = (widthMm = 24000, heightMm = 18000, palette: 'island' | 'coast' = 'island') => createRefinedBlankDocument(palette, {
  title: 'T3 fixed matrix', sceneId: 'terrain-t3-matrix', now: '2026-10-26T00:00:00.000Z', widthMm, heightMm, preset: 'narrative',
})

describe('T3 fixed seed and size matrix', () => {
  it.each(cases)('$kind $seed $widthMm × $heightMm keeps complete support, constraints, budget and editable records', ({ kind, seed, widthMm, heightMm }) => {
    const base = blank(widthMm, heightMm), before = canonicalJson(base)
    const result = generateTerrainDocument(base, { sceneId: base.sceneId, kind, seed, widthMm, heightMm })
    const scene = result.document
    expect(canonicalJson(generateTerrainDocument(JSON.parse(before), result.input))).toBe(canonicalJson(result))
    expect(canonicalJson(base)).toBe(before)
    expect(terrainGenerationResultSchema.safeParse(result).success).toBe(true)
    expect(validateSceneDocument(JSON.parse(canonicalJson(scene))).ok).toBe(true)
    expect(validateGeometry(scene).errors).toEqual([])
    expect(result.cost.total).toBeGreaterThan(0)
    expect(result.cost.total).toBeLessThanOrEqual(256)
    ;(costs[kind] ??= []).push(result.cost.total)
    expect(Object.keys(scene.props).length).toBeGreaterThanOrEqual(4)
    expect(supportedPolygon(scene, result.activity.boundaryMm, result.activity.supportRef, 'visual-floor')).toBe(true)
    for (const prop of Object.values(scene.props)) {
      expect(supportedPolygon(scene, propFootprint(prop), prop.supportRef, prop.floorId)).toBe(true)
      expect(polygonDistance(propFootprint(prop), result.activity.boundaryMm)).toBeGreaterThanOrEqual(300)
      if (prop.definitionRef?.id.includes('tree-')) expect(prop.rotationDeg).toBe(0)
    }
    const highConnection = scene.terrainConnections['terrain-stairs']
    expect(highConnection.blocksMovement).toBe(false)
    expect(highConnection.widthMm).toBeGreaterThanOrEqual(1500)
    expect(scene.terrainAreas['terrain-high'].groundElevationMm).toBeGreaterThan(scene.terrainAreas['terrain-low'].groundElevationMm)
    if (kind === 'river' || kind === 'mixed') {
      const shallow = scene.terrainAreas['terrain-shallow']
      expect(shallow.blocksMovement).toBe(false)
      expect(shallow.movementCostMultiplier).toBeGreaterThan(1)
      expect(scene.terrainAreas['terrain-water-north'].blocksMovement).toBe(true)
      expect(scene.terrainAreas['terrain-water-south'].blocksMovement).toBe(true)
      for (const id of ['terrain-shallow-left', 'terrain-shallow-right']) {
        const connection = scene.terrainConnections[id]
        expect(connection.kind).toBe('ramp')
        expect(connection.widthMm).toBeGreaterThanOrEqual(1400)
        expect(connection.blocksMovement).toBe(false)
        expect(pointOnSurface(scene, connection.from.positionMm, connection.from.surfaceRef, connection.floorId)).toBe(true)
        expect(pointOnSurface(scene, connection.to.positionMm, connection.to.surfaceRef, connection.floorId)).toBe(true)
      }
    }
    if (kind === 'lake') expect(scene.terrainAreas['terrain-lake'].blocksMovement).toBe(true)
    if (kind === 'forest' || kind === 'mixed') expect(scene.terrainAreas['terrain-forest'].movementCostMultiplier).toBeGreaterThan(1)
    const complete = composeTerrainDocument(base, result, 't3-matrix-birth')
    expect(complete.cost.total).toBe(result.cost.total)
    expect(validateSceneDocument(JSON.parse(canonicalJson(complete.document))).ok).toBe(true)
    const center = result.activity.boundaryMm.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 })
    const painted = prepareTerrainEdit(complete.document, { kind: 'brush', sceneId: scene.sceneId, operationId: `t3-paint-${kind}-${seed}-${widthMm}-${heightMm}`, floorId: 'visual-floor',
      scopeMm: scene.exportBoundsMm, linkMode: 'transitions', mode: 'paintGrass', targetAreaId: 'terrain-high', materialRef: cloneJson(scene.terrainAreas['terrain-high'].surfaceStyle!.base.materialRef),
      elevationMm: null, strokes: [{ pointsMm: [center], radiusMm: 100 }] })
    expect(painted.document.terrainAreas['terrain-high'].surfaceStyle!.overlays.length).toBe(1)
    expect(painted.document.terrainAreas['terrain-high'].boundaryMm).toEqual(scene.terrainAreas['terrain-high'].boundaryMm)
    expect(painted.document.props).toEqual(scene.props)
    expect(validateSceneDocument(painted.document).ok).toBe(true)
  }, 30000)

  it.each(['island', 'coast'] as const)('keeps the T1 %s fixed outputs available to T2 brushes', kind => {
    for (const seed of TERRAIN_FIXED_SEEDS) {
      const base = blank(24000, 18000, kind), result = generateTerrainDocument(base, { sceneId: base.sceneId, kind, seed })
      const scene = composeTerrainDocument(base, result, 't1-compat-birth').document
      const bounds = scene.floors['visual-floor'].boundsMm
      const point = visualBase(scene)!.boundaries['terrain-coast-curve'].segments.flatMap(segment => [segment.start, segment.end])
        .find(point => point.x >= bounds.x + 1000 && point.x <= bounds.x + bounds.width - 1000 && point.y >= bounds.y + 1000 && point.y <= bounds.y + bounds.height - 1000)
      expect(point, `fixed seed ${kind}/${seed} needs a legal interior brush target`).toBeDefined()
      if (!point) throw new Error('fixture')
      const scopeMm = { x: scene.exportBoundsMm.x - 2000, y: scene.exportBoundsMm.y - 2000, width: scene.exportBoundsMm.width + 4000, height: scene.exportBoundsMm.height + 4000 }
      const edited = prepareTerrainEdit(scene, { kind: 'brush', sceneId: scene.sceneId, operationId: `t1-compat-${kind}-${seed}`, floorId: 'visual-floor', scopeMm,
        linkMode: 'scenery', mode: 'addLand', targetAreaId: 'terrain-low', materialRef: null, elevationMm: null, strokes: [{ pointsMm: [point], radiusMm: 700 }] })
      expect(validateSceneDocument(edited.document).ok).toBe(true)
      expect(edited.document.terrainAreas['terrain-high']).toEqual(scene.terrainAreas['terrain-high'])
    }
  }, 30000)
})

afterAll(() => {
  console.info('T3 matrix observed budgets', JSON.stringify(Object.fromEntries(Object.entries(costs).map(([kind, values]) => [kind, { cases: values.length, min: Math.min(...values), max: Math.max(...values) }]))))
})
