import { FURNITURE_CATEGORIES, FURNITURE_STYLES, furnitureKey, type FurnitureCategory, type FurnitureStyle } from '../assets/furniture-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

/** Original top-down construction drawings. Each category has 24 explicitly
 * different plans; shared material/linen marks do not determine membership.
 * No reference pixels, external images, embedded text or cast shadows. */
const ink = '#3F3935'
const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke = ink, sw = 3) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const path = (d: string, fill: string, stroke = ink, sw = 3) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
const line = (d: string, color = ink, sw = 2) => path(d, 'none', color, sw)
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, stroke = ink, sw = 3) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const repeat = (count: number, draw: (i: number) => string) => Array.from({ length: count }, (_, i) => draw(i)).join('')
const group = (body: string, opacity: number) => `<g opacity="${opacity}">${body}</g>`
const grain = (x: number, y: number, w: number, h: number, p: FurnitureStyle['palette'], vertical = false) => group(repeat(6, i => {
  const at = (i + 1) / 7
  return vertical ? line(`M${x + at * w} ${y}q-5 ${h / 4} 0 ${h / 2}t0 ${h / 2}`, i % 2 ? p[1] : p[2], 1.3)
    : line(`M${x} ${y + at * h}q${w / 4} -3 ${w / 2} 0t${w / 2} 0`, i % 2 ? p[1] : p[2], 1.3)
}), .5)
const rivets = (points: number[][], p: FurnitureStyle['palette']) => points.map(([x, y]) => ellipse(x, y, 3.2, 3.2, p[4], p[2], 1)).join('')
const diamond = (x: number, y: number, r: number, fill: string, stroke = ink) => path(`M${x} ${y - r}l${r} ${r}-${r} ${r}-${r}-${r}Z`, fill, stroke, 2)
const leaf = (x: number, y: number, w: number, h: number, fill: string, stroke = ink) => path(`M${x} ${y + h}Q${x - w} ${y + h / 2} ${x} ${y}Q${x + w} ${y + h / 2} ${x} ${y + h}Z`, fill, stroke, 2)

function linen(x: number, y: number, w: number, h: number, p: FurnitureStyle['palette'], pillows = 1, tailored = false): string {
  const pillowW = (w - 30 - (pillows - 1) * 10) / pillows
  return rect(x, y, w, h, '#D6CCB3', 15, p[2], 2.5)
    + path(`M${x + 5} ${y + 90}Q${x + w * .3} ${y + 83} ${x + w * .55} ${y + 90}T${x + w - 5} ${y + 86}L${x + w - 6} ${y + h - 9}Q${x + w * .6} ${y + h + 2} ${x + 7} ${y + h - 7}Z`, 'url(#cloth)', p[2], 2)
    + repeat(pillows, i => path(`M${x + 15 + i * (pillowW + 10)} ${y + 15}q${pillowW / 2} -8 ${pillowW} 0q8 26 0 54q-${pillowW / 2} 8-${pillowW} 0q-6-27 0-54Z`, '#DED7C1', p[2], 1.6))
    + line(`M${x + 7} ${y + 105}Q${x + w / 2} ${y + 113} ${x + w - 7} ${y + 103}`, p[1], 3)
    + group(repeat(tailored ? 6 : 4, i => {
      const xx = x + 20 + (w - 40) * i / (tailored ? 5 : 3)
      return line(`M${xx} ${y + 120}q${i % 2 ? 7 : -6} ${h / 5} 1 ${h / 3}t-2 ${Math.max(30, h / 3 - 55)}`, i % 2 ? p[2] : p[1], tailored ? 1 : 2)
    }), .35)
    + (tailored ? line(`M${x + 8} ${y + h - 70}h${w - 16}m-${w - 16} 9h${w - 16}`, p[4], 2) : '')
}

