import { reliefBounds } from '../../../shared/geometry/terrain-relief.js'
import type { ProjectedSurface } from '../../../shared/projection/types.js'
import type { VisualEnvironment } from '../../../shared/visual/types.js'

export function drawTerrainReliefLight(ctx: CanvasRenderingContext2D, area: ProjectedSurface, clip: Path2D, environment?: VisualEnvironment) {
  const grid = area.relief
  if (!grid) return
  const { columns, rows, offsetsMm } = grid, bounds = reliefBounds(area.points)
  const bearing = ((environment?.lightDirectionDeg ?? 135) + 180) * Math.PI / 180
  // Keep a local slope cue in diffuse environments as well as directional ones.
  const pitch = Math.max(24, environment?.directionalLight?.elevationDeg ?? 35) * Math.PI / 180
  const sunX = Math.sin(bearing) * Math.cos(pitch), sunY = -Math.cos(bearing) * Math.cos(pitch), sunZ = Math.sin(pitch)
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
