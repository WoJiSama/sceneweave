import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Projection } from '../../../shared/projection/types.js'
import { renderRasterProjection } from './canvas-renderer.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function projection(outlineMm = 0, shadowOpacity = 0): Projection {
  const shadow = { directionDeg: 45, offsetMm: 60, blurMm: 25, opacity: 0, color: '#000000' }
  const edge = { strokeWidthMm: 10, color: '#39443E', bandWidthMm: 30 }
  const theme: Projection['theme'] = {
    outline: { widthMm: outlineMm, color: '#39443E' },
    openingStyle: { doorStrokeWidthMm: 24, windowStrokeWidthMm: 18, frameWidthMm: 60, doorFill: '#8B7355', windowFill: '#B2CBCC' },
    shadowPresets: { none: { ...shadow }, furniture: { ...shadow }, vegetation: { ...shadow }, wall: { ...shadow, opacity: shadowOpacity } },
    edgeStyles: { shore: { ...edge }, cliff: { ...edge }, materialTransition: { ...edge }, path: { ...edge } },
    terrainCliff: { directionDeg: 45, offsetFactor: .5, maxOffsetMm: 200, blurMm: 25, opacity: 0, color: '#000000' },
  }
  return { audience: 'gm', sourceRevision: 0, bounds: { x: 0, y: 0, width: 1000, height: 1000 }, gridSizeMm: null,
    rooms: [], terrain: [], props: [], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [],
    walls: [{ id: 'wall', sourceIds: ['wall'], start: { x: 100, y: 100 }, end: { x: 900, y: 100 }, thicknessMm: 100, style: null, openings: [] }],
    theme, materials: {}, assetIds: [], limitations: [], diagnostics: [] }
}

/** Allocation/cleanup checks only; actual alpha, joins and shadows are checked in Chrome. */
function surfaces(failContextAt = -1) {
  const allocated: { width: number; height: number; context: Record<string, unknown> }[] = []
  vi.stubGlobal('document', { createElement: () => {
    const index = allocated.length, output = { width: 0, height: 0, context: {} as Record<string, unknown>,
      getContext: () => index === failContextAt ? null : output.context }
    output.context = new Proxy({ canvas: output }, { get: (target, key: string) => {
      const values = target as Record<string, unknown>
      return key in values ? values[key] : values[key] = vi.fn()
    } })
    allocated.push(output); return output
  } })
  vi.stubGlobal('createImageBitmap', vi.fn())
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} closePath() {} })
  return allocated
}
const sources = { assetRefs: {}, assets: {}, resources: { read: async () => { throw new Error('No image resources in this fixture.') } } }
const options = { audience: 'gm' as const, longEdgePx: 4096 }

describe('wall paint transient surface budget', () => {
  it.each([
    { outline: 0, shadow: 0, count: 2 },
    { outline: 0, shadow: .4, count: 4 },
    { outline: 24, shadow: 0, count: 4 },
    { outline: 24, shadow: .4, count: 4 },
  ])('uses $count surfaces for outline $outline and wall shadow $shadow', async ({ outline, shadow, count }) => {
    const allocated = surfaces(), output = await renderRasterProjection(sources, projection(outline, shadow), options)
    expect(allocated).toHaveLength(count)
    expect([output.width, output.height]).toEqual([4096, 4096])
    expect(allocated.slice(1).every(surface => surface.width === 0 && surface.height === 0)).toBe(true)
    output.width = output.height = 0
  })

  it('allocates no wall surfaces when the audience projection has no walls', async () => {
    const allocated = surfaces(), source = projection(); source.walls = []
    const output = await renderRasterProjection(sources, source, options)
    expect(allocated).toHaveLength(1); output.width = output.height = 0
  })

  it.each([0, 1, 2, 3])('releases every allocated surface after context %i fails', async failAt => {
    const allocated = surfaces(failAt)
    await expect(renderRasterProjection(sources, projection(24, .4), options)).rejects.toThrow(/Canvas/)
    expect(allocated.every(surface => surface.width === 0 && surface.height === 0)).toBe(true)
  })

  it('releases the color-only path after a wall fill fails', async () => {
    const allocated = surfaces()
    const wall = projection().walls[0]
    Object.defineProperty(wall, 'style', { get: () => { throw new Error('wall paint failed') } })
    const source = projection(); source.walls = [wall]
    await expect(renderRasterProjection(sources, source, options)).rejects.toThrow('wall paint failed')
    expect(allocated).toHaveLength(2)
    expect(allocated.every(surface => surface.width === 0 && surface.height === 0)).toBe(true)
  })
})
