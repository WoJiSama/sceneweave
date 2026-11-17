import { STORAGE_DESIGNS, type StorageDesign } from '../assets/storage-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

// Top-down drawings, with restrained bevels and surface marks. Geometry is
// explicitly designed per item; material noise never creates a new design.
const ink = '#423B32', light = '#D6C3A0', iron = '#68716A', brass = '#BBA06B'
const n = (v: number) => Math.round(v * 100) / 100
const repeat = (count: number, draw: (i: number) => string) => Array.from({ length: count }, (_, i) => draw(i)).join('')
const path = (d: string, fill = 'none', stroke = ink, width = 3) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`
const line = (d: string, stroke = ink, width = 2) => path(d, 'none', stroke, width)
const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0, stroke = ink, sw = 3) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, stroke = ink, sw = 3) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const opacity = (body: string, alpha: number) => `<g opacity="${alpha}">${body}</g>`
const fill = 'url(#surface)'
const palettes: Record<StorageDesign['material'], readonly [string, string, string]> = {
  oak: ['#92714E', '#B69A70', '#6B533C'], pine: ['#A88C5F', '#CFB68B', '#7B6645'], darkwood: ['#67513F', '#93785D', '#4E4035'],
  wicker: ['#A78B5F', '#CEB384', '#6D6146'], leather: ['#78614C', '#A18A6A', '#514636'], iron: ['#6C736C', '#A0A49A', '#4B5452'],
  stone: ['#81877B', '#B3B4A1', '#616D66'], ceramic: ['#A7B2A2', '#DADECA', '#788E83'], cloth: ['#A79C7B', '#C9BFA0', '#7C775C'],
}
function grain(x: number, y: number, w: number, h: number, seed: number, rows = 12): string {
  return opacity(repeat(rows, i => {
    const at = y + h * (i + 1) / (rows + 1), bend = ((i * 17 + seed * 7) % 11) - 5
    return line(`M${x} ${n(at)}q${n(w * .23)} ${bend} ${n(w * .47)} ${n(bend / 2)}t${n(w * .53)} ${n(-bend / 2)}`, i % 3 ? '#DFCCAA' : '#574B38', i % 3 ? 1.2 : .8)
  }), .48)
}
function rivets(points: readonly (readonly [number, number])[], color = brass): string {
  return points.map(([x, y]) => ellipse(x, y, 3, 3, color, ink, 1) + line(`M${x - 1} ${y - 1}h2`, light, .8)).join('')
}
const buckle = (x: number, y: number, w = 25, h = 32) => rect(x, y, w, h, brass, 3, ink, 1.4) + rect(x + 6, y + 6, w - 12, h - 12, '#5B5544', 1, ink, 1) + line(`M${x + w / 2} ${y + 4}v${h - 8}`, light, 2)
const lock = (x: number, y: number, size = 1) => `<g transform="translate(${x} ${y}) scale(${size})">${path('M-20-25Q0-34 20-25L24 24Q0 33-24 24Z', brass, ink, 2)}${ellipse(0, 0, 4, 5, ink, ink, 1)}${path('M-2 3l-2 9h8L2 3Z', ink, ink, 1)}${rivets([[-14, -17], [14, -17]])}</g>`
const strap = (x: number, y: number, h: number, metal = false) => rect(x, y, 24, h, metal ? iron : '#66503B', 3, ink, 2) + line(`M${x + 4} ${y + 5}v${h - 10}`, metal ? '#ADB0A1' : '#B9A07A', 2) + rivets([[x + 12, y + 12], [x + 12, y + h - 12]])
const handle = (x: number, y: number, w = 60) => path(`M${x} ${y}q${w / 2}-25 ${w} 0v12q-${w / 2}-18-${w} 0Z`, '#71624B', ink, 2)
function panel(x: number, y: number, w: number, h: number, seed: number, r = 5): string {
  return rect(x, y, w, h, fill, r) + rect(x + 9, y + 9, w - 18, h - 18, 'none', Math.max(0, r - 2), light, 1.3)
    + grain(x + 15, y + 18, w - 30, h - 36, seed) + opacity(line(`M${x + w * .38} ${y + h * .3}q13-5 25 0q-12 9-25 0m6-2q5-4 12 0`, '#65523D', 1), .6)
}
function weave(cx: number, cy: number, rx: number, ry: number, spacing = 12): string {
  let dark = '', bright = ''
  for (let x = -rx + spacing; x < rx; x += spacing) {
    const h = ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2))
    dark += `M${n(cx + x)} ${n(cy - h)}v${n(2 * h)} `
    bright += `M${n(cx + x + 2)} ${n(cy - h + 3)}v${n(Math.max(0, 2 * h - 6))} `
  }
  for (let y = -ry + spacing; y < ry; y += spacing) {
    const w = rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2))
    dark += `M${n(cx - w)} ${n(cy + y)}h${n(2 * w)} `
    bright += `M${n(cx - w + 3)} ${n(cy + y + 2)}h${n(Math.max(0, 2 * w - 6))} `
  }
  return opacity(line(dark, '#675B43', 2), .65) + opacity(line(bright, '#E1CAA1', 2), .65)
}
function boxWeave(x: number, y: number, w: number, h: number, spacing = 13): string {
  return opacity(line(repeat(Math.floor(w / spacing), i => `M${x + (i + 1) * spacing} ${y}v${h} `)
    + repeat(Math.floor(h / spacing), i => `M${x} ${y + (i + 1) * spacing}h${w} `), '#5F5941', 2), .55)
    + opacity(line(repeat(Math.floor(w / spacing), i => `M${x + (i + 1) * spacing + 2} ${y + 2}v${h - 4} `)
      + repeat(Math.floor(h / spacing), i => `M${x + 2} ${y + (i + 1) * spacing + 2}h${w - 4} `), '#D9C6A1', 1.6), .75)
}
const stitched = (d: string) => line(d, '#D6C8A6', 1.5)
const fold = (d: string) => line(d, '#746D54', 2) + opacity(line(d, '#DACCAA', .7), .6)

function chest(i: number): string {
  switch (i) {
    case 0: return panel(47, 66, 506, 268, i) + line('M62 137h476M62 204h476M62 270h476', '#65513D') + strap(129, 70, 258, true) + strap(447, 70, 258, true) + lock(300, 304)
    case 1: return panel(63, 57, 474, 286, i) + panel(103, 95, 394, 207, i + 3) + repeat(6, j => rect(60, 75 + j * 43, 23, 23, '#68563D', 1, ink, 1) + rect(517, 75 + j * 43, 23, 23, '#68563D', 1, ink, 1)) + lock(300, 318, .7)
    case 2: return path('M63 99Q300 28 537 99L551 297Q300 369 49 297Z', fill) + grain(100, 130, 400, 140, i) + [117, 288, 459].map(x => strap(x, 82, 236, true)).join('') + lock(300, 301, 1.2) + line('M86 112q214-64 428 0M83 285q217 57 434 0', brass, 2)
    case 3: return rect(45, 62, 510, 276, fill, 40) + boxWeave(72, 88, 456, 223, 13) + rect(60, 77, 480, 246, 'none', 25, light, 9) + handle(23, 181, 43) + handle(534, 181, 43) + buckle(285, 304, 30, 25)
    case 4: return path('M78 62H519L547 90V312L524 338H79L52 308V91Z', fill) + stitched('M84 77H512L530 98V301L514 322H87L70 300V98Z') + path('M85 85L515 316M514 84L86 317', 'none', '#514536', 22) + buckle(286, 181, 30, 39) + handle(15, 174, 45) + handle(540, 174, 45)
    case 5: return path('M46 96Q300 34 554 96V302Q300 360 46 302Z', fill) + [70, 173, 288, 403, 506].map(x => strap(x, 84, 229, true)).join('') + line('M64 107Q300 54 535 107M64 287q236 53 471 0', '#B2B3A1', 3) + lock(223, 296, .85) + lock(377, 296, .85)
    case 6: return path('M87 63H513L552 331H48Z', fill) + grain(101, 88, 398, 217, i) + line('M111 128h378M101 196h398M89 263h421', '#68533B') + path('M76 135H35Q5 201 35 267H57M524 135H565Q595 201 565 267H543', 'none', '#BCAE8A', 12) + strap(143, 69, 256, true) + strap(433, 69, 256, true) + lock(300, 302)
    case 7: return path('M115 46H485L558 119V281L485 354H115L42 281V119Z', fill) + path('M127 69H473L533 129V269L473 331H127L67 269V129Z', 'none', brass, 6) + repeat(4, j => rect(76 + j * 141, 113, 21, 173, brass, 4)) + path('M166 201h268M300 91v220', 'none', brass, 9) + lock(300, 200, 1.2)
    case 8: return path('M32 202Q137 37 300 65Q464 29 568 202Q461 366 300 336Q134 368 32 202Z', fill) + line('M72 201Q190 79 300 99Q412 74 527 201M75 218Q191 319 302 304Q417 325 525 219M300 86q-49 106 0 227', '#C3BA83', 4) + path('M300 172q-53 32 0 72q53-40 0-72Z', '#8B9C72') + lock(300, 205, .55)
    case 9: return path('M132 46H469L565 200 469 354H132L35 200Z', fill, ink, 5) + path('M148 72H452L534 200 451 327H149L66 200Z', '#736D56', brass, 5) + panel(152, 100, 296, 200, i) + rivets([[129, 71], [473, 71], [550, 200], [472, 329], [130, 329], [50, 200]]) + [195, 300, 405].map(x => lock(x, 288, .68)).join('')
    case 10: return path('M62 84L157 55 283 75 431 47 544 97 528 301 393 339 262 315 106 345 45 295Z', fill) + stitched('M81 103L159 75 282 96 429 69 522 109 509 285 394 317 263 294 118 321 66 282Z') + path('M125 80Q89 196 127 312M469 76Q500 191 467 311', 'none', '#C6B99A', 22) + line('M117 114l27 11m-32 26 27 9m-30 28 28 7m-27 28 27 4m315-105 27-9m-21 35 27-6m-24 35 27-2m-28 30 27 3', '#6B5B45', 5) + lock(300, 308, .95)
    case 11: return path('M162 38H438L559 143V257L438 362H162L41 257V143Z', fill) + path('M173 61H427L532 152V247L427 337H173L67 247V152Z', 'none', brass, 4) + ellipse(300, 200, 105, 96, '#534D61', brass, 4) + path('M300 124L365 237H235Z', 'none', '#BFAE82', 3) + rivets([[300, 124], [365, 237], [235, 237]]) + [95, 475].map(x => strap(x, 158, 86, true)).join('')
    case 12: return path('M67 74L123 46H478L533 74V330H67Z', fill) + repeat(3, j => path(`M${103 + j * 142} 300V139l55-65 55 65v161Z`, '#4D4849', brass, 3)) + [54, 522].map(x => rect(x, 90, 25, 227, '#6B6560', 3)).join('') + lock(300, 306, .85)
    case 13: return path('M35 102L119 45 201 67 300 36 399 67 481 45 565 102 545 305 478 350H122L55 305Z', fill) + repeat(5, j => repeat(3, k => path(`M${121 + j * 73} ${113 + k * 58}q36 51 73 0`, 'none', '#B6AA83', 3))) + path('M70 113l41-33 26 34-54 28ZM530 113l-41-33-26 34 54 28Z', brass) + lock(300, 315, 1.15)
    case 14: return path('M41 231Q31 102 187 64Q335 22 492 105Q600 172 528 277Q421 356 282 328Q121 370 41 231Z', fill) + line('M69 216Q171 73 307 90Q445 75 528 188M76 238q197 136 431 21M306 88q-43 137-5 229', '#69583F', 4) + path('M291 178q-30-62 18-70q41 42-5 95', '#8D9670') + lock(300, 243, .65)
    case 15: return rect(53, 57, 494, 286, fill, 104) + grain(103, 101, 394, 198, i) + [127, 300, 473].map(x => line(`M${x} 87v227`, '#725F43', 6)).join('') + path('M89 201q210-79 422 0', 'none', '#CCB78D', 9) + handle(187, 276, 72) + handle(340, 276, 72) + lock(300, 301, .65)
    case 16: return panel(46, 61, 508, 278, i, 22) + strap(127, 65, 270) + strap(449, 65, 270) + [[47, 61], [517, 61], [47, 302], [517, 302]].map(([x, y]) => rect(x, y, 36, 36, brass, 5, ink, 2)).join('') + buckle(123, 277, 32, 39) + buckle(445, 277, 32, 39) + lock(300, 308, .8)
    case 17: return panel(50, 66, 500, 268, i, 7) + rect(63, 79, 474, 242, 'none', 4, '#B2B5A4', 3) + rivets([[76, 92], [524, 92], [76, 308], [524, 308], [300, 91], [300, 308]]) + rect(240, 170, 120, 44, '#4C5653', 9) + handle(254, 187, 90) + buckle(133, 288) + buckle(443, 288)
    case 18: return panel(58, 64, 484, 272, i) + line('M230 77v246M366 77v246', '#4D4A3B', 6) + [111, 247, 383].map(x => rect(x, 137, 102, 53, brass, 2, ink, 1.5) + rect(x + 9, 146, 84, 34, '#C6BA98', 1, ink, 1)).join('') + lock(300, 306, .7)
    case 19: return panel(45, 58, 510, 284, i) + [56, 510].map(x => rect(x, 68, 34, 264, '#B4A17B', 3)).join('') + [73, 290].map(y => rect(66, y, 468, 35, '#9B875F', 2)).join('') + rivets([[77, 86], [524, 86], [78, 309], [522, 309]]) + [103, 281, 459].map(x => buckle(x, 298, 31, 26)).join('') + [103, 281, 459].map(x => buckle(x, 79, 31, 26)).join('')
    case 20: return path('M63 108H95V77H137V45H463V77H505V108H537V330H63Z', fill) + path('M83 123H115V94H155V64H445V94H485V123H517V310H83Z', 'none', brass, 4) + repeat(7, j => line(`M300 296L${150 + j * 50} 137`, '#B79F71', 2)) + lock(300, 298, .7)
    case 21: return panel(41, 70, 518, 260, i) + [151, 251, 351, 451].map(x => line(`M${x} 88v224`, '#786346', 2)).join('') + rect(56, 85, 488, 230, 'none', 3, '#CFB88F', 4) + [88, 436].map(x => rect(x, 73, 76, 18, iron, 2)).join('') + lock(300, 302, .65)
    case 22: return rect(48, 59, 504, 282, fill, 54) + stitched('M74 88Q298 66 526 88V313Q300 336 74 313Z') + line('M65 200h470', '#443C32', 5) + buckle(143, 183, 29, 36) + buckle(428, 183, 29, 36) + handle(241, 324, 120) + rect(273, 76, 63, 37, '#B7A27F', 2, ink, 1)
    case 23: return panel(61, 65, 478, 270, i, 13) + rect(80, 84, 440, 232, 'none', 6, brass, 10) + [98, 274, 451].map(x => rect(x, 66, 52, 27, iron, 4)).join('') + ellipse(300, 204, 65, 63, iron, brass, 4) + ellipse(300, 204, 43, 41, '#4F5A55', brass, 2) + line('M300 169v70M265 204h70', '#C2B58F', 8) + rivets([[92, 98], [507, 98], [92, 301], [507, 301]])
    default: throw new Error('未知箱设计。')
  }
}

function barrel(i: number): string {
  const ring = (rx = 224, ry = 224, x = 300, y = 300) => ellipse(x, y, rx, ry, fill, ink, 5) + ellipse(x, y, rx - 17, ry - 17, 'none', '#C2B290', 5)
  const lid = (rx = 197, ry = 197, x = 300, y = 300) => ellipse(x, y, rx, ry, fill) + grain(x - rx * .68, y - ry * .6, rx * 1.36, ry * 1.2, i)
  switch (i) {
    case 0: return ring() + lid() + line('M160 172L438 431M168 431L433 171', '#8E7756', 27) + line('M162 171L440 430M169 430L435 171', '#C5AD82', 19) + rivets([[178, 188], [421, 414], [188, 410], [412, 190]])
    case 1: return ring(230, 195) + ellipse(300, 300, 197, 162, '#48635A', '#6D7254', 4) + line('M150 280q89-48 188-13m-138 80q115 31 209-11', '#A1B9A3', 3) + rect(31, 259, 49, 82, fill, 9) + rect(520, 259, 49, 82, fill, 9) + rivets([[55, 279], [545, 279]])
    case 2: return ring(177, 225) + lid(149, 195) + path('M269 106L300 58 331 107 320 397H280Z', '#A58B61') + rect(218, 80, 164, 25, '#BC9F74', 10) + line('M191 287h218', iron, 22) + rivets([[205, 287], [395, 287]])
    case 3: return ring(242, 218) + ellipse(300, 300, 206, 181, '#605A43', '#CFB98D', 5) + ellipse(300, 306, 184, 156, '#847651', '#534F3E', 3) + [0, 90, 180, 270].map(a => `<g transform="rotate(${a} 300 300)">${rect(273, 67, 54, 48, '#8C7451', 3)}</g>`).join('') + line('M185 224q109-43 228 0M174 365q119 40 243 0', '#AA9770', 3)
    case 4: return path('M101 109Q299 49 499 109Q557 301 499 491Q300 551 101 491Q44 301 101 109Z', fill) + grain(128, 128, 344, 340, i, 18) + [113, 278, 443].map(y => rect(86, y, 428, 35, iron, 9) + line(`M99 ${y + 6}h403`, '#A3AB9C', 3)).join('') + ellipse(300, 217, 28, 24, '#62523C', light, 2) + [121, 439].map(y => rect(58, y, 484, 25, '#6C5941', 5)).join('')
    case 5: return path('M97 154Q298 81 503 154L518 449Q300 515 82 449Z', fill) + grain(130, 166, 340, 266, i) + [145, 427].map(y => line(`M107 ${y}q191-57 385 0`, iron, 20)).join('') + path('M111 165L481 432M116 431L480 163M191 141v311M400 140v311', 'none', '#C0B18B', 12) + path('M70 244q-69 44 0 95M530 244q69 44 0 95', 'none', '#B9AC85', 14)
    case 6: return rect(74, 88, 452, 424, fill, 83) + rect(94, 108, 412, 384, 'none', 61, '#CEB48B', 7) + panel(113, 125, 374, 351, i, 52) + [182, 375].map(x => strap(x, 118, 367)).join('') + line('M110 303h381', '#6B5C40', 4)
    case 7: return ring(237, 217) + lid(207, 186) + line('M300 118v367', '#524D3B', 7) + rect(281, 153, 38, 293, iron, 4) + handle(176, 299, 65) + handle(356, 299, 65) + [165, 398].map(y => rect(267, y, 66, 28, brass, 5)).join('')
    case 8: return path('M52 302Q167 77 300 101Q453 63 548 302Q457 519 299 501Q142 526 52 302Z', fill) + path('M90 302Q183 117 300 136Q424 107 512 302Q425 488 300 463Q180 490 90 302Z', '#537264', '#B0B78A', 7) + line('M103 299q110-93 208-47m-94 114q123 34 237-36', '#A4B8A0', 3) + path('M469 174l88-53-28 98Z', fill) + line('M482 181l59-44', '#C1BD8B', 3)
    case 9: return path('M162 61H438L539 162V438L438 539H162L61 438V162Z', fill, ink, 7) + path('M178 97H422L503 177V422L422 503H178L97 422V177Z', '#696E65', '#BEC0A9', 5) + [150, 300, 450].map(x => rect(x - 16, 111, 32, 378, iron, 4)).join('') + rect(266, 263, 68, 74, '#B49D6F', 6) + rivets([[135, 135], [465, 135], [135, 465], [465, 465]])
    case 10: return path('M104 153L209 79 352 96 477 149 535 303 484 447 336 513 184 483 72 380 65 248Z', fill) + path('M135 170L221 112 343 127 453 177 494 300 452 424 332 473 203 447 111 361 104 256Z', '#655846') + [40, 160, 280].map(a => `<g transform="rotate(${a} 300 300)">${path('M178 107q122-44 244 0', 'none', '#C8B89B', 20)}${line('M201 91l9 34m35-44 6 36m38-43 0 36m42-34-5 36m40-26-9 34', '#74654B', 5)}</g>`).join('') + lock(299, 304, 1.3)
    case 11: return path('M183 74H417L532 300 417 526H183L68 300Z', fill, ink, 6) + path('M200 107H400L496 300 400 490H200L104 300Z', '#768878', brass, 4) + ellipse(300, 300, 137, 139, fill, '#D6D7BD', 5) + path('M300 212L376 344H224Z', 'none', '#6B705A', 5) + ellipse(300, 300, 24, 24, brass)
    case 12: return path('M300 72Q412 30 425 176Q572 186 526 300Q572 414 425 425Q412 570 300 528Q187 570 175 425Q29 412 74 300Q30 186 175 176Q187 31 300 72Z', fill) + path('M300 112Q381 90 390 210Q509 219 488 300Q509 382 390 390Q380 510 300 488Q219 510 210 390Q90 381 112 300Q91 220 210 210Q220 90 300 112Z', '#536E67', '#BDC0A3', 4) + line('M302 136v326M136 300h326', '#B4BAA2', 9)
    case 13: return ring(230, 227) + repeat(6, j => `<g transform="rotate(${j * 60} 300 300)">${path('M185 112q115-45 230 0l-24 88q-91-28-182 0Z', brass, ink, 2)}</g>`) + lid(173, 173) + [0, 120, 240].map(a => `<g transform="rotate(${a} 300 300)">${path('M276 98h48l-5 114-19 30-19-30Z', iron)}</g>`).join('')
    case 14: return path('M92 194Q151 68 291 115Q467 54 515 222Q564 397 388 484Q237 537 119 422Q54 318 92 194Z', fill) + path('M125 212Q178 112 291 151Q444 96 479 236Q520 370 370 448Q248 493 148 400Q94 312 125 212Z', '#60765F', '#B5BC91', 6) + path('M284 119q-64-86 3-93q68 32 16 99', '#8E9971') + line('M172 272q82-50 158-16M196 352q92 42 189-9', '#A3B89A', 3)
    case 15: return ring(219, 203) + ellipse(300, 300, 182, 165, '#A99D70') + [108, 458].map(x => rect(x, 105, 34, 386, '#9A8156', 5)).join('') + rect(99, 123, 402, 35, '#C4A879', 5) + rect(284, 82, 32, 327, iron, 3) + line('M277 99l45 15m-45 18 45 15m-45 18 45 15m-45 18 45 15m-45 18 45 15m-45 18 45 15', '#A8A995', 4) + ellipse(300, 319, 102, 94, '#C2AC7D') + path('M461 401l91 46-17 23-92-41Z', fill)
    case 16: return ring(228, 228) + ellipse(300, 300, 199, 199, fill, '#ADB1A5', 5) + ellipse(300, 300, 178, 178, 'none', '#4F5B56', 3) + ellipse(228, 216, 37, 37, iron, '#C1C2B0', 4) + ellipse(386, 381, 19, 19, '#545E59', '#AFB2A3', 4) + line('M216 215h25M385 371v20', '#D0CEB8', 4) + rivets([[140, 161], [300, 83], [460, 161], [517, 300], [461, 460], [300, 517], [140, 460], [83, 300]], iron)
    case 17: return ring(193, 216) + ellipse(300, 300, 148, 167, fill, '#A4ADA3', 7) + ellipse(300, 300, 105, 121, '#6B7772', '#D4D6C4', 5) + handle(33, 265, 80) + handle(487, 265, 80) + path('M237 177q63-24 126 0', 'none', '#CDD0BD', 7) + rect(273, 397, 54, 34, iron, 4)
    case 18: return ring(218, 216) + ellipse(300, 300, 193, 191, '#667F73', '#D5DBCA', 6) + path('M100 301Q300 48 500 301', 'none', '#4D5E57', 12) + path('M108 302Q300 63 491 302', 'none', '#C4CABB', 4) + ellipse(95, 302, 12, 12, iron) + ellipse(505, 302, 12, 12, iron)
    case 19: return path('M103 174Q299 57 497 174L530 466Q301 550 70 466Z', fill) + path('M128 189Q299 101 472 189L493 438Q300 501 107 438Z', '#394640', '#B5B9A9', 5) + path('M123 176L300 63 477 176', fill) + handle(230, 130, 140) + repeat(8, j => path(`M${130 + (j % 4) * 84} ${307 + Math.floor(j / 4) * 88}l42-32 34 33-17 39-48-5Z`, '#454E48', '#667367', 3))
    case 20: return ring(247, 166) + ellipse(300, 300, 218, 136, '#7A8980', '#C5C9B6', 6) + weave(300, 302, 195, 111, 21) + handle(17, 271, 44) + handle(539, 271, 44) + line('M128 267q165-86 344 0', '#CCD0BB', 4)
    case 21: return ring(224, 224) + ellipse(300, 300, 183, 183, '#A0AE9D', '#E0DFC8', 10) + ellipse(300, 300, 157, 157, fill, '#7E9684', 4) + ellipse(300, 300, 33, 31, '#788C7A', '#CDD2BA', 4) + handle(36, 271, 40) + handle(524, 271, 40) + opacity(path('M153 202q-28 66-8 138M436 203q21 34 18 69', 'none', '#E4DFC7', 10), .8)
    case 22: return ring(228, 216) + lid(198, 186) + boxWeave(182, 188, 236, 224, 16) + ellipse(300, 300, 215, 203, 'none', iron, 12) + rect(270, 77, 64, 47, iron, 5) + buckle(281, 82, 42, 35) + rect(228, 299, 145, 65, '#C5B99B', 2, '#847D61', 2)
    case 23: return rect(73, 137, 454, 326, fill, 121) + rect(96, 158, 408, 283, 'none', 101, '#B3B9AA', 5) + line('M132 235h334M131 366h335', '#4F6059', 9) + ellipse(425, 230, 39, 42, '#6A7771', '#C3C7B6', 5) + line('M416 207l18 44M405 220l40 19', '#D0CEB9', 4) + handle(162, 114, 85) + handle(350, 114, 85)
    default: throw new Error('未知桶设计。')
  }
}

function basket(i: number): string {
  const bowl = (rx = 227, ry = 166) => ellipse(300, 240, rx, ry, fill, ink, 4) + ellipse(300, 240, rx - 15, ry - 15, '#877D58', light, 7) + weave(300, 240, rx - 28, ry - 28)
  const flat = () => rect(55, 68, 490, 344, fill, 28) + rect(73, 86, 454, 308, '#9C8A61', 18, light, 7) + boxWeave(93, 105, 414, 268)
  switch (i) {
    case 0: return bowl(209, 180) + handle(62, 216, 44) + handle(494, 216, 44) + ellipse(300, 240, 200, 172, 'none', '#C2AC7C', 5)
    case 1: return bowl(245, 148) + path('M55 228q-40-84 18-96m472 96q40-84-18-96', 'none', '#7A6C4A', 13) + path('M57 223q-26-63 14-77m472 77q26-63-14-77', 'none', '#D2BC91', 4)
    case 2: return flat() + [65, 508].map(x => rect(x, 183, 27, 100, '#796744', 9)).join('') + rivets([[71, 85], [529, 85], [71, 395], [529, 395]])
    case 3: return path('M40 237Q93 102 300 111Q511 99 560 237Q502 380 300 369Q91 383 40 237Z', fill) + repeat(7, j => line(`M${120 + j * 60} 151v181`, '#6B5B40', 4)) + grain(141, 166, 319, 147, i) + path('M114 259Q300 14 486 259', 'none', '#8F7550', 20) + path('M121 254Q300 36 479 254', 'none', '#D1B88D', 5)
    case 4: return bowl(220, 171) + ellipse(300, 240, 151, 115, fill, light, 10) + weave(300, 240, 140, 104, 12) + ellipse(300, 239, 47, 38, '#5C6048', '#CEB98B', 9) + strap(140, 93, 300) + buckle(136, 335, 33, 29)
    case 5: return flat() + [212, 376].map(x => line(`M${x} 93v294`, '#6D6249', 17) + line(`M${x - 3} 98v283`, '#D4BF95', 5)).join('') + handle(23, 219, 43) + handle(534, 219, 43)
    case 6: return path('M89 67H510L550 403H49Z', fill) + boxWeave(111, 97, 379, 268) + path('M104 82H496L531 387H70Z', 'none', light, 9) + path('M116 71Q43 18 68 189M483 71Q558 20 535 189', 'none', '#6F5840', 17) + buckle(55, 134, 27, 38) + buckle(518, 134, 27, 38)
    case 7: return flat() + line('M300 89v299', '#615C43', 5) + strap(285, 91, 294) + path('M269 184Q239 101 300 101Q360 101 331 184', 'none', '#7B6548', 15) + buckle(133, 350) + buckle(441, 350)
    case 8: return path('M35 241Q163 67 296 103Q442 60 566 241Q445 418 299 378Q157 416 35 241Z', fill) + weave(300, 239, 173, 108, 14) + line('M66 240q227-240 468 0M69 256q231 190 462 0', '#D0C199', 8) + path('M155 296Q296 24 439 284', 'none', '#728361', 15)
    case 9: return path('M154 66H446L554 240 446 414H154L46 240Z', fill) + path('M168 91H432L521 240 431 390H168L79 240Z', '#5B6760', '#ADB2A0', 6) + weave(300, 240, 181, 126, 19) + handle(29, 211, 44) + handle(527, 211, 44)
    case 10: return path('M77 88L222 61 376 85 516 65 552 380 416 419 283 391 85 415 48 274Z', fill) + stitched('M92 110L221 83 377 107 499 88 527 362 414 396 283 367 104 391 70 271Z') + path('M84 91L513 71M69 389L538 377M77 94L65 384M519 80L543 368', 'none', '#C7B99A', 16) + rivets([[89, 102], [507, 87], [81, 376], [529, 365]], '#837251')
    case 11: return path('M165 64H433L543 241 433 414H165L57 241Z', fill) + weave(300, 240, 191, 132) + line('M99 240h403M299 97v286', '#6C5D43', 16) + ellipse(300, 240, 70, 106, 'none', '#D2BC92', 11) + ellipse(300, 240, 61, 97, 'none', '#7B6A4D', 4)
    case 12: return path('M300 79Q411 37 418 151Q562 160 519 240Q561 323 418 330Q409 445 300 401Q191 445 182 330Q41 322 82 240Q39 161 182 151Q192 36 300 79Z', fill) + weave(300, 240, 167, 124) + path('M153 268L222 79 299 239 375 80 447 268', 'none', '#685945', 13) + line('M158 265L223 94 299 252 375 94 442 265', '#C0B08B', 4)
    case 13: return path('M151 72H449L546 240 449 408H151L54 240Z', fill) + weave(300, 240, 181, 129, 24) + path('M59 195L23 133 122 172 105 221ZM541 195l36-62-99 39 17 49Z', brass) + path('M185 124l115 194 114-194', 'none', '#A0AB99', 6)
    case 14: return path('M300 70Q397 26 413 141Q540 141 490 256Q555 358 430 378Q368 479 299 397Q225 477 168 378Q43 358 110 256Q57 142 186 141Q200 27 300 70Z', fill) + weave(300, 251, 154, 122) + ellipse(300, 252, 158, 126, 'none', '#D8C7A2', 8)
    case 15: return path('M47 244Q80 88 246 106Q345 48 505 132Q589 258 477 351Q357 433 251 377Q91 404 47 244Z', fill) + weave(300, 240, 200, 124) + path('M86 286Q91 71 270 119M509 286Q508 92 327 113', 'none', '#AC986A', 14) + line('M95 278Q103 86 269 127M500 277Q496 110 330 123', '#E0CDA3', 4)
    case 16: return flat() + rect(74, 87, 452, 306, 'none', 17, '#D7C09A', 8) + rect(63, 187, 30, 91, '#706449', 13) + rect(507, 187, 30, 91, '#706449', 13) + line('M87 111h426M87 365h426', '#83714F', 8)
    case 17: return rect(55, 70, 490, 340, '#4F5D56', 31, '#B3B9A9', 8) + boxWeave(80, 94, 440, 292, 21) + path('M104 300Q300 29 498 301M111 177Q300 439 489 177', 'none', '#ACB2A2', 10) + line('M113 292Q300 48 489 292M120 181Q300 421 481 181', '#D0CDB8', 2)
    case 18: return flat() + strap(133, 80, 319) + strap(443, 80, 319) + buckle(129, 341, 33, 38) + buckle(439, 341, 33, 38) + handle(236, 212, 127) + rect(65, 78, 470, 323, 'none', 20, '#9D8058', 8)
    case 19: return flat() + repeat(5, j => rect(126 + j * 73, 103, 8, 270, '#79674B', 2, light, 1)) + path('M78 278H522V383H78Z', fill) + boxWeave(91, 294, 418, 73, 13) + rivets([[75, 84], [525, 84], [75, 393], [525, 393]], iron)
    case 20: return path('M152 67H449L532 149V333L449 413H152L69 333V149Z', fill) + path('M164 89H436L510 161V322L437 391H164L91 322V161Z', '#6C6E55', brass, 7) + repeat(12, j => line(`M300 240L${n(300 + Math.cos(j * Math.PI / 6) * 191)} ${n(240 + Math.sin(j * Math.PI / 6) * 136)}`, brass, 4)) + handle(35, 210, 50) + handle(515, 210, 50)
    case 21: return bowl(206, 183) + ellipse(300, 240, 147, 128, '#756B4E', light, 6) + weave(300, 240, 136, 117, 11) + repeat(16, j => { const a = j * Math.PI / 8; return line(`M${n(300 + Math.cos(a) * 155)} ${n(240 + Math.sin(a) * 135)}l${n(Math.cos(a) * 40)} ${n(Math.sin(a) * 35)}`, '#695D43', 4) })
    case 22: return bowl(207, 180) + weave(300, 240, 185, 157, 10) + path('M109 239Q300 94 492 239', 'none', '#73573E', 22) + stitched('M116 236Q300 110 484 236') + buckle(284, 169, 32, 32)
    case 23: return rect(58, 81, 484, 318, '#7B8A7D', 39, '#C4CDBB', 8) + boxWeave(81, 104, 438, 272, 15) + rect(76, 97, 448, 286, 'none', 22, '#596E65', 3) + handle(45, 216, 70) + handle(485, 216, 70)
    default: throw new Error('未知篮设计。')
  }
}

function sack(i: number): string {
  const body = (d: string) => path(d, fill, ink, 4)
  const seams = () => stitched('M130 207q-38 122-13 266M350 204q41 129 15 266M134 491q104 37 211 0')
  const wrinkles = () => fold('M158 206q46 79 19 143M300 205q-37 68-17 121M150 440q49-21 71-4M331 436q-51-15-72 4')
  const tie = (y = 155) => path(`M185 ${y}q55-15 110 0m-110 10q55-15 110 0`, 'none', '#6F6348', 9)
    + path(`M226 ${y + 4}q-73-52-67-3q26 24 68 3q76-52 68-3q-29 26-68 3m0 1-32 47m36-47 35 44`, 'none', '#CCBC91', 5)
  switch (i) {
    case 0: return body('M184 87Q235 55 292 87L277 144Q365 205 384 350L366 487Q241 553 113 487L94 355Q109 208 202 144Z') + seams() + wrinkles() + tie()
    case 1: return body('M127 82Q240 65 354 82L344 119Q378 270 376 464L347 522H132L103 465Q103 267 137 119Z') + rect(128, 84, 225, 34, '#A99F7E', 4, '#7A775C', 2) + seams() + fold('M142 134q-18 177-8 270M336 138q16 171 7 265M140 491l41-32m157 30-39-30')
    case 2: return body('M186 116Q240 89 294 116L278 168Q373 224 363 364Q346 472 239 487Q130 469 115 363Q102 224 202 169Z') + stitched('M153 266q-21 141 87 195q108-55 88-195') + tie(166) + fold('M171 211q37 41 29 106M304 213q-38 39-26 103')
    case 3: return body('M119 118H361L381 454 342 517H139L100 454Z') + rect(130, 103, 220, 47, '#A29875', 5) + path('M132 156Q42 104 72 229M348 156Q438 104 408 229', 'none', '#9F9575', 24) + stitched('M143 169q-20 132-13 296M337 168q22 126 13 296') + wrinkles()
    case 4: return body('M141 132L316 82 364 203 355 479 302 523H145L110 474 116 242Z') + body('M138 135L315 85 341 194 187 220Z') + path('M132 218l223-37', 'none', '#716747', 24) + buckle(231, 184, 29, 38) + stitched('M138 255l1 213 31 32h120l41-34V238')
    case 5: return body('M194 73Q239 48 285 73L273 157Q328 197 363 322L374 493Q238 549 105 492L116 321Q149 202 208 157Z') + stitched('M139 344l35-87 74 89 74-88 23 86M130 459l118-113 106 115M248 346v150') + tie(154) + handle(209, 70, 62)
    case 6: return body('M117 140Q269 90 363 178L352 440Q260 512 117 444Q80 288 117 140Z') + body('M117 142Q269 93 363 179L329 226Q231 162 128 194Z') + path('M132 144Q24 16 62 303M346 165Q437 46 421 318', 'none', '#6D5942', 18) + stitched('M135 227q-27 112 0 194q93 50 195 1') + fold('M170 239q63 21 110 2M167 394q65-14 131-4')
    case 7: return path('M72 178H409V419H72Z', '#69553F') + rect(38, 136, 187, 317, fill, 43) + rect(255, 136, 187, 317, fill, 43) + body('M44 148Q130 117 219 148L208 254 130 284 51 254Z') + body('M261 148Q349 119 436 148L424 254 348 284 268 254Z') + buckle(117, 245, 29, 37) + buckle(335, 245, 29, 37) + stitched('M64 292v122h136v-122M282 292v122h136v-122')
    case 8: return body('M240 67Q291 101 309 152Q389 221 357 417L238 533 124 420Q93 226 174 151Q191 102 240 67Z') + body('M240 70Q278 129 270 203L240 239 210 203Q200 126 240 70Z') + line('M153 246q82 36 170 0M143 414l95 95 99-96', '#C7C5A0', 3) + path('M169 175q71-31 142 0', 'none', '#718665', 10) + wrinkles()
    case 9: return body('M141 111H339L391 224 367 442 304 518H176L112 443 89 224Z') + rect(136, 112, 209, 40, iron, 5) + strap(224, 152, 327, true) + path('M129 414l59-30h104l59 30-57 81H187Z', iron) + rivets([[147, 424], [333, 424], [193, 479], [289, 479]]) + stitched('M122 228l20 131m217-131-20 131')
    case 10: return body('M149 119L254 88 353 145 394 296 363 482 236 530 110 481 87 300Z') + body('M148 121L254 92 351 147 327 257 233 283 131 253Z') + path('M212 253l52 8-4 40-51-6Z', '#C6B695') + stitched('M124 307l111 74 120-75M125 453l110-72 109 82') + path('M120 166Q23 88 46 286M351 170q101-69 81 127', 'none', '#B4A07A', 13)
    case 11: return body('M167 143H313L361 234 344 430 238 493 135 431 118 236Z') + [0, 90, 180, 270].map(a => `<g transform="rotate(${a} 240 313)">${rect(196, 170, 88, 146, fill, 24)}${body('M196 178q44-15 88 0l-13 67h-62Z')}${buckle(229, 232, 22, 27)}</g>`).join('') + tie(146)
    case 12: return body('M161 91H319L348 213 335 447 240 534 145 448 132 213Z') + body('M162 93L240 72 318 93 312 210 240 266 169 210Z') + [197, 259, 321].map(y => rect(216, y, 48, 22, brass, 3)).join('') + stitched('M155 284v149l85 78 85-78V284') + fold('M176 307q63 23 127 0M180 413q57-19 119 0')
    case 13: return body('M240 63L339 152 387 285 358 468 240 533 120 468 93 285 140 153Z') + repeat(4, j => repeat(3, k => body(`M${143 + k * 64} ${196 + j * 61}l32-24 33 24-8 52-25 25-25-25Z`))) + body('M147 154L240 77 332 154 296 219H183Z') + lock(203, 184, .55) + lock(276, 184, .55)
    case 14: return body('M205 120Q311 68 353 206Q405 321 335 437Q279 526 166 463Q70 413 111 277Q109 177 205 120Z') + body('M194 147Q224 73 289 79Q314 159 261 201Z') + path('M205 154q-66-65-83-24q14 54 83 24q53-59 69-21q-5 44-69 21', 'none', '#A0A779', 8) + fold('M151 250q74 45 172 7M154 401q73-25 155-9')
    case 15: return body('M103 167Q230 84 363 161Q394 282 352 453Q249 525 123 454Q74 301 103 167Z') + path('M116 164q120-59 235-7l-6 52q-115-40-219 4Z', '#C9B78C') + line('M126 182q115-37 218-7', '#786D4E', 6) + tie(194) + wrinkles() + stitched('M128 278q-17 97 15 155M342 273q20 101-13 158')
    case 16: return body('M137 88H343L374 157 366 477Q241 542 114 479L106 160Z') + rect(136, 96, 208, 40, '#A39875', 5) + repeat(8, j => ellipse(151 + j * 25, 115, 5, 6, '#585D4A', brass, 2)) + tie(143) + seams() + rect(203, 283, 101, 72, '#C6BA98', 2, '#77765B', 2) + line('M254 145l-4 137', '#726B51', 3)
    case 17: return body('M155 101Q240 72 325 101L346 151 366 441Q345 517 240 523Q131 517 114 442L132 152Z') + ellipse(240, 453, 115, 59, '#8A8363', '#BFB28D', 4) + path('M152 133Q77 184 120 371M325 134Q399 192 353 374', 'none', '#766D51', 24) + stitched('M160 191q-14 119-9 228M319 191q15 121 8 228') + tie(149)
    case 18: return rect(74, 126, 332, 356, fill, 64) + body('M86 132Q239 81 394 131L394 200Q239 169 86 200Z') + rect(83, 161, 314, 24, brass, 7) + path('M157 171Q124 66 239 65Q353 65 322 171', 'none', '#584A3B', 19) + path('M168 167Q146 88 239 87Q331 87 311 167', 'none', '#B7A282', 4) + stitched('M101 226v198q137 61 279 0V226') + lock(240, 177, .55)
    case 19: return rect(54, 172, 372, 247, fill, 98) + ellipse(104, 294, 40, 103, '#5B4C3B', '#C3AC84', 4) + ellipse(104, 294, 25, 77, '#8A7758') + strap(158, 179, 230) + strap(332, 179, 230) + buckle(154, 265, 33, 43) + buckle(328, 265, 33, 43) + stitched('M204 193q-17 104 0 205M302 192q14 106 0 206')
    case 20: return rect(86, 106, 308, 382, fill, 34) + body('M90 112H390L371 263 241 322 108 264Z') + stitched('M104 131H376L356 252 241 300 123 251Z') + buckle(225, 280, 30, 40) + handle(184, 103, 112) + stitched('M107 340v121h265V340')
    case 21: return body('M108 135Q239 101 373 136L382 428 345 507H135L97 429Z') + body('M112 137Q238 111 369 137L360 192Q238 168 122 194Z') + path('M130 156Q54 53 74 254M350 156Q426 53 406 254', 'none', '#A39877', 27) + stitched('M135 215l-10 196 29 70h170l31-71-12-196') + wrinkles()
    case 22: return rect(72, 143, 336, 337, fill, 91) + repeat(5, j => repeat(4, k => path(`M${111 + k * 65} ${210 + j * 45}l24-16 25 16-25 17Z`, (j + k) % 2 ? '#8D7657' : '#B7A07A', '#736548', 1))) + path('M85 165Q240 125 395 165', 'none', brass, 16) + path('M151 167Q132 64 210 80Q240 72 267 81Q348 63 330 166', 'none', '#5D4D3A', 18) + stitched('M99 218q-10 137 21 210M382 218q8 137-22 210')
    case 23: return body('M89 181Q230 141 367 177L414 234 391 397 338 444H111L67 398 61 239Z') + body('M345 179L400 176 427 236 394 288 365 258Z') + tie(245) + stitched('M91 226L87 382 121 417H327l44-39M113 200l42 37m-57 149 55-31m167 66-41-53') + fold('M151 267q90-28 174 1M145 360q77 28 164 4')
    default: throw new Error('未知袋设计。')
  }
}

export const STORAGE_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Storage-Collection-1'
export const STORAGE_COLLECTION_LICENSE = `Sceneweave Storage Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG designs of chests, barrels, baskets and bags, authored with coding assistance. No third-party artwork or reference-image pixels are embedded. Illustrative period and fantasy interpretations; art review is separate from technical validation.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

