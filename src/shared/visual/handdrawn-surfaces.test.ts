import { describe, expect, it } from 'vitest'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../ai/svg.js'
import { sha256Text } from '../validation/hash.js'
import { HANDDRAWN_SURFACE_ART, HANDDRAWN_SURFACE_LICENSE, HANDDRAWN_SURFACE_LICENSE_REF,
  generateHanddrawnSurfaceSvg, type HanddrawnSurfaceFamily } from './handdrawn-surfaces.js'

const families: HanddrawnSurfaceFamily[] = ['oak', 'limestone', 'basalt', 'plaster']
const seeds = [219, 433, 791, 1031]

describe('bounded original handdrawn surfaces', () => {
  it('produces safe complete opaque tiles for multiple seeds without external content or filters', () => {
    for (const family of families) for (const seed of [0, 1, 491, 0xffffffff]) {
      const svg = generateHanddrawnSurfaceSvg(family, seed), normalized = normalizeStaticSvg(svg)
      expect(normalized.viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
      expect(svg).toMatch(/<rect x="0" y="0" width="512" height="512" fill="#[0-9A-F]{6}"\/>/)
      expect(svg).not.toMatch(/<(?:filter|image|script|foreignObject|clipPath)\b|href=|data:|NaN|Infinity/)
      expect(normalized.pathCount).toBeLessThan(70)
      expect(normalized.nodeCount).toBeLessThan(75)
      expect(normalized.pathCommandCount).toBeLessThan(STATIC_SVG_LIMITS.pathCommands / 2)
      expect(normalized.sourceSizeBytes).toBeLessThan(150_000)
      expect(normalizeStaticSvg(normalized.normalizedSource).normalizedSource).toBe(normalized.normalizedSource)
    }
  })

  it('keeps independent fixed sources, calibrated physical dimensions and deterministic replay', () => {
    expect(HANDDRAWN_SURFACE_ART.map(art => [art.key, art.widthMm, art.heightMm])).toEqual([
      ['weathered-oak', 6400, 6400], ['old-limestone-flags', 4800, 4800], ['dark-basalt-flags', 4800, 4800], ['warm-plaster', 3600, 3600],
    ])
    for (const [index, art] of HANDDRAWN_SURFACE_ART.entries()) {
      expect(art.kind).toBe('material')
      expect(art.sourceSvg).toBe(generateHanddrawnSurfaceSvg(families[index], seeds[index]))
      expect(generateHanddrawnSurfaceSvg(families[index], seeds[index] + 1)).not.toBe(art.sourceSvg)
      expect(Object.isFrozen(art)).toBe(true)
      expect(Object.isFrozen(art.tags)).toBe(true)
    }
    expect(HANDDRAWN_SURFACE_ART.map(art => sha256Text(art.sourceSvg))).toEqual([
      "bd7520777588cc169ee55d21abaa05a08b5162b710524b73d3066b0594826da7",
      "774f9ba7fadd0e6c90c0e714cd4d05b7c9c7f8e776d789d99fb4c4315d3187a8",
      "123b3228637193813dcc392f0e462b75e752b571fc37cbb2adb43721d3ea313e",
      "9f4d3e747a4052eeb6e54ed82c407028daf30d014a26d91acf18df9f4ad6b4df"
])
    expect(HANDDRAWN_SURFACE_LICENSE_REF).toBe('MIT-Sceneweave-Handdrawn-Surfaces-1')
    expect(HANDDRAWN_SURFACE_LICENSE).toContain('Copyright (c) 2026 Sceneweave contributors')
    expect(HANDDRAWN_SURFACE_LICENSE).toContain('Permission is hereby granted, free of charge')
    expect(HANDDRAWN_SURFACE_LICENSE).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  })

  it('rejects unbounded or unsupported generator inputs', () => {
    for (const seed of [-1, .2, Infinity, NaN, 0x100000000]) expect(() => generateHanddrawnSurfaceSvg('oak', seed)).toThrow(/Invalid/)
    expect(() => generateHanddrawnSurfaceSvg('unknown' as HanddrawnSurfaceFamily, 1)).toThrow(/Invalid/)
  })
})
