import { FARM_DESIGNS, type FarmDesign } from '../assets/farm-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

type Point = readonly [number, number]
const edge = '#625D46', wood = 'url(#wood)', straw = 'url(#straw)', stone = 'url(#stone)', iron = 'url(#iron)', water = 'url(#water)', leaf = 'url(#leaf)'
const rep = (n: number, fn: (i: number) => string) => Array.from({ length: n }, (_, i) => fn(i)).join('')
const p = (d: string, fill = 'none', stroke = edge, sw = 2) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
const r = (x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke = edge, sw = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const e = (cx: number, cy: number, rx: number, ry: number, fill: string, stroke = edge, sw = 2) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g = (transform: string, body: string) => `<g transform="${transform}">${body}</g>`
const line = (d: string, color = '#AF9970', sw = 9) => p(d, 'none', '#6B634B', sw + 2.3) + p(d, 'none', color, sw) + p(d, 'none', '#D4C59C', .9)
const dot = (x: number, y: number, rad = 3) => e(x, y, rad, rad * .8, '#BEB591', '#73785D', 1) + p(`M${x-rad*.5} ${y}h${rad}`, 'none', '#646D57', .8)
const rng = (seed: number, i: number) => { let n = Math.imul(seed + i * 2371, 0x45d9f3b); n ^= n >>> 16; n = Math.imul(n, 0x45d9f3b); return (n >>> 0) / 4294967296 }
const pointsPath = (points: readonly Point[]) => points.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join('')+'Z'
const regular = (cx: number, cy: number, rx: number, ry: number, count: number, phase = -Math.PI/2): Point[] => Array.from({length:count},(_,i)=>[cx+rx*Math.cos(phase+i*Math.PI*2/count),cy+ry*Math.sin(phase+i*Math.PI*2/count)])
const ellipse = (cx: number, cy: number, rx: number, ry: number): Point[] => regular(cx,cy,rx,ry,48)
const rough = (cx: number, cy: number, rx: number, ry: number, seed: number, n = 38): Point[] => Array.from({length:n},(_,i)=>{const a=i*Math.PI*2/n, rr=.94+rng(seed,i)*.06;return[cx+rx*rr*Math.cos(a),cy+ry*rr*Math.sin(a)]})
const flower = (cx: number, cy: number, rx: number, ry: number, count: number): Point[] => Array.from({length:100},(_,i)=>{const a=-Math.PI/2+i*Math.PI/50,rr=.81+.19*Math.cos(count*(a+Math.PI/2));return[cx+rx*rr*Math.cos(a),cy+ry*rr*Math.sin(a)]})
function inside(x:number,y:number,polygon:readonly Point[]):boolean { let result=false; for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if(((a[1]>y)!==(b[1]>y))&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])result=!result}return result }
function texture(points: readonly Point[], seed: number, kind: 'straw'|'soil'|'stone'|'wood', count = 80, holes: readonly (readonly Point[])[] = []): string {
  const strokes = ['', '', '', '']; let placed=0
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0
  for(let i=0;i<count*12&&placed<count;i++){
    const x=x0+rng(seed,i*4)*w,y=y0+rng(seed,i*4+1)*h,dx=(rng(seed,i*4+2)-.5)*(kind==='straw'?38:kind==='wood'?55:14),dy=(rng(seed,i*4+3)-.5)*(kind==='straw'?30:kind==='wood'?5:9)
    if(!inside(x,y,points)||!inside(x+dx,y+dy,points)||!inside(x+dx*.5,y+dy*.5+3,points)||holes.some(hole=>inside(x,y,hole)||inside(x+dx,y+dy,hole)||inside(x+dx*.5,y+dy*.5+3,hole)))continue
    const shade=placed%4
    strokes[shade]+=`M${x} ${y}q${dx*.48} ${dy*.45+2} ${dx} ${dy}`
    placed++
  }
  const palette=kind==='straw'?['#DBC692','#C4AD75','#A28F5C','#E2D0A2']:kind==='wood'?['#D0B68B','#BDA174','#776647','#C0A77B']:kind==='stone'?['#C4C5A7','#86957A','#75846D','#B1BBA0']:['#B4A680','#756F50','#C0AF8A','#928767']
  return `<g opacity="${kind==='straw'?'.65':'.43'}">${strokes.map((d,i)=>d?p(d,'none',palette[i],kind==='straw'?1.3:kind==='wood'?.85:1.5):'').join('')}</g>`
}
const board = (x:number,y:number,w:number,h:number,rad=5) => r(x,y,w,h,wood,rad)+texture([[x+7,y+6],[x+w-7,y+6],[x+w-7,y+h-6],[x+7,y+h-6]],53,'wood',Math.min(42,Math.ceil(w*h/1700)))+p(`M${x+6} ${y+7}h${w-12}`,'none','#D4BC8F',1.3)
const footing = (x:number,y:number,material=stone) => e(x,y,20,16,material,'#77816A',1.7)+dot(x,y)
const fourFeet = (x:number,y:number,w:number,h:number,material=stone) => [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([a,b])=>footing(a,b,material)).join('')
const ring = (x:number,y:number,rx:number,ry:number,color='#B7A57B',sw=9) => e(x,y,rx,ry,'none','#6F674D',sw+3)+e(x,y,rx,ry,'none',color,sw)+p(`M${x-rx*.65} ${y-ry*.73}q${rx*.6} ${-ry*.3} ${rx*1.3} 0`,'none','#D7C79E',1)
const handle = (x:number,y:number,rotate=0) => g(`translate(${x} ${y}) rotate(${rotate})`,line('M-19 0v-18q19-16 38 0v18','#ABA582',5.5))
function hay(points: readonly Point[], seed:number, count=125):string {
  const cx=points.reduce((a,p)=>a+p[0],0)/points.length,cy=points.reduce((a,p)=>a+p[1],0)/points.length
  return p(pointsPath(points),straw,'#8E8156',2)+p(pointsPath(points.map(([x,y])=>[cx+(x-cx)*.96,cy+(y-cy)*.96])),'none','#D8C28E',1.7)+texture(points,seed,'straw',count)
}
function sheaf(x:number,y:number,angle:number,scale=1):string {
  const body=hay([[x-22,y-22],[x-52,y-85],[x-31,y-106],[x+3,y-91],[x+34,y-107],[x+55,y-82],[x+23,y-21],[x+39,y+94],[x+11,y+108],[x-8,y+101],[x-40,y+109],[x-43,y+81]],31+Math.round(x),44)
  return g(`translate(${x} ${y}) rotate(${angle}) scale(${scale}) translate(${-x} ${-y})`,body+line(`M${x-25} ${y-13}h51M${x-25} ${y-3}h51`,'#B29A6C',4))
}
function bale(x:number,y:number,w:number,h:number,seed:number):string { return hay([[x+5,y+7],[x+w-8,y],[x+w,y+h-6],[x+10,y+h]],seed,54)+line(`M${x+w*.3} ${y+4}v${h-7}M${x+w*.7} ${y+2}v${h-7}`,'#8F9576',3)+p(`M${x+8} ${y+8}h${w-19}`,'none','#E1CA95',2) }
function woodRoof(x:number,y:number,w:number,h:number,kind:'gable'|'hip'|'metal'|'gambrel'|'single'='gable'):string {
  let body=r(x,y,w,h,kind==='metal'?iron:wood,4)
  if(kind==='metal')body+=rep(Math.floor(w/14),n=>p(`M${x+8+n*14} ${y+4}v${h-8}`,'none',n%3?'#B5BDA0':'#778B70',1.8))
  else {
    body+=p(`M${x+2} ${y+2}H${x+w-2}V${y+h*.5}H${x+2}Z`,'#BEA47A','none',0)
    const rows=Math.floor(h/32)
    body+=rep(rows,n=>{const yy=y+15+n*(h-25)/rows;return p(`M${x+4} ${yy}q${w*.2} ${n%2?3:-2} ${w*.44} 0t${w*.54} 0`,'none','#857553',1.4)+rep(Math.floor(w/55),j=>p(`M${x+29+j*55+(n%2?17:0)} ${yy}v${Math.min(26,y+h-yy-3)}`,'none','#9A845D',1))})+texture([[x+6,y+6],[x+w-6,y+6],[x+w-6,y+h-6],[x+6,y+h-6]],61,'wood',55)
  }
  if(kind==='hip')body+=line(`M${x+5} ${y+5}L${x+w*.28} ${y+h*.5}L${x+5} ${y+h-5}M${x+w-5} ${y+5}L${x+w*.72} ${y+h*.5}L${x+w-5} ${y+h-5}M${x+w*.28} ${y+h*.5}H${x+w*.72}`,'#A89169',6)
  else if(kind==='single')body+=line(`M${x+9} ${y+10}h${w-18}`,'#B8A67C',7)
  else body+=line(`M${x+5} ${y+h*.5}h${w-10}`,'#9F8B62',7)
  if(kind==='gambrel')body+=p(`M${x+5} ${y+h*.25}h${w-10}M${x+5} ${y+h*.75}h${w-10}`,'none','#D0B789',4)
  return body+p(`M${x+4} ${y+h-5}h${w-8}`,'none','#786D4D',4)
}
function radialRoof(points: readonly Point[],material=wood,seed=11):string {
  const cx=points.reduce((v,p)=>v+p[0],0)/points.length,cy=points.reduce((v,p)=>v+p[1],0)/points.length
  const clipped = (x0:number,y0:number,x1:number,y1:number) => { let d='',start:Point|null=null,last:Point|null=null; const flush=()=>{if(start&&last)d+=`M${start[0]} ${start[1]}L${last[0]} ${last[1]}`;start=null;last=null};for(let n=1;n<80;n++){const t=n/80,x=x0+(x1-x0)*t,y=y0+(y1-y0)*t;if(inside(x,y,points)){if(!start)start=[x,y];last=[x,y]}else flush()}flush();return d }
  const rim=points.map(([x,y])=>[cx+(x-cx)*.89,cy+(y-cy)*.89] as const)
  return p(pointsPath(points),material)+p(rim.map(([x,y],i)=>clipped(x,y,...rim[(i+1)%rim.length])).join(''),'none','#C4B38B',2)+texture(points,seed,'wood',73)+points.map(([x,y],i)=>i%Math.max(1,Math.floor(points.length/8))?'':line(clipped(cx,cy,x,y),'#AA976F',5)).join('')+(inside(cx-18,cy-14,points)&&inside(cx+18,cy+14,points)?e(cx,cy,17,13,material):'')
}
const porch = (x:number,y:number,w:number,h=36) => board(x,y,w,h,3)+p(`M${x+7} ${y+h*.5}h${w-14}`,'none','#75684A',2)
function trough(d:string,material=wood,sx=.87,sy=.72):string {return p(d,material)+g(`translate(300 240) scale(${sx+.04} ${sy+.05}) translate(-300 -240)`,p(d,'#5C7566','#C8C3A0',2))+g(`translate(300 240) scale(${sx} ${sy}) translate(-300 -240)`,p(d,water,'#829B84',2))}
const waterBowl = (x:number,y:number,rx:number,ry:number,material=stone) => e(x,y,rx,ry,material)+e(x,y,rx-16,ry-13,'#5E7E6B','#C1C2A0',2)+e(x,y,rx-23,ry-19,water,'#8B9E84',1.5)
const stoneRing = (cx:number,cy:number,rx:number,ry:number,count=14,material=stone) => e(cx,cy,rx,ry,material)+rep(count,n=>{const a=n*Math.PI*2/count;return p(`M${cx+rx*Math.cos(a)} ${cy+ry*Math.sin(a)}L${cx+(rx-28)*Math.cos(a)} ${cy+(ry-23)*Math.sin(a)}`,'none','#7C8A70',2)})+e(cx,cy,rx-29,ry-24,'#405C4C','#BFC2A0',2.5)+texture(ellipse(cx,cy,rx,ry),71,'stone',18,[ellipse(cx,cy,rx-29,ry-24)])

