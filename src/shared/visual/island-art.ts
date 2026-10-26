import type { VisualSampleArt } from './sample-art.js'

/** Original, deterministic island artwork. No reference-map pixels or third-party assets are embedded. */
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`

function material(key: string, name: string, body: string, widthMm: number, heightMm: number, tags: string[]): VisualSampleArt {
  return { key: `island-${key}`, name, kind: 'material', sourceSvg: svg(body), widthMm, heightMm, tags }
}

function prop(
  key: string,
  name: string,
  body: string,
  widthMm: number,
  heightMm: number,
  tags: string[],
  details: Pick<VisualSampleArt, 'footprintMm' | 'blocksMovement' | 'blocksSight' | 'renderLayer' | 'shadowClass'>,
  transform?: string,
): VisualSampleArt {
  return { key: `island-${key}`, name, kind: 'prop', sourceSvg: svg(transform ? `<g transform="${transform}">${body}</g>` : body), widthMm, heightMm, tags, ...details }
}

const rockNorth = prop('rock-north-ridge', '北坡断层岩',
  '<path d="M45 305L67 216L121 168L145 103L224 71L283 98L337 76L409 120L465 194L447 267L478 316L429 382L344 401L276 448L192 421L119 439L61 383Z" fill="#898373" stroke="#4D5147" stroke-width="6" stroke-linejoin="round"/><path d="M67 216L145 237L224 71L252 202L337 76L326 238L409 120L389 269L465 194L447 267L478 316L361 336L276 448L252 326L192 421L205 319L119 439L141 324L45 305Z" fill="#A19A83" stroke="#737866" stroke-width="3.5" stroke-linejoin="round"/><path d="M145 237L252 202L326 238L389 269L361 336L252 326L205 319L141 324Z" fill="#7B7C6B" stroke="#5F6658" stroke-width="3"/><path d="M79 218L125 187L151 126L204 104M350 105L400 139L438 199M89 366L126 393L184 400M299 410L348 371L418 358" fill="none" stroke="#CDC3A3" stroke-width="7" stroke-linecap="round" opacity=".72"/><path d="M102 286L137 267L166 276L181 294L157 307L120 306ZM342 293L377 279L406 288L399 309L363 316ZM228 370L254 351L286 362L291 380L264 394L238 390Z" fill="#667C59" stroke="#4B604B" stroke-width="3"/><path d="M158 193L177 178L189 188L176 204M302 273L317 256L332 260L322 282M216 120L229 107L242 118" fill="none" stroke="#D0CBAA" stroke-width="3" stroke-linecap="round"/>',
  1950, 1550, ['岩块', '断层', '山脊', 'rock', 'ridge'],
  { footprintMm: { width: 1370, height: 1030 }, blocksMovement: true, blocksSight: false, renderLayer: 'object', shadowClass: 'furniture' })

const rockShelf = prop('rock-layered-shelf', '潮线层岩',
  '<path d="M52 331L78 253L113 228L120 167L169 127L210 143L249 99L309 120L338 105L384 146L435 156L463 221L447 281L474 329L432 374L370 382L327 427L260 408L208 439L159 402L94 401Z" fill="#8E8978" stroke="#50554A" stroke-width="6" stroke-linejoin="round"/><path d="M78 253L147 261L170 204L231 220L250 155L319 175L341 149L389 199L444 211L447 281L474 329L432 374L370 382L327 427L260 408L208 439L159 402L94 401L52 331Z" fill="#ABA18A" stroke="#777C6A" stroke-width="3.5" stroke-linejoin="round"/><path d="M55 330Q141 313 220 329T387 320Q435 319 470 333M91 368Q169 347 239 366T384 357Q425 354 448 365M126 395Q206 377 275 393T386 383" fill="none" stroke="#707462" stroke-width="13" stroke-linecap="round"/><path d="M85 319Q171 300 246 317T407 309M113 357Q194 336 269 354T414 342" fill="none" stroke="#D0C3A2" stroke-width="6" stroke-linecap="round" opacity=".78"/><path d="M148 226L171 171L208 158L228 177L213 228M283 200L307 151L337 140L363 164L350 210M371 260L395 227L426 238L423 267" fill="#B2A78B" stroke="#7B806C" stroke-width="3.5"/><path d="M172 283L201 273L217 281L204 294L178 299M311 288L339 273L357 280L344 297Z" fill="#667D59" stroke="#4A6049" stroke-width="3"/><path d="M102 277l20 -23M226 394l31 -25M385 228l22 -18" stroke="#D0C9A9" stroke-width="3.5" stroke-linecap="round"/>',
  2100, 1250, ['岩块', '层岩', '海蚀', 'rock', 'strata', 'shore'],
  { footprintMm: { width: 1530, height: 760 }, blocksMovement: true, blocksSight: false, renderLayer: 'object', shadowClass: 'furniture' })

const rockTidePool = prop('rock-tidepool', '浅洼潮池岩',
  '<path d="M54 284L79 207L132 159L202 136L238 94L313 111L353 98L412 147L455 212L439 275L467 326L428 381L355 395L299 429L232 412L172 438L111 400L63 350Z" fill="#858675" stroke="#50574B" stroke-width="6" stroke-linejoin="round"/><path d="M79 207L154 223L202 136L260 184L313 111L329 211L412 147L397 239L455 212L439 275L467 326L373 333L299 429L268 328L232 412L213 321L172 438L157 329L63 350L54 284Z" fill="#A19F87" stroke="#737B66" stroke-width="3.5" stroke-linejoin="round"/><path d="M154 223L260 184L329 211L397 239L373 333L268 328L213 321L157 329Z" fill="#797F6C" stroke="#606B58" stroke-width="3.5"/><path d="M235 250Q255 224 292 238Q321 249 313 278Q305 303 270 300Q235 299 225 278Q220 263 235 250Z" fill="#688D8A" stroke="#425C58" stroke-width="7"/><path d="M237 256Q265 239 294 250M239 273Q268 259 301 268" fill="none" stroke="#C1D0B6" stroke-width="3.5" stroke-linecap="round" opacity=".8"/><path d="M89 215L131 177L188 151M350 126L397 163L431 209M92 359L133 389L184 414M327 405L365 375L425 363" fill="none" stroke="#D1C6A5" stroke-width="7" stroke-linecap="round" opacity=".7"/><path d="M100 294L128 280L153 287L157 302L132 311L107 308M349 310L382 292L405 302L394 320L365 322" fill="#687D59" stroke="#4D624A" stroke-width="3"/>',
  1700, 1450, ['岩块', '潮池', '浅水', 'rock', 'tidepool', 'shore'],
  { footprintMm: { width: 1190, height: 980 }, blocksMovement: true, blocksSight: false, renderLayer: 'object', shadowClass: 'furniture' })

function fraction(seed: number, index: number): number {
  let value = Math.imul(seed + index * 137, 0x45d9f3b)
  value ^= value >>> 16
  return (Math.imul(value, 0x45d9f3b) >>> 0) / 4294967296
}
const round = (value: number) => Math.round(value * 10) / 10

/** A loose, uneven crown mass. Overlapping low-contrast masses reveal a top-down branch network. */
function crownMass(x: number, y: number, rx: number, ry: number, seed: number, fill: string): string {
  const points = Array.from({ length: 14 }, (_, i) => {
    const angle = i * Math.PI / 7, radius = .74 + fraction(seed, i) * .38
    return { x: x + Math.cos(angle) * rx * radius, y: y + Math.sin(angle) * ry * radius }
  })
  let outline = `M${round(points[0].x)} ${round(points[0].y)}`
  for (let i = 0; i < points.length; i++) {
    const before = points[(i + 13) % 14], current = points[i], next = points[(i + 1) % 14], after = points[(i + 2) % 14]
    outline += `C${round(current.x + (next.x - before.x) / 6)} ${round(current.y + (next.y - before.y) / 6)} ${round(next.x - (after.x - current.x) / 6)} ${round(next.y - (after.y - current.y) / 6)} ${round(next.x)} ${round(next.y)}`
  }
  let body = `<path d="${outline}Z" fill="${fill}" stroke="#52694B" stroke-width="1.4" stroke-linejoin="round"/>`
  for (let i = 0; i < 10; i++) {
    const angle = fraction(seed, 20 + i * 3) * Math.PI * 2, radius = Math.sqrt(fraction(seed, 21 + i * 3)) * .77
    const px = round(x + Math.cos(angle) * rx * radius), py = round(y + Math.sin(angle) * ry * radius)
    const length = round(7 + fraction(seed, 22 + i * 3) * 9)
    body += `<path d="M${px} ${py}q${round(-length * .15)} ${round(-length * .65)} ${length} ${round(-length * .45)}q${round(-length * .05)} ${round(length * .7)} ${-length} ${round(length * .45)}Z" fill="${i % 3 ? '#A1A97A' : '#4E684C'}" opacity="${i % 3 ? '.5' : '.4'}"/>`
  }
  return body
}

function canopy(key: string, name: string, widthMm: number, heightMm: number, clusters: readonly (readonly [number, number, number, number])[], seed: number, tags: string[]): VisualSampleArt {
  let body = '<path d="M233 270Q212 222 162 164M233 270Q295 210 357 166M233 270Q195 315 147 347M233 270Q301 304 371 342" fill="none" stroke="#5B6246" stroke-width="9" stroke-linecap="round"/>'
  const palette = ['#6A7C55', '#78855B', '#819064', '#5F7451', '#8C9767']
  for (const [i, [x, y, rx, ry]] of clusters.entries()) body += crownMass(x, y, rx, ry, seed + i * 19, palette[i % palette.length])
  body += '<path d="M233 270q-9 -22 -25 -32m25 32q21 -25 47 -35m-47 35q-14 19 -33 32m33 -32q23 18 46 23" fill="none" stroke="#63704D" stroke-width="4" stroke-linecap="round" opacity=".8"/>'
  return prop(key, name, body, widthMm, heightMm, tags,
    { footprintMm: { width: 520, height: 520 }, blocksMovement: true, blocksSight: true, renderLayer: 'canopy', shadowClass: 'vegetation' })
}

const treeNorth = canopy('tree-north-asym', '北坡偏冠古树', 2850, 2650, [
  [322, 370, 80, 72], [171, 356, 80, 67], [367, 280, 92, 80], [112, 257, 78, 77],
  [315, 168, 91, 83], [216, 111, 88, 76], [134, 168, 80, 72], [258, 294, 86, 71],
  [189, 242, 85, 79], [278, 216, 81, 79], [211, 167, 75, 74],
], 83, ['树', '古树', '偏冠', 'tree', 'canopy', 'vegetation'])

const treeWind = canopy('tree-windbent', '海风横冠树', 2950, 2450, [
  [368, 312, 87, 72], [259, 374, 83, 65], [132, 336, 75, 70], [419, 223, 64, 68],
  [337, 154, 91, 74], [227, 124, 79, 69], [122, 174, 81, 70], [74, 256, 48, 74],
  [318, 265, 89, 78], [184, 277, 89, 80], [237, 210, 84, 73],
], 197, ['树', '海风', '横冠', 'tree', 'wind', 'canopy', 'vegetation'])

const treeSplit = canopy('tree-split-crown', '双冠石缝树', 2750, 2700, [
  [355, 356, 79, 80], [236, 398, 80, 57], [123, 335, 75, 77], [403, 256, 55, 68],
  [338, 178, 79, 78], [227, 132, 70, 81], [130, 167, 70, 82], [80, 256, 53, 70],
  [175, 226, 80, 78], [304, 295, 77, 72], [282, 218, 66, 68],
], 317, ['树', '双冠', '石缝', 'tree', 'split crown', 'canopy', 'vegetation'])

const shrubHeath = prop('shrub-coastal-heath', '灰银海岸矮灌',
  [[137, 264, 82, 95], [226, 185, 84, 80], [350, 225, 93, 77], [327, 324, 101, 78], [203, 336, 80, 84], [244, 258, 84, 91]].map(([x, y, rx, ry], index) => crownMass(x, y, rx, ry, 421 + index * 13, ['#708060', '#84906B', '#78896B'][index % 3])).join(''),
  1350, 950, ['灌木', '海岸', '矮灌', 'shrub', 'heath', 'vegetation'],
  { footprintMm: { width: 530, height: 330 }, blocksMovement: false, blocksSight: false, renderLayer: 'object', shadowClass: 'vegetation' })

const shrubScree = prop('shrub-scree-sedge', '石隙苔草簇',
  '<path d="M100 344L135 318L177 329L184 360L154 379L119 367ZM326 333L361 305L402 320L413 351L378 373L340 364Z" fill="#93947E" stroke="#69745E" stroke-width="4" stroke-linejoin="round"/><path d="M135 322L170 334M361 311L395 325" fill="none" stroke="#C7BD9A" stroke-width="4" stroke-linecap="round"/>' +
  Array.from({ length: 19 }, (_, index) => {
    const x = 131 + index * 13 + fraction(452, index) * 14, y = 338 + fraction(453, index) * 42
    const topX = x - 45 + fraction(454, index) * 70, topY = 109 + fraction(455, index) * 123
    return `<path d="M${round(x)} ${round(y)}Q${round(x - 31)} ${round((y + topY) / 2)} ${round(topX)} ${round(topY)}Q${round(x + 9)} ${round((y + topY) / 2)} ${round(x + 8)} ${round(y + 2)}Z" fill="${['#718261', '#8F9A70', '#677C5C'][index % 3]}" stroke="#5C7154" stroke-width="2.5"/><path d="M${round(x + 4)} ${round(y - 8)}Q${round(x - 12)} ${round((y + topY) / 2)} ${round(topX + 2)} ${round(topY + 13)}" fill="none" stroke="#B0B58A" stroke-width="1.7" opacity=".7"/>`
  }).join(''),
  1150, 1000, ['灌木', '苔草', '石隙', 'shrub', 'sedge', 'scree', 'vegetation'],
  { footprintMm: { width: 460, height: 400 }, blocksMovement: false, blocksSight: false, renderLayer: 'object', shadowClass: 'vegetation' })

const screeScatter = prop('debris-scree', '浅灰碎石片',
  '<path d="M43 279L73 220L132 208L169 230L156 283L111 313L59 309Z" fill="#86877B" stroke="#4D5A50" stroke-width="8" stroke-linejoin="round"/><path d="M78 224L132 208L151 238L105 255Z" fill="#B3AE91" stroke="#667064" stroke-width="5"/><path d="M204 183L235 143L289 151L319 188L302 225L255 239L219 218Z" fill="#727B70" stroke="#46574C" stroke-width="7" stroke-linejoin="round"/><path d="M235 143L286 153L303 180L263 188Z" fill="#B8B394" stroke="#626C5E" stroke-width="4"/><path d="M336 287L362 251L405 253L452 286L433 326L381 337L348 319Z" fill="#919080" stroke="#566254" stroke-width="7" stroke-linejoin="round"/><path d="M363 254L402 255L436 281L393 291Z" fill="#C0B99A" stroke="#6A715F" stroke-width="4"/><path d="M172 347L189 324L218 327L230 350L209 368L181 365Z" fill="#667369" stroke="#44554B" stroke-width="6"/><path d="M90 271l30 -15M249 213l25 -20M387 316l26 -18" stroke="#D0C9AA" stroke-width="5" stroke-linecap="round"/>',
  1300, 760, ['碎石', '石片', '岩屑', 'scree', 'debris', 'rock'],
  { footprintMm: { width: 910, height: 420 }, blocksMovement: false, blocksSight: false, renderLayer: 'ground', shadowClass: 'none' }, 'translate(0 -185) scale(1 1.8)')

const driftwood = prop('debris-driftwood', '盐漂枯枝',
  '<path d="M48 339Q89 304 129 283L185 248L229 209L267 194L294 151L324 143L312 180L368 164L402 176L358 194L328 221L381 228L430 260L385 258L337 241L300 265L261 296L221 316L175 345L121 367L72 373Z" fill="#806B4E" stroke="#4D5040" stroke-width="12" stroke-linejoin="round"/><path d="M89 335Q146 298 198 268L245 228L278 216L306 173M250 264L299 249L340 209M200 287L205 322L180 348M306 224L348 229L385 250" fill="none" stroke="#B1986A" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M72 354Q129 329 178 309M235 244L271 231M320 190L357 181" fill="none" stroke="#D0B88A" stroke-width="5" stroke-linecap="round" opacity=".78"/><path d="M111 341l20 -16M184 291l18 -13M298 223l16 -13" stroke="#514E3E" stroke-width="5" stroke-linecap="round"/>',
  1650, 1050, ['枯枝', '漂木', '盐漂', 'driftwood', 'debris', 'shore'],
  { footprintMm: { width: 1260, height: 340 }, blocksMovement: false, blocksSight: false, renderLayer: 'ground', shadowClass: 'none' }, 'translate(0 -185) scale(1 1.6)')

function textureGrain(seed: number, count: number, colors: readonly string[], opacity = .26): string {
  return Array.from({ length: count }, (_, i) => {
    const x = round(fraction(seed, i * 3) * 512), y = round(fraction(seed, i * 3 + 1) * 512)
    const length = round(2 + fraction(seed, i * 3 + 2) * 7)
    return `<path d="M${x} ${y}l${length} ${round(-length * .3)}" stroke="${colors[i % colors.length]}" stroke-width="${i % 4 ? 1 : 1.8}" stroke-linecap="round" opacity="${opacity}"/>`
  }).join('')
}

const strata = material('material-strata', '暖灰层岩面',
  '<rect x="0" y="0" width="512" height="512" fill="#A29D86"/><path d="M42 112Q77 83 127 94L166 118L157 148L105 167L70 154ZM286 253Q327 225 369 242L404 274L391 304L344 319L307 299ZM84 400Q118 371 163 385L184 413L165 445L118 452L91 433Z" fill="#ACA58B" opacity=".52"/><path d="M-20 216Q39 202 79 214L104 238L150 231M281 77L316 91L344 78L383 96L422 89M252 382L295 365L329 381L368 375L395 394M53 64L77 89L69 120M184 175L207 194L192 222M414 296L400 329L419 350" fill="none" stroke="#727C6B" stroke-width="2.2" stroke-linecap="round" opacity=".5"/><path d="M-15 208L51 197L80 204M290 68L319 82L345 70M268 371L295 358L327 370" fill="none" stroke="#D0C3A0" stroke-width="2" stroke-linecap="round" opacity=".64"/>' + textureGrain(509, 210, ['#D4C9AA', '#707D6B', '#BEB397'], .28),
  2400, 2400, ['地表', '层岩', '断层', 'rock', 'strata', 'cliff'])

const moss = material('material-moss', '灰绿苔草地',
  '<rect x="0" y="0" width="512" height="512" fill="#7D886A"/><path d="M28 127Q52 80 101 99Q145 68 185 105Q221 141 181 182Q144 204 103 176Q62 196 32 166ZM292 305Q336 268 379 295Q430 276 468 313Q501 352 467 387Q431 410 392 380Q345 403 309 367Z" fill="#6D7C60" opacity=".5"/><path d="M66 355Q119 317 167 348Q214 327 248 369Q265 414 219 436Q174 458 143 425Q88 441 64 398ZM332 48Q367 24 403 49Q443 28 475 58L472 84Q442 108 408 87Q367 110 339 85Z" fill="#949A73" opacity=".44"/>' + textureGrain(617, 220, ['#B4B38B', '#5F7359', '#9EA77C'], .4) + '<path d="M108 244l14 -8 13 7-4 10-17 3ZM346 159l16 -8 12 6-3 10-18 4ZM423 468l11 -7 12 6-5 9-13 2Z" fill="#93917A" stroke="#6D775F" stroke-width="1.5" opacity=".6"/>',
  2500, 2500, ['地表', '苔草', '苔地', 'moss', 'grass', 'ground'])

const shallows = material('material-shallows', '浅湾玻璃水',
  '<rect x="0" y="0" width="512" height="512" fill="#6B9B95"/><path d="M0 84C42 76 85 76 128 84C170 92 213 92 256 84C298 76 341 76 384 84C426 92 469 92 512 84M0 152C42 144 85 144 128 152C170 160 213 160 256 152C298 144 341 144 384 152C426 160 469 160 512 152M0 275C42 267 85 267 128 275C170 283 213 283 256 275C298 267 341 267 384 275C426 283 469 283 512 275M0 411C42 403 85 403 128 411C170 419 213 419 256 411C298 403 341 403 384 411C426 419 469 419 512 411" fill="none" stroke="#9ABCB0" stroke-width="3" stroke-linecap="round" opacity=".34"/><path d="M22 104Q40 99 67 101M202 96Q224 90 245 94M364 163Q388 157 411 162M62 290Q87 283 108 288M259 282Q282 277 303 280M400 420Q425 413 448 418" fill="none" stroke="#D0D6B8" stroke-width="1.6" stroke-linecap="round" opacity=".54"/>' + textureGrain(719, 100, ['#B6CABA', '#4D817D'], .17),
  3200, 3200, ['地表', '浅水', '海湾', 'shallow water', 'water', 'shore'])

export const REFINED_ISLAND_ART: readonly VisualSampleArt[] = Object.freeze([
  rockNorth, rockShelf, rockTidePool,
  treeNorth, treeWind, treeSplit,
  shrubHeath, shrubScree,
  screeScatter, driftwood,
  strata, moss, shallows,
])

export const REFINED_ISLAND_LICENSE_ID = 'MIT' as const
export const REFINED_ISLAND_LICENSE = 'Sceneweave Refined Island Artwork, version 1\nCopyright (c) 2026 Sceneweave contributors\n\nOriginal deterministic SVG artwork for the M2-Q1 refined island asset batch, created for Sceneweave with coding assistance. No reference-map imagery or third-party assets are embedded.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
