import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { initializeCanonicalSvgRasterizer, rasterizeCanonicalSvgPixels } from '../../platform/browser/ai/svg-raster.js'
import { normalizeStaticSvg } from '../ai/svg.js'
import { encodeCanonicalPng } from '../project/png-rgba.js'
import { imageVectorOptionsSchema, vectorizeImageLayer } from './vector.js'
import { extractImageLayer, type ImagePixels, type ImageRepairFill } from './pixels.js'

beforeAll(async () => { await initializeCanonicalSvgRasterizer(new Uint8Array(readFileSync(resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm')))) })
function image(width: number, height: number, color: (x: number, y: number) => number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4)
  return { width, height, data }
}
const rgba = (data: Uint8ClampedArray, width: number, x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
const options = (kind: 'trace' | 'wood' | 'rug', changes = {}) => imageVectorOptionsSchema.parse({ kind, ...changes })

describe('local source-vector reconstruction', () => {
  it('traces real compound paths preserving transparent holes and partial alpha through the fixed software renderer', async () => {
    const source = image(32, 24, (x, y) => {
      if (x < 2 || x >= 30 || y < 2 || y >= 22 || x >= 12 && x < 20 && y >= 8 && y < 16) return [0, 0, 0, 0]
      return x < 10 ? [30, 70, 130, 128] : [160, 80, 40, 255]
    })
    const before = source.data.slice(), result = vectorizeImageLayer(source, options('trace'))
    expect(result.sourceSvg).not.toMatch(/<(?:image|rect)\b|base64|data:/)
    expect(result.sourceSvg).toContain('fill-rule="evenodd"')
    expect(result.stats.paletteColors).toBe(2)
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 32, height: 24 })
    expect(rgba(raster.rgba, 32, 0, 0)).toEqual([0, 0, 0, 0])
    expect(rgba(raster.rgba, 32, 15, 12)).toEqual([0, 0, 0, 0])
    expect(rgba(raster.rgba, 32, 25, 12)).toEqual([160, 80, 40, 255])
    expect(rgba(raster.rgba, 32, 5, 12)[3]).toBe(128)
    expect(source.data).toEqual(before)
    expect(vectorizeImageLayer(source, options('trace'))).toEqual(result)
  })

  it('simplifies a stair-step contour within the requested tolerance and retains its inner hole', async () => {
    const source = image(64, 64, (x, y) => {
      const radius = Math.hypot(x - 31.5, y - 31.5)
      return radius < 27 && radius > 8 ? [70, 110, 140, 255] : [0, 0, 0, 0]
    })
    const precise = vectorizeImageLayer(source, options('trace', { simplifyPx: 0 }))
    const simplified = vectorizeImageLayer(source, options('trace', { simplifyPx: 1 }))
    expect(simplified.stats.pathCommandCount).toBeLessThan(precise.stats.pathCommandCount / 2)
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(simplified.sourceSvg), { width: 64, height: 64 })
    expect(rgba(raster.rgba, 64, 32, 32)[3]).toBe(0)
    expect(rgba(raster.rgba, 64, 32, 12)[3]).toBe(255)
  })

  it.each(['wood', 'rug'] as const)('builds a deterministic %s surface with editable vector texture and masked holes', async kind => {
    const source = image(96, 64, (x, y) => x < 2 || y < 2 || x >= 94 || y >= 62 || x >= 45 && x < 51 && y >= 29 && y < 35
      ? [0, 0, 0, 0] : y % 12 === 0 ? [50, 45, 40, 255] : [110 + x % 3, 95 + y % 2, 80, 255])
    const result = vectorizeImageLayer(source, options(kind, { seed: 23 }))
    expect(result).toEqual(vectorizeImageLayer(source, options(kind, { seed: 23 })))
    expect(result.sourceSvg).not.toMatch(/<(?:image|rect)\b|base64/)
    expect(result.stats.pathCount).toBeGreaterThan(8)
    expect(result.stats.pathCount).toBeLessThanOrEqual(256)
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 96, height: 64 })
    expect(rgba(raster.rgba, 96, 0, 0)[3]).toBe(0)
    expect(rgba(raster.rgba, 96, 48, 32)[3]).toBe(0)
    expect(rgba(raster.rgba, 96, 20, 20)[3]).toBe(255)
    expect(new Set(Array.from({ length: raster.width * raster.height }, (_value, index) => raster.rgba.slice(index * 4, index * 4 + 3).join(','))).size).toBeGreaterThan(8)
  })

  it('rejects excessive detail and unsafe options without silently dropping source regions', () => {
    const noise = image(100, 100, (x, y) => (x + y) % 2 ? [20, 30, 40, 255] : [150, 160, 170, 255])
    expect(() => vectorizeImageLayer(noise, options('trace'))).toThrow('未丢弃细节')
    for (const value of [{ kind: 'trace', colors: 7 }, { kind: 'trace', externalUrl: 'https://example.com' }, { kind: 'trace', seed: .5 }]) expect(() => imageVectorOptionsSchema.parse(value)).toThrow()
    expect(() => vectorizeImageLayer(image(4, 4, () => [0, 0, 0, 0]), options('trace'))).toThrow('没有可见像素')
  })

  it('smooths low-contrast JPEG-like fragments while preserving narrow dark and bright strokes', async () => {
    const source = image(64, 48, (x, y) => x === 20 ? [10, 10, 10, 255] : x === 36 ? [230, 230, 230, 255]
      : (x * 13 + y * 7) % 17 === 0 ? [114, 104, 94, 255] : [110, 100, 90, 255])
    const precise = vectorizeImageLayer(source, options('trace'))
    const filtered = vectorizeImageLayer(source, options('trace', { smoothingRadius: 2 }))
    expect(filtered.stats.pathCommandCount).toBeLessThan(precise.stats.pathCommandCount)
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(filtered.sourceSvg), { width: 64, height: 48 })
    expect(rgba(raster.rgba, 64, 20, 24)).toEqual([10, 10, 10, 255])
    expect(rgba(raster.rgba, 64, 36, 24)).toEqual([230, 230, 230, 255])
  })

  it.each([255, 128])('keeps a non-integer shared color edge seamless at alpha %i in the real 2048 raster', async alpha => {
    const source = image(31, 23, x => x < 8 ? [40, 90, 140, alpha] : [150, 95, 50, alpha])
    const result = vectorizeImageLayer(source, options('trace'))
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 2048, height: 1519 })
    for (let y = 2; y < 1517; y++) expect(rgba(raster.rgba, 2048, 528, y)[3]).toBe(alpha)
  })

  it.each(['wood', 'rug'] as const)('preserves uniform partial alpha through %s texture compositing and refuses mixed alpha', async kind => {
    const source = image(31, 23, () => [80, 110, 140, 128])
    const result = vectorizeImageLayer(source, options(kind))
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 2048, height: 1519 })
    let minimum = 255, maximum = 0
    for (let y = 2; y < 1517; y++) for (let x = 2; x < 2046; x++) {
      const alpha = raster.rgba[(y * raster.width + x) * 4 + 3]
      minimum = Math.min(minimum, alpha); maximum = Math.max(maximum, alpha)
    }
    expect({ minimum, maximum }).toEqual({ minimum: 128, maximum: 128 })
    source.data[3] = 255
    expect(() => vectorizeImageLayer(source, options(kind))).toThrow('混合透明度')
  })

  it('rebuilds explicit local wood zones with independent plank directions', async () => {
    const source = image(96, 64, () => [110, 95, 80, 255])
    const result = vectorizeImageLayer(source, options('wood', { plankWidthPx: 16,
      woodZones: [{ x: 48, y: 0, width: 48, height: 64, direction: 'vertical', plankWidthPx: 12 }] }))
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 96, height: 64 })
    expect(rgba(raster.rgba, 96, 5, 16)[0]).toBeLessThan(rgba(raster.rgba, 96, 5, 15)[0])
    expect(rgba(raster.rgba, 96, 60, 5)[0]).toBeLessThan(rgba(raster.rgba, 96, 59, 5)[0])
    const zone = { x: 48, y: 0, width: 48, height: 64, direction: 'vertical' as const }
    expect(vectorizeImageLayer(source, options('wood', { plankWidthPx: 16, woodZones: [zone] })).sourceSvg)
      .toBe(vectorizeImageLayer(source, options('wood', { plankWidthPx: 16, woodZones: [{ ...zone, plankWidthPx: 16 }] })).sourceSvg)
    expect(() => vectorizeImageLayer(source, options('wood', { woodZones: [{ x: 90, y: 0, width: 10, height: 10, direction: 'vertical' }] }))).toThrow('超出原图')
  })
})