function haystack(i:number):string {
  switch(i){
    case 0:return hay(rough(300,240,222,179,4),4,165)+rep(11,n=>{const a=n*Math.PI*2/11;return p(`M300 211Q${300+85*Math.cos(a)} ${240+76*Math.sin(a)} ${300+205*Math.cos(a)} ${240+166*Math.sin(a)}`,'none','#AF985F',2)})+e(300,211,14,11,wood)
    case 1:return hay(rough(300,240,250,160,6),6,180)+p('M87 228Q296 142 514 245','none','#BAA370',8)+texture(rough(300,240,205,113,7),7,'straw',75)
    case 2:return [sheaf(182,188,-31,.9),sheaf(300,153,8,.9),sheaf(420,189,31,.9),sheaf(184,306,153,.9),sheaf(300,328,179,.9),sheaf(422,305,207,.9)].join('')+line('M265 236h70','#A08A60',8)
    case 3:return hay([[57,115],[149,82],[432,92],[545,129],[533,359],[438,396],[169,384],[61,351]],9,190)+line('M101 158l389 10M97 321l399 11','#9F9068',14)
    case 4:return line('M300 37L66 420H534Z','#99865C',21)+hay(rough(300,231,203,161,13),13,145)+e(300,223,20,16,wood)+line('M300 225v-56','#A18E65',8)
    case 5:return board(52,77,54,326)+board(495,77,54,326)+hay([[84,101],[205,80],[421,97],[519,123],[517,357],[375,388],[173,375],[82,354]],17,185)+line('M97 132h409M98 352h409','#AB966C',11)
    case 6:return hay(rough(300,240,237,173,19),19,185)+line('M111 118L484 366M484 119L108 365M58 242H543M300 63V416','#B5A378',4.5)+fourFeet(111,118,373,248,wood)
    case 7:return line('M214 240h172M300 171v138','#A6956D',8)+`<path d="${pointsPath(rough(300,240,225,180,23))}${pointsPath(ellipse(300,240,86,69))}" fill="${straw}" stroke="#9A8B5D" stroke-width="2" fill-rule="evenodd"/>`+texture(rough(300,240,225,180,23),23,'straw',170,[ellipse(300,240,89,71)])+rep(8,n=>{const a=n*Math.PI/4;return line(`M${300+83*Math.cos(a)} ${240+66*Math.sin(a)}L${300+219*Math.cos(a)} ${240+175*Math.sin(a)}`,'#BDA778',3.5)})
    case 8:return radialRoof([[34,240],[153,103],[332,76],[557,240],[407,379],[250,403]],'#8B9A6D',31)+hay([[59,239],[165,132],[330,104],[530,241],[399,351],[257,372]],31,170)+line('M55 239Q294 175 535 241','#97A677',9)
    case 9:return p(pointsPath(regular(300,240,243,191,6)),stone)+hay(regular(300,240,216,168,6),35,165)+rep(3,n=>{const a=n*Math.PI/3;return line(`M${300+223*Math.cos(a)} ${240+174*Math.sin(a)}L${300-223*Math.cos(a)} ${240-174*Math.sin(a)}`,'#909D7E',7)})+e(300,240,20,16,iron)
    case 10:return line('M74 93L525 393M524 88L80 394','#C0B28A',18)+hay([[83,139],[192,79],[302,107],[432,73],[538,145],[519,271],[539,351],[420,410],[296,379],[165,404],[61,333]],39,190)+line('M97 212l399 28M107 293l382 20','#938664',10)
    case 11:return hay(rough(300,240,226,181,43),43,170)+rep(9,n=>{const a=n*Math.PI*2/9;return p(`M300 170Q${300+126*Math.cos(a)} ${240+97*Math.sin(a)} ${300+211*Math.cos(a)} ${240+169*Math.sin(a)}`,'none','#BAA16A',4)})+e(300,170,25,18,'#BCA675','#8B8058',3)
    case 12:return hay(flower(300,240,231,185,5),47,190)+rep(5,n=>g(`rotate(${n*72} 300 240)`,line('M300 240L300 65','#AA9869',4)))+board(272,218,56,44,8)
    case 13:return hay([[49,124],[145,84],[471,84],[551,129],[541,362],[468,398],[131,394],[49,350]],51,170)+hay([[91,143],[191,108],[462,115],[513,165],[505,325],[429,364],[171,351],[91,317]],52,105)+line('M64 337h475M94 286h412','#9B8A61',12)+hay([[167,161],[238,136],[419,140],[463,182],[457,286],[400,323],[223,307],[165,284]],53,80)
    case 14:return hay([[40,213],[104,132],[204,93],[319,75],[432,89],[527,133],[560,195],[454,161],[347,171],[248,219],[180,298],[141,379],[74,358],[40,297]],57,160)+p('M67 203Q263 95 483 134','none','#D1BC87',4)+line('M87 262l49 25M202 150l33 45M351 106l7 43','#B5A077',4)
    case 15:return board(45,341,510,58)+hay(rough(192,237,148,153,61),61,115)+hay(rough(409,237,148,153,62),62,115)+line('M273 177h59M273 298h59','#BCA574',10)
    case 16:return bale(48,96,158,289,65)+bale(222,87,162,299,66)+bale(401,101,152,281,67)
    case 17:return bale(69,72,213,328,70)+bale(309,76,216,325,71)+g('rotate(90 300 240)',bale(193,48,214,384,72))
    case 18:return hay(rough(300,240,235,188,75),75,160)+radialRoof(regular(300,225,193,147,8),'#9D9980',76)+e(300,225,15,12,wood)
    case 19:return [board(46,80,509,51),board(46,218,509,51),board(46,355,509,51)].join('')+[bale(69,91,143,137,79),bale(227,91,143,137,80),bale(385,91,143,137,81),bale(69,244,143,137,82),bale(227,244,143,137,83),bale(385,244,143,137,84)].join('')
    case 20:return hay(rough(300,240,250,177,87),87,185)+p('M73 102Q288 53 525 110L507 245Q303 206 98 253Z','#879578','#65755B',2.5)+p('M95 236Q294 192 507 237','none','#B5BDA0',6)+line('M84 119l-33-49M518 118l34-44','#ADA282',4)
    case 21:return line('M73 81L56 409M527 81L544 409','#899D7E',13)+hay([[72,105],[200,76],[435,93],[531,131],[519,353],[418,403],[168,389],[64,348]],90,195)+line('M76 240H524M124 143L478 345M475 141L125 345','#A0AA88',7)
    case 22:return board(45,63,510,356)+hay([[73,92],[226,92],[226,389],[73,389]],94,90)+hay([[245,92],[383,92],[383,389],[245,389]],95,90)+hay([[402,92],[527,92],[527,389],[402,389]],96,90)+line('M235 73v335M393 73v335','#AB976E',14)
    case 23:return [sheaf(129,164,-28,.7),sheaf(242,151,-9,.75),sheaf(357,152,12,.75),sheaf(473,174,30,.7),sheaf(128,305,153,.7),sheaf(242,326,174,.75),sheaf(357,326,191,.75),sheaf(471,307,210,.7)].join('')
    default:throw new Error('未知草垛构造。')
  }
}

