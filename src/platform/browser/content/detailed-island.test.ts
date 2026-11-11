import { describe, expect, it } from 'vitest'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { getLegacyVisual } from '../../../shared/terrain-generation/composition-contracts.js'
import { visualBase } from '../../../shared/visual/base.js'
import { sampleVisualBoundary, signedVisualArea } from '../../../shared/visual/geometry.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { boundaryConnections } from '../render/connection-geometry.js'
import { createRefinedIslandDocument } from './refined-island.js'
import { createDetailedIslandDocument, createDetailedIslandProject, DETAILED_ISLAND_NAME } from './detailed-island.js'
import { SAMPLE_ATMOSPHERE_PROFILES } from './sample-atmosphere.js'

describe('independent detailed island surface layout', () => {
  it('retains every physical area, prop and connection from the original fixed layout', () => {
    const source = createRefinedIslandDocument(), detailed = createDetailedIslandDocument()
    for (const id of Object.keys(source.terrainAreas)) {
      const { surfaceStyle: _before, ...before } = source.terrainAreas[id], { surfaceStyle: _after, ...after } = detailed.terrainAreas[id]
      expect(after).toEqual(before)
    }
    for (const key of ['terrainEdges', 'terrainConnections', 'paths', 'props', 'scatterGroups', 'decorations', 'decorationClusters', 'surfaceRules', 'entityLayers', 'constraints'] as const) {
      expect(detailed[key]).toEqual(source[key])
    }
    expect(detailed.terrainConnections['q1-stairs']).toMatchObject({ widthMm: 1500, from: { surfaceRef: { id: 'q1-low' } }, to: { surfaceRef: { id: 'q1-high' } } })
    expect(detailed.terrainAreas['q1-low'].groundElevationMm).toBe(800)
    expect(detailed.terrainAreas['q1-high'].groundElevationMm).toBe(2600)
  })

  it('retains original fixed source definitions and creates an independent theme and recipe identity', () => {
    const source = createRefinedIslandDocument(), detailed = createDetailedIslandDocument()
    for (const key of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions'] as const) expect(detailed[key]).toEqual(source[key])
    for (const [id, theme] of Object.entries(source.styleThemes)) expect(detailed.styleThemes[id]).toEqual(theme)
    expect(detailed.activeStyleThemeRef).toEqual({ id: 'detailed-island-surface-theme', version: 1 })
    expect(detailed.presetSnapshot.presetId).toBe('sceneweave-detailed-island')
    expect(detailed.presetSnapshot.presetVersion).toBe(1)
    expect(detailed.title).toBe(DETAILED_ISLAND_NAME)
    expect(Object.keys(detailed.assets)).toHaveLength(13)
    expect(Object.keys(detailed.materials)).toHaveLength(3)
    expect(visualBase(detailed)!.environment).toEqual(SAMPLE_ATMOSPHERE_PROFILES['island-daylight'].environment)
    expect(visualBase(detailed)!.fogs).toEqual({})
    expect(visualBase(detailed)!.filters).toEqual({})
    expect(visualBase(source)!.fogs['q1-water-haze']).toBeTruthy()
    expect(visualBase(source)!.filters['q1-paper-tone']).toBeTruthy()
  })

  it('saves irregular patch contours, finite grass skirts and real world-aligned stair landing paint', () => {
    const detailed = createDetailedIslandDocument(), visual = visualBase(detailed)!
    const patches = [...detailed.terrainAreas['q1-low'].surfaceStyle!.overlays, ...detailed.terrainAreas['q1-high'].surfaceStyle!.overlays]
    const originalIds = new Set([...createRefinedIslandDocument().terrainAreas['q1-low'].surfaceStyle!.overlays,
      ...createRefinedIslandDocument().terrainAreas['q1-high'].surfaceStyle!.overlays].map(patch => patch.id))
    const sourcePatches = patches.filter(patch => originalIds.has(patch.id))
    expect(sourcePatches).toHaveLength(8)
    expect(new Set(sourcePatches.map(patch => patch.blendWidthMm)).size).toBeGreaterThan(4)
    for (const [index, patch] of sourcePatches.entries()) {
      expect(patch.boundaryMm.length).toBeGreaterThanOrEqual(10)
      expect(patch.boundaryMm.every(p => Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y))).toBe(true)
      expect(signedVisualArea(patch.boundaryMm)).toBeGreaterThan(0)
      const boundary = visual.boundaries[`detail-island-patch-${index + 1}`]
      expect(boundary.binding.kind).toBe('decoration')
      expect(boundary.segments.map(segment => segment.start)).toEqual(patch.boundaryMm)
      expect(sampleVisualBoundary(boundary).lengthMm).toBeGreaterThan(0)
    }
    for (const [id, areaId] of [['detail-island-stair-low-landing', 'q1-low'], ['detail-island-stair-high-landing', 'q1-high']] as const) {
      const landing = detailed.terrainAreas[areaId].surfaceStyle!.overlays.find(patch => patch.id === id)!
      expect(landing.paint.materialRef.id).toBe('refined-material-island-material-strata')
      expect(landing.paint.alignment).toBe('world')
      expect(landing.paint.originMm).toEqual({ x: 0, y: 0 })
      expect(landing.paint.tileSizeMm).toEqual({ width: 4200, height: 4200 })
    }
    expect(visual.edgeLooks['q1-crown-cliff'].widthMm).toBeLessThan(1000)
    expect(visual.edgeLooks['q1-coast-cliff'].widthMm).toBeLessThan(600)
  })

  it('retains one continuous cliff representation per bound source and exposes the real stair opening to both audiences', () => {
    const detailed = createDetailedIslandDocument(), visual = visualBase(detailed)!, edges = Object.values(getLegacyVisual(detailed)!.materializedEdges)
    expect(edges).toHaveLength(0)
    for (const id of ['q1-coast', 'q1-crown']) {
      expect(visual.boundaries[id].binding.kind).toBe('terrain')
      expect(Object.values(visual.edgeLooks).filter(look => look.boundaryId === id && look.kind === 'cliff' && look.enabled)).toHaveLength(1)
    }
    for (const audience of ['gm', 'player'] as const) {
      const projected = projectScene(detailed, audience), crown = projected.visual!.boundaries.find(boundary => boundary.id === 'q1-crown')!
      expect(boundaryConnections(projected.connections, crown.points, crown.closed, crown.terrainAreaIds).map(connection => connection.id)).toContain('q1-stairs')
      expect(projected.visual!.edgeLooks.filter(look => look.kind === 'cliff')).toHaveLength(2)
    }
  })

  it('strictly validates, survives a cold JSON round trip and allocates complete identity and appearance for saved detail', () => {
    const scene = createDetailedIslandDocument(), text = canonicalJson(scene)
    const checked = validateSceneDocument(JSON.parse(text))
    expect(checked.ok).toBe(true)
    if (!checked.ok) throw new Error('Expected a complete valid island')
    expect(canonicalJson(checked.document)).toBe(text)
    let sequence = 0
    const content = createCompositionContent(checked.document, { ids: { nextId: () => `detailed-island-test-${++sequence}` }, clock: { now: () => scene.updatedAt } })
    expect(content.historyIdentity.presentationTokens!['detail-island-stair-high-landing']).toMatchObject({ kind: 'surfaceOverlay' })
    expect(content.appearance.surfaceSources['q1-high']).toBeTruthy()
    expect(content.document).toEqual(scene)
  })

  it('returns independent instance state and cancels before any rasterization', async () => {
    const first = createDetailedIslandDocument({ sceneId: 'first' }), second = createDetailedIslandDocument({ sceneId: 'second' })
    first.terrainAreas['q1-low'].surfaceStyle!.overlays[0].boundaryMm[0].x++
    expect(first.terrainAreas['q1-low'].surfaceStyle).not.toEqual(second.terrainAreas['q1-low'].surfaceStyle)
    const controller = new AbortController(); controller.abort()
    await expect(createDetailedIslandProject(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
