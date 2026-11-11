import type { VisualSampleArt } from './sample-art.js'

// New fixed source batch. v1 remains separately available; no old source or
// physical footprint is rewritten. All pigment is native static SVG geometry.
const n = (x: number) => Math.round(x * 10) / 10
const repeat = (count: number, draw: (i: number) => string) => Array.from({ length: count }, (_, i) => draw(i)).join('')
function noise(seed: number, i: number): number {
  let x = Math.imul(seed + i * 827, 0x45d9f3b)
  x ^= x >>> 16
  return (Math.imul(x, 0x45d9f3b) >>> 0) / 0x100000000
}
const path = (d: string, fill: string, opacity = 1, stroke = 'none', width = 1) =>
  `<path d="${d}" fill="${fill}" opacity="${opacity}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, opacity = 1, angle = 0) =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" opacity="${opacity}" transform="rotate(${n(angle)} ${n(x)} ${n(y)})"/>`
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`

function contour(x: number, y: number, rx: number, ry: number, seed: number, lobes = 14): string {
  const points = Array.from({ length: lobes }, (_, i) => {
    const a = i * Math.PI * 2 / lobes, r = .78 + noise(seed, i) * .24
    return [x + Math.cos(a) * rx * r, y + Math.sin(a) * ry * r]
  })
  const mid = (i: number) => {
    const a = points[i % lobes], b = points[(i + 1) % lobes]
    return `${n((a[0] + b[0]) / 2)} ${n((a[1] + b[1]) / 2)}`
  }
  return `M${mid(lobes - 1)}` + points.map((p, i) => `Q${n(p[0])} ${n(p[1])} ${mid(i)}`).join('') + 'Z'
}
function wash(x: number, y: number, rx: number, ry: number, color: string, seed: number, opacity = 1): string {
  return path(contour(x, y, rx, ry, seed), color, opacity * .18)
    + path(contour(x, y, rx * .97, ry * .96, seed + 91), color, opacity * .29)
    + path(contour(x, y, rx * .92, ry * .91, seed + 3), color, opacity * .65)
}

function canopy(seed: number, willow = false, shrub = false): string {
  const colors = willow ? ['#50785C', '#78916B', '#A8AD79', '#C9C994'] : ['#3F6856', '#678664', '#94A578', '#BDC293']
  let body = wash(253, 258, 205, 201, colors[0], seed, .91)
  body += repeat(shrub ? 11 : 19, i => {
    const a = i * 2.399, r = Math.sqrt(noise(seed, i + 61)) * 156
    const x = 255 + Math.cos(a) * r, y = 251 + Math.sin(a) * r
    return wash(x, y, 42 + noise(seed, i + 31) * 47, 36 + noise(seed, i + 41) * 43,
      colors[(i % 3) + 1], seed + i * 23, .62)
  })
  // Small broken leaf strokes suggest pigment granulation rather than a thick
  // common outline around every crown. The cast shadow remains renderer-owned.
  body += repeat(willow ? 100 : 160, i => {
    const a = i * 2.399, r = Math.sqrt(noise(seed, i + 172)) * 177
    const x = 253 + Math.cos(a) * r, y = 253 + Math.sin(a) * r
    return ellipse(x, y, willow ? 2 : 3 + noise(seed, i + 211) * 4,
      willow ? 10 + noise(seed, i + 93) * 9 : 2 + noise(seed, i + 52) * 3,
      colors[i % 4], .22 + noise(seed, i + 4) * .2, willow ? 35 + i * 7 : i * 31)
  })
  return body
}
function pine(): string {
  let body = ''
  for (let ring = 0; ring < 5; ring++) {
    body += repeat(11, i => {
      const a = i * Math.PI * 2 / 11 + ring * .47 + noise(131 + ring, i) * .17
      const r = (211 - ring * 30) * (.77 + noise(311 + ring, i) * .23)
      const x = 254 + Math.cos(a) * r, y = 255 + Math.sin(a) * r
      const left = a - .19, right = a + .19
      return path(`M244 265Q${n(254 + Math.cos(left) * r * .7)} ${n(255 + Math.sin(left) * r * .7)} ${n(x)} ${n(y)}Q${n(254 + Math.cos(right) * r * .72)} ${n(255 + Math.sin(right) * r * .72)} 264 245Z`,
        ['#315F53', '#487561', '#648B6D', '#89A17D', '#B1BB8E'][ring], .68)
        + path(`M254 255L${n(x - Math.cos(a) * 10)} ${n(y - Math.sin(a) * 10)}`, 'none', .28, '#C0C69C', 1.7)
    })
  }
  return body
}
function fern(): string {
  return repeat(9, i => {
    const a = i * .77, length = 125 + noise(79, i) * 78
    return `<g transform="translate(256 256) rotate(${n(a * 180 / Math.PI)})">`
      + path(`M0 0Q-14 ${n(-length * .55)} 0 ${n(-length)}`, 'none', .9, '#668365', 3)
      + repeat(7, j => {
        const y = -18 - j * length / 8, w = (7 - j) * 6
        return path(`M0 ${n(y)}Q${n(-w)} ${n(y + 1)} ${n(-w * 1.2)} ${n(y - 16)}Q-5 ${n(y - 14)} 0 ${n(y - 3)}Q${n(w)} ${n(y - 10)} ${n(w * 1.3)} ${n(y - 24)}Q5 ${n(y - 17)} 0 ${n(y)}Z`,
          j % 2 ? '#87A379' : '#587D5C', .79)
      }) + '</g>'
  })
}

// Wrap every mark on both axes. Low contrast irregular washes replace the
// repeated rows of waves and moss disks; every material is fully opaque.
function tile(key: string, base: string, colors: string[], seed: number): string {
  const wrap = (x: number, y: number, rx: number, ry: number, draw: (x: number, y: number) => string) =>
    [-512, 0, 512].map(dx => [-512, 0, 512].map(dy => x + dx + rx < 0 || x + dx - rx > 512
      || y + dy + ry < 0 || y + dy - ry > 512 ? '' : draw(x + dx, y + dy)).join('')).join('')
  const marks = repeat(24, i => {
    const x = n(noise(seed, i * 2) * 512), y = n(noise(seed, i * 2 + 1) * 512)
    if (key === 'river-water') return wrap(x, y, 100, 8, (x, y) => path(`M${n(x)} ${n(y)}q${n(12 + noise(seed, i + 200) * 44)} -3 ${n(27 + noise(seed, i + 400) * 67)} -1`, 'none', .22, colors[i % colors.length], 1.4 + noise(seed, i + 100) * 3))
    const rx = 13 + noise(seed, i + 100) * 47, ry = 8 + noise(seed, i + 200) * 36
    return wrap(x, y, rx, ry, (x, y) => path(contour(x, y, rx, ry, seed + i), colors[i % colors.length], .025 + noise(seed, i + 300) * .035))
  })
  const fine = repeat(135, i => {
    const x = n(noise(seed + 9, i * 2) * 512), y = n(noise(seed + 9, i * 2 + 1) * 512)
    return wrap(x, y, 4, 4, (x, y) => ellipse(x, y, .8 + noise(seed, i + 111) * 2.8, .6 + noise(seed, i + 222) * 1.8, colors[i % colors.length], .16, i * 37))
  })
  let body = `<rect x="0" y="0" width="512" height="512" fill="${base}"/>`
  body += marks + fine
  return body
}
function wood(): string {
  return '<rect x="0" y="0" width="512" height="512" fill="#A18C6D"/>' + repeat(8, i => {
    const y = i * 64
    return path(`M0 ${y}H512M${i % 2 ? 155 : 389} ${y}v64`, 'none', .6, '#6C6652', 3)
      + path(`M0 ${y + 16}q62 -4 128 0t128 0t128 0t128 0M0 ${y + 42}q68 4 128 0t128 0t128 0t128 0`, 'none', .35, '#D2BD95', 2)
  })
}
function stone(seed = 13): string {
  return wash(256, 257, 233, 216, '#7D8A7C', seed)
    + path('M84 232L151 119L289 86L411 193L368 325L246 420L118 350Z', '#A8AE98', .85)
    + path('M151 119L223 234L289 86M223 234L118 350M223 234L368 325', 'none', .7, '#728376', 3)
    + wash(162, 156, 73, 42, '#D1D1AE', 33, .6)
    + wash(312, 348, 80, 41, '#798C5D', 44, .8)
    + repeat(45, i => ellipse(127 + noise(91, i) * 250, 157 + noise(31, i) * 181, 1.4, 1, '#596D60', .25))
}
function log(): string {
  return path('M58 202Q118 175 176 198L414 180L455 211L446 305L407 329L76 321L46 281Z', '#81755D', .95)
    + path('M115 201L167 134L188 133L166 202M322 319L345 385L363 392L353 318', '#81755D', .9)
    + path('M120 222Q244 229 416 209M123 254Q252 272 420 249M119 283Q268 301 415 284', 'none', .62, '#C3AE85', 5)
    + ellipse(90, 262, 37, 61, '#BBAA83') + ellipse(90, 262, 24, 45, '#8E8268', .7)
    + ellipse(90, 262, 15, 32, '#BDAC86', .9) + wash(332, 220, 51, 18, '#71815B', 15, .7)
}
function tent(torn = false): string {
  const body = path('M81 88L429 86L432 426L80 429Z', torn ? '#ACA183' : '#BBB28E', .95, '#736F56', 2)
    + path('M81 88L255 72L258 440L80 429Z', '#D4C9A4', .92)
    + path('M255 72L429 86L432 426L258 440Z', torn ? '#A2987D' : '#B4AD87', .92)
    + path('M255 73L258 439M87 98L252 85L421 97M88 417L255 429L422 414', 'none', .65, '#736B52', 2.5)
    + path('M81 88L47 48M429 86L468 48M80 429L43 468M432 426L470 468', 'none', .75, '#80785B', 2.5)
    + path('M255 73L254 42M258 440L258 477', 'none', .7, '#80785B', 2.5)
    + path('M102 121L232 104M104 255L238 251M101 392L238 412M280 109L408 125M278 258L410 262M280 409L409 389', 'none', .3, '#E0D4AE', 2)
  return body + (torn ? path('M135 174L176 201L145 232L190 264L139 294L111 246Z', '#626D58', .9)
    + path('M315 121L337 171L310 227L346 258L315 293', 'none', .8, '#655F4E', 8)
    + path('M322 126L348 170L325 205L367 199L350 135Z', '#D8CBA5', .9) : '')
}
function fire(): string {
  let body = wash(256, 257, 171, 158, '#7D7965', 17, .7)
  body += repeat(11, i => {
    const a = i * Math.PI * 2 / 11, r = 149 + noise(55, i) * 14
    return wash(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 32, 27,
      i % 2 ? '#909883' : '#AFB09A', 29 + i)
  })
  return body + path('M173 179L321 333M164 306L339 202M225 158L284 342', 'none', .8, '#5F6355', 23)
    + path('M174 181L318 330M165 304L337 203', 'none', .6, '#9D9378', 4)
    + repeat(35, i => ellipse(184 + noise(37, i) * 135, 185 + noise(11, i) * 137, 3, 2, '#C5C2AD', .5, i * 41))
}
function cloth(): string {
  return path('M128 44Q255 28 378 54L398 459Q253 482 111 452Z', '#87967B', .95, '#5F715C', 3)
    + path('M140 77Q255 59 366 84L379 430Q261 451 133 424Z', '#A9B18C', .9)
    + path('M143 82Q253 51 364 87L370 152Q250 129 137 151Z', '#C1C4A0', .9)
    + path('M159 58L151 445M345 57L359 448', 'none', .8, '#6E7A5E', 12)
    + path('M176 192Q252 211 331 193M167 352Q254 372 343 351', 'none', .35, '#D8D3AE', 4)
}
function sack(): string {
  return path('M126 98Q260 51 380 109L414 421Q258 465 100 411Z', '#859273', .96, '#5A6B55', 3)
    + path('M136 120Q252 78 371 130L364 231Q250 255 140 225Z', '#A9AC85', .95)
    + path('M147 286Q258 264 371 291L376 403Q260 427 142 398Z', '#9AA17E', .95)
    + path('M196 106L189 237M317 108L324 235M219 82V58H290V83', 'none', .85, '#606F56', 11)
}

function extra(key: string, name: string, body: string, width: number, height: number,
  footprint: [number, number], tags: string[], blocks = true): VisualSampleArt {
  return { key, name, kind: 'prop', sourceSvg: svg(body), widthMm: width, heightMm: height,
    footprintMm: { width: footprint[0], height: footprint[1] }, blocksMovement: blocks, blocksSight: false,
    renderLayer: blocks ? 'object' : 'ground', shadowClass: blocks ? 'furniture' : 'none',
    tags: ['主题艺术候选', 'wilderness', '自然水彩', ...tags] }
}

export function createWildernessArtV2(legacy: readonly VisualSampleArt[]): VisualSampleArt[] {
  const bodies: Record<string, string> = {
    'meadow-grass': tile('meadow-grass', '#AAB18B', ['#738A69', '#C9C7A0', '#899776'], 501),
    'forest-loam': tile('forest-loam', '#A69D7F', ['#7B8065', '#C3B291', '#8B8065'], 502),
    'river-water': tile('river-water', '#799F9A', ['#C4D3BB', '#9BB7AB', '#5E8786'], 503),
    'river-gravel': tile('river-gravel', '#B6B39A', ['#828F83', '#D1C7AA', '#949C8A'], 504),
    'hill-rock': tile('hill-rock', '#ACAF9A', ['#7F8E80', '#D0CBB0', '#939F8B'], 505),
    'forest-moss': tile('forest-moss', '#91A17B', ['#6E8763', '#BFBE95', '#81966F'], 506),
    'broadleaf-tree': canopy(514), 'pine-tree': pine(),
    'dead-tree': path('M238 455L247 281L158 190L111 68L137 61L183 164L241 208L230 66L256 50L269 223L341 151L400 68L420 85L364 180L285 268L326 348L413 377L405 399L306 371L268 302L272 456Z', '#8C8268', .95)
      + path('M174 172L85 192L76 212M269 235L337 241L400 224M252 287L164 332L136 401M246 199L195 104', 'none', .7, '#B8AB87', 4),
    'river-willow': canopy(519, true), 'low-shrub': canopy(525, false, true), 'fern': fern(),
    'flower-patch': repeat(23, i => {
      const x = 95 + noise(534, i * 2) * 320, y = 82 + noise(534, i * 2 + 1) * 332
      return path(`M${n(x - 10)} ${n(y + 18)}l10 -18 12 12`, 'none', .6, '#70866A', 2)
        + ellipse(x, y, 5, 4, i % 3 ? '#D9CCA9' : '#B99DA5', .9, i * 67)
    }),
    'grass-tuft': repeat(19, i => {
      const a = i * 2.399, r = 115 + noise(71, i) * 95
      return path(`M248 270Q${n(256 + Math.cos(a - .3) * r * .7)} ${n(256 + Math.sin(a - .3) * r * .7)} ${n(256 + Math.cos(a) * r)} ${n(256 + Math.sin(a) * r)}`, 'none', .7, i % 2 ? '#77916C' : '#AFBB8C', 4)
    }),
    'boulder': stone(), 'fallen-log': log(), 'canvas-tent': tent(), 'cold-campfire': fire(), 'bedroll': cloth(), 'rucksack': sack(),
  }
  const revised = legacy.map(art => ({ ...art, sourceSvg: svg(bodies[art.key]),
    tags: [...(art.tags ?? []), '自然水彩', '固定源v2'] }))
  const boards: VisualSampleArt = { key: 'weathered-boards', name: '灰褐旧木板', kind: 'material', sourceSvg: svg(wood()),
    widthMm: 2400, heightMm: 2400, tags: ['主题艺术候选', 'wilderness', '木地板', '哨站', '自然水彩'] }
  return [...revised, boards,
    extra('torn-tent', '破损塌帆废弃营帐', tent(true), 3000, 3000, [2500, 2350], ['废弃', '帐篷', '非可进入建筑']),
    extra('scattered-gear', '遗弃布片与散落器具', path('M79 136L247 90L282 267L121 301Z', '#A3A68A', .85)
      + path('M237 285L369 223L435 381L304 430Z', '#B4A284', .9)
      + ellipse(354, 146, 43, 33, '#8D9887') + ellipse(354, 146, 30, 23, '#626F61')
      + path('M97 362L226 401M127 346L205 417', 'none', .8, '#82745B', 12), 1800, 1500, [1100, 850], ['废弃', '生活痕迹'], false),
    extra('watch-table', '哨站记录木桌俯视', path('M48 78L464 78L462 432L50 432Z', '#927C5F', 1, '#6A644F', 3)
      + path('M58 90H450V419H62Z', '#B4A07B', .9)
      + path('M58 167H452M58 255H452M58 343H452', 'none', .6, '#837758', 3)
      + path('M90 103L272 119L264 302L79 282Z', '#DBD0A8', .94)
      + path('M108 146L232 161M102 180L249 193M96 224L217 234', 'none', .5, '#8A9474', 3), 1800, 950, [1650, 800], ['桌子', '哨站', '记录']),
    extra('supply-crate', '木条补给箱俯视', path('M69 71L441 73L438 441L71 438Z', '#A08C68', 1, '#6A664E', 4)
      + path('M137 82V428M214 82V429M294 82V429M374 82V429', 'none', .75, '#776E51', 4)
      + path('M83 93L423 417M423 93L85 418', 'none', .9, '#C1AB80', 26)
      + path('M85 95L421 415M421 95L87 416', 'none', .6, '#8E7C5C', 2), 1000, 850, [900, 750], ['储物', '哨站', '补给']),
    extra('field-cot', '哨站窄铺俯视', path('M117 38H395V474H117Z', '#81755A', 1, '#665F4B', 4)
      + path('M132 57H380V452H132Z', '#A4AE8D')
      + path('M143 70Q253 53 369 73L365 155Q253 140 143 158Z', '#CCCAA7')
      + path('M139 204H374V441H139Z', '#879C7F', .9)
      + path('M145 223Q251 245 367 222M146 388Q253 409 365 388', 'none', .5, '#B5BF96', 4), 1000, 2100, [850, 1950], ['床', '哨站', '休息']),
    extra('map-roll', '卷边地图与炭笔俯视', path('M70 109L421 85L440 403L89 425Z', '#DAD0AC', .98, '#A79D7B', 2)
      + path('M92 150Q195 126 247 206T410 265M126 344L206 270L261 327L345 306', 'none', .8, '#8B9B80', 5)
      + path('M70 109Q41 128 70 156L89 425Q64 403 104 391M421 85Q448 101 422 135', 'none', .85, '#B5A883', 11)
      + path('M303 352L394 388', 'none', .9, '#645F4E', 9), 600, 550, [350, 300], ['哨站', '地图', '细节'], false),
    extra('trail-sign', '木制路标俯视', path('M223 55H282V459H223Z', '#8F7D5D', 1, '#6B654E', 3)
      + path('M78 129H358L437 193L358 253H78Z', '#B5A27C', 1, '#746C50', 3)
      + path('M104 155H346M102 218H343', 'none', .6, '#D4BD91', 4), 650, 650, [300, 300], ['道路', '路标', '哨站']),
  ]
}
