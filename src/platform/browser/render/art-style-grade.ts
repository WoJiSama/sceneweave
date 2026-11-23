import type { BoundsMm } from '../../../shared/model/scene.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { activeLineArt, CURRENT_LINE_ART_PAINT_VERSION, type ActiveArtStyle, type ActiveArtStyles } from '../../../shared/visual/art-style.js'
import { BITMAP_LINE_ORIGINAL_INK, captureBitmapLineArt } from './bitmap-line-art.js'
import { prepareColorFilter } from './color-filter.js'

const PAPER_TILE_SIZE = 128
const GRADE_TILE_ROWS = 96
const paper = Float32Array.from({ length: PAPER_TILE_SIZE ** 2 }, (_, index) => {
  const seed = Math.imul(index + 1, 0x45d9f3b)
  return (Math.imul(seed ^ seed >>> 16, 0x45d9f3b) >>> 0) / 4294967296 - .5
})

/** Sample the darker side of each edge in the visible paint. The outline never changes coverage. */
export function captureLineArtEdges(ctx: CanvasRenderingContext2D, bounds: BoundsMm, signal?: AbortSignal,
  { tiles, mask }: { tiles?: readonly ImageData[]; mask?: CanvasRenderingContext2D } = {}): Uint8Array {
  const { width, height } = ctx.canvas
  const light = new Uint8Array(width * height)
  for (let top = 0, index = 0; top < height; top += GRADE_TILE_ROWS, index++) {
    checkCancelled(signal)
    const rows = Math.min(GRADE_TILE_ROWS, height - top)
    const { data } = tiles?.[index] ?? ctx.getImageData(0, top, width, rows)
    const coverage = mask?.getImageData(0, top, width, rows).data
    for (let i = 0, at = top * width; i < data.length; i += 4, at++) {
      // Even partly covered pixels are excluded from neighbor sampling.
      if (coverage?.[i + 3]) continue
      const luminance = data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722
      light[at] = Math.max(mask ? 1 : 0, Math.round(255 - (255 - luminance) * data[i + 3] / 255))
    }
  }
  const edges = new Uint8Array(light.length)
  const step = Math.min(6, Math.max(1, Math.round(32 / Math.max(bounds.width / width, bounds.height / height))))
  const diagonal = Math.max(1, Math.round(step * Math.SQRT1_2))
  for (let y = 0; y < height; y++) {
    if (y % GRADE_TILE_ROWS === 0) checkCancelled(signal)
    const row = y * width, above = Math.max(0, y - step) * width, below = Math.min(height - 1, y + step) * width
    const upper = Math.max(0, y - diagonal) * width, lower = Math.min(height - 1, y + diagonal) * width
    for (let x = 0; x < width; x++) {
      const at = row + x, center = light[at]
      if (mask && center === 0) continue
      const left = Math.max(0, x - diagonal), right = Math.min(width - 1, x + diagonal)
      const axial = Math.max(light[row + Math.max(0, x - step)], light[row + Math.min(width - 1, x + step)], light[above + x], light[below + x])
      const corners = Math.max(light[upper + left], light[upper + right], light[lower + left], light[lower + right])
      // Strong authored boundaries get ink, while gradual shadows and grazing texture stay light.
      const edge = Math.max(0, axial - center, (corners - center) * .86)
      edges[at] = Math.min(255, Math.round(edge * (1.14 + (255 - center) * .0015)))
    }
  }
  return edges
}

