import { PERIOD_EQUIPMENT_DESIGNS, type PeriodEquipmentDesign } from '../assets/period-equipment-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

const ink='#393D37',wood='url(#wood)',metal='url(#metal)',brass='url(#brass)',cloth='url(#cloth)',porcelain='url(#porcelain)',glass='#98B4AA'
const rep=(n:number,f:(i:number)=>string)=>Array.from({length:n},(_,i)=>f(i)).join('')
const num=(n:number)=>Math.round(n*100)/100
const p=(d:string,fill='none',stroke=ink,sw=2.4)=>`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
const r=(x:number,y:number,w:number,h:number,fill:string,rad=4,stroke=ink,sw=2.4)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const e=(x:number,y:number,rx:number,ry:number,fill:string,stroke=ink,sw=2.4)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g=(body:string,transform:string)=>`<g transform="${transform}">${body}</g>`
const line=(d:string,color='#AAB1A0',sw=9)=>p(d,'none',ink,sw+3)+p(d,'none',color,sw)+p(d,'none','#DBD6B8',.9)
const bolt=(x:number,y:number)=>e(x,y,3,3,'#ADB9A1','#566653',.8)+p(`M${x-2} ${y}h4`,'none','#51634C',.7)
const bolts=(x:number,y:number,w:number,h:number)=>[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([a,b])=>bolt(a,b)).join('')
const poly=(x:number,y:number,rx:number,ry:number,n:number,fill:string)=>p(rep(n,i=>{const a=i*Math.PI*2/n-Math.PI/2;return`${i?'L':'M'}${num(x+rx*Math.cos(a))} ${num(y+ry*Math.sin(a))}`})+'Z',fill)
function wear(x:number,y:number,rx:number,ry:number,n=55,seed=1):string {
 const paths=['',''];for(let i=0;i<n;i++){const a=(i+seed)*2.399963,s=Math.sqrt((i+.5)/n);paths[i%2]+=`M${num(x+Math.cos(a)*rx*s)} ${num(y+Math.sin(a)*ry*s)}l${1+i%4} ${i%3-1} `}
 return `<g opacity=".27">${p(paths[0],'none','#E4D4AC',.8)+p(paths[1],'none','#504F3D',.8)}</g>`
}
function timber(x:number,y:number,w:number,h:number,rad=6):string {
 const radius=Math.min(rad,w/2,h/2),inset=(dy:number)=>{const near=Math.min(dy,h-dy);return near<radius?radius-Math.sqrt(Math.max(0,radius*radius-(radius-near)**2))+6:6}
 return r(x,y,w,h,wood,rad)+p(rep(17,i=>{const dy=7+(i+1)*(h-14)/18,m=inset(dy)+i%3;return`M${num(x+m)} ${num(y+dy)}q${num((w-m*2)*.23)} ${i%3-1} ${num((w-m*2)*.47)} 0t${num((w-m*2)*.51)} 0 `}),'none','#CCB18A',.7)+wear(x+w/2,y+h/2,w*.38,h*.35,40)
}
const steel=(x:number,y:number,w:number,h:number,rad=7)=>r(x,y,w,h,metal,rad)+wear(x+w/2,y+h/2,w*.34,h*.3,70,5)+p(`M${x+11} ${y+7}h${w-22}`,'none','#D3D3B9',1.5)+bolts(x+Math.max(8,rad*.45),y+Math.max(8,rad*.45),w-Math.max(8,rad*.45)*2,h-Math.max(8,rad*.45)*2)
const ring=(x:number,y:number,rx:number,ry=rx,fill=metal)=>e(x,y,rx,ry,fill)+e(x,y,rx-Math.min(8,rx*.35),ry-Math.min(8,ry*.35),'none','#C4CAB2',1.7)+wear(x,y,rx*.7,ry*.7)
const paper=(x:number,y:number,w:number,h:number)=>r(x,y,w,h,'#D7CDAA',1,'#938E72',1)+p(rep(9,n=>`M${x+7} ${num(y+8+n*(h-16)/9)}h${w-14-n%3*6} `),'none','#9D9A78',.7)
const tray=(x:number,y:number,w:number,h:number,fill=metal)=>r(x,y,w,h,fill,5)+r(x+7,y+7,w-14,h-14,'#4F6454',3,'#B6B99B',1.3)
const handle=(x:number,y:number,w=60)=>line(`M${x} ${y}v-13h${w}v13`,'#A1AD94',7)
const wheel=(x:number,y:number,rx:number,ry=rx)=>ring(x,y,rx,ry)+p(`M${x-rx+5} ${y}h${rx*2-10}M${x} ${y-ry+5}v${ry*2-10}`,'none','#B7BDA6',5)+e(x,y,7,7,brass)
const cart=(body:string)=>line('M62 92H539V389H62Z','#A2B19B',12)+[[65,92],[536,92],[65,389],[536,389]].map(([x,y])=>r(x-11,y-17,22,34,'#435445',10)).join('')+body
const grid=(x:number,y:number,w:number,h:number,cols:number,rows:number,fill=wood)=>rep(rows,j=>rep(cols,i=>r(x+i*w/cols+2,y+j*h/rows+2,w/cols-4,h/rows-4,fill,2)+wear(x+(i+.5)*w/cols,y+(j+.5)*h/rows,w/cols*.25,h/rows*.2,9,i+j)))
const files=(x:number,y:number,w:number,h:number,n=8)=>tray(x,y,w,h,wood)+rep(n,i=>r(x+10+i*(w-20)/n,y+12,(w-24)/n-3,h-24,i%3?'#B9B58F':'#80937B',2,'#677760',1.3)+p(`M${num(x+14+i*(w-20)/n)} ${y+19}h${num((w-28)/n-9)}`,'none','#D1C6A2',2))
const pipe=(d:string)=>line(d,'#A6B6A2',8)
const tube=(x:number,y:number,rx=15,fill=glass)=>e(x,y,rx,rx,fill,'#657F70',2)+e(x-2,y-2,rx*.55,rx*.55,'none','#D0D8BC',1.3)
const basin=(x:number,y:number,rx:number,ry:number)=>e(x,y,rx,ry,porcelain)+e(x,y,rx-12,ry-12,'#A3B8AB','#DCE1CB',2)+e(x,y,7,7,'#586F5B')
const dial=(x:number,y:number,rx=23)=>ring(x,y,rx,rx,brass)+p(rep(12,n=>{const a=n*Math.PI/6;return`M${num(x+(rx-6)*Math.cos(a))} ${num(y+(rx-6)*Math.sin(a))}l${num(3*Math.cos(a))} ${num(3*Math.sin(a))} `}),'none','#4F5C48',1.2)+line(`M${x} ${y}l${rx*.5} ${-rx*.3}`,'#495B47',2)

function archive(i:number):string {
 switch(i){
 case 0:return steel(123,68,354,282)+files(136,310,328,112,9)+handle(265,416,70)
 case 1:return steel(62,73,476,261)+files(74,311,214,111,6)+files(313,311,214,111,6)+handle(136,416)+handle(390,416)
 case 2:return timber(47,90,508,239)+files(64,306,475,109,15)+handle(253,411,92)
 case 3:return timber(48,73,504,334)+grid(72,91,456,177,4,3)+files(79,290,441,97,13)
 case 4:return timber(58,64,484,274)+line('M74 181V423M527 181V423','#9BA48B',11)+timber(86,283,426,146)+paper(101,296,397,120)+handle(263,422,74)
 case 5:return timber(153,83,296,312)+g(timber(-106,-130,212,260)+paper(-100,-124,200,248),'translate(145 240) rotate(-15)')+g(timber(-106,-130,212,260)+paper(-100,-124,200,248),'translate(455 240) rotate(15)')+r(210,103,183,28,'#666B52',4)+rep(6,n=>ring(222+n*28,117,10,10,wood))
 case 6:return timber(62,84,476,312)+grid(80,102,440,273,4,3,'#5C6A51')+rep(12,n=>ring(134+n%4*110,147+Math.floor(n/4)*91,32,25,'#C5BA93'))
 case 7:return timber(48,66,504,347)+grid(67,86,468,194,4,3,'#667052')+rep(7,n=>paper(89+n*62,305+n%2*5,48,83))
 case 8:return timber(65,76,470,325)+files(83,96,79,277,5)+files(437,96,79,277,5)+paper(193,123,216,239)+line('M190 369H413','#BAA37A',12)
 case 9:return ring(300,240,202,184,wood)+rep(6,n=>{const a=n*60;return g(files(-54,-180,108,135,5),`translate(300 240) rotate(${a})`)})+ring(300,240,42,37,brass)
 case 10:return poly(300,240,245,191,8,wood)+files(232,51,136,116,5)+files(232,313,136,116,5)+g(files(-68,-58,136,116,5),'translate(120 240) rotate(90)')+g(files(-68,-58,136,116,5),'translate(480 240) rotate(90)')+paper(229,175,143,128)
 case 11:return p('M48 397V169Q51 58 301 58Q550 59 553 169V397H422V185Q418 145 301 145Q181 145 178 185V397Z',wood)+files(58,286,110,112,4)+files(432,286,110,112,4)+files(213,68,175,68,7)
 case 12:return p('M60 74H534V204H230V405H60Z',wood)+files(77,289,141,122,5)+files(302,81,214,112,8)+paper(78,97,182,88)
 case 13:return cart(files(83,113,434,255,13))+line('M62 138H33V341H62M539 138H568V341H539','#A4B29E',13)
 case 14:return timber(59,93,482,302)+[100,249,398].map(x=>tray(x,121,103,237)+p(rep(12,n=>`M${x+7} ${133+n*18}h89 `),'none','#B4BBA1',2)).join('')+paper(74,319,95,58)
 case 15:return cart(timber(83,112,432,258))+rep(6,n=>line(`M105 ${136+n*42}H493`,'#A0AB90',13))+ring(484,252,39,43,wood)+line('M62 161H33V320H62M539 161H568V320H539','#A5B29C',12)
 case 16:return line('M151 139H173M151 345H173M427 139H448M427 345H448','#ABB39B',12)+timber(167,85,266,312)+timber(28,87,129,308)+timber(443,87,129,308)+grid(184,103,232,276,2,3,'#B5AD86')+line('M158 95V387M442 95V387','#ABB39B',7)
 case 17:return timber(45,76,510,333)+paper(70,91,200,126)+g(paper(-100,-63,200,126),'translate(425 326) rotate(180)')+files(288,103,238,102,7)+files(71,274,236,110,7)+line('M57 240H542',wood,19)
 case 18:return timber(54,69,492,342)+r(76,91,448,298,glass,3,'#C9CEAE',4)+paper(91,104,222,267)+paper(293,146,211,225)+line('M302 85V395','#ACB7A0',11)
 case 19:return ring(300,240,211,183,wood)+rep(8,n=>g(paper(-37,-165,74,105),`translate(300 240) rotate(${n*45})`))+ring(300,240,37,33,brass)
 case 20:return timber(47,93,506,299)+files(216,111,315,261,11)+tray(65,111,129,164,wood)+paper(78,124,104,133)+line('M74 351H192','#A79770',11)
 case 21:return timber(54,86,493,306)+rep(12,n=>ring(117+n%4*121,140+Math.floor(n/4)*99,40-n%3*4,35-n%3*3,wood))+bolts(68,100,465,278)
 case 22:return timber(46,79,510,328)+files(64,98,471,121,17)+files(64,241,330,146,11)+tray(417,241,118,146,wood)+paper(432,257,89,115)
 case 23:return timber(57,77,486,325)+grid(80,101,287,164,6,4,'#83917A')+ring(435,154,51,42,metal)+ring(435,255,51,42,metal)+paper(82,290,286,90)
 default:throw new Error('未知档案设备构造。')
 }
}

const lock=(x:number,y:number)=>r(x-21,y-21,42,42,brass,5)+e(x,y,4,6,'#344A37')
const coffer=(x=64,y=87,w=474,h=309)=>steel(x,y,w,h)+line(`M${x+31} ${y+3}V${y+h-3}M${x+w-31} ${y+3}V${y+h-3}`,'#576B55',13)+bolts(x+31,y+15,w-62,h-30)
const thickDoor=(x:number,y:number,w:number,h:number,a:number)=>g(steel(-w/2,-h/2,w,h,4)+line(`M${-w*.35} 0H${w*.35}`,'#A3AF94',5),`translate(${x} ${y}) rotate(${a})`)
function safe(i:number):string {
 switch(i){
 case 0:return steel(88,99,424,285,31)+handle(229,240,139)+lock(443,299)
 case 1:return coffer()+line('M65 240H538','#879A80',22)+lock(160,240)+lock(441,240)
 case 2:return ring(300,240,200,187)+ring(300,240,167,154)+rep(12,n=>{const a=n*Math.PI/6;return bolt(300+184*Math.cos(a),240+170*Math.sin(a))})+line('M300 240L419 175','#A8B29A',19)+lock(251,280)
 case 3:return steel(53,48,494,384,3)+ring(300,240,173,160)+wheel(300,240,73,66)+bolts(77,70,446,340)
 case 4:return coffer(84,86,432,309)+line('M197 90V391M405 90V391','#7C8C73',18)+line('M84 173H38V306H84M516 173H562V306H516','#A2AD94',13)+lock(300,240)
 case 5:return line('M119 204V248M482 204V248','#AAB396',12)+steel(66,51,468,165)+coffer(66,236,468,186)+grid(83,253,434,151,5,2,'#9DA68A')+line('M93 223H506','#AAB396',8)+handle(267,63,68)
 case 6:return steel(83,63,433,271)+line('M97 191V423M503 191V423','#9FAD90',15)+steel(113,283,374,143)+lock(300,390)+handle(247,417,106)
 case 7:return coffer()+r(102,144,396,32,'#334C36',3)+r(102,289,396,32,'#334C36',3)+line('M113 185H487M113 331H487','#ABAF8E',18)+lock(300,238)
 case 8:return steel(56,57,421,275)+r(76,79,381,233,'#5B6A52',1)+line('M66 332H466','#AAB79E',24)+thickDoor(499,373,158,25,50)+lock(281,170)
 case 9:return steel(58,68,484,249)+line('M72 319H529','#A9B39A',25)+thickDoor(119,370,176,28,-37)+thickDoor(480,370,176,28,37)+line('M300 82V306','#B9BDA4',13)
 case 10:return steel(65,56,390,301)+ring(257,240,153,104)+thickDoor(483,376,158,37,37)+line('M388 314L468 337','#A6B095',21)+wheel(258,242,68,46)
 case 11:return coffer(49,65,502,275)+line('M301 72V332','#ADB99D',20)+steel(72,304,210,121)+lock(175,395)+lock(421,200)
 case 12:return line('M125 194V242M475 194V242','#A4B29A',13)+timber(68,48,465,155)+steel(68,230,465,194)+grid(85,249,274,158,3,2,'#778978')+rep(7,n=>r(383,252+n*20,130,8,'#B8AC8B',3))+line('M92 217H509','#A4B29A',9)
 case 13:return steel(49,68,501,274)+tray(72,91,456,71)+steel(125,302,351,125)+grid(139,316,322,86,5,2,'#A7AE90')+handle(251,416,101)
 case 14:return steel(48,43,484,290)+r(81,74,418,221,'#53634E',4)+paper(98,92,203,174)+thickDoor(493,371,170,31,41)+[[44,60],[537,60],[44,310],[537,310]].map(([x,y])=>steel(x-16,y-14,32,28)).join('')
 case 15:return coffer(61,67,478,340)+p('M184 112H424V251H184Z',metal)+r(202,132,202,43,'#314832',4)+line('M190 239H418','#9FAB90',18)+tray(89,280,139,101)+lock(446,326)
 case 16:return poly(300,240,221,189,8,metal)+rep(4,n=>{const a=n*Math.PI/2+Math.PI/4;return steel(300+214*Math.cos(a)-15,240+174*Math.sin(a)-15,30,30)})+rep(3,n=>{const a=n*Math.PI*2/3;return line(`M300 240L${300+124*Math.cos(a)} ${240+105*Math.sin(a)}`,'#AFB99E',19)})+dial(300,240,37)
 case 17:return steel(58,63,450,283)+p(rep(16,n=>`M${76+n*27} 77V329 `),'none','#ABB79A',8)+p(rep(7,n=>`M70 ${89+n*38}H493 `),'none','#53684F',6)+thickDoor(508,383,137,19,55)
 case 18:return steel(65,92,470,300,43)+line('M299 96V388','#78916F',22)+handle(126,244,101)+handle(372,244,101)+lock(300,318)
 case 19:return coffer(113,91,374,302)+line('M114 138H42V198H114M487 138H558V198H487M114 289H42V349H114M487 289H558V349H487','#A3B095',16)+lock(300,242)
 case 20:return line('M113 195V240M487 195V240','#A5AF94',13)+steel(62,48,476,156)+coffer(62,232,476,195)+ring(190,328,80,76,wood)+ring(407,328,80,76,wood)+line('M300 238V422','#A5AF94',19)+lock(300,330)
 case 21:return steel(45,75,510,334)+grid(62,92,476,300,3,2,metal)+rep(6,n=>lock(140+n%3*158,167+Math.floor(n/3)*150))
 case 22:return steel(66,68,464,343)+ring(300,238,146,134)+rep(4,n=>g(tray(-45,-124,90,95,metal),`translate(300 238) rotate(${n*90})`))+ring(300,238,31,28,brass)+line('M449 238H564V288','#AEB69C',13)
 case 23:return coffer(55,66,490,267)+steel(68,305,220,122)+steel(312,305,220,122)+files(83,318,189,87,7)+files(327,318,189,87,7)+line('M300 79V414','#9EAF91',15)
 default:throw new Error('未知保险设备构造。')
 }
}

const cushion=(x:number,y:number,w:number,h:number,fill=cloth)=>r(x,y,w,h,fill,Math.min(20,w/3,h/3))+r(x+7,y+7,w-14,h-14,'none',Math.min(17,w/4,h/4),'#B5B99B',1.2)+p(`M${x+12} ${y+12}q${w*.2} -5 ${w*.45} 0M${x+12} ${y+h-12}q${w*.4} 6 ${w-24} 0`,'none','#73856F',1.3)+wear(x+w/2,y+h/2,w*.34,h*.34,48)
const bed=(segments=1)=>steel(142,63,316,354)+rep(segments,n=>cushion(160,80+n*320/segments,280,320/segments-6))+line('M142 66H458M142 414H458','#A6B39D',13)
const tools=(x:number,y:number,n=6)=>p(rep(n,k=>`M${x+k*20} ${y}v90 `),'none','#394F3A',6)+p(rep(n,k=>`M${x+k*20} ${y}v90 `),'none','#B7BCA3',3)+rep(n,k=>e(x+k*20,y+84,5,9,'none','#B5BBA2',2))
const bottles=(x:number,y:number,n=5,s=1)=>rep(n,k=>g(r(-12,-19,24,38,glass,6,'#667F6B',2)+ring(0,0,10,9,porcelain)+p('M-5-5l8 3','none','#D7DDC1',1),`translate(${x+k*39*s} ${y}) scale(${s})`))
const gasBottle=(x:number,y:number,rx=38)=>ring(x,y,rx,rx,metal)+line(`M${x-17} ${y}h34`,'#B2B89B',7)+dial(x,y,10)
function medical(i:number):string {
 switch(i){
 case 0:return bed()+cushion(187,91,226,68,'#BAC2AC')+line('M132 136V357M468 136V357','#91A78F',11)
 case 1:return bed(3)+cushion(235,391,65,45)+cushion(309,391,65,45)+line('M160 232H64M440 232H536','#A7B59D',15)+tray(38,184,70,98)+tray(493,184,70,98)
 case 2:return steel(176,54,248,264)+cushion(190,68,220,141)+cushion(190,220,220,81)+line('M205 294L127 407M395 294L473 407','#A8B59F',18)+cushion(64,362,120,64)+cushion(416,362,120,64)+line('M181 244H81M419 244H519','#A8B59F',12)
 case 3:return ring(265,239,95,86,metal)+line('M265 75V374','#A7B59E',13)+cushion(182,90,165,139)+cushion(182,242,165,98)+cushion(213,349,104,75)+cushion(215,47,99,40)+line('M347 189H470V272M182 235H127V307','#A7B59E',15)+basin(470,273,68,58)+pipe('M471 214V141H391')+tray(372,98,124,50)
 case 4:return ring(300,242,136,111)+cushion(229,163,142,160)+cushion(239,101,121,49)+line('M229 192H126V287M371 192H474V287','#A7B99F',12)+ring(125,287,31,30,porcelain)+ring(474,287,31,30,porcelain)+line('M251 117V77H351V117','#B6C0A5',10)
 case 5:return bed()+e(300,130,39,29,'#4E6652','#ADB89C',5)+cushion(449,170,90,160)+line('M447 204H478M447 302H478','#A5B69B',10)
 case 6:return line('M126 43V437M474 43V437',wood,20)+cushion(139,80,322,324,'#B7B599')+p('M156 93L442 391M442 93L156 391','none','#828C72',1.5)+line('M122 101H479M122 380H479',wood,11)
 case 7:return cart(bed()+cushion(187,88,226,66,'#BAC2AD'))+tray(456,181,98,119)+line('M162 64V36H438V64','#A7B89D',12)
 case 8:return steel(91,51,418,378,21)+r(112,74,376,325,porcelain,26)+p('M300 98V369M148 129l132 28m172-28-132 28M148 233l132 28m172-28-132 28M148 329l132 28m172-28-132 28','none','#8CA594',3)+cushion(221,89,158,56)+e(300,385,19,13,'#4F6C55')
 case 9:return line('M100 49V429M500 49V429M100 131H500M100 352H500','#A1B19A',20)+steel(128,63,344,346,25)+p('M145 103H456M145 348H456','none','#B8C3A7',5)+handle(239,413,122)
 case 10:return steel(49,83,502,319)+basin(177,239,99,102)+basin(425,239,99,102)+pipe('M177 123V95H214V132M425 123V95H462V132')+p(rep(16,n=>`M${74+n*29} 375v13 `),'none','#829B85',2.5)
 case 11:return cart(steel(85,116,429,251))+ring(196,239,95,96,metal)+handle(154,234,84)+tray(318,141,170,198)+tools(344,190,6)+bottles(336,323,4,.85)
 case 12:return p('M56 171Q299 25 545 171L511 366Q301 286 90 367Z',metal)+p('M75 177Q300 54 527 177M104 343Q300 273 496 343','none','#BAC6AA',3)+tools(150,166,6)+tools(331,147,6)
 case 13:return cart(steel(88,115,422,252))+gasBottle(180,228,59)+gasBottle(315,228,45)+pipe('M180 228V150H432V239M315 228V170H432')+dial(430,244,37)+tray(124,306,350,48)
 case 14:return timber(50,78,500,328)+bottles(95,117,11,.95)+wheel(176,236,57,48)+wheel(321,236,57,48)+line('M176 236H321','#B9B58F',12)+basin(465,258,49,46)+grid(74,324,451,58,9,1,'#C0BFA0')
 case 15:return cart(steel(86,111,428,257))+rep(5,n=>ring(132+n*77,175,26,24,cloth))+grid(112,227,379,111,3,1,porcelain)+line('M62 141H31V338H62M539 141H568V338H539','#A3B39A',11)
 case 16:return bed(2)+cushion(180,94,238,64,'#C1C8B1')+line('M136 75V42H466V75M136 407V438H466V407','#A7B69D',15)+line('M304 437H365V417','#ADBAA1',9)
 case 17:return bed(2)+line('M153 63H51V414H153M447 63H549V414H447M179 336H91M421 336H509','#A2B39B',13)+wheel(90,337,25,21)+wheel(509,337,25,21)+cushion(202,302,77,76)+cushion(321,302,77,76)
 case 18:return steel(155,145,290,201,21)+cushion(179,171,242,145)+cushion(178,119,244,49)+line('M144 150V343M456 150V343','#A6B69B',19)+r(112,144,18,214,'#41583E',8)+r(470,144,18,214,'#41583E',8)+line('M189 339V405H411V339M159 129V82M441 129V82M159 129H188M441 129H413','#9FAF94',13)+cushion(232,389,136,38)
 case 19:return steel(99,153,402,259,31)+r(125,183,350,198,'#707C64',12)+steel(244,67,112,93)+line('M128 108H486','#A9B99C',15)+steel(355,79,40,57)+p(rep(17,n=>`M${145+n*18} 95v24 `),'none','#697B5D',1.5)
 case 20:return timber(54,77,492,329)+p(rep(35,n=>`M${87+n%7*70} ${110+Math.floor(n/7)*61}v2 `),'none','#53694D',5)+[0,1,2].map(n=>g(timber(-18,-118,36,236),`translate(${196+n*97} 242) rotate(${n*5-5})`)).join('')+p('M113 181H481M113 301H481','none','#5F674A',13)
 case 21:return rep(3,n=>{const a=n*Math.PI*2/3;return line(`M300 240L${300+218*Math.cos(a)} ${240+172*Math.sin(a)}`,'#AAB79E',21)})+line('M120 240H480','#AAB79E',13)+basin(300,240,123,111)+tray(40,205,102,75)+tray(458,205,102,75)
 case 22:return line('M58 353L175 124L297 353L419 124L542 353','#D0C9A8',25)+line('M58 353L175 124L297 353L419 124L542 353','#8A9A81',4)+[58,175,297,419,542].map((x,n)=>line(`M${x-19} ${n%2?124:353}h38`,'#A5B398',25)).join('')
 case 23:return cart(steel(86,113,430,253))+tube(182,224,55)+tube(335,224,55)+steel(391,154,86,178)+pipe('M182 224V150H335V224M335 224H413M182 224V311H456')+line('M437 169H514V219','#A7B69C',12)
 default:throw new Error('未知诊疗设备构造。')
 }
}

const labBase=()=>timber(46,71,510,338)+r(62,88,477,304,'#7A8C76',5,'#BBBEA0',1.7)+wear(300,240,188,116,120,7)
const flask=(x:number,y:number,rx=41)=>e(x,y,rx,rx,glass,'#546F60',2.8)+e(x,y,rx*.65,rx*.65,'#819F8A','#BDD1B5',1.3)+ring(x,y,12,11,porcelain)+p(`M${x-rx*.57} ${y-rx*.24}q${rx*.23} ${-rx*.32} ${rx*.48} ${-rx*.25}`,'none','#D2DDC2',2)
const cylinder=(x:number,y:number,w:number,h:number)=>steel(x,y,w,h,Math.min(18,h*.25))+p(rep(11,n=>`M${x+12+n*(w-24)/10} ${y+8}v${h-16} `),'none','#63795D',2)
/** Horizontal lens barrel viewed from above: narrow body and edge of the forward lens. */
const lens=(x:number,y:number,w:number,h:number,a=0)=>g(steel(-w/2,-h/2,w,h,6)+r(w/2-13,-h*.61,17,h*1.22,brass,3)+p(`M${w/2-3} ${-h*.48}v${h*.96}`,'none','#8DAEA0',4),`translate(${x} ${y}) rotate(${a})`)
function laboratory(i:number):string {
 const base=labBase()
 switch(i){
 case 0:return base+bottles(91,122,11,.92)+line('M165 171V333M428 171V333','#ABBAA1',10)+ring(165,170,24,23)+ring(428,170,24,23)+r(143,204,45,103,glass,5)+r(406,204,45,103,glass,5)+tray(125,321,354,55)+paper(239,195,115,105)
 case 1:return base+flask(148,270,69)+flask(433,270,60)+g(cylinder(-106,-18,212,36),'translate(297 198) rotate(-18)')+pipe('M148 270V229L196 229L205 230M393 168H434V211')+flask(484,337,28)+pipe('M433 270V337H456')+line('M221 156V305M373 135V305','#B3BCA1',6)+ring(221,310,28,15)+ring(373,310,28,15)
 case 2:return base+p('M191 309V203Q191 130 299 130Q409 129 409 203V309H366V205Q365 178 300 178Q235 178 235 205V309Z',metal)+steel(252,196,101,113)+r(278,228,51,55,'#47664F',3)+lens(300,162,94,37,90)+tube(276,116,18)+tube(323,116,18)+grid(83,283,100,93,3,2,'#CBC4A2')+tools(437,237,4)
 case 3:return base+r(104,115,393,246,glass,9,'#D0D3B7',5)+ring(206,239,69,62,brass)+ring(395,239,69,62,brass)+line('M206 239H395','#B2B89B',13)+steel(284,151,34,179)+grid(73,316,68,69,2,2,brass)
 case 4:return base+ring(278,239,141,131)+rep(4,n=>g(steel(-22,-118,44,91,20)+tube(0,-83,15),`translate(278 239) rotate(${n*90})`))+ring(278,239,31,29,brass)+line('M419 239H513V306','#ACB69C',18)+e(513,306,13,20,wood)
 case 5:return base+cylinder(106,136,273,73)+cylinder(106,282,273,73)+pipe('M379 173H437V319H379')+wheel(112,247,43,33)+line('M112 245H220M220 245V209M220 245V282','#B2B99F',13)+ring(467,244,59,53,glass)+pipe('M437 244H467')
 case 6:return base+ring(163,241,85,99,glass)+ring(377,241,73,89,glass)+tube(163,241,24)+tube(377,241,22)+pipe('M163 241V122H377V241M377 241H488V328H300')+wheel(487,243,24,21)+paper(78,330,166,55)
 case 7:return base+grid(75,109,286,252,4,4,'#9A997C')+ring(219,235,80,77,porcelain)+flask(219,235,37)+r(396,157,108,167,wood,24)+p(rep(8,n=>`M${409+n*12} 174v133 `),'none','#5E6449',2)+pipe('M362 238H397')+tools(433,147,3)
 case 8:return base+steel(69,106,464,29)+steel(69,106,26,251)+steel(507,106,26,251)+tray(112,144,375,167,porcelain)+flask(177,232,32)+flask(292,232,41)+flask(411,232,32)+bottles(142,350,9,.9)+pipe('M486 198V153H449')
 case 9:return base+line('M77 243H524','#A8B69C',19)+[113,240,358,491].map((x,n)=>steel(x-23,207,46,73)+lens(x,244,36,100,90)+line(`M${x-26} 274h52`,'#ADB79E',11)).join('')+steel(67,169,62,50)+steel(468,297,67,53)
 case 10:return base+line('M300 127L474 240L300 353L126 240Z','#B7A36E',6)+[[300,127],[474,240],[300,353],[126,240]].map(([x,y],n)=>steel(x-41,y-24,82,48)+p(rep(5,k=>`M${x-25+k*12} ${y-16}v32 `),'none','#556A4C',2)).join('')+dial(300,240,53)+line('M125 240H80M474 240H526','#AFBDA2',7)
 case 11:return base+rep(6,n=>r(100+n%3*149,128+Math.floor(n/3)*139,105,106,glass,9)+r(129+n%3*149,152+Math.floor(n/3)*139,13,57,'#4E654A',3)+r(165+n%3*149,152+Math.floor(n/3)*139,13,57,'#ACAA84',3))+pipe('M133 161H432M133 300H432M432 161V300')+steel(459,206,63,69)
 case 12:return base+ring(302,238,116,111,brass)+poly(302,238,42,39,3,glass)+lens(167,241,173,54)+lens(379,143,161,52,-49)+lens(383,334,161,52,49)+rep(3,n=>{const a=n*Math.PI*2/3;return bolt(302+100*Math.cos(a),238+91*Math.sin(a))})
 case 13:return base+pipe('M86 319H512M132 319V232M244 319V232M356 319V232M468 319V232')+[132,244,356,468].map(x=>ring(x,222,44,42,porcelain)+ring(x,222,14,13,metal)).join('')+wheel(504,319,25,23)+tray(83,112,430,64,porcelain)
 case 14:return base+steel(115,98,370,250,22)+dial(300,181,44)+line('M139 253V423M461 253V423','#9DAD93',12)+tray(158,292,285,130,porcelain)+grid(170,306,261,103,5,2,'#9EAA8F')+handle(259,412,85)
 case 15:return base+grid(79,103,230,166,5,4,'#A8A68A')+p('M375 298V184Q374 140 435 140Q497 140 497 184V298H474V187H398V298Z',metal)+steel(392,201,86,81)+lens(436,151,60,24,90)+line('M85 327H300M90 354H258','#A9B39B',8)+dial(335,347,26)
 case 16:return base+tray(130,129,338,227,'#B6B28D')+[[151,151],[447,151],[151,334],[447,334]].map(([x,y])=>bolt(x,y)).join('')+p('M160 162L440 325M440 162L160 325','none','#A19A70',2)+tools(82,182,2)+tools(501,182,2)+bottles(184,386,7,.7)
 case 17:return base+tray(81,137,185,197,porcelain)+tray(335,137,185,197,porcelain)+grid(98,156,153,159,3,4,glass)+grid(352,156,153,159,3,4,glass)+pipe('M265 172H336M265 296H336M298 172V296')+dial(299,236,23)+bottles(121,374,10,.9)
 case 18:return base+r(102,141,394,199,glass,21)+steel(173,161,17,159)+steel(411,161,17,159)+tube(219,237,24)+tube(377,237,24)+line('M180 162V112H92M419 162V112H511','#AFB18D',7)+dial(300,105,23)
 case 19:return base+ring(167,240,85,81,metal)+e(167,240,28,22,glass)+p('M267 105Q493 125 504 240Q490 353 267 375','none','#BFBF9D',8)+p(rep(25,n=>{const a=-1.1+n*.092;return`M${num(294+200*Math.cos(a))} ${num(240+128*Math.sin(a))}l-9 0 `}),'none','#536B4D',1.5)+lens(298,241,92,33)+line('M253 241H218','#B3BA9F',7)
 case 20:return base+steel(168,111,31,266)+steel(393,111,31,266)+line('M183 124H408M183 349H408','#B4BA9F',12)+line('M173 142L417 332M173 332L417 142','#B8A773',8)+ring(123,309,38,33,glass)+ring(477,309,38,33,glass)+pipe('M123 309V173H183M477 309V173H408')+line('M408 241H528V286','#ABB698',12)
 case 21:return base+ring(212,240,114,110,metal)+ring(212,240,89,85,'#B7AE8A')+line('M212 240L383 171L488 257','#AEB79B',10)+steel(363,143,41,58)+line('M329 331H504','#BFB896',9)+dial(464,337,31)+p(rep(16,n=>`M${339+n*10} 321v20 `),'none','#5B7051',1.3)
 case 22:return base+steel(103,159,284,163)+tray(123,182,95,114,glass)+tray(272,182,95,114,glass)+line('M170 163H320','#ABB99E',16)+lens(426,239,117,43)+bottles(128,367,10,.8)+dial(435,123,29)
 case 23:return base+ring(235,239,143,132,porcelain)+ring(235,239,112,105,metal)+ring(235,239,84,78,glass)+line('M235 239L292 167','#B3BDA0',9)+ring(235,239,15,15,brass)+tray(419,135,100,171,metal)+pipe('M364 193H417M364 281H417')+paper(409,326,117,61)
 default:throw new Error('未知实验设备构造。')
 }
}

function keys(x:number,y:number,w:number,h:number,n=34):string {
 return r(x-4,y-4,w+8,h+8,'#3C4736',2)+rep(n,k=>r(x+k*w/n,y,w/n-.65,h,'#DBD1AC',1,'#8E947B',.7))+rep(n,k=>[0,1,3,4,5].includes(k%7)&&k<n-1?r(x+(k+.69)*w/n,y,w/n*.57,h*.6,'#3E4D3A',1,'#2F4231',.5):'')+p(`M${x} ${y+h-4}h${w}`,'none','#C4B88F',.6)
}
const strings=(d:string)=>p(d,'none','#C6AB71',.8)
const footPedals=(x:number,y:number,w=130)=>line(`M${x+w/2} ${y-40}V${y}M${x} ${y}h${w}`,'#958D6A',7)+rep(3,n=>r(x+16+n*(w-45)/2,y+3,17,27,brass,5))
function wingBody(double=false):string {
 return p('M91 411V107Q94 57 183 57Q321 58 444 119Q527 161 510 239Q490 299 435 328L452 411Z',wood)+p('M112 346V113Q111 81 184 79Q327 82 430 137Q488 171 484 230Q473 277 410 307L417 348Z','#706F4B')+strings(rep(30,n=>`M${132+n*9} 126L${171+n*8} ${318-n*3.7} `))+p('M127 130L424 280M125 265L380 108','none','#B5A06E',9)+keys(115,349,305,48,double?43:36)+(double?keys(115,402,305,28,43):'')+footPedals(204,413,126)
}
const paperRoll=(x:number,y:number,w=226)=>timber(x,y,w,68,5)+ring(x+25,y+34,16,23,brass)+ring(x+w-25,y+34,16,23,brass)+r(x+42,y+11,w-84,46,'#D2C6A2',1)+p(rep(17,n=>`M${x+48+n*6} ${y+19+n%3*10}v7 `),'none','#62724E',2)
const upright=(shape=0)=>{
 const body=shape===1?p('M57 212V112L113 70H487L543 112V212Z',wood):shape===2?p('M59 212V111Q59 69 112 69H488Q541 69 541 111V212Z',wood):timber(59,75,482,137)
 return body+timber(79,213,442,162)+keys(98,230,405,100,43)+line('M99 348H503',wood,15)+footPedals(231,403,138)
}
const squarePiano=(shape=0)=>{
 const body=shape===1?p('M48 135L89 94H511L553 135V363L511 404H89L48 363Z',wood):shape===2?p('M47 124Q146 82 227 113Q302 87 377 113Q460 81 553 124V382Q460 416 377 386Q302 412 227 386Q145 416 47 382Z',wood):timber(47,93,506,310)
 return body+r(77,119,446,174,'#71744D',2)+strings(rep(30,n=>`M88 ${130+n*4.8}H510 `))+line('M95 132L487 270','#BAA270',9)+keys(shape===3?77:153,311,shape===3?293:295,63,36)+footPedals(236,414,128)
}
function keyboard(i:number):string {
 switch(i){
 case 0:return wingBody()
 case 1:return squarePiano()+timber(65,307,70,76)+timber(466,307,70,76)
 case 2:return upright()+p('M78 110H524M82 174H520','none','#BDA776',4)
 case 3:return upright()+paperRoll(143,92,317)+cushion(169,395,112,39)+cushion(322,395,112,39)
 case 4:return line('M92 195V240M508 195V240',wood,16)+timber(69,111,463,100)+rep(30,n=>r(83+n*14.5,129,9,43,metal,2))+timber(80,220,440,148)+keys(97,235,407,95,43)+line('M114 183H489',wood,12)+footPedals(239,396,120)
 case 5:return p('M47 139H73V104H105V72H494V104H527V139H553V369H47Z',wood)+timber(127,91,346,106)+p('M149 110H450M300 96V185','none','#C0AA7D',5)+keys(89,233,421,98,43)+timber(70,217,15,130)+timber(515,217,15,130)+footPedals(234,405,132)
 case 6:return p('M49 113L134 62L219 113L300 61L382 113L467 62L551 113V368H49Z',wood)+timber(131,120,339,84)+keys(111,236,379,97,43)+p('M49 234H101V371H49ZM501 234H551V371H501Z',wood)+footPedals(234,405,132)
 case 7:return upright(2)+e(87,290,25,88,wood)+e(513,290,25,88,wood)+p('M103 342Q300 368 498 342','none','#C1AC7E',6)
 case 8:return squarePiano(1)+[[69,113],[531,113],[69,383],[531,383]].map(([x,y])=>poly(x,y,23,21,4,brass)).join('')+line('M103 107V289M499 107V289',wood,10)
 case 9:return p('M89 409V109L171 57H319L515 182L465 409Z',wood)+p('M113 335V121L182 82H309L482 192L434 335Z','#71764B')+strings(rep(29,n=>`M${132+n*10} 323L${185+n*7} ${96+n*3.1} `))+p('M127 328L416 123M116 196L456 288','none','#B7A06A',10)+keys(113,349,321,55,43)+footPedals(210,418,127)
 case 10:return p('M72 410V127Q74 64 170 64Q397 21 528 163Q560 243 450 328L474 410Z',wood)+p('M97 336V131Q99 89 176 89Q388 50 498 175Q520 239 421 313L437 336Z','#73754C')+strings(rep(34,n=>`M${117+n*9} 326L${172+n*8.6} ${108+n*2.5} `))+line('M111 317L438 155','#B9A16B',12)+keys(99,351,338,54,43)+footPedals(211,418,130)
 case 11:return squarePiano(2)+p('M67 131Q144 103 224 132M377 132Q460 103 532 131M68 367Q147 395 224 367M378 367Q459 395 530 367','none','#C4AD7D',4)+lock(87,344)+lock(513,344)
 case 12:return p('M67 403V100H184L537 403Z',wood)+p('M93 328V121H174L470 328Z','#71774C')+strings(rep(24,n=>`M${111+n*13} 324L${105+n*2.8} ${145+n*7} `))+keys(95,346,387,54,43)+footPedals(233,414,130)
 case 13:return line('M80 226V409M520 226V409',wood,17)+timber(59,67,481,173)+keys(82,151,436,71,43)+timber(77,250,445,42)+rep(17,n=>g(timber(-9,-68,18,136,5),`translate(${116+n*23} ${350-Math.abs(n-8)*3}) rotate(${(n-8)*2})`))+line('M99 407H503',wood,17)
 case 14:return p('M101 412V112Q109 60 199 57Q353 52 471 140Q521 188 469 259Q426 302 425 412Z',wood)+p('M124 337V118Q126 82 198 80Q351 73 449 156Q485 190 446 239Q398 299 399 337Z','#6F734A')+strings(rep(31,n=>`M${141+n*8} 326L${191+n*8} ${100+n*2.6} `))+line('M136 182H444M133 275H408','#BCA472',10)+keys(124,350,277,58,43)+line('M217 409V436M313 409V436','#A39368',10)+footPedals(222,433,97)
 case 15:return upright(2)+ring(89,238,31,29,wood)+ring(513,238,31,29,wood)+timber(77,82,446,77,28)+keys(135,233,331,96,43)
 case 16:return steel(55,68,490,148)+r(81,91,437,99,'#677354',3)+rep(30,n=>r(94+n*14,103,7,66,brass,2))+steel(75,217,450,156,4)+keys(96,233,408,96,43)+[[62,80],[538,80],[85,350],[515,350]].map(([x,y])=>poly(x,y,19,17,4,metal)).join('')+footPedals(236,405,132)
 case 17:return wingBody()+paperRoll(164,263,231)+line('M152 250H415',wood,14)
 case 18:return squarePiano(3)+paperRoll(390,164,140)+line('M383 156V263','#9BA07C',9)+timber(410,309,119,71)
 case 19:return line('M75 194V249M526 194V249M119 333H483V369H119Z',wood,13)+timber(58,78,485,128)+r(76,97,448,88,'#5E6D50',3)+rep(32,n=>r(88+n*13.6,106,8,67,wood,3))+keys(102,240,396,96,43)+timber(58,222,33,148,12)+timber(509,222,33,148,12)+e(75,218,28,25,wood)+e(526,218,28,25,wood)+footPedals(232,402,136)
 case 20:return upright(1)+poly(90,286,41,84,8,wood)+poly(511,286,41,84,8,wood)+keys(135,234,332,93,43)+p('M148 112H453M300 96V192','none','#BBA378',4)
 case 21:return p('M79 406V120Q82 65 164 68Q260 42 292 88Q402 25 471 114Q539 128 508 207Q552 279 442 324L456 406Z',wood)+p('M106 332V123Q109 91 174 96Q259 71 295 116Q402 57 445 137Q510 149 479 208Q513 270 412 307L423 332Z','#74774E')+strings(rep(28,n=>`M${128+n*10} 323L${172+n*9} ${116+n*3} `))+p('M106 125Q187 85 225 115M363 106Q426 90 466 154M465 247Q428 285 411 301','none','#BFA66E',7)+keys(105,348,318,55,43)+footPedals(204,418,137)
 case 22:return r(53,72,494,142,porcelain,12)+timber(104,91,392,99)+r(74,219,452,155,porcelain,10)+keys(99,235,403,95,43)+ring(75,219,25,23,porcelain)+ring(525,219,25,23,porcelain)+footPedals(233,404,134)
 case 23:return squarePiano(3)+timber(397,306,133,73)+p('M418 319h91m-91 11h91m-91 11h91m-91 11h91','none','#C6B185',1.4)
 default:throw new Error('未知钢琴设计。')
 }
}

const balls=(rows=5,x=300,y=185,rr=7)=>rep(rows,j=>rep(j+1,k=>e(x+(k-j/2)*rr*2.15,y+j*rr*1.8,rr,rr,j%3?'#C9C8A8':'#856E4F','#5B654C',1)))
const poolBall=(x:number,y:number,fill='#DDD0AA')=>e(x,y,8,8,fill,'#4D6248',1.3)+e(x-2,y-3,2,2,'#E3DDBE','none',0)
const green='#677E58',greenLight='#A7AE7E',poolWood='#A18B5F'
function billiardBase(pockets=6):string {
 return timber(47,70,506,342,25)+r(66,89,468,304,poolWood,19)+r(82,105,436,272,green,12,'#C0B88C',3)+p('M95 117H504M95 364H504','none',greenLight,1.5)+rep(12,n=>{const x=126+n%6*70,y=n<6?81:401;return e(x,y,2,2,'#D9C99A','#5C674A',.7)})+(pockets?[0,1,2,3,4,5].map(n=>e(n<2?87:n<4?513:300,n%2?373:109,n>3?15:13,n>3?10:12,'#2D4931','#9F9A70',3)).join(''):'')
}
const peg=(x:number,y:number,rr=9)=>ring(x,y,rr,rr,wood)+e(x,y,rr*.42,rr*.42,'#D0C19A','#7C8A63',.6)
const cup=(x:number,y:number,rr=15)=>ring(x,y,rr,rr,brass)+e(x,y,rr*.64,rr*.64,'#304E35','#9BA57E',1)
function billiard(i:number):string {
 switch(i){
 case 0:return billiardBase()+p('M170 115V365M170 176Q266 239 170 302','none','#A2AF80',1.5)+balls(5,354,195)+[240,292,401,467,136].map((x,n)=>poolBall(x,239+n%2*45,['#C4B882','#374F38','#A19B66','#7B6653','#D5CBA6'][n])).join('')
 case 1:return billiardBase(0)+poolBall(189,195)+poolBall(420,290,'#B18A68')+poolBall(356,147,'#D6C492')+p('M300 117V365','none','#A6AE7D',.8)
 case 2:return billiardBase()+balls(4,344,211)+poolBall(163,241)+p('M320 186L394 288H284Z','none','#A89262',4)+tray(154,389,291,27,wood)
 case 3:return billiardBase()+balls(5,355,184,8)+poolBall(162,241)+line('M115 77H486M115 405H486',wood,6)+p(rep(20,n=>`M${122+n*18} 75v5M${122+n*18} 403v5 `),'none','#D4C69A',1)
 case 4:return [[71,85],[528,85],[71,398],[528,398]].map(([x,y])=>poly(x,y,31,28,8,wood)).join('')+billiardBase(0)+[[300,241],[279,241],[321,241],[300,220],[300,262]].map(([x,y])=>peg(x,y,5)).join('')+poolBall(172,178)+poolBall(425,304,'#AD8367')+poolBall(403,154,'#D5C18A')+line('M143 79H454','#B3A474',8)
 case 5:return billiardBase(0)+timber(47,167,23,148)+timber(530,167,23,148)+line('M56 72L83 97M545 72L516 97M56 410L83 383M545 410L516 383','#C1AC7C',12)+rep(9,n=>peg(275+n%3*25,216+Math.floor(n/3)*25,5))+poolBall(173,282)+poolBall(420,155,'#AF8668')+poolBall(408,318,'#D5C38D')
 case 6:return billiardBase(0)+cup(107,241,16)+cup(493,241,16)+rep(10,n=>peg(177+n%5*61,199+Math.floor(n/5)*84,12))+rep(5,n=>poolBall(133+n*82,148,n%2?'#BA9A75':'#D0C29B'))
 case 7:return billiardBase()+r(24,153,27,179,wood,8)+r(550,153,27,179,wood,8)+p('M35 163v159M563 163v159','none','#535F43',4)+balls(4,352,213,8)+poolBall(173,243)
 case 8:return timber(49,65,502,350,81)+r(74,89,453,301,green,62)+[[95,112],[505,112],[95,368],[505,368],[300,93],[300,387]].map(([x,y])=>cup(x,y,12)).join('')+balls(3,350,211,8)+poolBall(169,240)
 case 9:return [0,1,2,3].map(n=>{const x=n%2?516:84,y=n<2?90:390;return steel(x-37,y-37,74,74,2)+poly(x,y,23,23,4,brass)}).join('')+billiardBase()+p('M151 76L190 87L229 76L268 87L307 76L346 87L385 76L424 87L463 76M151 404L190 393L229 404L268 393L307 404L346 393L385 404L424 393L463 404','none','#C1B38C',3)+balls(3,352,213)+poolBall(176,241)
 case 10:return p('M67 58L127 81H473L533 58V137L554 164V315L533 342V421L473 398H127L67 421V342L46 315V164L67 137Z',wood)+billiardBase(0)+line('M77 108V371M522 108V371',wood,13)+poolBall(187,173)+poolBall(402,290,'#B18A68')+poolBall(391,160,'#D4BF85')
 case 11:return p('M51 104Q170 52 300 82Q430 51 550 104V379Q428 429 300 397Q170 428 51 379Z',wood)+billiardBase()+p('M59 118Q126 65 178 93M419 93Q481 65 541 118M59 364Q122 417 179 389M421 389Q485 417 541 364','none','#C6AD7D',7)+balls(4,351,203)+poolBall(174,242)
 case 12:return timber(83,53,434,374,24)+r(107,77,386,326,green,12)+[[118,89],[482,89],[118,391],[482,391]].map(([x,y])=>cup(x,y,16)).join('')+balls(4,338,209)+poolBall(210,283)
 case 13:return poly(300,240,263,197,6,wood)+poly(300,240,236,173,6,green)+rep(6,n=>{const a=n*Math.PI/3-Math.PI/2;return cup(300+231*Math.cos(a),240+168*Math.sin(a),13)})+balls(3,300,211,8)+poolBall(370,294)
 case 14:return ring(300,240,213,193,wood)+e(300,240,189,170,green,'#B5B188',3)+rep(12,n=>{const a=n*Math.PI/6;return e(300+202*Math.cos(a),240+183*Math.sin(a),2.2,2.2,'#D9CAA2')})+poolBall(245,221)+poolBall(353,283,'#A67F61')+poolBall(335,154,'#D3C28F')
 case 15:return poly(300,240,256,195,8,wood)+poly(300,240,229,171,8,green)+[0,1,2,3].map(n=>g(steel(-14,-52,28,104,9),`translate(300 240) rotate(${n*90})`)).join('')+[[300,83],[300,397],[87,240],[513,240]].map(([x,y])=>cup(x,y,14)).join('')+poolBall(178,156)+poolBall(391,298)
 case 16:return steel(46,63,508,353,12)+r(77,94,447,290,green,5)+steel(45,158,24,166,3)+steel(531,158,24,166,3)+line('M68 79L89 100M511 100L533 79M68 398L89 376M511 376L533 398','#B0B799',13)+poolBall(191,162)+poolBall(427,294,'#AD8362')+poolBall(376,186,'#D4C28A')
 case 17:return billiardBase()+rep(12,n=>poly(117+n%6*73,n<6?79:401,16,8,4,n%2?'#C0AA7C':'#635E42'))+balls(4,351,212)+poolBall(176,240)
 case 18:return line('M74 70L141 120M523 70L456 120M74 409L141 360M523 409L456 360',wood,24)+billiardBase()+handle(30,280,22)+handle(548,280,22)+balls(3,350,216)+poolBall(173,241)
 case 19:return billiardBase()+line('M110 52H490M110 428H490',wood,12)+line('M137 52V81M464 52V81M137 428V401M464 428V401',wood,12)+rep(25,n=>bolt(122+n*15,52)+bolt(122+n*15,428))+balls(5,357,193)+poolBall(175,242)
 case 20:return [[62,80],[538,80],[62,402],[538,402]].map(([x,y])=>timber(x-31,y-31,62,62,8)).join('')+billiardBase()+[[60,80],[540,80],[60,401],[540,401]].map(([x,y])=>e(x,y,14,14,'#5B6247','#C4B38D',2)).join('')+balls(4,352,212)+poolBall(175,241)
 case 21:return timber(42,44,517,54)+timber(42,383,517,54)+p('M54 71H544M54 410H544','none','#506548',12)+billiardBase()+tray(207,402,187,30,wood)+rep(8,n=>poolBall(222+n*21,416,n%2?'#C0AC80':'#806651'))+balls(3,351,218)+poolBall(178,241)
 case 22:return billiardBase()+line('M500 169H563V339H500',wood,13)+tray(500,183,67,141,wood)+rep(5,n=>poolBall(533,201+n*26,n%2?'#C9B88D':'#7D6A50'))+bolts(65,88,471,306)+balls(4,351,209)+poolBall(176,241)
 case 23:return billiardBase()+p('M166 133Q301 126 417 286M166 133L246 337M166 133L452 204','none','#B5B98C',2)+p('M124 122h108m-104 7h99','none','#D1C8A1',2)+rep(7,n=>poolBall(238+n*33,343,n%2?'#AE8D66':'#D4C79B'))+poolBall(165,133)
 default:throw new Error('未知台球桌设计。')
 }
}

const cord=(d:string)=>p(d,'none','#334E3B',6)+p(d,'none','#7B8E71',2)
const receiver=(x:number,y:number,s=1,a=0)=>g(p('M-123-20Q-121-44-91-44L-68-14Q0 11 68-14L91-44Q120-44 123-20L117 23Q97 45 70 25L61 12Q0 31-61 12L-70 25Q-98 45-117 23Z',metal)+p('M-73-4Q0 21 73-4','none','#BFC5A9',2),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const rotary=(x:number,y:number,rad=49)=>ring(x,y,rad,rad,metal)+ring(x,y,rad*.43,rad*.43,brass)+rep(10,n=>{const a=n*Math.PI/5-.7;return e(x+rad*.72*Math.cos(a),y+rad*.72*Math.sin(a),rad*.11,rad*.11,'#304F36','#B7BCA1',1)})
function telephone(i:number):string {
 switch(i){
 case 0:return ring(224,248,110,99,metal)+ring(224,248,34,29,brass)+line('M225 239H361V141','#A0AF94',13)+receiver(375,192,.75,90)+cord('M375 280Q493 333 451 389Q403 431 324 350Q253 293 224 280')+rotary(224,248,48)
 case 1:return steel(116,118,368,255,53)+ring(213,186,52,43,brass)+ring(384,186,52,43,brass)+rotary(300,287,55)+receiver(300,117,1.22)+cord('M161 124Q75 147 94 264Q117 345 175 364H192')
 case 2:return timber(122,86,309,298)+steel(136,101,279,43)+line('M430 252H511V307','#B2A57C',14)+receiver(111,229,.9,90)+cord('M110 345Q81 418 225 406Q337 415 308 343V302')+rotary(278,242,56)
 case 3:return line('M118 201V244M481 201V244',wood,12)+timber(67,64,468,149)+timber(67,231,468,189)+receiver(246,294,.98)+ring(437,320,52,52,wood)+cord('M115 295Q88 395 267 382Q411 373 438 320')+line('M92 222H509','#B2AC8A',9)+handle(221,77,129)
 case 4:return timber(60,73,480,328)+grid(84,100,431,128,10,2,'#73815D')+rep(20,n=>tube(105+n%10*43,133+Math.floor(n/10)*58,6,brass))+receiver(227,309,.95,-12)+cord('M110 302Q65 373 203 380Q385 408 426 169')+line('M480 257V347','#B2B99C',10)
 case 5:return steel(77,83,447,315,47)+receiver(300,152,1.2)+grid(131,228,336,137,4,2,'#B7BBA1')+cord('M155 151Q64 206 102 346Q127 403 178 380')
 case 6:return timber(76,89,448,301)+ring(177,216,62,60,metal)+ring(420,216,62,60,metal)+line('M178 216H244M420 216H355','#A8B49B',17)+grid(247,159,106,164,2,4,'#B2B89A')+cord('M178 250Q112 348 225 365Q369 414 421 251')
 case 7:return e(300,264,224,139,metal)+rotary(300,288,67)+receiver(300,143,1.32)+cord('M145 143Q45 158 58 277Q56 380 175 394L213 363')+line('M197 147V184M403 147V184','#9CAC8E',13)
 default:throw new Error('未知电话构造。')
 }
}

const roundKeys=(x:number,y:number,w:number,rows=4,cols=12)=>rep(rows,j=>rep(cols,k=>e(x+(k+(j%2)*.35)*w/cols,y+j*28,8,8,j?'#C6C5A2':'#A9B391','#3F5A3D',1.6)))
const platen=(x:number,y:number,w:number)=>cylinder(x,y,w,31)+line(`M${x-21} ${y+15}H${x+w+21}`,'#A5B497',9)+ring(x-26,y+15,13,16,wood)+ring(x+w+26,y+15,13,16,wood)
function typewriter(i:number):string {
 switch(i){
 case 0:return steel(95,106,410,293,24)+paper(141,50,318,127)+platen(115,161,370)+p('M178 219Q300 122 424 219','none','#B6B89A',15)+p(rep(31,n=>`M300 198L${165+n*9} 240 `),'none','#B2B89C',2)+roundKeys(135,274,335,4,12)+r(193,378,214,16,'#687D5C',6)
 case 1:return line('M107 194V239M491 194V239','#AAB498',12)+timber(72,71,456,135)+steel(97,224,406,187,20)+platen(111,214,377)+roundKeys(133,275,334,4,11)+line('M116 236H482','#B1B89B',10)+steel(84,100,31,75)+steel(485,100,31,75)
 case 2:return steel(99,105,402,290,47)+paper(158,51,284,119)+platen(127,159,346)+p('M147 276Q299 133 453 276','none','#B7B699',24)+p(rep(30,n=>{const a=Math.PI+n*Math.PI/29;return`M${num(300+152*Math.cos(a))} ${num(281+102*Math.sin(a))}l0 8 `}),'none','#546D4B',2)+line('M300 288L380 214','#B1B798',12)+r(205,322,66,38,metal,7)+r(329,322,66,38,metal,7)
 case 3:return steel(85,98,430,302,27)+paper(160,43,280,139)+platen(117,155,364)+ring(300,226,62,51,metal)+p(rep(31,n=>{const a=n*Math.PI*2/31;return`M${num(300+56*Math.cos(a))} ${num(226+45*Math.sin(a))}l0 4 `}),'none','#A9B697',1.4)+line('M171 215H241M359 215H429','#B4BC9E',14)+roundKeys(127,291,347,3,12)
 case 4:return steel(116,110,371,292,24)+paper(69,48,463,131)+platen(47,158,506)+line('M72 224H530','#B8BC9D',13)+p(rep(29,n=>`M${86+n*15} 217v16 `),'none','#536B49',1.4)+roundKeys(140,279,318,4,13)
 case 5:return steel(115,100,370,305,28)+r(263,101,75,190,'#D0C6A1',3)+ring(300,131,43,23,wood)+cylinder(265,214,70,28)+grid(143,291,128,88,5,2,metal)+grid(329,291,128,88,5,2,metal)+r(281,344,38,38,wood,6)
 case 6:return steel(80,98,440,300,26)+paper(112,42,377,125)+platen(88,156,423)+ring(300,237,94,69,metal)+p(rep(31,n=>`M300 237L${166+n*9} ${231+Math.abs(n-15)*1.4} `),'none','#ADB897',1.4)+roundKeys(131,328,342,2,14)+line('M117 284H482','#BCBD9D',11)
 case 7:return steel(71,96,426,299,29)+paper(108,45,321,125)+platen(92,153,383)+roundKeys(109,263,344,4,12)+ring(493,231,54,54,wood)+r(463,258,60,124,'#D4C8A3',3)+p(rep(19,n=>`M${474+n%3*15} ${270+Math.floor(n/3)*15}v4 `),'none','#5E7250',2)+pipe('M446 211H492')
 default:throw new Error('未知打字机构造。')
 }
}

const record=(x:number,y:number,rad=98)=>ring(x,y,rad,rad,'#3B5140')+rep(Math.min(8,Math.max(1,Math.floor((rad-14)/7))),n=>e(x,y,rad-10-n*7,rad-10-n*7,'none',n%2?'#718268':'#566E56',.7))+e(x,y,rad*.22,rad*.22,'#ADA981','#4F634A',1)+e(x,y,4,4,'#BCC2A4')
const tonearm=(x:number,y:number,d:string)=>ring(x,y,18,18,brass)+line(d,'#B7B494',10)
function horn(x:number,y:number,rx:number,ry:number):string {
 return poly(x,y,rx,ry,10,brass)+poly(x,y,rx-12,ry-12,10,'#929C6E')+p(rep(10,n=>{const a=n*Math.PI/5-Math.PI/2;return`M${x} ${y}L${num(x+(rx-17)*Math.cos(a))} ${num(y+(ry-17)*Math.sin(a))} `}),'none','#D1BD87',2.5)+e(x,y,rx*.22,ry*.22,'#526345','#A3A778',2)
}
function gramophone(i:number):string {
 switch(i){
 case 0:return timber(66,166,393,251)+record(244,287,100)+pipe('M415 337V216Q421 121 337 103')+horn(335,112,146,91)+tonearm(422,337,'M422 337H337L311 279')+line('M459 294H549V341','#B2AB84',13)
 case 1:return timber(81,74,435,332)+timber(100,94,396,292)+record(279,246,118)+tonearm(458,164,'M458 164V232L358 272')+line('M516 263H565V314','#B2AB83',12)+tray(106,338,81,47,wood)+tray(411,340,81,45,wood)
 case 2:return line('M122 194V239M478 194V239','#AAB498',12)+timber(70,46,461,160)+timber(70,227,461,201)+record(259,327,88)+tonearm(449,267,'M449 267V321H330')+line('M531 315H568V368','#A6AF91',11)+line('M92 219H507','#AEA882',9)+handle(236,58,128)
 case 3:return timber(64,151,470,258)+cylinder(161,183,246,78)+line('M145 174V288M423 174V288','#A9B198',13)+line('M158 286H407','#B6B99E',17)+steel(275,269,49,49)+pipe('M298 284V137H216')+horn(180,115,107,64)+line('M534 282H565V337','#ACA57F',12)
 case 4:return timber(75,76,450,331,29)+record(294,240,126)+tonearm(463,331,'M463 331H385L354 252')+wheel(135,329,31,28)+line('M525 191H568V245','#AFA984',11)
 case 5:return timber(43,92,514,309)+record(176,256,101)+record(426,256,101)+pipe('M300 284V150')+horn(300,113,105,61)+tonearm(80,155,'M80 155V234L143 270')+tonearm(514,155,'M514 155V234L453 270')+line('M43 319H22V352M557 319H578V352','#B7AA80',11)
 case 6:return timber(69,76,461,330)+ring(273,250,132,128,wood)+rep(8,n=>{const a=n*Math.PI/4;return record(273+72*Math.cos(a),250+69*Math.sin(a),43)})+ring(273,250,32,30,brass)+r(406,101,86,23,'#365439',4)+tonearm(466,332,'M466 332H399L365 281')+line('M530 221H568V276','#B7AB84',12)
 case 7:return timber(58,145,484,265)+record(245,284,107)+pipe('M474 327V210H407V118H294')+p('M199 67H331L359 154H176Z',brass)+p('M213 79H319L339 140H191Z','#8C9B6D')+p('M262 82V137M216 84L203 136M311 84L327 136','none','#CAB683',3)+tonearm(474,327,'M474 327H371L328 281')
 default:throw new Error('未知留声机构造。')
 }
}

const coil=(x:number,y:number,w:number,h:number)=>cylinder(x,y,w,h)+p(rep(18,n=>`M${x+7+n*(w-14)/17} ${y+5}v${h-10} `),'none','#BAA274',2)
const headphones=(x:number,y:number,s=1,a=0)=>g(p('M-76 11Q-86-91 0-91Q86-91 76 11','none','#3F543E',14)+p('M-76 11Q-86-91 0-91Q86-91 76 11','none','#B3B89B',7)+e(-75,22,24,37,metal)+e(75,22,24,37,metal)+cord('M-75 51Q-20 121 73 50'),`translate(${x} ${y}) rotate(${a}) scale(${s})`)
const valve=(x:number,y:number,rx=22)=>ring(x,y,rx,rx,metal)+tube(x,y,rx*.67)+e(x,y,rx*.28,rx*.28,'#A59E78','#D4D1B1',1)
function radio(i:number):string {
 switch(i){
 case 0:return timber(56,87,343,302)+coil(84,129,112,77)+ring(268,181,43,37,porcelain)+poly(268,181,17,16,5,'#596C4C')+line('M268 181L335 148','#B2A777',5)+steel(225,264,118,70)+dial(284,296,25)+pipe('M111 274H174V179H224M196 169H223M311 181H350')+headphones(469,242,.9,90)+cord('M371 285Q408 349 474 354')
 case 1:return timber(56,94,488,297)+[134,300,465].map(x=>valve(x,165,34)).join('')+coil(103,240,126,82)+steel(276,240,202,82)+p(rep(15,n=>`M${287+n*12} 250v60 `),'none','#C2B68F',3)+dial(160,356,26)+dial(431,356,26)+pipe('M168 165H266M334 165H431M134 198V240M465 198V240')
 case 2:return timber(46,75,510,329)+coil(77,122,143,82)+coil(375,122,143,82)+[116,238,360,482].map(x=>valve(x,291,28)).join('')+pipe('M116 263V222H482V263M238 263V171H220M360 263V171H375')+dial(295,123,32)+line('M77 362H519','#A4AD8F',5)
 case 3:return line('M124 58H481V78H124Z',wood,20)+line('M153 67V397M451 67V397',wood,16)+timber(69,206,462,200)+dial(198,303,54)+dial(414,303,36)+pipe('M300 67V219')+p(rep(11,n=>`M${141+n*31} 50v34 `),'none','#C3B28B',2)
 case 4:return timber(63,241,338,163)+dial(151,318,43)+dial(309,318,30)+pipe('M397 319H472V167')+horn(423,144,113,97)+p('M356 267H374V382','none','#B5AA7C',7)
 case 5:return line('M122 188V234M478 188V234','#AAB498',12)+timber(64,48,470,150)+timber(64,222,470,206)+dial(179,310,49)+steel(271,245,236,99)+grid(283,254,212,81,4,1,metal)+headphones(419,343,.55)+line('M90 210H508','#B4AA83',10)+handle(231,60,138)
 case 6:return timber(46,80,510,329)+record(189,238,102)+steel(331,126,187,164,19)+p(rep(13,n=>`M${344+n*13} 137v140 `),'none','#ACB697',3)+dial(354,350,29)+dial(482,350,29)+tonearm(82,146,'M82 146H129L158 175')
 case 7:return timber(45,76,511,330)+steel(72,103,248,166,11)+dial(145,184,38)+dial(256,184,25)+coil(372,111,137,95)+steel(358,283,161,75)+line('M386 321H492','#BAAC7C',14)+headphones(196,351,.66)+pipe('M320 160H372M320 224H430V283')
 default:throw new Error('未知收音设备构造。')
 }
}

/** Collapsible camera bellows is a sequence of nested top outlines, not a frontal lens disk. */
const bellowsCamera=(x:number,y:number,w:number,h:number)=>timber(x,y,w,h)+rep(10,n=>r(x+15+n*3,y+10+n*3,w-30-n*6,h-20-n*6,n%2?'#5F6651':'#8A8870',2,'#A4AA8B',1.2))
const tripod=(cx:number,cy:number)=>[0,1,2].map(n=>{const a=n*Math.PI*2/3-Math.PI/2;return line(`M${cx} ${cy}L${num(cx+228*Math.cos(a))} ${num(cy+179*Math.sin(a))}`,'#9E926B',18)}).join('')+ring(cx,cy,42,35,brass)
function camera(i:number):string {
 switch(i){
 case 0:return tripod(300,256)+line('M211 101V376M389 101V376',wood,16)+timber(164,105,272,61)+bellowsCamera(197,174,206,125)+steel(201,306,199,38)+lens(300,366,99,86,90)+line('M198 188H170V254M403 188H430V254','#A8AD8F',8)
 case 1:return line('M182 191V230M417 191V230',wood,13)+timber(134,70,331,130)+timber(164,211,272,206)+bellowsCamera(181,213,238,103)+steel(183,323,234,26)+lens(300,381,99,73,90)+ring(470,132,17,28,wood)+handle(226,82,142)
 case 2:return steel(111,99,378,253,16)+timber(124,112,351,226)+lens(300,373,125,101,90)+r(153,135,69,61,glass,6)+ring(489,224,24,33,metal)+handle(229,111,143)
 case 3:return timber(65,107,470,241)+lens(184,368,97,87,90)+lens(416,368,97,87,90)+r(271,154,60,64,glass,7)+ring(539,224,19,28,metal)+handle(233,119,136)
 case 4:return steel(151,98,299,243,21)+r(172,117,256,198,glass,17,'#BCC5A6',4)+r(190,135,220,162,'#6E8B73',10)+lens(300,367,112,74,90)+line('M260 341V355M339 341V355','#9AA88B',13)+line('M450 197H527V257','#AEAA83',12)
 case 5:return tripod(300,272)+steel(206,179,190,157,14)+e(237,137,17,71,metal)+e(365,137,17,71,metal)+p('M232 78V194M242 78V194M360 78V194M370 78V194','none','#BDCAA8',2)+lens(300,369,95,89,90)+line('M396 259H517V310','#AEA985',14)+e(517,310,12,19,wood)
 case 6:return ring(300,259,169,128,wood)+p('M95 161Q300 57 505 161L479 247Q300 161 121 247Z',metal)+p('M121 158Q300 85 480 158','none','#A9B498',6)+lens(300,306,106,153,90)+dial(300,259,36)+line('M436 161H525V211','#A9B096',11)
 case 7:return timber(85,96,431,309)+paper(154,153,292,204)+steel(283,66,34,211)+steel(212,216,177,101)+r(233,234,137,64,'#748A70',3)+line('M284 110H105V229M316 110H497V229','#A4B094',14)+ring(104,237,65,56,metal)+ring(497,237,65,56,metal)+e(104,237,42,35,porcelain)+e(497,237,42,35,porcelain)
 default:throw new Error('未知摄影设备构造。')
 }
}

export const PERIOD_EQUIPMENT_COLLECTION_LICENSE_REF='MIT-Sceneweave-Period-Equipment-Collection-1'
export const PERIOD_EQUIPMENT_COLLECTION_LICENSE=`Sceneweave Period Equipment Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG interpretations of period equipment, authored with coding assistance. No third-party artwork, photographs, trademarks or pixels are embedded. These are illustrative 1920s scene designs, not exact historical product reproductions. Artwork does not create functioning instruments, machines, medical treatment, buildings or traversal. Technical checks and visual acceptance are separate.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
export const PERIOD_EQUIPMENT_LICENSE_REF=PERIOD_EQUIPMENT_COLLECTION_LICENSE_REF
export const PERIOD_EQUIPMENT_LICENSE=PERIOD_EQUIPMENT_COLLECTION_LICENSE
const defs=`<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="27%" y2="100%"><stop offset="0%" stop-color="#AD946A"/><stop offset="28%" stop-color="#A1875D"/><stop offset="72%" stop-color="#8D7850"/><stop offset="100%" stop-color="#6F6243"/></linearGradient>
<linearGradient id="metal" x1="0%" y1="0%" x2="78%" y2="100%"><stop offset="0%" stop-color="#AFB29C"/><stop offset="18%" stop-color="#929D85"/><stop offset="68%" stop-color="#788B70"/><stop offset="100%" stop-color="#4E6850"/></linearGradient>
<linearGradient id="brass" x1="0%" y1="0%" x2="75%" y2="100%"><stop offset="0%" stop-color="#C3B282"/><stop offset="22%" stop-color="#B4AA7B"/><stop offset="75%" stop-color="#96976A"/><stop offset="100%" stop-color="#777F57"/></linearGradient>
<linearGradient id="cloth" x1="0%" y1="0%" x2="75%" y2="100%"><stop offset="0%" stop-color="#A6AE90"/><stop offset="24%" stop-color="#919F82"/><stop offset="78%" stop-color="#7D8F74"/><stop offset="100%" stop-color="#637C61"/></linearGradient>
<linearGradient id="porcelain" x1="0%" y1="0%" x2="80%" y2="100%"><stop offset="0%" stop-color="#D3D8BE"/><stop offset="23%" stop-color="#BDCDB7"/><stop offset="79%" stop-color="#ABC2AC"/><stop offset="100%" stop-color="#8FAE95"/></linearGradient>
</defs>`
const drawings={ 'archive-unit':archive,safe,'medical-unit':medical,'laboratory-unit':laboratory,piano:keyboard,'billiard-table':billiard,telephone,typewriter,gramophone,radio,camera }
function artwork(design:PeriodEquipmentDesign,index:number):VisualSampleArt {
 const detail=['telephone','typewriter','gramophone','radio','camera'].includes(design.category)
 return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
  sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm/600} ${design.heightMm/480})">${drawings[design.category](index)}</g></svg>`,
  footprintMm:{width:design.widthMm,height:design.heightMm},blocksMovement:!detail,blocksSight:false,renderLayer:'object',shadowClass:detail?'none':'furniture',
  tags:['原创','1920s时代器材',design.category,design.era,design.design,'严格俯视','保守矩形占地','无真实机器或诊疗能力']}
}
export const PERIOD_EQUIPMENT_COLLECTION_ART:readonly VisualSampleArt[]=freezeJson(PERIOD_EQUIPMENT_DESIGNS.map(design=>artwork(design,PERIOD_EQUIPMENT_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
export const PERIOD_EQUIPMENT_ART=PERIOD_EQUIPMENT_COLLECTION_ART
