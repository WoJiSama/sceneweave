import { describe, expect, it } from 'vitest'
import { createRefinedCoastDocument, createRefinedCoastProject, REFINED_COAST_NAME } from './refined-coast.js'
import { createVisualSampleDocument } from './visual-samples.js'
import { REFINED_COAST_ART } from '../../../shared/visual/coast-art.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { sampleVisualBoundary, terrainBoundaryChain } from '../../../shared/visual/geometry.js'

describe('independent Q2 editable coast', () => {
  it('keeps 15 distinct original SVGs and material definitions separate from the old fixed palette', () => {
    expect(REFINED_COAST_ART).toHaveLength(15)
    expect(new Set(REFINED_COAST_ART.map(art => art.sourceSvg)).size).toBe(15)
    for (const art of REFINED_COAST_ART) expect(normalizeStaticSvg(art.sourceSvg).viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
    const old = createVisualSampleDocument('beach'), scene = createRefinedCoastDocument()
    expect(scene.title).toBe(REFINED_COAST_NAME)
    expect(Object.keys(old.assets)).toHaveLength(24)
    expect(Object.keys(scene.assets)).toHaveLength(15)
    expect(Object.keys(scene.assets).some(id => id in old.assets)).toBe(false)
    expect(Object.keys(scene.propDefinitions)).toHaveLength(11)
    expect(Object.keys(scene.materials)).toHaveLength(4)
    expect(scene.presetSnapshot.presetId).toBe('sceneweave-refined-coast')
  })
  it('shares the exact nonstraight shoreline between both physical areas, with editable graded surfaces and unblocked activity sand', () => {
    const scene = createRefinedCoastDocument(), curve = scene.visual!.boundaries['q2-coast-shoreline']
    expect(curve.segments).toHaveLength(7)
    if (curve.binding.kind !== 'terrain') throw new Error('Expected a shared physical coast')
    const samples = sampleVisualBoundary(curve)
    expect(samples.points.length).toBeLessThanOrEqual(512)
    expect(curve.binding.sides).toHaveLength(2)
    for (const side of curve.binding.sides) {
      const chain = terrainBoundaryChain(scene.terrainAreas[side.areaId], side, false).map(value => value.positionMm)
      expect(side.reverse ? chain.reverse() : chain).toEqual(samples.points)
    }
    expect(scene.terrainAreas['q2-coast-water'].blocksMovement).toBe(true)
    expect(scene.terrainAreas['q2-coast-sand'].blocksMovement).toBe(false)
    expect(scene.terrainAreas['q2-coast-water'].surfaceStyle!.overlays).toHaveLength(1)
    expect(scene.terrainAreas['q2-coast-sand'].surfaceStyle!.overlays).toHaveLength(3)
    expect(Object.values(scene.props).filter(value => value.blocksMovement).every(value => value.positionMm.x < 6500 || value.positionMm.x > 16500 || value.positionMm.y < 10000)).toBe(true)
    expect(new Set(Object.values(scene.props).filter(value => value.definitionRef!.id.includes('reef-')).map(value => value.definitionRef!.id)).size).toBe(3)
    expect(Object.values(scene.props).every(value => value.supportRef?.kind === 'terrainArea' && !value.editLocked && value.visibility === 'public')).toBe(true)
    expect(scene.visual!.environment.ambientOpacity).toBeLessThan(.05)
  })
  it('cancels before image work and gives every composition independent mutable objects', async () => {
    const first = createRefinedCoastDocument(), second = createRefinedCoastDocument()
    Object.values(first.props)[0].positionMm.x += 1
    expect(first).not.toEqual(second)
    const controller = new AbortController(); controller.abort()
    await expect(createRefinedCoastProject(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