function granary(i:number):string {
  const round=(seed:number)=>hay(ellipse(300,240,225,180),seed,170)+rep(9,n=>{const a=n*Math.PI*2/9;return p(`M300 220L${300+211*Math.cos(a)} ${240+168*Math.sin(a)}`,'none','#B49D68',3)})+e(300,220,20,15,wood)
  switch(i){
    case 0:return fourFeet(146,112,308,256)+line('M146 112l44 42M454 112l-44 42M146 368l44-42M454 368l-44-42','#A7976E',15)+round(100)+porch(247,397,106)
    case 1:return fourFeet(65,89,470,301)+woodRoof(47,77,506,330)+porch(229,404,142)
    case 2:return radialRoof(regular(300,240,238,190,6),wood,104)+porch(225,398,150)
    case 3:return r(34,54,532,372,stone,9)+woodRoof(51,70,498,338,'hip')+porch(218,407,164)
    case 4:return fourFeet(91,106,418,268)+line('M91 106l47 49M509 106l-47 49M91 374l47-49M509 374l-47-49','#AA9873',15)+woodRoof(239,137,122,206,'single')+g('translate(169 240) scale(.58 1) translate(-300 -240)',round(108))+g('translate(431 240) scale(.58 1) translate(-300 -240)',round(109))
    case 5:return fourFeet(57,96,486,291)+woodRoof(40,76,520,329,'single')+line('M173 89v302M306 89v302M439 89v302','#A58E64',7)+porch(499,197,69,94)
    case 6:return fourFeet(95,80,410,320)+hay([[69,82],[300,55],[533,81],[550,397],[300,426],[51,397]],112,185)+line('M62 239h476M300 57v365','#B69E6D',5)+porch(236,404,128)
    case 7:return radialRoof([[191,45],[409,45],[409,147],[557,147],[557,334],[409,334],[409,435],[191,435],[191,334],[43,334],[43,147],[191,147]],wood,116)+radialRoof(regular(300,240,89,72,4),wood,117)
    case 8:return fourFeet(97,118,406,244,wood)+line('M97 118l66 59M503 118l-66 59M97 362l66-59M503 362l-66-59','#99A776',15)+p('M49 244Q154 69 328 76Q491 87 554 241Q425 409 261 402Q111 391 49 244Z',leaf)+p('M94 246Q181 98 332 118Q470 135 512 248Q401 371 268 365Q150 356 94 246Z','#A9B487','#6E865E',2)+line('M63 240Q302 161 537 243','#859B6A',12)+porch(236,372,128)
    case 9:return p(pointsPath(regular(300,240,253,203,6)),stone)+radialRoof(regular(300,240,227,181,6),stone,121)+e(300,240,54,43,iron)+p('M271 240h58M300 217v46','none','#C5C4A0',3)
    case 10:return fourFeet(64,95,470,301,wood)+p('M51 122L174 58 300 89 433 55 549 126 524 248 552 372 426 425 300 389 162 423 47 356 72 248Z','#A29572')+texture([[69,130],[175,77],[300,109],[434,76],[530,136],[503,249],[531,359],[426,404],[300,367],[166,401],[67,347],[94,249]],125,'wood',80)+line('M71 104L529 386M529 101L73 384','#C5B994',19)+p(rep(15,n=>`M${91+n*29} 110l5 15M${95+n*28} 386l-4-15`),'none','#DDD1AB',2)
    case 11:return p(pointsPath(rough(300,240,228,182,129)),leaf)+rep(12,n=>{const a=n*Math.PI/6;return p(`M300 216Q${300+99*Math.cos(a)} ${240+78*Math.sin(a)} ${300+214*Math.cos(a)} ${240+170*Math.sin(a)}`,'none','#B3BC92',4)})+e(300,216,28,22,'#B8B994','#7E966F',3)+texture(ellipse(300,240,210,167),129,'stone',70)+porch(249,400,102)
    case 12:return radialRoof(flower(300,240,239,191,5),wood,133)+rep(5,n=>g(`rotate(${n*72} 300 240)`,line('M300 240L300 54','#BBAC84',5)))+radialRoof(regular(300,240,68,54,5),leaf,134)
    case 13:return fourFeet(132,106,336,268)+radialRoof(regular(300,240,241,193,8),stone,137)+radialRoof(regular(300,240,190,152,8),wood,138)+radialRoof(regular(300,240,125,100,8),wood,139)+porch(246,414,108)
    case 14:return radialRoof([[35,204],[102,123],[207,80],[323,69],[435,87],[535,134],[566,210],[457,173],[344,181],[245,231],[177,311],[143,392],[72,369],[35,301]],wood,141)+line('M54 217Q285 95 530 158','#A5936C',8)+porch(186,249,112,31)
    case 15:return woodRoof(67,68,466,339,'hip')+radialRoof(ellipse(81,241,52,103),wood,145)+radialRoof(ellipse(519,241,52,103),wood,146)+porch(233,399,134,42)
    case 16:return fourFeet(57,87,486,310)+woodRoof(43,70,514,341,'metal')+r(69,205,56,61,'#82977C',7)+r(476,205,56,61,'#82977C',7)+porch(228,406,144)
    case 17:return fourFeet(55,86,490,313)+woodRoof(43,67,514,347,'gambrel')+woodRoof(215,390,170,58,'gable')
    case 18:return radialRoof(ellipse(300,240,231,185),iron,151)+e(300,240,61,49,iron)+e(300,240,36,29,'#748A72','#C3C4A1',3)+rep(16,n=>{const a=n*Math.PI/8;return p(`M${300+66*Math.cos(a)} ${240+53*Math.sin(a)}L${300+220*Math.cos(a)} ${240+176*Math.sin(a)}`,'none','#C1C8AB',1.4)})
    case 19:return woodRoof(227,148,146,181,'metal')+radialRoof(ellipse(169,240,137,179),iron,155)+radialRoof(ellipse(431,240,137,179),iron,156)+e(169,240,28,37,'#849B7E','#CBD0AC',3)+e(431,240,28,37,'#849B7E','#CBD0AC',3)+r(239,329,122,79,iron,5)
    case 20:return r(31,49,538,382,'#9E9675',5)+p('M36 90h528M36 390h528M81 50v35M164 50v35M247 50v35M330 50v35M413 50v35M496 50v35','none','#766D52',2)+woodRoof(47,68,506,344,'hip')+r(179,149,54,57,iron,8)+r(368,274,54,57,iron,8)
    case 21:return board(35,53,530,375)+p(rep(17,n=>`M${46+n*30} 58v365`),'none','#6C7050',3)+woodRoof(45,81,510,319)+porch(225,402,150)
    case 22:return fourFeet(55,83,490,314)+woodRoof(39,65,522,351,'metal')+woodRoof(87,189,426,103,'metal')+p('M96 205h408M96 277h408','none','#6F876D',7)+rep(15,n=>r(105+n*27,201,19,13,'#ACBA9C',1,'#728A70',1)+r(105+n*27,271,19,13,'#ACBA9C',1,'#728A70',1))
    case 23:return woodRoof(40,50,439,307,'metal')+woodRoof(41,352,517,83,'metal')+woodRoof(476,110,82,241,'single')+r(495,141,41,79,iron,5)+porch(203,407,134)
    default:throw new Error('未知粮仓构造。')
  }
}

