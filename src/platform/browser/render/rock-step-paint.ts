export { drawNaturalRockSteps } from './natural-rock-steps.js'
export { drawNaturalRockStepsV4 } from './natural-rock-steps-v4.js'
export { drawTerracedRockSteps } from './terraced-rock-steps.js'
export { planRockStepSideMask } from './rock-step-surface-mask.js'

import type { PointMm } from '../../../shared/model/scene.js'
import { planWeatheredRockSteps, weatheredStepColor } from './weathered-rock-steps.js'

export { planWeatheredRockSteps }

function stepPath(points: PointMm[], closed = false) {
  const path = new Path2D()
  points.forEach((point, i) => i ? path.lineTo(point.x, point.y) : path.moveTo(point.x, point.y))
  if (closed) path.closePath()
  return path
}

export function drawWeatheredRockSteps(ctx: CanvasRenderingContext2D, plan: NonNullable<ReturnType<typeof planWeatheredRockSteps>>, tint: string | null | undefined) {
  ctx.save()
  try {
    ctx.lineJoin = 'bevel'
    for (const tread of plan.treads) {
      const { colorVariation, polygonMm, front, lip, joint, facet, scuffs } = tread
      const cap = stepPath(polygonMm, true)
      ctx.globalAlpha = .27
      ctx.fillStyle = weatheredStepColor(tint, .97 + colorVariation)
      ctx.fill(cap)
      ctx.save()
      ctx.clip(cap)
      ctx.globalAlpha = plan.eroded ? .66 : .92
      ctx.fillStyle = weatheredStepColor(tint, (plan.eroded ? .75 : .69) + colorVariation)
      ctx.fill(stepPath([...front, ...lip.toReversed()], true))
      ctx.strokeStyle = weatheredStepColor(tint, (plan.eroded ? 1.09 : 1.15) + colorVariation)
      ctx.lineWidth = Math.min(31, plan.depthMm * .11)
      ctx.stroke(stepPath(plan.eroded ? lip.slice(1, 3) : lip.slice(1, 5)))
      if (plan.eroded) ctx.stroke(stepPath(lip.slice(4, 7)))
      ctx.globalAlpha = .41
      ctx.fillStyle = weatheredStepColor(tint, .80 + colorVariation)
      ctx.fill(stepPath(facet, true))
      ctx.fillStyle = weatheredStepColor(tint, 1.19 + colorVariation)
      for (const scuff of scuffs) ctx.fill(stepPath(scuff, true))
      if (tread.split) {
        ctx.globalAlpha = .65; ctx.fillStyle = weatheredStepColor(tint, .65 + colorVariation)
        ctx.fill(stepPath(joint, true))
      }
      ctx.restore()
    }
  } finally { ctx.restore() }
}
