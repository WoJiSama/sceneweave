import { MARINE_DESIGNS } from '../assets/marine-collection.js'
import type { VisualSampleArt } from './sample-art.js'

const outline = '#334D50'
const path = (d: string, fill: string, stroke = outline, width = 3) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`
const fish = (x: number, y: number, scale: number, angle: number) => `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">${path('M0 -76Q-30 -39 -18 18L-35 48L0 35L34 48L17 18Q30 -37 0 -76Z', 'url(#silver)')}${path('M-10 -13L-31 9L-9 4M12 -12L30 11L10 3', '#91B4AC', '#536F71', 2)}${path('M0 -60Q-4 -18 0 29', 'none', '#DAE3CD', 2)}<circle cx="-9" cy="-46" r="2.6" fill="#263D43"/><circle cx="9" cy="-46" r="2.6" fill="#263D43"/></g>`
function drawing(key: string): string {
  if (key === 'silver-school') return [[160,180,.6,-24],[285,130,.72,-8],[390,232,.65,15],[225,300,.8,-10],[350,390,.58,-17],[125,413,.53,-28],[470,383,.52,8]].map(([x,y,s,a]) => fish(x,y,s,a)).join('')
  if (key === 'reef-shark') return path('M296 27Q238 54 250 179L111 313L251 286Q255 379 281 444L236 548L298 514L350 562L322 450Q349 372 347 278L497 325L350 180Q356 65 296 27Z','url(#shark)')
    + path('M297 46Q276 175 298 445M261 190Q279 202 286 222M340 190Q323 202 316 222','none','#93AFA6',4)
    + path('M300 196L276 291L312 262Z','#506F76','#38525B',2)
    + [146,158,170].map(y => path(`M254 ${y}l19 9M344 ${y}l-19 9`,'none','#3F6268',2)).join('')
    + '<ellipse cx="270" cy="91" rx="3" ry="5" fill="#1F333A"/><ellipse cx="326" cy="91" rx="3" ry="5" fill="#1F333A"/>'
  if (key === 'manta') return path('M274 106Q267 65 248 71L243 136Q203 152 159 177L29 231Q119 289 210 302Q263 317 292 349L305 568L317 349Q341 315 398 303Q484 293 574 227L444 178Q401 149 359 136L355 72Q333 62 329 106Z','url(#shark)')
    + path('M74 230Q183 221 269 156M528 228Q422 218 333 157M295 128Q285 240 304 338','none','#9FB5A7',4)
    + '<ellipse cx="275" cy="135" rx="5" ry="3" fill="#243B40"/><ellipse cx="331" cy="135" rx="5" ry="3" fill="#243B40"/>'
    + Array.from({length:24},(_,i)=>`<circle cx="${190+i%6*43}" cy="${190+Math.floor(i/6)*22}" r="${2+i%3}" fill="#C2C7AA" opacity=".3"/>`).join('')
  if (key === 'dolphin') return path('M298 34L281 79Q248 111 263 208L188 294L266 270Q270 355 289 433L225 527Q271 536 303 493Q338 535 387 520L321 431Q337 349 335 268L417 303L338 206Q350 111 318 79Z','url(#silver)')
    + path('M300 108Q287 257 305 442M304 207L281 276L318 258Z','#718E91','#405D66',2)
    + '<circle cx="278" cy="112" r="3" fill="#243D42"/><circle cx="327" cy="112" r="3" fill="#243D42"/>'
  if (key === 'kraken') {
    const arms = ['M259 240C176 238 56 198 58 116C60 61 107 65 110 96C112 117 86 127 83 106', 'M244 276C150 254 49 292 49 358C50 410 99 422 113 393C123 372 105 355 91 364', 'M253 312C181 343 124 434 155 498C180 545 221 516 211 492C204 474 182 480 184 493', 'M280 329C253 407 237 524 284 557C317 582 349 555 331 532C321 519 300 527 309 540', 'M325 329C353 424 359 514 414 524C457 534 476 500 453 482C438 470 420 487 435 495', 'M346 296C418 335 517 377 545 326C568 284 535 257 511 276C494 291 511 313 522 301', 'M346 264C443 263 531 216 538 150C543 104 504 84 485 111C471 131 490 151 503 134', 'M323 242C379 186 435 137 419 80C406 40 372 39 359 67C349 91 371 109 384 91']
    return arms.map((d,i)=>path(d,'none',i%2?'#526F65':'#6D8978',29)+path(d,'none','#B0B59B',9)).join('')
      + path('M301 91C224 90 223 161 242 224Q234 275 261 309Q302 339 343 307Q371 270 354 222C376 145 357 90 301 91Z','url(#octopus)')
      + '<ellipse cx="258" cy="246" rx="14" ry="9" fill="#C9BB7F"/><ellipse cx="341" cy="246" rx="14" ry="9" fill="#C9BB7F"/><ellipse cx="258" cy="246" rx="4" ry="8" fill="#243F3D"/><ellipse cx="341" cy="246" rx="4" ry="8" fill="#243F3D"/>'
      + Array.from({length:20},(_,i)=>`<ellipse cx="${264+i%5*17}" cy="${132+Math.floor(i/5)*23}" rx="${3+i%3}" ry="${4+i%4}" fill="#C0BA90" opacity=".3"/>`).join('')
  }
  return path('M336 57C169 37 115 152 181 233C217 276 363 240 382 321C407 411 175 385 187 475C193 527 337 575 425 528C350 538 218 499 242 469C277 427 449 464 454 350C461 235 237 231 239 167C241 128 294 117 338 128L390 114L385 81Z','url(#serpent)')
    + path('M332 80C211 71 158 150 213 211C257 264 415 255 418 339C422 422 203 413 215 477Q229 521 357 539','none','#C3BE8A',7)
    + Array.from({length:16},(_,i)=>path(`M${224+i%4*18} ${143+Math.floor(i/4)*15}l8 6l9 -5`,'none','#334F4B',2)).join('')
    + '<ellipse cx="354" cy="83" rx="6" ry="5" fill="#E1C482"/><ellipse cx="354" cy="83" rx="2" ry="4" fill="#253D3A"/>'
}
const defs = '<defs><linearGradient id="silver"><stop offset="0" stop-color="#5E7E87"/><stop offset=".47" stop-color="#B7C6BA"/><stop offset="1" stop-color="#607E83"/></linearGradient><linearGradient id="shark"><stop offset="0" stop-color="#42636D"/><stop offset=".55" stop-color="#829C99"/><stop offset="1" stop-color="#4C6974"/></linearGradient><radialGradient id="octopus"><stop offset="0" stop-color="#9A9F78"/><stop offset=".65" stop-color="#7B8C6F"/><stop offset="1" stop-color="#506D63"/></radialGradient><linearGradient id="serpent"><stop offset="0" stop-color="#637F67"/><stop offset=".5" stop-color="#8D9A70"/><stop offset="1" stop-color="#3D645E"/></linearGradient></defs>'
export const MARINE_ART: readonly VisualSampleArt[] = Object.freeze(MARINE_DESIGNS.map(row => ({
  key: row.key, name: row.name, kind: 'prop' as const, widthMm: row.widthMm, heightMm: row.heightMm,
  sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">${defs}${drawing(row.key)}</svg>`,
  tags: ['海洋', '海洋生物', row.key === 'kraken' || row.key === 'sea-serpent' ? '海怪' : '海洋动物', row.era, 'marine', row.key], footprintMm: { width: Math.round(row.widthMm * .8), height: Math.round(row.heightMm * .8) },
  blocksMovement: false, blocksSight: false, renderLayer: 'object' as const, shadowClass: 'none' as const,
})))
export const MARINE_LICENSE_REF = 'sceneweave-marine-collection-v1'
export const MARINE_LICENSE = `Sceneweave Marine Collection v1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG artwork authored with coding assistance. No third-party artwork is embedded. Static scenery does not grant swimming, physical depth, buoyancy or creature simulation. Technical verification and user art acceptance are separate.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
