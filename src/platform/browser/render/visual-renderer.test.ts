import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Projection } from '../../../shared/projection/types.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { applyVisualFilters, drawVisualAtmosphere, drawVisualBoundaries } from './visual-renderer'
import { lightVisibilityPolygon, occluderSegments, windowVisibilityPolygon } from './visual-geometry'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import type { VisualBoundary } from '../../../shared/visual/types.js'
import { applyArtStyleGrades, captureLineArtEdges } from './art-style-grade.js'
import { activeArtStyles, defaultSceneArtStyle } from '../../../shared/visual/art-style.js'
import { neutralColorFilter } from '../../../shared/visual/color-filter.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function projection(): Projection {
  return { audience: 'gm', sourceRevision: 0, bounds: { x: 0, y: 0, width: 400, height: 400 }, gridSizeMm: null,
    rooms: [], terrain: [], walls: [], props: [], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [], theme: null, materials: {}, assetIds: [], limitations: [], diagnostics: [],
    visual: { environment: emptyVisualSystem().environment, boundsMm: { x: 0, y: 0, width: 400, height: 400 }, boundaries: [], edgeLooks: [], lights: [], fogs: [], filters: [], suppressedTerrainEdgeIds: [], occluderRings: [], contactRings: [] } }
}
function pixelContext(pixel: number[], width = 4, height = 4) {
  const data = Uint8ClampedArray.from(Array.from({ length: width * height }, () => pixel).flat())
  const ctx = { canvas: { width, height }, getImageData: vi.fn((x: number, y: number, w: number, h: number) => ({ width: w, height: h,
    data: Uint8ClampedArray.from(Array.from({ length: h }, (_, row) => [...data.slice(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4)]).flat()) })), putImageData: vi.fn((image: ImageData, x: number, y: number) => { data.set(image.data, (y * width + x) * 4) }) }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, data }
}
function addFilter(source: Projection) {
  source.visual!.filters.push({ id: 'filter', enabled: true, preset: 'neutral', exposure: 1, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 'fixed', targetRings: null, targetBoundsMm: { x: 0, y: 0, width: 400, height: 400 } })
  return source.visual!.filters[0]
}

