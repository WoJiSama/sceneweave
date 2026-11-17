import { ADVENTURE_DESIGNS, type AdventureDesign } from '../assets/adventure-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

const ink='#4D493D',wood='url(#wood)',iron='url(#iron)',cloth='url(#cloth)',leather='url(#leather)',stone='url(#stone)',bone='#C2B99B',brass='#AA9971'
const rep=(n:number,fn:(i:number)=>string)=>Array.from({length:n},(_,i)=>fn(i)).join('')
const num=(v:number)=>Math.round(v*100)/100
const paint=(fill:string)=>({[wood]:'#93805A',[iron]:'#77816D',[cloth]:'#A89E7C',[leather]:'#8C775B',[stone]:'#8D9B82'}[fill]??fill)
const p=(d:string,fill='none',stroke=ink,w=2.6)=>`<path d="${d}" fill="${fill}" stroke="${paint(stroke)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
const r=(x:number,y:number,w:number,h:number,fill:string,rad=0,stroke=ink,sw=2.6)=>`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${rad}" fill="${fill}" stroke="${paint(stroke)}" stroke-width="${sw}"/>`
const e=(x:number,y:number,rx:number,ry:number,fill:string,stroke=ink,w=2.6)=>`<ellipse cx="${num(x)}" cy="${num(y)}" rx="${num(rx)}" ry="${num(ry)}" fill="${fill}" stroke="${paint(stroke)}" stroke-width="${w}"/>`
const g=(x:number,y:number,body:string,s=1,a=0)=>`<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})">${body}</g>`
const line=(d:string,fill=iron,w=13)=>p(d,'none',ink,w+4)+p(d,'none',fill,w)+p(d,'none','#C0BEA0',1.1)
const bolt=(x:number,y:number,s=4)=>e(x,y,s,s,'#A1A58C','#545E4E',1.2)+p(`M${x-s*.6} ${y+s*.3}l${s} ${-s*.7}`,'none','#636D56',1.2)
const poly=(cx:number,cy:number,rad:number,n:number,fill:string,a=-90)=>p(rep(n,i=>{const t=(a+i*360/n)*Math.PI/180;return `${i?'L':'M'}${num(cx+rad*Math.cos(t))} ${num(cy+rad*Math.sin(t))}`})+'Z',fill)
const ring=(cx:number,cy:number,rad:number,fill=iron,w=14)=>e(cx,cy,rad,rad,'none',ink,w+4)+e(cx,cy,rad,rad,'none',fill,w)+e(cx,cy,rad-w*.3,rad-w*.3,'none','#C1BFA0',1)
const grain=(x:number,y:number,w:number,h:number,seed=1)=>`<g opacity=".48">${rep(14,n=>{const yy=y+(n+.6)*h/15,dy=(n*7+seed)%5-2;return p(`M${x} ${yy}q${w*.23} ${dy} ${w*.47} 0t${w*.53} 0`,'none',n%4?'#C7B184':'#695B40',1.3)})}</g>`
const plank=(x:number,y:number,w:number,h:number,seed=1)=>p(`M${x+2} ${y+2}L${x+w*.36} ${y} ${x+w*.72} ${y+2} ${x+w} ${y+1} ${x+w-1} ${y+h} ${x+w*.58} ${y+h-2} ${x+1} ${y+h}Z`,wood)+grain(x+8,y+7,w-16,h-14,seed)+bolt(x+11,y+11)+bolt(x+w-11,y+h-11)
const stitches=(x:number,y:number,w:number,h:number)=>p(rep(Math.floor(w/18),n=>`M${x+11+n*18} ${y+5}v5M${x+11+n*18} ${y+h-10}v5 `)+rep(Math.floor(h/18),n=>`M${x+5} ${y+11+n*18}h5M${x+w-10} ${y+11+n*18}h5 `),'none','#D0C09A',1.7)
const roundedStitches=(x:number,y:number,w:number,h:number,rad:number)=>p(rep(Math.max(0,Math.floor((w-2*rad)/18)),n=>`M${x+rad+9+n*18} ${y+7}v4M${x+rad+9+n*18} ${y+h-11}v4 `)+rep(Math.max(0,Math.floor((h-2*rad)/18)),n=>`M${x+7} ${y+rad+9+n*18}h4M${x+w-11} ${y+rad+9+n*18}h4 `)+[[x+rad,y+rad,180],[x+w-rad,y+rad,270],[x+w-rad,y+h-rad,0],[x+rad,y+h-rad,90]].map(([cx,cy,angle])=>rep(6,n=>{const a=(angle+(n+.5)*15)*Math.PI/180;return `M${cx+(rad-7)*Math.cos(a)} ${cy+(rad-7)*Math.sin(a)}l${-4*Math.cos(a)} ${-4*Math.sin(a)} `})).join(''),'none','#D0C09A',1.7)
const fabric=(x:number,y:number,w:number,h:number,fill=cloth,rad=14)=>r(x,y,w,h,fill,rad)+(rad>28?roundedStitches(x,y,w,h,rad):stitches(x,y,w,h))+p(rep(6,n=>`M${x+17+n*(w-34)/6} ${y+15}q${(n%3-1)*8} ${h*.24} 0 ${h*.48}t0 ${h*.4} `),'none','#C3B794',1.4)+p(`M${x+11} ${y+h*.21}q${w*.14} -8 ${w*.22} 2M${x+w*.68} ${y+h*.79}q${w*.12} 10 ${w*.24} 2`,'none','#7E775B',2)
const stake=(x:number,y:number)=>g(x,y,p('M-8-11L10-8 6 15-5 14Z',wood)+bolt(0,0,2.5),1,25)
const rope=(d:string,w=6)=>p(d,'none','#796E50',w+3)+p(d,'none','#BDAA7D',w)+p(d,'none','#DFCAA0',1)
const knot=(x:number,y:number)=>e(x,y,9,7,'#AB956A')+p(`M${x-5} ${y-8}l9 16m-10-12 9 15`,'none','#716B4B',2)
const star=(cx:number,cy:number,rad:number,n:number,fill:string)=>p(rep(n,i=>{const a=i*Math.PI*2/n-Math.PI/2,b=a+Math.PI/n;return `${i?'L':'M'}${cx+rad*Math.cos(a)} ${cy+rad*Math.sin(a)}L${cx+rad*.49*Math.cos(b)} ${cy+rad*.49*Math.sin(b)}`})+'Z',fill)
const leaf=(cx:number,cy:number,s=1,a=0)=>g(cx,cy,p('M0-83Q99-38 64 37Q33 81 0 96Q-101 35-67-40Q-47-76 0-83Z','#879572','#596E56',3)+p('M0-69Q-21 6 0 79M-8-27l45-24M-9 16l-39-22M-3 48l32-20','none','#C3C7A1',2),s,a)
const crystal=(x:number,y:number,s=1,a=0)=>g(x,y,p('M0-49L29-23 23 32 0 51-26 23-24-20Z','#96AAA0','#5E776D',3)+p('M0-49L8-7 0 51-9 0Z','#CCD2B8','#829C8B',1.5)+p('M-24-20L8-7 23 32','none','#E4E4C9',2),s,a)
const points=(n:number,rad:number,fn:(x:number,y:number,i:number)=>string)=>rep(n,i=>{const a=i*2*Math.PI/n-Math.PI/2;return fn(300+rad*Math.cos(a),300+rad*Math.sin(a),i)})
const spokes=(n:number,rad:number,fill=wood,w=13)=>points(n,rad,(x,y)=>line(`M300 300L${x} ${y}`,fill,w))
const cornerFeet=(x=83,y=126,w=434,h=348,fill=wood)=>[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([px,py])=>r(px-21,py-22,42,44,fill,6)+bolt(px,py,6)).join('')
const planks=(x:number,y:number,w:number,h:number,n=4)=>rep(n,k=>plank(x,y+k*h/n,w,h/n-3,k+1))
const net=(x:number,y:number,w:number,h:number,step=28)=>p(rep(Math.floor(w/step),n=>`M${x+(n+1)*step} ${y}v${h} `)+rep(Math.floor(h/step),n=>`M${x} ${y+(n+1)*step}h${w} `),'none','#909A80',2)
const ovalNet=(x:number,y:number,rx:number,ry:number)=>p(rep(19,n=>{const dx=(n-9)*rx/10,dy=ry*Math.sqrt(1-(dx/rx)**2);return `M${x+dx} ${y-dy}v${dy*2} `})+rep(17,n=>{const dy=(n-8)*ry/9,dx=rx*Math.sqrt(1-(dy/ry)**2);return `M${x-dx} ${y+dy}h${dx*2} `}),'none','#B5A47A',2)

