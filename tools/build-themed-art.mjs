/**
 * Original editable ink-and-colour artwork: cemetery/volcano studies and six
 * explicit refinements of the retained outdoor SVG library. No external images,
 * fonts, tracing, generated bitmap service or baked directional cast shadows.
 * Run: node tools/build-themed-art.mjs [--preview]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const root = new URL('../', import.meta.url)
const sourceRoot = new URL('assets/sceneweave-handdrawn-content/', root)
const publicRoot = new URL('public/assets/sceneweave-handdrawn-content/', root)
const reviewRoot = new URL('work/content-20261023/', root)
for (const dir of [sourceRoot, publicRoot, reviewRoot]) await mkdir(dir, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const f = value => Number(value.toFixed(2))
const ink = '#3E493C', fine = 2.048, line = 4.096
const path = (d, stroke = ink, width = fine, fill = 'none', opacity = 1) => `<path d="${d}" stroke="${stroke}" stroke-width="${width}" fill="${fill}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
const ellipse = (x, y, rx, ry, fill, stroke = 'none', width = 0, opacity = 1) => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`
const rect = (x, y, w, h, fill, stroke = 'none', width = 0, radius = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`
const wrap = (size, body) => [-size, 0, size].flatMap(x => [-size, 0, size].map(y => `<g transform="translate(${x} ${y})">${body}</g>`)).join('')
let randomState = 1
const reset = seed => { randomState = seed >>> 0 }
const rand = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296 }
const between = (a, b) => a + (b - a) * rand()
const shade = (color, amount) => `#${[1, 3, 5].map(start => Math.min(255, Math.max(0, parseInt(color.slice(start, start + 2), 16) + amount)).toString(16).padStart(2, '0')).join('')}`
const svg = (width, height, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs}</defs>${body}</svg>\n`
// Smooth closed contour through perturbed radial points; not a repeating polygon.
function contour(cx, cy, rx, ry, phase = 0, count = 17, amplitude = .1) {
  const points = Array.from({ length: count }, (_, i) => {
    const angle = i / count * Math.PI * 2, radius = 1 + Math.sin(angle * 3 + phase) * amplitude + Math.sin(angle * 7 - phase) * amplitude * .4
    return [cx + Math.cos(angle) * rx * radius, cy + Math.sin(angle) * ry * radius]
  })
  const mid = (a, b) => a.map((n, j) => (n + b[j]) / 2)
  let d = `M${mid(points.at(-1), points[0]).map(f).join(' ')}`
  for (let i = 0; i < points.length; i++) d += `Q${points[i].map(f).join(' ')} ${mid(points[i], points[(i + 1) % points.length]).map(f).join(' ')}`
  return d + 'Z'
}
function grain(id, seed, frequency = .09) {
  // Stitched turbulence remains an editable SVG filter. Low-opacity luminance,
  // never opaque sand noise or artificial light/shadow, supplies paper grain.
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="3" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope=".38" intercept=".29"/><feFuncG type="linear" slope=".38" intercept=".29"/><feFuncB type="linear" slope=".38" intercept=".29"/></feComponentTransfer></filter>`
}
function speckle(size, count, colors, opacity = .35, radius = 1.4) {
  let b = ''
  for (let i = 0; i < count; i++) {
    const x = between(0, size), y = between(0, size), r = between(.5, radius)
    b += wrap(size, ellipse(x, y, r, r * between(.45, 1), colors[i % colors.length], 'none', 0, opacity * between(.4, 1)))
  }
  return b
}
function materialBase(size, color, seed) {
  let b = rect(0, 0, size, size, color)
  for (let i = 0; i < 45; i++) b += wrap(size, path(contour(between(0, size), between(0, size), between(20, 90), between(10, 48), i, 15, .17), 'none', 0, shade(color, i % 2 ? 12 : -14), .1))
  b += `<rect width="${size}" height="${size}" filter="url(#grain)" opacity=".13" style="mix-blend-mode:soft-light"/>`
  return { b, defs: grain('grain', seed) }
}
function mossPaver() {
  reset(0x47525056)
  const size = 512, { b: base, defs } = materialBase(size, '#686F59', 72)
  let b = base
  for (let row = -1; row < 5; row++) for (let col = -1; col < 5; col++) {
    const x = col * 128 + (row % 2 ? 64 : 0), y = row * 128, color = ['#92917C', '#9A9984', '#868C78', '#A19D87'][(row + col + 8) % 4]
    const d = `M${x + 7} ${y + 8}L${x + 118} ${y + 5} ${x + 123} ${y + 112} ${x + 111} ${y + 121} ${x + 8} ${y + 118} ${x + 4} ${y + 31}Z`
    b += path(d, '#5A614E', 2.2, color)
    b += path(`M${x + 12} ${y + 16}L${x + 111} ${y + 12}M${x + 14} ${y + 19}V${y + 107}`, '#C0BA9B', 2, 'none', .5)
    b += path(`M${x + 15} ${y + 112}L${x + 106} ${y + 115} ${x + 116} ${y + 108}V${y + 23}`, '#65705A', 2, 'none', .5)
    b += path(`M${x + 25} ${y + 69}q24 -9 46 -1m8 2 18 -4M${x + 75} ${y + 17}l-7 13 3 9m-2 -11 -9 2`, '#606B56', 1.5, 'none', .37)
    for (let i = 0; i < 13; i++) {
      const side = i % 4, along = 12 + rand() * 100, px = x + (side % 2 ? along : side === 0 ? between(3, 18) : between(110, 123)), py = y + (side % 2 ? side === 1 ? between(3, 18) : between(110, 123) : along)
      b += ellipse(px, py, between(2, 6), between(1, 4), i % 2 ? '#647452' : '#7A865B', 'none', 0, .62)
    }
    for (let i = 0; i < 18; i++) b += ellipse(x + between(20, 106), y + between(20, 107), between(.6, 1.7), between(.5, 1.4), i % 2 ? '#D0C5A0' : '#56614F', 'none', 0, .27)
  }
  return svg(size, size, b + speckle(size, 210, ['#C3B894', '#465443'], .22), defs)
}
function soil() {
  reset(0x4752534F)
  const size = 512, { b: base, defs } = materialBase(size, '#77715B', 91)
  let b = base
  for (let i = 0; i < 95; i++) {
    const x = rand() * size, y = rand() * size, r = between(2, 7)
    let detail = path(contour(x, y, r, r * .6, i, 8, .1), '#555B49', .9, ['#9A947C', '#848571', '#B0A487'][i % 3], .75)
    if (i % 3 === 0) detail += path(`M${f(x - r * .5)} ${f(y - r * .1)}l${f(r * .7)} ${f(-r * .2)}`, '#D0BFA0', 1, 'none', .4)
    b += wrap(size, detail)
  }
  for (let i = 0; i < 26; i++) {
    const x = rand() * size, y = rand() * size
    b += wrap(size, path(`M${f(x)} ${f(y)}q${f(between(7, 16))} ${f(between(-5, 5))} ${f(between(20, 36))} ${f(between(-7, 7))}m-12 1 6 6`, '#555C46', 1.2, 'none', .32))
  }
  return svg(size, size, b + speckle(size, 680, ['#B9AB8B', '#484F41', '#8D9572'], .34), defs)
}
function headstone() {
  reset(0x48454144)
  // Orthographic top view of the thin upright slab and its broad stepped foot.
  // There is no readable face, carved letter or deceptive front-view elevation.
  let b = path('M65 95Q72 88 85 88H235Q249 89 255 97L259 156Q253 169 237 170H82Q67 169 61 157Z', '#485144', 4.1, '#7D8574')
  b += path('M74 99H246L248 155Q245 160 235 161H84L72 154Z', '#55614F', 2, '#9EA28B')
  b += path('M89 107Q93 101 103 101H218Q232 102 234 111L236 143Q233 151 220 151H102Q88 150 86 142Z', '#4D594A', 2.3, '#B2B29A')
  b += path('M96 111Q151 106 224 111M96 140Q154 145 226 140', '#D5CCAB', 2.1, 'none', .65)
  b += path('M153 109l-5 9 6 6 -3 17m3 -17 9 -4', '#6A7560', 1.7, 'none', .7)
  b += path('M81 97l8 6m144 51 9 -4M80 150l7 6m119 -54 8 4', '#CFCAA8', 2, 'none', .7)
  for (let i = 0; i < 23; i++) b += ellipse(between(70, 248), i % 2 ? between(151, 160) : between(94, 103), between(1.3, 4), between(1, 2.4), i % 3 ? '#71815B' : '#536D4E', 'none', 0, .7)
  for (let i = 0; i < 42; i++) b += ellipse(between(94, 225), between(111, 140), between(.5, 1.2), between(.5, 1.1), i % 2 ? '#D8D0B3' : '#697461', 'none', 0, .4)
  return svg(320, 256, b)
}
function sarcophagus() {
  reset(0x53415243)
  let b = path('M84 59L235 57 256 77 259 556 239 578 82 576 61 558 63 80Z', '#485144', 4.1, '#727D6D')
  b += path('M89 69L231 68 247 83 248 552 234 566 88 565 73 550 75 85Z', '#5C6755', 2, '#9B9F88')
  b += path('M97 80H221L237 95 236 539 222 553H96L84 540 85 96Z', '#535F4F', 2.1, '#B1B19A')
  b += path('M103 92H216L224 101V533L215 541H103L96 533V101Z', '#7B846C', 1.8, '#A6AD91')
  b += path('M107 97H211M101 104V527M108 534H210M219 110V526', '#D1CCAB', 2, 'none', .65)
  // Restrained geometric carving seen on the horizontal lid; no figure/portrait.
  b += path('M160 129L183 160 160 190 137 160ZM160 433L183 464 160 495 137 464Z', '#727E64', 2.1)
  b += path('M160 198V425M150 206V416m20 -210v210', '#7D896C', 2.2, 'none', .6)
  for (const y of [234, 276, 319, 361, 401]) b += path(`M136 ${y}q24 -10 48 0m-42 5q18 -7 36 0`, '#748163', 1.8, 'none', .57)
  b += path('M111 315l14 -13 -6 -19m6 19 11 4M207 489l-12 -10 -3 -16m3 16 -7 9M105 101l7 6', '#596B57', 1.8, 'none', .7)
  for (let i = 0; i < 80; i++) {
    const side = i % 4, px = side < 2 ? between(78, 94) : between(226, 244), py = between(90, 549)
    b += ellipse(px, py, between(1, 3), between(1.2, 5), ['#718359', '#8F976D', '#536E4F'][i % 3], 'none', 0, .56)
  }
  for (let i = 0; i < 96; i++) b += ellipse(between(105, 214), between(108, 529), between(.6, 1.8), between(.5, 1.1), i % 2 ? '#D6CBA9' : '#6B7B60', 'none', 0, .23)
  return svg(320, 640, b)
}
function ironFence() {
  reset(0x46454E43)
  // The top rail, narrow palings and square post caps all lie in a strict plan.
  let b = path('M49 121Q303 118 559 121V137Q303 141 49 137Z', '#333E37', 3.1, '#565F52')
  b += path('M64 125Q301 122 545 125', '#8B927B', 1.8, 'none', .6)
  for (let i = 0; i < 13; i++) {
    const x = 74 + i * 38.3
    b += path(`M${f(x - 3)} 106L${f(x - 5)} 114V146L${f(x)} 153 ${f(x + 5)} 146V114Z`, '#333F37', 1.7, '#707766')
    b += path(`M${f(x)} 115v28`, '#A4A58A', 1.2, 'none', .6)
    if (i % 3 === 0) b += path(`M${f(x + 2)} 133l-2 7`, '#987552', 1.5, 'none', .8)
  }
  for (const x of [48, 560]) {
    b += rect(x - 17, 111, 34, 34, '#626C5A', '#323D35', 3.1, 3)
    b += path(`M${x - 12} 115L${x} 111 ${x + 12} 115 ${x + 14} 128 ${x + 11} 139 ${x} 142 ${x - 11} 139 ${x - 14} 128Z`, '#4B594A', 1.7, '#90927B')
    b += ellipse(x, 127, 5, 5, '#6B755E', '#4B594A', 1.4)
    b += path(`M${x - 11} 116l8 -2m10 23 5 -5`, '#B8B99A', 1.7)
  }
  return svg(640, 256, `<g transform="translate(16 0)">${b}</g>`)
}
function basalt() {
  reset(0x42415341)
  const size = 512, { b: base, defs } = materialBase(size, '#626D5E', 41)
  let body = base
  for (const [index, cell] of periodicPlates(size, 4).entries()) {
    const { x, y, points } = cell, color = ['#71796A', '#77806D', '#6C7766', '#7D8270'][index % 4]
    let plate = path('M' + points.map(p => p.map(f).join(' ')).join('L') + 'Z', '#4C5D4F', 1.7, color, .8)
    for (let j = 0; j < points.length; j++) {
      const p = points[j], q = points[(j + 1) % points.length], r = [p[0] * .5 + q[0] * .5, p[1] * .5 + q[1] * .5]
      if (j % 2 === 0) plate += path(`M${f(x)} ${f(y)}L${r.map(f).join(' ')} ${q.map(f).join(' ')}Z`, 'none', 0, shade(color, j % 3 ? -7 : 8), .28)
    }
    const p = points[index % points.length], q = points[(index + 1) % points.length]
    plate += path(`M${f(p[0] * .8 + x * .2)} ${f(p[1] * .8 + y * .2)}L${f(q[0] * .8 + x * .2)} ${f(q[1] * .8 + y * .2)}`, '#A7AD91', 1.6, 'none', .47)
    plate += path(`M${f(x - 22)} ${f(y + 13)}l21 -12 23 6m-24 -5 -7 15m30 -12 9 -8`, '#4F6553', 1.3, 'none', .48)
    for (let i = 0; i < 34; i++) plate += ellipse(x + between(-29, 29), y + between(-24, 24), between(.6, 1.4), between(.5, 1.1), i % 2 ? '#B4B89A' : '#394C3E', 'none', 0, .25)
    body += wrap(size, plate)
  }
  return svg(size, size, body + speckle(size, 750, ['#B6B99F', '#303F38', '#7A8871'], .23), defs)
}

function ash() {
  reset(0x41534856)
  const size = 512, { b: base, defs } = materialBase(size, '#918D7D', 47)
  let b = base
  for (let i = 0; i < 78; i++) {
    const x = rand() * size, y = rand() * size
    b += wrap(size, path(`M${f(x)} ${f(y)}q${f(between(7, 19))} ${f(between(-3, 4))} ${f(between(17, 29))} ${f(between(-5, 6))}`, i % 2 ? '#C1B69B' : '#656E5E', 1.3, 'none', .29))
  }
  for (let i = 0; i < 85; i++) {
    const x = rand() * size, y = rand() * size, r = between(1.4, 4)
    b += wrap(size, path(contour(x, y, r, r * .64, i, 7, .14), '#566253', .7, i % 2 ? '#71796A' : '#ACA58D', .7))
  }
  return svg(size, size, b + speckle(size, 1350, ['#D0C4A6', '#586352', '#80715C'], .33), defs)
}
function periodicPlates(size = 512, n = 5) {
  const step = size / n, offsets = Array.from({ length: n * n }, () => [between(-step * .3, step * .3), between(-step * .3, step * .3)])
  const seeds = []
  for (let row = -1; row <= n; row++) for (let col = -1; col <= n; col++) {
    const offset = offsets[((row + n) % n) * n + (col + n) % n]
    seeds.push({ x: (col + .5) * step + offset[0], y: (row + .5) * step + offset[1], row, col })
  }
  const clip = (poly, a, b, c) => {
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c
      if (dp <= 0) out.push(p)
      if ((dp <= 0) !== (dq <= 0)) { const t = dp / (dp - dq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]) }
    }
    return out
  }
  return seeds.filter(s => s.row >= 0 && s.row < n && s.col >= 0 && s.col < n).map(seed => {
    let points = [[seed.x - step * 2, seed.y - step * 2], [seed.x + step * 2, seed.y - step * 2], [seed.x + step * 2, seed.y + step * 2], [seed.x - step * 2, seed.y + step * 2]]
    for (const other of seeds) if (other !== seed) points = clip(points, other.x - seed.x, other.y - seed.y, (other.x ** 2 + other.y ** 2 - seed.x ** 2 - seed.y ** 2) / 2)
    return { ...seed, points }
  })
}
function lava() {
  reset(0x4C415641)
  const size = 512, { b: base, defs } = materialBase(size, '#72513C', 61)
  let b = base
  // Actual periodic cooling plates fill the surface. The thin interstices carry
  // short ember lines; warm colour never forms a large flat orange/brown lake.
  for (const [index, cell] of periodicPlates(size, 5).entries()) {
    const { x, y, points } = cell, d = 'M' + points.map(p => p.map(f).join(' ')).join('L') + 'Z', color = ['#565D50', '#5C6254', '#4F584C', '#626655'][index % 4]
    let plate = path(d, '#3A473B', 3.2, color)
    const inner = points.map(([px, py]) => [x + (px - x) * .85, y + (py - y) * .85])
    plate += path('M' + inner.map(p => p.map(f).join(' ')).join('L') + 'Z', '#39493E', 1.2, 'none', .58)
    plate += path(`M${f(x - 20)} ${f(y + 8)}l18 -17 25 6m-24 -4 -4 19`, '#899078', 1.5, 'none', .55)
    const p = points[index % points.length], q = points[(index + 1) % points.length], a = [p[0] * .7 + q[0] * .3, p[1] * .7 + q[1] * .3], z = [p[0] * .25 + q[0] * .75, p[1] * .25 + q[1] * .75]
    plate += path(`M${a.map(f).join(' ')}L${z.map(f).join(' ')}`, '#AE7044', 3.2, 'none', .83) + path(`M${a.map(f).join(' ')}L${z.map(f).join(' ')}`, '#D09B58', 1.1, 'none', .74)
    for (let i = 0; i < 35; i++) plate += ellipse(x + between(-26, 26), y + between(-23, 23), between(.6, 1.4), between(.4, .9), i % 3 ? '#A4A58A' : '#2C3E33', 'none', 0, .3)
    b += wrap(size, plate)
  }
  return svg(size, size, b + speckle(size, 430, ['#C99A62', '#303E35', '#A39071'], .18), defs)
}

function stone(cx, cy, rx, ry, color, phase, scoria = false) {
  const angles = [-.93, -.52, .12, .66, .97, .77, .13, -.54, -.94], ys = [-.25, -.87, -.99, -.68, -.08, .61, .94, .77, .28]; const points = angles.map((x, i) => [cx + x * rx * (1 + Math.sin(phase + i) * .06), cy + ys[i] * ry * (1 + Math.cos(phase + i * 2) * .06)]); const d = 'M' + points.map(p => p.map(f).join(' ')).join('L') + 'Z'
  const clipId = `stone${String(phase).replace('.', '_')}`
  let b = `<defs><clipPath id="${clipId}">${path(d, 'none', 0, '#fff')}</clipPath></defs>`
  b += path(d, '#425044', 2.3, color)
  b += `<g clip-path="url(#${clipId})">`
  b += path(`M${f(cx - rx)} ${f(cy - ry * .1)}L${f(cx - rx * .2)} ${f(cy - ry * .7)} ${f(cx + rx * .6)} ${f(cy - ry * .45)} ${f(cx + rx * .25)} ${f(cy + ry * .25)} ${f(cx - rx * .48)} ${f(cy + ry * .46)}Z`, 'none', 0, shade(color, 13), .84)
  b += path(`M${f(cx - rx * .48)} ${f(cy + ry * .46)}L${f(cx + rx * .25)} ${f(cy + ry * .25)} ${f(cx + rx)} ${f(cy - ry * .12)} ${f(cx + rx * .8)} ${f(cy + ry)} ${f(cx - rx * .5)} ${f(cy + ry)}Z`, 'none', 0, shade(color, -9), .7)
  b += path(`M${f(cx - rx * .7)} ${f(cy - ry * .1)}L${f(cx - rx * .18)} ${f(cy - ry * .65)} ${f(cx + rx * .57)} ${f(cy - ry * .42)}M${f(cx - rx * .42)} ${f(cy + ry * .4)}L${f(cx + rx * .23)} ${f(cy + ry * .22)}`, shade(color, 42), 1.8, 'none', .67)
  b += path(`M${f(cx + rx * .7)} ${f(cy - ry * .43)}L${f(cx + rx * .12)} ${f(cy - ry * .14)} ${f(cx - rx * .25)} ${f(cy + ry * .4)} ${f(cx - rx * .56)} ${f(cy + ry * .52)}M${f(cx - rx * .25)} ${f(cy + ry * .4)}l${f(rx * .16)} ${f(ry * .31)}M${f(cx + rx * .12)} ${f(cy - ry * .14)}l${f(-rx * .16)} ${f(-ry * .47)}`, '#3B5144', 1.3, 'none', .64)
  b += path(`M${f(cx - rx * .88)} ${f(cy + ry * .23)}l${f(rx * .27)} ${f(-ry * .11)} ${f(rx * .1)} ${f(ry * .13)}m${f(rx * .9)} ${f(ry * .08)}l${f(rx * .25)} ${f(-ry * .1)}`, shade(color, -22), 1.2, 'none', .63)
  b += path(`M${f(cx - rx * .54)} ${f(cy - ry * .72)}l${f(rx * .21)} ${f(ry * .01)}m${f(rx * .51)} ${f(ry * .63)}l${f(rx * .18)} ${f(-ry * .07)}`, shade(color, 45), 1.1, 'none', .65)
  for (let i = 0; i < (scoria ? 105 : 42); i++) {
    const x = between(cx - rx, cx + rx), y = between(cy - ry, cy + ry), r = between(.6, scoria ? 2.5 : 1.7)
    b += ellipse(x, y, r, r * between(.5, .9), i % 3 ? shade(color, -30) : shade(color, 38), 'none', 0, scoria ? .4 : .3)
    if (scoria && i % 5 === 0) b += path(`M${f(x - r)} ${f(y + 1)}q${f(r)} ${f(r * .6)} ${f(r * 2)} 0`, shade(color, 38), 1, 'none', .5)
  }
  return b + '</g>'
}
function boulder() {
  reset(0x424F554C)
  let b = stone(222, 191, 157, 128, '#6E766A', 1.3, true)
  b += stone(130, 155, 49, 42, '#7B806D', 2.1, true)
  b += stone(337, 262, 35, 28, '#5F6A5D', 3.8, true)
  return svg(448, 384, b)
}
function crack() {
  reset(0x43524143)
  let b = ''
  const branches = ['M70 145L149 126 192 143 246 119 296 130 350 102 409 124 466 106 529 129 584 111 653 132 697 111', 'M192 143L210 171 246 182 267 204', 'M350 102L370 76 400 65 421 47', 'M529 129L539 158 574 174 584 197', 'M149 126L130 103 104 94', 'M653 132L663 156 688 167']
  for (const d of branches) b += path(d, '#39483D', 11, 'none', .91) + path(d, '#805B40', 7, 'none', .88) + path(d, '#B57844', 3.6, 'none', .9) + path(d, '#D1A461', 1.4, 'none', .7)
  for (let i = 0; i < 48; i++) {
    const x = between(90, 684), y = between(97, 157), r = between(2, 7)
    b += path(contour(x, y, r, r * .6, i, 7, .14), '#455344', 1.2, i % 2 ? '#727A64' : '#535F4E', .92)
  }
  return svg(768, 256, b)
}
function foliageContour(cx, cy, rx, ry, phase) {
  const points = Array.from({ length: 92 }, (_, i) => {
    const a = i / 92 * Math.PI * 2, r = 1 + .065 * Math.sin(a * 5 + phase) + .048 * Math.sin(a * 13 - phase) + .025 * Math.sin(a * 27 + phase)
    return [cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]
  })
  return 'M' + points.map(p => p.map(f).join(' ')).join('L') + 'Z'
}
function leaves(cx, cy, radius, color, count, phase) {
  // Individually oriented tapered leaves sit in irregular lobed growth, avoiding
  // the old broad empty disks and uniformly spaced ring-like canopy segments.
  let b = path(foliageContour(cx, cy, radius, radius * .84, phase), '#4D6448', 2.1, color)
  b += path(contour(cx + radius * .05, cy - radius * .03, radius * .77, radius * .62, phase + 2, 15, .14), 'none', 0, shade(color, 10), .33)
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius * .88, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * .79
    const len = between(radius * .055, radius * .12), wide = len * between(.37, .62), rot = rand() * 360
    let leaf = path(`M${f(-len)} 0Q${f(-len * .35)} ${f(-wide)} ${f(len)} 0Q${f(len * .1)} ${f(wide)} ${f(-len)} 0Z`, i % 4 ? shade(color, -11) : shade(color, -19), .75, shade(color, i % 5 * 6 - 7), .85)
    if (i % 3 === 0) leaf += path(`M${f(-len * .7)} 0Q0 ${f(-wide * .22)} ${f(len * .65)} 0`, shade(color, 40), .8, 'none', .53)
    b += `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})">${leaf}</g>`
  }
  for (let i = 0; i < count / 5; i++) {
    const x = between(cx - radius * .65, cx + radius * .65), y = between(cy - radius * .45, cy + radius * .45)
    b += path(`M${f(x)} ${f(y)}q${f(radius * .04)} ${f(-radius * .045)} ${f(radius * .08)} ${f(-radius * .015)}`, shade(color, 40), 1.4, 'none', .48)
  }
  return b
}
function treeRefined() {
  reset(0x54524545)
  let b = leaves(576, 576, 414, '#5D774C', 170, 1.7)
  // A broken outer crown of 24 smaller growth clusters, followed by 16 internal
  // clusters. Irregular positions/radii avoid an eight-blob flower silhouette.
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2 + between(-.05, .05), r = between(304, 338), x = 576 + Math.cos(a) * r, y = 576 + Math.sin(a) * r * .96
    b += leaves(x, y, between(94, 126), ['#708955', '#7C925C', '#6A8550', '#87985F'][i % 4], 54, i * 1.7)
  }
  const interior = [[409,414],[554,383],[700,410],[780,535],[769,684],[660,775],[514,787],[383,681],[357,543],[478,538],[620,505],[661,639],[516,672],[559,581],[475,430],[727,582]]
  interior.forEach(([x,y], i) => { b += leaves(x + between(-14,14), y + between(-14,14), between(103,137), ['#7D955D', '#899D65', '#78935B', '#819A60'][i % 4], 67, i * 2.1) })
  return svg(1152, 1152, b)
}
function shrubRefined() {
  reset(0x53485255)
  let b = leaves(224, 192, 146, '#657F4E', 60, 1.1)
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + between(-.09,.09), x = 224 + Math.cos(a) * between(108,125), y = 192 + Math.sin(a) * between(77,93)
    b += leaves(x, y, between(39,55), ['#7C9157','#899A61','#708A52','#81965B'][i%4], 35, i * 1.3)
  }
  for (const [i,[x,y,r]] of [[162,148,57],[222,132,53],[281,161,55],[288,216,54],[231,246,57],[170,228,53],[217,191,66]].entries()) b += leaves(x,y,r,['#8C9E65','#82985D','#90A069'][i%3],47,i*2.1)
  return svg(448, 384, b)
}

function stonesRefined() {
  reset(0x524F434B)
  let b = stone(157, 145, 78, 62, '#89927D', 1.1)
  b += stone(92, 110, 45, 39, '#A0A58A', 2.8)
  b += stone(228, 165, 35, 29, '#7C8974', 4.3)
  b += stone(208, 83, 31, 24, '#929B83', 6.7)
  for (const [x,y,rx,ry,p] of [[62,166,7,4,.8],[242,107,6,4,2.2],[191,208,8,4,4.1],[261,189,5,4,6.2]]) b += stone(x,y,rx,ry,'#8B957D',p)
  return svg(320, 256, b)
}
function grassRefined() {
  reset(0x47524153)
  const size = 1024, { b: base, defs } = materialBase(size, '#75845B', 77)
  let b = base
  for (let i = 0; i < 46; i++) {
    const x = rand() * size, y = rand() * size, rx = between(24,61), ry = between(15,35)
    b += wrap(size, path(contour(x,y,rx,ry,i,18,.14),'none',0,i%3?'#8B9A67':'#526E4A',.18))
  }
  for (let i = 0; i < 185; i++) {
    const x = rand() * size, y = rand() * size, r = between(10, 29)
    let tuft = ellipse(x, y, r * 1.1, r * .47, '#586F4B', 'none', 0, .13)
    for (let j = 0; j < 4 + i % 5; j++) {
      const tx = x + between(-r, r), ty = y + between(-r * .3, r * .3), len = between(7, 18), sway = between(-6, 7)
      tuft += path(`M${f(tx)} ${f(ty)}Q${f(tx + sway * .2 - 2)} ${f(ty - len * .5)} ${f(tx + sway)} ${f(ty - len)}Q${f(tx + sway * .5 + 2)} ${f(ty - len * .4)} ${f(tx + 1.5)} ${f(ty)}Z`, 'none', 0, ['#99A96D', '#AFB77A', '#526B49', '#7D935B'][j % 4], .5)
    }
    b += wrap(size, tuft)
  }
  for (let i = 0; i < 75; i++) {
    const x = rand() * size, y = rand() * size
    b += wrap(size, path(`M${f(x)} ${f(y)}q6 -6 13 -2m-5 -2 5 -4`, '#B9BC83', 1.3, 'none', .24))
  }
  return svg(size, size, b + speckle(size, 1500, ['#A4B17D', '#4D6749'], .17, 1.6), defs)
}
function rockRefined() {
  reset(0x524F4346)
  const size = 512, { b: base, defs } = materialBase(size, '#7A8172', 89)
  let b = base
  for (let i = 0; i < 32; i++) {
    const x = rand() * size, y = rand() * size, r = between(13, 48)
    b += wrap(size, path(contour(x, y, r, r * .65, i, 9, .1), 'none', 0, i % 3 ? '#89917B' : '#64705F', .21))
    b += wrap(size, path(`M${f(x - r)} ${f(y)}l${f(r * .6)} ${f(-r * .39)} ${f(r * .8)} ${f(r * .13)}m${f(-r * .8)} ${f(-r * .13)} ${f(-r * .12)} ${f(r * .39)}`, '#4D6353', 1.5, 'none', .43))
    b += wrap(size, path(`M${f(x - r * .94)} ${f(y - 2)}l${f(r * .56)} ${f(-r * .39)} ${f(r * .75)} ${f(r * .12)}`, '#B2B79B', 1.4, 'none', .47))
  }
  return svg(size, size, b + speckle(size, 1050, ['#BEC0A1', '#4B6050', '#899A79'], .27), defs)
}
function sandRefined() {
  reset(0x53414E44)
  const size = 1024, { b: base, defs } = materialBase(size, '#C1B286', 31)
  let b = base
  for (let i = 0; i < 48; i++) {
    const x = rand()*size, y=rand()*size, length=between(24,76)
    b += wrap(size,path(`M${f(x)} ${f(y)}q${f(length*.5)} -9 ${f(length)} -2m${f(-length*.8)} 7q${f(length*.4)} -7 ${f(length*.8)} -1`,'#E1CEA1',between(2,4),'none',.28))
  }
  for (let i = 0; i < 135; i++) {
    const x = rand() * size, y = rand() * size, w = between(8, 31)
    b += wrap(size, path(`M${f(x)} ${f(y)}q${f(w * .5)} ${f(between(-4, 1))} ${f(w)} ${f(between(-2, 3))}`, i % 3 ? '#A79C70' : '#DDD0A1', 1.3, 'none', .29))
  }
  for (let i = 0; i < 90; i++) {
    const x = rand() * size, y = rand() * size, r = between(1, 2.8)
    b += wrap(size, ellipse(x, y, r, r * .6, '#8F9672', 'none', 0, .36))
  }
  return svg(size, size, b + speckle(size, 3400, ['#E5D5AB', '#938B64', '#B8AE80'], .34, 1.2), defs)
}
function woodPanel(x, y, w, h, base = '#A18256', planks = 5) {
  const clipId = `wood${x}_${y}_${w}_${h}`
  let b = rect(x, y, w, h, '#71583E', '#403F31', 4.1, 4)
  b += rect(x + 6, y + 6, w - 12, h - 12, base, '#64543A', 1.7, 2)
  b += `<defs><clipPath id="${clipId}">${rect(x + 8, y + 8, w - 16, h - 16, '#fff')}</clipPath></defs><g clip-path="url(#${clipId})">`
  for (let i = 0; i < planks; i++) {
    const py = y + 8 + i * (h - 16) / planks
    b += rect(x + 8, f(py), w - 16, f((h - 16) / planks), shade(base, (i % 3 - 1) * 4))
    if (i) b += path(`M${x + 9} ${f(py)}H${x + w - 9}`, '#5A4D34', 1.6, 'none', .8)
    for (let j = 0; j < 4; j++) {
      const gy = py + 4 + j * (h - 16) / planks / 4, gx = between(x + 12, x + w * .3), len = between(w * .35, w * .7)
      b += path(`M${f(gx)} ${f(gy)}q${f(len * .25)} -3 ${f(len * .5)} 0t${f(len * .5)} 0`, i % 2 ? '#C3A575' : '#6F5638', 1.2, 'none', .31)
    }
  }
  for (let i = 0; i < 24; i++) b += path(`M${f(between(x + 14, x + w - 30))} ${f(between(y + 14, y + h - 14))}l${f(between(3, 12))} ${f(between(-1, 1))}`, i % 3 ? '#D6B685' : '#675135', 1, 'none', .4)
  return b + '</g>'
}
function coatRack() {
  reset(0x434F4154)
  let b = ''
  for (const a of [0, 90, 180, 270]) b += `<g transform="translate(128 128) rotate(${a})">${path('M-8 -8L-12 -68Q0 -77 12 -68L8 -8Z', '#454737', 2.3, '#8C7651')}${path('M0 -20V-65', '#B4A16F', 1.6)}</g>`
  b += path('M84 71Q100 60 118 78L139 112Q144 135 132 158L102 169Q85 162 82 142L68 113Q66 89 84 71Z', '#4E5D44', 2.2, '#8F9972')
  b += path('M87 77q-12 24 4 51l11 27M102 76q-8 24 12 48l11 26M76 112q22 -7 48 12m-30 12 18 19', '#C6C5A0', 1.5, 'none', .62)
  b += path('M84 175Q65 159 63 137L77 117 103 124 112 151 140 165 135 188 107 195Z', '#665844', 2, '#AA8F65')
  b += path('M74 132q14 24 33 39l23 10m-45 -19 -3 15', '#D0B78B', 1.5, 'none', .63)
  b += ellipse(157, 139, 28, 20, '#9D9C73', '#5F674A', 2.1)
  b += ellipse(157, 139, 18, 11, '#B2AC7F', '#6C704F', 1.5)
  b += path('M140 144q15 8 34 0', '#686B4C', 2.2)
  b += ellipse(128, 124, 12, 12, '#B09C69', '#555740', 2)
  return svg(256, 256, b)
}
function bench() {
  reset(0x42454E43)
  let b = woodPanel(49, 63, 414, 130, '#A88B5D', 3)
  for (const x of [79, 433]) for (const y of [80, 176]) {
    b += ellipse(x, y, 3.2, 3.2, '#6F6B4D', '#514E37', 1.2)
    b += path(`M${x - 1.5} ${y}h3`, '#C0B084', 1)
  }
  b += path('M68 70h24m317 116h28M158 150l18 -1m137 -65 14 1', '#DDC08A', 1.7, 'none', .7)
  return svg(512, 256, b)
}
function hearth() {
  reset(0x48454152)
  let b = path('M58 47L451 48 464 61 465 259 450 274 61 272 47 260 47 62Z', '#465144', 4.1, '#747D6A')
  b += rect(70, 68, 372, 186, '#515D4A', '#465144', 2.1, 4)
  b += rect(96, 91, 320, 139, '#666B55', '#3E4A3D', 2.1, 5)
  for (const [x, y, w, h] of [[52, 52, 94, 30], [149, 53, 104, 29], [256, 52, 100, 30], [359, 53, 96, 29], [53, 238, 100, 29], [156, 238, 98, 30], [257, 239, 100, 28], [360, 239, 95, 29], [52, 84, 30, 74], [52, 161, 30, 74], [430, 85, 30, 73], [430, 161, 30, 74]]) {
    b += rect(x, y, w, h, shade('#A5A58B', Math.round(between(-9, 7))), '#5A6753', 1.5, 2)
    b += path(`M${x + 5} ${y + 5}h${w - 13}`, '#D0C6A5', 1.4, 'none', .55)
  }
  for (let i = 0; i < 100; i++) b += ellipse(between(107, 404), between(102, 220), between(.8, 2.6), between(.8, 1.5), i % 3 ? '#A5A17F' : '#37463A', 'none', 0, .48)
  for (const a of [-18, 21]) b += `<g transform="translate(256 162) rotate(${a})">${rect(-102, -12, 204, 24, '#67563D', '#3D4234', 2, 10)}${path('M-87 -4H82m-167 9H81', '#A28A5B', 1.4)}${ellipse(-89, 0, 5, 8, '#AD9567', '#645238', 1.4)}</g>`
  b += path('M231 123Q234 146 252 143Q266 127 273 136Q266 150 281 163Q285 180 267 190Q249 203 234 188Q214 189 214 173Q206 157 221 148Q231 142 231 123Z', '#976744', 1.6, '#B78048')
  b += path('M243 148Q245 163 258 159Q251 173 264 181Q250 192 238 182Q225 177 233 165Z', '#CC9953', 1.3, '#D6B26B')
  return svg(512, 320, b)
}
function worktable() {
  reset(0x574F524B)
  let b = woodPanel(25, 25, 462, 206, '#A08257', 5)
  for (const x of [38, 474]) for (const y of [38, 218]) b += ellipse(x, y, 2.5, 2.5, '#645F43', '#504B35', 1)
  b += path('M73 61l92 5 -5 59 -94 -8Z', '#6F7755', 1.4, '#959A71')
  b += path('M76 69l78 4m-80 37 76 7m-74 -47 -4 35m80 -32 -4 39', '#C7C39A', 1.2, 'none', .55)
  b += path('M345 166l76 -13 4 13 -77 14Z', '#5F5238', 1.8, '#A88A59')
  b += rect(408, 133, 29, 36, '#7F8870', '#485740', 1.8, 3)
  b += path('M414 138v25m8 -25v23m8 -23v21', '#B1B49A', 1.3, 'none', .7)
  b += path('M249 78l47 -4m-92 83 28 -1m-36 -5 15 1M132 194l11 -3', '#D3B27D', 1.6, 'none', .65)
  return svg(512, 256, b)
}
function sideboard() {
  reset(0x53494445)
  let b = woodPanel(49, 49, 414, 158, '#94774F', 4)
  b += rect(59, 59, 394, 138, 'none', '#C2A16C', 1.6, 1)
  for (const x of [64, 448]) for (const y of [64, 192]) b += ellipse(x, y, 2.1, 2.1, '#B1A06A', '#6E6343', 1)
  b += path('M164 72q8 5 16 0m-13 1q7 10 13 0M327 182q8 -4 17 -1', '#66543A', 1.4, 'none', .65)
  b += path('M83 60l18 -1m306 134 25 -1m-220 -66 29 1', '#D1B17D', 1.5, 'none', .6)
  return svg(512, 256, b)
}
function bed() {
  reset(0x42454431)
  let b = rect(49, 49, 286, 542, '#7E6548', '#434B3B', 4.1, 5)
  b += rect(61, 65, 262, 509, '#B4AD8A', '#635F47', 2, 11)
  b += rect(66, 71, 252, 495, '#C9C0A0', '#938F70', 1.8, 10)
  b += path('M78 132Q67 106 83 93L149 88 192 96 233 87 301 94Q313 111 304 138L239 145 194 138 144 146Z', '#8D9070', 1.8, '#E0D4B1')
  b += path('M86 103q38 -10 76 0m41 -1q42 -12 91 2m-208 25q38 7 74 0m46 0q42 7 87 0', '#F0E3BF', 1.5, 'none', .7)
  b += path('M68 194Q130 185 191 195Q253 186 317 194L314 552Q188 567 69 550Z', '#586D50', 2.1, '#8D9A73')
  b += path('M69 194Q129 185 191 195Q252 187 317 194L315 241Q254 232 192 242Q129 231 69 241Z', '#7A8962', 1.7, '#A3AE85')
  b += path('M78 204q58 -7 112 0t117 0m-228 28q52 -9 109 1t118 -1M80 248q-8 106 1 243m221 -242q8 113 0 241', '#CDD0A0', 1.8, 'none', .65)
  for (const x of [110, 162, 214, 266]) b += path(`M${x} 261q-6 119 1 264`, '#6E825B', 1.6, 'none', .44)
  for (let i = 0; i < 65; i++) b += path(`M${f(between(84, 302))} ${f(between(270, 537))}l${f(between(2, 4))} 0`, '#B9C18F', .9, 'none', .38)
  b += rect(51, 51, 282, 21, '#A28556', '#504F3A', 2, 3) + rect(51, 567, 282, 22, '#A28556', '#504F3A', 2, 3)
  b += path('M65 58q126 -4 254 0M65 575q126 -4 254 0', '#CEAF77', 1.4)
  return svg(384, 640, b)
}
function wardrobe() {
  reset(0x57415244)
  let b = woodPanel(43, 49, 362, 158, '#8B704B', 4)
  b += rect(53, 59, 342, 138, 'none', '#B79B68', 1.7, 2)
  b += rect(59, 65, 330, 126, 'none', '#5C5138', 1.5, 1)
  b += path('M72 127H376', '#68553A', 1.4, 'none', .7)
  for (const x of [61, 387]) for (const y of [72, 184]) {
    b += rect(x - 5, y - 4, 10, 8, '#8D8962', '#504F36', 1.1, 1)
    b += ellipse(x, y, 1.4, 1.4, '#C6B883', '#6E6746', .5)
  }
  b += path('M86 58h29m232 139 26 -1m-190 -107 27 -1M99 180l13 1', '#CDB07C', 1.5, 'none', .6)
  return svg(448, 256, b)
}

const material = (key, name, baseColor, topic, tags, colors, art) => ({ key, catalogId: `material.sw.${key}`, version: 1, kind: 'material', name, topic, tags, colors, width: 512, height: 512, logicalSizeMm: { width: 2000, height: 2000 }, baseColor, surfaces: ['terrain', 'path'], art })
const prop = (key, name, width, height, foot, blocking, shadow, topic, tags, colors, art, renderLayer = 'object') => ({ key, catalogId: `prop.sw.${key}`, version: 1, kind: 'prop', name, topic, tags, colors, width, height, spanMm: { width: Math.round((width - 80) / .256), height: Math.round((height - 80) / .256) }, logicalSizeMm: { width: width / .256, height: height / .256 }, visualBoundsMm: { x: -width / .512, y: -height / .512, width: width / .256, height: height / .256 }, footprintMm: { width: foot[0], height: foot[1] }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: blocking, blocksSight: false, renderLayer, shadowClass: shadow, art })
const artworks = [
  material('moss-paver', '苔痕旧石板', '#92917C', 'graveyard', ['墓地', '铺装', '石板', '苔藓'], ['灰', '绿'], mossPaver()),
  material('grave-soil', '墓园细砾土', '#77715B', 'graveyard', ['墓地', '泥土', '碎石', '地面'], ['棕', '灰', '绿'], soil()),
  prop('headstone', '苔痕墓碑顶盖', 320, 256, [700, 300], true, 'furniture', 'graveyard', ['墓地', '墓碑', '石制', '俯视'], ['灰', '绿'], headstone()),
  prop('sarcophagus', '苔痕石棺', 320, 640, [700, 1900], true, 'furniture', 'graveyard', ['墓地', '石棺', '石制', '储藏'], ['灰', '绿'], sarcophagus()),
  prop('iron-fence', '旧铁围栏短段', 640, 256, [2000, 160], true, 'furniture', 'graveyard', ['墓地', '围栏', '金属', '边界'], ['灰', '黑', '棕'], ironFence()),
  material('basalt', '冷却玄武岩', '#62685F', 'volcano', ['火山', '玄武岩', '岩地', '冷却'], ['灰', '绿'], basalt()),
  material('volcanic-ash', '细层火山灰', '#918D7D', 'volcano', ['火山', '火山灰', '灰土', '地面'], ['灰', '棕'], ash()),
  material('lava', '熔岩冷壳纹理', '#665348', 'volcano', ['火山', '熔岩', '冷壳', '热纹外观'], ['棕', '灰', '橙'], lava()),
  prop('basalt-boulder', '气孔玄武岩块', 448, 384, [1300, 1000], true, 'furniture', 'volcano', ['火山', '玄武岩', '岩块', '障碍'], ['灰', '绿'], boulder()),
  prop('volcanic-crack', '余热裂隙装饰', 768, 256, [2400, 300], false, 'none', 'volcano', ['火山', '裂隙', '地表装饰', '热纹外观'], ['灰', '棕', '橙'], crack(), 'ground'),
]
const oldManifest = JSON.parse(await readFile(new URL('assets/sceneweave-handdrawn-outdoor/manifest.json', root), 'utf8'))
for (const [key, art] of [['tree-broadleaf', treeRefined()], ['shrub-round', shrubRefined()], ['rock-small', stonesRefined()], ['grass', grassRefined()], ['rock', rockRefined()], ['sand', sandRefined()]]) {
  const source = oldManifest.assets.find(asset => asset.key === key)
  const { file: _file, sourceFile: _sourceFile, sha256: _sha, sourceSha256: _sourceSha, sizeBytes: _bytes, alphaContentBoundsPx: _alpha, minTransparentPaddingPx: _padding, fullyOpaque: _opaque, pixelWidth, pixelHeight, ...metadata } = source
  artworks.push({ ...metadata, key: `refined-${key}`, catalogId: `${source.catalogId}.refined`, version: 1, name: `${source.name}·精修`, topic: 'refined', tags: ['精修', ...(key.includes('tree') ? ['树木', '阔叶树', '植被', '室外'] : key.includes('shrub') ? ['灌木', '植被', '室外'] : key.includes('rock') ? ['岩石', '自然', '室外'] : key === 'grass' ? ['草地', '植被', '地面'] : ['砂地', '岸地', '地面'])], colors: key === 'sand' ? ['棕', '黄'] : key.includes('rock') ? ['灰', '绿'] : ['绿'], width: pixelWidth, height: pixelHeight, refines: { catalogId: source.catalogId, version: 1, assetSha256: source.sha256 }, provenance: { sourceFile: `assets/sceneweave-handdrawn-outdoor/${source.sourceFile}`, sourceSha256: source.sourceSha256, method: 'Original SVG re-illustration; original geometry and fixed content retained' }, art })
}
// Added after the topic studies/refinement batch, for the authorized SCN-01
// furnishing continuation. Footprints are explicit gameplay geometry, not alpha.
artworks.push(
  prop('coat-rack', '挂衣木架', 256, 256, [500, 500], true, 'furniture', 'interior', ['室内', '衣架', '收纳', '木制'], ['棕', '绿'], coatRack()),
  prop('bench', '磨边木长凳', 512, 256, [1600, 500], true, 'furniture', 'interior', ['室内', '长凳', '座具', '木制'], ['棕'], bench()),
  prop('hearth', '灰石炉台', 512, 320, [1600, 900], true, 'furniture', 'interior', ['室内', '炉台', '石制', '照明装饰'], ['灰', '棕', '橙'], hearth()),
  prop('worktable', '旧木操作桌', 512, 256, [1800, 800], true, 'furniture', 'interior', ['室内', '操作桌', '桌子', '工作台'], ['棕', '绿'], worktable()),
  prop('sideboard', '矮木边柜', 512, 256, [1600, 600], true, 'furniture', 'interior', ['室内', '边柜', '储物', '木制'], ['棕'], sideboard()),
  prop('bed-single', '绿毯单人床', 384, 640, [1100, 2100], true, 'furniture', 'interior', ['室内', '单人床', '寝具', '木制'], ['棕', '绿', '白'], bed()),
  prop('wardrobe', '旧木衣柜', 448, 256, [1400, 600], true, 'furniture', 'interior', ['室内', '衣柜', '储物', '木制'], ['棕'], wardrobe()),
)
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }; return (crc ^ 0xffffffff) >>> 0 }
const chunk = (name, data) => { const type = Buffer.from(name), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); type.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8); return out }
function encodePng(width, height, rgba) {
  const rows = Buffer.alloc(height * (width * 4 + 1)); for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(rows, y * (width * 4 + 1) + 1)
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
const manifest = { catalogId: 'sceneweave-handdrawn-content', themeCatalogId: 'sceneweave-handdrawn', version: 1, name: '墨绘原野 · 墓园、火山与自然精修', status: 'P2', author: 'Sceneweave contributors; original SVG artwork authored with Codex assistance', source: 'tools/build-themed-art.mjs and assets/sceneweave-handdrawn-content/*.svg', rights: 'Project original artwork; no external reference tracing or extracted image components', licenseRef: 'MIT', licenseFile: 'LICENSE.txt', densityPxPerMetre: 256, longCastShadowBaked: false, colorSpace: 'sRGB', bitDepth: 8, alpha: 'straight; zero-alpha RGB cleared', assets: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-crashpad-for-testing'] })
const context = await browser.newContext()
try {
  const page = await context.newPage(), previews = []
  process.stdout.write(`Rasterizer: Node ${process.version}; Chrome ${browser.version()}\n`)
  for (const artwork of artworks) {
    await writeFile(new URL(`${artwork.key}.svg`, sourceRoot), artwork.art)
    const encodedPixels = await page.evaluate(async ({ source, width, height }) => {
      const image = new Image(), url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
      try { image.src = url; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }); ctx.drawImage(image, 0, 0); return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer).toBase64() } finally { URL.revokeObjectURL(url) }
    }, { source: artwork.art, width: artwork.width, height: artwork.height })
    const pixels = Buffer.from(encodedPixels, 'base64')
    let minX = artwork.width, minY = artwork.height, maxX = -1, maxY = -1, opaque = true
    for (let i = 0; i < pixels.length; i += 4) {
      if (!pixels[i + 3]) pixels[i] = pixels[i + 1] = pixels[i + 2] = 0
      else { const x = (i / 4) % artwork.width, y = Math.floor(i / 4 / artwork.width); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
      if (pixels[i + 3] !== 255) opaque = false
    }
    const padding = Math.min(minX, minY, artwork.width - 1 - maxX, artwork.height - 1 - maxY)
    if (artwork.kind === 'prop' && padding < 8) throw new Error(`${artwork.key}: padding ${padding} below 8px`)
    if (artwork.kind === 'material' && !opaque) throw new Error(`${artwork.key}: material must be fully opaque`)
    const bytes = encodePng(artwork.width, artwork.height, Uint8Array.from(pixels))
    await writeFile(new URL(`${artwork.key}.png`, publicRoot), bytes)
    const { art, width, height, ...metadata } = artwork
    manifest.assets.push({ ...metadata, file: `${artwork.key}.png`, sourceFile: `${artwork.key}.svg`, pixelWidth: width, pixelHeight: height, sha256: hash(bytes), sourceSha256: hash(art), sizeBytes: bytes.length, alphaContentBoundsPx: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, minTransparentPaddingPx: artwork.kind === 'prop' ? padding : null, fullyOpaque: opaque })
    previews.push({ key: artwork.key, name: artwork.name, topic: artwork.topic, width, height, png: bytes.toString('base64') })
  }
  const license = await readFile(new URL('LICENSE', root), 'utf8')
  for (const dir of [sourceRoot, publicRoot]) { await writeFile(new URL('LICENSE.txt', dir), license); await writeFile(new URL('manifest.json', dir), JSON.stringify(manifest, null, 2) + '\n') }
  if (process.argv.includes('--preview')) {
    const oldImages = await Promise.all(manifest.assets.filter(a => a.refines).map(async a => ({ key: a.key, png: (await readFile(new URL(`public/assets/sceneweave-handdrawn-outdoor/${a.key.replace('refined-', '')}.png`, root))).toString('base64') })))
    const render = async (mode, width, height) => {
      const data = await page.evaluate(async ({ previews, oldImages, mode, width, height }) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })
        ctx.fillStyle = '#EEEADD'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#34483A'; ctx.font = 'bold 25px sans-serif'
        ctx.fillText(mode === 'comparison' ? '墨绘原野 · 原件 / 精修候选（物理数据保持）' : mode === 'tiles' ? '自然材质 · 3×3 重复检查' : '墨绘原野 · 墓园 / 火山 · P2 候选', 25, 39)
        const decoded = await Promise.all(previews.map(async item => { const image = new Image(); image.src = `data:image/png;base64,${item.png}`; await image.decode(); return { ...item, image } }))
        const olds = await Promise.all(oldImages.map(async item => { const image = new Image(); image.src = `data:image/png;base64,${item.png}`; await image.decode(); return { ...item, image } }))
        const items = mode === 'comparison' ? decoded.filter(i => i.topic === 'refined').flatMap(i => [{ ...i, image: olds.find(o => o.key === i.key).image, label: '原件' }, { ...i, label: '精修候选' }]) : mode === 'tiles' ? decoded.filter(i => ['moss-paver', 'grave-soil', 'basalt', 'volcanic-ash', 'lava', 'refined-grass', 'refined-rock', 'refined-sand'].includes(i.key)) : decoded.filter(i => i.topic !== 'refined')
        const cols = mode === 'comparison' ? 4 : mode === 'tiles' ? 4 : 5, cardW = width / cols, cardH = mode === 'comparison' ? 370 : mode === 'tiles' ? 360 : 390
        for (const [index, item] of items.entries()) {
          const x = index % cols * cardW + 12, y = Math.floor(index / cols) * cardH + 62, w = cardW - 24, h = cardH - 70
          for (let ty = 0; ty < h; ty += 14) for (let tx = 0; tx < w; tx += 14) { ctx.fillStyle = (Math.floor(tx / 14) + Math.floor(ty / 14)) % 2 ? '#D7DDCE' : '#E6E9DA'; ctx.fillRect(x + tx, y + ty, Math.min(14, w - tx), Math.min(14, h - ty)) }
          if (mode === 'tiles') { const tile = Math.floor(Math.min(w, h) / 3); for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) ctx.drawImage(item.image, Math.floor(x) + col * tile, Math.floor(y) + row * tile, tile, tile) }
          else { const scale = Math.min((w - 20) / item.width, (h - 20) / item.height); ctx.drawImage(item.image, x + (w - item.width * scale) / 2, y + (h - item.height * scale) / 2, item.width * scale, item.height * scale) }
          ctx.fillStyle = '#34483A'; ctx.font = '16px sans-serif'; ctx.fillText(`${item.name}${item.label ? ' · ' + item.label : ''}`, x + 3, y + h + 24); ctx.font = '12px monospace'; ctx.fillText(item.key, x + 3, y + h + 43)
        }
        return canvas.toDataURL('image/png').split(',')[1]
      }, { previews, oldImages, mode, width, height })
      await writeFile(new URL(`art-${mode}.png`, reviewRoot), Buffer.from(data, 'base64'))
    }
    await render('contact', 1600, 1650); await render('comparison', 1440, 1180); await render('tiles', 1440, 800)
  }
  await writeFile(new URL('art-statistics.json', reviewRoot), JSON.stringify({ node: process.version, chrome: browser.version(), assets: manifest.assets.map(({ key, sha256, sourceSha256, pixelWidth, pixelHeight, sizeBytes, alphaContentBoundsPx, minTransparentPaddingPx, fullyOpaque, refines }) => ({ key, sha256, sourceSha256, pixelWidth, pixelHeight, sizeBytes, alphaContentBoundsPx, minTransparentPaddingPx, fullyOpaque, refines })), pngTotalBytes: manifest.assets.reduce((sum, a) => sum + a.sizeBytes, 0), rgba8CalculatedBytes: manifest.assets.reduce((sum, a) => sum + a.pixelWidth * a.pixelHeight * 4, 0) }, null, 2) + '\n')
  process.stdout.write(`Wrote ${manifest.assets.length} SVG/PNG candidates; ${manifest.assets.reduce((n, a) => n + a.sizeBytes, 0)} actual PNG bytes.\n`)
} finally { await context.close(); await browser.close() }