function well(i:number):string {
  const shaft=(cx=300,cy=240,rx=180,ry=144)=>stoneRing(cx,cy,rx,ry,14)
  const winch=(x=300,y=240,w=350)=>line(`M${x-w/2} ${y-105}v210M${x+w/2} ${y-105}v210`,'#A38E65',18)+line(`M${x-w/2-18} ${y}h${w+36}`,'#BAA576',22)+line(`M${x+w/2+18} ${y}h33v63h-26`,'#A0A583',7)+p(`M${x-13} ${y-10}h26m-26 7h26m-26 7h26`,'none','#D8C394',3)
  const pump=(x:number,y:number,s=1)=>g(`translate(${x} ${y}) scale(${s})`,e(0,0,43,33,iron)+line('M0 0v-75','#8EA081',25)+line('M-9-61Q-52-122-79-61L-77 52','#99A98B',10)+line('M9-42h57v36','#B7BBA0',12)+e(65,-4,10,8,'#516E5A','#C5C8A7',2))
  switch(i){
    case 0:return shaft()+porch(183,359,235,41)
    case 1:return board(85,79,430,322)+r(127,112,346,257,'#3E5849',4,'#C5B38A',7)+p('M94 91v299M506 91v299','none','#7B6A48',5)+winch(300,240,403)
    case 2:return shaft(300,258,184,139)+line('M85 146v219M515 146v219','#9D8960',18)+woodRoof(70,67,460,196)+porch(225,376,150)
    case 3:return shaft(190,245,133,117)+line('M110 111L528 371','#AC986C',21)+line('M340 177v161M309 255h65','#9B8D66',15)+p('M123 128v89','none','#D2BE92',4)+p('M507 324L557 334 565 395 507 416 479 375Z',stone)+dot(340,255,8)
    case 4:return p(pointsPath(regular(300,240,220,176,8)),stone)+e(300,240,164,131,'#405B4C','#BBC1A0',4)+rep(8,n=>{const a=n*Math.PI/4;return p(`M${300+217*Math.cos(a)} ${240+173*Math.sin(a)}L${300+166*Math.cos(a)} ${240+133*Math.sin(a)}`,'none','#7F8B72',2)})+porch(205,378,190)
    case 5:return shaft()+winch(300,240,357)+ring(520,240,35,62,'#A7AB8A',8)+p('M499 240h42M520 192v96','none','#C6C6A1',3)+line('M285 235v89','#A29B75',5)
    case 6:return p('M57 137L139 67 282 90 411 60 531 124 552 250 508 375 377 410 246 382 104 410 47 307Z',stone)+waterBowl(300,213,190,111)+trough('M146 279H454V397H146Z',stone,.86,.72)+p('M291 130v59h25','none','#B0B899',13)
    case 7:return r(39,63,522,355,stone,8)+shaft(177,244,120,121)+shaft(423,244,120,121)+line('M70 105h461M70 380h461','#B5A37D',13)+line('M300 82v316','#9FA889',7)
    case 8:return p('M37 240Q144 73 318 77Q489 85 561 240Q432 403 270 402Q113 392 37 240Z',stone)+shaft(300,242,145,116)+line('M109 252Q285 63 491 252','#95A978',16)+line('M300 128v91','#C3B78D',5)
    case 9:return p(pointsPath(regular(300,240,245,196,6)),stone)+e(300,240,164,131,'#405A4B','#B8C0A0',4)+winch(300,240,364)+p(pointsPath(regular(516,240,42,54,6)),iron)+p('M489 240h54M516 204v72','none','#C6C4A1',4)
    case 10:return p(pointsPath(rough(300,240,219,176,163)),stone)+e(300,240,156,124,'#40594A','#B4B994',5)+line('M83 92L515 388M516 89L84 388','#C4B68D',17)+line('M102 240H497','#B5A176',23)+p('M282 229h36m-36 7h36m-36 7h36','none','#E1CBA0',3)
    case 11:return p('M109 100Q250 22 413 79Q564 142 527 306Q489 440 314 420Q151 399 95 309Q35 212 109 100Z',stone)+e(300,240,130,105,'#405B4D','#C7C7A6',5)+p('M420 155Q307 80 189 151Q111 202 153 291M483 277q-16 63-57 88','none','#C0BE9A',8)+line('M443 350l77 37','#9CAA89',19)
    case 12:return p(pointsPath(flower(300,240,239,191,5)),stone)+shaft(300,240,126,101)+rep(5,n=>g(`rotate(${n*72} 300 240)`,p('M300 56v65','none','#8D9D7C',4)))
    case 13:return [r(252,24,96,62,stone,5),r(252,394,96,62,stone,5),r(28,201,69,77,stone,5),r(503,201,69,77,stone,5)].join('')+p(pointsPath(regular(300,240,225,180,8)),stone)+p(pointsPath(regular(300,240,194,155,8)),'none','#B9BF9B',4)+shaft(300,240,143,114)
    case 14:return p('M44 205Q188 28 418 79Q533 104 562 219Q478 149 356 182Q225 223 153 373Q89 391 45 321Q23 274 44 205Z',stone)+p('M85 219Q211 93 407 112Q330 144 255 203Q180 267 138 332Q91 312 85 278Z','#405A4B','#BFC3A1',5)+trough('M422 143L526 190 489 248 395 198Z',stone,.83,.75)
    case 15:return shaft(300,275,194,128)+line('M76 141v220M524 141v220','#9E8D66',18)+p('M59 241Q63 52 300 52Q538 52 542 241Z',wood)+texture([[75,230],[96,143],[186,84],[302,65],[418,92],[504,159],[526,229]],173,'wood',75)+line('M73 235Q298 153 529 236','#C0A77B',7)+porch(222,379,156)
    case 16:return r(48,62,504,357,stone,9)+r(77,94,445,293,'none',6,'#B8BEA0',2)+pump(296,262,1.35)+waterBowl(404,334,77,43,iron)
    case 17:return shaft(300,240,200,160)+e(300,240,186,149,'none','#B9B28D',9)+rep(14,n=>{const a=n*Math.PI/7;return p(`M${300+196*Math.cos(a)} ${240+157*Math.sin(a)}L${300+177*Math.cos(a)} ${240+142*Math.sin(a)}`,'none','#787E62',2)})+winch(300,240,399)
    case 18:return shaft(300,240,220,176)+p('M300 77v326M301 83L457 160M301 119L489 212M301 166L503 265M301 213L489 309M301 262L456 351M301 310L408 382','none','#9DB296',8)+p('M301 262L456 351','none','#C5CEAE',1.2)
    case 19:return r(58,49,484,383,stone,6)+fourFeet(88,80,424,322,iron)+line('M88 80L512 402M512 80L88 402M88 80H512V402H88Z','#92A789',12)+e(300,240,78,62,iron)+r(272,151,56,178,iron,11)+p('M286 169v139M314 169v139','none','#C3CAAB',3)
    case 20:return r(41,65,518,351,stone,7)+r(67,89,225,299,iron,9)+r(306,89,227,299,iron,9)+handle(192,239,90)+handle(408,239,-90)+line('M537 140h29v149','#A5B69B',12)+dot(276,145)+dot(324,145)
    case 21:return r(33,72,534,337,stone,7)+pump(177,233,1.12)+pump(425,233,1.12)+waterBowl(225,348,84,44,iron)+waterBowl(474,348,66,44,iron)
    case 22:return r(64,49,472,382,'#A59B78',7)+fourFeet(91,77,419,326)+shaft(300,275,158,126)+radialRoof(regular(300,215,244,167,8),wood,187)+porch(233,384,134)
    case 23:return r(43,60,514,362,stone,7)+shaft(220,245,139,123)+e(220,245,126,110,iron)+p('M101 245h238M220 141v209','none','#BEC7A8',3)+pump(460,265,.9)
    default:throw new Error('未知水井构造。')
  }
}

function watering(i:number):string {
  const long='M46 82H554V398H46Z'
  switch(i){
    case 0:return p('M40 146L107 80 213 91 324 60 437 91 538 120 555 216 536 317 549 372 454 415 338 392 229 417 109 386 42 325Z',wood)+trough('M78 132H509V349H78Z',wood,.87,.7)+p('M61 163l28-39M504 111l24 41M493 382l-22 16','none','#CDB488',2.5)
    case 1:return board(40,64,520,351)+trough(long,wood,.88,.74)+r(30,99,33,39,wood,3)+r(537,345,33,39,wood,3)+line('M166 78v326M434 78v326','#A79872',6)
    case 2:return trough(long,stone,.88,.72)+p('M75 103l67 8M481 366l43-6M82 153v53','none','#C1C4A4',2)+p('M527 207h31','none','#6D9079',9)
    case 3:return handle(81,240,-90)+handle(519,240,90)+waterBowl(300,240,222,178,wood)+rep(20,n=>{const a=n*Math.PI/10;return p(`M${300+221*Math.cos(a)} ${240+177*Math.sin(a)}L${300+207*Math.cos(a)} ${240+165*Math.sin(a)}`,'none','#7A6E4C',1.5)})
    case 4:return board(39,61,522,357)+trough('M57 94H317V386H57Z',wood,.84,.74)+trough('M335 94H543V386H335Z',wood,.84,.74)+line('M324 74v332','#9D926B',8)
    case 5:return trough('M66 87H534V198Q529 408 300 413Q71 408 66 198Z',stone,.83,.73)+p('M300 80v90h25','none','#BBC2A1',17)+p('M80 203l26 9M452 369l31-12','none','#D0CCAE',2)
    case 6:return line('M76 93L129 404M524 93L471 404M77 384h445','#9D8B64',20)+trough('M68 131Q300 64 532 131V348Q300 414 68 348Z',wood,.86,.71)+line('M192 113V365M409 113v252','#7F8E70',7)
    case 7:return r(32,60,536,365,stone,7)+trough('M52 93H548V392H52Z',stone,.91,.69)+[211,391].map(x=>r(x,156,15,184,'#97AA8D',6)).join('')+waterBowl(302,117,54,33,stone)
    case 8:return trough('M32 240Q150 73 330 81Q488 90 568 240Q419 405 265 401Q117 384 32 240Z',stone,.85,.72)+line('M58 241Q303 186 542 240','#B9BF99',7)+p('M498 209l33-10 19 16','none','#9FB28E',11)
    case 9:return trough('M126 59H477L558 240 477 421H126L42 240Z',stone,.84,.72)+r(413,108,69,62,'#B5A97E',8)+p('M427 147h31l12 17','none','#D4C6A0',5)+dot(84,240,5)+dot(516,240,5)
    case 10:return line('M73 99L529 386M528 95L75 386','#C5B690',18)+trough('M77 126L191 69 300 102 431 74 536 143 515 260 543 354 420 412 298 379 164 408 59 335Z','#9E906E',.83,.74)+p(rep(14,n=>`M${99+n*29} 112l5 13M${99+n*29} 384l-4-13`),'none','#D5C49C',2)
    case 11:return trough('M112 85Q300 44 488 85L551 268 521 344 475 350 434 392 388 374 344 411 299 389 254 411 211 374 163 392 122 352 79 347 47 268Z',stone,.83,.74)+p(rep(7,n=>`M300 108L${104+n*65} ${n%2?363:345}`),'none','#C1C2A0',2)+p('M285 81v59h31','none','#AFC09F',13)
    case 12:return trough('M300 46Q445 37 452 195Q590 296 449 394Q334 446 300 325Q220 443 101 368Q16 261 151 193Q151 42 300 46Z',stone,.8,.76)+e(300,240,22,18,'#AAB79A')
    case 13:return trough(pointsPath(regular(300,240,236,189,8)),stone,.81,.75)+p(pointsPath(regular(300,240,210,168,8)),'none','#BBC09A',3)+p('M300 53v38M300 390v38M65 240h46M489 240h46','none','#829A7A',4)
    case 14:return trough('M37 204Q183 30 420 77Q535 102 566 220Q481 147 358 180Q229 220 153 374Q88 391 43 321Q20 275 37 204Z',stone,.84,.73)+p('M520 195l29-6 13 15','none','#B2C09E',15)
    case 15:return board(43,210,514,61)+waterBowl(170,240,134,134,wood)+waterBowl(430,240,134,134,wood)+r(283,225,34,31,water,3,'#C5BA95',4)
    case 16:return trough('M49 240C49 137 142 81 300 81S551 136 551 240 456 399 300 399 49 343 49 240Z',iron,.9,.75)+e(300,240,202,117,'none','#BECAB0',2)+r(446,121,61,71,'#A4B79B',12)+dot(473,154)
    case 17:return fourFeet(112,92,378,296)+trough(long,stone,.88,.7)+r(265,71,71,65,iron,10)+p('M300 113v34','none','#BDCCA9',9)
    case 18:return waterBowl(300,240,227,182,iron)+e(300,240,173,138,'none','#B3C5A5',2)+e(300,240,147,117,'none','#8AA489',2)+r(391,126,87,57,'#AAB99C',16)+dot(433,153)
    case 19:return handle(50,240,-90)+handle(550,240,90)+r(52,69,496,342,iron,22)+trough('M72 92H290V388H72Z','#C8CFB3',.84,.7)+trough('M311 92H528V388H311Z','#C8CFB3',.84,.7)
    case 20:return trough('M50 133Q298 49 550 133L537 340Q301 431 63 340Z',stone,.84,.72)+[115,300,485].map(x=>r(x-19,333,38,77,stone,5)).join('')+p('M105 146Q297 88 492 145','none','#D4D3B5',2.5)
    case 21:return r(37,63,526,356,'#9E9471',5)+p('M41 100h518M41 385h518M97 65v31M188 65v31M279 65v31M370 65v31M461 65v31','none','#756D50',2)+trough('M71 100H529V385H71Z',stone,.9,.71)+line('M518 152h35v44','#A9BC9F',11)
    case 22:return trough('M48 119H552V403H48Z',iron,.88,.72)+e(421,97,37,28,iron)+line('M421 97V40M410 53Q369 17 351 69l8 88','#9CAF91',11)+line('M432 63h46v91','#BDCCAB',13)
    case 23:return [r(41,184,40,139,'#657E64',13),r(519,184,40,139,'#657E64',13)].join('')+line('M300 107V25h86','#A9B89A',15)+trough('M81 100H519V398H81Z',iron,.85,.71)+line('M107 243h385','#A8B89A',4)
    default:throw new Error('未知饮水槽构造。')
  }
}

