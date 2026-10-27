import { describe, expect, it } from 'vitest'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { NEAR_SIDE_ART, NEAR_SIDE_LICENSE } from './near-side-art.js'
import { createNearSideIslandProject, createNearSideSourceDocument, nearSideAssetId, nearSideDefinitionId } from './near-side.js'
import { createRefinedIslandDocument } from './refined-island.js'
import { REFINED_ISLAND_ART } from '../../../shared/visual/island-art.js'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'

describe('original fixed T4 near-side content', () => {
  it('has six distinct original source drawings, world root/shadow and actual small footprints', () => {
    expect(NEAR_SIDE_ART).toHaveLength(6)
    expect(new Set(NEAR_SIDE_ART.map(art => art.sourceSvg)).size).toBe(6)
    const old = new Set(REFINED_ISLAND_ART.map(art => art.sourceSvg))
    for (const art of NEAR_SIDE_ART) {
      expect(old.has(art.sourceSvg)).toBe(false)
      expect(normalizeStaticSvg(art.sourceSvg).viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
      expect(art.presentation.mode).toBe('nearSide')
      expect(art.presentation.rootAnchorMm.y).toBeGreaterThan(0)
      expect(art.presentation.rootAnchorMm.y).toBeLessThan(art.heightMm / 2)
      expect(pointInPolygon({ x: 0, y: 0 }, art.presentation.groundShadowMm!)).toBe(true)
      expect(art.footprintMm!.width).toBeLessThan(art.widthMm)
    }
    expect(NEAR_SIDE_LICENSE).toContain('MIT License')
  })

  it('keeps old definitions, original terrain and root positions unchanged before actual materialization', () => {
    const old = createRefinedIslandDocument(), source = createNearSideSourceDocument()
    expect(source.terrainAreas).toEqual(old.terrainAreas)
    expect(source.terrainConnections).toEqual(old.terrainConnections)
    expect(source.props).toEqual(old.props)
    for (const [id, definition] of Object.entries(old.propDefinitions)) expect(source.propDefinitions[id]).toEqual(definition)
    expect(Object.keys(source.assets)).toHaveLength(19)
    for (const art of NEAR_SIDE_ART) {
      expect(source.assets[nearSideAssetId(art.key)].origin.canEmbed).toBe(true)
      expect(source.propDefinitions[nearSideDefinitionId(art.key)]).toMatchObject({ version: 1, defaultFootprintOffsetMm: { x: 0, y: 0 } })
    }
  })

  it('cancels before rasterization or publishing any candidate', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(createNearSideIslandProject(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
