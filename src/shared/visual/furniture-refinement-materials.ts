import type { FurnitureCategory } from '../assets/furniture-collection.js'

/** Pure paint fragments in the existing furniture drawing's local coordinates.
 * Painters may import this module; it never imports a candidate aggregator.
 * Grain has dark opacity .27, pale .28, pores .27, widths .5-.55 local units.
 * Use only on opaque wood interiors with sufficient raster-scale inset; it is
 * not a clipping tool. Cloth, metal and holes require their own paint fragments.
 * The four peasant fragments below preserve the reviewed study byte-for-byte. */
export interface FurnitureMaterialPaint {
  category: FurnitureCategory
  styleId: string
  paint: string
  changes: readonly string[]
}

export const line = (d: string, color: string, width: number, opacity = 1) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`
export const fill = (d: string, color: string, opacity: number) => `<path d="${d}" fill="${color}" opacity="${opacity}"/>`
export const n = (value: number) => Math.round(value * 100) / 100
export const random = (seed: number, index: number) => {
  let value = Math.imul(seed + index * 137, 0x45d9f3b)
  value ^= value >>> 16
  value = Math.imul(value, 0x45d9f3b)
  return (value >>> 0) / 4294967296
}

/** Grain follows each existing board's axis. Wavy latewood, paired pale fibres,
 * broken pores and an occasional tapered knot have separate scales; the seed
 * only places paint marks and never changes the plan or physical footprint. */
export function woodGrain(x: number, y: number, width: number, height: number, seed: number,
  vertical = false, withKnot = true): string {
  const length = vertical ? height : width, across = vertical ? width : height
  const rows = Math.max(3, Math.floor(across / 5.5)), dark: string[] = [], pale: string[] = [], pores: string[] = []
  for (let row = 0; row < rows; row++) {
    const yy = 3 + (across - 6) * (row + .5) / rows + (random(seed + 11, row) - .5) * Math.min(1.8, across / 12)
    const start = 2 + random(seed, row * 5) * (row % 3 ? length * .24 : Math.min(14, length * .08))
    const end = length - 2 - random(seed, row * 5 + 1) * (row % 3 === 2 ? length * .25 : Math.min(16, length * .08))
    const wave = (.35 + random(seed, row * 5 + 2) * 1.6) * (row % 2 ? 1 : -1)
    const middle = (start + end) / 2
    const d = `M${n(start)} ${n(yy)}C${n(length * .2)} ${n(yy + wave)} ${n(length * .34)} ${n(yy - wave)} ${n(middle)} ${n(yy + wave * .3)}S${n(length * .78)} ${n(yy + wave)} ${n(end)} ${n(yy - wave * .25)}`
    dark.push(d)
    if (row % 3 !== 1) pale.push(`M${n(start + 1)} ${n(yy + 1.1)}Q${n(middle)} ${n(yy + 1.1 - wave)} ${n(end - 1)} ${n(yy + .8)}`)
  }
  const poreCount = Math.floor(length * across / 450)
  for (let i = 0; i < poreCount; i++) {
    const xx = 3 + random(seed + 71, i * 3) * Math.max(0, length - 16)
    const yy = 3 + random(seed + 71, i * 3 + 1) * Math.max(0, across - 6)
    pores.push(`M${n(xx)} ${n(yy)}l${n(1.2 + random(seed + 71, i * 3 + 2) * 5)} -.15`)
  }
  let knot = ''
  if (withKnot && length >= 100 && across >= 28) {
    const cx = length * (.28 + random(seed + 3, 1) * .4), cy = across * (.38 + random(seed + 3, 2) * .24)
    const rx = Math.min(18, length * .1, (Math.min(cx, length - cx) - 4) / 4.3), ry = Math.min(4.5, across * .08)
    const rings = [1, 1.65, 2.25].map(scale => {
      const a = rx * scale, b = ry * scale
      return `M${n(cx - a)} ${n(cy)}C${n(cx - a * .35)} ${n(cy - b)} ${n(cx + a * .55)} ${n(cy - b)} ${n(cx + a)} ${n(cy)}C${n(cx + a * .4)} ${n(cy + b)} ${n(cx - a * .55)} ${n(cy + b)} ${n(cx - a)} ${n(cy)}Z`
    }).join('')
    knot = fill(`M${n(cx - rx * .5)} ${n(cy)}q${n(rx * .5)} ${n(-ry * .8)} ${n(rx)} 0q${n(-rx * .5)} ${n(ry * .7)} ${n(-rx)} 0Z`, '#715237', .38)
      + line(rings, '#705136', .65, .38)
      + line(`M${n(cx - rx * .4)} ${n(cy)}l${n(rx * .8)} -.2`, '#544331', .7, .55)
      + line(`M${n(cx - rx * 2.3)} ${n(cy - 1)}q${n(-rx * 1.1)} -2 ${n(-rx * 2)} -.5M${n(cx + rx * 2.3)} ${n(cy + 1)}q${n(rx * .8)} 2 ${n(rx * 1.7)} 1`, '#72563A', .55, .35)
  }
  const transform = vertical ? `translate(${x + width} ${y}) rotate(90)` : `translate(${x} ${y})`
  return `<g transform="${transform}">${line(dark.join(''), '#6D5136', .55, .27)}${line(pale.join(''), '#E3C18C', .54, .28)}${pores.length ? line(pores.join(''), '#654A32', .5, .27) : ''}${knot}</g>`
}

export function nailHeads(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => fill(`M${x - 2} ${y + .7}q1.7 2 3.8 .2q-1 1.7-2.6 1.2Z`, '#463D31', .55)
    + line(`M${x - 1.7} ${y - .5}q.7-1.6 2.8-1`, '#D8C29A', .8, .8)
    + line(`M${x - .8} ${y + .5}l1.6-.3`, '#443E33', .65, .55)).join('')
}

function bedMaterial(): string {
  let weaveDark = '', weaveLight = '', patchFibres = ''
  for (let row = 0; row < 31; row++) for (let column = 0; column < 18; column++) {
    const x = 78 + column * 13.2 + (row % 2) * 2 + random(181, row * 18 + column) * 1.6, y = 211 + row * 7.7
    weaveDark += `M${n(x)} ${n(y)}l3.2 .25`
    weaveLight += `M${n(x + 5)} ${n(y + 2.7)}l.2 1.2`
  }
  for (let i = 0; i < 42; i++) {
    const x = 82 + i * 5.5, y = 496 + (i % 3) * 2.7
    patchFibres += `M${x} ${y}l3-2.3m-2 4.9 3.3-1.5`
  }
  const folds = [
    ['M91 207C105 249 92 298 98 333S111 395 98 454L92 454C102 399 96 374 92 336S100 253 86 209Z', 'M92 211C103 253 90 294 96 333S106 395 95 449'],
    ['M149 213C137 254 154 285 144 333S137 403 146 458L140 458C131 405 132 381 139 333S142 261 144 215Z', 'M149 220C141 256 156 283 147 334S140 402 149 451'],
    ['M219 207C230 240 213 295 223 335S233 407 223 455L217 453C226 408 221 373 217 336S223 250 214 210Z', 'M221 213C231 250 215 290 225 336S234 407 226 451'],
    ['M290 204C277 253 293 288 283 331S279 409 293 458L286 458C272 411 274 376 278 333S284 254 285 207Z', 'M291 211C281 257 297 287 287 334S284 411 296 453'],
  ]
  return woodGrain(49, 94, 10, 428, 33, true, false) + woodGrain(342, 91, 8, 434, 35, true, false)
    + [69, 136, 203, 270].map((x, i) => woodGrain(x, 53, 58, 24, 39 + i, true, false)).join('')
    + [70, 137, 204, 271].map((x, i) => woodGrain(x, 533, 57, 16, 46 + i, true, false)).join('')
    + line('M49 88l-2 440M340 89l7 441M53 49l287-5M49 552l299-5', '#E3BF89', 1.15, .62)
    + line('M60 96l-2 423M338 95l6 425', '#6A4F37', 1.2, .5)
    + fill('M82 145Q196 157 316 145L313 152Q198 163 87 152Z', '#A69B7B', .25)
    + line('M86 111q18-7 42-5M308 112q-19-7-36-5M91 144q15 3 23 1M308 144l-15 3', '#A49879', .9, .55)
    + line('M92 105q105-7 214 .5M87 151q111 11 224-.5', '#F4EAD0', 1, .7)
    + fill('M75 188Q193 197 325 185L324 195Q195 207 76 197Z', '#786D4B', .24)
    + line('M77 188Q197 200 322 188', '#ECE0B6', 1.6, .65)
    + line('M77 201Q193 211 323 198', '#776B48', .7, .5)
    + folds.map(([area, crest]) => fill(area, '#716949', .14) + line(crest, '#E5D8AA', 1.4, .45)).join('')
    + line(weaveDark, '#776C4B', .4, .065) + line(weaveLight, '#E6DDBB', .38, .1)
    + line('M76 218q3 119 0 229M325 216q-4 120-1 230', '#8C8059', .8, .4)
    + line('M82 459q116 10 237-1M83 463q115 10 234-1', '#D9CCA1', .65, .55)
    + line(patchFibres, '#817347', .65, .44)
    + line('M83 490l15-3 20 7 28-7 36 8 41-6 30 8 30-9 34 8', '#D9CC91', .9, .7)
    + nailHeads([[53, 57], [344, 52], [53, 543], [348, 542]])
}

function tableMaterial(): string {
  const boards: readonly [string, string][] = [
    ['M44 65L555 60L556 145L43 150Z', '#B28B5D'],
    ['M43 157L557 152L558 237L43 242Z', '#BE9869'],
    ['M43 249L559 244L560 329L43 334Z', '#9F784E'],
  ]
  return boards.map(([area, color]) => fill(area, color, .45)).join('')
    + woodGrain(48, 69, 502, 73, 61) + woodGrain(48, 161, 504, 73, 67) + woodGrain(48, 253, 506, 73, 71)
    + line('M43 63l513-5M43 155l514-5M43 247l516-5M43 339l516-5', '#E5C28D', 1.3, .75)
    + line('M44 151l513-5M44 243l515-5M44 335l516-5', '#6B4F34', .8, .55)
    + line('M39 50l520-7M37 69l-1 258M41 350l512-7', '#E3BD85', 1.5, .65)
    + fill('M47 319Q154 315 224 322T418 320L545 318L545 326Q392 331 260 326T47 328Z', '#DEC093', .15)
    + line('M83 113l23-1M365 207l38-1M268 304l21-1M486 105l17 1', '#E5CBA1', .85, .65)
    + line('M74 318l26-1 11 1M506 83l20-1M384 269l21 1', '#76593C', .7, .58)
    + nailHeads([[48, 56], [549, 54], [49, 340], [553, 337]])
}

function chairMaterial(): string {
  return fill('M84 166L316 159L321 307L81 314Z', '#AF8758', .35)
    + woodGrain(86, 169, 227, 134, 83) + woodGrain(170, 56, 57, 81, 89, true, false)
    + line('M81 151l235-6M82 164l-4 156M169 53h60M168 59v77', '#E8C48E', 1.5, .7)
    + line('M318 165l5 155-242 6M231 57v82', '#6C5035', 1.2, .55)
    + fill('M85 302Q188 294 316 301L317 309Q194 304 84 313Z', '#E0BC83', .17)
    + line('M110 291q45-3 74-1M228 297l53-2M184 77q-2 17 1 28M214 91l-1 29', '#E0BB84', .75, .6)
    + line('M107 100v37M289 100v35', '#C8B384', 1.3, .65)
    + line('M111 101v33M293 101v33', '#3F3B30', .7, .5)
    + nailHeads([[91, 156], [312, 153], [86, 316], [313, 314]])
}

function cabinetMaterial(): string {
  return [64, 156, 248, 340, 432].map((x, i) => fill(`M${x} 72h88v198h-88Z`, ['#A77E54', '#B38B5D', '#BC9768', '#B28B5D', '#A78156'][i], .96)
    + woodGrain(x + 4, 77, 80, 186, 97 + i * 7, true, i % 2 === 0)
    + line(`M${x} 76v187`, '#E4BE86', 1.1, .55)
    + line(`M${x + 88} 77v186`, '#715338', .7, .45)).join('')
    + fill('M44 74h16v196h-16Z', '#A17B52', .96) + fill('M524 72h30v198h-30Z', '#9F7951', .96)
    + woodGrain(45, 83, 12, 183, 139, true, false) + woodGrain(528, 78, 23, 184, 149, true, false)
    + line('M46 69l505-7M44 78l-2 197M47 299l508-8', '#E3BE87', 1.2, .65)
    + line('M57 277h232M307 277h232', '#DDB782', 1.1, .7)
    + line('M59 294h231M309 294h230', '#6C5037', .7, .65)
    + woodGrain(60, 278, 224, 3, 157, false, false) + woodGrain(310, 278, 224, 3, 163, false, false)
    + line('M156 284h40M406 284h40', '#BAAC87', .9, .9)
    + line('M156 289h40M406 289h40', '#514A38', .7, .8)
    + nailHeads([[50, 70], [552, 66], [48, 291], [554, 285]])
}

export const PEASANT_REFINEMENT_PAINTS: Readonly<Record<FurnitureCategory, string>> = Object.freeze({
  bed: bedMaterial(), table: tableMaterial(), chair: chairMaterial(), cabinet: cabinetMaterial(),
})
