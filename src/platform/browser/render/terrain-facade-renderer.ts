import type { TerrainFacade } from '../../../shared/appearance/terrain-facade.js'
import type { FacadeFace } from './terrain-facade-geometry.js'
import { facadeBayCount } from './terrain-facade-geometry.js'
import { paintGirderFlanges } from './path-assembly.js'
import { industrialFaceLight, shadeIndustrialFace, type IndustrialFaceEnvironment } from './industrial-face-light.js'

/** Rails, ribs and glazing are painted in the same coordinates as the face. */
export function drawTerrainFacadeFace(ctx: CanvasRenderingContext2D, face: FacadeFace, style: TerrainFacade, lit: boolean,
  environment?: IndustrialFaceEnvironment): void {
  const { start, end, lengthMm, facing, offsetsMm: [offset], endCaps, wall } = face
  const { fromMm, lengthMm: width } = wall, toMm = fromMm + lengthMm
  const height = style.depthMm, glazed = style.profile === 'glazed-v1'
  const light = industrialFaceLight(end.x - start.x, end.y - start.y, 1, environment)
  if (style.profile === 'girder-v1') {
    drawGirderFace(ctx, face, style, lit, light)
    return
  }
  const paint = (color: string) => shadeIndustrialFace(color, light)
  const glassPaint = (color: string) => shadeIndustrialFace(color, light, .55)
  const hue = style.lightColor
  const intensity = lit ? style.lightIntensity : 0
  const count = facadeBayCount(width, style), pitch = width / count
  const frame = Math.min(style.frameMm, pitch * .35, height * .25)
  const trim = paint(glazed ? '#887561' : '#566970'), side = paint(glazed ? '#3E3934' : '#2A3B43')
  const steel = paint('#36474E'), dark = paint('#142129'), voidColor = '#0B151D'
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
  depthGradient.addColorStop(0, paint('#314148'))
  depthGradient.addColorStop(.48, paint('#243239'))
  depthGradient.addColorStop(1, paint('#111C25'))
  rect(0, 0, width, height, depthGradient)
  rect(0, height * .68, width, height * .18, paint('#182830'))
  rect(0, height * .86, width, height * .14, paint('#293840'))
  rect(0, height * .89, width, height * .018, paint('#4D5B60'))
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
      glass.addColorStop(0, glassPaint('#42696C'))
      glass.addColorStop(.37, glassPaint('#2D5C61'))
      glass.addColorStop(1, glassPaint('#163941'))
      rect(paneX, paneY, paneW, paneH, glass)
      if (intensity) {
        ctx.globalAlpha = intensity * (.54 + (i % 4 === 2 ? .17 : 0))
        const windowLight = ctx.createLinearGradient(0, paneY, 0, paneY + paneH)
        windowLight.addColorStop(0, hue); windowLight.addColorStop(.27, hue + 'AF'); windowLight.addColorStop(1, hue + '20')
        rect(paneX, paneY, paneW, paneH, windowLight)
        ctx.globalAlpha = 1
      }
      rect(paneX + paneW * .49, paneY, paneW * .055, paneH, paint('#203E43'))
      for (const floor of [.27, .57, .80]) {
        rect(paneX, paneY + floor * paneH, paneW, joint * .9, paint('#203A42'))
        rect(paneX, paneY + floor * paneH, paneW, joint * .28, paint('#859083'))
      }
      ctx.globalAlpha = .17
      polygon([[paneX, paneY], [paneX + paneW * .28, paneY], [paneX + paneW * .7, paneY + paneH],
        [paneX + paneW * .59, paneY + paneH]], glassPaint('#BAF7DE'))
      ctx.globalAlpha = 1
    } else {
      rect(paneX, paneY, paneW, paneH, paint('#132833'))
      const louver = paint('#435862'), louverLip = paint('#748385')
      for (let row = 0; row < 7; row++) {
        const y = paneY + (row + .38) * paneH / 7
        rect(paneX, y, paneW, paneH * .096, louver)
        rect(paneX, y, paneW, paneH * .021, louverLip)
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

function drawGirderFace(ctx: CanvasRenderingContext2D, face: FacadeFace, style: TerrainFacade, lit: boolean, light: number): void {
  const { start, end, lengthMm, offsetsMm: [aOffset, bOffset], endCaps, wall } = face
  const fromMm = wall.fromMm, toMm = fromMm + lengthMm
  const count = facadeBayCount(wall.lengthMm, style), pitch = wall.lengthMm / count
  const frame = Math.min(style.frameMm, pitch * .35, style.depthMm * .25)
  const ux = (end.x - start.x) / lengthMm, uy = (end.y - start.y) / lengthMm
  ctx.save()
  ctx.transform(ux, uy, uy, -ux, start.x - ux * fromMm, start.y - uy * fromMm)
  const at = (station: number, depth: number): [number, number] => {
    const fraction = (station - fromMm) / lengthMm
    const x = aOffset.x + (bOffset.x - aOffset.x) * fraction, y = aOffset.y + (bOffset.y - aOffset.y) * fraction
    return [station + (x * ux + y * uy) * depth, (x * uy - y * ux) * depth]
  }
  const band = (from: number, to: number, low: number, high: number, color: string) => {
    const a = Math.max(fromMm, from), b = Math.min(toMm, to)
    if (b <= a) return
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(...at(a, low)); ctx.lineTo(...at(b, low)); ctx.lineTo(...at(b, high)); ctx.lineTo(...at(a, high))
    ctx.closePath(); ctx.fill()
  }
  const paint = (color: string) => shadeIndustrialFace(color, light)
  paintGirderFlanges('steel', (low, high, color) => band(fromMm, toMm, low, high, paint(color)))
  const recess = paint('#0B151D'), rib = paint('#36474E')
  const first = Math.floor(fromMm / pitch), last = Math.min(count, Math.ceil(toMm / pitch))
  for (let i = first; i < last; i++) {
    const x = (i + .5) * pitch - frame / 2
    band(x, x + frame, .16, .84, recess)
    band(x + frame * .17, x + frame * .75, .18, .80, rib)
    if (!lit || !style.lightIntensity) continue
    ctx.globalAlpha = style.lightIntensity
    band(x + frame * .17, x + frame * .62, .24, .32, style.lightColor)
    ctx.globalAlpha = 1
  }
  const capWidth = Math.min(frame, lengthMm * .35)
  // The jamb terminates the recessed web. Both flanges continue to the opening.
  const jamb = paint('#142129')
  if (endCaps[0]) band(fromMm, fromMm + capWidth, .40, .69, jamb)
  if (endCaps[1]) band(toMm - capWidth, toMm, .40, .69, jamb)
  ctx.restore()
}