function fence(points:readonly Point[],kind:'wood'|'wattle'|'stone'|'rope'|'bone'|'pipe'|'mesh'='wood',seed=201):string {
  const d=pointsPath(points)
  let body=p(d,'url(#earth)','#A99A72',1.7)+texture(points,seed,'soil',95)
  body+=kind==='stone'?p(d,'none','#6D7B62',25)+p(d,'none','#A9B497',20):line(d,kind==='bone'?'#C1B58C':kind==='pipe'||kind==='mesh'?'#A8B99B':kind==='rope'?'#BDAD83':'#9D8B63',kind==='wattle'?11:kind==='rope'?5:9)
  for(let j=0;j<points.length;j++){
    const [x0,y0]=points[j],[x1,y1]=points[(j+1)%points.length],dx=x1-x0,dy=y1-y0,length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length,n=Math.ceil(length/(kind==='stone'?33:kind==='wattle'||kind==='mesh'?22:75))
    for(let k=0;k<n;k++){
      const t=(k+.5)/n,x=x0+dx*t,y=y0+dy*t
      if(kind==='stone')body+=p(`M${x-nx*10} ${y-ny*10}l${nx*20} ${ny*20}`,'none','#7C8C71',2)
      else if(kind==='wattle'||kind==='mesh')body+=p(`M${x-nx*7-dx/n*.3} ${y-ny*7-dy/n*.3}L${x+nx*7+dx/n*.3} ${y+ny*7+dy/n*.3}m${-nx*14} ${-ny*14}l${nx*14-dx/n*.6} ${ny*14-dy/n*.6}`,'none',kind==='mesh'?'#BAC6A7':'#C0AD82',1.6)
      else if(k%2===0)body+=footing(x,y,kind==='pipe'?iron:kind==='bone'?'#C4B68C':wood)
    }
  }
  body+=points.filter((_,i)=>points.length<15||i%Math.ceil(points.length/12)===0).map(([x,y])=>footing(x,y,kind==='pipe'||kind==='mesh'?iron:kind==='stone'?stone:kind==='bone'?'#C5B78D':wood)).join('')
  return body
}
const gate = (x:number,y:number,w:number,material=wood,angle=0) => g(`translate(${x} ${y}) rotate(${angle})`,r(-w/2,-10,w,20,material,3)+p(`M${-w/2+4} 0H${w/2-4}M${-w/2+5} -7L${w/2-5} 7`,'none','#CCBE95',2)+footing(-w/2,0,material)+footing(w/2,0,material))
function pen(i:number):string {
  const rect:readonly Point[]=[[62,62],[538,62],[538,418],[62,418]]
  switch(i){
    case 0:return fence(rect,'wood',201)+gate(300,418,130)
    case 1:return fence(ellipse(300,240,231,185),'wattle',203)+gate(300,422,110)
    case 2:return fence([[70,62],[530,62],[550,91],[550,390],[527,418],[73,418],[49,388],[49,91]],'stone',205)+gate(300,418,144)
    case 3:return fence([[300,49],[555,422],[45,422]],'wood',207)+gate(300,422,128)
    case 4:return fence(rect,'wood',209)+line('M300 63v355','#A68F63',10)+gate(180,418,103)+gate(420,418,103)
    case 5:return fence(rect,'wood',211)+woodRoof(53,49,495,163,'gable')+gate(300,418,132)
    case 6:return fence(regular(300,240,237,190,8),'rope',213)+gate(300,430,119)
    case 7:return fence(ellipse(300,240,244,178),'wood',215)+p(pointsPath(ellipse(300,240,222,160)),'none','#B6A279',3)+gate(300,418,155)
    case 8:return fence([[38,241],[150,95],[330,68],[561,240],[410,388],[251,415]],'wattle',217)+line('M300 96v143','#9FA779',12)+gate(182,358,111,wood,37)
    case 9:return fence(regular(300,240,242,194,6),'stone',219)+gate(300,434,124,iron)+rep(6,n=>{const a=-Math.PI/2+n*Math.PI/3;return footing(300+242*Math.cos(a),240+194*Math.sin(a),iron)})
    case 10:return fence([[70,120],[172,67],[296,101],[437,64],[541,130],[518,254],[549,359],[421,418],[301,385],[166,412],[52,341],[86,240]],'bone',221)+gate(300,385,140)+p('M80 139l22 12M511 350l-22-12','none','#E1D2A7',3)
    case 11:return fence(flower(300,240,242,194,3),'wattle',223)+line('M300 240V60M300 240L122 363M300 240L479 363','#A4A478',8)+gate(300,360,120)
    case 12:return fence([[40,205],[104,130],[204,88],[324,71],[438,90],[540,139],[564,217],[454,178],[344,188],[245,235],[177,314],[142,395],[73,371],[37,300]],'stone',225)+gate(243,236,96,wood,-35)
    case 13:return fence(regular(300,240,237,190,8),'pipe',227)+rep(8,n=>{const a=-Math.PI/2+n*Math.PI/4;return footing(300+237*Math.cos(a),240+190*Math.sin(a),stone)})+gate(300,430,132,iron)
    case 14:return fence([[74,81],[524,81],[553,141],[553,345],[511,404],[407,417],[299,397],[194,417],[90,403],[47,345],[47,141]],'wood',229)+fence([[70,300],[193,300],[193,418],[70,418]],'wood',230)+fence([[407,300],[530,300],[530,418],[407,418]],'wood',231)+gate(300,397,135)
    case 15:return fence(rough(300,240,241,187,233,22),'wattle',233)+[g('rotate(-18 99 103)',line('M65 86L131 123M96 102l-20 31M96 102l26-26','#8E9D6C',15)),g('rotate(18 503 101)',line('M469 86L535 123M500 102l-20 31M500 102l26-26','#8E9D6C',15)),line('M72 368l55 38M503 367l-43 42','#8E9D6C',15)].join('')+gate(300,422,130)
    case 16:return fence(rect,'pipe',235)+gate(300,418,162,iron)
    case 17:return fence([[49,76],[551,76],[551,404],[49,404]],'mesh',237)+gate(300,404,113,iron)
    case 18:return fence([[62,62],[441,62],[441,171],[552,190],[552,334],[441,352],[441,418],[62,418]],'wood',239)+line('M375 63v355M441 190H552M441 333H552','#AEB399',8)+gate(375,268,110,iron,90)+gate(550,263,98,iron,90)
    case 19:return fence(rect,'pipe',241)+line('M220 63v355M379 63v355','#AEBB9E',8)+gate(140,418,96,iron)+gate(299,418,96,iron)+gate(459,418,96,iron)
    case 20:return fence(rect,'pipe',243)+[footing(62,62),footing(538,62),footing(538,418),footing(62,418),footing(299,62),footing(62,240),footing(538,240)].join('')+gate(300,418,138,iron)
    case 21:return fence(regular(300,240,236,189,12),'pipe',245)+p(pointsPath(ellipse(300,240,210,168)),'none','#A7B294',3)+gate(300,429,148,iron)
    case 22:return fence(rect,'pipe',247)+woodRoof(53,50,495,183,'metal')+gate(300,418,138,iron)
    case 23:return fence([[57,54],[547,54],[547,215],[285,215],[285,426],[57,426]],'pipe',249)+line('M285 56v157','#AAB89A',8)+gate(285,134,83,iron,90)+gate(172,426,109,iron)+gate(438,54,109,iron)
    default:throw new Error('未知畜栏构造。')
  }
}

