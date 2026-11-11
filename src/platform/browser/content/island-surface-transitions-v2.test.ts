import { describe, expect, it } from 'vitest'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { connectionFootprint, corridor, polygonInside, polygonsOverlap, terrainPoints } from '../../../shared/geometry/geometry.js'
import { createDetailedIslandDocument } from './detailed-island.js'
import { applyIslandSurfaceTransitionsV2, ISLAND_SURFACE_TRANSITIONS_V2_LIMITS } from './island-surface-transitions-v2.js'

const prefix = 'island-surface-v2-'
const patches = (scene: ReturnType<typeof createDetailedIslandDocument>) => Object.values(scene.terrainAreas).flatMap(area => area.surfaceStyle?.overlays ?? [])

describe('independent grass-rock transition recipe2', () => {
  it('changes only saved surface geometry and owned decoration while preserving physical content, fixed source and material phase', () => {
    const source = createDetailedIslandDocument(), before = canonicalJson(source), result = applyIslandSurfaceTransitionsV2(source)
    expect(canonicalJson(source)).toBe(before)
    for (const id of Object.keys(source.terrainAreas)) {
      const { surfaceStyle: _a, ...a } = source.terrainAreas[id], { surfaceStyle: _b, ...b } = result.terrainAreas[id]
      expect(b).toEqual(a)
      expect(result.terrainAreas[id].surfaceStyle?.base).toEqual(source.terrainAreas[id].surfaceStyle?.base)
    }
    for (const key of ['terrainEdges', 'terrainConnections', 'paths', 'props', 'scatterGroups', 'decorations', 'decorationClusters', 'surfaceRules', 'entityLayers',
      'constraints', 'assets', 'materials', 'propDefinitions', 'styleThemes', 'activeStyleThemeRef', 'presetSnapshot', 'revision'] as const) expect(result[key]).toEqual(source[key])
    const beforePatches = patches(source), afterPatches = patches(result)
    for (const patch of beforePatches) expect(afterPatches.find(value => value.id === patch.id)!.paint).toEqual(patch.paint)
    expect(afterPatches).toHaveLength(beforePatches.length + ISLAND_SURFACE_TRANSITIONS_V2_LIMITS.newFragments)
    expect(afterPatches.filter(patch => patch.id.startsWith(prefix))).toHaveLength(4)
    expect(beforePatches.filter(patch => canonicalJson(patch) !== canonicalJson(afterPatches.find(value => value.id === patch.id)))).toHaveLength(8)
    const originalVisual = visualBase(source)!, actualVisual = visualBase(result)!
    for (const id of ['q1-coast', 'q1-crown']) expect(actualVisual.boundaries[id]).toEqual(originalVisual.boundaries[id])
    for (const id of ['q1-coast-cliff', 'q1-crown-cliff', 'q1-coast-shore', 'q1-crown-grass']) expect(actualVisual.edgeLooks[id]).toEqual(originalVisual.edgeLooks[id])
    expect(actualVisual.environment).toEqual(originalVisual.environment)
  })

  it('replaces full closed rims with finite separated open grass runs and real support-safe fragments', () => {
    const result = applyIslandSurfaceTransitionsV2(createDetailedIslandDocument()), visual = visualBase(result)!
    expect(Object.keys(visual.boundaries).some(id => id.startsWith('detail-island-patch-'))).toBe(false)
    const runs = Object.values(visual.boundaries).filter(value => value.id.startsWith(prefix))
    expect(runs.length).toBeGreaterThanOrEqual(8); expect(runs.length).toBeLessThanOrEqual(16)
    for (const boundary of runs) {
      expect(boundary.closed).toBe(false); expect(boundary.binding).toEqual({ kind: 'decoration' }); expect(boundary.segments).toHaveLength(1)
      const curve = sampleVisualBoundary(boundary), look = visual.edgeLooks[`${boundary.id}-grass`]
      expect(look.widthMm).toBeLessThan(200)
      expect(curve.lengthMm).toBeGreaterThan(170)
      const sample = boundary.segments[0], envelope = corridor(sample.start, sample.end, (look.widthMm + look.repeatMm) * 2, true)
      expect(['q1-low', 'q1-high'].some(id => polygonInside(envelope, terrainPoints(result.terrainAreas[id])))).toBe(true)
      expect(polygonsOverlap(envelope, connectionFootprint(result.terrainConnections['q1-stairs']))).toBe(false)
    }
    for (const area of Object.values(result.terrainAreas)) for (const patch of area.surfaceStyle?.overlays.filter(patch => patch.id.startsWith(prefix)) ?? []) {
      expect(polygonInside(patch.boundaryMm, terrainPoints(area))).toBe(true)
      expect(polygonsOverlap(patch.boundaryMm, connectionFootprint(result.terrainConnections['q1-stairs']))).toBe(false)
      for (const higher of Object.values(result.terrainAreas).filter(candidate => candidate.coveragePriority > area.coveragePriority)) expect(polygonsOverlap(patch.boundaryMm, terrainPoints(higher))).toBe(false)
    }
  })

  it('is deterministic across scene identity and time and produces complete current-v1 appearance and identity', () => {
    const source = createDetailedIslandDocument(), first = applyIslandSurfaceTransitionsV2(source), other = applyIslandSurfaceTransitionsV2(createDetailedIslandDocument({ sceneId: 'other', now: '2026-11-11T00:00:00.000Z' }))
    expect(other.terrainAreas).toEqual(first.terrainAreas)
    expect(visualBase(other)).toEqual(visualBase(first))
    const cold = JSON.parse(canonicalJson(first))
    expect(validateSceneDocument(cold).ok).toBe(true)
    let index = 0
    const content = createCompositionContent(cold, { ids: { nextId: () => `surface-transition-test-${++index}` }, clock: { now: () => source.updatedAt } })
    expect(content.document).toEqual(first)
    for (const patch of patches(first).filter(value => value.id.startsWith(prefix))) expect(content.historyIdentity.presentationTokens![patch.id]).toMatchObject({ kind: 'surfaceOverlay' })
    expect(content.appearance.surfaceSources['q1-low']).toBeTruthy()
    expect(content.appearance.surfaceSources['q1-high']).toBeTruthy()
  })

  it('rejects a changed source, private or locked dependency, duplicate application and reserved IDs atomically', () => {
    const source = createDetailedIslandDocument()
    const cases = [
      (scene: typeof source) => { scene.terrainAreas['q1-low'].surfaceStyle!.overlays[0].paint.rotationDeg = 1 },
      (scene: typeof source) => { scene.terrainAreas['q1-high'].surfaceStyle!.overlays[0].boundaryMm[0].x++ },
      (scene: typeof source) => { visualBase(scene)!.edgeLooks['detail-island-patch-1-grass'].opacity = .2 },
      (scene: typeof source) => { visualBase(scene)!.boundaries['detail-island-patch-1'].visibility = 'gm' },
      (scene: typeof source) => { scene.terrainAreas['q1-low'].visibility = 'gm' },
      (scene: typeof source) => { scene.terrainAreas['q1-high'].editLocked = true },
      (scene: typeof source) => { scene.terrainConnections['q1-stairs'].visibility = 'gm' },
      (scene: typeof source) => { scene.userLayers['visual-layer-details'].editLocked = true },
      (scene: typeof source) => { scene.presetSnapshot.presetVersion = 2 },
      (scene: typeof source) => { const prop = Object.values(scene.props)[0], oldId = prop.id, id = `${prefix}occupied`; delete scene.props[oldId]; scene.props[id] = { ...prop, id }; scene.entityLayers[id] = scene.entityLayers[oldId]; delete scene.entityLayers[oldId] },
    ]
    for (const change of cases) {
      const scene = structuredClone(source); change(scene); const before = canonicalJson(scene)
      expect(() => applyIslandSurfaceTransitionsV2(scene)).toThrow()
      expect(canonicalJson(scene)).toBe(before)
    }
    const applied = applyIslandSurfaceTransitionsV2(source), before = canonicalJson(applied)
    expect(() => applyIslandSurfaceTransitionsV2(applied)).toThrow(/确切的新建/)
    expect(canonicalJson(applied)).toBe(before)
  })

  it('accepts the explicit new natural-detail construction identity without overwriting other profiles', () => {
    const source = createDetailedIslandDocument(); source.presetSnapshot.presetId = 'sceneweave-natural-detail-island'
    visualBase(source)!.edgeLooks['q1-crown-cliff'].renderProfile = 'rockRelief2'
    const result = applyIslandSurfaceTransitionsV2(source)
    expect(visualBase(result)!.edgeLooks['q1-crown-cliff']).toEqual(visualBase(source)!.edgeLooks['q1-crown-cliff'])
    expect(result.presetSnapshot).toEqual(source.presetSnapshot)
  })
})
