import { WASH_DESIGNS, type WashDesign } from '../assets/wash-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

const edge = '#514D40', wood = 'url(#wood)', stone = 'url(#stone)', copper = 'url(#copper)', porcelain = 'url(#porcelain)', water = 'url(#water)', metal = 'url(#metal)'
const rep = (n: number, fn: (n: number) => string) => Array.from({ length: n }, (_, i) => fn(i)).join('')
const p = (d: string, fill = 'none', stroke = edge, sw = 2.2) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
const r = (x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke = edge, sw = 2.2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const e = (x: number, y: number, rx: number, ry: number, fill: string, stroke = edge, sw = 2.2) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g = (transform: string, body: string) => `<g transform="${transform}">${body}</g>`
const line = (d: string, color = '#998E72', sw = 10) => p(d, 'none', '#5C5949', sw + 2.5) + p(d, 'none', color, sw) + p(d, 'none', '#D6C9A5', 1.1)
const grain = (x: number, y: number, w: number, h: number, count = 12) => `<g opacity=".32">${rep(count, i => p(`M${x + i % 3 * 9} ${y + (i + 1) * h / (count + 1)}q${w * .23} ${i % 2 ? 3 : -3} ${w * .49} 0t${w * .44} 0`, 'none', i % 3 ? '#E0CAA0' : '#63563B', .9))}</g>`
const board = (x: number, y: number, w: number, h: number, rad = 7) => r(x, y, w, h, wood, rad) + r(x + 7, y + 7, w - 14, h - 14, 'none', rad, '#C9B38B', 1.3) + grain(x + 13, y + 11, w - 26, h - 22)
const bolt = (x: number, y: number) => e(x, y, 4, 4, '#B8AF8B', '#686B59', 1) + p(`M${x - 2} ${y}h4`, 'none', '#555C50', .8)
const ring = (x: number, y: number, rx: number, ry: number, color = '#A8946C', width = 10) => e(x, y, rx, ry, 'none', '#5B5746', width + 3) + e(x, y, rx, ry, 'none', color, width) + p(`M${x - rx * .6} ${y - ry * .8}q${rx * .6} ${-ry * .3} ${rx * 1.2} 0`, 'none', '#DBCEAA', 1.2)
const foot = (x: number, y: number, color = wood) => r(x - 12, y - 12, 24, 24, color, 5) + bolt(x, y)
const legs = (x: number, y: number, w: number, h: number, color = wood) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => foot(a, b, color)).join('')
const quadraticY = (x: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => { let lo = 0, hi = 1; for (let n = 0; n < 30; n++) { const t = (lo + hi) / 2, q = (1-t)**2*x0 + 2*(1-t)*t*x1 + t*t*x2; if (q < x) lo=t; else hi=t } const t=(lo+hi)/2; return (1-t)**2*y0 + 2*(1-t)*t*y1 + t*t*y2 }
const polygon = (cx: number, cy: number, rx: number, ry: number, count: number) => rep(count, i => { const a = -Math.PI / 2 + i * Math.PI * 2 / count; return `${i ? 'L' : 'M'}${cx + Math.cos(a) * rx} ${cy + Math.sin(a) * ry}` }) + 'Z'
const flower = (count: number, rx: number, ry: number) => rep(100, i => { const a = -Math.PI / 2 + i * Math.PI / 50, radius = .8 + .2 * Math.cos(count * (a + Math.PI / 2)); return `${i ? 'L' : 'M'}${300 + rx * radius * Math.cos(a)} ${240 + ry * radius * Math.sin(a)}` }) + 'Z'
const drain = (x = 300, y = 255, radius = 9) => e(x, y, radius, radius, '#6D7568', '#B7B9A1', 2) + p(`M${x - radius * .5} ${y}h${radius}M${x} ${y - radius * .5}v${radius}`, 'none', '#384D47', 1.3)
const tap = (x: number, y: number, double = true) => line(`M${x} ${y}v31q0 13 16 13h16`, '#AFA787', 8) + e(x + 34, y + 44, 6, 7, '#777F6D', '#D3CBA7', 1) + (double ? [-27, 27].map(dx => e(x + dx, y + 7, 9, 9, metal, '#787B63', 1.5) + p(`M${x + dx - 7} ${y + 7}h14m-7-7v14`, 'none', '#D2C8A5', 2)).join('') : e(x - 21, y + 8, 10, 8, metal))
const handle = (x: number, y: number, angle = 0, color = '#A99A71') => g(`translate(${x} ${y}) rotate(${angle})`, line('M-23 0v-19q23-18 46 0v19', color, 6))
const ripple = (x = 300, y = 240) => `<g opacity=".34">${p(`M${x - 68} ${y}q65-11 136 0m-112 10q42-5 87 0`, 'none', '#C5D1BE', 1.3)}</g>`
const basin = (d: string, material = stone, sx = .84, sy = .76, inside = water) => p(d, material) + g(`translate(300 240) scale(${sx + .045} ${sy + .05}) translate(-300 -240)`, p(d, '#5B695E', '#D0CAB0', 2)) + g(`translate(300 240) scale(${sx} ${sy}) translate(-300 -240)`, p(d, inside, '#7F9280', 2.1))
const ob = (cx: number, cy: number, rx: number, ry: number, material = wood, inside = water, staves = false) => e(cx, cy, rx, ry, material) + (staves ? rep(22, i => {const a = i * Math.PI / 11; return p(`M${cx + Math.cos(a) * rx} ${cy + Math.sin(a) * ry}L${cx + Math.cos(a) * (rx - 18)} ${cy + Math.sin(a) * (ry - 18)}`, 'none', '#77694C', 1.5)}) : '') + e(cx, cy, rx - 18, ry - 18, '#576C62', '#D0BE97', 2.4) + e(cx, cy, rx - 25, ry - 25, inside, '#819180', 1.8)
const slats = (x: number, y: number, w: number, h: number, count: number, color = '#A8A080', width = 5) => rep(count, i => line(`M${x} ${y + i * h / (count - 1)}h${w}`, color, width))
const scrub = (x: number, y: number, w: number, h: number, color = wood) => r(x, y, w, h, color, 9) + slats(x + 9, y + 8, w - 18, h - 16, 12, '#C4BA96', 2.2)
const tile = (x: number, y: number, w: number, h: number) => r(x, y, w, h, '#B8B9A4', 3) + p(rep(Math.floor(w / 45), i => `M${x + 45 + i * 45} ${y}v${h}`) + rep(Math.floor(h / 45), i => `M${x} ${y + 45 + i * 45}h${w}`), 'none', '#8B9580', 1.8)

function bathtub(i: number): string {
  const oval = 'M63 240C63 130 153 76 300 76S537 130 537 240 447 404 300 404 63 350 63 240Z'
  switch (i) {
    case 0: return handle(83, 240, -90) + handle(517, 240, 90) + ob(300, 240, 220, 176, wood, water, true) + ripple() + p('M128 106L155 124M445 357L473 378', 'none', '#E2C99A', 2)
    case 1: return handle(74, 239, -90) + handle(526, 239, 90) + ob(300, 240, 231, 171, wood, water, true) + p('M193 87L193 392M407 87V392', 'none', '#686D5A', 8) + e(300, 111, 69, 19, '#AA946D') + ripple()
    case 2: return board(42, 64, 516, 352) + p('M126 65V416M474 65V416', 'none', '#6E6245', 3) + basin('M74 91H526V389H74Z', wood, .83, .76) + [[42, 112], [558, 112], [42, 367], [558, 367]].map(([x, y]) => r(x - 11, y - 12, 22, 24, wood, 2)).join('') + ripple()
    case 3: return p('M60 128L102 91 178 67 309 80 412 59 507 91 544 153 530 277 546 344 491 399 378 411 276 393 163 418 81 374 52 294Z', wood) + basin('M81 236C81 146 168 105 300 105S519 148 519 236 431 372 300 372 81 324 81 236Z', wood, .85, .76) + p('M67 183l-8 109M99 103l69-25M432 393l62-18M520 139l9 61', 'none', '#675A3E', 3) + e(111, 351, 24, 10, 'none', '#786447', 2) + ripple()
    case 4: return r(40, 47, 520, 386, stone, 6) + p('M170 47v37M380 47v37M40 171h43M40 315h43M516 167h44M517 324h43M190 396v37M423 396v37', 'none', '#777E6C', 3) + basin('M78 85H522V395H78Z', stone, .87, .77) + r(420, 176, 62, 130, '#9DA68E', 12) + drain(132, 238) + ripple(270, 240)
    case 5: return handle(63, 240, -90, '#B18F65') + handle(537, 240, 90, '#B18F65') + basin(oval, copper, .88, .76) + rep(22, n => { const a = n * Math.PI / 11; return bolt(300 + Math.cos(a) * 221, 240 + Math.sin(a) * 146) }) + p('M108 162q47-47 108-52M459 327l17-20', 'none', '#D3B08A', 2) + ripple()
    case 6: return basin('M108 102Q300 35 492 102L548 295 516 353 472 350 436 391 394 372 349 410 300 387 251 410 208 373 164 393 125 353 82 353 51 298Z', copper, .83, .76) + p(rep(7, n => `M300 113L${100 + n * 67} ${n % 2 ? 365 : 342}`), 'none', '#B29A70', 2.3) + e(300, 124, 64, 20, copper) + ripple(300, 282)
    case 7: return basin(polygon(300, 240, 235, 218, 8), wood, .82, .8) + p(polygon(300, 240, 203, 186, 8), 'none', '#D0B78E', 6) + rep(8, n => {const a = n * Math.PI / 4 + Math.PI / 8; return p(`M${300 + 233 * Math.cos(a)} ${240 + 215 * Math.sin(a)}L${300 + 201 * Math.cos(a)} ${240 + 184 * Math.sin(a)}`, 'none', '#665E45', 2)}) + board(230, 391, 140, 48) + ripple()
    case 8: return basin('M35 249Q132 72 340 73Q483 68 566 210Q475 408 270 408Q134 408 35 249Z', '#9EAB8B', .84, .77) + line('M54 243Q214 129 536 209', '#8D9A73', 8) + line('M116 332Q179 391 271 392', '#BBC4A1', 4) + ripple()
    case 9: return basin('M132 58H469L557 240 469 422H132L43 240Z', stone, .83, .77) + rep(6, n => {const a = n * Math.PI / 3; return bolt(300 + Math.cos(a) * 234, 240 + Math.sin(a) * 166)}) + p('M137 79h327M69 238l74 152M530 238l-72 153', 'none', '#BEBD9A', 3) + drain()
    case 10: return basin('M63 240Q31 88 180 78Q266 55 310 171Q405 67 487 111Q588 189 519 311Q468 409 357 386Q290 373 276 297Q183 427 93 366Q38 326 63 240Z', '#A7A789', .82, .77) + p('M81 209Q141 111 220 115M326 222q68-108 146-75', 'none', '#D2C8A2', 3) + ripple(170, 231) + ripple(422, 251)
    case 11: return line('M86 85L514 395M514 85L86 395', '#C0B38D', 14) + basin('M76 124L189 65 300 101 434 68 535 137 517 257 544 360 421 414 300 380 161 413 58 343 83 246Z', '#9D8F6E', .82, .76) + p(rep(12, n => `M${119 + n * 31} 109l4 13M${119 + n * 31} 380l-4-13`), 'none', '#DAC9A0', 2) + ripple()
    case 12: return basin(flower(5, 231, 185), '#B8B79A', .81, .79) + drain() + ripple()
    case 13: return [g('translate(0 -12)', r(248, 29, 104, 54, stone, 4)), g('translate(0 12)', r(248, 397, 104, 54, stone, 4)), r(37, 190, 57, 100, stone, 4), r(506, 190, 57, 100, stone, 4)].join('') + basin(polygon(300, 240, 225, 210, 8), stone, .8, .78) + p(polygon(300, 240, 205, 190, 8), 'none', '#BDB790', 3) + drain() + ripple()
    case 14: return p('M49 147L105 79 184 94 248 53 348 82 416 58 482 96 557 173 534 248 550 322 485 387 398 402 317 384 243 422 152 394 71 350 41 254Z', stone) + basin('M88 240Q94 120 260 118Q443 90 509 213Q535 334 368 359Q171 388 88 282Z', stone, .9, .81) + p('M57 202l42 19-23 64M410 71l-15 46 70 8M463 381l-23-35', 'none', '#717D69', 4) + e(160, 296, 44, 30, '#8D9B81') + ripple(332, 236)
    case 15: return basin('M36 200Q183 19 420 74Q534 99 566 219Q488 148 362 180Q230 214 150 370Q81 383 36 321Q19 275 36 200Z', stone, .83, .73) + p('M76 196Q230 71 415 110', 'none', '#D4D0B0', 3) + ripple(242, 208)
    case 16: return [foot(145, 114, metal), foot(455, 114, metal), foot(145, 366, metal), foot(455, 366, metal)].join('') + basin(oval, porcelain, .88, .76) + tap(300, 80) + drain(300, 322) + ripple(300, 230)
    case 17: return basin('M80 240Q70 144 182 98Q328 43 454 85Q555 136 535 257Q492 383 342 402Q166 422 80 317Z', porcelain, .86, .76) + p('M112 211Q128 123 256 103', 'none', '#F1E8CA', 5) + tap(423, 115, false) + drain(224, 300)
    case 18: return basin('M56 81H544V399H56Z', porcelain, .9, .72) + tap(300, 84) + drain(300, 316) + p('M75 104H243M528 167v124', 'none', '#DDDCC0', 3)
    case 19: return basin('M62 59H539V105Q536 373 66 423Z', porcelain, .83, .78) + tap(477, 88) + drain(339, 270) + p('M82 88h328M513 167Q444 329 154 384', 'none', '#E8DFC2', 3)
    case 20: return tile(35, 45, 530, 390) + basin('M66 240C66 147 144 88 280 88S494 146 494 240 415 392 280 392 66 333 66 240Z', porcelain, .86, .76) + tap(282, 92) + r(507, 183, 34, 100, '#A0AC94', 14, '#7F8A76', 2) + drain(280, 321)
    case 21: return foot(144, 133, copper) + foot(456, 133, copper) + foot(144, 349, copper) + foot(456, 349, copper) + basin('M36 240Q182 48 300 77Q418 47 564 240Q421 431 300 404Q177 433 36 240Z', copper, .88, .74) + tap(300, 91) + drain(300, 310)
    case 22: return basin('M86 64H514V245Q509 414 300 418Q91 416 86 245Z', porcelain, .84, .77) + r(147, 110, 305, 87, '#BAC6AE', 22, '#9CAC96', 3) + tap(419, 84, false) + drain(300, 314)
    case 23: return handle(196, 93) + handle(406, 386, 180) + basin(oval, porcelain, .87, .74) + tap(530, 201) + drain(291, 263) + ripple()
    default: throw new Error('未知浴缸构造。')
  }
}

function washstand(i: number): string {
  const bowl = (x: number, y: number, rx = 105, ry = 125, material = copper) => ob(x, y, rx, ry, material) + drain(x, y + 40, 7)
  switch (i) {
    case 0: return line('M83 359L300 49 517 359Z', '#9E8962', 20) + bowl(300, 241, 176, 173, wood) + grain(207, 79, 181, 13, 2)
    case 1: return legs(61, 89, 478, 297) + board(48, 86, 504, 310) + board(55, 55, 490, 38) + bowl(176, 246, 104, 128, wood) + bowl(423, 246, 104, 128, wood)
    case 2: return [[67,70],[525,70],[67,403],[244,403],[525,208]].map(([x,y])=>foot(x,y)).join('') + p('M47 58H552V230H270V423H47Z', wood) + grain(67, 78, 461, 100, 5) + bowl(154, 304, 83, 87, wood) + e(401, 144, 66, 38, '#C2B58B')
    case 3: return basin('M58 160Q300 49 542 160V321Q300 432 58 321Z', stone, .85, .72) + p('M82 314l49-33M479 310l37 12M452 123l45 8', 'none', '#C3C7AB', 2.5) + drain(437, 270)
    case 4: return handle(50, 230, -90) + handle(550, 230, 90) + board(50, 76, 500, 328) + p('M89 86v308M512 86v308', 'none', '#736B4E', 5) + board(58, 47, 484, 37) + bowl(300, 246, 165, 133)
    case 5: return board(51, 37, 498, 72) + line('M72 92l72 248M528 92L456 340', '#9A8965', 18) + basin('M72 114H528V212Q528 414 300 414Q72 414 72 212Z', copper, .84, .75) + drain(300, 292)
    case 6: return p('M71 139L127 59 230 74 305 49 428 78 513 136 546 238 519 342 446 406 318 424 208 399 99 353 61 254Z', wood) + e(297, 231, 207, 154, 'none', '#C5AF82', 4) + e(286, 227, 183, 132, 'none', '#8E7953', 2) + bowl(286, 231, 158, 112, wood) + e(467, 337, 24, 13, 'none', '#715C3E', 2)
    case 7: return legs(62, 113, 476, 278) + board(44, 115, 512, 280) + line('M55 78h490M96 78v37M219 78v37M342 78v37M464 78v37', '#A48F67', 9) + bowl(216, 257, 132, 109, wood) + e(442, 252, 76, 81, '#B49A6C') + e(442, 252, 49, 53, '#5D7163', '#D0BB95', 4)
    case 8: return line('M300 418V215M300 306Q144 360 78 281M300 304Q448 359 519 279', '#8B9D72', 16) + basin('M43 221Q178 49 339 89Q475 98 554 222Q418 383 260 367Q121 350 43 221Z', '#A8B18D', .81, .71) + drain(300, 245)
    case 9: return [foot(92, 143, metal), foot(507, 143, metal), foot(92, 343, metal), foot(507, 343, metal)].join('') + basin('M139 66H462L552 241 462 414H139L47 241Z', stone, .75, .71) + p('M145 80h305M71 241l76 146', 'none', '#CBC6A2', 3) + drain()
    case 10: return p('M72 94Q300 44 528 94L552 341Q299 420 48 341Z', wood) + line('M77 144L42 99 76 64M54 116l-24 1M524 144l35-45-35-35M546 116l24 1', '#B7AD88', 12) + bowl(180, 243, 112, 122, stone) + bowl(420, 243, 112, 122, stone) + board(279, 134, 42, 217)
    case 11: return basin('M93 102Q230 22 397 80Q564 142 522 304Q487 439 315 418Q158 400 97 309Q35 213 93 102Z', '#B6AE88', .82, .8) + p('M435 156Q297 74 181 167Q104 254 210 328Q306 381 382 292Q430 228 360 187Q300 157 256 213Q230 257 276 276', 'none', '#8B9B80', 6) + drain(297, 239)
    case 12: return basin('M300 50Q442 27 453 183Q598 259 481 363Q377 423 299 327Q211 427 112 358Q7 255 151 182Q153 30 300 50Z', '#BEC0A0', .8, .76) + drain(300, 247)
    case 13: return p('M99 66H501L554 239 501 414H99L47 239Z', stone) + bowl(208, 243, 120, 142, stone) + bowl(443, 243, 71, 94, stone) + r(347, 163, 24, 170, '#6B7A6A', 7, '#C9C6A3', 3) + bolt(77, 241) + bolt(527, 241)
    case 14: return p('M59 104H541V255Q520 434 300 430Q79 434 59 255Z', wood) + bowl(300, 239, 142, 141, wood) + board(80, 145, 53, 159, 10) + board(468, 145, 53, 159, 10) + grain(193, 391, 212, 15, 2)
    case 15: return p('M40 209L98 136 177 183 242 91H360L421 183 503 137 561 209 513 353H87Z', stone) + basin('M100 228Q184 138 304 173Q425 137 500 228Q415 386 300 335Q185 386 100 228Z', stone, .9, .7) + e(300, 119, 39, 37, '#8C9B82') + p('M277 141l23 29 23-29', '#677D68', '#B3B99A', 2) + drain(300, 273)
    case 16: return basin('M72 64H528V228Q528 414 300 417Q72 414 72 228Z', porcelain, .85, .75) + tap(300, 92) + drain(300, 290)
    case 17: return e(300, 352, 66, 70, '#9BAA94', '#C2C5AA', 2) + basin('M67 235Q68 65 300 65Q532 65 533 235Q533 406 300 406Q67 406 67 235Z', porcelain, .87, .73) + tap(300, 82, false) + drain(300, 296)
    case 18: return legs(57, 92, 486, 307, metal) + r(55, 77, 490, 319, stone, 8) + bowl(178, 249, 102, 123, porcelain) + bowl(422, 249, 102, 123, porcelain) + tap(178, 86) + tap(422, 86)
    case 19: return basin('M67 61H537V104Q506 384 67 419Z', porcelain, .81, .76) + tap(465, 89, false) + drain(297, 257)
    case 20: return r(49, 75, 502, 330, stone, 7) + p('M70 109l78 23 56-19M457 313l35 47-26 23', 'none', '#89967D', 2) + bowl(237, 249, 137, 139, porcelain) + tap(237, 87) + r(430, 182, 77, 115, '#AAB49B', 22, '#7D8D78', 3)
    case 21: return board(53, 69, 494, 344, 10) + bowl(300, 251, 162, 133, porcelain) + tap(300, 89) + r(76, 137, 32, 208, '#A2916B', 8) + r(490, 137, 32, 208, '#A2916B', 8)
    case 22: return p('M39 139H76V101H116V66H484V101H524V139H561V341H524V379H484V414H116V379H76V341H39Z', stone) + basin(polygon(300, 240, 188, 154, 8), porcelain, .83, .72) + tap(300, 89) + drain(300, 284)
    case 23: return basin('M43 89H557V402H43Z', porcelain, .89, .68) + r(289, 154, 22, 184, '#A9B9A2', 9, '#8E9D86', 2) + tap(176, 89) + tap(422, 89) + drain(176, 282) + drain(422, 282)
    default: throw new Error('未知盥洗台构造。')
  }
}

function toilet(i: number): string {
  const seat = (x: number, y: number, rx: number, ry: number, material = wood) => e(x, y, rx, ry, material) + e(x, y + 5, rx * .62, ry * .68, '#3F534A', '#B8B698', 2.7) + p(`M${x-rx*.6} ${y-ry*.72}q${rx*.65} ${-ry*.2} ${rx*1.25} 0`, 'none', '#D7CEAC', 2)
  const tank = (x: number, y: number, w: number, h: number) => r(x, y, w, h, porcelain, 15) + r(x + 11, y + 8, w - 22, h - 16, 'none', 13, '#D7D9BC', 2)
  switch (i) {
    case 0: return legs(121, 97, 358, 282) + board(111, 85, 378, 310) + handle(477, 241, 90) + seat(300, 240, 156, 135, copper)
    case 1: return board(93, 61, 414, 357) + board(93, 37, 414, 52) + seat(286, 258, 135, 137) + board(436, 124, 71, 262, 16)
    case 2: return legs(49, 98, 502, 288) + board(38, 80, 524, 320) + seat(216, 240, 117, 124) + p('M418 94v292', 'none', '#736245', 5)
    case 3: return r(44, 62, 512, 356, stone, 12) + [93, 398].map(x => scrub(x, 120, 108, 250, stone)).join('') + p('M266 107Q300 75 334 107L342 328Q300 384 257 328Z', '#40564D', '#A3AF97', 5) + p('M300 102V68', 'none', '#6B8070', 7)
    case 4: return board(55, 49, 490, 382, 3) + p('M151 54v373M253 54v373M352 54v373M452 54v373', 'none', '#766A4E', 2) + board(94, 120, 111, 249) + board(396, 120, 111, 249) + p('M262 125Q300 91 338 125V337Q300 366 262 337Z', '#43584C', '#BCAC86', 5)
    case 5: return line('M90 102L510 378M510 102L90 378', '#A39878', 18) + p('M110 112L469 91 508 356 138 388Z', '#8B8264') + seat(305, 239, 124, 132, '#ACA17A') + [[143, 132], [450, 115], [483, 338], [158, 369]].map(([x, y]) => bolt(x, y)).join('')
    case 6: return r(61, 64, 478, 360, stone, 7) + p('M88 83h424M92 409h416M65 162h80M458 323h75', 'none', '#B9BCA0', 3) + seat(300, 252, 158, 142, stone) + r(91, 44, 418, 45, stone, 3)
    case 7: return legs(42, 96, 516, 290) + board(33, 75, 534, 329) + seat(169, 242, 102, 123) + seat(432, 242, 102, 123) + board(291, 86, 19, 301, 2)
    case 8: return line('M99 367L300 73 501 367M300 73v338', '#87986B', 16) + p('M58 240Q144 63 318 82Q487 102 549 238Q419 396 261 397Q139 383 58 240Z', '#A9AE87') + seat(293, 248, 133, 127, '#A2AA82')
    case 9: return p('M128 65H470L554 240 470 416H128L44 240Z', stone) + seat(300, 243, 168, 140, metal) + bolt(97, 241) + bolt(503, 241) + r(241, 56, 118, 45, '#72836E', 7)
    case 10: return line('M74 362L300 60 526 362Z', '#BEB28C', 25) + p('M115 142L472 120 503 345 150 384Z', '#8D8262') + seat(307, 254, 135, 111, '#B0A27B') + p('M137 152l21 21m-20-7 21 21M459 132l-18 20m27-12-17 20M159 365l22-20M482 329l-23-2', 'none', '#D6C59B', 3)
    case 11: return p('M122 86Q262 20 419 77Q569 129 536 295Q502 443 329 419Q161 405 106 312Q41 205 122 86Z', '#B8AF88') + e(303, 243, 165, 146, 'none', '#909E82', 13) + seat(292, 245, 132, 119, '#B5BA9B') + p('M436 135Q281 70 205 139', 'none', '#D8CCAA', 4)
    case 12: return p('M300 55Q410 49 445 153Q557 176 530 281Q507 385 400 380Q300 445 199 380Q91 388 68 278Q48 174 153 153Q190 48 300 55Z', porcelain) + seat(301, 259, 141, 130, porcelain) + p('M165 123q66-35 76 36M357 158q20-65 79-32', 'none', '#B4BE9A', 5)
    case 13: return p(polygon(300, 240, 242, 197, 8), stone) + r(167, 120, 266, 241, metal, 64) + r(208, 152, 184, 181, '#405A4E', 56, '#C9C9AB', 4) + handle(73, 241, -90) + handle(528, 241, 90) + bolt(134, 123) + bolt(468, 356)
    case 14: return ob(300, 244, 232, 180, wood, '#8B825F', true) + seat(278, 248, 138, 124) + board(444, 140, 60, 215, 23) + p('M108 151l28-17M463 365l24-20', 'none', '#D5BD91', 2)
    case 15: return p('M300 39L488 147V409H112V147Z', stone) + p('M300 68L456 164V380H144V164Z', 'none', '#B7B79B', 4) + seat(300, 272, 135, 123, stone) + p('M300 58v88', 'none', '#8A9B80', 5)
    case 16: return tank(123, 28, 354, 89) + line('M300 117v65', '#B3B49B', 13) + e(300, 304, 179, 144, porcelain) + seat(300, 303, 141, 113, porcelain) + p('M465 80h43l-9 33', 'none', '#A4AA91', 7)
    case 17: return tank(105, 53, 390, 123) + r(240, 155, 120, 78, porcelain, 15) + e(300, 293, 181, 135, porcelain) + seat(300, 296, 143, 109, porcelain) + bolt(462, 101)
    case 18: return tank(151, 42, 298, 56) + p('M184 88H416L475 296Q463 426 300 430Q136 426 124 296Z', porcelain) + seat(300, 269, 151, 129, porcelain)
    case 19: return p('M78 57H523V91L366 259Z', porcelain) + g('rotate(-37 300 260)', e(300, 286, 142, 154, porcelain) + seat(300, 282, 112, 124, porcelain)) + p('M474 86l41 20', 'none', '#B7B598', 8)
    case 20: return line('M300 54v83', '#A8B09A', 14) + p('M221 112H379L465 267Q459 424 300 430Q140 424 135 267Z', porcelain) + r(156, 150, 287, 248, wood, 84) + r(210, 191, 179, 161, '#40564C', 57, '#B6BB9C', 4) + p('M179 204q17-33 48-34', 'none', '#D9C198', 2)
    case 21: return r(48, 74, 504, 332, porcelain, 33) + [83, 402].map(x => scrub(x, 104, 115, 262, porcelain)).join('') + p('M265 117Q300 85 335 117V322Q300 377 265 322Z', '#405A4E', '#A3B5A0', 6) + r(265, 66, 70, 45, porcelain, 10)
    case 22: return tank(124, 49, 352, 80) + basin('M112 128H488V253Q488 419 300 419Q112 419 112 253Z', porcelain, .82, .73, '#9CAF9B') + p('M220 146v112M260 146v142M300 146v156M340 146v142M380 146v112', 'none', '#839E8B', 3) + drain(300, 332)
    case 23: return basin('M109 107Q300 49 491 107L474 295Q460 427 300 427Q140 427 126 295Z', porcelain, .8, .74, '#A4B7A4') + tap(300, 92) + drain(300, 296)
    default: throw new Error('未知便器构造。')
  }
}

function laundry(i: number): string {
  const long = 'M53 81H547V397H53Z'
  switch (i) {
    case 0: return handle(83, 240, -90) + handle(517, 240, 90) + ob(300, 241, 220, 176, wood, water, true) + g('rotate(-16 300 240)', scrub(224, 118, 147, 247))
    case 1: return board(38, 63, 524, 353) + basin(long, wood, .86, .75) + scrub(393, 126, 109, 226) + r(31, 93, 30, 34, wood, 3) + r(538, 357, 30, 34, wood, 3) + ripple(224, 241)
    case 2: return r(40, 58, 520, 364, stone, 5) + basin('M58 84H293V396H58Z', stone, .86, .76) + basin('M307 84H542V396H307Z', stone, .86, .76) + scrub(69, 290, 208, 99, stone) + scrub(323, 290, 208, 99, stone)
    case 3: return p('M49 141L109 76 201 84 318 57 432 88 523 103 551 211 533 318 551 369 462 412 352 392 230 417 124 388 52 328Z', wood) + basin('M82 127H479L512 302 474 370H82Z', wood, .85, .73) + board(85, 292, 418, 84) + p('M70 133l34-34M500 107l19 34M523 365l-32 20', 'none', '#D5BC8B', 2)
    case 4: return p('M50 124L156 58 274 86 415 57 526 109 553 227 523 360 391 410 233 391 91 414 42 296Z', stone) + basin('M99 129Q300 82 496 146V306Q305 371 99 316Z', stone, .83, .76) + scrub(103, 277, 391, 98, stone) + p('M61 179l31 26-33 44M445 78l-25 44', 'none', '#6C7E68', 3)
    case 5: return handle(63, 240, -90, '#B39871') + handle(537, 240, 90, '#B39871') + ob(300, 241, 233, 163, copper) + p('M421 81l-5 41 48 1', 'none', '#DEC39A', 6) + ripple()
    case 6: return ob(300, 240, 240, 179, '#A69B72', '#9BA88C', true) + p(rep(22, n => `M${85+n*20} ${132+Math.abs(11-n)*5}v${210-Math.abs(11-n)*10}`), 'none', '#C4B187', 1.2) + basin('M85 200Q160 101 300 116Q445 98 515 201L494 340 300 380 104 342Z', '#8B8261', .91, .8) + line('M105 351q195 65 390-2', '#C4B38A', 7) + ripple()
    case 7: return r(30, 55, 540, 371, stone, 4) + basin('M48 76H552V397H48Z', stone, .92, .72) + [58, 237, 417].map(x => scrub(x, 280, 125, 117, stone)).join('') + p('M549 164h20', 'none', '#607D6B', 7)
    case 8: return basin('M34 242Q160 71 326 81Q475 94 566 238Q417 415 256 400Q119 381 34 242Z', '#A7AE87', .85, .75) + line('M94 242Q301 175 514 237', '#A4AF86', 7) + scrub(376, 217, 82, 90, '#A5AE88') + ripple(209, 251)
    case 9: return basin('M118 61H480L556 241 480 420H118L42 241Z', stone, .82, .73) + scrub(392, 147, 105, 197, copper) + bolt(84, 240) + bolt(515, 240) + ripple(220, 242)
    case 10: return line('M80 103L520 378M520 103L80 378', '#BFB38C', 18) + basin('M83 131L195 67 303 103 431 77 535 150 511 272 538 354 422 414 297 383 159 408 61 337Z', '#98876A', .82, .75) + g('rotate(-14 308 254)', scrub(220, 123, 155, 244)) + p('M102 127l13 17m-5-26 13 18M492 357l-12-21m21 18-12-21', 'none', '#D9C69E', 2)
    case 11: return basin('M54 232Q40 101 193 91Q295 70 323 182Q429 82 516 151Q581 245 503 350Q429 419 334 364Q289 348 281 292Q186 403 101 341Q55 313 54 232Z', '#B7AE89', .81, .77) + scrub(103, 205, 147, 108, '#B4B594') + ripple(421, 258)
    case 12: return basin('M300 45Q450 42 452 199Q586 302 443 396Q333 442 300 321Q221 442 100 366Q14 260 153 191Q151 41 300 45Z', stone, .81, .76) + g('rotate(29 185 250)', scrub(129, 210, 94, 126, stone)) + ripple(381, 229)
    case 13: return ob(300, 240, 231, 211, stone) + e(300, 240, 93, 87, stone) + [g('rotate(0 300 240)', scrub(260, 57, 80, 73, stone)), g('rotate(90 300 240)', scrub(260, 57, 80, 73, stone)), g('rotate(180 300 240)', scrub(260, 57, 80, 73, stone)), g('rotate(270 300 240)', scrub(260, 57, 80, 73, stone))].join('') + drain(300, 368)
    case 14: return basin('M59 152Q155 62 300 81Q458 59 540 152L526 316Q449 407 299 400Q146 412 73 316Z', wood, .83, .74) + board(68, 126, 45, 232, 17) + board(487, 126, 45, 232, 17) + scrub(193, 300, 213, 71) + ripple(300, 210)
    case 15: return p('M39 166L112 76 194 98 278 55 373 82 474 63 552 150 533 236 557 321 477 403 391 386 283 423 169 391 76 355Z', stone) + basin('M87 134H294L315 328 272 373H87Z', stone, .84, .76) + basin('M322 130H497L519 315 473 369H338Z', stone, .85, .75) + p('M308 81l-15 44 26 53-17 79 21 46-15 95', 'none', '#536F60', 3)
    case 16: return basin(long, porcelain, .84, .73) + tap(300, 87) + scrub(107, 294, 387, 82, porcelain) + drain(300, 239)
    case 17: return r(38, 61, 524, 360, porcelain, 17) + basin('M59 95H289V389H59Z', porcelain, .84, .73) + basin('M311 95H541V389H311Z', porcelain, .84, .73) + tap(176, 83) + tap(424, 83) + drain(176, 287) + drain(424, 287)
    case 18: return r(36, 56, 528, 368, stone, 6) + basin('M73 91H438V391H73Z', stone, .83, .72) + scrub(443, 99, 92, 289, stone) + p('M53 75l13 8M517 409h23M52 343l9 15', 'none', '#D0C9AF', 2.2) + drain(256, 286)
    case 19: return handle(65, 240, -90, '#B4B59A') + handle(535, 240, 90, '#B4B59A') + ob(300, 240, 231, 173, metal) + e(300, 240, 171, 114, 'none', '#BEC6AF', 2) + e(300, 240, 141, 90, 'none', '#728B78', 2) + ripple()
    case 20: return legs(62, 103, 467, 295, metal) + basin('M54 114H530V402H54Z', porcelain, .83, .73) + r(72, 52, 444, 70, metal, 20) + r(83, 62, 423, 23, '#C5C8AC', 10) + r(83, 90, 423, 23, '#7F9782', 10) + line('M516 87h41v55h-25', '#A7AB8B', 7) + drain(300, 285)
    case 21: return tile(31, 51, 538, 379) + basin('M55 101H323V394H55Z', porcelain, .84, .71) + basin('M344 101H506V394H344Z', porcelain, .83, .71) + tap(197, 87) + tap(424, 87) + drain(197, 288) + drain(424, 288)
    case 22: return p('M48 53H551V182H206V427H48Z', porcelain) + basin('M74 82H316V291H74Z', porcelain, .82, .74) + scrub(344, 77, 181, 83, porcelain) + g('rotate(90 133 345)', scrub(75, 307, 116, 77, porcelain)) + tap(193, 85)
    case 23: return basin('M30 80H570V405H30Z', porcelain, .92, .7) + [207, 389].map(x => r(x, 157, 13, 178, '#A3B49B', 5, '#80957D', 1.8)).join('') + [119, 300, 482].map(x => tap(x, 87, false) + drain(x, 292)).join('')
    default: throw new Error('未知洗衣槽构造。')
  }
}

function rack(i: number): string {
  const frame = (x: number, y: number, w: number, h: number, color = '#A08C64', width = 11) => line(`M${x} ${y}h${w}v${h}H${x}Z`, color, width)
  const vertical = (x: number, y: number, w: number, h: number, n: number, color = '#B6A983', width = 5) => rep(n, j => line(`M${x+j*w/(n-1)} ${y}v${h}`, color, width))
  switch (i) {
    case 0: return line('M59 58l65 363M541 58l-65 363M66 353h468', '#9A875E', 16) + frame(79, 91, 442, 282) + slats(86, 111, 428, 242, 6)
    case 1: return frame(69, 69, 462, 342) + slats(76, 106, 448, 267, 7) + ring(65, 85, 17, 24, '#AB9E76', 5) + ring(535, 394, 17, 24, '#AB9E76', 5)
    case 2: return line('M57 70v340M543 70v340M33 82h49M519 399h49', '#95835E', 19) + slats(65, 116, 470, 248, 3, '#BDB18A', 4.3) + [57, 543].map(x => bolt(x, 115) + bolt(x, 240) + bolt(x, 364)).join('')
    case 3: return ring(300, 240, 230, 184, '#A1916B', 10) + rep(8, n => {const a=n*Math.PI/4;return line(`M300 240L${300+228*Math.cos(a)} ${240+182*Math.sin(a)}`, '#B09B71', 7)}) + e(300, 240, 20, 18, wood)
    case 4: return board(43, 43, 514, 44) + vertical(88, 82, 424, 306, 5, '#AA9970', 12) + line('M80 389h440', '#A48F65', 14) + p('M55 98l42 13M542 99l-42 13', 'none', '#D3C199', 3)
    case 5: return line('M300 38L83 416H517Z', '#A18F67', 18) + line('M300 240V40M300 240L85 413M300 240L515 413', '#A18F67', 8) + p(polygon(300, 240, 211, 180, 6), 'none', '#BDB38D', 5) + p(polygon(300, 240, 147, 126, 6), 'none', '#BDB38D', 4) + e(300, 240, 17, 17, wood)
    case 6: return frame(74, 80, 452, 320, '#99865E', 12) + vertical(91, 92, 418, 296, 8, '#B29D72', 4) + slats(85, 105, 430, 270, 7, '#B4A079', 4) + line('M49 65l47 31M550 60l-44 37M48 424l51-36M552 429l-42-41', '#897F5B', 10)
    case 7: return board(51, 61, 67, 356) + board(482, 61, 67, 356) + slats(82, 102, 437, 275, 5, '#B6A17A', 10) + [93, 507].map(x=>p(`M${x-10} 93l20 17m-20-8 20 17M${x-10} 358l20 17m-20-8 20 17`, 'none', '#CFBE96', 3)).join('')
    case 8: return line('M43 240Q160 67 318 80Q480 103 557 240Q421 410 270 398Q123 380 43 240Z', '#8C9E72', 12) + line('M49 242Q303 180 550 240', '#ABB78E', 11) + rep(6,n=>{const x=112+n*73, xx=x+(300-x)*.14, mid=quadraticY(x,49,242,303,180,550,240), top=xx<318?quadraticY(xx,43,240,160,67,318,80):quadraticY(xx,318,80,480,103,557,240), bottom=xx<270?quadraticY(xx,43,240,123,380,270,398):quadraticY(xx,270,398,421,410,557,240);return line(`M${x} ${mid}L${xx} ${top+4}M${x} ${mid}L${xx} ${bottom-4}`, '#A3B084', 5)})
    case 9: return p(polygon(300, 240, 244, 203, 6), 'none', '#555E52', 15) + p(polygon(300, 240, 244, 203, 6), 'none', '#9DA88D', 10) + rep(3,n=>p(polygon(300, 240, 80+n*52, 63+n*44, 6), 'none', '#C0BA96', 4)) + rep(6,n=>{const a=-Math.PI/2+n*Math.PI/3;return line(`M300 240L${300+240*Math.cos(a)} ${240+198*Math.sin(a)}`, '#A8AF92', 6)}) + e(300, 240, 18, 17, metal)
    case 10: return line('M56 90L89 402M547 80L510 409M39 91l52 4M520 80l43 8', '#C0B48D', 17) + slats(74, 121, 451, 233, 4, '#B8A785', 4.5) + p('M61 105l25 13m-24-2 26 13M522 96l22-7m-22 18 23-7', 'none', '#8E7958', 3)
    case 11: return rep(5,n=>g(`rotate(${72*n} 300 240)`, p('M300 240Q156 139 245 48Q327 66 300 240', 'none', '#96A67A', 9))) + rep(5,n=>g(`rotate(${72*n} 300 240)`, line('M300 240L245 48', '#C0BA91', 4))) + e(300, 240, 24, 23, '#B5B792')
    case 12: return line('M50 300Q183 38 549 155M50 300Q280 425 549 155', '#9EAA80', 13) + rep(7,n=>{const x=99+n*65,top=quadraticY(x,50,300,183,38,549,155)+4,bottom=quadraticY(x,50,300,280,425,549,155)-4;return line(`M${x} ${top}v${bottom-top}`, '#BCB994', 6)})
    case 13: return p(polygon(300, 240, 231, 210, 8), 'none', '#7F9277', 13) + p(polygon(300, 240, 189, 168, 8), 'none', '#B7BB96', 6) + rep(8,n=>{const a=-Math.PI/2+n*Math.PI/4,b=a+Math.PI*.75;return p(`M${300+231*Math.cos(a)} ${240+210*Math.sin(a)}L${300+189*Math.cos(b)} ${240+168*Math.sin(b)}`, 'none', '#BBB28A', 4)}) + legs(137, 92, 326, 296, metal)
    case 14: return frame(249, 93, 102, 294, '#B29F75', 9) + line('M249 92Q61 45 45 240Q57 433 249 387M351 92Q539 45 555 240Q543 433 351 387', '#A89870', 11) + rep(6,n=>{const y=134+n*212/5, x=50+Math.abs(y-240)*.18; return line(`M${x} ${y}H245M355 ${y}H${600-x}`, '#BEB08B', 5)})
    case 15: return line('M72 113l44 242M526 113l-44 242M72 113L43 63M72 113l15-64M72 113l-46 9M116 355l-16 62M116 355l43 42M526 113l30-50M526 113l-15-64M526 113l47 9M482 355l17 62M482 355l-43 42', '#B4AD86', 11) + slats(83, 136, 430, 191, 4, '#BFB38E', 4)
    case 16: return line('M66 60l73 360M534 60l-73 360', '#9CA88D', 13) + frame(77, 86, 446, 307, '#ABB79A', 11) + slats(87, 115, 426, 251, 6, '#B9C1A7', 5) + bolt(99, 240) + bolt(502, 240)
    case 17: return frame(230, 68, 140, 342, '#A8B499', 8) + frame(39, 119, 188, 240, '#B3BCA0', 9) + frame(373, 119, 188, 240, '#B3BCA0', 9) + slats(49, 145, 168, 187, 7, '#B9C1A7', 3.5) + slats(383, 145, 168, 187, 7, '#B9C1A7', 3.5) + slats(240, 97, 120, 283, 8, '#B9C1A7', 3.5)
    case 18: return line('M300 46V434M81 240H519', '#9EAD91', 14) + rep(3,n=>frame(108+n*48, 57+n*45, 384-n*96, 366-n*90, '#C0BE9A', 3.4)) + e(300, 240, 21, 21, metal)
    case 19: return board(42, 32, 516, 37) + [84, 516].map(x=>p(`M${x} 71l-31 61 31 61-31 61 31 61-31 61M${x-31} 71l31 61-31 61 31 61-31 61 31 61`, 'none', '#A9B59B', 6)).join('') + slats(84, 101, 432, 269, 5, '#BCC5AA', 8)
    case 20: return p('M68 81Q10 240 68 399M532 81Q590 240 532 399', 'none', '#899B83', 12) + slats(57, 91, 486, 297, 6, '#BAA47A', 10) + [55,545].map(x=>ring(x, 72, 15, 22, '#B7B89B', 5) + ring(x, 408, 15, 22, '#B7B89B', 5)).join('')
    case 21: return ring(300, 240, 218, 174, '#B5C0A2', 7) + ring(300, 240, 175, 140, '#9BAE91', 5) + rep(12,n=>{const a=n*Math.PI/6;return line(`M300 240L${300+216*Math.cos(a)} ${240+172*Math.sin(a)}`, '#A5B599', 3.5)+g(`translate(${300+218*Math.cos(a)} ${240+174*Math.sin(a)}) rotate(${n*30+90})`,r(-6,-16,12,32,'#C0B38D',3)+p('M-4 1h8','none','#6C7C66',2))}) + e(300, 240, 17, 17, metal)
    case 22: return line('M81 126v-39q0-47 59-47M519 126v-39q0-47-59-47', '#B5BFA2', 12) + frame(82, 124, 436, 278, '#ABB89B', 9) + slats(92, 149, 416, 222, 4, '#BEC6A9', 7)
    case 23: return [[70,72],[530,72],[70,408],[530,408]].map(([x,y])=>r(x-15,y-22,30,44,'#687D6A',9)+r(x-8,y-16,16,32,'#9CAA8E',5)).join('') + frame(79, 77, 442, 326, '#A4B598', 12) + slats(89, 102, 422, 277, 6, '#BDC5A9', 8) + line('M542 118h18v245h-18', '#A2B195', 10)
    default: throw new Error('未知晾衣架构造。')
  }
}

function ewer(i: number): string {
  const jug = (body: string, material: string, handleD: string, mouth: string) => line(handleD, '#A59974', 18) + p(body, material) + p(mouth, '#5A6B5C', '#D4C49F', 4)
  switch (i) {
    case 0: return jug('M224 113Q364 63 430 184Q497 310 374 394Q211 439 140 312Q108 238 171 177L83 75 209 124Z', '#AE9D77', 'M418 174Q578 161 530 323Q489 394 416 352', 'M174 134L101 90 183 175Z') + ob(288, 239, 85, 81, '#B09C76', '#7E8870') + p('M185 274q21 66 74 76', 'none', '#D6BD91', 3)
    case 1: return ob(300, 240, 219, 175, wood, water, true) + line('M101 236Q103 64 300 61Q499 64 499 236', '#AA9870', 17) + ripple()
    case 2: return jug('M211 123Q305 58 409 138Q509 237 438 358Q355 433 222 379Q128 325 166 210L100 102 211 158Z', copper, 'M438 171Q560 165 535 292Q513 349 453 326', 'M174 177L124 126 191 204Z') + e(301, 225, 87, 85, copper) + e(301, 225, 23, 21, '#AA9A73') + p('M240 202q34-35 76-29', 'none', '#DFC199', 3)
    case 3: return jug('M43 104Q196 107 251 58Q430 55 491 220Q537 353 379 409Q225 443 157 320L107 198Z', '#9EAD83', 'M471 184Q581 152 553 288Q527 344 474 325', 'M83 136L186 178 151 207Z') + p('M159 181Q279 119 438 310M260 144l-6 67m100 38 60-4', 'none', '#C5CEAA', 5) + e(300, 238, 45, 48, '#788E70', '#C1C9A1', 3)
    case 4: return jug('M184 106L384 74 492 197 463 346 285 417 150 320 154 205 70 117Z', metal, 'M460 164L543 139 561 287 472 329', 'M105 134L165 156 159 184Z') + p('M184 106L285 188 384 74M285 188v229M285 188l207 9M285 188L150 320', 'none', '#CFCCAA', 3) + e(302, 204, 32, 29, '#849C82', '#D1CAAA', 3)
    case 5: return jug('M182 101Q309 36 446 135Q564 255 444 374Q278 453 161 336Q99 268 158 181L68 112Z', '#B8B08B', 'M443 157Q556 127 552 238Q542 310 484 314', 'M99 127L164 148 148 177Z') + p('M406 177Q266 89 201 209Q154 317 272 345Q377 361 395 263Q406 193 334 187Q284 185 269 230Q264 269 301 271', 'none', '#8B9E80', 9)
    case 6: return jug('M189 108Q299 43 414 119Q512 203 459 340Q365 434 224 383Q126 327 159 208L96 103Z', porcelain, 'M441 162Q572 149 545 291Q520 358 460 333', 'M119 125L185 147 165 183Z') + e(300, 231, 105, 103, '#9AAE96', '#D9D5B4', 5) + p('M221 201q23-38 77-41', 'none', '#E5DFC1', 4)
    case 7: return jug('M181 111L285 74 402 111 468 215 430 346 300 403 175 352 135 222 91 126Z', '#A2BAA8', 'M445 164Q569 134 548 274Q525 340 459 316', 'M118 142L176 155 152 191Z') + p('M181 111l57 112 47-149M238 223l-63 129M238 223l62 180 61-180 41-112M361 223l69 123M238 223h123', 'none', '#D8DBC0', 5) + e(298, 226, 49, 53, '#819F8B', '#D6D8B9', 3)
    default: throw new Error('未知水壶构造。')
  }
}
const stitch = (x: number, y: number, w: number, h: number) => p(rep(Math.floor(w/12),n=>`M${x+n*12} ${y}h5M${x+n*12} ${y+h}h5`)+rep(Math.floor(h/12),n=>`M${x} ${y+n*12}v5M${x+w} ${y+n*12}v5`),'none','#D8CCAA',1.3)
const cloth = (x: number, y: number, w: number, h: number, color='#ADA583') => r(x,y,w,h,color,7,'#85866B',2) + stitch(x+9,y+10,w-18,h-20) + p(`M${x+13} ${y+23}q${w*.2} 3 ${w*.37} 0M${x+w*.59} ${y+h-26}q${w*.2} -4 ${w*.32} 0`, 'none', '#CFC3A1',2)
const roll = (x: number, y: number, w: number, h: number) => r(x,y,w,h,'#BCB494',h*.3,'#898C72',2) + e(x+17,y+h/2,18,h/2-4,'#C9BFA0','#878D72',2)+e(x+17,y+h/2,9,h/2-13,'#A0A488','#757E65',1.5)+p(`M${x+34} ${y+14}q${w*.38} -4 ${w-52} 0`, 'none','#DDD1AF',2)
function towel(i: number): string {
  switch(i) {
    case 0: return p('M61 100L189 82 303 96 427 81 540 106 533 367 420 393 298 379 170 397 57 370Z','#B7AE8B','#85866B',2)+stitch(77,111,443,252)+p(rep(18,n=>`M${76+n*26} 381v20M${76+n*26} 95v-18`),'none','#C6BD9B',3)+p(rep(17,n=>`M${81+n*26} 125v232`),'none','#C8BC9A',.8)
    case 1: return g('rotate(-9 300 240)',roll(70,100,460,262))+line('M249 91l-10 272M367 91l7 272','#9E916C',6)+p('M205 300l-57 84 126-25Z','#D0C29E','#898B70',2)
    case 2: return cloth(64,104,467,297,'#968F70')+cloth(91,78,457,287,'#B1A786')+cloth(57,119,441,295,'#C1B598')+p('M61 136q145-18 291-7M490 159v181','none','#D8CCAA',3)
    case 3: return p('M46 128Q155 72 283 100Q406 64 554 117L526 353Q408 415 296 381Q176 414 71 366Z','#A9AF89','#7C8C6A',2)+p('M79 143Q180 104 284 128Q420 95 523 137M91 350Q190 389 294 355Q412 389 510 340','none','#D0CAA7',6)+p('M96 132l-37-46M515 127l39-45M104 361l-43 37M498 358l46 42','none','#ACA27C',7)+p('M215 139q91 59 158 0M215 332q91-59 158 0','none','#798D68',3)
    case 4: return p('M93 128L160 68 227 101 299 58 377 93 440 69 508 128 535 214 511 292 535 355 458 404 382 375 302 418 224 380 144 408 79 355 100 283 62 216Z','#A49A78','#766E52',2)+rep(70,n=>{const x=126+n%10*38,y=119+Math.floor(n/10)*38;return p(`M${x} ${y}q7-4 14 3m-10 3 10 2`,'none',n%3?'#C5B693':'#857B5B',1.5)})+p('M87 145l36 15M511 145l-28 19M118 376l25-23M489 372l-23-24','none','#D9C69D',3)
    case 5: return cloth(62,105,476,265,'#B4AA85')+p(rep(21,n=>`M${74+n*22} 111l12 14-12 14 12 14M${74+n*22} 323l12 14-12 14 12 14`),'none','#7E8C69',3)+p(rep(16,n=>`M${82+n*28} 369v34l8-10m-8 2-6 8M${82+n*28} 106V73l8 10m-8-2-6-8`),'none','#B6AB84',4)
    case 6: return cloth(58,98,483,288,'#AEB79B')+cloth(65,118,472,269,'#BCC3A7')+p('M80 333h441M80 345h441M80 157h441M80 169h441','none','#8FA187',3)+p('M438 120h98v79Z','#D2CFB0','#98A68A',2)+rep(65,n=>p(`M${91+n%13*33} ${194+Math.floor(n/13)*24}q4-4 8 0`, 'none', '#D3D0AE',1.4))
    case 7: return ob(300,240,246,180,wood,'#8D987B')+[roll(107,119,385,71),roll(110,206,382,71),roll(107,293,386,71)].join('')
    default: throw new Error('未知布草构造。')
  }
}
function cleaning(i: number): string {
  const broom = (color='#A79973') => line('M300 43v233', '#AC9264', 19)+p('M263 242L337 242 494 419Q300 458 106 419Z',color,'#837D5C',2)+rep(28,n=>{const x=118+n*13.3;return p(`M${273+n*2} 254L${x} ${413+Math.sin(n)*11}`,'none',n%3?'#C8BD94':'#93875D',1.7)})+line('M260 264h80M249 282h102','#B6A075',6)
  switch(i) {
    case 0: return broom()
    case 1: return e(300,240,246,159,'#797C5B','#535C48',2)+rep(43,n=>{const a=n*Math.PI/21.5;return p(`M${300+234*Math.cos(a)} ${240+151*Math.sin(a)}l${12*Math.cos(a)} ${12*Math.sin(a)}`,'none','#C4BA92',3)})+ob(300,240,215,127,wood,'#AE9870')+line('M217 241q82-146 166 0','#BFA77B',24)+p('M234 215q65-79 131 0','none','#DFC69C',2)
    case 2: return p('M57 147Q56 115 99 108H360L393 163H536V309H393L360 371H98Q55 367 57 333Z',wood)+grain(77,137,257,200,16)+e(500,238,20,29,'#4F6353','#C8B58C',3)+p('M376 166v145','none','#CBB48A',4)
    case 3: return g('rotate(7 300 240)',broom('#A6AC82'))+p('M300 65q-42 60-8 122','none','#D5C397',3)+rep(9,n=>p(`M${168+n*33} 356l-21 39m18-25 10 24`,'none','#667D59',2))
    case 4: return p('M63 281Q100 69 300 64Q501 69 537 281Q487 417 300 420Q112 417 63 281Z','#AAA98A')+rep(11,n=>{const x=96+n*41;return p(`M300 92L${x} ${280+65*Math.sin(n*Math.PI/10)}`,'none','#D1C7A5',3)})+p(rep(30,n=>`M${81+n*15} ${330+Math.sin(n/29*Math.PI)*65}l-5 16`),'none','#7E8968',4)+line('M217 253q83-140 167 0','#A6B28C',24)
    case 5: return p('M46 100H301L361 173H528L550 206V293L526 325H361L301 398H46Z',metal)+p('M64 122H283L328 174V325L281 375H64Z','#A7B198','#6E826D',3)+line('M375 191Q480 144 525 204V280Q449 323 374 277Z','#C2B692',18)+p('M356 180v145','none','#C3C3A0',3)
    case 6: return line('M300 35v256','#B09A71',18)+r(147,267,306,50,metal,8)+rep(25,n=>{const x=159+n*11.8;return p(`M${x} 312q${n%2?19:-18} 52 ${n%2?6:-7} ${86+n%5*8}`,'none',n%3?'#C9C3A1':'#9BA487',7)})+p('M164 280h270','none','#DFD1AC',2)
    case 7: return line('M300 435V241','#AE9368',17)+ring(242,152,89,109,'#B4A178',13)+ring(359,152,89,109,'#B4A178',13)+ring(300,218,99,100,'#BBA77B',12)+p('M284 313h32m-32 9h32M293 390h14','none','#D7C099',3)
    default: throw new Error('未知清洁工具构造。')
  }
}

export const WASH_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Wash-Collection-1'
export const WASH_COLLECTION_LICENSE = `Sceneweave Wash Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG drawings of washing, bathing, sanitation and laundry equipment, authored with coding assistance. No third-party art or image pixels are included. Illustrative period/fantasy interpretations; technical validation and art review are separate. Decorative sanitation fixtures do not create actual plumbing or building geometry.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const defs = `<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="88%" y2="100%"><stop offset="0%" stop-color="#BDA77D"/><stop offset="42%" stop-color="#A48C61"/><stop offset="100%" stop-color="#776849"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#BDC1A8"/><stop offset="48%" stop-color="#9FAA91"/><stop offset="100%" stop-color="#7B8C77"/></linearGradient>
<linearGradient id="copper" x1="0%" y1="0%" x2="95%" y2="100%"><stop offset="0%" stop-color="#C4AA7F"/><stop offset="23%" stop-color="#B8996A"/><stop offset="55%" stop-color="#9E895F"/><stop offset="100%" stop-color="#797451"/></linearGradient>
<linearGradient id="porcelain" x1="0%" y1="0%" x2="80%" y2="100%"><stop offset="0%" stop-color="#E2DEC4"/><stop offset="38%" stop-color="#CFD3B9"/><stop offset="100%" stop-color="#A1B39C"/></linearGradient>
<linearGradient id="water" x1="0%" y1="0%" x2="70%" y2="100%"><stop offset="0%" stop-color="#69877A"/><stop offset="20%" stop-color="#8DA898"/><stop offset="66%" stop-color="#A6B6A0"/><stop offset="100%" stop-color="#7D9A86"/></linearGradient>
<linearGradient id="metal" x1="0%" y1="0%" x2="86%" y2="100%"><stop offset="0%" stop-color="#BFC8AF"/><stop offset="30%" stop-color="#A3B49A"/><stop offset="55%" stop-color="#879C84"/><stop offset="100%" stop-color="#647D69"/></linearGradient>
</defs>`
function artwork(design: WashDesign, i: number): VisualSampleArt {
  const detail = ['ewer','towel','cleaning-tool'].includes(design.category)
  const body = ({ bathtub, washstand, toilet, 'laundry-trough': laundry, 'drying-rack': rack, ewer, towel, 'cleaning-tool': cleaning }[design.category])(i)
  return { key: design.key, name: design.name, kind: 'prop', widthMm: design.widthMm, heightMm: design.heightMm,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm/600} ${design.heightMm/480})">${body}</g></svg>`,
    footprintMm: { width: Math.round(design.widthMm*.9), height: Math.round(design.heightMm*.9) }, blocksMovement: !detail, blocksSight: false,
    renderLayer: 'object', shadowClass: detail ? 'none' : 'furniture', tags: ['原创','卫浴清洁',design.category,design.era,design.design,'俯视','独立装饰物件','不自动生成管道或建筑'] }
}
export const WASH_COLLECTION_ART: readonly VisualSampleArt[] = freezeJson(WASH_DESIGNS.map(design => artwork(design, WASH_DESIGNS.filter(row => row.category === design.category).findIndex(row => row.key === design.key))))