const tie=(ax:number,ay:number,bx:number,by:number)=>rope(`M${ax} ${ay}Q${(ax+bx)/2+3} ${(ay+by)/2+2} ${bx} ${by}`,3.5)+stake(bx,by)
const roof=(d:string,seams:string,fill=cloth)=>p(d,fill)+p(seams,'none','#776E50',4)+p(seams,'none','#D0C09A',1.3)
function tent(i:number):string{
  switch(i){
    case 0:return [[108,147,59,76],[492,147,541,76],[108,453,59,524],[492,453,541,524]].map(v=>tie(...v as [number,number,number,number])).join('')+roof('M101 142H499V458H101Z','M300 144V457M108 151L300 209 492 151M108 448L300 391 492 448')+line('M300 141V459',wood,8)+bolt(300,162,7)+bolt(300,438,7)
    case 1:return tie(300,111,300,47)+tie(105,461,48,518)+tie(495,461,552,518)+roof('M300 106L506 474H94Z','M300 113L284 466M300 113L108 461M300 113L492 461')+p('M284 465l-49-79 82 40Z','#8E8764')+line('M300 113L284 466',wood,7)
    case 2:return points(8,253,(x,y,n)=>{const a=n*Math.PI/4-Math.PI/2;return tie(300+202*Math.cos(a),300+202*Math.sin(a),x,y)})+e(300,300,204,204,cloth)+points(8,199,(x,y)=>p(`M300 300Q${(x+300)/2+6} ${(y+300)/2} ${x} ${y}`,'none','#B4A47E',3))+e(300,300,22,22,leather)+p('M300 300L269 501 322 501Z','#807C5C')
    case 3:return cornerFeet(109,118,382,350)+roof('M107 118H493V466H107Z','M107 118L300 250 493 118M107 466L300 342 493 466M300 250V342')+roof('M222 466H378L407 535H193Z','M300 468V531')+[[107,118,53,64],[493,118,547,64],[107,466,51,527],[493,466,549,527]].map(v=>tie(...v as [number,number,number,number])).join('')
    case 4:return line('M106 143V464M494 143V464',wood,12)+tie(104,144,47,71)+tie(496,144,553,71)+tie(104,459,47,530)+tie(496,459,553,530)+roof('M100 153L494 104 499 449 106 494Z','M119 215L483 168M122 311L485 264M125 408L488 360')
    case 5:return roof('M107 126Q300 63 493 126V474Q300 536 107 474Z','M111 194Q300 136 489 194M111 300Q300 242 489 300M111 406Q300 348 489 406')+line('M113 135V467M487 135V467',wood,9)+tie(109,136,52,72)+tie(491,136,548,72)+tie(109,464,52,528)+tie(491,464,548,528)
    case 6:return e(300,300,214,208,cloth)+ring(300,300,210,wood,12)+points(12,205,(x,y)=>line(`M300 300L${x} ${y}`,wood,4))+roof('M244 475H356L380 547H220Z','M300 475V544')+e(300,300,26,26,wood)+points(6,250,(x,y,n)=>{const a=n*Math.PI/3-Math.PI/2;return tie(300+215*Math.cos(a),300+208*Math.sin(a),x,y)})
    case 7:return roof('M82 127H518V473H82Z','M190 129V470M410 129V470M300 130V470M85 129L190 198 300 129 410 198 515 129M85 470L190 402 300 470 410 402 515 470')+line('M190 131V468M410 131V468',wood,8)+[[83,127,38,75],[517,127,562,75],[83,473,38,525],[517,473,562,525]].map(v=>tie(...v as [number,number,number,number])).join('')
    case 8:return tie(152,128,86,73)+tie(488,220,546,182)+tie(188,475,135,538)+leaf(261,260,2.12,-24)+leaf(371,309,2.14,38)+leaf(247,387,1.53,-131)+line('M158 144Q290 270 358 450',wood,10)+p('M229 204l-16 7m39 21-16 9m53 23-16 8m43 29-16 7','none','#D4CBA6',3)
    case 9:return poly(300,300,225,6,cloth)+points(6,225,(x,y)=>line(`M300 300L${x} ${y}`,iron,12)+bolt(x,y,7))+points(6,263,(x,y,n)=>{const a=n*Math.PI/3-Math.PI/2;return tie(300+225*Math.cos(a),300+225*Math.sin(a),x,y)})+poly(300,300,29,6,iron)
    case 10:return roof('M121 123L275 93 480 141 513 337 449 482 263 501 97 433 79 265Z','M121 123L263 501M480 141L97 433M121 123L513 337M79 265L449 482',leather)+line('M104 100L482 491M496 109L94 489',bone,17)+[[128,130],[472,148],[111,426],[438,473]].map(([x,y])=>knot(x,y)).join('')+tie(128,143,48,67)+tie(472,148,551,73)
    case 11:return poly(300,300,225,8,cloth)+spokes(8,221,brass,6)+e(300,300,28,28,iron)+[0,90,180,270].map(a=>g(300,300,roof('M-47-199H47L63-257H-63Z','M0-200V-254'),1,a)).join('')
    case 12:return roof('M300 62L477 161 477 445 300 536 123 445 123 161Z','M300 65V533M126 163L300 224 474 163M126 444L300 386 474 444')+line('M118 208L79 264 118 316M482 208L521 264 482 316',wood,13)+line('M300 68V532',wood,9)+tie(126,163,63,113)+tie(474,163,537,113)+tie(126,444,63,498)+tie(474,444,537,498)
    case 13:return roof('M300 106L154 77 52 248 110 441 244 479 300 414 382 501 496 430 548 218 423 72Z','M300 106L300 414M300 273L154 77M300 273L110 441M300 273L423 72M300 273L496 430',leather)+line('M95 164L311 309 493 144M115 432L311 309 474 439',bone,16)+tie(59,251,35,289)+tie(541,221,565,185)+knot(311,309)
    case 14:return roof('M300 74Q69 126 117 345Q139 489 300 531Q461 489 483 345Q531 126 300 74Z','M300 77Q185 279 300 528M300 77Q415 279 300 528')+line('M300 75Q252 38 277 23Q347 38 319 77',wood,12)+leaf(135,347,.9,-89)+leaf(460,347,.9,89)+leaf(300,500,.9,180)+p('M300 100Q249 211 269 287','none','#D6CBA9',4)
    case 15:return e(300,300,227,186,cloth)+p('M99 235Q300 181 501 235M99 365Q300 419 501 365','none','#827657',4)+line('M175 181V419M425 181V419',wood,9)+e(300,475,65,58,cloth)+e(300,475,43,37,'#89866B')+tie(104,225,48,183)+tie(496,225,552,183)+tie(115,416,60,478)+tie(485,416,540,478)
    case 16:return roof('M104 127H496V473H104Z','M300 128V471M108 179H492M108 423H492')+line('M300 126V474',wood,8)+r(281,132,38,337,'none',2,'#8B7C59',3)+stitches(111,138,378,324)+tie(104,127,48,66)+tie(496,127,552,66)+tie(104,473,48,534)+tie(496,473,552,534)
    case 17:return roof('M74 141L152 91H448L526 141V486H74Z','M74 141H526M300 94V484M78 477L300 411 522 477')+roof('M238 100H362V194H238Z','M300 102V191')+roof('M194 486H406V548H194Z','M300 488V545')+cornerFeet(83,154,434,320,iron)+tie(80,146,39,97)+tie(520,146,561,97)
    case 18:return poly(300,300,232,8,cloth,-67.5)+rep(8,n=>{const a=(n*45-67.5)*Math.PI/180;return line(`M300 300L${300+228*Math.cos(a)} ${300+228*Math.sin(a)}`,wood,5)})+roof('M240 477H360L389 542H211Z','M300 480V539')+rep(8,n=>{const a=(n*45-67.5)*Math.PI/180;return tie(300+232*Math.cos(a),300+232*Math.sin(a),300+263*Math.cos(a),300+263*Math.sin(a))})+e(300,300,26,26,leather)
    case 19:return roof('M55 134H252V222H348V134H545V466H348V378H252V466H55Z','M153 136V464M447 136V464M252 300H348M57 139L153 202 250 139M350 139L447 202 543 139M57 461L153 399 250 461M350 461L447 399 543 461')+line('M153 139V461M447 139V461',iron,6)+[107,493].map(x=>roof(`M${x-36} 466H${x+36}L${x+46} 530H${x-46}Z`,`M${x} 468V527`)).join('')+tie(56,134,31,81)+tie(544,134,569,81)
    case 20:return roof('M299 106L503 478H97Z','M299 109V473M250 193L347 193M200 285L397 285M149 381L448 381')+p(rep(13,n=>`M300 ${126+n*25}h8 `),'none','#CFBE96',3)+tie(299,106,299,46)+tie(98,478,48,535)+tie(502,478,552,535)
    case 21:return poly(300,300,224,6,cloth)+spokes(6,218,iron,5)+e(300,300,25,25,iron)+roof('M202 442H398L427 521H173Z','M300 445V518')+points(6,260,(x,y,n)=>{const a=n*Math.PI/3-Math.PI/2;return tie(300+224*Math.cos(a),300+224*Math.sin(a),x,y)})
    case 22:return cornerFeet(99,108,402,384,wood)+roof('M104 110H496V490H104Z','M300 112V487M107 111L300 187 493 111M107 487L300 413 493 487')+line('M104 137V466M496 137V466M104 137H496M104 466H496M216 113V489M384 113V489',wood,14)+[[104,137],[496,137],[104,466],[496,466]].map(([x,y])=>bolt(x,y,8)).join('')
    case 23:return roof('M126 129Q300 59 474 129L509 300 474 471Q300 541 126 471L91 300Z','M126 186Q300 121 474 186M99 300H501M126 414Q300 479 474 414')+line('M137 126Q114 300 137 474M463 126Q486 300 463 474',iron,7)+[209,296,383].map(y=>r(109,y,382,17,'#8C7B58',3)).join('')+tie(126,129,62,74)+tie(474,129,538,74)+tie(126,471,62,526)+tie(474,471,538,526)
    default:throw new Error('未知帐篷构造。')
  }
}

const pillow=(x:number,y:number,w=208,h=73)=>fabric(x,y,w,h,'#CFC3A2',h*.32)+p(`M${x+14} ${y+h*.55}q${w*.18} -10 ${w*.29} 0M${x+w*.69} ${y+h*.55}q${w*.15} 9 ${w*.24} -2`,'none','#A29A79',2)
const hide=(d:string,fill=leather)=>p(d,fill)+p('M163 176l11 21m271-18-10 21M149 291l14 13m290-5-13 13M177 428l15-4m235-1-13-3','none','#C9BA94',3)
function bedroll(i:number):string{
  switch(i){
    case 0:return r(122,67,356,466,wood,9)+r(140,82,320,436,'#AA9A71',4)+net(149,90,302,418,16)+fabric(119,60,23,480,cloth,5)+fabric(458,60,23,480,cloth,5)+pillow(182,97,236,70)
    case 1:return hide('M157 61L222 77 279 48 343 70 423 51 467 99 448 170 470 228 448 303 466 376 443 441 459 506 387 541 314 515 244 540 164 515 130 463 151 393 129 318 151 247 131 181 146 126Z','#B5AD8D')+p('M156 292Q300 264 447 297','none','#7B795E',5)+pillow(185,103,230,67)
    case 2:return fabric(124,63,352,472,cloth,62)+fabric(320,72,147,451,'#8D9675',45)+pillow(162,94,216,73)+[223,337,445].map(y=>rope(`M457 ${y}q39-11 35 17q-17 20-35 0`,4)).join('')
    case 3:return fabric(118,60,364,480,cloth,20)+[143,242,341,440].map(y=>fabric(139,y,322,84,'#B7AB85',29)).join('')+pillow(174,86,252,63)+p('M146 231H453M145 330H455M146 429H454','none','#7C7659',3)
    case 4:return r(130,71,340,458,'#887B58',8)+net(144,84,312,430,15)+p(rep(27,n=>`M147 ${92+n*15}l302 0 `),'none','#C3AD7D',2)+[[130,71],[470,71],[130,529],[470,529]].map(([x,y])=>rope(`M${x-9} ${y}q-18-20 3-23q25 4 6 26`,4)).join('')+pillow(171,95,258,69)
    case 5:return fabric(113,59,374,482,cloth,27)+p(rep(8,n=>`M${128+n*46} 91l0 430 `)+rep(9,n=>`M128 ${99+n*46}h344 `),'none','#8D8463',2)+pillow(155,85,290,77)+r(129,516,342,15,'#BBA97F',5)
    case 6:return hide('M152 61L218 78 278 51 337 75 404 52 463 94 441 151 472 215 448 287 475 351 449 409 469 480 416 533 344 516 281 541 220 517 151 532 129 473 149 408 126 344 150 281 125 215 147 152 130 95Z','#8D8060')+pillow(164,94,272,83)+[215,443].map(y=>fabric(129,y,342,25,leather,5)+r(289,y-4,34,34,iron,4)).join('')
    case 7:return fabric(107,57,386,486,'#8B9273',18)+fabric(149,91,302,416,cloth,17)+pillow(167,103,266,70)+[151,257,363,469].map(y=>rope(`M107 ${y}l-32-9m32 9-29 15M493 ${y}l32-9m-32 9 29 15`,3.5)).join('')
    case 8:return leaf(292,296,2.51,-6)+leaf(319,346,2.01,176)+p('M300 107Q248 280 301 506M298 179L205 222M281 268L404 310M288 381L210 423','none','#C2C7A0',4)+p('M184 110Q301 65 419 110Q399 166 300 164Q203 165 184 110Z','#C4C4A0')
    case 9:return p('M178 62H422L477 136V465L422 538H178L123 465V136Z',cloth)+fabric(143,143,314,307,'#909779',8)+[186,302,418].map(y=>fabric(126,y,348,27,leather,5)+r(294,y-4,34,35,iron,3)).join('')+pillow(181,86,238,58)
    case 10:return hide('M134 66L229 49 293 83 376 56 462 91 438 177 472 234 449 319 480 389 444 466 461 516 375 541 299 511 208 538 137 497 157 421 126 357 149 274 119 204 150 139Z',leather)+p('M294 79Q252 298 301 509','none','#D0BB8D',5)+[148,245,350,454].map(y=>line(`M143 ${y}l-17 17M453 ${y}l17 17`,bone,9)).join('')+pillow(185,108,227,76)
    case 11:return fabric(122,60,356,480,cloth,42)+rep(8,n=>fabric(141+(n%2)*162,151+Math.floor(n/2)*91,154,82,n%3?'#A6A481':'#879575',12))+p('M164 106L300 77 429 106 407 153H190Z','#CCC2A2')+stitches(133,72,334,456)
    case 12:return p('M300 49L471 139V468L300 550 129 468V139Z',cloth)+p('M171 445V224L224 160 277 224V445M323 445V224L376 160 429 224V445','none','#8D8460',3)+pillow(192,113,216,55)+p('M169 477L300 533 432 477','none','#CDBE95',3)
    case 13:return p('M206 59H395L468 155 450 439 375 538H225L150 439 132 155Z',leather)+rep(6,n=>{const yy=141+n*56;return p(`M162 ${yy}Q215 ${yy+71} 268 ${yy}Q321 ${yy+71} 374 ${yy}Q408 ${yy+43} 442 ${yy}`,'none','#C0AD83',5)})+pillow(196,88,213,66)
    case 14:return p('M300 54Q460 65 447 201Q512 311 435 426Q428 531 300 546Q172 531 165 426Q88 311 153 201Q140 65 300 54Z','#A7AE86','#61765A',3)+p('M300 75Q235 292 300 522M157 206Q300 247 443 206M167 422Q300 387 433 422','none','#D2CCA5',3)+e(300,133,79,62,'#D3C9A7')+rope('M250 517q-38 35-51 15M350 517q38 35 51 15',4)
    case 15:return fabric(99,71,402,459,cloth,85)+[185,294,403].map(y=>fabric(121,y,358,100,['#A89F7C','#909A77','#B6AB86'][Math.floor((y-185)/109)],34)).join('')+pillow(140,98,139,64)+pillow(292,98,165,64)
    case 16:return fabric(104,57,392,486,'#7F8A6C',13)+fabric(138,91,324,420,cloth,17)+pillow(167,109,266,74)+[219,334,450].map(y=>fabric(109,y,382,24,leather,5)+r(283,y-4,36,34,iron,4)).join('')
    case 17:return p('M300 55Q466 58 466 187L406 477Q376 551 300 548Q224 551 194 477L134 187Q134 58 300 55Z',cloth)+e(300,136,118,66,'#77856B')+pillow(207,100,186,64)+p(rep(7,n=>`M${158+n*8} ${201+n*43}Q300 ${222+n*43} ${442-n*8} ${201+n*43} `),'none','#8F8969',3)+p('M448 171L390 480','none','#D1C39E',4)
    case 18:return fabric(117,59,366,482,cloth,20)+fabric(365,72,103,454,'#919A79',21)+pillow(152,90,245,72)+[217,346,470].map(y=>r(438,y,35,20,leather,3)+bolt(457,y+10,4)).join('')+rope('M145 532q-18 30 15 24M455 532q18 30-15 24',4)
    case 19:return rope('M140 121L300 37M460 121L300 37M140 478L300 563M460 478L300 563',6)+line('M127 126H473M127 474H473',wood,15)+p('M140 133Q300 205 460 133L430 471Q300 420 170 471Z','#8D9674')+net(181,173,238,249,19)+pillow(189,167,221,62)+rope('M300 37v-15M300 563v15',8)
    case 20:return fabric(97,58,406,484,'#687D6C',11)+fabric(145,102,310,398,cloth,15)+pillow(171,116,259,71)+[[113,77],[487,77],[113,523],[487,523]].map(([x,y])=>e(x,y,9,9,'#6B7E66',brass,3)).join('')
    case 21:return fabric(113,58,374,484,cloth,28)+[141,207,273,339,405].map(x=>fabric(x,167,56,350,'#B6AB85',27)).join('')+pillow(160,85,280,73)+p('M141 524H460','none','#817B5A',4)
    case 22:return p('M300 51Q467 46 476 181L452 459Q425 545 300 547Q175 545 148 459L124 181Q133 46 300 51Z','#8C9272')+e(300,137,132,75,'#B8B093')+e(300,137,99,49,'#77785F')+fabric(171,198,258,262,cloth,31)+fabric(160,458,280,61,leather,24)+r(283,468,36,40,iron,4)+p('M148 183l16 19m275-18-16 17m-262 76 13 8m253-8-13 8','none','#C7C1A0',4)
    case 23:return line('M117 64V536M483 64V536',wood,21)+fabric(129,83,342,434,cloth,11)+[103,208,393,497].map(y=>rope(`M111 ${y}q35-18 43 7M489 ${y}q-35-18-43 7`,6)).join('')+pillow(171,105,258,69)+line('M117 90H483M117 510H483',wood,11)
    default:throw new Error('未知铺盖构造。')
  }
}

