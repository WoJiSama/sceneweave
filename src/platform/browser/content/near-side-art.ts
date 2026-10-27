import type { VisualSampleArt } from '../../../shared/visual/sample-art.js'
import type { FixedPresentation } from '../../../shared/terrain-generation/contracts.js'

/** New original side-elevation drawings. No old canopy image is rotated or repainted. */
export interface NearSideArt extends VisualSampleArt { presentation: FixedPresentation }
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
const outline = 'stroke="#354D3F" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"'
const twig = 'fill="none" stroke="#A3A77A" stroke-width="2.5" stroke-linecap="round" opacity="0.65"'
const bark = '<path d="M257 411l-4 -74M260 393l9 -28M247 424l-10 12M267 427l16 12" fill="none" stroke="#B49D6D" stroke-width="2.5" stroke-linecap="round"/>'
function foliageMarks(seed: number, rows: readonly (readonly [number, number, number, number])[]): string {
  return rows.map(([x,y,rx,ry],i) => `<path d="M${x-rx} ${y}q${rx*.5} ${-ry} ${rx} ${-ry*.2}q${rx*.4} ${-ry*.7} ${rx} ${ry*.1}" fill="none" stroke="${['#A3AE72','#B7B985','#70895F'][(i+seed)%3]}" stroke-width="${2.4 + (i % 2) * .6}" stroke-linecap="round" opacity="0.8"/><path d="M${x-rx*.4} ${y+ry}l${rx*.35} ${-ry*.3}m${rx*.5} ${ry*.1}l${rx*.3} ${-ry*.3}" stroke="#314C3D" stroke-width="1.6" opacity="0.45"/>`).join('')
}
function art(key: string, name: string, body: string, widthMm: number, heightMm: number, tree: boolean): NearSideArt {
  const rootY = tree ? 448 : 384
  const rootAnchorMm = { x: 0, y: Math.round((rootY / 512 - .5) * heightMm) }
  const scale = tree ? .8 : .5
  const artwork = tree ? `<g transform="translate(256 ${rootY}) scale(.9) translate(-256 ${-rootY})">${body}</g>` : body
  return { key, name, kind: 'prop', sourceSvg: svg(artwork), widthMm, heightMm,
    footprintMm: tree ? { width: 600, height: 600 } : { width: 1000, height: 750 },
    blocksMovement: true, blocksSight: tree, renderLayer: tree ? 'canopy' : 'object', shadowClass: tree ? 'vegetation' : 'furniture',
    tags: ['原创', '近侧视', tree ? '树木' : '岩石', tree ? 'tree' : 'rock', 'fixed-upright'],
    presentation: { mode: 'nearSide', rootAnchorMm, orientation: 'fixedUpright', fixedRotationDeg: 0, footprintAxes: 'world',
      groundShadowMm: [[-280,-180],[350,-650],[1450,-700],[2450,-200],[2650,150],[1700,650],[500,600],[-280,180]].map(([x,y])=>({x:Math.round(x*scale),y:Math.round(y*scale)})) } }
}

const oak = art('near-oak', '南望苔橡 · 近侧视',
  `<path d="M237 438q17 -35 9 -116l-25 -64 24 -10 20 60 28 -67 22 11 -37 90q-10 61 4 96l-25 10Z" fill="#766A4C" ${outline}/><path d="M229 438l28 7 29 -7M244 351l-35 -20M272 337l31 -26" fill="none" stroke="#46583F" stroke-width="5" stroke-linecap="round"/>${bark}
  <path d="M82 273Q48 256 65 220Q47 188 80 169Q71 132 112 124Q119 86 161 92Q182 55 223 73Q260 42 292 72Q337 63 352 99Q400 94 409 135Q452 151 436 192Q462 229 428 250Q427 293 385 297Q365 328 326 309Q283 337 252 315Q212 338 180 313Q137 326 119 299Q90 304 82 273Z" fill="#4F6F50" ${outline}/>
  <path d="M81 210Q88 180 113 181Q105 143 148 142Q148 108 184 116Q207 81 239 103Q270 72 300 101Q334 93 344 125Q383 112 391 151Q424 154 419 187Q395 202 370 188Q341 207 315 190Q284 212 255 191Q225 211 197 193Q166 211 141 193Q114 221 81 210Z" fill="#7D9462"/>
  <path d="M91 242q30 24 55 2q24 32 57 8q30 35 65 10q35 25 60 -2q34 15 65 -9q21 -6 36 -22q9 54 -39 61q-29 32 -67 11q-43 27 -72 6q-37 24 -73 -3q-40 17 -58 -10q-37 6 -29 -52Z" fill="#395C46"/>
  ${foliageMarks(1, [[145,161,30,18],[203,123,30,16],[277,121,32,17],[346,153,29,17],[111,223,26,17],[180,220,30,18],[251,208,32,19],[326,224,34,18],[385,208,23,16],[225,280,28,13],[301,282,26,13]])}<path d="M161 265q29 -24 62 -9M280 255q29 -16 56 2M191 171q29 -20 54 -8M299 167q25 -14 47 -3" ${twig}/>`, 3000, 3200, true)

