import { LIGHTING_DESIGNS, type LightingDesign } from '../assets/lighting-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

// Original plan views; warm wax, glass and embers are painted matter, never a light-source contract.
const edge = '#4D4A3F', light = '#D8CBAA', brass = 'url(#brass)', iron = 'url(#iron)', wood = 'url(#wood)', stone = 'url(#stone)', glass = 'url(#glass)', ceramic = 'url(#ceramic)'
const times = (n: number, fn: (i: number) => string) => Array.from({ length: n }, (_, i) => fn(i)).join('')
// Object-bounding-box gradients have no paint box on a perfectly straight path.
// Solid material midtones keep every narrow mechanical link visible after rasterization.
const strokePaint = (paint: string) => ({ [brass]:'#A39268', [iron]:'#78816E', [wood]:'#93805A', [stone]:'#939E87', [glass]:'#D6D8BE', [ceramic]:'#BBB79A' }[paint] ?? paint)
const p = (d: string, fill = 'none', stroke = edge, w = 2.5) => `<path d="${d}" fill="${fill}" stroke="${strokePaint(stroke)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
const r = (x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke = edge, sw = 2.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${strokePaint(stroke)}" stroke-width="${sw}"/>`
const e = (x: number, y: number, rx: number, ry: number, fill: string, stroke = edge, sw = 2.5) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${strokePaint(stroke)}" stroke-width="${sw}"/>`
const move = (x: number, y: number, body: string, scale = 1, rotation = 0) => `<g transform="translate(${x} ${y}) rotate(${rotation}) scale(${scale})">${body}</g>`
const rail = (d: string, fill = iron, width = 13) => p(d, 'none', edge, width + 4) + p(d, 'none', fill, width) + p(d, 'none', '#C8C6AF', 1.1)
const bolt = (x: number, y: number, size = 4) => e(x, y, size, size, '#A8A78E', '#515548', 1.5) + p(`M${x - size * .55} ${y + size * .35}l${size} ${-size * .6}`, 'none', '#656B5D', 1.1)
const polygon = (cx: number, cy: number, rad: number, n: number, fill: string, rotation = -90, stroke = edge, sw = 3) => p(times(n, i => { const a = (rotation + i * 360 / n) * Math.PI / 180; return `${i ? 'L' : 'M'}${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}` }) + 'Z', fill, stroke, sw)
const ring = (cx: number, cy: number, rad: number, fill = iron, width = 15) => e(cx, cy, rad, rad, 'none', edge, width + 4) + e(cx, cy, rad, rad, 'none', fill, width) + e(cx, cy, rad - width * .35, rad - width * .35, 'none', '#B5B5A0', 1.1)
const grain = (x: number, y: number, w: number, h: number) => `<g opacity=".4">${times(11, i => p(`M${x} ${y + h * (i + .6) / 12}q${w * .27} ${i % 3 - 1} ${w * .54} 0t${w * .46} 0`, 'none', i % 3 ? '#CBB387' : '#5E523D', 1.3))}</g>`
const plank = (x: number, y: number, w: number, h: number) => r(x, y, w, h, wood, 7) + grain(x + 9, y + 8, w - 18, h - 16) + bolt(x + 12, y + 12) + bolt(x + w - 12, y + h - 12)
const star = (cx: number, cy: number, rad: number, n: number, fill: string) => p(times(n, i => { const a = i * Math.PI * 2 / n - Math.PI / 2, b = a + Math.PI / n; return `${i ? 'L' : 'M'}${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}L${cx + rad * .5 * Math.cos(b)} ${cy + rad * .5 * Math.sin(b)}` }) + 'Z', fill)
const wax = (x: number, y: number, size = 1) => move(x, y, e(0, 0, 31, 31, brass) + e(0, 0, 24, 24, '#77664B', '#D1C097', 2) + p('M-16-10Q-20-23-7-21Q4-26 16-12Q23-1 16 14Q7 24-9 17Q-24 17-16-10Z', '#D9CDA7', '#A79976', 1.3) + e(-2, -2, 10, 10, '#C6B78E', '#E8DBB5', 1) + p('M0 3l2-8', 'none', '#645847', 2.3), size)
const oil = (x: number, y: number, size = 1, rotation = 0) => move(x, y, p('M-34-22Q-4-40 26-18L48-2 25 12Q5 32-22 23Q-49 13-34-22Z', ceramic) + e(-3, -1, 24, 21, '#5D5942', '#B9AD86', 3) + p('M30-1l11-1', 'none', '#CDBA8C', 7) + p('M34-2l8 1', 'none', '#61553E', 2), size, rotation)
const leaf = (x: number, y: number, s = 1, rotation = 0) => move(x, y, p('M0-48Q49-25 29 15Q13 37 0 49Q-48 21-34-15Q-27-36 0-48Z', '#8F9B75', '#5B6E57', 3) + p('M0-35Q-12 5 0 37M-2-8l21-14M-3 13l-20-10', 'none', '#C0C5A1', 2), s, rotation)
const crystal = (x: number, y: number, s = 1, rotation = 0) => move(x, y, p('M0-45L28-20 25 23 0 45-27 21-26-18Z', '#9AADA5', '#61786F', 3) + p('M0-45L8-13 0 45-9 0Z', '#CED3BA', '#8FA89A', 1.5) + p('M-25-18L8-13 25 23', 'none', '#E4E2C9', 2), s, rotation)
const shade = (x: number, y: number, rad: number, fill = '#687F68', fluted = false) => e(x, y, rad, rad, fill, '#566252', 3) + e(x, y, rad * .91, rad * .91, 'none', '#B4B89B', 2) + (fluted ? times(24, i => { const a = i * Math.PI / 12; return p(`M${x + rad * .22 * Math.cos(a)} ${y + rad * .22 * Math.sin(a)}L${x + rad * .88 * Math.cos(a)} ${y + rad * .88 * Math.sin(a)}`, 'none', i % 2 ? '#B9B298' : '#88816B', 1.5) }) : '') + e(x, y, rad * .18, rad * .18, brass, edge, 2)
const globe = (x: number, y: number, rad: number) => e(x, y, rad + 4, rad + 4, brass) + e(x, y, rad, rad, glass, '#9A9E88', 2) + p(`M${x - rad * .6} ${y - rad * .1}q${rad * .05} ${-rad * .48} ${rad * .53} ${-rad * .55}`, 'none', '#E9E8D3', 3)
const lanternHead = (x: number, y: number, s = 1, shape: 'square' | 'hex' | 'round' = 'square', fill = brass) => move(x, y,
  (shape === 'square' ? r(-56, -57, 112, 114, fill, 12) + r(-42, -43, 84, 86, glass, 7) : shape === 'hex' ? polygon(0, 0, 66, 6, fill, -90) + polygon(0, 0, 51, 6, glass, -90) : e(0, 0, 61, 61, fill) + e(0, 0, 48, 48, glass))
  + wax(0, 0, .67) + rail('M-42-42L42 42M42-42L-42 42', fill, 7) + e(0, 0, 14, 14, fill) + bolt(0, 0), s)
const base = (kind = 'round') => kind === 'square' ? r(185, 185, 230, 230, iron, 19) + r(201, 201, 198, 198, brass, 11) : e(300, 300, 112, 112, iron) + e(300, 300, 96, 96, brass)
const feet = (n = 3, rad = 188, fill = iron) => times(n, i => { const a = (i * 360 / n - 90) * Math.PI / 180, x = 300 + rad * Math.cos(a), y = 300 + rad * Math.sin(a); return rail(`M300 300L${x} ${y}`, fill, 17) + e(x, y, 23, 18, fill) })
const spokes = (n: number, rad: number, fill = iron, width = 13) => times(n, i => { const a = i * Math.PI * 2 / n - Math.PI / 2; return rail(`M300 300L${300 + rad * Math.cos(a)} ${300 + rad * Math.sin(a)}`, fill, width) })
const around = (n: number, rad: number, fn: (x: number, y: number, i: number) => string) => times(n, i => { const a = i * Math.PI * 2 / n - Math.PI / 2; return fn(300 + rad * Math.cos(a), 300 + rad * Math.sin(a), i) })
const stitches = (ax:number,ay:number,bx:number,by:number,cx:number,cy:number,half=10) => p(times(9,n=>{
  const t=(n+1)/10,x=(1-t)**2*ax+2*(1-t)*t*bx+t*t*cx,y=(1-t)**2*ay+2*(1-t)*t*by+t*t*cy
  const dx=2*(1-t)*(bx-ax)+2*t*(cx-bx),dy=2*(1-t)*(by-ay)+2*t*(cy-by),len=Math.hypot(dx,dy),nx=-dy/len*half,ny=dx/len*half
  return `M${x-nx} ${y-ny}L${x+nx} ${y+ny} `
}),'none','#756B50',2.7)
const back = (fill = iron, wide = false) => r(wide ? 175 : 250, 55, wide ? 250 : 100, 100, fill, 12) + bolt(wide ? 190 : 269, 76) + bolt(wide ? 410 : 331, 132)

