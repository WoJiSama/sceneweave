import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import type { RoadRow, RoadSurfaceGeometry } from '../../../shared/geometry/road-surface.js'
import type { PointMm } from '../../../shared/model/scene.js'
import { playerMaskContains } from '../../../shared/projection/player-mask.js'
import type { RoadBankMaterial } from '../../../shared/projection/road-material.js'
import type { ProjectedPath, Projection } from '../../../shared/projection/types.js'
import { staircaseMaterial } from '../../../shared/stairs/catalog.js'
import { terrainRandomUnit, terrainValueNoise } from '../../../shared/terrain-generation/field.js'
import { projectGround } from './projected-ground.js'

const bankColors: Record<RoadBankMaterial, { cut: string; fill: string; detail: string }> = {
  snow: { cut: '#7e766a', fill: '#c6d3d7', detail: '#e7edf0' },
  stone: { cut: '#73756f', fill: '#939389', detail: '#b3b0a2' },
  scree: { cut: '#877962', fill: '#ab9b81', detail: '#c1b19b' },
  grass: { cut: '#807151', fill: '#858366', detail: '#a1a481' },
  earth: { cut: '#7e6c56', fill: '#9d8868', detail: '#bba17a' },
}
const mix = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const alpha = (color: string, opacity: number) => color + Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0')
const polygon = (points: readonly PointMm[]) => {
  const path = new Path2D()
  points.forEach((point, i) => i ? path.lineTo(point.x, point.y) : path.moveTo(point.x, point.y))
  path.closePath()
  return path
}

export function roadBankSampler(projection: Projection) {
  const ground = projectGround(projection)
  const covers = new Map(ground.all.map(area => [area.id, [...area.style?.overlays ?? []].sort((a, b) => b.renderOrder - a.renderOrder || b.id.localeCompare(a.id))]))
  return (p: PointMm) => {
    if (projection.audience === 'player' && playerMaskContains(p, projection.masks, projection.maskPublicRooms)) return undefined
    const area = ground.surfaceAt(p)
    if (!area) return { material: 'earth' as const, tint: null }
    const patch = area.materialPatches?.findLast(overlay => overlay.paint.opacity >= .4 && overlay.regionsMm.some(row =>
      pointInPolygon(p, row.outerMm) && !row.holesMm.some(hole => pointInPolygon(p, hole))))
    const paint = patch?.paint ?? covers.get(area.id)?.find(row => row.paint.opacity >= .4 && pointInPolygon(p, row.boundaryMm))?.paint ?? area.style?.base
    return { material: (paint ? projection.materials[paint.materialRef.id]?.bankMaterial : undefined) ?? 'earth', tint: paint?.tint ?? null }
  }
}

const widthOf = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y)
const rowAt = (start: RoadRow, end: RoadRow, t: number): RoadRow => ([0, 1, 2, 3] as const).map(i =>
  ({ ...mix(start[i], end[i], t), z: start[i].z + (end[i].z - start[i].z) * t })) as RoadRow

