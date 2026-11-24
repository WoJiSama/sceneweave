import type { BoundsMm } from '../../../shared/model/scene.js'
import type { MaterialBrush } from '../../../shared/projection/material-drawing.js'
import type { Projection } from '../../../shared/projection/types.js'
import { artStyleArtworkIds } from '../../../shared/visual/art-style-sources.js'

type PaintImage = HTMLCanvasElement | ImageBitmap
type Point = readonly [number, number]
const fieldSize = 256
const tau = Math.PI * 2

function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function buffer(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法准备材质画布。')
  return ctx
}

function polygon(ctx: CanvasRenderingContext2D, points: readonly Point[]) {
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i])
  ctx.closePath()
  ctx.fill()
}

/** Each dab has one shape and pigment, including where it wraps a tile seam. */
function brushField(brush: MaterialBrush, seed: number) {
  const ctx = buffer(fieldSize, fieldSize), next = random(seed)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, fieldSize, fieldSize)
  const gray = (value: number) => { const n = Math.round(value); return `rgb(${n} ${n} ${n})` }
  const dab = (x: number, y: number, dx: number, dy: number, width: number, tone: number) => {
    const length = Math.hypot(dx, dy), nx = -dy / length * width, ny = dx / length * width
    const points: Point[] = [[x, y], [x + dx * .23 + nx, y + dy * .23 + ny], [x + dx * .73 + nx * .6, y + dy * .73 + ny * .6],
      [x + dx, y + dy], [x + dx * .61 - nx * .64, y + dy * .61 - ny * .64], [x + dx * .15 - nx * .46, y + dy * .15 - ny * .46]]
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    ctx.fillStyle = gray(tone)
    for (let tx = -Math.floor(Math.max(...xs) / fieldSize); tx <= -Math.floor(Math.min(...xs) / fieldSize); tx++) {
      for (let ty = -Math.floor(Math.max(...ys) / fieldSize); ty <= -Math.floor(Math.min(...ys) / fieldSize); ty++) {
        ctx.setTransform(1, 0, 0, 1, tx * fieldSize, ty * fieldSize)
        polygon(ctx, points)
      }
    }
  }
  const wood = brush === 'wood', leaves = brush === 'foliage' || brush === 'grass'
  for (let i = 0; i < 84; i++) {
    const x = next() * fieldSize, y = next() * fieldSize
    const angle = (next() - .5) * (leaves ? 1.6 : .65) + (leaves ? -.73 : -.12)
    const length = (wood ? 26 : 8) + next() * (wood ? 99 : 44)
    const dx = length * Math.cos(angle), dy = wood ? (next() - .5) * 4 : length * Math.sin(angle)
    dab(x, y, dx, dy, (wood ? .7 : 2) + next() * (leaves ? 9 : wood ? 2.6 : 6), 83 + next() * 86)
    if (leaves) for (let j = 0; j < 3; j++) {
      const t = next(), size = .22 + next() * .27
      dab(x + t * dx, y + t * dy + next() * 9, dx * size, dy * size - 3, 1 + next() * 2.5, 63 + next() * 133)
    }
    if (brush === 'stone' && i % 3 === 0) {
      dab(x + .35 * dx, y + .35 * dy, dx * .54, dy * .54 + 6, 1.2, 66)
    }
  }
  if (brush === 'foliage') for (let cluster = 0; cluster < 57; cluster++) {
    const cx = next() * fieldSize, cy = next() * fieldSize, lean = next() * tau
    const tone = next() > .48 ? 155 + next() * 51 : 49 + next() * 51
    const count = 4 + Math.floor(next() * 6)
    for (let i = 0; i < count; i++) {
      const angle = lean + (next() - .5) * 1.5, reach = 3 + next() * 11
      dab(cx + (next() - .5) * 24, cy + (next() - .5) * 16,
        Math.cos(angle) * reach, Math.sin(angle) * reach, 1.2 + next() * 2.1, tone + next() * 12)
    }
  }
  const field = ctx.getImageData(0, 0, fieldSize, fieldSize).data
  ctx.canvas.width = 0
  return field
}

// Tone intervals and broken pigment are in source-image space; zooming or
// rotating the map never re-rolls a stroke. Metal retains its brightest edge.
const pigments: Record<MaterialBrush, { interval: number; marks: number; shadow: number }> = {
  wood: { interval: 18, marks: .34, shadow: 7 }, stone: { interval: 27, marks: .36, shadow: 9 },
  foliage: { interval: 22, marks: .57, shadow: 13 }, grass: { interval: 16, marks: .18, shadow: 7 },
  earth: { interval: 19, marks: .21, shadow: 7 }, metal: { interval: 30, marks: .08, shadow: 8 },
  cloth: { interval: 15, marks: .13, shadow: 4 }, plaster: { interval: 17, marks: .15, shadow: 5 },
}

