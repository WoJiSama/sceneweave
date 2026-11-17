import { ARCHITECTURE_DESIGNS, type ArchitectureDesign } from '../assets/architecture-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

type Pt=readonly [number,number]
interface Tone {wood:string;light:string;dark:string;stone:string;stoneLight:string;metal:string;glass:string;aspect?:number}
const tones:readonly Tone[]=[
 ['#98764F','#CCAE78','#514332','#9B9C86','#CAC8AC','#8A8165','#BCCAB6'],['#9C7B50','#CEB37E','#57442E','#A6A18A','#D0C9AE','#94835E','#BECEC2'],
 ['#805F45','#B9986D','#46382C','#999987','#C9C5AE','#8B8067','#B5C6BD'],['#7F7059','#BAAA87','#4C4838','#A2A68C','#D3D1B7','#8C9275','#C4CEB5'],
 ['#8C6346','#C19A6C','#4E3B2C','#A29A84','#CFC4A6','#AE9768','#B9CDB9'],['#88694B','#BEA17B','#4D3D2F','#8D9989','#BDC7AC','#989575','#B6C7BE'],
 ['#795C44','#B49B73','#44372C','#97977E','#C5C1A0','#908775','#ACBFAE'],['#8B643F','#CBA774','#51392A','#A39D82','#CFC5A5','#BAA36D','#BFCDBB'],
 ['#8E9A70','#CED2A3','#4D6853','#A0AA91','#D0D2AF','#A4A77B','#C8D9BD'],['#78857A','#B6C3A5','#414F48','#839182','#B8C3A7','#B49D70','#ABC7BD'],
 ['#A3895E','#D2BC87','#63533A','#9C9F85','#C7CAAA','#B4A677','#C1D0BB'],['#7F7585','#BEB3CA','#4C465F','#8B9387','#BFC5AB','#B5A47D','#AFBDCF'],
 ['#8D7B5D','#C9B590','#4F4B3A','#A4A38C','#D1CBAF','#B2A47B','#C0CEB6'],['#7A6D71','#B9ABB2','#49404D','#A29C94','#CBC4B1','#B9A574','#C3C8BE'],
 ['#8D7253','#C6AC7E','#52402F','#9DA387','#C9CFAD','#BFA86F','#BAD0BE'],['#AA9588','#D9C8AA','#62595D','#A4AA93','#CED0B1','#BAA378','#BFCDBD'],
 ['#A28D60','#D5C391','#655A40','#A6AC96','#D6D8BC','#C8B279','#CCD6BF'],['#9CAFA6','#D4DCCD','#596F68','#A0ACA0','#D5DCC6','#9CAFA3','#BDCEC3'],
 ['#987B50','#CBB27D','#59462F','#A8A38A','#D5CCAD','#B0A075','#C5D1BE'],['#95745B','#CCB18E','#534336','#A2B1A0','#D0DCC4','#B6A576','#C4D9CE'],
 ['#665D62','#B5A28A','#393C43','#979F96','#CACFB9','#CCB686','#B8CEC3'],['#805F47','#BA9770','#46372B','#A09F8C','#CECBB0','#B6A073','#BDCDC0'],
 ['#9B8667','#CCBA9A','#5C5140','#ABB09F','#D8DBC1','#AFA584','#C9D8CB'],['#91755E','#D0BA9B','#554535','#A8B09E','#D6D9BD','#CBB88A','#C6D8CB'],
].map(([wood,light,dark,stone,stoneLight,metal,glass])=>({wood,light,dark,stone,stoneLight,metal,glass}))
const ink='#48483E',wood='url(#wood)',stone='url(#stone)',metal='url(#metal)',glass='url(#glass)'
const f=(n:number)=>Math.round(n*100)/100
const rep=(n:number,fn:(i:number)=>string)=>Array.from({length:n},(_,i)=>fn(i)).join('')
const p=(d:string,fill='none',stroke=ink,sw=2.6)=>d.trim()?`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`:''
const r=(x:number,y:number,w:number,h:number,fill:string,rad=0,stroke=ink,sw=2.6)=>`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const e=(x:number,y:number,rx:number,ry:number,fill:string,stroke=ink,sw=2.6)=>`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g=(x:number,y:number,body:string,a=0,s=1)=>`<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})">${body}</g>`
const path=(pts:readonly Pt[])=>pts.map(([x,y],n)=>`${n?'L':'M'}${f(x)} ${f(y)}`).join('')+'Z'
const poly=(pts:readonly Pt[],fill:string,stroke=ink,sw=2.6)=>p(path(pts),fill,stroke,sw)
const reg=(x:number,y:number,rx:number,ry:number,n=8,a=-90):Pt[]=>Array.from({length:n},(_,k)=>[x+rx*Math.cos((a+k*360/n)*Math.PI/180),y+ry*Math.sin((a+k*360/n)*Math.PI/180)] as Pt)
const oval=(x:number,y:number,rx:number,ry:number)=>reg(x,y,rx,ry,64,0)
const rect=(x:number,y:number,w:number,h:number):Pt[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
const arc=(x:number,y:number,rx:number,ry:number,inner:number,a:number,b:number,n=40):Pt[]=>[
 ...Array.from({length:n+1},(_,k)=>{const c=(a+(b-a)*k/n)*Math.PI/180;return [x+rx*Math.cos(c),y+ry*Math.sin(c)] as Pt}),
 ...Array.from({length:n+1},(_,k)=>{const c=(b-(b-a)*k/n)*Math.PI/180;return [x+rx*inner*Math.cos(c),y+ry*inner*Math.sin(c)] as Pt}),
]
const fibres=(pts:readonly Pt[],spacing:number,color:string,sw=1,a=0,wavy=false)=>{
 const aa=a*Math.PI/180,c=Math.cos(aa),s=Math.sin(aa),q=pts.map(([x,y])=>[x*c+y*s,-x*s+y*c]),lo=Math.min(...q.map(v=>v[1])),hi=Math.max(...q.map(v=>v[1]));let d=''
 for(let y=lo+spacing*.7,k=0;y<hi-spacing*.4;y+=spacing,k++){const xs:number[]=[];for(let j=0;j<q.length;j++){const u=q[j],v=q[(j+1)%q.length];if((u[1]<=y&&v[1]>y)||(v[1]<=y&&u[1]>y))xs.push(u[0]+(y-u[1])*(v[0]-u[0])/(v[1]-u[1]))}xs.sort((u,v)=>u-v);for(let j=0;j+1<xs.length;j+=2){const x=xs[j]+5,w=xs[j+1]-xs[j]-10;if(w<6)continue;d+=wavy?`M${f(x)} ${f(y)}q${f(w*.25)} ${k%2?1.4:-1.4} ${f(w*.5)} 0t${f(w*.5)} 0 `:`M${f(x)} ${f(y)}h${f(w)} `}}
 return `<g transform="rotate(${a})">${p(d,'none',color,sw)}</g>`
}
type Material='wood'|'stone'|'metal'|'woven'|'tile'|'thatch'
const stoneGrain=(pts:readonly Pt[],t:Tone)=>{
 const minX=Math.min(...pts.map(q=>q[0])),maxX=Math.max(...pts.map(q=>q[0])),minY=Math.min(...pts.map(q=>q[1])),maxY=Math.max(...pts.map(q=>q[1]))
 const inside=(x:number,y:number)=>{let yes=false;for(let k=0,j=pts.length-1;k<pts.length;j=k++){const a=pts[k],b=pts[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes}
 const specks=rep(43,k=>{const x=minX+7+((k*97+31)%997)/997*Math.max(0,maxX-minX-14),y=minY+7+((k*163+61)%991)/991*Math.max(0,maxY-minY-14);return inside(x-3,y)&&inside(x+4,y+2)?`M${f(x)} ${f(y)}l${k%3+1} ${k%2?1.4:-1.4} `:''})
 return `<g opacity=".32">${fibres(pts,73,t.stoneLight,1,21,true)}${fibres(pts,119,t.dark,.65,-17,true)}${p(specks,'none',t.dark,1.1)}</g>`
}
const texture=(pts:readonly Pt[],t:Tone,m:Material='wood')=>m==='wood'?`<g opacity=".62">${fibres(pts,10,t.light,1.3,0,true)}${fibres(pts,19,t.dark,.8,0,true)}</g>`:m==='woven'?fibres(pts,12,t.light,5,43)+fibres(pts,12,t.dark,4,-43)+fibres(pts,12,'#DED4AE',.8,43):m==='metal'?fibres(pts,65,t.light,1,90)+fibres(pts,67,t.dark,.6,90):m==='thatch'?fibres(pts,5,t.light,2,90,true)+fibres(pts,15,t.dark,1,90,true)+fibres(pts,53,t.dark,3,0):m==='stone'?stoneGrain(pts,t):fibres(pts,29,t.dark,2.8,0)+fibres(pts,43,t.stoneLight,1.4,90)
const face=(pts:readonly Pt[],t:Tone,m:Material='wood')=>poly(pts,m==='metal'?metal:m==='stone'||m==='tile'?stone:wood)+texture(pts,t,m)
const panel=(x:number,y:number,w:number,h:number,t:Tone,m:Material='wood')=>face(rect(x,y,w,h),t,m)
const bolt=(x:number,y:number,t:Tone,rad=5)=>e(x,y,rad,rad,t.metal,t.dark,1)+p(`M${x-rad*.5} ${y+rad*.3}l${rad} ${-rad*.6}`,'none',t.light,.8)
const rail=(d:string,t:Tone,w=18,iron=false)=>p(d,'none',ink,w+4)+p(d,'none',iron?t.metal:t.wood,w)+p(d,'none',t.light,1.3)
const rope=(d:string,t:Tone,w=8)=>p(d,'none',t.dark,w+3)+p(d,'none',t.light,w)+p(d,'none','#E0D4AD',1)
const beam=(a:Pt,b:Pt,t:Tone,w=28,m:Material='wood')=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);return g((a[0]+b[0])/2,(a[1]+b[1])/2,panel(-len/2,-w/2,len,w,t,m),Math.atan2(dy,dx)*180/Math.PI)}
const pins=(x:number,y:number,w:number,h:number,t:Tone)=>[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([u,v])=>bolt(u,v,t,5)).join('')
const boards=(x:number,y:number,w:number,h:number,t:Tone,n=6,vertical=false)=>rep(n,k=>panel(x+(vertical?k*w/n:0),y+(vertical?0:k*h/n),vertical?w/n-2:w,vertical?h:h/n-2,t))
const slats=(x:number,y:number,w:number,h:number,t:Tone,n=12,iron=false)=>rep(n,k=>panel(x,y+k*h/n,w,h/n*.68,t,iron?'metal':'wood'))
const grille=(x:number,y:number,w:number,h:number,t:Tone,nx=5,ny=5,diagonal=false)=>r(x,y,w,h,'none',2,t.wood,20)+(diagonal?fibres(rect(x+10,y+10,w-20,h-20),h/ny,t.light,8,45)+fibres(rect(x+10,y+10,w-20,h-20),h/ny,t.wood,8,-45):rep(nx-1,k=>rail(`M${x+(k+1)*w/nx} ${y+7}V${y+h-7}`,t,8))+rep(ny-1,k=>rail(`M${x+7} ${y+(k+1)*h/ny}H${x+w-7}`,t,8)))
const handle=(x:number,y:number,t:Tone)=>r(x-13,y-29,26,58,metal,5)+e(x,y+15,21,27,'none',t.dark,8)+e(x,y+15,21,27,'none',t.metal,5)
const hinge=(x:number,y:number,t:Tone,left=false)=>r(x-10,y-23,20,46,metal,4)+r(left?x:x-50,y-14,50,28,metal,3)+bolt(left?x+34:x-34,y,t,5)
const roundedDoor=(x:number,y:number,w:number,h:number,pointed=false):Pt[]=>pointed?[[x,y+h],[x,y+w*.45],[x+w/2,y],[x+w,y+w*.45],[x+w,y+h]]:Array.from({length:25},(_,n)=>[x+w/2+w/2*Math.cos(Math.PI+n*Math.PI/24),y+w/2+w/2*Math.sin(Math.PI+n*Math.PI/24)] as Pt).concat([[x+w,y+h],[x,y+h]])

function door(i:number,t:Tone):string{
 switch(i){
 case 0:return boards(105,63,390,474,t,5,true)+[167,423].map(y=>panel(89,y,422,43,t,'metal')+rep(7,n=>bolt(113+n*62,y+21,t))).join('')+handle(430,302,t)
 case 1:return boards(99,66,402,468,t,4,true)+beam([119,116],[481,484],t,31)+panel(108,104,384,36,t)+panel(108,460,384,36,t)+hinge(103,132,t,true)+hinge(103,470,t,true)+handle(449,296,t)
 case 2:return face(roundedDoor(96,58,408,480),t)+fibres(roundedDoor(111,74,378,450),61,t.dark,3,90)+[184,331,467].map(y=>rail(`M114 ${y}Q300 ${y-35} 486 ${y}`,t,22,true)+rep(7,n=>bolt(132+n*56,y-6,t,5))).join('')+handle(433,291,t)
 case 3:return face(roundedDoor(101,48,398,498,true),t)+fibres(roundedDoor(124,80,352,443,true),31,t.light,6,45)+fibres(roundedDoor(124,80,352,443,true),31,t.dark,4,-45)+r(110,221,28,258,metal,4)+hinge(109,240,t,true)+hinge(109,451,t,true)+poly(reg(440,304,30,42,4),metal)
 case 4:return panel(70,69,460,462,t)+[84,311].map(x=>panel(x,84,205,432,t)+panel(x+18,102,169,171,t)+panel(x+18,292,169,204,t)+r(x+6,94,193,412,'none',1,t.dark,5)).join('')+rail('M300 79V521',t,10)+hinge(75,151,t,true)+hinge(525,151,t)+hinge(75,449,t,true)+hinge(525,449,t)+handle(271,310,t)+handle(329,310,t)
 case 5:return grille(73,62,454,476,t,6,3)+panel(303,233,201,279,t)+panel(317,246,172,253,t)+rail('M308 244L489 493',t,17)+handle(463,364,t)+hinge(309,284,t,true)+hinge(309,453,t,true)
 case 6:return panel(98,62,404,476,t,'metal')+rep(6,n=>panel(112+n%2*192,76+Math.floor(n/2)*149,184,141,t,'metal')+pins(123+n%2*192,87+Math.floor(n/2)*149,162,119,t))+r(200,153,199,37,t.dark,4)+rail('M220 154V188M258 154V188M296 154V188M334 154V188M372 154V188',t,8,true)+handle(440,326,t)
 case 7:return panel(88,62,424,476,t)+[0,1].map(n=>fibres(rect(113+n*186,87,174,426),39,t.light,17,n?45:-45)).join('')+rail('M300 84V518',t,18)+handle(434,309,t)+hinge(96,152,t,true)+hinge(96,449,t,true)
 case 8:return face([[114,95],[232,57],[372,77],[490,134],[509,383],[475,528],[311,543],[128,511],[89,335]],t)+boards(142,137,316,349,t,5,true)+rail('M128 492Q94 235 157 104M453 506Q515 264 443 105',t,30)+rail('M418 245Q470 292 421 346',t,24)+bolt(128,213,t,9)+bolt(478,396,t,9)
 case 9:return panel(84,61,432,478,t,'stone')+rep(3,n=>face([[99,77+n*151],[490,89+n*151],[500,213+n*151],[112,220+n*151]],t,'stone'))+[[119,207],[476,219],[127,366],[472,377]].map(([x,y])=>r(x-16,y-34,32,68,metal,4)+bolt(x,y,t,6)).join('')+r(369,275,85,59,t.dark,7)
 case 10:return face(oval(300,300,219,243),t)+rep(9,n=>beam([300,300],[300+198*Math.cos(n*Math.PI/4.5),300+222*Math.sin(n*Math.PI/4.5)],t,35))+[127,223,377,473].map(y=>rail(`M${y===127||y===473?158:100} ${y}H${y===127||y===473?442:500}`,t,15,true)).join('')+handle(428,304,t)
 case 11:return panel(86,67,428,466,t)+[90,313].map(x=>face(roundedDoor(x,79,197,441),t)+panel(x+17,172,163,321,t,'woven')).join('')+rail('M302 83V515',t,17)+rope('M271 305q29-29 58 0q-29 29-58 0',t,7)+hinge(89,174,t,true)+hinge(511,435,t)
 case 12:return face([[133,57],[259,73],[397,57],[495,143],[477,320],[506,514],[345,544],[208,525],[99,538],[112,287],[87,139]],t)+p('M267 80L289 214 262 335 301 518','none',t.dark,6)+[209,390].map(y=>poly([[229,y],[258,y-17],[283,y],[311,y-17],[337,y],[309,y+17],[283,y],[255,y+17]],metal)).join('')+handle(439,303,t)
 case 13:return [73,229,385].map((x,n)=>panel(x,70,142,460,t)+panel(x+16,88,110,424,t)+hinge(x+141,168,t)+hinge(x+141,436,t)+r(x+8,79,126,442,'none',1,t.dark,4)).join('')+handle(491,307,t)
 case 14:return boards(90,60,420,480,t,6,true)+rep(5,n=>panel(112+n*83,70,20,460,t,'metal')+rep(6,k=>bolt(122+n*83,91+k*83,t,4)))+e(436,303,40,47,metal)+handle(436,303,t)
 case 15:return [75,310].map((x,n)=>face(roundedDoor(x,67,215,469),t)+face(roundedDoor(x+24,94,167,414),t,'stone')+handle(n?337:263,310,t)).join('')+hinge(78,210,t,true)+hinge(522,420,t)
 case 16:return panel(102,65,396,470,t)+rep(6,n=>panel(123+n%2*183,87+Math.floor(n/2)*145,171,130,t)+r(132+n%2*183,96+Math.floor(n/2)*145,153,112,'none',4,t.dark,4))+r(427,282,32,85,metal,7)+rail('M442 296V348',t,12,true)
 case 17:return panel(100,63,400,474,t)+r(124,88,352,244,glass,3)+grille(126,90,348,240,t,2,3)+panel(125,355,160,157,t)+panel(308,355,167,157,t)+rail('M432 369V424',t,14,true)+hinge(105,166,t,true)+hinge(105,456,t,true)
 case 18:return panel(91,61,418,478,t)+[112,136,160].map((a,n)=>r(a,a-42,600-2*a,684-2*a,'none',1,n%2?t.metal:t.dark,7)).join('')+poly([[207,161],[389,161],[420,435],[180,435]],t.wood)+rail('M441 252V358',t,19,true)
 case 19:return [75,314].map((x,n)=>face(roundedDoor(x,87,211,426),t)+slats(x+22,218,167,267,t,15)+hinge(n?527:73,261,t,!n)+hinge(n?527:73,449,t,!n)).join('')
 case 20:return boards(98,63,404,474,t,4,true)+e(300,190,85,85,metal)+e(300,190,65,65,glass)+r(117,401,366,107,metal,4)+rail('M425 307V364',t,15,true)+hinge(101,140,t,true)+hinge(101,350,t,true)
 case 21:return rail('M58 70H542',t,22,true)+[144,456].map(x=>r(x-27,76,54,48,metal,7)+e(x,81,21,21,t.dark)+e(x,81,12,12,metal)).join('')+boards(80,115,440,423,t,6,true)+beam([94,130],[505,518],t,23,'metal')+beam([94,518],[505,130],t,23,'metal')+handle(448,326,t)
 case 22:return panel(94,61,412,478,t,'metal')+rep(6,n=>panel(110+n%2*195,79+Math.floor(n/2)*148,185,137,t,'metal')+pins(121+n%2*195,90+Math.floor(n/2)*148,163,115,t))+rail('M159 300H452',t,20,true)+bolt(439,299,t,12)
 case 23:return grille(75,64,450,472,t,6,1)+fibres(rect(91,79,418,442),55,t.metal,11,40)+fibres(rect(91,79,418,442),55,t.metal,11,-40)+r(281,256,38,103,metal,4)+bolt(300,301,t,7)
 default:throw new Error('未知平放门扇。')
 }
}

const windowRect=(x:number,y:number,w:number,h:number,t:Tone,nx=2,ny=2,mat:Material='wood')=>panel(x,y,w,h,t,mat)+r(x+23,y+23,w-46,h-46,glass,2)+grille(x+20,y+20,w-40,h-40,t,nx,ny)
const windowShape=(pts:readonly Pt[],inner:readonly Pt[],t:Tone)=>face(pts,t)+poly(inner,glass)+fibres(inner,103,'#DEE8D6',3,-34)
function windowArt(i:number,t:Tone):string{
 switch(i){
 case 0:return windowRect(88,75,424,450,t)+pins(103,90,394,420,t)
 case 1:return panel(119,61,362,478,t,'stone')+r(227,95,146,410,t.dark,4)+r(243,108,114,382,'none',2,t.stoneLight,4)+p('M142 167H214M382 269H460M142 419H214','none',t.dark,4)
 case 2:return windowShape(roundedDoor(104,61,392,477),roundedDoor(130,91,340,422),t)+rail('M300 93V513M136 285H464',t,15)
 case 3:return windowShape(roundedDoor(95,50,410,490,true),roundedDoor(124,86,352,425,true),t)+fibres(roundedDoor(132,96,336,405,true),50,t.metal,6,45)+fibres(roundedDoor(132,96,336,405,true),50,t.metal,6,-45)+rail('M300 86V509',t,12)
 case 4:return face(oval(300,300,233,233),t,'stone')+e(300,300,195,195,glass)+rep(8,n=>g(300,300,rail('M0 0H191',t,13),n*45))+e(300,300,37,37,wood)+e(300,300,217,217,'none',t.stoneLight,7)
 case 5:return panel(63,79,474,442,t,'stone')+[84,314].map(x=>windowShape(roundedDoor(x,99,202,396),roundedDoor(x+22,127,158,341),t)+rail(`M${x+101} 132V490`,t,12)).join('')
 case 6:return windowRect(82,72,436,456,t,1,1)+fibres(rect(111,101,378,398),41,t.light,9,45)+fibres(rect(111,101,378,398),41,t.wood,8,-45)+pins(94,84,412,432,t)
 case 7:return windowRect(218,104,164,392,t,2,3)+boards(61,134,141,331,t,5)+boards(398,134,141,331,t,5)+[209,391].map(x=>hinge(x,206,t)+hinge(x,400,t)).join('')+rail('M76 169L187 432M413 169L524 432',t,14)
 case 8:return windowShape([[114,106],[254,66],[401,86],[502,199],[485,407],[375,525],[204,509],[91,398],[74,248]],[[143,135],[256,105],[382,120],[462,212],[449,389],[362,486],[222,472],[128,379],[112,253]],t)+rail('M130 235Q300 268 456 223M137 371Q300 336 446 379',t,19)+rail('M126 411Q69 250 132 112M441 456Q524 263 437 132',t,24)
 case 9:return face(reg(300,300,238,238,6),t,'stone')+poly(reg(300,300,197,197,6),glass)+rep(3,n=>g(300,300,rail('M0 0V-190',t,19,true),n*120))+bolt(300,300,t,18)
 case 10:return windowShape(oval(208,300,143,225),oval(208,300,116,194),t)+windowShape(oval(403,300,140,202),oval(403,300,113,174),t)+rail('M163 147Q250 306 434 456M148 425Q293 303 447 153',t,20)+bolt(301,304,t,9)
 case 11:return panel(70,85,460,430,t,'stone')+panel(88,66,418,458,t,'stone')+r(132,114,336,372,glass,3)+rail('M300 120V480M138 300H462',t,27,true)+pins(103,99,394,402,t)
 case 12:return [76,314].map(x=>face(roundedDoor(x,78,210,444),t)+poly(roundedDoor(x+24,110,162,386),t.dark)+texture(roundedDoor(x+24,110,162,386),t,'woven')).join('')+panel(281,233,38,165,t)+rope('M102 482Q300 532 498 482',t,8)
 case 13:return face(oval(300,300,208,244),t)+e(300,300,175,209,glass)+e(300,300,187,222,'none',t.light,8)+e(300,300,161,194,'none',t.metal,5)+rail('M127 300H473',t,17)+fibres(oval(300,300,156,188),111,'#E1EAD9',3,-33)
 case 14:return panel(57,99,486,402,t,'stone')+[76,244,412].map(x=>windowRect(x,118,112,364,t,1,3)).join('')+pins(66,110,468,380,t)
 case 15:return windowShape(roundedDoor(65,75,470,443),roundedDoor(92,104,416,388),t)+r(70,322,460,190,wood,1)+r(91,338,418,150,glass,1)+rep(7,n=>beam([300,493],[111+n*63,223-Math.sin(n*Math.PI/6)*94],t,14))+rail('M91 495H509',t,22)
 case 16:return windowRect(100,57,400,486,t,2,6)+panel(115,296,370,28,t)+r(275,285,50,48,metal,4)+bolt(300,308,t,6)
 case 17:return windowRect(76,67,448,466,t,4,3)+rail('M300 90V510',t,18)+rail('M271 285V348M329 285V348',t,11,true)
 case 18:return windowRect(75,67,450,466,t,2,3)+panel(86,214,428,28,t)+windowRect(93,82,414,125,t,3,1)+rail('M108 289L131 449M492 289L469 449',t,11,true)
 case 19:return windowRect(68,83,464,434,t,6,5,'metal')+pins(80,95,440,410,t)+bolt(75,300,t,11)+bolt(525,300,t,11)
 case 20:return face([[96,62],[504,62],[504,102],[538,102],[538,498],[504,498],[504,538],[96,538],[96,498],[62,498],[62,102],[96,102]],t,'stone')+windowRect(111,93,378,414,t,3,1)+rail('M205 111V489M395 111V489',t,8,true)
 case 21:return face(oval(300,300,226,226),t,'metal')+e(300,300,187,187,glass)+rep(16,n=>bolt(300+210*Math.cos(n*Math.PI/8),300+210*Math.sin(n*Math.PI/8),t,6))+r(68,237,48,126,metal,6)+r(484,266,48,68,metal,6)+fibres(oval(300,300,179,179),116,'#E1EADA',3,-32)
 case 22:return windowRect(216,76,168,448,t,1,3)+g(135,300,windowRect(-66,-191,132,382,t,1,3),-8)+g(465,300,windowRect(-66,-191,132,382,t,1,3),8)+[203,397].map(x=>hinge(x,167,t)+hinge(x,437,t)).join('')
 case 23:return windowRect(71,128,458,344,t,2,1,'metal')+rail('M83 300H517',t,17,true)+rail('M88 199L119 408M512 199L481 408',t,13,true)+pins(84,141,432,318,t)
 default:throw new Error('未知平放窗框。')
 }
}

const columnCap=(x:number,y:number,rad:number,t:Tone,square=false)=>square?panel(x-rad,y-rad,rad*2,rad*2,t,'stone')+panel(x-rad*.68,y-rad*.68,rad*1.36,rad*1.36,t,'stone')+panel(x-rad*.32,y-rad*.32,rad*.64,rad*.64,t,'stone'):face(oval(x,y,rad,rad),t,'stone')+e(x,y,rad*.77,rad*.77,'none',t.stoneLight,7)+e(x,y,rad*.43,rad*.43,stone)+e(x,y,rad*.32,rad*.32,'none',t.dark,2)
function column(i:number,t:Tone):string{
 switch(i){
 case 0:return columnCap(300,300,233,t)+e(300,300,197,197,'none',t.dark,3)+e(300,300,126,126,'none',t.stoneLight,5)
 case 1:return panel(71,71,458,458,t,'stone')+face(reg(300,300,206,206,8,22.5),t,'stone')+panel(214,214,172,172,t,'stone')
 case 2:return beam([85,300],[515,300],t,117)+beam([300,85],[300,515],t,117)+panel(190,190,220,220,t)+pins(211,211,178,178,t)+p('M201 201L399 399M201 399L399 201','none',t.dark,4)
 case 3:return face(reg(300,300,238,238),t,'stone')+face(reg(300,300,201,201),t,'stone')+face(reg(300,300,113,113),t,'stone')+rep(8,n=>g(300,300,p('M142-12L183-12','none',t.dark,3),n*45))
 case 4:return face([[171,70],[429,70],[429,171],[530,171],[530,429],[429,429],[429,530],[171,530],[171,429],[70,429],[70,171],[171,171]],t,'stone')+[[211,211],[389,211],[211,389],[389,389]].map(([x,y])=>columnCap(x,y,87,t)).join('')+panel(273,273,54,54,t,'stone')
 case 5:return face(oval(300,300,233,233),t,'tile')+e(300,300,202,202,'none',t.stoneLight,18)+columnCap(300,300,145,t)
 case 6:return face([[61,300],[122,137],[478,137],[539,300],[478,463],[122,463]],t,'stone')+panel(149,188,302,224,t,'stone')+p('M189 210H410M189 390H410','none',t.stoneLight,7)
 case 7:return face(oval(211,211,132,132),t,'stone')+face(oval(389,211,132,132),t,'stone')+face(oval(211,389,132,132),t,'stone')+face(oval(389,389,132,132),t,'stone')+panel(208,208,184,184,t,'stone')+p('M300 89V190M89 300H190M410 300H511M300 410V511','none',t.dark,13)
 case 8:return rep(5,n=>g(300,300,rail('M0 0Q-68-135 0-229',t,64)+p('M0-30Q-53-140 0-219','none',t.light,3),n*72))+face(oval(300,300,116,116),t)+e(300,300,79,79,'none',t.dark,3)+e(300,300,43,43,'none',t.dark,2)
 case 9:return face([[65,173],[430,92],[532,200],[481,481],[142,516]],t,'stone')+face([[103,108],[497,138],[512,420],[132,475]],t,'stone')+panel(190,189,220,222,t,'stone')+pins(167,156,266,277,t)
 case 10:return face(oval(300,300,225,225),t,'woven')+e(300,300,203,203,'none',t.light,15)+rep(4,n=>g(300,300,rope('M-26-209Q0-242 26-209',t,12),n*90))+face(oval(300,300,113,113),t)+e(300,300,74,74,'none',t.dark,3)
 case 11:return face(reg(300,300,225,225,8,22.5),t,'stone')+rep(4,n=>g(300,300,panel(-35,-233,70,161,t,'metal')+pins(-22,-217,44,120,t),n*90))+columnCap(300,300,101,t)
 case 12:return face(oval(183,300,129,201),t,'stone')+face(oval(417,300,129,201),t,'stone')+panel(155,225,290,150,t,'stone')+columnCap(183,300,88,t)+columnCap(417,300,88,t)
 case 13:return face(reg(300,300,237,237,8,22.5),t)+rep(8,n=>{const a=n*Math.PI/4,b=a+.7;return poly([[300,300],[300+193*Math.cos(a),300+193*Math.sin(a)],[300+193*Math.cos(b),300+193*Math.sin(b)]],n%2?t.stone:t.metal,t.dark,4)})+panel(229,229,142,142,t,'stone')
 case 14:return rep(3,n=>g(300,300,panel(-44,-226,88,229,t,'stone')+columnCap(0,-193,53,t,true),n*120))+columnCap(300,300,106,t)
 case 15:return face(arc(300,300,232,232,.55,0,360,64),t,'stone')+rep(4,n=>g(300,300,panel(-15,-231,30,134,t,'metal'),n*90))+columnCap(300,300,108,t)
 case 16:return columnCap(300,300,231,t)+rep(28,n=>g(300,300,p('M153 0H216','none',n%2?t.dark:t.stoneLight,3),n*360/28))+e(300,300,131,131,stone)
 case 17:return [72,105,138,174].map((x,n)=>panel(x,x,600-x*2,600-x*2,t,'stone')+(n<3?pins(x+12,x+12,576-x*2,576-x*2,t):'')).join('')
 case 18:return face(reg(300,300,226,226,8,22.5),t,'metal')+[[115,115],[485,115],[115,485],[485,485]].map(([x,y])=>r(x-34,y-34,68,68,metal,13)+bolt(x,y,t,14)).join('')+rail('M115 115L485 485M485 115L115 485',t,49,true)+columnCap(300,300,114,t)
 case 19:return panel(76,76,448,448,t,'tile')+r(103,103,394,394,'none',25,t.stoneLight,17)+panel(207,207,186,186,t,'stone')
 case 20:return face([[210,70],[390,70],[390,210],[530,210],[530,390],[390,390],[390,530],[210,530],[210,390],[70,390],[70,210],[210,210]],t,'metal')+rep(4,n=>g(300,300,panel(-35,-216,70,180,t,'metal')+rep(4,k=>bolt(0,-194+k*39,t,7)),n*90))+poly([[249,224],[351,224],[351,249],[319,249],[319,351],[351,351],[351,376],[249,376],[249,351],[281,351],[281,249],[249,249]],t.dark)
 case 21:return face(oval(300,300,242,202),t,'stone')+e(300,300,208,168,'none',t.metal,9)+face(oval(300,300,171,134),t,'stone')+face(oval(300,300,96,74),t,'stone')
 case 22:return face(reg(300,300,231,216,8,22.5),t,'stone')+rep(4,n=>g(300,300,r(-29,-231,58,99,metal,6)+bolt(0,-207,t,11),n*90))+columnCap(300,300,117,t)
 case 23:return panel(62,115,476,370,t,'stone')+columnCap(184,300,111,t)+columnCap(416,300,111,t)+rep(18,n=>g(184,300,p('M82 0H105','none',t.dark,2),n*20)+g(416,300,p('M82 0H105','none',t.dark,2),n*20))+rail('M300 130V470',t,6,true)
 default:throw new Error('未知柱顶结构。')
 }
}

/** Counter the image aspect ratio so top-view post caps stay physically round or square. */
const post=(x:number,y:number,t:Tone,rad=22,square=false,m:Material='wood')=>{
 const ry=rad*(t.aspect??1),pts=square?rect(x-rad,y-ry,rad*2,ry*2):oval(x,y,rad,ry)
 return face(pts,t,m)+e(x,y,rad*.42,ry*.42,m==='stone'?t.stoneLight:m==='metal'?t.metal:t.light,t.dark,1.4)+bolt(x,y,t,Math.min(5,rad*.2))
}
const chain=(pts:readonly Pt[],t:Tone,w=25,m:Material='wood')=>pts.slice(1).map((b,k)=>beam(pts[k],b,t,w,m)).join('')
function archArt(i:number,t:Tone):string{
 switch(i){
 case 0:return chain([[104,300],[496,300]],t,83)+post(104,300,t,59,true)+post(496,300,t,59,true)+pins(88,226,424,148,t)
 case 1:return panel(91,217,418,166,t,'stone')+rep(7,n=>panel(105+n*56,226,53,148,t,'stone'))+post(104,300,t,64,true,'stone')+post(496,300,t,64,true,'stone')+panel(274,211,52,178,t,'stone')
 case 2:return face(oval(103,300,63,176),t,'stone')+face(oval(497,300,63,176),t,'stone')+panel(100,245,400,110,t,'stone')+post(103,300,t,51,false,'stone')+post(497,300,t,51,false,'stone')
 case 3:return beam([112,300],[488,300],t,115)+[111,489].map(x=>panel(x-28,84,56,432,t)+panel(x-48,221,96,158,t)+bolt(x,243,t,10)+bolt(x,357,t,10)).join('')+panel(65,270,470,60,t)
 case 4:return panel(85,248,430,104,t)+[88,300,512].map(x=>post(x,300,t,40,true,'stone')).join('')+panel(178,241,26,118,t,'metal')+panel(396,241,26,118,t,'metal')
 case 5:return panel(90,209,420,182,t,'tile')+rail('M103 215H497M103 385H497',t,17)+post(98,300,t,57,true,'stone')+post(502,300,t,57,true,'stone')
 case 6:return [113,487].map(x=>panel(x-38,91,76,371,t,'stone')).join('')+panel(89,244,422,115,t,'stone')+post(113,300,t,65,true,'stone')+post(487,300,t,65,true,'stone')
 case 7:return face([[62,255],[139,205],[461,205],[538,255],[529,363],[71,363]],t)+post(121,300,t,52,true)+post(479,300,t,52,true)+p('M173 224Q300 254 427 224M173 344Q300 313 427 344','none',t.dark,5)+pins(162,271,276,58,t)
 case 8:return rail('M82 466Q139 245 177 216Q300 106 423 216Q461 245 518 466',t,57)+rail('M120 409Q142 482 81 516M480 409Q458 482 519 516',t,39)+post(134,347,t,45,false)+post(466,347,t,45,false)+p('M149 380Q154 244 206 209M451 380Q446 244 394 209','none',t.light,4)
 case 9:return [103,497].map(x=>face([[x-50,144],[x+43,127],[x+63,424],[x-41,468]],t,'stone')).join('')+face([[66,247],[229,218],[391,241],[530,211],[531,361],[369,384],[215,359],[72,391]],t,'stone')+panel(255,233,90,142,t,'metal')
 case 10:return rail('M101 253H499M101 347H499',t,33)+[108,492].map(x=>face(arc(x,300,57,168,.65,0,360),t)).join('')+[[143,249],[457,249],[143,351],[457,351]].map(([x,y])=>rope(`M${x-10} ${y-20}l20 40m-20-27 20 40`,t,8)).join('')
 case 11:return [106,494].map(x=>post(x,300,t,54,true,'stone')).join('')+rail('M104 238H496M104 362H496',t,37,true)+rep(7,n=>panel(147+n*45,224,25,152,t,'metal')+bolt(159+n*45,245,t,5)+bolt(159+n*45,356,t,5))
 case 12:return chain([[95,392],[300,238],[505,392]],t,71,'stone')+[[95,392],[300,238],[505,392]].map(([x,y])=>post(x,y,t,48,true,'stone')).join('')+pins(196,285,207,61,t)
 case 13:return rail('M92 269Q300 154 508 269M92 331Q300 446 508 331',t,34)+face([[99,279],[300,205],[501,279],[501,321],[300,395],[99,321]],t,'woven')+post(110,300,t,47,false)+post(490,300,t,47,false)
 case 14:return panel(74,239,452,122,t,'stone')+panel(122,213,356,174,t,'stone')+post(106,300,t,62,true,'stone')+post(494,300,t,62,true,'stone')+panel(286,203,28,194,t,'metal')
 case 15:return rep(3,n=>g(300,300,beam([0,0],[0,-211],t,76)+post(0,-211,t,49,true),n*120))+post(300,300,t,68,false,'stone')
 case 16:return panel(73,234,454,132,t,'stone')+rail('M106 238H494M106 362H494',t,10,true)+[106,494].map(x=>post(x,300,t,62,true,'stone')+r(x-43,188,86,224,'none',2,t.metal,5)).join('')
 case 17:return rail('M90 215H510M90 385H510',t,32,true)+panel(90,286,420,28,t,'metal')+rep(7,n=>beam([123+n*53,236],[173+n*53,364],t,13,'metal'))+[90,510].map(x=>post(x,300,t,43,true,'metal')).join('')
 case 18:return panel(75,246,450,108,t,'stone')+[109,491].map(x=>post(x,300,t,59,true,'tile')).join('')+pins(140,264,320,72,t)
 case 19:return face(arc(300,420,246,236,.55,200,340),t,'stone')+post(77,339,t,49,false,'stone')+post(523,339,t,49,false,'stone')+p('M100 326Q300 113 500 326','none',t.metal,8)
 case 20:return rail('M84 255H516M84 345H516',t,27,true)+[84,300,516].map(x=>post(x,300,t,39,false,'stone')).join('')+rep(7,n=>bolt(114+n*62,255,t,5)+bolt(114+n*62,345,t,5))
 case 21:return panel(71,221,458,158,t,'stone')+[107,493].map(x=>post(x,300,t,58,true,'stone')+r(x-44,199,88,202,'none',2,t.metal,9)).join('')+p('M192 241H408M192 358H408','none',t.stoneLight,8)
 case 22:return r(91,226,418,148,glass,3)+rail('M88 226H512M88 374H512',t,16,true)+[103,497].map(x=>post(x,300,t,50,true,'metal')).join('')+rep(5,n=>r(163+n*68,217,22,166,metal,3)+bolt(174+n*68,241,t,5)+bolt(174+n*68,360,t,5))
 case 23:return chain([[109,490],[109,109],[491,109]],t,88,'stone')+[[109,490],[109,109],[491,109]].map(([x,y])=>post(x,y,t,51,true,'stone')).join('')+rail('M94 428V94H428',t,9,true)+panel(76,274,66,33,t,'metal')+panel(274,76,33,66,t,'metal')
 default:throw new Error('未知顶视门架。')
 }
}

const straightFence=(t:Tone,n=5,material:Material='wood',rad=17,double=true)=>
 rail('M72 264H528'+(double?'M72 336H528':''),t,19,material==='metal')+rep(n,k=>post(75+k*450/(n-1),300,t,rad,k%2===0,material))
const curvePosts=(pts:readonly Pt[],t:Tone,rad=18,m:Material='wood')=>chain(pts,t,23,m)+pts.map(([x,y])=>post(x,y,t,rad,false,m)).join('')
function fence(i:number,t:Tone):string{
 switch(i){
 case 0:return straightFence(t,5,'wood',19)+rep(5,n=>bolt(75+n*112.5,264,t,5)+bolt(75+n*112.5,336,t,5))
 case 1:return rail('M68 278H532M68 322H532',t,31)+rep(22,n=>panel(69+n*21.2,221+n%3*7,18,150-n%3*12,t))+rep(6,n=>rope(`M${83+n*85} 245v107`,t,7))
 case 2:return face(rect(75,229,450,142),t,'woven')+straightFence(t,5,'wood',17,false)
 case 3:return rope('M77 238Q300 279 523 238M77 362Q300 321 523 362',t,11)+rep(5,n=>post(76+n*112,300,t,18,false))
 case 4:return panel(66,193,468,214,t,'stone')+rep(12,n=>face([[72+n%6*77,204+Math.floor(n/6)*100],[142+n%6*77,199+Math.floor(n/6)*100],[147+n%6*77,292+Math.floor(n/6)*100],[77+n%6*77,301+Math.floor(n/6)*100]],t,'stone'))
 case 5:return chain([[105,498],[105,112],[495,112]],t,49)+[[105,498],[105,305],[105,112],[302,112],[495,112]].map(([x,y])=>post(x,y,t,24,true)).join('')+chain([[130,496],[130,136],[495,136]],t,13)
 case 6:return rep(19,n=>post(75+n*25,245+(n%2)*9,t,12,false)+post(75+n*25,355-(n%2)*9,t,12,false))+rope('M72 248H528M72 352H528M74 299H526',t,12)
 case 7:return panel(67,223,466,154,t,'tile')+rail('M69 229H531M69 371H531',t,17)+rep(3,n=>post(77+n*223,300,t,31,true,'stone'))
 case 8:return rail('M63 359Q184 157 306 294Q414 425 539 251M65 403Q197 211 307 343Q416 474 537 296',t,26)+[[79,357],[191,256],[302,318],[420,374],[526,291]].map(([x,y])=>post(x,y,t,21,false)).join('')+p('M102 337l-26-89M486 331l43 85','none',t.wood,17)
 case 9:return panel(74,246,452,108,t,'stone')+rep(6,n=>face(reg(76+n*89.6,300,31,128,6,0),t,'stone'))+rail('M76 247H524M76 353H524',t,10,true)
 case 10:return rope('M76 229Q190 365 300 237Q408 365 524 229M76 371Q190 235 300 363Q408 235 524 371M76 300H524',t,15)+rep(4,n=>post(76+n*149.3,300,t,24,false))
 case 11:return rail('M71 235H529M71 365H529',t,29,true)+rep(4,n=>post(76+n*149.3,300,t,28,true,'stone'))+rep(7,n=>panel(100+n*62,226,24,148,t,'metal')+bolt(112+n*62,245,t,5)+bolt(112+n*62,356,t,5))
 case 12:return curvePosts(Array.from({length:9},(_,n)=>[75+n*56.25,350-Math.sin(n*Math.PI/8)*187] as Pt),t,17)+p('M75 399Q300 32 525 399','none',t.wood,14)
 case 13:return chain([[70,385],[279,385],[321,215],[530,215]],t,112,'stone')+post(300,300,t,35,true,'stone')+p('M72 349H260M340 250H526','none',t.metal,7)
 case 14:return face(rect(73,242,454,116),t,'woven')+rep(4,n=>face(oval(76+n*149.3,300,29,157),t,'woven')+e(76+n*149.3,300,21,137,'none',t.light,7))
 case 15:return straightFence(t,4,'wood',20)+rep(4,n=>panel(61+n*149,169,32,262,t)+panel(46+n*149,226,62,148,t)+bolt(77+n*149,243,t,9)+bolt(77+n*149,357,t,9))
 case 16:return straightFence(t,6,'metal',16)+rep(24,n=>panel(80+n*19,242,8,116,t,'metal'))+rep(6,n=>bolt(75+n*90,264,t,5)+bolt(75+n*90,336,t,5))
 case 17:return rail('M68 263H532M68 337H532',t,18)+rep(25,n=>panel(69+n*18.5,236,15,128,t))+rep(4,n=>post(73+n*151.3,300,t,20,true))
 case 18:return face(rect(75,230,450,140),t,'woven')+straightFence(t,5,'metal',16)+rep(9,n=>bolt(78+n*55,234,t,4)+bolt(78+n*55,367,t,4))
 case 19:return rail('M75 248H171V276H226V300H374V276H429V248H525M75 352H171V324H226V300H374V324H429V352H525',t,19,true)+rep(4,n=>post(77+n*148.7,300,t,26,true,'stone'))
 case 20:return rep(4,n=>panel(79+n*110.5,239,108,122,t,'stone'))+rep(5,n=>post(77+n*111.5,300,t,21,true,'stone'))+rail('M83 248H517M83 352H517',t,8,true)
 case 21:return rep(20,n=>e(80+n*23,248,17,28,'none',t.dark,8)+e(80+n*23,248,17,28,'none',t.metal,5)+e(80+n*23,352,17,28,'none',t.dark,8)+e(80+n*23,352,17,28,'none',t.metal,5))+rep(4,n=>post(76+n*149.3,300,t,23,false,'metal'))
 case 22:return curvePosts([[72,402],[176,312],[300,229],[426,241],[530,297]],t,18,'metal')+chain([[72,444],[176,354],[300,271],[426,283],[530,339]],t,18)
 case 23:return [78,312].map(x=>panel(x,225,211,150,t,'metal')+panel(x+13,239,185,122,t,'woven')).join('')+rep(3,n=>post(76+n*224,300,t,24,true,'metal'))+pins(96,243,408,114,t)
 default:throw new Error('未知围栏。')
 }
}

function railing(i:number,t:Tone):string{
 switch(i){
 case 0:return straightFence(t,4,'wood',20)+rail('M62 247H538M62 353H538',t,26)
 case 1:return straightFence(t,7,'wood',14)+panel(64,238,472,26,t)
 case 2:return rope('M74 234Q300 382 526 234M74 366Q300 218 526 366M74 300H526',t,12)+rep(4,n=>post(76+n*149.3,300,t,20,false))
 case 3:return panel(66,217,468,166,t,'stone')+p('M78 247H522M78 353H522','none',t.stoneLight,12)+rep(3,n=>post(82+n*218,300,t,31,true,'stone'))
 case 4:return grille(70,208,460,184,t,8,1,true)+rep(4,n=>post(77+n*149,300,t,18,true))+rail('M67 219H533',t,28)
 case 5:return chain([[107,493],[107,107],[493,107]],t,48)+[[107,493],[107,107],[493,107]].map(([x,y])=>post(x,y,t,30,true)).join('')+chain([[137,491],[137,137],[491,137]],t,15)
 case 6:return curvePosts(Array.from({length:7},(_,n)=>[73+n*75.7,371-Math.sin(n*Math.PI/6)*210] as Pt),t,20,'stone')+p('M73 411Q300-6 527 411','none',t.stoneLight,15)
 case 7:return boards(72,183,456,234,t,5)+rail('M63 193H537M63 407H537',t,30)+post(76,300,t,31,true)+post(524,300,t,31,true)
 case 8:return rail('M69 253Q192 180 302 269Q424 365 531 271M69 343Q192 270 302 359Q424 455 531 361',t,30)+rep(5,n=>post(76+n*112,288+(n%3)*27,t,22,false))+p('M72 337l-16 87M520 299l24-87','none',t.wood,15)
 case 9:return panel(74,232,452,136,t,'stone')+rep(4,n=>face(reg(77+n*148.7,300,31,143,8,22.5),t,'stone'))+p('M100 255H500M100 345H500','none',t.metal,8)
 case 10:return rope('M76 248Q188 345 300 247Q412 345 524 248M76 352Q188 255 300 353Q412 255 524 352',t,18)+rep(4,n=>face(arc(76+n*149.3,300,27,149,.61,0,360),t))+rail('M75 300H525',t,9,true)
 case 11:return rail('M71 241H529M71 359H529',t,31,true)+panel(61,219,478,34,t)+rep(3,n=>post(76+n*224,300,t,28,true,'metal'))+rep(8,n=>bolt(102+n*56,244,t,5)+bolt(102+n*56,359,t,5))
 case 12:return face(arc(300,460,246,285,.63,199,341),t)+rep(5,n=>{const a=(199+n*35.5)*Math.PI/180;return post(300+246*Math.cos(a),460+285*Math.sin(a),t,22,true)})+p('M70 365Q300 15 530 365','none',t.light,4)
 case 13:return curvePosts([[74,420],[224,270],[374,365],[526,174]],t,28,'stone')+chain([[74,456],[224,306],[374,401],[526,210]],t,18,'stone')
 case 14:return face([[72,216],[300,166],[528,216],[528,384],[300,434],[72,384]],t,'woven')+rail('M72 208Q300 109 528 208M72 392Q300 491 528 392',t,24)+post(79,300,t,27,false)+post(521,300,t,27,false)
 case 15:return rep(3,n=>g(300,300,rail('M0 0V-210',t,29)+post(0,-211,t,25,true),n*120))+post(300,300,t,37,false)
 case 16:return straightFence(t,5,'metal',15)+rail('M64 245H536M64 355H536',t,18,true)+rep(5,n=>e(75+n*112.5,300,11,66,'none',t.metal,8))
 case 17:return grille(72,232,456,136,t,15,1)+rail('M66 226H534M66 374H534',t,18,true)+post(76,300,t,19,true,'metal')+post(524,300,t,19,true,'metal')
 case 18:return panel(62,224,476,47,t)+panel(62,329,476,47,t)+rep(4,n=>face([[57+n*149,195],[94+n*149,195],[94+n*149,233],[111+n*149,233],[111+n*149,367],[94+n*149,367],[94+n*149,405],[57+n*149,405]],t,'stone')+panel(68+n*149,247,23,106,t,'metal'))
 case 19:return [79,191,303,415].map(x=>r(x,248,107,104,glass,1)+p(`M${x+8} 265l83 68`,'none','#DEE6D4',3)).join('')+rep(5,n=>post(77+n*111.5,300,t,15,true,'metal'))+panel(65,233,470,26,t)
 case 20:return rail('M72 235H528M72 300H528M72 365H528',t,6,true)+rep(5,n=>post(76+n*112,300,t,19,false,'metal'))+pins(74,235,452,130,t)
 case 21:return curvePosts(Array.from({length:7},(_,n)=>[73+n*75.7,384-Math.sin(n*Math.PI/6)*214] as Pt),t,15,'metal')+p('M73 427Q300 0 527 427','none',t.metal,13)+p('M73 382Q300-46 527 382','none',t.wood,14)
 case 22:return [77,312].map(x=>panel(x,216,211,168,t,'metal')+panel(x+12,228,187,144,t,'woven')).join('')+rep(3,n=>post(76+n*224,300,t,24,true,'metal'))+rail('M65 208H535',t,28,true)
 case 23:return chain([[105,495],[105,109],[495,109],[495,495]],t,29,'metal')+[[105,495],[105,109],[495,109],[495,495]].map(([x,y])=>post(x,y,t,23,true,'metal')).join('')+chain([[136,493],[136,141],[464,141],[464,493]],t,12,'metal')
 default:throw new Error('未知栏杆。')
 }
}

const run=(x:number,y:number,w:number,h:number,n:number,t:Tone,m:Material='wood',grated=false)=>{
 const step=h/n
 return panel(x-15,y-8,w+30,h+16,t,m)+rep(n,k=>panel(x,y+k*step,w,step-3,t,m)+(grated?r(x+7,y+k*step+5,w-14,step-12,'none',1,t.dark,2)+rep(7,j=>r(x+17+j*(w-34)/7,y+k*step+8,(w-34)/10,Math.max(4,step-18),t.dark,1,'none',0)):p(`M${x+7} ${y+(k+1)*step-6}H${x+w-7}`,'none',m==='stone'||m==='tile'?t.stoneLight:t.light,3)))
}
const stairRails=(x:number,y:number,w:number,h:number,t:Tone,iron=false)=>rail(`M${x} ${y}V${y+h}M${x+w} ${y}V${y+h}`,t,17,iron)+[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([u,v])=>post(u,v,t,10,true,iron?'metal':'wood')).join('')
const spiralSteps=(t:Tone,n=12,iron=false,polygonal=false)=>face(arc(300,300,235,235,.2,0,360,polygonal?8:64),t,iron?'metal':'stone')+rep(n,k=>face(arc(300,300,223,223,.22,k*360/n+1,(k+1)*360/n-1,polygonal?1:5),t,iron?'metal':'stone')+(iron?g(300,300,rep(5,j=>p(`M${69+j*28}-9l8-22`,'none',t.dark,5)),(k+.5)*360/n):''))+e(300,300,56,56,iron?metal:stone)+e(300,300,230,230,'none',iron?t.metal:t.stoneLight,8)
function stairs(i:number,t:Tone):string{
 switch(i){
 case 0:return run(142,77,316,401,9,t)+panel(120,481,360,54,t)+stairRails(128,73,344,454,t)
 case 1:return run(130,65,340,470,10,t,'stone')+stairRails(111,67,378,466,t)
 case 2:return rail('M165 65V535M435 65V535',t,37)+rep(10,n=>panel(157,91+n*45,286,20,t)+rope(`M164 ${91+n*45}v24M436 ${91+n*45}v24`,t,6))
 case 3:return run(76,146,448,330,6,t,'stone')+panel(68,73,464,76,t,'stone')+post(70,300,t,23,true,'stone')+post(530,300,t,23,true,'stone')
 case 4:return run(80,275,182,248,6,t)+g(523,80,run(0,0,182,248,6,t),90)+panel(80,80,182,197,t)+rail('M66 514V65H514M275 514V275H514',t,17)
 case 5:return spiralSteps(t)+panel(257,68,86,61,t,'stone')
 case 6:return run(139,65,322,184,4,t,'stone')+panel(122,251,356,99,t,'stone')+run(139,353,322,181,4,t,'stone')+stairRails(113,67,374,466,t)
 case 7:return rep(8,n=>face([[121+(n%3)*13,68+n*59],[469-(n%2)*17,62+n*59],[486-(n%3)*11,113+n*59],[108+(n%2)*17,121+n*59]],t,'stone'))+rail('M110 79V525M490 79V525',t,16)
 case 8:return rail('M118 70Q91 278 135 534M482 70Q509 278 465 534',t,29)+rep(9,n=>face([[127,75+n*50],[462,71+n*50],[474,116+n*50],[136,122+n*50]],t)+bolt(144,96+n*50,t,7)+bolt(453,95+n*50,t,7))
 case 9:return panel(125,58,350,485,t,'stone')+rep(10,n=>face([[113+(n%3)*13,69+n*46],[476-(n%2)*17,63+n*46],[488-(n%3)*11,106+n*46],[126+(n%2)*17,113+n*46]],t,'stone')+rail(`M141 ${105+n*46}H460`,t,5,true))
 case 10:return run(142,72,316,456,9,t)+rope('M121 65Q103 300 121 535M479 65Q497 300 479 535',t,17)+[[121,73],[479,73],[121,527],[479,527]].map(([x,y])=>post(x,y,t,18,true)).join('')+rep(9,n=>rope(`M121 ${96+n*50}l29 13M479 ${96+n*50}l-29 13`,t,7))
 case 11:return face(arc(70,530,463,463,.19,270,360),t,'stone')+rep(10,n=>face(arc(70,530,453,453,.19,271+n*8.8,278.5+n*8.8,5),t,'stone'))+p('M72 73A457 457 0 0 1 527 530','none',t.stoneLight,12)+panel(72,431,95,95,t,'stone')
 case 12:return run(217,318,166,214,5,t)+panel(192,209,216,107,t)+g(87,100,run(0,0,154,225,5,t),-25)+g(367,46,run(0,0,154,225,5,t),25)+rail('M217 518V318M383 518V318',t,19)
 case 13:return spiralSteps(t,8,false,true)+face(reg(300,300,61,61,4,45),t,'stone')
 case 14:return [0,1,2].map(n=>face([[68+n*59,91+n*63],[532-n*59,91+n*63],[532-n*59,529-n*9],[68+n*59,529-n*9]],t,'stone')+p(`M${86+n*59} ${115+n*63}H${514-n*59}`,'none',t.metal,7)).join('')+run(224,290,152,210,5,t,'stone')
 case 15:return run(77,183,181,350,8,t,'stone')+run(342,183,181,350,8,t,'stone')+panel(65,69,470,115,t,'stone')+panel(279,184,42,349,t,'stone')+rail('M65 518V62H535V518',t,15,true)
 case 16:return run(132,64,336,471,12,t)+panel(202,68,196,463,t,'woven')+rep(12,n=>rail(`M198 ${95+n*38.5}H402`,t,7,true))+stairRails(112,67,376,466,t)
 case 17:return run(135,65,330,470,12,t,'metal',true)+stairRails(112,67,376,466,t,true)+rep(8,n=>bolt(113,96+n*59,t,7)+bolt(487,96+n*59,t,7))
 case 18:return run(116,67,368,466,10,t,'tile')+stairRails(96,69,408,462,t)+pins(99,87,402,426,t)
 case 19:return face(arc(300,510,239,440,.19,188,352,40),t,'stone')+rep(7,n=>{const scale=1-n*.11;return face(arc(300,510,239*scale,440*scale,(scale-.1)/scale,188,352,30),t,'stone')})+face(arc(300,510,239,440,.975,188,352,40),t,'metal')+post(68,449,t,21,true,'stone')+post(532,449,t,21,true,'stone')
 case 20:return run(139,64,322,162,4,t)+panel(111,229,378,135,t)+run(139,367,322,168,4,t)+stairRails(101,67,398,466,t)
 case 21:return run(79,278,188,244,6,t,'metal',true)+g(522,79,run(0,0,188,244,6,t,'metal',true),90)+panel(77,77,192,201,t,'metal')+rail('M66 511V65H511M282 511V282H511',t,15,true)+pins(94,96,150,150,t)
 case 22:return spiralSteps(t,13,true)+rep(13,n=>g(300,300,bolt(194,0,t,5),(n+.5)*360/13))
 case 23:return run(76,183,181,349,9,t,'stone')+run(343,183,181,349,9,t,'stone')+panel(66,67,468,116,t,'stone')+panel(281,185,38,346,t,'stone')+p('M95 199H238M362 199H505','none',t.metal,7)+rail('M65 520V61H535V520',t,14,true)
 default:throw new Error('未知楼梯外观。')
 }
}

const bridgeRails=(x:number,y:number,w:number,h:number,t:Tone,iron=false,n=3)=>rail(`M${x} ${y}V${y+h}M${x+w} ${y}V${y+h}`,t,17,iron)+rep(n,k=>post(x,y+k*h/(n-1),t,13,true,iron?'metal':'wood')+post(x+w,y+k*h/(n-1),t,13,true,iron?'metal':'wood'))
const plankDeck=(x:number,y:number,w:number,h:number,t:Tone,n=14)=>panel(x,y,w,h,t)+boards(x+6,y+5,w-12,h-10,t,n)
function bridge(i:number,t:Tone):string{
 switch(i){
 case 0:return plankDeck(124,64,352,472,t,13)+bridgeRails(114,65,372,470,t,false,2)+rep(13,n=>bolt(140,78+n*36,t,4)+bolt(460,78+n*36,t,4))
 case 1:return rep(6,n=>face(oval(151+n*60,300,28,236-(n%3)*6),t))+rope('M126 101H475M126 300H475M126 499H475',t,13)+pins(140,90,320,420,t)
 case 2:return panel(102,70,396,460,t,'stone')+panel(85,67,33,466,t,'stone')+panel(482,67,33,466,t,'stone')+bridgeRails(91,77,418,446,t,false,2)+[[92,80],[508,80],[92,520],[508,520]].map(([x,y])=>post(x,y,t,22,true,'stone')).join('')
 case 3:return plankDeck(146,63,308,474,t,20)+rope('M122 65Q89 300 122 535M478 65Q511 300 478 535',t,18)+rep(10,n=>rope(`M122 ${82+n*48}l29 13M478 ${82+n*48}l-29 13`,t,6))+bridgeRails(123,66,354,468,t,false,2)
 case 4:return rep(3,n=>face([[120,68+n*157],[471,74+n*157],[479,212+n*157],[128,221+n*157]],t,'stone'))+rail('M112 76V524M488 76V524',t,20)+pins(126,92,348,416,t)
 case 5:return panel(95,64,410,472,t)+rep(4,n=>boards(104,70+n*115,392,109,t,4))+rail('M106 176H494M106 300H494M106 424H494',t,24)+bridgeRails(86,68,428,464,t,false,3)
 case 6:return face([[153,62],[444,62],[497,185],[514,329],[463,538],[126,538],[177,325],[170,192]],t,'stone')+rail('M151 68Q254 304 125 531M444 68Q548 304 463 531',t,24)+[[153,73],[444,73],[129,527],[463,527]].map(([x,y])=>post(x,y,t,23,true,'stone')).join('')
 case 7:return post(102,95,t,26,true)+post(498,95,t,26,true)+post(102,505,t,26,true)+post(498,505,t,26,true)+face([[83,70],[300,55],[517,70],[517,530],[300,545],[83,530]],t,'tile')+rail('M300 57V543M89 79L294 111M511 79L306 111M89 521L294 489M511 521L306 489',t,18)
 case 8:return rail('M123 65Q70 300 145 535M477 65Q530 300 455 535',t,41)+face([[137,72],[462,72],[480,232],[443,380],[455,529],[145,529],[157,381],[119,233]],t,'woven')+rep(4,n=>post(n%2?468:132,n<2?78:522,t,22,false))+p('M141 93Q110 285 164 506M459 93Q490 285 436 506','none',t.light,4)
 case 9:return panel(119,59,362,482,t,'stone')+rep(5,n=>face([[111+(n%2)*13,67+n*93],[478-(n%2)*16,63+n*93],[492-(n%2)*13,150+n*93],[128+(n%2)*9,156+n*93]],t,'stone')+rail(`M142 ${151+n*93}H460`,t,6,true))+bridgeRails(99,73,402,454,t,true,2)
 case 10:return face(rect(144,67,312,466),t,'woven')+rope('M124 67Q101 300 124 533M476 67Q499 300 476 533',t,23)+rep(4,n=>e(n%2?476:124,n<2?79:521,30,21,'none',t.metal,9))+rep(11,n=>rope(`M128 ${87+n*42}l25 11M472 ${87+n*42}l-25 11`,t,6))
 case 11:return plankDeck(133,62,334,476,t,13)+rail('M113 63V537M487 63V537',t,31,true)+bridgeRails(105,78,390,444,t,true,3)+rep(13,n=>bolt(113,76+n*37,t,6)+bolt(487,76+n*37,t,6))
 case 12:return rep(3,n=>g(300,300,plankDeck(-73,-235,146,235,t,8)+rail('M-78-235V-42M78-235V-42',t,18)+post(-78,-226,t,12,true)+post(78,-226,t,12,true),n*120))+face(oval(300,300,105,105),t)+e(300,300,83,83,'none',t.light,3)
 case 13:return face(arc(300,411,241,330,.47,195,345),t)+rep(13,n=>g(300,411,beam([113,0],[237,0],t,25),(195+n*12.5)))+p('M66 328Q300-9 534 328M189 360Q300 203 411 360','none',t.wood,16)+rep(4,n=>{const a=(195+n*50)*Math.PI/180;return post(300+239*Math.cos(a),411+326*Math.sin(a),t,15,false)})
 case 14:return panel(141,63,318,474,t,'stone')+panel(92,243,416,114,t,'stone')+bridgeRails(125,74,350,452,t,true,3)+pins(110,260,380,80,t)
 case 15:return plankDeck(90,122,151,356,t,12)+plankDeck(359,122,151,356,t,12)+panel(69,62,462,68,t,'stone')+panel(69,470,462,68,t,'stone')+bridgeRails(78,123,444,354,t,false,2)+rail('M247 132V468M353 132V468',t,15)
 case 16:return plankDeck(126,64,348,472,t,18)+rail('M108 62V538M492 62V538',t,30,true)+bridgeRails(100,75,400,450,t,true,3)+rep(16,n=>bolt(108,76+n*30,t,5)+bolt(492,76+n*30,t,5))
 case 17:return panel(92,63,416,474,t,'stone')+panel(78,65,35,470,t,'stone')+panel(487,65,35,470,t,'stone')+[[86,80],[514,80],[86,520],[514,520]].map(([x,y])=>post(x,y,t,23,true,'stone')).join('')+p('M121 144H479M121 300H479M121 456H479','none',t.dark,2)
 case 18:return panel(102,68,396,464,t,'stone')+bridgeRails(91,78,418,444,t,true,3)+[[88,83],[512,83],[88,517],[512,517]].map(([x,y])=>post(x,y,t,25,true,'stone')+r(x-18,y-35,36,70,'none',1,t.metal,5)).join('')
 case 19:return panel(127,65,346,470,t,'metal')+[74,309].map(y=>grille(143,y,314,216,t,8,7)).join('')+rail('M116 62V538M484 62V538M116 300H484',t,27,true)+pins(116,81,368,438,t)
 case 20:return panel(126,65,348,470,t,'tile')+bridgeRails(110,75,380,450,t,true,2)+[[105,82],[495,82],[105,518],[495,518]].map(([x,y])=>post(x,y,t,22,false,'stone')).join('')
 case 21:return panel(103,66,394,468,t)+rep(17,n=>panel(122,73+n*27,356,15,t))+rail('M208 64V536M392 64V536',t,19,true)+panel(104,66,58,468,t)+panel(438,66,58,468,t)+bridgeRails(94,74,412,452,t,true,3)
 case 22:return face(arc(300,424,244,329,.48,195,345),t)+rep(16,n=>g(300,424,beam([121,0],[241,0],t,20),196+n*9.85))+p('M65 339Q300 6 535 339M185 381Q300 220 415 381','none',t.metal,13)+rep(4,n=>{const a=(195+n*50)*Math.PI/180;return post(300+244*Math.cos(a),424+329*Math.sin(a),t,13,false,'metal')})
 case 23:return [[105,82],[495,82],[105,300],[495,300],[105,518],[495,518]].map(([x,y])=>post(x,y,t,20,true,'metal')).join('')+face(rect(88,65,424,470),t,'metal')+rep(14,n=>rail(`M${105+n*30} 74V526`,t,5,true))+rail('M300 63V537M94 73L299 123 506 73M94 527L299 477 506 527',t,15,true)
 default:throw new Error('未知桥梁外观。')
 }
}

const roofFace=(pts:readonly Pt[],t:Tone,m:Material='tile',seed=0)=>face(pts,t,m)+fibres(pts,37+(seed%3)*8,m==='thatch'?t.dark:m==='metal'?t.light:t.stoneLight,m==='thatch'?3:1.5,seed%2?6:-6)
const roofRidge=(d:string,t:Tone,iron=false)=>rail(d,t,15,iron)
const gable=(x:number,y:number,w:number,h:number,t:Tone,m:Material='tile')=>roofFace([[x,y],[x+w/2,y],[x+w/2,y+h],[x,y+h]],t,m)+roofFace([[x+w/2,y],[x+w,y],[x+w,y+h],[x+w/2,y+h]],t,m,1)+roofRidge(`M${x+w/2} ${y}V${y+h}`,t,m==='metal')+p(`M${x+5} ${y+6}L${x+w/2} ${y+37} ${x+w-5} ${y+6}M${x+5} ${y+h-6}L${x+w/2} ${y+h-37} ${x+w-5} ${y+h-6}`,'none',t.dark,4)
const hip=(x:number,y:number,w:number,h:number,t:Tone,m:Material='tile')=>{
 const a:Pt=[x+w/2,y+h*.24],b:Pt=[x+w/2,y+h*.76]
 return roofFace([[x,y],[x+w,y],a],t,m)+roofFace([[x,y],a,b,[x,y+h]],t,m,1)+roofFace([[x+w,y],a,b,[x+w,y+h]],t,m)+roofFace([[x,y+h],b,[x+w,y+h]],t,m,1)+roofRidge(`M${a[0]} ${a[1]}V${b[1]}M${x} ${y}L${a[0]} ${a[1]} ${x+w} ${y}M${x} ${y+h}L${b[0]} ${b[1]} ${x+w} ${y+h}`,t,m==='metal')
}
const cone=(x:number,y:number,rx:number,ry:number,t:Tone,m:Material='wood',n=12)=>face(oval(x,y,rx,ry),t,m)+rep(n,k=>roofFace([[x,y],[x+rx*Math.cos(k*2*Math.PI/n),y+ry*Math.sin(k*2*Math.PI/n)],[x+rx*Math.cos((k+1)*2*Math.PI/n),y+ry*Math.sin((k+1)*2*Math.PI/n)]],t,m,k))+e(x,y,rx*.13,ry*.13,m==='metal'?metal:wood)+rep(5,k=>e(x,y,rx*(.27+k*.14),ry*(.27+k*.14),'none',m==='metal'?t.metal:t.dark,2.4))
function roof(i:number,t:Tone):string{
 switch(i){
 case 0:return gable(67,81,466,438,t,'thatch')+rope('M300 93V507',t,20)+rep(7,n=>rope(`M287 ${112+n*62}h26`,t,7))
 case 1:return hip(68,69,464,462,t,'wood')+p('M78 80H522M78 521H522','none',t.light,4)
 case 2:return gable(65,78,470,444,t,'tile')+rail('M69 85V515M531 85V515',t,15)
 case 3:return cone(300,300,234,234,t,'wood',16)
 case 4:return gable(63,95,474,410,t,'thatch')+rep(3,n=>rope(`M279 ${142+n*157}l42 14m-40 0 38 14`,t,8))
 case 5:return roofFace([[207,63],[393,63],[393,207],[537,207],[537,393],[393,393],[393,537],[207,537],[207,393],[63,393],[63,207],[207,207]],t,'wood')+roofRidge('M300 63V537M63 300H537',t)+p('M208 208L300 300 392 208M208 392L300 300 392 392','none',t.dark,8)
 case 6:return roofFace([[67,67],[533,67],[533,255],[255,255],[255,533],[67,533]],t,'wood')+roofRidge('M163 529V163H529',t)+p('M255 255L163 163M68 68L163 163','none',t.dark,7)
 case 7:return face(reg(300,300,240,240),t,'tile')+rep(8,n=>roofFace([[300,300],reg(300,300,237,237)[n],reg(300,300,237,237)[(n+1)%8]],t,'tile',n))+face(reg(300,300,34,34),t,'stone')+rep(8,n=>g(300,300,p('M50 0H232','none',t.dark,4),n*45))
 case 8:return roofFace([[95,105],[251,66],[423,97],[524,241],[492,440],[367,529],[190,508],[73,368]],t,'woven')+roofRidge('M101 382Q241 256 457 147M238 261L193 123M324 215L454 365',t)+rail('M95 107Q74 273 74 367Q116 462 190 508M423 97Q524 193 524 241Q523 381 492 440',t,19)
 case 9:return roofFace([[70,92],[501,66],[534,473],[117,532]],t,'stone')+panel(86,101,253,193,t,'stone')+panel(283,77,226,240,t,'stone')+panel(105,300,218,208,t,'stone')+panel(329,323,190,174,t,'stone')+roofRidge('M319 94L324 506M104 296H505',t,true)
 case 10:return face(reg(300,300,238,238,6),t,'metal')+rep(6,n=>roofFace([[300,300],reg(300,300,235,235,6)[n],reg(300,300,235,235,6)[(n+1)%6]],t,'metal',n))+rep(6,n=>g(300,300,rail('M33 0H231',t,7,true)+rep(5,k=>bolt(62+k*35,0,t,4)),n*60-90))+e(300,300,33,33,metal)
 case 11:return roofFace([[72,108],[300,62],[528,108],[528,492],[300,538],[72,492]],t,'wood')+rep(3,n=>rail(`M79 ${135+n*165}Q300 ${75+n*165} 521 ${135+n*165}`,t,16,true))+p('M300 76V524','none',t.dark,4)
 case 12:return face(reg(300,300,239,239),t,'wood')+rep(8,n=>roofFace([[300,300],reg(300,300,237,237)[n],reg(300,300,237,237)[(n+1)%8]],t,'wood',n))+face(reg(300,300,157,157),t,'wood')+rep(8,n=>roofFace([[300,300],reg(300,300,155,155)[n],reg(300,300,155,155)[(n+1)%8]],t,'wood',n+1))+e(300,300,24,24,metal)
 case 13:return roofFace([[65,65],[535,65],[426,174],[174,174]],t,'tile')+roofFace([[65,65],[174,174],[174,426],[65,535]],t,'tile',1)+roofFace([[535,65],[535,535],[426,426],[426,174]],t,'tile',1)+roofFace([[65,535],[174,426],[426,426],[535,535]],t,'tile')
 case 14:return roofFace(rect(199,209,202,182),t,'wood')+cone(191,300,133,231,t,'wood',12)+cone(409,300,133,231,t,'wood',12)+roofRidge('M264 210H336M264 390H336',t)
 case 15:{const vertices:readonly Pt[]=[[89,78],[407,56],[532,220],[491,481],[221,538],[66,362]];return roofFace(vertices,t,'wood')+vertices.map((a,n)=>roofFace([[263,242],a,vertices[(n+1)%vertices.length]],t,'wood',n)).join('')+roofRidge('M263 242L409 380',t)}
 case 16:return hip(65,74,470,452,t,'tile')+rep(14,n=>p(`M${78+n*34} 85V515`,'none','#BFA485',3))+roofRidge('M300 184V416',t)
 case 17:return roofFace(rect(63,66,474,468),t,'tile')+r(107,111,386,378,'none',2,t.dark,9)+hip(125,129,350,342,t,'tile')+p('M65 68L126 130M535 68L474 130M65 532L126 470M535 532L474 470','none',t.stoneLight,5)
 case 18:return gable(65,72,470,456,t,'metal')+rep(16,n=>rail(`M${78+n*29.5} 82V518`,t,5,true))+pins(80,86,440,428,t)
 case 19:return panel(65,72,470,456,t,'stone')+r(74,81,452,438,'none',1,t.stoneLight,23)+p('M90 98H510M90 502H510M98 90V510M502 90V510','none',t.dark,3)+r(81,81,40,40,t.dark,3)+r(479,479,40,40,t.dark,3)
 case 20:return panel(62,67,476,466,t,'metal')+rep(4,n=>roofFace(rect(68+n*116,75,107,450),t,'metal',n)+r(155+n*116,77,17,446,glass,1)+rail(`M${177+n*116} 75V525`,t,10,true))+rail('M65 70H535M65 530H535',t,13,true)
 case 21:return roofFace([[65,66],[535,66],[535,534],[364,534],[364,251],[236,251],[236,534],[65,534]],t,'tile')+roofRidge('M150 527V151H450V527',t)+p('M236 251L150 151M364 251L450 151','none',t.dark,7)
 case 22:return gable(65,67,470,466,t,'metal')+r(266,85,68,430,glass,2)+rail('M263 84V516M337 84V516',t,13,true)+rep(10,n=>rail(`M267 ${98+n*44}H333`,t,8,true))
 case 23:return cone(300,300,235,235,t,'metal',12)+rep(5,n=>e(300,300,61+n*35,61+n*35,'none',t.metal,3))+rep(12,n=>g(300,300,rep(5,k=>bolt(57+k*33,0,t,3.7)),n*30))
 default:throw new Error('未知屋顶。')
 }
}

const flue=(x:number,y:number,rx:number,ry:number,t:Tone,clay=false,square=false)=>square?r(x-rx,y-ry,rx*2,ry*2,clay?'#AD8862':stone,4)+r(x-rx+12,y-ry+12,rx*2-24,ry*2-24,t.dark,3)+r(x-rx+18,y-ry+18,rx*2-36,ry*2-36,'none',2,'#706C5D',4):e(x,y,rx,ry,clay?'#AD8862':stone)+e(x,y,rx-13,ry-13,t.dark)+e(x,y,rx-20,ry-20,'none','#716F5E',5)
const chimneyBase=(t:Tone,x=93,y=94,w=414,h=412,m:Material='stone')=>panel(x,y,w,h,t,m)+r(x+10,y+10,w-20,h-20,'none',2,t.stoneLight,10)
function chimney(i:number,t:Tone):string{
 switch(i){
 case 0:return chimneyBase(t,94,95,412,410,'tile')+panel(122,123,356,354,t,'stone')+flue(300,300,115,115,t,false,true)
 case 1:return face(oval(300,300,229,229),t,'stone')+e(300,300,196,196,'none',t.stoneLight,13)+flue(300,300,139,139,t)
 case 2:return chimneyBase(t,68,122,464,356)+flue(195,300,91,132,t)+flue(405,300,91,132,t)+rail('M300 140V460',t,7)
 case 3:return [[106,105],[494,105],[106,495],[494,495]].map(([x,y])=>post(x,y,t,31,true,'stone')).join('')+hip(74,78,452,444,t,'stone')+roofRidge('M300 181V419',t)
 case 4:return chimneyBase(t,68,72,464,456,'tile')+chimneyBase(t,101,105,398,390,'tile')+chimneyBase(t,131,135,338,330)+flue(300,300,101,98,t,false,true)
 case 5:return face(reg(300,300,234,234),t,'stone')+face(reg(300,300,193,193),t,'stone')+flue(300,300,123,123,t)+rep(8,n=>g(300,300,p('M150 0H215','none',t.dark,4),n*45))
 case 6:return chimneyBase(t,65,116,470,368,'tile')+flue(191,300,91,137,t,true)+flue(409,300,91,137,t,true)+p('M300 137V463','none',t.dark,4)
 case 7:return face([[70,156],[256,98],[489,133],[534,315],[476,475],[234,507],[79,439]],t,'stone')+flue(300,300,149,91,t,false,true)+p('M102 192l64 9m297 198-45 17','none',t.stoneLight,7)
 case 8:return face([[85,146],[253,66],[470,116],[540,350],[419,510],[153,529],[62,345]],t,'stone')+[[194,226],[406,226],[300,397]].map(([x,y])=>face(reg(x,y,79,88,6),t,'stone')+poly(reg(x,y,54,62,6),t.dark)).join('')+pins(124,144,320,280,t)
 case 9:return face(oval(300,300,220,220),t,'stone')+rep(4,n=>g(300,300,rail('M0-109Q-102-155 0-239',t,35),n*90))+flue(300,300,124,124,t)+e(300,300,153,153,'none',t.metal,13)
 case 10:return [[106,110],[494,110],[106,490],[494,490]].map(([x,y])=>post(x,y,t,29,true,'metal')).join('')+hip(76,82,448,436,t,'metal')+pins(93,99,414,402,t)+rep(7,n=>bolt(300,116+n*61,t,5))
 case 11:return face([[69,152],[445,84],[530,189],[484,475],[133,529]],t,'stone')+face([[107,105],[502,144],[505,419],[112,477]],t,'stone')+panel(136,162,333,266,t,'stone')+rail('M149 190H451M149 410H451',t,10,true)
 case 12:return face(reg(300,300,241,235,3),t,'stone')+[[300,153],[172,372],[428,372]].map(([x,y])=>flue(x,y,74,81,t,true)).join('')+poly(reg(300,300,191,183,3),'none',t.metal,13)
 case 13:return face(oval(300,300,233,233),t,'stone')+rep(4,n=>g(300,300,r(-26,-209,52,130,t.dark,12),n*90))+face(oval(300,300,106,106),t,'stone')+e(300,300,82,82,'none',t.stoneLight,6)
 case 14:return chimneyBase(t,63,103,474,394)+hip(80,133,201,334,t,'metal')+hip(319,133,201,334,t,'metal')+panel(274,264,52,72,t,'metal')+pins(289,278,22,44,t)
 case 15:return face([[69,136],[414,79],[532,185],[497,482],[132,521]],t,'stone')+panel(119,119,400,285,t,'stone')+panel(91,207,398,257,t,'stone')+flue(312,312,123,71,t,false,true)+rail('M142 235H174M440 391H474',t,10,true)
 case 16:return chimneyBase(t,67,100,466,400,'tile')+[[184,213],[416,213],[184,387],[416,387]].map(([x,y])=>flue(x,y,75,72,t,true)).join('')
 case 17:return rep(4,n=>g(300,300,r(-31,-231,62,123,metal,7)+bolt(0,-211,t,12),n*90))+face(oval(300,300,203,203),t,'metal')+rep(12,n=>g(300,300,rail('M25 0H194',t,4,true),n*30))+e(300,300,42,42,metal)
 case 18:return chimneyBase(t,67,79,466,442)+chimneyBase(t,104,114,392,372)+flue(205,300,71,113,t,false,true)+flue(395,300,71,113,t,false,true)+rail('M107 122H493M107 478H493',t,8,true)
 case 19:return chimneyBase(t,68,84,464,432,'metal')+hip(88,108,424,384,t,'metal')+rail('M93 300H507M300 113V487',t,9,true)+pins(104,124,392,352,t)
 case 20:return face(oval(300,300,226,226),t,'metal')+face([[153,221],[331,122],[526,253],[498,411],[273,426]],t,'metal')+face(oval(269,271,166,153),t,'metal')+rail('M154 231Q269 126 388 231',t,11,true)+e(269,271,35,31,metal)
 case 21:return chimneyBase(t,61,116,478,368,'tile')+[155,300,445].map(x=>flue(x,300,63,116,t)+e(x,300,68,122,'none',t.metal,5)).join('')
 case 22:return chimneyBase(t,62,105,476,390,'metal')+flue(182,300,101,143,t)+flue(418,300,101,143,t)+rail('M282 245H318M282 355H318',t,16,true)+pins(83,130,434,340,t)
 case 23:return chimneyBase(t,61,123,478,354,'tile')+rep(6,n=>flue(143+n%3*157,218+Math.floor(n/3)*164,56,64,t,false,true))+pins(78,140,444,320,t)
 default:throw new Error('未知烟囱顶盖。')
 }
}

function doorTrim(i:number,t:Tone):string{
 switch(i){
 case 0:return poly([[271,72],[329,72],[343,181],[318,480],[300,540],[282,480],[257,181]],metal)+r(246,75,108,59,metal,11)+rep(7,n=>bolt(300,158+n*48,t,10))+p('M279 149L292 470','none',t.light,3)
 case 1:return face(reg(300,259,179,182,8,22.5),t,'metal')+pins(180,137,240,244,t)+e(300,364,142,159,'none',t.dark,32)+e(300,364,142,159,'none',t.metal,24)+r(262,223,76,91,metal,13)+bolt(300,247,t,17)
 case 2:return panel(76,243,448,114,t)+[159,441].map(x=>r(x-23,206,46,188,metal,7)+bolt(x,230,t,7)+bolt(x,371,t,7)).join('')+r(466,269,68,62,metal,6)+handle(501,300,t)
 case 3:return rail('M241 504Q179 337 253 148Q291 88 334 76M246 326L407 225M254 179L153 115',t,48)+[181,448].map(y=>r(213,y,100,51,metal,8)+bolt(232,y+25,t,8)+bolt(294,y+25,t,8)).join('')+p('M241 463Q211 307 278 153','none',t.light,3)
 case 4:return face(reg(300,300,220,231,8,22.5),t,'stone')+[163,285,407].map(x=>r(x,132,32,336,metal,6)+bolt(x+16,158,t,7)+bolt(x+16,442,t,7)).join('')+r(243,237,114,126,t.dark,9)+r(257,251,86,98,'none',4,t.stoneLight,5)
 case 5:return face(arc(300,300,156,225,.69,0,360),t,'woven')+post(300,87,t,27,true)+post(300,513,t,27,true)+r(259,61,82,63,metal,7)+r(259,476,82,63,metal,7)+pins(276,78,48,441,t)
 case 6:return r(221,62,158,476,metal,15)+r(238,81,124,438,'none',9,t.light,4)+rail('M300 188V420',t,36,true)+r(262,166,76,49,metal,10)+r(262,393,76,49,metal,10)+bolt(300,103,t,12)+bolt(300,497,t,12)
 case 7:return face([[136,64],[464,64],[464,105],[519,105],[519,495],[464,495],[464,536],[136,536],[136,495],[81,495],[81,105],[136,105]],t,'metal')+r(142,124,316,352,wood,5)+r(159,141,282,318,'none',2,t.metal,9)+pins(105,133,390,334,t)
 default:throw new Error('未知平放门饰。')
 }
}
function shutter(i:number,t:Tone):string{
 switch(i){
 case 0:return boards(102,65,396,470,t,4,true)+panel(88,148,424,38,t)+panel(88,419,424,38,t)+hinge(107,166,t,true)+hinge(107,439,t,true)+handle(439,307,t)
 case 1:return boards(115,63,370,474,t,3,true)+panel(105,119,390,36,t)+panel(105,447,390,36,t)+beam([130,141],[469,461],t,28)+hinge(114,139,t,true)+hinge(114,465,t,true)+r(407,282,61,52,metal,5)
 case 2:return grille(69,73,214,454,t,3,5)+grille(317,73,214,454,t,3,5)+hinge(75,155,t,true)+hinge(75,450,t,true)+hinge(525,155,t)+hinge(525,450,t)+rail('M279 294H321',t,18,true)
 case 3:return face([[107,85],[255,66],[439,96],[508,233],[474,401],[491,524],[158,538],[80,384]],t)+face([[137,125],[259,106],[416,128],[469,238],[440,395],[457,491],[181,502],[120,380]],t,'woven')+rail('M124 108Q72 337 147 512M443 115Q512 329 463 508',t,22)+hinge(107,181,t,true)+hinge(486,441,t)
 case 4:return panel(96,64,408,472,t,'metal')+rep(3,n=>panel(118,84+n*146,364,133,t,'stone')+pins(129,97+n*146,342,107,t))+hinge(103,155,t,true)+hinge(103,450,t,true)+r(423,274,60,64,metal,5)
 case 5:return [67,225,383].map(x=>panel(x,74,150,452,t)+panel(x+18,95,114,410,t,'woven')+hinge(x+149,157,t)+hinge(x+149,442,t)).join('')+rope('M478 279q-37 21 0 42q37-21 0-42',t,7)
 case 6:return panel(104,61,392,478,t)+slats(128,87,344,200,t,13)+slats(128,314,344,200,t,13)+panel(117,286,366,28,t)+r(421,284,35,72,metal,6)+bolt(439,319,t,7)+hinge(108,164,t,true)+hinge(108,437,t,true)
 case 7:return panel(91,69,418,462,t,'metal')+r(112,92,376,416,'none',4,t.dark,11)+rep(14,n=>r(141,119+n*26,318,11,t.dark,3)+p(`M146 ${116+n*26}H454`,'none',t.light,2))+pins(117,96,366,408,t)+r(466,273,57,68,metal,6)+bolt(494,307,t,9)
 default:throw new Error('未知平放护扇。')
 }
}
function eaveTrim(i:number,t:Tone):string{
 switch(i){
 case 0:return panel(65,199,470,202,t)+p(rep(7,n=>`M${88+n*67} 239q18 91 38 0`),'none',t.dark,11)+rail('M72 208H528M72 392H528',t,13)+pins(82,226,436,148,t)
 case 1:return face(rect(64,195,472,210),t,'thatch')+panel(63,201,474,47,t)+rep(3,n=>rope(`M${112+n*188} 184v232m-13-211 26 0m-26 22 26 0`,t,8))
 case 2:return panel(62,208,476,87,t,'stone')+rep(7,n=>face([[72+n*67,273],[128+n*67,273],[132+n*67,405],[76+n*67,398]],t,'stone'))+p('M78 231H522','none',t.stoneLight,9)
 case 3:return rail('M63 273Q215 182 355 288Q458 361 537 272M63 346Q215 255 355 361Q458 434 537 345',t,35)+rail('M133 259L112 127M251 275L295 162M395 345L360 462M487 330L526 438',t,23)+[[124,281],[304,301],[471,351]].map(([x,y])=>r(x-19,y-39,38,78,metal,6)+bolt(x,y,t,8)).join('')
 case 4:return face([[63,210],[537,210],[537,257],[503,257],[503,305],[537,305],[537,390],[63,390],[63,305],[97,305],[97,257],[63,257]],t,'metal')+rep(6,n=>r(77+n*84,224,26,152,metal,6)+bolt(90+n*84,246,t,7)+bolt(90+n*84,354,t,7))+rail('M71 298H529',t,9,true)
 case 5:return face([[65,232],[300,161],[535,232],[535,368],[300,439],[65,368]],t,'woven')+rail('M65 225Q300 84 535 225M65 375Q300 516 535 375',t,25)+post(75,300,t,24,true)+post(525,300,t,24,true)
 case 6:return panel(62,194,476,212,t,'metal')+r(80,224,440,151,t.dark,12)+p('M93 238H507M93 363H507','none',t.metal,14)+[98,232,366,500].map(x=>r(x-13,183,26,234,metal,4)+bolt(x,206,t,7)+bolt(x,395,t,7)).join('')
 case 7:return panel(62,187,476,226,t,'stone')+panel(80,209,440,180,t,'tile')+panel(99,235,402,131,t,'stone')+rail('M69 198H531M69 402H531',t,12,true)+pins(82,218,436,164,t)
 default:throw new Error('未知平放檐饰。')
 }
}

export const ARCHITECTURE_LICENSE_REF='MIT-Sceneweave-Architecture-Collection-1'
export const ARCHITECTURE_LICENSE=`Sceneweave Architecture Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original SVG decorative architecture components, authored with coding assistance. No third-party image pixels or artwork are included. Medieval, western fantasy and 1920s interpretations with original wood fibres, weaving, stone joints and metal seams. Doors, windows, shutters and trims are explicitly flat laid components, not a frontal elevation masquerading as an attached opening. Other items are independent top-down decorative props: no building interior, wall attachment, height change, stair or bridge traversal, smoke simulation, or structural topology is created. Technical self-check is separate from human art acceptance.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const defs=(t:Tone)=>`<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="21%" y2="100%"><stop offset="0%" stop-color="${t.light}"/><stop offset="36%" stop-color="${t.wood}"/><stop offset="100%" stop-color="${t.dark}"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${t.stoneLight}"/><stop offset="40%" stop-color="${t.stone}"/><stop offset="100%" stop-color="#6C7B6D"/></linearGradient>
<linearGradient id="metal" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#D4CBA9"/><stop offset="36%" stop-color="${t.metal}"/><stop offset="100%" stop-color="${t.dark}"/></linearGradient>
<linearGradient id="glass" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#DDE6D2"/><stop offset="35%" stop-color="${t.glass}"/><stop offset="78%" stop-color="#95B1A4"/><stop offset="100%" stop-color="#C3D4C5"/></linearGradient>
</defs>`
function artwork(design:ArchitectureDesign,i:number):VisualSampleArt{
 const small=['door-trim','shutter','eave-trim'].includes(design.category),ti=small?[1,5,7,8,9,11,18,20][i]:i
 const t:Tone={...tones[ti],aspect:design.widthMm/design.heightMm}
 const draw={door,window:windowArt,column,arch:archArt,fence,railing,stairs,bridge,roof,chimney,'door-trim':doorTrim,shutter,'eave-trim':eaveTrim}[design.category]
 const flat=['door','window','door-trim','shutter','eave-trim'].includes(design.category)
 const extent=Math.max(design.widthMm,design.heightMm),vw=600*design.widthMm/extent,vh=600*design.heightMm/extent
 return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
  sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}">${defs(t)}<g transform="scale(${vw/600} ${vh/600})">${draw(i,t)}</g></svg>`,
  footprintMm:{width:Math.round(design.widthMm*.98),height:Math.round(design.heightMm*.98)},blocksMovement:!flat,blocksSight:false,renderLayer:flat?'ground':'object',shadowClass:flat?'none':'furniture',
  tags:['原创','建筑与户外构件',design.category,design.era,design.design,'独立装饰构件',flat?'平放组件':'正顶视',...(flat?['不创建实际门窗开口或墙体附着','不声明悬挂高程']:['保守整体阻挡占地','图像不授予高程或通行']),...(design.category==='roof'?['独立闭合屋顶外观','不创建建筑内部或遮蔽拓扑']:[]),...(['stairs','bridge'].includes(design.category)?['装饰外观','需实际地形合同另设高程通行']:[])]}
}
export const ARCHITECTURE_ART:readonly VisualSampleArt[]=freezeJson(ARCHITECTURE_DESIGNS.map(design=>artwork(design,ARCHITECTURE_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
