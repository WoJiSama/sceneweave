import { setCanvasBlur } from './canvas-filter.js'
import { drawLineProfile } from './line-profiles.js'
import type { BoundsMm, BridgeArt, PointMm } from '../../../shared/model/scene.js'
import type { ProjectedBridge } from '../../../shared/projection/types.js'
import { industrialFaceLight, shadeIndustrialFace, type IndustrialFaceEnvironment } from './industrial-face-light.js'

const steel = { outer: '#10191E', edge: '#303C42', trim: '#596C73', highlight: '#6C7E82', bolt: '#899999' }
const timber = { outer: '#2D211A', edge: '#654631', trim: '#AD8257', highlight: '#BD9160', bolt: '#594034' }

export function drawBridgeContactShadow(ctx: CanvasRenderingContext2D, bridge: ProjectedBridge, offset: PointMm): void {
  const transform = ctx.getTransform()
  ctx.save()
  ctx.translate(offset.x, offset.y)
  ctx.globalAlpha = bridge.relief!.shadowOpacity
  setCanvasBlur(ctx, Math.hypot(transform.a, transform.b) * 48, '#152426')
  ctx.fillStyle = '#152426'
  ctx.fill(ring(bridge.outline))
  ctx.restore()
}

export function drawBridgeDeckEdge(ctx: CanvasRenderingContext2D, cap: [PointMm, PointMm], finish: ProjectedBridge['finish']): void {
  const [a, b] = cap, width = Math.hypot(b.x - a.x, b.y - a.y)
  const inset = (p: PointMm) => ({ x: p.x + (a.y - b.y) * 54 / width, y: p.y + (b.x - a.x) * 54 / width })
  const innerA = inset(a), innerB = inset(b), colors = finish === 'steel' ? steel : timber
  ctx.save()
  ctx.fillStyle = colors.outer
  ctx.fill(ring([a, b, innerB, innerA]))
  line(ctx, innerA.x, innerA.y, innerB.x, innerB.y, 17, colors.trim)
  ctx.restore()
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string | CanvasGradient) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function ring(points: readonly PointMm[]): Path2D {
  const body = new Path2D()
  if (points.length) body.moveTo(points[0].x, points[0].y)
  for (const p of points.slice(1)) body.lineTo(p.x, p.y)
  body.closePath()
  return body
}

const hardwarePaint = {
  riveted: { rim: '#151b1d', body: '#424746', light: '#76776a', plate: '#525954', recess: '#272e2d', accent: '#c6a367' },
  alloy: { rim: '#111e26', body: '#344d57', light: '#779497', plate: '#496167', recess: '#20363e', accent: '#6ce8d4' },
}

/** The last flange continues into the same-height bearing seat at each bank. */
export function drawBridgeBearingSeat(ctx: CanvasRenderingContext2D, bridge: ProjectedBridge, end: 'start' | 'end', contact: PointMm): void {
  if (!bridge.structure) return
  const points = bridge.centerlineMm
  const [tip, next] = end === 'start' ? [points[0], points[1]] : [points.at(-1)!, points.at(-2)!]
  const length = Math.hypot(tip.x - next.x, tip.y - next.y)
  const ux = (tip.x - next.x) / length, uy = (tip.y - next.y) / length
  const seatLength = Math.min(1800, Math.max(680, bridge.widthMm * .48))
  const fade = ctx.createLinearGradient(contact.x - ux * 350, contact.y - uy * 350,
    contact.x + ux * seatLength, contact.y + uy * seatLength)
  const colors = bridge.finish === 'steel' ? steel : timber
  fade.addColorStop(0, colors.edge)
  fade.addColorStop(.36, colors.edge)
  fade.addColorStop(.82, colors.edge + 'A3')
  fade.addColorStop(1, colors.edge + '00')
  ctx.fillStyle = fade
  ctx.fill(ring(bridge.outline))
}

