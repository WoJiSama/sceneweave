import type { BoundsMm } from '../../../shared/model/scene.js'
import type { LineProfile } from '../../../shared/path-assembly/profiles.js'

interface Palette { base: string; face: string; edge: string; accent: string }
const palettes: Record<LineProfile, Palette> = {
  boxGirder: { base: '#101a1e', face: '#414d50', edge: '#829092', accent: '#b09762' },
  industrialSteel: { base: '#152327', face: '#485353', edge: '#869091', accent: '#e5b774' },
  neonAlloy: { base: '#121e2a', face: '#324957', edge: '#73818e', accent: '#54f5e8' },
  safetyBeam: { base: '#222624', face: '#6e6351', edge: '#9a895e', accent: '#ecc359' },
  glassGuard: { base: '#233738', face: '#47746e', edge: '#98c2b1', accent: '#b2ebcc' },
  concreteBarrier: { base: '#454642', face: '#898679', edge: '#c2bbae', accent: '#d9a35a' },
  doubleTimber: { base: '#392c26', face: '#81603d', edge: '#b99160', accent: '#c9a575' },
  ironPickets: { base: '#181e24', face: '#39444b', edge: '#7f8d89', accent: '#b89061' },
  wireMesh: { base: '#1e2b27', face: '#48564a', edge: '#a0b09c', accent: '#c0c5a9' },
  woodPalisade: { base: '#403227', face: '#8b6944', edge: '#b48f5b', accent: '#cead75' },
  stoneParapet: { base: '#393b37', face: '#737567', edge: '#a8aa96', accent: '#bcbda7' },
  coolantPipe: { base: '#142127', face: '#437F78', edge: '#819A90', accent: '#78E8CA' },
}

