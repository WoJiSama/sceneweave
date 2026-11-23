import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import type { StaircaseGeometry } from '../../../shared/stairs/geometry.js'
import type { ThemeLineGuide } from './art-style-grade.js'
import { bitmapLineSamplingPadding, captureBitmapLineArt, type LineArtPixels } from './bitmap-line-art.js'

function guideContext(width: number, height: number, bounds: BoundsMm): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建线稿引导缓冲。')
  const sx = width / bounds.width, sy = height / bounds.height
  ctx.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy)
  ctx.fillStyle = ctx.strokeStyle = '#fff'
  ctx.lineJoin = ctx.lineCap = 'round'
  return ctx
}

function alphaPixels(ctx: CanvasRenderingContext2D, signal?: AbortSignal) {
  const { width, height } = ctx.canvas
  const pixels = new Uint8Array(width * height)
  let left = width, right = -1, top = height, bottom = -1
  for (let y = 0; y < height; y += 96) {
    checkCancelled(signal)
    const { data } = ctx.getImageData(0, y, width, Math.min(96, height - y))
    for (let i = 0; i < data.length / 4; i++) {
      const alpha = data[i * 4 + 3]
      if (!alpha) continue
      pixels[y * width + i] = alpha
      const x = i % width, row = y + Math.floor(i / width)
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, row); bottom = Math.max(bottom, row)
    }
  }
  return { pixels, left, right, top, bottom }
}

function trace(path: Path2D, points: readonly PointMm[], close = false) {
  for (const [index, point] of points.entries()) {
    if (index === 0) path.moveTo(point.x, point.y)
    else path.lineTo(point.x, point.y)
  }
  if (close) path.closePath()
}

/** The guides follow native paint order, including opaque covers and sprite alpha. */
export class ArtStyleLineGuide {
  private readonly structure?: CanvasRenderingContext2D
  private readonly bitmap?: CanvasRenderingContext2D
  private readonly pixelMm: number

  constructor(width: number, height: number, bounds: BoundsMm, useStructure: boolean, useBitmap: boolean, clip?: BoundsMm) {
    this.structure = useStructure ? guideContext(width, height, bounds) : undefined
    try {
      this.bitmap = useBitmap ? guideContext(width, height, bounds) : undefined
      for (const ctx of [this.structure, this.bitmap]) if (ctx && clip) {
        ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.width, clip.height); ctx.clip()
      }
    } catch (error) { this.dispose(); throw error }
    this.pixelMm = Math.max(bounds.width / width, bounds.height / height)
  }

  cover(path: Path2D) {
    this.sprite(false, ctx => ctx.fill(path, 'evenodd'))
  }

  sprite(bitmap: boolean, draw: (ctx: CanvasRenderingContext2D) => void) {
    for (const ctx of [this.structure, this.bitmap]) if (ctx) {
      ctx.save()
      try {
        ctx.globalCompositeOperation = bitmap && ctx === this.bitmap ? 'source-over' : 'destination-out'
        draw(ctx)
      } finally { ctx.restore() }
    }
  }

  stroke(path: Path2D, opacity: number, widthMm: number, minPx = 1.05) {
    if (!this.structure) return
    this.structure.globalAlpha = opacity
    this.structure.lineWidth = Math.max(widthMm, this.pixelMm * minPx)
    this.structure.stroke(path)
    this.structure.globalAlpha = 1
  }

  clipped(clip: (ctx: CanvasRenderingContext2D) => void, draw: () => void) {
    if (!this.structure) return
    this.structure.save()
    try { clip(this.structure); draw() } finally { this.structure.restore() }
  }

  treads(geometry: StaircaseGeometry, footprint: Path2D, ascending = true) {
    const ctx = this.structure
    if (!ctx) return
    const path = new Path2D()
    for (const tread of geometry.treads) {
      if (tread.endMm - tread.startMm >= this.pixelMm * 1.6) trace(path, ascending ? tread.frontMm : tread.rearMm)
    }
    ctx.save()
    try {
      ctx.clip(footprint)
      const band = new Path2D(); trace(band, geometry.footprintMm, true); ctx.clip(band)
      for (const cover of geometry.covers) {
        const outside = new Path2D(band); trace(outside, cover.polygonMm, true)
        ctx.clip(outside, 'evenodd')
      }
      this.stroke(path, .53, 24, .85)
    } finally { ctx.restore() }
  }

  capture(source: CanvasRenderingContext2D, signal?: AbortSignal, mask?: CanvasRenderingContext2D,
    referenceLongEdge = Math.max(source.canvas.width, source.canvas.height), preserveContours = false, minimumStrokeScale = 1): ThemeLineGuide {
    const structure = this.structure && alphaPixels(this.structure, signal).pixels
    const bitmap = this.bitmap && alphaPixels(this.bitmap, signal)
    if (!bitmap || bitmap.right < 0) return { structure }
    const padding = bitmapLineSamplingPadding(referenceLongEdge, preserveContours, minimumStrokeScale)
    const x = Math.max(0, bitmap.left - padding), y = Math.max(0, bitmap.top - padding)
    const width = Math.min(source.canvas.width, bitmap.right + 1 + padding) - x
    const height = Math.min(source.canvas.height, bitmap.bottom + 1 + padding) - y
    const crop = (ctx: CanvasRenderingContext2D): LineArtPixels => ({ canvas: { width, height }, getImageData: (left, top, w, h) => ctx.getImageData(x + left, y + top, w, h) })
    const pixels = captureBitmapLineArt(crop(source), { signal, mask: mask && crop(mask), referenceLongEdge, preserveContours, minimumStrokeScale })
    return { structure, bitmapCoverage: bitmap.pixels, bitmapEdges: { x, y, width, pixels } }
  }

  dispose() {
    for (const ctx of [this.structure, this.bitmap]) if (ctx) ctx.canvas.width = ctx.canvas.height = 0
  }
}