/** Load plates sit on the two flanks of the entrance. */
export function drawBridgeLandings(ctx: CanvasRenderingContext2D, bridge: ProjectedBridge): void {
  if (!bridge.structure) return
  const paint = hardwarePaint[bridge.structure.palette]
  ctx.save(); ctx.clip(ring(bridge.outline))
  const mix = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  for (const { outline: [innerLeft, outerLeft, outerRight, innerRight] } of bridge.structure.landings) {
    const at = (along: number, across: number) => mix(mix(innerLeft, outerLeft, along), mix(innerRight, outerRight, along), across)
    const span = Math.hypot(innerRight.x - innerLeft.x, innerRight.y - innerLeft.y)
    const shoulder = Math.max(0, (span - bridge.widthMm) / span / 2)
    if (shoulder < .025) continue
    for (const flip of [false, true]) {
      const p = (along: number, across: number) => at(along, flip ? 1 - across : across)
      const plate = (from: number, to: number, inset: number, width: number, bevel: number, color: string) => {
        ctx.fillStyle = color
        ctx.fill(ring([p(from, inset + width * bevel), p(from + .09, inset), p(to - .11, inset),
          p(to, inset + width * bevel), p(to, inset + width * (1 - bevel)), p(from, inset + width)]))
      }
      const width = shoulder * .73
      plate(-.24, .94, .05, width, .30, paint.rim)
      plate(-.19, .84, .06, width * .82, .30, paint.body)
      plate(-.16, .76, .075, width * .62, .30, paint.plate)
      const a = p(-.12, .05 + width * .42), b = p(.70, .05 + width * .42)
      line(ctx, a.x, a.y, b.x, b.y, 52, paint.recess)
      line(ctx, a.x, a.y, b.x, b.y, 19, paint.accent)
      for (const station of [-.075, .72]) {
        const bolt = p(station, .05 + width * .67)
        dot(ctx, bolt.x, bolt.y, 28, paint.rim)
        dot(ctx, bolt.x, bolt.y, 13, paint.light)
      }
    }
  }
  ctx.restore()
}

/** The near sides share one depth vector at each vertex. Repeat the flange
 * and stiffeners over those same faces, including each bend and landing. */
export function drawBridgeSides(ctx: CanvasRenderingContext2D, bridge: ProjectedBridge, offset: PointMm, perimeter: [PointMm, PointMm][],
  environment?: IndustrialFaceEnvironment): void {
  const colors = bridge.finish === 'steel' ? steel : timber
  const faceEnvironment = bridge.structure && bridge.finish === 'steel' ? environment : undefined
  const points = bridge.outline, origin = points[0]
  const facing = Math.sign(points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length]
    return sum + (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y)
  }, 0))
  const faces = perimeter.flatMap(([a, b]) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    return (dy * offset.x - dx * offset.y) * facing > length
      ? [{ a, b, dx, dy, length, light: industrialFaceLight(dx, dy, facing, faceEnvironment) }]
      : []
  })
  const at = (p: PointMm, depth: number) => ({ x: p.x + offset.x * depth, y: p.y + offset.y * depth })
  const flange = (from: number, to: number, color: string) => {
    const batches = new Map<string, Path2D>()
    for (const { a, b, light } of faces) {
      const paint = shadeIndustrialFace(color, light)
      const path = batches.get(paint) ?? new Path2D()
      path.addPath(ring([at(a, from), at(b, from), at(b, to), at(a, to)]))
      batches.set(paint, path)
    }
    if (batches.size > 1) {
      // Cover the joint beneath both antialiased edges of a differently lit turn.
      const underpaint = new Path2D()
      for (const path of batches.values()) underpaint.addPath(path)
      ctx.fillStyle = color
      ctx.fill(underpaint)
    }
    for (const [paint, path] of batches) {
      ctx.fillStyle = paint
      ctx.fill(path)
    }
  }
  if (!bridge.structure) {
    flange(0, 1, colors.outer)
    flange(.12, .58, colors.edge)
    flange(.12, .24, colors.trim)
    return
  }
  paintGirderFlanges(bridge.finish, flange)
  const spacing = bridge.relief!.ribSpacingMm
  for (const { a, dx, dy, length, light } of faces) {
    const outer = shadeIndustrialFace(colors.outer, light), edge = shadeIndustrialFace(colors.edge, light)
    const boltPaint = shadeIndustrialFace(colors.bolt, light)
    const count = Math.min(48, Math.floor(length / Math.max(1100, spacing * .58)))
    for (let i = 0; i < count; i++) {
      const center = (i + .5) * length / count, half = Math.min(170, length / count * .1)
      const atStation = (station: number, depth: number) => at({ x: a.x + dx * station / length, y: a.y + dy * station / length }, depth)
      ctx.fillStyle = outer
      ctx.fill(ring([atStation(center - half, .19), atStation(center + half, .19), atStation(center + half, .83), atStation(center - half, .83)]))
      ctx.fillStyle = edge
      ctx.fill(ring([atStation(center - half * .75, .22), atStation(center + half * .4, .22),
        atStation(center + half * .4, .8), atStation(center - half * .75, .8)]))
      const bolt = atStation(center - half * .15, .3)
      dot(ctx, bolt.x, bolt.y, Math.min(24, Math.hypot(offset.x, offset.y) * .08), boltPaint)
    }
  }
}

