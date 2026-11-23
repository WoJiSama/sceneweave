import { checkCancelled, type RasterImage } from '../../../shared/ports/resources.js'
import type { ActiveArtStyle, ActiveArtStyles } from '../../../shared/visual/art-style.js'
import type { ArtStyleSource } from '../../../shared/visual/art-style-sources.js'
import { forEachOakBoard } from '../../../shared/visual/handdrawn-surfaces.js'

type Context = CanvasRenderingContext2D
type Rect = readonly [x: number, y: number, width: number, height: number]
interface Cloth {
  outline: string
  sourceOutline?: string
  bounds: Rect
  folds: readonly string[]
}
interface Bed {
  frame: Rect
  pillow: Cloth
  quilt: Cloth
  trim: readonly Rect[]
}

// Guides follow the editable wood, pillow and cloth paths in the two fixed SVGs.
const beds: Record<'singleBed' | 'strawBed', Bed> = {
  singleBed: {
    frame: [49, 49, 286, 542],
    trim: [[52, 52, 280, 18], [52, 568, 280, 18]],
    pillow: {
      outline: 'M78 132Q67 106 83 93L149 88 192 96 233 87 301 94Q313 111 304 138L239 145 194 138 144 146Z',
      bounds: [77, 86, 232, 62],
      folds: ['M88 127Q108 126 125 118', 'M192 140Q182 128 188 115', 'M297 106Q283 111 269 110'],
    },
    quilt: {
      outline: 'M68 194Q130 185 191 195Q253 186 317 194L314 552Q188 567 69 550Z',
      bounds: [68, 187, 249, 376],
      folds: [
        'M71 237Q118 226 172 237T314 237', 'M71 267C104 262 124 278 144 290',
        'M95 536C138 513 115 476 148 453S184 412 194 396',
        'M315 301C285 312 273 329 256 353', 'M308 504C269 485 291 451 270 421S251 391 251 379',
      ],
    },
  },
  strawBed: {
    frame: [78, 35, 356, 442],
    trim: [[89, 44, 335, 13], [89, 456, 335, 15]],
    pillow: {
      outline: 'M146 79Q191 80 232 89Q246 94 259 90Q315 74 369 80Q386 82 386 99V151Q385 170 368 174Q316 177 264 166Q250 162 236 169Q189 185 145 173Q127 169 127 151V101Q127 81 146 79Z',
      bounds: [125, 77, 265, 101],
      folds: ['M139 153Q166 153 178 139', 'M255 93C247 106 263 110 252 123', 'M369 101Q345 113 330 109', 'M373 157Q356 151 341 152'],
    },
    quilt: {
      outline: 'M100 219Q169 209 230 216Q259 223 296 214Q351 211 407 204L409 452Q333 449 273 454Q205 448 147 454L100 451Z',
      sourceOutline: 'M100 218L409 204V453H100Z',
      bounds: [99, 204, 311, 250],
      folds: [
        'M102 252C152 247 193 244 231 253S319 249 408 238',
        'M102 275C134 271 147 289 172 298', 'M111 435C169 407 146 374 190 344Q225 324 227 308',
        'M406 289Q371 292 344 330', 'M404 414C371 409 365 371 319 363Q301 360 281 322',
        'M190 447Q205 437 219 434',
      ],
    },
  },
}

const furniture = {
  roundTable: { size: 256, face: 'M128 50a78 78 0 1 0 0 156a78 78 0 1 0 0-156Z', bounds: [50, 50, 156, 156], vertical: true },
  oakChair: { size: 256, face: 'M48 40H208Q216 40 216 48V71Q216 79 208 79H48Q40 79 40 71V48Q40 40 48 40Z', bounds: [40, 40, 176, 39], vertical: false },
  longTable: { size: 512, face: 'M65 119L448 108L451 390L59 403Z', bounds: [60, 108, 391, 295], vertical: false },
  bench: { size: 512, face: 'M66 155H446Q456 155 456 165V345Q456 355 446 355H66Q56 355 56 345V165Q56 155 66 155Z', bounds: [56, 155, 400, 200], vertical: false },
  stool: { size: 512, face: 'M256 116a140 140 0 1 0 0 280a140 140 0 1 0 0-280Z', bounds: [116, 116, 280, 280], vertical: false },
} satisfies Record<string, { size: number; face: string; bounds: Rect; vertical: boolean }>
type GuidedSource = Exclude<ArtStyleSource, 'svg'>

