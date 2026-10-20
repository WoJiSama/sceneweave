import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MaterialPaint } from '../../core/v2/types'
import { imageProject } from '../../io/v2/test-fixtures'
import { renderProjectV2 } from './renderer'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture() {
  const project = await imageProject(), scene = project.document
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.props = {}; scene.notes = {}; scene.regions = {}
  scene.constraints.entranceOpeningIds = []; scene.units.gridVisible = false
  scene.exportBoundsMm = { x: 0, y: 0, width: 4000, height: 4000 }
  scene.floors['f-a1'].boundsMm = { ...scene.exportBoundsMm }
  scene.materials['test-material'].applicableSurfaces = ['terrain']
  const paint: MaterialPaint = { materialRef: { id: 'test-material', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 30, alignment: 'world', originMm: { x: 120, y: -50 }, tint: null, opacity: 1 }
  // Consecutive A/A exercises a hit; A/B/A requires fresh replacements, including a tinted paint.
  for (const [index, tint] of [null, null, '#809070', null].entries()) {
    const id = `surface-${index}`, x = 100 + index * 900
    scene.terrainAreas[id] = { id, floorId: 'f-a1', editLocked: false, visibility: 'public', groundElevationMm: 0, coveragePriority: 1,
      boundaryMm: [{ x, y: 500 }, { x: x + 700, y: 500 }, { x: x + 700, y: 1500 }, { x, y: 1500 }].map((positionMm, i) => ({ id: `${id}-v${i}`, segmentId: `${id}-s${i}`, positionMm })),
      surfaceStyle: { base: { ...paint, tint }, overlays: [] }, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  }
  return project
}

/** Browser primitives are instrumented for ownership/state checks only; real pixels are verified separately. */
function primitives(options: { failPaintContext?: boolean; failPatternAt?: number; failPaintFillAt?: number; abortOnPaint?: { controller: AbortController; atFill: number } } = {}) {
  type Surface = { width: number; height: number; getContext: ReturnType<typeof vi.fn> }
  const surfaces: Surface[] = [], trace: { surface: number; action: string; args?: unknown[] }[] = []
  const paints: number[] = [], copies: { destination: number; source: Surface; sourceWidth: number; sourceHeight: number }[] = []
  let peakLiveSurfaces = 0, patternCalls = 0, paintFills = 0
  const updatePeak = () => { peakLiveSurfaces = Math.max(peakLiveSurfaces, surfaces.filter(surface => surface.width > 0 && surface.height > 0).length) }
  const close = vi.fn(), decode = vi.fn(async () => ({ width: 1, height: 1, close }))
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} closePath() {} })
  vi.stubGlobal('DOMMatrix', class { translate() { return this } rotate() { return this } scale() { return this } })
  vi.stubGlobal('document', { createElement: vi.fn(() => {
    const index = surfaces.length
    let width = 0, height = 0
    const surface: Surface = {
      get width() { return width }, set width(value) { width = value; updatePeak() },
      get height() { return height }, set height(value) { height = value; updatePeak() },
      getContext: vi.fn(),
    }
    surfaces.push(surface)
    const action = (name: string, args?: unknown[]) => trace.push({ surface: index, action: name, args })
    const ctx = {
      canvas: surface, fillStyle: '' as unknown, globalAlpha: 1, globalCompositeOperation: 'source-over',
      save: vi.fn(), restore: vi.fn(), clip: vi.fn(),
      setTransform: vi.fn((...args: unknown[]) => action('setTransform', args)),
      resetTransform: vi.fn(() => action('resetTransform')),
      clearRect: vi.fn((...args: unknown[]) => action('clearRect', args)),
      createPattern: vi.fn(() => {
        patternCalls++; action('createPattern')
        if (!paints.includes(index)) paints.push(index)
        return patternCalls === options.failPatternAt ? null : { setTransform: vi.fn(() => action('patternTransform')) }
      }),
      fillRect: vi.fn(() => {
        action('fillRect', [ctx.globalCompositeOperation])
        if (paints.includes(index)) {
          paintFills++
          if (paintFills === options.abortOnPaint?.atFill) options.abortOnPaint.controller.abort()
          if (paintFills === options.failPaintFillAt) throw new Error('paint failed')
        }
      }),
      drawImage: vi.fn((source: Surface) => { copies.push({ destination: index, source, sourceWidth: source.width, sourceHeight: source.height }) }),
    }
    surface.getContext.mockImplementation(() => options.failPaintContext && index === 1 ? null : ctx)
    return surface
  }) })
  return { surfaces, trace, paints, copies, close, decode, peakLiveSurfaces: () => peakLiveSurfaces }
}