/** Each frame has its own structural topology, reused only between two different functional equipment families. */
function rackFrame(i:number):string{
  switch(i){
    case 0:return cornerFeet(92,171,416,258)+line('M92 171V429M508 171V429',wood,27)+plank(84,209,432,75)+plank(84,351,432,47)
    case 1:return line('M79 106L137 493M521 106L463 493M86 125H514M129 478H471',wood,25)+plank(97,232,406,87)+bolt(118,279,9)+bolt(482,279,9)
    case 2:return planks(79,105,442,391,5)+line('M90 113H510M90 488H510',iron,15)+rep(6,n=>bolt(113+n*75,258,7))
    case 3:return e(300,300,216,216,wood)+ring(300,300,183,iron,14)+spokes(6,165,wood,13)+e(300,300,31,31,wood)
    case 4:return plank(239,74,122,452)+plank(74,239,452,122)+r(268,268,64,64,iron,5)+bolt(300,300,9)
    case 5:return line('M92 86V506M508 86V506M92 100H508M92 490H508',wood,22)+plank(94,123,412,85)+line('M94 209L141 478M506 209L459 478',wood,16)
    case 6:return plank(65,109,470,382)+[164,273,382].map(x=>line(`M${x} 126V473`,wood,18)).join('')+line('M81 298H519',wood,16)+plank(56,99,488,34)+plank(56,467,488,34)
    case 7:return ring(300,300,214,wood,30)+spokes(8,199,wood,19)+e(300,300,39,39,iron)+points(8,214,(x,y)=>bolt(x,y,8))
    case 8:return line('M99 466Q200 383 300 310Q424 243 503 123M300 310Q242 190 112 124M199 387L92 301M399 243L501 342',wood,27)+leaf(101,467,.45,-55)+leaf(502,123,.45,35)+leaf(112,124,.45,-35)
    case 9:return poly(300,300,229,6,stone)+poly(300,300,176,6,'#5D6A57')+spokes(3,202,iron,23)+points(6,206,(x,y)=>bolt(x,y,10))
    case 10:return line('M101 472Q122 308 87 119M499 472Q478 308 513 119M98 161Q300 221 502 161M110 430Q300 391 490 430',bone,29)+[[97,165],[503,165],[112,431],[488,431]].map(([x,y])=>knot(x,y)).join('')
    case 11:return star(300,300,236,5,iron)+poly(300,300,129,5,'#76816A')+spokes(5,202,brass,13)+e(300,300,34,34,iron)
    case 12:return planks(101,135,398,337,3)+line('M103 482V179L163 99 223 179V482M238 482V179L298 99 358 179V482M373 482V179L433 99 493 179V482',iron,14)+r(67,104,40,401,stone,5)+r(493,104,40,401,stone,5)
    case 13:return p('M300 423L98 466 53 297 108 115 204 214 300 126 396 214 492 115 547 297 502 466Z',wood)+line('M300 423L110 133M300 423L490 133M300 423L75 313M300 423L525 313',iron,14)+poly(300,366,53,5,iron)
    case 14:return rep(5,n=>g(300,300,p('M0 19Q-131-36-88-150Q0-227 88-150Q131-36 0 19Z',wood)+p('M0-173V-30','none','#BCA77C',3),1,n*72))+e(300,300,33,33,wood)
    case 15:return plank(115,222,370,154)+e(113,300,59,177,wood)+e(487,300,59,177,wood)+line('M90 148Q300 222 510 148M90 452Q300 378 510 452',wood,17)
    case 16:return cornerFeet(89,127,422,346,iron)+plank(80,177,440,66)+plank(80,357,440,66)+line('M100 137V463M500 137V463',iron,16)+[100,500].map(x=>r(x-16,188,32,212,iron,3)).join('')
    case 17:return cornerFeet(84,111,432,378,iron)+line('M85 111H515V489H85Z',iron,25)+line('M107 233H493M107 367H493',iron,19)+bolt(110,135,8)+bolt(490,465,8)
    case 18:return r(71,111,458,380,iron,16)+r(92,132,416,338,'#626D59',5)+[196,300,404].map(x=>line(`M${x} 134V469`,iron,17)).join('')+line('M86 438H514',brass,17)+bolt(94,153,8)+bolt(506,153,8)
    case 19:return [[72,79],[494,79],[72,469],[494,469]].map(([x,y])=>r(x,y,34,52,'#4D5547',12)+r(x+7,y+7,20,38,iron,8)).join('')+line('M89 115H511V485H89Z',iron,22)+plank(100,203,400,64)+plank(100,351,400,49)+line('M89 184H59V419H89M511 184H541V419H511',iron,16)
    case 20:return p('M77 121Q172 76 175 227V374Q184 516 77 479ZM523 121Q428 76 425 227V374Q416 516 523 479Z',wood)+plank(122,201,356,62)+plank(122,361,356,43)+p('M101 149q38 16 41 75M499 149q-38 16-41 75','none','#C8B085',3)
    case 21:return plank(71,105,458,390)+r(95,128,410,344,'#716950',8)+line('M300 135V465M103 300H497',wood,18)+[159,439].map(y=>[171,429].map(x=>r(x-41,y-27,82,54,leather,9)).join('')).join('')
    case 22:return points(3,227,(x,y)=>line(`M300 300L${x} ${y}`,iron,27)+e(x,y,27,22,iron))+ring(300,300,160,iron,18)+spokes(6,160,iron,12)+e(300,300,38,38,iron)
    case 23:return plank(65,100,470,400)+r(89,123,422,354,'#716D54',8)+line('M74 200H35V400H74M526 200H565V400H526',iron,18)+rep(5,n=>r(103+n*81,137,64,326,cloth,18))+line('M82 116H518M82 484H518',iron,11)
    default:throw new Error('未知器械架构造。')
  }
}
const rackSites:readonly (readonly (readonly [number,number,number])[])[]=[
  [[156,300,0],[252,300,0],[348,300,0],[444,300,0]],[[173,283,-10],[300,283,0],[427,283,10]],[[166,250,0],[300,250,0],[434,250,0]],[[300,145,0],[439,371,120],[161,371,240]],
  [[300,141,0],[459,300,90],[300,459,180],[141,300,270]],[[190,247,0],[300,247,0],[410,247,0]],[[124,223,0],[217,223,0],[329,223,0],[441,223,0]],[[300,133,0],[467,300,90],[300,467,180],[133,300,270]],
  [[160,159,-28],[283,302,24],[440,177,34]],[[300,150,0],[432,376,120],[168,376,240]],[[173,235,-12],[300,235,0],[427,235,12]],[[300,106,0],[484,241,72],[413,456,144],[187,456,216],[116,241,288]],
  [[165,289,0],[300,289,0],[435,289,0]],[[141,206,-30],[300,266,0],[459,206,30]],[[300,148,0],[445,252,72],[389,423,144],[211,423,216],[155,252,288]],[[168,300,0],[300,300,0],[432,300,0]],
  [[160,300,0],[254,300,0],[348,300,0],[442,300,0]],[[174,294,0],[300,294,0],[426,294,0]],[[148,294,0],[248,294,0],[352,294,0],[452,294,0]],[[172,296,0],[300,296,0],[428,296,0]],
  [[190,293,0],[300,293,0],[410,293,0]],[[174,224,-20],[426,224,20],[174,389,-20],[426,389,20]],[[300,148,0],[432,376,120],[168,376,240]],[[138,301,0],[219,301,0],[300,301,0],[381,301,0],[462,301,0]],
]
const weaponTop=(x:number,y:number,kind:number,a=0)=>g(x,y,
  kind===0?line('M0-83V83',wood,11)+p('M0-106L17-66 0-48-17-66Z','#A8B0A0'):
  kind===1?line('M0-68V83',wood,13)+p('M-3-75Q-67-77-56-20L-2-29 42-12 48-59 8-75Z',iron)+rope('M-6-66l17 8m-17 3 17 8',3):
  kind===2?line('M0-57V83',leather,12)+p('M-9-86H9L16-18 0 7-16-18Z','#ADB4A1')+line('M-35 18H35',iron,9)+e(0,85,11,10,iron):
  kind===3?p('M0-93Q-77-17 0 93','none',wood,11)+rope('M0-93V93',2.6)+line('M-19-72L22 83',wood,5):
  kind===4?line('M0-85V29',iron,7)+p('M-6 8H13L25 64 8 87-19 70-23 31Z',wood)+r(-14,-17,30,18,iron,3)+line('M-5-62H16',iron,5):
  p('M-20-38H24L31 12 4 27-18 79-35 64-23 12Z',iron)+line('M-18-10H29',wood,10),1,a)
function weaponRack(i:number):string{return rackFrame(i)+rackSites[i].map(([x,y,a],n)=>weaponTop(x,y,i>=16?(i===21?5:4):i===8||i===14?3:(i+n)%3,a)).join('')}
const armorTop=(x:number,y:number,s=1,a=0,style=0)=>g(x,y,
  p('M-18-5L-76-23-113 11-93 63-44 74 0 55 44 74 93 63 113 11 76-23 18-5Z',style===2?leather:iron)+p('M-83-8L-61 49-25 55M83-8L61 49 25 55','none','#BCC2A8',4)+e(0,2,43,47,leather)+e(0,-7,34,37,iron)+p('M-25-20Q0-33 25-20M0-39V18','none','#C8CCB4',3)+(style===1?line('M-96 8L-128-19M96 8L128-19',bone,13):style===3?leaf(-65,26,.46,-45)+leaf(65,26,.46,45):'')+bolt(-63,31,5)+bolt(63,31,5),s,a)
