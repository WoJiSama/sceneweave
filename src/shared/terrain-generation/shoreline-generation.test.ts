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
    "hash": "2931c0f27dea2ef8d81bfd1ec6c51597287964fc5f5b82bad612e6d8146a5849"
  },
  {
    "kind": "island",
    "seed": "terrain-v1-1",
    "hash": "1b9f55ce4cc5dc2c33ed1fba85dadaac45530354c4095da0bc8b043ec3137d77"
  },
  {
    "kind": "island",
    "seed": "terrain-v1-2",
    "hash": "70f5db6647a312543aa90ef655ba3fe3d4c7ce761033030519c070a109eb17df"
  },
  {
    "kind": "coast",
    "seed": "terrain-v1-0",
    "hash": "ec3e8a3afcf03ec6d9de851512a59b852c8c2d2e13d8581e652de02bcbc97785"
  },
  {
    "kind": "coast",
    "seed": "terrain-v1-1",
    "hash": "05986cd53e84eb85a1fb2646895a3a43c35eea39784b0d85274e189c0b71efac"
  },
  {
    "kind": "coast",
    "seed": "terrain-v1-2",
    "hash": "697f671d51878bfb8a8053054f60820874ffd77bcd4a591eb2a41ad9e2c99bc9"
  }
])('retains frozen algorithm1 domain output for $kind/$seed', ({kind,seed,hash}) => {
    const type = kind as 'island' | 'coast', sceneId = `diagnosis-legacy-${kind}-${seed}`
    const result = generateTerrainDocument(blank(type, sceneId), { sceneId, kind, seed, widthMm: 48000, heightMm: 36000 })
    expect(sha256Text(canonicalJson(({ ...result, document: { ...Object.fromEntries(['terrainAreas','terrainEdges','terrainConnections','paths','props','entityLayers'].map(key => [key, result.document[key as keyof typeof result.document]])), visual: visualBase(result.document) } })))).toBe(hash)
  })

  // Domain hashes captured from committed pre-collapse source. Project envelopes evolve independently.
  it.each([
    { kind: 'island', seed: 'terrain-v1-0', hash: 'f43e2c75eefc18849fccb475977b9c81b560a64768a4f9cffdd751a5dd6421ae' },
    { kind: 'island', seed: 'terrain-v1-1', hash: 'cd07d75086889f57850e3883eea04bc525e541f1f882a72b61c22b490309e189' },
    { kind: 'island', seed: 'terrain-v1-2', hash: '0ddf52114673ea819950cd4e0db61de3501335376c055aa39323b4f6263bee95' },
    { kind: 'island', seed: 'terrain-v1-3', hash: '6e32000d54c6027345ff74db1e4246d129289550e1e01e25c1c6aff382d85ca3' },
    { kind: 'island', seed: 'terrain-v1-4', hash: '1fbb5250c42f218e27d7510fa27e0be32fd9f3f7b8b874f21406cff2ade10a64' },
    { kind: 'coast', seed: 'terrain-v1-0', hash: '789efe734d12c2036379126811e6b5282cde1998a472fcda47fda0f1ac1bb9ba' },
    { kind: 'coast', seed: 'terrain-v1-1', hash: '44dcb69fb03924934cb887f474bf13a1a22a65ae58e222ebe564e98d78960b04' },
    { kind: 'coast', seed: 'terrain-v1-2', hash: '9aa389b5fddb5c6919c55f31f6d280a07bfdbe67e9e3399877f3d89e5364b77a' },
    { kind: 'coast', seed: 'terrain-v1-3', hash: '95d373126b1d183402d30fb485300e4826f07d8aca4f6d875f2d5cb0a05d3e3c' },
    { kind: 'coast', seed: 'terrain-v1-4', hash: '794594a10c5e08deb3390fff993b4fce97707dddf5a6551d881188ae90ff7ecd' },
  ])('retains frozen algorithm2 domain output for $kind/$seed', ({ kind, seed, hash }) => {
    const type = kind as 'island' | 'coast', sceneId = `frozen-v2-${kind}-${seed}`
    const base = createRefinedBlankDocument(type, { sceneId, title: '冻结算法2', now: '2026-10-30T00:00:00.000Z', widthMm: 48000, heightMm: 36000, preset: 'narrative' })
    const result = generateTerrainDocument(base, { sceneId, kind, seed, widthMm: 48000, heightMm: 36000, algorithmVersion: 2 })
    expect(sha256Text(canonicalJson(({ ...result, document: { ...Object.fromEntries(['terrainAreas','terrainEdges','terrainConnections','paths','props','entityLayers'].map(key => [key, result.document[key as keyof typeof result.document]])), visual: visualBase(result.document) } })))).toBe(hash)
  })

  it('keeps omitted versions absent from old request hashes and rejects unsupported selectors', () => {
    const input = { sceneId: 'selector', kind: 'island', seed: 'terrain-v1-0' }
    expect(terrainGenerationInputSchema.parse(input)).not.toHaveProperty('algorithmVersion')
    expect(terrainGenerationInputSchema.safeParse({ ...input, algorithmVersion: 99 }).success).toBe(false)
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
      expect(composed.cost.total).toBeGreaterThan(result.cost.total)
      expect(composed.document.generation.legacy.version).toBe(1)
      const g = composed.document.generation.legacy
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
    expect(edited.document.generation.legacy.version).toBe(2)
    expect(canonicalJson(scene)).toBe(before)
  })
})
