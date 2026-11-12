import { describe, expect, it } from 'vitest'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../ai/svg.js'
import { ARCHITECTURAL_WALL_ART, ARCHITECTURAL_WALL_LICENSE, ARCHITECTURAL_WALL_LICENSE_REF,
  generateArchitecturalWallSurfaceSvg, type ArchitecturalWallFamily } from './architectural-wall-surfaces.js'

const families: ArchitecturalWallFamily[] = ['plastered-brick', 'cast-concrete', 'warm-masonry', 'ruined-limestone']

describe('wall-top artwork at physical masonry scale', () => {
  it('keeps complete opaque, safe SVG sources within the supported raster workload', () => {
    for (const family of families) for (const seed of [0, 1597, 0xffffffff]) {
      const svg = generateArchitecturalWallSurfaceSvg(family, seed), normalized = normalizeStaticSvg(svg)
      expect(normalized.viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
      expect(svg).toMatch(/<rect x="0" y="0" width="512" height="512" fill="#[0-9A-F]{6}"\/>/)
      expect(svg).not.toMatch(/<(?:filter|image|script|foreignObject|clipPath)\b|href=|data:|NaN|Infinity/)
      expect(normalized.pathCommandCount).toBeLessThan(STATIC_SVG_LIMITS.pathCommands / 2)
      expect(normalized.sourceSizeBytes).toBeLessThan(150_000)
      expect(normalizeStaticSvg(normalized.normalizedSource).normalizedSource).toBe(normalized.normalizedSource)
    }
  })

  it('provides independently fixed, deterministic paint with joints at a readable wall scale', () => {
    expect(ARCHITECTURAL_WALL_ART.map(art => [art.key, art.widthMm, art.heightMm])).toEqual([
      ['old-house-plastered-brick', 1440, 1440], ['modern-cast-concrete', 1600, 1600],
      ['tavern-warm-masonry', 1440, 1440], ['ruins-fractured-limestone', 1440, 1440],
    ])
    const seeds = [1597, 2027, 3079, 4093]
    for (const [index, art] of ARCHITECTURAL_WALL_ART.entries()) {
      expect(art.kind).toBe('material')
      expect(art.sourceSvg).toBe(generateArchitecturalWallSurfaceSvg(families[index], seeds[index]))
      expect(generateArchitecturalWallSurfaceSvg(families[index], seeds[index] + 1)).not.toBe(art.sourceSvg)
      expect(Object.isFrozen(art)).toBe(true)
      expect(Object.isFrozen(art.tags)).toBe(true)
      // 240mm masonry courses and 400mm concrete formwork subdivisions remain
      // structural-scale marks, rather than sub-centimetre speckle alone.
      const courseMm = art.heightMm / (index === 1 ? 4 : 6)
      expect(courseMm).toBeGreaterThanOrEqual(240)
      expect(courseMm).toBeLessThanOrEqual(400)
    }
    expect(new Set(ARCHITECTURAL_WALL_ART.map(art => art.sourceSvg)).size).toBe(4)
    expect(ARCHITECTURAL_WALL_LICENSE_REF).toBe('MIT-Sceneweave-Architectural-Wall-Surfaces-1')
    expect(ARCHITECTURAL_WALL_LICENSE).toContain('Permission is hereby granted, free of charge')
  })

  it('rejects unsupported families and unbounded seeds', () => {
    for (const seed of [-1, .2, Infinity, NaN, 0x100000000]) expect(() => generateArchitecturalWallSurfaceSvg('warm-masonry', seed)).toThrow(/Invalid/)
    expect(() => generateArchitecturalWallSurfaceSvg('unknown' as ArchitecturalWallFamily, 1)).toThrow(/Invalid/)
  })
})
