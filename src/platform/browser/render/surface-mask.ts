import { setCanvasBlur, supportsCanvasFilter } from './canvas-filter.js'
import type { BoundsMm } from '../../../shared/model/scene.js'
import type { ProjectedSurface } from '../../../shared/projection/types.js'
import { blurWhiteMask } from './mask-blur.js'

/** One world-space mask for terrain, material patches and their holes. */
export function drawSurfaceRuleMask(ctx: CanvasRenderingContext2D, bounds: BoundsMm, widthPx: number, heightPx: number,
  regions: NonNullable<ProjectedSurface['regionsMm']>, blendWidthMm: number, inward = false): void {
  const path = new Path2D()
  for (const region of regions) for (const ring of [region.outerMm, ...region.holesMm]) {
    ring.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath()
  }
  const sx = widthPx / bounds.width, sy = heightPx / bounds.height
  ctx.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy)
  ctx.fillStyle = '#fff'
  // An expando assignment to ctx.filter can succeed without implementing it.
  // Inspect the native prototype so such engines receive a real soft mask.
  const nativeBlur = supportsCanvasFilter(ctx)
  if (!blendWidthMm || !inward && nativeBlur) {
    if (blendWidthMm) ctx.filter = `blur(${blendWidthMm * .5 * Math.max(sx, sy)}px)`
    ctx.fill(path, 'evenodd'); setCanvasBlur(ctx, 0)
    return
  }
  // Erode before the existing Gaussian feather. The three-sigma inset keeps
  // the result inside its actual owner: privacy and physical bounds do not grow.
  // Rasterize beyond the viewport before blurring. Cropping the input at the
  // viewport makes its artificial edge fade, even deep inside solid terrain.
  const pad = Math.ceil(blendWidthMm * .5 * Math.max(sx, sy) * 3) + 2
  const paddedWidth = widthPx + pad * 2, paddedHeight = heightPx + pad * 2
  if (paddedWidth > 16384 || paddedHeight > 16384 || paddedWidth * paddedHeight > 64 * 1024 * 1024) throw new Error('地表羽化遮罩超出像素预算，请降低输出尺寸或羽化宽度。')
  const core = document.createElement('canvas'); core.width = paddedWidth; core.height = paddedHeight
  try {
    const source = core.getContext('2d', { willReadFrequently: !nativeBlur })
    if (!source) throw new Error('无法建立地表羽化遮罩。')
    source.setTransform(sx, 0, 0, sy, -bounds.x * sx + pad, -bounds.y * sy + pad)
    source.fillStyle = '#fff'; source.fill(path, 'evenodd')
    if (inward) {
      source.globalCompositeOperation = 'destination-out'; source.lineWidth = blendWidthMm * 3
      source.lineJoin = 'round'; source.stroke(path)
    }
    const sigma = blendWidthMm * .5 * Math.max(sx, sy)
    if (!nativeBlur) {
      const image = source.getImageData(0, 0, paddedWidth, paddedHeight)
      blurWhiteMask(image, sigma); source.putImageData(image, 0, 0)
    }
    ctx.save(); if (inward) ctx.clip(path, 'evenodd'); ctx.resetTransform()
    if (nativeBlur) ctx.filter = `blur(${sigma}px)`
    ctx.drawImage(core, -pad, -pad); ctx.restore()
  } finally { core.width = core.height = 0 }
}
