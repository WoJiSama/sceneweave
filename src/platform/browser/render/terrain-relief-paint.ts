import { reliefBounds, sampleTerrainRelief } from '../../../shared/geometry/terrain-relief.js'
import type { ProjectedSurface } from '../../../shared/projection/types.js'
import type { VisualEnvironment } from '../../../shared/visual/types.js'
import { directionToLight } from '../../../shared/visual/directional-light.js'

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const ramp = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t) }

/** A world-space pigment layer over exposed slopes. The saved surface
 * supplies height and slope; both terrain views use the same brush. */
export function drawWeatheredRelief(ctx: CanvasRenderingContext2D, area: ProjectedSurface, clip: Path2D) {
  const relief = area.relief
  if (!relief || area.reliefFinish !== 'weathered-v1') return
  const box = reliefBounds(area.points), canvas = document.createElement('canvas')
  const scale = Math.min(920 / Math.max(box.width, box.height), 1 / 67)
  const width = canvas.width = Math.max(3, Math.ceil(box.width * scale))
  const height = canvas.height = Math.max(3, Math.ceil(box.height * scale))
  const stepX = box.width / width, stepY = box.height / height
  const pigment = canvas.getContext('2d')!, image = pigment.createImageData(width, height)
  const heights = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    heights[y * width + x] = sampleTerrainRelief(relief, box, { x: box.x + (x + .5) * stepX, y: box.y + (y + .5) * stepY }).offsetMm
  }
  const span = Math.max(1, Math.round(310 / Math.min(stepX, stepY)))
  const at = (x: number, y: number) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const wx = box.x + (x + .5) * stepX, wy = box.y + (y + .5) * stepY, z = area.elevationMm + at(x, y)
    const dx = (at(x + span, y) - at(x - span, y)) / (2 * span * stepX)
    const dy = (at(x, y + span) - at(x, y - span)) / (2 * span * stepY)
    const slope = Math.hypot(dx, dy)
    const fold = Math.sin(wx / 1577 + Math.sin(wy / 990) * .67) * Math.cos(wy / 2033 - wx / 3602)
    const exposure = ramp((slope - .22 + fold * .058) / .46)
    if (exposure <= .001) continue
    const grain = Math.sin(wx / 94 - wy / 83) * Math.sin(wy / 103 + z / 230)
    const beds = (z + wx * .063 - wy * .041 + 137 * fold + 50 * Math.sin(wx / 560 + wy / 800)) / 770
    const face = beds - Math.floor(beds)
    const breakage = .47 + .53 * ramp((Math.sin(wx / 688 - wy / 1320) + Math.cos(wy / 942 + wx / 1930) + .19) / 1.17)
    const strata = Math.max(0, (face - .81) / .19) * breakage
    const lightBed = .56 * Math.max(0, 1 - face * 9) * breakage
    const fissure = ramp((Math.sin(wx / 331 + wy / 521 + z / 1477 + fold * 3.3) - .931) / .069)
      * ramp((Math.cos(wy / 654 + wx / 1928) - .03) / .67)
    const shade = 21 * fold + 6 * grain + 26 * lightBed - 23 * strata - 21 * fissure
    const i = (y * width + x) * 4
    image.data[i] = 82 + shade
    image.data[i + 1] = 88 + shade
    image.data[i + 2] = 92 + shade
    image.data[i + 3] = Math.round(exposure * (130 + 44 * strata + 32 * fissure))
  }
  pigment.putImageData(image, 0, 0)
  ctx.save(); ctx.clip(clip, 'evenodd')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(canvas, box.x, box.y, box.width, box.height)
  ctx.restore()
  canvas.width = canvas.height = 0
}

export function drawTerrainReliefLight(ctx: CanvasRenderingContext2D, area: ProjectedSurface, clip: Path2D, environment?: VisualEnvironment) {
  const grid = area.relief
  if (!grid) return
  const { columns, rows, offsetsMm } = grid, bounds = reliefBounds(area.points)
  const [sunX, sunY, sunZ] = directionToLight(environment)
  const shade = document.createElement('canvas')
  shade.width = columns
  shade.height = rows
  const color = shade.getContext('2d')!
  const image = color.createImageData(columns, rows)
  const sample = (x: number, y: number) => offsetsMm[y * columns + x]
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const west = Math.max(0, x - 1), east = Math.min(columns - 1, x + 1)
    const north = Math.max(0, y - 1), south = Math.min(rows - 1, y + 1)
    const dx = (sample(west, y) - sample(east, y)) * (columns - 1) / (bounds.width * (east - west))
    const dy = (sample(x, north) - sample(x, south)) * (rows - 1) / (bounds.height * (south - north))
    const illumination = Math.max(0, (dx * sunX + dy * sunY + sunZ) / Math.hypot(dx, dy, 1)) - sunZ
    const i = (y * columns + x) * 4
    image.data[i] = illumination > 0 ? 231 : 20
    image.data[i + 1] = illumination > 0 ? 222 : 24
    image.data[i + 2] = illumination > 0 ? 199 : 25
    image.data[i + 3] = Math.min(118, Math.abs(illumination) * (illumination > 0 ? 174 : 195))
  }
  color.putImageData(image, 0, 0)
  const stepX = bounds.width / (columns - 1), stepY = bounds.height / (rows - 1)
  ctx.save()
  ctx.clip(clip, 'evenodd')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(shade, bounds.x - stepX / 2, bounds.y - stepY / 2, bounds.width + stepX, bounds.height + stepY)
  ctx.restore()
  shade.width = shade.height = 0
}
