import { visualBase } from '../../../shared/visual/base.js'
import { describe, expect, it } from 'vitest'
import { createRefinedIslandDocument, createRefinedIslandProject } from './refined-island.js'
import { createVisualSampleDocument } from './visual-samples.js'
import { REFINED_ISLAND_ART } from '../../../shared/visual/island-art.js'
import { sampleVisualBoundary, terrainBoundaryChain, signedVisualArea } from '../../../shared/visual/geometry.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'

describe('independent Q1 editable island', () => {
  it('normalizes the independent 13-piece fixed original artwork and retains the old palette', () => {
    expect(REFINED_ISLAND_ART).toHaveLength(13)
    expect(new Set(REFINED_ISLAND_ART.map(value => value.sourceSvg)).size).toBe(13)
    for (const art of REFINED_ISLAND_ART) expect(normalizeStaticSvg(art.sourceSvg).viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
    const old = createVisualSampleDocument('island'), refined = createRefinedIslandDocument()
    expect(Object.keys(old.assets)).toHaveLength(24)
    expect(Object.keys(refined.assets)).toHaveLength(13)
    expect(Object.keys(refined.assets).some(id => id in old.assets)).toBe(false)
    expect(Object.keys(refined.propDefinitions)).toHaveLength(10)
    expect(Object.keys(refined.materials)).toHaveLength(3)
    expect(refined.presetSnapshot.presetId).toBe('sceneweave-refined-island')
  })
  it('persists exactly sampled asymmetric bays and real 800/2600mm ground with an open 1500mm stair', () => {
    const scene = createRefinedIslandDocument()
    expect(scene.terrainAreas['q1-low'].groundElevationMm).toBe(800)
    expect(scene.terrainAreas['q1-high'].groundElevationMm).toBe(2600)
    expect(scene.terrainConnections['q1-stairs']).toMatchObject({ kind: 'stairs', widthMm: 1500, blocksMovement: false,
      from: { surfaceRef: { id: 'q1-low' } }, to: { surfaceRef: { id: 'q1-high' } } })
    for (const curve of Object.values(visualBase(scene)!.boundaries)) {
      if (curve.binding.kind !== 'terrain') throw new Error('Expected physical terrain binding')
      const samples = sampleVisualBoundary(curve), side = curve.binding.sides[0]
      expect(terrainBoundaryChain(scene.terrainAreas[side.areaId], side, true).map(value => value.positionMm)).toEqual(samples.points)
      expect(samples.points.length).toBeLessThanOrEqual(512)
      expect(signedVisualArea(samples.points)).toBeGreaterThan(0)
      const turns = samples.points.map((p, i, points) => {
        const next = points[(i + 1) % points.length], after = points[(i + 2) % points.length]
        return (next.x - p.x) * (after.y - next.y) - (next.y - p.y) * (after.x - next.x)
      })
      expect(turns.some(value => value < 0)).toBe(true)
      expect(turns.some(value => value > 0)).toBe(true)
    }
    expect(scene.terrainAreas['q1-low'].surfaceStyle!.overlays.length).toBeGreaterThanOrEqual(4)
    expect(scene.terrainAreas['q1-high'].surfaceStyle!.overlays.length).toBeGreaterThanOrEqual(2)
    expect(Object.values(scene.props).every(value => !value.editLocked && value.visibility === 'public')).toBe(true)
    for (const prefix of ['tree-', 'rock-', 'shrub-']) expect(new Set(Object.values(scene.props).map(value => value.definitionRef!.id).filter(id => id.includes(prefix))).size).toBe(prefix === 'shrub-' ? 2 : 3)
    expect(visualBase(scene)!.environment.ambientOpacity).toBeLessThan(.05)
    expect(Object.values(visualBase(scene)!.fogs).every(value => value.opacity < .05)).toBe(true)
  })
  it('does not share mutable instance state and cancels before rasterization', async () => {
    const first = createRefinedIslandDocument(), second = createRefinedIslandDocument()
    Object.values(first.props)[0].positionMm.x += 1
    expect(first).not.toEqual(second)
    const controller = new AbortController(); controller.abort()
    await expect(createRefinedIslandProject(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