function armorFrame(i:number):string{
  switch(i){
    case 0:return p('M300 77L510 480H90Z',wood)+p('M300 126L460 449H140Z','#8B7954')+line('M300 109V464M120 254H480',wood,28)+r(274,101,52,49,iron,7)
    case 1:return line('M86 147V457M514 147V457M72 224H528M95 416H505',wood,28)+line('M87 161L154 416M513 161L446 416',wood,17)+plank(70,234,460,74)
    case 2:return planks(102,104,396,392,4)+r(84,84,432,32,wood,5)+r(84,484,432,32,wood,5)+[[148,151],[300,151],[452,151],[148,449],[300,449],[452,449]].map(([x,y])=>line(`M${x} ${y-10}v22q13 18 22 0`,iron,11)).join('')
    case 3:return p('M101 107Q300 53 499 107L471 353 300 520 129 353Z',wood)+p('M128 128Q300 84 472 128L446 344 300 487 154 344Z','none',iron,10)+line('M300 125V454',wood,31)+e(300,414,50,45,wood)
    case 4:return cornerFeet(117,117,366,366,wood)+line('M117 117H483V483H117Z',wood,30)+line('M117 117L483 483M483 117L117 483',wood,20)+r(265,255,70,90,iron,8)
    case 5:return e(300,300,222,222,wood)+ring(300,300,204,iron,11)+spokes(4,155,wood,26)+e(300,300,106,109,'#8C7A55')+ring(300,300,89,iron,13)
    case 6:return line('M138 130V470M462 130V470',wood,31)+p('M103 190Q300 304 497 190L477 256Q300 356 123 256ZM103 377Q300 291 497 377L477 428Q300 343 123 428Z',wood)+line('M300 184V425',wood,24)+line('M130 148h-35v49q21 23 36 0M470 435h35v-49q-21-23-36 0',iron,13)
    case 7:return branch('M301 506Q264 351 300 294Q267 177 134 102M300 294Q383 177 461 93M300 294Q231 287 107 350M300 294Q385 348 488 410',43)+rope('M276 271l43 28m-49-12 44 28m-39-10 33 27',8)+e(300,299,43,49,leather)
    case 8:return branch('M300 310Q229 421 93 485M300 310Q371 421 507 485M300 310Q278 151 184 99M300 310Q370 215 453 105',26)+leaf(158,235,.84,-57)+leaf(442,235,.84,57)+leaf(129,462,.63,-109)+leaf(471,462,.63,109)+e(300,300,42,47,wood)
    case 9:return poly(300,300,238,6,iron)+poly(300,300,202,6,stone)+spokes(3,192,iron,31)+points(6,220,(x,y)=>bolt(x,y,11))+r(251,238,98,124,iron,10)
    case 10:return line('M300 311Q170 176 111 132M300 311Q430 176 489 132M300 311V506',bone,39)+p('M143 198Q81 73 141 68Q123 115 182 174ZM457 198Q519 73 459 68Q477 115 418 174Z',bone)+p('M178 247L294 219 424 245 452 349 371 432 224 421 151 349Z',leather)+knot(300,441)
    case 11:return poly(300,300,229,8,brass,-67.5)+poly(300,300,207,8,'#77866B',-67.5)+ring(300,300,154,brass,15)+ring(300,300,101,brass,12)+spokes(4,190,brass,10)+e(300,300,33,33,brass)
    case 12:return [[94,113],[452,113],[94,402],[452,402]].map(([x,y])=>r(x,y,54,85,stone,4)).join('')+line('M121 191V396M479 191V396M121 181H479M121 421H479',iron,22)+[222,378].map(x=>line(`M${x-69} 415V230L${x} 127 ${x+69} 230V415`,iron,22)).join('')+line('M300 98V451',iron,15)
    case 13:return p('M300 208L150 99 69 204 108 442 254 494 300 419 346 494 492 442 531 204 450 99Z',iron)+line('M109 201L300 320 491 201M128 426L300 320 472 426',iron,23)+rep(5,n=>e(300,187+n*48,47,33,leather))+line('M139 449L100 511M461 449L500 511',bone,29)
    case 14:return rep(5,n=>g(300,300,p('M0 9Q-145-72-93-165Q0-239 93-165Q145-72 0 9Z',wood),1,n*72))+leaf(190,287,.83,-60)+leaf(410,287,.83,60)+e(300,300,49,50,cloth)
    case 15:return e(122,300,66,183,wood)+e(478,300,66,183,wood)+branch('M114 179Q300 239 486 179M114 421Q300 361 486 421',31)+fabric(188,230,224,155,leather,47)+line('M87 202H41V275M513 399H559V326',iron,15)+bolt(117,300,12)+bolt(483,300,12)
    case 16:return r(102,102,396,396,iron,8)+r(126,126,348,348,'#7A856D',5)+line('M300 150V450M163 243H437M208 356H392',iron,26)+r(264,146,72,63,iron,8)+[[118,118],[482,118],[118,482],[482,482]].map(([x,y])=>bolt(x,y,10)).join('')
    case 17:return e(300,300,232,192,wood)+e(300,300,207,167,'none','#C7B48B',4)+fabric(145,222,310,174,cloth,61)+line('M125 192V408M475 192V408',iron,21)+line('M300 154V444',wood,31)+r(278,145,44,53,iron,9)
    case 18:return p('M126 94H474L514 137V463L474 506H126L86 463V137Z',iron)+r(111,121,378,358,'#78856C',4)+line('M114 397H486M197 152V447M407 152V447',iron,23)+[[118,126],[482,126],[118,474],[482,474]].map(([x,y])=>bolt(x,y,9)).join('')
    case 19:return [[75,79],[491,79],[75,469],[491,469]].map(([x,y])=>r(x,y,34,52,'#4D5547',12)+r(x+7,y+7,20,38,iron,8)).join('')+line('M92 116H508V484H92ZM92 300H508M300 131V469',iron,24)+line('M92 191H49V409H92M508 191H551V409H508',iron,17)
    case 20:return e(300,300,225,225,wood)+e(300,300,203,203,'none','#C6B288',4)+p('M300 157Q175 123 122 216L143 295Q210 232 300 245Q390 232 457 295L478 216Q425 123 300 157Z',wood)+line('M300 161V453',wood,34)+fabric(203,222,194,185,leather,47)
    case 21:return plank(65,122,470,356)+r(88,147,424,306,'#6B7359',8)+rep(3,n=>fabric(103+n*135,161,125,278,cloth,23))+line('M231 144V454M369 144V454',iron,17)+line('M72 127H528M72 473H528',iron,16)
    case 22:return line('M106 108L494 492M494 108L106 492',iron,28)+line('M102 216H498M102 384H498',iron,23)+rope('M114 112L114 488M486 112V488',9)+[[106,108],[494,108],[106,492],[494,492]].map(([x,y])=>r(x-18,y-19,36,38,iron,8)).join('')+bolt(300,300,22)
    case 23:return poly(300,300,240,8,wood,-67.5)+poly(300,300,214,8,'#74806A',-67.5)+poly(300,300,210,8,'none',-67.5)+line('M300 109V491',iron,16)+e(300,300,104,111,cloth)+p('M143 145L460 440M174 119L489 403','none','#D4D9BC',3)+points(8,228,(x,y)=>bolt(x,y,8))
    default:throw new Error('未知盔甲架构造。')
  }
}
function armorRack(i:number):string{
  const frame=armorFrame(i),style=i===8||i===14?3:i===10||i===13?1:i===2||i===7||i===15||i===20?2:0
  if([1,18].includes(i))return frame+armorTop(197,286,.77,0,style)+armorTop(407,286,.77,0,style)
  if(i===21)return frame+[165,300,435].map(x=>armorTop(x,283,.5,0,2)).join('')
  return frame+armorTop(300,286,1.31,0,style)
}

const beam=(x:number,y:number,w:number,h:number,a=0,fill=wood)=>g(x,y,fill===wood?plank(-w/2,-h/2,w,h):r(-w/2,-h/2,w,h,fill,5)+bolt(-w/2+13,0,5)+bolt(w/2-13,0,5),1,a)
const bag=(x:number,y:number,w=116,h=78,a=0)=>g(x,y,p(`M${-w/2+11} ${-h/2}Q0 ${-h/2-10} ${w/2-11} ${-h/2}L${w/2} ${-h/2+12}Q${w/2+6} 0 ${w/2} ${h/2-10}L${w/2-12} ${h/2}Q0 ${h/2+10} ${-w/2+12} ${h/2}L${-w/2} ${h/2-11}Q${-w/2-6} 0 ${-w/2} ${-h/2+11}Z`,cloth)+p(`M${-w/2+13} ${-h/2+9}Q0 ${-h/2} ${w/2-13} ${-h/2+9}M${-w/2+13} ${h/2-9}Q0 ${h/2} ${w/2-13} ${h/2-9}`,'none','#D0BE94',2)+p(`M${-w/2+9} -9q12 9 1 20M${w/2-9} -9q-12 9-1 20`,'none','#7E7356',2),1,a)
const rock=(x:number,y:number,s=1,a=0)=>g(x,y,p('M-57-32L-18-48 33-39 61-4 47 37-9 48-56 23Z',stone)+p('M-44-24L-13-34 28-28 44-7M-40 24l39 9 37-8','none','#BDC3A5',3),s,a)
const barrel=(x:number,y:number,s=1,metal=false)=>g(x,y,e(0,0,76,94,metal?iron:wood)+e(0,0,61,79,'none',metal?'#ABB197':'#C4AE81',4)+(metal?line('M-66-37H66M-68 34H68',iron,10):p('M-37-76V76M0-86V86M37-76V76','none','#756344',3)+line('M-64-42Q0-25 64-42M-64 42Q0 25 64 42',iron,10))+e(22,-35,11,10,metal?iron:wood),s)
const spike=(x:number,y:number,len=180,a=0,fill=wood,w=24)=>g(x,y,p(`M${-w/2} ${len/2}V${-len/2+38}L0 ${-len/2}L${w/2} ${-len/2+38}V${len/2}Z`,fill)+p(`M${-w*.2} ${len/2-12}V${-len/2+45}`,'none','#C7B58B',2),1,a)
const branch=(d:string,w=28)=>line(d,wood,w)+p(d,'none','#C4B188',2)
function barricade(i:number):string{
  switch(i){
    case 0:return [194,299,406].map((y,n)=>beam(300,y,477,61,n%2?9:-7)).join('')+beam(300,300,416,39,-32)+[147,449].map(x=>rope(`M${x} 164q-20 130 3 274m-8-187 23 17m-22-3 22 16`,6)).join('')
    case 1:return beam(300,218,467,37)+beam(300,407,467,35)+rep(7,n=>spike(101+n*66,296,335+(n%3)*22,(n%3-1)*3))+beam(106,420,137,35,55)+beam(496,420,137,35,-55)
    case 2:return r(87,126,426,348,'#7B7551',15)+[106,235,365,494].map(x=>beam(x,300,408,30,90)).join('')+rep(16,n=>p(`M82 ${145+n*21}Q190 ${125+n*21} 300 ${145+n*21}T518 ${145+n*21}`,'none',n%2?'#B29D72':'#806D4D',9))+rope('M95 129V470M505 129V470',5)
    case 3:return e(103,300,64,203,wood)+e(497,300,64,203,wood)+[103,497].map(x=>e(x,300,42,176,'none',iron,12)+line(`M${x} 127V473`,wood,12)).join('')+planks(133,118,334,364,5)+beam(300,299,405,40,-34)+beam(300,299,405,40,34)
    case 4:return r(65,126,470,350,stone,37)+[0,1,2].map(row=>rep(4,n=>rock(114+n*122+(row%2?23:0),176+row*124,.92,(n+row)*13))).join('')+beam(300,299,397,30,-29)
    case 5:return barrel(125,300,1.38)+barrel(475,300,1.38)+planks(182,149,236,300,3)+line('M148 181H452M148 419H452',iron,13)
    case 6:return beam(110,300,415,43,68)+beam(490,300,415,43,-68)+planks(74,139,452,322,3)+line('M97 152V446M503 152V446',iron,14)+[[111,176],[489,176],[111,424],[489,424]].map(([x,y])=>bolt(x,y,10)).join('')
    case 7:return [188,296,405].map((y,n)=>rep(n%2?3:4,k=>bag(n%2?164+k*136:98+k*135,y,129,93,k%2?4:-3))).join('')+beam(76,300,360,24,90)+beam(524,300,360,24,90)
    case 8:return branch('M64 432Q198 343 268 155Q298 89 354 108M96 143Q206 247 420 413Q477 449 538 427M66 304Q278 371 461 143Q491 100 529 99',38)+[[-1,0]].map(()=>leaf(117,166,.7,-50)+leaf(481,411,.7,63)+leaf(473,154,.7,35)).join('')+knot(230,309)+knot(330,262)
    case 9:return line('M300 153V447',iron,26)+[124,300,476].map(x=>poly(x,300,133,6,stone,0)).join('')+line('M79 227H521M79 373H521',iron,24)+[99,300,501].map(x=>bolt(x,227,12)+bolt(x,373,12)).join('')+r(270,100,60,71,iron,6)+r(270,429,60,71,iron,6)
    case 10:return p('M91 150L214 104 290 169 397 99 510 159 489 426 368 492 278 426 161 492 79 405Z',leather)+line('M88 143Q61 299 107 461M510 143Q551 299 491 461',bone,32)+line('M113 167L474 430M485 167L123 430',bone,13)+[[142,175],[461,175],[140,425],[461,425]].map(([x,y])=>knot(x,y)).join('')
    case 11:return [129,300,471].map((x,n)=>p(`M${x-74} ${154+n%2*32}H${x+74}V411L${x} 464 ${x-74} 411Z`,stone)+poly(x,294+n%2*20,34,4,'none',0)+bolt(x,176+n%2*32,9)).join('')+line('M69 421H531',brass,21)+cornerFeet(75,167,450,264,stone)
    case 12:return planks(89,380,422,75,2)+[158,300,442].map(x=>p(`M${x-65} 378V192L${x} 103 ${x+65} 192V378Z`,wood)+p(`M${x-44} 362V206L${x} 144 ${x+44} 206V362`,'none','#C5B38A',3)).join('')+r(64,331,48,145,stone,5)+r(488,331,48,145,stone,5)
    case 13:return p('M300 188L136 82 63 225 108 448 249 501 300 419 351 501 492 448 537 225 464 82Z',iron)+p('M83 230L300 333 517 230M108 403L300 333 492 403','none','#B9BBA0',6)+rep(7,n=>e(300,181+n*40,36+(n%2)*9,25,leather))+line('M137 472L107 509M463 472L493 509',bone,28)
    case 14:return branch('M69 222Q176 99 309 248T538 350M67 391Q245 454 299 252T521 115M133 111Q234 290 161 477M432 119Q353 305 483 472',22)+[135,263,401,492].map((x,n)=>p(`M${x} ${182+n%2*204}l-26-56 47 28m-21 5 35-43-4 55`,wood)).join('')+rope('M144 151Q300 81 459 154M120 440Q300 507 480 438',10)
    case 15:return [132,468].map(x=>e(x,300,91,168,'#9B8A60')+ovalNet(x,300,77,152)+rock(x,277,.54)+rock(x-20,337,.5)).join('')+branch('M157 174Q300 214 443 174M157 300Q300 340 443 300M157 427Q300 387 443 427',25)
    case 16:return [180,300,420].map((y,n)=>rep(n%2?3:4,k=>bag(n%2?164+k*136:97+k*135,y,131,103,k%2?3:-3))).join('')+rock(65,147,.4)+rock(535,453,.4)
    case 17:return cornerFeet(96,159,408,282,iron)+p('M77 147L299 169V453L77 432ZM301 169L523 147V432L301 453Z',iron)+line('M300 166V453',iron,17)+rep(7,n=>bolt(95+n*68,180+(n%2)*5,7)+bolt(95+n*68,421-(n%2)*5,7))+p('M108 199L272 218M329 218L491 199','none','#B6BCA0',3)
    case 18:return [155,300,445].map((x,n)=>beam(x,300,398,59,n%2?18:-18)).join('')+beam(300,216,486,29,0,iron)+beam(300,384,486,29,0,iron)+[110,235,365,490].map(x=>bolt(x,216,9)+bolt(x,384,9)).join('')
    case 19:return line('M70 229H530M70 371H530',iron,23)+[117,300,483].map(x=>p(`M${x-53} 145L${x+34} 128 ${x+63} 170V430L${x+34} 472 ${x-53} 455 ${x-66} 419V181Z`,stone)+e(x,190,15,13,'none',iron,8)+p(`M${x-42} 204v190`,'none','#BEC3A8',4)).join('')
    case 20:return cornerFeet(85,145,430,310,iron)+r(75,131,450,338,'#68715D',9)+net(87,143,426,314,22)+p(rep(21,n=>`M${89+n*21} 145L${89+n*21} 456 `),'none','#B3B79B',1.5)+line('M75 131H525V469H75Z',iron,21)+line('M95 143L505 457',iron,9)
    case 21:return [108,300,492].map(x=>barrel(x,300,1.2,true)).join('')+line('M63 200H537M63 400H537',iron,22)+[74,526].map(x=>line(`M${x} 246h${x<300?-31:31}v108h${x<300?31:-31}`,iron,14)).join('')
    case 22:return beam(114,300,423,45,73)+beam(486,300,423,45,-73)+beam(300,300,496,143)+line('M84 240H516M84 360H516',wood,20)+[108,492].map(x=>bolt(x,274,11)+bolt(x,326,11)).join('')
    case 23:return rep(13,n=>rock(106+n*127%412,129+n*107%340,.52+n%3*.17,n*37))+beam(276,278,455,92,-25)+beam(333,344,418,67,29)+line('M105 129L475 478M461 128L512 352',iron,19)+r(96,421,107,46,'#947B5E',3)+r(434,173,72,52,'#A98D6E',3)
    default:throw new Error('未知路障构造。')
  }
}