function coop(i:number):string {
  const ramp=(x:number,y:number,w=83,h=66)=>porch(x,y,w,h)+rep(4,n=>p(`M${x+7} ${y+12+n*13}h${w-14}`,'none','#7E7150',2))
  switch(i){
    case 0:return fourFeet(92,93,416,287)+woodRoof(76,78,448,317)+ramp(258,393)
    case 1:return radialRoof(ellipse(300,240,222,178),wood,254)+rep(12,n=>{const a=n*Math.PI/6;return p(`M300 240L${300+212*Math.cos(a)} ${240+169*Math.sin(a)}`,'none','#B9A67B',3)})+porch(250,393,100)
    case 2:return fourFeet(83,97,433,285)+woodRoof(65,78,470,320,'single')+ramp(492,283,64,104)
    case 3:return fourFeet(66,101,468,278)+woodRoof(54,86,492,309)+line('M54 240h492','#B6A378',15)+ramp(42,201,51,85)+ramp(507,201,51,85)
    case 4:return fourFeet(92,90,416,301,wood)+woodRoof(90,88,420,303,'hip')+ramp(509,230,54,99)
    case 5:return fourFeet(52,93,496,289)+woodRoof(244,115,112,259,'single')+woodRoof(40,76,225,330)+woodRoof(335,76,225,330)+ramp(261,371,78,76)
    case 6:return r(57,56,486,369,stone,6)+woodRoof(75,73,450,334,'hip')+ramp(258,406)
    case 7:return p(pointsPath(ellipse(300,240,245,162)),wood)+texture(ellipse(300,240,231,147),267,'wood',130)+line('M166 105v270M300 89v301M434 105v270','#9F9A71',8)+porch(512,205,49,70)
    case 8:return p('M42 241Q165 66 325 79Q485 92 558 241Q417 404 263 401Q116 383 42 241Z',leaf)+p('M101 250Q188 105 329 119Q470 142 508 247Q403 368 271 362Q164 355 101 250Z','#A9B78B','#6D865D',2)+line('M57 241Q300 172 543 241','#92A774',10)+p('M300 111l-21 65m90 72 62 22M183 242l-41 38','none','#CCD0A7',3)+porch(251,372,98)
    case 9:return radialRoof(regular(300,240,238,190,6),stone,272)+rep(6,n=>{const a=-Math.PI/2+n*Math.PI/3;return footing(300+228*Math.cos(a),240+181*Math.sin(a),iron)})+porch(243,405,114)
    case 10:return fourFeet(65,89,471,304,wood)+p('M54 120L174 61 301 90 430 56 549 124 525 246 554 370 426 419 299 384 163 418 48 355 74 246Z','#A39773')+texture([[74,132],[174,82],[301,110],[429,78],[528,137],[505,246],[530,358],[425,399],[300,364],[167,397],[69,346],[96,245]],275,'wood',85)+line('M70 105L531 384M529 104L72 382','#C9B98F',18)+porch(253,383,94)
    case 11:return p(pointsPath(rough(300,240,225,180,278)),leaf)+rep(10,n=>{const a=n*Math.PI/5;return p(`M300 208Q${300+121*Math.cos(a)} ${240+97*Math.sin(a)} ${300+214*Math.cos(a)} ${240+170*Math.sin(a)}`,'none','#B2BC91',4)})+e(300,208,27,20,'#B7BB93','#819A71',3)+porch(249,404,102)
    case 12:return radialRoof(flower(300,240,236,189,3),wood,281)+rep(3,n=>g(`rotate(${n*120} 300 240)`,line('M300 240V55','#BFA77D',5)))+e(300,240,26,21,leaf)+porch(249,354,102)
    case 13:return radialRoof(regular(300,240,238,190,8),stone,284)+p(pointsPath(regular(300,240,206,165,8)),'none','#C4C4A2',4)+porch(243,416,114)
    case 14:return radialRoof([[38,205],[103,128],[205,87],[323,71],[435,89],[535,136],[564,215],[456,178],[344,188],[245,235],[178,313],[143,393],[74,369],[37,301]],wood,287)+line('M56 217Q279 100 531 158','#A49268',9)+porch(207,262,89,29)
    case 15:return woodRoof(88,77,425,327,'hip')+radialRoof(ellipse(103,242,63,111),wood,290)+radialRoof(ellipse(498,242,63,111),wood,291)+porch(248,397,104,42)
    case 16:return fourFeet(73,85,454,310)+woodRoof(57,70,486,340,'metal')+woodRoof(232,208,137,63,'metal')+ramp(255,408,89,44)
    case 17:return r(47,58,506,366,'#A39876',4)+woodRoof(62,73,476,335,'single')+ramp(251,405,98,42)
    case 18:return r(38,174,41,142,'#698063',14)+r(521,174,41,142,'#698063',14)+line('M300 84V30h68','#A6B391',16)+woodRoof(75,79,450,326)+ramp(251,401,98,42)
    case 19:return board(57,83,44,314)+board(499,83,44,314)+p('M92 94Q300 44 508 94V389Q300 434 92 389Z','#7F9779','#657B62',3)+p(rep(23,n=>`M${102+n*17} 96v290`)+rep(13,n=>`M97 ${108+n*22}q204-32 407 0`),'none','#BCC5A4',1.4)+p('M89 99Q295 45 508 99V243Q292 202 89 243Z','#A7AA87','#7A8B6F',2)+p('M92 233Q299 201 505 233','none','#D0C7A0',4)
    case 20:return fourFeet(65,83,470,315)+woodRoof(47,66,506,349)+woodRoof(106,187,387,112,'metal')+p('M116 204h367M116 285h367','none','#7C936F',7)+ramp(254,414,92,37)
    case 21:return fourFeet(48,86,504,313)+woodRoof(245,118,109,242,'single')+woodRoof(35,73,229,338,'metal')+woodRoof(336,73,229,338,'metal')+ramp(258,357,84,87)
    case 22:return woodRoof(59,66,483,295,'metal')+[porch(77,352,95,80),porch(188,352,95,80),porch(300,352,95,80),porch(412,352,95,80)].join('')+ramp(52,177,53,94)
    case 23:return radialRoof(regular(300,240,240,192,8),wood,308)+radialRoof(regular(300,240,203,162,8),wood,309)+radialRoof(regular(300,240,63,50,8),iron,310)+ramp(251,421,98,33)
    default:throw new Error('未知鸡舍构造。')
  }
}

function beehive(i:number):string {
  const entrance=(x=300,y=407,w=79)=>porch(x-w/2,y,w,29)+r(x-w*.32,y-7,w*.64,9,'#526D50',3,'#526D50',0)
  const skep=(x:number,y:number,rx:number,ry:number,seed:number)=>hay(ellipse(x,y,rx,ry),seed,110)+rep(6,n=>e(x,y,rx*(.15+n*.14),ry*(.15+n*.14),'none',n%2?'#A99562':'#D2BC83',2.3))+e(x-8,y-12,14,11,wood)
  switch(i){
    case 0:return skep(300,235,203,162,315)+entrance(300,398)
    case 1:return skep(300,240,233,178,317)+ring(300,240,224,170,'#B5A170',7)+entrance(300,413)
    case 2:return p(pointsPath(rough(300,240,237,180,319,28)),wood)+e(300,240,201,153,wood)+e(300,240,170,129,'none','#B8A276',3)+texture(ellipse(300,240,197,149),319,'wood',93)+p('M109 143l30-19M477 352l20-25M514 200l-20 17','none','#776D49',4)+entrance(300,416,90)
    case 3:return board(72,67,456,346)+line('M114 82v315M486 82v315','#BAA77B',10)+entrance(300,413,138)
    case 4:return p(pointsPath(ellipse(300,240,227,181)),'#B1A27B')+texture(ellipse(300,240,216,170),323,'stone',70)+e(300,225,55,44,'#BBAF8C','#8F9370',3)+p('M92 206q23-65 82-90','none','#D6C39D',3)+entrance(300,417,88)
    case 5:return board(75,74,450,332)+hay([[59,87],[302,50],[542,87],[552,392],[300,431],[47,392]],325,160)+line('M53 240H547M300 52V426','#BDA577',5)+entrance(300,421,105)
    case 6:return board(42,364,516,55)+skep(176,238,132,143,328)+skep(422,252,122,128,329)+entrance(176,379,82)+entrance(422,379,82)
    case 7:return p(pointsPath(ellipse(300,240,245,156)),wood)+texture(ellipse(300,240,232,145),331,'wood',130)+line('M163 111v259M300 92v296M438 111v259','#A4A175',8)+e(84,240,24,96,wood)+entrance(520,238,47)
    case 8:return p('M39 241Q160 69 327 78Q488 90 561 240Q422 407 264 401Q113 383 39 241Z',leaf)+texture([[64,239],[170,110],[327,101],[533,240],[409,371],[268,376]],335,'wood',86)+line('M56 241Q299 175 544 240','#91A572',10)+p('M198 210l-31-54M355 208l43-53M174 266l-31 39M367 263l45 46','none','#C6CFA7',3)+entrance(299,387,102)
    case 9:return radialRoof(regular(300,240,237,190,6),stone,338)+p('M173 155h254M173 324h254M219 84v312M382 85v311','none','#99A98A',3)+entrance(300,424,114)
    case 10:return skep(300,240,225,180,341)+line('M100 98L506 381M502 96L98 380','#C8B88F',17)+line('M91 352q209 71 418 0','#B9A478',6)+entrance(300,418,91)
    case 11:return p(pointsPath(rough(300,240,232,186,344)),leaf)+rep(11,n=>{const a=n*Math.PI*2/11;return p(`M287 208Q${300+113*Math.cos(a)} ${240+90*Math.sin(a)} ${300+220*Math.cos(a)} ${240+176*Math.sin(a)}`,'none','#B9C296',3.4)})+e(287,208,27,21,'#BAC29A','#849D6F',3)+entrance(300,418,91)
    case 12:return hay(flower(300,240,235,188,5),347,150)+rep(5,n=>g(`rotate(${n*72} 300 240)`,line('M300 240V59','#B6A170',4)))+e(300,240,25,20,wood)+entrance(300,353,91)
    case 13:return radialRoof(regular(300,240,239,191,8),wood,350)+p(pointsPath(regular(300,240,209,167,8)),'none','#C9B78C',3)+entrance(300,423,105)+entrance(300,25,105)
    case 14:return hay([[35,203],[102,128],[203,85],[325,71],[436,91],[540,139],[566,216],[453,177],[344,188],[245,236],[178,314],[143,393],[75,369],[35,300]],353,175)+skep(178,196,67,49,354)+skep(391,138,64,45,355)+entrance(272,214,91)
    case 15:return board(37,335,526,75)+skep(179,221,132,145,357)+skep(421,232,123,135,358)+woodRoof(89,55,430,112,'single')+entrance(180,366,98)+entrance(420,366,98)
    case 16:return handle(65,237,-90)+handle(535,237,90)+r(68,70,464,332,iron,10)+r(85,84,430,304,'none',7,'#C1CBA9',3)+entrance(300,402,165)
    case 17:return woodRoof(62,67,476,342)+r(83,208,44,58,'#78916E',5)+r(473,208,44,58,'#78916E',5)+entrance(300,410,145)
    case 18:return board(40,64,520,349)+rep(16,n=>r(52+n*32,76,22,323,n%3?wood:'#AA956A',2,'#7C7352',1.2))+handle(43,239,-90)+handle(557,239,90)+entrance(300,413,109)
    case 19:return board(51,65,499,349)+r(74,88,325,300,'#9AAE89',6,'#7C916E',3)+rep(5,n=>p(`M${100+n*61} 103q21 142 0 270`,'none','#C6BD8F',14))+rep(34,n=>{const x=96+n%7*43,y=122+Math.floor(n/7)*51;return e(x,y,5,3,'#6B7856','#A3A77A',1)})+board(407,87,123,303,6)+line('M399 101v271','#89967B',5)+entrance(242,414,130)
    case 20:return r(54,65,492,348,iron,8)+r(73,82,454,313,'none',6,'#B7C4A3',3)+[[99,118],[453,118],[99,359],[453,359]].map(([x,y])=>r(x-20,y-17,40,34,'#6E8666',4)+p(`M${x-15} ${y-9}h30m-30 8h30m-30 8h30`,'none','#B9C7A5',2)).join('')+entrance(300,414,133)
    case 21:return board(40,66,520,347)+board(56,81,232,316)+board(309,81,234,316)+line('M299 75v331','#A5AB86',7)+entrance(175,412,133)+entrance(428,412,133)
    case 22:return board(66,66,468,348)+line('M183 76v328M418 76v328M78 241h444','#7E8E6E',13)+fourFeet(80,79,440,321,iron)+entrance(300,414,120)
    case 23:return board(32,337,536,84)+woodRoof(45,85,155,267,'metal')+woodRoof(223,85,155,267,'metal')+woodRoof(401,85,155,267,'metal')+entrance(122,351,97)+entrance(300,351,97)+entrance(478,351,97)
    default:throw new Error('未知蜂箱构造。')
  }
}