/** Optional private diagnosis obtains source coordinates from the host-owned recipe, never production code. */
const diagnostic = process.env.SCENEWEAVE_VECTOR_DIAGNOSTIC
it.skipIf(!diagnostic)('reports the actual private room trace budgets and writes software-rendered comparisons', async () => {
  const config = JSON.parse(readFileSync(diagnostic!, 'utf8')) as { image: string; recipe: string; output: string;
    cases?: Array<{ colors: number; simplifyPx: number; smoothingRadius: number }> }
  const recipe = JSON.parse(readFileSync(config.recipe, 'utf8')) as { roomPointsPx: Array<{ x: number; y: number }>; layers: Array<{
    polygon: Array<{ x: number; y: number }>; donor: { x: number; y: number; width: number; height: number };
    repair?: 'tile' | 'seamless'; fills?: ImageRepairFill[]; cleanupPx?: number }> }
  const { jpegjs } = createRequire(import.meta.url)('../../../node_modules/playwright-core/lib/utilsBundle.js')
  const decoded = jpegjs.decode(readFileSync(config.image)) as { width: number; height: number; data: Uint8Array }
  let source: ImagePixels = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) }
  for (const layer of recipe.layers) source = extractImageLayer(source, layer.polygon, layer.donor, layer).remaining
  const left = Math.min(...recipe.roomPointsPx.map(point => point.x)), top = Math.min(...recipe.roomPointsPx.map(point => point.y))
  const width = Math.max(...recipe.roomPointsPx.map(point => point.x)) - left, height = Math.max(...recipe.roomPointsPx.map(point => point.y)) - top
  const contains = (x: number, y: number) => {
    let inside = false
    for (let index = 0, previous = recipe.roomPointsPx.length - 1; index < recipe.roomPointsPx.length; previous = index++) {
      const a = recipe.roomPointsPx[index], b = recipe.roomPointsPx[previous]
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
  }
  const cropped = image(width, height, (x, y) => contains(left + x + .5, top + y + .5) ? rgba(source.data, source.width, left + x, top + y) : [0, 0, 0, 0])
  mkdirSync(config.output, { recursive: true })
  writeFileSync(resolve(config.output, 'source.png'), encodeCanonicalPng({ width, height, rgba: cropped.data }))
  const facts: unknown[] = []
  for (const { colors, simplifyPx, smoothingRadius } of config.cases ?? [{ colors: 8, simplifyPx: 2, smoothingRadius: 2 }]) {
    try {
      const result = vectorizeImageLayer(cropped, options('trace', { colors, simplifyPx, smoothingRadius }))
      const key = `${colors}-${simplifyPx}-${smoothingRadius}`, raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width, height })
      writeFileSync(resolve(config.output, `${key}.svg`), result.sourceSvg)
      writeFileSync(resolve(config.output, `${key}.png`), encodeCanonicalPng(raster))
      facts.push({ colors, simplifyPx, smoothingRadius, status: 'complete', ...result.stats })
    } catch (error) { facts.push({ colors, simplifyPx, smoothingRadius, status: 'rejected', error: error instanceof Error ? error.message : String(error) }) }
    writeFileSync(resolve(config.output, 'facts.json'), JSON.stringify(facts, null, 2))
  }
  writeFileSync(resolve(config.output, 'facts.json'), JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts))
}, 120000)