function bed(i: number, s: FurnitureStyle): string {
  const p = s.palette, wood = 'url(#wood)', border = p[2], standard = (x = 63, y = 86, w = 274, h = 435, pillows = 1) => linen(x, y, w, h, p, pillows, i >= 16)
  switch (i) {
    case 0: return path('M45 44L353 39L360 556L42 561Z', wood) + repeat(5, n => line(`M${66 + n * 67} 55l-2 490`, border, 2)) + grain(50, 58, 295, 476, p, true) + standard(64, 86, 272, 429) + path('M64 470l37-6 21 19 28-10 35 10 42-8 28 12 30-13 49 9-6 31-32 8-29-12-40 9-45-6-40 9-26-11-25 7Z', '#B9AA73', p[2], 2) + rivets([[53, 57], [344, 52], [53, 543], [348, 542]], p)
    case 1: return rect(38, 32, 324, 535, wood, 10) + rect(58, 62, 284, 475, p[2], 4) + repeat(10, n => line(`M60 ${75 + n * 48}l280 18`, p[1], 3)) + repeat(6, n => line(`M${73 + n * 49} 65l-8 467`, p[1], 3)) + standard(82, 95, 238, 410) + rivets([[45, 44], [354, 44], [45, 555], [354, 555]], p)
    case 2: return rect(40, 35, 320, 535, wood, 10) + standard(62, 75, 276, 395) + rect(48, 480, 304, 75, wood, 4) + line('M57 495h286M143 485v65M259 485v65', border, 2) + rect(172, 508, 55, 10, p[4], 3) + grain(56, 523, 285, 22, p)
    case 3: return rect(72, 30, 256, 540, wood, 3) + rect(78, 42, 244, 22, p[2], 2) + standard(87, 76, 226, 443) + rect(97, 455, 206, 60, 'url(#cloth)', 22) + line('M113 463v42M285 463v42', p[1], 4) + grain(82, 532, 235, 23, p)
    case 4: return rect(42, 35, 316, 530, wood, 4) + standard(65, 78, 270, 438) + rect(65, 385, 270, 90, p[3], 2) + line('M78 402h245M78 457h245', p[4], 4) + [[40, 34], [325, 34], [40, 533], [325, 533]].map(([x, y]) => rect(x, y, 36, 33, p[4], 2) + rivets([[x + 8, y + 8], [x + 28, y + 25]], p)).join('')
    case 5: return rect(42, 38, 26, 522, wood, 12) + rect(332, 38, 26, 522, wood, 12) + rect(37, 43, 326, 39, wood, 16) + rect(37, 513, 326, 42, wood, 16) + path('M77 108l55-28 35 20 54-17 35 24 62-4 16 48-13 60 16 56-18 59 14 63-25 44 13 57-46 26-49-13-52 16-50-20-49 5 3-55-15-46 14-58-14-48 13-67-9-52Z', 'url(#cloth)') + repeat(9, n => line(`M${100 + n * 23} 144q-18 100 3 190t-1 130`, p[1], 2)) + ellipse(200, 124, 84, 28, '#C7B79D', border, 2)
    case 6: return path('M38 77Q80 17 119 45Q200 3 281 45Q329 17 362 77L353 553Q200 578 46 553Z', wood) + standard(65, 103, 270, 411, 2) + repeat(5, n => diamond(84 + n * 58, 64, 12, p[4], border)) + rect(57, 525, 286, 24, p[2], 5) + line('M66 536h268', p[4], 3)
    case 7: return rect(30, 38, 340, 526, wood, 10) + standard(74, 87, 252, 425, 2) + path('M39 58Q75 101 65 268L45 366 32 327V60M362 58Q323 101 335 268l22 98 12-39V60', 'url(#cloth)', border, 3) + path('M50 43Q200 4 350 43l-28 46Q200 60 78 89Z', 'url(#cloth)') + [[35, 40], [365, 40], [35, 557], [365, 557]].map(([x, y]) => ellipse(x, y, 14, 14, p[4], border, 3)).join('')
    case 8: return path('M200 25Q356 90 365 315Q365 472 200 575Q40 472 34 315Q38 95 200 25Z', wood) + standard(88, 116, 224, 379) + line('M197 37Q69 196 53 335M205 37q127 157 142 298M200 565q-99-88-133-177M200 565q99-88 133-177', p[4], 5) + leaf(200, 43, 30, 56, p[3], border)
    case 9: return path('M75 30H325L370 84V517L324 570H76L30 517V84Z', 'url(#stone)') + path('M70 73H330V527H70Z', p[2]) + standard(85, 87, 230, 425) + repeat(4, n => diamond(100 + n * 67, 53, 12, p[4], border)) + line('M49 118v369M351 118v369M87 548h226', p[4], 4)
    case 10: return path('M60 45Q200 5 340 45Q387 125 363 300Q383 484 328 550Q200 590 72 550Q18 478 39 300Q18 125 60 45Z', wood) + standard(77, 105, 246, 396, 2) + ellipse(200, 60, 62, 18, p[3], border, 2) + grain(98, 533, 205, 17, p)
    case 11: return path('M99 35H301L361 110V490L301 565H99L39 490V110Z', wood) + standard(74, 114, 252, 375) + diamond(200, 69, 27, p[4]) + repeat(5, n => diamond(56, 168 + n * 60, 7, p[4]) + diamond(344, 168 + n * 60, 7, p[4])) + line('M91 522h218l-22 25H113Z', p[4], 3)
    case 12: return path('M38 84L105 30 307 43 365 96 350 518 293 566 89 554 32 498Z', wood) + path('M85 113l60-22 59 10 95-5 19 63-12 332-45 29-71-12-99 1-17-58Z', 'url(#cloth)') + repeat(8, n => line(`M55 ${131 + n * 48}l30 14m228-3 29-17`, p[4], 4)) + [[43, 68], [351, 76], [41, 530], [342, 532]].map(([x, y]) => path(`M${x - 9} ${y + 20}l-5-44 14-15 12 19-5 40Z`, p[4], border, 2)).join('') + ellipse(200, 140, 87, 34, '#B0A38C', border, 2)
    case 13: return path('M45 101L112 53 200 19 288 53 355 101V557H45Z', wood) + standard(73, 129, 254, 385, 2) + line('M66 100Q200 37 334 100M115 101l85-52 85 52M55 530h290', p[4], 3) + repeat(3, n => diamond(110 + n * 90, 545, 7, p[4]))
    case 14: return path('M85 55L35 97 45 225 66 272 36 359 60 527 110 560H291L343 528 368 360 337 274 361 210 369 100 316 53Z', wood) + standard(91, 97, 218, 415, 2) + repeat(6, n => path(`M52 ${122 + n * 55}q28-16 27 17m242-17q22-16 27 17`, 'none', p[4], 3)) + path('M128 62l32-26 41 17 40-17 31 26-72 21Z', p[4], border, 2)
    case 15: return repeat(8, n => `<g transform="rotate(${n * 45} 200 300)">${path('M200 126Q268 160 248 229L200 280 153 224Q134 158 200 126Z', n % 2 ? p[0] : p[1], border, 2)}</g>`) + ellipse(200, 300, 135, 160, 'url(#cloth)', border, 3) + ellipse(200, 207, 84, 36, '#E1D2B9', border, 2) + line('M85 327q119 39 232-2M118 404q79 31 162 2', p[1], 3)
    case 16: return rect(50, 44, 300, 513, wood, 22) + standard(70, 102, 260, 393) + repeat(6, n => ellipse(84 + n * 46, 66, 16, 18, 'none', p[4], 6) + ellipse(84 + n * 46, 532, 16, 14, 'none', p[4], 5)) + line('M52 88h296M52 510h296', p[4], 8)
    case 17: return rect(45, 49, 310, 500, p[0], 24) + standard(65, 109, 270, 376) + path('M50 95Q50 38 111 38H289Q350 38 350 95M50 510Q50 557 111 557H289Q350 557 350 510', 'none', p[1], 11) + repeat(6, n => line(`M${84 + n * 46} 54v42m0 412v30`, p[4], 4))
    case 18: return rect(40, 32, 320, 535, wood, 5) + repeat(7, n => rect(58 + n * 43, 45, 25, 58, p[2], 2)) + standard(65, 119, 270, 391, 2) + repeat(5, n => rect(66 + n * 57, 525, 40, 23, p[2], 2)) + grain(48, 131, 9, 370, p, true) + grain(343, 131, 9, 370, p, true)
    case 19: return path('M39 104Q75 16 140 47Q200 0 261 47Q332 15 363 104L344 519Q282 577 200 549Q113 578 55 520Z', wood) + standard(77, 119, 246, 388, 2) + line('M74 94q56-58 115-25t132 22M90 534q105-28 223 0', p[4], 4) + leaf(200, 37, 20, 51, p[3], border)
    case 20: return path('M38 98H62V64H96V33H304V64H338V98H362V553H38Z', wood) + standard(65, 122, 270, 384, 2) + line('M51 103H76V78H111V48H289V78H324V103H349M53 525H347V542H53Z', p[4], 4) + diamond(200, 82, 23, p[4], p[4])
    case 21: return path('M45 87Q74 19 145 45Q200 17 256 45Q329 19 355 87V551Q200 579 45 551Z', wood) + standard(68, 108, 264, 400, 2) + ellipse(200, 66, 33, 16, p[4], border, 2) + line('M74 81q42-24 77-11m98 0q41-12 76 10M70 536q130 22 260 0', p[1], 3)
    case 22: return rect(47, 38, 306, 523, wood, 5) + standard(68, 83, 250, 421) + rect(322, 119, 24, 174, p[0], 2) + rect(322, 310, 24, 189, p[0], 2) + line('M331 177v52m0 144v53', p[4], 4) + rect(74, 521, 242, 24, wood, 2) + rect(174, 526, 45, 6, p[4], 2)
    case 23: return path('M38 91Q43 35 82 57Q114 11 152 44Q200 8 248 44Q289 14 321 57Q358 34 363 91V545Q200 574 38 545Z', 'url(#cloth)') + standard(68, 125, 264, 377, 2) + repeat(5, n => ellipse(83 + n * 59, 86 + (n % 2) * 11, 3, 3, p[2], p[2], 1)) + rect(69, 468, 263, 30, p[3], 9) + line('M55 529q144 22 289 0', p[4], 3)
    default: throw new Error('Unknown furniture bed design')
  }
}