/** The walkable width stays fixed. Soil, grass or snow shows through the worn margins. */
export function paintRoadWearMask(ctx: CanvasRenderingContext2D, { spans }: RoadSurfaceGeometry, bankAt: ReturnType<typeof roadBankSampler>) {
  const rows = spans.flatMap(({ start, end }) => {
    const count = Math.min(16, Math.max(1, Math.ceil(widthOf(mix(start[1], start[2], .5), mix(end[1], end[2], .5)) / 85)))
    return Array.from({ length: count }, (_, i) => rowAt(start, end, i / count))
  })
  rows.push(spans.at(-1)!.end)
  const rails = ([0, 1] as const).map(side => rows.map(row => {
    const edge = row[side ? 2 : 1], other = row[side ? 1 : 2], outer = row[side ? 3 : 0]
    const width = widthOf(edge, other)
    const cover = bankAt(outer)?.material
    const patch = terrainValueNoise('road-wear', 'flow', edge.x / 1130, edge.y / 1130)
    const rough = terrainValueNoise('road-wear', 'weathering', edge.x / 290, edge.y / 290)
    const fine = terrainValueNoise('road-wear', 'chips', edge.x / 98, edge.y / 98)
    const cut = Math.min(1, Math.abs(edge.z - outer.z) / 440)
    const scale = Math.min(2350, width)
    const verge = cover === 'grass' || cover === 'snow' ? .21 : .13
    const inset = scale * verge * Math.max(0, .55 + .59 * patch + .22 * rough + .09 * fine) * (1 - .42 * cut)
    const blend = scale * (.15 + .045 * rough + (cover === 'stone' ? 0 : .055))
    return { edge, other, width, inset, blend, cover, patch, cut: outer.z > edge.z ? cut : 0 }
  }))
  let previous = 0
  for (let i = 1; i <= 9; i++) {
    const t = i / 9, coverage = t * t * (3 - 2 * t)
    const side = (index: number) => rails[index].map(({ edge, other, width, inset, blend }) =>
      mix(edge, other, Math.min(.41, (inset + t * blend) / width)))
    ctx.fillStyle = alpha('#ffffff', (coverage - previous) / (1 - previous))
    ctx.fill(polygon([...side(0), ...side(1).reverse()]))
    previous = coverage
  }
  // A cut exposes the parent rock through the tread. When only one bank is
  // rock, keep that texture on its own side, even as the path turns.
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < rows.length - 1; i += 4) {
    const j = Math.min(i + 4, rows.length - 1), mid = (i + j) >> 1
    const a = mix(rows[i][1], rows[i][2], .5), b = mix(rows[j][1], rows[j][2], .5), step = widthOf(a, b)
    if (!step) continue
    const tangent = { x: (b.x - a.x) / step, y: (b.y - a.y) / step }
    for (const rail of rails) {
      const { edge, other, width, cover, patch, cut } = rail[mid]
      if (!cover) continue
      const normal = { x: (other.x - edge.x) / width, y: (other.y - edge.y) / width }
      const outcrop = cover === 'stone' ? .44 + .72 * cut : .22 + .18 * cut
      const along = 700 + 215 * patch
      dab(ctx, mix(edge, other, .19 + .06 * patch), tangent, normal, along, Math.min(1250, width * .57),
        '#ffffff', Math.min(.86, step / along * outcrop * (.86 + .58 * patch)))
    }
  }
  ctx.restore()
}

function dab(ctx: CanvasRenderingContext2D, center: PointMm, tangent: PointMm, normal: PointMm,
  along: number, across: number, color: string, opacity: number) {
  ctx.save()
  ctx.transform(tangent.x * along, tangent.y * along, normal.x * across, normal.y * across, center.x, center.y)
  const paint = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  paint.addColorStop(0, alpha(color, opacity))
  paint.addColorStop(.48, alpha(color, opacity * .62))
  paint.addColorStop(1, alpha(color, 0))
  ctx.fillStyle = paint
  ctx.fillRect(-1, -1, 2, 2)
  ctx.restore()
}

