import { TRANSPORT_DESIGNS, type TransportDesign } from '../assets/transport-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

const ink='#3D4038',wood='url(#wood)',metal='url(#metal)',brass='url(#brass)',stone='url(#stone)',canvas='url(#canvas)',water='#7DABA7'
const rep=(n:number,f:(i:number)=>string)=>Array.from({length:n},(_,i)=>f(i)).join('')
const num=(n:number)=>Math.round(n*100)/100
const p=(d:string,fill='none',stroke=ink,sw=2.7)=>`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
const r=(x:number,y:number,w:number,h:number,fill:string,rad=5,stroke=ink,sw=2.7)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const e=(x:number,y:number,rx:number,ry:number,fill:string,stroke=ink,sw=2.7)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g=(body:string,transform:string)=>`<g transform="${transform}">${body}</g>`
const line=(d:string,color='#9EA58D',sw=10)=>p(d,'none',ink,sw+4)+p(d,'none',color,sw)+p(d,'none','#CDC9AC',1.1)
const poly=(x:number,y:number,rx:number,ry:number,n:number,fill:string,angle=-Math.PI/2)=>p(rep(n,i=>{const a=i*Math.PI*2/n+angle;return`${i?'L':'M'}${num(x+rx*Math.cos(a))} ${num(y+ry*Math.sin(a))}`})+'Z',fill)
function wear(x:number,y:number,rx:number,ry:number,n=60,seed=1):string {
 const paths=['',''];for(let i=0;i<n;i++){const a=(i+seed)*2.399963,s=Math.sqrt((i+.5)/n);paths[i%2]+=`M${num(x+Math.cos(a)*rx*s)} ${num(y+Math.sin(a)*ry*s)}l${1+i%4} ${i%3-1} `}
 return `<g opacity=".28">${p(paths[0],'none','#E2D2AC',.9)+p(paths[1],'none','#4C513E',.8)}</g>`
}
const bolt=(x:number,y:number)=>e(x,y,3.8,3.8,'#B9BCA2','#5C6A51',1)+p(`M${x-2} ${y}h4`,'none','#617056',.8)
const bolts=(x:number,y:number,w:number,h:number)=>[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([a,b])=>bolt(a,b)).join('')
function timber(x:number,y:number,w:number,h:number,rad=6):string {
 return r(x,y,w,h,wood,rad)+p(rep(11,i=>`M${x+10} ${num(y+13+(h-26)*i/10)}q${num((w-20)*.22)} ${i%3-1} ${num((w-20)*.48)} 0t${num((w-20)*.5)} 0 `),'none','#C5AD80',.9)+wear(x+w/2,y+h/2,w*.36,h*.34,45)
}
const steel=(x:number,y:number,w:number,h:number,rad=7)=>r(x,y,w,h,metal,rad)+wear(x+w/2,y+h/2,w*.34,h*.34)+bolts(x+Math.min(w*.15,12),y+Math.min(h*.15,12),w-Math.min(w*.3,24),h-Math.min(h*.3,24))
const ring=(x:number,y:number,rx:number,ry=rx,fill=metal)=>e(x,y,rx,ry,fill)+e(x,y,rx*.78,ry*.78,'none','#C7CBB0',1.8)+wear(x,y,rx*.65,ry*.65,30)
const planks=(x:number,y:number,w:number,h:number,n=8)=>timber(x,y,w,h)+p(rep(n-1,i=>`M${num(x+(i+1)*w/n)} ${y+4}v${h-8} `),'none','#6D6143',2)+bolts(x+13,y+13,w-26,h-26)
const seat=(x:number,y:number,w:number,h:number)=>r(x,y,w,h,canvas,14)+r(x+7,y+7,w-14,h-14,'none',9,'#B6BEA2',1.3)+wear(x+w/2,y+h/2,w*.35,h*.25,35)
const barrel=(x:number,y:number,rx=48,ry=rx)=>ring(x,y,rx,ry,wood)+e(x,y,rx*.91,ry*.91,'none','#6C7353',5)+p(`M${x-rx*.6} ${y}h${rx*1.2}`,'none','#C2AA7C',1.2)+e(x+rx*.25,y-ry*.2,5,5,wood)
const crate=(x:number,y:number,w:number,h:number)=>planks(x,y,w,h,5)+line(`M${x+9} ${y+9}L${x+w-9} ${y+h-9}M${x+w-9} ${y+9}L${x+9} ${y+h-9}`,'#B39C70',10)
const cord=(d:string)=>p(d,'none','#5B6348',5)+p(d,'none','#C5B78C',2.4)
const coil=(x:number,y:number,rx=46,ry=rx)=>p(rep(4,n=>`M${x+rx-n*8} ${y}a${rx-n*8} ${ry-n*7} 0 1 1 ${-2*(rx-n*8)} 0a${rx-n*8} ${ry-n*7} 0 1 1 ${2*(rx-n*8)} 0 `),'none','#C5B991',3)
/** A vertically oriented wheel has a narrow longitudinal top projection, never a face-on spoke disk. */
const tyre=(x:number,y:number,w=22,h=112)=>r(x-w/2,y-h/2,w,h,'#40493D',w*.4)+p(`M${x-w*.22} ${y-h*.42}v${h*.84}M${x+w*.22} ${y-h*.42}v${h*.84}`,'none','#8E9580',1.5)
const axle=(y:number,x1=105,x2=495)=>line(`M${x1} ${y}H${x2}`,'#8D9479',12)+tyre(x1,y)+tyre(x2,y)
const wagonBase=(long=false)=>line('M238 248L213 41M362 248L387 41',wood,18)+axle(322)+axle(long?665:615)+planks(144,235,312,long?477:434,9)+line(`M146 239V${long?708:665}M454 239V${long?708:665}`,wood,14)
const grille=(x:number,y:number,w:number,h:number,n=9)=>r(x,y,w,h,'#57644D',2)+p(rep(n,i=>`M${num(x+6+i*(w-12)/(n-1))} ${y+5}v${h-10} `),'none','#B1B89C',3)
function wagon(i:number):string {
 const base=wagonBase([2,8,13].includes(i))
 switch(i){
 case 0:return base+line('M153 269H447M153 628H447',wood,13)
 case 1:return base+p('M165 266H435L419 645H181Z',wood)+p('M178 287H422M300 281V627M183 619H417','none','#C6B080',9)+line('M178 638H423','#839276',12)
 case 2:return base+line('M141 249V708M459 249V708',wood,20)+p(rep(9,n=>`M118 ${278+n*46}h47M435 ${278+n*46}h47 `),'none','#BAA275',10)+r(176,291,249,362,canvas,20)+cord('M176 347H425M176 573H425')
 case 3:return base+rep(6,n=>barrel(225+n%2*151,320+Math.floor(n/2)*137,61,53))+line('M152 273H446M152 645H446',wood,15)
 case 4:return base+r(160,269,280,358,canvas,48)+p(rep(5,n=>`M169 ${292+n*77}Q300 ${266+n*77} 431 ${292+n*77} `),'none','#BEC4A5',6)+line('M174 268H426M174 630H426','#B4AF88',16)
 case 5:return base+seat(173,285,255,99)+seat(173,512,255,99)+line('M162 403V496M438 403V496',wood,11)+planks(195,411,212,77,5)
 case 6:return base+seat(180,249,240,76)+p('M185 350H415L443 400V580L415 634H185L158 580V400Z',wood)+p('M184 371H416V613H184Z',canvas,'#B4B89B',5)+line('M186 483H414',wood,12)+crate(202,645,196,63)
 case 7:return base+grille(163,304,275,322,13)+p(rep(6,n=>`M170 ${328+n*54}H430 `),'none','#ADB696',7)+line('M156 304H443M156 626H443','#8B9A7A',14)+seat(180,246,239,47)
 case 8:return base+r(173,295,254,361,'#7F9E88',15)+p('M214 322H386L412 371V599L386 634H214L187 599V371Z',wood)+line('M186 319V647M414 319V647','#B1B495',13)+[315,637].map(y=>line(`M180 ${y}H421`,'#A8AE8E',12)).join('')+seat(185,246,230,42)
 case 9:return base+p('M164 304L203 276H397L436 304V625H164Z',metal)+p('M199 288V610M401 288V610M172 451H430','none','#B6BEA0',4)+rep(6,n=>poly(n%2?457:143,353+Math.floor(n/2)*99,23,43,5,brass))+seat(196,239,208,54)
 case 10:return base+p('M174 325L300 278L426 325V604L300 644L174 604Z',wood)+line('M300 283V638M181 461H419',brass,14)+poly(300,457,46,56,4,brass)+planks(177,644,247,48,5)
 case 11:return base+p('M171 286H429L447 612L405 646H194L153 610Z',metal)+p('M196 313H404L421 598H178Z','#707D5C')+wear(300,454,94,110,105)+line('M160 604H442','#A5AF8F',20)+line('M190 642V669M410 642V669','#A9B394',12)
 case 12:return base+r(190,286,221,339,wood,80)+p('M207 313Q300 288 394 313M197 445Q300 425 404 445M206 598Q300 623 394 598','none','#879273',14)+ring(300,350,36,32,wood)+line('M301 623V678H359','#A5AF8E',12)
 case 13:return base+[211,300,389].map((x,n)=>r(x-37,253+n%2*13,74,440,wood,32)+p(rep(6,k=>`M${x-23+k*9} ${275+n%2*13}q${k%2?12:-9} 190 0 390 `),'none','#C0A16B',1)).join('')+line('M158 314H442M158 630H442',wood,25)+cord('M174 290L425 655M425 290L174 655')
 case 14:return base+crate(165,280,122,324)+crate(313,280,122,324)+rep(7,n=>line(`M${188+n*37} 310V573`,'#C4B38A',4))+line('M163 437H437','#A3AF8C',17)
 case 15:return base+line('M150 303H49V624H150M450 303H551V624H450',wood,10)+r(37,301,123,326,canvas,5)+r(440,301,123,326,canvas,5)+p('M53 316H145V612M455 316H548V612','none','#BBC2A4',4)+crate(173,327,253,281)
 case 16:return base+rep(6,n=>grille(167+n%2*139,280+Math.floor(n/2)*116,128,104,8))+line('M301 271V627',wood,14)
 case 17:return base+poly(300,465,123,154,8,metal)+[0,1,2].map(n=>{const a=n*Math.PI*2/3;return line(`M300 465L${num(300+116*Math.cos(a))} ${num(465+141*Math.sin(a))}`,brass,16)}).join('')+poly(300,465,60,90,6,'#89B0A4')+poly(300,464,27,53,4,'#BDCEB0')+seat(184,246,232,53)
 case 18:return base+[232,368].map(x=>r(x-54,295,108,314,wood,48)+p(rep(4,n=>`M${x-51} ${322+n*85}h102 `),'none','#8B9677',12)).join('')+line('M167 289H433M167 617H433',wood,18)
 case 19:return base+seat(173,256,255,79)+steel(164,371,272,270)+line('M300 378V635','#BAC09E',11)+r(181,423,100,20,'#53644B',2)+r(320,423,100,20,'#53644B',2)+crate(454,393,47,182)
 default:throw Error('未知四轮马车构造')
 }
}
const cartBase=(one=false,four=false)=>line('M187 325L153 66M413 325L447 66',wood,17)+(one?line('M300 549V673',wood,18)+tyre(300,693,28,115):axle(507,111,489))+(four?axle(300,111,489):'')+planks(156,257,288,359,7)
function handcart(i:number):string {
 const base=cartBase(i<2,i===18||i===19)
 switch(i){
 case 0:return base+p('M177 292H423L402 570H198Z',wood)+p('M191 307H410L390 553H211Z','#8D835C')+line('M178 289H422',wood,15)
 case 1:return base+p('M167 279H433L374 620H226Z',metal)+p('M185 300H415L360 597H241Z','#68785A')+wear(300,445,60,105,90)
 case 2:return base+line('M172 278H428M172 595H428',wood,14)
 case 3:return base+timber(172,282,256,307)+r(187,298,226,275,'#7C7751',4)+line('M300 297V576M184 563H416',wood,12)
 case 4:return base+barrel(300,439,112,130)+line('M189 435H411','#9BA587',15)
 case 5:return base+r(189,289,222,300,wood,73)+p('M201 323H399M195 437H405M201 555H399','none','#8C9878',14)+line('M300 589V644H350','#ADAF8E',11)
 case 6:return base+line('M150 254V620M450 254V620',wood,20)+p(rep(7,n=>`M125 ${290+n*47}h51M424 ${290+n*47}h51 `),'none','#C0A879',11)+r(180,302,239,257,canvas,19)+cord('M180 361H420M180 505H420')
 case 7:return base+line('M171 295H430M171 578H430','#9CA68A',18)+poly(300,439,103,125,6,stone)+wear(300,435,73,84,100)
 case 8:return base+crate(176,283,113,286)+crate(308,283,113,140)+crate(308,439,113,130)
 case 9:return base+[366,516].map(y=>ring(300,y,113,65,metal)+e(300,y,94,48,water)+p(`M226 ${y}q74 -23 148 0`,'none','#C4D7BC',2)).join('')+line('M178 439H423',wood,14)
 case 10:return base+line('M158 288H57V610H158M442 288H543V610H442',wood,9)+r(41,286,118,327,canvas)+r(441,286,118,327,canvas)+crate(175,306,248,271)
 case 11:return base+ring(300,366,103,93,metal)+ring(300,366,71,65,'#544A35')+barrel(234,538,47,44)+barrel(365,538,47,44)+line('M174 465H426','#A7AF8F',11)
 case 12:return base+poly(300,443,119,155,6,wood)+poly(300,443,95,129,6,canvas)+line('M300 292V593',brass,10)+poly(300,443,36,41,4,brass)
 case 13:return base+p('M174 287H426L414 564L379 597H222L186 564Z',metal)+p('M196 311H404L390 551H210Z','#6F7F60')+wear(300,430,80,93,115)+line('M184 566H416','#A7AF92',16)
 case 14:return base+rep(6,n=>r(177+n%2*130,285+Math.floor(n/2)*98,115,86,wood)+p(rep(7,k=>`M${187+n%2*130+k*13} ${298+Math.floor(n/2)*98}q${k%2?13:-10} 28 0 52 `),'none',n%2?'#77926D':'#A9B287',4))+crate(449,337,43,194)
 case 15:return base+rep(12,n=>barrel(212+n%3*88,314+Math.floor(n/3)*76,31,28))+cord('M179 440H422')
 case 16:return base+line('M172 284H429M173 291V602M426 291V602','#ADB69A',16)+crate(186,359,228,216)+line('M169 296H131V226H470V296','#ADB69A',13)
 case 17:return base+rep(4,n=>ring(225+n%2*150,357+Math.floor(n/2)*159,62,65,metal)+ring(225+n%2*150,357+Math.floor(n/2)*159,35,37,metal))+line('M173 437H427','#AEB797',10)
 case 18:return base+line('M151 262H112V181H488V262M151 615H112V682H488V615','#B4BBA0',13)+line('M171 282H428M171 589H428','#9BA98B',9)
 case 19:return base+line('M156 269Q300 150 444 269M156 607Q300 724 444 607','#B3BBA0',17)+seat(178,304,244,259)+cord('M181 421H418')+r(215,365,170,123,wood,15)+line('M300 370V482','#697355',10)
 default:throw Error('未知手车构造')
 }
}
function hull(w=370,flat=false):string {
 const left=300-w/2,right=300+w/2
 const d=flat?`M${left+21} 97H${right-21}L${right} 159V685L${right-23} 741H${left+23}L${left} 685V159Z`:`M300 42Q${right+15} 133 ${right} 451Q${right} 663 300 754Q${left} 663 ${left} 451Q${left-15} 133 300 42Z`
 return p(d,wood)+p(flat?`M${left+22} 120H${right-22}V715H${left+22}Z`:`M300 75Q${right-9} 151 ${right-22} 450Q${right-24} 647 300 725Q${left+24} 647 ${left+22} 450Q${left+9} 151 300 75Z`,'#7C7953','#C0AC7C',7)+p(rep(9,n=>`M${num(left+w*.18+n*w*.64/8)} ${flat?188:188+Math.abs(n-4)*28}V${flat?650:650-Math.abs(n-4)*20} `),'none','#AD9468',1.7)+wear(300,427,w*.26,239,100)
}
const bench=(y:number,w=260)=>planks(300-w/2,y,w,28,5)
const oar=(x:number,y:number,a:number)=>g(line('M0 0V128',wood,7)+r(-10,107,20,61,wood,10),`translate(${x} ${y}) rotate(${a})`)
const mast=(x=300,y=388)=>cord(`M${x} ${y}L245 175M${x} ${y}L355 175M${x} ${y}L245 640M${x} ${y}L355 640`)+line(`M${x-112} ${y-79}L${x+104} ${y+105}`,wood,12)+p(`M${x-106} ${y-69}L${x+95} ${y+102}L${x+106} ${y+90}L${x-97} ${y-83}Z`,canvas)+ring(x,y,19,21,wood)
function boat(i:number):string {
 switch(i){
 case 0:return hull(402)+bench(261)+bench(461)+bench(617,210)+oar(155,339,-10)+oar(445,339,10)
 case 1:return hull(335)+bench(264,229)+bench(460,240)+line('M220 556H380',wood,9)+oar(174,370,-35)+oar(426,370,35)
 case 2:return hull(398,true)+bench(206)+bench(601)+line('M454 138V696',wood,8)+p('M168 328H431M168 469H431','none','#B9A477',7)
 case 3:return hull(278)+bench(255,188)+bench(432,213)+bench(610,160)+oar(193,345,-5)
 case 4:return e(300,399,241,274,wood)+e(300,399,218,250,'#8C835C','#B7A373',8)+p(rep(20,n=>`M${122+n*19} ${num(400-Math.sqrt(Math.max(0,220*220-(122+n*19-300)**2)))}V${num(400+Math.sqrt(Math.max(0,220*220-(122+n*19-300)**2)))} `),'none','#BBA377',2)+p(rep(12,n=>`M133 ${190+n*39}Q300 ${225+n*33} 466 ${190+n*39} `),'none','#70674B',2)+bench(383,362)+oar(450,267,18)
 case 5:return hull(446,true)+planks(130,119,340,115,8)+planks(130,614,340,103,8)+r(155,264,290,320,'#606B4B',3)+crate(170,282,115,276)+crate(307,282,119,132)+barrel(367,510,56,58)
 case 6:return hull(397)+bench(213)+planks(178,532,244,121,6)+line('M155 357H442M155 434H442',wood,10)+p(rep(8,n=>`M${170+n*34} 357L${186+n*29} 433 `),'none','#B6B393',1.6)+p('M161 359L435 432M435 359L161 432','none','#BAC09F',1.4)+coil(299,600,49,39)+oar(151,281,-6)
 case 7:return hull(374)+planks(203,164,194,99,6)+planks(194,558,212,92,6)+seat(214,577,172,55)+mast()+cord('M300 388L300 97M300 388L300 699')
 case 8:return hull(288)+rep(6,n=>oar(188,222+n*66,64)+oar(412,222+n*66,-64))+rep(6,n=>bench(230+n*65,203))+mast(300,405)+poly(300,97,16,42,4,wood)+poly(300,711,17,29,4,wood)
 case 9:return hull(270)+rep(9,n=>oar(187,172+n*54,63)+oar(413,172+n*54,-63))+rep(8,n=>bench(196+n*53,197))+planks(213,94,174,84,5)+planks(208,649,184,73,5)+mast(300,403)
 case 10:return hull(448,true)+rep(4,n=>bench(235+n*103,370))+line('M112 145V694M488 145V694',wood,12)+line('M161 119V715',wood,7)
 case 11:return hull(371,true)+p('M199 215L300 174L401 215V590L300 625L199 590Z',canvas)+line('M300 183V617',wood,14)+planks(153,119,294,63,7)+planks(153,646,294,67,7)+barrel(208,675,26,25)
 case 12:return g(hull(170),'translate(-139 0)')+g(hull(170),'translate(139 0)')+line('M153 287H446M153 551H446',wood,21)+r(190,309,221,219,canvas,4)+p(rep(8,n=>`M${203+n*27} 313V522M193 ${321+n*28}H407 `),'none','#B8B491',1.5)
 case 13:return g(hull(220),'translate(-71 0)')+p('M484 147Q559 273 548 531Q534 627 484 680Q449 584 455 391Q448 234 484 147Z',wood)+line('M243 247Q369 210 485 257M243 432H483M243 609Q369 644 485 596',wood,14)+g(bench(304,150)+bench(522,157),'translate(-71 0)')
 case 14:return p('M300 64Q463 149 459 600Q420 686 300 735Q180 686 141 600Q137 149 300 64Z',canvas)+p(rep(13,n=>`M${204+n*16} ${num(155+Math.abs(n-6)*28)}Q${num(210+n*15)} 400 ${num(212+n*14.7)} ${num(685-Math.abs(n-6)*9)} `),'none','#BBA77B',3)+cord('M171 273Q300 304 429 273M153 473Q300 503 447 473M188 640Q300 658 412 640')+bench(366,252)
 case 15:return hull(379)+poly(300,398,129,184,6,canvas)+line('M300 222V569M184 304L414 490M416 304L184 490',wood,12)+seat(214,601,173,62)+planks(213,151,173,61,5)
 case 16:return hull(393)+steel(203,159,194,178,40)+r(201,368,198,182,wood,13)+r(216,384,168,147,metal,8)+ring(299,268,40,38,metal)+ring(299,268,24,23,'#4B5843')+seat(210,592,181,65)+cord('M151 435H186M414 435H449')
 case 17:return hull(410)+rep(6,n=>bench(211+n*76,302))+p('M168 167Q130 400 170 641M432 167Q470 400 430 641','none',canvas,25)+oar(153,274,1)+oar(446,274,-1)
 case 18:return hull(451)+planks(162,163,276,100,7)+steel(195,296,210,178,19)+ring(300,384,40,40,metal)+ring(300,384,25,25,'#455740')+planks(167,505,267,149,7)+ring(300,589,39,36,metal)+cord('M300 608V687')+coil(397,621,25,25)
 case 19:return hull(393)+planks(200,143,201,131,6)+r(188,309,225,113,'#465C45',14)+seat(203,331,195,67)+r(184,476,233,113,'#465C45',14)+seat(201,499,200,67)+planks(209,621,183,76,6)+line('M193 313H408M189 481H413','#B8C1A3',8)
 default:throw Error('未知舟船构造')
 }
}

const bumper=(y:number,w=390)=>line(`M${300-w/2} ${y}H${300+w/2}`,'#B6BBA0',11)
const carBase=(long=false)=>line(`M149 233H451M149 ${long?645:619}H451M204 134V174M396 134V174M204 ${long?706:676}V${long?739:710}M396 ${long?706:676}V${long?739:710}`,'#819071',12)+[137,463].map(x=>tyre(x,236,31,127)+tyre(x,long?645:616,31,137)).join('')+p(`M151 181Q150 157 178 153H422Q451 157 449 181V${long?713:682}H151Z`,metal)+r(172,185,256,215,wood,31)+p(rep(10,n=>`M187 ${207+n*17}h225 `),'none','#6E7F60',2)+grille(181,159,238,28,15)+bumper(134)+bumper(long?739:710)+r(157,378,286,25,'#A6B49A',4)
const cabin=(x=173,y=418,w=254,h=223)=>r(x,y,w,h,canvas,30)+r(x+15,y+14,w-30,h-28,'none',19,'#BEC7A9',2)+wear(x+w/2,y+h/2,w*.35,h*.34,75)+p(`M${x+15} ${y+13}H${x+w-15}M${x+15} ${y+h-13}H${x+w-15}`,'none','#627A5D',3)
const openCab=(two=true)=>r(171,418,258,two?225:125,'#3E5741',15)+seat(189,440,221,73)+(two?seat(189,548,221,71):'')+line('M180 425H421','#ADB79C',10)+r(196,two?653:554,208,38,canvas,13)
function car(i:number):string {
 const base=carBase([6,9,10,11,12,13,14,15,17,18,19].includes(i))
 switch(i){
 case 0:return base+openCab()+r(199,662,203,27,canvas,12)
 case 1:return base+openCab(false)+timber(185,607,230,75)+tyre(300,693,100,24)
 case 2:return base+cabin(179,417,242,157)+timber(181,602,238,78)
 case 3:return base+cabin()+line('M151 429H128V661H151M449 429H472V661H449','#9AA98A',12)
 case 4:return base+cabin(176,419,248,96)+r(175,531,250,111,'#425E45',14)+seat(191,551,219,72)+r(193,651,214,37,canvas,12)
 case 5:return base+openCab()+line('M171 429L188 632M429 429L412 632','#A7B498',7)+r(186,654,227,35,canvas,16)
 case 6:return base+cabin(171,405,258,279)+r(182,692,238,31,wood,9)+line('M182 498H418','#ADB99B',8)
 case 7:return base+cabin()+steel(233,501,134,22,3)+grille(196,655,208,37,9)
 case 8:return base+cabin(171,416,258,273)+p('M193 438V671M409 438V671M180 656H420','none','#AAB89B',5)+line('M186 683H414','#6E8063',7)
 case 9:return base+cabin(179,406,242,95)+crate(161,520,278,192)+line('M163 563H437M163 669H437',wood,12)
 case 10:return base+cabin(179,406,242,95)+planks(158,519,284,195,8)+rep(8,n=>e(n%2?450:150,535+Math.floor(n/2)*52,7,7,metal))
 case 11:return base+cabin(181,405,239,92)+planks(161,516,278,197,8)+grille(142,519,20,190,2)+grille(439,519,20,190,2)+crate(184,539,102,147)+crate(311,540,101,147)
 case 12:return base+cabin(180,405,240,95)+r(176,520,249,198,metal,68)+p('M190 553H411M185 650H416','none','#596D52',13)+ring(300,568,31,25,metal)+ring(300,667,31,25,metal)
 case 13:return base+openCab(false)+ring(220,620,57,51,metal)+coil(220,620,41,35)+steel(331,564,84,130)+line('M230 297V713M371 297V713',wood,12)+p(rep(14,n=>`M232 ${312+n*29}H369 `),'none','#AEB89A',6)+ring(352,668,24,22,metal)
 case 14:return base+cabin(165,414,270,297)+p('M278 471H322V537H376V579H322V645H278V579H224V537H278Z','#D4CBB0','#8D8F72',2)
 case 15:return base+cabin(162,329,276,384)+steel(228,385,145,48,12)+steel(228,574,145,48,12)+p(rep(13,n=>`M181 ${350+n*27}H192M409 ${350+n*27}H420 `),'none','#B3BEA1',3)
 case 16:return line('M132 235H468M132 639H468','#879575',13)+[126,474].map(x=>tyre(x,235,28,130)+tyre(x,639,32,141)).join('')+p('M300 82Q400 169 399 380L385 647Q353 717 300 753Q247 717 215 647L201 380Q200 169 300 82Z',metal)+p('M300 104V392','none','#C5C9A8',4)+r(249,413,102,147,'#3D5941',28)+seat(262,447,76,86)+r(259,398,83,23,'#A6B699',7)+wear(300,631,50,61,60)
 case 17:return base+p('M168 403L200 376H402L434 403V699H168Z',metal)+p('M194 413V686M406 413V686M183 559H418','none','#B6C0A2',5)+ring(300,531,94,98,metal)+ring(300,531,64,67,metal)+line('M300 531V415','#8B9A7C',23)+bolt(300,531)+bolts(185,424,230,257)
 case 18:return base+r(163,419,274,294,'#839D85',14)+p('M197 443H403L423 472V676H177V472Z',wood)+line('M177 475V683M422 475V683','#B0B79A',12)+p('M206 455H393M206 676H393','none','#D4C8A3',3)+seat(187,407,226,36)
 case 19:return base+planks(166,415,269,261,7)+line('M175 431H425M175 658H425',wood,14)+grille(187,686,227,36,10)
 default:throw Error('未知旧式汽车构造')
 }
}
const saddle=(x:number,y:number,s=1)=>g(p('M-32-27Q0-45 32-27L24 30Q0 42-24 30Z',canvas)+p('M-19-20Q0-29 19-20','none','#C3C6AA',2)+wear(0,0,18,20,24),`translate(${x} ${y}) scale(${s})`)
function motoBase(trike=false):string {
 return tyre(300,133,26,190)+(trike?axle(661,155,445):tyre(300,681,31,190))+line('M289 194L275 320V584L291 618M311 194L325 320V584L309 618','#A2AF90',12)+line('M200 259Q300 225 400 259','#B2B99E',13)+r(278,211,44,22,brass,6)+steel(265,424,70,135,17)+p('M276 443V541M289 438V547M310 438V547M323 443V541','none','#C4C9AB',2)+line('M239 542H361','#A9B698',12)+r(251,322,98,112,wood,34)+p('M270 341H330','none','#CAB78A',2)+ring(300,348,10,9,brass)+saddle(300,500,1.08)
}
const exhaust=(side=1)=>line(`M${300+side*39} 473Q${300+side*68} 517 ${300+side*68} 629`,'#A4B095',9)+r(300+side*68-9,594,18,72,metal,6)
const pack=(x:number,y:number,w=63,h=125)=>r(x-w/2,y-h/2,w,h,wood,13)+p(`M${x} ${y-h/2+8}v${h-16}`,'none','#72764F',9)+wear(x,y,w*.3,h*.33,30)
function motorcycle(i:number):string {
 const base=motoBase(i>=18)
 switch(i){
 case 0:return base+line('M341 484L347 650','#A1A583',15)+p('M344 499V638','none','#544F38',6)+exhaust(-1)
 case 1:return base+steel(336,502,26,154,12)+exhaust(-1)+line('M210 257L193 286M390 257L407 286','#B0B89A',9)
 case 2:return base+g(steel(-28,-29,56,58),'translate(273 462) rotate(-25)')+g(steel(-28,-29,56,58),'translate(329 462) rotate(25)')+exhaust(-1)+exhaust(1)
 case 3:return base+steel(198,437,65,86,9)+steel(337,437,65,86,9)+p('M205 448V513M217 448V513M229 448V513M371 448V513M383 448V513M395 448V513','none','#BEC5A7',3)+exhaust(1)
 case 4:return base+steel(267,408,66,201,14)+rep(4,n=>ring(300,435+n*46,19,17,metal))+g(saddle(300,500,1.03),'translate(0 85)')+exhaust(-1)
 case 5:return base+steel(333,514,20,144)+line('M249 609H351','#9FAE8D',8)+pack(221,609,64,122)+pack(379,609,64,122)+seat(274,501,52,129)
 case 6:return tyre(300,131,23,146)+tyre(300,684,26,145)+line('M287 191V636M313 191V636','#9EAD90',9)+line('M220 281L240 239H360L380 281','#ADB798',11)+r(269,299,62,167,wood,25)+steel(268,463,65,86,12)+saddle(300,524,.8)+line('M334 487L350 674','#AAB495',8)
 case 7:return base+steel(243,239,115,22)+r(246,231,108,11,'#9BB6A1',3)+seat(272,502,57,127)+exhaust(1)
 case 8:return base+pack(220,600,87,146)+pack(381,600,87,146)+grille(263,584,74,71,5)+exhaust(-1)
 case 9:return base+steel(224,226,152,29,10)+pack(237,569,56,94)+grille(263,599,74,58,5)+exhaust(1)
 case 10:return base+saddle(300,591,1.03)+line('M256 608Q300 641 344 608','#AFB69A',9)+line('M234 607H366','#9AA98A',9)+exhaust(1)
 case 11:return base+steel(232,319,136,43,12)+steel(231,453,30,167,10)+steel(339,453,30,167,10)+line('M250 616H350','#ADB69A',10)+saddle(300,546,1.1)
 case 12:return base+steel(277,401,46,42)+p('M279 409H321','none','#C2C7A7',4)+line('M261 258H339','#AEB99A',16)+pack(300,606,55,83)
 case 13:return base+rep(2,n=>r(269+n*51,192,11,52,brass,5)+p(rep(8,k=>`M${268+n*51} ${198+k*5}h13 `),'none','#5A6C50',1.5))+seat(270,499,60,136)+ring(236,566,21,28,wood)+ring(364,566,21,28,wood)
 case 14:return g(base+exhaust(-1),'translate(-79 0)')+line('M255 408H415M255 591H415M487 575H518','#A8B397',13)+tyre(518,575,26,155)+p('M428 277Q493 331 496 532L482 651H371L356 532Q354 359 428 277Z',metal)+r(380,420,94,161,'#3D5840',29)+saddle(428,516,1.06)
 case 15:return g(base+exhaust(-1),'translate(-83 0)')+line('M254 413H418M254 597H418M493 579H525','#AAB698',14)+tyre(525,579,27,159)+p('M429 272Q501 335 503 533L489 661H367L354 534Q354 357 429 272Z',metal)+r(371,388,117,236,canvas,43)+p('M386 406H473M386 605H473','none','#BBC3A5',3)
 case 16:return g(base+exhaust(-1),'translate(-85 0)')+line('M254 406H413M254 604H413M497 571H535','#AEB89C',13)+tyre(535,571,25,160)+crate(351,341,157,301)
 case 17:return g(base+exhaust(-1),'translate(-109 0)')+line('M226 358H411M226 626H411M511 572H544','#AAB698',14)+tyre(544,572,25,162)+line('M345 269V681M511 269V681M345 312H511M345 640H511','#AFB89C',12)+seat(354,314,149,317)+cord('M356 392H503M356 550H503')
 case 18:return base+line('M161 626H438','#AAB797',17)+r(134,588,42,148,metal,18)+r(425,588,42,148,metal,18)+seat(267,501,66,115)+pack(300,653,106,82)
 case 19:return base+line('M155 591H446','#ABB69A',20)+crate(177,531,246,181)+saddle(300,491,1.05)
 default:throw Error('未知摩托车构造')
 }
}
const bikeRack=(y=611,w=114)=>line(`M${300-w/2} ${y}H${300+w/2}V${y+77}H${300-w/2}Z`,'#A3AF90',6)+p(rep(4,n=>`M${300-w/2+8} ${y+10+n*19}h${w-16} `),'none','#9EAD8E',3)
const bikeBase=(long=false)=>tyre(300,141,20,245)+tyre(300,657,20,245)+line('M290 218L280 325V579L292 616M310 218L320 325V579L308 616','#A9B598',8)+line('M194 267Q300 249 406 267','#BBC2A7',8)+line('M238 492H362','#B5BCA2',8)+r(220,480,35,23,'#6B775A',4)+r(345,480,35,23,'#6B775A',4)+saddle(300,long?523:470,.91)+r(330,507,17,127,metal,7)+p('M337 519V622','none','#5B6B50',1.7)
function bicycle(i:number):string {
 const base=bikeBase(i===14)
 switch(i){
 case 0:return base+line('M287 318V438M313 318V438','#ACB79B',6)
 case 1:return base+line('M280 309Q246 411 281 600M320 309Q354 411 319 600','#B2BA9E',8)+p('M287 601V733M313 601V733','none',canvas,8)
 case 2:return base+steel(324,492,29,172,12)+bikeRack()+r(291,76,18,135,metal,7)+r(291,629,18,119,metal,7)
 case 3:return base+p('M207 266Q175 264 174 304Q176 342 204 329M393 266Q425 264 426 304Q424 342 396 329','none','#C0C7A9',8)+line('M289 314V439M311 314V439','#A5B492',5)
 case 4:return base+line('M248 267L261 298M352 267L339 298','#B6BFA2',8)+p('M282 321L291 438M318 321L309 438','none','#6A8060',6)
 case 5:return tyre(300,133,20,147)+tyre(300,686,20,147)+line('M285 207V619M315 207V619','#A9B596',8)+line('M195 235H405M234 422H366M233 602H366','#B9C3A5',8)+saddle(300,355,.91)+saddle(300,547,.91)+r(218,411,35,22,'#64765A',4)+r(347,411,35,22,'#64765A',4)+r(218,591,35,22,'#64765A',4)+r(347,591,35,22,'#64765A',4)+steel(331,424,15,201,6)
 case 6:return tyre(300,121,21,132)+tyre(300,687,21,151)+line('M287 193V620M313 193V620','#AAB697',9)+crate(203,222,195,233)+line('M198 479H402M238 579H362','#B5C0A0',9)+saddle(300,556,.95)+steel(331,579,15,70)+line('M321 181L349 465','#9BAD8C',5)
 case 7:return base+line('M286 223H214V365M314 223H386V365','#ADB99A',7)+planks(193,272,214,116,6)+line('M212 373L280 413M388 373L320 413','#A9B595',6)
 case 8:return base+e(300,321,111,81,wood)+e(300,321,96,67,'#8C8660','#C7B087',4)+p(rep(10,n=>`M${219+n*18} 283q-12 38 0 76 `),'none','#B9A475',2)+bikeRack(613,87)
 case 9:return tyre(300,236,23,333)+tyre(300,700,17,97)+line('M289 272V620M311 272V620','#B0B99B',10)+line('M204 288H396','#B8C1A3',8)+saddle(300,442,.96)+line('M238 371H362','#B6BDA0',8)+r(219,360,36,23,'#687A5B',4)+r(345,360,36,23,'#687A5B',4)
 case 10:return base+rep(2,n=>r(271+n*45,212,13,72,brass,5)+p(rep(10,k=>`M${270+n*45} ${218+k*6}h15 `),'none','#657652',1.6))+pack(300,539,79,57)
 case 11:return base+line('M343 503V643','#AEB99B',10)+ring(340,508,13,9,metal)+ring(340,644,13,9,metal)+line('M289 320V437M311 320V437','#9EAD8D',8)
 case 12:return base+steel(276,351,48,24)+steel(276,407,48,24)+line('M250 262H350','#A6B493',12)+pack(300,551,66,68)
 case 13:return base+line('M279 315V438M321 315V438','#7D9474',10)+pack(235,555,58,104)+bikeRack(612,113)+cord('M251 543L282 578')
 case 14:return base+bikeRack(588,190)+line('M275 565V706M325 565V706','#A6B391',9)+cord('M213 607H387M213 652H387')
 case 15:return base+line('M276 318L321 436M324 318L279 436','#A6B593',7)+saddle(300,474,1.09)
 case 16:return base+line('M278 314Q247 420 284 597M322 314Q353 420 316 597','#AFB99B',8)+p('M278 592V724M322 592V724','none',canvas,10)+bikeRack(613,98)+line('M242 267L223 286M358 267L377 286','#B7C0A2',7)
 case 17:return base+line('M255 612H345','#A9B798',7)+pack(216,642,83,132)+pack(385,642,83,132)+pack(300,292,120,50)+line('M199 268L178 292M401 268L422 292','#B7C0A4',8)
 case 18:return tyre(300,127,21,145)+tyre(300,690,23,150)+line('M281 203V618M319 203V618','#B0B99A',10)+seat(246,418,108,171)+line('M229 405H371M220 293H380','#BBC3A5',9)+r(203,280,34,22,'#61785B',4)+r(363,280,34,22,'#61785B',4)+line('M254 579H346','#ACB99A',7)
 case 19:return base+line('M273 315V437M327 315V437','#A5B391',11)+planks(220,287,161,75,5)+bikeRack(613,166)+saddle(300,475,1.18)
 default:throw Error('未知自行车构造')
 }
}
const railBase=()=>line('M300 36V90M300 710V767','#9AA98A',15)+bumper(78,234)+bumper(727,234)+r(175,99,250,611,metal,10)+[239,294,591,646].map(y=>axle(y,159,441)).join('')
const railRoof=(x=186,y=117,w=228,h=576)=>r(x,y,w,h,canvas,31)+p(`M${x+19} ${y+26}V${y+h-26}M${x+w-19} ${y+26}V${y+h-26}`,'none','#C6C8A8',3)+wear(x+w/2,y+h/2,w*.35,h*.38,95)
const vent=(y:number,w=90)=>grille(300-w/2,y,w,24,7)
function rail(i:number):string {
 const base=railBase()
 switch(i){
 case 0:return base+r(203,242,194,313,metal,62)+p('M205 315H395M205 443H395','none','#526A4E',11)+ring(300,300,34,31,metal)+ring(300,300,22,20,'#42533B')+ring(300,428,25,24,brass)+steel(177,235,37,305)+steel(386,235,37,305)+railRoof(187,566,226,115)+steel(202,133,197,87)
 case 1:return base+r(219,201,162,399,metal,68)+[269,388,505].map(y=>line(`M225 ${y}H375`,'#A8B796',10)).join('')+ring(300,262,35,34,metal)+ring(300,262,23,22,'#3E5138')+ring(300,453,23,22,brass)+railRoof(185,610,230,86)+p('M220 129H380L420 173H180Z',metal)+p('M209 141H391M225 152H375M242 164H358','none','#4F684B',5)
 case 2:return base+steel(204,135,192,178,23)+steel(204,509,192,177,23)+railRoof(190,328,220,166)+line('M253 347L345 380L253 414L345 447L253 480','#AAB596',7)+line('M235 414H365','#C1C5A7',7)
 case 3:return base+steel(210,135,180,353,16)+p(rep(16,n=>`M228 ${155+n*19}h144 `),'none','#50674B',5)+railRoof(188,516,224,169)+ring(300,211,21,18,metal)
 case 4:return base+railRoof()+line('M202 136H399M202 670H399','#B9C3A3',7)+line('M256 320L346 381L256 440L346 499','#A4B292',9)+line('M239 409H363','#C0C7A7',7)
 case 5:return base+railRoof()+rep(10,n=>vent(156+n*51,71))+line('M208 111H392M208 697H392','#A5B294',10)
 case 6:return base+railRoof(186,117,228,472)+planks(189,611,222,92,7)+line('M184 609V688Q300 739 416 688V609','#B4BEA0',9)+vent(168)+vent(498)
 case 7:return base+planks(186,117,228,576,8)+rep(10,n=>seat(202,145+n*51,73,33)+seat(325,145+n*51,73,33))+line('M184 126V685M416 126V685','#B2BDA0',8)
 case 8:return base+railRoof()+vent(187,130)+vent(568,130)+line('M189 397H411','#9DAF8C',15)+steel(169,347,21,131)+steel(410,347,21,131)
 case 9:return base+railRoof()+r(233,151,135,505,metal,18)+rep(12,n=>vent(170+n*40,86))+p('M239 162V645M360 162V645','none','#BCC6A5',2)
 case 10:return base+planks(186,116,228,577,10)+line('M190 225H410M190 401H410M190 582H410',wood,18)+steel(168,321,23,165)+steel(409,321,23,165)
 case 11:return base+planks(182,116,237,578,9)+rep(10,n=>bolt(n%2?429:171,146+Math.floor(n/2)*128))+line('M191 128H409M191 680H409','#899D7C',12)
 case 12:return base+planks(183,117,234,577,8)+[231,300,369].map(x=>r(x-24,144,48,512,wood,21)+p(`M${x-10} 161q14 230 0 473`,'none','#C5AB7A',1.4)).join('')+rep(12,n=>steel(n%2?414:162,138+Math.floor(n/2)*99,25,21,3))+cord('M186 256H414M186 548H414')
 case 13:return base+r(189,164,222,473,metal,91)+line('M195 247H405M195 552H405','#536F50',13)+ring(300,286,36,31,metal)+ring(300,515,36,31,metal)+line('M200 143H400M200 660H400','#A2B292',9)
 case 14:return base+steel(187,126,226,554)+[155,425].map(y=>p(`M203 ${y}H397V${y+223}H203Z`,'#677C59')+p(`M222 ${y+18}H378L354 ${y+203}H245Z`,metal)+wear(300,y+113,51,73,70)).join('')+line('M188 404H412','#A5B393',14)
 case 15:return base+planks(185,121,231,571,8)+r(202,139,197,537,'#687650',4)+wear(300,404,68,209,180)+line('M188 288H412M188 532H412','#A7B292',10)
 case 16:return base+r(184,119,232,575,'#BFC6AC',15)+p(rep(16,n=>`M197 ${140+n*35}h206 `),'none','#8D9E80',1.5)+steel(225,167,149,72)+steel(225,571,149,72)+line('M190 401H410','#A4AF8F',17)
 case 17:return base+planks(190,234,221,326,8)+railRoof(191,226,219,341)+railRoof(224,342,152,127)+planks(186,119,227,86,6)+planks(186,591,227,100,6)+line('M180 129V194M420 129V194M180 598V689M420 598V689','#AAB797',9)
 case 18:return base+planks(185,118,230,578,8)+ring(300,498,101,85,metal)+steel(228,550,145,105)+p('M269 509L238 139H362L331 509Z',metal)+p(rep(9,n=>`M${num(246+n*3)} ${162+n*38}L${num(354-n*3)} ${194+n*38}M${num(354-n*3)} ${162+n*38}L${num(246+n*3)} ${194+n*38} `),'none','#4E6B4C',3)+cord('M300 155V119')
 case 19:return base+steel(185,391,230,301)+ring(300,544,34,31,metal)+r(192,125,215,243,'#586A49',4)+wear(300,244,77,89,150)+line('M187 378H414','#AAB697',15)
 default:throw Error('未知铁路车辆构造')
 }
}

/** Samples the authored rim paths to place masonry joints within their radial stone bands. */
function masonry(d:string):string {
 const tokens=d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)??[]
 let at=0,cmd='',x=0,y=0,sx=0,sy=0,seams='',chips=''
 while(at<tokens.length){
  if(/^[a-z]$/i.test(tokens[at]))cmd=tokens[at++]
  const relative=cmd===cmd.toLowerCase(),kind=cmd.toUpperCase(),count=({M:2,L:2,H:1,V:1,Q:4,C:6,A:7,Z:0} as Record<string,number>)[kind]
  if(count===undefined)throw Error('Unsupported authored masonry path')
  if(kind==='Z'){x=sx;y=sy;cmd='';continue}
  const v=tokens.slice(at,at+count).map(Number);at+=count;const ox=x,oy=y
  const px=(n:number)=>v[n]+(relative?ox:0),py=(n:number)=>v[n]+(relative?oy:0)
  let point:(t:number)=>[number,number]
  if(kind==='M'){x=px(0);y=py(1);sx=x;sy=y;cmd=relative?'l':'L';continue}
  if(kind==='L'){x=px(0);y=py(1)}else if(kind==='H')x=px(0);else if(kind==='V')y=py(0);else{x=px(count-2);y=py(count-1)}
  if(kind==='Q'){const cx=px(0),cy=py(1);point=t=>[(1-t)**2*ox+2*(1-t)*t*cx+t*t*x,(1-t)**2*oy+2*(1-t)*t*cy+t*t*y]}
  else if(kind==='C'){const ax=px(0),ay=py(1),bx=px(2),by=py(3);point=t=>[(1-t)**3*ox+3*(1-t)**2*t*ax+3*(1-t)*t*t*bx+t**3*x,(1-t)**3*oy+3*(1-t)**2*t*ay+3*(1-t)*t*t*by+t**3*y]}
  else if(kind==='A'){const cx=(ox+x)/2,cy=(oy+y)/2,a=Math.atan2((oy-cy)/v[1],(ox-cx)/v[0]);point=t=>[cx+v[0]*Math.cos(a+(v[4]?1:-1)*Math.PI*t),cy+v[1]*Math.sin(a+(v[4]?1:-1)*Math.PI*t)]}
  else point=t=>[ox+(x-ox)*t,oy+(y-oy)*t]
  for(let j=0;j<4;j++){const [a,b]=point((j+.5)/4),dx=a-300,dy=b-300;seams+=`M${num(300+dx*.845)} ${num(300+dy*.845)}L${num(300+dx*.975)} ${num(300+dy*.975)} `;chips+=`M${num(300+dx*.925)} ${num(300+dy*.925)}l${j%2?3:-2} ${j%3-1} `}
 }
 return p(seams,'none','#707D65',1.5)+p(chips,'none','#D7D0B1',1.4)
}
const pool=(d:string)=>p(d,stone,'#575E4C',5)+masonry(d)+g(p(d,'none','#D9D1B5',1.7),'translate(300 300) scale(.98) translate(-300 -300)')+g(p(d,water,'#D2D2B4',4),'translate(300 300) scale(.82) translate(-300 -300)')
const circleD=(cx:number,cy:number,rx:number,ry=rx)=>`M${cx+rx} ${cy}a${rx} ${ry} 0 1 1 ${-rx*2} 0a${rx} ${ry} 0 1 1 ${rx*2} 0Z`
const polyD=(cx:number,cy:number,rx:number,ry:number,n:number,a=-Math.PI/2)=>rep(n,i=>`${i?'L':'M'}${num(cx+rx*Math.cos(a+i*Math.PI*2/n))} ${num(cy+ry*Math.sin(a+i*Math.PI*2/n))}`)+'Z'
const ripple=(cx:number,cy:number,rx:number,ry=rx)=>e(cx,cy,rx,ry,'none','#C4D6C0',1.8)+e(cx,cy,rx*.73,ry*.73,'none','#597D76',1.2)
const nozzle=(x:number,y:number,s=1)=>ring(x,y,11*s,11*s,brass)+e(x,y,3*s,3*s,'#41594B',ink,1)
const column=(x=300,y=300,s=1)=>ring(x,y,66*s,66*s,stone)+ring(x,y,46*s,46*s,metal)+nozzle(x,y,1.2*s)+ripple(x,y,89*s)
const jets=(n:number,radius=124,cx=300,cy=300)=>rep(n,i=>{const a=i*Math.PI*2/n;const x=num(cx+radius*Math.cos(a)),y=num(cy+radius*Math.sin(a));return nozzle(x,y,.85)+p(`M${x} ${y}Q${num((x+cx)/2+9)} ${num((y+cy)/2-8)} ${cx} ${cy}`,'none','#C2D9C4',1.8)})
function fountain(i:number):string {
 switch(i){
 case 0:return pool(circleD(300,300,252))+ripple(300,300,183)+column()+jets(4,160)
 case 1:return pool(polyD(300,300,258,258,8))+ring(300,300,116,116,stone)+e(300,300,94,94,water)+column(300,300,.7)+jets(8,170)
 case 2:return pool('M92 49H508L551 92V508L508 551H92L49 508V92Z')+column()+jets(4,173)+p('M122 121L151 151M478 121L449 151M122 479L151 449M478 479L449 449','none','#607F72',3)
 case 3:return pool('M167 44H433Q492 44 492 103V497Q492 556 433 556H167Q108 556 108 497V103Q108 44 167 44Z')+[151,300,449].map(y=>column(300,y,.65)).join('')+p('M300 158V442','none','#C7D7BC',2.5)
 case 4:return pool('M224 44H376V224H556V376H376V556H224V376H44V224H224Z')+column(300,300,.85)+nozzle(300,136)+nozzle(464,300)+nozzle(300,464)+nozzle(136,300)+p('M300 143V457M143 300H457','none','#C2D7BC',3)
 case 5:return pool('M300 99C434 8 591 165 501 300C591 435 434 592 300 501C166 592 9 435 99 300C9 165 166 8 300 99Z')+column()+jets(4,166)
 case 6:return pool('M67 159H533V333Q527 524 300 548Q73 524 67 333Z')+timber(60,115,480,53)+[182,300,418].map(x=>nozzle(x,180)+p(`M${x} 183q-23 73 0 120`,'none','#CBDAC0',3)+ripple(x,315,39,25)).join('')
 case 7:return pool('M70 55H264V545H70ZM336 55H530V545H336Z')+r(268,71,64,458,stone,6)+[183,416].map(y=>line(`M237 ${y}H363`,stone,18)+nozzle(241,y)+nozzle(359,y)+ripple(167,y,35,55)+ripple(433,y,35,55)).join('')
 case 8:return pool(circleD(300,300,252))+ring(262,271,103,103,stone)+e(262,271,82,82,water)+ring(363,372,70,70,stone)+e(363,372,52,52,water)+nozzle(262,271)+nozzle(363,372)+p('M286 333Q319 323 327 343','none','#CBDAC2',4)+ripple(300,300,184)
 case 9:return pool(rep(12,n=>{const a=n*Math.PI/6-Math.PI/2,ra=n%2?145:262;return`${n?'L':'M'}${num(300+ra*Math.cos(a))} ${num(300+ra*Math.sin(a))}`})+'Z')+column(300,300,.75)+jets(6,142)
 case 10:return pool(circleD(300,300,252))+p('M300 300c-18-58 70-95 112-45s19 142-54 166-165-25-185-114 49-183 148-188 198 84 192 190','none',stone,19)+p('M300 300c-18-58 70-95 112-45s19 142-54 166-165-25-185-114 49-183 148-188 198 84 192 190','none','#D0CEAF',3)+nozzle(300,300,1.5)
 case 11:return pool('M337 48C43 43 13 490 328 551C145 434 180 153 337 48ZM414 201A125 125 0 1 1 414 451A125 125 0 1 1 414 201Z')+p('M215 308Q289 267 323 325','none',stone,24)+p('M215 308Q289 267 323 325','none',water,12)+nozzle(416,326)+ripple(416,326,63)+nozzle(151,333)
 case 12:return pool(rep(8,n=>{const a=n*Math.PI/4-Math.PI/2,b=(n+1)*Math.PI/4-Math.PI/2,m=a+Math.PI/8;return`${n?'L':'M'}${num(300+183*Math.cos(a))} ${num(300+183*Math.sin(a))}Q${num(300+324*Math.cos(m))} ${num(300+324*Math.sin(m))} ${num(300+183*Math.cos(b))} ${num(300+183*Math.sin(b))}`})+'Z')+column(300,300,.7)+jets(8,144)
 case 13:return pool(circleD(300,300,258,211))+line('M179 318Q145 240 229 207M421 318Q455 240 371 207',stone,39)+poly(229,206,26,32,5,stone)+poly(371,206,26,32,5,stone)+p('M237 225Q253 289 283 313M363 225Q347 289 317 313','none','#CBDCC7',4)+ripple(300,341,73,48)
 case 14:return pool(polyD(300,300,258,258,8))+line('M300 300V129M300 300L447 384M300 300L153 384',stone,20)+poly(300,300,76,100,6,'#7DA79B')+poly(300,300,38,65,4,'#BED1B1')+jets(3,139)
 case 15:return pool('M49 72H551V528H49Z')+p('M140 159H452V247H221V352H454V435H148V346H373V247','none',stone,21)+p('M140 159H452V247H221V352H454V435H148V346H373V247','none','#CAD0AE',3)+nozzle(146,159)+nozzle(452,435)
 case 16:return pool(circleD(300,300,256))+ring(300,300,177,177,stone)+e(300,300,148,148,water)+line('M300 111V176M300 424V489M111 300H176M424 300H489',stone,21)+column(300,300,.7)+jets(4,108)
 case 17:return pool('M300 46C417 41 475 153 423 244C566 254 577 445 442 490C385 511 332 487 300 453C224 548 76 499 64 390C56 304 103 252 178 245C123 156 177 45 300 46Z')+p('M300 151L176 380H424Z','none',stone,24)+p('M300 151L176 380H424Z','none',water,13)+column(300,300,.6)+nozzle(300,151)+nozzle(176,380)+nozzle(424,380)
 case 18:return pool('M65 96H535V504H65Z')+r(109,138,382,324,'none',1,'#C9CDB0',8)+r(154,178,292,244,'none',1,'#CAD3B6',7)+steel(232,232,136,136,3)+rep(5,n=>nozzle(254+n*23,300,.7))+p('M171 200H428M171 401H428','none','#8BA79A',2)
 case 19:return pool('M98 44H502V556H98Z')+[98,259,420].map(y=>r(148,y,304,128,water,3,'#C8CEAE',12)+p(`M169 ${y+102}H430`,'none','#D1DCC2',4)+ripple(300,y+61,78,25)).join('')+nozzle(300,128)
 case 20:return pool('M145 45H455L533 123V477L455 555H145L67 477V123Z')+p(rep(7,n=>`M138 ${142+n*53}H461M${159+n*46} 122V474 `),'none','#689188',1)+rep(12,n=>nozzle(207+n%3*93,170+Math.floor(n/3)*86,.8))+ripple(300,300,152,169)
 case 21:return pool('M70 453Q34 151 300 50Q566 151 530 453Q300 561 70 453Z')+p(rep(7,n=>{const a=Math.PI+n*Math.PI/6;return`M300 438L${num(300+186*Math.cos(a))} ${num(438+312*Math.sin(a))} `}),'none','#5F8A7D',3)+[0,1,2,3,4].map(n=>{const a=Math.PI+Math.PI/6+n*Math.PI/6;return nozzle(num(300+154*Math.cos(a)),num(418+250*Math.sin(a)),.9)}).join('')+ripple(300,379,68,26)
 case 22:return pool(circleD(300,300,256,210))+e(300,300,171,135,'none',stone,13)+rep(10,n=>{const a=n*Math.PI/5;return nozzle(num(300+169*Math.cos(a)),num(300+133*Math.sin(a)),.8)})+column(300,300,.7)
 case 23:return pool('M49 49H551V551H49Z')+p(rep(8,n=>`M${107+n*55} 96V504M96 ${107+n*55}H504 `),'none','#719488',2)+[157,443].map(x=>[157,443].map(y=>nozzle(x,y)+p(`M${x} ${y}L300 300`,'none','#D0DDC4',2)).join('')).join('')+column(300,300,.7)
 default:throw Error('未知喷泉构造')
 }
}
const foot=(fill=stone)=>r(225,225,150,150,fill,9)+bolts(242,242,116,116)+wear(300,300,43,46,60)
const post=()=>ring(300,300,24,24,wood)+e(300,300,12,12,brass)
const signArm=(a:number,len=203,fill=wood)=>g(line('M0 0H232',fill,10)+r(42,-12,len-20,24,fill,2)+p(`M52-4H${len+10}`,'none','#C7BB93',1.5)+bolt(57,0)+bolt(len+8,0),'translate(300 300) rotate('+a+')')
function streetSign(i:number):string {
 const base=foot()+post()
 switch(i){
 case 0:return base+signArm(0)+post()
 case 1:return base+[0,90,180,270].map(a=>signArm(a,194)).join('')+post()
 case 2:return base+[0,120,240].map(a=>signArm(a,201)).join('')+post()
 case 3:return base+signArm(-25,213)+signArm(155,172)+line('M277 321L323 279',metal,6)+post()
 case 4:return base+line('M300 300V173H506',wood,16)+r(339,184,168,22,wood,3)+line('M354 176V193M488 176V193',metal,4)+post()
 case 5:return line('M138 174V426M462 174V426M138 219H462M138 381H462',wood,15)+timber(104,205,392,31)+timber(104,365,392,31)+line('M146 300H454',wood,8)+bolts(124,218,351,162)
 case 6:return line('M142 179V422M458 179V422',wood,18)+timber(81,278,438,42)+r(126,280,33,39,metal,2)+r(441,280,33,39,metal,2)+line('M168 301H432',wood,14)
 case 7:return poly(300,300,202,176,6,stone)+wear(300,300,125,99,120)+line('M188 276H412',stone,25)+p('M211 273H390M244 292H357','none','#6F7960',2)
 case 8:return poly(300,300,158,158,8,stone)+[0,120,240].map(a=>signArm(a,138,brass)).join('')+poly(300,300,45,45,6,wood)
 case 9:return r(77,77,446,446,stone,8)+p('M264 450V257H181L300 112L419 257H336V450Z',brass,'#697655',4)+p('M103 103H497V497H103Z','none','#C1BEA0',3)+bolts(105,105,390,390)
 case 10:return ring(300,300,245,245,stone)+rep(8,n=>{const a=n*Math.PI/4;return g(p('M-12 55H12L17 132H35L0 213L-35 132H-17Z',n%2?metal:brass),`translate(300 300) rotate(${n*45})`)})+ring(300,300,35,35,brass)
 case 11:return base+line('M300 300Q296 159 495 165',metal,12)+r(356,176,149,26,brass,10)+line('M371 166V184M486 166V184',metal,4)+post()
 case 12:return base+line('M300 300L172 154M300 300L458 139',wood,21)+g(timber(-93,-11,186,22),'translate(180 182) rotate(-35)')+g(timber(-94,-11,188,22),'translate(423 190) rotate(26)')+post()
 case 13:return base+signArm(0,192)+signArm(180,192)+line('M300 300V136',metal,12)+lantern(300,116,52,6)+post()
 case 14:return line('M102 205V393M498 205V393',wood,23)+timber(89,286,422,29)+line('M113 306H486',wood,9)+ring(103,300,25,23,brass)+ring(497,300,25,23,brass)
 case 15:return line('M154 163Q109 300 154 437M446 163Q491 300 446 437',metal,17)+timber(129,285,342,31)+line('M151 253H449M151 347H449',metal,6)+bolts(151,298,298,0)
 case 16:return base+steel(162,289,276,22,10)+post()+p('M190 297H410','none','#D1C9A6',2)
 case 17:return base+signArm(0,202,metal)+signArm(90,194,metal)+post()
 case 18:return base+steel(103,271,394,55,4)+r(119,280,362,10,'#C0C6A5',2)+post()+line('M300 327V365','#708363',8)
 case 19:return base+steel(178,281,243,19,3)+steel(214,315,172,16,3)+line('M300 300L418 177',metal,10)+lantern(435,160,37,6)+post()
 case 20:return line('M142 202V398M458 202V398M143 300H457',metal,16)+steel(106,283,388,34,3)+r(117,290,367,8,'#C6C9AB',1)+bolts(139,299,322,0)
 case 21:return base+[0,70,140,215,285].map(a=>signArm(a,195,metal)).join('')+ring(300,300,28,28,metal)
 case 22:return line('M150 156L211 300L150 444M450 156L389 300L450 444',metal,15)+steel(104,283,392,34,3)+line('M166 181H434M166 419H434',metal,7)
 case 23:return r(66,91,468,418,stone,4)+p(rep(6,n=>`M${93+n*82} 103V497M79 ${127+n*65}H521 `),'none','#737D61',2)+p('M114 300L225 183V260H376V183L487 300L376 417V340H225V417Z','#D7CCAA','#9B9C7C',4)+r(80,105,440,390,'none',1,'#B5B081',5)
 default:throw Error('未知街道标识构造')
 }
}
function lantern(x:number,y:number,s=80,n=4):string {
 const roof=n===0?e(x,y,s,s,metal):poly(x,y,s,s,n,metal,n===4?-Math.PI/4:-Math.PI/2)
 return roof+rep(n||6,i=>{const a=i*Math.PI*2/(n||6)+(n===4?-Math.PI/4:-Math.PI/2);return p(`M${x} ${y}L${num(x+s*.87*Math.cos(a))} ${num(y+s*.87*Math.sin(a))}`,'none','#D0CCAC',2.5)})+ring(x,y,s*.21,s*.21,brass)+wear(x,y,s*.46,s*.46,33)
}
const lampArm=(x:number,y:number,s=65,n=6)=>line(`M300 300Q${num((300+x)/2+12)} ${num((300+y)/2-12)} ${x} ${y}`,metal,13)+lantern(x,y,s,n)
function streetLamp(i:number):string {
 const base=foot()+ring(300,300,24,24,metal)
 switch(i){
 case 0:return base+lantern(300,300,202,4)
 case 1:return base+lantern(300,300,210,6)
 case 2:return base+lantern(300,300,204,0)+line('M165 300H435M300 165V435',metal,8)+ring(300,300,27,27,brass)
 case 3:return base+lampArm(466,279,91,4)+ring(300,300,27,27,metal)
 case 4:return base+lampArm(133,300,82,4)+lampArm(467,300,82,4)+ring(300,300,31,31,brass)
 case 5:return base+rep(3,n=>{const a=n*Math.PI*2/3-Math.PI/2;return lampArm(num(300+173*Math.cos(a)),num(300+173*Math.sin(a)),65,6)})+ring(300,300,27,27,metal)
 case 6:return base+line('M300 300V129H466V217',wood,20)+line('M463 217V245',metal,4)+lantern(463,300,83,6)+ring(300,300,28,28,wood)
 case 7:return base+lantern(300,300,212,8)+steel(186,258,88,19,3)+steel(326,323,88,19,3)
 case 8:return base+rep(4,n=>g(p('M0 0Q-148-136 0-218Q148-136 0 0Z',metal)+p('M0-36V-192','none','#B6C4A3',4),`translate(300 300) rotate(${n*90})`))+poly(300,300,52,79,6,'#9ABAA7')
 case 9:return base+poly(300,300,245,245,6,metal)+poly(300,300,178,178,6,brass)+rep(6,n=>g(p('M0-219L25-154L-25-154Z','#C8D0AE'),`translate(300 300) rotate(${n*60})`))+ring(300,300,70,70,metal)
 case 10:return base+e(300,300,168,168,'none',metal,22)+[0,120,240].map(a=>{const an=a*Math.PI/180;return lampArm(num(300+169*Math.cos(an)),num(300+169*Math.sin(an)),67,6)}).join('')+ring(300,300,30,30,metal)
 case 11:return base+[[300,109],[491,300],[300,491],[109,300]].map(([x,y])=>lampArm(x,y,61,4)).join('')+ring(300,300,31,31,brass)
 case 12:return base+line('M300 300Q135 80 90 263M300 300Q465 520 510 337',metal,17)+lantern(103,267,66,0)+lantern(497,333,66,0)+ring(300,300,30,30,brass)
 case 13:return base+line('M300 300Q412 113 491 277M300 300Q381 389 491 277',metal,13)+p('M354 219q-49-72-83-25q61 17 83 25M391 348q-7 63-55 45q30-31 55-45',canvas)+lantern(470,272,74,8)+ring(300,300,27,27,metal)
 case 14:return base+line('M300 300Q186 119 104 252M300 300Q414 119 496 252',metal,19)+lantern(108,269,62,6)+lantern(492,269,62,6)+ring(300,300,32,32,brass)
 case 15:return base+lantern(300,300,171,0)+r(103,103,394,394,'none',28,metal,18)+line('M161 161L439 439M439 161L161 439',metal,9)+ring(300,300,31,31,brass)
 case 16:return base+lantern(300,300,208,0)+rep(3,n=>g(line('M0 0V-175',metal,8),`translate(300 300) rotate(${n*120})`))+ring(300,300,39,39,brass)
 case 17:return base+line('M300 300Q287 82 486 164',metal,20)+lantern(466,186,89,0)+ring(300,300,26,26,metal)
 case 18:return base+line('M300 300Q205 137 111 269M300 300Q395 137 489 269',metal,16)+lantern(111,283,64,0)+lantern(489,283,64,0)+ring(300,300,29,29,metal)
 case 19:return base+lampArm(470,157,77,0)+ring(300,300,31,31,metal)
 case 20:return base+[326,263,193,127].map((s,n)=>r(300-s/2,300-s/2,s,s,n%2?metal:brass,2)).join('')+r(265,265,70,70,'#CFD6B9',3)+wear(300,300,88,88,85)
 case 21:return line('M111 269H489M111 179V419M489 179V419',metal,19)+lantern(211,269,74,0)+lantern(389,269,74,0)+ring(111,269,29,29,metal)+ring(489,269,29,29,metal)+bolts(97,201,405,197)
 case 22:return base+[[300,149],[451,300],[300,451],[149,300]].map(([x,y])=>lampArm(x,y,70,0)).join('')+lantern(300,300,82,0)
 case 23:return base+line('M97 300H503',metal,18)+steel(93,184,169,117,33)+steel(338,299,169,117,33)+p('M112 209H243M357 390H488','none','#C2CBA9',5)+ring(300,300,29,29,metal)
 default:throw Error('未知街灯构造')
 }
}
const dockBase=(round=false)=>round?poly(300,300,218,218,8,stone)+poly(300,300,211,211,8,'none')+p(rep(8,n=>{const a=n*Math.PI/4-Math.PI/2;return`M${num(300+179*Math.cos(a))} ${num(300+179*Math.sin(a))}L${num(300+210*Math.cos(a))} ${num(300+210*Math.sin(a))} `}),'none','#6C7B60',1.7)+wear(300,300,133,132,95):planks(85,125,430,350,8)
const bollard=(x:number,y:number,rx=68,fill=wood)=>ring(x,y,rx,rx,fill)+e(x,y,rx*.91,rx*.91,'none','#52674B',7)+wear(x,y,rx*.53,rx*.53,45)
function dockPost(i:number):string {
 const base=dockBase([4,5,8,10,11,14,15,16,19,22].includes(i))
 switch(i){
 case 0:return base+bollard(300,300,117)+line('M224 299H376','#A0AA88',16)+bolts(126,158,348,284)
 case 1:return base+line('M180 300H420',wood,51)+bollard(180,300,77)+bollard(420,300,77)+bolts(110,158,380,284)
 case 2:return base+line('M300 300V204M151 210H449',wood,62)+bollard(300,300,84)+line('M163 204H438','#A4AF8E',17)
 case 3:return base+line('M300 365V300M300 300Q199 223 135 253M300 300Q401 223 465 253',wood,64)+bollard(300,350,67)+p('M147 248Q216 235 284 291M453 248Q384 235 316 291','none','#C2AC7E',3)
 case 4:return base+poly(300,300,134,134,8,stone)+r(209,209,183,183,'none',4,'#B6B99C',3)+wear(300,300,66,66,100)
 case 5:return base+ring(300,300,135,135,stone)+e(300,300,112,112,'none','#6D7B60',8)+wear(300,300,76,76,115)
 case 6:return base+bollard(239,277,95)+e(239,277,106,106,'none','#C7B58A',5)+e(239,277,112,112,'none','#C7B58A',5)+cord('M341 299Q395 351 429 387')+coil(431,387,77,60)
 case 7:return base+line('M181 300H419',wood,35)+bollard(181,300,68)+bollard(419,300,68)+cord('M181 219C75 219 76 381 181 381C282 381 318 219 419 219C524 219 524 381 419 381C318 381 282 219 181 219Z')
 case 8:return base+ring(300,300,126,126,metal)+ring(300,300,91,91,metal)+rep(6,n=>{const a=n*Math.PI/3;return bolt(num(300+162*Math.cos(a)),num(300+162*Math.sin(a)))})
 case 9:return base+line('M150 317Q207 224 300 300Q393 376 450 283',metal,67)+ring(300,300,65,65,metal)+p('M162 305Q208 253 283 298M317 302Q393 351 438 294','none','#C3CAAA',3)
 case 10:return base+line('M167 300H433M300 167V433',metal,70)+ring(300,300,70,70,metal)+bolts(153,153,294,294)
 case 11:return base+poly(300,300,151,151,8,metal)+poly(300,300,111,111,8,brass)+poly(300,300,63,63,8,metal)+wear(300,300,78,78,90)
 case 12:return base+bollard(239,300,96)+line('M325 300H366',metal,23)+e(405,300,91,68,brass)+e(405,300,58,39,'#737C59','#CED0AB',3)+line('M320 285H361M320 315H361',metal,10)
 case 13:return base+bollard(219,289,92,metal)+line('M290 330L321 355',metal,10)+rep(6,n=>g(e(0,0,24,13,'none',metal,8),`translate(${306+n*32} ${340+n*14}) rotate(${n%2?45:0})`))
 case 14:return base+line('M300 310Q197 182 119 299M300 310Q403 438 481 321',brass,62)+ring(300,310,68,68,metal)+p('M142 282Q199 220 282 302M458 339Q401 397 318 318','none','#D0C79C',3)+bolts(151,151,298,298)
 case 15:return base+line('M300 161L156 394H444Z',wood,45)+[[300,161],[156,394],[444,394]].map(([x,y])=>bollard(x,y,56)).join('')
 case 16:return base+ring(300,300,142,142,metal)+ring(300,300,102,102,metal)+rep(6,n=>{const a=n*Math.PI/3;return bolt(num(300+173*Math.cos(a)),num(300+173*Math.sin(a)))})
 case 17:return base+p('M300 189C406 143 483 252 416 328C367 379 348 425 266 414C157 398 111 271 183 213C218 184 257 190 300 189Z',metal)+p('M244 229Q330 190 391 257','none','#C3CAAB',4)+wear(300,301,88,67,90)
 case 18:return base+steel(137,233,326,135,31)+ring(200,300,78,78,metal)+ring(400,300,78,78,metal)+bolts(105,159,390,283)
 case 19:return base+line('M171 300H429M300 171V429',metal,69)+ring(300,300,77,77,metal)+[150,450].map(x=>[150,450].map(y=>steel(x-17,y-17,34,34)).join('')).join('')
 case 20:return base+steel(128,237,344,126,7)+ring(206,300,71,71,metal)+ring(394,300,71,71,metal)+line('M154 214H447M154 385H447',metal,17)+bolts(107,161,385,279)
 case 21:return base+r(148,229,304,142,metal,68)+r(185,288,231,24,'#556D50',11)+p('M177 251H419','none','#CAD0AF',3)+wear(300,300,98,39,70)
 case 22:return base+steel(172,172,256,256)+line('M303 300H389',metal,17)+e(418,300,76,64,metal)+e(418,300,49,36,'#758261','#C8CDAA',3)+r(336,282,68,36,brass,4)
 case 23:return base+steel(108,225,384,151)+[169,300,431].map(x=>ring(x,300,66,66,metal)).join('')+cord('M169 367Q300 435 431 367')+bolts(106,161,388,280)
 default:throw Error('未知系泊桩构造')
 }
}
const drum=(x:number,y:number,w=155,h=75)=>r(x-w/2,y-h/2,w,h,wood,10)+p(rep(12,n=>`M${num(x-w/2+10+n*(w-20)/11)} ${y-h/2+4}v${h-8} `),'none','#C5BB92',2)+steel(x-w/2-9,y-h/2-13,18,h+26,3)+steel(x+w/2-9,y-h/2-13,18,h+26,3)+line(`M${x-w/2-32} ${y}H${x+w/2+32}`,metal,8)
const rigFoot=(x:number,y:number,w=92,h=70)=>timber(x-w/2,y-h/2,w,h)+bolts(x-w/2+12,y-h/2+12,w-24,h-24)
const turntable=(x=300,y=390)=>ring(x,y,97,91,metal)+ring(x,y,66,62,metal)+rep(8,n=>{const a=n*Math.PI/4;return bolt(num(x+80*Math.cos(a)),num(y+74*Math.sin(a)))})
const boom=(x=300,y=402,tx=300,ty=88,w=57)=>p(`M${x-w/2} ${y}L${tx-w*.3} ${ty}H${tx+w*.3}L${x+w/2} ${y}Z`,metal)+p(rep(8,n=>{const f=n/8,ff=(n+1)/8,l=x+(tx-x)*f-w/2+w*.2*f,rr=x+(tx-x)*f+w/2-w*.2*f,lf=x+(tx-x)*ff-w/2+w*.2*ff,rf=x+(tx-x)*ff+w/2-w*.2*ff,yy=y+(ty-y)*f,yf=y+(ty-y)*ff;return`M${num(l)} ${num(yy)}L${num(rf)} ${num(yf)}M${num(rr)} ${num(yy)}L${num(lf)} ${num(yf)} `}),'none','#4E684C',3)+cord(`M${x} ${y}L${tx} ${ty}`)+ring(tx,ty,8,7,metal)
function loadingRig(i:number):string {
 switch(i){
 case 0:return planks(91,163,418,278,8)+drum(300,282,246,122)+line('M146 282H96V360H144',metal,13)+cord('M300 223V112')+steel(251,98,98,26)+bolts(110,185,381,232)
 case 1:return poly(300,300,201,201,8,stone)+ring(300,300,94,94,wood)+rep(6,n=>g(line('M0-55V-245',wood,19),`translate(300 300) rotate(${n*60})`))+ring(300,300,45,45,metal)+e(300,300,105,105,'none','#C8BB92',4)
 case 2:return [[110,494],[490,494],[300,182]].map(([x,y])=>rigFoot(x,y)).join('')+line('M110 494L300 373L490 494M300 373V182',wood,24)+cord('M300 373L111 494M300 373L490 494M300 373L300 182')+ring(300,373,50,46,wood)+boom(300,373,300,74,39)
 case 3:return rigFoot(132,470,130,79)+rigFoot(468,470,130,79)+line('M132 470L300 166L468 470',wood,26)+line('M132 447H468',wood,14)+ring(300,166,33,30,metal)+cord('M300 166V415')+drum(300,432,122,54)
 case 4:return rigFoot(113,300,97,313)+rigFoot(487,300,97,313)+line('M113 300H487',wood,31)+steel(263,264,74,72)+cord('M300 300V458')+coil(300,469,43,35)
 case 5:return rigFoot(145,450,110,110)+rigFoot(452,450,110,110)+line('M145 450L300 325L452 450',wood,25)+steel(179,191,28,226)+steel(394,191,28,226)+line('M191 303H408',wood,27)+p(rep(12,n=>`M182 ${200+n*18}h23M396 ${200+n*18}h23 `),'none','#C7B58A',3)+boom(300,323,300,69,42)+cord('M300 323L191 303M300 323L408 303')
 case 6:return [[127,472],[473,472],[300,131]].map(([x,y])=>rigFoot(x,y,93,77)).join('')+line('M127 472L300 303L473 472M300 303V131',wood,20)+steel(274,254,20,97)+steel(306,254,20,97)+cord('M290 303L267 421M315 303L331 421')+coil(299,442,49,35)
 case 7:return planks(100,149,400,302,7)+drum(216,295,112,135)+drum(388,295,112,135)+line('M112 295H68V384H116M490 295H537V384H490',metal,11)+cord('M214 225V98M388 225V98')+steel(180,89,244,26)
 case 8:return poly(300,396,159,146,6,stone)+turntable(300,396)+line('M267 396L244 245L351 98',brass,32)+line('M333 396L292 246L383 114',brass,19)+poly(300,396,43,63,6,'#9EBAA6')+cord('M300 396L267 246L367 106')+ring(367,106,10,9,metal)
 case 9:return steel(86,181,92,267)+steel(422,181,92,267)+line('M130 303H470',metal,34)+steel(270,259,60,91)+cord('M292 301V461M308 301V461')+rep(10,n=>e(300,356+n*10,6,8,'none','#BBC4A5',2.5))
 case 10:return poly(300,402,173,138,8,stone)+turntable(300,402)+boom(300,402,300,75,65)+rigFoot(163,463)+rigFoot(437,463)+cord('M300 402L164 462M300 402L436 462')
 case 11:return rigFoot(173,466,129,96)+rigFoot(427,466,129,96)+turntable(300,410)+line('M300 410L196 112M300 410L404 112',metal,29)+cord('M300 410L196 112M300 410L404 112')+ring(196,112,9,8,metal)+ring(404,112,9,8,metal)+line('M230 209H370',metal,10)
 case 12:return [[300,100],[111,479],[489,479]].map(([x,y])=>rigFoot(x,y)).join('')+line('M300 100V300L111 479M300 300L489 479',metal,26)+turntable(300,300)+drum(300,300,120,52)+cord('M300 273L300 140')
 case 13:return rigFoot(132,399,101,170)+rigFoot(468,399,101,170)+line('M132 399H468',metal,24)+turntable(300,397)+boom(300,397,300,72,61)+line('M278 427L235 503M322 427L365 503',metal,20)+crate(213,482,174,66)+cord('M300 397L300 515')
 case 14:return rigFoot(154,465,110,92)+rigFoot(446,465,110,92)+line('M154 465H446M154 465L300 119L446 465',metal,25)+line('M300 119V383',metal,18)+cord('M300 119V424')+ring(300,119,11,10,metal)+bolts(124,444,353,43)
 case 15:return planks(134,365,332,176,8)+drum(300,448,173,77)+turntable(300,304)+boom(300,304,300,66,51)+cord('M300 413V71')+line('M161 467L300 304L439 467',wood,20)
 case 16:return steel(108,158,384,341)+r(154,301,292,174,metal,66)+ring(300,378,39,38,metal)+ring(300,378,24,23,'#45573E')+drum(300,230,206,79)+cord('M300 190V96')+steel(241,79,118,29)+p('M191 454H409','none','#C6CDA9',3)
 case 17:return steel(89,175,422,269)+steel(116,232,104,153,34)+p(rep(8,n=>`M128 ${247+n*18}h79 `),'none','#5E7656',4)+drum(351,305,171,111)+cord('M350 247V112')+steel(290,94,118,26)
 case 18:return steel(84,173,101,288)+steel(415,173,101,288)+line('M134 300H466',metal,38)+p(rep(7,n=>`M${158+n*41} 282l40 36m-40 0 40-36 `),'none','#536D4E',3)+steel(263,263,74,74)+cord('M300 300V471')+coil(300,478,40,32)
 case 19:return axle(430,149,451)+axle(252,149,451)+steel(168,209,264,294)+turntable(300,374)+boom(300,374,300,69,47)+line('M225 467H190V503H231',metal,11)+cord('M300 374L243 461')
 case 20:return steel(116,335,368,173)+turntable(300,391)+boom(300,391,300,69,73)+steel(224,451,152,78)+line('M145 354L106 521M455 354L494 521',metal,23)+rigFoot(106,521,89,53)+rigFoot(494,521,89,53)
 case 21:return steel(85,416,430,70)+line('M151 443Q137 210 224 128M449 443Q463 210 376 128',metal,31)+line('M151 442H449',metal,17)+cord('M224 128L224 355M376 128L376 355')+ring(224,128,9,8,metal)+ring(376,128,9,8,metal)+drum(300,451,122,45)
 case 22:return axle(421,123,477)+line('M174 427L210 176M426 427L390 176',metal,25)+steel(179,74,242,441)+r(201,91,198,405,'#586B4D',5)+p(rep(22,n=>`M209 ${108+n*17}h182 `),'none','#91A284',6)+line('M176 181H424M151 454H449',metal,13)
 case 23:return steel(116,375,368,135)+turntable(300,390)+boom(300,390,300,131,62)+cord('M300 143L300 100')+p('M290 80Q185 32 157 123L188 196L290 155ZM310 80Q415 32 443 123L412 196L310 155Z',metal)+p('M180 120L279 141M420 120L321 141','none','#C1C9A7',4)+line('M300 130V86',metal,18)
 default:throw Error('未知装卸机具构造')
 }
}

export const TRANSPORT_LICENSE_REF='MIT-Sceneweave-Transport-Collection-1'
export const TRANSPORT_LICENSE=`Sceneweave Transport Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG scene interpretations authored with coding assistance. No third-party artwork, photographs, trademarks or pixels are embedded. Medieval, fantasy and 1920s designs are illustrative original interpretations, not exact historical product reproductions. These static props do not create vehicle motion, navigation, functioning machines, bridges, water support, elevation or traversal. Conservative declared rectangular footprints include illustrated outlying wheels, shafts, oars, arms and ropes. Technical render checks, source visual review, integrated scene validation and final art acceptance are separate.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
export const TRANSPORT_COLLECTION_LICENSE_REF=TRANSPORT_LICENSE_REF
export const TRANSPORT_COLLECTION_LICENSE=TRANSPORT_LICENSE
const defs=`<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="37%" y2="100%"><stop offset="0%" stop-color="#B1996E"/><stop offset="24%" stop-color="#A1895E"/><stop offset="73%" stop-color="#8D7750"/><stop offset="100%" stop-color="#706442"/></linearGradient>
<linearGradient id="metal" x1="0%" y1="0%" x2="79%" y2="100%"><stop offset="0%" stop-color="#B7BAA1"/><stop offset="21%" stop-color="#9EAB90"/><stop offset="72%" stop-color="#7D9575"/><stop offset="100%" stop-color="#4C6A4C"/></linearGradient>
<linearGradient id="brass" x1="0%" y1="0%" x2="74%" y2="100%"><stop offset="0%" stop-color="#CBBC8C"/><stop offset="24%" stop-color="#B7AC79"/><stop offset="74%" stop-color="#97996A"/><stop offset="100%" stop-color="#777F54"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="71%" y2="100%"><stop offset="0%" stop-color="#B7BAA5"/><stop offset="26%" stop-color="#A4AA91"/><stop offset="73%" stop-color="#8D997E"/><stop offset="100%" stop-color="#697C63"/></linearGradient>
<linearGradient id="canvas" x1="0%" y1="0%" x2="81%" y2="100%"><stop offset="0%" stop-color="#B9BE9B"/><stop offset="24%" stop-color="#9FAF8C"/><stop offset="76%" stop-color="#839B77"/><stop offset="100%" stop-color="#637E5B"/></linearGradient>
</defs>`
const drawings={wagon,handcart,boat,'period-car':car,motorcycle,bicycle,'rail-vehicle':rail,fountain,'street-sign':streetSign,'street-lamp':streetLamp,'dock-post':dockPost,'loading-rig':loadingRig}
const squareCategories=new Set(['fountain','street-sign','street-lamp','dock-post','loading-rig'])
function artwork(design:TransportDesign,index:number):VisualSampleArt {
 const h=squareCategories.has(design.category)?600:800
 const vw=1000*design.widthMm/Math.max(design.widthMm,design.heightMm),vh=1000*design.heightMm/Math.max(design.widthMm,design.heightMm)
 const spread=design.category==='bicycle'?2.1:design.category==='motorcycle'&&index<14?1.9:design.category==='rail-vehicle'?1.8:design.category==='period-car'?1.35:design.category==='wagon'&&index!==15?1.25:1
 const drawing=g(drawings[design.category](index),`translate(300 0) scale(${spread} 1) translate(-300 0)`)
 return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
  sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}">${defs}<g transform="scale(${vw/600} ${vh/h})">${drawing}</g></svg>`,
  footprintMm:{width:design.widthMm,height:design.heightMm},blocksMovement:true,blocksSight:false,renderLayer:'object',shadowClass:'furniture',
  tags:['原创',design.category,design.era,design.design,'严格俯视','保守矩形占地','静态布景','无车辆移动或机器能力','无桥面水面支撑或高程通路']}
}
export const TRANSPORT_ART:readonly VisualSampleArt[]=freezeJson(TRANSPORT_DESIGNS.map(design=>artwork(design,TRANSPORT_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
export const TRANSPORT_COLLECTION_ART=TRANSPORT_ART