function chevalDeFrise(i:number):string{
  switch(i){
    case 0:return beam(300,300,485,74)+rep(6,n=>spike(95+n*82,300,375,n%2?36:-36))+line('M78 260V340M522 260V340',iron,15)
    case 1:return beam(300,300,477,96)+rep(5,n=>spike(111+n*94,300,412,n%2?-24:24,wood,32))+rep(4,n=>knot(159+n*94,300))
    case 2:return line('M95 217H505V383H95Z',wood,33)+[[132,250,-45],[231,350,45],[369,250,-45],[468,350,45]].map(([x,y,a])=>spike(x,y,432,a,wood,32)).join('')+beam(300,300,485,33)
    case 3:return [135,465].map(x=>spike(x,300,445,-32)+spike(x,300,445,32)+bolt(x,300,14)).join('')+[211,300,389].map(y=>beam(300,y,458,28)).join('')
    case 4:return beam(300,300,496,37)+[130,300,470].map(x=>g(x,300,rep(3,n=>spike(0,0,384,n*120,wood,29))+knot(0,0),.74)).join('')
    case 5:return line('M66 244H534M66 356H534',wood,30)+rep(6,n=>beam(83+n*86,300,159,28,90)+spike(83+n*86,300,361,n%2?18:-18,wood,23))
    case 6:return e(300,300,81,81,wood)+rep(8,n=>g(300,300,spike(0,-112,276,0,wood,36),1,n*45))+e(300,300,48,48,iron)+bolt(300,300,14)
    case 7:return [166,434].map(x=>spike(x,300,439,39)+spike(x,300,439,-39)+bolt(x,300,17)).join('')+line('M93 242H507M93 358H507',wood,28)
    case 8:return branch('M62 300Q251 341 540 283',47)+rep(8,n=>{const x=87+n*60,a=n%2?1:-1;return branch(`M${x} 303Q${x-39} ${300+a*95} ${x+22} ${300+a*219}`,25)+p(`M${x+15} ${300+a*192}l7 ${a*27} 9 ${-a*38}Z`,wood)})+knot(213,306)+knot(415,297)
    case 9:return beam(300,300,484,90,0,iron)+rep(6,n=>g(94+n*82,300,spike(0,0,383,0,iron,38)+spike(0,0,338,54,iron,22),1,n%2?0:180))+poly(71,300,45,6,iron,0)+poly(529,300,45,6,iron,0)
    case 10:return line('M63 309Q300 246 538 310',bone,48)+rep(6,n=>{const x=88+n*85;return p(`M${x-14} 304Q${x-63} 178 ${x+20} 78Q${x-4} 216 ${x+20} 301Q${x+63} 425 ${x-20} 522Q${x+4} 386 ${x-14} 304Z`,bone)+knot(x,300)})
    case 11:return star(300,300,115,5,stone)+rep(5,n=>g(300,300,spike(0,-158,220,0,iron,43),1,n*72))+poly(300,300,67,5,brass)+bolt(300,300,14)
    case 12:return [127,300,473].map(x=>p(`M${x-40} 202L${x} 119 ${x+40} 202V397L${x} 481 ${x-40} 397Z`,stone)+spike(x,300,389,-33,iron,23)+spike(x,300,389,33,iron,23)).join('')+line('M86 300H514',iron,27)
    case 13:return p('M300 152L94 204 56 299 120 424 300 366 480 424 544 299 506 204Z',bone)+line('M89 297Q300 224 511 297',bone,32)+rep(8,n=>spike(89+n*60,300,357+(n%3)*19,(n-3.5)*9,bone,24))+line('M141 409L111 493M459 409L489 493',bone,31)
    case 14:return e(220,300,123,216,'none',wood,25)+e(380,300,123,216,'none',wood,25)+rep(10,n=>g(300,300,branch('M-20-65L0-142 36-179M0-142L-23-193',16),1,n*36))+rope('M190 198Q300 149 410 198M190 402Q300 451 410 402',9)
    case 15:return [137,463].map(x=>e(x,300,83,161,wood)+e(x,300,61,139,'none','#CAB387',3)).join('')+branch('M119 202Q300 245 481 202M119 300Q300 344 481 300M119 398Q300 355 481 398',23)+rep(6,n=>spike(99+n*80,300,310,n%2?21:-21,wood,24))
    case 16:return rep(3,n=>beam(300,300,497,51,n*60,iron)+g(300,300,rep(2,k=>r(-242+k*436,-35,48,70,iron,4)),1,n*60))+poly(300,300,76,6,iron)+points(6,48,(x,y)=>bolt(x,y,8))
    case 17:return rep(3,n=>line('M300 300V61',iron,39)+g(300,300,line('M0 0V-239',iron,39)+p('M-33-104L33-104 0-34Z',iron),1,n*120))+rep(3,n=>g(300,300,line('M0 0V227',iron,31),1,n*120))+poly(300,300,49,6,iron)
    case 18:return line('M59 251H541M59 349H541',iron,31)+rep(6,n=>spike(79+n*88,300,361,n%2?23:-23,iron,26))+[66,534].map(x=>r(x-18,226,36,148,iron,3)+bolt(x,250,9)+bolt(x,350,9)).join('')
    case 19:return [110,300,490].map(x=>line(`M${x-56} 119L${x+56} 481M${x+56} 119L${x-56} 481`,iron,22)+bolt(x,300,14)).join('')+net(70,170,460,260,29)+line('M59 170H541M59 430H541',iron,15)
    case 20:return rep(8,n=>g(300,300,spike(0,-143,237,0,iron,27),1,n*45))+poly(300,300,122,8,stone)+points(4,99,(x,y)=>e(x,y,15,15,'none',iron,8))+r(273,273,54,54,iron,6)
    case 21:return rep(4,n=>{const x=118+n*121;return beam(x,300,360,20,31,iron)+beam(x,300,360,20,-31,iron)+bolt(x,300,13)})+line('M65 219H535M65 381H535',iron,17)
    case 22:return [190,300,410].map((y,n)=>beam(300,y,498,64,n%2?7:-7)+g(300,y,r(-247,-36,40,72,iron,4)+r(207,-36,40,72,iron,4),1,n%2?7:-7)).join('')+rep(5,n=>spike(108+n*96,300,405,n%2?23:-23,iron,24))
    case 23:return [113,300,487].map(x=>r(x-34,257,68,86,iron,5)+bolt(x,279,8)+bolt(x,321,8)+line(`M${x} 272V117M${x} 328V483`,iron,22)+spike(x,300,382,35,iron,22)).join('')+line('M68 300H532',iron,30)+[203,397].map(x=>r(x-16,276,32,48,brass,3)).join('')
    default:throw new Error('未知拒马构造。')
  }
}

const targetDisc=(x:number,y:number,rad:number,style=0)=>e(x,y,rad,rad,style===1?iron:'#B8A477')+ring(x,y,rad*.83,style===1?'#A2AC92':'#887853',4)+ring(x,y,rad*.57,'#78866A',rad*.12)+ring(x,y,rad*.3,'#A07859',rad*.12)+e(x,y,rad*.1,rad*.1,'#645E49')
function target(i:number):string{
  switch(i){
    case 0:return points(3,228,(x,y)=>line(`M300 300L${x} ${y}`,wood,27))+e(300,300,203,203,'#B5A16F')+ovalNet(300,300,192,192)+points(8,198,(x,y)=>rope(`M300 300L${x} ${y}`,2.6))+targetDisc(300,300,151)
    case 1:return line('M135 75V525M465 75V525',wood,34)+planks(84,98,432,404,4)+r(105,120,390,360,'none',6,iron,8)+targetDisc(300,300,144)
    case 2:return r(111,82,378,436,wood,8)+p('M157 130L251 102 331 125 437 109 465 201 441 315 466 423 414 481 311 457 202 482 137 419 156 306 135 208Z',leather)+[[150,151],[450,151],[150,449],[450,449]].map(([x,y])=>rope(`M${x} ${y}l${x<300?-35:35} ${y<300?-34:34}`,9)).join('')+e(300,300,102,116,'none','#CFBE99',11)+e(300,300,37,46,'#B59F78')
    case 3:return line('M95 220L64 411M505 220L536 411',wood,29)+points(8,221,(x,y,n)=>{const a=n*Math.PI/4-Math.PI/2;return line(`M${x} ${y}L${300+179*Math.cos(a)} ${300+179*Math.sin(a)}`,wood,12)})+ring(300,300,221,wood,19)+ring(300,300,187,wood,13)+ovalNet(300,300,172,172)+targetDisc(300,300,128)
    case 4:return e(300,300,226,226,wood)+rep(5,n=>p(`M${125+n*88} ${300-Math.sqrt(218**2-(175-n*88)**2)}V${300+Math.sqrt(218**2-(175-n*88)**2)}`,'none','#685C40',4))+ring(300,300,221,iron,15)+targetDisc(300,300,146)
    case 5:return p('M111 91Q300 32 489 91L455 392 300 547 145 392Z',wood)+p('M132 108Q300 58 468 108L436 385 300 521 164 385Z','none',iron,12)+targetDisc(300,267,136)+line('M200 478H400',wood,20)
    case 6:return line('M76 290H524M300 111V491',wood,44)+line('M220 480H380',wood,36)+targetDisc(169,260,102)+targetDisc(437,260,83)+bolt(300,290,18)
    case 7:return [104,230,368,492].map((x,n)=>rock(x,353+n%2*45,.76)).join('')+line('M179 455L300 131 421 455',wood,26)+targetDisc(300,264,185)
    case 8:return branch('M114 459Q168 317 300 105Q432 317 486 459',30)+leaf(300,290,2.45)+p('M210 239Q300 148 390 239Q410 351 300 409Q190 351 210 239Z','#AFA475')+targetDisc(300,294,98)
    case 9:return poly(300,300,239,6,iron)+poly(300,300,210,6,stone)+points(6,226,(x,y)=>bolt(x,y,10))+poly(300,300,144,6,'#A8AD8F')+poly(300,300,87,6,'#7E8A70')+poly(300,300,34,6,'#B3996D')
    case 10:return line('M106 118L494 482M494 118L106 482',bone,38)+p('M154 132L281 92 436 137 481 289 442 441 300 493 149 441 113 288Z',leather)+targetDisc(300,300,147)+[[147,153],[452,153],[147,447],[452,447]].map(([x,y])=>knot(x,y)).join('')
    case 11:return star(300,300,239,5,iron)+points(5,170,(x,y,n)=>targetDisc(x,y,66,n%2))+e(300,300,36,36,brass)
    case 12:return p('M95 477V220L300 62 505 220V477Z',wood)+p('M128 448V236L300 105 472 236V448Z','none',iron,11)+rep(5,n=>line(`M${164+n*68} 236V444`,wood,14))+e(300,296,114,114,'none','#B7BE9B',17)+e(300,296,57,57,'none','#897654',15)+r(64,441,472,51,stone,5)
    case 13:return p('M68 222L154 103 300 189 446 103 532 222 491 449 300 493 109 449Z',wood)+rep(5,n=>g(300,300,p('M-48-90Q0-145 48-90L39 102Q0 152-39 102Z',iron)+e(0,0,22,42,'none','#BCC0A0',5),1,-64+n*32))+line('M114 464L89 505M486 464L511 505',bone,24)
    case 14:return rep(5,n=>g(300,300,p('M0-222Q115-174 79-69Q41-6 0 18Q-111-53-79-144Q-54-206 0-222Z',wood),1,n*72))+targetDisc(300,300,126)+branch('M300 404Q251 467 248 531M300 404Q349 467 352 531',24)
    case 15:return line('M83 300H517',wood,45)+[159,441].map(x=>ring(x,300,112,wood,24)+bag(x,300,162,160)).join('')+[159,441].map(x=>e(x,300,49,49,'none','#8B7956',8)).join('')
    case 16:return cornerFeet(81,95,438,410,iron)+r(95,106,410,388,'#D1CCAC',5)+r(125,132,350,336,'none',2,'#A1A889',2)+line('M88 121H512M88 479H512',iron,13)+targetDisc(300,300,141)+p('M150 300H450M300 156V444','none','#777D63',1.5)
    case 17:return points(3,239,(x,y)=>line(`M300 300L${x} ${y}`,iron,27))+p('M162 80H438L519 161V439L438 520H162L81 439V161Z',iron)+points(8,216,(x,y)=>bolt(x,y,9))+targetDisc(300,300,150,1)
    case 18:return line('M50 183H550M50 417H550',iron,31)+[72,528].map(x=>r(x-19,150,38,300,iron,4)).join('')+[171,429].map(x=>r(x-46,377,92,65,iron,5)+line(`M${x} 374V285`,iron,22)+targetDisc(x,273,108)).join('')
    case 19:return [[72,91],[488,91],[72,459],[488,459]].map(([x,y])=>r(x,y,41,54,'#4D594B',14)).join('')+planks(91,110,418,380,4)+targetDisc(300,300,140)+line('M505 198H558V402H505',iron,21)
    case 20:return [157,443].map(x=>rep(4,n=>bag(x,134+n*107,105,93,n%2?5:-5))).join('')+rep(4,n=>bag(137+n*110,480,105,88,n%2?3:-4))+r(199,125,202,310,wood,6)+r(214,144,172,271,'#D0C7A4',3)+targetDisc(300,279,76)
    case 21:return cornerFeet(85,166,430,269,iron)+planks(75,165,450,270,2)+rep(6,n=>e(149+n%3*151,236+Math.floor(n/3)*133,57,54,'#B99873')+e(149+n%3*151,236+Math.floor(n/3)*133,36,34,'none','#D4BC92',3))+line('M223 174V428M375 174V428',iron,12)
    case 22:return line('M51 427H549',iron,32)+[130,300,470].map((x,n)=>r(x-44,402,88,67,iron,5)+line(`M${x} 403V291`,iron,23)+(n===0?e(x,223,62,73,iron):n===1?poly(x,224,74,4,iron,0):p(`M${x-62} 292V158H${x+62}V292Z`,iron))+e(x,223,25,30,'none','#B7BDA1',5)).join('')
    case 23:return line('M98 475L300 85 502 475M162 475H438',iron,22)+e(300,288,202,202,'#B1A075')+[0,1,2,3,4].map(n=>ring(300,288,187-n*35,['#B9B99B','#797D66','#899A88','#AE9875','#92855D'][n],24)).join('')+e(300,288,20,20,'#665F47')
    default:throw new Error('未知靶架构造。')
  }
}