function farmTool(i:number):string {
  switch(i){
    case 0:return line('M300 435V183','#B39A6F',17)+r(276,163,48,44,iron,7)+p('M281 172Q220 146 194 61M300 172V43M319 172Q380 146 406 61','none','#8C9B7C',15)+p('M196 65l-10-20M300 46V27M405 65l10-20','none','#BFC5A3',7)
    case 1:return line('M300 438V117','#AD966A',17)+board(69,83,462,44,9)+rep(10,n=>line(`M${91+n*46} 95V46`,'#B2A178',10))+p('M282 105h36','none','#D8BD8E',2)
    case 2:return line('M274 436Q202 338 285 231Q337 162 298 65','#AF966A',16)+line('M268 315l76 4M284 206l-71 9','#B6A075',10)+p('M294 83Q406 1 551 73Q470 54 319 118Z',iron)+p('M324 105Q436 58 529 70','none','#D0CFAC',2.5)+r(284,70,28,57,iron,5)
    case 3:return line('M296 270Q337 174 296 77','#97A476',21)+line('M296 109l-48-57M296 109l40-68M296 258l-19 23','#94A273',11)+p('M221 255Q300 224 379 255L397 366Q300 447 202 366Z',iron)+p('M300 261v147M229 273l-13 78','none','#C9CCAA',2.5)+line('M279 226l40 6M280 238l40 6','#B8A276',5)
    case 4:return line('M300 436V142','#B29B71',22)+p('M132 108H290L320 80H464L491 107 466 129H333L309 166 142 166Z',iron)+p('M133 108V63H183V108M216 108V50H263V108','none','#A9B997',13)+p('M146 157h148','none','#CAD1AD',3)+r(278,125,44,55,iron,6)+dot(300,151)
    case 5:return line('M300 435Q341 315 300 159','#C6B88E',22)+p('M215 140H385V177H215Z',iron)+rep(4,n=>p(`M${224+n*51} 147Q${221+n*51} 91 ${203+n*64} 35`,'none','#95A786',14))+line('M282 183h38M284 195h36M286 208h34','#A28D65',5)+p('M301 224l-9 108','none','#E1D1A8',2)
    case 6:return line('M300 403V142','#AD9467',18)+line('M300 152Q206 151 218 62H382Q394 151 300 152Z','#A6B491',16)+p('M208 318H393L403 393Q300 451 197 393Z',iron)+p('M300 329v94M217 333l-7 49','none','#CED0AC',3)+r(279,299,42,52,iron,5)
    case 7:return line('M113 427L241 224M486 427L359 224','#AA966E',13)+r(279,65,42,244,'#708669',14)+r(287,76,26,222,iron,9)+line('M231 167h138','#B6C4A1',8)+e(300,167,19,15,iron)+p('M231 177H367L385 310 299 348 215 310Z',iron)+p('M241 189H357L340 230H256Z','#718C6C','#C3C7A2',3)+p('M270 346L300 410 328 346Z',iron)+line('M239 111l-36-37M360 111l36-37','#B1A078',9)
    default:throw new Error('未知农具构造。')
  }
}