const pine = art('near-pine', '分层矮松 · 近侧视',
  `<path d="M245 438l6 -132 -2 -71h13l4 76 4 127 -14 9Z" fill="#7C6B4C" ${outline}/>${bark}
  <path d="M256 52q-14 40 -50 82l21 1q-29 41 -77 69l38 1q-39 41 -91 68l51 6q-34 42 -77 70q39 14 78 0q35 22 70 7q40 26 78 4q45 21 77 -4q33 11 66 -5q-57 -36 -85 -74l38 -5q-53 -32 -87 -70l32 -2q-48 -27 -75 -64l20 -2q-33 -40 -27 -82Z" fill="#3D6851" ${outline}/>
  <path d="M254 79q-13 43 -46 69l24 1q-23 37 -59 57l29 4q-28 35 -65 60q33 7 64 -6q39 16 75 1q39 16 77 3q-46 -30 -77 -61l26 -2q-37 -26 -57 -59l15 1q-15 -32 -6 -68Z" fill="#749368"/>
  <path d="M152 293q36 15 61 -2q31 16 60 1q32 18 62 2M189 222q34 9 60 -6q27 12 54 4M221 155q18 7 36 0" fill="none" stroke="#A9B27C" stroke-width="4" stroke-linecap="round"/>
  <path d="M119 333l20 -10m11 20 18 -12m15 13 18 -11m25 16 19 -10m22 10 18 -12m28 10 19 -11m-167 -91 17 -11m25 10 16 -10m32 10 18 -11m29 9 16 -10m-97 -54 15 -10m27 11 15 -11" fill="none" stroke="#294D40" stroke-width="3" stroke-linecap="round"/>`, 2600, 3500, true)

const wind = art('near-windbent', '西倾风樟 · 近侧视',
  `<path d="M239 439q25 -55 4 -100q-20 -39 -58 -57l10 -24q45 18 69 61q23 44 15 89l9 30 -30 11Z" fill="#74674A" ${outline}/><path d="M254 390q-3 -39 -22 -64l-32 -31M257 424l-8 14M270 426l13 10" fill="none" stroke="#AD996B" stroke-width="4" stroke-linecap="round"/>
  <path d="M65 248q-27 -26 -5 -51q-14 -38 24 -51q5 -38 45 -34q24 -37 57 -14q29 -29 58 -8q41 -16 61 13q37 -5 55 26q42 1 49 37q39 16 24 48q17 38 -23 55q-17 37 -53 20q-26 28 -59 10q-34 24 -65 -1q-40 15 -67 -11q-43 9 -55 -25q-29 4 -46 -14Z" fill="#607A51" ${outline}/>
  <path d="M73 193q8 -32 44 -31q9 -32 40 -23q22 -27 53 -6q32 -23 60 -2q36 -8 55 20q37 -1 49 27q28 1 35 29q-29 13 -55 -6q-28 20 -55 2q-32 22 -63 1q-34 18 -63 -2q-34 16 -58 -4q-22 15 -42 -5Z" fill="#91A26A"/>
  <path d="M91 239q38 13 66 -3q30 25 61 5q33 23 69 5q34 13 59 -5q36 8 60 -16q17 39 -25 50q-31 29 -61 10q-40 27 -68 4q-37 15 -62 -9q-42 5 -58 -25q-23 1 -41 -16Z" fill="#3C5D42"/>
  ${foliageMarks(2, [[113,183,24,16],[173,151,28,14],[236,153,27,15],[298,175,29,14],[361,198,25,15],[163,226,29,14],[226,233,28,13],[291,245,27,13]])}<path d="M158 268q26 -19 61 -10M232 268q28 -17 57 -8" ${twig}/>`, 3200, 2900, true)

