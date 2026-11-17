import { TRADE_DESIGNS, type TradeDesign } from '../assets/trade-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'
const ink = '#433F33', gold = '#BAA575', iron = '#68716B', bone = '#C7BCA0'
const repeat = (n: number, draw: (i: number) => string) => Array.from({ length: n }, (_, i) => draw(i)).join('')
const path = (d: string, fill = 'none', stroke = ink, sw = 3) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0, stroke = ink, sw = 3) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const oval = (x: number, y: number, rx: number, ry: number, fill: string, stroke = ink, sw = 3) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const fill = 'url(#wood)', stone = 'url(#stone)', cloth = 'url(#cloth)'
const bar = (d: string, color = iron, width = 12) => path(d, 'none', ink, width + 4) + path(d, 'none', color, width) + path(d, 'none', '#D2C7A9', 1)
const rivet = (x: number, y: number) => oval(x, y, 4, 4, gold, ink, 1) + path(`M${x - 1} ${y - 2}h2`, 'none', '#E5D5AF', 1)
const bolts = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => rivet(a, b)).join('')
const grain = (x: number, y: number, w: number, h: number, n = 10) => `<g opacity=".38">${repeat(n, i => path(`M${x} ${y + h * (i + 1) / (n + 1)}q${w * .26} ${(i % 3) * 2 - 2} ${w * .5} 0t${w * .5} 0`, 'none', i % 3 ? '#D7C49D' : '#5A4E38', 1))}</g>`
const slab = (x: number, y: number, w: number, h: number, r = 6) => rect(x, y, w, h, fill, r) + rect(x + 9, y + 9, w - 18, h - 18, 'none', r, '#C4AF86', 2) + grain(x + 17, y + 18, w - 34, h - 36)
const grid = (x: number, y: number, w: number, h: number, step = 16) => `<g opacity=".55">${path(repeat(Math.floor(w / step), i => `M${x + step * (i + 1)} ${y}v${h} `) + repeat(Math.floor(h / step), i => `M${x} ${y + step * (i + 1)}h${w} `), 'none', '#B4B9A7', 1.2)}</g>`
const ovalWeave = (cx:number,cy:number,rx:number,ry:number) => path(repeat(31,n=>{const dx=(n-15)*rx/16,dy=ry*Math.sqrt(1-(dx/rx)**2);return `M${cx+dx} ${cy-dy}v${dy*2} `})+repeat(23,n=>{const dy=(n-11)*ry/12,dx=rx*Math.sqrt(1-(dy/ry)**2);return `M${cx-dx} ${cy+dy}h${dx*2} `}),'none','#C5B992',1.3)
const star = (cx: number, cy: number, r: number, count: number, fillColor: string) => path(repeat(count, i => {
  const a = i * 2 * Math.PI / count, b = a + Math.PI / count
  return `${i ? 'L' : 'M'}${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}L${cx + r * .8 * Math.cos(b)} ${cy + r * .8 * Math.sin(b)}`
}) + 'Z', fillColor)
const legs = (x = 64, y = 82, w = 472, h = 316, color = fill) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => rect(a - 18, b - 18, 36, 36, color, 4) + rivet(a, b)).join('')