function chandelier(i: number): string {
  switch (i) {
    case 0: return ring(300, 300, 184) + spokes(3, 182) + around(6, 202, (x, y) => wax(x, y)) + e(300, 300, 25, 25, iron)
    case 1: return plank(76, 241, 448, 118) + [119, 475].map(x => r(x, 234, 18, 132, iron, 2)).join('') + [[116, 205], [238, 388], [363, 205], [485, 388]].map(([x,y]) => rail(`M${x} 300V${y}`) + wax(x, y)).join('')
    case 2: return plank(242, 74, 116, 452) + plank(74, 242, 452, 116) + r(266, 266, 68, 68, iron, 5) + [[108,216],[108,382],[217,107],[383,107],[490,217],[490,383],[217,492],[383,492]].map(([x,y]) => rail(`M300 300L${x} ${y}`, wood, 12) + wax(x,y)).join('')
    case 3: return ring(300,300,198,wood,32)+spokes(12,187,wood,13)+around(12,222,(x,y)=>wax(x,y,.83))+e(300,300,38,38,iron)+bolt(300,300,9)
    case 4: return e(300,300,224,142,'none',edge,23)+e(300,300,224,142,'none',brass,17)+e(300,300,190,109,'none',iron,9)+rail('M82 300h436M300 162v276',brass,10)+times(8,n=>{const a=n*Math.PI/4;return wax(300+218*Math.cos(a),300+154*Math.sin(a),.94)})
    case 5: return ring(300,300,205)+ring(300,300,124,brass,14)+spokes(8,198)+around(8,214,(x,y)=>wax(x,y,.9))+around(8,112,(x,y)=>wax(x,y,.73))+e(300,300,26,26,iron)
    case 6: return rail('M135 135H465V465H135Z',wood,29)+rail('M135 135L465 465M465 135L135 465',iron,9)+[[135,135],[465,135],[135,465],[465,465]].map(([x,y])=>lanternHead(x,y,.93,'square')).join('')+e(300,300,26,26,iron)
    case 7: return polygon(300,300,222,6,stone)+polygon(300,300,174,6,'#595D50')+spokes(3,156,iron,7)+around(6,204,(x,y,n)=>oil(x,y,.85,n*60))+oil(300,300,1.25)
    case 8: return rail('M90 390Q180 292 300 300Q437 250 515 136M202 349Q140 200 112 158M300 300Q314 162 357 99M404 235Q472 348 497 426M251 306Q269 421 209 492',wood,20)+[[112,158,-35],[209,492,155],[357,99,0],[515,136,50],[497,426,135],[90,390,220]].map(([x,y,a])=>leaf(x,y,1.05,a)+oil(x,y,.65,a)).join('')+e(300,300,24,24,brass)
    case 9: return polygon(300,300,218,6,iron)+polygon(300,300,175,6,'#555F56')+spokes(6,192,brass,18)+around(6,201,(x,y)=>lanternHead(x,y,.69,'hex',iron))+polygon(300,300,42,6,brass)
    case 10: return rail('M300 435Q239 351 192 239L81 156M192 239L125 289M192 239L208 119M300 435Q361 351 408 239L519 156M408 239L475 289M408 239L392 119','#B7B29A',23)+[[81,156],[125,289],[208,119],[245,337],[519,156],[475,289],[392,119],[355,337]].map(([x,y])=>wax(x,y,.92)).join('')+r(270,371,60,57,'#85704E',7)
    case 11: return e(300,300,221,187,'none',edge,15)+e(300,300,221,187,'none',brass,10)+e(275,292,145,220,'none','#8C957E',8)+rail('M87 168L482 426M97 426L478 155',brass,11)+[[300,84],[511,290],[396,466],[122,416],[176,198]].map(([x,y],n)=>crystal(x,y,.92,n*40)).join('')+globe(300,300,40)
    case 12: return polygon(300,300,229,8,iron)+polygon(300,300,202,8,'#58594D')+times(8,n=>move(300,300,p('M0-21L-54-143 0-199 54-143Z',iron,'#9D9B80',2)+lanternHead(0,-203,.58,'hex',brass),1,n*45))+e(300,300,30,30,brass)
    case 13: return p('M300 388Q208 460 62 307L106 163 191 220 218 114 291 225 300 130 309 225 382 114 409 220 494 163 538 307Q392 460 300 388Z',iron)+rail('M300 370L108 184M300 370L222 141M300 370L492 184M300 370L378 141',brass,10)+[[83,308],[106,163],[191,220],[218,114],[259,257],[341,257],[382,114],[409,220],[494,163],[517,308]].map(([x,y])=>wax(x,y,.75)).join('')+r(278,269,44,143,brass,14)
    case 14: return times(5,n=>move(300,300,p('M0 12Q-128-50-60-160Q0-228 60-160Q128-50 0 12Z','#959F7A','#61745C',3)+oil(0,-173,.85,90),1,n*72))+oil(300,300,1.35)
    case 15: return p('M300 102Q75 79 102 316Q155 489 300 474Q442 489 498 316Q525 79 300 102Z','none',edge,24)+p('M300 102Q75 79 102 316Q155 489 300 474Q442 489 498 316Q525 79 300 102Z','none',wood,18)+rail('M300 102Q430 300 300 474Q169 300 300 102M154 300H446',wood,18)+[[300,102],[114,269],[184,438],[416,438],[486,269],[300,301]].map(([x,y],n)=>oil(x,y,.86,n*60)).join('')
    case 16: return spokes(6,179,brass,13)+around(6,203,(x,y)=>globe(x,y,53))+e(300,300,48,48,brass)+ring(300,300,114,brass,7)
    case 17: return rail('M101 183H499M101 417H499M181 183V417M419 183V417M181 300H419',iron,16)+[[146,183],[454,183],[146,417],[454,417]].map(([x,y])=>shade(x,y,72,glass)).join('')+r(260,267,80,66,iron,10)
    case 18: return r(120,120,360,360,brass,5)+r(143,143,314,314,'#818477',3)+r(170,170,260,260,brass,2)+r(193,193,214,214,glass,2)+[[180,96],[420,96],[504,180],[504,420],[420,504],[180,504],[96,420],[96,180]].map(([x,y],n)=>r(x-45,y-22,90,44,glass,3)+rail(n%2?`M${x} ${y}L300 300`:`M${x} ${y}L300 300`,brass,6)).join('')+r(268,268,64,64,brass,4)
    case 19: return spokes(3,199,brass,5)+ring(300,300,203,brass,9)+ring(300,300,119,brass,7)+around(36,203,(x,y,n)=>e(x,y,8+n%2*2,8+n%2*2,glass,'#9FAD9C',1))+around(12,226,(x,y,n)=>crystal(x,y,.55,n*30))+globe(300,300,83)
    case 20: return rail('M84 300H516',brass,16)+[133,300,467].map(x=>shade(x,300,94,'#577565')).join('')+[203,397].map(x=>r(x,273,18,54,brass,3)).join('')
    case 21: return times(6,n=>move(300,300,rail('M0 0Q-84-99 0-202',brass,11)+leaf(0,-161,1.06,0)+shade(0,-202,52,glass),1,n*60))+globe(300,300,36)
    case 22: return rail('M129 153H471V447H129Z',iron,21)+rail('M129 153L471 447M471 153L129 447',iron,9)+[[129,153],[471,153],[129,447],[471,447]].map(([x,y])=>lanternHead(x,y,1.1,'round',iron)+ring(x,y,50,iron,6)).join('')+r(274,274,52,52,iron,4)
    case 23: return rail('M88 217H512M88 383H512M105 217V383M495 217V383',brass,14)+[122,242,362,482].map(x=>shade(x,217,48,glass)+shade(x,383,48,glass)).join('')+rail('M300 217v166',brass,10)+e(300,300,25,25,brass)
    default: throw new Error('未知吊灯构造。')
  }
}

function wallLamp(i: number): string {
  switch (i) {
    case 0: return back()+plank(275,115,50,333)+r(264,181,72,25,iron,2)+r(264,309,72,25,iron,2)+p('M267 370Q244 399 252 481L300 531 348 481Q355 404 333 370Z','#8F7753')+p('M267 398l61 75m-71-42 62 65m-53-12 55-50','none','#B6A078',5)
    case 1: return back(brass)+rail('M300 123Q277 279 300 392',iron,17)+wax(300,422,1.85)
    case 2: return back()+rail('M300 128V284Q220 341 155 376M300 284Q380 341 445 376',iron,18)+wax(155,386,1.58)+wax(445,386,1.58)
    case 3: return back(stone,true)+r(261,139,78,90,stone,8)+p('M176 189Q300 151 424 189L481 431Q300 525 119 431Z',stone)+p('M165 410Q300 465 435 410','none','#B7B9A0',4)+oil(300,354,2.15,90)
    case 4: return back()+rail('M300 123V240',iron,20)+p('M158 237L300 161 442 237 432 438 168 438Z',iron)+r(186,249,228,169,glass,24)+wax(300,340,1.3)+rail('M186 249L414 418M414 249L186 418',iron,9)+p('M153 239H447L414 192H186Z',iron)
    case 5: return back(wood,true)+rail('M227 123L159 420M373 123L441 420M159 420H441',wood,22)+lanternHead(300,348,1.58,'square',wood)+rail('M300 121v119',iron,12)
    case 6: return p('M98 101Q300 32 502 101L449 204H151Z',brass)+p('M300 143V294','none',brass,21)+p('M105 300Q300 212 495 300Q494 499 300 513Q105 496 105 300Z',brass)+p('M130 314Q300 251 470 314Q457 469 300 481Q143 466 130 314Z','#5A5541')+oil(188,361,1.1,180)+oil(412,361,1.1,0)
    case 7: return back(iron,true)+rail('M194 122L409 450M406 122L191 450',wood,29)+[0,1].map(n=>move(n?191:409,450,p('M-28-55Q-55-13-42 38L0 68 42 38Q55-13 28-55Z','#89734F')+p('M-31-27l58 50m-61-13 55 49m-46-58 45 30','none','#C1AA78',5),1,n?-25:25)).join('')+rail('M235 188l32 19M333 188l32-19M274 349l31 21M295 370l31-21',iron,14)
    case 8: return back(wood)+rail('M300 116Q207 218 185 402M231 218Q384 278 425 410',wood,20)+leaf(185,407,1.4,-20)+leaf(425,410,1.3,35)+oil(185,407,.98,-35)+oil(425,410,.94,20)
    case 9: return polygon(300,111,88,6,iron)+rail('M300 138v137',iron,27)+lanternHead(300,381,1.73,'hex',iron)+[[249,88],[351,88],[300,163]].map(([x,y])=>bolt(x,y,7)).join('')
    case 10: return back(stone,true)+rail('M204 134Q115 280 245 423M396 134Q485 280 355 423M300 134V349','#B5AF91',25)+p('M210 151l31 39m-49 1 32 32m177-74-31 39m47 3-30 30','none','#79775D',4)+oil(300,398,2.04,90)+r(277,270,46,47,'#826B4D',8)
    case 11: return r(217,53,166,191,brass,8)+p('M239 93l33 36-27 41m111-77-33 36 27 41','none','#6B6C59',4)+rail('M300 213v102M300 315L173 417M300 315L427 417',brass,14)+crystal(300,329,1.42)+crystal(173,435,1.18,-30)+crystal(427,435,1.18,30)
    case 12: return p('M300 48L408 160V518H192V160Z',iron)+p('M300 77L382 169V490H218V169Z','#9B9C7E')+rail('M204 473L300 233 396 473',brass,12)+lanternHead(300,369,1.23,'hex',brass)
    case 13: return back(iron,true)+rail('M300 133Q183 238 260 359Q339 437 401 407',brass,31)+times(7,n=>{const t=(n+1)/9;return e((1-t)**2*300+2*(1-t)*t*183+t*t*260,(1-t)**2*133+2*(1-t)*t*238+t*t*359,14,9,'#9FA583','#69745B',2)})+p('M234 271L130 301 182 350 247 330M324 357L434 312 464 376 373 414Z',iron)+oil(407,420,1.58,35)
    case 14: return back(wood)+rail('M300 133V444M300 270L166 390M300 270L434 390',wood,17)+[[166,390,-45],[300,444,0],[434,390,45]].map(([x,y,a])=>leaf(x,y,1.32,a)+oil(x,y,.95,a)).join('')
    case 15: return e(300,115,125,78,wood)+p('M218 88Q309 62 386 107M211 128q76 26 173-1','none','#C0AC80',3)+rail('M300 126v148M300 274L166 411M300 274L434 411',wood,24)+oil(166,421,1.28,175)+oil(434,421,1.28,5)
    case 16: return e(300,106,88,58,brass)+rail('M300 126Q183 238 300 360',brass,22)+globe(300,403,109)
    case 17: return r(129,80,342,90,brass,4)+r(156,170,288,49,brass,3)+r(184,219,232,36,brass,3)+rail('M300 248V300',brass,17)+p('M300 274L72 445Q300 554 528 445Z',glass)+p('M300 274L180 483M300 274L420 483M300 274V503','none',brass,10)
    case 18: return e(300,300,150,222,iron)+e(300,300,125,194,glass)+rail('M185 223H415M177 301H423M185 379H415M258 119V481M342 119V481',iron,13)+[[177,156],[423,156],[177,444],[423,444]].map(([x,y])=>r(x-17,y-23,34,46,iron,6)+bolt(x,y,7)).join('')
    case 19: return e(286,102,79,49,brass)+rail('M286 116L179 247 369 336 439 431',brass,18)+[[179,247],[369,336]].map(([x,y])=>e(x,y,23,23,brass)+bolt(x,y,7)).join('')+shade(439,431,88,'#5C7B67')
    case 20: return r(264,72,72,441,brass,13)+[169,431].map(x=>r(x-48,177,96,287,glass,32)+r(x-55,171,110,26,brass,7)+r(x-55,443,110,26,brass,7)+rail(`M300 306H${x}`,brass,14)).join('')+bolt(300,100,8)
    case 21: return leaf(300,117,1.65)+rail('M300 135Q167 235 300 377',brass,17)+times(5,n=>move(300,403,p('M0 13Q-95-22-64-88Q-26-135 0-99Q26-135 64-88Q95-22 0 13Z',glass),1,n*72))+e(300,403,24,24,brass)
    case 22: return back(iron,true)+rail('M209 127L357 323M391 127L357 323M300 149L357 323',iron,18)+rail('M357 323L420 417',iron,20)+shade(420,417,103,'#627568')+bolt(357,323,10)
    case 23: return e(300,131,97,65,ceramic)+e(300,131,73,47,'#BDBFA7')+rail('M300 169v146',ceramic,29)+e(300,317,34,37,brass)+globe(300,404,82)+bolt(247,121,6)+bolt(353,121,6)
    default: throw new Error('未知壁灯构造。')
  }
}