const cageRect=(x:number,y:number,w:number,h:number,fill=iron,step=51)=>r(x,y,w,h,'#888C6D',8)+net(x+13,y+13,w-26,h-26,step)+line(`M${x} ${y}H${x+w}V${y+h}H${x}Z`,fill,21)+rep(Math.floor(w/step)-1,n=>line(`M${x+(n+1)*step} ${y+5}V${y+h-5}`,fill,11))+cornerFeet(x,y,w,h,fill)
const lock=(x:number,y:number,s=1)=>g(x,y,line('M-13-5V-20Q0-38 13-20V-5',iron,7)+r(-22,-5,44,38,iron,5)+e(0,9,4,5,'#495445')+p('M0 11v8','none','#495445',3),s)
function cage(i:number):string{
  switch(i){
    case 0:return cageRect(105,105,390,390,wood,80)+line('M108 297H492',wood,22)+lock(300,483,.8)
    case 1:return e(300,300,224,224,'#777B5B')+ovalNet(300,300,206,206)+ring(300,300,221,wood,23)+points(10,216,(x,y)=>branch(`M300 300Q${(x+300)/2+15} ${(y+300)/2} ${x} ${y}`,13))+knot(300,300)+lock(300,494,.75)
    case 2:return cageRect(73,128,454,344,iron,47)+line('M83 287H517',iron,13)+r(468,237,56,124,iron,4)+lock(491,289,.8)
    case 3:return cageRect(68,111,464,378,wood,62)+line('M300 112V488',wood,27)+lock(184,476,.75)+lock(418,476,.75)+line('M68 299H532',wood,17)
    case 4:return line('M90 298H510',wood,45)+[74,526].map(x=>e(x,300,31,183,wood)+e(x,300,19,151,'none',iron,8)).join('')+cageRect(112,126,376,338,wood,59)+line('M300 464V556M263 541H337',wood,24)+lock(300,129,.8)
    case 5:return poly(300,300,239,6,wood)+poly(300,300,211,6,'#818464')+points(6,224,(x,y)=>beam(x,y,44,44)+line(`M300 300L${x} ${y}`,wood,22))+poly(300,300,122,6,'none')+points(12,211,(x,y)=>line(`M300 300L${x} ${y}`,wood,8))+lock(300,501,.8)
    case 6:return e(300,300,229,229,'#778068')+ring(300,300,225,iron,24)+spokes(8,217,iron,14)+ring(300,300,139,iron,11)+e(300,300,36,36,iron)+lock(300,484,.9)
    case 7:return p('M101 126H499L535 474H65Z','#86866A')+net(113,142,373,313,21)+line('M101 126H499L535 474H65Z',wood,26)+line('M126 147L95 464M474 147L505 464M104 251H496M91 370H509',wood,18)+lock(300,472,.9)
    case 8:return p('M112 123Q281 57 470 129Q536 256 489 456Q330 530 132 478Q66 308 112 123Z','#7B8765')+branch('M112 123Q281 57 470 129Q536 256 489 456Q330 530 132 478Q66 308 112 123Z',26)+branch('M113 130Q301 219 490 457M467 133Q300 210 133 475M91 273Q300 322 510 274M300 96Q251 293 300 494',16)+leaf(145,145,.5,-45)+leaf(453,461,.5,134)+knot(300,300)+lock(431,463,.7)
    case 9:return poly(300,300,242,8,iron,-67.5)+poly(300,300,216,8,'#7D866B',-67.5)+points(8,219,(x,y)=>line(`M300 300L${x} ${y}`,iron,20)+bolt(x,y,10))+net(158,158,284,284,40)+line('M155 155L445 445M445 155L155 445',iron,18)+lock(455,455,1)
    case 10:return p('M103 127L257 85 468 118 521 294 464 483 280 512 91 455 72 281Z','#81765B')+line('M103 127L257 85 468 118 521 294 464 483 280 512 91 455 72 281Z',bone,28)+line('M103 127L464 483M468 118L91 455M72 281L521 294',bone,15)+p('M145 152L291 116 283 277 126 260ZM311 314L481 307 441 452 302 476Z',leather)+[[103,127],[468,118],[464,483],[91,455]].map(([x,y])=>knot(x,y)).join('')+lock(291,486,.8)
    case 11:return poly(300,300,239,8,brass)+poly(300,300,213,8,'#738575')+spokes(16,211,brass,7)+points(8,219,(x,y,n)=>crystal(x,y,.54,n*45))+ring(300,300,126,brass,9)+poly(300,300,47,8,brass)+lock(300,502,.7)
    case 12:return poly(300,300,243,6,stone)+poly(300,300,212,6,'#78816A')+points(6,216,(x,y)=>line(`M300 300L${x} ${y}`,iron,21))+poly(300,300,141,6,'none')+rep(3,n=>g(300,300,line('M0-211Q-80-80 0 0Q80 80 0 211',iron,18),1,n*60))+lock(300,514,.8)
    case 13:return p('M129 110H471L531 209 531 391 471 490H129L69 391 69 209Z','#788169')+line('M129 110H471L531 209V391L471 490H129L69 391V209Z',iron,26)+net(132,124,336,352,48)+line('M129 110L471 490M471 110L129 490',iron,17)+p('M79 207L26 260 79 299M521 207L574 260 521 299',iron)+poly(300,481,38,5,leather)+lock(300,473,.75)
    case 14:return p('M300 63Q516 156 478 352Q451 480 300 537Q149 480 122 352Q84 156 300 63Z','#85916E')+branch('M300 63Q516 156 478 352Q451 480 300 537Q149 480 122 352Q84 156 300 63Z',23)+rep(5,n=>{const x=170+n*65;return branch(`M${x} ${126+Math.abs(2-n)*44}Q${x-31} 300 ${x} ${474-Math.abs(2-n)*44}`,12)})+branch('M128 227Q300 273 472 227M133 381Q300 335 467 381',12)+line('M300 65Q271 20 322 26',wood,14)+knot(300,64)+lock(300,510,.65)
    case 15:return r(65,117,470,366,'#7C8365',82)+r(65,117,470,366,'none',82,wood,24)+[182,418].map(x=>e(x,300,93,155,'none',wood,17)+ovalNet(x,300,86,145)).join('')+line('M300 123V477',wood,29)+lock(178,460,.75)+lock(422,460,.75)
    case 16:return cageRect(78,118,444,364,iron,23)+[[97,137],[503,137],[97,463],[503,463]].map(([x,y])=>r(x-18,y-18,36,36,iron,3)+bolt(x,y,6)).join('')+lock(300,476,.85)
    case 17:return [[62,69],[494,69],[62,477],[494,477]].map(([x,y])=>r(x,y,44,55,'#495648',15)+r(x+10,y+9,24,37,iron,9)).join('')+cageRect(85,113,430,374,iron,48)+line('M111 488V546H489V488',iron,21)+lock(300,115,.9)
    case 18:return cageRect(54,105,492,390,wood,61)+line('M300 109V491',iron,29)+line('M69 89V511M531 89V511',iron,27)+line('M74 174H526M74 426H526',iron,13)+lock(184,486,.9)+lock(419,486,.9)
    case 19:return poly(300,300,236,8,brass,-67.5)+poly(300,300,217,8,'#81907B',-67.5)+spokes(24,211,brass,5)+ring(300,300,137,brass,9)+points(8,217,(x,y)=>e(x,y,10,10,brass))+e(300,300,29,29,brass)+lock(368,471,.65)
    case 20:return r(70,110,460,380,'#7F886D',70)+net(91,130,418,340,30)+r(70,110,460,380,'none',70,iron,26)+line('M300 120V480M83 300H517',iron,21)+lock(189,471,.8)+lock(411,471,.8)
    case 21:return cageRect(86,112,428,376,iron,28)+line('M300 120V480M94 300H506',iron,25)+[[191,128],[409,128],[191,472],[409,472]].map(([x,y])=>lock(x,y,.65)).join('')+[[92,118],[508,118],[92,482],[508,482]].map(([x,y])=>bolt(x,y,12)).join('')
    case 22:return cageRect(70,105,460,390,iron,51)+[[70,105],[410,105],[70,405],[410,405]].map(([x,y])=>r(x,y,120,90,iron,6)+bolt(x+20,y+20,8)+bolt(x+100,y+70,8)).join('')+line('M79 296H521',iron,23)+lock(300,488,1)
    case 23:return r(75,123,450,354,'#7C8870',8)+net(90,137,420,326,22)+line('M75 123H525V477H75Z',iron,21)+p(rep(11,n=>`M${90+n*39} 138L${90+n*39} 461 `),'none','#BBC1A1',1.4)+line('M169 130L111 470M259 130L201 470M349 130L291 470M439 130L381 470M169 130L227 470M259 130L317 470M349 130L407 470M439 130L497 470',iron,5)+[150,300,450].map(x=>r(x-15,112,30,27,iron,4)+r(x-15,461,30,27,iron,4)).join('')+lock(507,300,.8)
    default:throw new Error('未知笼具构造。')
  }
}

