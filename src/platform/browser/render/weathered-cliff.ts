import { terrainRandomUnit } from '../../../shared/terrain-generation/field.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'
import { strataColor } from './stratified-cliff.js'

export const WEATHERED_CLIFF_TEXTURE_SIZE = [1024, 256] as const

export function weatheredCliffPeriod(look: VisualEdgeLook, lengthMm: number) {
  return lengthMm / Math.max(1, Math.round(lengthMm / Math.max(12500, look.repeatMm * 32)))
}

/** An opaque continuous course, mapped by cumulative crest distance. A
 * mineral seam or fracture can cross any number of sampled boundary edges. */
export function paintWeatheredCliffTexture(canvas: HTMLCanvasElement, look: VisualEdgeLook) {
  const ctx = canvas.getContext('2d')!, { width, height } = canvas
  const sample = (channel: string, i: number) => terrainRandomUnit(look.seed, `weathered cliff/${channel}/${i}`)
  const stone = (tone: number, shade = 1) => strataColor(look, tone, shade)
  const trace = (points: number[][]) => {
    ctx.beginPath()
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  }
  const base = ctx.createLinearGradient(0, 0, 0, height)
  base.addColorStop(0, stone(.14, 1.02)); base.addColorStop(.24, stone(.27))
  base.addColorStop(.59, stone(.43)); base.addColorStop(.87, stone(.66)); base.addColorStop(1, stone(.76, .97))
  ctx.fillStyle = base; ctx.fillRect(0, 0, width, height)
  const markStrength = Math.min(1, .38 + look.intensity * .59)
  const wrap = (draw: () => void) => {
    for (const offset of [-width, 0, width]) {
      ctx.save(); ctx.translate(offset, 0); draw(); ctx.restore()
    }
  }

  for (let i = 0; i < 12; i++) {
    const x = (i + sample('station', i) * .85) * width / 12, w = 57 + 116 * sample('slab width', i)
    const y = -23 + 114 * sample('crest', i), front = y + 60 + 121 * sample('slab height', i)
    const shift = (sample('dip', i) - .39) * 82, lip = y + 33 + 22 * sample('worn edge', i)
    const lean = (sample('lean', i) - .49) * 49
    const rock = [[x - w * .46, y + 15], [x - w * .10, y - 1], [x + w * .37, y + 6], [x + w * .55, lip - 5],
      [x + w * .37 + shift, front - 21], [x + shift, front + 9], [x - w * .41 + lean, front - 11], [x - w * .53, lip + 17]]
    const tornEdge = [rock[3], [x + w * .45 + shift * .30, lip + 27], [x + w * .32 + shift * .62, front - 32], rock[4]]
    wrap(() => {
      const tone = sample('mineral', i), wash = ctx.createLinearGradient(0, y, 0, front)
      wash.addColorStop(0, stone(.10 + tone * .30, 1.06)); wash.addColorStop(.4, stone(.32 + tone * .32))
      wash.addColorStop(1, stone(.62 + tone * .25))
      ctx.globalAlpha = (.62 + tone * .33) * markStrength
      ctx.fillStyle = wash; trace(rock); ctx.fill()
      ctx.globalAlpha = .53 * markStrength
      ctx.fillStyle = stone(.80, .84)
      trace([...tornEdge, [rock[4][0] - 13, rock[4][1] - 20], [rock[3][0] - 16, rock[3][1] + 8]]); ctx.fill()
      if (sample('fissured', i) < .79) {
        ctx.strokeStyle = stone(.96, .77); ctx.lineWidth = 1.5 + tone * 2.1
        trace(tornEdge.slice(0, 3)); ctx.stroke()
        trace([tornEdge[2], [x + w * .13 + shift * .56, front - 27], [x + shift * .44, front - 11]]); ctx.stroke()
      }
    })
  }
  for (let i = 0; i < 29; i++) {
    const x = width * sample('fault x', i), y = 12 + 187 * sample('fault y', i)
    const fall = 34 + 104 * sample('fault length', i), skew = (sample('fault lean', i) - .63) * 72
    const points = [[x, y], [x + skew * .36 + 4, y + fall * .23], [x + skew * .66 - 3, y + fall * .53], [x + skew * .63 + 8, y + fall * .72], [x + skew, y + fall]]
    wrap(() => {
      ctx.lineJoin = 'bevel'; ctx.lineCap = 'round'
      ctx.globalAlpha = (.23 + sample('fault ink', i) * .29) * markStrength
      ctx.strokeStyle = stone(.94, .76); ctx.lineWidth = 1.15 + 2.4 * sample('fault width', i)
      trace(points); ctx.stroke()
      trace([points[2], [points[2][0] + 18 + 26 * sample('fault branch', i), points[2][1] - 11], [points[2][0] + 33, points[2][1] - 26]]); ctx.stroke()
      ctx.globalAlpha *= .75; ctx.strokeStyle = stone(.13, 1.09); ctx.lineWidth *= .51
      trace(points.slice(1, -1).map(([x, y]) => [x - 3, y + 1])); ctx.stroke()
    })
  }
  for (let i = 0; i < 17; i++) {
    const x = width * sample('shelf position', i), y = 25 + sample('shelf height', i) * 204
    const span = 22 + sample('shelf width', i) * 153, dip = (sample('shelf dip', i) - .54) * 36
    const edge = [[x, y], [x + span * .26, y + dip * .37 - 4], [x + span * .55, y + dip * .62 + 2], [x + span * .83, y + dip * .81 - 2], [x + span, y + dip]]
    wrap(() => {
      ctx.globalAlpha = .55 * markStrength; ctx.fillStyle = stone(.73, .79)
      trace([...edge, ...edge.slice(1, -1).toReversed().map(([x, y]) => [x - 5, y + 5 + 8 * sample('broken bed', i)])]); ctx.fill()
      ctx.globalAlpha = .47 * markStrength; ctx.fillStyle = stone(.04, 1.11)
      trace([...edge, ...edge.slice(1, -1).toReversed().map(([x, y]) => [x + 4, y - 5 - 5 * sample('chalk edge', i)])]); ctx.fill()
    })
  }

  ctx.globalAlpha = .23 * markStrength
  const grainDark = stone(.98, .83), grainLight = stone(.12, 1.12)
  for (let i = 0; i < 1750; i++) {
    const x = width * sample('grain x', i), y = height * sample('grain y', i)
    const length = 1 + sample('grain size', i) ** 2 * 5
    ctx.fillStyle = i % 3 ? grainDark : grainLight
    ctx.fillRect(x, y, length, i % 4 ? 1.1 : 1.8)
    if (x + length > width) ctx.fillRect(x - width, y, length, i % 4 ? 1.1 : 1.8)
  }
  ctx.globalAlpha = 1
}