export function paintGirderFlanges(finish: ProjectedBridge['finish'], flange: (from: number, to: number, color: string) => void): void {
  const colors = finish === 'steel' ? steel : timber
  const inset = finish === 'steel' ? '#1D282E' : '#392C23'
  flange(0, 1, colors.outer)
  flange(.10, .86, inset)
  flange(.10, .26, colors.edge)
  flange(.11, .14, colors.trim)
  flange(.26, .40, colors.outer)
  flange(.69, .77, colors.edge)
  flange(.78, .93, colors.outer)
  flange(.81, .87, colors.edge)
  flange(.85, .88, colors.trim)
}

/** Solid shoulders and perimeter cladding. The route owns the wearing surface. */
export function drawBridgeStructure(ctx: CanvasRenderingContext2D, bridge: ProjectedBridge, perimeter?: Path2D): void {
  const colors = bridge.finish === 'steel' ? steel : timber
  const outside = ring(bridge.outline)
  ctx.save()
  ctx.fillStyle = colors.edge
  ctx.fill(outside)
  ctx.clip(outside)
  ctx.lineJoin = 'round'
  ctx.strokeStyle = colors.outer
  ctx.lineWidth = 140
  ctx.stroke(perimeter ?? outside)
  ctx.strokeStyle = colors.trim
  ctx.lineWidth = 38
  ctx.stroke(perimeter ?? outside)
  ctx.restore()
}

function drawBridgeJoint(ctx: CanvasRenderingContext2D, v: BoundsMm, palette: keyof typeof hardwarePaint, corner: boolean, detail: number) {
  const paint = hardwarePaint[palette]
  const point = (x: number, y: number) => ({ x: v.x + x * v.width, y: v.y + y * v.height })
  const plate = (x1: number, y1: number, x2: number, y2: number, cut: number, color: string) => {
    ctx.fillStyle = color
    ctx.fill(ring([point(x1 + cut, y1), point(x2 - cut, y1), point(x2, y1 + cut), point(x2, y2 - cut),
      point(x2 - cut, y2), point(x1 + cut, y2), point(x1, y2 - cut), point(x1, y1 + cut)]))
  }
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(v.x + x * v.width, v.y + y * v.height, w * v.width, h * v.height)
  }
  plate(.01, .01, .99, .99, corner ? .26 : .16, paint.rim)
  plate(.064, .055, .936, .93, corner ? .22 : .135, paint.body)
  plate(.14, .14, .86, .835, corner ? .19 : .10, paint.recess)
  if (corner) {
    plate(.19, .22, .81, .79, .16, paint.light)
    plate(.25, .25, .75, .74, .13, paint.plate)
    rect(.34, .68, .32, .026 * detail, paint.accent)
  } else {
    rect(.21, .19, .58, .565, paint.plate)
    for (const x of [.21, .71]) {
      rect(x, .18, .08, .565, paint.light)
      rect(x + .08, .23, .04, .47, paint.rim)
    }
    rect(.22, .77, .56, .033 * detail, paint.accent)
    for (const y of [.32, .60]) rect(.36, y, .28, .026, paint.body)
  }
  const bolt = Math.min(v.width, v.height) * .059
  for (const p of [point(.5, .13), point(.5, .86)]) {
    dot(ctx, p.x, p.y, bolt, paint.rim)
    dot(ctx, p.x, p.y - bolt * .17, bolt * .58, paint.accent)
  }
}