function variation(seed: number, index: number): number {
  const n = Math.imul(seed + index * 271 + 1, 0x45d9f3b)
  return (Math.imul(n ^ n >>> 16, 0x45d9f3b) >>> 0) / 4294967296
}

function stroke(ctx: Context, path: Path2D, color: string, width: number, alpha: number) {
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke(path)
}

function woodGrain(ctx: Context, [x, y, w, h]: Rect, seed: number, vertical: boolean, look: ActiveArtStyle) {
  const tea = look.preset === 'tea', { ink, depth } = look.parameters
  const bold = look.parameters.paintVersion !== undefined
  const across = vertical ? w : h, length = vertical ? h : w
  const rows = Math.max(3, Math.round(across / (tea ? 4.9 : 11)))
  const dark = new Path2D(), light = new Path2D(), knots = new Path2D()
  ctx.save()
  ctx.translate(x + (vertical ? w : 0), y)
  if (vertical) ctx.rotate(Math.PI / 2)
  for (let row = 0; row < rows; row++) {
    const v = across * (.07 + .86 * ((row + .5) / rows))
    const u = length * (.025 + .59 * variation(seed, row * 4))
    const end = Math.min(length - 1, u + length * (.18 + variation(seed, row * 4 + 1) * .71))
    const bend = (variation(seed, row * 4 + 2) - .5) * Math.min(across * .46, 10)
    const path = row % 3 ? dark : light
    path.moveTo(u, v)
    path.bezierCurveTo(u + (end - u) * .28, v + bend, u + (end - u) * .61, v - bend, end, v + bend * .12)
  }
  if (across >= 14 && length >= 50) {
    const u = length * (.30 + .37 * variation(seed, 81)), v = across * (.37 + .22 * variation(seed, 82))
    const r = Math.min(length * .075, Math.max(3, across * .43))
    for (const size of tea ? [1, 1.65, 2.2] : [1, 1.62]) {
      const a = r * size, b = a * .31
      knots.moveTo(u - a, v)
      knots.bezierCurveTo(u - a * .5, v - b, u + a * .4, v - b, u + a, v)
      knots.bezierCurveTo(u + a * .45, v + b, u - a * .40, v + b, u - a, v)
    }
  }
  stroke(ctx, dark, '#473327', tea ? .83 : .63, (tea ? .14 : .03) + ink * (bold ? .0044 : tea ? .0029 : .0025))
  stroke(ctx, light, '#f5d8a9', tea ? 1.1 : .7, (tea ? .15 : .07) + depth * (tea ? .0027 : .0014))
  stroke(ctx, knots, '#5b3c2e', tea ? 1.0 : .75, ink * .004)
  ctx.restore()
}

function woodFace(ctx: Context, path: Path2D, bounds: Rect, seed: number, vertical: boolean, look: ActiveArtStyle) {
  const tea = look.preset === 'tea', { depth, ink } = look.parameters
  const bold = look.parameters.paintVersion !== undefined
  const [x, y, w, h] = bounds
  ctx.save()
  ctx.clip(path)
  ctx.fillStyle = tea ? (bold ? '#78584e' : '#9c684a') : (bold ? '#eee2c6' : '#edd7a8')
  ctx.globalAlpha = tea ? (bold ? .50 + variation(seed, 7) * .12 : .35) : (bold ? .56 : .28)
  ctx.fillRect(x - 2, y - 3, w + 4, h + 6)
  const axis = vertical ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h)
  axis.addColorStop(0, '#ffe3b9ac')
  axis.addColorStop(.12, '#ffe3b940')
  axis.addColorStop(.48, '#b7856100')
  axis.addColorStop(.81, '#56403520')
  axis.addColorStop(1, '#35231ebf')
  ctx.fillStyle = axis
  ctx.globalAlpha = depth * (tea ? .006 : .002)
  ctx.fillRect(x - 2, y - 3, w + 4, h + 6)
  woodGrain(ctx, bounds, seed, vertical, look)
  stroke(ctx, path, bold && !tea ? '#39392f' : '#513928', bold && !tea ? 1.6 : tea ? 1.5 : 1.15, ink * (bold && !tea ? .0072 : tea ? .0038 : .0047))
  ctx.restore()
}