function prepareGrade(bounds: BoundsMm, width: number, height: number, look: ActiveArtStyle, edges: Uint8Array | undefined, bitmapLine: boolean) {
  const { strength, warmth, contrast, saturation, grain, grainSize, paintVersion, ink, depth } = look.parameters
  const sx = bounds.width / width, sy = bounds.height / height
  const amount = strength / 100, warm = warmth / 100
  const lineArt = look.preset === 'lineArt'
  const contrastAmount = 1 + contrast * .0066, pigment = (1 + saturation * .01) * (lineArt ? .24 : 1)
  const edgeThreshold = 10 - contrast * .055, edgeGain = (1 + contrast * .006) / 48
  const tea = look.preset === 'tea'
  const bold = paintVersion !== undefined
  const keepShadows = paintVersion === 3 && tea
  const warmthRed = bold && tea ? 34 : 29, warmthBlue = bold && tea ? -17 : -26
  const scale = 12 * 8 ** (grainSize / 100)
  const grainAmount = grain * (bold ? .54 : .48) * Math.min(1, scale * 1.15 / Math.max(sx, sy))
  const paperX = new Uint8Array(width), fractionX = new Float32Array(width)
  const mask = PAPER_TILE_SIZE - 1
  if (grainAmount) for (let x = 0; x < width; x++) {
    const cell = (bounds.x + (x + .5) * sx) / scale, index = Math.floor(cell)
    paperX[x] = index & mask
    fractionX[x] = cell - index
  }
  return (image: ImageData, top: number) => {
    const pixel = image.data
    for (let row = 0; row < image.height; row++) {
      const docY = (bounds.y + (top + row + .5) * sy) / scale, tileY = Math.floor(docY), fy = docY - tileY
      const thisRow = (tileY & mask) * PAPER_TILE_SIZE, nextRow = ((tileY + 1) & mask) * PAPER_TILE_SIZE
      for (let x = 0, i = row * width * 4; x < width; x++, i += 4) {
        if (!pixel[i + 3]) continue
        const r = pixel[i], g = pixel[i + 1], b = pixel[i + 2]
        const luminance = r * .2126 + g * .7152 + b * .0722
        const normalized = luminance / 255
        const squared = normalized * normalized
        let value: number
        if (bitmapLine) {
          const detail = edges?.[(top + row) * width + x] ?? 0
          const darkness = detail === BITMAP_LINE_ORIGINAL_INK ? Math.max(0, 247 - luminance) * .92
            : 224 * Math.min(.9, detail / 127 * (1 + (contrast - 36) * .006))
          value = 247 - darkness * ink / 98 - depth * (1 - normalized)
        } else if (lineArt) {
          const edge = Math.max(0, Math.min(1, ((edges?.[(top + row) * width + x] ?? 0) - edgeThreshold) * edgeGain))
          value = 248 - 2.19 * ink * edge * edge * (3 - 2 * edge) - depth * .78 * (1 - normalized) * (1 - .4 * normalized)
        } else {
          const wash = bold
            ? tea ? 32 * squared * normalized - 100 * normalized * (1 - normalized) : 84 * normalized * (1 - normalized) + 11 * squared
            : tea ? (normalized - .45) * normalized * (1 - normalized) * 20 : (1 - normalized) * 8
          value = (luminance - 124) * contrastAmount + 124 + wash
          if (keepShadows) value += (luminance - value) * .64 * Math.max(0, 1 - normalized / .38) ** 2
        }
        if (grainAmount) {
          const tx = paperX[x], right = (tx + 1) & mask, fx = fractionX[x]
          const a = paper[thisRow + tx] * (1 - fx) + paper[thisRow + right] * fx
          const b = paper[nextRow + tx] * (1 - fx) + paper[nextRow + right] * fx
          value += (a * (1 - fy) + b * fy) * grainAmount
        }
        const color = warm * (1 - .67 * squared)
        pixel[i] = r + amount * (value + (r - luminance) * pigment + warmthRed * color - r)
        pixel[i + 1] = g + amount * (value + (g - luminance) * pigment + 5 * color - g)
        pixel[i + 2] = b + amount * (value + (b - luminance) * pigment + warmthBlue * color - b)
      }
    }
  }
}

export interface ThemeLineGuide {
  structure?: Uint8Array
  bitmapCoverage?: Uint8Array
  bitmapEdges?: { x: number; y: number; width: number; pixels: Uint8Array }
}

function prepareThemeGrade(bounds: BoundsMm, width: number, height: number, look: ActiveArtStyle, edges?: Uint8Array, guide?: ThemeLineGuide) {
  const color = prepareColorFilter(look.filter!)
  const { strength, grain, grainSize, ink, depth } = look.parameters
  const line = look.effects && 'edgeDetail' in look.effects && look.effects.brushwork && strength > 0 ? look.effects : undefined
  const amount = strength / 100
  const dx = bounds.width / width, dy = bounds.height / height
  const grainScale = 24 * 8 ** (grainSize / 100)
  const texture = amount * grain * .62 * Math.min(1, grainScale * 1.15 / Math.max(dx, dy))
  const noiseMask = PAPER_TILE_SIZE - 1
  const columns = new Uint8Array(width), fractions = new Float32Array(width)
  if (texture) for (let x = 0; x < width; x++) {
    const cell = (bounds.x + (x + .5) * dx) / grainScale, index = Math.floor(cell)
    columns[x] = index & noiseMask
    fractions[x] = cell - index
  }
  const edgeThreshold = line ? 37 - line.edgeDetail * .52 : 0
  const contourGain = ink / 100
  const bitmap = guide?.bitmapEdges
  return (image: ImageData, top: number) => {
    const pixels = image.data
    for (let row = 0; row < image.height; row++) {
      const y = top + row, offset = y * width
      const docY = (bounds.y + (y + .5) * dy) / grainScale, tileY = Math.floor(docY), fy = docY - tileY
      const thisRow = (tileY & noiseMask) * PAPER_TILE_SIZE, nextRow = ((tileY + 1) & noiseMask) * PAPER_TILE_SIZE
      for (let x = 0, i = row * width * 4; x < width; x++, i += 4) {
        if (!pixels[i + 3]) continue
        let grainTone = 0
        if (texture) {
          const tx = columns[x], right = (tx + 1) & noiseMask, fx = fractions[x]
          const a = paper[thisRow + tx] * (1 - fx) + paper[thisRow + right] * fx
          const b = paper[nextRow + tx] * (1 - fx) + paper[nextRow + right] * fx
          grainTone = texture * (a * (1 - fy) + b * fy)
        }
        if (line) {
          const at = offset + x
          const luminance = pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722
          const edge = Math.min(1, Math.max(0, ((edges?.[at] ?? 0) - edgeThreshold) / 85))
          const structuralInk = (guide?.structure?.[at] ?? 0) / 255
          let darkness = 220 * Math.max(structuralInk, edge * edge * (3 - 2 * edge) * .73)
          const coverage = (guide?.bitmapCoverage?.[at] ?? 0) / 255
          if (coverage && bitmap) {
            const detail = bitmap.pixels[(y - bitmap.y) * bitmap.width + x - bitmap.x]
            const bitmapInk = detail === BITMAP_LINE_ORIGINAL_INK ? Math.max(0, 247 - luminance) * .92
              : 224 * Math.min(.9, detail / 127 * (.66 + line.edgeDetail * .008))
            darkness += (bitmapInk - darkness) * coverage
          }
          const tone = 247 - darkness * contourGain - depth * (1 - luminance / 255)
          for (let c = 0; c < 3; c++) {
            const source = pixels[i + c]
            pixels[i + c] = source + (tone + .1 * (source - luminance) - source) * amount + grainTone
          }
        } else if (texture) {
          pixels[i] += grainTone; pixels[i + 1] += grainTone; pixels[i + 2] += grainTone
        }
        color?.(pixels, i)
      }
    }
  }
}

