import type { Prop } from '../../../shared/model/scene.js'
import type { ProjectedSurface, Projection } from '../../../shared/projection/types.js'
import { oceanWaves } from '../../../shared/ocean/waves.js'
import { waterVisualBounds } from '../../../shared/ocean/presentation.js'

function surfacePath(area: ProjectedSurface): Path2D {
  const result = new Path2D()
  const ring = (points: ProjectedSurface['points']) => {
    points.forEach((p, i) => i ? result.lineTo(p.x, p.y) : result.moveTo(p.x, p.y)); result.closePath()
  }
  for (const region of area.regionsMm ?? [{ outerMm: area.points, holesMm: [] }]) {
    ring(region.outerMm); region.holesMm.forEach(ring)
  }
  return result
}
/** Only audience-owned visible surfaces participate. Hidden geometry never cuts public water. */
function clipWater(ctx: CanvasRenderingContext2D, area: ProjectedSurface, projection: Projection) {
  ctx.clip(surfacePath(area), 'evenodd')
  const index = projection.terrain.findIndex(row => row.id === area.id)
  for (const cover of [...projection.terrain.slice(index + 1), ...projection.rooms]) {
    const outside = new Path2D(), b = projection.bounds
    outside.rect(b.x, b.y, b.width, b.height); outside.addPath(surfacePath(cover))
    ctx.clip(outside, 'evenodd')
  }
}
export function drawOceanWaves(ctx: CanvasRenderingContext2D, area: ProjectedSurface, projection: Projection) {
  const water = area.waterSurface
  if (!water || !water.waveStrength) return
  ctx.save()
  try {
    clipWater(ctx, area, projection); ctx.lineCap = 'round'; ctx.strokeStyle = water.highlightColor
    for (const wave of oceanWaves(area.points, water, projection.bounds)) {
      ctx.globalAlpha = water.waveStrength * wave.strength; ctx.lineWidth = wave.widthMm
      ctx.beginPath(); ctx.moveTo(wave.start.x, wave.start.y)
      ctx.quadraticCurveTo(wave.control.x, wave.control.y, wave.end.x, wave.end.y); ctx.stroke()
    }
  } finally { ctx.restore() }
}