describe('visual renderer bounded deterministic effects', () => {
  it('leaves native-v1 and neutral visual-v2 pixels untouched and allocates no effects', () => {
    const source = projection(), { ctx, data } = pixelContext([80, 90, 100, 255]), create = vi.fn()
    vi.stubGlobal('document', { createElement: create })
    addFilter(source)
    drawVisualAtmosphere(ctx, source)
    expect([...data.slice(0, 4)]).toEqual([80, 90, 100, 255])
    expect(ctx.getImageData).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled()
    delete source.visual
    drawVisualAtmosphere(ctx, source)
    expect(create).not.toHaveBeenCalled()
  })
  it('performs explicit color parameters and keeps alpha unchanged', () => {
    const source = projection(), { ctx, data } = pixelContext([200, 100, 50, 123]), filter = addFilter(source)
    filter.saturation = 0; filter.exposure = .5
    applyVisualFilters(ctx, source)
    const luma = Math.round((200 * .2126 + 100 * .7152 + 50 * .0722) * .5)
    expect([...data.slice(0, 4)]).toEqual([luma, luma, luma, 123])
  })
  it('produces the same curve mapping for a scoped filter, original and every theme on the same pixels', () => {
    const source = projection(), scoped = addFilter(source)
    const filter = neutralColorFilter()
    filter.curves.rgb.splice(1, 0, { input: 128, output: 170 })
    filter.curves.blue.splice(1, 0, { input: 170, output: 99 })
    scoped.colorFilter = filter
    const matched = pixelContext([128, 128, 128, 123])
    applyVisualFilters(matched.ctx, source)
    expect([...matched.data.slice(0, 4)]).toEqual([170, 170, 99, 123])
    for (const active of ['original', 'handDrawn', 'tea', 'lineArt'] as const) {
      const style = { ...defaultSceneArtStyle(), active }
      if (active === 'original') style.original = filter
      else {
        style.presets[active].filter = filter
        style.presets[active].effects.enabled = false
      }
      const result = pixelContext([128, 128, 128, 123])
      applyArtStyleGrades(result.ctx, source.bounds, activeArtStyles(style)!)
      expect(result.data).toEqual(matched.data)
    }
  })
  it('scales the atmosphere grade for a partial line art look and omits it at full line art strength', () => {
    const source = projection(), { ctx, data } = pixelContext([120, 100, 80, 123]), filter = addFilter(source)
    filter.exposure = .5
    drawVisualAtmosphere(ctx, source, undefined, false, .5)
    expect([...data.slice(0, 4)]).toEqual([90, 75, 60, 123])
    drawVisualAtmosphere(ctx, source, undefined, false, 0)
    expect([...data.slice(0, 4)]).toEqual([90, 75, 60, 123])
  })
  it('uses world grain phase for the same crop at the same scale', () => {
    const full = projection(), filter = addFilter(full); filter.grain = .2
    const a = pixelContext([128, 128, 128, 255]); applyVisualFilters(a.ctx, full)
    const crop = structuredClone(full); crop.bounds = { x: 200, y: 0, width: 200, height: 400 }
    const b = pixelContext([128, 128, 128, 255], 2, 4); applyVisualFilters(b.ctx, crop)
    for (let y = 0; y < 4; y++) expect([...b.data.slice(y * 8, y * 8 + 8)]).toEqual([...a.data.slice(y * 16 + 8, y * 16 + 16)])
  })
  it('keeps full occlusion closure even when editor props are culled', () => {
    const source = projection()
    source.visual!.occluderRings = [[{ x: 100, y: -1000 }, { x: 200, y: -1000 }, { x: 200, y: 1000 }, { x: 100, y: 1000 }]]
    const blockers = occluderSegments(source.visual!)
    expect(blockers).toHaveLength(4)
    expect(lightVisibilityPolygon({ x: 0, y: 0 }, 500, blockers).every(p => p.x <= 100.000001)).toBe(true)
    expect(source.props).toEqual([])
  })
  it('casts parallel aperture shadows along the actual blocker, with clear rays beside it', () => {
    const p = (x: number, y: number) => ({ x, y })
    const beam = [p(100, 100), p(300, 100), p(360, 400), p(40, 400)]
    const visibility = windowVisibilityPolygon(beam, [{ start: p(175, 210), end: p(230, 210) }])
    expect(pointInPolygon(p(200, 170), visibility)).toBe(true)
    expect(pointInPolygon(p(200, 280), visibility)).toBe(false)
    expect(pointInPolygon(p(130, 280), visibility)).toBe(true)
    expect(pointInPolygon(p(270, 280), visibility)).toBe(true)
  })
  it('checks cancellation before a filter readback', () => {
    const source = projection(), filter = addFilter(source), controller = new AbortController(), { ctx } = pixelContext([128, 128, 128, 255])
    filter.contrast = .8; controller.abort()
    expect(() => applyVisualFilters(ctx, source, controller.signal)).toThrow()
    expect(ctx.getImageData).not.toHaveBeenCalled()
  })
})

it('excludes even partially masked pixels when finding neighboring line art contours', () => {
  const light = pixelContext([140, 140, 140, 255], 4, 1)
  const dark = pixelContext([140, 140, 140, 255], 4, 1)
  light.data.set([255, 255, 255, 255], 4)
  dark.data.set([0, 0, 0, 255], 4)
  const mask = pixelContext([0, 0, 0, 0], 4, 1)
  mask.data[7] = 1
  const bounds = { x: 0, y: 0, width: 128, height: 32 }
  expect(captureLineArtEdges(light.ctx, bounds)).not.toEqual(captureLineArtEdges(dark.ctx, bounds))
  expect(captureLineArtEdges(light.ctx, bounds, undefined, { mask: mask.ctx }))
    .toEqual(captureLineArtEdges(dark.ctx, bounds, undefined, { mask: mask.ctx }))
})