export interface ArtStyleGradeSource {
  tiles?: readonly ImageData[]
  marks?: ImageData
  /** A uniform background can skip the neighborhood sampling. */
  lineArtEdges?: Uint8Array | null
  bitmapLine?: boolean
  mask?: CanvasRenderingContext2D
  referenceLongEdge?: number
  themeLineGuide?: ThemeLineGuide
}

export function captureArtStyleLineEdges(ctx: CanvasRenderingContext2D, bounds: BoundsMm, signal?: AbortSignal,
  { tiles, bitmapLine, mask, referenceLongEdge }: ArtStyleGradeSource = {}): Uint8Array {
  return bitmapLine ? captureBitmapLineArt(ctx, { signal, mask, referenceLongEdge }) : captureLineArtEdges(ctx, bounds, signal, { tiles, mask })
}

/** Grade the whole stack tile by tile, with paper aligned to the world origin. */
export function applyArtStyleGrades(ctx: CanvasRenderingContext2D, bounds: BoundsMm, looks: ActiveArtStyles, signal?: AbortSignal,
  { tiles, marks, lineArtEdges, bitmapLine, mask, referenceLongEdge, themeLineGuide }: ArtStyleGradeSource = {}): void {
  const { width, height } = ctx.canvas
  const line = activeLineArt(looks)
  const cleaned = !line?.filter && bitmapLine === true && line?.parameters.paintVersion === CURRENT_LINE_ART_PAINT_VERSION
  const edges = lineArtEdges === undefined && line
    ? captureArtStyleLineEdges(ctx, bounds, signal, { tiles, bitmapLine: cleaned, mask, referenceLongEdge }) : lineArtEdges
  const grades = looks.map(look => look.filter ? prepareThemeGrade(bounds, width, height, look, edges ?? undefined, themeLineGuide)
    : prepareGrade(bounds, width, height, look, edges ?? undefined, cleaned && look === line))
  for (let top = 0, index = 0; top < height; top += GRADE_TILE_ROWS, index++) {
    checkCancelled(signal)
    const original = tiles?.[index]
    const image = original ? new ImageData(original.data.slice(), original.width, original.height)
      : ctx.getImageData(0, top, width, Math.min(GRADE_TILE_ROWS, height - top))
    for (const grade of grades) grade(image, top)
    if (marks) overlayArtStyleMarks(image.data, marks.data, top * width * 4)
    ctx.putImageData(image, 0, top)
  }
}

export function paintArtStyleMarks(ctx: CanvasRenderingContext2D, marks: ImageData, signal?: AbortSignal): void {
  const { width, height } = ctx.canvas
  for (let top = 0; top < height; top += GRADE_TILE_ROWS) {
    checkCancelled(signal)
    const image = ctx.getImageData(0, top, width, Math.min(GRADE_TILE_ROWS, height - top))
    overlayArtStyleMarks(image.data, marks.data, top * width * 4)
    ctx.putImageData(image, 0, top)
  }
}

export function captureArtStyleTiles(ctx: CanvasRenderingContext2D, signal?: AbortSignal): ImageData[] {
  const { width, height } = ctx.canvas, tiles: ImageData[] = []
  for (let top = 0; top < height; top += GRADE_TILE_ROWS) {
    checkCancelled(signal)
    tiles.push(ctx.getImageData(0, top, width, Math.min(GRADE_TILE_ROWS, height - top)))
  }
  return tiles
}

function overlayArtStyleMarks(background: Uint8ClampedArray, foreground: Uint8ClampedArray, offset: number) {
  for (let i = 0, at = offset; i < background.length; i += 4, at += 4) {
    if (!foreground[at + 3]) continue
    const opacity = foreground[at + 3] / 255, backgroundWeight = background[i + 3] / 255 * (1 - opacity)
    const alpha = opacity + backgroundWeight
    for (let c = 0; c < 3; c++) background[i + c] = (foreground[at + c] * opacity + background[i + c] * backgroundWeight) / alpha
    background[i + 3] = Math.round(alpha * 255)
  }
}