function clothFace(ctx: Context, surface: Cloth, pillow: boolean, look: ActiveArtStyle) {
  const tea = look.preset === 'tea', { depth, ink } = look.parameters
  const bold = look.parameters.paintVersion !== undefined
  const path = new Path2D(surface.outline), [x, y, w, h] = surface.bounds
  const folds = new Path2D()
  for (const curve of surface.folds) folds.addPath(new Path2D(curve))
  ctx.save()
  // The broad paint belongs to this material. Grain is added later in world space.
  ctx.fillStyle = tea ? (pillow ? '#ead9b6' : bold ? '#404f66' : '#646875')
    : (pillow ? '#f5e9cd' : bold ? '#b9c7ad' : '#b7ba95')
  ctx.globalAlpha = tea ? (pillow ? .83 : .92) : bold ? .82 : .58
  ctx.fill(surface.sourceOutline ? new Path2D(surface.sourceOutline) : path)
  ctx.clip(path)
  if (surface.sourceOutline) ctx.clip(new Path2D(surface.sourceOutline))
  const light = ctx.createRadialGradient(x + w * .42, y + h * .35, 0, x + w * .52, y + h * .49, Math.max(w, h) * .59)
  light.addColorStop(0, '#fff4dd86')
  light.addColorStop(.58, '#fff4dd17')
  light.addColorStop(1, '#2d2828a0')
  ctx.fillStyle = light
  ctx.globalAlpha = depth * (tea ? .009 : .0045)
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6)
  if (tea) {
    ctx.save()
    ctx.translate(0, 4)
    stroke(ctx, folds, pillow ? '#a48d73' : '#31313f', pillow ? 12 : 20, depth * (bold ? .0032 : .0023))
    stroke(ctx, folds, pillow ? '#8f7965' : '#393841', pillow ? 6 : 9, depth * (bold ? .0037 : .0026))
    ctx.translate(0, -7)
    stroke(ctx, folds, pillow ? '#fff3d9' : '#c6bfa9', pillow ? 3.2 : 6, depth * (bold ? .0041 : .0031))
    ctx.restore()
  } else {
    const hatch = new Path2D()
    for (let j = -1; j < 9; j++) {
      const start = x + w * (.065 + .023 * j)
      const edge = y + h * (.86 + variation(26, j) * .10)
      hatch.moveTo(start, edge)
      hatch.lineTo(start + w * .047, edge - (pillow ? 5 : 16) * (1 + variation(15, j)))
    }
    stroke(ctx, hatch, '#6d6552', bold ? 1.8 : 1.3, depth * (bold ? .009 : .005))
  }
  stroke(ctx, folds, tea ? '#554c45' : '#534d3a', tea ? 1.7 : bold ? 3.2 : 2.2, ink * (tea ? .0038 : bold ? .010 : .007))
  stroke(ctx, path, '#463b34', tea ? 4.4 : bold ? 4.1 : 3.0, ink * (bold && !tea ? .010 : .0065))
  ctx.restore()
}

function bed(ctx: Context, source: 'singleBed' | 'strawBed', look: ActiveArtStyle) {
  const { frame: [x, y, w, h], pillow, quilt, trim } = beds[source]
  const border: Rect[] = [[x + 3, y + 2, 16, h - 4], [x + w - 18, y + 2, 15, h - 4]]
  for (const bounds of [...border, ...trim]) {
    const path = new Path2D()
    path.roundRect(...bounds, 3)
    woodFace(ctx, path, bounds, 33, bounds[2] < bounds[3], look)
  }
  clothFace(ctx, pillow, true, look)
  clothFace(ctx, quilt, false, look)
}