/** Source terrain is already visible at the margin. Only exposed soil needs a cut face or loose fill. */
export function paintRoadBanks(ctx: CanvasRenderingContext2D, geometry: RoadSurfaceGeometry, bankAt: ReturnType<typeof roadBankSampler>) {
  for (const { start, end } of geometry.spans) {
    const from = mix(start[1], start[2], .5), to = mix(end[1], end[2], .5)
    const length = widthOf(from, to), count = Math.min(16, Math.max(1, Math.ceil(length / 115)))
    const tangent = { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
    for (let i = 0; i < count; i++) {
      const row = rowAt(start, end, (i + .5) / count), width = widthOf(row[1], row[2])
      for (const side of [0, 1] as const) {
        const outer = row[side ? 3 : 0], inner = row[side ? 2 : 1], other = row[side ? 1 : 2]
        const context = bankAt(outer)
        if (!context) continue
        const palette = bankColors[context.material], difference = outer.z - inner.z, bankWidth = widthOf(outer, inner)
        const rough = terrainValueNoise('road-wear', 'cut-face', outer.x / 335, outer.y / 335)
        const pocket = terrainValueNoise('road-wear', 'bank-outcrop', outer.x / 930, outer.y / 930)
        const exposed = Math.max(0, Math.min(1, (Math.abs(difference) - 48) / 390)), cut = difference > 0
        const normal = { x: (other.x - inner.x) / width, y: (other.y - inner.y) / width }
        const reach = Math.min(230, bankWidth * (.46 + .13 * rough))
        const center = mix(outer, inner, .60 + .19 * rough)
        const base = cut ? palette.cut : palette.fill
        const seed = `${Math.round(outer.x / 37)},${Math.round(outer.y / 37)}`
        const noise = (field: string) => terrainRandomUnit(seed, field)
        if (reach > 2 && exposed > 0) {
          const opacity = exposed * Math.max(0, .28 + .48 * pocket + .32 * rough)
          dab(ctx, center, tangent, normal, 180 + 80 * rough, reach, base, opacity * .43)
          if (cut) dab(ctx, mix(outer, inner, .86), tangent, normal, 140 + 55 * rough, reach * .38, '#483c31', opacity * .66)
        }
        const toe = mix(inner, other, Math.min(.20, (.07 + rough * .05) * 1500 / width))
        if (context.material === 'snow' && pocket + rough > .10) {
          dab(ctx, toe, tangent, normal, 150 + 80 * rough, 65 + 44 * rough, palette.detail, .20 + .19 * pocket)
        }
        if (noise('mark') > .17 + .16 * exposed + .29 * pocket) continue
        const mark = mix(outer, mix(inner, other, .18), noise('lateral'))
        const chip = (along: number, cross: number): PointMm => ({ x: mark.x + along * tangent.x + cross * normal.x, y: mark.y + along * tangent.y + cross * normal.y })
        if (context.material === 'grass' && !exposed) {
          ctx.strokeStyle = alpha(palette.detail, .58)
          ctx.lineWidth = 8
          ctx.beginPath()
          for (const k of [-1, 0, 1]) {
            const tip = chip(k * (23 + noise('blade') * 20), 24 + noise(String(k)) * 52)
            ctx.moveTo(mark.x, mark.y); ctx.lineTo(tip.x, tip.y)
          }
          ctx.stroke()
        } else {
          const size = 9 + (exposed * 18 + 14) * noise('size')
          const ground = chip(size * .7, size * .7)
          ctx.fillStyle = alpha('#514738', .32)
          ctx.fill(polygon([chip(-size, 0), chip(-size * .3, size * .85), ground, chip(size * 1.3, -size * .13)]))
          ctx.fillStyle = alpha(context.tint ?? palette.detail, .30 + .15 * exposed)
          ctx.fill(polygon([chip(-size, 0), chip(-size * .5, -size * .60), chip(size * .76, -size * .43), chip(size * 1.3, -size * .13), chip(size * .26, size * .39)]))
        }
      }
    }
  }
}

/** Group loose grit where there are steps. Flat road finishes carry their own grain. */
export function paintRoadWear(ctx: CanvasRenderingContext2D, geometry: RoadSurfaceGeometry) {
  ctx.save()
  ctx.clip(polygon(geometry.coreMm))
  for (const { start, end, kind } of geometry.spans) {
    if (kind === 'trail') continue
    const a = mix(start[1], start[2], .5), b = mix(end[1], end[2], .5), length = widthOf(a, b)
    const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
    const count = Math.min(8, Math.max(1, Math.ceil(length / 205)))
    for (let i = 0; i < count; i++) {
      const row = rowAt(start, end, (i + .5) / count), width = widthOf(row[1], row[2])
      const normal = { x: (row[2].x - row[1].x) / width, y: (row[2].y - row[1].y) / width }
      const mid = mix(row[1], row[2], .5), seed = `${Math.round(mid.x / 61)},${Math.round(mid.y / 61)}`
      const variation = terrainRandomUnit(seed, 'wear')
      if (kind === 'landing') dab(ctx, mix(row[1], row[2], .41 + .18 * variation), tangent, normal, 345,
        Math.min(390, width * .29), '#d1c2a2', .10)
      for (let j = 0; j < 3; j++) {
        const t = terrainRandomUnit(seed, `grain/${j}`)
        const p = mix(row[1], row[2], .05 + .9 * t)
        const size = 5 + 15 * terrainRandomUnit(seed, `size/${j}`) ** 2
        const advance = (terrainRandomUnit(seed, `along/${j}`) - .5) * Math.min(190, length)
        const x = p.x + tangent.x * advance, y = p.y + tangent.y * advance
        ctx.fillStyle = alpha(j % 2 ? '#5e5445' : '#cec2a3', .13 + .12 * t)
        ctx.fill(polygon([{ x: x - size, y }, { x: x - size * .15, y: y - size * .62 }, { x: x + size, y: y + size * .27 }, { x, y: y + size * .48 }]))
      }
    }
  }
  ctx.restore()
}

export const gradedRiserPalette = (path: ProjectedPath) => staircaseMaterial(path.gradedFinish?.material ?? 'earth').palette

export function paintGradedRoadRisers(ctx: CanvasRenderingContext2D, geometry: RoadSurfaceGeometry, path: ProjectedPath, shadeFace: boolean) {
  const { risers, spans } = geometry
  const byStart = new Map(spans.map(span => [span.aPpm, span]))
  const byEnd = new Map(spans.map(span => [span.bPpm, span]))
  const palette = gradedRiserPalette(path)
  ctx.save()
  ctx.clip(polygon(geometry.coreMm))
  for (const { lower, upper, atPpm, ascending } of risers) {
    const span = (ascending ? byEnd : byStart).get(atPpm)!
    const back = ascending ? span.start : span.end
    const center = mix(lower[1], lower[2], .5), down = mix(back[1], back[2], .5)
    const reach = Math.hypot(down.x - center.x, down.y - center.y)
    const height = upper[1].z - lower[1].z, depth = Math.min(184, 38 + height * .77, reach * .94)
    const seed = `${Math.round(center.x / 65)},${Math.round(center.y / 65)}`
    const left = .032 + .046 * terrainRandomUnit(seed, 'left'), right = .97 - .055 * terrainRandomUnit(seed, 'right')
    const across = [0, .14, .26, .36, .49, .60, .71, .84, 1].map(t => left + t * (right - left))
    const points = across.map((u, i) => {
      const crest = mix(lower[1], lower[2], u)
      const base = mix(back[1], back[2], u)
      const wear = Math.sin(i / (across.length - 1) * Math.PI)
      const chip = terrainRandomUnit(seed, String(i))
      const lip = mix(crest, base, depth / reach * (.03 + .13 * chip) * wear)
      const toe = mix(crest, base, depth / reach * (.06 + .94 * wear ** .42) * (.87 + .13 * chip))
      return { crest, lip, toe, wear }
    })
    if (shadeFace) {
      const end = mix(center, down, depth / reach)
      const shade = ctx.createLinearGradient(center.x, center.y, end.x, end.y)
      shade.addColorStop(0, alpha(palette.joint, .80))
      shade.addColorStop(.28, alpha(palette.joint, .64))
      shade.addColorStop(.69, alpha(palette.shadow, .30))
      shade.addColorStop(1, alpha(palette.shadow, 0))
      ctx.fillStyle = shade
      ctx.fill(polygon([...points.map(row => row.lip), ...points.map(row => row.toe).reverse()]))
    }
    // The worn edge reads as one step with tapered ends at map scale.
    const rim = points.map(({ crest, lip, wear }, i) => {
      const highlight = (12 + height * .15) * wear * (.62 + .38 * terrainRandomUnit(seed, `rim/${i}`))
      return { x: crest.x + (center.x - down.x) / reach * highlight,
        y: crest.y + (center.y - down.y) / reach * highlight, lip }
    })
    ctx.fillStyle = alpha(palette.light, shadeFace ? .64 : .36)
    ctx.fill(polygon([...rim, ...rim.map(row => row.lip).reverse()]))
  }
  ctx.restore()
}

export function paintGradedRoadCovers(ctx: CanvasRenderingContext2D, finish: ProjectedPath['gradedFinish']) {
  const colors = { earth: '#8c7657', grass: '#737d53', rock: '#858781' }
  ctx.save()
  for (const cover of finish?.covers ?? []) {
    ctx.globalCompositeOperation = cover.kind === 'reveal-ground' ? 'destination-out' : 'source-over'
    ctx.fillStyle = cover.kind === 'reveal-ground' ? '#fff' : alpha(colors[cover.kind], .84)
    ctx.fill(polygon(cover.polygonMm))
  }
  ctx.restore()
}

export function fadeGradedRoadEnds(ctx: CanvasRenderingContext2D, { spans, footprintMm }: RoadSurfaceGeometry) {
  const first = spans[0], last = spans.at(-1)!
  const lengthMm = spans.reduce((total, { start, end }) => total + widthOf(mix(start[1], start[2], .5), mix(end[1], end[2], .5)), 0)
  ctx.save()
  ctx.clip(polygon(footprintMm))
  ctx.globalCompositeOperation = 'destination-out'
  for (const [cap, toward] of [[first.start, first.end], [last.end, last.start]]) {
    const a = mix(cap[1], cap[2], .5), b = mix(toward[1], toward[2], .5)
    const length = Math.hypot(b.x - a.x, b.y - a.y), width = Math.hypot(cap[2].x - cap[1].x, cap[2].y - cap[1].y)
    const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length, reach = Math.min(1850, width * 1.15, lengthMm * .23)
    const corner = (along: number, side: number) => ({ x: a.x + dx * along - dy * side, y: a.y + dy * along + dx * side })
    const tip = corner(reach, 0), wash = ctx.createLinearGradient(a.x, a.y, tip.x, tip.y)
    wash.addColorStop(0, '#000')
    wash.addColorStop(.28, '#000d')
    wash.addColorStop(.69, '#0004')
    wash.addColorStop(1, '#0000')
    ctx.fillStyle = wash
    ctx.fill(polygon([corner(-40, -width), corner(reach, -width), corner(reach, width), corner(-40, width)]))
  }
  ctx.restore()
}