const gateFrame=(fill=iron)=>line('M78 166H522V434H78Z',fill,25)
const gateBars=(n=7,fill=iron)=>rep(n,k=>line(`M${113+k*374/(n-1)} 180V420`,fill,15))
const hinge=(x:number,y:number,fill=iron)=>r(x-28,y-25,56,50,fill,5)+bolt(x-13,y,7)+bolt(x+13,y,7)
function cellGate(i:number):string{
  switch(i){
    case 0:return gateFrame(wood)+gateBars(6,wood)+line('M91 240H509M91 360H509',wood,20)+hinge(74,212)+hinge(74,388)+lock(508,299,.85)
    case 1:return gateFrame()+gateBars()+r(473,263,61,74,iron,5)+hinge(70,214)+hinge(70,386)+lock(505,298,.7)
    case 2:return planks(78,165,444,270,4)+line('M90 208H510M90 392H510',iron,23)+line('M252 299H534',wood,32)+r(403,276,45,47,iron,4)+hinge(73,216)+hinge(73,384)
    case 3:return r(46,145,47,310,wood,6)+r(507,145,47,310,wood,6)+line('M102 167H286V433H102ZM314 167H498V433H314Z',wood,23)+[0,1].map(n=>rep(3,k=>line(`M${134+n*211+k*58} 180V420`,wood,18))).join('')+line('M229 300H389',iron,25)+lock(300,298,.8)
    case 4:return line('M63 124V476M537 124V476',wood,36)+gateFrame(wood)+gateBars(8)+line('M91 239H509M91 360H509',iron,20)+r(36,229,50,140,iron,5)+e(61,276,19,19,wood)+rope('M61 276V142H300',5)+lock(300,423,.7)
    case 5:return r(72,160,456,280,'#7D886D',91)+r(72,160,456,280,'none',91,iron,25)+rep(7,k=>{const x=117+k*61;return line(`M300 300L${x} ${179+Math.abs(3-k)*17}M300 300L${x} ${421-Math.abs(3-k)*17}`,iron,12)})+line('M90 300H510',iron,20)+lock(411,300,.95)
    case 6:return gateFrame(wood)+gateBars(8,wood)+line('M352 171V430M349 221H497V407H349',iron,17)+line('M96 281H339M368 322H520',wood,26)+lock(280,281,.7)+lock(469,324,.65)
    case 7:return planks(78,164,444,272,5)+line('M89 177L511 423M89 423L511 177',iron,24)+line('M83 220H183M83 380H183',iron,27)+lock(490,300,.9)+e(442,300,17,25,'none',iron,8)
    case 8:return branch('M81 172Q300 117 519 172Q491 301 519 428Q300 483 81 428Q109 300 81 172Z',28)+branch('M105 208Q300 329 495 393M105 393Q300 269 495 208M178 161Q229 299 178 439M419 161Q368 299 419 439',15)+leaf(300,300,.67)+lock(472,300,.7)
    case 9:return p('M110 134H490L538 190V410L490 466H110L62 410V190Z',iron)+p('M122 167H478L504 203V397L478 433H122L96 397V203Z','#7B866F')+gateBars(6)+line('M106 300H494',iron,22)+rep(3,n=>line(`M390 ${237+n*63}H526`,iron,19))+lock(457,300,.75)
    case 10:return line('M73 157Q91 300 73 443M527 157Q509 300 527 443',bone,37)+[188,263,338,413].map(y=>line(`M82 ${y}Q300 ${y-22} 518 ${y}`,bone,23)).join('')+[[89,193],[512,193],[89,409],[512,409]].map(([x,y])=>knot(x,y)).join('')+e(300,300,35,35,'none',bone,14)+line('M272 300H441',bone,19)
    case 11:return gateFrame()+gateBars(7,brass)+line('M84 300H516',brass,19)+rep(8,n=>r(91+n*52,153,40,33,stone,3)+p(`M${100+n*52} 163l18 0-9 11Z`,'none','#647462',2))+e(300,300,43,43,brass)+lock(300,300,.7)
    case 12:return p('M65 439V230L139 154H461L535 230V439Z','none',ink,28)+p('M65 439V230L139 154H461L535 230V439Z','none',iron,23)+[167,300,433].map(x=>line(`M${x-54} 428V267L${x} 188 ${x+54} 267V428`,iron,16)).join('')+r(43,365,65,101,stone,4)+r(492,365,65,101,stone,4)+line('M80 430H520',iron,25)+lock(479,300,.8)
    case 13:return p('M78 185L193 119 300 189 407 119 522 185 494 435 300 476 106 435Z',iron)+rep(7,n=>g(300,300,p('M-29-120Q0-151 29-120V109Q0 145-29 109Z',leather),1,-75+n*25))+p('M89 204L300 311 511 204M109 414L300 311 491 414','none','#C6C5A5',7)+line('M422 300H537',bone,24)+lock(479,300,.7)
    case 14:return branch('M81 182Q300 126 519 182V418Q300 474 81 418ZM141 164V436M459 164V436',23)+branch('M112 207L484 393M112 393L484 207M207 166L255 437M393 166L345 437',14)+[145,261,384,463].map((x,n)=>p(`M${x} ${n%2?390:210}l-27 ${n%2?37:-37} 48 ${n%2?-17:17}Z`,wood)).join('')+knot(300,300)+lock(482,300,.7)
    case 15:return e(179,300,117,166,wood)+e(421,300,117,166,wood)+[179,421].map(x=>e(x,300,93,140,'#7D8265')+rep(3,n=>line(`M${x-60+n*60} 181V419`,wood,20))).join('')+e(275,300,24,24,'none',iron,9)+e(325,300,24,24,'none',iron,9)+line('M244 300H356',iron,17)+hinge(71,300)+hinge(529,300)
    case 16:return gateFrame()+gateBars(8)+line('M83 216H517M83 384H517',iron,11)+rep(7,n=>bolt(94+n*68,168,7)+bolt(94+n*68,432,7))+r(461,258,74,84,iron,5)+lock(498,299,.7)
    case 17:return r(72,158,456,284,'#74836B',7)+net(83,170,434,260,20)+gateFrame()+line('M90 183L510 417',iron,10)+line('M247 300H530',iron,30)+lock(458,301,.85)
    case 18:return line('M33 137H567M33 463H567',iron,29)+gateFrame()+gateBars(9)+line('M300 173V428',iron,26)+[111,487].map(x=>r(x-26,115,52,49,iron,6)+e(x,140,13,13,brass)+r(x-26,436,52,49,iron,6)+e(x,461,13,13,brass)).join('')+lock(495,300,.85)
    case 19:return r(72,155,456,290,iron,8)+r(198,195,204,74,'#536251',3)+rep(5,n=>line(`M${221+n*40} 201V263`,iron,10))+p('M98 178H501M98 421H501','none','#A7B297',3)+hinge(71,212)+hinge(71,387)+r(473,291,63,74,iron,4)+lock(503,319,.6)
    case 20:return line('M56 136V464M544 136V464',iron,31)+rep(5,n=>{const x=104+n*98;return line(`M${x-39} 164L${x+39} 436M${x+39} 164L${x-39} 436`,iron,11)+bolt(x,300,8)})+line('M75 160H525M75 440H525',iron,17)+r(507,252,54,96,iron,4)+lock(535,300,.7)
    case 21:return line('M72 163H284V437H72ZM316 163H528V437H316Z',iron,26)+[0,1].map(n=>rep(4,k=>line(`M${109+n*244+k*45} 179V421`,iron,13))).join('')+line('M229 273H388M211 329H371',iron,23)+hinge(66,202)+hinge(534,398)+lock(300,300,.8)
    case 22:return r(62,153,476,294,iron,105)+r(87,179,426,242,'#73836E',85)+[215,272,329,386].map(y=>line(`M${y===215||y===386?118:96} ${y}H${y===215||y===386?482:504}`,iron,16)).join('')+e(300,300,49,49,iron)+line('M270 300H330M300 270V330',brass,8)+lock(465,300,.8)
    case 23:return line('M48 152H552M48 448H552',iron,24)+[133,300,467].map(x=>line(`M${x-70} 171H${x+70}V429H${x-70}Z`,iron,18)+rep(3,n=>line(`M${x-43+n*43} 182V418`,iron,11))+lock(x+50,300,.65)).join('')
    default:throw new Error('未知牢门组件构造。')
  }
}

const gear=(x:number,y:number,rad=75,n=12,fill=iron)=>g(x,y,p(rep(n*4,k=>{const a=k*2*Math.PI/(n*4),rr=rad*(k%4===0||k%4===3?.82:1);return `${k?'L':'M'}${num(rr*Math.cos(a))} ${num(rr*Math.sin(a))}`})+'Z',fill)+e(0,0,rad*.62,rad*.62,'#7C866C')+rep(5,k=>g(0,0,line(`M0 ${-rad*.26}V${-rad*.57}`,fill,rad*.11),1,k*72))+e(0,0,rad*.23,rad*.23,fill)+bolt(0,0,rad*.12))
const spring=(x:number,y:number,w=160,h=56,a=0)=>g(x,y,line(`M${-w/2-23} 0H${-w/2}M${w/2} 0H${w/2+23}`,iron,9)+p(rep(12,n=>`M${-w/2+n*w/12} ${-h/2}q${w/12} ${h/2} 0 ${h} `),'none',ink,6)+p(rep(12,n=>`M${-w/2+n*w/12} ${-h/2}q${w/12} ${h/2} 0 ${h} `),'none','#AAB296',3),1,a)
const chain=(d:string)=>line(d,iron,12)+p(d,'none','#AAB598',2)
function trap(i:number):string{
  switch(i){
    case 0:return line('M95 300H505',iron,32)+spring(432,300,95,45,90)+spring(168,300,95,45,90)+p('M109 286Q138 97 300 86Q462 97 491 286L458 271Q419 129 300 121Q181 129 142 271ZM109 314Q138 503 300 514Q462 503 491 314L458 329Q419 471 300 479Q181 471 142 329Z',iron)+rep(8,n=>g(300,300,p('M-12-180L0-137 12-180Z',iron),1,-70+n*20))+rep(8,n=>g(300,300,p('M-12 180L0 137 12 180Z',iron),1,-70+n*20))+r(242,242,116,116,iron,15)+bolt(300,300,11)
    case 1:return rope('M159 154Q320 54 465 189Q549 351 388 472Q215 549 109 379Q48 227 159 154Z',15)+rope('M443 329L478 427',5)+plank(146,250,301,101)+stake(115,197)+stake(478,427)+line('M300 301L441 181',wood,21)+rope('M300 302L469 201',5)+knot(300,300)
    case 2:return planks(91,91,418,418,4)+line('M93 100H507V500H93Z',iron,15)+rep(9,n=>poly(168+n%3*132,168+Math.floor(n/3)*132,31,4,iron,0)+p(`M${168+n%3*132} ${133+Math.floor(n/3)*132}l11 35-11 10-11-10Z`,'#BCC1A4'))+hinge(87,170)+hinge(87,430)
    case 3:return ring(300,300,235,stone,55)+e(300,300,197,197,'#58624E')+net(161,161,278,278,46)+r(151,151,298,298,'none',5,iron,18)+r(480,261,51,78,iron,7)+chain('M491 300L554 300')+e(554,300,18,23,'none',iron,9)
    case 4:return spring(111,300,210,48,90)+spring(489,300,210,48,90)+line('M111 171V429M489 171V429',iron,15)+planks(166,122,268,356,3)+line('M105 270L193 330M495 270L407 330',wood,24)+bolt(111,270,14)+bolt(489,270,14)
    case 5:return cornerFeet(100,151,400,298,wood)+line('M91 150H509V450H91Z',wood,31)+line('M98 228H502',iron,24)+e(207,228,32,32,wood)+chain('M307 227L403 370')+e(430,407,87,87,iron)+e(430,407,56,56,'none','#ADB79B',5)+bolt(430,407,13)
    case 6:return cornerFeet(95,107,410,386,wood)+line('M95 110H505V490H95Z',wood,27)+[160,440].map(x=>e(x,177,44,44,wood)+ring(x,177,28,iron,8)+bolt(x,177,8)).join('')+rope('M159 392V176H440V401',7)+rock(430,416,1.14)+plank(118,335,137,114)+line('M95 261H505',wood,20)
    case 7:return plank(80,103,440,394)+r(103,125,394,350,'#807552',5)+line('M80 212H43V388H80M520 212H557V388H520',iron,17)+[[190,206],[397,199],[302,300],[193,399],[411,398]].map(([x,y],n)=>g(x,y,rep(3,k=>spike(0,0,109,k*120,iron,14))+bolt(0,0,7),1,n*23)).join('')+r(82,104,438,19,wood,3)+r(82,478,438,19,wood,3)
    case 8:return branch('M111 177Q300 74 473 182Q547 329 420 460Q245 536 117 398Q59 287 111 177Z',24)+branch('M124 204Q307 124 435 221M129 389Q313 485 432 383',14)+leaf(212,252,.64,-30)+leaf(380,349,.72,147)+line('M179 305L407 299',bone,20)+stake(135,153)+stake(459,441)+rope('M178 305L428 150',6)
    case 9:return poly(300,300,228,6,iron)+poly(300,300,196,6,'#818C71')+points(6,173,(x,y,n)=>g(x,y,p('M-33-45H33L25 35 0 77-25 35Z',iron)+p('M-12-26V34','none','#BDC4A5',3),1,n*60+180))+e(300,300,83,83,iron)+ring(300,300,61,brass,11)+bolt(300,300,12)
    case 10:return line('M86 300H514',bone,33)+p('M83 282Q123 108 298 88Q473 108 517 282L474 258Q427 156 300 137Q173 156 126 258ZM83 318Q123 492 298 512Q473 492 517 318L474 342Q427 444 300 463Q173 444 126 342Z',bone)+p('M223 255L299 234 383 263 365 348 301 371 237 346Z',bone)+knot(114,300)+knot(486,300)+rope('M260 258L339 345M254 342L346 264',7)
    case 11:return poly(300,300,238,8,stone)+poly(300,300,209,8,'#758575')+points(8,175,(x,y,n)=>r(x-25,y-32,50,64,brass,8)+crystal(x,y,.55,n*45))+gear(300,300,96,12,brass)+points(8,221,(x,y)=>bolt(x,y,7))
    case 12:return r(91,116,418,368,stone,7)+[158,300,442].map(x=>line(`M${x-51} 258V190L${x} 129 ${x+51} 190V258M${x-51} 342V410L${x} 471 ${x+51} 410V342`,iron,17)).join('')+line('M89 257H511M89 343H511',iron,21)+[[76,194],[524,194],[76,406],[524,406]].map(([x,y])=>e(x,y,26,34,iron)+e(x,y,11,18,'#9DA88C')).join('')+r(260,258,80,84,iron,5)+lock(300,299,.75)
    case 13:return p('M293 157L164 88 78 189 102 407 235 505 293 437ZM307 157L436 88 522 189 498 407 365 505 307 437Z',iron)+line('M300 91V509',iron,29)+rep(5,n=>line(`M${139+n*11} ${158+n*64}L278 ${204+n*48}M${461-n*11} ${158+n*64}L322 ${204+n*48}`,leather,18))+[104,496].map(x=>line(`M${x} 271l${x<300?-40:40}-28v114l${x<300?40:-40}-28`,bone,23)).join('')+bolt(300,300,18)
    case 14:return rep(5,n=>g(300,300,p('M-47-86Q-92-203 0-226Q92-203 47-86L0-48Z',wood)+rope('M0-223V-98',4),1,n*72))+e(300,300,95,95,wood)+e(300,300,69,69,'#9EA780')+rope('M115 235Q300 48 485 235Q522 458 300 498Q78 458 115 235Z',6)+e(300,300,21,21,brass)
    case 15:return r(72,131,456,338,wood,67)+r(95,154,410,292,'#B09D74',49)+spring(184,300,185,62,90)+spring(416,300,185,62,90)+p('M235 225Q300 163 365 225L383 368Q300 442 217 368Z',wood)+p('M244 237Q300 189 356 237','none','#D1B98B',4)+line('M106 300H494',iron,16)+bolt(300,300,15)
    case 16:return line('M66 300H534M149 270V330M451 270V330',iron,27)+spring(134,300,193,56,90)+spring(466,300,193,56,90)+p('M127 277Q157 131 300 111Q443 131 473 277L433 256Q393 174 300 153Q207 174 167 256ZM127 323Q157 469 300 489Q443 469 473 323L433 344Q393 426 300 447Q207 426 167 344Z',iron)+rep(7,n=>g(300,300,p('M-11-150L0-117 11-150Z',iron),1,-60+n*20))+rep(7,n=>g(300,300,p('M-11 150L0 117 11 150Z',iron),1,-60+n*20))+r(248,246,104,108,iron,8)+bolt(300,300,11)
    case 17:return r(83,128,434,344,iron,19)+e(284,294,136,136,brass)+e(284,294,109,109,'none','#C6B58A',7)+e(284,294,33,33,brass)+line('M284 294L379 209',iron,12)+e(434,373,43,43,wood)+rope('M434 373Q522 194 458 94M434 373Q505 477 549 419',4)+r(395,143,75,47,iron,4)+bolt(109,154,8)+bolt(491,446,8)
    case 18:return points(3,235,(x,y)=>line(`M300 300L${x} ${y}`,iron,27)+e(x,y,25,22,iron))+e(300,300,162,162,iron)+p('M171 299Q182 153 300 161Q433 166 432 301Q429 430 301 428Q187 424 191 301Q193 201 300 202Q392 204 391 300Q388 389 301 388Q232 386 233 301Q236 245 300 245Q348 245 348 300Q348 340 302 340','none','#B6BEA1',9)+e(300,300,25,25,brass)
    case 19:return r(70,120,460,360,iron,10)+r(268,137,244,326,wood,8)+gear(177,232,83)+gear(177,393,73)+line('M176 232V394',leather,11)+r(290,160,198,280,iron,8)+p('M312 185H466M312 414H466','none','#B3BE9F',4)+bolt(390,300,17)
    case 20:return rope('M101 195Q300 51 487 184Q568 366 407 491Q205 549 102 388Q47 288 101 195Z',10)+e(300,300,143,143,iron)+ring(300,300,114,iron,10)+p('M300 194Q180 175 184 299Q188 407 298 402Q392 395 386 301Q381 224 303 228Q240 231 244 298Q247 348 298 345','none','#B5BDA0',8)+r(452,290,78,65,iron,7)+line('M419 300H457',iron,15)
    case 21:return line('M62 131V469M538 131V469',iron,29)+rep(5,n=>r(91+n*84,154,75,292,iron,7)+p(`M${106+n*84} 175v247`,'none','#BAC2A4',3)+bolt(128+n*84,299,8))+line('M81 145H519M81 455H519',iron,18)+gear(539,299,32,10)
    case 22:return line('M68 213H532M68 388H532',iron,22)+r(90,155,197,290,iron,9)+r(313,155,197,290,iron,9)+line('M300 112V490',iron,30)+r(85,91,135,92,stone,6)+line('M155 180V300H287',iron,17)+r(389,417,126,92,stone,6)+line('M454 421V300H314',iron,17)+bolt(300,300,19)
    case 23:return r(74,107,452,386,brass,16)+r(98,132,404,336,'#6F7863',8)+gear(213,246,92,14,brass)+gear(370,222,70,12,brass)+gear(381,366,73,11,brass)+p('M225 437Q107 420 126 319Q143 239 220 259Q277 279 247 337Q224 377 185 349Q158 325 187 302','none','#CAB994',8)+line('M218 438H368',iron,14)+bolt(300,462,6)
    default:throw new Error('未知机关构件构造。')
  }
}