export function drawMaterialImage(source: PaintImage, brush: MaterialBrush, seed: number): HTMLCanvasElement {
  const scale = Math.min(1, 768 / Math.max(source.width, source.height))
  const ctx = buffer(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)))
  const { width, height } = ctx.canvas
  ctx.drawImage(source, 0, 0, width, height)
  const image = ctx.getImageData(0, 0, width, height), pixels = image.data
  const field = brushField(brush, seed), { interval, marks, shadow } = pigments[brush]
  const ground = brush === 'grass' || brush === 'earth'
  let mean = 0, samples = 0
  if (ground) for (let i = 0; i < pixels.length; i += 28) {
    if (pixels[i + 3] < 220) continue
    mean += pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722
    samples++
  }
  mean /= samples || 1
  let across = 0, along = 0
  if (brush === 'wood') for (let y = 2; y < height; y += 4) for (let x = 2; x < width; x += 4) {
    const i = (y * width + x) * 4
    if (pixels[i + 3] < 200 || pixels[i - 5] < 200 || pixels[i - width * 8 + 3] < 200) continue
    across += Math.abs(pixels[i] - pixels[i - 8])
    along += Math.abs(pixels[i] - pixels[i - width * 8])
  }
  const vertical = across > along
  const tones = new Float32Array(256)
  for (let v = 0; v < 256; v++) {
    const t = v / interval, f = t - Math.floor(t)
    const edge = Math.max(0, Math.min(1, (f - .34) / .32))
    tones[v] = (Math.floor(t) + edge * edge * (3 - 2 * edge) - t) * interval * .78
      - (brush === 'metal' ? 0 : Math.max(0, v - 180) * .20)
  }
  for (let y = 0; y < height; y++) {
    const fy = Math.floor(y * fieldSize / height)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (!pixels[i + 3]) continue
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], luma = Math.round(r * .2126 + g * .7152 + b * .0722)
      const fx = Math.floor(x * fieldSize / width), at = vertical ? fx * fieldSize + fy : fy * fieldSize + fx
      // Quiet repeating ground flecks. Its broad changes in light and pigment
      // are drawn once in world space, across the entire terrain surface.
      const pigment = (field[at * 4] - 128) * marks
      const tone = ground ? (mean - luma) * .76 + tones[luma] * .25 + pigment * .55 : tones[luma] + pigment
      const leafLight = brush === 'foliage' ? pigment * .30 + (luma - 110) * .10 : 0
      const cool = (1 - luma / 255) * shadow
      pixels[i] = r + tone - cool + leafLight
      pixels[i + 1] = g + tone - cool * .57
      pixels[i + 2] = b + tone + cool * .58 - leafLight
    }
  }
  ctx.putImageData(image, 0, 0)
  if (scale === 1) return ctx.canvas
  // Keep fine contours and the complete source alpha on larger artwork.
  const full = buffer(source.width, source.height)
  full.drawImage(source, 0, 0)
  full.globalCompositeOperation = 'source-atop'
  full.drawImage(ctx.canvas, 0, 0, source.width, source.height)
  ctx.canvas.width = 0
  return full.canvas
}

function washNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const value = (cx: number, cy: number) => {
    let h = Math.imul(cx, 0x1f123bb5) ^ Math.imul(cy, 0x5f356495) ^ seed
    h = Math.imul(h ^ h >>> 16, 0x45d9f3b)
    return ((h ^ h >>> 16) >>> 0) / 4294967295
  }
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  return (value(ix, iy) * (1 - u) + value(ix + 1, iy) * u) * (1 - v)
    + (value(ix, iy + 1) * (1 - u) + value(ix + 1, iy + 1) * u) * v
}

