import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedPath } from '../../../shared/projection/types.js'
import { staircasePointAt, type StaircaseGeometry } from '../../../shared/stairs/geometry.js'
import { terrainRandomUnit } from '../../../shared/terrain-generation/field.js'
import { planEarthenRoad } from './earthen-road.js'

function outline(points: PointMm[]) {
  const path = new Path2D()
  points.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y))
  return path
}

/** Reveal the underlying snow or soil in short, irregular tongues along the road. */
export function erodeRoadPaintEdge(ctx: CanvasRenderingContext2D, ring: PointMm[], widthMm: number, ends: ProjectedPath['groundBlendEnds'] = []) {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#fff'
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    const count = Math.min(48, Math.floor(length / Math.max(130, widthMm * 2.7)))
    for (let j = 0; j < count; j++) {
      const p = { x: a.x + (j + .5) / count * dx, y: a.y + (j + .5) / count * dy }
      const seed = `${Math.round(p.x / 45)},${Math.round(p.y / 45)}`
      const depth = widthMm * (1.38 + terrainRandomUnit(seed, 'depth') * 1.05)
      const half = Math.min(length / count * .44, widthMm * (0.53 + terrainRandomUnit(seed, 'span') * .45))
      const x = p.x, y = p.y, tx = dx / length, ty = dy / length
      ctx.globalAlpha = .40 + terrainRandomUnit(seed, 'opacity') * .53
      ctx.beginPath()
      ctx.moveTo(x - tx * half * 1.7, y - ty * half * 1.7)
      ctx.quadraticCurveTo(x - ty * depth - tx * half * .60, y + tx * depth - ty * half * .60, x - ty * depth * .86, y + tx * depth * .86)
      ctx.quadraticCurveTo(x - ty * depth * .62 + tx * half, y + tx * depth * .62 + ty * half, x + tx * half, y + ty * half)
      ctx.closePath(); ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  for (const { point, inward, widthMm } of ends) {
    const at = (d: number, side: number) => ({ x: point.x + inward.x * d - inward.y * side, y: point.y + inward.y * d + inward.x * side })
    const start = -Math.min(1000, .55 * widthMm), end = Math.min(700, .65 * widthMm), halfSpan = Math.min(3400, widthMm)
    const a = at(start, 0), b = at(end, 0), fade = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
    fade.addColorStop(0, '#fff'); fade.addColorStop(.24, 'rgba(255,255,255,.86)'); fade.addColorStop(.68, 'rgba(255,255,255,.20)'); fade.addColorStop(1, 'rgba(255,255,255,0)')
    const patch = outline([at(start, halfSpan), at(end, halfSpan), at(end, -halfSpan), at(start, -halfSpan)]); patch.closePath()
    ctx.fillStyle = fade; ctx.fill(patch)
  }
  ctx.restore()
}

/** Paint shallow, worn riser faces over the actual road material. */
export function drawEarthenRoadPaint(ctx: CanvasRenderingContext2D, stairs: StaircaseGeometry, groundAt: (point: PointMm) => number) {
  const plan = planEarthenRoad(stairs, groundAt)
  const at = (d: number, side = 0) => staircasePointAt(stairs, d, side)
  ctx.save()
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  for (const { distance, rise } of plan.risers) {
    const height = Math.abs(rise)
    if (height < 34) continue
    const direction = Math.sign(rise), anchor = at(distance)
    const seed = `${Math.round(anchor.x / 60)},${Math.round(anchor.y / 60)}`
    const random = (key: string) => terrainRandomUnit(seed, key)
    const depth = Math.min(138, 22 + height * .48), span = .29 + .075 * random('span'), drift = (random('drift') - .5) * .10
    const offsets = [-1, -.65, -.26, .20, .61, 1].map((part, index) => ({
      side: drift + span * part,
      distance: distance + (random(`lip/${index}`) - .5) * Math.min(55, depth * .66),
      depth: depth * (1 - Math.abs(part) ** 2 * .80),
    }))
    const lower = offsets.map(row => at(row.distance - direction * row.depth, row.side)), lip = offsets.map(row => at(row.distance, row.side))
    const fadeFrom = at(distance - direction * depth), shade = ctx.createLinearGradient(anchor.x, anchor.y, fadeFrom.x, fadeFrom.y)
    shade.addColorStop(0, `rgba(47,43,36,${Math.min(.66, .23 + height / 520)})`)
    shade.addColorStop(1, 'rgba(67,61,50,0)')
    const face = outline([...lip, ...lower.reverse()]); face.closePath()
    ctx.fillStyle = shade; ctx.fill(face)
    // The lip is chipped and fades into both banks, leaving the grain and
    // colour of the underlying loam visible through the step.
    ctx.strokeStyle = 'rgba(235,219,181,0.66)'; ctx.lineWidth = Math.min(21, 7 + height * .07)
    ctx.stroke(outline(offsets.slice(1, -1).map(row => at(row.distance + direction * 15, row.side))))
  }
  ctx.restore()
}