function campKit(i:number):string{
  switch(i){
    case 0:return points(3,233,(x,y)=>line(`M300 300L${x} ${y}`,wood,24))+ring(300,300,110,iron,18)+chain('M300 300L415 400')+p('M415 398q-15 41 16 41q29-8 9-28','none',iron,12)+knot(300,300)
    case 1:return p('M269 84H331L347 137Q454 174 472 300L443 453Q300 535 157 453L128 300Q146 174 253 137Z',leather)+p('M270 109H330M159 311Q300 349 441 311','none','#CDB892',4)+line('M271 98H329',wood,24)+rope('M167 209Q76 158 78 245Q85 307 141 294M433 209Q524 158 522 245Q515 307 459 294',12)+p('M196 188Q170 224 171 267','none','#AF9D7C',3)
    case 2:return rep(4,n=>g(132+n*99,311,spike(0,0,342,n%2?13:-13,wood,28),1))+r(129,168,342,264,wood,17)+rope('M150 207H450M150 231H450M150 255H450M150 279H450M150 303H450M150 327H450M150 351H450M150 375H450',12)+rope('M179 182Q101 81 65 175Q59 248 150 269M421 409Q504 505 544 410Q555 336 450 329',8)
    case 3:return line('M140 260Q61 73 300 69Q539 73 460 260',iron,24)+e(300,318,190,185,iron)+e(300,318,156,151,'none','#ACB79B',6)+p('M456 236L521 211 554 273 467 300Z',iron)+e(300,318,44,42,iron)+line('M273 316H327',wood,15)+bolt(136,259,10)+bolt(464,259,10)
    case 4:return leaf(221,279,2.05,-40)+leaf(373,310,1.9,118)+e(277,275,115,110,wood)+e(277,275,84,79,'#857B56')+fabric(318,349,153,141,leather,17)+p('M333 364Q395 394 456 364','none','#CDBA91',3)+line('M435 137L473 313',wood,17)+e(423,109,27,48,wood)
    case 5:return poly(300,300,242,6,iron,0)+poly(300,300,209,6,wood,0)+line('M75 300H525M300 97V503',leather,36)+r(233,222,134,154,iron,11)+line('M248 237V181H352V237',leather,22)+points(6,223,(x,y)=>bolt(x,y,10))
    case 6:return e(236,300,155,185,iron)+e(236,300,127,156,'none','#B7BEA3',6)+e(394,356,115,137,iron)+e(394,356,87,108,'none','#AFB89B',5)+line('M216 112V65H279V117M412 227V122H470V264',iron,16)+r(92,270,44,67,iron,4)+r(336,350,33,56,iron,4)+bolt(456,236,9)
    case 7:return points(3,234,(x,y)=>line(`M300 300L${x} ${y}`,iron,26)+r(x-17,y-17,34,34,iron,8))+e(300,300,141,141,brass)+ring(300,300,115,brass,9)+e(300,300,68,68,iron)+ring(300,300,43,iron,13)+e(368,229,18,18,brass)+line('M410 300H489V198',brass,14)+e(489,190,17,17,iron)
    default:throw new Error('未知营具构造。')
  }
}
function explorationSupply(i:number):string{
  switch(i){
    case 0:return [205,395].map(x=>e(x,300,135,188,'none','#796A49',21)+e(x,300,109,162,'none','#AF9A6E',18)+e(x,300,83,136,'none','#D3BB8E',15)+e(x,300,58,111,'none','#95835D',14)).join('')+rope('M164 140Q126 64 80 101Q51 148 92 182M432 461Q471 539 523 489Q552 445 511 410',9)+knot(205,139)+knot(395,461)
    case 1:return rope('M144 92V523M456 92V523',15)+rep(5,n=>beam(300,153+n*80,349,34,n%2?2:-2)+rope(`M128 ${143+n*80}q18 23 33 0M439 ${143+n*80}q18 23 33 0`,5))+rope('M144 92q-44-72 8-63q47 13 16 62M456 92q44-72-8-63q-47 13-16 62',10)
    case 2:return rep(4,n=>g(300,300,line('M0 41V-154Q-9-224-83-196L-117-153',iron,25)+p('M-129-139L-98-159-123-170Z',iron),1,n*90))+e(300,300,46,46,iron)+rope('M300 339Q198 403 247 478Q302 548 369 483Q417 422 339 378',12)+bolt(300,300,13)
    case 3:return g(300,300,r(-229,-88,458,176,leather,45)+e(-203,0,29,73,leather)+e(203,0,29,73,'#D5CDAE')+e(203,0,19,55,'none','#ABAA88',3)+[-122,116].map(x=>r(x-15,-94,30,188,iron,5)+bolt(x,-68,6)+bolt(x,68,6)).join('')+rope('M-123-83Q0-241 120-83',10)+p('M-164-53H148','none','#C6B28C',3),1,-12)
    case 4:return plank(74,116,452,368)+r(97,139,406,322,'#6E755D',7)+rep(3,n=>fabric(112+n*127,155,119,290,cloth,20)+crystal(172+n*127,301,.93+n%2*.25,n*37))+line('M75 221H42V379H75M525 221H558V379H525',iron,18)+lock(300,475,.7)
    case 5:return points(4,222,(x,y,n)=>g(300,300,line('M0-160V-223',brass,16),1,n*90))+ring(300,300,224,bone,29)+ring(300,300,188,brass,15)+e(300,300,162,162,'#9AA487')+rep(16,n=>g(300,300,p('M0-142V-159','none','#626F57',n%4?2:4),1,n*22.5))+p('M300 153L335 300 300 447 266 300Z',brass)+p('M300 153L335 300H300Z','#D4C8A4')+e(300,300,15,15,iron)+leaf(300,227,.35)+leaf(300,375,.35,180)
    case 6:return p('M121 166L204 93 394 98 487 168 532 359 438 493 173 494 69 363Z',leather)+fabric(145,179,310,266,leather,18)+e(368,279,72,72,brass)+e(368,279,54,54,'#9DA88B')+p('M368 234L380 280 368 322 356 280Z','#D1C6A1')+beam(244,295,253,31,-47)+beam(262,318,206,31,39)+p(rep(9,n=>`M${167+n*14} ${366-n*15}l8 7`),'none','#4F5546',2)+r(255,466,89,49,iron,5)
    case 7:return plank(66,104,468,393)+r(90,128,420,345,'#747A60',5)+rep(6,n=>{const x=160+n%3*140,y=225+Math.floor(n/3)*153;return fabric(x-50,y-59,100,119,cloth,16)+r(x-29,y-40,58,85,'#A7B29A',14)+r(x-20,y-62,40,25,wood,4)+p(`M${x-18} ${y-28}v55`,'none','#D5DDC0',4)})+line('M73 226H38V376H73M527 226H562V376H527',leather,21)+r(254,469,92,35,iron,5)
    default:throw new Error('未知探险物资构造。')
  }
}

export const ADVENTURE_COLLECTION_LICENSE_REF='MIT-Sceneweave-Adventure-Collection-1'
export const ADVENTURE_COLLECTION_LICENSE=`Sceneweave Adventure, Military and Camping Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG drawings, authored with coding assistance. No third-party art or image pixels are included. Illustrative medieval, western fantasy and 1920s interpretations; technical validation and art review are separate. Tents, cages, gate components and trap mechanisms are independent decorative props. Artwork does not create building interiors, wall attachments, light, trap triggers, damage, secret states or movement permissions.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const defs=`<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="27%" y2="100%"><stop offset="0%" stop-color="#B4A079"/><stop offset="45%" stop-color="#93805A"/><stop offset="100%" stop-color="#716248"/></linearGradient>
<linearGradient id="iron" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#A4AD98"/><stop offset="38%" stop-color="#78856F"/><stop offset="100%" stop-color="#535F51"/></linearGradient>
<linearGradient id="cloth" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#C1B793"/><stop offset="46%" stop-color="#A89E7C"/><stop offset="100%" stop-color="#898263"/></linearGradient>
<linearGradient id="leather" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#B09A76"/><stop offset="42%" stop-color="#8C775B"/><stop offset="100%" stop-color="#726248"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#BBC1A7"/><stop offset="48%" stop-color="#8D9B82"/><stop offset="100%" stop-color="#707F69"/></linearGradient>
</defs>`
function artwork(design:AdventureDesign,i:number):VisualSampleArt{
  const raw=({tent,bedroll,'weapon-rack':weaponRack,'armor-rack':armorRack,barricade,'cheval-de-frise':chevalDeFrise,target,cage,'cell-gate':cellGate,trap,'camp-kit':campKit,'exploration-supply':explorationSupply}[design.category])(i)
  const clearance=['barricade-hex','barricade-rail','cheval-de-frise-beam','cheval-de-frise-frame','cheval-de-frise-hex','cheval-de-frise-dragon','cheval-de-frise-scissor','cheval-de-frise-portable'].includes(design.key)
  const drawing=clearance?g(300,300,g(-300,-300,raw),.84):raw
  const blocking=['tent','weapon-rack','armor-rack','barricade','cheval-de-frise','target','cage','cell-gate'].includes(design.category)
  return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
    sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm/600} ${design.heightMm/600})">${drawing}</g></svg>`,
    footprintMm:{width:Math.round(design.widthMm*.86),height:Math.round(design.heightMm*.86)},
    blocksMovement:blocking,blocksSight:false,renderLayer:design.category==='bedroll'?'ground':'object',shadowClass:blocking?'furniture':'none',
    tags:['原创','军事地牢与野营',design.category,design.era,design.design,'正顶视','独立装饰物件',...(design.category==='tent'?['实心屋面物件','不创建可进入建筑']:[]),...(design.category==='cell-gate'?['平放牢门组件','不创建墙体附着']:[]),...(design.category==='trap'?['静态机关外观','不创建触发或伤害']:[])]}
}
export const ADVENTURE_COLLECTION_ART:readonly VisualSampleArt[]=freezeJson(ADVENTURE_DESIGNS.map(design=>artwork(design,ADVENTURE_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