function artwork(design: StorageDesign, index: number): VisualSampleArt {
  const [w, h] = design.category === 'chest' ? [600, 400] : design.category === 'barrel' ? [600, 600] : design.category === 'basket' ? [600, 480] : [480, 600]
  const [base, bright, dark] = palettes[design.material]
  const surface = `<defs><linearGradient id="surface" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${bright}"/><stop offset="38%" stop-color="${base}"/><stop offset="100%" stop-color="${dark}"/></linearGradient></defs>`
  const body = ({ chest, barrel, basket, sack }[design.category])(index)
  const categoryNames = { chest: '箱', barrel: '桶', basket: '篮', sack: '袋' }
  return { key: design.key, name: design.name, kind: 'prop', widthMm: design.widthMm, heightMm: design.heightMm,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${surface}<g transform="scale(${design.widthMm / w} ${design.heightMm / h})">${body}</g></svg>`,
    footprintMm: { width: Math.round(design.widthMm * .9), height: Math.round(design.heightMm * .9) }, blocksMovement: true, blocksSight: false,
    renderLayer: 'object', shadowClass: 'furniture', tags: ['原创', '仓储生活', categoryNames[design.category], design.category, design.era, design.material, design.design, '俯视'] }
}
export const STORAGE_COLLECTION_ART: readonly VisualSampleArt[] = freezeJson(STORAGE_DESIGNS.map(design => artwork(design,
  STORAGE_DESIGNS.filter(row => row.category === design.category).findIndex(row => row.key === design.key))))
