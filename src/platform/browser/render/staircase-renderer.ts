import type { PointMm } from '../../../shared/model/scene.js'
import type { StaircaseConfig } from '../../../shared/stairs/contracts.js'
import { staircaseMaterial } from '../../../shared/stairs/catalog.js'
import { planStaircase, staircasePatch, staircasePointAt, type StaircaseGeometry, type StaircaseTread } from '../../../shared/stairs/geometry.js'
import type { RouteWidthSection } from '../../../shared/geometry/route-width.js'
import { setCanvasBlur } from './canvas-filter.js'

function path(ctx: CanvasRenderingContext2D, polygon: readonly PointMm[]): void {
  if (!polygon.length) return
  ctx.moveTo(polygon[0].x, polygon[0].y)
  for (const p of polygon.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.closePath()
}
function fill(ctx: CanvasRenderingContext2D, polygon: readonly PointMm[], colour: string): void {
  ctx.beginPath(); path(ctx, polygon); ctx.fillStyle = colour; ctx.fill()
}
function line(ctx: CanvasRenderingContext2D, points: readonly PointMm[], colour: string, width: number): void {
  if (points.length < 2) return
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y)
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.stroke()
}
const noise = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
/** Bounded samples on an absolute world-size lattice, never fitted to a tread. */
function worldStations(start: number, end: number, spacing: number, limit: number, phase = 0): number[] {
  const first = Math.ceil((start - phase) / spacing), last = Math.floor((end - phase) / spacing)
  const stride = Math.max(1, Math.ceil((last - first + 1) / limit)), result: number[] = []
  for (let index = first; index <= last; index += stride) result.push(index * spacing + phase)
  return result
}

/** Native opaque shapes, in world millimetres. No blur, raster enlargement or
 * slope-wide gradient enters the stair layer. Audience filtering happens upstream. */
