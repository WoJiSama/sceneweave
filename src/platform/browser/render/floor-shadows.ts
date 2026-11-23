import type { BoundsMm } from '../../../shared/model/scene.js'
import type { ProjectedFloorShadow } from '../../../shared/projection/types.js'

function regionPath(regions: ProjectedFloorShadow['caster']): Path2D {
  const path = new Path2D()
  for (const region of regions) for (const points of [region.outerMm, ...region.holesMm]) {
    points.forEach(({ x, y }, i) => i ? path.lineTo(x, y) : path.moveTo(x, y))
    path.closePath()
  }
  return path
}

/** Compose onto the finished lower image, before the caster's own Floor. */
export function drawFloorShadows(ctx: CanvasRenderingContext2D, view: BoundsMm, shadows: readonly ProjectedFloorShadow[], amount = 1): void {
  if (!shadows.length) return
  const sx = ctx.canvas.width / view.width, sy = ctx.canvas.height / view.height
  ctx.save()
  ctx.setTransform(sx, 0, 0, sy, -view.x * sx, -view.y * sy)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = '#080E16'
  for (const { caster, receiver, offsetMm, blurMm, opacity } of shadows) {
    ctx.save()
    ctx.clip(regionPath(receiver), 'evenodd')
    ctx.translate(offsetMm.x, offsetMm.y)
    ctx.filter = 'blur(' + blurMm * Math.max(sx, sy) + 'px)'
    ctx.globalAlpha = opacity * amount
    ctx.fill(regionPath(caster), 'evenodd')
    ctx.restore()
  }
  ctx.restore()
}