/** Each pass takes the preceding colors as its base and preserves the source coverage. */
function paintArtworkPass(original: ImageBitmap | HTMLCanvasElement, source: GuidedSource, look: ActiveArtStyle): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = original.width; canvas.height = original.height
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!ctx) { canvas.width = canvas.height = 0; throw new Error('无法创建画风素材缓冲。') }
  try {
    ctx.save()
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    if (source === 'singleBed' || source === 'strawBed') {
      ctx.scale(original.width / (source === 'singleBed' ? 384 : 512), original.height / (source === 'singleBed' ? 640 : 512))
      bed(ctx, source, look)
    } else if (source === 'oakTile' || source === 'studyTile' || source === 'tavernTile') {
      ctx.scale(original.width / 512, original.height / 512)
      if (source === 'oakTile') forEachOakBoard(219, ({ left, top, right, bottom, index }) => {
        const face = new Path2D(`M${left} ${top}L${right - .9} ${top + .3}L${right} ${bottom - .3}L${left + .6} ${bottom}Z`)
        woodFace(ctx, face, [left, top, right - left, bottom - top], index + 37, false, look)
      })
      else for (let i = 0; i < 8; i++) {
        const phase = i % 2 ? 128 : 0, joint = i % 2 ? 160 : 384
        const cuts = source === 'studyTile' ? [phase - 256, phase, phase + 256, phase + 512] : [joint - 512, joint, joint + 512]
        for (let j = 0; j < cuts.length - 1; j++) {
          const start = cuts[j], length = cuts[j + 1] - start, stripe = i * 64 + 1.6
          const bounds: Rect = source === 'studyTile' ? [stripe, start + 1.6, 60.8, length - 3.2] : [start + 1.6, stripe, length - 3.2, 60.8]
          const face = new Path2D()
          face.rect(...bounds)
          woodFace(ctx, face, bounds, i * 17 + ((start + 512) % 512), source === 'studyTile', look)
        }
      }
    } else {
      const { size, face, bounds, vertical } = furniture[source]
      ctx.scale(original.width / size, original.height / size)
      woodFace(ctx, new Path2D(face), bounds, 56, vertical, look)
      if (source === 'oakChair') clothFace(ctx, {
        outline: 'M78 89H179Q190 89 190 103V183Q190 196 178 196H78Q66 196 66 182V103Q66 89 78 89Z',
        bounds: [65, 88, 126, 109], folds: ['M71 166Q92 177 132 174T186 164'],
      }, false, look)
    }
    ctx.restore()
    // Put the original underneath, then preserve its coverage exactly even at translucent edges.
    ctx.globalCompositeOperation = 'destination-over'; ctx.drawImage(original, 0, 0)
    const appearance = ctx.getImageData(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'copy'; ctx.drawImage(original, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), mix = look.parameters.strength / 100
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (!pixels.data[i + 3]) continue
      pixels.data[i] += (appearance.data[i] - pixels.data[i]) * mix
      pixels.data[i + 1] += (appearance.data[i + 1] - pixels.data[i + 1]) * mix
      pixels.data[i + 2] += (appearance.data[i + 2] - pixels.data[i + 2]) * mix
    }
    ctx.putImageData(pixels, 0, 0)
    return canvas
  } catch (error) {
    canvas.width = canvas.height = 0
    throw error
  }
}

/** Runtime paint on a disposable copy of a verified, audience-resident source. */
export function paintArtStyleArtwork(original: ImageBitmap, source: GuidedSource, [first, ...remaining]: ActiveArtStyles, signal?: AbortSignal): HTMLCanvasElement {
  let painted = paintArtworkPass(original, source, first)
  try {
    for (const look of remaining) {
      checkCancelled(signal)
      const next = paintArtworkPass(painted, source, look)
      painted.width = painted.height = 0
      painted = next
    }
    return painted
  } catch (error) {
    painted.width = painted.height = 0
    throw error
  }
}

/** Use the authored paint regions as an RGB layer on the fixed source coverage. */
export function mixVectorArtStyle(original: ImageBitmap | HTMLCanvasElement, colored: RasterImage, strength: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = original.width; canvas.height = original.height
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!ctx) { canvas.width = canvas.height = 0; throw new Error('无法创建矢量画风缓冲。') }
  try {
    ctx.drawImage(original, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const { data } = pixels
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3] || !colored.rgba[i + 3]) continue
      const mix = strength * Math.min(1, colored.rgba[i + 3] / data[i + 3])
      for (let channel = 0; channel < 3; channel++) data[i + channel] += (colored.rgba[i + channel] - data[i + channel]) * mix
    }
    ctx.putImageData(pixels, 0, 0)
    return canvas
  } catch (error) {
    canvas.width = canvas.height = 0
    throw error
  }
}
