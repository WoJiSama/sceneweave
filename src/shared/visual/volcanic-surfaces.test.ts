import { describe, expect, it } from 'vitest'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../ai/svg.js'
import { VOLCANIC_SURFACE_ART, VOLCANIC_SURFACE_LICENSE, generateVolcanicSurfaceSvg, type VolcanicSurfaceFamily } from './volcanic-surfaces.js'

const families: VolcanicSurfaceFamily[] = ['ash', 'basalt', 'cold-lava', 'molten-lava', 'worn-ash']
describe('independent natural volcanic paint', () => {
  it('keeps deterministic opaque, safe artwork within the static SVG workload', () => {
    for (const family of families) for (const seed of [0, 1783, 0xffffffff]) {
      const svg = generateVolcanicSurfaceSvg(family, seed), source = normalizeStaticSvg(svg)
      expect(source.viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
      expect(svg).toMatch(/<rect x="0" y="0" width="512" height="512" fill="#[0-9A-F]{6}"\/>/)
      expect(svg).not.toMatch(/<(?:filter|image|script|foreignObject|clipPath)\b|href=|data:|NaN|Infinity/)
      expect(source.pathCommandCount).toBeLessThan(STATIC_SVG_LIMITS.pathCommands)
      expect(source.sourceSizeBytes).toBeLessThan(250_000)
      expect(normalizeStaticSvg(source.normalizedSource).normalizedSource).toBe(source.normalizedSource)
      expect(generateVolcanicSurfaceSvg(family, seed)).toBe(svg)
    }
  })
  it('uses broad independently fixed sources and keeps appearance separate from physical policy', () => {
    expect(VOLCANIC_SURFACE_ART.map(art => [art.key, art.widthMm, art.heightMm])).toEqual([
      ['wind-laid-ash', 8000, 8000], ['fractured-basalt', 8000, 8000], ['cooled-lava-crust', 7000, 7000],
      ['molten-lava', 5600, 5600], ['worn-ash-path', 6000, 6000],
    ])
    const seeds = [1783, 2843, 3767, 4657, 5741]
    for (const [index, art] of VOLCANIC_SURFACE_ART.entries()) {
      expect(art.kind).toBe('material'); expect(Object.isFrozen(art)).toBe(true)
      expect(art.blocksMovement).toBeUndefined(); expect(art.blocksSight).toBeUndefined()
      expect(art.sourceSvg).toBe(generateVolcanicSurfaceSvg(families[index], seeds[index]))
      expect(generateVolcanicSurfaceSvg(families[index], seeds[index] + 1)).not.toBe(art.sourceSvg)
    }
    expect(VOLCANIC_SURFACE_LICENSE).toContain('No third-party imagery is embedded')
  })
  it('rejects unsupported paint or unsafe seeds', () => {
    for (const seed of [-1, .4, Infinity, NaN, 0x100000000]) expect(() => generateVolcanicSurfaceSvg('ash', seed)).toThrow(/Invalid/)
    expect(() => generateVolcanicSurfaceSvg('unknown' as VolcanicSurfaceFamily, 0)).toThrow(/Invalid/)
  })
})