function shelf(i: number): string {
  switch (i) {
    case 0: return legs() + slab(70, 90, 460, 300) + path('M82 190h436M82 290h436', 'none', '#68573D', 5) + bar('M50 120v240M550 120v240', fill, 15)
    case 1: return slab(72, 105, 456, 270) + [109, 350].map(y => rect(48, y, 504, 21, '#786240', 3) + rect(32, y - 6, 30, 33, '#9F8357', 3) + rect(538, y - 6, 30, 33, '#9F8357', 3)).join('') + path('M89 236h422', 'none', '#685B40', 5)
    case 2: return bar('M63 65L115 415M537 65L485 415', fill, 21) + slab(78, 118, 444, 250) + bar('M55 72h490M97 413h406', fill, 14) + bolts(76, 98, 448, 285)
    case 3: return path('M65 62H534V200H207V418H65Z', fill) + path('M83 80H516V180H188V400H83Z', 'none', '#CBB58C', 3) + grain(95, 100, 398, 61, 4) + bar('M135 197v186', fill, 9) + [[80,80],[518,80],[80,400],[190,190]].map(([x,y]) => rect(x-13,y-13,26,26,fill,3)+rivet(x,y)).join('')
    case 4: return oval(300, 240, 218, 188, fill) + repeat(8, n => { const a = n * Math.PI / 4; return bar(`M300 240L${300 + 198 * Math.cos(a)} ${240 + 167 * Math.sin(a)}`, '#8C7852', 11) }) + oval(300, 240, 35, 35, fill, gold, 5)
    case 5: return bar('M73 58v358M527 58v358M71 68h458', fill, 17) + slab(90, 116, 420, 275) + path('M104 197h392M104 280h392', 'none', '#746040', 5) + rect(76, 53, 449, 45, '#746041', 5)
    case 6: return slab(50, 88, 500, 304) + repeat(3, n => bar(`M${175 + n * 125} 105v270`, '#82704C', 10)) + rect(60, 94, 480, 20, '#695B41', 2) + bolts(66, 104, 468, 272)
    case 7: return slab(75, 109, 450, 262) + path('M91 235h418', 'none', '#746345', 7) + [[70, 90], [530, 90], [70, 390], [530, 390]].map(([x, y]) => oval(x, y, 15, 25, '#544C3D', bone, 6) + path(`M${x - 7} ${y - 20}l17 40m-17-34 17 40`, 'none', '#B5A47F', 4)).join('')
    case 8: return path('M38 241Q145 52 300 83Q463 48 565 240Q454 418 300 390Q143 422 38 241Z', fill) + path('M73 239Q189 109 300 116Q411 98 528 238M81 263q214 160 441-2M300 115v257', 'none', '#ADB084', 6) + oval(300, 240, 24, 31, '#7F936B')
    case 9: return path('M148 51H452L558 240 452 429H148L42 240Z', stone, ink, 6) + bar('M85 240h430M190 90l214 296M405 92L193 386', iron, 18) + [0, 60, 120, 180, 240, 300].map(a => `<g transform="rotate(${a} 300 240)">${rect(488, 215, 39, 50, iron, 4)}${rivet(507, 240)}</g>`).join('')
    case 10: return path('M78 88L192 66 327 93 480 59 545 102 525 382 410 414 261 383 88 419 47 356Z', fill) + grain(108, 130, 380, 210) + bar('M91 82q-47 159 8 322M494 87q56 151-2 316', bone, 20) + path('M90 113l22 10m-31 37 26 4m-24 42 27 2m380-93 23-9m-17 43 25-5m-20 39 26 3', 'none', '#6B624A', 4)
    case 11: return star(300, 240, 223, 8, '#685A47') + oval(300, 240, 156, 151, '#585665', gold, 6) + repeat(6, n => { const a = n * Math.PI / 3; return oval(300 + 106 * Math.cos(a), 240 + 98 * Math.sin(a), 27, 27, '#423F4A', gold, 3) }) + oval(300, 240, 42, 40, stone, gold, 4)
    case 12: return slab(62, 98, 476, 283) + repeat(3, n => path(`M${93 + n * 140} 356V189l57-70 57 70v167Z`, '#544D43', gold, 4)) + [49, 520].map(x => rect(x, 78, 31, 327, iron, 5)).join('')
    case 13: return path('M36 211L87 97 192 77 300 106 411 72 522 105 564 217 528 384H70Z', fill) + repeat(6, n => path(`M${98 + n * 67} 177q34 67 68 0m-68 74q34 67 68 0`, 'none', gold, 3)) + [65, 508].map(x => path(`M${x} 130l-33 98 51 94 17-26-24-69 20-59Z`, iron)).join('')
    case 14: return path('M47 266Q46 92 231 76Q470 37 552 195Q598 354 391 403Q144 464 47 266Z', fill) + path('M82 258Q133 119 292 108Q459 86 523 220M97 293q170 141 404-15M290 112q-45 121 0 262', 'none', '#B8AE83', 5) + oval(286, 239, 31, 49, '#7C8C68')
    case 15: return slab(57, 81, 486, 318, 104) + [121, 233, 345, 457].map(x => bar(`M${x} 99v280`, '#9E8154', 13)).join('') + oval(61, 240, 24, 40, fill) + oval(539, 240, 24, 40, fill)
    case 16: return legs(65, 80, 470, 320, iron) + rect(73, 92, 454, 296, iron, 2) + rect(87, 108, 426, 265, '#899082', 1, '#C2C4AE', 3) + bar('M93 179h413M93 300h413', iron, 9) + bolts(101, 121, 398, 238)
    case 17: return rect(59, 85, 482, 310, '#647169', 23) + grid(80, 106, 440, 267) + bar('M62 90h476v300H62Z', iron, 12) + legs(64, 89, 470, 299, iron)
    case 18: return [50, 518].map(x => [54, 378].map(y => rect(x, y, 31, 52, '#4B544C', 11) + rect(x + 6, y + 7, 19, 38, iron, 7)).join('')).join('') + slab(67, 98, 466, 284) + bar('M40 110v263M560 110v263', iron, 12) + bolts(85, 116, 430, 247)
    case 19: return slab(60, 85, 480, 310) + repeat(6, n => rect(79 + (n % 3) * 150, 104 + Math.floor(n / 3) * 140, 142, 129, '#6C6149', 3, '#BCAD8A', 4)) + bar('M75 240h450', iron, 10)
    case 20: return slab(57, 80, 486, 320) + repeat(12, n => oval(113 + (n % 4) * 125, 143 + Math.floor(n / 4) * 96, 34, 33, '#464C3D', '#B2A07C', 4)) + bolts(78, 101, 444, 278)
    case 21: return rect(64, 90, 472, 302, iron, 7) + rect(85, 105, 429, 269, '#8A8B74', 3, '#C0B79A', 4) + grid(101, 119, 397, 237, 12) + bar('M51 130v222M548 130v222', iron, 12) + rect(251, 369, 98, 34, iron, 6)
    case 22: return rect(67, 92, 466, 296, '#8EA698', 8, gold, 7) + `<g opacity=".35">${path('M82 342L331 104H389L139 374ZM386 374L521 244V190L328 374Z', '#E3E3C9', 'none')}</g>` + legs(75, 98, 450, 281, gold)
    case 23: return slab(103, 100, 394, 280) + [false, true].map(mirror => `<g transform="${mirror ? 'translate(600 0) scale(-1 1)' : 'translate(0 0)'}">${path('M35 118H56V87H80V59H106V421H80V393H56V362H35Z', '#7B6B4D', gold, 3)}</g>`).join('') + repeat(5, n => path(`M300 349L${171 + n * 64} 137`, 'none', gold, 2))
    default: throw new Error('未知货架设计。')
  }
}