function table(i: number, s: FurnitureStyle): string {
  const p = s.palette, wood = 'url(#wood)', inset = (x = 70, y = 70, w = 460, h = 260) => grain(x, y, w, h, p)
  switch (i) {
    case 0: return path('M32 46L566 39 572 349 31 357Z', wood) + repeat(4, n => line(`M40 ${61 + n * 92}l520-5`, p[2], 3)) + inset() + rivets([[48, 56], [549, 54], [49, 340], [553, 337]], p)
    case 1: return rect(32, 57, 536, 286, wood, 5) + rect(59, 47, 32, 306, p[2], 3) + rect(509, 47, 32, 306, p[2], 3) + repeat(4, n => line(`M96 ${76 + n * 80}h408`, p[2], 2)) + inset(107, 75, 385, 250) + rivets([[75, 72], [525, 72], [75, 327], [525, 327]], p)
    case 2: return ellipse(300, 200, 268, 164, wood) + line('M161 60v280M439 60v280', p[2], 3) + inset(184, 86, 229, 228) + rect(152, 181, 17, 37, p[4], 3) + rect(431, 181, 17, 37, p[4], 3)
    case 3: return rect(25, 93, 550, 214, wood, 3) + line('M34 162h532M34 235h532', p[2], 3) + inset(40, 107, 520, 185) + rect(65, 97, 15, 205, p[4], 1) + rect(520, 97, 15, 205, p[4], 1)
    case 4: return rect(39, 45, 522, 310, wood, 8) + inset(66, 76, 466, 245) + [[39, 45], [516, 45], [39, 310], [516, 310]].map(([x, y]) => path(`M${x} ${y}h45v12h-32v33h-13Z`, p[4], p[2], 1)).join('') + line('M300 63v274', p[2], 3)
    case 5: return path('M107 69Q208 12 331 39Q474 11 552 130Q596 239 500 328Q407 390 271 357Q119 394 51 284Q8 153 107 69Z', wood) + repeat(6, n => ellipse(300, 200, 35 + n * 36, 21 + n * 24, 'none', n % 2 ? p[1] : p[2], 1.8)) + line('M456 57L371 133l5 40M71 273l100-38 33 11', p[2], 3)
    case 6: return path('M140 35H460L566 116V284L460 365H140L34 284V116Z', wood) + path('M153 57H447L540 127V273L447 342H153L61 273V127Z', 'none', p[4], 4) + diamond(300, 200, 100, p[2]) + diamond(300, 200, 78, p[1]) + repeat(4, n => `<g transform="rotate(${n * 90} 300 200)">${leaf(300, 117, 12, 63, p[0])}</g>`)
    case 7: return path('M48 68Q110 33 166 61Q300 22 435 61Q493 35 553 69Q577 143 550 200Q578 259 552 331Q492 363 433 338Q300 377 168 338Q106 365 48 331Q24 258 50 201Q21 141 48 68Z', wood) + path('M73 84Q300 45 527 84L527 316Q300 354 73 316Z', 'none', p[4], 7) + repeat(5, n => diamond(127 + n * 87, 200, 28, p[4]))
    case 8: return path('M30 201Q173 20 340 47Q474 52 568 200Q437 355 279 352Q112 345 30 201Z', wood) + line('M50 200q242-42 500 0M166 106l96 83-96 105M302 70l66 119-66 137M432 112l33 82-32 90', p[4], 3) + ellipse(305, 200, 36, 17, p[3], p[2], 2)
    case 9: return path('M158 35H442L570 200 442 365H158L30 200Z', 'url(#stone)') + path('M177 68H423L526 200 423 332H177L74 200Z', 'none', p[4], 5) + path('M245 126h110l54 74-54 74H245l-54-74Z', p[2]) + diamond(300, 200, 50, p[4])
    case 10: return path('M58 120Q111 12 268 53Q323 90 389 63Q527 28 561 143Q582 293 449 343Q343 378 288 289Q232 233 162 296Q54 319 39 237Q19 163 58 120Z', wood) + path('M75 151Q167 62 276 104Q337 138 422 108Q512 85 529 173', 'none', p[1], 4) + grain(131, 147, 343, 80, p)
    case 11: return path('M173 32H427L568 130V270L427 368H173L32 270V130Z', wood) + ellipse(300, 200, 143, 130, p[2], p[4], 4) + ellipse(300, 200, 117, 105, 'none', p[4], 2) + repeat(8, n => `<g transform="rotate(${n * 45} 300 200)">${diamond(300, 95, 11, p[4])}</g>`) + path('M300 115L379 246H221Z', 'none', p[4], 3)
    case 12: return path('M45 97L145 38 280 57 416 27 560 103 540 223 570 309 433 365 276 338 135 367 31 280 61 188Z', 'url(#stone)') + path('M89 98l420 224M503 93L101 326', 'none', p[4], 15) + path('M101 100l398 211M495 102L111 316', 'none', p[1], 5) + rivets([[98, 107], [500, 106], [114, 316], [495, 312]], p)
    case 13: return path('M300 27Q352 72 409 61Q455 53 469 113Q540 119 563 200Q521 260 470 284Q455 345 405 334Q346 327 300 372Q253 327 194 334Q146 345 130 284Q67 258 36 200Q64 130 130 113Q142 55 194 61Q252 72 300 27Z', wood) + diamond(300, 200, 116, 'none', p[4]) + diamond(300, 200, 89, 'none', p[1]) + line('M80 200h80m280 0h80M300 57v40m0 205v40', p[4], 3)
    case 14: return path('M105 47L230 67 300 33 370 67 496 47 548 135 513 200 548 268 497 353 369 332 300 369 230 332 103 353 53 266 86 200 53 135Z', wood) + repeat(4, n => repeat(5, j => path(`M${146 + j * 68} ${104 + n * 58}q34 45 68 0`, 'none', p[4], 2))) + diamond(300, 200, 52, p[3])
    case 15: return ellipse(300, 200, 261, 165, 'url(#cloth)') + path('M74 210Q300 124 525 208', 'none', p[1], 8) + [[155, 143, 24], [397, 106, 29], [453, 270, 22], [236, 292, 30], [296, 116, 15], [113, 244, 15]].map(([x, y, r]) => ellipse(x, y, r, r * .68, '#DCC9AF', p[1], 2)).join('')
    case 16: return ellipse(300, 200, 260, 160, p[4]) + ellipse(300, 200, 242, 143, '#D0CBB9', p[2], 2) + path('M132 131q67 17 92 71t96 49 132 26M203 78q12 64 63 73t63 78', 'none', '#AAA99C', 2) + ellipse(300, 200, 233, 135, 'none', '#E4DDC5', 2)
    case 17: return path('M60 109Q160 28 302 66Q364 119 459 67Q558 34 563 173Q571 318 449 337Q352 343 284 283Q188 342 87 307Q22 275 39 188Z', p[0]) + path('M65 143Q183 72 286 115Q365 163 459 113Q522 75 537 167', 'none', p[1], 6) + line('M79 286q108 28 202-33q98 56 188 55', p[4], 3)
    case 18: return rect(35, 49, 530, 303, wood, 4) + inset(58, 65, 480, 265) + rect(157, 86, 285, 205, 'url(#cloth)', 8) + rect(171, 99, 257, 179, 'none', 5, p[4], 2) + rect(126, 324, 92, 18, p[2], 2) + rect(380, 324, 92, 18, p[2], 2) + rivets([[48, 62], [551, 62], [48, 339], [551, 339]], p)
    case 19: return path('M48 96Q110 15 245 60Q310 91 369 51Q490 11 550 115Q589 200 533 299Q443 365 355 310Q283 270 208 338Q90 379 43 281Q16 181 48 96Z', wood) + line('M65 139Q168 50 258 105Q310 139 370 100Q463 49 527 134M84 289q57 42 120 7', p[4], 4) + leaf(445, 178, 29, 90, p[3], p[4])
    case 20: return path('M32 109H72V75H112V41H488V75H528V109H568V291H528V325H488V359H112V325H72V291H32Z', wood) + path('M59 127H91V96H131V64H469V96H509V127H541V273H509V304H469V335H131V304H91V273H59Z', 'none', p[4], 4) + diamond(300, 200, 102, p[4]) + diamond(300, 200, 78, p[2])
    case 21: return ellipse(300, 200, 268, 165, wood) + ellipse(300, 200, 245, 143, 'none', p[4], 4) + ellipse(300, 200, 222, 123, 'none', p[1], 2) + repeat(8, n => `<g transform="rotate(${n * 45} 300 200)">${path('M300 200L280 126Q300 95 320 126Z', n % 2 ? p[0] : p[1], p[2], 1)}</g>`)
    case 22: return rect(51, 50, 498, 300, wood, 48) + line('M171 65v270M429 65v270', p[2], 3) + rect(171, 62, 258, 277, 'none', 1, p[1], 2) + inset(188, 79, 222, 240) + rivets([[166, 145], [166, 255], [434, 145], [434, 255]], p)
    case 23: return ellipse(300, 200, 260, 166, wood) + ellipse(300, 200, 239, 146, 'none', p[4], 4) + repeat(12, n => `<g transform="rotate(${n * 30} 300 200)">${path('M300 200L269 83Q300 65 331 83Z', n % 2 ? p[0] : p[1], p[2], 1)}</g>`) + ellipse(300, 200, 46, 31, wood, p[4], 3)
    default: throw new Error('Unknown furniture table design')
  }
}