const leafBlade = (x:number,y:number,angle:number,length=46,width=15,color=leaf) => g(`translate(${x} ${y}) rotate(${angle})`,p(`M0 0Q${-width} ${-length*.42} 0 ${-length}Q${width} ${-length*.42} 0 0Z`,color,'#6C8156',1.1)+p(`M0-2v${-length+7}`,'none','#BCC296',.9))
const greens = (x:number,y:number,seed:number,size=1) => g(`translate(${x} ${y}) scale(${size})`,rep(7,n=>leafBlade(0,0,n*51+seed*7,40+rng(seed,n)*18,12+rng(seed,n+10)*6,n%3?leaf:'#9EAE78'))+e(0,0,8,6,'#9BAE75','#6D8655',1))
const mushroom = (x:number,y:number,rx:number,ry:number,color='#ABA17A') => e(x,y,rx,ry,color,'#6E7957',1.4)+p(`M${x-rx*.55} ${y-ry*.47}q${rx*.5} ${-ry*.45} ${rx*1.05} 0`,'none','#D0C59A',1.1)+e(x+rx*.16,y+ry*.11,rx*.18,ry*.19,'#8F9371','#8F9371',0)
function fodder(i:number):string {
  const ovalTray=(material=wood)=>e(300,240,246,172,material)+e(300,240,227,155,'#7D825C','#C6B68C',3)
  const ovalInside=ellipse(300,240,216,142)
  const seeds=(kind:number)=>rep(190,n=>{const x=83+rng(371,n*3)*432,y=99+rng(371,n*3+1)*282;if(!inside(x,y,ovalInside))return'';return e(x,y,kind===1?4:6+rng(371,n*3+2)*4,kind===1?3:3+rng(372,n)*2,n%3?'#C1AD74':'#A4925E','#8F8555',.65)})
  switch(i){
    case 0:return ovalTray()+seeds(0)+g('rotate(-28 435 294)',e(435,294,34,24,wood)+line('M459 294h78','#B8A070',13))
    case 1:return board(54,65,492,351)+p('M77 89H523V391H77Z','#9C9167','#C8B68C',3)+texture([[85,97],[515,97],[515,382],[85,382]],377,'straw',160)+e(287,241,69,43,'#8D865F','#BDB180',1.4)+p('M216 234q73-26 139 6','none','#C9B988',2)
    case 2:return ovalTray()+p(rep(28,n=>{const a=n*Math.PI/14;return `M${300+240*Math.cos(a)} ${240+167*Math.sin(a)}L${300+223*Math.cos(a)} ${240+151*Math.sin(a)}` }),'none','#786D4A',2)+[greens(180,188,4,1.3),greens(297,163,5,1.35),greens(416,192,6,1.3),greens(205,293,7,1.35),greens(362,299,8,1.4)].join('')
    case 3:return board(46,72,508,337)+r(71,96,458,289,'#777F58',9,'#CBB88D',3)+rep(15,n=>{const x=125+n%5*88,y=158+Math.floor(n/5)*82;return g(`rotate(${n%2?17:-21} ${x} ${y})`,p(`M${x-31} ${y-21}Q${x+12} ${y-43} ${x+37} ${y-4}L${x+26} ${y+34} ${x-27} ${y+28}Z`,n%3?'#A69D6C':'#B8A575','#7D8459',1.6)+p(`M${x-19} ${y-10}l24-6M${x+12} ${y+18}l13-1`,'none','#D0BF8D',1.2)+(n%4?'':leafBlade(x+28,y-16,37,35,10)))})
    case 4:return p('M39 239Q156 74 325 79Q484 89 561 240Q420 404 263 401Q114 383 39 239Z',leaf)+[g('rotate(-13 180 249)',rep(9,n=>leafBlade(180+n%3*16,300,-31+n*8,105+n%3*11,13))),g('rotate(7 304 238)',rep(9,n=>leafBlade(295+n%3*15,302,-29+n*8,118+n%3*9,13))),g('rotate(22 424 242)',rep(8,n=>leafBlade(417+n%3*14,302,-29+n*8,108+n%3*11,13)))].join('')+line('M144 286q159 41 314 0','#B8AA7C',9)
    case 5:return p(pointsPath(regular(300,240,244,181,6)),stone)+p(pointsPath(regular(300,240,219,157,6)),'#7E8A62','#BDC5A0',2.5)+rep(23,n=>{const x=134+n%5*85+rng(383,n)*14,y=150+Math.floor(n/5)*46;return inside(x,y,regular(300,240,203,142,6))?mushroom(x,y,21+rng(384,n)*13,15+rng(385,n)*10,n%3?'#A9A27A':'#C1B18A'):''})+texture(regular(300,240,207,145,6),385,'straw',33)
    case 6:return ovalTray(iron)+seeds(1)+g('rotate(20 457 314)',r(420,289,69,48,wood,8)+line('M486 314h48','#B49A6D',13))
    case 7:return board(47,70,506,340,23)+r(69,94,462,292,'#7C8C5F',17,'#C6B68A',3)+texture([[78,104],[520,104],[520,376],[78,376]],389,'straw',190)+rep(11,n=>{const x=125+n%4*114,y=157+Math.floor(n/4)*93;return r(x-13,y-11,26,22,n%3?'#A4A674':'#BEAE7D',4,'#7D8B5F',1.2)})
    default:throw new Error('未知饲料构造。')
  }
}
function crops(i:number):string {
  const ridge=(x:number,y:number,w:number,h:number,seed:number)=>p(pointsPath(rough(x+w/2,y+h/2,w/2,h/2,seed,26)),'url(#earth)','#9A926B',1.3)+texture(ellipse(x+w/2,y+h/2,w*.47,h*.44),seed,'soil',48)
  const wheat=(x:number,y:number,seed:number)=>rep(8,n=>{const xx=x+(n%4-1.5)*10,yy=y+(Math.floor(n/4)-.5)*21;return p(`M${xx} ${yy+29}q${n%2?11:-9} -23 0-57`,'none','#A7A06A',2)+g(`translate(${xx} ${yy-23}) rotate(${n%2?14:-13})`,rep(5,k=>e(k%2?4:-4,-k*4,5,2.5,k%3?'#CCBB7E':'#B4A366','#8F8C58',.6))+p('M0 7v-25','none','#DDD09B',.8))})
  switch(i){
    case 0:return ridge(33,81,533,121,400)+ridge(33,276,533,121,401)+rep(10,n=>wheat(91+n%5*104,143+Math.floor(n/5)*195,402+n))
    case 1:return ridge(37,86,526,124,410)+ridge(37,271,526,124,411)+rep(8,n=>{const x=105+n%4*129,y=148+Math.floor(n/4)*186;return greens(x,y,412+n,1.07)+e(x,y,27,22,'#91A46C','#647E50',1.3)+p(`M${x-12} ${y+7}q-17-28 7-35q30 11 6 34M${x-22} ${y-5}q21-16 44 0`,'none','#BDC58E',1.5)})
    case 2:return ridge(36,84,528,121,422)+ridge(36,277,528,121,423)+rep(8,n=>{const x=99+n%4*133,y=143+Math.floor(n/4)*194;return line(`M${x-25} ${y+32}L${x+22} ${y-43}`,'#AC9870',5)+p(`M${x-20} ${y+25}q62-35 7-72`,'none','#718C50',3)+rep(5,k=>leafBlade(x+(k%2?14:-12),y+26-k*14,k%2?65:-61,28,9))})
    case 3:return [ridge(36,66,528,83,432),ridge(36,197,528,83,433),ridge(36,327,528,83,434)].join('')+rep(15,n=>{const x=82+n%5*109,y=104+Math.floor(n/5)*131;return Math.floor(n/5)===0?greens(x,y,435+n,.72):Math.floor(n/5)===1?rep(6,k=>leafBlade(x,y,k*60,43,7,'#9CA978')):rep(6,k=>leafBlade(x,y,k*60,40,15,'#8FA571'))})
    case 4:return [g('rotate(-3 300 146)',p(pointsPath(rough(300,146,254,64,451,26)),wood)+texture(ellipse(300,146,239,52),451,'wood',77)),g('rotate(3 300 336)',p(pointsPath(rough(300,336,254,64,452,26)),wood)+texture(ellipse(300,336,239,52),452,'wood',77))].join('')+rep(22,n=>mushroom(81+n%11*43,137+Math.floor(n/11)*197+(n%3-1)*17,17+n%3*4,12+n%3*3,n%3?'#AAA27C':'#C2B28D'))
    case 5:return ridge(36,83,528,129,460)+ridge(36,272,528,129,461)+rep(6,n=>{const x=121+n%3*178,y=148+Math.floor(n/3)*190;return e(x+10,y+18,18,23,'#B2A16C','#818A58',1.2)+rep(7,k=>leafBlade(x,y,k*51+n*3,51,18,k%3?leaf:'#A5B57F'))})
    case 6:return ridge(31,79,538,125,470)+ridge(31,279,538,125,471)+rep(10,n=>{const x=86+n%5*107,y=142+Math.floor(n/5)*202;return line(`M${x} ${y+36}v-74`,'#9FAB77',4)+rep(6,k=>leafBlade(x,y+21-k*9,k%2?64:-64,54+k%2*8,8,k%3?leaf:'#A2B37D'))})
    case 7:return rep(4,n=>ridge(32,46+n*105,536,74,480+n))+rep(12,n=>greens(111+n%3*188,83+Math.floor(n/3)*105,485+n,.83))+rep(19,n=>e(58+rng(499,n)*481,52+rng(500,n)*370,3+rng(501,n)*4,2+rng(502,n)*3,'#B2AC87','#8D9270',.6))
    default:throw new Error('未知作物行构造。')
  }
}

export const FARM_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Farm-Collection-1'
export const FARM_COLLECTION_LICENSE = `Sceneweave Farm Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG drawings of farming, animal husbandry and village facilities, authored with coding assistance. No third-party art or image pixels are included. Illustrative period/fantasy interpretations; technical validation and art review are separate. Granaries, coops and pens here are solid decorative props, not enterable buildings or actual traversable fence geometry. Wells do not create terrain holes; water pictures do not create travel permissions. Animal tokens are outside this collection.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const defs = `<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="88%" y2="100%"><stop offset="0%" stop-color="#C0A87C"/><stop offset="38%" stop-color="#AE946A"/><stop offset="100%" stop-color="#7C6D4C"/></linearGradient>
<linearGradient id="straw" x1="0%" y1="0%" x2="78%" y2="100%"><stop offset="0%" stop-color="#C9B883"/><stop offset="29%" stop-color="#BEAA71"/><stop offset="67%" stop-color="#AC9B64"/><stop offset="100%" stop-color="#928456"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#BCC2A6"/><stop offset="45%" stop-color="#A3B095"/><stop offset="100%" stop-color="#7E9077"/></linearGradient>
<linearGradient id="iron" x1="0%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#BDC6A6"/><stop offset="28%" stop-color="#A4B694"/><stop offset="62%" stop-color="#8DA581"/><stop offset="100%" stop-color="#6E886B"/></linearGradient>
<linearGradient id="water" x1="0%" y1="0%" x2="73%" y2="100%"><stop offset="0%" stop-color="#648773"/><stop offset="22%" stop-color="#88A38B"/><stop offset="67%" stop-color="#A5B496"/><stop offset="100%" stop-color="#7D9B7D"/></linearGradient>
<linearGradient id="leaf" x1="0%" y1="0%" x2="88%" y2="100%"><stop offset="0%" stop-color="#B7C08B"/><stop offset="34%" stop-color="#9FB27B"/><stop offset="100%" stop-color="#6E8D58"/></linearGradient>
<linearGradient id="earth" x1="0%" y1="0%" x2="87%" y2="100%"><stop offset="0%" stop-color="#B2A580"/><stop offset="48%" stop-color="#A29570"/><stop offset="100%" stop-color="#8B835D"/></linearGradient>
</defs>`
function artwork(design:FarmDesign,index:number):VisualSampleArt {
  const detail=['farm-tool','fodder','crop-row'].includes(design.category),solidBuilding=['granary','coop','pen'].includes(design.category)
  const body=({ haystack,granary,well,'watering-trough':watering,pen,coop,beehive,'farm-tool':farmTool,fodder,'crop-row':crops }[design.category])(index)
  return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
    sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm/600} ${design.heightMm/480})">${body}</g></svg>`,
    footprintMm:{width:Math.round(design.widthMm*.94),height:Math.round(design.heightMm*.94)},blocksMovement:!detail,blocksSight:false,
    renderLayer:design.category==='crop-row'?'ground':'object',shadowClass:design.category==='crop-row'?'vegetation':detail?'none':'furniture',
    tags:['原创','农牧乡村',design.category,design.era,design.design,'俯视',...(solidBuilding?['整片阻挡装饰','非可进入建筑','围栏图像不授予内部通行']:[]),...(design.category==='well'?['装饰井口','不生成真实地形孔洞']:[])]}
}
export const FARM_COLLECTION_ART:readonly VisualSampleArt[]=freezeJson(FARM_DESIGNS.map(design=>artwork(design,FARM_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