describe('materialized edges share the surface detail pass', () => {
  function surfaceFixture() {
    const source = projection(), visual = source.visual!
    const common = { floorId: 'floor', layerId: 'layer', visibility: 'public' as const, editLocked: false }
    const boundary: VisualBoundary = { ...common, id: 'boundary', closed: false, sampleSpacingMm: 100, toleranceMm: 10, binding: { kind: 'decoration' },
      segments: [{ id: 'segment', start: { x: 10, y: 100 }, control1: { x: 110, y: 100 }, control2: { x: 290, y: 100 }, end: { x: 390, y: 100 } }] }
    visual.boundaries = [{ id: boundary.id, ...sampleVisualBoundary(boundary), terrainAreaIds: [] }]
    visual.edgeLooks = [{ ...common, id: 'look', boundaryId: boundary.id, kind: 'path', side: 'right', widthMm: 50, color: '#00AA00',
      accentColor: '#003300', opacity: 1, intensity: 0, seed: 'paint-order', repeatMm: 100, enabled: true }]
    const ring = [{ x: 50, y: 80 }, { x: 350, y: 80 }, { x: 350, y: 130 }, { x: 50, y: 130 }]
    visual.materializedEdges = [
      { id: 'low', kind: 'grass', polygons: [ring], strokes: [], fillColor: '#AA0000', opacity: .8 },
      { id: 'high', kind: 'shore', polygons: [ring], strokes: [{ id: 'line', pointsMm: [{ x: 50, y: 100 }, { x: 350, y: 100 }], widthMm: 20, color: '#FFFFFF', opacity: .5 }], fillColor: '#0000AA', opacity: .6 },
    ]
    visual.edgePaintOrder = [{ kind: 'materializedEdge', id: 'low' }, { kind: 'edgeLook', id: 'look' }, { kind: 'materializedEdge', id: 'high' }]
    class TestPath { moveTo() {} lineTo() {} closePath() {} rect() {} }
    vi.stubGlobal('Path2D', TestPath)
    const fills: { color: string; alpha: number }[] = [], strokes: { color: string; alpha: number; width: number; cap: string }[] = []
    const properties = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineJoin: '', lineCap: 'round' }
    const ctx = Object.assign(properties, { save: vi.fn(), restore: vi.fn(),
      fill: vi.fn(() => fills.push({ color: properties.fillStyle, alpha: properties.globalAlpha })),
      stroke: vi.fn(() => strokes.push({ color: properties.strokeStyle, alpha: properties.globalAlpha, width: properties.lineWidth, cap: properties.lineCap })) })
    return { source, ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes }
  }

  it('draws both representations in the audience-owned layer order and preserves saved opacity/width', () => {
    const { source, ctx, fills, strokes } = surfaceFixture()
    drawVisualBoundaries(ctx, source)
    expect(fills).toEqual([{ color: '#AA0000', alpha: .8 }, { color: '#00AA00', alpha: 1 }, { color: '#0000AA', alpha: .6 }])
    expect(strokes.at(-1)).toEqual({ color: '#FFFFFF', alpha: .3, width: 20, cap: 'butt' })
    source.visual!.edgePaintOrder!.reverse(); fills.length = 0; strokes.length = 0
    drawVisualBoundaries(ctx, source)
    expect(fills.map(fill => fill.color)).toEqual(['#0000AA', '#00AA00', '#AA0000'])
  })

  it('checks cancellation before drawing materialized geometry', () => {
    const { source, ctx, fills } = surfaceFixture(), controller = new AbortController()
    controller.abort()
    expect(() => drawVisualBoundaries(ctx, source, controller.signal)).toThrow()
    expect(fills).toEqual([])
  })
})
