import { RITUAL_DESIGNS, type RitualDesign } from '../assets/ritual-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

type Point = readonly [number,number]
type Material = 'stone'|'marble'|'darkstone'|'wood'|'copper'|'brass'|'cloth'|'paper'|'glass'|'crystal'|'bone'|'ceramic'
const colors:Record<Material,readonly [string,string,string]>={stone:['#9A9B88','#5C665B','#CAC6A9'],marble:['#C7C7B3','#747F74','#ECE6CC'],darkstone:['#696F66','#3D4A43','#9BA18B'],wood:['#8B684B','#493E31','#C2A075'],copper:['#9D8259','#4E6658','#CEB082'],brass:['#B69A65','#69674C','#E0C58B'],cloth:['#785355','#423D3C','#B3867C'],paper:['#CFBA8B','#8C7B59','#EAD9AC'],glass:['#789F96','#456E69','#C9DFCE'],crystal:['#88B3AA','#4B7775','#DBEBDA'],bone:['#C5BA98','#817D62','#E7D8B4'],ceramic:['#AC9674','#6C6B55','#D9C7A0']}
const fill=(m:Material)=>`url(#${m})`
const nn=(n:number)=>Math.round(n*100)/100
const rep=(n:number,fn:(i:number)=>string)=>Array.from({length:n},(_,i)=>fn(i)).join('')
const p=(d:string,f='none',s='#4E554B',w=2)=>`<path d="${d}" fill="${f}" stroke="${s}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`
const r=(x:number,y:number,w:number,h:number,f:string,rad=0,s='#4E554B',sw=2)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`
const e=(x:number,y:number,rx:number,ry:number,f:string,s='#4E554B',w=2)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${f}" stroke="${s}" stroke-width="${w}"/>`
const g=(t:string,b:string)=>`<g transform="${t}">${b}</g>`
const path=(v:readonly Point[])=>v.map(([x,y],i)=>`${i?'L':'M'}${nn(x)} ${nn(y)}`).join('')+'Z'
const polygon=(x:number,y:number,rx:number,ry:number,n:number,phase=-Math.PI/2):Point[]=>Array.from({length:n},(_,i)=>[x+rx*Math.cos(phase+i*Math.PI*2/n),y+ry*Math.sin(phase+i*Math.PI*2/n)])
const oval=(x:number,y:number,rx:number,ry:number)=>polygon(x,y,rx,ry,48)
const rect=(x:number,y:number,w:number,h:number):Point[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
const leaf:readonly Point[]=[[41,244],[120,145],[231,88],[362,86],[477,141],[559,239],[478,334],[364,393],[231,391],[115,334]]
const crescent:readonly Point[]=[[38,208],[101,132],[210,83],[332,75],[443,100],[532,151],[564,218],[459,181],[352,195],[252,246],[185,321],[150,389],[75,369],[36,300]]
const shell:readonly Point[]=[[76,110],[182,65],[301,48],[417,64],[526,108],[564,215],[534,330],[465,362],[411,406],[352,389],[299,424],[246,388],[186,405],[132,362],[65,330],[35,218]]
const rng=(seed:number,i:number)=>{let n=Math.imul(seed+i*2371,0x45d9f3b);n^=n>>>16;n=Math.imul(n,0x45d9f3b);return(n>>>0)/4294967296}
const rough=(x:number,y:number,rx:number,ry:number,seed:number,n=32):Point[]=>Array.from({length:n},(_,i)=>{const a=i*Math.PI*2/n,f=.92+rng(seed,i)*.08;return[x+rx*f*Math.cos(a),y+ry*f*Math.sin(a)]})
const petal=(x:number,y:number,rx:number,ry:number,n=3):Point[]=>Array.from({length:100},(_,i)=>{const a=-Math.PI/2+i*Math.PI/50,f=.8+.2*Math.cos(n*(a+Math.PI/2));return[x+rx*f*Math.cos(a),y+ry*f*Math.sin(a)]})
function inside(x:number,y:number,v:readonly Point[]):boolean {let hit=false;for(let i=0,j=v.length-1;i<v.length;j=i++){const a=v[i],b=v[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit}return hit}
function texture(v:readonly Point[],m:Material,seed:number,count=80):string {
 const a=['','','',''],xs=v.map(p=>p[0]),ys=v.map(p=>p[1]),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0
 const palette=[colors[m][1],colors[m][2],colors[m][2],colors[m][0]]
 for(let k=0,done=0;k<count*12&&done<count;k++){
  const x=x0+rng(seed,k*4)*w,y=y0+rng(seed,k*4+1)*h,dx=(rng(seed,k*4+2)-.5)*(m==='wood'?77:m==='marble'?49:19),dy=(rng(seed,k*4+3)-.5)*(m==='wood'?5:m==='marble'?21:13)
  if(!inside(x,y,v)||!inside(x+dx,y+dy,v)||!inside(x+dx*.5,y+dy*.5+1,v))continue
  a[done%4]+=`M${nn(x)} ${nn(y)}q${nn(dx*.47)} ${nn(dy*.54+1)} ${nn(dx)} ${nn(dy)}`;done++
 }
 return `<g opacity="${m==='wood'?'.5':'.48'}">${a.map((d,i)=>p(d,'none',palette[i],i===0?1.4:.9)).join('')}</g>`
}
function slab(v:readonly Point[],m:Material='stone',seed=1):string {
 const cx=v.reduce((n,p)=>n+p[0],0)/v.length,cy=v.reduce((n,p)=>n+p[1],0)/v.length,inset=v.map(([x,y])=>[cx+(x-cx)*.93,cy+(y-cy)*.92] as const)
 let body=p(path(v),colors[m][1],colors[m][1],3)+g('translate(-2 -5)',p(path(v),fill(m),colors[m][1],2))+p(path(inset),'none',colors[m][2],2)+texture(inset,m,seed,95)
 if(m==='stone'||m==='marble'||m==='darkstone')body+=v.filter((_,i)=>i%Math.max(1,Math.floor(v.length/6))===0).map(([x,y],i)=>{const [nx,ny]=v[(i*Math.max(1,Math.floor(v.length/6))+1)%v.length];return p(`M${nn(x*.97+cx*.03)} ${nn(y*.97+cy*.03)}l${nn((cx-x)*.055)} ${nn((cy-y)*.055)}l${nn((nx-x)*.04)} ${nn((ny-y)*.04)}`,'none',colors[m][1],1.6)}).join('')
 return body
}
const plate=(x:number,y:number,w:number,h:number,m:Material='stone',seed=1)=>slab(rect(x,y,w,h),m,seed)
const pyramid=(x:number,y:number,rx:number,ry:number,m:Material='stone')=>{const v=rect(x-rx,y-ry,rx*2,ry*2),c=colors[m];return v.map((point,n)=>p(path([[x,y],point,v[(n+1)%4]]),[c[2],c[0],c[1],c[0]][n],c[1],1.6)).join('')+p(`M${x-rx} ${y-ry}L${x} ${y}L${x+rx} ${y+ry}M${x+rx} ${y-ry}L${x} ${y}L${x-rx} ${y+ry}`,'none',c[2],1.1)}
const band=(d:string,m:Material='copper',w=10)=>p(d,'none',colors[m][1],w+3)+p(d,'none',fill(m),w)+p(d,'none',colors[m][2],1)
const rivet=(x:number,y:number,m:Material='copper',s=4)=>e(x,y,s,s*.8,fill(m),colors[m][1],1)+p(`M${x-s*.4} ${y}h${s*.8}`,'none',colors[m][1],.8)
const bowl=(x:number,y:number,rx=39,ry=30,m:Material='copper',content='ash')=>e(x+1,y+3,rx+2,ry+2,colors[m][1],'none',0)+e(x,y,rx,ry,fill(m),colors[m][1],2)+e(x,y,rx*.78,ry*.76,content==='water'?'#72968D':content==='grain'?'#AA9469':content==='empty'?colors[m][0]:'#65695B',colors[m][2],1.6)+(content==='grain'?rep(19,i=>e(x-25+rng(51,i*2)*50,y-17+rng(51,i*2+1)*34,2.5,1.6,'#CBB882','#8F835D',.5)):content==='ash'?p(`M${x-rx*.42} ${y+ry*.2}q${rx*.35} ${-ry*.55} ${rx*.85} 0`,'none','#A5A38C',2):'')
const candle=(x:number,y:number,s=1)=>g(`translate(${x} ${y}) scale(${s})`,bowl(0,0,17,13,'brass','empty')+e(0,0,10,8,'#D4C39A','#9C916F',1.2)+p('M-2-2l3 2','none','#514F42',2)+p('M-8 3q3 6 8 4','none','#E3D5AF',2))
const dish=(x:number,y:number,s=1,m:Material='ceramic')=>g(`translate(${x} ${y}) scale(${s})`,bowl(0,0,51,38,m,'empty')+e(0,0,36,25,'none',colors[m][2],1.4))
function cloth(x:number,y:number,w:number,h:number,m:Material='cloth',seed=1):string {
 return p(`M${x} ${y+3}Q${x+w*.24} ${y-9} ${x+w*.5} ${y+1}T${x+w} ${y+3}L${x+w-5} ${y+h-3}Q${x+w*.76} ${y+h+10} ${x+w*.5} ${y+h-1}T${x+4} ${y+h-2}Z`,fill(m),colors[m][1],1.8)+texture(rect(x+9,y+10,w-18,h-20),m,seed,37)+p(`M${x+13} ${y+7}q${w*.1} ${h*.41} 0 ${h-17}M${x+w-16} ${y+7}q${-w*.08} ${h*.5} 0 ${h-17}`,'none',colors[m][2],2.6)
}
function mark(x:number,y:number,size=25,m:Material='copper',index=0):string {
 const symbols=['M-19 0H19M0-14v28M-12-8l24 16','M-17-12L17 12M-17 12L17-12M0-17v7m0 20v7','M-18 7l9-19h18l9 19M-8 7v8m16-8v8','M-17 0a17 12 0 1 0 34 0M0-15v30','M-18-11h11v22H7v-22h11','M-18 8L0-12 18 8M-10 4v11m20-11v11']
 return g(`translate(${x} ${y}) scale(${size/25})`,p(symbols[index%symbols.length],'none',colors[m][1],3.2)+p(symbols[index%symbols.length],'none',colors[m][2],1.4))
}
const leafBlade=(x:number,y:number,a:number,len=45,w=15)=>g(`translate(${x} ${y}) rotate(${a})`,p(`M0 0Q${-w} ${-len*.6} 0 ${-len}Q${w} ${-len*.6} 0 0Z`,'#778865','#4B6652',1.1)+p(`M0-2v${-len+8}`,'none','#B8BE8E',1))
const herb=(x:number,y:number,seed=1,s=1)=>g(`translate(${x} ${y}) scale(${s})`,rep(7,i=>leafBlade(0,0,i*51+seed*13,36+rng(seed,i)*28,11+rng(seed,i+10)*8))+band('M-11 3h22','wood',3))
const flowers=(x:number,y:number,s=1)=>g(`translate(${x} ${y}) scale(${s})`,herb(0,4,7,.9)+rep(5,i=>{const a=i*2.4,xx=25*Math.cos(a),yy=22*Math.sin(a);return p(path(petal(xx,yy,12,10,5)),'#BDA780','#726F54',1)+e(xx,yy,3,2.3,'#D9C59B','#8D8768',.7)}))
const handle=(x:number,y:number,a=0)=>g(`translate(${x} ${y}) rotate(${a})`,band('M-15 0v-12q15-13 30 0v12','copper',5))
function crystal(x:number,y:number,rx=37,ry=40,seed=1):string {
 const v=polygon(x,y,rx,ry,5,seed*.17),tip:[number,number]=[x-rx*.1,y-ry*.17]
 return p(path(v),'#73A09B','#406E6B',2)+v.map(([xx,yy],i)=>p(path([tip,[xx,yy],v[(i+1)%v.length]]),['#B8D2C2','#8FB8AC','#6B9996','#D2E2CD','#5F8A88'][i%5],'#5A8580',.9)).join('')+p(`M${x-rx*.25} ${y-ry*.45}l${rx*.14} ${ry*.62}`,'none','#E2EEDD',2)
}
const bottle=(x:number,y:number,rx=24,ry=22,m:Material='glass',seed=1)=>e(x+1,y+2,rx+2,ry+2,'#52665B','none',0)+e(x,y,rx,ry,fill(m),colors[m][1],1.8)+e(x,y,rx*.72,ry*.72,m==='glass'?['#80986C','#9E9076','#6C938E'][seed%3]:colors[m][0],'none',0)+e(x-2,y-2,rx*.29,ry*.3,fill('ceramic'),'#74755E',1)+p(`M${x-rx*.53} ${y-ry*.34}q${rx*.3} ${-ry*.4} ${rx*.63} ${-ry*.13}`,'none',colors[m][2],2)+rivet(x-2,y-2,'wood',3)
function book(x:number,y:number,w=100,h=76,open=true,seed=1):string {
 const edge=plate(x-3,y-2,w+6,h+6,'wood',seed)
 if(!open)return edge+cloth(x+3,y+3,w-6,h-6,'cloth',seed)+band(`M${x+w*.17} ${y+7}v${h-14}M${x+w*.78} ${y+h*.12}h${w*.21}m${-w*.21} ${h*.69}h${w*.21}`,'brass',4)+mark(x+w*.5,y+h*.5,w*.21,'brass',seed)
 return edge+p(`M${x} ${y+3}Q${x+w*.25} ${y-11} ${x+w*.5} ${y+6}Q${x+w*.75} ${y-11} ${x+w} ${y+3}V${y+h-3}Q${x+w*.75} ${y+h-13} ${x+w*.5} ${y+h}Q${x+w*.25} ${y+h-13} ${x} ${y+h-3}Z`,fill('paper'),'#8F7F5C',1.4)+p(`M${x+w*.5} ${y+6}v${h-7}`,'none','#99845D',2.3)+rep(7,i=>p(`M${x+9} ${y+13+i*(h-23)/7}q${w*.14} -4 ${w*.33-rng(seed,i)*8} 0M${x+w*.58} ${y+13+i*(h-23)/7}q${w*.13} -4 ${w*.32-rng(seed+1,i)*8} 0`,'none',i%3?'#897B5C':'#9F6F57',1.1))
}

function altar(i:number):string {
 const cups=(xs:number[],y=240)=>xs.map((x,k)=>bowl(x,y,34,27,k%2?'ceramic':'copper','empty')).join('')
 switch(i){
  case 0:return slab(rough(300,240,244,162,10),'stone',10)+bowl(280,222,55,41,'stone','ash')+mark(416,255,27,'copper',0)+candle(148,240)
  case 1:return plate(46,83,508,322,'darkstone',12)+plate(61,99,478,285,'stone',13)+p('M75 171h450M75 304h450M180 105v62M393 175v123M213 307v69','none','#71806D',2)+cups([183,415])+mark(300,237,32)
  case 2:return plate(35,116,116,258,'stone',16)+plate(449,116,116,258,'stone',17)+plate(73,76,454,322,'marble',18)+cups([211,388],245)+band('M117 92v288M481 92v288','copper',7)
  case 3:return slab(rough(117,286,77,120,21),'darkstone',21)+slab(rough(486,283,76,121,22),'darkstone',22)+slab(rough(305,111,102,62,23),'darkstone',23)+slab(rough(300,237,238,161,24),'stone',24)+bowl(314,236,70,52,'copper')+mark(150,242,25,'copper',1)
  case 4:return slab([[131,58],[469,58],[548,136],[519,403],[82,403],[54,137]],'stone',27)+slab([[156,85],[442,85],[509,149],[482,371],[117,371],[92,148]],'marble',28)+band('M300 100v253','copper',10)+cups([165,435],245)
  case 5:return rep(3,n=>g(`rotate(${n*120} 300 240)`,plate(251,39,98,86,'stone',31+n)))+slab(oval(300,240,217,171),'stone',30)+bowl(300,240,140,108,'copper')+rep(8,n=>{const a=n*Math.PI/4;return mark(300+180*Math.cos(a),240+141*Math.sin(a),16,'copper',n)})
  case 6:return plate(36,125,527,257,'wood',35)+plate(61,77,478,323,'wood',36)+p('M75 173h451M75 304h451','none','#594832',3)+cloth(151,86,299,309,'paper',37)+cups([224,378],237)+candle(103,241)+candle(497,241)
  case 7:return rep(3,n=>g(`rotate(${n*120} 300 240)`,band('M300 240V40','copper',25)+rivet(300,54,'brass',8)))+bowl(300,240,218,170,'copper')+texture(oval(300,240,191,145),'darkstone',39,85)+rep(13,n=>{const a=n*Math.PI*2/13;return rivet(300+203*Math.cos(a),240+157*Math.sin(a),'brass',4)})
  case 8:return band('M97 300Q265 147 509 298M111 174Q279 349 493 173','wood',18)+slab(leaf,'marble',43)+bowl(340,235,63,48,'stone','empty')+p('M84 243Q294 176 522 242','none','#8A9A75',7)+mark(187,245,24,'copper',2)
  case 9:return plate(55,110,490,270,'darkstone',46)+slab([[147,49],[453,49],[554,144],[554,335],[453,431],[147,431],[46,335],[46,144]],'stone',47)+band('M102 124H498M102 355H498','copper',19)+rep(6,n=>{const a=n*Math.PI/3;return rivet(300+204*Math.cos(a),240+165*Math.sin(a),'brass',8)})+mark(300,239,46,'copper',4)
  case 10:return slab([[44,123],[143,68],[288,83],[267,180],[304,239],[268,326],[281,394],[131,409],[38,333]],'darkstone',50)+slab([[322,72],[458,81],[555,150],[550,347],[429,410],[310,389],[323,303],[297,243],[332,161]],'stone',51)+band('M246 239h104','copper',24)+bowl(154,244,48,38,'copper')+bowl(445,243,48,38,'copper')
  case 11:return rep(6,n=>{const a=n*Math.PI/3;return band(`M300 240Q${300+120*Math.cos(a+.4)} ${240+120*Math.sin(a+.4)} ${300+263*Math.cos(a)} ${240+189*Math.sin(a)}`,'wood',25)})+slab(rough(300,240,231,159,54),'wood',54)+p('M159 233q56-115 182-65t65 111t-154 35t-43-97','none','#B69A70',4)+herb(451,290,3)+bowl(230,242,49,36,'ceramic')
  case 12:return slab(crescent,'marble',57)+bowl(207,235,44,32,'copper','empty')+mark(381,130,26,'copper',3)+candle(110,289)
  case 13:return slab(shell,'stone',60)+p('M300 377Q108 206 257 141Q417 87 446 226Q454 314 329 304Q254 284 290 230','none','#6C7B68',7)+p('M300 377Q108 206 257 141','none','#C9C7A4',2)+bowl(335,235,39,29,'copper','empty')
  case 14:return band('M64 82L539 399M541 85L68 402','bone',22)+slab([[73,128],[189,76],[301,107],[429,71],[533,134],[511,258],[545,355],[418,412],[299,382],[164,414],[55,337]],'cloth',64)+band('M89 142l31 17M495 145l-31 15M110 365l28-13M482 367l-32-12','paper',5)+cups([197,403],241)
  case 15:return slab(petal(300,240,241,190,4),'stone',67)+plate(243,193,114,93,'darkstone',68)+bowl(300,130,38,28,'copper')+bowl(164,240,38,28,'copper')+bowl(436,240,38,28,'copper')+bowl(300,350,38,28,'copper')
  case 16:return plate(36,124,117,245,'marble',71)+plate(447,124,117,245,'marble',72)+plate(60,77,480,328,'marble',73)+band('M91 98v284M511 98v284','brass',4)+cloth(187,98,226,284,'paper',74)+bowl(300,240,51,38,'brass','empty')
  case 17:return plate(50,126,500,267,'darkstone',76)+plate(79,97,442,285,'stone',77)+slab([[137,64],[463,64],[532,130],[532,350],[463,416],[137,416],[68,350],[68,130]],'marble',78)+band('M140 128h319M140 352h319','brass',6)+mark(300,240,49,'brass',4)
  case 18:return handle(53,241,-90)+handle(547,241,90)+plate(47,83,506,315,'wood',81)+band('M181 95v289M419 95v289','copper',8)+r(278,97,45,47,fill('copper'),4)+r(278,337,45,47,fill('copper'),4)+cloth(203,155,193,166,'paper',82)+bowl(300,239,44,32,'ceramic','empty')
  case 19:return plate(59,70,482,340,'darkstone',85)+plate(80,92,440,297,'stone',86)+bowl(366,228,112,89,'copper')+r(110,307,377,55,'#65765E',5)+rep(5,n=>flowers(145+n*76,334,.56))
  case 20:return plate(42,87,516,311,'marble',89)+bowl(163,241,92,73,'copper')+bowl(437,241,92,73,'copper')+plate(255,204,90,74,'marble',90)+mark(300,241,23,'copper',5)
  case 21:return plate(52,83,496,321,'wood',93)+cloth(65,92,470,303,'cloth',94)+p('M101 104q12 141 0 279M491 104q-14 141 0 279','none','#A6756D',5)+bowl(300,240,61,44,'brass','empty')+candle(130,241,1.6)+candle(470,241,1.6)
  case 22:return slab([[45,72],[553,72],[553,229],[288,229],[288,412],[45,412]],'marble',97)+band('M71 95H530V207H266V389H70Z','brass',4)+bowl(177,171,59,44,'brass','empty')+candle(452,151,1.3)+candle(169,331,1.3)
  case 23:return slab(oval(300,240,238,190),'darkstone',100)+slab(oval(300,240,218,171),'marble',101)+rep(4,n=>g(`rotate(${n*90} 300 240)`,plate(271,54,58,61,'brass',102+n)))+bowl(325,225,73,56,'copper','empty')+mark(179,255,25,'copper',2)
  default:throw new Error('未知祭坛构造。')
 }
}

/** Crown/hood/hair top, shoulders and projected hands: no face or front-view portrait. */
function figure(x:number,y:number,s=1,pose=0,m:Material='stone'):string {
 const c=colors[m]
 let body=p('M-56-19Q-94 14-82 87Q-38 125 0 113Q40 126 83 87Q94 10 55-20Z',fill(m),c[1],2.3)+texture([[-55,-16],[-78,84],[0,108],[78,84],[55,-16]],m,130+pose,31)+p('M-38 31q-13 39 7 62M28 33q17 40-2 64M-5 51l8 46','none',c[1],2.5)
 if(pose===3)body+=p('M-59-16Q0-91 60-15L38 56Q0 37-40 56Z',fill(m),c[1],3)+p('M-38-2Q0-58 38-2','none',c[2],4)
 else body+=e(0,-13,42,37,fill(m),c[1],2.5)+p('M-28-22q22-23 48-1M-23-6q22-17 46-2M-5-39q-11 15 1 31','none',c[2],2.2)
 if(pose===2||pose===8)body+=pose===2?band('M-35-34l10-18 13 8 13-15 13 15 13-8 12 18','brass',7):p('M-29-34Q-85-98-71-23M28-34Q85-98 71-23','none',c[1],15)+p('M-29-34Q-85-98-71-23M28-34Q85-98 71-23','none',c[2],10)
 if(pose===9)body+=p('M-67 0Q-125-19-146 34L-111 64M67 0Q125-19 146 34L111 64','none',c[1],25)+p('M-67 0Q-125-19-146 34L-111 64M67 0Q125-19 146 34L111 64','none',c[0],21)+e(-110,64,18,13,fill(m),c[1],1.7)+e(110,64,18,13,fill(m),c[1],1.7)
 if(pose===7)body=p('M-58-12Q-146-78-203-37L-177 48-138 62-98 49-52 18M58-12Q146-78 203-37L177 48 138 62 98 49 52 18',fill(m),c[1],3)+rep(6,n=>p(`M${-176+n*20} ${-32+n*4}l23 69M${176-n*20} ${-32+n*4}l-23 69`,'none',c[2],3))+body
 if(pose===1)body+=p('M-62 15Q-83 76-34 90M62 15Q83 76 34 90','none',c[1],27)+p('M-62 15Q-83 76-34 90M62 15Q83 76 34 90','none',c[0],22)+book(-54,70,108,66,true,4)+e(-48,83,16,11,fill(m),c[1],1.5)+e(48,83,16,11,fill(m),c[1],1.5)
 else if(pose===4)body+=p('M-64 9Q-115 20-125 76M63 13Q78 64 20 70','none',c[1],25)+p('M-64 9Q-115 20-125 76M63 13Q78 64 20 70','none',c[0],20)+bowl(-126,91,27,22,'brass','empty')+band('M-143 92v-37h34v37','copper',3)+e(20,70,16,12,fill(m),c[1],1.5)
 else if(pose===6)body+=band('M111-102V132','wood',7)+p('M-56 9Q-70 69-22 85M57 9Q91 34 110 30','none',c[1],25)+p('M-56 9Q-70 69-22 85M57 9Q91 34 110 30','none',c[0],21)+e(109,30,17,12,fill(m),c[1],1.5)+e(-20,85,17,12,fill(m),c[1],1.5)
 else if(pose===5)body+=e(-38,109,32,32,fill(m),c[1],2)+e(38,109,32,32,fill(m),c[1],2)+p('M-67 11v73M67 11v73','none',c[1],25)+p('M-67 11v73M67 11v73','none',c[2],13)
 else body+=p('M-63 8Q-87 53-16 66M63 8Q87 53 16 66','none',c[1],25)+p('M-63 8Q-87 53-16 66M63 8Q87 53 16 66','none',c[0],20)+e(-10,66,18,11,fill(m),c[1],1.5)+e(10,66,18,11,fill(m),c[1],1.5)
 return g(`translate(${x} ${y}) scale(${s})`,body)
}
function statue(i:number):string {
 const base=(m:Material='stone',seed=110,round=false)=>slab(round?oval(300,240,231,181):[[112,58],[488,58],[548,115],[548,366],[488,422],[112,422],[52,366],[52,115]],m,seed)
 switch(i){
  case 0:return base('stone',110)+plate(173,100,254,282,'darkstone',111)+figure(300,194,1.1,0)
  case 1:return base('marble',112)+figure(300,187,1.18,1,'marble')
  case 2:return base('darkstone',114,true)+figure(300,196,1.26,2,'stone')+band('M192 390h216','brass',6)
  case 3:return base('stone',116,true)+figure(300,199,1.23,3,'darkstone')
  case 4:return plate(63,85,475,321,'stone',118)+figure(322,195,1.1,4,'stone')
  case 5:return base('marble',120)+plate(177,102,247,253,'darkstone',121)+plate(166,93,270,42,'stone',122)+plate(167,142,35,189,'stone',123)+plate(399,142,35,189,'stone',124)+figure(300,194,1.12,5,'stone')
  case 6:return base('stone',125)+figure(285,187,1.13,6,'stone')
  case 7:return base('marble',127)+figure(300,209,1.01,7,'marble')
  case 8:return base('darkstone',129)+figure(300,204,1.15,8,'stone')+mark(300,369,29,'copper',1)
  case 9:return base('stone',131)+figure(300,190,1.12,9,'darkstone')+band('M174 377h252','copper',6)
  case 10:return slab(leaf,'wood',133)+rep(8,n=>leafBlade(300,154,n*45,73,19))+figure(300,208,1.07,0,'wood')+herb(146,269,5,.8)
  case 11:return base('darkstone',135)+figure(300,190,1.12,2,'copper')+plate(229,284,145,40,'copper',136)+band('M302 272v92','wood',8)
  case 12:return base('stone',138,true)+p('M401 313Q247 418 142 286Q89 186 202 120Q344 60 459 172Q501 236 433 269Q344 286 288 235','none','#4B5D51',62)+p('M401 313Q247 418 142 286Q89 186 202 120Q344 60 459 172Q501 236 433 269Q344 286 288 235','none',fill('stone'),54)+p('M218 147Q292 180 340 265L237 278 159 222Z',fill('darkstone'),'#4A5D51',2)+p('M218 147l19 131M192 176l67 85M172 202l99 41','none','#A9AF95',3)+slab([[369,142],[427,122],[467,153],[452,204],[390,212],[355,186]],'stone',139)+p('M418 164l42 9M413 176l41 9','none','#C8C7AA',3)+rep(7,n=>g(`rotate(${n*27-35} 300 240)`,p('M300 119l-13-22 26 1Z','#8A947F','#586B5A',1.5)))
  case 13:return base('marble',141,true)+slab(oval(317,265,143,101),'stone',142)+p('M386 326Q221 411 159 287Q124 218 200 183','none','#5A6B5D',28)+p('M386 326Q221 411 159 287Q124 218 200 183','none','#9CA48F',23)+e(246,180,65,54,fill('stone'),'#5C6B5B',2)+p('M197 155l-9-50 48 31M265 135l39-36-3 57',fill('stone'),'#5C6B5B',2)+e(205,293,37,24,fill('marble'))+e(259,317,38,22,fill('marble'))+p('M301 218q31 43 94 43','none','#C4C9AB',3)
  case 14:return plate(42,86,516,321,'stone',144)+slab(oval(330,249,158,93),'darkstone',145)+p('M196 214Q179 179 223 139L321 134 350 172 291 212Z',fill('stone'),'#536557',2)+p('M224 146l-20-49 53 37M283 135l27-42 8 60',fill('stone'),'#536557',2)+p('M197 287L82 318M246 312L130 358M454 273q71 38 65 80','none','#536557',29)+p('M197 287L82 318M246 312L130 358M454 273q71 38 65 80','none','#A2AA94',24)+p('M245 151l57 15M257 161l41 13','none','#CDD0B4',3)
  case 15:return base('darkstone',147,true)+p('M433 299C241 439 95 260 194 145S486 119 450 234 230 356 217 235 384 136 397 237','none','#4C6558',52)+p('M433 299C241 439 95 260 194 145S486 119 450 234 230 356 217 235 384 136 397 237','none',fill('stone'),44)+slab([[373,223],[403,191],[440,209],[460,248],[420,271],[381,255]],'stone',148)+p('M204 153l28 13M163 204l30 7M179 273l29-8M258 330l4-28M357 321l-7-27M437 172l-27 8M337 115v29','none','#CED0B2',3)
  case 16:return base('marble',150)+figure(300,190,1.15,3,'marble')+flowers(300,296,1.2)
  case 17:return base('darkstone',152)+figure(287,199,1.07,6,'copper')+e(287,185,47,36,fill('copper'),'#4E6658',2)+p('M252 181q32-23 67 0','none','#C8B385',3)
  case 18:return plate(118,94,365,294,'darkstone',155)+p('M174 290Q166 218 217 207L381 207Q434 221 426 290L391 331H209Z',fill('marble'),'#68796B',2)+e(300,202,64,57,fill('marble'),'#68796B',2)+p('M254 181q45-33 89 3M267 198q31-20 62 1','none','#ECE6CB',3)+texture(oval(300,202,56,49),'marble',156,28)
  case 19:return base('marble',158)+e(300,238,139,117,fill('stone'),'#657565',3)+handle(165,240,-90)+handle(435,240,90)+e(300,225,88,73,fill('marble'),'#89927A',2)+cloth(280,102,128,265,'paper',159)+e(288,220,28,23,fill('stone'))
  case 20:return plate(61,98,477,302,'darkstone',162)+slab([[103,289],[190,114],[246,86],[299,112],[238,320],[190,357]],'marble',163)+slab([[211,328],[312,141],[371,127],[416,158],[349,350],[287,372]],'stone',164)+slab([[342,342],[444,188],[488,193],[511,231],[447,362],[387,379]],'copper',165)
  case 21:return base('stone',167,true)+band('M109 291Q301 345 503 270','wood',20)+slab(oval(300,237,106,121),'marble',168)+p('M294 136Q379 181 378 282L310 347 277 298Z',fill('stone'),'#667766',2)+p('M308 162l49 99M300 193l53 92M304 227l29 62','none','#C8CDB0',3)+e(282,135,43,37,fill('marble'),'#68796C',2)+p('M244 133l-48 13 49 9Z',fill('copper'),'#657461',1.5)
  case 22:return base('darkstone',170)+plate(213,92,174,139,'stone',171)+pyramid(300,161,74,58,'marble')+figure(300,290,.68,0,'marble')
  case 23:return plate(38,81,524,325,'stone',173)+g('rotate(-13 206 220)',figure(206,203,.87,0,'marble'))+g('rotate(17 394 220)',figure(394,203,.87,1,'stone'))
  default:throw new Error('未知雕塑构造。')
 }
}

function sarcophagus(i:number):string {
 const taper:readonly Point[]=[[149,51],[451,51],[526,125],[487,419],[112,419],[74,125]]
 const box:readonly Point[]=[[91,50],[509,50],[535,76],[535,407],[509,431],[91,431],[66,407],[66,76]]
 const seam=(v:readonly Point[])=>p(path(v),'none','#424F46',6)+p(path(v),'none','#CDC8AA',1.1)
 const rings=(xs=[91,509],ys=[145,330])=>xs.map(x=>ys.map(y=>handle(x,y,x<300?-90:90)).join('')).join('')
 const lid=(v:readonly Point[],m:Material='stone',seed=180)=>slab(v,m,seed)+seam(v.map(([x,y])=>[300+(x-300)*.86,240+(y-240)*.88]))
 switch(i){
  case 0:return lid(taper,'stone',180)+rings([85,515])+mark(300,192,32,'copper',1)
  case 1:return lid(box,'marble',182)+[[105,91],[495,91],[105,389],[495,389]].map(([x,y])=>rivet(x,y,'copper',8)).join('')+mark(300,240,35,'copper',4)
  case 2:return lid(box,'stone',184)+p('M105 91L300 66 496 91V390L300 417 105 390Z',fill('stone'),'#647561',2)+band('M300 68v347','stone',12)+p('M119 112L284 90M321 393l151-20','none','#D2D0B2',2.5)+rings()
  case 3:return lid(box,'darkstone',186)+slab(oval(300,240,187,177),'stone',187)+band('M119 157h362M119 323h362','copper',16)+texture(oval(300,240,171,160),'stone',188,65)
  case 4:return lid(taper,'marble',190)+g('translate(300 218) scale(1.03 .94)',p('M-54-27Q-79 9-67 48L-73 147Q0 174 73 147L67 48Q79 9 54-27Z',fill('stone'),'#697666',2)+p('M-31 68l-13 79M-10 77v76M17 76l9 77M39 69l14 79','none','#A8AE94',3)+e(0,-29,35,31,fill('stone'),'#697666',2)+p('M-24-38q21-17 43 0','none','#D4D5B8',2)+band('M-51 13Q-54 60-8 60M51 13Q54 60 8 60','stone',16)+e(0,60,20,11,fill('stone')))
  case 5:return plate(42,48,516,384,'darkstone',193)+lid([[65,76],[280,76],[280,408],[65,408]],'stone',194)+lid([[321,76],[535,76],[535,408],[321,408]],'marble',195)+band('M300 66v352','copper',7)+mark(175,240,26,'copper',0)+mark(427,240,26,'copper',2)
  case 6:return lid(taper,'darkstone',197)+band('M133 88L467 387M465 88L133 387','copper',17)+e(300,240,26,21,'#9D775C','#615D47',2)+mark(300,240,18,'brass',3)
  case 7:return slab(rough(300,240,250,197,200),'darkstone',200)+lid([[146,76],[443,62],[514,124],[472,401],[129,418],[79,139]],'stone',201)+p('M115 143l34 36-12 43M446 359l-22-36 8-29','none','#5F705F',2.3)
  case 8:return lid([[297,39],[433,96],[502,194],[473,331],[393,410],[300,441],[202,410],[123,331],[96,194],[162,96]],'marble',204)+p('M300 63Q218 236 300 418M300 127l-104 74M300 127l104 74M282 268l-91 49M282 268l115 49','none','#8B9B7D',6)+rings([117,483])
  case 9:return lid([[153,49],[447,49],[538,124],[538,357],[447,430],[153,430],[62,357],[62,124]],'darkstone',207)+band('M104 147h392M104 331h392','copper',24)+rep(4,n=>rivet(n%2?483:117,n<2?147:331,'brass',9))+mark(300,239,39,'copper',4)
  case 10:return lid(taper,'darkstone',210)+p('M296 71l-20 71 32 74-26 64 19 90-15 37','none','#334E49',8)+crystal(280,128,28,38,1)+crystal(322,198,36,43,2)+crystal(272,307,22,31,3)+p('M144 178l29 4-8 24M438 338l-23-9 4-20','none','#BBC5A8',2)
  case 11:return lid([[138,69],[302,41],[465,67],[521,148],[498,360],[427,418],[170,417],[88,346],[76,153]],'wood',213)+band('M86 121Q111 239 103 389M493 111Q469 247 510 382','wood',30)+p('M187 113q182-43 236 89t-78 160t-141-93t93-96','none','#C0A57E',4)
  case 12:return lid([[173,48],[332,54],[467,123],[517,248],[460,373],[344,435],[171,415],[241,347],[288,253],[260,159]],'marble',216)+p('M213 83Q494 239 225 388','none','#A6B09A',8)+band('M341 117l29 28M373 351l-25 23','copper',12)+mark(409,239,28,'copper',3)
  case 13:return lid([[300,44],[443,77],[519,160],[536,294],[461,389],[358,432],[243,432],[137,389],[63,294],[81,160],[159,77]],'marble',219)+p(rep(7,n=>`M300 394Q${111+n*63} 236 ${124+n*58} 107`),'none','#8E9E87',4)+e(300,397,32,22,fill('ceramic'),'#8E9A7C',2)
  case 14:return lid(taper,'stone',222)+rep(3,n=>band(`M101 ${128+n*104}q44-28 70-1M499 ${128+n*104}q-44-28-70-1`,'bone',23))+band('M141 131L462 362M462 131L141 362','wood',5)+mark(300,240,31,'copper',1)
  case 15:return slab([[138,42],[462,42],[552,129],[552,353],[462,437],[138,437],[47,353],[47,129]],'darkstone',225)+lid([[169,74],[431,74],[508,145],[508,335],[431,406],[169,406],[92,335],[92,145]],'marble',226)+slab([[205,113],[395,113],[446,164],[446,315],[395,367],[205,367],[154,315],[154,164]],'stone',227)+mark(300,240,42,'copper',5)
  case 16:return lid(box,'marble',229)+plate(118,100,364,100,'marble',230)+plate(118,220,364,158,'marble',231)+r(167,385,266,29,'#657B62',4)+rep(4,n=>flowers(199+n*67,399,.47))
  case 17:return slab(box,'darkstone',233)+lid([[161,64],[439,64],[511,131],[483,409],[117,409],[89,131]],'stone',234)+band('M167 108H433M139 372h322','brass',9)+mark(300,241,40,'brass',4)
  case 18:return plate(40,47,520,388,'darkstone',236)+[58,225,392].map((x,n)=>lid([[x,76],[x+150,76],[x+150,407],[x,407]],n%2?'marble':'stone',237+n)+mark(x+75,220,22,'copper',n)).join('')+handle(122,414)+handle(475,414)
  case 19:return lid(box,'copper',241)+band('M93 151h414M93 329h414','brass',15)+rep(12,n=>rivet(n%2?500:100,91+Math.floor(n/2)*58,'brass',4))+p('M121 116l32-11M453 372l-29 6M149 355l21-13','none','#547F6B',5)+mark(300,240,32,'brass',0)
  case 20:return slab(rough(300,240,251,199,244),'darkstone',244)+lid(box,'stone',245)+p('M103 81h392v318H103Z','none','#53695B',4)+p('M115 93h369','none','#C6CAAC',2)
  case 21:return lid(box,'marble',247)+rep(12,n=>{const a=n*Math.PI/6;return leafBlade(300+68*Math.cos(a),140+49*Math.sin(a),n*30+60,43,13)})+r(152,324,296,65,fill('stone'),6)+flowers(224,354,.8)+flowers(302,354,.8)+flowers(381,354,.8)
  case 22:return plate(52,46,496,389,'darkstone',250)+lid(box,'marble',251)+plate(171,167,258,146,'copper',252)+mark(300,240,34,'brass',5)+band('M91 90v300M509 90v300','brass',4)
  case 23:return lid(box,'stone',254)+[[83,82],[515,82],[83,397],[515,397]].map(([x,y])=>plate(x-22,y-18,44,36,'marble',255)).join('')+p('M107 92L300 56 493 92V389L300 424 107 389Z',fill('marble'),'#7F8D78',2)+band('M300 58v363','stone',14)+p('M125 112L283 87M321 396l150-24','none','#ECE6CB',3)
  default:throw new Error('未知石棺构造。')
 }
}

function headstone(i:number):string {
 const thin=(x:number,y:number,w:number,h=45,m:Material='stone',seed=260)=>plate(x,y,w,h,m,seed)+p(`M${x+9} ${y+8}h${w-18}`,'none',colors[m][2],2)
 switch(i){
  case 0:return slab(rough(300,260,240,150,260),'stone',260)+thin(104,174,392,67,'darkstone',261)+herb(448,336,4,.8)
  case 1:return slab(oval(300,266,237,155),'marble',263)+slab([[103,218],[121,174],[164,161],[437,161],[479,174],[497,218]],'stone',264)+p('M133 178h330','none','#D0CFB1',3)
  case 2:return slab([[210,75],[390,75],[390,170],[541,170],[541,303],[390,303],[390,405],[210,405],[210,303],[59,303],[59,170],[210,170]],'stone',266)+thin(93,211,414,54,'marble',267)
  case 3:return plate(83,70,434,340,'darkstone',269)+slab(oval(300,240,171,135),'stone',270)+e(300,240,142,111,'none','#C8C7AB',4)+mark(300,240,38,'copper',2)
  case 4:return slab(rough(155,284,112,87,272),'darkstone',272)+slab(rough(397,305,151,103,273),'stone',273)+slab(rough(234,170,145,103,274),'stone',274)+slab(rough(380,192,119,86,275),'marble',275)+slab(rough(293,236,104,81,276),'stone',276)+mark(289,237,31,'copper',3)
  case 5:return slab(rough(300,267,247,138,278),'darkstone',278)+plate(89,163,422,102,'wood',279)+e(123,214,42,33,fill('wood'),'#554733',2)+e(477,214,42,33,fill('wood'),'#554733',2)+e(123,214,25,19,'none','#C4AA7A',2)+e(477,214,25,19,'none','#C4AA7A',2)+band('M163 215h274','wood',18)
  case 6:return plate(79,48,442,388,'stone',281)+plate(107,74,386,335,'marble',282)+mark(300,147,43,'copper',1)+rep(6,n=>p(`M161 ${219+n*23}h${267-(n%2)*34}`,'none','#8B947E',2))+[[133,102],[468,102],[133,384],[468,384]].map(([x,y])=>mark(x,y,13,'copper',narrow(x))).join('')
  case 7:return plate(49,124,502,254,'darkstone',284)+slab([[82,222],[300,153],[518,222],[518,281],[300,211],[82,281]],'stone',285)+band('M300 155v58','stone',10)+plate(66,203,40,100,'marble',286)+plate(495,203,40,100,'marble',287)
  case 8:return slab(leaf,'marble',289)+slab([[142,250],[225,201],[381,201],[462,250],[382,274],[225,274]],'stone',290)+band('M182 249Q300 216 421 249','copper',7)+herb(471,290,4,.65)
  case 9:return slab(polygon(300,240,236,187,6),'darkstone',292)+slab(polygon(300,240,174,137,6),'stone',293)+mark(300,240,52,'copper',4)+p('M180 189l32 13M420 294l-32-13','none','#CCD0AF',4)
  case 10:return rep(6,n=>{const a=n*Math.PI/3;return band(`M300 240Q${300+148*Math.cos(a+.3)} ${240+117*Math.sin(a+.3)} ${300+258*Math.cos(a)} ${240+194*Math.sin(a)}`,'wood',33)})+slab(rough(300,240,168,128,296),'wood',296)+p('M185 228q49-89 150-53t64 96t-137 24t-22-63','none','#C7A97C',4)+p('M300 122l-19 77 18 34','none','#514A35',5)
  case 11:return slab(oval(300,270,244,130),'darkstone',299)+thin(183,211,234,55,'stone',300)+p('M200 227Q82 200 90 83M400 227Q518 200 510 83','none','#7A7E63',33)+p('M200 227Q82 200 90 83M400 227Q518 200 510 83','none',fill('bone'),26)+p('M119 127l-17 3M481 127l17 3','none','#E1D4AF',3)
  case 12:return slab(crescent,'stone',302)+slab([[91,209],[149,158],[234,133],[355,123],[455,143],[497,173],[403,153],[308,153],[215,178],[143,221]],'marble',303)+band('M150 179Q304 114 455 155','copper',4)
  case 13:return slab(rough(300,248,234,174,305),'darkstone',305)+crystal(250,213,87,83,1)+crystal(380,280,67,62,2)+crystal(173,306,45,44,3)+crystal(423,163,28,25,4)
  case 14:return slab(shell,'stone',308)+slab([[108,225],[168,192],[300,176],[432,192],[492,225],[431,251],[300,235],[169,251]],'marble',309)+p('M165 214l34-8M246 200l35-4M325 196l35 4M403 207l32 8','none','#D4D3B6',3)
  case 15:return plate(46,112,507,291,'darkstone',311)+plate(107,80,396,264,'stone',312)+plate(185,63,267,218,'marble',313)+mark(318,178,35,'copper',5)
  case 16:return plate(40,118,520,283,'darkstone',315)+thin(82,172,438,76,'marble',316)+bottle(444,325,35,29,'copper')+flowers(442,323,.68)
  case 17:return slab([[72,155],[143,155],[143,112],[233,112],[233,75],[367,75],[367,112],[458,112],[458,155],[529,155],[529,363],[72,363]],'darkstone',318)+thin(108,199,384,63,'stone',319)+band('M177 210h246','brass',5)+mark(300,303,27,'brass',4)
  case 18:return plate(63,51,474,380,'darkstone',321)+plate(145,116,310,248,'stone',322)+pyramid(300,240,125,100,'marble')
  case 19:return plate(48,101,504,305,'darkstone',324)+handle(157,241,-90)+handle(443,241,90)+e(300,240,146,111,fill('stone'),'#647663',2)+e(300,231,102,78,fill('marble'),'#8A967E',2)+e(300,230,32,25,fill('stone'),'#71826A',1.8)+p('M203 229q75-73 168-15','none','#D2D4B6',2.5)
  case 20:return plate(41,105,518,303,'darkstone',326)+thin(70,180,201,61,'stone',327)+thin(328,180,202,61,'marble',328)+bottle(300,304,25,23,'copper')+flowers(300,302,.7)
  case 21:return plate(79,50,442,383,'darkstone',330)+plate(105,74,391,335,'stone',331)+plate(142,118,316,242,'copper',332)+mark(300,182,34,'brass',0)+rep(5,n=>p(`M183 ${232+n*20}h${232-(n%2)*32}`,'none','#D4BD8C',1.6))+[[161,136],[439,136],[161,342],[439,342]].map(([x,y])=>rivet(x,y,'brass',6)).join('')
  case 22:return plate(37,60,526,370,'stone',334)+band('M69 89H531V401H69Z','copper',8)+[[69,89],[531,89],[69,401],[531,401]].map(([x,y])=>plate(x-20,y-16,40,32,'darkstone',335)).join('')+rep(12,n=>rivet(87+n*38,90,'copper',3))+thin(140,177,319,50,'darkstone',336)+flowers(301,325,.9)
  case 23:return plate(36,66,528,365,'stone',338)+thin(86,127,429,65,'marble',339)+r(83,262,435,126,fill('darkstone'),7)+rep(6,n=>flowers(124+n*70,325,.78))+p('M99 276h403M99 374h403','none','#B8C0A0',3)
  default:throw new Error('未知墓标构造。')
 }
}
const narrow=(x:number)=>x<300?1:2

function offering(i:number):string {
 const settings=(x=300,y=240)=>dish(x,y,1.3)+bowl(x-91,y+3,30,23,'copper','grain')+bowl(x+99,y-7,29,23,'ceramic','empty')
 const planks=(x:number,y:number,w:number,h:number)=>plate(x,y,w,h,'wood',349+i)+p(`M${x+7} ${y+h*.32}h${w-14}M${x+7} ${y+h*.67}h${w-14}`,'none','#594B37',2.8)
 switch(i){
  case 0:return plate(33,159,534,165,'wood',350)+planks(57,80,486,324)+settings(300,238)+candle(113,241)
  case 1:return plate(38,121,72,241,'wood',352)+plate(490,121,72,241,'wood',353)+planks(55,81,490,321)+settings(215,240)+dish(433,240,.8)+candle(433,239)
  case 2:return slab(oval(300,240,239,190),'wood',355)+rep(7,n=>p(`M300 240L${nn(300+222*Math.cos(n*Math.PI*2/7))} ${nn(240+175*Math.sin(n*Math.PI*2/7))}`,'none','#69513B',2))+e(300,240,216,169,'none','#B3A075',9)+dish(300,240,1.8)+bowl(300,240,61,43,'ceramic','grain')
  case 3:return plate(48,79,504,326,'stone',357)+r(104,124,389,71,'#6C7B63',8)+p('M115 139h365','none','#AFB49A',3)+dish(300,281,1.4,'stone')+bowl(145,290,33,26,'stone','empty')+bowl(455,290,33,26,'stone','empty')
  case 4:return planks(54,79,492,325)+cloth(65,88,470,307,'paper',359)+[169,300,431].map((x,n)=>bowl(x,240,48,35,n%2?'copper':'ceramic','grain')).join('')+p('M93 107q16 137 0 271M508 105q-16 141 0 273','none','#B4A37E',3)
  case 5:return planks(47,78,506,328)+planks(58,71,483,119)+band('M67 181h466','wood',12)+settings(300,302)+[155,300,445].map(x=>candle(x,130,1.3)).join('')
  case 6:return slab([[43,67],[558,67],[558,226],[279,226],[279,412],[43,412]],'wood',362)+p('M60 143h479M122 230v163','none','#584A35',3)+dish(172,168,1.1)+bowl(423,150,44,32,'copper','grain')+bowl(160,330,38,28,'ceramic','empty')
  case 7:return slab(polygon(300,240,241,191,8),'wood',364)+p(path(polygon(300,240,217,171,8)),'none','#C3A777',3)+rep(8,n=>{const a=-Math.PI/2+n*Math.PI/4;return rivet(300+221*Math.cos(a),240+175*Math.sin(a),'copper',5)})+settings(300,240)
  case 8:return slab(leaf,'wood',366)+band('M74 244Q300 168 527 243','wood',9)+dish(316,239,1.1)+rep(8,n=>e(292+(n%3)*23,224+Math.floor(n/3)*16,13,10,n%2?'#A69C62':'#B49A75','#7C8057',1))+herb(162,255,4,.7)
  case 9:return slab(polygon(300,240,246,189,6),'stone',368)+band(path(polygon(300,240,221,168,6)),'copper',12)+[175,300,425].map(x=>plate(x-31,210,62,61,'copper',369)+r(x-20,223,40,36,'#65745D',3)).join('')+mark(300,125,25,'copper',4)
  case 10:return rep(5,n=>{const a=n*Math.PI*2/5;return band(`M300 240Q${300+150*Math.cos(a+.3)} ${240+115*Math.sin(a+.3)} ${300+262*Math.cos(a)} ${240+192*Math.sin(a)}`,'wood',22)})+slab(rough(300,240,229,163,371),'wood',371)+p('M142 234q39-119 177-71t97 125t-169 22t-41-92','none','#BA9D73',3)+dish(316,242,1.4,'wood')+herb(168,281,6,.75)
  case 11:return slab(shell,'marble',373)+p(rep(7,n=>`M300 385L${123+n*59} 114`),'none','#A1AF92',3)+dish(299,248,1.4,'marble')+bowl(301,248,33,24,'ceramic','grain')+e(299,353,17,13,'#DFD6B5','#99A68D',1.4)
  case 12:return band('M68 81L536 400M535 80L67 401','bone',20)+slab([[67,132],[190,79],[301,106],[431,75],[537,138],[514,260],[544,350],[420,410],[299,379],[166,410],[55,333]],'cloth',375)+settings(300,243)+band('M93 145l26 14M509 145l-26 14M111 366l26-13M492 366l-26-13','paper',4)
  case 13:return slab(crescent,'wood',377)+slab([[91,198],[158,150],[262,118],[385,127],[461,157],[374,151],[269,172],[191,219],[148,273],[107,289],[79,259]],'copper',378)+bowl(168,218,37,27,'ceramic','grain')+candle(387,137,1.2)
  case 14:return slab(petal(300,240,242,193,3),'wood',380)+dish(300,133,.94)+flowers(298,134,.85)+bowl(180,297,46,35,'copper','grain')+cloth(357,263,86,88,'paper',381)
  case 15:return plate(214,171,171,139,'wood',383)+slab(oval(180,242,137,165),'wood',384)+slab(oval(423,242,134,139),'wood',385)+dish(180,242,1.35)+bowl(422,242,64,47,'ceramic','grain')+band('M284 212h32M284 270h32','copper',7)
  case 16:return plate(49,79,502,325,'marble',387)+band('M67 100H532V382H67Z','brass',4)+settings(300,261)+bottle(153,155,31,28)+flowers(151,153,.73)
  case 17:return slab([[105,65],[497,65],[553,120],[553,360],[496,414],[104,414],[47,359],[47,120]],'wood',389)+band('M104 120h392M104 359h392','brass',6)+plate(199,173,201,133,'brass',390)+dish(300,240,.97,'ceramic')+mark(117,240,24,'brass',4)+mark(483,240,24,'brass',5)
  case 18:return handle(54,240,-90)+handle(546,240,90)+planks(50,86,500,315)+band('M182 99v288M419 99v288','copper',7)+cloth(207,151,187,179,'paper',393)+dish(300,240,1.1)+r(282,93,36,33,fill('copper'),3)
  case 19:return plate(47,73,506,337,'stone',395)+cloth(207,118,187,253,'paper',396)+bottle(136,239,46,38,'copper')+flowers(136,235,1)+bottle(465,239,46,38,'copper')+flowers(465,235,1)+dish(300,240,1)
  case 20:return planks(51,77,498,327)+plate(55,69,490,45,'wood',398)+plate(63,116,475,31,'wood',399)+[136,218,300,382,464].map((x,n)=>bowl(x,225,31,24,n%2?'copper':'ceramic','empty')).join('')+cloth(124,289,352,70,'paper',400)
  case 21:return plate(46,78,508,328,'copper',402)+`<g opacity=".59">${plate(61,93,478,299,'glass',403)}</g>`+[[78,111],[524,111],[78,372],[524,372]].map(([x,y])=>rivet(x,y,'brass',6)).join('')+dish(300,243,1.3,'marble')+bowl(165,245,30,25,'ceramic','empty')+bowl(440,245,30,25,'ceramic','empty')
  case 22:return slab(oval(300,240,239,190),'marble',405)+band('M75 240H525M300 63V418','copper',6)+dish(300,240,1.62,'copper')+[210,300,390].map(x=>bowl(x,240,29,23,'ceramic','empty')).join('')
  case 23:return slab([[66,83],[538,83],[554,108],[554,403],[414,403],[414,223],[187,223],[187,403],[47,403],[47,108]],'wood',407)+band('M78 110h445M78 379V116M524 379V116','brass',4)+dish(124,301,.9)+dish(476,301,.9)+bowl(300,151,44,34,'copper','grain')
  default:throw new Error('未知供桌构造。')
 }
}

function railing(v:readonly Point[],m:Material='wood',seed=420):string {
 let body=slab(v,m,seed)
 const inset=v.map(([x,y])=>[300+(x-300)*.78,240+(y-240)*.73] as const)
 body+=p(path(inset),'#756F54',colors[m][1],2)+texture(inset,'wood',seed+1,45)
 body+=band(path(v),m,17)
 v.filter((_,i)=>v.length<16||i%Math.ceil(v.length/12)===0).forEach(([x,y])=>{body+=e(x,y,15,12,fill(m),colors[m][1],1.5)+rivet(x,y,m,3)})
 return body
}
const bookBoard=(x=210,y=102,w=180,h=128,m:Material='wood',seed=430)=>plate(x,y,w,h,m,seed)+band(`M${x+7} ${y+h-8}h${w-14}`,m,9)+book(x+w*.12,y+h*.12,w*.76,h*.7,true,seed)
function pulpit(i:number):string {
 const square:readonly Point[]=[[79,85],[521,85],[521,371],[397,371],[397,391],[203,391],[203,371],[79,371]]
 const openFloor=(m:Material='wood',seed=420)=>plate(63,83,474,307,m,seed)+p('M78 179h443M78 257h443M78 335h443','none',m==='wood'?'#5E4A35':'#84917A',2)
 switch(i){
  case 0:return plate(185,269,230,125,'wood',420)+plate(268,129,64,242,'wood',421)+bookBoard(99,85,402,242,'wood',422)
  case 1:return openFloor()+band('M85 377V87H515V377','wood',26)+plate(70,72,460,58,'wood',424)+bookBoard(194,111,212,150,'wood',425)
  case 2:return railing([[161,57],[441,57],[545,139],[545,339],[438,425],[392,425],[392,380],[207,380],[207,425],[160,425],[54,339],[54,139]],'wood',427)+bookBoard(201,91,198,127,'wood',428)
  case 3:return slab([[68,377],[55,245],[92,136],[184,74],[300,53],[416,75],[508,137],[546,245],[531,377]],'wood',429)+slab([[66,360],[53,245],[91,135],[183,72],[300,49],[416,73],[510,136],[548,245],[534,360],[441,360],[440,249],[405,178],[300,139],[195,177],[160,250],[160,360]],'stone',430)+bookBoard(209,81,182,135,'stone',432)
  case 4:return openFloor('wood',434)+band('M201 371V97H529V371','wood',23)+bookBoard(289,108,166,129,'wood',435)+plate(37,172,174,231,'wood',436)+[182,231,280,330,379].map(y=>band(`M45 ${y}h155`,'wood',8)).join('')
  case 5:return plate(52,78,496,327,'wood',438)+bookBoard(72,94,219,288,'wood',439)+bookBoard(312,94,219,288,'wood',440)+band('M301 103v276','copper',7)
  case 6:return slab(oval(300,262,200,145),'stone',442)+plate(268,164,64,168,'stone',443)+slab([[82,103],[301,67],[517,103],[493,339],[303,369],[105,339]],'wood',444)+book(170,132,260,172,true,445)+band('M123 326h355','copper',10)
  case 7:return openFloor('wood',447)+band('M68 380V89H532V380','wood',11)+[68,300,532].map(x=>plate(x-19,74,38,37,'wood',448)).join('')+bookBoard(204,106,192,126,'wood',449)
  case 8:return slab(leaf,'wood',451)+p('M124 323Q63 235 157 151Q299 60 444 149Q535 231 476 324','none','#4C674E',25)+p('M124 323Q63 235 157 151Q299 60 444 149Q535 231 476 324','none','#91A374',19)+bookBoard(208,104,184,133,'wood',452)+herb(116,274,5,.7)
  case 9:return railing([[178,63],[420,63],[544,163],[544,338],[398,420],[398,368],[201,368],[201,420],[55,338],[55,163]],'stone',454)+band('M93 167H506','copper',12)+bookBoard(208,99,184,130,'copper',455)
  case 10:return rep(5,n=>{const a=n*Math.PI*2/5;return band(`M300 240Q${300+125*Math.cos(a+.4)} ${240+120*Math.sin(a+.4)} ${300+244*Math.cos(a)} ${240+181*Math.sin(a)}`,'wood',24)})+slab(rough(300,240,208,156,457),'wood',457)+p('M158 237q39-105 157-61t72 120t-143 6','none','#C1A57A',4)+bookBoard(173,99,255,159,'wood',458)
  case 11:return slab(shell,'marble',460)+p('M105 341L67 250 105 144 199 91 300 77 401 91 497 144 534 250 496 341','none','#748870',30)+p('M105 341L67 250 105 144 199 91 300 77 401 91 497 144 534 250 496 341','none','#C3C9AF',23)+bookBoard(202,100,196,134,'marble',461)
  case 12:return openFloor('wood',463)+band('M80 379V91H520V379','bone',17)+band('M107 259V126H493V259','wood',5)+[[80,90],[520,90],[80,376],[520,376]].map(([x,y])=>e(x,y,22,17,fill('bone'),'#7D8065',2)).join('')+bookBoard(206,109,187,135,'cloth',464)
  case 13:return slab(crescent,'marble',466)+band('M78 213Q274 74 508 162','stone',25)+bookBoard(114,157,130,91,'stone',467)+mark(397,137,20,'copper',3)
  case 14:return railing(petal(300,240,240,187,3),'wood',469)+plate(243,339,114,86,'wood',470)+bookBoard(204,86,192,132,'wood',471)
  case 15:return openFloor('stone',473)+slab([[60,365],[60,103],[159,71],[298,93],[428,62],[541,117],[541,365],[497,365],[492,158],[412,127],[300,148],[171,124],[107,155],[107,365]],'darkstone',474)+crystal(102,137,31,38,1)+crystal(493,138,32,40,2)+bookBoard(212,99,179,133,'stone',475)
  case 16:return openFloor('wood',477)+slab([[67,369],[67,123],[127,123],[127,78],[472,78],[472,123],[532,123],[532,369],[475,369],[475,166],[125,166],[125,369]],'wood',478)+band('M146 92h306','brass',6)+bookBoard(211,106,179,128,'wood',479)
  case 17:return openFloor('darkstone',481)+band('M69 376V92H531V376','brass',8)+[69,300,531].map(x=>e(x,91,14,12,fill('brass'),'#6A714D',2)).join('')+slab(oval(300,239,144,113),'copper',482)+bookBoard(209,105,182,133,'copper',483)
  case 18:return handle(77,240,-90)+handle(523,240,90)+plate(73,116,454,271,'wood',485)+band('M184 129v242M416 129v242','copper',7)+bookBoard(106,82,388,215,'wood',486)+r(277,88,46,31,fill('copper'),4)
  case 19:return openFloor('marble',488)+slab([[59,371],[59,98],[540,98],[540,371],[455,371],[455,172],[145,172],[145,371]],'marble',489)+band('M86 119H514','brass',7)+bookBoard(200,113,200,142,'marble',490)
  case 20:return plate(60,80,480,326,'wood',492)+bookBoard(121,149,257,177,'wood',493)+band('M433 328V139','copper',7)+e(433,328,38,28,fill('copper'))+e(432,134,36,20,'#5C6255','#C4B180',3)+p('M406 134h51m-48-8h45m-45 16h45','none','#99A18A',2)+cloth(164,192,164,90,'paper',494)
  case 21:return slab(oval(300,240,229,177),'wood',496)+p('M109 179h382M81 257h438M119 335h363','none','#5E4A35',2)+p('M129 368Q29 222 142 117Q300 25 459 117Q570 222 471 368','none','#514F3D',30)+p('M129 368Q29 222 142 117Q300 25 459 117Q570 222 471 368','none',fill('wood'),23)+[110,300,490].map(x=>plate(x-23,x===300?58:166,46,42,'wood',497)).join('')+bookBoard(207,104,186,132,'wood',498)
  case 22:return openFloor('wood',500)+band('M78 112V369M522 112V369','wood',17)+[78,522].map(x=>plate(x-23,100,46,46,'wood',501)).join('')+slab(polygon(300,262,112,81,4,Math.PI/4),'copper',502)+bookBoard(190,114,220,148,'wood',503)
  case 23:return openFloor('wood',505)+slab([[56,391],[56,80],[539,80],[539,177],[160,177],[160,391]],'wood',506)+bookBoard(156,115,232,157,'wood',507)+plate(393,220,156,173,'wood',508)+[234,283,333,382].map(y=>band(`M402 ${y}h137`,'wood',7)).join('')
  default:throw new Error('未知讲坛构造。')
 }
}

const mortar=(x:number,y:number,s=1)=>g(`translate(${x} ${y}) scale(${s})`,bowl(0,0,55,43,'stone')+band('M-20 16L49-39','stone',14)+p('M-7 5l38-29','none','#D0CFB0',2))
const boiler=(x:number,y:number,s=1)=>g(`translate(${x} ${y}) scale(${s})`,handle(-57,0,-90)+handle(57,0,90)+bowl(0,0,60,46,'copper','empty')+e(0,0,39,29,fill('copper'),'#65755D',2)+e(0,0,12,9,fill('wood'),'#5D5A43',1.5)+p('M-24-16q19-10 37-3','none','#E0C295',2))
const coil=(x:number,y:number,s=1)=>g(`translate(${x} ${y}) scale(${s})`,p('M-55 3C-55-46 58-46 58 4S-48 46-48 5 47-35 47 4-37 35-37 5 36-25 36 4-27 25-27 5 25-16 25 4-14 15-14 5 14-6 14 4','none','#4C665B',9)+p('M-55 3C-55-46 58-46 58 4S-48 46-48 5 47-35 47 4-37 35-37 5 36-25 36 4-27 25-27 5 25-16 25 4-14 15-14 5 14-6 14 4','none',fill('copper'),6)+p('M-55 3h-30M14 4h58','none','#B9A172',6))
const bottleRack=(x:number,y:number,w=167,h=72,seed=1)=>plate(x,y,w,h,'wood',520+seed)+[.18,.5,.82].map((t,n)=>bottle(x+w*t,y+h*.51,w*.105,h*.28,n%2?'ceramic':'glass',seed+n)).join('')+band(`M${x+8} ${y+h*.7}h${w-16}`,'copper',3)
const balance=(x:number,y:number,s=1)=>g(`translate(${x} ${y}) scale(${s})`,e(0,2,24,18,fill('copper'))+band('M-86 0H86','brass',8)+bowl(-88,0,36,28,'brass','empty')+bowl(88,0,36,28,'brass','empty')+band('M0-42V42','brass',8)+e(0,0,13,10,fill('copper')))
function alchemy(i:number):string {
 const surface=(m:Material='wood',seed=530)=>plate(43,74,514,334,m,seed)
 const reagents=(x=398,y=151)=>bottleRack(x-75,y-37,151,74,i)+bottleRack(x-75,y+72,151,74,i+1)
 switch(i){
  case 0:return surface('wood',530)+p('M58 182h484M58 302h484','none','#5E4A36',3)+mortar(198,228,1.2)+herb(410,297,4,1.2)+dish(429,144,.9)+herb(425,142,9,.65)
  case 1:return surface('wood',532)+boiler(159,242,1.05)+band('M218 231H264V173H342','copper',9)+coil(365,174,.96)+band('M434 176h45v101','copper',7)+bowl(478,315,47,35,'ceramic','water')+bottle(299,327,29,26)
  case 2:return slab(rough(300,240,256,181,534),'stone',534)+mortar(179,202,1.12)+mortar(390,282,.86)+r(314,110,154,63,'#82846B',9)+texture(rect(324,120,134,43),'paper',535,37)+band('M119 333l127 12','wood',9)
  case 3:return surface('wood',537)+plate(70,106,459,116,'wood',538)+r(85,123,430,80,'#636F58',9)+plate(70,260,459,116,'wood',539)+r(85,277,430,80,'#8A9973',9)+band('M85 237H517','wood',12)+bottle(194,161,31,26,'ceramic')+bottle(392,317,33,27,'ceramic')
  case 4:return slab([[43,67],[558,67],[558,222],[278,222],[278,412],[43,412]],'wood',541)+mortar(181,167,1.05)+dish(421,145,1)+herb(422,144,4,.85)+bottleRack(85,297,145,74,5)
  case 5:return slab(oval(300,240,239,190),'stone',543)+boiler(270,211,1.05)+band('M366 255l94 49','wood',10)+bowl(455,308,29,21,'wood','empty')+bottle(156,285,30,27)+bottle(221,345,25,22)+mark(402,143,23,'copper',1)
  case 6:return plate(45,69,509,344,'wood',545)+plate(57,79,486,105,'wood',546)+bottleRack(75,89,211,77,8)+bottleRack(314,89,211,77,9)+plate(77,201,445,182,'wood',547)+mortar(224,291,.85)+book(355,249,122,85,true,9)+handle(50,279,-90)+handle(550,279,90)
  case 7:return surface('stone',549)+e(179,240,100,79,'#424E44','#B1B89A',9)+p('M111 208l37-17 35 9 30-11 26 28-14 37-45 7-37-4-31-30Z','#5E6252','#90947B',2)+boiler(178,240,1.1)+dish(424,157,.95)+bowl(433,304,51,37,'ceramic','water')+band('M364 284l72 26','wood',7)
  case 8:return slab(leaf,'wood',552)+band('M95 242Q290 181 504 243','wood',8)+bottle(173,250,42,35)+bottle(423,226,48,40)+p('M176 245Q298 93 421 225','none','#58795E',9)+p('M176 245Q298 93 421 225','none','#A5B98D',5)+mortar(301,310,.67)+herb(304,134,8,.7)
  case 9:return slab(polygon(300,240,247,190,6),'darkstone',554)+band(path(polygon(300,240,225,170,6)),'copper',12)+boiler(395,242,.95)+plate(111,178,122,105,'copper',555)+band('M171 151V319','wood',12)+plate(137,163,69,43,'darkstone',556)+band('M275 313L415 343','copper',7)+mortar(284,127,.6)
  case 10:return rep(5,n=>{const a=n*Math.PI*2/5;return band(`M300 240Q${300+125*Math.cos(a+.3)} ${240+107*Math.sin(a+.3)} ${300+259*Math.cos(a)} ${240+191*Math.sin(a)}`,'wood',23)})+slab(rough(300,240,226,160,558),'wood',558)+p('M144 238q44-105 163-62t82 112t-143 15','none','#BA9D74',4)+mortar(252,221,1.02)+herb(418,293,8,.9)+bottle(415,161,30,26,'ceramic')
  case 11:return surface('darkstone',560)+p('M317 85l-26 80 34 65-26 79 14 80','none','#334E49',7)+crystal(119,113,32,36,2)+bottleRack(365,104,146,76,7)+bottleRack(365,279,146,76,8)+p('M164 209H252V168H362M257 169v151h104','none','#406D67',10)+p('M164 209H252V168H362M257 169v151h104','none','#B6D1BD',6)+bottle(157,210,36,29)+bottle(359,166,30,25)+bottle(360,320,30,25)
  case 12:return slab(shell,'marble',563)+bowl(189,234,83,63,'marble','water')+band('M248 236H329V158H421','copper',8)+coil(420,217,.72)+bowl(425,322,40,29,'ceramic','water')+band('M474 218v82h-32','copper',6)+bottle(300,342,27,23)
  case 13:return band('M65 80L537 399M535 80L66 399','bone',22)+slab([[69,131],[187,77],[300,104],[430,73],[536,137],[511,259],[544,352],[419,411],[299,380],[166,410],[55,334]],'cloth',565)+mortar(188,246,1)+bottleRack(334,115,152,72,9)+bottle(377,311,30,26,'ceramic')+bottle(433,296,27,24,'ceramic')+band('M358 304l96 9','paper',4)
  case 14:return slab(crescent,'stone',567)+boiler(184,215,.76)+boiler(437,139,.51)+band('M225 208H304V147H401','copper',8)+coil(303,156,.67)+bowl(111,318,32,24,'ceramic','water')+band('M243 161H111V290','copper',5)
  case 15:return slab(petal(300,240,243,191,3),'wood',569)+mortar(300,140,.77)+bottleRack(110,273,147,72,12)+boiler(420,297,.72)+herb(297,285,4,.7)
  case 16:return surface('copper',571)+plate(58,88,484,305,'marble',572)+p('M75 106H524V374H75Z','none','#EBE8D0',4)+bottleRack(98,118,184,78,2)+bottleRack(315,118,184,78,3)+dish(202,303,.86,'marble')+bowl(401,304,47,37,'glass','water')
  case 17:return surface('wood',574)+bottleRack(65,91,224,76,4)+bottleRack(310,91,224,76,5)+bottleRack(66,185,223,76,6)+book(339,246,160,109,true,7)+bowl(190,324,45,34,'glass','water')+band('M268 295l31 71','wood',5)
  case 18:return surface('wood',576)+plate(72,102,215,271,'marble',577)+r(91,126,177,213,'#547C76',18,'#D8D9BD',7)+r(107,140,145,179,'#8DAE9E',12,'#638B7B',3)+band('M179 125V96h42v53','copper',9)+bottleRack(332,104,184,80,8)+bowl(418,288,58,44,'glass','water')+bottle(365,347,25,22)
  case 19:return surface('darkstone',579)+bowl(151,238,72,58,'glass','water')+e(151,238,21,17,fill('glass'),'#B5CEB9',2)+p('M173 216L286 142 413 243','none','#3F706B',15)+p('M173 216L286 142 413 243','none','#B9D1BF',10)+r(285,163,51,60,fill('copper'),6)+p('M286 177l31 27M296 166l31 27','none','#DEC08B',3)+bottle(442,281,44,36)+plate(241,302,82,58,'copper',580)+band('M282 329V174','copper',7)+book(349,327,141,54,true,4)
  case 20:return surface('stone',582)+balance(261,177,1.16)+plate(92,283,185,88,'wood',583)+rep(6,n=>e(118+n*26,328,8+n%3*2,7,fill('copper'),'#576D57',1))+dish(427,298,1.1,'ceramic')+texture(oval(427,298,35,24),'paper',584,27)+bottle(458,148,30,25)
  case 21:return r(38,171,40,145,'#536759',12)+r(522,171,40,145,'#536759',12)+plate(68,78,463,325,'copper',586)+plate(84,96,430,289,'marble',587)+band('M300 82V38h89','copper',13)+bottleRack(109,120,175,79,9)+bottleRack(316,120,175,79,10)+bowl(218,299,44,33,'glass','water')+dish(412,299,.83)
  case 22:return slab(polygon(300,240,242,191,8),'wood',589)+band(path(polygon(300,240,218,170,8)),'brass',5)+band('M95 240H505M300 71V409','brass',4)+bowl(300,240,82,63,'glass','water')+bottle(163,199,25,23)+bottle(416,306,26,23)+mortar(389,144,.53)
  case 23:return slab([[67,71],[534,71],[554,94],[554,409],[413,409],[413,227],[187,227],[187,409],[47,409],[47,93]],'wood',591)+bottleRack(108,102,175,78,12)+bottleRack(316,102,175,78,13)+mortar(118,307,.67)+bowl(482,307,44,32,'glass','water')+book(243,109,115,76,true,10)
  default:throw new Error('未知炼金台构造。')
 }
}

function crystalDevice(i:number):string {
 const socket=(x:number,y:number,rx=61,ry=48,m:Material='copper',seed=1)=>bowl(x,y,rx,ry,m,'empty')+crystal(x,y,rx*.67,ry*.72,seed)
 const clamps=(x:number,y:number,rx:number,ry:number,n=3)=>rep(n,k=>{const a=k*Math.PI*2/n;return band(`M${nn(x+rx*Math.cos(a))} ${nn(y+ry*Math.sin(a))}L${nn(x+rx*.48*Math.cos(a))} ${nn(y+ry*.48*Math.sin(a))}`,'copper',11)+rivet(x+rx*Math.cos(a),y+ry*Math.sin(a),'brass',5)})
 const lens=(x:number,y:number,rx=58,ry=45)=>e(x,y,rx,ry,fill('copper'),'#526F5A',3)+`<g opacity=".72">${e(x,y,rx-10,ry-8,fill('glass'),'#C9DAC2',2)}</g>`+p(`M${x-rx*.45} ${y-ry*.4}q${rx*.4} ${-ry*.23} ${rx*.8} 0`,'none','#DBE6CF',3)
 switch(i){
  case 0:return plate(59,86,481,316,'stone',600)+plate(117,143,366,193,'copper',601)+crystal(300,240,92,79,1)+clamps(300,240,147,113,2)+mark(300,367,20,'copper',1)
  case 1:return slab(rough(300,240,244,183,603),'darkstone',603)+rep(3,n=>{const a=-Math.PI/2+n*Math.PI*2/3;return band(`M300 240L${nn(300+223*Math.cos(a))} ${nn(240+167*Math.sin(a))}`,'copper',22)+rivet(300+223*Math.cos(a),240+167*Math.sin(a),'brass',9)})+lens(300,240,143,110)+clamps(300,240,158,123)
  case 2:return slab(rough(300,240,245,185,605),'stone',605)+crystal(295,226,99,103,1)+crystal(153,286,54,57,2)+crystal(431,286,63,66,3)+crystal(421,134,27,30,4)+p('M133 143l31 11-7 27M457 352l-28-5 9-23','none','#657A67',2.3)
  case 3:return slab(oval(300,240,235,182),'stone',607)+bowl(300,240,154,119,'glass','water')+clamps(300,240,178,136)+e(300,240,102,78,'none','#B9D7C1',3)+p('M220 204q85-49 147 5','none','#D9E8CF',4)
  case 4:return plate(66,81,469,324,'darkstone',609)+socket(300,240,110,88,'copper',2)+[[104,111],[495,111],[104,367],[495,367]].map(([x,y])=>plate(x-22,y-18,44,36,'wood',610)).join('')+band('M103 112L496 367M496 112L103 367','copper',6)+rivet(300,240,'brass',8)
  case 5:return rep(3,n=>g(`rotate(${n*120} 300 240)`,plate(274,41,52,193,'copper',612+n)+rivet(300,56,'brass',8)))+lens(300,240,137,108)+clamps(300,240,149,119,3)
  case 6:return plate(40,113,520,255,'stone',616)+band('M189 240H418','copper',24)+socket(173,240,95,92,'copper',1)+socket(429,240,80,74,'copper',2)+rivet(300,240,'brass',10)
  case 7:return plate(52,77,495,328,'wood',618)+plate(66,83,468,67,'wood',619)+band('M85 183H516M85 282H516','wood',7)+crystal(169,233,58,51,1)+crystal(316,319,66,50,2)+crystal(444,224,46,43,3)+mark(300,115,21,'copper',0)
  case 8:return rep(7,n=>{const a=n*Math.PI*2/7;return band(`M300 240Q${300+122*Math.cos(a+.4)} ${240+112*Math.sin(a+.4)} ${300+258*Math.cos(a)} ${240+187*Math.sin(a)}`,'wood',26)})+slab(rough(300,240,183,134,621),'wood',621)+crystal(267,221,77,81,1)+crystal(366,275,48,53,2)+crystal(407,164,32,37,3)+herb(139,307,7,.7)
  case 9:return slab(polygon(300,240,243,192,6),'darkstone',623)+slab(polygon(300,240,210,165,6),'stone',624)+crystal(300,240,93,99,1)+clamps(300,240,182,144,6)+rep(6,n=>{const a=n*Math.PI/3;return mark(300+218*Math.cos(a),240+171*Math.sin(a),15,'copper',n)})
  case 10:return slab(rough(225,241,182,185,626),'darkstone',626)+slab(rough(404,253,155,164,627),'stone',627)+p('M302 84l-24 75 37 78-22 83 20 80','none','#334D46',8)+crystal(175,188,52,57,1)+crystal(305,150,58,67,2)+crystal(422,235,66,76,3)+crystal(275,315,58,55,4)+crystal(141,315,29,30,5)
  case 11:return slab(crescent,'marble',630)+socket(174,237,69,61,'copper',1)+socket(410,142,57,51,'copper',2)+band('M195 180Q292 99 377 129','copper',12)+mark(97,305,17,'copper',3)
  case 12:return slab(petal(300,240,241,189,5),'copper',632)+rep(5,n=>{const a=-Math.PI/2+n*Math.PI*2/5;return socket(300+155*Math.cos(a),240+120*Math.sin(a),45,35,'brass',n)})+bowl(300,240,63,49,'glass','water')
  case 13:return slab(rough(300,240,239,177,634),'darkstone',634)+band('M86 123Q132 292 300 376M514 123Q470 292 300 376M120 155Q300 85 480 155','bone',24)+crystal(300,227,102,102,1)+band('M140 213L449 313M451 207L150 313','wood',5)+rivet(300,273,'copper',7)
  case 14:return slab(oval(300,240,240,187),'darkstone',636)+p('M111 297C80 139 319 71 448 164S415 353 267 324 210 146 345 169 353 280 297 262','none','#596E5D',54)+p('M111 297C80 139 319 71 448 164S415 353 267 324 210 146 345 169 353 280 297 262','none',fill('stone'),46)+[[113,288],[181,157],[326,129],[450,201],[391,315],[253,297],[271,194],[352,231]].map(([x,y],n)=>crystal(x,y,22,23,n)).join('')
  case 15:return plate(43,191,514,106,'copper',638)+slab(rough(130,246,88,126,639),'stone',639)+slab(rough(301,246,83,173,640),'stone',640)+slab(rough(475,246,83,110,641),'stone',641)+crystal(130,246,49,66,1)+crystal(301,246,48,94,2)+crystal(475,246,47,58,3)+rivet(214,244,'brass',9)+rivet(389,244,'brass',9)
  case 16:return plate(42,77,516,327,'wood',643)+coil(191,221,1.2)+plate(354,133,143,133,'copper',644)+crystal(425,200,43,45,2)+band('M380 165l92 69','copper',7)+rep(3,n=>rivet(323+n*76,342,'brass',10))+p('M117 274V342H323M265 221h51v121H476','none','#4C6652',4)
  case 17:return plate(42,84,517,317,'wood',646)+band('M90 241h420','copper',14)+[149,300,450].map((x,n)=>lens(x,241,61+n*4,81-n*9)+plate(x-20,324,40,37,'copper',647+n)).join('')+band('M93 135h413','brass',5)+rep(15,n=>p(`M${108+n*27} 135v${n%5?10:19}`,'none','#DED0A0',2))
  case 18:return slab(oval(300,240,240,190),'wood',651)+e(300,240,176,137,fill('cloth'),'#5B4B43',5)+lens(300,240,129,102)+clamps(300,240,151,119,4)+p('M218 195q66-28 124-5','none','#DFE8D2',4)
  case 19:return plate(43,79,514,326,'darkstone',653)+coil(169,228,1.05)+coil(432,228,1.05)+socket(300,242,62,51,'copper',3)+band('M231 221H261M340 221h30','copper',7)+rep(4,n=>rivet(129+n*114,355,'brass',9))+p('M128 289v57H471V289','none','#AF996C',3)
  case 20:return plate(47,76,506,330,'wood',655)+plate(64,91,472,299,'copper',656)+crystal(161,171,51,48,1)+crystal(300,181,44,57,2)+crystal(435,176,47,43,3)+crystal(199,304,67,42,4)+crystal(413,310,62,47,5)+band('M80 104H520V376H80Z','brass',6)+p('M80 240H520M237 106v133M368 106v133M300 242v132','none','#A6BEA5',4)+`<g opacity=".23">${plate(83,107,434,266,'glass',657)}</g>`+[[82,105],[519,105],[82,375],[519,375]].map(([x,y])=>rivet(x,y,'brass',5)).join('')
  case 21:return plate(43,78,515,325,'wood',659)+plate(62,94,478,290,'darkstone',660)+[159,439].map((x,n)=>lens(x,180,63,52)+p(`M${x-36} 193Q${x} 148 ${x+36} 193M${x} 190l${n?-21:18}-23`,'none','#D3C498',2)).join('')+socket(300,280,62,56,'copper',2)+[123,206,394,477].map(x=>bowl(x,329,19,15,'copper','empty')).join('')+band('M221 182h157','copper',5)
  case 22:return plate(47,88,506,319,'darkstone',662)+plate(89,71,422,284,'stone',663)+plate(148,55,305,240,'marble',664)+crystal(300,187,80,84,2)+clamps(300,187,120,111,2)+band('M126 377H474','brass',7)+mark(300,335,29,'brass',4)
  case 23:return handle(54,271,-90)+handle(546,271,90)+plate(48,75,503,331,'wood',666)+plate(63,86,474,80,'wood',667)+plate(71,181,459,197,'cloth',668)+[155,300,444].map((x,n)=>crystal(x,263,43+n*7,47+n*4,n)).join('')+band('M225 199v163M373 199v163','wood',7)+plate(111,111,376,28,'copper',669)+rep(18,n=>p(`M${125+n*20} 112v${n%5?8:16}`,'none','#E2CEA0',1.8))+r(277,382,46,20,fill('copper'),3)
  default:throw new Error('未知晶体装置构造。')
 }
}

function magicCircle(i:number):string {
 const ring=(rx:number,ry:number,m:Material='paper',seed=700,width=4)=>p(path(rough(300,240,rx,ry,seed,78)),'none',colors[m][1],width+1)+p(path(rough(300,240,rx,ry,seed,78)),'none',colors[m][2],width)
 const ticks=(n:number,rx:number,ry:number,m:Material='paper')=>rep(n,k=>{const a=k*Math.PI*2/n;return p(`M${nn(300+rx*Math.cos(a))} ${nn(240+ry*Math.sin(a))}L${nn(300+(rx-12)*Math.cos(a))} ${nn(240+(ry-10)*Math.sin(a))}`,'none',colors[m][2],3)})
 const dust=(seed:number)=>rep(90,n=>{const a=rng(seed,n*3)*Math.PI*2,rr=.68+rng(seed,n*3+1)*.29;return e(300+244*rr*Math.cos(a),240+192*rr*Math.sin(a),1+rng(seed,n*3+2)*2,.8+rng(seed,n*3+2)*1.5,'#D7CEAF','#9B987B',.4)})
 switch(i){
  case 0:return ring(245,193,'paper',700,3)+ring(215,170,'paper',701,2)+ring(157,122,'paper',702,3)+ticks(24,231,181)+[0,1,2,3].map(n=>{const a=n*Math.PI/2;return mark(300+181*Math.cos(a),240+142*Math.sin(a),27,'paper',n)}).join('')+p('M300 148v184M182 240h235','none','#D8CDA6',3)+dust(703)
  case 1:return rep(32,n=>{const a=n*Math.PI/16,b=a+.15,v:readonly Point[]=[[300+235*Math.cos(a),240+185*Math.sin(a)],[300+235*Math.cos(b),240+185*Math.sin(b)],[300+213*Math.cos(b),240+168*Math.sin(b)],[300+213*Math.cos(a),240+168*Math.sin(a)]];return p(path(v),fill('stone'),'#63745F',2)+texture(v,'stone',705+n,6)})+p('M100 240H500M300 83V397','none','#BCB798',9)+ring(112,87,'darkstone',706,5)+mark(300,240,45,'stone',4)
  case 2:return ring(240,189,'wood',709,7)+ring(228,180,'paper',709,2)+ring(217,171,'wood',709,4)+rep(8,n=>{const a=n*Math.PI/4,x=300+230*Math.cos(a),y=240+181*Math.sin(a);return g(`translate(${x} ${y}) rotate(${n*45})`,band('M-14 0l13-12 14 12-14 12Z','paper',3)+e(0,25,8,6,fill('copper'),'#82744E',1))})+p('M184 238Q300 90 417 240Q300 387 184 238Z','none','#D8CA9D',3)
  case 3:return p(path(leaf),'none','#526E58',7)+p('M57 243Q300 159 542 241M122 173Q300 393 480 172M157 136Q295 323 442 135M211 105Q296 244 388 105','none','#A9BC91',4)+rep(6,n=>{const a=n*Math.PI/3;return slab(rough(300+180*Math.cos(a),240+127*Math.sin(a),17,13,712+n),'stone',712+n)})+mark(300,240,30,'paper',2)
  case 4:return p(path(polygon(300,240,244,192,6)),'none','#4D6756',7)+p(path(polygon(300,240,236,185,6)),'none','#CBC5A0',3)+p(path(polygon(300,240,190,148,6)),'none','#B9BA93',4)+rep(6,n=>{const a=-Math.PI/2+n*Math.PI/3;return mark(300+208*Math.cos(a),240+164*Math.sin(a),24,'paper',n)+p(`M300 240L${nn(300+170*Math.cos(a))} ${nn(240+133*Math.sin(a))}`,'none','#BBC49B',3)})+e(300,240,59,44,'none','#354F47',9)+p('M257 211Q295 189 340 210M341 268q-43 25-83 1','none','#D3CCAA',4)+dust(717)
  case 5:return p('M93 292C61 133 301 68 451 154S436 354 271 328 209 133 354 164 360 290 294 264M507 185C542 340 296 409 150 323S165 126 330 151 391 345 247 315 240 188 307 215','none','#8F9779',7)+p('M93 292C61 133 301 68 451 154S436 354 271 328 209 133 354 164 360 290 294 264M507 185C542 340 296 409 150 323S165 126 330 151 391 345 247 315 240 188 307 215','none','#D0C8A3',3)+[bowl(155,341,20,15,'stone','empty'),bowl(454,137,20,15,'stone','empty'),bowl(406,349,20,15,'stone','empty')].join('')+dust(720)
  case 6:return e(300,240,243,191,'none','#6B7054',8)+e(300,240,243,191,'none','#D2B580',5)+e(300,240,204,160,'none','#CBB17D',3)+ticks(32,230,180,'brass')+rep(8,n=>{const a=n*Math.PI/4;return mark(300+174*Math.cos(a),240+135*Math.sin(a),24,'brass',n)})+p('M300 133L395 240 300 348 204 240Z','none','#6E7457',7)+p('M300 133L395 240 300 348 204 240Z','none','#D8C28F',3)+mark(300,240,38,'brass',5)
  case 7:return ring(245,182,'paper',725,3)+ring(224,163,'paper',726,2)+rep(6,n=>{const a=n*Math.PI/3,x=300+183*Math.cos(a),y=240+131*Math.sin(a);return e(x,y,27,20,'none','#CFCAA9',2)+p(`M${x-10} ${y+2}l17-5m-9-3l4 13`,'none','#CBC6A5',2)})+p('M215 184l21-11 13 18M364 181l18 16 12-11M247 307l-17 7-11-14M376 308l-15 9-14-11','none','#D5CEAD',3)+dust(727)
  default:throw new Error('未知仪式地纹构造。')
 }
}
function relic(i:number):string {
 switch(i){
  case 0:return plate(58,95,484,290,'copper',730)+cloth(77,111,446,258,'cloth',731)+band('M82 125H518V355H82Z','brass',9)+band('M144 122v236M456 122v236','copper',12)+mark(300,240,79,'brass',0)+r(275,352,50,36,fill('copper'),5)+[[99,140],[500,140],[99,341],[500,341]].map(([x,y])=>rivet(x,y,'brass',7)).join('')
  case 1:return e(300,244,201,156,fill('copper'),'#5B6D54',4)+e(300,244,176,136,'none','#D6B884',4)+e(300,244,145,110,'none','#7A8B6C',3)+plate(276,82,48,182,'wood',733)+e(300,89,41,32,fill('copper'),'#546A53',2)+p('M162 174q103-60 212-11M177 320l52 12','none','#D9BD8E',4)+texture(oval(300,244,179,136),'copper',734,100)
  case 2:return cloth(48,83,504,322,'paper',736)+g('rotate(-19 190 235)',band('M190 136V326','bone',31)+e(190,143,34,23,fill('bone'),'#8B896A',2)+e(190,326,37,24,fill('bone'),'#8B896A',2))+g('rotate(22 370 244)',band('M371 137V346','bone',24)+e(371,142,31,21,fill('bone'),'#8B896A',2))+p('M264 288l51-19 23 14-17 19-53 6Z',fill('bone'),'#8B896A',2)+p('M235 199q59-81 107 4t-28 133t-90-45','none','#6E7A5C',6)+p('M235 199q59-81 107 4t-28 133t-90-45','none','#C9AF78',3)
  case 3:return slab(leaf,'wood',739)+band('M91 241Q301 174 509 241','wood',9)+crystal(302,237,121,108,3)+p('M164 190Q300 315 443 192M177 308Q300 153 429 306','none','#4B7156',12)+p('M164 190Q300 315 443 192M177 308Q300 153 429 306','none','#A5B88A',7)+leafBlade(139,251,-42,89,24)
  case 4:return e(300,240,75,58,'none','#516B58',21)+e(300,240,75,58,'none',fill('copper'),15)+rep(3,n=>g(`rotate(${n*120} 300 240)`,p('M290 206Q182 136 160 52Q272 65 327 185L315 223Z',fill('bone'),'#7A8060',3)+p('M186 88q68 33 108 115','none','#E5D8AF',4)+band('M284 203l42-15','wood',7)))+p('M296 281q-3 99 70 116t81-20','none','#9E8F64',8)+p('M296 281q-3 99 70 116t81-20','none','#D1BD88',3)
  case 5:return slab([[33,240],[69,137],[198,84],[286,123],[304,224],[293,314],[204,387],[76,346]],'ceramic',744)+slab([[318,128],[426,82],[530,137],[568,240],[531,346],[404,386],[314,310],[304,224]],'ceramic',745)+p('M62 239L263 238M84 162L262 225M99 320L263 252M340 238H539M340 225L520 160M341 252L510 322','none','#D3C09A',4)+e(443,242,48,37,'#D5D6B8','#899E81',3)+band('M291 169v142','copper',7)+p('M443 282q-2 112 87 118','none','#B29C6C',4)
  case 6:return slab(oval(182,241,139,151),'copper',747)+slab(oval(422,241,139,151),'copper',748)+e(422,241,111,120,fill('cloth'),'#706A4B',3)+e(422,241,86,95,fill('brass'),'#6F7351',3)+mark(422,241,55,'copper',4)+band('M300 159v164','copper',8)+p('M439 339q23 74 94 63','none','#6B795C',6)+p('M439 339q23 74 94 63','none','#C8B080',3)
  case 7:return plate(50,89,501,303,'copper',750)+plate(73,110,454,261,'cloth',751)+slab(rough(238,247,113,69,752),'stone',752)+slab(rough(417,255,63,57,753),'marble',753)+`<g opacity=".21">${plate(84,120,432,240,'glass',754)}</g>`+band('M100 136H501V352H100Z','brass',6)+band('M184 115v255M419 115v255','copper',15)+rivet(184,137,'brass',7)+rivet(419,350,'brass',7)
  default:throw new Error('未知圣物构造。')
 }
}
function potion(i:number):string {
 switch(i){
  case 0:return bottle(300,240,186,153,'ceramic',0)+e(300,239,71,58,fill('wood'),'#6B6249',3)+p(path(rough(300,240,90,70,760,17)),'#996F54','#735E48',2)+e(300,239,48,39,fill('wood'),'#735E48',2)+mark(300,240,26,'copper',1)+texture(oval(300,240,171,137),'ceramic',761,115)
  case 1:return handle(91,240,-90)+handle(509,240,90)+bottle(300,240,207,166,'glass',2)+e(300,239,58,47,'#4E7168','#C7D7BC',5)+e(300,239,36,28,fill('ceramic'),'#647F6B',2)+p('M108 239Q98 111 300 82Q495 108 491 239','none','#BAA272',8)+p('M110 239Q100 111 300 84','none','#E0C79A',2)
  case 2:return plate(42,113,517,267,'wood',765)+bottle(204,243,122,112,'ceramic',0)+bottle(433,232,92,89,'marble',1)+band('M73 352h447','wood',9)+g('rotate(-13 342 340)',bowl(343,343,36,26,'wood','empty')+band('M367 344h101','wood',12))
  case 3:return bottle(300,240,190,166,'glass',0)+rep(5,n=>leafBlade(300,262,n*72+17,155,45))+e(306,206,61,51,fill('wood'),'#6E7F5D',3)+p('M151 167Q300 327 450 170M165 311Q295 144 439 313','none','#4D7759',10)+p('M151 167Q300 327 450 170M165 311Q295 144 439 313','none','#B3C196',5)+mark(306,206,26,'copper',2)
  case 4:return p('M65 288Q116 111 327 91L493 128 538 188Q408 162 319 212Q214 272 151 376Z',fill('bone'),'#7C8263',4)+texture([[89,279],[138,179],[325,113],[470,143],[504,174],[315,193],[209,267],[148,347]],'bone',770,90)+band('M389 121l28 57M434 131l26 47','copper',13)+e(478,162,37,28,'#5E8071','#CDCBA7',4)+e(478,162,21,16,'#789B88','#416E60',2)+p('M125 277q73-116 196-140','none','#E3D5AF',4)
  case 5:return cloth(45,80,510,331,'paper',772)+[[186,180],[413,182],[298,325]].map(([x,y],n)=>e(x,y,96,78,fill('cloth'),'#645344',3)+e(x,y,31,24,fill('wood'),'#5B5B43',2)+p(`M${x-56} ${y-42}q52 22 105 0M${x-49} ${y+45}q51-15 100 0`,'none','#B18A75',3)).join('')+band('M186 197L298 325 413 198M186 198H413','wood',7)+rivet(300,226,'copper',7)
  case 6:return plate(100,76,400,329,'glass',775)+p('M123 96H477V381H123Z','none','#C1D8C2',4)+e(300,239,119,97,'#6D9A8A','#C1D3B8',3)+e(300,239,57,48,fill('glass'),'#DCE5CC',5)+e(300,239,35,29,'#99B8A2','#567E70',2)+cloth(153,99,92,46,'paper',776)+p('M167 114h61m-61 10h47','none','#8F8563',2)+p('M140 132v128M458 268v87','none','#E0E8D1',5)
  case 7:return plate(41,106,519,272,'wood',778)+bottle(152,239,70,89,'glass',0)+bottle(300,239,66,97,'ceramic',1)+bottle(446,239,70,81,'glass',2)+band('M60 296H542','copper',9)+band('M70 177H532','wood',9)+[[70,174],[530,174],[70,299],[530,299]].map(([x,y])=>rivet(x,y,'copper',5)).join('')
  default:throw new Error('未知药瓶构造。')
 }
}
function scrollBook(i:number):string {
 const scroll=(x:number,y:number,w:number,h:number,seed=1)=>cloth(x,y,w,h,'paper',seed)+band(`M${x-3} ${y-10}v${h+20}M${x+w+3} ${y-10}v${h+20}`,'wood',17)+rep(8,n=>p(`M${x+25} ${y+30+n*(h-50)/8}q${w*.23} -5 ${w-58-rng(seed,n)*22} 0`,'none',n%4?'#8C7F5E':'#A37C5D',2.4))+e(x-3,y-12,14,11,fill('wood'))+e(x+w+3,y+h+12,14,11,fill('wood'))
 switch(i){
  case 0:return book(56,86,487,311,true,783)+p('M296 109q-13 131 2 281','none','#B0966B',3)+band('M451 99v173','cloth',5)
  case 1:return scroll(92,85,414,313,785)+mark(294,169,39,'copper',5)+p('M235 320l41-21 26 12 42-28','none','#A27D5B',2)
  case 2:return book(82,55,435,377,false,787)+band('M410 108h116M410 366h116','copper',14)+rivet(465,108,'brass',8)+rivet(465,366,'brass',8)+p('M117 84v315','none','#B99374',5)
  case 3:return slab(leaf,'wood',789)+p('M80 243Q293 171 525 243M182 162L227 202M385 286l45 46','none','#AEB98A',5)+book(204,133,293,210,true,790)+band('M157 150v184','wood',13)+leafBlade(140,340,-11,193,38)
  case 4:return plate(63,62,474,359,'darkstone',792)+plate(77,77,216,327,'stone',793)+plate(309,77,214,327,'marble',794)+band('M300 104v264','copper',9)+[135,224,313].map(y=>band(`M277 ${y}h46`,'brass',16)+rivet(285,y,'copper',5)+rivet(315,y,'copper',5)).join('')+rep(8,n=>mark(n%2?415:184,126+Math.floor(n/2)*76,29,'copper',n))
  case 5:return cloth(49,82,501,323,'cloth',796)+g('rotate(-14 298 157)',scroll(81,117,426,74,797))+g('rotate(12 303 260)',scroll(117,226,380,76,798))+g('rotate(-8 289 344)',scroll(101,310,377,73,799))+band('M256 81Q301 236 245 399M354 80Q302 236 362 399','wood',9)+cloth(270,201,81,89,'paper',800)+mark(309,245,20,'copper',1)
  case 6:return book(57,85,487,311,true,802)+p('M301 98v292','none','#6B6F57',6)+rep(8,n=>p(`M83 ${121+n*33}h198M323 ${121+n*33}h191`,'none','#B8A77B',.9))+cloth(397,72,75,162,'paper',803)+p('M410 94h49m-49 13h43m-43 13h46','none','#958663',1.8)
  case 7:return cloth(47,57,508,369,'cloth',805)+plate(75,82,453,320,'wood',806)+g('rotate(-7 299 243)',cloth(103,112,384,257,'paper',807))+g('rotate(6 311 234)',cloth(131,91,355,261,'paper',808)+rep(9,n=>p(`M159 ${120+n*25}h${286-(n%3)*31}`,'none','#8D8263',1.6)))+g('rotate(22 423 300)',band('M423 215V369','copper',8)+p('M414 369l9 25 9-25Z','#6C6C52','#555D48',1.3))+r(51,218,39,63,fill('copper'),5)
  default:throw new Error('未知书卷构造。')
 }
}

export const RITUAL_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Ritual-Collection-1'
export const RITUAL_COLLECTION_LICENSE = `Sceneweave Ritual Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG drawings for religious, occult, funerary and alchemical scene dressing, authored with coding assistance. No third-party artwork, map pixels or external sacred symbol designs are embedded. Geometric marks are original decorative symbols. Period/fantasy interpretations; no historical accuracy or supernatural capability is asserted. All devices and funerary fixtures are static decorative props. Images do not grant real light, magic, floor support, enterable tombs, traversable platforms or terrain holes. Technical validation, art review and user acceptance are separate.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const defs='<defs>'+Object.entries(colors).map(([id,[mid,dark,light]])=>`<linearGradient id="${id}" x1="0%" y1="0%" x2="84%" y2="100%"><stop offset="0%" stop-color="${light}"/><stop offset="23%" stop-color="${mid}"/><stop offset="74%" stop-color="${mid}"/><stop offset="100%" stop-color="${dark}"/></linearGradient>`).join('')+'</defs>'
function artwork(design:RitualDesign,index:number):VisualSampleArt {
 const ground=design.category==='magic-circle',small=['relic','potion','scroll-book'].includes(design.category),solid=design.category==='pulpit'
 const body=({altar,statue,sarcophagus,headstone,'offering-table':offering,pulpit,'alchemy-bench':alchemy,'crystal-device':crystalDevice,'magic-circle':magicCircle,relic,potion,'scroll-book':scrollBook}[design.category])(index)
 return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
  sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs}<g transform="scale(${design.widthMm/600} ${design.heightMm/480})">${body}</g></svg>`,
  footprintMm:{width:Math.round(design.widthMm*.92),height:Math.round(design.heightMm*.92)},blocksMovement:!ground&&!small,blocksSight:false,
  renderLayer:ground?'ground':'object',shadowClass:ground||small?'none':'furniture',
  tags:['原创','宗教魔法墓葬',design.category,design.era,design.design,'严格俯视','静态装饰','不产生真实魔法或发光',...(solid?['整片阻挡装饰','不授予站立支撑或可进入平台']:[]),...(design.category==='sarcophagus'?['封闭石棺装饰','不创建可进入墓穴']:[])]}
}
export const RITUAL_COLLECTION_ART:readonly VisualSampleArt[]=freezeJson(RITUAL_DESIGNS.map(design=>artwork(design,RITUAL_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