function tableLamp(i: number): string {
  switch (i) {
    case 0: return oil(300,300,4,0)+p('M198 250Q72 234 119 355L204 345','none',ceramic,20)
    case 1: return p('M118 186Q300 82 482 186L536 302 474 420Q300 505 126 420L64 302Z',ceramic)+e(300,300,161,126,'#625E46','#B5AC88',8)+p('M84 291l59 6M455 298l61 3','none','#CABA91',24)+rail('M225 244Q300 177 375 244',ceramic,25)+p('M91 301h41M466 301h39','none','#5E5541',6)
    case 2: return base('square')+r(142,142,54,54,iron,6)+r(404,142,54,54,iron,6)+r(142,404,54,54,iron,6)+r(404,404,54,54,iron,6)+wax(300,300,3.5)
    case 3: return p('M87 153L249 105 471 142 526 331 457 465 207 492 65 354Z',stone)+oil(210,280,1.65,180)+oil(394,330,1.65,0)+p('M260 282L344 323','none','#605C43',11)+p('M136 187l37 61M463 410l-54-34M278 448l37-21','none','#BBC0A8',4)
    case 4: return lanternHead(300,300,3.47,'square',wood)+[[114,114],[486,114],[114,486],[486,486]].map(([x,y])=>r(x-17,y-17,34,34,wood,4)+bolt(x,y,5)).join('')
    case 5: return e(287,300,173,177,brass)+e(287,300,151,155,'#918462','#D1C49C',6)+p('M430 227Q566 204 549 335Q535 400 433 363','none',edge,24)+p('M430 227Q566 204 549 335Q535 400 433 363','none',brass,18)+wax(271,300,2.2)
    case 6: return feet(3,214,brass)+e(300,300,165,165,brass)+e(300,300,138,138,'#635C42','#D7C69D',6)+around(3,155,(x,y,n)=>oil(x,y,1.14,n*120))+e(300,300,78,78,'#7B7050','#A79A73',2)
    case 7: return r(70,170,460,260,iron,20)+rail('M66 240H39V360H66M534 240H561V360H534',iron,15)+[153,300,447].map(x=>oil(x,300,1.43,90)).join('')+bolt(91,191,7)+bolt(509,409,7)
    case 8: return p('M77 334Q96 140 263 95Q463 36 526 260Q542 456 305 499Q151 507 77 334Z',wood)+leaf(299,288,3.7,35)+oil(288,302,1.69,45)+rail('M281 481Q401 437 469 356',wood,21)
    case 9: return polygon(300,300,229,6,iron)+polygon(300,300,193,6,'#747D68')+globe(300,300,120)+rail('M300 82V518M111 191L489 409M111 409L489 191',iron,24)+polygon(300,300,40,6,brass)+around(6,205,(x,y)=>bolt(x,y,9))
    case 10: return rail('M88 434L331 91M512 434L269 91M88 434H512','#BBB69E',27)+r(279,172,42,53,'#877152',6)+r(160,408,47,44,'#877152',6)+r(394,408,47,44,'#877152',6)+oil(300,321,3.01,90)
    case 11: return feet(3,219,brass)+e(300,300,199,156,'none',brass,17)+e(300,300,133,216,'none',iron,12)+crystal(300,300,2.6)+[[104,300],[496,300],[300,106]].map(([x,y])=>bolt(x,y,10)).join('')+p('M134 211l24 17m-10-44 20 20m257 186 25 13m-9-40 26 10','none',light,3)
    case 12: return polygon(300,300,229,6,iron)+polygon(300,300,178,6,glass)+wax(300,300,2.56)+times(6,n=>move(300,300,p('M-20-186L0-226 20-186 0-91Z',brass)+bolt(0,-191,7),1,n*60))+e(300,300,35,35,brass)
    case 13: return e(300,300,162,226,glass)+e(300,300,142,204,'none','#D6D8C0',3)+rail('M300 73Q199 299 300 527M300 73Q401 299 300 527',brass,16)+times(8,n=>p(`M${235+n%2*50} ${137+n*41}q40 33 78 0`,'none','#939B7D',3))+p('M194 435L109 476 141 520 224 485M406 435L491 476 459 520 376 485Z',iron)
    case 14: return feet(3,196,wood)+p('M76 342Q49 150 222 112Q307 64 457 143Q566 227 510 366Q443 499 300 467Q163 503 76 342Z','#8E9572','#60735D',4)+p('M110 335Q158 182 298 158Q428 151 480 311','none','#CBD0AB',5)+times(17,n=>e(130+(n*79)%346,218+(n*37)%142,5+n%4,3+n%2,'#BDC19B','#7A8E6E',1))+e(300,300,35,35,wood)
    case 15: return e(300,300,219,187,wood)+e(300,300,188,158,'none','#66533C',3)+p('M144 235q126-43 303 3M129 340q177 43 324-7','none','#C7AF7E',3)+oil(300,300,2.94,0)+rail('M141 170Q300 51 459 170','#B5A174',21)+p('M179 142l8 21m23-35 8 21m24-33 7 22m24-30 5 23m26-24 2 23m27-21-1 23m26-17-2 21m25-14-4 19','none','#756B4F',3)
    case 16: return e(300,360,177,113,brass)+e(300,360,147,86,iron)+rail('M213 370V264M387 370V264',brass,18)+r(78,119,444,204,'#4F6F5F',66,'#3C5147',4)+r(95,135,410,170,'none',65,'#97AA8A',3)+p('M118 164q157-20 360 0','none','#A5B394',5)+e(300,359,21,21,brass)
    case 17: return base()+shade(300,300,217,'#C7B994',true)+e(300,300,27,27,wood)+p('M467 379l41 82','none',brass,3)+e(508,463,8,8,wood)
    case 18: return e(174,399,104,90,iron)+rail('M174 399L329 367 269 191 417 170',iron,18)+[[174,399],[329,367],[269,191]].map(([x,y])=>e(x,y,23,23,brass)+bolt(x,y,7)).join('')+shade(429,167,95,'#617765')
    case 19: return times(6,n=>move(300,300,p('M0 0L-101-149Q0-247 101-149Z',n%2?'#8FA58D':'#B6B68F','#655C45',3)+p('M0 0L-44-177M0 0L44-177','none',brass,3),1,n*60))+e(300,300,35,35,brass)+bolt(300,300,8)
    case 20: return r(94,94,412,412,brass,8)+r(118,118,364,364,glass,6)+r(163,163,274,274,brass,5)+r(183,183,234,234,glass,4)+rail('M118 118L482 482M482 118L118 482',brass,9)+r(267,267,66,66,brass,3)
    case 21: return e(300,300,207,207,ceramic)+e(300,300,178,178,ceramic)+globe(300,300,146)+e(460,403,20,20,brass)+p('M453 402h13','none','#66684E',3)
    case 22: return e(300,300,203,169,brass)+e(300,300,175,143,'#8D926F')+e(300,300,113,113,glass)+e(300,300,75,75,'#6A6550','#C2BE9A',4)+rail('M148 207L300 300L452 207M300 300v164',brass,13)+e(300,300,32,32,'#8E8A6C')+e(500,337,22,22,iron)+p('M479 336h-36','none',brass,13)
    case 23: return e(183,403,112,90,ceramic)+rail('M183 403Q120 260 302 271Q444 263 431 162',iron,20)+stitches(183,403,120,260,302,271,9)+shade(431,162,102,ceramic)
    default: throw new Error('未知台灯构造。')
  }
}