/** A single sprite owns both parts. The local straight waterline rotates with it. */
export function drawWaterProp(ctx: CanvasRenderingContext2D, prop: Prop, projection: Projection, bitmap: ImageBitmap, phase: 'under' | 'over') {
  const look = prop.waterAppearance, area = projection.terrain.find(row => row.id === prop.supportRef.id), water = area?.waterSurface
  if (!look || !area || !water) throw new Error('水中物件缺少当前受众可见的实际水面。')
  if (phase === 'under' && look.mode === 'surface' || phase === 'over' && look.mode === 'submerged') return
  const v = prop.visualBoundsMm, fraction = look.mode === 'partial' ? look.submergedFraction : look.mode === 'submerged' ? 1 : 0
  const lineY = v.y + v.height * (1 - fraction)
  const depth = look.mode === 'surface' ? 0 : look.depth
  if (phase === 'under' && !water.clarity) return
  ctx.save()
  let tinted: HTMLCanvasElement | null = null
  try {
    clipWater(ctx, area, projection)
    ctx.translate(prop.positionMm.x, prop.positionMm.y); ctx.rotate(prop.rotationDeg * Math.PI / 180)
    ctx.beginPath()
    if (phase === 'under') ctx.rect(v.x, lineY, v.width, v.y + v.height - lineY)
    else ctx.rect(v.x, v.y, v.width, lineY - v.y)
    ctx.clip()
    ctx.globalAlpha = prop.appearance.opacity * (phase === 'under' ? water.clarity * (1 - depth * .82) : 1)
    if (phase === 'under') {
      tinted = document.createElement('canvas'); tinted.width = bitmap.width; tinted.height = bitmap.height
      const source = tinted.getContext('2d')
      if (!source) throw new Error('无法创建水下图像合成画布。')
      source.drawImage(bitmap, 0, 0); source.globalCompositeOperation = 'source-atop'
      source.globalAlpha = .22 + depth * .48; source.fillStyle = water.color; source.fillRect(0, 0, tinted.width, tinted.height)
    }
    ctx.drawImage(tinted ?? bitmap, v.x, v.y, v.width, v.height)
    // Surface ripples stay inside the saved visual bounds; no new secret/shadow extent.
    if (phase === 'over' && look.mode === 'surface') {
      ctx.globalAlpha = prop.appearance.opacity * .38; ctx.strokeStyle = water.highlightColor
      ctx.lineWidth = Math.max(10, Math.min(v.width, v.height) * .006)
      ctx.beginPath(); ctx.ellipse(v.x + v.width / 2, v.y + v.height / 2, v.width * .46, v.height * .46, 0, .12, .8)
      ctx.stroke(); ctx.beginPath(); ctx.ellipse(v.x + v.width / 2, v.y + v.height / 2, v.width * .46, v.height * .46, 0, Math.PI + .12, Math.PI + .8); ctx.stroke()
    }
  } finally { ctx.restore(); if (tinted) tinted.width = tinted.height = 0 }
  if (phase === 'over' && look.mode !== 'submerged' && look.surfaceEffects) {
    const effects = look.surfaceEffects, bounds = waterVisualBounds(prop)
    ctx.save()
    let foam: HTMLCanvasElement | undefined
    try {
      clipWater(ctx, area, projection)
      ctx.translate(prop.positionMm.x, prop.positionMm.y); ctx.rotate(prop.rotationDeg * Math.PI / 180)
      ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height); ctx.clip()
      ctx.globalAlpha = prop.appearance.opacity * effects.ripples
      ctx.strokeStyle = water.highlightColor; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      const centerX = v.x + v.width / 2, centerY = look.mode === 'partial' ? lineY : v.y + v.height / 2
      const width = Math.max(12, Math.min(v.width, v.height) * .012)
      // Outside strokes follow the image's local frame; all rotation, opacity,
      // filtering, secret extent and support clipping remain owned by this prop.
      for (let i = 0; i < 2; i++) {
        ctx.lineWidth = width * (1 - i * .32); ctx.globalAlpha = prop.appearance.opacity * effects.ripples * (.55 - i * .18)
        const rx = v.width * (.51 + i * .035), ry = look.mode === 'partial' ? Math.min(v.width, v.height) * (.09 + i * .05) : v.height * (.45 + i * .045)
        ctx.beginPath(); ctx.ellipse(centerX, centerY, rx, ry, 0, .16, Math.PI - .16); ctx.stroke()
        ctx.beginPath(); ctx.ellipse(centerX, centerY, rx, ry, 0, Math.PI + .2, Math.PI * 2 - .2); ctx.stroke()
      }
      if (look.mode === 'partial' && effects.ripples) {
        foam = document.createElement('canvas'); foam.width = bitmap.width; foam.height = bitmap.height
        const source = foam.getContext('2d')
        if (!source) throw new Error('无法建立出水水线。')
        source.drawImage(bitmap, 0, 0); source.globalCompositeOperation = 'source-in'; source.fillStyle = water.highlightColor
        source.fillRect(0, 0, foam.width, foam.height)
        ctx.save(); ctx.beginPath(); ctx.rect(v.x, lineY - width, v.width, width * 2); ctx.clip()
        ctx.globalAlpha = prop.appearance.opacity * effects.ripples * .8; ctx.drawImage(foam, v.x, v.y, v.width, v.height); ctx.restore()
      }
      if (effects.wakeLengthMm > 0) {
        const stern = v.y + v.height * .93, end = v.y + v.height + effects.wakeLengthMm
        for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = prop.appearance.opacity * (.32 - i * .07)
          ctx.lineWidth = width * (1 - i * .18)
          ctx.beginPath(); ctx.moveTo(centerX + side * v.width * (.15 + i * .04), stern + effects.wakeLengthMm * i * .1)
          ctx.quadraticCurveTo(centerX + side * v.width * .3, stern + effects.wakeLengthMm * .55,
            centerX + side * v.width * (.43 + i * .025), end - effects.wakeLengthMm * i * .14); ctx.stroke()
        }
      }
    } finally { ctx.restore(); if (foam) foam.width = foam.height = 0 }
  }
}