export function drawLineProfile(ctx: CanvasRenderingContext2D, art: LineProfile, { x, y, width, height }: BoundsMm, detailPercent = 100): void {
  const p = palettes[art], weight = detailPercent / 100
  const rect = (left: number, top: number, w: number, h: number, paint: string) => {
    ctx.fillStyle = paint
    ctx.fillRect(x + width * left, y + height * top, width * w, height * h)
  }
  const stroke = (ax: number, ay: number, bx: number, by: number, fraction: number, paint: string) => {
    ctx.strokeStyle = paint; ctx.lineWidth = height * fraction * weight
    ctx.beginPath(); ctx.moveTo(x + width * ax, y + height * ay); ctx.lineTo(x + width * bx, y + height * by); ctx.stroke()
  }
  const bolt = (ax: number, ay: number, fraction: number, paint: string) => {
    ctx.fillStyle = paint; ctx.beginPath(); ctx.arc(x + ax * width, y + ay * height, Math.min(height, width) * fraction, 0, 2 * Math.PI); ctx.fill()
  }
  const postWidth = Math.min(.24, height * .86 / width)
  const post = (at: number) => {
    const a = at - postWidth / 2
    rect(a, .02, postWidth, .96, p.base)
    rect(a + postWidth * .10, .10, postWidth * .80, .73, p.edge)
    rect(a + postWidth * .18, .19, postWidth * .64, .61, p.face)
    rect(a + postWidth * .18, .19, postWidth * .64, .09, p.edge)
    bolt(at, .51, .105, p.base)
    bolt(at - postWidth * .018, .46, .044, p.accent)
  }
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip()
  if (art === 'coolantPipe') {
    rect(0, .08, 1, .84, p.base)
    for (const [top, color] of [[.14, '#79725B'], [.55, p.face]] as const) {
      rect(0, top, 1, .30, color)
      rect(0, top + .04, 1, .045 * weight, p.edge)
      rect(0, top + .23, 1, .07, '#294448')
    }
    const collar = Math.min(width * .095, height * .14) / width
    for (const at of [.035, .5, .965]) {
      const left = at - collar / 2
      rect(left, .04, collar, .91, '#18272D')
      rect(left + collar * .21, .07, collar * .58, .85, '#53676D')
      rect(left + collar * .21, .07, collar * .21, .85, p.edge)
    }
  } else if (art === 'boxGirder') {
    rect(0, .03, 1, .94, p.base)
    rect(0, .14, 1, .71, p.face)
    rect(0, .24, 1, .07 * weight, p.edge)
    rect(0, .40, 1, .32, '#222d31')
    rect(0, .72, 1, .065 * weight, p.accent)
    const ribs = Math.min(16, Math.max(1, Math.round(width / (height * 1.9))))
    const ribWidth = Math.min(height * .18 / width, .14)
    for (let i = 0; i < ribs; i++) {
      const at = (i + .5) / ribs
      rect(at - ribWidth / 2, .11, ribWidth, .77, '#171f22')
      rect(at - ribWidth / 2, .15, ribWidth * .29, .58, p.edge)
    }
  } else if (art === 'woodPalisade') {
    rect(0, .13, 1, .74, p.base)
    const count = Math.min(22, Math.max(3, Math.round(width / (height * .48))))
    for (let i = 0; i < count; i++) {
      const a = i / count, rise = .07 + (i * 11 % 7) * .023
      rect(a + .035 / count, rise, .91 / count, .92 - rise, i % 3 ? p.face : '#765536')
      rect(a + .09 / count, rise, .18 / count, .82 - rise, p.edge)
      stroke(a + .59 / count, rise + .10, a + .52 / count, .76, .018, p.base)
    }
    rect(0, .72, 1, .10, p.base)
    rect(0, .72, 1, .036 * weight, p.accent)
  } else if (art === 'stoneParapet' || art === 'concreteBarrier') {
    const stone = art === 'stoneParapet'
    rect(0, .05, 1, .90, p.base)
    rect(0, .10, 1, .75, p.face)
    rect(0, .24, 1, .50, p.edge)
    rect(0, .32, 1, .32, stone ? '#989981' : '#aea99b')
    const count = Math.min(12, Math.max(2, Math.round(width / (height * (stone ? .95 : 2.6)))))
    for (let i = 0; i < count; i++) {
      const a = i / count, shift = (i % 3 - 1) * .019
      stroke(a + shift, .10, a - shift, .86, .035, p.base)
      stroke(a + .011, .26, (i + .81) / count, .27, .023, p.accent)
      if (stone) stroke(a + .33 / count, .65, a + .29 / count, .87, .034, p.base)
      else rect(a + .18 / count, .73, .26 / count, .11, p.accent)
    }
  } else if (art === 'ironPickets' || art === 'wireMesh' || art === 'doubleTimber') {
    const wood = art === 'doubleTimber', wire = art === 'wireMesh'
    rect(0, wood ? .13 : .21, 1, wood ? .25 : .13, p.base)
    rect(0, wood ? .59 : .67, 1, wood ? .27 : .12, p.base)
    rect(0, wood ? .17 : .24, 1, wood ? .14 : .035 * weight, p.edge)
    rect(0, wood ? .63 : .68, 1, wood ? .13 : .035 * weight, p.face)
    const count = Math.min(32, Math.max(5, Math.round(width / (height * (wire ? .39 : .62)))))
    for (let i = 0; i < count; i++) {
      const a = (i + .5) / count
      if (wood) stroke(i / count, i % 2 ? .70 : .26, (i + .82) / count, i % 2 ? .69 : .26, .022, p.base)
      else if (wire) {
        stroke(i / count, .31, (i + 1) / count, .70, .043, p.face)
        stroke(i / count, .70, (i + 1) / count, .31, .027, p.edge)
      } else {
        stroke(a, .16, a, .85, .081, p.base)
        bolt(a, .25, .060, p.edge)
      }
    }
    post(.5)
  } else {
    rect(0, .12, 1, .76, p.base)
    rect(0, .21, 1, .54, p.face)
    rect(0, .22, 1, .07 * weight, p.edge)
    rect(0, .71, 1, .09, p.base)
    if (art === 'glassGuard') {
      rect(0, .30, 1, .34, '#6f9e90')
      stroke(.05, .60, .94, .36, .075, '#95c2ad')
      rect(0, .62, 1, .040 * weight, p.accent)
    } else if (art === 'safetyBeam') {
      rect(0, .35, 1, .28, p.accent)
      const count = Math.min(16, Math.max(4, Math.round(width / height * 1.5)))
      for (let i = 0; i < count; i++) stroke((i + .20) / count, .37, (i + .58) / count, .61, .145, p.base)
    } else if (art === 'neonAlloy') {
      rect(0, .43, 1, .24, '#0e343b')
      rect(0, .46, 1, .14, '#287779')
      for (const a of [.05, .56]) rect(a, .51, .39, .078 * weight, p.accent)
      for (const a of [.16, .26, .37, .63, .74, .85]) bolt(a, .31, .045, '#151f26')
    } else {
      rect(0, .40, 1, .16, '#233335')
      rect(0, .62, 1, .047 * weight, p.accent)
      for (const a of [.18, .24, .30, .70, .76, .82]) stroke(a, .37, a, .54, .045, p.edge)
    }
    post(.5)
  }
  // A narrow end plate reads as a seam on repeated pieces and closes exposed ends.
  for (const at of [0, 1 - postWidth * .19]) rect(at, .10, postWidth * .19, .78, p.base)
  ctx.restore()
}