function floorLamp(i: number): string {
  switch (i) {
    case 0: return feet(3,221,wood)+e(300,300,98,101,wood)+ring(300,300,79,iron,13)+p('M266 233L315 224 365 268 349 337 294 374 242 324Z','#8F7851')+p('M265 260l62 67m-74-27 58 47m-34-101 62 57','none','#C0AA78',7)+r(270,294,61,27,'#776548',8)
    case 1: return feet(3,216)+rail('M300 300L300 150M300 300L158 384M300 300L442 384',iron,17)+[[300,143],[151,387],[449,387]].map(([x,y])=>wax(x,y,1.77)).join('')+e(300,300,36,36,iron)
    case 2: return r(140,140,320,320,stone,21)+r(161,161,278,278,'none',18,'#C0C2AB',3)+oil(300,300,3.2,90)+bolt(170,170,8)+bolt(430,430,8)
    case 3: return rail('M300 286L118 472M300 286L482 472M300 286V128',wood,34)+rail('M117 149H483',wood,29)+oil(137,209,1.6,180)+oil(463,209,1.6,0)+r(271,251,58,59,'#907951',9)
    case 4: return rail('M110 403H360M235 278V528',iron,25)+rail('M235 403Q112 189 393 146L455 233',iron,20)+lanternHead(451,264,1.53,'square',brass)+e(235,403,35,35,iron)
    case 5: return feet(4,211)+ring(300,300,147,iron,25)+p('M205 196l191 209M173 252l174 185M252 171l179 181M200 406L406 200M173 347l174-175M252 429l179-177','none','#959C87',9)+p('M244 237l55-42 59 33 21 90-58 71-78-39Z','#8D7750')+p('M251 261l84 73m-82-27 49-62m-28 104 54-68','none','#C3AA76',8)
    case 6: return feet(3,207,wood)+rail('M300 300L369 171',wood,25)+lanternHead(383,151,1.44,'hex',iron)+r(279,262,42,67,'#867151',7)+bolt(300,287,8)
    case 7: return r(98,261,404,131,stone,23)+rail('M300 320Q168 243 140 181M300 320Q432 243 460 181',iron,23)+oil(140,174,1.58,180)+oil(460,174,1.58,0)+r(279,279,42,42,brass,4)
    case 8: return rail('M300 300Q149 383 100 469M300 300Q424 389 517 401M300 300Q345 188 307 79M300 300Q194 224 93 198',wood,26)+rail('M300 300Q177 298 155 138M300 300Q425 272 467 140M300 300Q277 421 305 470',wood,17)+[[155,138,-35],[467,140,35],[305,470,175]].map(([x,y,a])=>leaf(x,y,1.42,a)+oil(x,y,.96,a)).join('')+e(300,300,29,29,wood)
    case 9: return feet(6,219,iron)+polygon(300,300,180,6,iron)+spokes(3,163,brass,19)+lanternHead(300,300,2.24,'hex',iron)+around(6,190,(x,y)=>bolt(x,y,10))
    case 10: return feet(3,216,'#B4B097')+rail('M300 329Q215 293 129 117M300 329Q385 293 471 117M169 206L84 256M431 206L516 256','#BDB79F',26)+[[129,117],[471,117],[84,256],[516,256]].map(([x,y])=>wax(x,y,1.27)).join('')+r(275,297,50,63,'#8B7351',7)
    case 11: return feet(3,219,brass)+e(300,300,196,133,'none',iron,16)+e(300,300,138,220,'none',brass,11)+globe(327,279,96)+crystal(327,279,1.45,40)+polygon(300,300,29,3,brass)
    case 12: return p('M237 80H363V237H520V363H363V520H237V363H80V237H237Z',stone)+p('M255 254L145 145M345 254L455 145M345 346L455 455M255 346L145 455','none',iron,36)+lanternHead(300,300,2.05,'hex',brass)+bolt(300,112,9)+bolt(488,300,9)
    case 13: return p('M91 424L173 352 255 372 273 454 221 510 185 451 131 481Z',iron)+p('M509 424L427 352 345 372 327 454 379 510 415 451 469 481Z',iron)+rail('M184 406L300 249L416 406',brass,25)+p('M300 244L79 125 108 290 221 317M300 244L521 125 492 290 379 317Z',iron)+[[128,199],[300,224],[472,199]].map(([x,y],n)=>lanternHead(x,y,1,'hex',n===1?brass:iron)).join('')
    case 14: return feet(5,195,wood)+rail('M300 300Q125 264 126 141M300 300Q449 269 475 185M300 300Q318 391 249 475',wood,18)+[[126,141],[475,185],[249,475]].map(([x,y],n)=>times(5,k=>move(x,y,p('M0 10Q-68-21-40-81Q0-125 40-81Q68-21 0 10Z',glass),.71,n*15+k*72))+e(x,y,17,17,brass)).join('')
    case 15: return feet(3,222,wood)+rail('M300 300Q198 145 109 196M300 300Q410 133 489 181',wood,27)+oil(113,208,1.42,190)+oil(484,196,1.42,-10)+r(274,273,52,54,'#9A8359',8)
    case 16: return e(177,420,119,103,iron)+e(177,420,101,86,brass)+rail('M177 420L421 159',brass,20)+shade(430,149,101,'#597964')+e(177,420,25,25,brass)
    case 17: return e(300,300,223,223,brass)+e(300,300,203,203,iron)+e(300,300,183,183,ceramic)+e(300,300,147,147,glass)+e(300,300,38,38,brass)+e(461,401,17,17,brass)
    case 18: return feet(3,221,wood)+shade(300,300,210,'#C7BA96',true)+e(300,300,31,31,wood)+rail('M468 372l42 109',brass,3)+e(510,481,9,9,wood)
    case 19: return r(91,91,418,418,iron,4)+r(120,120,360,360,brass,4)+r(157,157,286,286,glass,3)+rail('M120 120L480 480M480 120L120 480',brass,12)+r(268,268,64,64,brass,2)
    case 20: return e(151,420,88,103,iron)+e(151,420,70,84,brass)+rail('M151 420Q83 123 331 124Q405 121 445 207',brass,23)+shade(447,232,99,glass)+e(151,420,21,21,brass)
    case 21: return feet(3,218,iron)+around(3,219,(x,y,n)=>move(x,y,r(-14,-24,28,48,'#4A5048',10)+r(-8,-19,16,38,iron,6),1,n*120))+rail('M300 300L390 284 322 133 434 132',iron,20)+e(390,284,24,24,brass)+e(322,133,23,23,brass)+shade(439,130,92,ceramic)
    case 22: return feet(3,219,wood)+rail('M300 300L399 203',iron,18)+shade(409,193,124,iron)+e(409,193,91,91,'#C5C5A9')+e(409,193,32,32,glass)+bolt(300,300,13)
    case 23: return e(300,347,213,119,iron)+e(300,347,188,95,brass)+rail('M300 347V270M300 270L157 192M300 270L443 192',brass,21)+globe(157,192,84)+globe(443,192,84)+e(300,347,29,29,brass)
    default: throw new Error('未知落地灯构造。')
  }
}

function lantern(i: number): string {
  const handle = (fill = iron, wide = false) => rail(wide?'M133 280Q87 49 300 53Q513 49 467 280':'M211 205Q164 49 300 50Q436 49 389 205',fill,18)+bolt(wide?133:211,wide?280:195,8)+bolt(wide?467:389,wide?280:195,8)
  switch (i) {
    case 0: return handle()+lanternHead(300,337,3.04,'square',wood)+[[139,176],[461,176],[139,498],[461,498]].map(([x,y])=>bolt(x,y,8)).join('')
    case 1: return handle(brass,true)+lanternHead(300,338,3.03,'hex',iron)+polygon(300,338,38,6,brass)
    case 2: return handle(wood)+r(118,160,364,359,wood,83)+r(140,181,320,315,'#BFB28C',64)+wax(300,338,1.85)+rail('M151 194L449 481M449 194L151 481',wood,19)+e(300,338,24,24,wood)
    case 3: return handle(brass,true)+lanternHead(300,339,3,'round',brass)+ring(300,339,141,brass,10)+times(7,n=>{const y=226+n*36,dx=Math.sqrt(151**2-(y-339)**2);return rail(`M${300-dx} ${y}H${300+dx}`,brass,6)})
    case 4: return handle()+p('M141 174H330Q505 172 505 339Q505 505 330 505H141Z',iron)+p('M161 194H321Q480 190 480 339Q480 485 321 485H161Z',glass)+wax(338,339,1.75)+r(139,174,126,331,iron,11)+r(153,191,98,297,'#7A8170',7)+bolt(202,216,7)+bolt(202,460,7)
    case 5: return rail('M162 169Q140 52 300 53Q460 52 438 169','#B5A47B',23)+stitches(162,169,140,52,300,53)+stitches(300,53,460,52,438,169)+lanternHead(300,343,2.96,'square',wood)+rail('M162 169L438 517M438 169L162 517','#B7A379',12)+r(284,298,32,83,'#927C54',4)
    case 6: return e(300,330,198,198,ceramic)+e(300,330,166,166,'#837A58','#CCB88B',5)+around(8,132,(x,y)=>e(x,y,19,19,'#4E5140','#BDAA81',4))+oil(300,330,1.45,90)+rail('M234 135Q149 46 300 51Q451 46 366 135',ceramic,25)
    case 7: return handle()+r(107,167,386,349,iron,21)+r(133,191,334,297,glass,8)+wax(300,336,1.8)+r(117,185,121,309,'#747B69',8)+rail('M139 174V508M250 174V508',brass,10)+r(151,210,56,36,iron,7)+bolt(178,228,5)
    case 8: return rail('M300 175Q182 111 258 57Q337 16 365 89Q380 137 320 174',wood,19)+p('M300 143Q101 185 96 344Q118 505 300 538Q491 499 504 344Q496 182 300 143Z',wood)+p('M300 172Q138 205 126 344Q145 474 300 509Q455 474 474 344Q461 205 300 172Z',glass)+rail('M300 174Q219 333 300 509M300 174Q381 333 300 509',wood,15)+leaf(300,341,1.35)+wax(300,342,.9)
    case 9: return rail('M184 189V76H416V189',iron,25)+polygon(300,343,206,8,iron)+polygon(300,343,172,8,glass)+rail('M154 197L446 489M446 197L154 489M94 343H506M300 137V549',iron,15)+polygon(300,343,34,8,brass)+around(8,188,(x,y)=>bolt(x,y+43,9))
    case 10: return rail('M193 167Q129 49 300 51Q471 49 407 167','#947E58',23)+p('M136 170L263 141 421 169 481 299 461 468 320 532 161 490 104 342Z','#958564')+p('M159 198L272 174 403 196 447 311 431 444 317 499 184 463 139 343Z',glass)+rail('M141 181L459 481M423 181L161 485','#BBB59B',20)+r(277,308,46,52,'#826B4D',8)+wax(300,333,.86)
    case 11: return handle(brass)+ring(300,336,195,brass,13)+e(300,336,129,195,'none',brass,15)+rail('M300 143V529M105 336H495',brass,8)+globe(300,336,111)+crystal(300,336,1.67,30)+around(3,191,(x,y)=>bolt(x,y+36,8))
    case 12: return rail('M250 154Q167 50 300 49Q433 50 350 154',brass,19)+polygon(300,339,211,6,iron)+polygon(300,339,176,6,glass)+times(6,n=>move(300,339,p('M0-202L-23-141 0-76 23-141Z',brass),1,n*60))+wax(300,339,1.25)+e(300,339,25,25,brass)
    case 13: return rail('M244 143L221 89 267 51 300 78 333 51 379 89 356 143',iron,22)+e(300,336,167,216,glass)+rail('M300 123Q171 337 300 549M300 123Q429 337 300 549',brass,18)+times(9,n=>p(`M${237+n%2*56} ${170+n*37}q35 29 70 0`,'none','#919E7F',4))+p('M157 462l-34 47 51 21 35-38M443 462l34 47-51 21-35-38Z',iron)
    case 14: return rail('M301 173Q222 95 298 50Q396 15 380 99Q366 137 318 175',wood,21)+p('M301 141Q109 139 103 326Q95 497 295 542Q355 477 334 341Q376 212 301 141Z','#A6AC83','#62755A',4)+p('M320 157Q486 171 488 334Q489 471 326 529Q375 436 354 336Q395 237 320 157Z',glass)+p('M277 181Q180 312 279 490','none','#D2D3A9',5)+leaf(299,336,1.43,15)
    case 15: return e(300,337,204,188,ceramic)+e(300,337,172,157,'#8C8865')+around(6,133,(x,y)=>e(x,y,26,22,'#515540','#B3A97F',4))+rail('M130 235Q69 59 300 58Q531 59 470 235','#B6A377',25)+stitches(130,235,69,59,300,58)+stitches(300,58,531,59,470,235)+oil(300,337,1.67,0)
    case 16: return e(300,391,180,149,iron)+e(300,391,158,127,brass)+rail('M155 391Q105 221 170 170M445 391Q495 221 430 170',iron,26)+lanternHead(300,283,1.9,'round',iron)+rail('M176 177Q120 58 300 53Q480 58 424 177',iron,15)+e(300,283,43,43,glass)+bolt(300,283,8)
    case 17: return rail('M173 167V64H427V167',iron,24)+r(121,163,358,356,iron,20)+r(144,185,312,313,'#747E68',11)+globe(300,338,123)+r(245,169,110,31,brass,4)+bolt(150,490,8)+bolt(449,490,8)
    case 18: return rail('M201 169Q123 50 300 48Q477 50 399 169',brass,20)+lanternHead(300,342,3.08,'round',brass)+rail('M168 210L432 474M432 210L168 474',brass,16)+ring(300,342,129,brass,7)
    case 19: return rail('M155 170Q110 52 300 53Q490 52 445 170','#796B4C',29)+stitches(155,170,110,52,300,53)+stitches(300,53,490,52,445,170)+r(117,163,366,355,iron,19)+r(139,187,322,306,'#737E6B',8)+globe(300,342,126)+r(214,174,172,26,brass,5)+bolt(147,486,8)+bolt(453,486,8)
    case 20: return polygon(300,335,214,8,brass)+polygon(300,335,183,8,glass)+rail('M170 203L430 467M430 203L170 467',iron,12)+e(300,335,35,35,brass)+rail('M177 173Q132 52 300 52Q468 52 423 173',brass,17)+p('M493 312q64-38 49 33l-24 20','none',iron,17)
    case 21: return e(300,409,188,134,brass)+e(300,409,163,111,iron)+lanternHead(300,308,2.17,'round',iron)+times(9,n=>{const y=211+n*24,dx=Math.sqrt(116**2-(y-308)**2);return rail(`M${300-dx} ${y}H${300+dx}`,iron,5)})+rail('M154 371V150Q300 36 446 150V371',iron,18)+e(300,409,37,37,brass)
    case 22: return rail('M300 155V84q-55-50-67 0',iron,13)+r(210,136,180,298,iron,71)+r(226,152,148,265,glass,58)+rail('M245 153V416M300 141V427M355 153V416M228 220H372M226 293H374M235 366H365',iron,8)+r(250,425,100,128,wood,26)+p('M267 447v82m20-85v88m26-88v88m20-85v82','none','#6A5940',3)
    case 23: return e(300,321,206,206,iron)+e(300,321,177,177,'#697565')+globe(300,321,125)+ring(300,321,133,brass,9)+rail('M190 153Q126 59 300 55Q474 59 410 153',iron,18)+r(224,482,152,55,'#796B50',19)+r(251,494,98,30,'#4A5145',11)
    default: throw new Error('未知提灯构造。')
  }
}