function drawPipeFitting(ctx: CanvasRenderingContext2D, art: 'pipeManifold' | 'pipeSocket', v: BoundsMm): void {
  const { x, y, width, height } = v
  const rect = (l: number, t: number, r: number, b: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(x + width * l, y + height * t, width * (r - l), height * (b - t))
  }
  const housing = (inset: number, bevel: number, color: string) => {
    const a = inset, b = 1 - inset, c = a + bevel, d = b - bevel
    const outline = [[c, a], [d, a], [b, c], [b, d], [d, b], [c, b], [a, d], [a, c]]
      .map(([u, v]) => ({ x: x + u * width, y: y + v * height }))
    ctx.fillStyle = color
    ctx.fill(ring(outline))
  }
  housing(0, .21, '#111B22')
  housing(.075, .17, '#748480')
  housing(.14, .12, '#3A4C50')
  if (art === 'pipeManifold') {
    housing(.27, .14, '#192B32')
    housing(.34, .12, '#4C6869')
    rect(.41, .47, .59, .54, '#70E8C4')
    for (const u of [.25, .75]) for (const v of [.24, .76]) {
      const radius = Math.min(width, height) * .047
      dot(ctx, x + width * u, y + height * v, radius, '#17252B')
      dot(ctx, x + width * u, y + height * v - radius * .24, radius * .49, '#A49A75')
    }
  } else {
    rect(.29, .14, .46, .86, '#879693')
    rect(.47, .15, .68, .85, '#26383E')
    rect(.53, .26, .72, .33, '#BC9C6A')
    rect(.53, .67, .72, .74, '#78C6B3')
  }
}

