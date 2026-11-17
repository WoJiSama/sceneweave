import { KITCHEN_DESIGNS, type KitchenDesign } from '../assets/kitchen-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

const ink = '#4B483D', wood = 'url(#wood)', stone = 'url(#stone)', iron = 'url(#iron)', copper = 'url(#copper)', ceramic = 'url(#ceramic)'
const rep = (n: number, draw: (i: number) => string) => Array.from({ length: n }, (_, i) => draw(i)).join('')
const p = (d: string, fill = 'none', stroke = ink, sw = 2.4) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
const r = (x: number, y: number, w: number, h: number, fill: string, rad = 4, stroke = ink, sw = 2.4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const e = (x: number, y: number, rx: number, ry: number, fill: string, stroke = ink, sw = 2.4) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g = (body: string, transform: string) => `<g transform="${transform}">${body}</g>`
const pipe = (d: string, color = '#9E9B83', sw = 9) => p(d, 'none', '#56594D', sw + 4) + p(d, 'none', color, sw) + p(d, 'none', '#D2CCB3', 1.2)
const bolt = (x: number, y: number) => e(x, y, 3.4, 3.4, '#B0AA91', '#5F6253', 1) + p(`M${x-2} ${y}h4`, 'none', '#5F6253', 1)
const bolts = (x: number, y: number, w: number, h: number) => [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([x,y])=>bolt(x,y)).join('')
const grain = (x: number, y: number, w: number, h: number, n = 12) => `<g opacity=".4">${rep(n,i=>p(`M${x+((i*17)%19)} ${y+(i+1)*h/(n+1)}q${w*.23} ${i%3-1} ${w*.46} 0t${w*.46} 0`, 'none', i%4?'#C6B08B':'#5C513D', 1.1))}</g>`
function board(x: number, y: number, w: number, h: number, rad = 8):string {
  const radius=Math.min(rad,w/2,h/2), inset=(dy:number)=>{
    const near=Math.min(dy,h-dy)
    return near<radius?radius-Math.sqrt(Math.max(0,radius*radius-(radius-near)**2))+7:7
  }
  return r(x,y,w,h,wood,rad)+`<g opacity=".4">${rep(13,i=>{const dy=14+(i+1)*(h-28)/14,margin=inset(dy)+4+i%3;return p(`M${x+margin} ${y+dy}q${(w-margin*2)*.25} ${i%3-1} ${(w-margin*2)*.5} 0t${(w-margin*2)*.5} 0`,'none',i%4?'#C6B08B':'#5C513D',1.1)})}</g>`
    +p([.35,.67].map(ratio=>{const dy=h*ratio,margin=inset(dy);return `M${x+margin} ${y+dy}h${w-margin*2}`}).join(' '),'none','#685C44',2)
    +p(`M${x+inset(7)} ${y+7}h${w-inset(7)*2}`,'none','#C5B08A',1.3)
}
const specks = (cx:number,cy:number,rx:number,ry:number,n=45,color='#A9A28E') => `<g opacity=".35">${rep(n,i=>{const a=i*2.399963,b=Math.sqrt((i+.5)/n);return e(cx+Math.cos(a)*rx*b,cy+Math.sin(a)*ry*b,1+(i%3)*.4,.7+(i%2)*.5,color,color,.1)})}</g>`
const stoneSlab = (x:number,y:number,w:number,h:number) => r(x,y,w,h,stone,11) + specks(x+w/2,y+h/2,w*.45,h*.42,80) + p(`M${x+w*.2} ${y+5}l12 ${h*.34} -8 ${h*.2}M${x+w*.68} ${y+h*.41}l-18 ${h*.28} 6 ${h*.15}`, 'none', '#6D7567',1.4)
const tile = (x:number,y:number,w:number,h:number,n=6) => r(x,y,w,h,ceramic,9) + p(rep(n-1,i=>`M${x+(i+1)*w/n} ${y+4}v${h-8} `)+rep(3,i=>`M${x+4} ${y+(i+1)*h/4}h${w-8} `),'none','#A4A897',1.5)
const polygon = (cx:number,cy:number,rx:number,ry:number,n:number,fill:string) => p(rep(n,i=>`${i?'L':'M'}${cx+Math.cos(i*2*Math.PI/n-Math.PI/2)*rx} ${cy+Math.sin(i*2*Math.PI/n-Math.PI/2)*ry}`)+'Z',fill)
const ring = (x:number,y:number,rx:number,ry=rx,fill=iron) => e(x,y,rx,ry,fill) + e(x,y,rx*.78,ry*.78,'#3E433B','#7E8474',2) + e(x,y,rx*.58,ry*.58,'#4F5548','#969B84',1.8) + p(`M${x-rx*.57} ${y-ry*.28}q${rx*.5} ${-ry*.25} ${rx*.95} 0`, 'none', '#272F2A',1.6)
const burner = (x:number,y:number,s=1) => g(ring(0,0,45,45) + pipe('M-51 0H51M0-51V51','#777C6B',6) + e(0,0,14,14,'#484C41','#8E947D',1.5),`translate(${x} ${y}) scale(${s})`)
const coals = (x:number,y:number,rx:number,ry:number) => e(x,y,rx,ry,'#42443A','#625E4D',3) + rep(15,i=>{const a=i*2.4,b=Math.sqrt((i+.5)/15);return p(`M${x+Math.cos(a)*rx*.78*b-6} ${y+Math.sin(a)*ry*.74*b-4}l11-3 8 7-7 8-11-4Z`,i%3?'#5F5540':'#9D7044','#443F31',1)})
const grate = (x:number,y:number,w:number,h:number) => r(x,y,w,h,iron,3) + p(rep(10,i=>`M${x+10+i*(w-20)/9} ${y+6}v${h-12} `),'none','#262F2B',6) + p(rep(10,i=>`M${x+11+i*(w-20)/9} ${y+7}v${h-14} `),'none','#939780',1.4)
const masonry = (x:number,y:number,w:number,h:number) => r(x,y,w,h,'#8E8872',14) + rep(4,j=>rep(5,i=>{const bx=x+8+i*(w-16)/5,by=y+8+j*(h-16)/4;return r(bx+1,by+1,(w-16)/5-3,(h-16)/4-3,['#96917B','#AAA18A','#7F826E'][(i+j)%3],4,'#6B6F5E',1.5)}))
const heatPlate = (x:number,y:number,w:number,h:number) => r(x,y,w,h,iron,8) + bolts(x+10,y+10,w-20,h-20) + p(`M${x+24} ${y+21}h${w-48}m-${w*.67} 17h${w*.52}`, 'none','#A1A28A',1.2)
const potLid = (x:number,y:number,s=1,fill=iron) => g(e(0,0,51,51,fill) + e(0,0,38,38,'none','#B4B29A',1.4) + pipe('M-14 0q14-16 28 0','#A5A58D',6),`translate(${x} ${y}) scale(${s})`)

function stove(i:number):string {
  switch(i) {
    case 0: return masonry(53,85,118,315)+masonry(431,85,118,315)+coals(300,249,115,144)+grate(155,160,290,174)+pipe('M84 124H516M84 360H516','#636959',12)
    case 1: return r(58,69,484,346,'#AA9878',61)+r(82,92,436,298,'#BAA783',45,'#8A8065',2)+ring(220,228,94)+ring(421,256,68)+r(128,377,120,35,'#555345',8)+specks(300,241,215,135,90)
    case 2: return masonry(45,93,510,309)+[144,300,456].map(x=>ring(x,244,66)).join('')+r(71,106,458,30,'#646854',3)+pipe('M75 371H526','#AAA58B',8)
    case 3: return p('M61 59H539V195H211V423H61Z',stone)+ring(164,132,56)+ring(405,132,63)+ring(136,309,64)+p('M76 82H519M84 404V209','none','#B6B8A2',2)+specks(130,319,45,74,24)
    case 4: return e(300,244,207,190,stone)+coals(300,244,166,150)+pipe('M125 385L300 73 474 385M125 385H474','#8D7A56',13)+pipe('M300 73V240','#767965',3)+potLid(300,247,1.35)+e(300,246,52,52,'none','#BCC0A2',2)
    case 5: return p('M47 395V222Q60 62 300 61Q542 65 553 224V395Z',stone)+p('M101 358V232Q123 115 300 112Q477 116 498 235V358Z','#555A49')+coals(298,246,169,98)+grate(128,153,338,184)+board(470,258,65,122,3)+p('M67 377h459','none','#C0BEA3',4)
    case 6: return e(187,245,139,157,'#AA9776')+e(413,245,139,157,'#AA9776')+r(189,135,222,252,'#AA9776',12,'#AA9776',1)+ring(183,245,99)+ring(417,245,99)+r(262,382,75,31,'#494C3E',7)
    case 7: return masonry(51,92,498,309)+heatPlate(71,111,319,268)+r(414,128,105,225,stone,5)+r(88,331,106,37,'#4A4E3D',3)+p('M108 135L345 351M123 125L364 341','none','#656E5A',1.2)
    case 8: return p('M300 46Q456 82 441 229Q555 309 460 397Q373 445 300 364Q222 443 140 394Q49 306 160 226Q145 85 300 46Z','#96A083')+ring(300,170,66,74,copper)+ring(185,318,62,59,copper)+ring(414,318,62,59,copper)+pipe('M300 245V367M300 246L172 334M300 246L427 331','#C4B48C',5)
    case 9: return polygon(300,240,251,205,6,iron)+polygon(300,240,226,181,6,'#858975')+pipe('M300 61V410M81 329L516 151M83 151L518 329','#5D6655',10)+ring(221,183,60,60)+ring(379,183,60,60)+ring(300,323,60,60)+[0,1,2,3,4,5].map(n=>{const a=n*Math.PI/3;return bolt(300+204*Math.cos(a),240+172*Math.sin(a))}).join('')
    case 10: return p('M91 90L202 69 315 88 456 64 534 105 510 365 410 412 259 386 94 415 55 354Z',stone)+coals(299,244,150,124)+pipe('M95 93Q44 248 106 396M493 91Q553 253 493 390','#C1B593',23)+grate(178,127,251,224)+p('M89 134l24 10m-26 61 25 5m388-66 23-10m-17 66 24-7','none','#746D52',4)
    case 11: return e(300,240,218,194,stone)+e(300,240,190,168,'none','#B6B99A',4)+ring(300,243,82,82,copper)+[0,1,2].map(n=>{const a=n*Math.PI*2/3-Math.PI/2;return heatPlate(300+139*Math.cos(a)-37,240+120*Math.sin(a)-34,74,68)}).join('')+pipe('M129 330L300 86 471 330Z','#8B8D75',3)
    case 12: return p('M49 99L132 55 212 99 300 50 387 99 470 55 552 99V406H49Z',stone)+[143,300,457].map(x=>{return heatPlate(x-61,150,122,209)+ring(x,239,49,69)}).join('')+r(44,128,28,249,iron,4)+r(528,128,28,249,iron,4)
    case 13: return p('M45 232L160 74 301 115 441 74 557 233 490 402 300 349 110 402Z',stone)+pipe('M300 121V340','#92876A',15)+ring(167,243,80,101,copper)+ring(433,243,80,101,copper)+p('M274 146l52 21-51 22 51 22-51 23 51 23-51 23','none','#6E7059',3)
    case 14: return p('M56 242Q141 62 300 89Q462 62 546 242Q455 416 300 389Q140 414 56 242Z','#A0AA83')+p('M79 242Q300 164 524 242','none','#6F815D',8)+ring(220,241,76,95,copper)+ring(401,241,60,78,copper)+p('M536 223l34 3v42l-34 3Z',wood)
    case 15: return p('M61 263Q54 82 273 65Q489 49 542 232Q560 400 362 416Q107 448 61 263Z','#B09E7B')+ring(246,239,115,119)+ring(441,275,60,73)+r(147,386,124,29,'#52543F',7)+specks(300,239,210,150,100)
    case 16: return heatPlate(49,82,504,327)+rep(6,n=>potLid(144+n%3*151,176+Math.floor(n/3)*143,.98))+r(472,43,69,59,iron,6)+e(506,67,19,16,'#384337','#969A81',3)+pipe('M69 425H528M109 425V408M489 425V408','#A2A68D',9)
    case 17: return tile(64,86,473,324)+[178,422].map(x=>[179,324].map(y=>ring(x,y,57)).join('')).join('')+pipe('M74 63H526M112 63V89M489 63V89','#9AA189',10)+rep(4,n=>e(144+n*101,407,10,7,'#59654E','#D5D7B6',2))
    case 18: return heatPlate(46,113,508,250)+burner(174,238,1.55)+burner(425,238,1.55)+pipe('M144 90H455V114','#9D9F86',10)+[182,418].map(x=>r(x-25,366,50,32,'#4F5747',6)).join('')
    case 19: return r(58,99,483,273,ceramic,19)+[197,403].map(x=>e(x,234,84,84,iron)+p(rep(9,n=>`M${x-63} ${178+n*14}q63-18 126 0 `),'none','#363E35',3)).join('')+r(503,150,52,177,iron,8)+e(530,204,13,16,'#9E9D83')+e(530,275,13,16,'#9E9D83')
    case 20: return tile(92,111,415,260)+[193,406].map(x=>[188,297].map(y=>ring(x,y,47)).join('')).join('')+pipe('M65 91H535V393H65ZM110 86V62M490 86V62','#A2A68F',8)+r(35,205,58,64,iron,7)+r(508,205,58,64,iron,7)
    case 21: return heatPlate(40,84,520,328)+[121,238].map(x=>[175,319].map(y=>ring(x,y,45)).join('')).join('')+r(322,105,214,285,iron,3)+p('M338 131l173 217m-169-8 165-184','none','#656D59',1.4)+r(484,41,66,58,iron,7)+e(517,62,18,17,'#394237')
    case 22: return e(300,241,196,195,iron)+e(300,241,173,172,'none','#A0A38A',3)+ring(300,236,133)+p('M469 199H552V281H469Z',iron)+r(506,214,52,53,'#4A5243',6)+bolts(172,112,255,257)
    case 23: return pipe('M69 118H529V390H69Z','#8A917A',14)+[178,422].map(x=>burner(x,224,1.35)).join('')+r(110,330,380,70,'#7A846E',31)+pipe('M180 307V330M420 307V330','#A7A58B',9)+e(475,366,12,12,copper)+bolts(81,132,436,244)
    default: throw new Error('未知厨房灶台构造。')
  }
}

const mouth = (x:number,y:number,w:number) => r(x,y,w,42,stone,8)+r(x+13,y+4,w-26,20,'#4A4C3D',6)+p(`M${x+16} ${y+35}h${w-32}`,'none','#CAC3A8',2)
const dome = (x:number,y:number,rx:number,ry:number,fill=stone) => e(x,y,rx,ry,fill)+e(x,y,rx*.8,ry*.8,'none','#B7B79C',2)+p(`M${x-rx*.68} ${y-ry*.53}q${rx*.68} ${-ry*.35} ${rx*1.35} 0M${x-rx*.78} ${y+ry*.4}q${rx*.78} ${ry*.3} ${rx*1.56} 0`,'none','#7A806A',2)+specks(x,y,rx*.85,ry*.85,70)
const chimney = (x:number,y:number,s=1) => g(e(0,0,29,27,stone)+e(0,0,17,16,'#3F473A','#989C83',3),`translate(${x} ${y}) scale(${s})`)
function oven(i:number):string {
  switch(i) {
    case 0: return dome(300,232,226,189,'#AC9A78')+mouth(224,390,152)+chimney(321,114,1.2)
    case 1: return masonry(51,65,500,354)+dome(300,221,208,148,'#AC9780')+p('M119 143q180-29 361 0M104 195q196-34 391 0M115 259q185-29 371 0M156 312q144-18 285 0','none','#7D7863',4)+mouth(195,386,210)+chimney(330,100)
    case 2: return stoneSlab(43,74,514,332)+r(80,99,440,264,'#9A947C',111)+rep(7,n=>p(`M${104+n*62} 114q-16 127 0 232`,'none','#B9B29A',5))+mouth(73,349,167)+chimney(475,229,1.1)
    case 3: return p('M67 265Q49 106 223 64Q434 35 521 187Q578 365 369 408Q128 455 67 265Z','#AD9672')+p('M111 160Q291 73 466 158M91 235Q303 156 514 236M122 314Q307 249 485 310','none','#897A5D',3)+mouth(204,386,173)+chimney(302,130,1.1)+specks(300,238,200,142,100)
    case 4: return dome(185,229,149,170,'#A29B7B')+dome(415,229,149,170,'#AC9A78')+r(283,103,34,281,stone,3)+mouth(107,375,152)+mouth(340,375,152)+chimney(185,124,.8)+chimney(414,124,.8)
    case 5: return e(300,241,244,182,stone)+rep(9,n=>{const a=n*Math.PI*2/9;return g(r(-44,-23,88,46,stone,5),`translate(${300+Math.cos(a)*199} ${241+Math.sin(a)*143}) rotate(${n*40+90})`)})+p('M148 124L256 89 410 142 440 269 334 369 166 334 112 220Z','#92967D')+p('M148 124L440 269M256 89L166 334M410 142L334 369','none','#626D56',4)+mouth(215,374,167)
    case 6: return masonry(49,55,502,374)+r(93,145,415,165,'#9D9983',68)+r(208,85,187,300,'#B1A68C',63)+p('M100 228H501M300 91V377','none','#7D816C',3)+mouth(213,388,179)+chimney(301,142,1.05)
    case 7: return masonry(51,74,500,332)+grate(90,107,420,264)+[142,300,458].map(x=>r(x-38,87,76,306,'#9C9F87',28)+p(`M${x} 99v278`,'none','#BABCA1',2)).join('')+mouth(204,375,191)
    case 8: return p('M59 288Q90 65 301 65Q533 75 548 289Q428 400 302 371Q164 421 59 288Z','#939D7C')+p('M86 282Q171 88 406 94Q473 245 299 350Q188 376 86 282Z','#ADB294')+p('M110 287Q245 167 407 99M303 69Q398 204 530 285','none','#718560',6)+mouth(192,370,215)+chimney(279,136,.9)
    case 9: return polygon(300,226,253,191,6,copper)+polygon(300,226,213,160,6,'#9D8A62')+p('M300 45V407M82 136L520 318M81 318L519 135','none','#6F6D55',10)+rep(6,n=>{const a=n*Math.PI/3;return bolt(300+184*Math.cos(a),226+147*Math.sin(a))})+mouth(218,384,165)+polygon(300,224,53,43,6,iron)
    case 10: return p('M54 252L92 104 222 67 343 92 493 63 552 244 517 383 377 408 254 380 95 421Z',stone)+pipe('M93 112L512 367M498 101L112 382','#BCB08D',18)+pipe('M77 177L525 273','#AC9F7C',14)+mouth(216,377,169)+chimney(388,143,1.1)
    case 11: return polygon(300,226,243,183,8,stone)+polygon(300,226,207,154,8,'#9FA28A')+rep(8,n=>{const a=n*Math.PI/4;return p(`M300 226L${300+224*Math.cos(a)} ${226+170*Math.sin(a)}`,'none','#BEBBA0',3)})+[170,300,430].map(x=>chimney(x,x===300?132:247,.72)).join('')+mouth(221,379,160)
    case 12: return p('M85 373V125L165 66H435L516 125V373Z',stone)+p('M112 344V138L300 74 488 138V344L300 383Z','#979D84')+p('M300 75V381M113 138L300 182 488 138M114 246L300 282 488 246','none','#6A775F',5)+[118,460].map(x=>[160,294].map(y=>r(x,y,27,53,stone,3)).join('')).join('')+mouth(211,383,179)+chimney(300,119,.75)
    case 13: return dome(300,223,241,178,copper)+rep(5,j=>rep(6,k=>{const x=125+k*61+(j%2)*26,y=100+j*58;if(((x-300)/214)**2+((y-223)/158)**2>.82)return '';return p(`M${x-27} ${y-15}q27-23 54 0l-3 23-24 14-26-14Z`,j%2?'#A79870':'#B6A37A','#766E53',1.4)}))+mouth(190,378,220)+chimney(305,99,.9)
    case 14: return p('M68 243Q111 62 306 86Q472 61 541 244Q460 412 298 388Q131 414 68 243Z','#A6AC87')+p('M87 246Q291 112 521 244Q287 337 87 246Z','#B6BB96')+p('M298 89Q337 234 297 387','none','#71825B',5)+mouth(224,367,149)+chimney(418,205,.72)
    case 15: return p('M55 259Q70 90 234 67Q433 39 529 187Q584 343 384 404Q148 463 55 259Z','#A49C78')+dome(291,226,189,141,'#B2A383')+mouth(176,376,240)+chimney(242,125,.8)+chimney(378,153,.65)
    case 16: return heatPlate(47,81,509,324)+r(74,110,453,231,iron,9)+p('M81 227H520M139 112V334M461 112V334','none','#525C4B',3)+pipe('M88 374H512','#A8A48A',12)+pipe('M90 237H510','#A8A48A',7)+bolts(91,127,417,192)
    case 17: return tile(48,67,503,345,7)+r(100,100,402,257,iron,111)+p('M159 116q-22 111 0 225M239 107q-20 124 0 243M324 108q-19 118 0 240M410 118q-15 107 0 222','none','#949984',3)+r(451,83,70,73,iron,7)+e(486,116,19,20,'#353F34')+mouth(194,376,208)
    case 18: return heatPlate(122,86,356,319)+board(47,138,83,214,6)+board(471,138,81,214,6)+chimney(384,128,.9)+pipe('M169 369H430','#A6A58E',12)+r(162,189,275,128,'#7C8370',9)+bolts(146,112,308,266)
    case 19: return dome(270,231,215,189,iron)+e(270,231,173,150,'none','#A4A78E',3)+pipe('M270 85V379M107 231H435','#8E9680',5)+r(454,129,96,180,'#707B65',12)+e(499,212,26,28,copper)+mouth(187,381,180)
    case 20: return heatPlate(46,100,511,291)+r(67,116,470,224,'#8D9780',8)+r(78,127,451,22,'#454F40',4)+pipe('M73 370H286M313 370H528','#B1AF95',9)+bolts(78,164,449,156)
    case 21: return r(70,80,460,325,ceramic,26)+[150,240,330].map(y=>r(104,y,391,20,iron,7)+p(`M119 ${y+4}h358`,'none','#B6B9A1',2)).join('')+pipe('M85 68H515M85 412H515','#A4A58C',8)+bolts(92,103,418,278)
    case 22: return heatPlate(104,107,391,279)+pipe('M75 83H526V409H75Z','#9CA58C',9)+pipe('M120 87V59M480 87V59','#A5AB94',9)+r(139,143,320,154,'#7E8872',8)+pipe('M151 353H449','#B1AF93',9)
    case 23: return heatPlate(112,114,335,256)+r(454,147,76,186,iron,34)+e(493,175,19,21,copper)+pipe('M168 354H384','#A2A790',10)+bolts(136,138,287,206)+pipe('M466 237H447','#A89C77',10)
    default: throw new Error('未知厨房烤炉构造。')
  }
}

const feet = (x:number,y:number,w:number,h:number,color=wood) => [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([x,y])=>r(x-13,y-13,26,26,color,4)+bolt(x,y)).join('')
const leafSurface = (fill=wood) => p('M41 240Q171 57 300 88Q446 58 560 240Q431 423 300 391Q152 420 41 240Z',fill)+p('M74 240Q303 194 530 240M300 89V390','none','#80906C',5)
const bowl = (x:number,y:number,rx:number,ry=rx,fill=ceramic) => e(x,y,rx,ry,fill)+e(x,y,rx*.78,ry*.77,'#718071','#BFC6AC',3)+e(x,y,rx*.5,ry*.48,'none','#566D5C',1.7)+p(`M${x-rx*.49} ${y-ry*.5}q${rx*.5} ${-ry*.1} ${rx*.94} 0`,'none','#D3D7BE',1.5)
function prep(i:number):string {
  switch(i) {
    case 0: return pipe('M77 56L112 424M523 56L488 424',wood,23)+board(60,98,480,288)+pipe('M69 64H531M95 417H505',wood,14)+bolts(81,118,438,248)
    case 1: return feet(74,93,452,300)+r(64,82,474,323,wood,18)+rep(6,j=>rep(8,k=>r(78+k*56,95+j*48,53,45,['#9E8861','#B19A72','#8B7754'][(k+j*2)%3],2,'#716244',1.5)+p(`M${87+k*56} ${107+j*48}q17-10 30 0m-24 6q10-5 18 0`,'none','#C3AC7E',1)))+p('M83 381H516M501 116v241','none','#675C43',6)
    case 2: return stoneSlab(47,80,505,328)+p('M210 89l-17 134 18 173M392 88l-9 164 23 146','none','#626F5B',4)+p('M67 373H528','none','#647159',6)+feet(63,99,474,288,stone)
    case 3: return p('M60 60H540V196H212V421H60Z',wood)+grain(84,78,428,98)+grain(80,221,105,170)+p('M76 178H194V403M211 76V179H520','none','#6C5D40',4)+r(244,148,213,10,'#554F39',3)+feet(76,77,445,104)
    case 4: return pipe('M139 398L300 71 465 398M139 398H465',wood,18)+e(300,239,227,190,wood)+rep(8,n=>{const a=n*Math.PI/4;return p(`M300 239L${300+215*Math.cos(a)} ${239+177*Math.sin(a)}`,'none','#756044',2)})+e(300,239,24,21,'#AA9168','#7D6A48',2)
    case 5: return stoneSlab(47,108,505,263)+p('M80 243H498M498 223v42','none','#65745E',8)+e(506,242,17,17,'#3B4A39','#A2AD8D',3)+p('M98 136l12 20m264 100 27-15m-198 66 19 8','none','#C8CAB0',1.3)
    case 6: return board(55,93,490,302)+r(80,116,440,254,'#78684B',13)+r(99,133,402,219,wood,7)+grain(118,148,362,187)+pipe('M55 163H31V316H55M545 163H570V316H545','#A2936C',12)+p('M114 338H483','none','#C2AD83',2)
    case 7: return feet(106,109,389,259)+board(56,94,159,295)+board(220,94,159,295)+board(384,94,159,295)+[146,337].map(y=>[210,378].map(x=>r(x-4,y-13,8,26,iron,2)+bolt(x,y)).join('')).join('')+p('M73 106h124M401 377h123','none','#CBB58A',2)
    case 8: return leafSurface()+p('M120 183q158 17 337 0M132 309q162-17 326 0','none','#B5B191',2)+[85,515].map(x=>e(x,239,19,26,wood,'#7C805B',2)).join('')+p('M281 96q-28 104 0 285','none','#D0C098',1.3)
    case 9: return polygon(300,240,252,192,6,stone)+pipe('M300 48V430M82 143L518 335M82 335L518 143','#AFA178',6)+rep(6,n=>{const a=n*Math.PI/3;return r(300+206*Math.cos(a)-13,240+162*Math.sin(a)-13,26,26,iron,4)+bolt(300+206*Math.cos(a),240+162*Math.sin(a))})+specks(300,240,191,143,80)
    case 10: return p('M62 97L202 63 342 92 490 68 547 133 515 361 400 413 253 380 80 415Z',wood)+grain(103,123,391,237)+pipe('M82 99Q29 242 89 398M503 93Q560 245 503 387','#C0B390',20)+p('M89 149l19 9m-25 53 23 6m392-48 22-7m-20 64 24-6','none','#796F50',4)
    case 11: return polygon(300,240,246,190,8,wood)+polygon(300,240,221,166,8,'none')+[174,300,426].map((x,n)=>bowl(x,152+n%2*9,43,42)).join('')+grain(126,229,351,140)+pipe('M172 213H431','#8B9476',3)
    case 12: return p('M50 107L134 61 218 107 300 57 382 107 467 61 551 107V395H50Z',wood)+grain(80,146,440,223)+r(45,128,29,241,iron,3)+r(526,128,29,241,iron,3)+p('M85 333H513','none','#675B40',3)
    case 13: return p('M43 227L152 67 300 129 447 67 558 227 467 413 300 334 131 413Z',wood)+p('M64 228L159 95 299 151 442 95 536 228M132 388L300 311 468 388','none','#C8B08A',2)+p('M300 137V298','none','#7A6547',6)+[155,443].map(x=>grain(x-39,163,80,139,6)).join('')
    case 14: return p('M54 242Q153 64 300 91Q464 66 546 242Q444 419 300 388Q133 416 54 242Z',wood)+p('M82 242Q300 169 521 242','none','#8A9D72',6)+[163,299,432].map(x=>e(x,252,48,70,'#6B7659','#ADAD87',4)).join('')+p('M544 229h31v27h-31Z',wood)
    case 15: return p('M53 236Q77 81 298 77Q524 76 546 235Q538 368 389 401L344 350H252L208 405Q63 370 53 236Z',wood)+grain(108,122,386,181)+e(86,244,47,61,wood)+e(514,244,47,61,wood)+p('M124 335q173 51 353 0','none','#6E6043',3)
    case 16: return feet(77,106,445,269,iron)+r(55,89,491,300,ceramic,14)+r(69,102,462,20,'#ADBAA4',5,'#829580',2)+specks(300,249,209,105,50,'#C9CCB5')+pipe('M91 373H510','#B1B5A0',4)
    case 17: return stoneSlab(48,82,504,324)+p('M74 102Q189 190 157 289T291 391M299 94q72 42 60 105t116 186M426 117q-56 90-5 155','none','#7D8977',1.4)+p('M97 109q77 66 63 139m190-52q-2 66 111 171','none','#BBC4AD',2)+feet(65,100,470,287,iron)
    case 18: return heatPlate(49,89,502,302)+r(72,111,458,232,'#9CA38F',7)+p('M85 353H514','none','#54644E',7)+p('M92 117h419M81 124v205','none','#D3D4BE',1.8)+bolts(61,101,479,278)
    case 19: return board(45,61,510,360)+r(69,82,461,12,'#635B43',4)+r(69,386,461,12,'#635B43',4)+pipe('M28 127V354M573 127V354M28 136H46M28 344H46M555 136H573M555 344H573','#A5A68C',10)+feet(68,88,465,309,iron)
    case 20: return feet(76,116,448,245,iron)+board(83,101,434,273)+pipe('M53 135V338M547 135V338M53 150H83M53 323H83M517 150H547M517 323H547','#9CA68E',10)+[66,519].map(x=>[95,365].map(y=>r(x-13,y-11,26,24,'#485643',9)+r(x-5,y-13,10,28,'#9BA28A',2)).join('')).join('')
    case 21: return p('M48 383Q49 75 300 69Q553 72 553 383H414Q418 244 300 237Q181 245 187 383Z',stone)+p('M69 365Q77 96 300 91Q524 98 532 365M176 365q7-139 124-144q123 7 131 144','none','#C1C5AB',3)+p('M165 102l52 141M434 101l-51 143','none','#687963',2)
    case 22: return r(47,91,506,300,ceramic,9)+rep(6,n=>bowl(112+n*76,172,31,38))+p('M67 244H534','none','#A5B29A',3)+specks(300,304,210,58,35)+pipe('M57 100H542V381H57Z','#B5BBA2',3)
    case 23: return board(84,92,255,295)+board(346,92,170,295)+[151,332].map(y=>r(334,y,13,30,iron,3)+bolt(341,y+15)).join('')+pipe('M64 71H537V407H64Z','#A2AD92',8)+pipe('M103 72V53M498 72V53','#99A68D',8)
    default: throw new Error('未知厨房备餐案构造。')
  }
}

const basin = (x:number,y:number,w:number,h:number,rad=13,fill=stone) => r(x,y,w,h,fill,rad)+r(x+15,y+14,w-30,h-28,'#6F8171',Math.max(5,rad*.65),'#B2BDA5',3)+r(x+29,y+27,w-58,h-54,'#81947F',Math.max(4,rad*.5),'#5D7460',2)+e(x+w*.65,y+h*.65,10,10,'#465E4C','#AFBA9E',2)+p(`M${x+35} ${y+34}h${w-76}`,'none','#C4CDB2',2)
const faucet = (x:number,y:number,s=1) => g(pipe('M0 0V-47Q18-72 37-48V-12','#9EA98F',9)+e(0,-8,14,10,iron)+pipe('M-28-20H-6M-18-30V-10M41-20H63M52-30V-10','#AAB49A',5),`translate(${x} ${y}) scale(${s})`)
const drainer = (x:number,y:number,w:number,h:number,fill=ceramic) => r(x,y,w,h,fill,6)+p(rep(9,n=>`M${x+12+n*(w-24)/8} ${y+15}v${h-30} `),'none','#6E826D',3)
function sink(i:number):string {
  switch(i) {
    case 0: return basin(50,86,501,312,24)+p('M75 100l25 34m343 190 35 47M78 355l21-23','none','#C2C5AA',1.8)+specks(300,240,217,131,65)
    case 1: return board(52,92,496,300)+[180,421].map(x=>e(x,243,104,122,wood)+bowl(x,243,82,99,wood)+p(`M${x-91} 227h182M${x-84} 288h168`,'none','#65583E',2)).join('')+feet(65,108,470,267)
    case 2: return basin(73,81,452,325,5)+p('M79 94h437M89 397V111M516 110V395M86 394h426','none','#C7C9AF',4)+r(222,56,153,36,stone,3)+r(247,62,101,20,'#536B56',2)
    case 3: return feet(85,120,429,240)+pipe('M85 120H514V360H85Z',wood,12)+e(300,241,222,186,wood)+bowl(300,241,191,153,wood)+e(300,241,211,174,'none','#697360',9)+p('M115 170H484M110 310H490','none','#5C664F',7)
    case 4: return p('M56 55H543V207H223V424H56Z',stone)+basin(75,73,447,117,8)+basin(76,218,131,187,8)+e(230,211,12,12,'#445A45','#B8C0A1',3)+p('M256 193l-15 13m-30 23-15 8','none','#62785C',3)
    case 5: return board(49,88,502,307)+bowl(239,244,159,134,'#AD9778')+e(239,244,126,104,'none','#CBB58C',3)+e(286,273,12,11,'#4C624B')+p('M404 282h116','none','#556E52',8)+r(498,265,35,35,'#727E60',5)
    case 6: return stoneSlab(41,116,518,250)+rep(3,n=>basin(57+n*170,133,147,216,4))+p('M177 241h58M348 241h57','none','#4A6C50',11)+r(29,218,39,45,'#6D805D',3)+r(531,218,39,45,'#6D805D',3)
    case 7: return stoneSlab(45,86,510,315)+basin(61,104,245,279,10)+drainer(322,109,215,267,wood)+p('M309 118v250','none','#B1B69A',3)
    case 8: return leafSurface(stone)+p('M83 241Q168 126 300 139Q451 131 521 241Q443 350 300 344Q161 356 83 241Z','#6F8A70','#BDC3A5',4)+p('M112 241q186-45 376 0M300 151V331','none','#547454',3)+e(344,272,14,12,'#3B5C40')+pipe('M300 93q-72 27-60 104','#899D70',13)
    case 9: return stoneSlab(46,97,508,300)+[172,428].map(x=>polygon(x,245,106,120,6,iron)+polygon(x,245,83,95,6,'#81947A')+e(x,272,11,12,'#485F46')).join('')+pipe('M300 114V369','#A7986E',8)+bolts(61,114,478,264)
    case 10: return p('M65 91L209 61 338 89 484 69 549 118 520 365 397 413 248 380 84 413Z',stone)+basin(122,127,365,235,26)+pipe('M92 94Q35 243 95 398M500 94Q552 241 501 388','#BEB18B',21)+pipe('M313 85Q233 91 230 167','#B9AB85',17)
    case 11: return e(300,241,220,193,stone)+[0,1,2].map(n=>{const a=n*2*Math.PI/3-Math.PI/2;return bowl(300+119*Math.cos(a),241+113*Math.sin(a),72,69)}).join('')+e(300,241,17,17,'#5B7458','#B5BE9D',3)+pipe('M300 241V183M300 241L237 275M300 241L363 275','#A9B18B',6)
    case 12: return p('M300 51L535 232 450 398H150L65 232Z',stone)+p('M300 94L486 238 421 366H179L114 238Z','#80927A','#BAC3A5',5)+p('M300 121L455 243 405 338H196L145 243Z','none','#5F7E60',3)+r(56,212,39,112,stone,4)+r(505,212,39,112,stone,4)+e(267,318,11,11,'#3E5D40')+e(333,318,11,11,'#3E5D40')
    case 13: return p('M48 228L160 67 300 124 438 67 551 228 468 412 300 359 133 412Z',stone)+basin(100,176,181,177,57)+basin(320,176,181,177,57)+pipe('M300 129V359','#A1A57B',8)+pipe('M292 110q-69-40-86 42m102-42q69-40 86 42','#ADAA85',14)
    case 14: return p('M300 49Q371 61 387 130Q488 92 528 186Q559 265 466 304Q505 398 407 424Q327 442 301 365Q267 444 183 420Q94 390 134 305Q38 258 75 181Q116 91 212 130Q225 57 300 49Z','#B7B99B')+bowl(300,244,151,136,'#B3BE9E')+e(300,263,12,12,'#486849')+pipe('M300 74q-50 23-40 61','#819A6A',13)
    case 15: return p('M57 242Q65 80 298 74Q532 73 545 242Q532 410 298 407Q66 409 57 242Z',wood)+bowl(201,253,111,119,wood)+bowl(426,253,82,100,wood)+pipe('M95 120q212-89 408 8','#8D9973',15)+pipe('M268 103v41','#A4AC83',8)
    case 16: return r(60,78,482,332,ceramic,17)+basin(80,110,441,275,32,ceramic)+faucet(274,110,.8)+p('M83 398h436','none','#A1AF98',4)+rep(8,n=>p(`M${102+n*55} 393v11`,'none','#7D957A',2))
    case 17: return r(47,90,506,308,ceramic,15)+basin(63,117,228,263,25,ceramic)+basin(309,117,228,263,25,ceramic)+faucet(281,119,.85)
    case 18: return r(41,91,518,308,ceramic,12)+drainer(54,113,137,264)+basin(201,113,198,264,25,ceramic)+drainer(408,113,138,264)+faucet(284,114,.8)
    case 19: return heatPlate(47,85,506,313)+basin(76,111,448,261,24,iron)+bolts(61,99,478,285)+faucet(275,112,.84)+p('M90 120h416','none','#D2D6BB',1.8)
    case 20: return p('M57 55H543V208H220V424H57Z',ceramic)+p('M224 81H512V188H224L90 394V222Z','#7D947B','#B5C6A9',5)+drainer(75,77,133,122)+drainer(75,263,129,141)+faucet(347,101,.8)+e(259,193,11,10,'#47674B')
    case 21: return r(57,89,486,309,ceramic,17)+bowl(274,254,177,125)+faucet(253,131,.9)+e(322,280,12,11,'#405C43')+p('M472 168v180','none','#9EAE92',3)
    case 22: return r(79,106,442,282,iron,10)+basin(96,126,194,241,18,ceramic)+basin(308,126,195,241,18,ceramic)+pipe('M54 84H545V411H54Z','#AEB79B',8)+faucet(282,136,.8)+bolts(91,118,418,257)
    case 23: return r(38,91,524,310,iron,10)+rep(3,n=>basin(52+n*173,125,149,260,17,ceramic)+faucet(101+n*173,126,.67))+pipe('M51 402H551','#AEB79D',7)
    default: throw new Error('未知厨房水槽构造。')
  }
}

const brassRail = (d:string) => pipe(d,'#B5A57D',7)
const drip = (x:number,y:number,w:number,h:number) => r(x,y,w,h,iron,6)+p(rep(10,n=>`M${x+8+n*(w-16)/9} ${y+5}v${h-10} `),'none','#B0B69B',1.5)
const tap = (x:number,y:number,s=1) => g(e(0,0,13,13,iron)+pipe('M0 0V-44H24V-18','#B2A078',8)+pipe('M-12-34H13','#817B5D',6),`translate(${x} ${y}) scale(${s})`)
function barCounter(i:number):string {
  switch(i) {
    case 0: return feet(76,111,445,252)+board(47,85,506,310)+brassRail('M71 410H528M133 395V410M467 395V410')+p('M67 359H532','none','#5F533A',4)
    case 1: return [132,300,468].map(x=>e(x,240,97,152,wood)+e(x,240,86,139,'none','#6A705B',6)).join('')+board(46,133,508,216,50)+brassRail('M75 363H524M160 349V363M440 349V363')
    case 2: return p('M55 60H543V205H216V423H55Z',wood)+grain(83,83,426,97)+grain(79,229,111,168)+p('M76 184H195V400M226 77H521','none','#B8A078',2)+brassRail('M42 207V437H229M42 264H55M42 380H55M100 423V437M200 423V437')
    case 3: return p('M46 385Q69 78 301 68Q533 78 554 385H421Q410 230 301 222Q185 232 179 385Z',wood)+p('M67 365Q93 101 301 90Q508 100 533 365M191 358Q208 249 301 244Q393 250 409 358','none','#C4AA7F',2)+brassRail('M38 383Q57 57 300 46Q546 59 564 383M300 46V68')
    case 4: return stoneSlab(47,91,506,307)+p('M214 101l-20 154 13 132M393 102l-9 137 21 148','none','#6C7C63',4)+p('M70 374H529','none','#C3C5AC',2)+feet(64,106,473,277,stone)
    case 5: return p('M53 409V176Q65 64 176 63H423Q536 65 548 177V409H413V207H188V409Z',wood)+p('M72 397V181Q84 84 181 83H419Q515 84 527 180V397M174 396V194H429V396','none','#C0AA7C',2)+brassRail('M37 410V176Q48 48 177 46H423Q554 48 563 176V410M300 46V63M37 273H53M548 273H563')
    case 6: return board(45,143,510,196,9)+rep(3,n=>r(130+n*170,124,38,32,iron,3)+bolt(149+n*170,140))+pipe('M67 342H532',wood,8)+p('M67 293H530','none','#66573C',4)
    case 7: return board(49,89,503,303)+tap(200,178,1.1)+tap(394,178,1.1)+drip(132,218,336,85)+p('M78 365H525','none','#695B40',5)+brassRail('M71 410H527M134 392V410M467 392V410')
    case 8: return p('M42 241Q161 65 301 91Q442 65 560 241Q460 423 301 378Q142 423 42 241Z',wood)+p('M300 92V362M75 242Q301 162 527 242','none','#81956B',5)+brassRail('M83 331Q299 421 519 332')+grain(180,161,258,118,6)
    case 9: return p('M42 273L146 88H454L558 273 462 405H372L448 268 389 177H211L151 268 228 405H139Z',stone)+p('M63 274L157 109H441L536 274M165 264L225 192H375L435 264','none','#C2C2A3',3)+brassRail('M31 279L139 70H460L570 279')+[104,490].map(x=>bolt(x,291)).join('')
    case 10: return p('M62 99L199 67 338 91 488 67 549 125 517 365 402 413 251 382 81 414Z',wood)+grain(101,125,392,224)+pipe('M89 99Q30 245 92 400M503 93Q559 242 503 391','#C0B38D',22)+pipe('M112 374Q294 419 488 370','#A59A76',12)
    case 11: return p('M44 315L99 143 219 64H384L502 143 557 315 456 411 400 337 440 277 401 190H199L161 277 202 337 146 411Z',wood)+polygon(300,123,50,29,6,copper)+bowl(149,236,38,44)+bowl(451,236,38,44)+p('M118 155L224 85H376L481 155','none','#BAAA7C',4)+brassRail('M37 319L83 132 215 47H389L517 132 568 319')
    case 12: return p('M50 115L112 69 173 115 237 69 300 115 363 69 427 115 489 69 550 115V394H50Z',wood)+grain(79,152,439,209)+r(45,132,29,237,iron,4)+r(526,132,29,237,iron,4)+brassRail('M70 409H530M134 394V409M467 394V409')
    case 13: return p('M43 249L155 71 301 129 444 71 558 249 475 405 387 368 429 279 376 205H224L171 279 213 368 126 405Z',stone)+p('M70 249L161 99 301 153 438 99 532 249','none','#C0BB9E',3)+brassRail('M42 275L136 423 216 391M386 391L465 423 561 275')+r(252,126,96,37,copper,9)
    case 14: return p('M300 48Q382 55 397 130Q489 104 530 184Q561 265 480 309Q501 383 425 417L354 333H246L176 418Q91 384 119 309Q37 265 71 183Q110 105 204 131Q221 57 300 48Z',wood)+e(300,236,62,57,'#929B74','#B9B58E',4)+p('M129 234Q299 145 471 234','none','#87986A',4)
    case 15: return p('M52 282Q37 92 299 72Q559 91 548 282Q536 388 446 413H383Q443 318 411 241Q303 175 189 241Q154 320 214 413H154Q67 389 52 282Z',wood)+e(83,265,43,62,wood)+e(517,265,43,62,wood)+p('M77 254Q112 110 300 99Q492 110 524 254','none','#C7AF83',2)+brassRail('M105 366Q300 421 495 366')
    case 16: return r(46,104,508,293,'#606C5B',8)+p('M46 104H136V76H196V52H405V76H465V104H554V393H465V417H405V440H196V417H136V393H46Z',stone)+r(139,106,325,287,'#5B6959',7)+p(rep(11,n=>`M300 236L${155+n*27} 385 `),'none','#A79770',1.5)+brassRail('M67 411H532M90 397V411M510 397V411')
    case 17: return p('M45 386Q59 72 300 66Q541 75 556 386H421Q417 232 300 224Q179 233 180 386Z',stone)+p('M76 355Q107 95 301 91Q494 99 525 355','none','#C4C9B0',2)+p('M167 108l63 132M435 110l-65 132','none','#768570',2)+brassRail('M192 375Q198 246 300 245Q402 250 408 375')
    case 18: return p('M93 413Q41 332 46 242Q48 70 301 62Q551 73 554 242Q558 336 505 413H401Q450 333 446 242Q448 189 302 185Q152 188 153 242Q146 336 198 413Z',wood)+p('M118 391Q66 291 83 205Q111 96 301 89Q495 98 521 205Q538 297 481 390','none','#BEAA80',3)+brassRail('M181 394Q137 315 171 238Q305 177 431 238Q458 317 419 394')
    case 19: return r(45,128,511,220,ceramic,14)+drip(184,171,229,85)+pipe('M62 107H539V369H62Z','#AAB59B',8)+pipe('M111 107V77M488 107V77','#B5BCA4',8)+bolts(66,148,469,179)
    case 20: return p('M49 102H550V408H416V316Q362 246 301 316Q238 245 185 316V408H49Z',wood)+grain(83,127,432,122)+drip(230,139,139,70)+tap(247,137,.78)+tap(336,137,.78)+brassRail('M66 421V118H534V421')
    case 21: return p('M49 411V166Q62 62 164 62H437Q541 63 552 166V411H418V202H183V411Z','#52604F')+p('M65 405V169Q78 81 170 81H430Q523 82 535 169V405M168 404V188H432V404','none','#BBA77C',9)+drip(209,101,183,65)+brassRail('M35 410V166Q45 45 164 44H437Q558 47 567 166V410')
    case 22: return p('M41 324L128 104H473L560 324 444 400 391 304 368 240H232L209 304 156 400Z',wood)+p('M67 323L144 125H456L535 323M215 282L241 224H360L384 282','none','#C6AC80',3)+brassRail('M40 346L140 421 203 381M399 380L457 421 562 346')+r(49,284,51,96,iron,7)+r(501,284,51,96,iron,7)
    case 23: return r(43,96,513,303,ceramic,65)+r(62,112,477,265,'#C7C9AD',53,'#A5B396',2)+bowl(169,221,43,52)+bowl(280,221,43,52)+r(409,107,126,263,stone,28)+brassRail('M65 410H530M142 399V410M467 399V410')
    default: throw new Error('未知厨房吧台构造。')
  }
}

const lyingBottle = (x:number,y:number,s=1,a=0) => g(r(-21,-55,42,83,'#667C60',16,'#3E5945',2)+r(-10,-76,20,31,'#91A47E',6,'#415F45',2)+r(-10,-80,20,12,'#AD9E75',3)+p('M-11-42v41','none','#A5B497',2)+r(-18,-24,36,27,'#C3B997',2,'#9D9E7A',1),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const bottleSlot = (x:number,y:number,rx=31,ry=56) => e(x,y,rx+6,ry+5,wood,'#4E5842',2)+e(x,y,rx,ry,'#394D39','#AAA984',3)+lyingBottle(x,y+13,Math.min(rx/28,ry/60))
const cask = (x:number,y:number,s=1,a=0) => g(p('M-78-64Q-111 0-78 64Q0 85 78 64Q111 0 78-64Q0-85-78-64Z',wood)+p('M-70-53Q0-64 70-53M-82-27Q0-35 82-27M-86 1H86M-81 29Q0 35 81 29M-69 55Q0 65 69 55','none','#C0A77A',1.5)+pipe('M-61-69Q-78 0-61 69M61-69Q78 0 61 69','#73765D',7)+e(0,0,10,9,'#695F42','#C7AF80',2),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
function wineRack(i:number):string {
  switch(i) {
    case 0: return board(59,88,482,307)+[104,484].map(x=>r(x,66,17,349,wood,4)).join('')+rep(8,n=>bottleSlot(125+n%4*116,175+Math.floor(n/4)*143,35,53))+pipe('M79 238H521',wood,9)
    case 1: return board(49,84,502,312)+p('M53 244L202 88 355 244 509 88M51 244L202 396 355 244 508 396M200 88L50 244M202 395L355 244 509 395M355 87L202 243 355 397M355 87L509 244 355 397','none','#5E583D',12)+[127,278,431].map((x,n)=>lyingBottle(x,239,.92,45+(n%2)*90)).join('')+bolts(63,98,474,284)
    case 2: return e(300,240,227,190,wood)+rep(8,n=>{const a=n*Math.PI/4;return pipe(`M300 240L${300+211*Math.cos(a)} ${240+175*Math.sin(a)}`,wood,10)+g(lyingBottle(0,0,.9,0),`translate(${300+154*Math.cos(a)} ${240+128*Math.sin(a)}) rotate(${n*45+90})`)})+e(300,240,37,33,wood)
    case 3: return board(42,157,516,165)+rep(6,n=>bottleSlot(84+n*86,243,28,65))+r(78,142,445,18,iron,3)+[63,530].map(x=>r(x-10,127,20,28,iron,4)+e(x,139,5,5,'#394A34')).join('')
    case 4: return e(300,242,236,172,wood)+e(300,242,215,151,'#726F50','#BCC0A2',3)+p('M76 233H524M113 335H487','none','#5B644B',7)+rep(6,n=>bottleSlot(154+n%3*145,180+Math.floor(n/3)*119,39,45))+e(300,242,225,161,'none','#6A7357',8)
    case 5: return board(51,79,497,326)+pipe('M300 90V395M64 241H537',wood,12)+rep(8,n=>bottleSlot(116+n%4*122,174+Math.floor(n/4)*139,29,49))+r(40,199,28,88,wood,6)+r(533,199,28,88,wood,6)
    case 6: return pipe('M77 64L119 414M522 64L481 414M70 74H530M105 408H494',wood,19)+board(89,110,422,266)+rep(6,n=>bottleSlot(151+n%3*150,180+Math.floor(n/3)*133,40,47))+pipe('M93 239H507',wood,10)
    case 7: return pipe('M86 134H514M86 344H514',wood,18)+cask(140,243,.95)+cask(300,243,.95)+cask(460,243,.95)+r(76,85,30,314,wood,5)+r(493,85,30,314,wood,5)
    case 8: return leafSurface()+p('M77 240Q300 166 526 240','none','#9BAF7C',8)+rep(6,n=>bottleSlot(128+n*69,240,26,47))+p('M93 291q204 125 414-2','none','#9DAF80',4)
    case 9: return polygon(300,240,251,195,6,iron)+rep(6,n=>{const a=n*Math.PI/3;return pipe(`M300 240L${300+229*Math.cos(a)} ${240+178*Math.sin(a)}`,'#998C68',7)+g(bottleSlot(0,0,36,51),`translate(${300+162*Math.cos(a)} ${240+128*Math.sin(a)}) rotate(${n*60+90})`)})+bottleSlot(300,240,37,52)
    case 10: return p('M75 92L217 64 348 88 495 64 538 131 512 375 391 411 243 382 72 414Z',wood)+pipe('M84 96Q30 241 88 398M501 90Q558 237 501 389','#BFB28B',19)+rep(4,n=>bottleSlot(167+n%2*259,178+Math.floor(n/2)*144,65,53))+p('M100 120L494 370M494 115L104 375','none','#AC9B72',8)
    case 11: return polygon(300,240,244,191,8,wood)+rep(6,n=>{const a=n*Math.PI/3;return bottleSlot(300+142*Math.cos(a),240+120*Math.sin(a),34,48)})+bottleSlot(300,240,36,53)+e(300,240,50,63,'none','#A99F77',4)
    case 12: return p('M48 112L134 62 219 112 300 61 382 112 465 62 551 112V393H48Z',wood)+pipe('M64 245H537M219 122V380M382 121V380',wood,11)+rep(6,n=>bottleSlot(137+n%3*162,179+Math.floor(n/3)*142,42,47))+r(40,133,28,231,iron,4)+r(531,133,28,231,iron,4)
    case 13: return p('M47 236L158 71 300 115 442 71 553 236 484 404 300 370 115 404Z',wood)+pipe('M85 240Q299 162 517 240M93 320Q300 241 507 320','#A69970',10)+rep(6,n=>bottleSlot(158+n%3*143,178+Math.floor(n/3)*137,36,48))+p('M121 132l16 12m343-12-16 12','none','#C2B68E',4)
    case 14: return p('M300 49Q382 58 396 131Q489 104 528 184Q562 264 475 308Q504 392 411 421Q329 441 300 365Q270 441 184 420Q95 390 125 307Q38 262 73 182Q112 103 206 132Q220 57 300 49Z',wood)+rep(5,n=>{const a=n*2*Math.PI/5-Math.PI/2;return bottleSlot(300+139*Math.cos(a),240+132*Math.sin(a),36,49)})+e(300,240,32,29,wood)
    case 15: return p('M58 240Q72 78 300 75Q528 76 544 240Q528 409 300 407Q72 411 58 240Z',wood)+rep(8,n=>bottleSlot(136+n%4*109,176+Math.floor(n/4)*135,n%3===0?36:29,n%3===0?57:48))+pipe('M78 245H523',wood,10)+e(87,242,24,42,wood)+e(514,242,24,42,wood)
    case 16: return heatPlate(47,88,506,303)+rep(12,n=>r(60+n%6*82,101+Math.floor(n/6)*143,72,134,'#4E624A',3,'#A7B195',3)+lyingBottle(96+n%6*82,187+Math.floor(n/6)*143,.81))+bolts(56,97,488,285)
    case 17: return pipe('M61 115H539V369H61Z','#9DA88B',9)+rep(10,n=>{const x=111+n%5*96+(Math.floor(n/5)?29:0),y=182+Math.floor(n/5)*120;return polygon(x,y,49,64,6,'#5A7051')+polygon(x,y,44,57,6,'none')+lyingBottle(x,y+12,.8)})
    case 18: return e(300,240,225,192,iron)+rep(6,n=>{const a=n*Math.PI/3;return pipe(`M300 240Q${300+95*Math.cos(a-.5)} ${240+95*Math.sin(a-.5)} ${300+166*Math.cos(a)} ${240+145*Math.sin(a)}`,'#A1AA8B',13)+g(bottleSlot(0,0,35,55),`translate(${300+169*Math.cos(a)} ${240+143*Math.sin(a)}) rotate(${n*60+90})`)})+e(300,240,34,31,copper)
    case 19: return p('M43 141H106V102H162V74H440V102H495V141H557V342H495V380H440V409H162V380H106V342H43Z',wood)+pipe('M173 240H426','#A3A586',11)+rep(8,n=>bottleSlot(137+n%4*109,171+Math.floor(n/4)*147,33,51))+brassRail('M58 145V337M540 145V337')
    case 20: return pipe('M62 96H539V385H62Z','#A1AA8F',13)+rep(8,n=>bottleSlot(126+n%4*116,172+Math.floor(n/4)*145,34,51))+pipe('M43 141V338M557 141V338M43 153H62M43 325H62M539 153H557M539 325H557','#A4AF93',9)+[64,536].map(x=>[88,388].map(y=>r(x-14,y-13,28,26,'#4C5F45',9)+r(x-5,y-17,10,34,iron,3)).join('')).join('')
    case 21: return r(43,83,514,316,wood,9)+rep(8,n=>bottleSlot(126+n%4*116,171+Math.floor(n/4)*145,35,49))+r(60,101,480,278,'#9AB09A',7,'#AFA77F',6)+p('M73 110l208 258M158 110l207 258','none','#BACDB5',2)+p('M300 112V367M73 241H527','none','#7D8D6E',4)
    case 22: return r(41,152,518,177,iron,7)+rep(10,n=>bottleSlot(86+n%5*105,199+Math.floor(n/5)*89,28,34))+pipe('M52 155H546M52 327H546','#AEB497',8)+rep(3,n=>polygon(77+n*224,143,11,11,6,'#3F583D'))
    case 23: return board(43,79,514,327)+rep(3,n=>r(61+n*166,99,146,279,'#505E43',4)+rep(3,k=>lyingBottle(91+n*166+k*45,289,.92,-17))+pipe(`M${61+n*166} 298l143-135`,wood,8))+pipe('M56 387H547',wood,15)
    default: throw new Error('未知厨房酒架构造。')
  }
}

const staveVat = (x:number,y:number,rx:number,ry:number,liquid='#7B7750') => e(x,y,rx,ry,wood)+e(x,y,rx-13,ry-13,'none','#606B4E',9)+e(x,y,rx-27,ry-27,'#746D4D','#B7A37B',3)+e(x,y,rx-39,ry-39,liquid,'#4F6446',3)+rep(18,n=>{const a=n*Math.PI/9;return p(`M${x+(rx-25)*Math.cos(a)} ${y+(ry-25)*Math.sin(a)}L${x+(rx-2)*Math.cos(a)} ${y+(ry-2)*Math.sin(a)}`,'none','#5C573E',2)})+p(`M${x-rx*.48} ${y-ry*.46}q${rx*.5} ${-ry*.13} ${rx*.98} 0`, 'none','#B7AD7F',2)
const sealedTank = (x:number,y:number,rx:number,ry:number,fill=copper) => e(x,y,rx,ry,fill)+e(x,y,rx-18,ry-18,'none','#C3B891',3)+rep(16,n=>{const a=n*Math.PI/8;return bolt(x+(rx-9)*Math.cos(a),y+(ry-9)*Math.sin(a))})+e(x+rx*.19,y-ry*.1,rx*.28,ry*.28,fill)+pipe(`M${x+rx*.08} ${y-ry*.1}h${rx*.22}`,'#C8BE9A',7)
const valve = (x:number,y:number,s=1) => g(e(0,0,24,24,'none','#506647',7)+e(0,0,24,24,'none','#A6B28F',4)+p('M-21 0H21M0-21V21','none','#8B9A77',5)+e(0,0,7,7,iron),`translate(${x} ${y}) scale(${s})`)
function brew(i:number):string {
  switch(i) {
    case 0: return staveVat(300,240,228,195)+specks(300,241,173,140,90,'#BAAC78')+pipe('M81 257H54M522 257H551',iron,14)
    case 1: return staveVat(300,239,247,177,'#908154')+pipe('M100 359L501 117',wood,19)+p('M83 356l34 22 43-25-35-22Z',wood)+pipe('M530 273H569V321',wood,18)+specks(300,239,184,112,75,'#BBAD77')
    case 2: return e(300,241,227,191,copper)+e(300,241,197,162,'#726B43','#CAB58A',4)+p('M118 158Q300 45 482 159V243Q300 200 118 243Z',copper)+pipe('M259 137q40-35 81 0','#C7B48A',10)+pipe('M72 187H42V296H72M526 187H556V296H526','#A99164',15)+specks(300,300,161,87,40,'#AD9B68')
    case 3: return stoneSlab(45,79,510,326)+basin(62,96,225,291,7)+basin(306,96,231,291,7)+r(295,211,20,49,'#718560',2)+p('M541 263h29v44','none','#A0AA83',19)+p('M79 109l181 253m67-228 185 224','none','#8B9773',2)
    case 4: return board(66,90,67,302)+board(467,90,67,302)+g(cask(0,0,2.15),'translate(300 240)')+pipe('M153 78Q110 239 153 403M447 78Q490 240 447 403',iron,12)+e(300,240,17,15,wood)
    case 5: return staveVat(183,240,143,173)+staveVat(433,240,115,147)+r(298,189,49,101,wood,8)+r(306,206,33,67,'#665F3F',4)+pipe('M539 280H568V321',wood,13)+pipe('M171 70l14-26M421 95l4-26',wood,10)
    case 6: return staveVat(300,240,225,190,'#7C7050')+pipe('M83 73V410M518 73V410',wood,22)+board(79,203,441,78)+e(300,242,45,42,wood)+e(300,242,24,22,iron)+pipe('M300 196V287','#B4A582',10)+pipe('M68 411H533',wood,17)
    case 7: return p('M100 200Q99 68 300 62Q501 69 501 200Q520 395 300 418Q81 395 100 200Z','#B29A77')+p('M135 207Q126 99 300 93Q470 102 466 208M137 330Q303 400 464 329','none','#CBB48B',3)+e(300,190,89,76,'#71674A','#CBB58A',12)+e(300,190,64,52,wood)+pipe('M104 143Q29 150 56 266L104 296M498 143Q573 150 546 266L499 296','#AC9570',19)+specks(300,276,149,102,65)
    case 8: return p('M300 49Q445 53 471 198Q560 282 477 387Q397 435 300 365Q205 435 124 385Q42 281 131 198Q158 51 300 49Z',wood)+p('M300 91Q397 90 427 220Q494 277 445 350Q374 390 300 318Q220 392 154 350Q104 280 173 220Q200 89 300 91Z','#81906A','#BDAD82',4)+pipe('M300 76V337M300 281L151 350M300 281L450 350','#B0A47C',5)+pipe('M300 364V424','#A2A680',15)
    case 9: return polygon(300,240,250,194,6,copper)+polygon(300,240,218,166,6,'#A18F65')+rep(6,n=>{const a=n*Math.PI/3;return pipe(`M300 240L${300+235*Math.cos(a)} ${240+179*Math.sin(a)}`,'#897E5B',9)})+polygon(300,240,69,58,6,iron)+rep(12,n=>{const a=n*Math.PI/6;return bolt(300+201*Math.cos(a),240+153*Math.sin(a))})
    case 10: return staveVat(300,241,246,179,'#7E7350')+pipe('M91 109Q64 245 95 372M504 105Q537 243 503 372','#BDB089',18)+pipe('M105 145L491 340M108 341L488 147','#A29671',9)+e(300,241,21,20,wood)+p('M98 168l19 7m-24 42 23 5m383-42 22-6m-16 43 22-4','none','#7C7452',3)
    case 11: return pipe('M185 152L413 151 300 359Z','#B6A980',13)+[185,413].map(x=>sealedTank(x,162,107,107)).join('')+sealedTank(300,346,104,98)+pipe('M185 182L300 279 413 182','#B6A980',11)+valve(300,238,.68)
    case 12: return p('M299 53L546 238 451 407H149L54 238Z',stone)+p('M300 91L503 242 422 378H178L97 242Z','#7A8C6C','#B8C0A0',4)+[171,300,429].map(x=>pipe(`M${x-76} ${x===300?89:173}L${x+69} 378`,'#A7AB8B',9)).join('')+pipe('M99 294H34V354','#A4AA85',14)
    case 13: return sealedTank(300,241,228,187,copper)+rep(8,n=>{const a=n*Math.PI/4;return p(`M300 241Q${300+112*Math.cos(a-.3)} ${241+112*Math.sin(a-.3)} ${300+206*Math.cos(a)} ${241+167*Math.sin(a)}`,'none','#786D4E',4)})+pipe('M76 174Q27 168 43 268L79 298M523 174Q572 168 557 268L522 298','#BCA67B',17)+e(357,150,37,34,iron)+valve(357,150,.57)
    case 14: return p('M56 242Q153 61 300 88Q456 61 545 242Q456 417 300 390Q150 416 56 242Z','#A9B08C')+p('M81 242Q300 152 521 242Q300 330 81 242Z','#83976C','#C4C4A0',4)+e(300,242,53,48,ceramic)+e(300,242,30,27,wood)+pipe('M524 241H566V288','#A6AE83',13)
    case 15: return staveVat(215,240,175,184,'#9B8C59')+staveVat(432,240,126,150,'#8C8051')+pipe('M220 78Q332 48 428 104',wood,14)+r(317,212,36,64,wood,6)+r(327,226,18,36,'#5D6040',3)+p('M98 361l168-25','none','#B09C70',15)+e(106,360,22,19,wood)
    case 16: return sealedTank(280,241,219,192,copper)+pipe('M493 212H551V335','#B5A47B',17)+e(238,191,49,44,copper)+e(238,191,34,30,'none','#DDCAA0',2)+valve(543,278,.75)+p('M100 282Q282 392 460 281','none','#877651',3)
    case 17: return sealedTank(300,241,227,192,iron)+e(300,241,167,140,'none','#9CA98B',3)+e(300,241,65,58,iron)+rep(3,n=>{const a=n*Math.PI*2/3;return r(300+222*Math.cos(a)-16,241+188*Math.sin(a)-15,32,30,iron,5)+bolt(300+222*Math.cos(a),241+188*Math.sin(a))})+pipe('M391 90V57H447','#B0B79A',13)
    case 18: return r(43,82,513,321,ceramic,34)+r(66,105,467,276,'#7D8E72',23,'#AEBCA1',4)+p('M90 139q191-35 417 0M80 328q227 37 428 0','none','#9BAA82',2)+pipe('M43 202H24V275M555 202H577V275','#A5B495',14)+specks(300,243,199,111,70,'#B8B68B')
    case 19: return sealedTank(216,252,166,167,copper)+pipe('M260 111Q360 30 436 111V199','#BCA57A',25)+sealedTank(458,297,96,113,iron)+pipe('M458 205V145','#AFA581',17)+valve(436,115,.66)+e(184,242,38,35,copper)
    case 20: return sealedTank(179,239,130,171,iron)+sealedTank(423,239,130,171,iron)+pipe('M180 101H423M179 366H423','#AEAF91',18)+valve(299,101,.78)+valve(299,366,.78)+pipe('M551 255H572V304','#A5AD8E',13)
    case 21: return e(300,241,211,190,ceramic)+e(300,241,174,157,'none','#A9B99E',4)+e(300,241,85,76,iron)+e(300,241,67,59,ceramic)+pipe('M269 242h62','#A5B497',10)+pipe('M89 167Q33 170 53 290L90 319M510 167Q567 170 547 290L510 319','#A0AD90',17)+rep(6,n=>bolt(300+91*Math.cos(n*Math.PI/3),241+81*Math.sin(n*Math.PI/3)))
    case 22: return r(43,87,514,307,copper,18)+r(64,108,472,264,'#9E9468',11,'#D2C096',3)+p(rep(12,n=>`M${83+n*40} 120v241 `),'none','#7A805D',4)+p(rep(12,n=>`M${85+n*40} 121v239 `),'none','#B9AE7C',1.4)+pipe('M548 354H574V410','#AD9F74',15)+valve(571,381,.6)
    case 23: return sealedTank(300,241,224,188,iron)+pipe('M94 323H53V130','#ADAF8F',21)+pipe('M520 173H562V357','#ADAF8F',21)+[201,300,399].map((x,n)=>valve(x,n===1?157:266,.9)).join('')+p('M300 76v73M92 241h82M427 241h88','none','#AEB494',8)+bolts(158,98,284,283)
    default: throw new Error('未知厨房酿造器构造。')
  }
}

function pot(i:number):string {
  switch(i) {
    case 0: return pipe('M111 175Q46 157 48 239Q47 318 111 302M489 175Q553 157 552 239Q555 317 489 302','#858B72',18)+e(300,240,196,180,iron)+e(300,240,171,153,'#4E5B46','#ADB59B',3)+p('M140 148Q300 63 460 148V242Q300 211 140 242Z',iron)+pipe('M272 141q30-24 58 0','#B1B49A',9)
    case 1: return pipe('M333 238H552','#7E8770',29)+r(515,221,56,35,iron,15)+e(545,239,9,9,'#3D4D3B','#9EAC8F',3)+e(216,239,178,177,iron)+e(216,239,151,149,'#4B5944','#899879',3)+specks(216,239,127,126,65,'#8C9777')
    case 2: return pipe('M110 172Q46 165 48 239Q48 310 110 307M490 172Q554 165 552 239Q552 310 490 307','#B19B76',22)+e(300,240,199,175,'#A18B66')+e(300,240,175,151,'#6B7151','#C7B28A',5)+e(300,240,147,125,'#7C7B53','#57684A',2)+p('M166 142q138-46 267 0','none','#D3BB92',2)
    case 3: return pipe('M81 172H44V308H81M519 172H556V308H519','#A9B198',15)+r(82,92,437,296,iron,35)+r(105,113,391,250,'#6C7B60',20,'#BEC5A9',4)+r(120,130,361,217,'none',17,'#4A6146',3)+bolts(92,122,416,235)
    case 4: return p('M41 241Q162 67 300 92Q441 65 560 241Q445 417 300 390Q155 417 41 241Z',copper)+p('M89 241Q300 126 515 241Q300 354 89 241Z','#9C9B6A','#D5C196',4)+pipe('M74 241H31','#A0A27D',13)+p('M300 114V366M95 242H507','none','#8E895F',4)
    case 5: return polygon(300,240,219,185,6,iron)+polygon(300,240,190,158,6,'#737E60')+pipe('M101 180H56V300H101M499 180H543V300H499','#ADB197',17)+polygon(300,240,150,122,6,iron)+pipe('M272 239h56','#B5B59C',11)+rep(6,n=>{const a=n*Math.PI/3;return bolt(300+184*Math.cos(a),240+154*Math.sin(a))})
    case 6: return pipe('M112 173Q54 172 57 240Q55 311 111 306M489 173Q547 172 544 240Q547 311 489 306','#71816B',18)+e(300,240,193,178,ceramic)+e(300,240,172,155,'#687F67','#AEBBA0',8)+e(300,240,148,133,'#8B9D7E','#5D795B',2)+p('M175 148q129-34 248 0','none','#DCE0C7',3)
    case 7: return pipe('M107 180H56V301H107M493 180H544V301H493','#A6B196',17)+e(300,241,196,181,iron)+e(300,241,176,160,'#69836C','#C7D0B6',3)+p('M146 159Q300 57 454 159V251Q301 220 146 251Z','#A6B39A')+e(300,161,22,19,'#727F66','#C5CEB2',2)+p('M144 278q160 48 313 0','none','#99B49A',2)
    default: throw new Error('未知厨房锅具构造。')
  }
}

const spoon = (x:number,y:number,s=1,a=0) => g(pipe('M0-69V42','#B2A37B',8)+e(0,-79,16,24,wood,'#766E4D',2),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const plate = (x:number,y:number,rx:number,ry=rx,fill=ceramic) => e(x,y,rx,ry,fill)+e(x,y,rx*.8,ry*.78,'none','#8FA48B',3)+e(x,y,rx*.68,ry*.65,'none','#C3CDB3',1.8)
const tankard = (x:number,y:number,s=1) => g(pipe('M51-41Q110-47 109 7Q110 59 51 54',wood,15)+e(0,0,65,74,wood)+e(0,0,49,57,'#675E3F','#B7A779',3)+e(0,0,37,43,'#81764A','#4F6342',2)+p('M-59-30H59M-61 31H61','none','#697453',5),`translate(${x} ${y}) scale(${s})`)
function tableware(i:number):string {
  switch(i) {
    case 0: return board(53,98,363,290,119)+e(237,242,150,112,'#917C54','#C3AD80',2)+grain(100,165,272,150,8)+spoon(491,249,1.3,-14)+tankard(448,104,.6)
    case 1: return plate(272,245,165,173,iron)+p('M70 83H99V287L86 343H69Z','#9FA88D')+r(67,344,34,73,wood,6)+spoon(502,260,1.7,0)+p('M174 107q94-39 193 0','none','#C9D0B2',2)
    case 2: return bowl(204,229,151,164,'#AF9872')+bowl(439,157,93,102,'#927D5A')+bowl(438,353,76,82,'#B6A17B')+p('M137 112q53-29 109 0m133 2q57-18 110 0','none','#D1BA8E',2)
    case 3: return tankard(171,257,1.5)+tankard(431,234,1.23)+specks(171,256,49,65,23,'#C0A56A')+specks(431,232,40,53,18,'#C0A56A')
    case 4: return g(leafSurface(ceramic),'translate(20 12) scale(.68 .92)')+p('M210 132V354M102 245H331','none','#9DAD81',3)+bowl(473,142,67,76,'#B4BE9A')+bowl(470,332,68,72,'#A0AD83')+pipe('M393 415L383 162M368 179l11-32 14 28 10-32','#8E9F71',7)
    case 5: return polygon(255,241,181,171,6,iron)+polygon(255,241,148,137,6,'#8A9878')+polygon(255,241,121,110,6,'none')+tankard(469,142,.84)+spoon(486,341,.84,0)+rep(6,n=>{const a=n*Math.PI/3;return bolt(255+159*Math.cos(a),241+151*Math.sin(a))})
    case 6: return plate(267,245,162,170)+plate(478,139,66,69)+pipe('M65 128V389','#ADB89B',9)+p('M45 64V125H85V64M59 65V123M72 65V123','none','#B9C1A6',6)+p('M477 244H502V365H479Z',iron)+r(478,365,28,67,'#6C7D60',6)+p('M145 149q121-58 240 0','none','#D7DEC6',2)
    case 7: return plate(299,246,250,182,iron)+plate(133,264,65,66)+plate(465,264,65,66)+bowl(130,253,39,39)+bowl(462,253,39,39)+e(295,240,93,107,ceramic)+e(295,240,44,49,ceramic)+pipe('M274 239h41','#A4B294',7)+pipe('M209 205Q155 200 183 270L210 285','#ADB99B',10)+p('M385 211l31-29v54l-31 28Z',ceramic)
    default: throw new Error('未知厨房餐具构造。')
  }
}

const carrot = (x:number,y:number,s=1,a=0) => g(p('M-21-45Q0-57 21-45L7 65Q0 78-7 64Z','#A99057','#716E45',2)+p('M0-43V-85M0-48L-30-73M0-50L29-74','none','#738B53',8)+p('M-12-14l16 4m-15 21 12 4m-10 18 10 3','none','#D0B474',1.5),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const mushroom = (x:number,y:number,s=1,fill='#A39A74') => g(p('M-11-8L-18 67Q0 79 18 66L10-8Z','#C2B28B','#7D7F58',2)+p('M-57-3Q-58-68 0-76Q62-69 59-3Q5 25-57-3Z',fill)+p('M-49 1Q0 25 50 2','none','#D4C69D',3)+p('M-32-18l5-3m29-31 5 1m21 31 5-1','none','#D2C49A',4),`translate(${x} ${y}) scale(${s})`)
const fish = (x:number,y:number,s=1,a=0) => g(p('M-109 0L-161-56-147 0-161 56Z','#829888')+p('M-114 0Q-51-75 58-58L126-13 141 0 126 13 58 58Q-54 75-114 0Z','#9DAB96')+p('M-62-38L-29-85 3-56M-35 58l46 26 17-28','none','#6C8A74',7)+p('M82-35Q62 0 83 37M-98 0H86','none','#6D8971',3)+e(116,-8,6,6,'#374D3D','#C7D0B6',2)+p(rep(8,n=>`M${-75+n*20}-30q15 30 0 60 `),'none','#B7C4AA',1.2),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
function food(i:number):string {
  switch(i) {
    case 0: return board(41,72,518,337,57)+p('M93 255Q61 117 239 95Q380 105 358 256Q256 327 93 255Z','#A68B58','#776A42',3)+p('M111 169l76-36m-45 79 89-51m-18 69 77-42','none','#D0B57B',8)+[0,1,2].map(n=>p(`M${351+n*39} ${171+n*43}q62-15 91 18l-15 62-76-12Z`,'#C7B17D','#8B784F',3)+p(`M${370+n*39} ${195+n*43}l48 8`,'none','#9E8C5D',1.3)).join('')+specks(233,208,112,72,40,'#E0C391')
    case 1: return bowl(271,248,199,173,'#AE9472')+e(271,248,146,122,'#7F7950','#605F40',2)+rep(16,n=>{const a=n*2.4,b=Math.sqrt((n+.5)/16);return r(271+Math.cos(a)*112*b-10,248+Math.sin(a)*90*b-9,20+n%3*3,18+n%4,['#A99962','#809365','#B5A272','#6E875D'][n%4],5,'#6E7650',1.3)})+spoon(453,253,1.65,24)
    case 2: return board(42,97,516,290,41)+fish(307,170,1.06,-6)+fish(309,318,.9,10)+p('M79 119l22 11m392 211 30 8','none','#CDB58A',1.4)
    case 3: return plate(300,242,248,179,wood)+carrot(190,229,1.18,-31)+carrot(287,286,1.15,25)+e(411,229,98,106,'#7A915E','#506F4C',3)+rep(7,n=>e(411+Math.cos(n*2.4)*n*6,229+Math.sin(n*2.4)*n*7,42+n*2,38+n*3,'none',n%2?'#ABB286':'#536F4B',2))+p('M100 300Q145 252 195 306L177 355 121 345Z','#B7A87A','#7C8356',2)
    case 4: return plate(300,243,246,180,wood)+mushroom(163,202,1.15)+mushroom(320,178,.82,'#9D8B6B')+mushroom(443,255,1.15,'#A7AA7D')+p('M199 300L267 270 324 318 269 388Z','#7F9768','#506F4A',3)+p('M199 300L269 336 267 270M269 336L324 318M269 336V388','none','#A7B18A',2)+p('M94 331L158 306 196 344 144 388Z','#95A77B','#506F4A',3)+p('M99 332l47 19 12-41','none','#C3C6A0',2)
    case 5: return plate(300,243,245,177,wood)+polygon(190,223,102,89,6,'#AF995E')+rep(12,n=>{const x=129+n%4*39,y=169+Math.floor(n/4)*39;return polygon(x,y,20,22,6,n%3?'#BAA76B':'#8D874F')})+e(430,202,82,72,'#AA9B6A','#737848',3)+p('M430 132v140','none','#D0BB86',3)+e(423,201,35,28,'#797F4A','#C5B383',3)+e(325,339,64,55,'#9A875B','#D0B78A',6)+e(325,339,45,37,'#A49457','#746E42',2)+spoon(473,351,.65,-48)
    case 6: return plate(299,244,245,179)+p('M111 135L238 124 264 259 126 272Z','#A99466','#786E45',3)+p('M125 146L226 139 246 243 139 254Z','#C9B582','#AC966A',2)+p('M125 291L253 268 285 370 149 389Z','#B6A173','#786E45',3)+p('M274 163Q316 119 352 154Q402 131 419 180Q452 218 411 242Q388 283 346 250Q300 279 278 240Q243 214 274 163Z','#D4D1AF','#B2B691',2)+e(345,202,40,35,'#C4A455','#A78D45',2)+[465,422].map((x,n)=>e(x,319+n*14,27,29,'#A7815E','#856E45',2)+p(`M${x-12} ${304+n*14}l12 6 11-6`,'none','#6E8B55',3)).join('')
    case 7: return r(44,86,512,309,iron,25)+r(61,103,478,275,'#9EAB90',18,'#C5CFB2',3)+e(164,180,76,58,'#AF9868','#7A7248',3)+e(164,180,37,28,'#8E7D4E','#D1BC87',3)+p('M330 119Q381 127 408 188L355 212 301 161Z','#B7A273','#7F784B',3)+p('M315 134l49 61m-29-69 48 62','none','#D8C393',3)+p('M111 279H243V350H111Z','#A2926A','#736C46',3)+p('M115 300H238M115 328H238','none','#D5C395',6)+p('M356 259L480 284 430 357 335 332Z','#A58D62','#6D6F45',3)+p('M368 275l89 20m-109 21 86 23','none','#D2B786',3)
    default: throw new Error('未知厨房食物构造。')
  }
}

const glassBody = (cx:number,cy:number,rx:number,ry:number) => e(cx,cy,rx,ry,'#879F83','#405E46',3)+e(cx,cy,rx*.8,ry*.8,'none','#B9C8A8',3)+p(`M${cx-rx*.6} ${cy-ry*.4}q${rx*.1} ${-ry*.27} ${rx*.43} ${-ry*.31}`,'none','#D0DAC0',5)
function bottle(i:number):string {
  switch(i) {
    case 0: return pipe('M123 146Q38 131 45 241Q40 351 123 334M477 146Q562 131 555 241Q562 350 477 334','#AC9670',22)+e(300,241,186,181,'#AC9470')+e(300,241,152,145,'none','#C7B38B',3)+e(300,211,72,67,'#746E4A','#C9B58C',9)+e(300,211,46,43,wood)+specks(300,294,121,73,40)
    case 1: return pipe('M443 151Q554 114 554 238Q557 355 442 324','#AA9570',24)+e(280,240,193,181,'#AA9672')+p('M147 117L86 67 82 144 128 182Z','#AA9672')+e(280,240,154,142,'#82906A','#C9B58C',5)+e(280,240,128,116,'#78815B','#5B7252',2)+p('M155 147q108-48 213-4','none','#D1C29D',2)
    case 2: return p('M76 247Q58 113 235 87L241 44H347L354 91Q526 112 525 248Q513 393 301 417Q88 398 76 247Z','#9D8961')+p('M101 246Q93 137 254 113M508 246Q500 371 301 392Q113 379 101 246','none','#C0AC81',4)+p(rep(27,n=>{const a=n*2*Math.PI/27;return `M${301+206*Math.cos(a)} ${249+154*Math.sin(a)}l${-3*Math.cos(a)} ${-3*Math.sin(a)} `}),'none','#655C3D',3)+r(247,39,94,52,wood,8)+pipe('M344 71Q420 30 446 80Q466 139 396 139','#A69E74',9)
    case 3: return glassBody(300,240,200,184)+e(300,240,182,166,'none','#B5A67D',12)+p(rep(17,n=>{const a=n*Math.PI/8.5;return `M${300+144*Math.cos(a)} ${240+130*Math.sin(a)}L${300+194*Math.cos(a+.08)} ${240+177*Math.sin(a+.08)} `}),'none','#998E64',8)+e(300,212,67,60,'#7E987A','#CBD0B0',6)+e(300,212,42,37,wood)+p('M169 137q126-57 256 0','none','#D2D4B5',2)
    case 4: return p('M300 51Q423 69 406 170Q541 207 479 346Q423 426 300 363Q173 428 118 345Q60 205 197 168Q178 70 300 51Z','#91A984','#4D7051',3)+p('M300 79V342M218 195l82 37 84-37M147 299l153-67 151 67','none','#B7C49D',3)+e(300,211,62,55,'#A6B996','#4D7351',5)+e(300,211,33,31,wood)+specks(300,300,110,47,30,'#C4D0AC')
    case 5: return polygon(300,240,218,190,6,'#8B9D80')+polygon(300,240,181,157,6,'#A8B493')+p('M300 51V427M114 145L485 334M114 334L485 145','none','#6E8969',4)+polygon(300,210,82,71,6,iron)+polygon(300,210,48,42,6,wood)+rep(6,n=>{const a=n*Math.PI/3;return bolt(300+89*Math.cos(a),210+78*Math.sin(a))})
    case 6: return glassBody(174,256,122,151)+glassBody(428,220,117,147)+e(174,224,51,60,'#697F60','#B4C1A0',5)+e(428,191,48,55,'#617F61','#B4C1A0',5)+r(150,178,48,69,ceramic,13)+r(405,148,46,68,ceramic,13)+pipe('M126 204H222V253H126M381 173H475V220H381','#8D9A7A',5)+p('M82 304q89 39 181 0m91-39q83 37 165 0','none','#C9C9AA',4)
    case 7: return glassBody(285,252,184,175)+e(285,252,148,141,'none','#BDD0AF',3)+r(204,144,164,167,iron,45)+e(285,224,53,55,'#ACB99B','#4A6B4D',4)+pipe('M284 222H449V272','#B2BCA0',19)+pipe('M358 174Q434 136 478 199L475 266','#889E7F',13)+e(452,273,16,12,'#46674C','#BBC5A7',4)+p('M135 210q16-61 55-72','none','#D7E0C4',5)
    default: throw new Error('未知厨房饮瓶构造。')
  }
}

export const KITCHEN_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Kitchen-Collection-1'
export const KITCHEN_COLLECTION_LICENSE = `Sceneweave Kitchen Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG drawings of kitchens, dining and brewing equipment, authored with coding assistance. No third-party artwork or pixels are embedded. These are illustrative period and fantasy interpretations; technical checks and visual acceptance are separate.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const defs = `<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="80%" y2="100%"><stop offset="0%" stop-color="#B3A17B"/><stop offset="43%" stop-color="#98845E"/><stop offset="100%" stop-color="#76684A"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#B2B49C"/><stop offset="38%" stop-color="#9CA48C"/><stop offset="100%" stop-color="#6F8068"/></linearGradient>
<linearGradient id="iron" x1="0%" y1="0%" x2="40%" y2="100%"><stop offset="0%" stop-color="#969E89"/><stop offset="24%" stop-color="#7B8870"/><stop offset="100%" stop-color="#4B5C49"/></linearGradient>
<linearGradient id="copper" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#C1AC7E"/><stop offset="32%" stop-color="#B59B69"/><stop offset="70%" stop-color="#8D835A"/><stop offset="100%" stop-color="#747956"/></linearGradient>
<linearGradient id="ceramic" x1="0%" y1="0%" x2="60%" y2="100%"><stop offset="0%" stop-color="#DEE0C9"/><stop offset="45%" stop-color="#CCD2B8"/><stop offset="100%" stop-color="#A7B698"/></linearGradient>
</defs>`
function artwork(design:KitchenDesign,index:number):VisualSampleArt {
  const detail=['pot','tableware','food','bottle'].includes(design.category)
  const draw = ({ stove, oven, 'prep-counter':prep, sink, 'bar-counter':barCounter, 'wine-rack':wineRack, 'brew-vessel':brew, pot, tableware, food, bottle })[design.category]
  return { key:design.key, name:design.name, kind:'prop', widthMm:design.widthMm, heightMm:design.heightMm,
    sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm/600} ${design.heightMm/480})">${draw(index)}</g></svg>`,
    footprintMm:{width:Math.round(design.widthMm*.9),height:Math.round(design.heightMm*.9)},blocksMovement:!detail,blocksSight:false,
    renderLayer:'object',shadowClass:detail?'none':'furniture',tags:['原创','厨房餐饮酿造',design.category,design.era,design.design,'俯视','独立物件'] }
}
export const KITCHEN_COLLECTION_ART:readonly VisualSampleArt[] = freezeJson(KITCHEN_DESIGNS.map(design=>artwork(design,KITCHEN_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