function candelabrum(i: number): string {
  switch (i) {
    case 0: return r(131,131,338,338,iron,10)+r(111,111,64,64,iron,7)+r(425,111,64,64,iron,7)+r(111,425,64,64,iron,7)+r(425,425,64,64,iron,7)+wax(300,300,3.39)
    case 1: return feet(3,171)+rail('M120 300H480M300 300V132',iron,22)+[[120,300],[300,132],[480,300]].map(([x,y])=>wax(x,y,1.65)).join('')
    case 2: return e(300,365,146,99,brass)+rail('M300 362V131M300 272Q186 139 99 181M300 272Q414 139 501 181M300 307Q179 355 101 423M300 307Q421 355 499 423',brass,19)+[[99,181],[300,131],[501,181],[101,423],[499,423]].map(([x,y])=>wax(x,y,1.45)).join('')
    case 3: return feet(3,147)+rail('M91 300H509M300 91V509',iron,27)+[[91,300],[509,300],[300,91],[300,509]].map(([x,y])=>wax(x,y,1.71)).join('')+e(300,300,41,41,iron)
    case 4: return feet(3,150)+ring(300,300,193,brass,18)+around(8,206,(x,y)=>wax(x,y,1.03))+e(300,300,36,36,brass)
    case 5: return p('M77 199L215 163 371 185 505 161 540 355 410 423 265 393 109 436 58 313Z',wood)+grain(108,230,378,105)+rail('M127 192L153 416M458 177L486 380',iron,16)+[[167,301],[303,270],[437,314]].map(([x,y])=>wax(x,y,1.27)).join('')
    case 6: return p('M67 180L211 136 432 157 522 247 499 411 327 458 133 420 75 336Z',stone)+wax(211,297,2.06)+wax(397,297,1.64)+p('M111 214l41 33m294 149-55-22M204 399l27-22','none','#C4C4A8',4)
    case 7: return feet(3,194)+rail('M300 300Q370 228 432 295Q490 363 385 431Q244 511 145 360Q67 202 226 138Q359 90 454 158',iron,21)+[[454,158],[145,360],[385,431],[300,300]].map(([x,y])=>wax(x,y,1.34)).join('')
    case 8: return rail('M132 477Q194 363 300 300Q434 294 503 169M300 300Q281 170 188 106M300 300Q376 421 431 468M217 348Q110 288 95 215',wood,20)+[[188,106],[503,169],[431,468],[95,215],[276,344]].map(([x,y],n)=>leaf(x,y,1.03,n*72)+wax(x,y,.91)).join('')
    case 9: return polygon(300,300,213,6,stone)+spokes(6,185,iron,26)+around(6,203,(x,y)=>wax(x,y,1.05))+polygon(300,300,43,6,brass)
    case 10: return rail('M300 347Q190 289 99 151M300 347Q410 289 501 151M177 249L113 393M423 249L487 393','#BAB49B',30)+[[99,151],[501,151],[113,393],[487,393]].map(([x,y])=>wax(x,y,1.45)).join('')+r(271,307,58,69,'#8E7653',7)
    case 11: return star(300,300,231,6,brass)+polygon(300,300,166,6,'#626C5B')+around(6,206,(x,y)=>wax(x,y,1.06))+wax(300,300,1.78)
    case 12: return p('M75 453V255L150 111 225 255V453M225 453V255L300 111 375 255V453M375 453V255L450 111 525 255V453','none',iron,24)+rail('M78 447H522M75 260H525',iron,23)+[[150,260],[300,260],[450,260]].map(([x,y])=>wax(x,y,1.4)).join('')+r(67,430,57,59,stone,4)+r(476,430,57,59,stone,4)
    case 13: return p('M300 391L93 435 65 262 141 120 241 231 300 142 359 231 459 120 535 262 507 435Z',iron)+rail('M300 390L141 140M300 390L459 140M300 390L82 281M300 390L518 281',brass,12)+[[93,435],[65,262],[141,120],[459,120],[535,262],[507,435]].map(([x,y])=>wax(x,y,1.1)).join('')+polygon(300,355,59,5,brass)
    case 14: return times(5,n=>move(300,300,p('M0 16Q-131-51-74-153Q0-241 74-153Q131-51 0 16Z','#A3A77E','#6B795D',3)+wax(0,-142,1.29),1,n*72))+e(300,300,29,29,brass)
    case 15: return rail('M84 376Q170 303 300 328Q440 285 516 376M300 328Q223 241 216 151M300 328Q389 231 415 146',wood,39)+[[119,366],[216,151],[415,146],[485,365]].map(([x,y])=>e(x,y,54,51,wood)+e(x,y,40,38,'none','#D0BC8D',3)+wax(x,y,1.01)).join('')+r(273,292,55,54,'#B8A074',7)
    case 16: return e(300,363,132,91,'#A1ADA6')+rail('M300 363V128M300 213Q151 114 105 243M300 213Q449 114 495 243','#BAC2B6',20)+[[105,243],[300,128],[495,243]].map(([x,y])=>wax(x,y,1.58)).join('')
    case 17: return r(103,355,394,97,iron,8)+r(127,372,346,63,brass,4)+rail('M100 316H191V260H262V201H338V260H409V316H500',brass,23)+[[100,316],[191,260],[300,201],[409,260],[500,316]].map(([x,y])=>wax(x,y,1.17)).join('')
    case 18: return around(3,156,(x,y)=>globe(x,y,43))+e(300,300,217,217,glass)+ring(300,300,191,'#B9C3AF',9)+wax(300,300,2.61)
    case 19: return p('M79 399Q225 305 300 171Q374 308 521 399Q332 462 300 421Q265 464 79 399Z',iron)+rail('M300 365Q104 358 129 182M300 365Q496 358 471 182',iron,25)+wax(129,182,1.66)+wax(471,182,1.66)
    case 20: return times(3,n=>move(300,300,p('M0 24Q-149-18-114-133Q-23-217 74-119Q151 1 0 24Z',ceramic,'#82978A',3)+e(0,-126,69,69,ceramic,'#779391',5)+wax(0,-126,1.42),1,n*120))+e(300,300,24,24,ceramic)
    case 21: return r(48,238,504,125,brass,17)+r(78,259,444,81,iron,10)+[99,180,261,342,423,504].map(x=>wax(x,300,1.01)).join('')+rail('M72 244V208M528 356v38',iron,24)
    case 22: return rail('M299 322Q128 296 120 138M299 322Q396 258 439 105M299 322Q464 359 486 470M299 322Q227 397 112 452',brass,20)+[[120,138,-25],[439,105,35],[486,470,150],[112,452,210]].map(([x,y,a])=>leaf(x,y,1.03,a)+wax(x,y,.96)).join('')+leaf(299,322,1.2,15)
    case 23: return r(72,152,456,297,iron,14)+r(91,170,206,260,'#6A725E',8)+r(303,170,206,260,'#6A725E',8)+rail('M300 159V442',brass,13)+wax(191,300,1.86)+wax(409,300,1.86)+r(279,127,42,33,brass,5)+r(279,440,42,33,brass,5)
    default: throw new Error('未知烛台构造。')
  }
}

