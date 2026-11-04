import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { pointInPolygon, polygonDistance, supportedPolygon } from '../geometry/geometry.js'
import { sampleVisualBoundary, signedVisualArea } from '../visual/geometry.js'
import { visualBase } from '../visual/base.js'
import { generateTerrainDocument, terrainGenerationInputSchema, TERRAIN_FIXED_SEEDS } from './generate.js'
import { composeTerrainDocument } from './compose.js'
import { prepareTerrainEdit } from './edit.js'

const blank = (widthMm: number) => createRefinedBlankDocument('island', {
  sceneId: 'island-v3', title: '原创双肩岩岛', now: '2026-10-30T00:00:00.000Z', widthMm, heightMm: widthMm * .75, preset: 'narrative',
})

describe('non-radial island skeleton v3', () => {
  for (const widthMm of [24000, 48000, 120000]) it.each(TERRAIN_FIXED_SEEDS)(`preserves the complete main island and both reefs at ${widthMm}mm: %s`, seed => {
    const base = blank(widthMm), before = canonicalJson(base)
    const request = { sceneId: base.sceneId, kind: 'island', seed, widthMm, heightMm: widthMm * .75, algorithmVersion: 3 }
    const result = generateTerrainDocument(base, request), scene = result.document
    const low = scene.terrainAreas['terrain-low'].boundaryMm.map(row => row.positionMm)
    const reefs = ['terrain-reef-0', 'terrain-reef-1'].map(id => scene.terrainAreas[id].boundaryMm.map(row => row.positionMm))
    expect(result.cost.total).toBeLessThanOrEqual(256)
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(sampleVisualBoundary(visualBase(scene)!.boundaries['terrain-coast-curve']).points).toEqual(low)
    expect(supportedPolygon(scene, result.activity.boundaryMm, result.activity.supportRef, 'visual-floor')).toBe(true)
    expect(scene.terrainConnections['terrain-stairs']).toMatchObject({ widthMm: 1500, blocksMovement: false })
    expect(reefs.map(reef => reef.length)).toEqual([5, 5])
    expect(polygonDistance(low, reefs[0])).toBeGreaterThan(widthMm * .015)
    expect(polygonDistance(low, reefs[1])).toBeGreaterThan(widthMm * .015)
    expect(polygonDistance(reefs[0], reefs[1])).toBeGreaterThan(widthMm * .1)
    expect(signedVisualArea(low)).toBeGreaterThan(widthMm * widthMm * .18)
    expect(scene.terrainAreas['terrain-low']).toMatchObject({ groundElevationMm: 800, blocksMovement: false })
    expect(scene.terrainAreas['terrain-water'].blocksMovement).toBe(true)
    const variant = result.skeleton.variant, mirrorX = variant === 1 || variant === 3, mirrorY = variant === 2 || variant === 4
    const point = (x: number, y: number) => ({ x: (mirrorX ? 1 - x : x) * widthMm, y: (mirrorY ? 1 - y : y) * widthMm * .75 })
    // The side inlet wraps behind its shoulder, while the lower shelf and
    // offset neck remain real connected ground, not a dark painted overlay.
    expect(pointInPolygon(point(.58, .49), low)).toBe(false)
    expect(pointInPolygon(point(.72, .31), low)).toBe(true)
    expect(pointInPolygon(point(.37, .73), low)).toBe(true)
    expect(pointInPolygon(point(.34, .51), low)).toBe(true)
    for (const id of ['terrain-reef-0', 'terrain-reef-1']) expect(result.managedTargets).toContainEqual({ kind: 'terrainArea', id })
    const composed = composeTerrainDocument(base, result, 'island-v3-birth')
    expect(composed.cost.total).toBe(result.cost.total)
    expect(validateSceneDocument(JSON.parse(canonicalJson(composed.document))).ok).toBe(true)
    const generation = composed.document.generation!
    if (generation.version === 5) throw new Error('Expected ordinary terrain generation')
    expect(generation.recipes['terrain-recipe']).toMatchObject({ algorithmVersion: 3, recipeVersion: 3 })
    expect(canonicalJson(generateTerrainDocument(base, request))).toBe(canonicalJson(result))
    expect(canonicalJson(base)).toBe(before)
  })

  it('keeps v3 restricted to islands and retains explicit atomic local editing', () => {
    expect(terrainGenerationInputSchema.safeParse({ sceneId: 'coast-v3', kind: 'coast', seed: 'same', algorithmVersion: 3 }).success).toBe(false)
    const base = blank(24000), generated = generateTerrainDocument(base, { sceneId: base.sceneId, kind: 'island', seed: TERRAIN_FIXED_SEEDS[0], algorithmVersion: 3 })
    const scene = composeTerrainDocument(base, generated, 'island-v3-edit').document, before = canonicalJson(scene)
    const edited = prepareTerrainEdit(scene, { kind: 'brush', sceneId: scene.sceneId, operationId: 'island-v3-clear', floorId: 'visual-floor', scopeMm: scene.exportBoundsMm,
      linkMode: 'scenery', mode: 'clearArea', targetAreaId: 'terrain-low', materialRef: null, elevationMm: null, strokes: [{ pointsMm: [{ x: 1000, y: 1000 }], radiusMm: 300 }] })
    expect(validateSceneDocument(edited.document).ok).toBe(true)
    expect(canonicalJson(scene)).toBe(before)
  })
})
