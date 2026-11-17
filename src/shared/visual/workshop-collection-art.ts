import { WORKSHOP_DESIGNS, type WorkshopDesign } from '../assets/workshop-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

const ink='#403C32',wood='url(#wood)',iron='url(#iron)',stone='url(#stone)',leather='url(#leather)',cloth='url(#cloth)'
const rep=(n:number,draw:(i:number)=>string)=>Array.from({length:n},(_,i)=>draw(i)).join('')
const p=(d:string,fill='none',stroke=ink,sw=2.2)=>`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
const r=(x:number,y:number,w:number,h:number,fill:string,rad=4,stroke=ink,sw=2.2)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const e=(x:number,y:number,rx:number,ry:number,fill:string,stroke=ink,sw=2.2)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g=(body:string,transform:string)=>`<g transform="${transform}">${body}</g>`
const num=(n:number)=>Math.round(n*100)/100
const line=(d:string,color='#9D967F',sw=8)=>p(d,'none','#45463A',sw+3)+p(d,'none',color,sw)+p(d,'none','#C7BEA5',.9)
const bolt=(x:number,y:number)=>e(x,y,3.5,3.5,'#A7A18C','#4D5345',.8)+p(`M${x-2} ${y}h4`,'none','#53594A',.8)
const bolts=(x:number,y:number,w:number,h:number)=>[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([a,b])=>bolt(a,b)).join('')
const poly=(x:number,y:number,rx:number,ry:number,n:number,fill:string)=>p(rep(n,i=>{const a=i*2*Math.PI/n-Math.PI/2;return`${i?'L':'M'}${num(x+rx*Math.cos(a))} ${num(y+ry*Math.sin(a))}`})+'Z',fill)
function spots(cx:number,cy:number,rx:number,ry:number,n=70,seed=3,color='#DBCAA5'):string {
  const strokes:Record<string,{d:string;color:string;width:number}>={}
  for(let i=0;i<n;i++){
    const a=(i+seed)*2.399963,s=Math.sqrt((i+.5)/n),x=cx+Math.cos(a)*rx*s,y=cy+Math.sin(a)*ry*s,c=i%5?color:'#544B3A',width=.6+i%3*.3,key=`${c}-${width}`
    const stroke=strokes[key]??={d:'',color:c,width};stroke.d+=`M${num(x)} ${num(y)}l${1+i%4} ${num((i%3-1)*.8)} `
  }
  return `<g opacity=".3">${Object.values(strokes).map(stroke=>p(stroke.d,'none',stroke.color,stroke.width)).join('')}</g>`
}
function plank(x:number,y:number,w:number,h:number,rad=6):string {
  const radius=Math.min(rad,w/2,h/2),inset=(dy:number)=>{const near=Math.min(dy,h-dy);return near<radius?radius-Math.sqrt(Math.max(0,radius*radius-(radius-near)**2))+6:6}
  return r(x,y,w,h,wood,rad)+`<g opacity=".47">${rep(18,i=>{const dy=10+(i+1)*(h-20)/19,m=inset(dy)+i%3;return p(`M${x+m} ${num(y+dy)}q${num((w-m*2)*.19)} ${i%3-1} ${num((w-m*2)*.47)} 0t${num((w-m*2)*.51)} 0`,'none',i%4?'#D3B78C':'#61513A',.7+i%3*.2)})}</g>`+p(`M${x+inset(5)} ${y+5}h${w-inset(5)*2}`,'none','#D1B78F',1.3)+spots(x+w/2,y+h/2,w*.38,h*.37,26,4)
}
const board=(x:number,y:number,w:number,h:number)=>plank(x,y,w,h)+p(`M${x+7} ${y+h*.34}h${w-14}M${x+7} ${y+h*.68}h${w-14}`,'none','#66543A',2)
const metal=(x:number,y:number,w:number,h:number,rad=7)=>r(x,y,w,h,iron,rad)+spots(x+w/2,y+h/2,w*.42,h*.4,65,2,'#C4C1A7')+p(`M${x+11} ${y+6}h${w-22}`,'none','#BBC1A7',1.6)+bolts(x+9,y+9,w-18,h-18)
const slab=(x:number,y:number,w:number,h:number)=>r(x,y,w,h,stone,10)+spots(x+w/2,y+h/2,w*.43,h*.4,90,7,'#C7C5AC')+p(`M${x+w*.23} ${y+6}l10 ${h*.21}-6 ${h*.19}M${x+w*.71} ${y+h*.48}l-9 ${h*.23} 4 ${h*.14}`,'none','#6D7564',1)
const feet=(x:number,y:number,w:number,h:number,fill=wood)=>[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([a,b])=>r(a-14,b-14,28,28,fill,3)+bolt(a,b)).join('')
const ring=(x:number,y:number,rx:number,ry=rx,fill=iron)=>e(x,y,rx,ry,fill)+e(x,y,rx-10,ry-10,'none','#ACB397',2)+spots(x,y,rx*.73,ry*.72,45,4,'#BFC2AA')
const wheel=(x:number,y:number,rx:number,ry=rx,n=8,fill=wood)=>e(x,y,rx,ry,'none','#514B38',12)+e(x,y,rx,ry,'none',fill,8)+rep(n,k=>{const a=k*Math.PI*2/n;return line(`M${x} ${y}L${num(x+(rx-5)*Math.cos(a))} ${num(y+(ry-5)*Math.sin(a))}`,'#97815B',6)})+e(x,y,15,14,iron)+bolt(x,y)
/** Edge-on vertical wheel: its narrow top silhouette is deliberate, not an isometric face. */
const edgeWheel=(x:number,y:number,rad:number,angle=0,fill=wood)=>g(e(0,0,16,rad,fill)+e(0,0,8,rad-5,'#545C49','#B0AE8B',2)+line('M-26 0H26','#AAA58B',9)+p(`M-10 ${-rad+11}v${rad*2-22}`,'none','#D1BE97',1),`translate(${x} ${y}) rotate(${angle})`)
const handwheel=(x:number,y:number,s=1)=>g(wheel(0,0,30,29,5,iron)+line('M20 20h24','#A29C80',6),`translate(${x} ${y}) scale(${s})`)
const vice=(x:number,y:number,s=1,a=0)=>g(metal(-35,-27,70,54,4)+r(-43,-45,86,22,'#92947C',4)+r(-42,28,84,18,'#666F5B',3)+line('M0 46V81M-32 78H32','#A3A58B',8),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const woodenVice=(x:number,y:number,s=1,a=0)=>g(plank(-49,-22,98,44,4)+plank(-49,34,98,25,3)+line('M0 21V87','#7C6848',11)+line('M-36 84H36','#AD9269',8),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const leaf=(fill=wood)=>p('M45 240Q163 56 300 87Q445 60 555 240Q443 419 300 392Q154 419 45 240Z',fill)+p('M76 240Q300 166 525 240M300 90V388','none','#9CA17A',4)
const pit=(x:number,y:number,rx:number,ry:number)=>e(x,y,rx,ry,'#45473B','#726D55',4)+rep(29,n=>{const a=n*2.4,s=Math.sqrt((n+.5)/29),cx=x+Math.cos(a)*rx*.85*s,cy=y+Math.sin(a)*ry*.82*s;return p(`M${num(cx-7)} ${num(cy-5)}l12-3 8 9-8 8-11-4Z`,n%5?'#5B5743':'#92724D','#393E31',1)})
const brick=(x:number,y:number,w:number,h:number)=>r(x,y,w,h,'#817F69',8)+rep(5,j=>rep(6,i=>{const bw=(w-10)/6,bh=(h-10)/5;return r(x+5+i*bw+1,y+5+j*bh+1,bw-3,bh-3,['#9B947A','#AAA082','#88876D'][(i+j)%3],3,'#696E58',1.3)}))
const grate=(x:number,y:number,w:number,h:number)=>metal(x,y,w,h,4)+p(rep(12,n=>`M${x+10+n*(w-20)/11} ${y+6}v${h-12} `),'none','#343D2F',5)+p(rep(12,n=>`M${x+11+n*(w-20)/11} ${y+7}v${h-14} `),'none','#A0A58A',1)

function workbench(i:number):string {
 switch(i){
  case 0:return feet(73,99,455,281)+board(48,77,504,326)+woodenVice(204,371,.8)+r(370,99,113,14,'#61543A',3)
  case 1:return feet(66,100,467,282)+slab(47,80,506,321)+p('M311 90l-15 146 12 151','none','#6B735E',3)+metal(78,137,153,177,6)+r(478,115,43,228,'#555F47',4)
  case 2:return p('M48 83H553V408H410Q394 250 299 250Q202 251 189 408H48Z',wood)+r(78,108,112,109,'#746A4C',5)+r(410,108,112,109,'#746A4C',5)+woodenVice(299,237,.45)+plank(237,99,126,94)
  case 3:return board(49,85,504,314)+ring(224,236,137,139,stone)+e(224,236,18,18,wood)+r(394,126,119,219,'#746A4A',10)+r(408,140,91,191,leather,5)
  case 4:return plank(46,87,509,311,91)+plank(76,111,449,30)+plank(76,344,449,30)+r(93,311,413,13,'#5C654A',5)+spots(300,241,181,82,75,9)
  case 5:return board(46,89,508,310)+e(300,245,123,114,'#4F5B43','#B5A67F',5)+line('M166 151Q298 80 435 153M163 334Q301 411 438 333','#9C9572',13)+woodenVice(86,244,.7,90)+woodenVice(514,244,.7,-90)
  case 6:return feet(66,92,470,300)+slab(48,76,505,328)+p('M145 124H454V362H145Z','#7F846B')+p('M154 132l61 61-60 25ZM445 352l-60-61 60-25Z',wood)+spots(300,242,125,86,80,4)
  case 7:return board(45,83,318,313)+board(370,83,185,313)+[147,320].map(y=>metal(355,y,23,40,3)).join('')+r(58,64,483,23,wood,3)+bolts(89,77,416,303)
  case 8:return leaf()+line('M123 227Q300 96 479 227','#8A7A53',12)+line('M139 245Q300 131 462 245','#B0A079',8)+woodenVice(295,353,.7)+spots(300,269,125,62,45)
  case 9:return poly(300,240,254,194,6,stone)+line('M300 50V428M80 143L519 335M81 336L519 143','#918E70',10)+vice(300,315,1.05)+rep(6,n=>{const a=n*Math.PI/3;return bolt(300+211*Math.cos(a),240+158*Math.sin(a))})
  case 10:return p('M63 95L204 63 340 91 493 68 547 125 514 365 402 416 254 383 79 414Z',wood)+line('M89 94Q32 245 91 399M501 94Q558 244 500 390','#C1AF86',22)+p('M107 146L488 365M488 146L109 365','none','#A18F68',5)+r(123,123,353,235,leather,22)+spots(300,242,149,97,85,7)
  case 11:return poly(300,240,245,192,8,wood)+ring(300,240,98,89,stone)+[148,452].map(x=>[151,330].map(y=>r(x-38,y-30,76,60,'#5F654B',7)+r(x-30,y-22,60,44,leather,5)).join('')).join('')+p('M234 240h132M300 178v122','none','#9D9B7A',2)
  case 12:return p('M49 106L134 59 218 106 300 57 382 106 467 59 551 106V396H49Z',wood)+r(122,176,356,133,'#656B50',13)+r(139,190,322,103,leather,9)+r(43,127,29,243,iron,4)+r(529,127,29,243,iron,4)+spots(300,235,140,36,45)
  case 13:return p('M43 232L157 68 300 126 443 68 557 232 476 412 300 346 125 412Z',wood)+vice(300,327,.75)+rep(6,n=>{const x=118+n*72;return r(x,147+(n%2)*32,35,47,iron,5)+bolt(x+18,170+(n%2)*32)})+p('M80 234L160 98 300 149 440 98 524 234','none','#C5AD84',2)
  case 14:return p('M300 48Q383 59 396 130Q492 104 530 184Q560 266 478 309Q505 396 409 422Q328 438 300 362Q269 441 185 421Q93 391 123 308Q39 262 73 183Q112 101 205 131Q221 58 300 48Z',wood)+ring(300,242,99,91,stone)+r(278,359,44,49,'#6A7051',5)+spots(300,241,66,58,55)
  case 15:return p('M54 243Q65 76 301 75Q537 78 547 243Q536 373 389 409L350 357H250L210 409Q63 371 54 243Z',wood)+e(88,245,43,62,wood)+e(513,245,43,62,wood)+woodenVice(205,338,.55)+woodenVice(398,338,.55)+spots(300,228,174,81,70)
  case 16:return feet(66,91,471,301,iron)+board(48,78,506,326)+vice(165,317,.88)+r(331,108,174,17,'#4C5941',4)+bolts(66,95,471,290)
  case 17:return p('M49 84H551V409H408Q393 267 300 264Q205 264 192 409H49Z',wood)+rep(3,n=>r(85+n*151,106,126,92,'#625D43',5)+r(95+n*151,116,106,72,leather,3))+vice(300,250,.45)
  case 18:return board(46,83,509,315)+r(85,122,430,226,'#4F5844',8)+spots(300,237,184,82,80,1,'#9F9C7A')+[100,500].map(x=>[141,326].map(y=>r(x-12,y-12,24,24,'#B29E72',3)+bolt(x,y)).join('')).join('')+r(114,355,372,21,iron,4)
  case 19:return board(45,67,510,350)+rep(7,j=>rep(8,k=>r(62+k*48,83+j*44,43,39,j%2?'#7C7052':'#71664A',2,'#B29D76',1)))+plank(451,83,85,316)+r(459,323,69,16,'#5B644A',3)
  case 20:return board(47,83,506,315)+[141,300,457].map((x,n)=>p(`M${x-39} 147Q${x} 108 ${x+37} 152L${x+28} 282Q${x} 324 ${x-26} 283Z`,wood)+e(x,199,8,9,'#5C644B')).join('')+woodenVice(299,363,.63)
  case 21:return feet(68,101,467,280,iron)+board(79,85,443,313)+line('M47 121V356M554 121V356M47 139H79M47 338H79M522 139H554M522 338H554','#9EA48B',9)+[67,535].map(x=>[87,393].map(y=>r(x-13,y-13,26,26,'#3F4D38',8)+r(x-5,y-17,10,34,iron,3)).join('')).join('')
  case 22:return feet(68,103,468,278,iron)+slab(47,85,507,311)+[140,300,460].map(x=>vice(x,272,.48)).join('')+line('M63 96H538V384H63Z','#A8A589',4)
  case 23:return board(42,64,516,355)+vice(183,123,.7,180)+vice(418,360,.7)+p(rep(10,n=>`M${91+n*46} 88v12M${91+n*46} 393v12 `),'none','#4C5841',6)+feet(59,82,482,319,iron)
  default:throw new Error('未知工坊工作台构造。')
 }
}

function anvil(i:number):string {
 const face=(d:string)=>p(d,iron)+spots(300,237,121,51,90,3,'#C9C8AE')+p('M223 186H377','none','#D2CDB4',2)
 const stump=()=>p('M93 154L165 79 272 64 418 88 510 166 527 286 449 393 321 416 184 389 83 311Z',wood)+e(300,239,167,135,'none','#C1A67D',2)+e(300,239,120,95,'none','#68553C',1.5)
 switch(i){
  case 0:return metal(199,96,226,289)+face('M66 242Q131 185 203 171H457L533 219V294H202Q124 287 66 242Z')+r(454,204,31,31,'#374534',2)
  case 1:return metal(207,107,187,271)+face('M42 240L197 162H404L560 241 404 313H197Z')+r(368,191,28,29,'#35442F',2)
  case 2:return metal(96,80,409,321,11)+metal(135,114,331,249,6)+r(378,140,48,44,'#34442D',2)+spots(300,242,135,91,110,2)
  case 3:return stump()+face('M111 194H489V263H329V338H270V263H111Z')+p('M146 196h309','none','#C3C5AC',2)+p('M270 326l-40 35 53-7Z',wood)
  case 4:return metal(227,120,148,242)+face('M33 241Q132 170 236 179H366Q464 172 567 241Q467 289 364 285H237Q134 290 33 241Z')
  case 5:return metal(65,75,471,332)+rep(8,n=>{const x=137+n%4*110,y=156+Math.floor(n/4)*165;return n%2?r(x-25,y-25,50,50,'#3E4A35',4):e(x,y,26,26,'#3D4934')})+p('M74 166h26m-26 155h26m412-155h24m-24 155h24','none','#3C4831',16)
  case 6:return line('M126 365L300 82 479 365M126 365H479','#8C7652',24)+ring(300,234,217,168,iron)+e(300,234,161,119,'none','#AEB7A0',2)+spots(300,234,150,107,95,4)
  case 7:return metal(216,104,171,275)+face('M43 241L225 176H376L558 241 376 285H224Z')+e(346,216,14,14,'#35452F')
  case 8:return leaf(iron)+p('M109 242Q300 148 492 242Q302 326 109 242Z','#9AA18B','#C0C7AD',2)+spots(300,240,142,51,80)+p('M115 243H489','none','#6D7860',2)
  case 9:return poly(300,240,224,187,6,iron)+p('M490 185L566 214V276L490 300Z',iron)+poly(300,240,174,144,6,'#8D9580')+rep(6,n=>{const a=n*Math.PI/3;return bolt(300+195*Math.cos(a),240+159*Math.sin(a))})+spots(300,239,129,100,100)
  case 10:return stump()+line('M115 120L482 362M482 118L118 364','#B5A780',18)+face('M62 257L173 158 372 162 537 209 565 263 399 317 181 296Z')+p('M508 230l-61 38','none','#C5CAB0',2)
  case 11:return poly(300,240,239,192,8,iron)+rep(8,n=>{const a=n*Math.PI/4;return e(300+150*Math.cos(a),240+119*Math.sin(a),14+n%3*5,15+n%3*4,'#34452F')})+e(300,240,70,58,'#8B947B','#BDC6A9',2)+spots(300,240,53,42,55)
  case 12:return p('M51 137L139 68 222 137 301 68 380 137 466 68 550 137V381H51Z',iron)+r(72,164,458,177,'#90987F',5)+r(49,174,24,158,iron,3)+r(527,174,24,158,iron,3)+spots(300,240,185,59,100)
  case 13:return metal(204,122,192,251)+face('M45 200L187 125 298 175 412 125 554 200 476 331 378 277H224L125 330Z')+p('M68 207L186 148 298 198 413 148 529 207','none','#BFC5AB',2)
  case 14:return p('M300 53Q382 64 394 141Q480 118 518 194Q540 269 466 307Q483 383 406 406Q332 427 300 353Q267 425 193 406Q119 382 135 308Q60 267 84 194Q120 116 205 141Q220 64 300 53Z',iron)+e(300,242,103,88,'#929A80','#BEC7A8',2)+spots(300,242,75,60,65)
  case 15:return metal(196,111,207,270)+face('M53 243Q111 171 216 179H383Q491 172 550 242L440 303H163Z')+plank(94,348,151,30)+plank(357,348,151,30)
  case 16:return metal(190,93,234,296)+face('M46 241Q141 172 213 163H461V310H211Q130 294 46 241Z')+r(406,182,30,30,'#34432E',2)+e(454,224,13,13,'#34432E')
  case 17:return metal(187,97,229,287)+face('M37 242L205 155H398L566 242 400 315H202Z')+r(355,178,31,31,'#34432E',2)+e(224,228,11,11,'#34432E')
  case 18:return metal(47,95,505,292)+r(59,193,481,104,iron,12)+r(68,212,463,63,'#ACAF98',7)+p('M84 219h430','none','#D1D4BA',2)+bolts(70,120,460,240)
  case 19:return poly(300,241,190,170,3,iron)+[0,1,2].map(n=>g(p('M-36 8L-48-130Q0-185 48-132L36 8Z',iron)+p('M-26-112q25-20 51 0','none','#BFC4A9',2),`translate(300 241) rotate(${n*120})`)).join('')+e(300,241,45,40,iron)
  case 20:return metal(105,112,373,264)+face('M59 147H502V215H377V351H301V215H59Z')+p('M78 162H481M320 224V330','none','#C8CDB3',3)+p('M502 147l53 68H502Z',iron)
  case 21:return metal(61,76,479,329)+metal(102,116,395,249)+r(140,165,128,139,'#3A4933',4)+r(326,165,128,139,'#3A4933',4)+r(151,178,106,113,'#89957B',4)+r(337,178,106,113,'#89957B',4)+bolts(84,100,432,280)
  case 22:return metal(118,82,365,320)+e(300,241,131,128,iron)+face('M74 240L223 173H376L527 240 376 299H224Z')+bolt(300,241)+bolts(132,96,337,292)
  case 23:return metal(159,100,303,279)+line('M165 170Q61 147 68 240Q62 330 165 307M463 170Q555 151 549 240Q555 328 463 307','#A2AA91',15)+face('M79 242L219 161H465V316H220Z')+r(412,183,29,29,'#34432F',2)
  default:throw new Error('未知工坊铁砧构造。')
 }
}

const tuyere=(d:string)=>line(d,'#919278',15)
function forge(i:number):string {
 switch(i){
  case 0:return brick(66,67,468,348)+pit(300,241,175,126)+tuyere('M470 244H567')+p('M91 107l21 14m355 251 25 10','none','#C6B48A',2)
  case 1:return brick(45,93,509,304)+pit(224,245,134,118)+tuyere('M345 245H554')+metal(417,156,108,162,6)
  case 2:return slab(43,116,514,248)+r(72,138,457,204,'#434C37',12)+pit(300,240,211,79)+line('M75 133H525M75 347H525','#989F85',9)+tuyere('M542 240H574')
  case 3:return ring(300,241,228,192,stone)+pit(300,249,170,132)+tuyere('M500 258H569V306')+rep(12,n=>{const a=n*Math.PI/6;return p(`M${300+190*Math.cos(a)} ${241+156*Math.sin(a)}l${23*Math.cos(a)} ${22*Math.sin(a)}`,'none','#67715B',3)})
  case 4:return feet(91,105,418,274,iron)+pit(300,241,184,130)+grate(88,101,424,279)+line('M71 83H529V399H71Z','#8E9780',10)+tuyere('M517 254H566')
  case 5:return brick(43,73,514,332)+pit(174,241,105,132)+pit(426,241,105,132)+slab(286,89,28,302)+tuyere('M172 115V49H429V115')
  case 6:return p('M48 401V221Q61 63 301 61Q543 66 553 222V401Z',stone)+pit(300,268,180,104)+metal(199,68,202,61,14)+tuyere('M49 280H30V333')+spots(300,154,145,53,70)
  case 7:return p('M59 244Q72 85 258 66Q476 52 540 232Q555 400 339 416Q101 436 59 244Z','#A79370')+pit(286,249,160,137)+tuyere('M452 245H566')+spots(297,239,212,149,90)
  case 8:return leaf(stone)+pit(299,246,165,101)+tuyere('M474 247Q537 225 566 265')+p('M125 144q181-71 344 10','none','#ACB28B',3)
  case 9:return poly(300,240,252,194,6,stone)+poly(300,240,227,172,6,iron)+pit(300,240,162,122)+tuyere('M102 245H36M498 245H565')+rep(6,n=>{const a=n*Math.PI/3;return bolt(300+208*Math.cos(a),240+156*Math.sin(a))})
  case 10:return p('M60 97L206 65 341 89 495 68 546 129 515 368 401 416 252 384 81 415Z',stone)+pit(300,250,162,115)+line('M86 101Q32 245 91 397M502 97Q558 245 501 387','#C1AF88',22)+tuyere('M467 258H570')
  case 11:return poly(300,240,246,193,8,stone)+[0,1,2].map(n=>{const a=n*Math.PI*2/3-Math.PI/2,x=300+117*Math.cos(a),y=240+106*Math.sin(a);return pit(x,y,68,63)+tuyere(`M300 241L${x} ${y}`)}).join('')+e(300,241,22,20,iron)+tuyere('M300 408V442')
  case 12:return p('M47 109L133 62 217 109 300 58 383 109 468 62 553 109V399H47Z',stone)+pit(300,258,180,91)+r(44,133,30,239,iron,3)+r(527,133,30,239,iron,3)+tuyere('M301 109V76')
  case 13:return p('M43 235L157 68 300 126 444 68 557 235 474 414 300 352 126 414Z',stone)+pit(300,245,167,91)+line('M300 134V344','#94967A',17)+tuyere('M102 280H35M498 280H566')
  case 14:return p('M300 48Q383 59 396 130Q492 104 530 184Q560 266 478 309Q505 396 409 422Q328 438 300 362Q269 441 185 421Q93 391 123 308Q39 262 73 183Q112 101 205 131Q221 58 300 48Z',stone)+pit(300,242,121,109)+tuyere('M300 364V436')
  case 15:return e(221,240,178,184,stone)+e(428,253,123,151,stone)+pit(217,242,128,134)+pit(433,253,79,101)+tuyere('M535 265H572')+spots(300,241,181,126,90)
  case 16:return feet(94,94,410,288,iron)+line('M94 94L300 242L504 94M94 382L300 242L504 382','#87927A',24)+ring(300,242,227,187,iron)+pit(300,244,174,128)+tuyere('M501 260H567V306')+bolts(163,103,273,274)
  case 17:return metal(45,92,349,304)+pit(217,242,135,112)+tuyere('M356 265H447V247')+ring(481,183,76,96,iron)+handwheel(481,183,.9)+line('M487 110H541V158','#A6AA90',9)
  case 18:return feet(77,94,448,294,iron)+metal(86,84,429,316)+pit(300,242,163,121)+line('M52 119V359M548 119V359M52 140H86M52 337H86M515 140H548M515 337H548','#A9AB93',9)+[72,529].map(x=>[85,398].map(y=>r(x-13,y-13,26,26,'#3F5038',8)).join('')).join('')
  case 19:return metal(43,86,514,311)+pit(174,242,109,126)+pit(426,242,109,126)+metal(286,102,28,281)+tuyere('M176 114V53H426V114')
  case 20:return line('M66 102H535V384H66Z','#9BA48B',13)+metal(81,114,437,256)+pit(300,248,160,96)+tuyere('M300 144V114')+ring(301,84,74,37,iron)+handwheel(301,82,.7)
  case 21:return brick(45,80,512,324)+pit(300,271,202,93)+[139,300,460].map(x=>metal(x-26,85,52,107,8)).join('')+metal(69,64,464,45,8)+tuyere('M536 281H569')
  case 22:return metal(44,92,513,302)+pit(300,163,220,44)+pit(300,320,220,44)+line('M75 235H525','#A5AA8C',12)+tuyere('M79 163H32V319H79')+p('M549 216V267','none','#B6BBA1',3)
  case 23:return ring(286,239,209,182,iron)+pit(286,241,161,132)+line('M91 161H48V303H91M481 161H526V303H481','#A5AB92',12)+tuyere('M488 270H561V353')
  default:throw new Error('未知工坊锻炉构造。')
 }
}

function pearBellows(x:number,y:number,sx=1,sy=1):string {
 return g(p('M-160 8Q-156-111-38-126L111-41H160V41H111L-38 126Q-155 109-160 8Z',wood)+p('M-136 6Q-137-83-39-101L93-28H136V28H93L-39 102Q-136 88-136 6Z',leather)+p(rep(9,n=>`M${-112+n*23} ${-69+n*4}q-13 ${138-n*8} 0 ${138-n*8} `),'none','#554A34',2)+p('M-135-1H100','none','#B8A079',4)+line('M152 0H207','#94977B',16)+spots(-35,0,83,62,80,3,'#D1B28A'),`translate(${x} ${y}) scale(${sx} ${sy})`)
}
const boxBellows=(x:number,y:number,w:number,h:number)=>board(x,y,w,h)+r(x+18,y+17,w-36,h-34,leather,5)+p(rep(13,n=>`M${x+27+n*(w-54)/12} ${y+24}v${h-48} `),'none','#5F503A',3)+plank(x+2,y+3,24,h-6)+plank(x+w-26,y+3,24,h-6)+spots(x+w/2,y+h/2,w*.32,h*.32,65,5)
const pistonBox=(x:number,y:number,w:number,h:number)=>board(x,y,w,h)+line(`M${x+w*.6} ${y+h/2}H${x+w+81}`,'#9B8962',13)+line(`M${x+w+81} ${y+h*.18}V${y+h*.82}`,'#B09A73',10)+metal(x+8,y+17,27,h-34,4)+line(`M${x} ${y+h/2}H${x-39}`,'#9C9D81',16)
function bellows(i:number):string {
 switch(i){
  case 0:return pearBellows(270,241,1.18,1.25)+line('M83 241H34','#A68D64',20)
  case 1:return pearBellows(267,140,1.17,.68)+pearBellows(267,342,1.17,.68)+line('M514 140H557V342H514M557 241H578','#A4A285',16)+plank(73,217,323,46)
  case 2:return pistonBox(119,93,324,294)+line('M79 241H32','#9DA384',16)+p('M147 110h260','none','#C7B18B',2)
  case 3:return line('M68 83H522V399H68Z',wood,17)+pearBellows(282,241,.95,1)+plank(111,298,204,72)+line('M126 302L426 173M315 333L426 173','#9A9B78',7)+bolt(426,173)
  case 4:return e(260,241,172,172,wood)+e(260,241,149,148,'none','#605E44',9)+line('M262 241H504M504 153V329','#A99870',16)+line('M91 240H35','#9B9C7F',18)+rep(12,n=>{const a=n*Math.PI/6;return p(`M${260+133*Math.cos(a)} ${241+131*Math.sin(a)}l${28*Math.cos(a)} ${28*Math.sin(a)}`,'none','#756347',2)})
  case 5:return boxBellows(66,131,192,218)+boxBellows(329,131,190,218)+metal(260,160,67,161,6)+line('M259 241H327M67 241H33M519 241H571','#A0A286',15)+line('M113 96H476V131M113 96V131',wood,13)
  case 6:return boxBellows(113,99,359,284)+plank(82,179,34,124)+line('M472 241H565','#969C7D',17)+line('M113 241H32','#A48C62',18)
  case 7:return pearBellows(255,146,1.09,.69)+pearBellows(255,340,1.09,.69)+plank(111,221,358,39)+line('M148 143L451 339M148 340L451 143','#A39E7D',8)+bolt(300,240)+line('M483 145H544V340H483M544 241H575','#A3A58A',16)
  case 8:return leaf(leather)+line('M84 241Q293 142 509 241','#B8B184',12)+line('M552 241H578','#A2A789',17)+spots(300,261,156,74,100,4,'#C9B58B')
  case 9:return poly(286,241,216,182,6,iron)+line('M283 241H520M520 141V341','#ACA486',19)+line('M115 240H32','#9FA689',18)+poly(285,241,163,134,6,leather)+p('M285 108V376','none','#8C8E6B',13)+spots(285,241,128,84,90)
  case 10:return line('M129 192L37 146M129 293L36 341','#AA9C72',7)+pearBellows(270,242,1.15,1.25)+line('M92 111L415 364','#C1B08B',22)+line('M91 350L418 118','#A59C74',8)
  case 11:return [0,1,2].map(n=>g(pearBellows(0,0,.55,.56),'translate(300 241) rotate('+(n*120)+') translate(-107 0)')).join('')+ring(300,241,54,48,iron)+line('M300 290V433','#9AA485',17)
  case 12:return p('M47 113L132 64 218 113 300 64 383 113 469 64 552 113V395H47Z',wood)+boxBellows(80,133,438,229)+line('M520 241H575','#9AA182',18)+line('M48 240H25','#9E916C',19)+spots(301,242,175,75,100)
  case 13:return p('M45 242L156 73 300 128 444 73 556 242 471 408 300 351 128 408Z',leather)+line('M300 132V347','#B0A77D',18)+p('M166 99q-29 150 0 280M436 99q29 150 0 280','none','#5D5239',3)+line('M556 242H578','#9AA383',17)+spots(300,242,169,83,105)
  case 14:return pearBellows(271,241,1.08,.93)+line('M83 242H38','#B19C73',14)+plank(70,198,38,86,8)
  case 15:return pearBellows(272,242,1.12,1.21)+plank(117,298,214,72)+line('M131 304L416 172M331 335L416 172','#A4A580',8)+e(416,172,7,7,iron)+plank(99,369,269,22)
  case 16:return boxBellows(92,97,363,286)+line('M455 241H563','#A9AD91',19)+[174,366].map(x=>ring(x,241,31,39,iron)).join('')+line('M91 241H37','#A9A082',15)
  case 17:return ring(277,238,191,176,iron)+p('M395 109H492V187H431Z',iron)+line('M487 149H560','#ABB197',20)+handwheel(275,239,1.34)+line('M313 272H397V322','#AEB196',9)+spots(277,238,145,125,100)
  case 18:return pistonBox(63,140,256,226)+edgeWheel(453,235,158,0,iron)+line('M319 253L453 218','#A9B093',12)+e(453,218,9,9,iron)+line('M443 235H337','#88947A',15)+r(348,357,186,28,wood,4)
  case 19:return boxBellows(84,81,404,135)+boxBellows(84,267,404,135)+plank(132,116,218,59)+plank(132,304,218,59)+line('M488 148H552V334H488M552 241H575','#A6AE91',17)+line('M110 182L420 138M110 370L420 324','#9EA582',7)
  case 20:return line('M133 174Q34 159 38 240Q31 320 133 307','#A2A885',12)+pearBellows(269,241,1.11,.92)+line('M498 241Q556 200 567 291V347','#A2A98A',17)
  case 21:return [134,300,466].map(x=>metal(x-63,95,126,246,48)+r(x-25,118,50,198,'#7F8C70',17)+line(`M${x} 340V390`,'#A6AD8D',12)).join('')+line('M78 390H524M130 86H470','#A6AA8A',17)+line('M530 390H567V331','#A6AC90',17)
  case 22:return metal(53,89,494,303)+ring(224,242,156,137,iron)+edgeWheel(472,243,120,0,iron)+p('M318 143L462 123M318 341L462 363','none','#4C503B',7)+line('M224 242H472','#A4AB8B',12)+line('M89 151H37V208','#A4AE91',20)
  case 23:return pistonBox(111,117,328,248)+ring(159,170,26,28,iron)+ring(393,305,26,28,iron)+line('M72 241H32','#ABB194',17)+bolts(126,133,297,216)
  default:throw new Error('未知工坊风箱构造。')
 }
}

const beam=(x:number,y:number,w:number,h:number,fill=wood)=>r(x,y,w,h,fill,4)+p(w>h?`M${x+8} ${y+6}h${w-16}M${x+12} ${y+h-6}h${w-24}`:`M${x+6} ${y+8}v${h-16}M${x+w-6} ${y+12}v${h-24}`,'none','#BEAC82',1.1)+bolts(x+8,y+8,w-16,h-16)
const warp=(x:number,y:number,w:number,h:number,n=31)=>r(x,y,w,h,'#77735B',0,'#8E9272',.5)+p(rep(n,k=>`M${num(x+3+k*(w-6)/(n-1))} ${y}v${h} `),'none','#C4BB93',1)+r(x+2,y+h*.58,w-4,h*.4,cloth,1,'#AAAB86',1)+p(rep(17,k=>`M${x+5} ${num(y+h*.59+k*h*.021)}h${w-10} `),'none','#837E5A',.7)+p(rep(n,k=>`M${num(x+3+k*(w-6)/(n-1))} ${y+h*.59}v${h*.38} `),'none','#D1C39A',.65)
function loomBed(x:number,y:number,w:number,h:number,heddles=2,fill=wood):string {
 return beam(x,y,29,h,fill)+beam(x+w-29,y,29,h,fill)+beam(x-13,y+15,w+26,29,fill)+beam(x-13,y+h-43,w+26,29,fill)+warp(x+36,y+48,w-72,h-97)+rep(heddles,n=>beam(x+25,y+89+n*40,w-50,13,fill)+p(`M${x+39} ${y+103+n*40}h${w-78}`,'none','#D6C6A0',1))+p(`M${x+w*.23} ${y+h-61}h${w*.44}`,'none','#867351',8)
}
const treadles=(x:number,y:number,n=2,shaftY=350)=>rep(n,k=>beam(x+k*56,y,37,60)+line(`M${x+18+k*56} ${y}L${x+9+k*56} ${shaftY}`,'#A09E7C',4))
const shuttle=(x:number,y:number,s=1,a=0)=>g(p('M-54 0Q0-26 54 0Q0 26-54 0Z',wood)+e(0,0,25,7,cloth,'#8B8B64',1)+p('M-15 0H15','none','#D5C79F',2),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
function loom(i:number):string {
 switch(i){
  case 0:return feet(64,67,471,347)+loomBed(64,67,471,347,1)+shuttle(300,300,1.4,-4)+line('M62 85H36M536 85H562',wood,13)
  case 1:return loomBed(70,53,460,343,2)+treadles(237,393,2,344)+shuttle(300,302,1.1)+feet(83,69,434,310)
  case 2:return beam(52,159,495,31)+beam(52,303,495,31)+warp(78,194,444,104,20)+rep(12,n=>r(115+n*31,185,25,34,wood,3)+e(127+n*31,196,3,3,'#625F42'))+shuttle(435,263,.8)
  case 3:return beam(69,75,461,35)+warp(95,110,409,235,27)+beam(81,341,436,27)+p('M91 369L145 426H459L513 369Z',leather)+shuttle(299,270,1.1)+line('M72 77H34M529 77H567',wood,14)
  case 4:return ring(300,240,226,192,wood)+p(rep(36,n=>{const a=n*Math.PI/18;return`M300 240L${num(300+210*Math.cos(a))} ${num(240+175*Math.sin(a))} `}),'none','#D3BF98',1.2)+e(300,240,75,63,cloth)+shuttle(383,310,.9,34)
  case 5:return beam(50,99,499,31)+beam(67,125,24,233)+beam(509,125,24,233)+warp(96,135,407,178,28)+rep(14,n=>line(`M${111+n*29} 310V345`,'#B3A781',2)+e(111+n*29,365,10+n%3,17,stone))+shuttle(301,261,.9)
  case 6:return loomBed(55,52,489,351,3)+treadles(211,400,3,352)+shuttle(299,304,1.2)+line('M40 123V330M560 123V330M40 123H55M544 123H560',wood,10)
  case 7:return loomBed(80,66,439,348,0)+beam(94,81,412,15)+beam(94,388,412,15)+shuttle(318,293,1.25,-10)+p('M97 177h404','none','#AAB18C',3)
  case 8:return leaf()+loomBed(114,84,374,309,2)+treadles(250,391,2,354)+shuttle(305,282,.9)+line('M114 89Q302 48 488 89','#A6B184',7)
  case 9:return poly(300,240,254,192,6,iron)+warp(147,110,307,260,26)+[139,240,342].map(y=>beam(126,y,350,16,iron)).join('')+beam(125,84,351,28,iron)+beam(125,367,351,28,iron)+shuttle(300,318,.9)
  case 10:return p('M70 92L204 62 342 89 493 68 540 128 514 372 396 416 253 383 81 414Z',wood)+warp(120,119,361,255,24)+line('M86 91Q32 243 91 401M501 93Q559 245 501 390','#C4B18B',21)+beam(108,103,386,27)+beam(110,367,382,24)+shuttle(300,300,1.1)
  case 11:return poly(300,240,246,193,8,wood)+p(rep(40,n=>{const a=n*Math.PI/20;return`M300 240L${num(300+221*Math.cos(a))} ${num(240+170*Math.sin(a))} `}),'none','#CBBE94',1)+poly(300,240,106,91,8,cloth)+rep(4,n=>shuttle(300+91*Math.cos(n*Math.PI/2),240+79*Math.sin(n*Math.PI/2),.6,n*90))
  case 12:return p('M48 107L132 61 217 107 300 61 384 107 468 61 552 107V394H48Z',wood)+loomBed(82,119,436,272,2)+treadles(239,391,2,349)+shuttle(300,300,1.1)
  case 13:return p('M44 237L156 69 300 123 444 69 557 237 475 413 300 354 125 413Z',wood)+loomBed(113,100,375,286,3)+shuttle(300,295,1.1)+treadles(227,385,3,342)+line('M76 237H113M488 237H525','#9C9270',11)
  case 14:return p('M300 47Q380 60 396 132Q492 107 530 184Q561 265 476 309Q503 393 411 420Q329 438 300 362Q269 440 185 420Q95 391 124 308Q40 262 73 182Q112 102 205 131Q220 57 300 47Z',wood)+e(300,242,139,119,cloth)+p(rep(25,n=>`M${num(176+n*10)} ${num(199-Math.sqrt(Math.max(0,1-((n-12)/13)**2))*66)}V${num(284+Math.sqrt(Math.max(0,1-((n-12)/13)**2))*66)} `),'none','#CCC29A',1)+shuttle(300,330,.8)+line('M300 380V427',wood,12)
  case 15:return loomBed(83,83,434,306,2)+line('M73 98Q301 39 528 98',wood,16)+treadles(235,389,2,347)+e(109,390,26,21,cloth)+e(492,390,26,21,cloth)+shuttle(300,287,1)
  case 16:return feet(68,66,465,332,iron)+loomBed(67,63,467,333,2,iron)+treadles(236,396,2,345)+shuttle(300,295,1.1)+metal(112,254,379,13,2)
  case 17:return loomBed(69,70,462,325,3)+metal(28,265,61,78)+metal(511,265,61,78)+beam(31,286,538,29,iron)+shuttle(472,300,.8)+treadles(238,394,2,350)
  case 18:return loomBed(63,91,473,303,3,iron)+metal(162,39,277,67)+rep(7,n=>r(177+n*35,50,24,44,'#5D6D50',3))+line('M440 79H555V337H536','#A0A58A',7)+shuttle(300,302,1)
  case 19:return loomBed(64,135,471,263,3,iron)+beam(119,53,361,28,iron)+rep(3,n=>r(171+n*88,40,75,78,'#C7BC98',3)+p(rep(12,k=>`M${181+n*88+k%3*23} ${53+Math.floor(k/3)*17}h7 `),'none','#5D6A4E',4))+line('M126 80V135M472 80V135','#A1A58D',12)+shuttle(300,310,1)
  case 20:return loomBed(72,73,455,335,2)+shuttle(302,305,1)+line('M78 79H43M521 79H560',wood,15)+handwheel(540,202,.7)
  case 21:return ring(300,240,224,192,iron)+rep(6,n=>{const a=n*Math.PI/3;return line(`M300 240L${num(300+225*Math.cos(a))} ${num(240+190*Math.sin(a))}`,'#9BA38A',14)})+e(300,240,167,139,cloth)+p(rep(32,n=>{const a=n*Math.PI/16;return`M300 240L${num(300+158*Math.cos(a))} ${num(240+130*Math.sin(a))} `}),'none','#D1C39C',1)+shuttle(441,263,.7,65)
  case 22:return beam(58,93,485,29,iron)+beam(58,368,485,29,iron)+warp(94,128,151,237,17)+warp(356,128,151,237,17)+beam(66,209,470,17,iron)+beam(66,262,470,17,iron)+shuttle(170,325,.75)+shuttle(431,325,.75)+treadles(251,396,2,349)
  case 23:return loomBed(66,80,468,320,0)+beam(103,96,22,287,iron)+beam(476,96,22,287,iron)+handwheel(62,244,.72)+handwheel(537,244,.72)+shuttle(300,302,1.1,-5)
  default:throw new Error('未知工坊织机构造。')
 }
}

const spindle=(x:number,y:number,s=1,a=0)=>g(line('M-82 0H85','#9B9F81',8)+r(-35,-18,70,36,wood,13)+p(rep(12,n=>`M${-30+n*5.5}-16v32 `),'none','#CEBF98',1)+p('M-59-33H41Q72-28 70 0Q72 28 41 33H-59','none','#8D9877',8)+line('M-59-34V34','#A7AC8C',8),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const belt=(x:number,y1:number,y2:number)=>p(`M${x-9} ${y1}V${y2}M${x+9} ${y1}V${y2}`,'none','#584D36',4)+p(`M${x-8} ${y1}V${y2}M${x+8} ${y1}V${y2}`,'none','#B19A72',1)
function spinRig(wx:number,wy:number,rad:number,sx:number,sy:number,foot=0,fill=wood):string {
 return edgeWheel(wx,wy,rad,0,fill)+edgeWheel(wx,sy,27,0,fill)+belt(wx,wy-rad+8,sy+23)+line(`M${wx} ${sy}H${sx-77}`,'#9C9E7B',8)+spindle(sx,sy)+line(`M${wx-30} ${wy}H${wx+31}`,'#A49A78',12)+(foot?beam(226,384,foot===2?48:137,53)+line(`M245 383L${wx+6} ${wy+12}`,'#A1A07D',5)+(foot===2?beam(294,384,48,53):''):'')
}
function spinning(i:number):string {
 switch(i){
  case 0:return plank(43,270,512,75)+beam(105,65,37,311)+spinRig(146,174,120,456,302)+feet(79,284,446,48)
  case 1:return board(64,83,474,298)+spinRig(161,181,103,426,324,1)+beam(116,104,31,245)+beam(456,213,29,136)
  case 2:return board(123,68,351,335)+spinRig(232,190,112,384,340,1)+beam(170,64,28,305)+beam(310,64,28,305)+line('M177 67H325',wood,17)
  case 3:return plank(44,276,512,82)+edgeWheel(136,158,108)+belt(136,58,331)+line('M136 304H481','#A5A17E',11)+spindle(421,284,.78)+spindle(421,359,.78)+beam(305,277,29,83)+handwheel(136,158,.65)
  case 4:return board(64,86,474,296)+spinRig(168,188,102,421,326,1)+line('M492 330V97M479 114l26 0m-28 16h29m-26 16h29','#A9A17A',9)+e(492,92,25,32,cloth)
  case 5:return board(53,84,493,313)+wheel(192,215,117,112,10)+spindle(429,290,1.05)+p('M167 105L351 267M169 328L353 311','none','#6C5E40',5)+line('M296 290H350','#9A9D7D',9)+handwheel(192,215,.65)
  case 6:return p('M62 245Q74 72 301 76Q533 80 545 245Q527 405 301 408Q71 409 62 245Z',wood)+spinRig(171,174,105,412,319,1)+e(483,132,49,60,wood)+e(483,132,35,45,cloth)+p('M453 131h58','none','#8B916D',2)
  case 7:return beam(92,83,26,306)+beam(491,83,26,306)+beam(76,91,457,31)+beam(76,358,457,31)+spinRig(166,186,99,426,326)+line('M112 102L494 372M494 102L112 372','#968E6B',10)
  case 8:return leaf()+spinRig(173,183,104,422,322,1)+line('M96 236Q156 67 216 236','#A9AB7D',13)+spots(300,254,149,75,80)
  case 9:return poly(300,240,252,192,6,iron)+spinRig(187,181,100,419,327,1,iron)+beam(121,70,29,319,iron)+beam(457,112,29,277,iron)
  case 10:return p('M68 93L206 65 340 91 494 69 547 131 514 371 400 414 255 383 81 414Z',wood)+line('M86 94Q32 243 91 399M501 96Q559 245 501 389','#C3AF86',21)+spinRig(169,184,101,419,326,1)+spots(302,248,136,73,70)
  case 11:return poly(300,240,244,192,8,wood)+edgeWheel(159,162,100)+edgeWheel(290,195,69)+belt(159,70,342)+line('M159 320H440','#9FA17F',10)+spindle(402,316,.84)+spindle(402,377,.84)+p('M169 79L281 129M169 250L281 259','none','#685B40',5)+e(290,196,15,15,iron)
  case 12:return p('M49 115L134 67 218 115 300 65 383 115 469 67 553 115V394H49Z',wood)+spinRig(176,191,113,420,327,1)+beam(109,123,29,259)+beam(468,141,27,242)
  case 13:return p('M44 237L157 71 300 126 445 71 557 237 475 413 300 354 124 413Z',wood)+edgeWheel(166,174,106)+belt(166,74,360)+line('M166 311H444M166 361H444','#A1A180',9)+spindle(400,311,.85)+spindle(400,362,.85)+beam(468,146,27,237)+spots(301,241,125,62,70)
  case 14:return p('M300 48Q380 59 396 132Q492 106 530 184Q560 266 477 308Q504 393 409 422Q329 439 300 362Q270 439 185 421Q94 392 124 307Q40 263 73 183Q111 103 205 132Q221 58 300 48Z',wood)+spinRig(200,193,101,410,328,1)+e(399,154,40,33,cloth)
  case 15:return p('M57 243Q68 77 300 75Q534 78 546 243Q532 412 300 408Q71 410 57 243Z',wood)+spinRig(169,178,108,411,326,1)+e(467,125,38,35,cloth)+e(467,206,33,31,cloth)+p('M443 123h50m-46 81h42','none','#8B8A66',2)
  case 16:return metal(61,87,480,296)+spinRig(170,184,108,421,326,1,iron)+beam(108,86,27,287,iron)+beam(465,112,29,262,iron)
  case 17:return board(62,85,476,297)+spinRig(164,181,108,423,326,2)+line('M171 194L248 385M171 194L314 385','#A5AA89',5)+bolt(171,194)
  case 18:return board(45,56,512,363)+edgeWheel(129,176,113,0,iron)+belt(129,69,389)+rep(4,n=>line(`M129 ${140+n*76}H379`,'#A8AC8D',7)+spindle(431,140+n*76,.64))+beam(492,101,25,297,iron)
  case 19:return board(62,68,476,341)+r(84,88,427,298,'#7D7A59',7)+wheel(194,198,88,88,8)+spindle(409,318,.88)+p('M177 111L338 300M177 284L338 334','none','#5E5339',5)+line('M84 96H511V379H84Z',wood,6)
  case 20:return board(58,83,483,301)+edgeWheel(300,171,109)+belt(300,70,354)+line('M300 329H119M300 329H481','#A7AB8B',8)+spindle(150,329,.68,180)+spindle(450,329,.68)+beam(236,385,125,51)+handwheel(487,166,.6)
  case 21:return board(47,83,507,311)+spinRig(139,176,107,345,327,1)+edgeWheel(477,187,78)+belt(477,117,331)+line('M410 327H477','#A9AC8B',9)+r(436,286,84,64,wood,17)+p(rep(13,n=>`M${443+n*5} 290v56 `),'none','#D6C39E',1)+handwheel(477,187,.65)
  case 22:return board(43,82,514,316)+spinRig(130,176,108,249,328,1)+spinRig(461,176,108,384,328)+beam(288,91,27,292)+spots(300,240,171,105,80)
  case 23:return p('M94 399L222 73H383L511 399Z',iron)+spinRig(213,187,108,422,326)+beam(241,393,95,42,iron)+line('M258 392L219 195','#A8B18F',6)+feet(107,383,390,0,iron)
  default:throw new Error('未知工坊纺车构造。')
 }
}

const kilnMouth=(x:number,y:number,w:number)=>slab(x,y,w,43)+r(x+12,y+3,w-24,22,'#414A35',5)+p(`M${x+17} ${y+34}h${w-34}`,'none','#BEB995',2)
const smoke=(x:number,y:number,s=1)=>g(ring(0,0,29,26,stone)+e(0,0,16,14,'#394734','#8F977A',3),`translate(${x} ${y}) scale(${s})`)
const dome=(x:number,y:number,rx:number,ry:number,fill=stone)=>e(x,y,rx,ry,fill)+e(x,y,rx-18,ry-18,'none','#C1BA9A',2)+spots(x,y,rx*.82,ry*.81,130,8,'#D2C5A6')+p(`M${x-rx*.7} ${y-ry*.53}q${rx*.7} ${-ry*.3} ${rx*1.4} 0M${x-rx*.72} ${y+ry*.49}q${rx*.7} ${ry*.21} ${rx*1.4} 0`,'none','#7D7E61',1.5)
function kiln(i:number):string {
 switch(i){
  case 0:return ring(300,231,236,183,stone)+poly(300,229,197,146,9,'#9CA084')+p('M136 124L446 326M216 89L202 365M381 104L292 377','none','#6B775F',4)+kilnMouth(215,378,171)
  case 1:return p('M61 239Q76 81 248 64Q465 47 540 226Q561 401 338 417Q94 438 61 239Z','#A18E6A')+dome(299,231,196,149,'#AE9771')+smoke(330,117,1.1)+kilnMouth(192,381,214)
  case 2:return brick(46,70,510,344)+r(84,103,433,261,'#96977A',73)+rep(5,n=>p(`M${117+n*90} 114q-19 120 0 239`,'none','#C7B995',4))+kilnMouth(210,378,187)+smoke(468,226,.9)
  case 3:return dome(289,206,221,164,'#9B9370')+e(300,206,66,53,stone)+e(300,206,43,34,'#4F5E43')+r(184,329,225,81,'#A0916A',21)+kilnMouth(210,389,175)+spots(300,223,174,113,90)
  case 4:return slab(42,105,515,271)+r(67,125,468,228,'#96947A',89)+rep(8,n=>p(`M${95+n*58} 142q-13 91 0 193`,'none','#BFB592',4))+kilnMouth(60,357,150)+smoke(490,238,.87)
  case 5:return dome(183,224,145,169,'#A79573')+dome(418,224,145,169,'#A0906C')+r(283,92,35,287,stone,3)+smoke(301,130,1)+kilnMouth(115,374,143)+kilnMouth(344,374,143)
  case 6:return dome(300,231,226,185,'#A5946F')+e(300,231,143,118,'#B3A07B','#867F5D',3)+smoke(300,231,1.7)+p('M114 139q187-83 374 0M128 334q168 62 341 0','none','#C2B391',2)+kilnMouth(210,378,180)
  case 7:return slab(46,62,508,357)+dome(300,204,213,147,'#9E9473')+plank(92,353,416,64,10)+kilnMouth(210,353,181)+smoke(329,111,1.1)
  case 8:return p('M55 293Q90 66 300 66Q528 71 549 291Q425 411 300 370Q157 420 55 293Z',stone)+p('M83 285Q157 88 404 93Q469 237 299 348Q176 387 83 285Z','#A6AF88')+p('M111 284Q244 170 405 96M300 67Q387 199 531 283','none','#71835B',6)+smoke(276,134,1)+kilnMouth(187,372,226)
  case 9:return poly(300,226,253,188,6,stone)+poly(300,226,223,161,6,iron)+line('M300 43V409M82 136L519 318M82 318L519 136','#9B987C',8)+poly(300,226,59,48,6,'#46573B')+rep(12,n=>{const a=n*Math.PI/6;return bolt(300+204*Math.cos(a),226+147*Math.sin(a))})+kilnMouth(204,380,192)
  case 10:return p('M53 248L91 104 220 67 344 91 495 65 553 243 517 382 377 408 254 380 94 419Z',stone)+line('M94 111L512 368M496 100L113 384','#C0AC81',19)+line('M78 178L526 274','#A69770',14)+smoke(389,141,1.07)+kilnMouth(205,378,191)
  case 11:return poly(300,226,248,187,8,stone)+rep(8,n=>{const a=n*Math.PI/4;return p(`M300 226L${num(300+229*Math.cos(a))} ${num(226+170*Math.sin(a))}`,'none','#BEB89A',3)})+ring(300,226,70,59,iron)+[170,430].map(x=>[137,306].map(y=>smoke(x,y,.58)).join('')).join('')+kilnMouth(210,381,182)
  case 12:return p('M85 371V128L166 66H434L516 128V371Z',stone)+p('M112 343V140L300 75 487 140V343L300 382Z','#8C987C')+p('M300 76V379M114 141L300 183 486 141M114 246L300 283 486 246','none','#BEC1A0',4)+[111,464].map(x=>[162,293].map(y=>metal(x,y,25,53,4)).join('')).join('')+smoke(300,121,.77)+kilnMouth(205,381,193)
  case 13:return dome(300,222,240,177,'#9C9775')+rep(6,j=>rep(7,k=>{const x=111+k*58+(j%2)*26,y=84+j*51;if(((x-300)/212)**2+((y-222)/155)**2>.84)return '';return p(`M${x-25} ${y-12}q25-20 50 0l-3 22-22 12-22-12Z`,j%2?'#AAA27C':'#8C9471','#68775B',1.4)}))+smoke(342,111,.9)+kilnMouth(188,377,226)
  case 14:return p('M63 242Q145 65 301 89Q463 63 546 242Q455 417 301 389Q143 418 63 242Z','#A5AF8A')+p('M84 242Q300 142 522 242Q300 336 84 242Z','#B7BD98')+p('M300 91Q340 238 299 386','none','#7E8E64',6)+smoke(422,202,.8)+kilnMouth(218,371,166)
  case 15:return dome(224,221,178,171,'#9D956F')+dome(431,248,120,139,'#AEA17C')+smoke(215,135,.9)+smoke(431,209,.67)+plank(119,374,364,44,12)+kilnMouth(201,370,190)
  case 16:return brick(44,77,513,329)+r(80,102,439,260,iron,79)+rep(3,n=>metal(133+n*151,88,32,289,7))+kilnMouth(47,357,152)+kilnMouth(400,357,152)+smoke(300,211,1.1)
  case 17:return dome(300,221,238,179,iron)+rep(10,n=>{const a=n*Math.PI/5;return p(`M300 221L${num(300+218*Math.cos(a))} ${num(221+160*Math.sin(a))}`,'none','#737F65',3)})+rep(16,n=>{const a=n*Math.PI/8;return bolt(300+207*Math.cos(a),221+150*Math.sin(a))})+smoke(300,194,1.1)+kilnMouth(203,377,194)
  case 18:return brick(47,72,508,337)+metal(78,106,445,249,12)+smoke(169,113,.8)+smoke(428,113,.8)+line('M544 143H572V344H544','#A8AB90',16)+kilnMouth(199,378,202)
  case 19:return metal(45,67,511,303)+slab(83,92,434,249)+line('M123 359V440M474 359V440','#A4AC8E',13)+metal(128,352,342,53,6)+p(rep(6,n=>`M${155+n*52} 364v26 `),'none','#5B694F',7)+kilnMouth(223,332,157)
  case 20:return brick(81,83,438,317)+metal(107,106,387,260)+smoke(420,127,.85)+line('M186 374H413','#AFB294',12)+bolts(128,129,345,216)
  case 21:return metal(58,75,483,330,24)+r(88,106,423,255,stone,28)+r(128,139,343,188,'#839375',18)+smoke(301,118,.8)+metal(88,85,423,24,5)+line('M170 378H430','#B1B59A',11)
  case 22:return brick(43,69,513,337)+r(65,98,217,265,iron,69)+r(318,98,217,265,iron,69)+metal(286,87,28,296,4)+kilnMouth(104,367,142)+kilnMouth(356,367,142)+metal(58,66,485,30,6)
  case 23:return ring(300,232,232,184,iron)+ring(300,232,183,143,iron)+line('M273 232H329','#BCC0A4',14)+rep(3,n=>{const a=n*2*Math.PI/3;return g(metal(-18,-17,36,34),`translate(${300+229*Math.cos(a)} ${232+183*Math.sin(a)}) rotate(${n*120})`)})+smoke(365,135,.78)
  default:throw new Error('未知工坊陶窑构造。')
 }
}

function grindDisc(x:number,y:number,rx:number,ry=rx,seed=1):string {
 return ring(x,y,rx,ry,stone)+rep(12,n=>g(p(`M18-7Q${rx*.45}-22 ${rx-17}-17M${rx*.42}-19l-8 17m22-20-8 18`,'none','#66755C',1.6),`translate(${x} ${y}) scale(1 ${ry/rx}) rotate(${n*30})`))+e(x,y,22,20,'#495B40','#C1C4A4',3)+spots(x,y,rx*.75,ry*.75,130,seed,'#D0CAA7')
}
function millstone(i:number):string {
 switch(i){
  case 0:return grindDisc(300,240,227,187)+line('M390 119H462V177',wood,18)+bolt(391,119)
  case 1:return slab(49,100,502,281)+p('M94 170Q300 121 510 170L481 323Q302 373 119 323Z','#879174')+g(grindDisc(0,0,103,52),'translate(300 245) rotate(-14)')+line('M183 262L420 204',wood,16)
  case 2:return board(52,77,494,329)+grindDisc(275,242,190,155)+handwheel(493,246,.93)+line('M459 242H493','#A4A689',12)+line('M491 276H543V321','#AFAB8A',8)
  case 3:return board(49,70,501,342)+grindDisc(300,242,219,171)+beam(88,190,424,25)+beam(88,265,424,25)+p('M213 130H386L350 241H249Z',wood)+r(254,157,91,66,'#5A6549',3)+bolt(301,241)
  case 4:return board(63,80,473,305)+grindDisc(266,229,179,151)+beam(404,366,106,57)+line('M424 367L329 253','#A3A581',8)+bolt(329,253)
  case 5:return grindDisc(299,239,180,166)+line('M300 240H559M300 240L50 363',wood,24)+metal(269,210,62,59)+line('M537 234V343',wood,14)+feet(244,199,111,83)
  case 6:return board(46,80,510,322)+grindDisc(184,241,135,142)+grindDisc(432,241,111,123,6)+line('M305 241H324','#9EA382',14)+line('M98 124L134 97M493 141l30-24',wood,14)
  case 7:return ring(300,240,228,193,stone)+e(300,240,179,143,'#6C7C5D','#B7BE9A',3)+edgeWheel(300,240,134,0,stone)+line('M98 240H549',wood,23)+metal(278,216,44,49)+line('M528 233V340',wood,12)
  case 8:return leaf()+grindDisc(299,240,171,140)+line('M382 133Q443 113 497 181','#A8AC7F',17)+spots(301,241,119,84,80)
  case 9:return poly(300,240,252,194,6,iron)+grindDisc(300,240,193,157)+rep(6,n=>{const a=n*Math.PI/3;return bolt(300+219*Math.cos(a),240+165*Math.sin(a))})+handwheel(301,242,.66)
  case 10:return p('M64 101L205 66 342 90 492 70 545 134 514 369 399 414 255 383 83 413Z',stone)+grindDisc(285,247,187,150)+line('M289 246L550 98','#C0B18A',25)+p('M491 111l9 18m-42 8 11 18','none','#766A4B',5)
  case 11:return poly(300,241,247,192,3,wood)+[0,1,2].map(n=>{const a=n*2*Math.PI/3-Math.PI/2;return grindDisc(300+117*Math.cos(a),241+106*Math.sin(a),78,74,n+3)+line(`M300 241L${300+117*Math.cos(a)} ${241+106*Math.sin(a)}`,'#A2A582',8)}).join('')+metal(278,219,44,43)
  case 12:return p('M300 55L547 237 451 407H149L53 237Z',stone)+grindDisc(300,244,178,144)+metal(68,197,29,111)+metal(503,197,29,111)+line('M342 120H427V176',wood,15)
  case 13:return p('M44 235L157 69 300 124 444 69 557 235 474 412 300 354 125 412Z',stone)+grindDisc(177,242,107,119)+grindDisc(424,242,107,119,4)+line('M285 242H316','#A5A483',13)+metal(144,360,65,28)+metal(391,360,65,28)
  case 14:return p('M300 48Q381 60 396 131Q490 106 530 184Q560 266 477 308Q504 394 409 421Q330 440 300 363Q269 440 186 420Q93 392 124 308Q40 264 73 183Q111 102 205 131Q220 59 300 48Z',wood)+grindDisc(300,242,137,121)+line('M350 151H420V194','#A8AD80',13)
  case 15:return p('M57 243Q66 76 301 75Q532 76 547 243Q534 412 301 407Q69 410 57 243Z',wood)+grindDisc(250,241,171,151)+p('M404 121Q515 155 519 244Q515 340 405 365L389 329Q475 298 477 244Q474 184 389 158Z',stone)+line('M302 130H364V181',wood,14)
  case 16:return metal(49,83,502,317)+grindDisc(255,241,183,152)+edgeWheel(485,242,130,0,iron)+line('M438 242H485','#A9AD8E',16)+p('M475 131V354M495 131V354','none','#5B533A',5)
  case 17:return metal(55,78,491,326)+grindDisc(300,247,200,159)+p('M188 106H413L361 244H239Z',iron)+r(239,134,122,78,'#4A5D40',3)+p('M247 370H353V431H247Z',iron)
  case 18:return metal(44,74,512,333)+grindDisc(175,242,123,139)+grindDisc(424,242,123,139,5)+metal(284,187,32,112)+line('M296 242H304','#A5AD8F',17)+handwheel(300,101,.94)
  case 19:return metal(90,82,418,320)+grindDisc(275,242,159,151)+handwheel(488,243,.97)+line('M433 242H488','#A4AC8C',13)+line('M489 274H541V319','#ABB291',9)
  case 20:return metal(49,87,502,308)+r(105,141,389,74,stone,28)+r(105,272,389,74,stone,28)+p(rep(14,n=>`M${121+n*27} 148v59M${121+n*27} 279v59 `),'none','#6C7C5E',2)+metal(60,145,38,198)+p('M155 87H449L404 142H201Z',wood)
  case 21:return metal(53,78,493,326)+grindDisc(300,242,188,163)+p('M473 123Q559 239 473 356L451 324Q518 242 451 160Z','#687F5C','#AFBB96',5)+line('M300 81V49H365V105','#A5AF8D',12)+e(487,330,9,10,'#3F593B')
  case 22:return metal(95,81,407,323)+grindDisc(263,237,143,140)+handwheel(486,204,.85)+line('M407 238H486V205','#A7B08F',12)+r(203,363,139,62,iron,9)+p('M218 376H327','none','#4C6246',6)
  case 23:return metal(44,65,512,352)+grindDisc(207,149,133,99)+grindDisc(207,335,133,83,4)+edgeWheel(468,240,149,0,iron)+line('M338 149H468M338 335H468','#A4AC8B',14)+p('M458 104V375M478 104V375','none','#60563D',5)+feet(60,81,481,320,iron)
  default:throw new Error('未知工坊磨盘构造。')
 }
}

const sawSlot=(x:number,y:number,h:number)=>r(x-5,y-6,10,h+12,'#3E4933',3)+p(rep(Math.floor(h/11),n=>`${n?'L':'M'}${x-3} ${y+n*11}l6 3-6 5 `),'none','#BCC3A9',2.5)
const frameSaw=(x:number,y:number,s=1,a=0)=>g(beam(-70,-62,140,18)+beam(-70,47,140,18)+beam(-71,-49,18,98)+beam(54,-49,18,98)+p('M-59 0H59','none','#ADB398',4)+p('M-60 2H60','none','#3D4C34',1.2)+line('M-79-52H79','#6E6346',2),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const log=(x:number,y:number,w:number,h:number)=>r(x,y,w,h,wood,h*.43)+p(`M${x+8} ${y+h*.24}q${w*.4}-8 ${w-16} 0M${x+8} ${y+h*.73}q${w*.4} 8 ${w-16} 0`,'none','#5D5037',3)+spots(x+w/2,y+h/2,w*.36,h*.27,70,5)+e(x+9,y+h/2,12,h*.39,'#B9A17A','#6C5D40',2)+e(x+9,y+h/2,6,h*.21,'none','#887550',1.3)
function sawbench(i:number):string {
 switch(i){
  case 0:return beam(98,68,30,346)+beam(472,68,30,346)+beam(59,105,482,37)+beam(59,341,482,37)+plank(51,162,499,70)+plank(51,249,499,70)+sawSlot(300,159,162)+frameSaw(300,240,.62,90)
  case 1:return beam(48,92,505,65)+beam(48,328,505,65)+beam(56,88,28,307)+beam(518,88,28,307)+r(85,169,429,146,'#4D593D',4)+sawSlot(300,139,202)+p('M86 183H514M86 303H514','none','#B29B73',2)
  case 2:return board(48,86,506,313)+frameSaw(297,242,1.8)+plank(65,125,55,238)+plank(477,125,55,238)+p('M123 144l33 47-33 23M474 346l-33-47 33-23',wood)
  case 3:return [132,300,468].map(x=>line(`M${x-64} 94L${x+65} 391M${x+64} 94L${x-65} 391`,wood,18)).join('')+log(49,173,503,139)+p('M172 178v124M413 178v124','none','#A99A72',7)+sawSlot(300,158,170)
  case 4:return line('M99 79L498 402M498 79L99 402',wood,22)+beam(75,110,450,42)+beam(75,328,450,42)+log(148,172,308,138)+sawSlot(300,151,180)+p('M183 199l83 21','none','#BDA47C',1.4)
  case 5:return board(43,88,515,307)+sawSlot(300,105,273)+woodenVice(107,241,.8,90)+woodenVice(494,241,.8,-90)+r(175,109,28,17,'#4B583C',3)+r(396,357,28,17,'#4B583C',3)
  case 6:return beam(67,80,27,320)+beam(508,80,27,320)+board(50,98,500,285)+line('M80 94L522 386M522 94L80 386','#8C8160',12)+beam(57,142,204,24)+sawSlot(319,117,251)+line('M79 157L246 266',wood,15)
  case 7:return slab(54,94,93,295)+slab(454,94,93,295)+board(79,115,442,256)+p(rep(15,n=>`M${114+n%5*95} ${149+Math.floor(n/5)*91}v7 `),'none','#48573C',6)+sawSlot(300,131,223)
  case 8:return leaf()+beam(111,105,28,274)+beam(462,105,28,274)+sawSlot(300,118,242)+line('M114 128Q304 76 487 128M113 352Q301 402 486 352','#A6AE7D',13)+plank(74,216,126,48)+plank(402,216,126,48)
  case 9:return poly(300,240,253,193,6,iron)+board(126,107,350,266)+sawSlot(301,119,243)+metal(100,143,61,43)+metal(439,143,61,43)+metal(100,295,61,43)+metal(439,295,61,43)+line('M176 105V373M425 105V373','#A8AC8E',9)
  case 10:return p('M66 99L206 65 341 91 494 70 545 132 513 369 400 415 253 384 82 414Z',wood)+line('M88 98Q32 244 92 399M501 97Q559 244 501 390','#C0AD85',22)+log(117,166,366,150)+line('M170 143V338M430 143V338','#AD9B70',12)+sawSlot(302,150,182)
  case 11:return poly(300,240,245,193,8,wood)+frameSaw(418,239,1.08,90)+ring(260,240,108,102,stone)+p('M141 241H369M261 130V350','none','#999A77',2)+vice(167,341,.49)
  case 12:return p('M47 111L133 63 218 111 300 60 383 111 468 63 553 111V396H47Z',wood)+sawSlot(299,135,243)+metal(44,139,31,231)+metal(526,139,31,231)+line('M98 199H501M98 291H501','#8F8667',10)
  case 13:return p('M43 235L157 68 301 123 444 68 557 235 474 413 300 354 126 413Z',wood)+sawSlot(300,117,240)+line('M156 101V367M445 101V367','#A4A27C',10)+[166,434].map(x=>[167,317].map(y=>vice(x,y,.43,90)).join('')).join('')+spots(300,241,120,62,70)
  case 14:return leaf()+frameSaw(301,236,1.68)+vice(518,242,.45,-90)+line('M61 241H87',wood,12)+spots(300,244,111,67,70)
  case 15:return plank(47,85,507,314,94)+e(91,242,47,74,wood)+e(509,242,47,74,wood)+woodenVice(300,351,.75)+sawSlot(299,119,212)+log(136,196,326,82)
  case 16:return board(48,88,507,309)+sawSlot(299,161,164)+edgeWheel(510,240,133,0,iron)+line('M305 241H510','#A0AA8B',13)+p('M500 116V365M520 116V365','none','#5A5039',5)+r(102,130,27,223,'#5B6448',4)
  case 17:return metal(50,86,504,313)+metal(405,91,83,294,12)+edgeWheel(448,152,87,0,iron)+edgeWheel(448,335,51,0,iron)+p('M437 79V380M459 79V380','none','#576548',5)+sawSlot(300,184,145)+line('M301 186H438','#A2AC8E',12)
  case 18:return board(70,87,462,308)+line('M145 310V147H436V278','#A2AC8B',16)+sawSlot(437,215,99)+handwheel(456,333,1.1)+line('M455 333L437 310','#A1AA8D',10)+r(121,123,47,211,iron,8)
  case 19:return board(45,76,513,328)+sawSlot(300,136,210)+metal(108,95,29,292,5)+metal(462,95,29,292,5)+p('M163 99V383M438 99V383','none','#56664A',4)+handwheel(535,240,.72)
  case 20:return board(44,114,512,253)+plank(118,143,364,197)+beam(122,142,357,25)+beam(122,312,357,25)+p('M188 142L288 337M256 142L356 337M348 142L248 337','none','#4F5C41',6)+plank(43,103,88,27)+plank(474,351,82,27)
  case 21:return line('M66 88H534V397H66Z','#9DA58C',14)+board(82,105,436,271)+sawSlot(291,156,170)+handwheel(503,241,1.03)+line('M299 241H503','#A4AA8A',11)+line('M496 267H547V315','#A9AF91',9)
  case 22:return board(43,73,514,336)+metal(57,196,486,42,5)+r(323,174,92,85,'#879377',9)+line('M368 214V351','#A6AF8F',17)+sawSlot(368,265,83)+handwheel(467,215,.72)+beam(59,92,483,29,iron)
  case 23:return line('M59 62H543M59 419H543M86 62V419M514 62V419','#A5AE90',11)+metal(44,74,513,335)+rep(8,n=>metal(73+n%2*286,93+Math.floor(n/2)*85,180,39,17)+p(rep(5,k=>`M${87+n%2*286+k*35} ${98+Math.floor(n/2)*85}v28 `),'none','#A9B194',1.1))+sawSlot(300,127,229)
  default:throw new Error('未知工坊锯台构造。')
 }
}

const latheBeds=(x:number,y:number,w:number,h:number,fill=iron)=>beam(x,y,w,27,fill)+beam(x,y+h-27,w,27,fill)+beam(x+23,y,23,h,fill)+beam(x+w-46,y,23,h,fill)+line(`M${x+51} ${y+h/2}H${x+w-51}`,'#A9B091',7)
const latheHeads=(x:number,y:number,w:number,fill=iron)=>metal(x,y-43,72,86,7)+p(`M${x+72} ${y-16}l39 16-39 16Z`,fill)+metal(x+w-74,y-34,74,68,7)+p(`M${x+w-74} ${y-15}l-32 15 32 15Z`,fill)
const cylinder=(x:number,y:number,w:number,h:number)=>metal(x,y,w,h,h*.28)+p(rep(11,n=>`M${x+14+n*(w-28)/10} ${y+10}v${h-20} `),'none','#616E56',2)+p(`M${x+12} ${y+7}h${w-24}`,'none','#C8C8AE',2)
function machine(i:number):string {
 switch(i){
  case 0:return latheBeds(55,159,491,190,wood)+latheHeads(64,252,474,wood)+line('M128 253L80 72H450',wood,13)+plank(249,374,159,55)+line('M270 374L304 251','#B0A27B',5)+p('M299 206V293','none','#6A6045',4)
  case 1:return board(70,83,460,317)+beam(275,101,49,280)+ring(300,241,67,56,iron)+line('M104 246Q300 127 496 246',wood,16)+p('M125 245H475','none','#6A5E41',4)+r(273,212,54,58,wood,5)+metal(291,225,18,34)
  case 2:return board(60,72,480,334)+beam(102,96,35,286)+beam(462,96,35,286)+beam(98,171,403,43)+ring(300,240,56,46,wood)+line('M90 240H511',wood,18)+r(257,281,86,84,wood,7)+p('M281 286v70m15-70v70m15-70v70','none','#685D3F',3)
  case 3:return board(57,68,486,343)+ring(300,241,109,95,wood)+line('M300 241H548M300 241H52M300 241V51M300 241V431',wood,24)+ring(484,241,44,73,wood)+p('M464 187v108m14-114v120m14-120v120m14-110v102','none','#CEBD94',2)+metal(281,223,38,36)
  case 4:return latheBeds(48,164,505,177,wood)+latheHeads(61,251,479,wood)+edgeWheel(116,171,112)+line('M116 253H163','#A5AA86',10)+plank(230,380,164,51)+line('M252 380L123 184','#A7A783',7)+p('M107 68V276M125 68V276','none','#6B5D40',4)
  case 5:return board(68,96,465,288)+edgeWheel(150,241,135,0,stone)+edgeWheel(450,241,135,0,stone)+line('M150 241H450','#9CA485',19)+metal(262,199,77,85,7)+line('M450 241H536V295','#A9B191',11)+p('M137 120v242M437 120v242','none','#C6C8AC',1.6)
  case 6:return beam(66,83,31,318)+beam(503,83,31,318)+beam(50,99,500,32)+beam(50,354,500,32)+edgeWheel(155,244,117)+edgeWheel(432,244,117)+line('M156 244H432','#A1A383',16)+r(245,213,102,61,wood,19)+p(rep(15,n=>`M${253+n*6} 218v51 `),'none','#CEBB92',1)+line('M432 245H551V304','#A9AB89',11)
  case 7:return board(49,76,504,333)+edgeWheel(119,240,154)+line('M119 240H479','#A3A383',16)+rep(2,n=>beam(273+n*145,113,42,264)+metal(256+n*145,178,77,73)+r(253+n*145,303,83,61,stone,5)+line(`M${294+n*145} 239V310`,'#ABA98B',14))+bolt(119,229)
  case 8:return leaf()+latheBeds(107,164,385,166,wood)+latheHeads(116,247,367,wood)+edgeWheel(126,168,105)+line('M111 81Q147 39 201 90',wood,14)+p('M118 76V279M135 76V279','none','#675B3E',4)
  case 9:return poly(300,240,251,193,6,iron)+metal(121,191,359,60,6)+p(rep(20,n=>`M${133+n*17} 202v13 `),'none','#C4C7AB',2)+metal(263,124,74,204,7)+ring(300,239,60,52,iron)+line('M137 310V251M467 310V251','#A5AD8B',7)+handwheel(137,310,.8)+handwheel(467,310,.8)
  case 10:return p('M65 98L205 66 341 90 494 70 546 132 513 370 400 414 254 383 82 414Z',wood)+beam(112,98,34,288)+beam(454,98,34,288)+line('M96 181H502','#BEAD85',26)+ring(301,241,58,52,iron)+line('M157 241H448','#A9A07C',19)+r(254,303,93,63,stone,6)
  case 11:return poly(300,240,246,192,8,iron)+ring(300,240,120,104,stone)+p('M208 240H393M300 162V318','none','#A3AD8A',2)+[0,1,2].map(n=>{const a=n*Math.PI*2/3-Math.PI/2;return handwheel(300+188*Math.cos(a),240+146*Math.sin(a),.7)+line(`M${300+133*Math.cos(a)} ${240+111*Math.sin(a)}L${300+167*Math.cos(a)} ${240+132*Math.sin(a)}`,'#A3AD8A',8)}).join('')
  case 12:return p('M47 113L133 64 218 113 300 60 383 113 467 64 553 113V396H47Z',wood)+latheBeds(83,181,435,168,iron)+latheHeads(96,264,409)+edgeWheel(120,166,100,0,iron)+p('M111 75V259M129 75V259','none','#675D41',5)
  case 13:return p('M43 236L156 70 300 125 443 70 557 236 475 414 300 354 125 414Z',iron)+cylinder(111,154,379,59)+cylinder(111,269,379,59)+handwheel(504,241,1)+line('M489 183H504V298H489','#A8B08F',11)+metal(83,165,24,151)+line('M111 241H488','#B3B899',8)
  case 14:return p('M300 49Q381 61 395 132Q491 105 529 184Q560 266 477 308Q504 394 410 421Q329 438 300 363Q269 441 186 420Q94 391 124 308Q40 263 73 183Q111 104 205 132Q221 59 300 49Z',wood)+beam(277,98,47,266)+ring(300,242,72,60,stone)+line('M155 209Q301 115 446 209',wood,13)+metal(282,209,37,53)+p('M171 209H431','none','#756949',4)
  case 15:return p('M56 244Q66 75 300 75Q535 77 546 244Q532 412 300 408Q70 410 56 244Z',wood)+latheBeds(103,180,397,168,wood)+edgeWheel(137,154,99)+edgeWheel(463,154,99)+woodenVice(201,298,.6,90)+woodenVice(403,298,.6,-90)+line('M137 154H463','#A3A47F',13)
  case 16:return metal(42,101,516,282)+latheBeds(55,164,490,162,iron)+latheHeads(67,244,463)+edgeWheel(113,150,101,0,iron)+metal(274,181,97,128,6)+handwheel(323,340,.73)+p('M103 59V244M123 59V244','none','#675F43',5)
  case 17:return metal(94,67,411,349)+metal(256,97,88,237,15)+ring(300,267,133,105,iron)+metal(280,234,41,66)+line('M300 137H482','#A8B18F',9)+[0,1,2].map(n=>{const a=n*Math.PI*2/3;return line(`M482 137L${482+61*Math.cos(a)} ${137+53*Math.sin(a)}`,'#A9B496',8)+e(482+61*Math.cos(a),137+53*Math.sin(a),9,9,wood)}).join('')
  case 18:return metal(49,78,503,326)+metal(91,149,361,159,21)+r(175,177,339,101,'#8B947B',12)+vice(458,241,.66,90)+edgeWheel(131,241,145,0,iron)+line('M461 242H523M313 308V361','#A9B08E',11)+handwheel(313,361,.83)
  case 19:return metal(66,65,469,351)+metal(199,90,202,214,28)+edgeWheel(448,213,136,0,iron)+line('M300 213H448','#A5AE8B',19)+metal(229,312,143,76)+line('M300 258V325','#B1B99A',16)+bolt(448,201)
  case 20:return metal(62,71,476,338)+metal(256,98,91,274,8)+metal(121,210,359,76,8)+metal(170,192,257,111,7)+handwheel(300,391,.73)+handwheel(102,248,.73)+handwheel(500,248,.73)+line('M124 248H172M427 248H477','#ADB496',10)
  case 21:return metal(46,94,509,294)+cylinder(156,159,287,165)+metal(95,186,74,111,8)+edgeWheel(466,242,164,0,iron)+edgeWheel(129,242,164,0,iron)+line('M101 242H490','#A4AE8D',20)+metal(234,128,96,39,6)+ring(282,149,17,14,iron)+line('M442 178H538V129','#AAB494',16)
  case 22:return metal(49,99,503,283)+cylinder(145,150,293,180)+edgeWheel(490,241,139,0,iron)+line('M437 241H490','#AAB493',19)+metal(112,191,48,101)+r(204,130,176,28,'#8B9477',6)+p('M183 170v136M413 170v136','none','#BCC2A7',3)+p('M479 115V367M501 115V367','none','#635C41',5)
  case 23:return metal(45,81,513,321)+cylinder(147,113,287,93)+cylinder(147,280,287,93)+edgeWheel(485,243,152,0,iron)+line('M434 160H485M434 327H485','#A8B090',18)+line('M132 160H73V327H132M73 241H31','#A7B290',17)+handwheel(73,241,.65)
  default:throw new Error('未知工坊机床构造。')
 }
}

const hammer=(x:number,y:number,s=1,a=0)=>g(plank(-9,-12,18,166,8)+metal(-58,-48,116,53,6)+p('M-51-40h100','none','#C5C6AC',2),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const chisel=(x:number,y:number,s=1,a=0)=>g(plank(-14,12,28,94,7)+p('M-9 12V-66L-20-91H20L9-66V12Z',iron)+p('M-14-87h28','none','#D0D1B5',2),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const pliers=(x:number,y:number,s=1,a=0)=>g(p('M-38-100L-12-43 16 31 44 124M38-100L12-43-16 31-44 124','none','#3F4A34',16)+p('M-38-100L-12-43 16 31 44 124M38-100L12-43-16 31-44 124','none','#A0AA8A',11)+e(0,0,13,13,iron)+bolt(0,0),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
function gear(x:number,y:number,rx:number,ry:number,n:number,fill=iron):string {
 return p(rep(n,k=>{const a=k*2*Math.PI/n;return rep(4,j=>{const b=a+(j-.5)*Math.PI/n,rr=j===1||j===2?1:.87;return`${k||j?'L':'M'}${num(x+rx*rr*Math.cos(b))} ${num(y+ry*rr*Math.sin(b))}`})})+'Z',fill)+e(x,y,rx*.37,ry*.37,'#596C4B','#BAC0A1',3)+e(x,y,rx*.16,ry*.16,'#31452E','#8C9B79',2)+spots(x,y,rx*.65,ry*.65,65,3)
}
function craftTool(i:number):string {
 switch(i){
  case 0:return hammer(153,137,1.35,-14)+hammer(352,239,.92,18)+chisel(483,267,1.16,9)+p('M273 336l39-54 36 18-15 67Z',iron)
  case 1:return plank(62,109,289,150,36)+r(171,125,97,114,'#48553D',5)+p('M193 220l-14-64h80l-13 64Z',iron)+p('M382 77H430V333H549V381H382Z',wood)+p('M397 92v267H532','none','#D5BD93',1.5)+p('M140 328q134-35 124 56','none','#9D9870',3)+p('M248 372l-20 47h43Z',iron)
  case 2:return pliers(124,236,.98,-18)+pliers(300,210,.93,2)+g(pliers(0,0,.89),'translate(475 253) rotate(20)')
  case 3:return plank(59,105,108,247,37)+p('M81 128l45-9 17 79-37 88-31-29Z','#B9A67D')+plank(191,151,63,230,23)+chisel(448,264,.91,-11)+line('M278 115H390V349H278','#B9A984',11)+p('M289 119V344','none','#AAB395',2.5)+e(447,157,28,34,'none','#AEB698',8)
  case 4:return chisel(107,244,.96,-17)+chisel(239,214,.91,7)+chisel(359,252,1.01,19)+poly(486,147,48,42,6,iron)+r(465,190,41,68,wood,10)+hammer(473,335,.57,43)
  case 5:return p('M70 131L88 99 105 132 95 364 77 364Z','#C6B891')+p('M65 145h44','none','#83734F',2)+plank(177,232,26,150,8)+metal(149,177,84,60,5)+p('M154 181V132M175 181V132M196 181V132M217 181V132','none','#A1AC8C',9)+hammer(358,190,.86,-16)+ring(486,291,59,71,wood)+p(rep(13,n=>`M${439+n*7} 254v73 `),'none','#D7C69E',1)
  case 6:return p('M91 80L66 139 95 165V372H129V165L157 138 129 80 113 114Z',iron)+p('M253 107H324V148H277V342H248V173H230V136Z',iron)+p('M383 80H411V363H503V337H406V321H483V301H406Z',iron)+plank(505,252,23,145,7)+p('M511 252V112H523V252Z',iron)+spots(288,245,111,75,55)
  case 7:return chisel(91,229,1.1,-8)+chisel(192,228,1.05,4)+chisel(300,230,1,13)+pliers(425,224,.95,-3)+plank(522,273,24,119,7)+p('M528 273V123H540V273Z',iron)
  default:throw new Error('未知工坊工具组构造。')
 }
}
function progress(i:number):string {
 switch(i){
  case 0:return rep(5,n=>g(plank(-33,-144,66,288,20)+p('M-27-127q-15 124 0 254','none','#CFB68C',2),`translate(${97+n*91} ${218+(n%2)*30}) rotate(${(n-2)*6})`))+e(166,371,107,44,'none','#778265',9)+e(434,117,99,42,'none','#778265',9)
  case 1:return ring(162,250,113,140,'#AB9672')+e(162,250,80,104,'#6B7350','#CEB58B',4)+ring(427,194,96,113,'#AA9270')+e(427,194,47,54,'#4D5E40','#C7AF87',8)+line('M336 141Q285 142 307 228L336 244','#B69D76',15)+e(422,374,101,48,'#B4A17A','#7C7652',2)+e(422,374,71,30,'none','#D1BF98',2)
  case 2:return plank(45,94,390,62)+p('M435 106H482V142H435Z',wood)+plank(76,241,63,160)+plank(137,338,325,63)+p('M119 242v-47h29v47Z',wood)+plank(329,221,161,51)+p('M491 229h49v34h-49Z',wood)+p('M175 274l32-31 31 61Z',wood)+p('M295 135l31-19 19 45Z',wood)
  case 3:return metal(64,81,420,40,5)+metal(100,168,433,46,7)+metal(55,263,371,57,7)+line('M496 286Q552 299 526 368L459 392','#8F967A',24)+metal(88,372,221,31,4)+rep(6,n=>p(`M${110+n*34} 374v-40`,'none','#B7C0A0',6))+spots(300,243,141,82,80)
  case 4:return p('M152 86L450 97 524 204 459 400 136 387 77 196Z',leather)+rep(15,n=>{const x=155+n%5*62+(Math.floor(n/5)%2)*15,y=151+Math.floor(n/5)*76;return p(`M${x-23} ${y-19}h46l-3 37-20 14-21-14Z`,n%3?'#8E987C':'#A6AE90')+bolt(x,y-10)})+rep(9,n=>bolt(93+n*52,422-n%3*5))+p('M108 192l19 7m-11 25 18 5','none','#D5BA90',2)
  case 5:return p('M71 123L189 75 330 97 471 71 544 143 514 364 386 415 251 383 81 415Z',stone)+p('M127 148H431L393 211H268V320H141','none','#586F4E',9)+p('M131 151H428M270 214V317','none','#BDCAA5',2)+poly(385,307,61,52,6,iron)+p('M431 114l54 22-27 58-59-28Z','#B9B18C')+spots(300,241,184,117,110)
  case 6:return gear(181,180,128,122,15)+gear(437,320,109,101,12)+cylinder(72,340,214,53)+metal(354,80,171,87,5)+r(387,93,104,61,'#4A6042',8)+line('M282 111L315 206','#ADAF8D',17)+spots(303,244,123,66,70)
  case 7:return beam(72,85,455,40)+beam(72,85,40,315)+beam(487,85,40,315)+beam(72,360,455,40)+plank(146,151,302,154)+g(p('M-44-32H42V-9H-18V52H43V76H-44Z',iron)+line('M42 3V87M16 85H66','#A6B08F',9),'translate(111 217)')+g(p('M-44-32H42V-9H-18V52H43V76H-44Z',iron)+line('M42 3V87M16 85H66','#A6B08F',9),'translate(488 272) rotate(180)')
  default:throw new Error('未知工坊半成品构造。')
 }
}

export const WORKSHOP_COLLECTION_LICENSE_REF='MIT-Sceneweave-Workshop-Collection-1'
export const WORKSHOP_COLLECTION_LICENSE=`Sceneweave Workshop Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG interpretations of craft equipment and period machinery, authored with coding assistance. No third-party artwork or pixels are embedded. Illustrative interpretations; technical source checks and visual acceptance are separate. Artwork does not create functional machinery, fires, buildings or traversal.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const defs=`<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="30%" y2="100%"><stop offset="0%" stop-color="#B39C74"/><stop offset="26%" stop-color="#A48B61"/><stop offset="75%" stop-color="#8C7952"/><stop offset="100%" stop-color="#746444"/></linearGradient>
<linearGradient id="iron" x1="0%" y1="0%" x2="65%" y2="100%"><stop offset="0%" stop-color="#ABA996"/><stop offset="17%" stop-color="#8F9481"/><stop offset="63%" stop-color="#727D65"/><stop offset="100%" stop-color="#515E49"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#B2AE94"/><stop offset="37%" stop-color="#9DA388"/><stop offset="80%" stop-color="#879577"/><stop offset="100%" stop-color="#6C7D60"/></linearGradient>
<linearGradient id="leather" x1="0%" y1="0%" x2="70%" y2="100%"><stop offset="0%" stop-color="#B09A74"/><stop offset="22%" stop-color="#9D845D"/><stop offset="71%" stop-color="#8B7650"/><stop offset="100%" stop-color="#6C6241"/></linearGradient>
<linearGradient id="cloth" x1="0%" y1="0%" x2="70%" y2="100%"><stop offset="0%" stop-color="#C0B390"/><stop offset="48%" stop-color="#A99D79"/><stop offset="100%" stop-color="#918C67"/></linearGradient>
</defs>`
function artwork(design:WorkshopDesign,index:number):VisualSampleArt {
 const detail=design.category==='craft-tool'||design.category==='work-in-progress'
 const draw=({workbench,anvil,forge,bellows,loom,'spinning-wheel':spinning,kiln,millstone,sawbench,'machine-tool':machine,'craft-tool':craftTool,'work-in-progress':progress})[design.category]
 return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
  sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm/600} ${design.heightMm/480})">${draw(index)}</g></svg>`,
  footprintMm:{width:design.widthMm,height:design.heightMm},blocksMovement:!detail,blocksSight:false,renderLayer:'object',shadowClass:detail?'none':'furniture',
  tags:['原创','工坊生产',design.category,design.era,design.design,'俯视','独立物件','保守矩形占地','无实际机器运转或炉火能力']}
}
export const WORKSHOP_COLLECTION_ART:readonly VisualSampleArt[]=freezeJson(WORKSHOP_DESIGNS.map(design=>artwork(design,WORKSHOP_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