// Discrete charcoal chunks are bounded by the actual bowl; no texture is clipped outside its support.
const coals = (cx: number, cy: number, rx: number, ry: number, n = 34) => e(cx,cy,rx,ry,'#4D4E40','#72705A',3)+times(n,i=>{
  const a=i*2.399963,rad=Math.sqrt((i+.5)/n)*.82,x=cx+Math.cos(a)*rx*rad,y=cy+Math.sin(a)*ry*rad,s=9+i%5*2
  return p(`M${x-s} ${y-s*.4}l${s*.4} ${-s*.7} ${s*1.2} ${s*.1} ${s*.4} ${s*.9} ${-s*.8} ${s*.8} ${-s} ${-s*.3}Z`,i%6===0?'#7D6B4A':'#3F443B','#626757',1.3)+p(`M${x-s*.45} ${y-s*.2}l${s*.7} ${s*.25}`,'none',i%6===0?'#B08C5D':'#8B8A70',1.5)
})
const coalBox = (x:number,y:number,w:number,h:number) => r(x,y,w,h,'#4D4F40',11)+times(35,i=>{const px=x+18+(i*59)%(w-36),py=y+16+(i*37)%(h-32);return polygon(px,py,9+i%5,5,i%7===0?'#7C6C4A':'#3F453B',i*37,'#6A6F5A',1.3)})
const log = (x:number,y:number,w:number,h:number,angle=0) => move(x,y,r(-w/2,-h/2,w,h,wood,10)+e(-w/2+8,0,10,h/2,'#B9A078','#77684B',2)+e(w/2-8,0,10,h/2,'#B9A078','#77684B',2)+grain(-w/2+21,-h/2+4,w-42,h-8)+p(`M${-w/2+31} ${h*.1}q${w*.21} -6 ${w*.41} 0`,'none','#65533C',2),1,angle)
const hearthCoals = (x=300,y=320,rx=157,ry=126) => coals(x,y,rx,ry)+log(x-16,y-12,rx*1.55,31,-20)+log(x+10,y+19,rx*1.6,34,23)
const stoneBits = (cx:number,cy:number,rx:number,ry:number,n=10) => times(n,i=>{const a=i*2*Math.PI/n,x=cx+rx*Math.cos(a),y=cy+ry*Math.sin(a);return move(x,y,p('M-43-25L-13-36 27-28 43 1 25 30-17 34-42 13Z',stone)+p('M-29-17L-9-23 23-18M-25 21l30 6','none','#C2C5AB',2),1,i*360/n+10)})

function brazier(i:number):string {
  switch(i){
    case 0:return feet(3,222)+e(300,300,185,185,iron)+e(300,300,160,160,'#767B65')+hearthCoals()+ring(300,300,171,iron,11)
    case 1:return feet(4,218)+r(117,117,366,366,iron,23)+coalBox(140,140,320,320)+rail('M118 229H68V371H118M482 229H532V371H482',iron,18)+bolt(137,137,9)+bolt(463,463,9)
    case 2:return coals(300,300,160,140)+stoneBits(300,300,199,178,17)+log(284,283,246,43,-24)+log(321,325,240,45,29)
    case 3:return feet(3,221)+e(300,300,179,179,iron)+hearthCoals(300,300,148,148)+ring(300,300,177,iron,16)+ring(300,300,151,iron,8)+around(16,168,(x,y,n)=>rail(`M${x} ${y}L${300+(x-300)*.81} ${300+(y-300)*.81}`,iron,n%2?10:15))
    case 4:return r(77,163,446,274,iron,27)+coalBox(98,184,404,232)+rail('M75 242H36V359H75M525 242H564V359H525',iron,19)+rail('M126 174V426M474 174V426',iron,12)+log(300,307,323,44,8)
    case 5:return around(3,214,(x,y)=>e(x,y,37,35,ceramic)+e(x,y,17,15,'#685F45'))+e(300,300,184,184,ceramic)+hearthCoals(300,300,145,145)+ring(300,300,164,'#B5AB85',8)
    case 6:return e(300,300,183,185,iron)+rail('M139 212Q39 211 59 300Q55 390 139 388M461 212Q561 211 541 300Q545 390 461 388',iron,21)+hearthCoals(300,300,158,158)+ring(300,300,171,iron,12)
    case 7:return r(65,79,470,442,stone,12)+r(91,104,418,390,'#6D6954',6)+coalBox(137,164,326,284)+times(6,n=>r(78+n*76,78,69,61,'#9B8667',4))+times(5,n=>r(78,151+n*71,59,65,'#A08A69',4)+r(464,151+n*71,59,65,'#9A8263',4))+times(4,n=>r(143+n*79,453,72,56,'#AC9674',4))+log(300,297,255,42,-20)
    case 8:return feet(3,217,wood)+times(3,n=>move(300,300,p('M0 17Q-161-30-138-142Q-51-235 50-186Q151-113 0 17Z','#8C9872','#5B7157',4),1,n*120))+hearthCoals(300,300,135,131)+ring(300,300,148,brass,7)
    case 9:return feet(3,230,iron)+polygon(300,300,215,6,iron)+polygon(300,300,177,6,'#858B71')+coals(300,300,144,144)+around(6,191,(x,y,n)=>move(x,y,r(-13,-22,26,44,'#4D5545',5),1,n*60))+polygon(300,300,36,6,'#867653')
    case 10:return rail('M109 113L489 483M491 115L107 485','#BAB49B',31)+p('M139 163L277 128 438 162 486 310 440 448 269 479 118 423 91 294Z',iron)+hearthCoals(300,304,147,132)+[[147,160],[453,163],[128,426],[442,446]].map(([x,y])=>r(x-22,y-22,44,44,'#8D7453',8)).join('')
    case 11:return polygon(300,300,224,8,stone)+polygon(300,300,182,8,'#676C58')+coals(300,300,146,146)+around(8,202,(x,y,n)=>move(x,y,p('M-13-12l16 2-4 12 12 7m-16-21-4 19','none','#8B8F72',3),1,n*45))+crystal(300,300,.95,20)
    case 12:return p('M215 74H385V215H526V385H385V526H215V385H74V215H215Z',stone)+r(151,151,298,298,iron,12)+coalBox(171,171,258,258)+rail('M164 164L225 225M436 164L375 225M164 436L225 375M436 436L375 375',iron,24)+r(269,277,62,46,'#8D7B54',6)
    case 13:return p('M300 469L139 503 67 411 103 344 174 375 223 413M300 469L461 503 533 411 497 344 426 375 377 413Z',iron)+p('M300 439Q92 437 91 219L190 125 300 195 410 125 509 219Q508 437 300 439Z',brass)+hearthCoals(300,304,145,119)+rail('M141 219L185 328M459 219L415 328',iron,15)+p('M136 172l24 17m-34 33 24 17m313-67-24 17m34 33-24 17','none','#8F9B7D',4)
    case 14:return feet(5,222,wood)+times(5,n=>move(300,300,p('M0 17Q-135-32-87-151Q0-229 87-151Q135-32 0 17Z',ceramic),1,n*72))+coals(300,300,124,124,26)+e(300,300,132,132,'none','#9A9B76',6)
    case 15:return rail('M118 147L170 469M482 147L430 469M133 451H467',wood,26)+e(300,300,221,169,stone)+rail('M92 270Q36 300 92 348M508 270Q564 300 508 348',ceramic,24)+hearthCoals(300,300,177,126)+e(300,300,199,148,'none','#B8B89D',8)
    case 16:return feet(4,208)+r(118,149,364,302,'#60776C',73)+r(138,169,324,262,'none',57,'#A7B29C',3)+coals(300,300,139,110)+rail('M119 235H69V365H119M481 235H531V365H481',iron,15)
    case 17:return [45,135,225,315].map(a=>move(300,300,r(-27,-235,54,77,iron,7),1,a)).join('')+polygon(300,300,234,8,iron,-67.5)+polygon(300,300,187,8,'#74816A',-67.5)+hearthCoals(300,300,142,142)+around(8,207,(x,y,n)=>move(x,y,p('M-16-14Q0-37 16-14Q32 4 0 31Q-32 4-16-14Z','none','#A6AE94',5)+bolt(0,-27,5),.78,n*45))
    case 18:return r(69,163,462,274,iron,15)+coalBox(91,185,418,230)+rail('M126 189V410M203 189V410M280 189V410M357 189V410M434 189V410M94 246H506M94 353H506',iron,7)+r(233,440,134,32,iron,8)+r(270,448,60,14,'#494F42',4)
    case 19:return rail('M113 131L477 485M487 131L123 485',iron,15)+e(300,300,208,158,iron)+hearthCoals(300,300,178,128)+rail('M115 201Q95 48 300 53Q505 48 485 201',iron,17)+bolt(128,204,8)+bolt(472,204,8)
    case 20:return r(82,101,436,398,stone,12)+times(6,n=>r(87+n*72,106,67,57,'#6F8B7C',3)+r(87+n*72,437,67,57,'#6A8777',3))+times(4,n=>r(87,171+n*65,60,60,'#718A79',3)+r(453,171+n*65,60,60,'#728E7E',3))+hearthCoals(300,300,145,122)+r(224,477,152,27,brass,4)+p('M244 482v15m20-15v15m20-15v15m20-15v15m20-15v15m20-15v15m20-15v15','none','#60694F',5)
    case 21:return feet(6,221,iron)+e(300,300,188,188,iron)+hearthCoals(300,300,139,139)+around(18,165,(x,y,n)=>move(x,y,e(0,0,10,18,'#48503F','#8C967A',2),1,n*20))+ring(300,300,181,iron,9)
    case 22:return e(300,300,214,214,iron)+e(300,300,189,189,'#78816B')+hearthCoals(300,300,168,168)+ring(300,300,205,iron,10)+[0,1,2,3].map(n=>move(300,300,r(-39,-207,78,14,'#49513F',5),1,n*90)).join('')+p('M166 144l29 11m212 277-28-9M123 336l22-7','none','#9D9E7E',3)
    case 23:return e(300,300,217,149,iron)+coals(300,300,191,124)+p('M300 151Q520 151 520 300H300Z',iron)+p(times(9,n=>`M${311+n*22} ${182+n*4}V294 `)+times(5,n=>`M310 ${200+n*19}H${485+n*6} `),'none','#A8AE93',3)+rail('M301 154V447',brass,10)+rail('M91 258H45V344H91M509 258H555V344H509',wood,22)
    default:throw new Error('未知火盆构造。')
  }
}

