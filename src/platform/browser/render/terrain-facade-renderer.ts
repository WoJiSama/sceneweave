import type { TerrainFacade } from '../../../shared/appearance/terrain-facade.js'
import type { FacadeFace } from './terrain-facade-geometry.js'
import { facadeBayCount } from './terrain-facade-geometry.js'

/** Both motifs start at the same structural frame. Each bay is painted in
 * face space, so the glazing, rails and light share the face's perspective. */
export function drawTerrainFacadeFace(ctx: CanvasRenderingContext2D, face: FacadeFace, style: TerrainFacade, lit: boolean) {
  const { start, end, lengthMm, facing, offset, endCaps, wall } = face
  const { fromMm, lengthMm: width } = wall, toMm = fromMm + lengthMm
  const height = style.depthMm, glazed = style.profile === 'glazed-v1'
  const hue = style.lightColor
  const intensity = lit ? style.lightIntensity : 0
  const count = facadeBayCount(width, style), pitch = width / count
  const frame = Math.min(style.frameMm, pitch * .35, height * .25)
  const trim = glazed ? '#887561' : '#566970', side = glazed ? '#3E3934' : '#2A3B43'
  const steel = '#36474E', dark = '#142129', voidColor = '#0B151D'
  const ux = (end.x - start.x) / lengthMm, uy = (end.y - start.y) / lengthMm
  const firstBay = Math.floor(fromMm / pitch), lastPost = Math.min(count, Math.ceil(toMm / pitch))
  ctx.save()
  ctx.transform(ux, uy, offset.x / offset.y, 1, start.x - ux * fromMm, start.y - uy * fromMm)
  ctx.beginPath(); ctx.rect(fromMm, 0, lengthMm, offset.y); ctx.clip()
  const rect = (x: number, y: number, w: number, h: number, color: string | CanvasGradient) => {
    ctx.fillStyle = color; ctx.fillRect(x, y, w, h)
  }
  const polygon = (points: [number, number][], color: string | CanvasGradient) => {
    ctx.beginPath()
    for (const [i, [x, y]] of points.entries()) if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    ctx.closePath(); ctx.fillStyle = color; ctx.fill()
  }
  const depthGradient = ctx.createLinearGradient(0, 0, 0, height)
  depthGradient.addColorStop(0, '#314148'); depthGradient.addColorStop(.48, '#243239'); depthGradient.addColorStop(1, '#111C25')
  rect(0, 0, width, height, depthGradient)
  rect(0, height * .68, width, height * .18, '#182830')
  rect(0, height * .86, width, height * .14, '#293840')
  rect(0, height * .89, width, height * .018, '#4D5B60')
  const windowTop = height * (glazed ? .16 : .22), windowBase = height * (glazed ? .70 : .64)
  const edge = Math.min(frame * .9, pitch * .15)
  for (let i = firstBay; i < lastPost; i++) {
    const left = i * pitch, x = left + edge, w = pitch - 2 * edge, h = windowBase - windowTop
    const chamfer = Math.min(edge * .85, h * .18)
    polygon([[x, windowTop + chamfer], [x + chamfer, windowTop], [x + w - chamfer, windowTop],
      [x + w, windowTop + chamfer], [x + w, windowBase], [x, windowBase]], voidColor)
    const joint = edge * .23
    rect(x + joint, windowTop + chamfer, w - 2 * joint, h - chamfer - joint, side)
    const paneX = x + Math.min(edge * .8, w * .18), paneW = w - (paneX - x) * 2
    const paneY = windowTop + chamfer + joint, paneH = windowBase - paneY - 2 * joint
    if (paneW < 22 || paneH < 24) continue
    if (glazed) {
      const glass = ctx.createLinearGradient(paneX, paneY, paneX + paneW * .24, paneY + paneH)
      glass.addColorStop(0, '#42696C'); glass.addColorStop(.37, '#2D5C61'); glass.addColorStop(1, '#163941')
      rect(paneX, paneY, paneW, paneH, glass)
      if (intensity) {
        ctx.globalAlpha = intensity * (.54 + (i % 4 === 2 ? .17 : 0))
        const windowLight = ctx.createLinearGradient(0, paneY, 0, paneY + paneH)
        windowLight.addColorStop(0, hue); windowLight.addColorStop(.27, hue + 'AF'); windowLight.addColorStop(1, hue + '20')
        rect(paneX, paneY, paneW, paneH, windowLight)
        ctx.globalAlpha = 1
      }
      rect(paneX + paneW * .49, paneY, paneW * .055, paneH, '#203E43')
      for (const floor of [.27, .57, .80]) {
        rect(paneX, paneY + floor * paneH, paneW, joint * .9, '#203A42')
        rect(paneX, paneY + floor * paneH, paneW, joint * .28, '#859083')
      }
      ctx.globalAlpha = .17
      polygon([[paneX, paneY], [paneX + paneW * .28, paneY], [paneX + paneW * .7, paneY + paneH],
        [paneX + paneW * .59, paneY + paneH]], '#BAF7DE')
      ctx.globalAlpha = 1
    } else {
      rect(paneX, paneY, paneW, paneH, '#132833')
      for (let row = 0; row < 7; row++) {
        const y = paneY + (row + .38) * paneH / 7
        rect(paneX, y, paneW, paneH * .096, '#435862')
        rect(paneX, y, paneW, paneH * .021, '#748385')
      }
      rect(paneX, paneY, paneW, Math.min(paneH * .09, frame), trim)
    }
    rect(x + joint, windowBase - 2 * joint, w - 2 * joint, joint, trim)
    rect(x + w * .24, height * .77, w * .52, height * .052, voidColor)
    rect(x + w * .26, height * .775, w * .48, height * .012, steel)
    if (intensity) {
      const lightY = glazed ? paneY : paneY + paneH * .15, strip = Math.min(paneW * .30, frame * 1.3)
      const beam = ctx.createLinearGradient(0, lightY, 0, height * .98)
      beam.addColorStop(0, hue + '61'); beam.addColorStop(.42, hue + '26'); beam.addColorStop(1, hue + '00')
      ctx.globalAlpha = intensity * facing
      const lampX = glazed ? x + w * .095 : x + w * .5
      polygon([[lampX - strip * .5, lightY], [lampX + strip * .5, lightY], [lampX + strip * 2.05, height * .98],
        [lampX - strip * 1.7, height * .98]], beam)
      const glow = ctx.createLinearGradient(lampX - strip, 0, lampX + strip, 0)
      glow.addColorStop(0, hue + '00'); glow.addColorStop(.5, hue + '9C'); glow.addColorStop(1, hue + '00')
      rect(lampX - strip, lightY, strip * 2, glazed ? h * .81 : frame * .75, glow)
      ctx.globalAlpha = intensity * .93
      rect(lampX - strip * .13, lightY, strip * .26, glazed ? h * .8 : frame * .68, hue)
      ctx.globalAlpha = 1
    }
  }
  for (let i = firstBay; i <= lastPost; i++) {
    const x = i * pitch, w = frame
    rect(x - w * .52, 0, w * 1.04, height, voidColor)
    polygon([[x - w * .47, 0], [x + w * .40, 0], [x + w * .22, height], [x - w * .36, height]], side)
    rect(x - w * .35, 0, w * .25, height * .93, trim)
    for (const y of [.14, .72, .9]) rect(x - w * .3, height * y, w * .55, Math.min(frame * .45, height * .03), steel)
  }
  // Openings have their own load-bearing jambs even where they cut across a bay.
  const jamb = Math.min(frame * 1.3, lengthMm * .4)
  for (const [i, cap] of endCaps.entries()) if (cap) {
    const x = i === 0 ? fromMm : toMm - jamb
    rect(x, 0, jamb, offset.y, voidColor)
    rect(x + jamb * .17, 0, jamb * .66, offset.y, side)
    rect(x + jamb * .21, 0, jamb * .14, offset.y, trim)
  }
  rect(0, 0, width, height * .098, dark)
  rect(0, height * .049, width, height * .019, steel)
  rect(0, height * .095, width, height * .011, trim)
  rect(0, height * .965, width, height * .035, voidColor)
  if (offset.y < height) {
    const shoe = Math.min(frame * .55, offset.y * .14)
    rect(fromMm, offset.y - shoe, lengthMm, shoe, dark)
    rect(fromMm, offset.y - shoe, lengthMm, shoe * .24, trim)
  }
  ctx.globalAlpha = .32 * (1 - facing)
  rect(0, 0, width, height, voidColor)
  ctx.restore()
}