function counter(i: number): string {
  switch (i) {
    case 0: return bar('M81 84L124 396M519 84L476 396', fill, 22) + slab(65, 100, 470, 280) + path('M80 193h440M80 287h440', 'none', '#6C5A3F', 5)
    case 1: return slab(70, 75, 460, 330, 12) + repeat(20, n => rect(84 + n % 5 * 87, 90 + Math.floor(n / 5) * 74, 83, 70, n % 3 ? '#A18B61' : '#8F7753', 1, '#746043', 2)) + bar('M77 384h446', fill, 15)
    case 2: return path('M55 175Q298 14 545 175L505 375Q300 276 95 375Z', fill) + path('M80 184Q300 51 520 184M110 343Q300 260 490 343', 'none', '#CAB58C', 5) + grain(170, 150, 260, 130) + oval(67, 185, 18, 25, fill) + oval(533, 185, 18, 25, fill)
    case 3: return path('M62 62H535V205H212V418H62Z', fill) + path('M81 80H516V186H192V399H81Z', 'none', '#CCB68B', 3) + grain(98, 100, 389, 63, 5) + grain(91, 222, 93, 145)
    case 4: return rect(64, 88, 472, 306, stone, 9) + path('M230 99l-27 112 23 173M389 98l34 158-15 125', 'none', '#4F5D52', 4) + path('M80 108H517V375H80Z', 'none', '#B9B9A0', 5) + rect(51, 88, 38, 306, '#697064', 4) + rect(511, 88, 38, 306, '#697064', 4)
    case 5: return path('M70 106H530V377H70Z', fill) + grain(90, 128, 420, 227) + [112, 286, 459].map(x => rect(x, 88, 32, 63, iron, 3) + rivet(x + 16, 114)).join('') + bar('M75 142L40 340M525 142l35 198', fill, 15)
    case 6: return [146, 455].map(x => oval(x, 240, 109, 158, fill, iron, 10) + oval(x, 240, 92, 140, 'none', '#C6AF82', 4)).join('') + slab(87, 129, 426, 225) + path('M104 238h393', 'none', '#6B5C41', 5)
    case 7: return slab(54, 83, 492, 314) + repeat(6, n => rect(72 + n * 77, 101, 72, 93, '#625D40', 3, '#C3B28B', 3)) + path('M70 210h460', 'none', '#746145', 7) + grain(76, 231, 447, 139)
    case 8: return path('M31 243Q143 42 301 87Q460 39 570 243Q453 413 300 375Q142 422 31 243Z', fill) + bar('M69 244Q173 107 300 121Q440 95 529 243', '#94A17B', 9) + path('M84 270q211 129 429-2M300 119v235', 'none', '#D1C394', 4)
    case 9: return path('M125 67H475L559 167V343L475 413H125L41 343V167Z', stone, iron, 10) + bolts(103, 141, 392, 211) + oval(300, 234, 66, 65, iron, gold, 5) + path('M260 234h80M300 194v80', 'none', '#BDBB9F', 3)
    case 10: return path('M74 102L211 79 314 106 478 70 540 143 521 370 407 408 268 374 82 414 43 335Z', '#79664D') + path('M105 126L216 105 312 132 477 98 515 151 493 348 408 379 269 349 108 381 71 326Z', fill) + bar('M80 131Q11 215 89 343M521 135q70 81-3 213', bone, 23)
    case 11: return path('M172 57H428L557 164V380H426L389 310H211L174 380H43V164Z', fill) + path('M187 82H414L529 176V350H444L403 281H196L155 350H71V176Z', 'none', gold, 4) + oval(151, 205, 49, 49, '#5C5B6A', gold, 3) + oval(449, 205, 49, 49, '#5C5B6A', gold, 3)
    case 12: return slab(60, 99, 480, 283) + repeat(3, n => path(`M${92 + n * 144} 330V183l63-66 63 66v147Z`, '#584F40', gold, 3)) + legs(64, 104, 472, 266, iron)
    case 13: return path('M39 241L96 113 186 82 300 119 413 82 509 113 560 241 515 370H86Z', fill) + repeat(5, n => path(`M${111 + n * 75} 164q37 58 74 0m-74 67q37 58 74 0`, 'none', gold, 3)) + rect(243, 284, 114, 60, '#5C5C57', 10, gold, 4)
    case 14: return star(300, 240, 218, 5, fill) + oval(300, 240, 122, 117, 'none', '#ADB286', 7) + oval(300, 240, 99, 96, 'none', '#6E7758', 3) + path('M284 150q-42 88 16 183q62-96 16-183', 'none', '#BCC18D', 4)
    case 15: return slab(86, 87, 428, 310, 98) + [78, 522].map(x => oval(x, 240, 51, 108, fill, '#B6A77C', 4)).join('') + path('M120 112q180-34 360 0M119 371q181 31 362 0', 'none', '#D0BB91', 6) + grain(147, 136, 304, 204)
    case 16: return slab(55, 94, 490, 295) + rect(355, 107, 170, 267, '#77684E', 8, gold, 4) + rect(372, 128, 135, 161, iron, 11) + repeat(5, n => oval(391 + n % 3 * 37, 159 + Math.floor(n / 3) * 47, 9, 9, bone, ink, 1)) + rect(373, 307, 133, 33, '#45564D', 4)
    case 17: return rect(58, 90, 484, 302, '#91A493', 10, gold, 8) + repeat(6, n => rect(81 + n % 3 * 149, 112 + Math.floor(n / 3) * 132, 140, 123, '#7C8072', 7, '#CEC1A0', 3)) + `<g opacity=".3">${path('M81 362L357 107H427L155 373Z', '#EEF0D8', 'none')}</g>` + bolts(75, 107, 450, 269)
    case 18: return path('M59 100Q298 64 541 100V380H378L353 316H247L219 380H59Z', stone) + path('M83 118Q301 86 516 118V355H397L373 291H226L202 355H83Z', 'none', '#CBD1B9', 5) + [119, 183, 429, 493].map(x => oval(x, 181, 19, 18, '#657A6B', '#D6D5BE', 3)).join('') + path('M127 265q90-84 162-27m71-91 41 28 55-17', 'none', '#829383', 2)
    case 19: return slab(108, 94, 384, 291) + [false, true].map(mirror => `<g transform="${mirror ? 'translate(600 0) scale(-1 1)' : 'translate(0 0)'}">${path('M35 119H59V88H84V61H108V419H84V392H59V362H35Z', '#76664A', gold, 3)}</g>`).join('') + repeat(7, n => path(`M300 351L${171 + n * 43} 128`, 'none', gold, 2)) + rect(253, 344, 94, 16, '#524D3B', 6)
    case 20: return slab(53, 85, 494, 310) + repeat(3, n => rect(74 + n * 157, 105, 143, 122, '#5A624E', 4, '#BAAC87', 3) + rect(84 + n * 157, 259, 123, 101, '#76634C', 4)) + rect(73, 371, 452, 13, gold, 2)
    case 21: return rect(59, 83, 482, 314, '#BBC5B3', 6, iron, 6) + path(repeat(5, n => `M${140 + n * 79} 95v290 `) + repeat(3, n => `M72 ${163 + n * 77}h456 `), 'none', '#8A9B88', 2) + oval(145, 265, 49, 48, stone, '#65766B', 5) + rect(252, 111, 267, 71, '#7F9381', 5, '#DAE0C9', 4)
    case 22: return path('M61 375V155Q61 57 167 57H433Q539 57 539 155V375H396V175H204V375Z', fill) + path('M80 355V156Q81 80 169 80H431Q518 80 518 156V355H416V156H183V355Z', 'none', gold, 5) + grain(215, 88, 172, 48, 4)
    case 23: return rect(62, 97, 476, 288, stone, 7, iron, 5) + path('M62 283H225Q300 174 375 283H538V385H62Z', '#809080') + oval(300, 282, 67, 51, '#5A6D5E', '#C4CAB4', 5) + [62, 511].map(x => rect(x, 80, 27, 322, iron, 4)).join('')
    default: throw new Error('未知柜台设计。')
  }
}