function chair(i: number, s: FurnitureStyle): string {
  const p = s.palette, wood = 'url(#wood)', seat = (x = 85, y = 134, w = 230, h = 191, fill = 'url(#cloth)', r = 24) => rect(x, y, w, h, fill, r), arms = (curve = false) => curve
    ? path('M61 130q-26 89 8 157m269-157q27 89-8 157', 'none', p[0], 20)
    : rect(48, 130, 31, 167, wood, 9) + rect(321, 130, 31, 167, wood, 9)
  switch (i) {
    case 0: return path('M74 146L323 139 330 328 69 335Z', wood) + rect(163, 47, 73, 101, wood, 4) + grain(90, 165, 221, 146, p) + rivets([[91, 156], [312, 153], [86, 316], [313, 314]], p)
    case 1: return seat(77, 131, 246, 200, p[2], 8) + repeat(8, n => line(`M${91 + n * 30} 143v172M88 ${146 + n * 23}h223`, p[1], 3)) + rect(58, 57, 284, 39, wood, 5) + rect(76, 87, 25, 48, wood, 2) + rect(300, 87, 25, 48, wood, 2)
    case 2: return path('M65 145Q40 44 130 43H270Q359 48 336 145L313 157 294 94H107L89 156Z', wood) + seat(86, 155, 228, 177, wood, 39) + grain(109, 182, 182, 123, p) + arms(true)
    case 3: return seat(92, 140, 216, 190, wood, 3) + rect(83, 48, 234, 43, wood, 3) + repeat(4, n => rect(101 + n * 58, 89, 19, 54, p[0], 2)) + line('M111 165v141m59-141v141m59-141v141m59-141v141', p[2], 2)
    case 4: return seat(75, 138, 250, 190, p[3], 5) + path('M60 65L334 116M337 65L65 116', 'none', p[0], 20) + line('M80 150l236 166M318 150L85 316', p[4], 5) + rivets([[77, 151], [317, 151], [79, 314], [316, 314]], p)
    case 5: return seat(88, 139, 224, 187, 'url(#cloth)', 45) + path('M72 148Q39 75 89 49l29 33 15-49 22 58m171 60q38-75-13-102l-28 33-16-49-22 58', 'none', p[4], 13) + arms(true) + line('M116 176q-23 83 16 115m151-111q22 88-17 117', p[1], 3)
    case 6: return seat() + path('M55 115Q61 48 123 63Q200 25 277 63Q343 49 345 115L314 134H86Z', wood) + arms() + repeat(5, n => diamond(112 + n * 44, 86, 10, p[4]))
    case 7: return seat(78, 146, 244, 182, 'url(#cloth)', 23) + path('M49 130L79 64 126 75 156 37 200 62 244 37 274 75 321 64 350 130Z', wood) + arms() + diamond(200, 95, 27, p[4]) + rect(62, 310, 276, 25, p[0], 9) + line('M89 322h221', p[4], 4)
    case 8: return path('M72 166Q52 91 105 76Q167 3 200 57Q239 5 298 76Q351 92 327 169L301 154Q286 106 255 109Q200 163 144 109Q111 112 98 157Z', wood) + path('M89 171Q200 123 312 171L303 294Q200 358 96 294Z', 'url(#cloth)') + arms(true) + line('M116 182q83 20 171-1', p[4], 3)
    case 9: return path('M62 66H338V318L304 349H96L62 318Z', 'url(#stone)') + rect(89, 140, 222, 174, 'url(#cloth)', 3) + rect(78, 82, 244, 36, p[2], 2) + repeat(4, n => diamond(110 + n * 60, 100, 12, p[4])) + line('M77 157v143m247-143v143', p[4], 5)
    case 10: return ellipse(200, 223, 129, 117, wood) + ellipse(200, 223, 103, 90, 'url(#cloth)', p[2], 2) + path('M69 193Q39 85 138 56Q200 28 264 56Q358 85 331 193', 'none', p[0], 27) + line('M94 188Q74 103 141 84Q203 57 259 84Q325 107 306 188', p[1], 3)
    case 11: return path('M200 34L320 98 311 157H90L80 98Z', wood) + path('M78 159L126 132H274L322 159V287L271 338H130L78 287Z', 'url(#cloth)') + diamond(200, 89, 28, p[4]) + arms() + diamond(200, 236, 42, 'none', p[4])
    case 12: return path('M63 156L93 113 181 126 274 102 335 153 320 315 268 345 137 331 75 300Z', 'url(#cloth)') + path('M78 163L55 54 87 39 119 126m202 37L345 54 313 39 281 126', 'none', p[4], 20) + repeat(7, n => line(`M${110 + n * 27} 313l6 19`, p[4], 3)) + path('M52 184l9 98m285-98-9 98', 'none', p[0], 23)
    case 13: return path('M65 140L112 71 200 30 286 71 336 140Z', wood) + seat(82, 157, 236, 172, 'url(#cloth)', 8) + line('M89 132l40-46 71-33 71 33 41 46M130 119l70-37 70 37', p[4], 3) + arms()
    case 14: return seat(88, 158, 224, 172, 'url(#cloth)', 26) + path('M83 155L44 109 64 44 118 91 167 68 200 98 233 68 282 91 336 44 356 109 317 155Z', wood) + path('M54 167l-16 75 40 53m268-128 16 75-40 53', 'none', p[4], 15) + repeat(3, n => path(`M${125 + n * 53} 203q27 37 54 0`, 'none', p[4], 2))
    case 15: return repeat(6, n => `<g transform="rotate(${n * 60} 200 219)">${path('M200 45Q266 86 247 159L200 215 157 154Q136 85 200 45Z', n % 2 ? p[0] : p[1])}</g>`) + ellipse(200, 223, 99, 97, 'url(#cloth)') + ellipse(200, 223, 74, 71, 'none', p[1], 3)
    case 16: return seat(80, 151, 240, 176, '#B6A279', 47) + repeat(9, n => line(`M${99 + n * 25} 171v136M102 ${167 + n * 17}h192`, p[1], 1.5)) + path('M68 161Q47 66 138 52H264Q353 66 331 161', 'none', p[4], 16) + path('M89 149Q77 95 144 83H255Q323 96 310 149', 'none', p[2], 3)
    case 17: return seat(91, 146, 218, 183, p[0], 48) + path('M74 159Q48 50 150 48H249Q350 48 328 159', 'none', p[1], 14) + repeat(4, n => line(`M${128 + n * 48} 65v65`, p[4], 4)) + ellipse(200, 237, 75, 65, 'none', p[1], 3)
    case 18: return seat(93, 142, 214, 185, 'url(#cloth)', 5) + rect(65, 50, 270, 41, wood, 3) + repeat(5, n => rect(84 + n * 52, 91, 21, 44, p[0], 2)) + arms() + line('M109 161v149M291 161v149', p[4], 2)
    case 19: return seat(90, 151, 220, 177, 'url(#cloth)', 53) + path('M64 164Q28 62 144 44Q216 27 272 61Q345 78 333 167', 'none', p[0], 21) + path('M115 128Q144 62 200 86Q253 43 288 131', 'none', p[4], 5) + arms(true)
    case 20: return path('M64 145L87 84 143 49H257L313 84 336 145Z', 'url(#cloth)') + seat(84, 162, 232, 164, 'url(#cloth)', 14) + line('M91 130l26-39 48-24h71l49 24 25 39M200 66v67M151 73l20 62M249 73l-20 62', p[4], 3) + rect(49, 155, 28, 146, p[2], 5) + rect(323, 155, 28, 146, p[2], 5)
    case 21: return seat(91, 154, 218, 168, 'url(#cloth)', 25) + path('M55 153Q39 49 128 52Q200 20 272 52Q361 49 345 153L317 167Q319 107 277 105H124Q81 107 83 167Z', wood) + arms(true) + repeat(3, n => ellipse(142 + n * 58, 215, 3, 3, p[2], p[2], 1))
    case 22: return seat(78, 152, 244, 174, wood, 5) + rect(74, 55, 252, 42, wood, 5) + line('M91 98l27 46m191-46-27 46M94 174h211M94 218h211M94 262h211M94 307h211', p[2], 3) + rivets([[103, 145], [297, 145], [86, 321], [314, 321]], p)
    case 23: return path('M56 167Q41 61 125 54Q202 25 277 54Q359 62 344 167L331 306Q200 365 69 306Z', 'url(#cloth)') + seat(91, 158, 218, 166, 'url(#cloth)', 46) + repeat(5, n => ellipse(108 + n * 46, 101 + (n % 2) * 12, 3, 3, p[2], p[2], 1)) + path('M73 173q-6 53 4 101m249-101q5 52-4 101', 'none', p[1], 12)
    default: throw new Error('Unknown furniture chair design')
  }
}