export function drawGroundPigment(ctx: CanvasRenderingContext2D, path: Path2D, bounds: BoundsMm, brush: MaterialBrush | undefined) {
  if (brush !== 'grass' && brush !== 'earth') return
  const grass = brush === 'grass', longest = Math.max(bounds.width, bounds.height)
  if (!bounds.width || !bounds.height) return
  const spacing = Math.max(95, longest / 420)
  const wash = buffer(Math.ceil(bounds.width / spacing), Math.ceil(bounds.height / spacing))
  const { width, height } = wash.canvas, color = wash.createImageData(width, height)
  const dark = grass ? [41, 69, 56] : [91, 67, 51], light = grass ? [231, 211, 147] : [225, 196, 143]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = bounds.x + (x + .5) * bounds.width / width, v = bounds.y + (y + .5) * bounds.height / height
    const value = washNoise(u / 5700, v / 4700, 317) * .57 + washNoise(u / 1860, v / 1570, 739) * .32
      + washNoise((u + .4 * v) / 660, v / 470, 193) * .11 - .50
    const tone = value < 0 ? dark : light, i = 4 * (y * width + x)
    color.data[i] = tone[0]; color.data[i + 1] = tone[1]; color.data[i + 2] = tone[2]
    color.data[i + 3] = Math.min(85, Math.abs(value) * 230)
  }
  wash.putImageData(color, 0, 0)
  ctx.save()
  ctx.clip(path)
  ctx.drawImage(wash.canvas, bounds.x, bounds.y, bounds.width, bounds.height)
  wash.canvas.width = 0
  if (!grass) { ctx.restore(); return }
  const span = Math.max(3600, longest / 45)
  for (let row = Math.floor(bounds.y / span) - 1; row <= Math.floor((bounds.y + bounds.height) / span) + 1; row++) {
    for (let col = Math.floor(bounds.x / span) - 1; col <= Math.floor((bounds.x + bounds.width) / span) + 1; col++) {
      const next = random(Math.imul(row + 43, 73856093) ^ Math.imul(col + 71, 19349663))
      const x = (col + next()) * span, y = (row + next()) * span
      const rx = span * (.21 + next() * .44), ry = rx * (.32 + next() * .45)
      ctx.fillStyle = next() > .45 ? '#4359404c' : '#ead69b52'
      for (let i = 0; i < 14; i++) {
        const t = next() * tau, r = Math.sqrt(next()), cx = x + rx * Math.cos(t) * r, cy = y + ry * Math.sin(t) * r
        const size = 38 + next() * 66
        polygon(ctx, [[cx - size, cy + size * .3], [cx - size * .3, cy], [cx - size * .12, cy - size], [cx + size * .14, cy - size * .14],
          [cx + size, cy - size * .6], [cx + size * .38, cy + size * .1]])
      }
    }
  }
  ctx.restore()
}

/** Broken stone chips and scuffs on worn trail paint in world millimetres. */
export function drawSoilTrailGrain(ctx: CanvasRenderingContext2D, bounds: BoundsMm, trail: BoundsMm) {
  const span = Math.max(820, Math.max(trail.width, trail.height) / 76)
  for (let row = Math.floor(bounds.y / span) - 1; row <= Math.floor((bounds.y + bounds.height) / span) + 1; row++) {
    for (let col = Math.floor(bounds.x / span) - 1; col <= Math.floor((bounds.x + bounds.width) / span) + 1; col++) {
      const next = random(Math.imul(row + 113, 73856093) ^ Math.imul(col + 17, 19349663))
      const x = (col + .19 + next() * .62) * span, y = (row + .19 + next() * .62) * span
      if (next() < .23) continue
      for (let i = 0; i < 4; i++) {
        const cx = x + (next() - .5) * 430, cy = y + (next() - .5) * 430, size = 50 + next() * 104
        ctx.fillStyle = next() < .52 ? '#55473348' : '#ecd1a057'
        polygon(ctx, [[cx - size, cy + size * .22], [cx - size * .52, cy - size * .20],
          [cx + size * .38, cy - size * .38], [cx + size, cy + size * .16], [cx + size * .34, cy + size * .52]])
      }
    }
  }
}

export function paintedMaterialImages(projection: Projection, images: ReadonlyMap<string, PaintImage>,
  hashOf: (id: string) => string, styled: Map<string, HTMLCanvasElement>, signal?: AbortSignal) {
  const previous = new Set(styled.values()), cache = new Map<PaintImage, Map<MaterialBrush, HTMLCanvasElement>>()
  try {
    for (const id of artStyleArtworkIds(projection)) {
      signal?.throwIfAborted()
      const brush = projection.materialBrushes?.[id]
      const source = styled.get(id) ?? images.get(id)
      if (!source || !brush) continue
      const variants = cache.get(source) ?? new Map<MaterialBrush, HTMLCanvasElement>()
      cache.set(source, variants)
      let painted = variants.get(brush)
      if (!painted) {
        painted = drawMaterialImage(source, brush, Number.parseInt(hashOf(id).slice(0, 8), 16))
        variants.set(brush, painted)
      }
      styled.set(id, painted)
    }
  } finally {
    for (const current of styled.values()) previous.delete(current)
    for (const old of previous) old.width = 0
  }
}