function stall(i: number): string {
  // A top-down roof plus exposed counter and supports, never an elevation icon.
  const table = slab(68, 342, 464, 94), poles = legs(57, 62, 486, 355)
  const rope = path('M65 66L25 30M535 66l40-36M65 416l-40 34M535 416l40 34', 'none', '#B8AB84', 5)
  const roof = (d: string, ridge: string) => path(d, cloth) + path(ridge, 'none', '#D4C19B', 5)
  switch (i) {
    case 0: return rope + poles + table + roof('M56 59H544V323H56Z', 'M67 77H533M70 300H530') + path('M110 82q-7 98 0 215m95-215q-7 99 0 215m95-215q-7 98 0 215m95-215q-7 98 0 215m95-215q-7 98 0 215', 'none', '#8C8061', 3)
    case 1: return rope + poles + slab(43, 101, 77, 321) + slab(480, 101, 77, 321) + roof('M59 63H541V350H59Z', 'M300 67V344M70 76l230 115L530 76M70 335l230-144L530 335')
    case 2: return star(300, 240, 211, 8, fill) + path('M164 351L205 413H396L437 352', 'none', fill, 45) + oval(300, 220, 208, 184, cloth) + repeat(8, n => { const a = n * Math.PI / 4; return path(`M300 220L${300 + 205 * Math.cos(a)} ${220 + 182 * Math.sin(a)}`, 'none', '#B9AA84', 4) }) + oval(300, 220, 16, 16, gold)
    case 3: return poles + table + roof('M54 53H546V308H54Z', 'M66 69H534') + repeat(6, n => path(`M65 ${88 + n * 35}h470`, 'none', '#736E55', 10)) + repeat(3, n => rect(82 + n * 149, 354, 139, 66, '#819486', 7, '#C4C8AD', 3))
    case 4: return [43, 522].map(x => rect(x, 175, 35, 154, '#535E52', 12) + rect(x + 9, 191, 17, 123, iron, 6)).join('') + bar('M171 350L127 446M431 350l43 96', fill, 16) + slab(86, 79, 428, 321) + roof('M92 94Q300 20 508 94V319Q300 248 92 319Z', 'M111 112q190-60 378 0M113 295q190-54 374 0')
    case 5: return poles + table + bar('M58 67l486 24M57 210l484 20', fill, 13) + roof('M62 70L183 88 309 60 433 84 542 67 539 319 412 303 305 331 178 307 59 323Z', 'M74 91l459 0M79 293l441 1') + [142, 300, 458].map(x => oval(x, 383, 48, 28, '#625F43', bone, 4)).join('')
    case 6: return legs(58, 65, 484, 349, stone) + rect(71, 345, 458, 86, stone, 5) + rect(53, 55, 494, 276, '#7D7762', 5) + repeat(6, n => path(`M64 ${77 + n * 43}h472`, 'none', '#B3A584', 12)) + repeat(6, n => path(`M${90 + n * 80} 62v260`, 'none', '#5A6251', 3))
    case 7: return bar('M65 70L534 349M535 70L65 349', fill, 13) + path('M34 344H566V426H408V450H192V426H34Z', fill) + roof('M97 76H503V324H97Z', 'M109 90H490M110 309H489') + legs(93, 84, 414, 330)
    case 8: return table + bar('M63 78q-35 203 19 340M536 78q35 203-19 340', '#8C9470', 17) + path('M33 271Q42 74 245 57Q413 32 547 145Q598 266 414 334Q175 396 33 271Z', '#7F926C') + path('M65 248Q165 70 377 93M68 271q207 117 464-85M291 83q-35 138 43 229', 'none', '#BEC092', 5) + path('M123 105Q295 61 435 174L380 275 243 240Z', '#98A27A')
    case 9: return path('M143 47H456L564 224 458 399H142L36 224Z', stone, iron, 8) + path('M165 71H435L531 224 435 374H165L69 224Z', '#7B8172', gold, 5) + bar('M77 224h446M187 83l225 279M413 83L187 362', iron, 13) + slab(142, 390, 317, 56) + oval(300, 224, 25, 25, iron, gold, 4)
    case 10: return rope + table + path('M45 111L162 55 279 79 397 49 550 110 533 334 423 309 308 351 174 316 67 344Z', '#89775A') + path('M66 128L166 78 279 101 400 73 528 127 514 311 423 286 308 326 174 292 87 316Z', cloth) + bar('M64 119q-49 96 0 211M531 119q50 96 1 211', bone, 20)
    case 11: return star(300, 224, 221, 8, cloth) + repeat(8, n => { const a = n * Math.PI / 4; return path(`M300 224L${300 + 213 * Math.cos(a)} ${224 + 211 * Math.sin(a)}`, 'none', gold, 4) }) + oval(300, 224, 44, 44, '#63626E', gold, 4) + slab(155, 406, 290, 48)
    case 12: return poles + table + roof('M72 92L178 46H423L529 92V327H72Z', 'M300 54V319M85 104L300 169 516 104') + bar('M59 80v330M541 80v330', iron, 16) + path('M88 315l78-98 67 98m133 0 67-98 78 98', 'none', gold, 4)
    case 13: return table + path('M28 205L131 58 300 103 470 58 573 205 537 342 431 316 300 351 168 316 63 342Z', '#6D7B69') + repeat(6, n => path(`M${73 + n * 76} 133q38 65 76 0m-76 71q38 65 76 0m-76 71q38 65 76 0`, 'none', '#A8B28A', 3)) + bar('M131 69L300 334 470 69', iron, 10)
    case 14: return star(300, 229, 216, 5, '#9EA57C') + repeat(5, n => {const a = n * 72; return `<g transform="rotate(${a} 300 229)">${path('M300 229q-118-96-37-177q68 45 37 177Z', '#A6AD83', '#6C795A', 3)}</g>`}) + oval(300, 229, 34, 34, '#C3B880', '#7C835E', 4) + slab(171, 402, 258, 47, 20)
    case 15: return [77, 523].map(x => oval(x, 370, 51, 68, fill, iron, 7)).join('') + slab(90, 358, 420, 72, 23) + roof('M63 105Q301 21 537 105V330Q300 252 63 330Z', 'M80 123q220-69 440 0M78 308q222-65 442 0') + path('M176 95v211M300 75v221M424 96v211', 'none', '#8D8463', 5)
    case 16: return poles + table + rect(52, 59, 496, 274, cloth, 8) + repeat(5, n => rect(64 + n * 97, 68, 48, 253, '#8A987D', 2, 'none', 0)) + path(repeat(10, n => `M${65 + n * 48} 316q24 33 47 0 `), 'none', '#B9AD89', 12)
    case 17: return star(300, 233, 224, 8, '#7C8F7C') + star(300, 233, 190, 8, '#9CAC90') + repeat(8, n => {const a=n*Math.PI/4; return path(`M300 233L${300+210*Math.cos(a)} ${233+206*Math.sin(a)}`,'none',gold,5)}) + oval(300,233,24,24,gold) + slab(180, 411, 240, 42)
    case 18: return [41, 526].map(x=>rect(x,173,33,148,'#444F48',12)).join('') + rect(78, 102, 444, 294, '#A0AC97', 26, iron, 6) + oval(194, 253, 71, 77, '#B7C2A8', '#6A8071', 5) + oval(407, 253, 71, 77, '#B7C2A8', '#6A8071', 5) + oval(300, 148, 130, 104, cloth, gold, 5) + bar('M300 50v197M171 148h257', gold, 5)
    case 19: return table + roof('M60 315Q66 50 300 49Q532 50 540 315Z','M300 60v242M78 302L300 61 522 302M128 142l172 160 171-159') + repeat(6,n=>oval(101+n*80,381,29,30,'#4F6655',iron,4))
    case 20: return bar('M78 80L51 423M522 80l27 343',iron,12) + slab(58, 313, 484, 124) + repeat(3,n=>rect(78, 325+n*34, 445, 28, '#918467', 3, '#BDB28C', 2)) + roof('M91 63H509V293H91Z','M106 77H495M107 278H494')
    case 21: return rect(94, 80, 412, 314, '#839582', 9, iron, 7) + path('M94 80L169 43H431L506 80 431 268H169Z', '#A8B096', gold, 4) + path('M169 43l48 200M431 43l-48 200M300 43v212', 'none', '#6F816E', 5) + oval(300, 382, 138, 49, cloth, gold, 4) + slab(193, 417, 214, 34)
    case 22: return legs(75, 90, 450, 290, iron) + slab(90, 99, 420, 281) + path('M40 157H90V330H40ZM510 157H560V330H510Z', fill) + oval(215, 202, 56, 56, '#7C9380', '#C4C9B0', 5) + oval(385, 202, 56, 56, '#7C9380', '#C4C9B0', 5) + rect(127, 291, 346, 64, '#9A9B7E', 6, '#5F7665', 3)
    case 23: return legs(65, 70, 470, 340, iron) + slab(63, 354, 474, 78) + rect(66, 61, 468, 267, '#667E6A', 6, gold, 4) + rect(99, 78, 402, 231, '#8C9C80', 5, gold, 4) + rect(133, 99, 334, 189, '#A7AD8B', 4, gold, 4) + path('M300 108v171M144 193h312', 'none', '#C6C5A1', 5)
    default: throw new Error('未知摊位设计。')
  }
}
function merchandise(i: number): string {
  const crate = () => slab(59, 61, 482, 358) + rect(77, 79, 446, 322, '#71674C', 4, bone, 3)
  switch(i) {
    case 0: return oval(300,240,231,183,'#A08C61',bone,8) + oval(300,240,207,159,'#766848') + repeat(96,n=>{const x=115+n%12*32+n*7%13,y=100+Math.floor(n/12)*38+n*11%9;return ((x-300)/190)**2+((y-240)/140)**2<1?oval(x,y,7+(n%3),4+(n%2),'#BDB07B','#887A51',1):''})
    case 1: return crate() + bar('M223 88v304M378 88v304',fill,10) + repeat(15,n=>oval(122+(n%5)*88,133+Math.floor(n/5)*105,33,39,n%3?'#A69C60':'#8A8A59','#5F6949',3) + path(`M${120+n%5*88} ${105+Math.floor(n/5)*105}l6-12`, 'none', '#656147',4))
    case 2: return [0,1,2].map(n=>rect(71,74+n*110,456,96,n===1?'#8D9C80':n===2?'#A09170':'#B6AC8A',39) + oval(95,121+n*110,21,39,'#6E7058',bone,3) + oval(95,121+n*110,9,23,'#4C5545',bone,2) + path(`M122 ${91+n*110}q174-12 377 0`, 'none', '#D0C19B',2)).join('') + bar('M229 75v315M411 75v315','#766B4D',15)
    case 3: return slab(60,68,480,343,45) + oval(228,230,117,131,'#BDB070','#7F774E',5) + path('M395 106L524 323 349 352Z','#D0BE7C','#7E774F',4) + [0,1,2,3,4].map(n=>oval(179+n%3*47,178+Math.floor(n/3)*81,8,7,'#938A57','#938A57',1)).join('') + path('M353 350l-9 32 159-28-25-12','#BEB89C', '#9C9574',2)
    case 4: return crate() + repeat(6,n=>{const x=139+n%3*160,y=154+Math.floor(n/3)*169;return path(`M${x} ${y-57}l49 35-14 71-35 22-37-25-12-64Z`,n%2?'#77927D':'#9DA886','#516C5D',3)+path(`M${x} ${y-44}v102m-38-67 38 67 36-62`,'none','#C7C9A5',2)})
    case 5: return oval(300,240,232,184,fill,bone,7) + repeat(4,n=>`<g transform="translate(${190+n%2*220} ${150+Math.floor(n/2)*174}) rotate(${n%2?10:-12})">${bar('M-9-58L12 65','#7D8961',5)}${repeat(6,k=>oval(-22+k%2*45,-46+k*16,23,8,k%2?'#8D9D70':'#687F57','#526849',1))}${path('M-8 37l25 5m-24 3 25 5','none','#C1AE7F',3)}</g>`)
    case 6: return crate() + repeat(9,n=>{const x=145+n%3*155,y=132+Math.floor(n/3)*111;return oval(x,y,52,43,'#8B9B89','#C6CCB2',5)+oval(x,y,39,31,'none','#627B68',3)+path(`M${x-16} ${y}h32`,'none','#D3D4BA',2)})
    case 7: return slab(52,64,267,175,6) + rect(345,99,203,306,'#B4A480',12) + rect(79,268,244,138,'#8A937B',7) + bar('M183 73v158M61 152h250M448 108v287M353 253h187M86 335h230', '#716D50', 6) + rect(219,282,72,53,'#D3C7A4',2, '#948A6C',1)
    default: throw new Error('未知货品设计。')
  }
}
function scale(i: number): string {
  const pan = (x: number,y: number,r=84) => oval(x,y,r,r*.82,'#8D9B83',gold,5) + oval(x,y,r-13,(r-13)*.82,'none','#5D725D',3)
  switch(i) {
    case 0: return slab(236,108,128,271,25) + bar('M106 172h388',gold,16) + pan(139,291) + pan(461,291) + path('M104 173l-35 123 70-25 68 25-34-123M426 173l-35 123 70-25 68 25-34-123','none',gold,4) + oval(300,172,26,26,iron,gold,4)
    case 1: return bar('M58 140l482 28',iron,16) + pan(157,304,104) + path('M91 143L61 316 157 282 250 319 224 151','none',gold,4) + rect(397,138,59,82,iron,9,gold,4) + path('M452 148v-45q-25-30-47-3','none',iron,9)
    case 2: return slab(246,67,108,337) + bar('M91 151h418',fill,26) + [83,397].map(x=>rect(x,214,121,155,'#7D886E',12,gold,5)).join('') + path('M105 158v70M182 158v70M421 158v70M499 158v70','none',gold,4) + oval(300,150,25,26,iron,gold,4) + rect(267,313,66,58,stone,6)
    case 3: return pan(300,257,191) + path('M300 257L141 158M300 257L458 159M300 257V423','none',gold,9) + oval(300,257,32,32,iron,gold,4) + path('M300 255V97q-3-50 41-43q39 10 7 43','none',iron,14)
    case 4: return path('M164 54H436L551 240 436 426H164L49 240Z',stone,iron,7) + bar('M102 226h396M300 97v286',iron,16) + [135,465].map(x=>star(x,284,91,6,'#879782') + oval(x,284,61,54,'none',gold,4)).join('') + oval(300,226,32,32,gold)
    case 5: return path('M69 296Q88 99 247 135Q300 179 353 135Q512 98 532 296','none','#8A9D73',17) + [145,455].map(x=>path(`M${x-80} 300Q${x} 168 ${x+79} 300Q${x} 401 ${x-80} 300Z`,'#9EAA7C','#637E59',4)).join('') + oval(300,186,26,31,gold,'#6A8058',3) + path('M300 215v177','none','#9DA779',15)
    case 6: return rect(57,71,486,340,iron,29,gold,4) + rect(75,90,350,303,'#AAB59A',17,'#D1D3B6',5) + rect(448,81,75,315,'#556D5C',13) + bar('M445 135h79M486 106v262',gold,10) + rect(464,211,45,57,iron,5,gold,3) + bolts(88,104,323,275)
    case 7: return rect(104,185,392,222,iron,49) + oval(300,258,174,108,'#A8B59C','#D4D6B9',5) + path('M132 181Q300 16 468 181L389 219H211Z','#AFAE87',gold,5) + path(repeat(9,n=>{const x=171+n*32,y=181-(1-((x-300)/168)**2)*74;return`M${x} ${y+9}v9 `}),'none','#64745F',3) + path('M300 189l62-66','none','#5B6652',6)
    default: throw new Error('未知秤设计。')
  }
}
function label(i: number): string {
  const marks = (x:number,y:number,w:number) => path(`M${x} ${y}h${w}m-${w} 37h${w*.8}m-${w*.8} 37h${w*.9}`, 'none', '#7F7859',5)
  switch(i) {
    case 0: return path('M135 77H492L548 141V360L492 412H135Z',fill) + oval(176,240,17,19,'#595E45',bone,5) + path('M172 226Q25 78 40 250Q31 398 174 253','none',bone,10) + grain(214,114,280,235) + marks(245,171,208)
    case 1: return path('M109 109L228 75 372 103 499 75 536 337 393 406 244 369 90 413Z','#B3AB8B') + path('M112 178L497 356M175 96L449 388','none', '#7A7154',8) + oval(304,240,66,70,'#997A59','#665F47',4) + star(304,240,36,7,'#AE8E65')
    case 2: return slab(80,91,440,306,25) + rect(108,119,384,249,'#59695A',10,gold,4) + path(repeat(7,n=>`M${147+n*42} 177v125 `),'none','#B4B69A',6) + bar('M256 91Q300 18 344 91',iron,12)
    case 3: return path('M63 105H518V216H408L369 198 335 216H63Z',fill) + path('M101 275H455V386H359L326 367 293 386H101Z',fill) + path(repeat(8,n=>`M${129+n*44} 110v71M${139+n*33} 282v66 `),'none','#63593F',5) + grain(84,119,400,72,4) + grain(117,294,314,70,4)
    case 4: return star(312,241,185,8,iron) + oval(312,241,120,117,stone,gold,7) + path('M259 174L356 174 284 286 359 286M258 227h102','none',gold,9) + oval(119,240,32,44,'none',gold,10)
    case 5: return path('M54 244Q179 68 343 111Q484 75 553 243Q455 386 300 363Q147 413 54 244Z','#8F8E68') + path('M84 242Q190 101 342 139Q462 111 523 243Q443 356 298 335Q164 381 84 242Z','none',bone,4) + path('M148 242q181-62 330 0M304 154v167','none','#5E7651',4) + oval(95,240,20,22,'none',gold,6)
    case 6: return path('M134 75H491L553 141V340L491 407H134Z','#B8AC85') + oval(178,240,20,20,'#6F795D',bone,8) + path('M176 227Q40 83 47 233Q32 365 177 254','none','#857C5C',8) + marks(244,157,239) + rect(382,313,103,54,'#C5BD98',2,'#948D6D',2)
    case 7: return path('M75 78H524l-13 20 14 20-13 20 14 20-13 20 14 20-13 20 14 20-13 20 14 20-13 20 14 20-13 20 14 20H75L88 362 75 342 88 322 75 302 88 282 75 262 88 242 75 222 88 202 75 182 88 162 75 142 88 122 75 102Z','#C0B898') + marks(112,146,373) + rect(111,288,374,80,'none',4,'#8F9678',3) + oval(412,184,48,49,'none','#819177',6)
    default: throw new Error('未知货签设计。')
  }
}
function packing(i:number):string {
  switch(i) {
    case 0: return oval(246,237,155,159,'none','#776D50',18)+oval(246,237,135,139,'none','#C2B18B',13)+oval(330,260,156,160,'none','#776D50',18)+oval(330,260,136,140,'none','#C2B18B',13)+path('M96 238Q54 423 172 431Q275 437 337 386M486 252Q556 193 522 93','none','#B5A580',14)+path('M95 239Q54 419 171 427','none','#DECEA5',3)
    case 1: return oval(300,240,238,177,'#A79563','#6C6948',7)+ovalWeave(300,240,218,158)+oval(300,240,225,165,'none',bone,12)+path('M91 166Q126 74 205 91L169 160Z','#B8AA7B','#6C6948',4)
    case 2: return path('M62 115L503 74 544 376 101 417Z','#A8A184')+path('M70 124L484 109 508 378 108 393Z','#B9B093')+path('M109 141L467 126 485 347 124 367Z','#C1B99C')+path('M126 159l322-15M141 340l319-13M111 398l14 22m15-24 12 20m15-24 9 19','none','#7F8269',3)
    case 3: return `<g transform="rotate(-12 300 240)">${slab(52,123,480,57)}${slab(74,207,471,68)}${slab(49,300,494,58)}</g>`+bar('M183 125l-12 229M414 113l17 239','#BEB08A',10)+path('M171 223l25 10m-26-1 25 10M419 224l26-6m-24 16 26-5','none','#6C674A',3)
    case 4: return path('M185 146L122 65 63 98 82 234 49 376 130 416 202 338H400L476 421 553 375 520 237 543 103 471 64 410 146Z','#867052')+rect(176,139,246,207,fill,22,bone,4)+bar('M145 212h322M145 275h322','#61583F',16)+[195,376].map(x=>rect(x,198,35,30,gold,4)+rect(x+7,205,21,16,'#5D614B',2)).join('')+path('M132 88l56 74m284-76-55 74M78 372l105-51m338 52-106-51','none',bone,3)
    case 5: return path('M72 119L194 65 319 96 446 62 545 127 521 360 414 418 286 383 152 414 53 348Z',fill)+repeat(28,n=>{const x=130+n%7*57,y=137+Math.floor(n/7)*62;return oval(x+n*11%15,y+n*7%11,25+n%8,20+n%5,n%2?'#7A8E60':'#95A576','#627A50',2)})+path('M88 148l48 213M492 132l-25 233','none','#B9AA7D',13)
    case 6: return path('M84 129L486 72 542 357 139 415Z','#BCAF85')+path('M84 129Q33 179 89 243L138 414 166 369 133 211Z','#8B8966')+oval(96,177,32,47,'#777C5E',bone,5)+oval(96,177,13,26,'#525F46',bone,3)+path('M483 74l-34 51 43 23Z','#D0C29B')+path('M169 164l299-43M191 358l291-41','none','#DED0AA',2)
    case 7: return path('M174 147L91 66 45 143 110 246 43 359 111 419 177 339H424L493 416 554 355 490 244 553 143 490 65 421 147Z','#B8A57C')+rect(166,139,268,209,'#7B7658',4,bone,5)+rect(190,164,221,159,'#A99C74',2,'#666C4F',3)+path('M176 148l-65 99 66 92m247-191 66 97-66 94','none','#877951',4)+path('M111 247h52M436 245h55','none','#D6C8A1',3)
    default: throw new Error('未知包装设计。')
  }
}
export const TRADE_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Trade-Collection-1'
export const TRADE_COLLECTION_LICENSE = `Sceneweave Trade Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG drawings of shelving, counters and market stalls, authored with coding assistance. No third-party art or image pixels are included. Illustrative period/fantasy interpretations; technical validation and art review are separate.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
function artwork(design: TradeDesign, i: number): VisualSampleArt {
  const defs = `<defs><linearGradient id="wood" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#B9A276"/><stop offset="38%" stop-color="#94805A"/><stop offset="100%" stop-color="#695C43"/></linearGradient><linearGradient id="stone" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#B6BEA7"/><stop offset="100%" stop-color="#68796B"/></linearGradient><linearGradient id="cloth" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#C2B58E"/><stop offset="40%" stop-color="#A39671"/><stop offset="100%" stop-color="#7D785A"/></linearGradient></defs>`
  const detail = ['merchandise','trade-scale','cargo-label','packing'].includes(design.category)
  return { key: design.key, name: design.name, kind: 'prop', widthMm: design.widthMm, heightMm: design.heightMm,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm / 600} ${design.heightMm / 480})">${({ shelf, 'shop-counter': counter, 'market-stall': stall, merchandise, 'trade-scale':scale, 'cargo-label':label, packing }[design.category])(i)}</g></svg>`,
    footprintMm: { width: Math.round(design.widthMm * .9), height: Math.round(design.heightMm * .9) }, blocksMovement: !detail, blocksSight: false, renderLayer: design.category === 'cargo-label' ? 'ground' : 'object', shadowClass: detail ? 'none' : 'furniture',
    tags: ['原创', '仓储商贸', design.category, design.era, design.design, '俯视', ...(design.category === 'market-stall' ? ['顶视棚面', '装饰物件占地', '非可进入建筑'] : [])] }
}
export const TRADE_COLLECTION_ART: readonly VisualSampleArt[] = freezeJson(TRADE_DESIGNS.map(design => artwork(design, TRADE_DESIGNS.filter(row => row.category === design.category).findIndex(row => row.key === design.key))))
