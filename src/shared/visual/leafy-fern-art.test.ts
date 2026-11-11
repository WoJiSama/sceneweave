import { describe, expect, it } from 'vitest'
import { normalizeStaticSvg } from '../ai/svg.js'
import { sha256Text } from '../validation/hash.js'
import { VEGETATION_DETAIL_ART, VEGETATION_DETAIL_SPECS } from './vegetation-detail-art.js'
import { LEAFY_FERN_ART, LEAFY_FERN_PINNAE, LEAFY_FERN_SPEC, LEAFY_FERN_LICENSE, LEAFY_FERN_LICENSE_REF } from './leafy-fern-art.js'

describe('independent fixed leafy fern source',()=>{
  it('has actual closed leaf surfaces with substantial area and freezes the old six source hashes',()=>{
    const art=LEAFY_FERN_ART[0]
    expect(normalizeStaticSvg(art.sourceSvg).viewBox).toEqual({x:0,y:0,width:512,height:512})
    expect(sha256Text(art.sourceSvg)).toBe('20449908d2d00457c4df2cf3dc06f66c6ad0f837298c0822fcb5e15066d06b79')
    expect(LEAFY_FERN_PINNAE).toHaveLength(98)
    for(const leaf of LEAFY_FERN_PINNAE) {
      // Exact area between the two quadratic curves sharing their endpoints.
      // The former almost coincident curves produced tiny fills under the stroke.
      const a={x:leaf.outwardControl.x-leaf.inwardControl.x,y:leaf.outwardControl.y-leaf.inwardControl.y},b={x:leaf.tip.x-leaf.start.x,y:leaf.tip.y-leaf.start.y}
      expect(Math.abs(a.x*b.y-a.y*b.x)/3).toBeGreaterThan(200)
      for(const p of [leaf.start,leaf.tip,leaf.outwardControl,leaf.inwardControl]) {expect(p.x).toBeGreaterThan(8);expect(p.x).toBeLessThan(504);expect(p.y).toBeGreaterThan(8);expect(p.y).toBeLessThan(504)}
      expect(art.sourceSvg).toContain(`Z" fill="${leaf.fill}"`)
    }
    expect(new Set(LEAFY_FERN_PINNAE.map(leaf=>leaf.fill)).size).toBe(7)
    expect(art.sourceSvg).not.toMatch(/<(?:rect|image|foreignObject|filter|script)\b|href=|data:/)
    expect(VEGETATION_DETAIL_ART.map(old=>sha256Text(old.sourceSvg))).toEqual([
      '4f1c950e9a7eec6800fb345e514431c009977336992f219bcb74f4b23314273d',
      'fbac1f018f3e0e3e9b5132eaa283097f7550147ea07294315cdecaad121a2c0c',
      '16301567ed72f975c598fd70cf7f99d8e7f7b763cfd719f4fec174f7bc75f88c',
      '1371a50535b5b9e58a9dbb3fdf5eb8ab85eda6ee5d2fa8393f3a3d4f2c38ab83',
      'ee5e7e8494eec24b28b7183f726bc1445bae3dd69e24e391581695f61dffe926',
      '8ab4bfa64e9670d0914106e9d01c881f3e77f25043ecc6007ce15a8d33f2ef4a',
    ])
    expect(VEGETATION_DETAIL_SPECS.some(old=>old.assetId===LEAFY_FERN_SPEC.assetId||old.definitionId===LEAFY_FERN_SPEC.definitionId||old.key===LEAFY_FERN_SPEC.key)).toBe(false)
  })

  it('keeps an explicit calibrated root, separate physical footprint and complete standalone embedding licence',()=>{
    const art=LEAFY_FERN_ART[0],spec=LEAFY_FERN_SPEC
    expect(LEAFY_FERN_ART).toHaveLength(1);expect(spec.version).toBe(1)
    expect(spec.rootPixel).toEqual({x:256,y:288})
    expect(Math.abs(spec.visualBoundsMm.x+spec.rootPixel.x/512*spec.widthMm)).toBeLessThanOrEqual(.5)
    expect(Math.abs(spec.visualBoundsMm.y+spec.rootPixel.y/512*spec.heightMm)).toBeLessThanOrEqual(.5)
    expect(spec.footprintMm).toEqual({width:420,height:420})
    expect(spec.blocksMovement).toBe(false);expect(spec.blocksSight).toBe(false);expect(spec.shadowClass).toBe('none');expect(spec.renderLayer).toBe('ground')
    expect(art.presentation).toEqual({mode:'topDown',rootAnchorMm:{x:0,y:0},orientation:'rotateWithGround',groundShadowMm:null})
    expect(Object.isFrozen(LEAFY_FERN_PINNAE[0].outwardControl)).toBe(true);expect(Object.isFrozen(art)).toBe(true);expect(Object.isFrozen(spec.footprintMm)).toBe(true)
    expect(LEAFY_FERN_LICENSE_REF).toBe('MIT-Sceneweave-Leafy-Fern-1')
    expect(LEAFY_FERN_LICENSE).toContain('Copyright (c) 2026 Sceneweave contributors')
    expect(LEAFY_FERN_LICENSE).toContain('Permission is hereby granted, free of charge')
    expect(LEAFY_FERN_LICENSE).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  })
})