describe('per-render single paint canvas ownership', () => {
  it('keeps a key hit, disposes each changed paint before replacement, and preserves the returned output', async () => {
    const project = await fixture(), before = structuredClone(project.document), browser = primitives()
    const output = await renderProjectV2(project, { audience: 'gm', longEdgePx: 256 })
    expect(browser.surfaces).toHaveLength(4); expect(browser.paints).toEqual([1, 2, 3]); expect(browser.peakLiveSurfaces()).toBe(2)
    expect(browser.copies).toHaveLength(4)
    for (const [index, copy] of browser.copies.entries()) {
      expect(copy.destination).toBe(0); expect(copy.source).toBe(browser.surfaces[[1, 1, 2, 3][index]])
      expect([copy.sourceWidth, copy.sourceHeight]).toEqual([256, 256])
    }
    for (const surface of browser.paints) {
      const events = browser.trace.filter(event => event.surface === surface)
      expect(events.filter(event => event.action === 'createPattern')).toHaveLength(1)
      expect(events.filter(event => event.action === 'fillRect').map(event => event.args)).toEqual(surface === 2 ? [['source-over'], ['multiply']] : [['source-over']])
      expect(browser.surfaces[surface].width).toBe(0); expect(browser.surfaces[surface].height).toBe(0)
    }
    expect(output).toBe(browser.surfaces[0]); expect(output.width).toBe(256); expect(output.height).toBe(256)
    expect(browser.close).toHaveBeenCalledOnce(); expect(project.document).toEqual(before)
  })

  it('starts with a fresh bitmap and paint surface for another render and audience', async () => {
    const project = await fixture(), browser = primitives()
    const gm = await renderProjectV2(project, { audience: 'gm', longEdgePx: 256 })
    const player = await renderProjectV2(project, { audience: 'player', longEdgePx: 256 })
    expect(browser.surfaces).toHaveLength(8); expect(browser.paints).toEqual([1, 2, 3, 5, 6, 7])
    expect(gm).not.toBe(player); expect(gm.width).toBe(256); expect(player.width).toBe(256)
    for (const surface of browser.paints) { expect(browser.surfaces[surface].width).toBe(0); expect(browser.surfaces[surface].height).toBe(0) }
    expect(browser.decode).toHaveBeenCalledTimes(2); expect(browser.close).toHaveBeenCalledTimes(2)
  })

  it('owns a newly allocated paint surface before a context failure', async () => {
    const project = await fixture(), browser = primitives({ failPaintContext: true }), onMetrics = vi.fn()
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics })).rejects.toThrow('无法分配 sRGB Canvas')
    expect(browser.surfaces).toHaveLength(2)
    expect(browser.surfaces.every(surface => surface.width === 0 && surface.height === 0)).toBe(true)
    expect(browser.close).toHaveBeenCalledOnce(); expect(onMetrics).not.toHaveBeenCalled()
  })

  it.each([1, 2])('releases all owned surfaces when pattern creation fails at paint %s', async failPatternAt => {
    const project = await fixture(), browser = primitives({ failPatternAt }), onMetrics = vi.fn()
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics })).rejects.toThrow('无法建立重复材质')
    expect(browser.surfaces).toHaveLength(failPatternAt + 1); expect(browser.peakLiveSurfaces()).toBe(2)
    expect(browser.surfaces.every(surface => surface.width === 0 && surface.height === 0)).toBe(true)
    expect(browser.close).toHaveBeenCalledOnce(); expect(onMetrics).not.toHaveBeenCalled()
  })

  it('releases the replacement paint and output after a later fill fails', async () => {
    const project = await fixture(), browser = primitives({ failPaintFillAt: 2 }), onMetrics = vi.fn()
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics })).rejects.toThrow('paint failed')
    expect(browser.surfaces).toHaveLength(3); expect(browser.peakLiveSurfaces()).toBe(2)
    expect(browser.surfaces.every(surface => surface.width === 0 && surface.height === 0)).toBe(true)
    expect(browser.close).toHaveBeenCalledOnce(); expect(onMetrics).not.toHaveBeenCalled()
  })

  it('releases the replacement paint and decoded bitmap when cancelled during later painting', async () => {
    const project = await fixture(), controller = new AbortController(), browser = primitives({ abortOnPaint: { controller, atFill: 2 } }), onMetrics = vi.fn()
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256, signal: controller.signal, onMetrics })).rejects.toMatchObject({ name: 'AbortError' })
    // Terrain submission is synchronous; cancellation is observed at the next render checkpoint.
    expect(browser.surfaces).toHaveLength(4); expect(browser.peakLiveSurfaces()).toBe(2)
    expect(browser.surfaces.every(surface => surface.width === 0 && surface.height === 0)).toBe(true)
    expect(browser.close).toHaveBeenCalledOnce(); expect(onMetrics).not.toHaveBeenCalled()
  })
})