const masonry = (x:number,y:number,w:number,h:number,fill=stone) => r(x,y,w,h,fill,5)+p(times(3,n=>`M${x+4} ${y+(n+1)*h/4}H${x+w-4} `)+times(4,n=>`M${x+w*(n+1)/5} ${y+3}v${h/4-5}M${x+w*(n+.5)/5} ${y+h/4+2}v${h/4-4}M${x+w*(n+1)/5} ${y+h/2+2}v${h/4-4} `),'none','#727764',2)+p(`M${x+8} ${y+8}H${x+w-8}`,'none','#C4C4A9',2)
const fireGrate = (x=300,y=341,w=260,h=158) => coalBox(x-w/2,y-h/2,w,h)+log(x-9,y-17,w*.81,25,-15)+log(x+9,y+17,w*.82,28,19)+rail(times(8,n=>`M${x-w*.43+n*w*.12} ${y+h*.43}V${y-h*.43} `),iron,6)+rail(`M${x-w*.5} ${y+h*.45}H${x+w*.5}`,iron,10)
const uHearth = (fill=stone) => r(65,61,470,478,fill,15)+r(115,165,370,329,'#8A8D75',9)+p('M65 539V61H535V539H453V176H147V539Z',fill)+p('M88 505V85H512V505','none','#B8BCA2',3)

function fireplace(i:number):string {
  switch(i){
    case 0:return r(62,103,476,429,stone,19)+fireGrate()+stoneBits(300,119,191,0,7)+masonry(65,163,86,303)+masonry(449,163,86,303)+p('M82 487L244 502 354 483 508 498','none','#666E5A',4)
    case 1:return p('M58 516V216Q75 54 300 53Q525 54 542 216V516H462V228Q300 101 138 228V516Z','#A38B6A')+r(109,219,382,318,stone,8)+p('M58 516V216Q75 54 300 53Q525 54 542 216V516H462V228Q300 101 138 228V516Z','#9B8362')+times(12,n=>{const a=Math.PI+n*Math.PI/11;return p(`M${300+205*Math.cos(a)} ${219+146*Math.sin(a)}L${300+155*Math.cos(a)} ${219+101*Math.sin(a)}`,'none','#6C6852',3)})+fireGrate(300,361,271,180)+masonry(65,239,71,256,'#A38C6B')+masonry(464,239,71,256,'#9A8363')
    case 2:return uHearth()+plank(58,61,484,109)+masonry(68,178,84,294)+masonry(448,178,84,294)+fireGrate(300,348,255,169)+r(74,486,452,49,stone,5)
    case 3:return p('M64 64H536V162H164V536H64Z',stone)+p('M164 164H535Q530 431 163 536Z',stone)+p('M178 178H483Q458 412 178 483Z','#7A806A')+p('M184 184L454 382M184 184L382 454','none','#AFB59A',3)+fireGrate(285,288,188,164)+masonry(64,64,472,98)+masonry(64,169,99,367)
    case 4:return r(50,86,500,448,stone,9)+masonry(52,64,496,108)+masonry(53,178,74,278)+masonry(473,178,74,278)+masonry(274,171,52,315)+fireGrate(194,329,139,190)+fireGrate(406,329,139,190)+r(67,484,466,48,stone,4)
    case 5:return p('M56 486V288Q70 72 300 66Q530 72 544 288V486Z',stone)+p('M131 482V291Q137 153 300 144Q463 153 469 291V482Z','#7C826C')+times(9,n=>{const a=Math.PI+n*Math.PI/8;return p(`M${300+232*Math.cos(a)} ${288+211*Math.sin(a)}L${300+165*Math.cos(a)} ${291+143*Math.sin(a)}`,'none','#727963',4)})+p('M300 281L131 482M300 281L469 482M300 281V482','none','#ABB49A',3)+fireGrate(300,347,263,160)
    case 6:return p('M62 513L74 119 217 72 392 88 537 143 523 512 444 516 448 214 354 171 231 165 148 207 152 524Z','#AA9B76')+p('M148 214L443 211 442 519H151Z','#7C7E64')+hearthCoals(300,344,128,123)+e(189,448,31,23,ceramic)+e(413,444,31,23,ceramic)+p('M94 164l32 11m-37 111 29-8m364-100 29 11m-21 140 27-4','none','#D1C3A0',4)
    case 7:return uHearth(iron)+p('M63 65H537L492 198H108Z',iron)+rail('M76 88L122 182M524 88L478 182',brass,16)+[[96,99],[504,99],[124,166],[476,166]].map(([x,y])=>bolt(x,y,9)).join('')+fireGrate(300,345,262,173)+r(84,476,432,54,stone,4)
    case 8:return p('M53 483Q100 410 102 290Q56 98 229 68Q315 114 390 68Q549 131 495 286Q528 441 549 482L453 531Q441 369 429 235Q333 155 179 235Q153 382 147 529Z',stone)+p('M179 235Q308 181 429 235L442 492 151 492Z','#7F886D')+rail('M97 456Q175 279 128 204Q133 110 220 108M503 456Q425 279 472 204Q467 110 380 108',wood,22)+hearthCoals(300,349,127,119)+leaf(124,495,.85,-40)+leaf(476,495,.85,40)
    case 9:return p('M52 155L142 69H458L548 155V529H52Z',stone)+p('M149 195H451V487H149Z','#7A8068')+p('M52 155L142 69H458L548 155V529H461V202H139V529H52Z',iron)+rail('M90 161H510',brass,24)+[112,488].map(x=>r(x-22,175,44,291,iron,7)+bolt(x,206,9)+bolt(x,438,9)).join('')+fireGrate(300,349,263,192)+r(79,487,442,47,stone,5)
    case 10:return r(66,106,468,429,stone,25)+stoneBits(300,130,177,0,6)+masonry(64,164,93,293)+masonry(443,164,93,293)+rail('M107 491Q71 312 149 166M493 491Q529 312 451 166','#BBB39A',26)+hearthCoals(300,350,131,126)+log(300,372,236,46,14)+p('M121 251l30 13m-39 83 31 5m334-97-29 13m39 79-32 6','none','#7A7860',4)
    case 11:return polygon(300,300,258,8,stone,-67.5)+polygon(300,322,184,8,'#69745F',-67.5)+r(85,73,430,89,iron,7)+r(126,162,348,32,brass,3)+coals(300,345,139,110)+[[217,332],[300,370],[383,332]].map(([x,y],n)=>e(x,y,38,32,brass)+crystal(x,y,.67,n*60)).join('')+p('M137 119l22-22 21 22m62 0 22-22 21 22m62 0 22-22 21 22m62 0 22-22 21 22','none','#A3AC8D',3)
    case 12:return uHearth(iron)+masonry(63,61,474,108)+p('M65 61H535L465 185H135Z',stone)+rail('M105 74L153 169M495 74L447 169',iron,17)+masonry(65,177,102,319)+masonry(433,177,102,319)+fireGrate(300,349,239,190)+p('M68 428L151 360 169 501H65M532 428L449 360 431 501H535Z',stone)
    case 13:return p('M300 177L122 71 54 156 88 378 151 483 213 499 215 238M300 177L478 71 546 156 512 378 449 483 387 499 385 238Z',stone)+p('M215 238Q300 192 385 238L442 481 158 481Z','#7B826A')+rail('M85 164L177 353M515 164L423 353',iron,20)+hearthCoals(300,349,137,119)+p('M91 478L154 438 216 474 206 524 164 512 142 540 101 517ZM509 478L446 438 384 474 394 524 436 512 458 540 499 517Z',iron)
    case 14:return times(5,n=>move(300,310,p('M0 37Q-161-14-118-154Q0-263 118-154Q161-14 0 37Z',stone),1,n*72))+hearthCoals(300,326,147,132)+p('M300 96Q156 104 142 221M300 96Q444 104 458 221','none','#C6C7AB',5)+rail('M183 422Q300 484 417 422',brass,10)
    case 15:return p('M62 501V232Q77 70 300 64Q523 70 538 232V501H443V242Q300 139 157 242V501Z','#A18C69')+r(145,245,310,256,stone,11)+times(9,n=>{const a=Math.PI+n*Math.PI/8;return p(`M${300+229*Math.cos(a)} ${232+158*Math.sin(a)}L${300+146*Math.cos(a)} ${242+84*Math.sin(a)}`,'none','#716950',3)})+hearthCoals(300,349,132,109)+plank(58,421,101,95)+plank(441,421,101,95)+p('M72 224h71m318 0h68','none','#CCBA90',4)
    case 16:return uHearth(ceramic)+r(66,62,468,105,ceramic,4)+r(76,81,448,64,'none',2,'#A9AE98',3)+p('M109 87l31 49m-8 47-29 110m371-188-32 31m19 93 32 89M168 513l94-17m159 18-58-12','none','#B4B8A3',2)+fireGrate(300,346,248,185)+r(72,482,456,52,ceramic,3)
    case 17:return uHearth('#6E8B79')+times(6,n=>r(66+n*78,64,74,97,'#728F7D',4))+times(4,n=>r(66,171+n*75,78,69,'#668371',4)+r(456,171+n*75,78,69,'#738E7C',4))+times(3,n=>r(151+n*100,473,95,60,'#789480',3))+fireGrate(300,349,254,183)+p('M157 217Q300 172 443 217','none',brass,9)
    case 18:return uHearth('#565F55')+r(53,60,494,85,'#5B6255',4)+r(71,145,458,45,brass,2)+[76,119,438,481].map((x,n)=>r(x,184+n%2*32,42,314-n%2*32,'#616B5B',2)).join('')+fireGrate(300,337,225,174)+rail('M173 450L225 401H375L427 450M225 401V487M300 401V487M375 401V487',brass,9)+r(68,490,464,48,'#505A51',3)
    case 19:return uHearth('#9B8661')+plank(54,60,492,115)+plank(66,180,84,309)+plank(450,180,84,309)+[[86,91],[514,91],[105,213],[495,213]].map(([x,y])=>r(x-16,y-16,32,32,brass,3)+bolt(x,y,6)).join('')+fireGrate(300,350,258,184)+masonry(70,488,460,47,'#9D8968')
    case 20:return uHearth(iron)+p('M66 165Q300 36 534 165L490 234Q300 148 110 234Z',iron)+p('M81 164Q300 67 519 164','none','#A7AE94',4)+rail('M112 212V487M488 212V487',brass,16)+fireGrate(300,353,252,176)+r(91,488,418,43,iron,7)+r(256,497,88,20,brass,5)
    case 21:return p('M68 68H532V161H161V532H68Z','#789481')+p('M161 161H531Q521 442 161 532Z','#8A9D83')+times(5,n=>r(75+n*91,75,85,76,'#6D8A78',3)+r(75,168+n*72,76,67,'#74917D',3))+p('M178 178L500 283M178 178L447 411M178 178L298 496','none','#BBC1A3',3)+fireGrate(289,289,180,171)+rail('M177 424Q330 406 423 181',brass,10)
    case 22:return uHearth(ceramic)+p('M68 98Q177 33 245 103L210 175 146 186 150 460 87 493ZM532 98Q423 33 355 103L390 175 454 186 450 460 513 493Z',stone)+rail('M105 111Q181 73 206 127M495 111Q419 73 394 127',brass,14)+fireGrate(300,347,246,179)+p('M157 453Q300 493 443 453','none',brass,12)+leaf(236,450,.55,-45)+leaf(364,450,.55,45)
    case 23:return uHearth('#9E8A68')+masonry(65,62,470,107,'#A48D6C')+masonry(65,177,81,310)+masonry(454,177,81,310)+fireGrate(300,340,251,183)+r(151,432,146,45,iron,5)+r(303,432,146,45,iron,5)+rail('M167 442H279M321 442H433',brass,7)+r(70,489,460,46,stone,4)+bolt(160,455,6)+bolt(440,455,6)
    default:throw new Error('未知壁炉构造。')
  }
}