function cabinet(i: number, s: FurnitureStyle): string {
  const p = s.palette, wood = 'url(#wood)', handle = (x: number, y: number, w = 52) => rect(x, y, w, 7, p[4], 3, p[2], 1)
  const slab = (x = 40, y = 54, w = 520, h = 248, r = 4) => rect(x, y, w, h, wood, r) + grain(x + 16, y + 15, w - 32, h - 34, p)
  const front = (x: number, y: number, w: number, n: number) => repeat(n, j => rect(x + j * w / n, y, w / n - 3, 26, p[0], 3) + handle(x + (j + .5) * w / n - 24, y + 10, 48))
  switch (i) {
    case 0: return path('M39 62L561 55 567 295 36 304Z', wood) + grain(58, 77, 488, 183, p) + repeat(6, n => line(`M${62 + n * 92} 69v204`, p[2], 2)) + front(51, 273, 500, 2) + rivets([[50, 70], [552, 66], [48, 291], [554, 285]], p)
    case 1: return slab() + rect(63, 77, 474, 170, p[2], 3) + repeat(7, n => rect(76 + n * 66, 88, 49, 147, wood, 3)) + front(53, 269, 494, 2)
    case 2: return slab(34, 45, 532, 267, 10) + line('M300 55v222M47 167h507', p[2], 3) + front(48, 276, 506, 2) + handle(140, 156) + handle(409, 156)
    case 3: return slab(29, 73, 542, 215) + rect(43, 87, 514, 167, p[2], 3) + repeat(4, n => rect(51 + n * 127, 96, 116, 146, 'url(#cloth)', 5)) + front(40, 260, 520, 4)
    case 4: return slab(38, 46, 524, 266) + rect(49, 58, 502, 243, 'none', 2, p[4], 11) + line('M301 66v227M61 125h478M61 231h478', p[4], 5) + rect(229, 278, 142, 22, p[2], 2) + rivets([[61, 71], [538, 71], [61, 285], [538, 285]], p)
    case 5: return slab(43, 62, 514, 236, 20) + rect(39, 54, 522, 22, p[0], 10) + rect(39, 285, 522, 22, p[0], 10) + repeat(5, n => line(`M${88 + n * 105} 82v190`, p[2], 5)) + path('M119 116l61-22 43 24 89-18 72 23 71-8-4 100-64 17-61-10-65 17-72-21-73 8Z', 'url(#cloth)', p[2], 2) + front(61, 271, 478, 2)
    case 6: return path('M45 63L94 42H507L556 63V294L513 315H87L45 294Z', wood) + rect(67, 64, 466, 213, 'none', 3, p[4], 4) + diamond(183, 169, 71, 'none', p[1]) + diamond(416, 169, 71, 'none', p[1]) + front(61, 281, 478, 2)
    case 7: return path('M49 66Q160 20 300 52Q444 20 550 66Q577 177 550 290Q300 350 49 290Q24 174 49 66Z', wood) + path('M69 84Q300 37 531 84L532 273Q300 323 68 273Z', 'none', p[4], 5) + ellipse(300, 175, 70, 56, 'none', p[4], 3) + front(108, 284, 384, 3)
    case 8: return path('M52 96Q295 4 549 96Q582 179 542 263Q300 348 57 263Q17 176 52 96Z', wood) + line('M71 116Q300 46 529 116M77 246q221 65 447 0M299 76q-45 94 0 214', p[4], 4) + leaf(195, 131, 27, 91, p[3], p[2]) + leaf(406, 131, 27, 91, p[3], p[2]) + handle(259, 278, 82)
    case 9: return path('M31 108H61V70H103V39H497V70H538V108H569V289H31Z', 'url(#stone)') + rect(72, 104, 456, 151, wood, 2) + repeat(3, n => diamond(150 + n * 150, 176, 38, p[4])) + front(44, 264, 512, 3)
    case 10: return path('M50 74Q300 21 550 74V263Q302 352 50 263Z', wood) + path('M72 90Q300 49 528 90V240Q300 308 72 240Z', 'none', p[1], 4) + line('M299 69v211', p[2], 2) + handle(153, 278, 52) + handle(392, 278, 52)
    case 11: return path('M133 38H466L568 146 469 311H133L32 146Z', wood) + path('M151 61H447L532 148 448 287H151L68 148Z', 'none', p[4], 3) + diamond(300, 170, 67, p[2]) + diamond(300, 170, 44, 'none', p[4]) + front(148, 281, 305, 3)
    case 12: return path('M40 79L132 43 264 58 412 33 558 75 544 270 421 312 284 286 137 317 37 278Z', 'url(#cloth)') + repeat(7, n => path(`M${74 + n * 75} 77q15 85-3 193`, 'none', p[4], 15)) + line('M64 95l474 163M63 257L536 92', p[2], 5) + handle(263, 281, 75)
    case 13: return path('M51 92L100 46H263L300 25 339 46H499L550 92V300H51Z', wood) + rect(75, 92, 450, 169, p[2], 4) + repeat(3, n => path(`M${87 + n * 149} 245V134l61-35 61 35v111Z`, p[0], p[4], 2)) + front(62, 271, 476, 3)
    case 14: return path('M47 78L111 36 213 54 299 27 387 54 489 36 552 78 540 278 480 313 120 313 58 278Z', wood) + repeat(3, n => repeat(5, j => path(`M${102 + j * 76} ${100 + n * 53}q38 38 76 0`, 'none', p[4], 2))) + front(85, 271, 430, 2) + [[63, 61], [532, 61], [63, 285], [532, 285]].map(([x, y]) => diamond(x, y, 14, p[4])).join('')
    case 15: return path('M65 97Q150 12 300 50Q448 13 536 97Q590 183 512 265Q420 336 300 300Q170 338 85 265Q10 181 65 97Z', wood) + path('M74 113Q300 27 527 113l-5 28Q300 78 79 141Z', p[4], p[2], 2) + line('M299 146v139M96 259q200 67 408 0', p[1], 4) + ellipse(284, 275, 7, 6, p[4], p[2], 1) + ellipse(316, 275, 7, 6, p[4], p[2], 1)
    case 16: return slab(40, 45, 520, 267, 8) + rect(59, 65, 482, 189, '#A7B4A6', 4, p[4], 6) + line('M300 67v184M60 157h479', p[4], 6) + group(line('M91 91l151 131M345 85l148 133', '#D9E2CA', 8), .55) + front(54, 272, 492, 2)
    case 17: return rect(36, 51, 528, 255, p[0], 18) + rect(51, 67, 497, 211, p[1], 10, p[4], 3) + line('M70 92h457M70 238h457M299 76v194', p[4], 3) + front(51, 274, 498, 3) + rivets([[48, 65], [552, 65], [48, 291], [552, 291]], p)
    case 18: return slab(30, 53, 540, 250, 3) + rect(52, 75, 496, 174, p[2], 2) + repeat(6, n => rect(66 + n * 80, 88, 64, 147, wood, 2) + grain(72 + n * 80, 94, 50, 135, p, true)) + front(45, 269, 510, 3)
    case 19: return path('M40 83Q112 19 219 53Q300 18 380 53Q490 20 559 83L545 275Q434 335 301 299Q169 336 53 275Z', wood) + path('M72 106Q175 45 260 85Q301 105 340 85Q435 45 528 106', 'none', p[4], 4) + leaf(185, 132, 28, 96, p[3], p[4]) + leaf(413, 132, 28, 96, p[3], p[4]) + line('M299 75v217', p[2], 2) + handle(115, 280) + handle(430, 280)
    case 20: return path('M28 100H67V67H108V34H493V67H533V100H572V297H28Z', wood) + path('M49 118H88V86H126V56H475V86H513V118H551V272H49Z', 'none', p[4], 4) + repeat(3, n => diamond(153 + n * 147, 170, 37, p[4])) + front(43, 274, 514, 3)
    case 21: return path('M42 76Q152 30 300 57Q447 31 557 76L548 265Q300 334 51 265Z', wood) + path('M63 92Q300 43 536 92L526 248Q300 306 74 248Z', 'none', p[1], 3) + ellipse(300, 170, 77, 53, wood, p[4], 3) + front(87, 269, 426, 3)
    case 22: return path('M47 42H551V282H332V314H47Z', wood) + path('M73 67H524V260H305V287H73Z', 'none', p[1], 3) + line('M306 67v220M327 145h197', p[2], 2) + front(62, 283, 245, 2) + handle(399, 263, 62)
    case 23: return slab(29, 44, 542, 267, 12) + rect(46, 63, 361, 209, wood, 3, p[4], 2) + rect(421, 67, 132, 199, p[2], 4) + repeat(5, n => rect(434 + n * 23, 80, 12, 172, p[1], 2)) + front(45, 276, 363, 2) + line('M420 282h134M436 293h103', p[4], 5)
    default: throw new Error('Unknown furniture cabinet design')
  }
}