const ridge = art('near-ridge', '苔脊断岩 · 近侧视',
  `<path d="M73 298l47 -126 116 -61 131 46 77 118 -12 86 -119 53 -144 -16 -96 -46Z" fill="#777C69" stroke="#465649" stroke-width="6" stroke-linejoin="round"/><path d="M73 298l137 -38 88 34 146 -19 -12 86 -119 53 -144 -16 -96 -46Z" fill="#505E50"/><path d="M120 172l116 -61 131 46 -69 137 -88 -34Z" fill="#ACAF8D"/><path d="M120 172l90 88 -137 38M236 111l7 114 55 69M367 157l-19 76 96 42M210 260l-10 112M298 294l15 120" fill="none" stroke="#64715C" stroke-width="5"/><path d="M140 182l74 -39 31 4M251 156l48 16M96 302l33 -9M336 329l59 -16" fill="none" stroke="#D4CC9E" stroke-width="5" stroke-linecap="round"/><path d="M139 321q27 -17 48 0q15 13 40 -1M287 350q25 -16 51 -2" fill="none" stroke="#7D925C" stroke-width="11" stroke-linecap="round"/>`, 1800, 1500, false)

const shelf = art('near-shelf', '层理平岩 · 近侧视',
  `<path d="M54 267l65 -95 130 -42 147 35 64 104 -18 82 -95 44 -167 -8 -109 -52Z" fill="#969A80" stroke="#43594B" stroke-width="6" stroke-linejoin="round"/><path d="M54 267l151 37 137 -11 118 -24 -18 82 -95 44 -167 -8 -109 -52Z" fill="#63745F"/><path d="M119 172l130 -42 147 35 -54 128 -137 11 -151 -37Z" fill="#B8B696"/><path d="M71 298l133 37 141 -12 102 -29M80 325l123 36 143 -10 94 -25M120 173l85 131M249 130l-4 76 97 87M396 165l-85 57" fill="none" stroke="#4C6654" stroke-width="4"/><path d="M137 184l82 -25 59 11M93 257l86 22M260 276l58 -6" fill="none" stroke="#E0D8AC" stroke-width="5" stroke-linecap="round"/><path d="M107 293l49 13M297 337l42 -4" stroke="#82975E" stroke-width="12" stroke-linecap="round"/>`, 1900, 1300, false)

const round = art('near-rounded', '海磨圆岩 · 近侧视',
  `<path d="M92 300q-13 -94 71 -140q90 -56 178 -5q85 38 83 132q13 81 -85 111q-96 31 -191 -8q-62 -21 -56 -90Z" fill="#929B85" stroke="#425B4D" stroke-width="6"/><path d="M95 290q65 45 167 32q103 -10 158 -46q18 91 -84 121q-97 30 -188 -8q-62 -21 -53 -99Z" fill="#5B7362"/><path d="M129 248q9 -77 91 -86q94 -20 150 50q-83 -27 -144 -3q-64 19 -97 39Z" fill="#C0C0A0"/><path d="M270 166q-29 50 -4 90l-18 53M144 285q38 -14 75 -7M292 344q39 -2 72 -20" fill="none" stroke="#687D65" stroke-width="5" stroke-linecap="round"/><path d="M135 317q17 -14 36 -4q17 14 34 0M313 286q23 -17 40 -5" fill="none" stroke="#90A16B" stroke-width="12" stroke-linecap="round"/><path d="M174 198q32 -18 66 -14" fill="none" stroke="#E0DAB2" stroke-width="5" stroke-linecap="round"/>`, 1600, 1450, false)

export const NEAR_SIDE_ART: readonly NearSideArt[] = [oak, pine, wind, ridge, shelf, round]
export const NEAR_SIDE_LICENSE = `Sceneweave T4 original fixed near-side artwork, version 1 (2026-10-27).
Copyright (c) 2026 Sceneweave contributors.
The six new SVG drawings depict upright trunks, distinct crowns and exposed rock sides. They do not derive from rotated top-down artwork or embed reference-map pixels. Original SVG, normalized SVG and actual PNG are retained together.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
