import { describe, expect, it } from 'vitest'
import { normalizeStaticSvg } from '../ai/svg.js'
import { canonicalJson } from '../validation/json.js'
import { VEGETATION_DETAIL_ART, VEGETATION_DETAIL_SPECS, VEGETATION_DETAIL_LICENSE,
  vegetationDetailAssetId, vegetationDetailDefinitionId } from './vegetation-detail-art.js'
import { REFINED_ISLAND_ART } from './island-art.js'
import { THEME_PACK_ART } from './theme-pack-art.js'
const WILDERNESS_ART_V2 = THEME_PACK_ART.wilderness

describe('independent vegetation detail artwork v1', () => {
  it('fixes six genuinely distinct silhouettes and calibrated physical roles without replacing old sources', () => {
    const old = canonicalJson(REFINED_ISLAND_ART), wilderness = canonicalJson(WILDERNESS_ART_V2)
    expect(VEGETATION_DETAIL_ART).toHaveLength(6)
    expect(VEGETATION_DETAIL_ART.filter(art => art.role === 'tree')).toHaveLength(3)
    expect(VEGETATION_DETAIL_ART.filter(art => art.role === 'shrub')).toHaveLength(2)
    expect(VEGETATION_DETAIL_ART.filter(art => art.role === 'grass')).toHaveLength(1)
    const normalized = VEGETATION_DETAIL_ART.map(art => normalizeStaticSvg(art.sourceSvg))
    expect(new Set(normalized.map(svg => svg.normalizedSha256)).size).toBe(6)
    expect(new Set(VEGETATION_DETAIL_ART.map(art => `${art.widthMm}/${art.heightMm}`)).size).toBe(6)
    for (const art of VEGETATION_DETAIL_ART) {
      expect(art.sourceSvg).not.toMatch(/<(?:image|rect|foreignObject|script)\b/)
      expect(art.sourceSvg).toContain('viewBox="0 0 512 512"')
      expect(art.footprintMm!.width).toBeLessThan(art.widthMm)
      expect(art.footprintMm!.height).toBeLessThan(art.heightMm)
      expect(art.presentation).toEqual({ mode: 'topDown', rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround', groundShadowMm: null })
      expect(art.blocksMovement).toBe(art.role === 'tree'); expect(art.blocksSight).toBe(art.role === 'tree')
      expect(art.renderLayer === 'canopy').toBe(art.role === 'tree')
      expect(REFINED_ISLAND_ART.some(old => old.sourceSvg === art.sourceSvg)).toBe(false)
      expect(WILDERNESS_ART_V2.some(old => old.sourceSvg === art.sourceSvg)).toBe(false)
    }
    expect(canonicalJson(REFINED_ISLAND_ART)).toBe(old); expect(canonicalJson(WILDERNESS_ART_V2)).toBe(wilderness)
  })

  it('publishes immutable exact specs and a standalone embedding licence', () => {
    expect(VEGETATION_DETAIL_LICENSE).toContain('Copyright (c) 2026 Sceneweave contributors')
    expect(VEGETATION_DETAIL_LICENSE).toContain('Permission is hereby granted, free of charge')
    expect(VEGETATION_DETAIL_LICENSE).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
    expect(Object.isFrozen(VEGETATION_DETAIL_ART)).toBe(true)
    expect(Object.isFrozen(VEGETATION_DETAIL_ART[0].footprintMm)).toBe(true)
    for (const [index, spec] of VEGETATION_DETAIL_SPECS.entries()) {
      const art = VEGETATION_DETAIL_ART[index]
      expect(spec.assetId).toBe(vegetationDetailAssetId(art.key)); expect(spec.definitionId).toBe(vegetationDetailDefinitionId(art.key))
      expect(spec.version).toBe(1); expect(spec.footprintMm).toEqual(art.footprintMm)
    }
  })
})