function firewood(i:number):string {
  switch(i){
    case 0:return log(267,180,351,67,-11)+log(322,285,361,73,13)+log(269,398,369,72,-8)+log(324,427,329,62,10)+log(277,269,365,58,-20)+log(289,348,367,65,18)
    case 1:return times(10,n=>log(285+(n%2)*22,100+n*43,386+(n%4)*12,21+n%3*4,n%2*6-3))+rail('M170 90Q132 302 171 510M420 90Q458 302 419 510','#B7A278',18)+p('M146 282l51 34m-47-23 49 31m196-42 47 34m-44-24 48 31','none','#776B4D',4)
    case 2:return e(300,287,172,166,wood)+e(300,287,145,140,'#B8A07A')+e(300,287,112,106,'none','#8C7A57',3)+e(300,287,72,66,'none','#8C7A57',3)+e(300,287,32,29,'none','#8C7A57',3)+p('M305 148l-12 85 26 54-14 82','none','#6F6044',5)+log(193,425,206,43,31)+log(428,194,200,49,-63)+times(15,n=>move(87+n*31%437,95+n*41%415,p('M-12-5L6-11 17 3-4 10Z','#BDA47D','#817050',1),1,n*23))
    case 3:return e(300,300,237,183,'#AA9469','#6F6F50',5)+e(300,300,207,155,'#5F6048','#D0BC8D',7)+times(12,n=>{const y=156+n*26,dx=Math.sqrt(219**2-((y-300)/.77)**2);return Number.isFinite(dx)?p(`M${300-dx} ${y}Q300 ${y+13} ${300+dx} ${y}`,'none','#C5AF7E',3):''})+log(279,229,275,60,-13)+log(311,325,303,65,10)+log(290,384,279,57,-8)+rail('M104 198Q54 73 300 67Q546 73 496 198','#A9946A',20)
    case 4:return rail('M79 419Q253 373 352 171M236 358L152 137M337 214L479 125',wood,58)+rail('M106 453Q267 416 402 300L507 370M403 300L457 199',wood,45)+e(84,420,33,35,'#BAA27A')+e(151,137,29,31,'#BAA27A')+e(479,125,31,28,'#BAA27A')+e(507,370,27,24,'#BAA27A')+p('M142 400q71-18 114-60m23-74 49-70m87 137 54 21M183 267l19 48','none','#C9B38B',4)
    case 5:return p('M89 140L166 89 449 105 523 169 495 452 392 511 139 463 69 378Z','#8C7D5B')+p('M117 155L195 130 431 140 480 186 459 430 382 471 168 433 112 364Z','#B5A17A')+times(6,n=>polygon(191+n%3*106,229+Math.floor(n/3)*117,35+n%3*6,5,'#A58A53',n*31,'#786A46',2))+log(294,202,320,18,-16)+log(288,291,322,19,12)+log(288,386,311,20,-17)+p('M91 166l39 199m370-172-27 218','none','#5F5D45',10)
    case 6:return rail('M114 138V470H486V138M92 164H508',iron,19)+times(7,n=>log(300,139+n*50,333+(n%3)*10,38,n%2*4-2))+rail('M113 202V467M487 202V467',iron,15)+bolt(113,452,9)+bolt(487,452,9)
    case 7:return plank(69,95,462,410)+r(92,119,416,363,'#6B6148',5)+times(11,n=>log(143+n%6*60,213+Math.floor(n/6)*150,160+n%3*12,20+n%3*3,n%2?63:-67))+r(70,94,461,28,wood,3)+r(70,475,461,28,wood,3)+r(70,95,29,408,wood,3)+r(502,95,29,408,wood,3)
    default:throw new Error('未知柴薪构造。')
  }
}

function coalScuttle(i:number):string {
  switch(i){
    case 0:return rail('M137 225Q36 227 58 309Q50 383 142 378M463 225Q564 227 542 309Q550 383 458 378',ceramic,25)+e(300,300,187,197,ceramic)+coals(300,300,153,159)+e(300,300,173,180,'none','#B7AB83',8)
    case 1:return p('M119 113H481L531 479H69Z',wood)+grain(124,144,352,298)+p('M146 151H454L490 446H110Z','#6F6850')+coalBox(155,176,289,246)+rail('M120 158H68V286H104M480 158H532V286H496',iron,19)+rail('M96 429H504',iron,16)+p('M193 155l-11 270m129-270 7 270m113-270 24 270','none','#7D6B49',4)
    case 2:return e(300,326,206,182,iron)+coals(300,326,174,151)+p('M116 244Q300 142 484 244L459 149Q300 78 141 149Z',iron)+rail('M133 230Q87 54 300 55Q513 54 467 230',iron,21)+e(300,326,187,164,'none','#A4AC90',5)
    case 3:return e(300,326,224,171,'#A58F62','#6B6B4B',5)+e(300,326,196,145,'#6C6048','#CCB78A',7)+times(10,n=>{const y=181+n*31,dx=Math.sqrt(211**2-((y-326)/.76)**2);return Number.isFinite(dx)?p(`M${300-dx} ${y}Q300 ${y+12} ${300+dx} ${y}`,'none','#BAA376',3):''})+coals(300,326,168,119)+rail('M115 219Q56 58 300 55Q544 58 485 219','#B09B70',24)+stitches(115,219,56,58,300,55)+stitches(300,55,544,58,485,219)
    case 4:return polygon(300,326,232,6,iron)+polygon(300,326,192,6,'#76816A')+coals(300,326,159,138)+rail('M142 219V63H458V219',iron,25)+rail('M300 193V459',iron,18)+around(6,210,(x,y)=>bolt(x,y+26,9))
    case 5:return p('M112 163L228 117 387 133 496 203 524 367 442 497 267 525 106 447 67 303Z','#968361')+p('M139 184L239 150 374 163 466 224 490 360 421 465 273 492 134 423 104 304Z','#6C6248')+coals(300,319,159,132)+rail('M132 219Q55 52 300 53Q545 52 468 219',wood,26)+rail('M123 198L155 445M463 207L437 451','#B2A176',17)+p('M124 290l53 19m-49-7 54 20m265-26 50-17m-47 31 52-17','none','#756C50',4)
    case 6:return e(300,343,217,174,brass)+coals(300,343,181,139)+p('M125 236Q300 145 475 236L435 89H165Z',brass)+p('M154 226Q300 171 446 226L414 117H186Z','#8A7A55')+rail('M133 262Q58 54 300 52Q542 54 467 262',iron,20)+[[144,267],[456,267]].map(([x,y])=>r(x-18,y-22,36,44,brass,7)+bolt(x,y,7)).join('')+e(300,343,196,155,'none','#C3B082',4)
    case 7:return e(265,326,179,183,'#69877A')+e(265,326,158,161,'none','#ADBEA4',4)+coals(265,326,139,141)+rail('M126 208Q65 53 265 56Q465 53 404 208',iron,21)+p('M434 279L506 251 546 372 466 399Z',iron)+rail('M489 326L454 483',wood,20)+rail('M433 483H476V537H433Z',iron,11)+bolt(448,479,6)
    default:throw new Error('未知煤斗构造。')
  }
}

export const LIGHTING_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Lighting-Collection-1'
export const LIGHTING_COLLECTION_LICENSE = `Sceneweave Lighting and Heating Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG drawings of lighting fixtures, hearths and fuel accessories, authored with coding assistance. No third-party art or image pixels are included. Illustrative period and fantasy interpretations; technical validation and art review are separate. Painted fixtures do not create real light sources, wall attachment, smoke, heat or movement permissions.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const defs = `<defs>
<linearGradient id="brass" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#CFBE91"/><stop offset="32%" stop-color="#A39268"/><stop offset="61%" stop-color="#B7A47A"/><stop offset="100%" stop-color="#746A4D"/></linearGradient>
<linearGradient id="iron" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#A1A692"/><stop offset="31%" stop-color="#78816E"/><stop offset="100%" stop-color="#515D51"/></linearGradient>
<linearGradient id="wood" x1="0%" y1="0%" x2="27%" y2="100%"><stop offset="0%" stop-color="#B4A079"/><stop offset="45%" stop-color="#93805A"/><stop offset="100%" stop-color="#716248"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#B7BEA4"/><stop offset="48%" stop-color="#939E87"/><stop offset="100%" stop-color="#75816C"/></linearGradient>
<radialGradient id="glass" cx="32%" cy="25%" r="78%"><stop offset="0%" stop-color="#F0EED6"/><stop offset="44%" stop-color="#D6D8BE"/><stop offset="100%" stop-color="#A9B5A0"/></radialGradient>
<radialGradient id="ceramic" cx="30%" cy="25%" r="85%"><stop offset="0%" stop-color="#D2CBB0"/><stop offset="55%" stop-color="#BBB79A"/><stop offset="100%" stop-color="#929B80"/></radialGradient>
</defs>`
function artwork(design: LightingDesign, i:number):VisualSampleArt {
  const drawing = ({ chandelier, 'wall-lamp':wallLamp, 'table-lamp':tableLamp, 'floor-lamp':floorLamp, lantern, candelabrum, brazier, fireplace, firewood, 'coal-scuttle':coalScuttle }[design.category])(i)
  const ceiling = design.category === 'chandelier'
  const wall = design.category === 'wall-lamp' || design.category === 'fireplace'
  const blocking = ['floor-lamp','brazier','fireplace'].includes(design.category)
  return { key:design.key, name:design.name, kind:'prop', widthMm:design.widthMm, heightMm:design.heightMm,
    sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm/600} ${design.heightMm/600})">${drawing}</g></svg>`,
    footprintMm:{width:Math.round(design.widthMm*(ceiling?.8:.86)),height:Math.round(design.heightMm*(ceiling?.8:.86))},
    blocksMovement:blocking, blocksSight:false, renderLayer:ceiling?'canopy':'object', shadowClass:ceiling?'none':blocking?'furniture':'none',
    tags:['原创','照明与供热',design.category,design.era,design.design,'正顶视','静态外观不创建光源',...(wall?['独立物件','不创建墙体附着']:[]),...(ceiling?['悬挂装饰','不授予净高通行']:[])] }
}
export const LIGHTING_COLLECTION_ART:readonly VisualSampleArt[] = freezeJson(LIGHTING_DESIGNS.map(design=>artwork(design,LIGHTING_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
