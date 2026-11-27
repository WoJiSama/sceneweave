import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'
import { terrainRandomUnit } from '../../../shared/terrain-generation/field.js'
import { directionToLight } from '../../../shared/visual/directional-light.js'
import type { VisualEnvironment } from '../../../shared/visual/types.js'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Cache the lattice, so drawing a large surface does not hash each pixel. */
function reliefNoise(bounds: BoundsMm, spacing: number, feature: string) {
  const left = Math.floor(bounds.x / spacing), top = Math.floor(bounds.y / spacing)
  const columns = Math.ceil((bounds.x + bounds.width) / spacing) - left + 1
  const rows = Math.ceil((bounds.y + bounds.height) / spacing) - top + 1
  const values = Float32Array.from({ length: columns * rows }, (_, i) =>
    2 * terrainRandomUnit(feature, `${left + i % columns}/${top + Math.floor(i / columns)}`) - 1)
  return (x: number, y: number) => {
    const u = x / spacing - left, v = y / spacing - top
    const col = Math.floor(u), row = Math.floor(v), i = row * columns + col
    const dx = smooth(u - col), dy = smooth(v - row)
    return mix(mix(values[i], values[i + 1], dx), mix(values[i + columns], values[i + columns + 1], dx), dy)
  }
}

export function paintReliefOutcrops(ctx: CanvasRenderingContext2D, image: ImageData, bounds: BoundsMm, heights: Float32Array,
  environment?: VisualEnvironment) {
  const { width, height, data } = image
  const stepX = bounds.width / width, stepY = bounds.height / height
  const step = Math.max(stepX, stepY)
  const short = Math.max(1, Math.round(470 / step)), long = Math.max(short + 1, Math.round(1790 / step))
  const pocket = reliefNoise(bounds, Math.max(3740, step * 6), 'rock-exposure')
  const grain = reliefNoise(bounds, Math.max(340, step * 2), 'rock-weathering')
  const [sunX, sunY, sunZ] = directionToLight(environment)
  const at = (x: number, y: number) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]
  const east = (x: number, y: number, span: number) => (at(x + span, y) - at(x - span, y)) / (2 * span * stepX)
  const south = (x: number, y: number, span: number) => (at(x, y + span) - at(x, y - span)) / (2 * span * stepY)
  const rockLight = (dx: number, dy: number) => (sunZ - dx * sunX - dy * sunY) / Math.hypot(dx, dy, 1)

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = east(x, y, short), dy = south(x, y, short), grade = Math.hypot(dx, dy)
    if (grade < .085) continue
    const wx = bounds.x + (x + .5) * stepX, wy = bounds.y + (y + .5) * stepY
    const variation = pocket(wx, wy), weathering = grain(wx, wy)
    const broadGrade = Math.hypot(east(x, y, long), south(x, y, long))
    const rock = smooth((grade - .43 + .36 * variation + .105 * weathering + .24 * (grade - broadGrade)) / .59)
    const patch = .36 + .57 * smooth((variation + .58) / 1.02) + .07 * smooth((grade - 1.02) / .66)
    // A concave break below a steep face collects loose stone. An upper
    // shoulder at the same steepness keeps its ground cover.
    const u = Math.round(long * dx / grade), v = Math.round(long * dy / grade)
    const bend = (at(x + u, y + v) + at(x - u, y - v) - 2 * at(x, y)) / Math.hypot(u * stepX, v * stepY)
    const talus = smooth((bend - .08) / .41) * smooth((broadGrade - .35) / .38) * smooth((grade - .09) / .24)
    const value = clamp(.52 + (rockLight(dx, dy) - sunZ) * .68 + .24 * variation + .12 * weathering)
    const i = (y * width + x) * 4
    data[i] = mix(105, 211, value) + 12 * talus
    data[i + 1] = mix(104, 180, value) + 6 * talus
    data[i + 2] = mix(113, 141, value)
    data[i + 3] = 244 * rock * patch + 88 * talus * (1 - rock) * (.65 + .35 * weathering)
  }
  ctx.putImageData(image, 0, 0)

  const spacing = Math.max(2120, step * 13)
  const x0 = Math.floor(bounds.x / spacing), x1 = Math.ceil((bounds.x + bounds.width) / spacing)
  const y0 = Math.floor(bounds.y / spacing), y1 = Math.ceil((bounds.y + bounds.height) / spacing)
  const face = (points: PointMm[], color: string | CanvasGradient) => {
    ctx.fillStyle = color
    ctx.beginPath()
    for (const { x, y } of points) ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.save()
  ctx.setTransform(1 / stepX, 0, 0, 1 / stepY, -bounds.x / stepX, -bounds.y / stepY)
  ctx.globalCompositeOperation = 'source-atop'
  for (let row = y0; row < y1; row++) for (let col = x0; col < x1; col++) {
    const seed = `${col}/${row}`
    const random = (key: string) => terrainRandomUnit(seed, `outcrop/${key}`)
    const x = (col + .14 + .72 * random('x')) * spacing, y = (row + .14 + .72 * random('y')) * spacing
    const i = Math.floor((x - bounds.x) / stepX), j = Math.floor((y - bounds.y) / stepY)
    if (i < 0 || j < 0 || i >= width || j >= height || data[(j * width + i) * 4 + 3] < 42) continue
    const dx = east(i, j, long), dy = south(i, j, long), grade = Math.hypot(dx, dy)
    if (grade < .37 || random('gap') < .20) continue
    // Trace the fracture down the actual fall line. Tilting the fracture
    // locally gives rock faces different orientations on a single escarpment.
    const ux = -dx / grade, uy = -dy / grade, lean = 1.15 * (random('lean') - .5)
    const across = spacing * (.25 + .84 * random('width'))
    const down = spacing * (.52 + .89 * random('reach')) * (.75 + .40 * smooth(grade))
    const point = (u: number, v: number) => ({ x: x - uy * across * u + ux * down * v, y: y + ux * across * u + uy * down * v })
    const crest = point(-.05, -.54 + .25 * random('crest')), saddle = point(lean * .16 - .13, -.11)
    const hinge = point(lean * .52, .18), end = point(lean, .76 + .13 * random('tail'))
    const shoulder = point(.55, -.30 + .22 * random('shoulder'))
    const outside = point(.53 + lean * .55, .09 + .6 * random('toe'))
    const light = rockLight(dx, dy), sunward = -uy * sunX + ux * sunY
    const strength = (.41 + .59 * random('contrast')) * (.62 + .38 * smooth(grade))
    const wash = ctx.createLinearGradient(hinge.x, hinge.y, outside.x, outside.y)
    wash.addColorStop(0, `rgba(218,193,158,${strength * (.27 + .33 * Math.max(0, light))})`)
    wash.addColorStop(.63, `rgba(183,158,130,${strength * .26})`)
    wash.addColorStop(1, 'rgba(159,137,120,0)')
    face([crest, shoulder, outside, end, hinge, saddle], wash)
    const seam = ctx.createLinearGradient(crest.x, crest.y, end.x, end.y)
    seam.addColorStop(0, `rgba(67,53,51,${strength * .43})`)
    seam.addColorStop(.40, `rgba(60,51,54,${strength * (.64 + .16 * Math.abs(sunward))})`)
    seam.addColorStop(1, 'rgba(62,55,61,0)')
    const edge = .075 + .09 * random('edge')
    face([crest, saddle, hinge, end, point(lean + edge * .32, .66), point(lean * .52 + edge, .18),
      point(lean * .16 + edge * .5 - .13, -.14)], seam)
    const shelf = point(-.4 - .34 * random('shelf'), -.26 + .26 * random('shelf-height'))
    face([shelf, point(-.24, -.15), saddle, point(-.28, -.09)], `rgba(239,214,175,${strength * (.22 + .33 * Math.max(0, light))})`)
  }
  ctx.restore()
}
