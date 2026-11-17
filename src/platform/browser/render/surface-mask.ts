import type { BoundsMm } from '../../../shared/model/scene.js'
import type { ProjectedSurface } from '../../../shared/projection/types.js'

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
  if (!inward || !blendWidthMm) {
    if (blendWidthMm) ctx.filter = `blur(${blendWidthMm * .5 * Math.max(sx, sy)}px)`
    ctx.fill(path, 'evenodd'); ctx.filter = 'none'
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
    const source = core.getContext('2d')
    if (!source) throw new Error('无法建立地表羽化遮罩。')
    source.setTransform(sx, 0, 0, sy, -bounds.x * sx + pad, -bounds.y * sy + pad)
    source.fillStyle = '#fff'; source.fill(path, 'evenodd')
    source.globalCompositeOperation = 'destination-out'; source.lineWidth = blendWidthMm * 3
    source.lineJoin = 'round'; source.stroke(path)
    ctx.save(); ctx.clip(path, 'evenodd'); ctx.resetTransform()
    ctx.filter = `blur(${blendWidthMm * .5 * Math.max(sx, sy)}px)`; ctx.drawImage(core, -pad, -pad); ctx.restore()
  } finally { core.width = core.height = 0 }
}
