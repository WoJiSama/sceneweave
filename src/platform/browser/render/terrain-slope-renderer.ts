import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedTerrainInlay } from '../../../shared/projection/types.js'
import { terrainSlopeShades, terrainSlopeTreads } from '../../../shared/terrain-inlay/surface-paint.js'

function path(points: PointMm[], closed = true) {
  const p = new Path2D(); points.forEach((v, i) => i ? p.lineTo(v.x, v.y) : p.moveTo(v.x, v.y)); if (closed) p.closePath(); return p
}

export function drawTerrainSlopeFinish(ctx: CanvasRenderingContext2D, inlay: ProjectedTerrainInlay, lightDirectionDeg: number, suppressTreads = false): void {
  if (!inlay.finish) return
  ctx.save()
  try {
    ctx.clip(path(inlay.footprintMm))
    // A linear per-triangle interpolation of shared-node shading retains the
    // real mesh but never outlines triangle edges or the walk classification.
    for (const patch of terrainSlopeShades(inlay, lightDirectionDeg)) {
      const [a, b, c] = patch.pointsMm, [qa, qb, qc] = patch.opacity
      const dx = b.x - a.x, dy = b.y - a.y, ux = c.x - a.x, uy = c.y - a.y, determinant = dx * uy - dy * ux
      const gx = ((qb - qa) * uy - (qc - qa) * dy) / determinant, gy = (dx * (qc - qa) - ux * (qb - qa)) / determinant, g2 = gx * gx + gy * gy
      ctx.save()
      if (g2 < 1e-20) { ctx.globalAlpha = qa; ctx.fillStyle = '#594D3F' }
      else {
        const x = a.x - qa * gx / g2, y = a.y - qa * gy / g2, shade = ctx.createLinearGradient(x, y, x + gx / g2, y + gy / g2)
        shade.addColorStop(0, 'rgba(70,60,45,0)'); shade.addColorStop(1, 'rgba(70,60,45,1)'); ctx.fillStyle = shade
      }
      ctx.fill(path(patch.pointsMm)); ctx.restore()
    }
    if (suppressTreads) return
    ctx.clip(path(inlay.walkFootprintMm)); ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    for (const tread of terrainSlopeTreads(inlay)) {
      ctx.strokeStyle = '#635745'; ctx.globalAlpha = .52; ctx.lineWidth = Math.min(35, 13 + tread.dropMm * .1)
      ctx.stroke(path(tread.pointsMm, false))
      ctx.strokeStyle = '#E6D6B3'; ctx.globalAlpha = .56; ctx.lineWidth = 12
      ctx.stroke(path(tread.pointsMm.map(p => ({ x: p.x, y: p.y - 17 })), false))
    }
  } finally { ctx.restore() }
}