export function drawStaircase(ctx: CanvasRenderingContext2D, centerlineMm: readonly PointMm[], widthMm: number, config: StaircaseConfig,
  options: { footprintMm?: PointMm[]; ascending?: boolean; riseMm?: number; widthSections?: RouteWidthSection[] } = {}): StaircaseGeometry {
  const geometry = planStaircase(centerlineMm, widthMm, config, options.widthSections), palette = staircaseMaterial(config.material).palette
  const footprint = options.footprintMm ?? geometry.footprintMm, ascending = options.ascending !== false
  const routeFraction = config.range ? (config.range.endPpm - config.range.startPpm) / 1_000_000 : 1
  const risePerTread = (options.riseMm ?? 0) * routeFraction / geometry.treads.length
  const scale = config.textureScaleMm
  const at = (distance: number, lateral = 0) => staircasePointAt(geometry, distance, lateral)
  const patch = (start: number, end: number, low = -0.5, high = 0.5) => staircasePatch(geometry, start, end, low, high)
  ctx.save()
  setCanvasBlur(ctx, 0)
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
  ctx.lineJoin = 'miter'; ctx.lineCap = 'butt'
  ctx.beginPath(); path(ctx, footprint); ctx.clip()
  ctx.beginPath(); path(ctx, geometry.footprintMm); ctx.clip()
  ctx.save()
  // Sequential subtraction produces the union of masks, including overlaps.
  // It clips only this stair draw; destination-out would erase the actual ground.
  for (const cover of geometry.covers.filter(row => row.kind === 'reveal-ground')) {
    ctx.beginPath(); path(ctx, geometry.footprintMm); path(ctx, cover.polygonMm); ctx.clip('evenodd')
  }
  const stringer = Math.min(0.16, 126 / widthMm)
  if (config.preset === 'boardwalk' || config.preset === 'timber') {
    for (const lateral of [-0.38, 0.38]) fill(ctx, patch(0, geometry.lengthMm, lateral - 0.05, lateral + 0.05), palette.shadow)
  }
  if (config.preset === 'metal-grate') {
    for (const side of [-1, 1]) {
      const from = side > 0 ? .5 - stringer : -.5, to = from + stringer
      fill(ctx, patch(0, geometry.lengthMm, from, to), palette.joint)
      fill(ctx, patch(0, geometry.lengthMm, from + stringer * .19, to - stringer * .15), palette.shadow)
      fill(ctx, patch(0, geometry.lengthMm, from + stringer * .19, from + stringer * .35), palette.top)
    }
    const tieDepth = Math.min(92, geometry.lengthMm * .06)
    fill(ctx, patch(0, tieDepth), palette.joint)
    fill(ctx, patch(geometry.lengthMm - tieDepth, geometry.lengthMm), palette.joint)
  }
  for (const tread of geometry.treads) drawTread(ctx, geometry, tread, config, ascending)
  ctx.restore()

  for (const cover of geometry.covers) {
    if (cover.kind === 'reveal-ground') continue
    const colours = cover.kind === 'earth' ? ['#817052', '#a08b63'] : cover.kind === 'grass' ? ['#647148', '#85925d'] : ['#787c6d', '#a1a28b']
    fill(ctx, cover.polygonMm, colours[0])
    ctx.save(); ctx.beginPath(); path(ctx, cover.polygonMm); ctx.clip()
    const minX = Math.min(...cover.polygonMm.map(p => p.x)), maxX = Math.max(...cover.polygonMm.map(p => p.x)), minY = Math.min(...cover.polygonMm.map(p => p.y)), maxY = Math.max(...cover.polygonMm.map(p => p.y))
    // Fixed maximum per region; texture size remains tied to world units.
    const count = Math.min(80, Math.ceil((maxX - minX) * (maxY - minY) / (scale * scale)))
    for (let i = 0; i < count; i++) {
      const x = minX + noise(i * 3 + 1) * (maxX - minX), y = minY + noise(i * 3 + 2) * (maxY - minY), size = scale * (0.035 + noise(i * 3 + 3) * 0.075)
      if (cover.kind === 'grass') line(ctx, [{ x, y }, { x: x + size * 0.4, y: y - size }], colours[1], size * 0.18)
      else fill(ctx, [{ x: x - size, y }, { x, y: y - size * 0.5 }, { x: x + size, y: y + size * 0.2 }, { x, y: y + size * 0.6 }], colours[1])
    }
    ctx.restore()
  }
  ctx.restore()
  return geometry

  function drawTread(context: CanvasRenderingContext2D, g: StaircaseGeometry, tread: StaircaseTread, style: StaircaseConfig, uphill: boolean): void {
    const { startMm: start, endMm: end, index } = tread, depth = end - start
    const gap = Math.min(12, depth * 0.055), edge = Math.min(42, depth * 0.14)
    const face = risePerTread > 0 ? Math.min(82, depth * .28, 26 + risePerTread * .28) : Math.min(45, depth * .18)
    const point = (u: number, v: number) => at(start + depth * u, v)
    const polygon = (coords: [number, number][]) => coords.map(([u, v]) => point(u, v))
    const strip = (s: number, e: number, low = -0.5, high = 0.5, colour = palette.top) => fill(context, patch(s, e, low, high), colour)
    const across = (d: number, low: number, high: number, colour: string, width: number) => line(context, [at(d, low), at(d, high)], colour, width)
    const along = (s: number, e: number, lateral: number, colour: string, width: number) => {
      const stations = [s, ...g.sections.filter(row => row.distanceMm > s && row.distanceMm < e).map(row => row.distanceMm), e]
      line(context, stations.map(d => at(d, lateral)), colour, width)
    }
    context.save(); context.beginPath(); path(context, tread.polygonMm); context.clip()

    if (style.preset === 'stepping-stones') {
      // Large discrete slabs preserve open gaps on all sides of each tread.
      for (let j = 0; j < 2; j++) {
        const low = -0.46 + j * 0.47, high = low + 0.44
        const slab = polygon([[0.07, low + 0.025], [0.03, high - 0.04], [0.13, high], [0.88, high - 0.008], [0.96, high - 0.055], [0.94, low + 0.01], [0.79, low]])
        fill(context, slab, palette.shadow)
        fill(context, polygon([[0.09, low + 0.035], [0.07, high - 0.045], [0.16, high - 0.01], [0.9, high - 0.02], [0.94, high - 0.065], [0.91, low + 0.018], [0.8, low + 0.012]]), j === index % 2 ? palette.top : palette.alternate)
        line(context, [point(0.1, low + 0.04), point(0.08, high - 0.05)], palette.light, 7)
      }
    } else if (style.preset === 'metal-grate') {
      // Each open grate ends in a folded nosing. The gaps retain the ground below.
      const low = -.5 + stringer * .62, high = -low
      const nose = Math.min(100, depth * .30), back = Math.min(34, depth * .10)
      const s = uphill ? start + nose : start + back, e = uphill ? end - back : end - nose
      const width = Math.max(12, Math.min(25, scale * .065))
      strip(uphill ? start : e, uphill ? s : end, low, high, palette.joint)
      strip(uphill ? e : start, uphill ? end : s, low, high, palette.shadow)
      const lip = uphill ? s : e, sign = uphill ? 1 : -1
      across(lip - sign * nose * .33, low, high, palette.shadow, nose * .55)
      across(lip - sign * nose * .57, low, high, palette.light, Math.min(15, nose * .22))
      for (const offset of worldStations(low * widthMm, high * widthMm, Math.max(88, scale * .31), 40)) {
        if (Math.abs(offset / widthMm) >= high - .012) continue
        along(s, e, offset / widthMm, palette.alternate, width)
      }
      for (const d of worldStations(s + 14, e - 14, Math.max(75, scale * .27), 24, scale * .08)) across(d, low, high, palette.shadow, width * .67)
      for (const side of [-1, 1]) {
        const bolt = at(lip - sign * nose * .42, side * (.5 - stringer * .48))
        const radius = Math.min(18, nose * .21, widthMm * stringer * .15)
        context.beginPath(); context.arc(bolt.x, bolt.y, radius, 0, Math.PI * 2); context.fillStyle = palette.light; context.fill()
      }
    } else if (style.preset === 'boardwalk') {
      strip(start + gap, end - gap, -0.5, 0.5, index % 3 === 0 ? palette.alternate : palette.top)
      for (const side of [-0.37, 0.37]) {
        for (const u of [0.23, 0.77]) fill(context, polygon([[u - 0.025, side - 0.008], [u - 0.025, side + 0.008], [u + 0.025, side + 0.008], [u + 0.025, side - 0.008]]), palette.joint)
      }
      woodGrain(3)
      across(uphill ? start + gap + 4 : end - gap - 4, -0.5, 0.5, palette.light, 6)
    } else {
      fill(context, tread.polygonMm, index % 4 === 0 ? palette.alternate : palette.top)
      if (style.preset === 'cut-stone') {
        const blocks = Math.max(1, Math.min(16, Math.ceil(widthMm / (scale * 1.8))))
        for (let j = 1; j < blocks; j++) {
          const v = -0.5 + (j + (index % 2 ? 0.2 : -0.2)) / blocks
          along(start, end, v, palette.joint, 11); along(start + edge, end - gap, v + 0.008, palette.light, 5)
        }
        grain(9, false)
      } else if (style.preset === 'rough-stone') {
        const blocks = Math.max(2, Math.min(12, Math.ceil(widthMm / scale)))
        for (let j = 0; j < blocks; j++) {
          const low = -0.5 + j / blocks, high = -0.5 + (j + 1) / blocks, wobble = 0.035 + noise(index * 23 + j) * 0.065
          fill(context, polygon([[0.13, low + 0.012], [0.05 + wobble, high - 0.02], [0.44, high - 0.006], [0.93, high - 0.035], [0.98 - wobble, low + 0.025], [0.5, low + 0.005]]), (index + j) % 3 === 0 ? palette.alternate : palette.top)
          line(context, [point(0.1, low), point(0.32, low + 0.018), point(0.74, low - 0.007), point(1, low + 0.009)], palette.joint, 12)
        }
        grain(14, true)
      } else if (style.preset === 'carved-rock') {
        // Chisel cuts belong to each full tread, never to the whole slope.
        for (const v of [-0.41, 0.43]) for (const d of worldStations(start, end, scale * 1.7, 16, scale * 0.15)) {
          line(context, [at(d, v), at(d + scale * 0.21, v + scale * 0.035 / widthMm), at(d + scale * 0.35, v + scale * 0.015 / widthMm), at(d + scale * 0.65, v + scale * 0.04 / widthMm)], palette.shadow, 13)
        }
        const v = noise(index * 11) * 0.45 - 0.2
        const crackStart = start + scale * 0.04
        line(context, [at(crackStart, v - scale * 0.08 / widthMm), at(crackStart + scale * 0.17, v), at(crackStart + scale * 0.5, v + scale * 0.035 / widthMm), at(crackStart + scale * 0.66, v + scale * 0.13 / widthMm)], palette.joint, 6)
        grain(18, true)
      } else if (style.preset === 'flagstone') {
        const columns = Math.max(2, Math.min(12, Math.ceil(widthMm / scale)))
        for (let row = 0; row < 2; row++) for (let j = 0; j < columns; j++) {
          const low = -0.5 + j / columns, high = -0.5 + (j + 1) / columns, u = row / 2
          fill(context, polygon([[u + 0.025, low + 0.012], [u + 0.045, high - 0.02], [u + 0.41, high - 0.008], [u + 0.475, high - 0.04], [u + 0.46, low + 0.02], [u + 0.14, low + 0.025]]), (j + row + index) % 3 === 0 ? palette.light : (j + row) % 2 ? palette.alternate : palette.top)
        }
        across(start + depth / 2, -0.5, 0.5, palette.joint, 11)
        for (let j = 1; j < columns; j++) line(context, [point(0, -0.5 + j / columns), point(0.47, -0.5 + (j + 0.12) / columns), point(0.55, -0.5 + (j - 0.12) / columns), point(1, -0.5 + j / columns)], palette.joint, 12)
      } else if (style.preset === 'brick') {
        const columns = Math.max(2, Math.min(24, Math.ceil(widthMm / Math.max(160, scale * 0.7))))
        for (let row = 0; row < 2; row++) {
          for (let j = 0; j < columns; j++) {
            const low = -0.5 + (j + ((row + index) % 2) * 0.5) / columns
            strip(start + row * depth / 2 + 6, start + (row + 1) * depth / 2 - 6, low + 0.009, Math.min(0.5, low + 1 / columns - 0.009), (j + index) % 3 ? palette.top : palette.alternate)
            along(start + row * depth / 2, start + (row + 1) * depth / 2, low, palette.joint, 12)
          }
        }
        across(start + depth / 2, -0.5, 0.5, palette.joint, 12)
      } else if (style.preset === 'concrete') {
        for (const side of [-0.46, 0.46]) along(start, end, side, palette.shadow, 12)
        if (index % 4 === 0) across(start + depth * 0.84, -0.46, 0.46, palette.joint, 7)
        grain(5, false)
      } else if (style.preset === 'timber') {
        across(start + depth / 2, -0.5, 0.5, palette.joint, 13)
        strip(start + depth / 2 + 7, end, -0.5, 0.5, index % 2 ? palette.top : palette.alternate)
        woodGrain(4)
        for (const v of [-0.4, 0.4]) for (const u of [0.24, 0.74]) {
          const p = point(u, v); context.beginPath(); context.arc(p.x, p.y, 8, 0, Math.PI * 2); context.fillStyle = palette.joint; context.fill()
        }
      }
      // A dark riser occupies a bounded portion of each individual tread.
      strip(uphill ? start : end - face, uphill ? start + face : end, -0.5, 0.5, palette.shadow)
      across(uphill ? start + face : end - face, -0.5, 0.5, palette.light, Math.min(8, depth * 0.04))
      across(uphill ? start : end, -0.5, 0.5, palette.joint, Math.min(10, depth * 0.045))
    }
    context.restore()

    function woodGrain(width: number): void {
      for (const d of worldStations(start + gap, end - gap, scale * 0.12, 64, scale * 0.035)) {
        // Grain wavelength and lateral wobble retain their millimetre size
        // when a tread is stretched or another complete tread is appended.
        line(context, [at(d, -0.48), at(d + scale * 0.018, -0.12), at(d - scale * 0.014, 0.22), at(d, 0.48)], palette.grain, width)
      }
    }

    function grain(density: number, cracks: boolean): void {
      const spacing = scale / Math.sqrt(density * 0.5)
      const longitudinal = worldStations(start - spacing, end, spacing, 24), lateral = worldStations(-widthMm / 2, widthMm / 2, spacing, 16)
      for (const d of longitudinal) for (const offset of lateral) {
        const seed = Math.round(d / spacing) * 113 + Math.round(offset / spacing) * 7
        const distance = d + noise(seed) * spacing * 0.8, v = (offset + noise(seed + 1) * spacing * 0.8) / widthMm
        const size = scale * (0.018 + noise(seed + 2) * 0.028)
        if (distance + size * 2 < start || distance - size > end || Math.abs(v) > 0.5) continue
        if (cracks && Math.abs(seed) % 4 === 0) line(context, [at(distance, v), at(distance + size, v + size / widthMm * 1.5), at(distance + size * 2, v + size / widthMm)], palette.grain, Math.max(2, size * 0.22))
        else fill(context, [at(distance - size, v), at(distance, v - size * 0.5 / widthMm), at(distance + size, v + size * 0.5 / widthMm)], Math.abs(seed) % 3 ? palette.grain : palette.light)
      }
    }
  }
}