export const FURNITURE_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Furniture-Collection-1'
export const FURNITURE_COLLECTION_LICENSE = `Sceneweave Furniture Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down static SVG designs created with coding assistance for the medieval, western fantasy and 1920s collection. Design families are illustrative, not historical authentication. No external images, reference-map pixels or third-party artwork are embedded. Artwork remains an art candidate pending user review.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

function artwork(category: FurnitureCategory, s: FurnitureStyle, index: number): VisualSampleArt {
  const [widthMm, heightMm] = s.sizes[category], [wood, light, dark, cloth] = s.palette
  const [w, h] = category === 'bed' ? [400, 600] : category === 'table' ? [600, 400] : category === 'chair' ? [400, 400] : [600, 360]
  // Back/arms are connected to the seat by real visible rails, including the
  // folding and tubular designs. Avoid detached ornamental fragments.
  const rails = category === 'chair' && index !== 15
    ? line('M109 94v88M291 94v88', s.palette[2], index === 16 || index === 17 ? 6 : 10) : ''
  const body = rails + ({ bed, table, chair, cabinet }[category])(index, s)
  // A proportional root viewBox is essential: production PNG aspect, world
  // visual bounds and transparent margins must describe the same rectangle.
  const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMm} ${heightMm}"><defs><linearGradient id="wood" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="${wood}"/><stop offset="47%" stop-color="${light}"/><stop offset="100%" stop-color="${wood}"/></linearGradient><linearGradient id="cloth" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="${cloth}"/><stop offset="55%" stop-color="${cloth}"/><stop offset="100%" stop-color="${wood}"/></linearGradient><linearGradient id="stone" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${light}"/><stop offset="55%" stop-color="${wood}"/><stop offset="100%" stop-color="${dark}"/></linearGradient></defs><g transform="scale(${widthMm / w} ${heightMm / h})">${body}</g></svg>`
  return { key: furnitureKey(category, s.id), name: `${s.name} · ${s.designs[category]}`, kind: 'prop', sourceSvg, widthMm, heightMm,
    footprintMm: { width: Math.round(widthMm * .92), height: Math.round(heightMm * .92) }, blocksMovement: true, blocksSight: false,
    renderLayer: 'object', shadowClass: 'furniture', tags: ['原创', '家具', FURNITURE_CATEGORIES.find(row => row.id === category)!.name, category, s.era, s.name, '固定设计款', '俯视'] }
}
export const FURNITURE_COLLECTION_ART: readonly VisualSampleArt[] = freezeJson(FURNITURE_CATEGORIES.flatMap(category => FURNITURE_STYLES.map((s, i) => artwork(category.id, s, i))))