/** A complete repeating panel has one enlarged node and its own directional inner detail. */
export function drawBridgeSymbol(ctx: CanvasRenderingContext2D, art: BridgeArt, v: BoundsMm, detailPercent = 100): void {
  const detail = detailPercent / 100
  if (art === 'pipeManifold' || art === 'pipeSocket') { drawPipeFitting(ctx, art, v); return }
  if (art === 'rivetedSupport' || art === 'alloySupport' || art === 'rivetedCorner' || art === 'alloyCorner') {
    drawBridgeJoint(ctx, v, art.startsWith('alloy') ? 'alloy' : 'riveted', art.endsWith('Corner'), detail)
    return
  }
  if (art === 'nodeLamp') {
    const x = v.x + v.width / 2, y = v.y + v.height / 2, radius = Math.min(v.width, v.height) / 2
    const glow = ctx.createRadialGradient(x, y, radius * .15, x, y, radius)
    glow.addColorStop(0, 'rgba(255,220,143,.72)')
    glow.addColorStop(.38, 'rgba(255,202,111,.24)')
    glow.addColorStop(1, 'rgba(230,141,42,0)')
    dot(ctx, x, y, radius, glow)
    dot(ctx, x, y, radius * .29, '#1c2524')
    dot(ctx, x, y, radius * .22, '#a48550')
    dot(ctx, x, y, radius * .15, '#fff0bb')
    return
  }
  if (art !== 'steelRail' && art !== 'timberRail' && art !== 'lamp') { drawLineProfile(ctx, art, v, detailPercent); return }
  if (art === 'lamp') {
    const x = v.x + v.width / 2, y = v.y + v.height * .705
    const glow = ctx.createRadialGradient(x, y - 82, 14, x, y - 82, Math.min(v.width, v.height) * .49)
    glow.addColorStop(0, 'rgba(255,209,128,.60)')
    glow.addColorStop(.27, 'rgba(223,143,61,.28)')
    glow.addColorStop(1, 'rgba(206,120,29,0)')
    ctx.fillStyle = glow
    ctx.fillRect(v.x, v.y, v.width, v.height)
    dot(ctx, x, y, 88, '#191E20')
    dot(ctx, x, y, 66, '#927049')
    dot(ctx, x, y - 12, 42, '#FFE0A5')
    dot(ctx, x - 7, y - 20, 20, '#FFF3D1')
    return
  }
  const { x, y, width, height } = v, center = x + width / 2, mid = y + height / 2
  const wooden = art === 'timberRail', colors = wooden ? timber : steel
  const node = Math.min(width * .49, wooden ? 262 : 515)
  const post = center - node / 2
  ctx.fillStyle = colors.outer
  ctx.fillRect(x, y + height * .16, width, height * .70)
  ctx.fillStyle = colors.edge
  ctx.fillRect(x, y + height * .24, width, height * .43)
  ctx.fillStyle = colors.highlight
  ctx.fillRect(x, y + height * .24, width, height * .085 * detail)
  ctx.fillStyle = wooden ? '#6B4C34' : '#7B643E'
  ctx.fillRect(x, y + height * .73, width, height * .06)
  if (!wooden) {
    ctx.fillStyle = '#18282D'
    ctx.fillRect(x, y + height * .49, width, height * .09)
    ctx.fillStyle = '#806B4A'
    ctx.fillRect(x, y + height * .30, width, height * .045 * detail)
  }
  ctx.fillStyle = colors.outer
  const bevel = Math.min(node / 5, height / 7)
  ctx.fill(ring([{ x: post, y: y + bevel }, { x: post + bevel, y }, { x: post + node - bevel, y },
    { x: post + node, y: y + bevel }, { x: post + node, y: y + height - bevel },
    { x: post + node - bevel, y: y + height }, { x: post + bevel, y: y + height }, { x: post, y: y + height - bevel }]))
  ctx.fillStyle = colors.trim
  ctx.fillRect(post + node * .10, y + height * .07, node * .8, height * .82)
  ctx.fillStyle = wooden ? '#966B44' : '#465256'
  ctx.fillRect(post + node * .17, y + height * .14, node * .66, height * .66)
  ctx.fillStyle = colors.highlight
  ctx.fillRect(post + node * .17, y + height * .14, node * .66, height * .085 * detail)
  const bolt = Math.min(height * .08, node * .10)
  dot(ctx, center, mid, bolt * 1.4, colors.outer)
  dot(ctx, center, mid - bolt * .2, bolt, colors.bolt)
  if (!wooden && width > 600) {
    const inset = node * .29
    for (const dx of [-inset, inset]) {
      line(ctx, center + dx, y + height * .23, center + dx, y + height * .66, height * .043, '#222E33')
      dot(ctx, center + dx, y + height * .75, bolt * .66, '#C19558')
    }
    for (const pos of [x + width * .22, x + width * .78]) {
      ctx.fillStyle = colors.outer
      ctx.fillRect(pos - 46, y + height * .15, 92, height * .72)
      ctx.fillStyle = colors.trim
      ctx.fillRect(pos - 32, y + height * .23, 22, height * .48)
    }
  }
}
