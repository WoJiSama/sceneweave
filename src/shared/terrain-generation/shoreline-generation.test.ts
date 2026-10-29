import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { validateSceneDocument } from '../validation/scene.js'
import { sampleVisualBoundary, signedVisualArea } from '../visual/geometry.js'
import { visualBase } from '../visual/base.js'
import { pointInPolygon, supportedPolygon } from '../geometry/geometry.js'
import { generateTerrainDocument, terrainGenerationInputSchema } from './generate.js'
import { composeTerrainDocument } from './compose.js'
import { prepareTerrainEdit } from './edit.js'

const stamp = '2026-10-29T00:00:00.000Z'
const blank = (kind: 'island' | 'coast', sceneId: string, widthMm = 48000) => createRefinedBlankDocument(kind,
  { sceneId, title: '固定岸线诊断', now: stamp, widthMm, heightMm: widthMm * .75, preset: 'narrative' })

describe('versioned shoreline generation', () => {
  it.each([
  {
    "kind": "island",
    "seed": "terrain-v1-0",
    "hash": "05cf5c0d02789e4057ae09745bcedbf0f873d6031a76ceb4729545098095c917"
  },
  {
    "kind": "island",
    "seed": "terrain-v1-1",
    "hash": "3cba4011dcfa49469bdf92d380a6d8abcab8c856a32704a4a6a0d68124f9029d"
  },
  {
    "kind": "island",
    "seed": "terrain-v1-2",
    "hash": "892fe36e88fac199de129ab0855a4661534160f8a8382bb1530604eb2da6e32d"
  },
  {
    "kind": "coast",
    "seed": "terrain-v1-0",
    "hash": "94bdb9a797af8368a4afdef711b2c07885446e7b2bf263ef4ee077a662293c2a"
  },
  {
    "kind": "coast",
    "seed": "terrain-v1-1",
    "hash": "0952ea3294b8a3d600f5d671e25abc18535ba4f09346e61dfb18522b997a2b33"
  },
  {
    "kind": "coast",
    "seed": "terrain-v1-2",
    "hash": "779fca01b318264de093045438f4b205b705a4bbf7ef0af1d40b66f6bd71128a"
  }
])('retains the frozen v1 $kind/$seed result', ({kind,seed,hash}) => {
    const type = kind as 'island' | 'coast', sceneId = `diagnosis-legacy-${kind}-${seed}`
    const result = generateTerrainDocument(blank(type, sceneId), { sceneId, kind, seed, widthMm: 48000, heightMm: 36000 })
    expect(sha256Text(canonicalJson(result))).toBe(hash)
  })

  it('keeps omitted versions absent from old request hashes and rejects unsupported selectors', () => {
    const input = { sceneId: 'selector', kind: 'island', seed: 'terrain-v1-0' }
    expect(terrainGenerationInputSchema.parse(input)).not.toHaveProperty('algorithmVersion')
    expect(terrainGenerationInputSchema.safeParse({ ...input, algorithmVersion: 3 }).success).toBe(false)
    expect(terrainGenerationInputSchema.safeParse({ ...input, kind: 'forest', algorithmVersion: 2 }).success).toBe(false)
  })

  it.each(['island', 'coast'] as const)('preserves explicit legacy %s geometry', kind => {
    const base = blank(kind, 'legacy-selector')
    const request = { sceneId: base.sceneId, kind, seed: 'terrain-v1-0', widthMm: 48000, heightMm: 36000 }
    expect(generateTerrainDocument(base, { ...request, algorithmVersion: 1 }).document)
      .toEqual(generateTerrainDocument(base, request).document)
  })

  for (const widthMm of [24000, 48000]) for (const kind of ['island', 'coast'] as const) {
    it.each([0, 1, 2, 3, 4])(`creates supported ${widthMm}mm ${kind} @2 seed %s without changing the baseline`, index => {
      const sceneId = `shoreline-${kind}-${widthMm}-${index}`, base = blank(kind, sceneId, widthMm), before = canonicalJson(base)
      const request = { sceneId, kind, seed: `terrain-v1-${index}`, widthMm, heightMm: widthMm * .75, algorithmVersion: 2 }
      const result = generateTerrainDocument(base, request), curve = visualBase(result.document)!.boundaries['terrain-coast-curve']
      expect(validateSceneDocument(result.document).ok).toBe(true)
      expect(result.cost.total).toBeLessThanOrEqual(256)
      expect(result.document.terrainConnections['terrain-stairs']).toMatchObject({ widthMm: 1500, blocksMovement: false })
      expect(supportedPolygon(result.document, result.activity.boundaryMm, result.activity.supportRef, 'visual-floor')).toBe(true)
      const sampled = sampleVisualBoundary(curve).points
      if (kind === 'coast') for (let i = 0; i < curve.segments.length; i++) {
        const segment = curve.segments[i], bottom = Math.min(segment.start.y, segment.end.y), top = Math.max(segment.start.y, segment.end.y)
        expect(segment.control1.y).toBeGreaterThanOrEqual(bottom - 1)
        expect(segment.control1.y).toBeLessThanOrEqual(top + 1)
        expect(segment.control2.y).toBeGreaterThanOrEqual(bottom - 1)
        expect(segment.control2.y).toBeLessThanOrEqual(top + 1)
        const next = curve.segments[i + 1]
        if (next && (segment.end.y - segment.start.y) * (next.end.y - next.start.y) <= 0) {
          expect(segment.control2.y).toBe(segment.end.y)
          expect(next.control1.y).toBe(next.start.y)
        }
      }
      const low = result.document.terrainAreas['terrain-low'].boundaryMm.map(row => row.positionMm)
      expect(kind === 'island' ? low : low.slice(0, -2)).toEqual(sampled)
      expect(signedVisualArea(low)).toBeGreaterThan(0)
      if (kind === 'island') {
        const radii = [[.37,.34],[.38,.33],[.36,.35],[.39,.31],[.35,.36]][index], bay = result.skeleton.bayDirection
        const position = (along: number, across: number) => ({ x: Math.round(widthMm * (.5 + (along * bay.x + across * bay.y) * radii[0])), y: Math.round(widthMm * .75 * (.5 + (along * bay.y - across * bay.x) * radii[1])) })
        expect(pointInPolygon(position(.73, 0), low)).toBe(false)
        expect(pointInPolygon(position(.65, .65), low)).toBe(true)
        expect(pointInPolygon(position(.65, -.65), low)).toBe(true)
      }
      const composed = composeTerrainDocument(base, result, 'shoreline-birth')
      expect(composed.cost.total).toBe(result.cost.total)
      expect(composed.document.generation!.version).toBe(1)
      const g = composed.document.generation!
      if (g.version !== 1) throw new Error('Expected generation1')
      expect(g.recipes['terrain-recipe']).toMatchObject({ recipeVersion: 2, algorithmId: 'terrain-scene', algorithmVersion: 2 })
      expect(g.rules['terrain-rule'].recipeRef.version).toBe(2)
      expect(g.checks['terrain-activity-check'].algorithmVersion).toBe(2)
      expect(validateSceneDocument(JSON.parse(canonicalJson(composed.document))).ok).toBe(true)
      expect(canonicalJson(generateTerrainDocument(base, request))).toBe(canonicalJson(result))
      expect(canonicalJson(base)).toBe(before)
    })
  }

  it('keeps version 2 editable through the existing atomic local terrain entry', () => {
    const base = blank('island', 'shoreline-edit', 24000)
    const generated = generateTerrainDocument(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', algorithmVersion: 2 })
    const scene = composeTerrainDocument(base, generated, 'shoreline-edit-birth').document, before = canonicalJson(scene)
    const edited = prepareTerrainEdit(scene, { kind: 'brush', sceneId: scene.sceneId, operationId: 'shoreline-clear', floorId: 'visual-floor', scopeMm: scene.exportBoundsMm, linkMode: 'scenery', mode: 'clearArea', targetAreaId: 'terrain-low', materialRef: null, elevationMm: null, strokes: [{ pointsMm: [{ x: 1000, y: 1000 }], radiusMm: 300 }] })
    expect(validateSceneDocument(edited.document).ok).toBe(true)
    expect(edited.document.generation!.version).toBe(2)
    expect(canonicalJson(scene)).toBe(before)
  })
})
