import { FURNISHING_DETAILS_DESIGNS, type FurnishingDetailsDesign } from '../assets/furnishing-details-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

type Pt=readonly [number,number]
interface Palette { timber:string; light:string; dark:string; cloth:string; clothLight:string; clothDark:string; metal:string }
const palettes:readonly Palette[]=[
  ['#96734F','#C8AC7B','#54432F','#AFA077','#D6C79C','#807653','#827A64'],['#A27E50','#D2B784','#5C452F','#A39C72','#D1CCA1','#747452','#8B805D'],
  ['#805C42','#B89162','#483629','#9C795B','#C3AA85','#6D5845','#938164'],['#8B7B60','#BDAD8E','#554D3D','#B7B199','#DED6B9','#8C8870','#7B806D'],
  ['#78674C','#B19B72','#423D31','#7C856D','#ADB499','#515F50','#788272'],['#846145','#BA9873','#4D392A','#9E8F71','#C8B99B','#70674F','#AFA282'],
  ['#825538','#BF9460','#483024','#836363','#B79384','#5A4547','#BEA66B'],['#805832','#D1AE72','#4E3424','#934F5C','#C58D98','#643943','#D4B77B'],
  ['#8C956C','#C9CAA0','#4B6550','#91AB96','#C4D3AF','#627F6B','#B6AF7E'],['#7C8580','#BABDA8','#424E4A','#947261','#C2AA8D','#614C43','#AE966D'],
  ['#A48254','#D0B982','#62503A','#B8A36D','#D9C895','#85774F','#A39870'],['#7C7087','#BDB0C4','#4A405B','#82889F','#B5BED0','#555F78','#C1B187'],
  ['#7C674E','#B8A07A','#494134','#9B8B6C','#CCBA95','#6C604C','#B3A47F'],['#685E65','#A89B9E','#3D3946','#8D7D99','#BEB1C9','#5E526F','#B1A17B'],
  ['#886A51','#C0A274','#4B3E32','#83977D','#B6C3A1','#566E57','#C1AB72'],['#B3958D','#DFC9AD','#6C5D63','#B0B38A','#D8D9AF','#7E875F','#C3AD7C'],
  ['#A08A5C','#D2C08D','#665E45','#AA8B70','#D2BE9D','#77614E','#D2BB7A'],['#B7C1B6','#E1E2D0','#65766D','#B4C0B3','#DDE2CC','#7C8C7C','#A4B4A2'],
  ['#937347','#C7AA77','#58452E','#849174','#B5BFA1','#5D6C53','#AA9E73'],['#926C55','#CBAA83','#514034','#96AA9C','#C5D3BC','#647E71','#BDA576'],
  ['#60555C','#B09A80','#36363F','#83968D','#B7C7B5','#586D66','#CEB57F'],['#765541','#AF8964','#403229','#947760','#C7AE8F','#664C3F','#B59F71'],
  ['#9B8262','#C8B492','#60513D','#B0AD8E','#D8D4B3','#828068','#A29778'],['#8D6D58','#C9B294','#513F35','#94A5A2','#C5D5CB','#667F7B','#CEB589'],
].map(([timber,light,dark,cloth,clothLight,clothDark,metal])=>({timber,light,dark,cloth,clothLight,clothDark,metal}))
const ink='#4C463B',wood='url(#wood)',cloth='url(#cloth)',metal='url(#metal)',stone='url(#stone)',glass='url(#glass)'
const rep=(n:number,fn:(i:number)=>string)=>Array.from({length:n},(_,i)=>fn(i)).join('')
const fmt=(n:number)=>Math.round(n*100)/100
const p=(d:string,fill='none',stroke=ink,sw=2.7)=>d.trim()?`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`:''
const r=(x:number,y:number,w:number,h:number,fill:string,rad=0,stroke=ink,sw=2.7)=>`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const e=(x:number,y:number,rx:number,ry:number,fill:string,stroke=ink,sw=2.7)=>`<ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g=(x:number,y:number,body:string,s=1,a=0)=>`<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})">${body}</g>`
const pathPts=(pts:readonly Pt[])=>pts.map(([x,y],n)=>`${n?'L':'M'}${fmt(x)} ${fmt(y)}`).join('')+'Z'
const poly=(pts:readonly Pt[],fill:string,stroke=ink,sw=2.7)=>p(pathPts(pts),fill,stroke,sw)
const regular=(cx:number,cy:number,rad:number,n:number,a=-90):Pt[]=>Array.from({length:n},(_,k)=>[cx+rad*Math.cos((a+k*360/n)*Math.PI/180),cy+rad*Math.sin((a+k*360/n)*Math.PI/180)] as Pt)
const ellipsePts=(cx:number,cy:number,rx:number,ry:number):Pt[]=>Array.from({length:48},(_,k)=>[cx+rx*Math.cos(k*Math.PI/24),cy+ry*Math.sin(k*Math.PI/24)] as Pt)
const roundedPts=(x:number,y:number,w:number,h:number,rad:number):Pt[]=>{
  const rr=Math.min(rad,w/2,h/2)
  return [[x+w-rr,y+rr,-90],[x+w-rr,y+h-rr,0],[x+rr,y+h-rr,90],[x+rr,y+rr,180]].flatMap(([cx,cy,a])=>Array.from({length:9},(_,k)=>[cx+rr*Math.cos((a+k*11.25)*Math.PI/180),cy+rr*Math.sin((a+k*11.25)*Math.PI/180)] as Pt))
}
/** Clip individual fibres analytically to the drawn polygon; no SVG clipping masks. */
const fibres=(pts:readonly Pt[],spacing:number,color:string,sw=1,a=0,wave=false)=>{
  const aa=a*Math.PI/180,c=Math.cos(aa),s=Math.sin(aa),rot=pts.map(([x,y])=>[x*c+y*s,-x*s+y*c] as Pt),lo=Math.min(...rot.map(q=>q[1])),hi=Math.max(...rot.map(q=>q[1]))
  let d=''
  for(let y=lo+spacing*.7,n=0;y<hi-spacing*.35;y+=spacing,n++){
    const xs:number[]=[]
    for(let k=0;k<rot.length;k++){const u=rot[k],v=rot[(k+1)%rot.length];if((u[1]<=y&&v[1]>y)||(v[1]<=y&&u[1]>y))xs.push(u[0]+(y-u[1])*(v[0]-u[0])/(v[1]-u[1]))}
    xs.sort((u,v)=>u-v)
    for(let k=0;k+1<xs.length;k+=2){const x=xs[k]+5,w=xs[k+1]-xs[k]-10;if(w<4)continue;d+=wave?`M${fmt(x)} ${fmt(y)}q${fmt(w*.25)} ${n%2?1.8:-1.8} ${fmt(w*.5)} 0t${fmt(w*.5)} 0 `:`M${fmt(x)} ${fmt(y)}h${fmt(w)} `}
  }
  return `<g transform="rotate(${a})">${p(d,'none',color,sw)}</g>`
}
const grain=(x:number,y:number,w:number,h:number,t:Palette,seed=0)=>w<22||h<22?'':`<g opacity=".66">${fibres(roundedPts(x+5,y+5,w-10,h-10,4),Math.max(5,h/11),t.light,1.2,0,true)}${fibres(roundedPts(x+8,y+8,w-16,h-16,3),Math.max(7,h/8),t.dark,.8,0,true)}${w>90&&h>35?e(x+w*(.32+seed%3*.12),y+h*.54,Math.min(25,w*.11),Math.min(8,h*.12),'none',t.dark,1.2)+e(x+w*(.32+seed%3*.12),y+h*.54,Math.min(15,w*.06),Math.min(4,h*.06),'none',t.light,1):''}</g>`
const plank=(x:number,y:number,w:number,h:number,t:Palette,seed=0)=>p(`M${x+2} ${y+1}L${x+w*.37} ${y} ${x+w*.71} ${y+2} ${x+w-1} ${y+1} ${x+w} ${y+h-2} ${x+w*.57} ${y+h} ${x+1} ${y+h-1}Z`,wood)+grain(x+3,y+3,w-6,h-6,t,seed)
const woodPoly=(pts:readonly Pt[],t:Palette)=>poly(pts,wood)+`<g opacity=".56">${fibres(pts,11,t.light,1.4,0,true)}${fibres(pts,18,t.dark,.9,0,true)}</g>`
const woodOval=(x:number,y:number,rx:number,ry:number,t:Palette)=>e(x,y,rx,ry,wood)+`<g opacity=".58">${fibres(ellipsePts(x,y,rx-6,ry-6),9,t.light,1.5,0,true)}${fibres(ellipsePts(x,y,rx-8,ry-8),17,t.dark,.9,0,true)}</g>`+e(x+rx*.22,y-ry*.05,rx*.22,ry*.09,'none',t.dark,1.5)+e(x+rx*.22,y-ry*.05,rx*.14,ry*.045,'none',t.light,1.2)
const weave=(pts:readonly Pt[],t:Palette,spacing=9)=>`<g opacity=".55">${fibres(pts,spacing,t.clothLight,1.1,0)}${fibres(pts,spacing*1.4,t.clothDark,.8,90)}${fibres(pts,spacing*3.1,t.clothLight,1.7,0)}</g>`
const fabricFill=(t:Palette)=>palettes.includes(t)?cloth:t.cloth
const fabric=(x:number,y:number,w:number,h:number,t:Palette,rad=16,tuft=false)=>r(x,y,w,h,fabricFill(t),rad)+weave(roundedPts(x+5,y+5,w-10,h-10,Math.max(1,rad-4)),t)+r(x+8,y+8,w-16,h-16,'none',Math.max(1,rad-6),t.clothDark,1.2)+p(`M${x+16} ${y+h*.26}q${w*.15} -8 ${w*.25} 2M${x+w*.68} ${y+h*.76}q${w*.13} 9 ${w*.23} 0`,'none',t.clothLight,1.8)+(tuft?rep(9,n=>{const xx=x+w*(.22+n%3*.28),yy=y+h*(.22+Math.floor(n/3)*.28);return p(`M${xx-7} ${yy-6}l14 12m-14 0 14-12`,'none',t.clothDark,1.1)+e(xx,yy,3.2,3.2,t.clothDark,t.clothLight,.7)}):'')
const fabricPoly=(pts:readonly Pt[],t:Palette)=>poly(pts,fabricFill(t))+weave(pts,t)
const fabricOval=(x:number,y:number,rx:number,ry:number,t:Palette,tuft=false)=>e(x,y,rx,ry,fabricFill(t))+weave(ellipsePts(x,y,rx-5,ry-5),t)+e(x,y,rx-9,ry-9,'none',t.clothDark,1.4)+(tuft?rep(5,n=>e(x+(n-2)*rx*.3,y,3,3,t.clothDark,t.clothLight,.6)):'')
const rail=(d:string,t:Palette,w=18,iron=false)=>p(d,'none',ink,w+4)+p(d,'none',iron?t.metal:t.timber,w)+p(d,'none',iron?'#D2CEAB':t.light,1.5)
const bolt=(x:number,y:number,t:Palette,s=4)=>e(x,y,s,s,t.metal,t.dark,1)+p(`M${x-s*.55} ${y+s*.3}l${s} ${-s*.65}`,'none',t.light,.9)
const rope=(d:string,t:Palette,w=7)=>p(d,'none',t.dark,w+3)+p(d,'none',t.light,w)+p(d,'none','#DDD0A9',.9)
const foot=(x:number,y:number,t:Palette,iron=false)=>r(x-18,y-18,36,36,iron?metal:wood,5)+bolt(x,y,t,6)
const cornerFeet=(x:number,y:number,w:number,h:number,t:Palette,iron=false)=>[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([px,py])=>foot(px,py,t,iron)).join('')
const beam=(x:number,y:number,w:number,h:number,t:Palette,a=0,iron=false)=>g(x,y,iron?r(-w/2,-h/2,w,h,metal,5)+bolt(-w/2+12,0,t,5)+bolt(w/2-12,0,t,5):plank(-w/2,-h/2,w,h,t),1,a)
const planks=(x:number,y:number,w:number,h:number,t:Palette,n=4)=>rep(n,k=>plank(x,y+k*h/n,w,h/n-2,t,k))
const ring=(x:number,y:number,rad:number,t:Palette,iron=false,w=16)=>e(x,y,rad,rad,'none',ink,w+4)+e(x,y,rad,rad,'none',iron?t.metal:t.timber,w)+e(x,y,rad-w*.2,rad-w*.2,'none',iron?'#D6D1AF':t.light,1.3)
const warpRect=(x:number,y:number,w:number,h:number,t:Palette)=>r(x,y,w,h,t.dark,6)+fibres(roundedPts(x+4,y+4,w-8,h-8,4),13,t.light,7,45)+fibres(roundedPts(x+4,y+4,w-8,h-8,4),13,t.timber,6,-45)+fibres(roundedPts(x+4,y+4,w-8,h-8,4),13,'#DDCDA2',1,45)

function stool(i:number,t:Palette):string{
  switch(i){
    case 0:return regular(300,300,207,3).map(([x,y])=>foot(x,y,t)).join('')+woodPoly([[152,105],[282,76],[412,104],[503,239],[481,392],[362,493],[204,478],[103,360],[98,218]],t)+e(300,291,146,157,'none',t.dark,2)+e(300,291,100,111,'none',t.dark,1.5)+e(300,291,48,53,'none',t.dark,1.4)+[[230,140],[436,358],[171,381]].map(([x,y])=>bolt(x,y,t,11)).join('')
    case 1:return cornerFeet(118,134,364,332,t)+plank(93,112,414,376,t)+p('M110 181L489 173M109 431L489 438','none',t.dark,4)+[[128,145],[472,145],[128,455],[472,455]].map(([x,y])=>bolt(x,y,t,7)).join('')
    case 2:return beam(121,300,392,54,t,90)+beam(479,300,392,54,t,90)+planks(70,169,460,262,t,3)+[121,479].map(x=>r(x-17,125,34,38,wood,3)+r(x-17,437,34,38,wood,3)).join('')
    case 3:return cornerFeet(113,113,374,374,t)+r(110,110,380,380,wood,8)+r(139,139,322,322,t.dark,4)+rep(21,n=>rope(`M149 ${150+n*14}H451M${150+n*14} 149V451`,t,6))+r(112,110,376,27,wood,4)+r(112,463,376,27,wood,4)
    case 4:return beam(300,300,501,39,t,43)+beam(300,300,501,39,t,-43)+fabricPoly([[143,137],[460,121],[481,435],[152,477],[119,298]],t)+rope('M151 151L176 454M446 145L458 422',t,8)+bolt(300,300,t,10)
    case 5:return cornerFeet(131,131,338,338,t)+r(106,106,388,388,wood,45)+warpRect(134,134,332,332,t)+rail('M138 138L461 461M461 138L138 461',t,7)
    case 6:return poly([[134,111],[401,91],[505,183],[482,430],[358,501],[132,466],[90,309]],stone)+poly([[157,145],[387,125],[468,205],[449,409],[349,467],[159,432],[123,308]],'#9A9D85')+e(300,295,138,154,'none','#C2C3AA',8)+p('M142 181l38 14m211-53 20 23m53 219-31-7M163 424l28-12','none','#686D5A',3)
    case 7:return cornerFeet(119,125,362,350,t)+woodPoly([[134,111],[257,93],[343,93],[466,111],[502,198],[483,430],[386,495],[214,495],[117,430],[98,198]],t)+fabric(138,135,324,330,t,61,true)+rail('M143 472Q300 509 457 472',t,8)
    case 8:return rail('M300 300Q149 213 92 91M300 300Q461 187 512 122M300 300Q305 456 265 524',t,37)+woodPoly([[122,189],[219,121],[401,134],[491,219],[462,392],[362,457],[180,424],[103,307]],t)+p('M142 226Q300 168 462 248M139 354Q300 420 455 344','none',t.dark,4)+e(301,301,44,24,'none',t.dark,2)
    case 9:return poly([[118,135],[425,105],[496,192],[469,455],[172,497],[91,377]],stone)+poly([[143,109],[453,137],[490,413],[158,459],[101,194]],'#6F7A70')+poly([[152,139],[442,159],[462,397],[174,434],[127,208]],stone)+fabric(165,174,272,239,t,22)+rail('M153 149L445 168M175 424L452 389',t,10,true)
    case 10:return woodOval(300,300,221,221,t)+e(300,300,199,199,'none',t.dark,3)+planks(127,175,346,250,t,3)+ring(300,300,212,t,true,17)+rail('M182 143H418M182 457H418',t,14,true)+r(421,281,50,38,metal,5)+bolt(446,299,t,6)
    case 11:return e(164,300,77,215,'none',t.dark,29)+e(436,300,77,215,'none',t.dark,29)+e(164,300,77,215,'none',t.timber,23)+e(436,300,77,215,'none',t.timber,23)+fabricPoly([[169,158],[431,158],[413,436],[300,482],[187,436]],t)+[[169,166],[431,166],[190,431],[410,431]].map(([x,y])=>r(x-17,y-19,34,38,metal,5)+bolt(x,y,t,5)).join('')
    case 12:return woodPoly([[138,128],[248,91],[378,111],[479,186],[506,294],[469,423],[366,485],[232,497],[118,426],[88,299]],t)+rep(6,n=>p(`M300 287Q${145+n*55} 200 ${153+n*53} ${130+Math.abs(2-n)*14}`,'none',t.dark,3))+e(300,287,27,23,wood)+bolt(300,287,t,7)
    case 13:return rope('M144 244Q48 113 153 92Q223 107 202 172M435 378Q548 476 454 511Q390 502 405 439',t,15)+woodOval(300,300,222,192,t)+fibres(ellipsePts(300,300,203,173),15,t.light,6,42)+fibres(ellipsePts(300,300,203,173),15,t.dark,5,-42)+e(300,300,211,181,'none',t.light,8)
    case 14:return poly([[91,152],[159,112],[228,146],[198,481],[105,490]],stone)+poly([[509,152],[441,112],[372,146],[402,481],[495,490]],stone)+planks(153,158,294,287,t,5)+[[166,188],[434,188],[179,422],[421,422]].map(([x,y])=>bolt(x,y,t,9)).join('')
    case 15:return regular(300,300,223,3).map(([x,y])=>foot(x,y,t)).join('')+woodOval(300,300,218,218,t)+rep(8,n=>{const a=n*Math.PI/4,b=a+Math.PI/4;return poly([[300,300],[300+178*Math.cos(a),300+178*Math.sin(a)],[300+178*Math.cos(b),300+178*Math.sin(b)]],n%3?t.cloth:t.metal,t.dark,4)})+e(300,300,28,28,stone)
    case 16:return rep(4,n=>g(300,300,rail('M0 0Q-35-105 0-222',t,27,true)+foot(0,-222,t,true),1,n*90))+e(300,300,118,118,metal)+rep(7,n=>ring(300,300,36+n*9,t,true,3))+fabricOval(300,300,171,164,t,true)
    case 17:return regular(300,300,222,4,-45).map(([x,y])=>rail(`M300 300L${x} ${y}`,t,24,true)+foot(x,y,t,true)).join('')+ring(300,300,195,t,true,13)+fabricOval(300,300,173,173,t)+e(300,300,155,155,'none',t.clothLight,3)
    case 18:return regular(300,300,238,3).map(([x,y])=>rail(`M300 300L${x} ${y}`,t,27,true)+foot(x,y,t,true)).join('')+poly(regular(300,300,190,3),metal)+rep(9,n=>{const xx=244+n%3*57,yy=248+Math.floor(n/3)*55;return e(xx,yy,11,11,t.dark,t.metal,2)})+bolt(300,300,t,16)
    case 19:return cornerFeet(137,177,326,256,t)+woodOval(300,300,220,162,t)+fabricOval(300,300,181,138,t,true)+[100,500].map((x,n)=>rail(`M${x} 424V192Q${x+(n?53:-53)} 137 ${x+(n?49:-49)} 218Q${x+(n?52:-52)} 267 ${x} 246`,t,25)).join('')
    case 20:return cornerFeet(119,119,362,362,t)+fabric(96,96,408,408,t,54,true)+r(112,112,376,376,'none',45,t.clothLight,2)
    case 21:return rail('M122 122L478 478M478 122L122 478',t,28)+ring(300,300,220,t,false,19)+ring(300,300,189,t,false,12)+fibres(ellipsePts(300,300,180,180),14,t.light,6,45)+fibres(ellipsePts(300,300,180,180),14,t.dark,5,-45)+e(300,300,178,178,'none',t.timber,8)
    case 22:return beam(300,300,486,26,t,43,true)+beam(300,300,486,26,t,-43,true)+fabric(140,134,320,333,t,12)+rail('M139 139V461M461 139V461',t,19,true)+bolt(300,300,t,13)
    case 23:return e(300,300,223,223,metal)+e(300,300,209,209,'none',t.dark,4)+fabricOval(300,300,193,193,t,true)+r(466,273,54,54,metal,7)+r(76,235,33,130,metal,6)+bolt(494,300,t,6)+bolt(94,258,t,6)+bolt(94,342,t,6)
    default:throw new Error('未知坐凳构造。')
  }
}

function bench(i:number,t:Palette):string{
  switch(i){
    case 0:return beam(119,300,391,50,t,90)+beam(481,300,391,50,t,90)+planks(67,166,466,268,t,3)+[119,481].map(x=>bolt(x,192,t,9)+bolt(x,408,t,9)).join('')
    case 1:return woodOval(134,300,67,204,t)+woodOval(466,300,67,204,t)+woodPoly([[67,181],[135,158],[256,167],[369,146],[531,181],[524,411],[430,441],[297,423],[177,440],[71,411]],t)+p('M101 200Q300 178 505 195M103 397Q300 419 503 403M169 229L220 282 201 355 261 404','none',t.dark,4)
    case 2:return beam(127,300,425,63,t,90)+beam(473,300,425,63,t,90)+plank(61,193,478,214,t)+[127,473].map(x=>r(x-14,156,28,39,wood,3)+r(x-14,407,28,39,wood,3)).join('')+rail('M92 220H508M92 380H508',t,6)
    case 3:return cornerFeet(90,144,420,312,t)+planks(71,132,458,336,t,3)+rail('M94 148V453M506 148V453',t,17,true)+r(164,122,65,40,metal,4)+r(371,122,65,40,metal,4)+r(269,441,62,39,metal,4)+e(300,460,5,6,t.dark)
    case 4:return cornerFeet(83,113,434,374,t)+r(83,112,434,374,wood,6)+planks(117,199,366,246,t,3)+warpRect(113,136,374,57,t)+rail('M97 149V458M503 149V458',t,29)
    case 5:return cornerFeet(88,146,424,310,t)+planks(80,117,440,350,t,4)+rail('M87 138V465M513 138V465M85 464H515',t,32)+rep(3,n=>fabric(113+n*128,210,117,227,t,16,true))
    case 6:return [134,466].map(x=>r(x-50,99,100,402,stone,10)).join('')+poly([[68,169],[283,159],[532,173],[526,429],[307,443],[71,426]],stone)+p('M92 192Q300 180 508 197M92 407Q300 422 506 409','none','#BFC1A6',5)+p('M114 208l34-7m247 220 38-9m-195-21 15-20','none','#7B816D',3)
    case 7:return woodPoly([[62,208],[176,124],[424,124],[538,208],[519,465],[81,465]],t)+rail('M65 206Q300 62 535 206',t,35)+planks(99,236,402,192,t,3)+[179,421].map(x=>rail(`M${x} 185V444`,t,20)).join('')
    case 8:return rail('M142 292L78 494M300 302L300 509M459 292L522 494',t,29)+woodPoly([[67,231],[170,129],[300,94],[430,129],[533,231],[500,444],[391,380],[300,363],[209,380],[100,444]],t)+p('M88 248Q300 28 512 248M105 408Q300 288 495 408','none',t.dark,4)
    case 9:return [126,474].map(x=>poly([[x-55,123],[x+41,104],[x+64,152],[x+64,447],[x+33,493],[x-55,477]],stone)).join('')+rail('M81 194H519M81 406H519',t,27,true)+rep(3,n=>plank(159+n*99,156,88,288,t,n))+[[135,194],[465,194],[135,406],[465,406]].map(([x,y])=>bolt(x,y,t,11)).join('')
    case 10:return [130,470].map(x=>woodOval(x,300,76,190,t)+fibres(ellipsePts(x,300,65,180),14,t.light,6,45)+fibres(ellipsePts(x,300,65,180),14,t.dark,5,-45)).join('')+warpRect(168,177,264,246,t)+rail('M124 184Q300 126 476 184M124 416Q300 474 476 416',t,21)
    case 11:return [96,300,504].map(x=>rail(`M${x} 123Q${x-38} 300 ${x} 477`,t,32)).join('')+fabricPoly([[106,165],[290,190],[281,426],[111,448]],t)+fabricPoly([[310,190],[494,165],[489,448],[319,426]],t)+[116,282,318,484].map(x=>rope(`M${x} 173V436`,t,8)).join('')
    case 12:return woodPoly(arcPts(300,300,235,235,114/235,0,360,72),t)+ring(300,300,233,t,false,14)+rep(4,n=>g(300,300,fabric(-103,-219,206,95,t,23,true),1,n*90))+e(300,300,114,114,'none',t.light,5)
    case 13:return [132,468].map(x=>poly([[x-53,121],[x+34,109],[x+71,429],[x+27,489],[x-63,475]],stone)).join('')+rep(5,n=>plank(58,166+n*55,484,43,t,n))+[[128,183],[471,183],[140,403],[459,403]].map(([x,y])=>bolt(x,y,t,9)).join('')
    case 14:return r(70,95,460,410,stone,12)+r(87,163,426,326,'#8D9580',9)+r(105,228,390,244,stone,7)+fabric(119,248,362,203,t,13)+rail('M90 178H510M105 244H495',t,9,true)
    case 15:return rail('M62 181Q300 64 538 181M62 419Q300 536 538 419',t,27)+fabricPoly([[74,194],[300,130],[526,194],[526,406],[300,470],[74,406]],t)+rope('M83 189Q300 96 517 189M83 411Q300 504 517 411',t,10)+rope('M81 192V410M519 192V410',t,9)
    case 16:return [104,300,496].map(x=>rail(`M${x} 88V512`,t,29,true)).join('')+beam(300,300,485,55,t)+planks(67,129,466,131,t,3)+planks(67,340,466,131,t,3)+rail('M70 280H530M70 320H530',t,22)
    case 17:return planks(84,173,432,261,t,6)+rail('M91 164Q300 108 509 164M95 448H505',t,23)+[95,300,505].map((x,n)=>rail(`M${x} 150V445M${x} 173q${n===2?42:-42}-90 0-86q43 0 0 86`,t,20,true)).join('')
    case 18:return cornerFeet(104,147,392,306,t)+plank(86,144,428,310,t)+fabric(104,160,181,280,t,19,true)+fabric(315,160,181,280,t,19,true)+e(300,119,28,24,metal)+e(300,481,28,24,metal)+rail('M285 300H315',t,16,true)
    case 19:return cornerFeet(82,135,436,330,t,true)+planks(66,125,468,350,t,5)+[220,380].map(x=>rail(`M${x} 145V455`,t,14,true)).join('')+rail('M79 135H521M79 465H521',t,17,true)
    case 20:return fabric(70,111,460,363,t,87,true)+fabric(95,143,410,82,t,34,true)+rep(4,n=>fabric(111+n*96,245,88,202,t,22,true))+fabric(76,172,33,267,t,13)+fabric(491,172,33,267,t,13)
    case 21:return woodPoly([[72,178],[182,123],[418,123],[528,178],[514,475],[86,475]],t)+rail('M79 181Q300 72 521 181',t,27)+rep(5,n=>plank(101,222+n*43,398,32,t,n))+rail('M79 161V478M521 161V478',t,21,true)
    case 22:return cornerFeet(95,95,410,410,t)+rail('M95 95L300 300 505 95M95 505L300 300 505 505',t,28)+fabric(183,183,234,234,t,42,true)+[0,90,180,270].map(a=>g(300,300,fabric(-172,-222,344,103,t,28,true),1,a)).join('')+r(207,207,186,186,cloth,34)
    case 23:return [157,443].map(x=>beam(x,300,298,26,t,25,true)+beam(x,300,298,26,t,-25,true)+bolt(x,300,t,12)).join('')+plank(66,184,231,232,t)+plank(303,184,231,232,t)+r(282,194,36,51,metal,4)+r(282,355,36,51,metal,4)
    default:throw new Error('未知长凳构造。')
  }
}

const bookColors=['#9B735B','#7C8D76','#A99874','#7D7C8C','#AA8D77','#6E807D','#9D946C']
const bookRow=(x:number,y:number,w:number,h:number,t:Palette,seed=0)=>{
  const n=Math.max(2,Math.floor(w/24)),bw=w/n
  return rep(n,k=>{const xx=x+k*bw,hh=h*(.83+((k*7+seed)%5)*.035),yy=y+h-hh;return r(xx+1,yy,bw-3,hh,bookColors[(k+seed)%bookColors.length],2,t.dark,1.3)+r(xx+4,yy+7,Math.max(2,bw-9),Math.max(8,hh-14),'#CEC6A5',1,t.dark,.7)+p(`M${xx+5} ${yy+13}v${hh-26}M${xx+bw-6} ${yy+13}v${hh-26}`,'none','#A9A38B',.7)+p(`M${xx+1} ${yy+hh*.22}h${bw-3}M${xx+1} ${yy+hh*.78}h${bw-3}`,'none',t.light,1.5)})
}
const bookBay=(x:number,y:number,w:number,h:number,t:Palette,seed=0)=>r(x,y,w,h,wood,5)+grain(x+2,y+2,w-4,h-4,t,seed)+r(x+17,y+17,w-34,h-34,t.dark,3)+bookRow(x+25,y+25,w-50,h-50,t,seed)
const stackedBook=(x:number,y:number,w:number,h:number,t:Palette,a=0,seed=0)=>g(x,y,r(-w/2+3,-h/2+5,w,h,'#D1C8A8',3,t.dark,1.5)+r(-w/2,-h/2,w,h,bookColors[seed%bookColors.length],4,t.dark,2)+r(-w/2+9,-h/2+9,w-18,h-18,'none',2,t.light,1.2)+rail(`M${-w/2+5} ${-h/2+5}V${h/2-5}`,t,4),1,a)
const scroll=(x:number,y:number,s:number,t:Palette)=>g(x,y,e(0,0,32,34,'#C9BE97')+e(0,0,21,23,'none',t.dark,2)+p('M-9-12q25-7 23 14q-1 15-16 12q-11-2-7-12q3-6 10-2','none','#8C8567',1.8),s)
const arcPts=(cx:number,cy:number,rx:number,ry:number,inner:number,start:number,end:number,steps=32):Pt[]=>[
  ...Array.from({length:steps+1},(_,n)=>{const a=(start+(end-start)*n/steps)*Math.PI/180;return [cx+rx*Math.cos(a),cy+ry*Math.sin(a)] as Pt}),
  ...Array.from({length:steps+1},(_,n)=>{const a=(end-(end-start)*n/steps)*Math.PI/180;return [cx+rx*inner*Math.cos(a),cy+ry*inner*Math.sin(a)] as Pt}),
]
function bookshelf(i:number,t:Palette):string{
  switch(i){
    case 0:return cornerFeet(83,139,434,322,t)+bookBay(76,131,448,338,t)+plank(288,147,24,305,t)
    case 1:return plank(59,106,482,67,t)+[72,231,390].map((x,n)=>bookBay(x,179,137,277,t,n*2)).join('')+plank(59,456,482,41,t)
    case 2:return bookBay(77,77,203,446,t)+bookBay(281,320,242,203,t,3)+plank(99,300,401,29,t)
    case 3:return cornerFeet(79,115,442,370,t)+bookBay(68,116,464,166,t)+bookBay(68,318,464,166,t,3)+plank(60,284,480,32,t)
    case 4:return r(74,131,452,338,wood,8)+[87,235,383].map((x,n)=>r(x,144,130,312,t.dark,4)+scroll(x+65,231,1.52,t)+scroll(x+65,369,1.52,t)+plank(x+5,292,120,20,t,n)).join('')+rail('M80 137H520M80 463H520',t,12)
    case 5:return rail('M82 235V282M518 235V282',t,24)+bookBay(68,98,464,151,t)+planks(68,269,464,237,t,3)+g(190,378,p('M-96-83Q-40-103 0-71Q40-103 96-83V83Q40 64 0 94Q-40 64-96 83Z','#D9D0AE')+p('M0-69V91M-81-61q39-13 68 0m-68 22q39-13 68 0m-68 22q39-13 68 0M13-61q39-13 68 0m-68 22q39-13 68 0m-68 22q39-13 68 0','none','#8D8A6F',1.4),.9,-6)+stackedBook(418,387,130,178,t,8,4)
    case 6:return woodPoly([[70,150],[159,101],[441,101],[530,150],[519,455],[438,493],[162,493],[81,455]],t)+bookBay(94,154,163,291,t,2)+bookBay(343,154,163,291,t,4)+stackedBook(301,298,132,184,t,-10,1)+stackedBook(300,278,121,175,t,8,2)
    case 7:return bookBay(230,66,140,468,t)+bookBay(66,230,164,140,t,2)+bookBay(370,230,164,140,t,4)+plank(282,78,36,443,t)+plank(78,282,443,36,t)
    case 8:return rail('M78 326Q300 243 526 321M159 121Q204 203 183 472M435 127Q395 256 458 473',t,33)+g(163,290,bookBay(-86,-170,172,340,t,2),1,-8)+g(306,291,bookBay(-68,-158,136,316,t,4),1,4)+g(447,303,bookBay(-70,-167,140,334,t,1),1,-7)
    case 9:return r(62,150,476,300,metal,8)+[94,222,350,478].map(x=>r(x-20,113,40,374,stone,7)).join('')+[114,242,370].map((x,n)=>bookRow(x+5,169,98,263,t,n+1)).join('')+rail('M65 151H535M65 449H535',t,13,true)
    case 10:return bookBay(65,78,470,157,t)+bookBay(65,235,157,284,t,2)+bookBay(378,235,157,284,t,5)+woodOval(143,492,77,43,t)+woodOval(457,492,77,43,t)+plank(203,237,194,27,t)
    case 11:return rope('M121 90V513M479 90V513',t,13)+bookBay(80,142,440,316,t)+[[121,119],[479,119],[121,481],[479,481]].map(([x,y])=>e(x,y,21,26,'none',t.metal,10)).join('')+rope('M120 121v22M480 121v22M120 458v24M480 458v24',t,10)
    case 12:return woodOval(300,300,232,232,t)+poly(regular(300,300,211,6),t.dark)+rep(6,n=>g(300,300,bookBay(-59,-205,118,129,t,n),1,n*60))+rail('M300 76V524M106 188L494 412M106 412L494 188',t,17)+e(300,300,52,52,wood)+scroll(300,300,1.24,t)
    case 13:return [[67,170,-8],[233,156,5],[402,183,-6]].map(([x,y,a],n)=>g(x+66,y+135,poly([[-72,-137],[72,-123],[82,137],[-66,149]],stone)+bookRow(-52,-105,108,226,t,n*2),1,a)).join('')+rail('M80 420H522M80 166H522',t,16,true)
    case 14:return rail('M132 141Q300 101 468 141M132 459Q300 499 468 459',t,23)+[185,415].map((x,n)=>woodOval(x,300,124,190,t)+e(x,300,97,161,t.dark)+bookRow(x-67,169,134,262,t,n+2)+scroll(x,390,.96,t)).join('')+plank(274,155,52,291,t)
    case 15:return r(73,110,454,370,wood,4)+rep(8,n=>{const x=76+n%4*112,y=113+Math.floor(n/4)*191;return n%3===1?g(x+54,y+86,bookBay(-54,-86,108,172,t,n),1,180):bookBay(x,y,108,172,t,n)})+rail('M76 300H524',t,12,true)+[[77,113],[523,113],[77,477],[523,477]].map(([x,y])=>r(x-15,y-17,30,34,metal,4)+bolt(x,y,t,5)).join('')
    case 16:return [74,228,382].map((x,n)=>bookBay(x,132,144,326,t,n*2)).join('')+plank(63,114,474,26,t)+plank(63,460,474,26,t)+cornerFeet(78,122,444,356,t)
    case 17:return [[66,88],[495,88],[66,472],[495,472]].map(([x,y])=>r(x,y,39,42,t.dark,12)+r(x+8,y+7,23,28,metal,9)).join('')+bookBay(89,126,422,158,t)+bookBay(89,316,422,158,t,4)+plank(83,286,434,28,t)+rail('M89 178H43V422H89M511 178H557V422H511',t,19,true)
    case 18:return cornerFeet(77,134,446,332,t)+bookBay(74,132,217,336,t)+bookBay(309,132,217,336,t,3)+r(91,149,183,302,'none',4,t.metal,11)+r(326,149,183,302,'none',4,t.metal,11)+p('M109 166L256 431M344 166L491 431M124 164L258 408M359 164L493 408','none','#D1D8BE',2.7)+rail('M300 144V454',t,15,true)
    case 19:return bookBay(60,185,154,301,t)+bookBay(223,120,154,366,t,2)+bookBay(386,64,154,422,t,4)+rail('M65 492H535M65 190V479M231 128V479M394 72V479',t,10,true)
    case 20:return rep(4,n=>g(300,300,bookBay(-103,-225,206,150,t,n+1),1,n*90))+e(300,300,99,99,wood)+ring(300,300,75,t,true,12)+rail('M300 65V535M65 300H535',t,19)+bolt(300,300,t,13)
    case 21:return rail('M94 99L126 501M506 99L474 501M91 106H509M125 494H475',t,25)+[120,239,358].map((y,n)=>bookBay(134,y,332,111,t,n*2)).join('')+rail('M88 173L50 430M512 173L550 430',t,14,true)
    case 22:return woodOval(130,300,77,188,t)+woodOval(470,300,77,188,t)+bookBay(129,198,342,204,t,2)+stackedBook(142,311,110,162,t,-6,3)+stackedBook(295,300,117,158,t,8,1)+stackedBook(458,300,110,166,t,-4,5)
    case 23:return bookBay(63,66,474,143,t)+bookBay(63,391,474,143,t,2)+bookBay(63,210,143,180,t,3)+bookBay(394,210,143,180,t,5)+[[65,68],[535,68],[65,532],[535,532]].map(([x,y])=>r(x-15,y-15,30,30,metal,4)+bolt(x,y,t,5)).join('')
    default:throw new Error('未知书架构造。')
  }
}

const sofaRail=(x:number,y:number,w:number,h:number,t:Palette,rad=17)=>plank(x,y,w,h,t)+r(x+7,y+7,w-14,h-14,'none',rad,t.light,1.3)
const pillows=(x:number,y:number,w:number,h:number,n:number,t:Palette)=>rep(n,k=>fabric(x+k*(w+9),y,w,h,t,19,k%2===1))
function sofa(i:number,t:Palette):string{
  switch(i){
    case 0:return cornerFeet(83,137,434,326,t)+planks(68,126,464,348,t,4)+rail('M86 139V462M514 139V462',t,31)+fabric(119,158,362,285,t,26)+fabric(133,169,79,263,t,35)+rope('M153 184V415M184 184V415',t,4)
    case 1:return planks(70,129,460,342,t,4)+rail('M88 141V459M512 141V459',t,27,true)+fabric(113,160,181,284,t,22,true)+fabric(306,160,181,284,t,22,true)+r(270,455,60,28,metal,4)
    case 2:return cornerFeet(82,122,436,356,t)+r(77,115,446,370,wood,16)+warpRect(108,153,384,296,t)+rail('M92 136V470M508 136V470M86 131H514',t,29)+pillows(122,166,106,94,3,t)
    case 3:return r(65,112,470,376,stone,31)+r(89,137,422,326,'#8F9781',20)+fabric(129,173,180,264,t,16)+fabric(291,173,180,264,t,16)+r(77,140,43,316,stone,11)+r(480,140,43,316,stone,11)+fabric(142,180,132,73,t,21)
    case 4:return planks(71,120,458,360,t,4)+sofaRail(76,114,448,67,t)+rail('M89 143Q60 251 94 460M511 143Q540 251 506 460',t,35)+rep(3,n=>fabric(117+n*125,217,115,228,t,23,true))+pillows(125,157,106,74,3,t)
    case 5:return woodPoly([[67,166],[145,105],[455,105],[533,166],[509,471],[91,471]],t)+fabricPoly([[122,220],[179,153],[421,153],[478,220],[468,436],[132,436]],t)+fabric(107,228,76,143,t,27)+fabric(417,228,76,143,t,27)+pillows(185,171,70,73,3,t)+fabric(235,359,131,75,t,18,true)
    case 6:return woodPoly([[67,74],[525,74],[525,240],[240,240],[240,526],[67,526]],t)+rail('M84 510V90H510',t,31)+fabric(114,127,180,91,t,16)+fabric(305,127,180,91,t,16)+fabric(113,236,95,128,t,16)+fabric(113,375,95,128,t,16)+fabric(125,139,89,91,t,21,true)
    case 7:return cornerFeet(81,135,438,334,t)+r(73,120,454,360,wood,65)+fabric(119,151,362,297,t,52,true)+[105,495].map(x=>fabricOval(x,300,47,177,t)+rail(`M${x} 160Q${x+(x<300?-60:60)} 119 ${x+(x<300?-51:51)} 214M${x} 440Q${x+(x<300?-60:60)} 481 ${x+(x<300?-51:51)} 386`,t,18)).join('')+fabric(169,171,63,255,t,31)+fabric(368,171,63,255,t,31)
    case 8:return rail('M129 159Q91 309 141 471M123 143Q298 39 471 224M440 422L502 478',t,29)+woodPoly([[122,151],[263,105],[424,160],[498,282],[469,422],[353,491],[193,465],[106,322]],t)+fabricPoly([[145,184],[262,139],[405,190],[460,294],[433,401],[343,454],[208,430],[144,319]],t)+fabric(159,183,121,86,t,31,true)
    case 9:return cornerFeet(78,137,444,326,t,true)+r(76,128,448,344,metal,13)+rep(3,n=>plank(107+n*130,154,126,291,t,n)+fabric(115+n*130,204,110,239,t,18,true))+rail('M90 145H510M90 452H510M91 155V445M509 155V445',t,26,true)+pillows(118,158,111,72,3,t)
    case 10:return woodOval(300,300,236,212,t)+fibres(ellipsePts(300,300,224,201),13,t.light,5,45)+fibres(ellipsePts(300,300,224,201),13,t.dark,4,-45)+fabricOval(300,334,190,142,t,true)+fabricOval(205,172,97,53,t)+fabricOval(395,172,97,53,t)+e(300,300,226,202,'none',t.timber,17)
    case 11:return rail('M100 159Q70 300 113 456M500 159Q530 300 487 456M100 160H500M111 444H489',t,32)+fabricPoly([[132,148],[259,131],[327,158],[471,140],[490,273],[468,424],[362,460],[257,435],[132,463],[105,332]],t)+rope('M134 167L120 432M466 165L478 411',t,10)+pillows(165,177,120,79,2,t)
    case 12:return woodPoly(arcPts(300,300,239,233,.43,-40,260,40),t)+poly(arcPts(300,300,233,227,.82,-40,260,40),cloth)+weave(arcPts(300,300,229,223,.84,-40,260,40),t)+rep(5,n=>fabricPoly(arcPts(300,300,194,188,.58,-38+n*59,17+n*59,9),t))+fabricOval(476,172,36,53,t)+fabricOval(261,482,53,31,t)
    case 13:return poly([[74,109],[484,84],[532,465],[126,504]],stone)+poly([[87,139],[513,127],[504,478],[95,470]],'#7F8C77')+poly([[89,151],[502,151],[488,466],[103,466]],stone)+fabric(119,186,362,247,t,27)+fabricPoly([[135,204],[231,204],[193,359],[126,352]],t)+rail('M114 443H486',t,12,true)
    case 14:return [127,473].map(x=>woodOval(x,300,70,188,t)+fibres(ellipsePts(x,300,58,177),13,t.light,5,45)+fibres(ellipsePts(x,300,58,177),13,t.dark,4,-45)).join('')+fabric(158,152,284,298,t,50)+fabric(163,157,274,88,t,33,true)+rope('M157 196V414M443 196V414',t,9)
    case 15:return fabricOval(300,345,211,151,t,true)+g(192,203,fabricOval(0,0,125,74,t),1,-35)+fabricOval(300,159,117,73,t)+g(408,203,fabricOval(0,0,125,74,t),1,35)+fabricPoly([[133,337],[255,247],[289,313],[282,456],[142,427]],t)+fabricPoly([[311,313],[345,247],[467,337],[458,427],[318,456]],t)
    case 16:return fabric(70,116,460,368,t,64,true)+fabric(107,132,386,113,t,46,true)+rep(3,n=>fabric(128+n*118,252,108,207,t,23,true))+fabricOval(99,306,39,160,t,true)+fabricOval(501,306,39,160,t,true)
    case 17:return woodPoly([[72,189],[139,108],[299,141],[407,219],[529,247],[517,462],[102,478]],t)+fabricPoly([[112,209],[151,155],[289,178],[394,251],[493,273],[483,433],[127,444]],t)+fabricOval(116,301,42,155,t)+fabric(166,179,96,105,t,34,true)+rail('M104 468H514',t,15)
    case 18:return cornerFeet(81,130,438,340,t)+fabric(73,116,454,368,t,46)+fabric(135,144,158,114,t,31,true)+fabric(307,144,158,114,t,31,true)+fabric(142,274,151,179,t,30,true)+fabric(307,274,151,179,t,30,true)+fabric(78,161,55,294,t,26)+fabric(467,161,55,294,t,26)
    case 19:return cornerFeet(86,128,428,342,t)+r(77,116,446,366,wood,57)+warpRect(104,135,392,97,t)+rail('M91 147Q48 265 91 466M509 147Q552 265 509 466',t,20)+fabric(123,248,171,205,t,29)+fabric(306,248,171,205,t,29)
    case 20:return r(64,113,472,374,wood,18)+fabric(126,135,348,119,t,13)+rep(3,n=>fabric(137+n*112,264,102,192,t,14,true))+[72,476].map(x=>r(x,143,52,319,wood,5)+r(x+9,173,34,271,cloth,9)+r(x+18,203,16,211,metal,3)).join('')
    case 21:return woodPoly(arcPts(300,404,241,303,.34,194,346,34),t)+fabricPoly(arcPts(300,404,235,294,.79,194,346,34),t)+rep(4,n=>fabricPoly(arcPts(300,404,194,238,.44,196+n*37,230+n*37,9),t))+fabricOval(75,350,33,71,t)+fabricOval(525,350,33,71,t)
    case 22:return cornerFeet(91,142,418,316,t)+fabric(72,127,456,346,t,59,true)+g(184,230,fabric(-64,-59,128,118,t,28),1,-12)+g(411,361,fabric(-69,-55,138,110,t,30,true),1,9)+r(80,158,17,284,wood,5)+r(503,158,17,284,wood,5)
    case 23:return fabric(66,77,468,446,t,72,true)+fabricPoly([[85,229],[203,185],[300,259],[397,185],[515,229],[503,306],[395,274],[300,339],[205,274],[97,306]],t)+fabric(121,106,150,92,t,29)+fabric(329,106,150,92,t,29)+fabric(121,403,150,92,t,29)+fabric(329,403,150,92,t,29)+fabric(93,312,180,82,t,29,true)+fabric(327,312,180,82,t,29,true)
    default:throw new Error('未知软坐榻构造。')
  }
}

const screenSegment=(a:Pt,b:Pt,t:Palette,material:'wood'|'cloth'|'wicker'|'stone'|'glass'='cloth',w=30)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),angle=Math.atan2(dy,dx)*180/Math.PI
  const mid=(a[0]+b[0])/2,my=(a[1]+b[1])/2
  const core=material==='wood'?plank(-len/2,-w/2,len,w,t):material==='stone'?r(-len/2,-w/2,len,w,stone,5):material==='wicker'?warpRect(-len/2,-w/2,len,w,t):material==='glass'?r(-len/2,-w/2,len,w,glass,5)+p(`M${-len/2+10} ${-w/2+8}H${len/2-10}`,'none','#E0E7CE',2):fabric(-len/2,-w/2,len,w,t,4)
  return g(mid,my,core,1,angle)+e(a[0],a[1],11,11,wood)+e(b[0],b[1],11,11,wood)
}
const screenChain=(pts:readonly Pt[],t:Palette,mat:'wood'|'cloth'|'wicker'|'stone'|'glass'='cloth',w=30)=>pts.slice(1).map((b,n)=>screenSegment(pts[n],b,t,mat,w)).join('')
const screenFoot=(x:number,y:number,t:Palette,a=0,iron=false)=>g(x,y,beam(0,0,134,30,t,0,iron)+foot(0,0,t,iron),1,a)
function screen(i:number,t:Palette):string{
  switch(i){
    case 0:return screenFoot(84,398,t,-42)+screenFoot(516,398,t,42)+screenChain([[84,398],[300,167],[516,398]],t,'wood',41)+bolt(300,167,t,8)
    case 1:return screenFoot(74,396,t,-55)+screenFoot(526,168,t,-55)+screenChain([[74,396],[225,168],[376,396],[526,168]],t,'wicker',34)+rope('M218 158l18 21m-18-10 18 21M369 386l18 21m-18-10 18 21',t,5)
    case 2:return screenFoot(94,300,t,90)+screenFoot(506,300,t,90)+screenSegment([94,300],[506,300],t,'cloth',39)+rail('M94 276H506',t,12)+bolt(94,300,t,9)+bolt(506,300,t,9)
    case 3:return screenFoot(72,396,t,-46)+screenFoot(528,194,t,46)+screenChain([[72,396],[224,194],[376,396],[528,194]],t,'wood',37)+[[224,194],[376,396]].map(([x,y])=>r(x-15,y-18,30,36,metal,4)+bolt(x,y,t,5)).join('')+p('M100 370l80-105M252 232l90 124M404 358l84-118','none',t.metal,5)
    case 4:return screenFoot(65,383,t,-59)+screenFoot(535,383,t,59)+screenChain([[65,383],[182,193],[300,383],[418,193],[535,383]],t,'wood',31)+rep(4,k=>{const pts:[[number,number],[number,number]]=[[65+k*117.5,k%2?193:383],[182.5+k*117.5,k%2?383:193]];return rep(9,n=>{const q=(n+1)/10,x=pts[0][0]+(pts[1][0]-pts[0][0])*q,y=pts[0][1]+(pts[1][1]-pts[0][1])*q;return beam(x,y,39,9,t,k%2?-32:32)})})
    case 5:return screenFoot(76,406,t,-52)+screenFoot(524,406,t,52)+screenChain([[76,406],[300,153],[524,406]],t,'cloth',47)+rail('M77 389L300 137 523 389',t,12)+[[99,380],[157,311],[245,205],[355,205],[443,311],[501,380]].map(([x,y])=>rope(`M${x-8} ${y-8}l16 16m-15-6 14 14`,t,4)).join('')
    case 6:return r(74,201,92,198,stone,11)+r(434,201,92,198,stone,11)+screenSegment([120,300],[480,300],t,'cloth',51)+rail('M120 269H480',t,15,true)+bolt(120,300,t,12)+bolt(480,300,t,12)
    case 7:return screenFoot(81,433,t,32)+screenFoot(519,433,t,-32)+screenChain([[81,433],[98,203],[300,133],[502,203],[519,433]],t,'cloth',40)+rail('M81 411L96 178 300 111 504 178 519 411',t,13)+woodOval(81,433,30,40,t)+woodOval(519,433,30,40,t)
    case 8:return screenFoot(88,428,t,-42)+screenFoot(512,401,t,31)+rail('M88 428Q153 289 187 171Q269 244 312 382Q380 247 421 143Q472 249 512 401',t,29)+screenSegment([103,410],[186,194],t,'wicker',27)+screenSegment([199,195],[312,365],t,'wicker',27)+screenSegment([324,365],[418,166],t,'wicker',27)+screenSegment([435,169],[504,384],t,'wicker',27)
    case 9:return r(44,314,75,142,stone,9)+r(481,134,75,142,stone,9)+screenChain([[84,383],[169,191],[257,386],[345,173],[433,367],[516,205]],t,'stone',42)+rail('M90 366L169 190 257 385 345 175 433 366 511 219',t,11,true)
    case 10:return woodOval(89,300,49,176,t)+woodOval(511,300,49,176,t)+screenChain([[89,300],[231,183],[370,417],[511,300]],t,'cloth',43)+rail('M91 281L231 165 370 398 508 282',t,14)+screenFoot(89,300,t,90)+screenFoot(511,300,t,90)
    case 11:return screenFoot(77,364,t,-25)+screenFoot(523,364,t,25)+screenChain([[77,364],[300,176],[523,364]],t,'wicker',62)+rail('M78 333Q190 135 301 164Q412 135 522 333',t,19)+screenFoot(300,176,t,90)
    case 12:return screenFoot(63,385,t,-53,true)+screenFoot(537,385,t,53,true)+screenChain([[63,385],[182,172],[300,385],[418,172],[537,385]],t,'cloth',34)+rail('M64 365L181 151 300 364 418 151 536 365',t,13,true)+[[182,172],[300,385],[418,172]].map(([x,y])=>e(x,y,16,16,metal)+bolt(x,y,t,7)).join('')
    case 13:return [76,188,300,412,524].map((x,n)=>screenFoot(x,n%2?174:392,t,n%2?48:-48)+rail(`M${x} ${n%2?130:348}V${n%2?211:429}`,t,26)).join('')+screenChain([[76,392],[188,174],[300,392],[412,174],[524,392]],t,'cloth',45)+rope('M166 165l39 19M276 381l43 21M390 163l39 21',t,6)
    case 14:return r(54,315,78,143,stone,12)+r(332,315,78,143,stone,12)+screenChain([[92,385],[231,177],[370,385],[509,177]],t,'glass',43)+rail('M95 363L231 156 370 363 507 157',t,9,true)+screenFoot(509,177,t,-55,true)
    case 15:return woodPoly(arcPts(300,300,223,213,.83,35,325,40),t)+rep(46,n=>{const a=(35+n*290/45)*Math.PI/180;return rope(`M${300+190*Math.cos(a)} ${300+181*Math.sin(a)}L${300+220*Math.cos(a)} ${300+210*Math.sin(a)}`,t,5)})+screenFoot(482,422,t,40)+screenFoot(482,178,t,-40)
    case 16:return screenChain([[85,398],[229,175],[373,398],[517,175]],t,'cloth',40)+rail('M86 379L229 155 373 379 516 155',t,12,true)+[[85,398],[229,175],[373,398],[517,175]].map(([x,y])=>screenFoot(x,y,t,35,true)+e(x-55,y-38,13,17,t.dark)+e(x+55,y+38,13,17,t.dark)).join('')
    case 17:return screenFoot(70,385,t,-58)+screenFoot(530,385,t,58)+screenChain([[70,385],[185,171],[300,385],[415,171],[530,385]],t,'wicker',37)+[[70,385],[530,385]].map(([x,y])=>woodOval(x,y,24,30,t)).join('')
    case 18:return screenFoot(69,398,t,-40)+screenFoot(531,365,t,40)+screenChain([[69,398],[157,177],[286,377],[423,177],[531,365]],t,'wood',40)+rail('M71 375L157 155 286 355 423 155 530 343',t,9,true)+r(135,148,44,58,metal,4)+r(264,348,44,58,metal,4)+r(401,148,44,58,metal,4)
    case 19:return screenFoot(84,396,t,-51)+screenFoot(516,166,t,51)+screenChain([[84,396],[228,166],[372,396],[516,166]],t,'glass',48)+rail('M84 371L228 142 372 372 515 142',t,16)+rep(3,k=>rep(7,n=>{const q=(n+1)/8,x=84+k*144+q*144,y=(k%2?166:396)+(k%2?230:-230)*q;return beam(x,y,45,6,t,k%2?-31:31,true)}))
    case 20:return screenFoot(119,300,t,90,true)+screenFoot(481,300,t,90,true)+screenSegment([92,300],[508,300],t,'cloth',47)+rail('M92 272H508',t,16,true)+[[119,237],[119,363],[481,237],[481,363]].map(([x,y])=>r(x-15,y-18,30,36,t.dark,11)+e(x,y,7,11,metal)).join('')
    case 21:return screenFoot(60,386,t,-62,true)+screenFoot(540,386,t,62,true)+screenChain(Array.from({length:9},(_,n)=>[60+n*60,n%2?193:386] as Pt),t,'cloth',28)+rail('M60 367L120 174 180 367 240 174 300 367 360 174 420 367 480 174 540 367',t,7,true)
    case 22:return screenFoot(82,383,t,20,true)+screenFoot(518,383,t,-20,true)+screenChain([[82,383],[128,241],[232,152],[368,152],[472,241],[518,383]],t,'wood',43)+rail('M81 360L118 220 226 131H374L482 220 519 360',t,10,true)
    case 23:return screenFoot(88,478,t,90)+screenFoot(515,110,t,90)+screenFoot(87,111,t,0)+screenChain([[88,478],[88,111],[515,111]],t,'wood',38)+screenSegment([88,474],[88,300],t,'glass',25)+screenSegment([300,111],[511,111],t,'cloth',25)+bolt(88,111,t,12)
    default:throw new Error('未知屏风顶视构造。')
  }
}

const fringe=(x:number,y:number,w:number,t:Palette,n=26,len=24)=>p(rep(n,k=>{const xx=x+(k+.5)*w/n,dy=len*(.68+(k%4)*.1);return `M${xx} ${y}l${k%3-1} ${dy}m${k%3-1} ${-dy*.3}l${k%2?3:-3} ${dy*.3} `}),'none',t.clothLight,2.8)
const edgeFringe=(pts:readonly Pt[],t:Palette,spacing=15,len=22)=>p(pts.slice(1).map((b,k)=>{const a=pts[k],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/spacing));return rep(n,j=>{const q=(j+.5)/n,x=a[0]+(b[0]-a[0])*q,y=a[1]+(b[1]-a[1])*q;return `M${fmt(x)} ${fmt(y-2)}l${j%3-1} ${fmt(len*(.8+(j%3)*.1))} `})}).join(''),'none',t.clothLight,2.8)
const rugRect=(x:number,y:number,w:number,h:number,t:Palette,border=24)=>fabric(x,y,w,h,t,5)+r(x+border,y+border,w-2*border,h-2*border,'none',2,t.clothDark,8)+r(x+border+10,y+border+10,w-2*border-20,h-2*border-20,'none',2,t.clothLight,2)
const diamond=(x:number,y:number,rx:number,ry:number,fill:string,stroke=ink,sw=2)=>poly([[x,y-ry],[x+rx,y],[x,y+ry],[x-rx,y]],fill,stroke,sw)
function rug(i:number,t:Palette):string{
  switch(i){
    case 0:return rugRect(91,71,418,458,t,22)+fibres(roundedPts(114,94,372,412,2),9,t.light,4,90)+fringe(101,529,398,t,28,23)+g(300,71,g(-300,-71,fringe(101,71,398,t,28,23)),1,180)
    case 1:return fabricPoly([[93,74],[247,69],[399,73],[509,68],[516,236],[510,395],[514,530],[362,526],[218,534],[87,529],[93,373],[86,219]],t)+p('M111 89H493V511H108Z','none',t.clothDark,6)+fibres(roundedPts(113,94,377,415,3),5,t.clothLight,1.5,0)+p('M102 99V508M498 99V508','none',t.clothLight,4)
    case 2:return rugRect(96,73,408,454,t,16)+rep(9,n=>r(119,100+n*47,362,n%3?13:29,n%3?t.clothDark:t.clothLight,0,'none',0))+weave(roundedPts(117,96,366,407,1),t,5)+fringe(104,527,392,t,31,25)+g(300,73,g(-300,-73,fringe(104,73,392,t,31,25)),1,180)
    case 3:return fabricOval(300,300,221,239,t)+rep(15,n=>e(300,300,212-n*12.6,230-n*13.7,'none',n%3===0?t.clothDark:n%3===1?t.light:t.clothLight,8))+p('M198 96l13 15M389 107l-12 13M111 299h21M469 299h20M200 502l11-14M390 489l-13 13','none',t.dark,3)
    case 4:return fabricPoly([[116,80],[218,98],[271,69],[344,91],[451,71],[479,161],[503,242],[471,315],[511,405],[474,514],[385,527],[311,503],[233,536],[139,510],[101,425],[124,340],[91,261],[123,179]],t)+p('M131 278Q300 304 477 273M300 91Q268 290 313 507','none',t.clothDark,6)+fibres([[116,80],[218,98],[271,69],[344,91],[451,71],[479,161],[503,242],[471,315],[511,405],[474,514],[385,527],[311,503],[233,536],[139,510],[101,425],[124,340],[91,261],[123,179]],7,t.clothLight,.9,63,true)
    case 5:return rugRect(81,68,438,464,t,27)+rep(5,n=>diamond(300,122+n*90,135,n%2?38:42,n%2?t.clothDark:t.clothLight,t.clothDark,3)+diamond(300,122+n*90,58,22,t.cloth,t.clothDark,2))+rep(12,n=>diamond(106,102+n*35,9,13,t.clothDark)+diamond(494,102+n*35,9,13,t.clothDark))+weave(roundedPts(112,99,376,402,1),t,7)+fringe(89,532,422,t,33,23)
    case 6:return fabricOval(300,300,231,231,t)+rep(48,n=>{const a=n*Math.PI/24;return p(`M${300+31*Math.cos(a)} ${300+31*Math.sin(a)}L${300+218*Math.cos(a)} ${300+218*Math.sin(a)}`,'none',n%2?t.clothLight:t.clothDark,2)})+[105,171,223].map(rad=>e(300,300,rad,rad,'none',t.clothDark,10)+e(300,300,rad-6,rad-6,'none',t.clothLight,2)).join('')
    case 7:return rugRect(131,63,338,474,t,32)+rep(12,n=>p(`M151 ${88+n*35}h28v20h-17v-10M449 ${88+n*35}h-28v20h17v-10`,'none',t.clothLight,5))+rep(6,n=>diamond(300,123+n*70,79,25,'none',t.clothDark,5))+fringe(137,537,326,t,25,23)+g(300,63,g(-300,-63,fringe(137,63,326,t,25,23)),1,180)
    case 8:return fabricPoly([[123,69],[246,84],[393,64],[481,112],[515,231],[495,359],[519,477],[440,528],[282,510],[133,536],[85,433],[105,305],[81,188]],t)+p('M108 179Q226 77 469 189M103 310Q300 206 500 300M117 440Q282 352 494 429','none',t.clothDark,22)+p('M111 186Q224 84 469 196M106 317Q300 213 497 307M120 447Q282 359 491 436','none',t.clothLight,3)+weave([[123,69],[246,84],[393,64],[481,112],[515,231],[495,359],[519,477],[440,528],[282,510],[133,536],[85,433],[105,305],[81,188]],t,6)
    case 9:return rugRect(76,71,448,458,t,23)+rep(6,n=>{const xx=105+n%2*199,yy=102+Math.floor(n/2)*135;return fabricPoly([[xx,yy],[xx+172,yy+7],[xx+184,yy+113],[xx+11,yy+121]],{...t,cloth:n%2?t.clothLight:t.cloth,clothLight:t.clothLight})})+p('M299 101V504M105 233H494M105 369H494','none',t.metal,7)+p('M299 101V504M105 233H494M105 369H494','none',t.clothDark,2)
    case 10:return fabric(66,88,468,424,t,91)+rep(9,n=>fabric(103+n%3*133,121+Math.floor(n/3)*120,125,111,{...t,cloth:n%3===0?t.clothDark:n%3===1?t.cloth:t.clothLight},23))+p('M226 126V472M359 126V472M108 237H492M108 357H492','none',t.clothDark,3)
    case 11:return fabricOval(300,300,233,233,t)+[214,166,111,55].map((rad,n)=>e(300,300,rad,rad,'none',n%2?t.clothLight:t.clothDark,23)).join('')+rep(24,n=>{const a=n*Math.PI/12;return p(`M${300+178*Math.cos(a)} ${300+178*Math.sin(a)}L${300+208*Math.cos(a)} ${300+208*Math.sin(a)}`,'none',t.clothLight,4)})+weave(ellipsePts(300,300,229,229),t,6)
    case 12:return fabricPoly([[103,73],[170,90],[238,68],[311,90],[385,68],[472,91],[496,247],[481,392],[509,502],[419,525],[349,503],[274,531],[203,509],[122,534],[99,377],[115,219]],t)+rep(6,n=>p(`M${126+n*69} ${90+(n%2?0:5)}Q${100+n*69} 295 ${141+n*69} ${511-(n%2?0:12)}`,'none',n%2?t.clothLight:t.clothDark,10))+fibres([[103,73],[170,90],[238,68],[311,90],[385,68],[472,91],[496,247],[481,392],[509,502],[419,525],[349,503],[274,531],[203,509],[122,534],[99,377],[115,219]],6,t.clothLight,.9,74,true)
    case 13:return fabricPoly([[91,235],[91,152],[151,72],[211,152],[240,107],[300,58],[360,107],[389,152],[449,72],[509,152],[509,535],[91,535]],t)+[180,300,420].map(x=>p(`M${x-39} 487V237L${x} 177 ${x+39} 237V487`,'none',t.clothLight,8)).join('')+p('M112 519H488','none',t.clothDark,10)+fringe(99,535,402,t,29,23)
    case 14:return fabricPoly([[132,65],[227,90],[360,65],[480,105],[520,199],[489,301],[515,409],[454,526],[326,509],[200,536],[100,494],[79,387],[109,278],[83,164]],t)+rep(5,n=>p(`M${105+n%2*10} ${145+n*80}L207 ${116+n*80} 322 ${151+n*80} 470 ${123+n*80}`,'none',n%2?t.clothDark:t.clothLight,18))+weave([[132,65],[227,90],[360,65],[480,105],[520,199],[489,301],[515,409],[454,526],[326,509],[200,536],[100,494],[79,387],[109,278],[83,164]],t,6)
    case 15:return fabricPoly(Array.from({length:32},(_,n)=>{const a=n*Math.PI/16,rad=n%4===0?226:n%4===2?245:237;return [300+rad*Math.cos(a),300+rad*Math.sin(a)] as Pt}),t)+rep(8,n=>fabricPoly(arcPts(300,300,225,225,.15,n*45+1,n*45+44,8),{...t,cloth:n%3===0?t.clothDark:n%3===1?t.cloth:t.clothLight}))+e(300,300,45,45,cloth)+e(300,300,35,35,'none',t.clothDark,3)
    case 16:return rugRect(79,64,442,472,t,23)+[111,126,141].map((off,n)=>r(off,off-15,600-off*2,630-off*2,'none',1,n%2?t.clothDark:t.clothLight,6)).join('')+rep(20,n=>{const x=181+n%4*79,y=142+Math.floor(n/4)*80;return diamond(x,y,24,30,t.clothDark,t.clothLight,2)+e(x,y,7,8,t.clothLight,t.clothDark,1)})+weave(roundedPts(106,91,388,418,1),t,5)+fringe(87,536,426,t,33,22)
    case 17:return rugRect(72,66,456,468,t,26)+p('M110 113H159V155H207V197H255M490 113H441V155H393V197H345M110 487H159V445H207V403H255M490 487H441V445H393V403H345','none',t.clothLight,13)+rep(13,n=>{const a=(195+n*12.5)*Math.PI/180;return p(`M300 342L${300+167*Math.cos(a)} ${342+183*Math.sin(a)}`,'none',n%2?t.clothLight:t.clothDark,6)})+diamond(300,351,59,71,t.clothDark,t.clothLight,5)+weave(roundedPts(107,101,386,398,1),t,5)+fringe(81,534,438,t,31,22)
    case 18:return rugRect(94,75,412,450,t,16)+rep(29,n=>r(115,99+n*14,370,6+n%3,[t.clothDark,t.clothLight,t.timber,t.cloth][n%4],1,'none',0))+fibres(roundedPts(112,94,376,412,1),13,t.clothLight,1,90)+fringe(103,525,394,t,29,26)+g(300,75,g(-300,-75,fringe(103,75,394,t,29,26)),1,180)
    case 19:return fabricOval(300,300,214,239,t)+rep(95,n=>{const a=n*2.39996323,rr=Math.sqrt((n+.5)/95),x=300+199*rr*Math.cos(a),y=300+224*rr*Math.sin(a);return p(`M${x-3} ${y+4}l5-7 3 7`,'none',n%3?t.clothLight:t.clothDark,1.5)})+e(300,300,181,206,'none',t.clothLight,8)+e(300,300,206,231,'none',t.clothDark,3)
    case 20:return rugRect(81,71,438,458,t,32)+fibres(roundedPts(119,109,362,382,1),12,t.clothLight,5,45)+fibres(roundedPts(119,109,362,382,1),12,t.clothDark,3,-45)+[[93,83],[469,83],[93,479],[469,479]].map(([x,y])=>fabric(x,y,38,38,t,3)).join('')+p('M122 115H478V485H122Z','none',t.light,3)
    case 21:return rugRect(87,66,426,468,t,22)+rep(24,n=>diamond(155+n%4*97+(Math.floor(n/4)%2?0:0),122+Math.floor(n/4)*72,43,32,n%2?t.clothDark:t.clothLight,t.clothDark,2))+weave(roundedPts(112,91,376,418,1),t,5)+fringe(95,534,410,t,31,23)
    case 22:return fabricOval(300,300,226,226,t)+rep(20,n=>g(300,300,p('M-34-205Q0-263 34-205Q0-183-34-205Z',cloth)+p('M-19-212Q0-239 19-212','none',t.clothLight,3),1,n*18))+[190,151,111].map(rad=>e(300,300,rad,rad,'none',t.clothDark,9)).join('')+rep(16,n=>g(300,300,p('M-25-144Q0-186 25-144','none',t.clothLight,5),1,n*22.5))+e(300,300,71,71,cloth)+weave(ellipsePts(300,300,66,66),t,6)
    case 23:return rugRect(134,60,332,480,t,18)+[0,1,2].map(n=>fabric(159,91+n*142,282,126,{...t,cloth:n===1?t.clothDark:t.cloth},5)+rep(4,k=>n===0?diamond(194+k*70,152+n*142,24,38,t.clothLight,t.clothDark,2):n===1?p(`M${171+k*67} ${109+n*142}v87`,'none',t.clothLight,8):e(194+k*70,152+n*142,22,31,'none',t.clothDark,6))).join('')+fringe(140,540,320,t,25,20)+g(300,60,g(-300,-60,fringe(140,60,320,t,25,20)),1,180)
    default:throw new Error('未知地毯织造构造。')
  }
}

const pleats=(x:number,y:number,w:number,h:number,t:Palette,n=8)=>p(rep(n,k=>{const xx=x+(k+.5)*w/n;return `M${xx} ${y}q${k%2?9:-7} ${h*.22} 0 ${h*.47}t${k%2?-3:4} ${h*.49} `}),'none',t.clothDark,4.5)+p(rep(n,k=>{const xx=x+(k+.5)*w/n+5;return `M${xx} ${y+4}q${k%2?9:-7} ${h*.22} 0 ${h*.47}t${k%2?-3:4} ${h*.47} `}),'none',t.clothLight,2)
const curtainPanel=(x:number,y:number,w:number,h:number,t:Palette,n=8)=>fabric(x,y,w,h,t,8)+pleats(x+8,y+7,w-16,h-22,t,n)
const curtainRod=(t:Palette,n=7,iron=false)=>rail('M62 91H538',t,15,iron)+e(59,91,17,21,iron?metal:wood)+e(541,91,17,21,iron?metal:wood)+rep(n,k=>e(92+k*416/(n-1),108,14,26,'none',iron?t.metal:t.timber,7))
const tiedPanel=(x:number,y:number,w:number,h:number,t:Palette,left=false)=>{
  const points:Pt[]=left?[[x,y],[x+w,y],[x+w*.72,y+h*.48],[x+w*.91,y+h],[x+3,y+h],[x+w*.22,y+h*.48]]:[[x,y],[x+w,y],[x+w*.78,y+h*.48],[x+w-3,y+h],[x+w*.09,y+h],[x+w*.28,y+h*.48]]
  const mid=x+w*.47
  return fabricPoly(points,t)+p(rep(5,k=>`M${x+13+k*(w-26)/4} ${y+7}Q${mid+(k-2)*w*.06} ${y+h*.48} ${x+12+k*(w-24)/4} ${y+h-8}`),'none',t.clothDark,3)+rail(`M${mid-w*.21} ${y+h*.48}h${w*.42}`,t,15)+(left?rope(`M${mid-4} ${y+h*.48}q-43-18-46 14q3 31 42-2`,t,5):rope(`M${mid+4} ${y+h*.48}q43-18 46 14q-3 31-42-2`,t,5))
}
function curtain(i:number,t:Palette):string{
  switch(i){
    case 0:return curtainRod(t,6)+curtainPanel(80,125,440,360,t,11)+fabric(82,462,436,35,t,4)+fringe(89,497,422,t,31,25)
    case 1:return curtainRod(t,8)+tiedPanel(79,128,212,392,t,true)+tiedPanel(309,128,212,392,t)+fabric(89,124,422,39,t,6)
    case 2:return curtainRod(t,7)+curtainPanel(83,133,434,333,t,9)+fabricPoly([[73,126],[527,126],[512,228],[433,269],[347,228],[300,266],[253,228],[167,269],[88,228]],t)+p('M92 151Q167 271 242 160M225 147Q300 280 375 147M358 160Q433 271 508 151','none',t.clothDark,5)+fringe(91,466,418,t,33,40)
    case 3:return rail('M85 96H515',t,16)+rope('M96 102H503',t,7)+fabricPoly([[103,126],[227,113],[361,124],[498,112],[491,287],[506,407],[481,532],[352,518],[211,535],[108,522],[119,347]],t)+pleats(132,140,335,353,t,6)+fabric(379,421,95,95,{...t,cloth:t.clothDark},7)+p('M389 431l75 75m-75 0 75-75','none',t.clothLight,2)+rep(12,k=>rope(`M${119+k*31} 118q14-28 24-2`,t,4))
    case 4:return plank(72,94,456,47,t)+rep(6,n=>fabricPoly([[91+n*70,142],[155+n*70,142],[157+n*70,468+n%3*18],[128+n*70,526-n%2*16],[87+n*70,493]],t)+p(`M${105+n*70} 162V${477+n%3*9}`,'none',t.clothDark,2))+rep(12,n=>bolt(94+n*37.5,115,t,5))
    case 5:return curtainRod(t,8)+curtainPanel(89,130,422,394,t,7)+[116,484].map(x=>r(x-12,151,24,352,t.clothDark,2)+rep(11,n=>diamond(x,170+n*30,8,11,t.clothLight,t.clothDark,1))).join('')+fringe(105,524,44,t,4,31)+fringe(451,524,44,t,4,31)
    case 6:return curtainRod(t,7,true)+fabricPoly([[76,128],[524,128],[511,377],[451,420],[372,344],[300,408],[228,344],[149,420],[89,377]],t)+[0,1,2].map(n=>p(`M${88+n*141} 151Q${158+n*141} 431 ${229+n*141} 151`,'none',t.clothDark,7)+p(`M${93+n*141} 155Q${158+n*141} 396 ${224+n*141} 155`,'none',t.clothLight,3)).join('')+tiedPanel(79,276,89,240,t,true)+tiedPanel(432,276,89,240,t)
    case 7:return curtainRod(t,8,true)+rep(4,n=>tiedPanel(80+n*112,133,104,388,t,n<2))+fabric(76,124,448,75,t,12,true)+fringe(87,199,426,t,31,21)
    case 8:return rail('M71 103Q300 57 529 103',t,21)+fabricPoly([[93,130],[218,119],[347,133],[506,118],[493,523],[367,533],[239,513],[104,532]],t)+fibres([[93,130],[218,119],[347,133],[506,118],[493,523],[367,533],[239,513],[104,532]],15,t.clothLight,5,90,true)+rope('M143 92q-23 41 12 48M300 78q-25 44 11 51M457 91q-23 42 12 48',t,10)+edgeFringe([[104,532],[239,513],[367,533],[493,523]],t,15,21)
    case 9:return [89,230,371].map((x,n)=>[0,1].map(k=>fabric(x,145+k*183,132,174,{...t,cloth:(n+k)%2?t.clothDark:t.cloth},7)).join('')+fringe(x+6,501,120,t,9,27)).join('')+rail('M91 140H509',t,15)+[122,300,478].map(x=>r(x-25,97,50,55,stone,7)+bolt(x,123,t,6)).join('')+p('M228 151V491M370 151V491M101 326H500','none',t.metal,6)
    case 10:return rail('M65 100H535',t,20)+e(61,100,20,25,wood)+e(539,100,20,25,wood)+rep(12,n=>{const xx=98+n*36.7,hh=353+(n%4)*13;return rope(`M${xx} 105V${133+hh}`,t,4)+rep(9,k=>e(xx,151+k*(hh-14)/9,9+n%2*2,13,wood,t.dark,1.4))+e(xx,131+hh,11,15,metal,t.dark,1.3)})
    case 11:return curtainRod(t,10,true)+rep(5,n=>curtainPanel(85+n*88,131,79,371-(n%2)*24,{...t,cloth:n%2?t.clothLight:t.cloth},4)+poly([[108+n*88,497-(n%2)*24],[141+n*88,497-(n%2)*24],[137+n*88,535-(n%2)*24],[112+n*88,535-(n%2)*24]],metal))+fabric(79,124,442,45,t,7)
    case 12:return rail('M71 103H529',t,25)+fabricPoly([[94,144],[165,126],[238,151],[315,127],[386,149],[496,131],[507,258],[481,365],[513,483],[448,526],[360,509],[286,532],[209,505],[123,528],[91,398],[115,272]],t)+p('M219 152Q245 310 208 504M381 153Q356 310 374 507','none',t.clothDark,7)+rep(6,n=>r(96+n*75,94,34,73,wood,8)+rope(`M${113+n*75} 112v42`,t,6))+edgeFringe([[123,528],[209,505],[286,532],[360,509],[448,526],[513,483]],t,16,21)
    case 13:return rail('M80 100H520',t,21,true)+fabricPoly([[86,217],[86,146],[192,78],[276,158],[281,531],[86,522]],t)+fabricPoly([[324,158],[408,78],[514,146],[514,217],[514,522],[319,531]],t)+p('M104 206L192 111 260 174M496 206L408 111 340 174','none',t.clothLight,6)+pleats(113,229,135,263,t,4)+pleats(352,229,135,263,t,4)+edgeFringe([[86,522],[281,531]],t,15,27)+edgeFringe([[319,531],[514,522]],t,15,27)
    case 14:return curtainRod(t,6,true)+curtainPanel(94,129,412,390,t,6)+warpRect(103,143,394,241,t)+fabric(102,379,396,127,t,5)+pleats(110,389,380,105,t,7)+rope('M103 386H497',t,8)
    case 15:return curtainRod(t,8)+fabricPoly([[81,132],[519,132],[515,374],[482,453],[409,502],[300,534],[191,502],[118,453],[85,374]],t)+rep(6,n=>p(`M${108+n*77} 147Q${108+n*74} 344 ${148+n*60} ${460+Math.sin(n*Math.PI/5)*55}`,'none',t.clothDark,4))+p('M102 378Q300 615 498 378','none',t.clothLight,5)+rope('M93 122H507',t,9)
    case 16:return curtainRod(t,9,true)+curtainPanel(86,129,428,385,t,9)+fabric(102,144,396,360,{...t,cloth:'#DBDBC4',clothLight:'#F1EFD9',clothDark:'#ADBAA2'},5)+pleats(119,157,362,329,t,11)+rep(24,n=>e(115+n%12*33.6,477+Math.floor(n/12)*17,6,6,'none','#EAE8D1',2))+fringe(104,512,392,{...t,clothLight:'#E4E2CB'},37,17)
    case 17:return curtainRod(t,10,true)+curtainPanel(73,133,210,390,t,9)+curtainPanel(317,133,210,390,t,9)+fabric(69,120,462,79,t,20,true)+fringe(84,199,432,t,34,24)+fringe(83,523,188,t,15,22)+fringe(329,523,188,t,15,22)
    case 18:return rail('M64 99H536',t,15,true)+fabricPoly([[88,140],[286,140],[286,460],[252,460],[252,493],[215,493],[215,526],[88,526]],t)+fabricPoly([[314,140],[512,140],[512,526],[385,526],[385,493],[348,493],[348,460],[314,460]],t)+p('M108 163H180V235H253M492 163H420V235H347M111 491H159V443H211M489 491H441V443H389','none',t.clothDark,16)+weave([[88,140],[286,140],[286,460],[252,460],[252,493],[215,493],[215,526],[88,526]],t,6)+[112,214,386,488].map(x=>r(x-16,94,32,64,metal,4)+bolt(x,117,t,5)).join('')
    case 19:return fabric(89,132,422,389,t,4)+fibres(roundedPts(99,144,402,365,2),9,t.clothLight,1.5,90)+e(300,129,228,35,wood)+rail('M72 129H528',t,40)+rail('M83 522H517',t,22,true)+rope('M527 132V488q39 31 0 50',t,4)
    case 20:return curtainRod(t,8,true)+curtainPanel(83,133,197,315,t,9)+curtainPanel(320,133,197,315,t,9)+fabric(91,413,181,41,t,5)+fabric(328,413,181,41,t,5)+rep(2,k=>rep(12,n=>e(102+k*237+n%6*28,446+Math.floor(n/6)*9,5,5,'none',t.clothLight,2)))+fringe(93,452,179,t,16,20)+fringe(328,452,179,t,16,20)
    case 21:return rail('M61 92H539',t,16)+curtainPanel(85,146,430,380,t,8)+rep(7,n=>fabric(95+n*64,93,27,69,t,11))+fibres(roundedPts(98,158,404,350,2),5,t.clothLight,1.2,0)+fabric(93,497,414,27,t,3)
    case 22:return curtainRod(t,8,true)+tiedPanel(81,155,209,370,t,true)+tiedPanel(310,155,209,370,t)+rep(3,n=>fabric(74+n*151,118,145,96,t,27,true))+p('M95 504H258M342 504H505','none',t.clothLight,8)+fringe(89,216,422,t,31,21)
    case 23:return rail('M63 98H537',t,22,true)+rep(7,n=>rope(`M${102+n*66} 101V139`,t,5))+fabricPoly(Array.from({length:13},(_,n)=>[82+n*36.4,135] as Pt).concat(Array.from({length:25},(_,n)=>[519-n*18.2,n%2?503:532] as Pt)),t)+rep(12,n=>r(83+n*36.4,139,17,364,t.clothDark,1,'none',0)+p(`M${103+n*36.4} 144V${n%2?513:521}`,'none',t.clothLight,3))+fabric(80,119,440,32,t,3)
    default:throw new Error('未知平铺帷幔构造。')
  }
}

const glassGlints=(pts:readonly Pt[])=>fibres(pts,113,'#DDE7D3',3.5,-33)+fibres(pts,117,'#CFD9C8',1,-33)
const mirrorRect=(x:number,y:number,w:number,h:number,t:Palette,frame=30,rad=10)=>r(x,y,w,h,wood,rad)+grain(x+3,y+3,w-6,h-6,t)+r(x+frame,y+frame,w-frame*2,h-frame*2,glass,Math.max(1,rad-frame*.3))+r(x+frame+6,y+frame+6,w-frame*2-12,h-frame*2-12,'none',Math.max(1,rad-frame*.3),t.metal,3)+glassGlints(roundedPts(x+frame+8,y+frame+8,w-frame*2-16,h-frame*2-16,Math.max(1,rad-frame*.3)))
const mirrorOval=(x:number,y:number,rx:number,ry:number,t:Palette,frame=27)=>woodOval(x,y,rx,ry,t)+e(x,y,rx-frame,ry-frame,glass)+e(x,y,rx-frame-6,ry-frame-6,'none',t.metal,3)+glassGlints(ellipsePts(x,y,rx-frame-9,ry-frame-9))
function mirror(i:number,t:Palette):string{
  switch(i){
    case 0:return e(300,300,220,220,metal)+e(300,300,190,190,'#BDB18B')+e(300,300,179,179,'none','#D4CBA8',4)+rep(20,n=>{const a=n*Math.PI/10;return bolt(300+207*Math.cos(a),300+207*Math.sin(a),t,6)})+glassGlints(ellipsePts(300,300,177,177))+rail('M276 83Q259 39 300 36Q341 39 324 83',t,12,true)
    case 1:return mirrorRect(88,69,424,462,t,49,6)+[[99,81],[473,81],[99,487],[473,487]].map(([x,y])=>r(x,y,28,32,wood,1)+p(`M${x+4} ${y+5}l20 21`,'none',t.dark,2)).join('')
    case 2:return rail('M300 360V509',t,33,true)+e(300,524,29,32,'none',t.metal,11)+e(300,231,172,175,metal)+e(300,231,150,153,glass)+e(300,231,140,143,'none',t.metal,3)+glassGlints(ellipsePts(300,231,136,139))+r(279,378,42,69,metal,9)
    case 3:return mirrorRect(210,85,180,430,t,25,6)+g(140,302,mirrorRect(-66,-186,132,372,t,20,5),1,-7)+g(460,302,mirrorRect(-66,-186,132,372,t,20,5),1,7)+[196,404].map(x=>r(x-14,164,28,45,metal,4)+r(x-14,392,28,45,metal,4)+bolt(x,185,t,5)+bolt(x,413,t,5)).join('')
    case 4:return mirrorRect(195,103,210,394,t,24,7)+planks(63,135,118,330,t,4)+planks(419,135,118,330,t,4)+[186,414].map(x=>r(x-14,176,28,45,metal,4)+r(x-14,379,28,45,metal,4)).join('')+r(276,79,48,40,metal,4)
    case 5:return poly([[166,68],[300,51],[438,79],[512,203],[506,393],[421,526],[269,548],[135,501],[82,371],[91,190]],stone)+mirrorOval(300,300,192,228,t,21)+p('M112 229l24 15m329-20 23-19M158 470l23-8m228 23 26 8','none','#6B7560',5)
    case 6:return mirrorRect(93,62,414,476,t,43,66)+rep(18,n=>{const x=n<9?108+n%3*128:108+(n-9)%3*128,y=n<9?76+Math.floor(n/3)*26:470+Math.floor((n-9)/3)*26;return r(x,y,107,21,n%2?'#C9BFA1':'#B8AD91',4,t.dark,1.6)})+rail('M106 129V469M494 129V469',t,9,true)
    case 7:return mirrorOval(300,307,189,230,t,39)+rail('M132 439Q54 335 107 163Q142 91 185 128M468 439Q546 335 493 163Q458 91 415 128',t,27)+woodPoly([[231,89],[252,46],[300,69],[348,46],[369,89],[300,121]],t)+rail('M164 494Q300 565 436 494',t,20)
    case 8:return mirrorOval(300,300,194,235,t,30)+rail('M154 111Q66 208 126 452M438 103Q514 243 468 450M161 490Q300 541 443 490',t,27)+rail('M116 222L79 183M484 335L523 370',t,17)+p('M147 153q-24 90-4 149M454 161q24 90 4 149','none',t.light,3)
    case 9:return r(108,100,384,400,metal,8)+r(137,129,326,342,glass,5)+glassGlints(roundedPts(145,137,310,326,3))+[[87,83],[419,83],[87,420],[419,420]].map(([x,y])=>poly([[x,y+12],[x+67,y],[x+94,y+31],[x+82,y+95],[x+12,y+92]],stone)+bolt(x+46,y+44,t,10)).join('')+rail('M132 108H468M132 492H468',t,17,true)
    case 10:return e(300,300,238,215,stone)+e(300,300,212,188,'none','#C5C7AE',7)+e(300,300,181,158,'#8EA69B')+e(310,310,167,144,glass)+glassGlints(ellipsePts(310,310,159,136))+p('M145 140l18 23m267 22 25-19M151 449l28-15','none','#6F7E68',4)
    case 11:return mirrorOval(185,300,130,201,t,25)+mirrorOval(424,300,120,178,t,24)+r(285,264,30,72,metal,7)+bolt(300,281,t,5)+bolt(300,319,t,5)+rail('M70 249V351M533 250V350',t,11,true)
    case 12:return rope('M300 52L529 298 300 548 71 298Z',t,15)+poly([[300,73],[512,299],[300,527],[88,299]],metal)+poly([[300,108],[478,299],[300,492],[122,299]],glass)+glassGlints([[300,117],[469,299],[300,483],[131,299]])+rail('M300 110V490',t,8,true)+[[300,64],[520,299],[300,536],[80,299]].map(([x,y])=>r(x-19,y-21,38,42,wood,6)+bolt(x,y,t,7)).join('')
    case 13:return mirrorOval(300,300,207,239,t,43)+rep(6,n=>{const a=(n*60-90)*Math.PI/180,x=300+205*Math.cos(a),y=300+232*Math.sin(a);return g(x,y,poly([[-38,-33],[34,-30],[49,15],[13,45],[-43,26]],metal)+p('M-25-14L22-13 28 14','none',t.light,3),1,n*60)})+e(300,300,157,189,'none',t.metal,5)
    case 14:return rail('M300 333Q259 410 300 528M300 470L251 507M300 425L347 477',t,31)+woodPoly([[300,63],[432,96],[488,202],[465,337],[345,414],[204,387],[115,282],[130,137]],t)+poly([[300,91],[414,122],[456,208],[437,319],[339,380],[222,357],[147,274],[157,153]],glass)+glassGlints([[300,101],[406,132],[446,210],[427,310],[337,370],[229,347],[157,271],[167,163]])+e(300,529,22,21,wood)
    case 15:return woodOval(300,300,234,234,t)+e(300,300,202,202,glass)+rep(6,n=>{const a=n*Math.PI/3;return e(300+117*Math.cos(a),300+117*Math.sin(a),74,82,glass,t.dark,5)})+e(300,300,76,76,glass,t.dark,6)+glassGlints(ellipsePts(300,300,196,196))+e(300,300,211,211,'none',t.metal,5)
    case 16:return rail('M154 201V462Q300 543 446 462V201',t,26)+mirrorOval(300,280,182,214,t,25)+rail('M118 280H154M446 280H482',t,17,true)+e(141,280,17,19,metal)+e(459,280,17,19,metal)+rail('M192 487H408',t,21)
    case 17:return r(86,60,428,480,wood,8)+r(107,80,386,440,metal,6)+r(122,96,356,408,wood,4)+mirrorRect(141,116,318,368,t,17,3)+rail('M112 85H150V120M488 85H450V120M112 515H150V480M488 515H450V480',t,8,true)
    case 18:return e(300,300,230,230,metal)+e(300,300,213,213,glass)+e(300,300,200,200,'none','#D4E0CD',8)+e(300,300,184,184,'none','#95AD9D',5)+glassGlints(ellipsePts(300,300,181,181))+e(300,300,224,224,'none',t.metal,2)
    case 19:return mirrorRect(201,81,198,438,t,22,5)+g(127,300,mirrorRect(-59,-185,118,370,t,17,3),1,-8)+g(473,300,mirrorRect(-59,-185,118,370,t,17,3),1,8)+[191,409].map(x=>r(x-13,151,26,49,metal,4)+r(x-13,400,26,49,metal,4)+bolt(x,176,t,5)+bolt(x,425,t,5)).join('')
    case 20:return fabric(69,110,462,381,{...t,cloth:t.timber,clothLight:t.light,clothDark:t.dark},28)+mirrorRect(93,137,414,220,t,22,11)+fabric(94,374,412,92,{...t,cloth:t.timber},14)+p('M114 393H486M114 448H486','none',t.light,3)+r(264,476,72,38,metal,6)+bolt(300,494,t,5)+rail('M215 111V70H385V111',t,16)
    case 21:return woodPoly([[164,70],[296,52],[435,102],[483,219],[455,379],[488,497],[373,545],[230,519],[109,447],[116,305],[88,173]],t)+poly([[176,103],[291,87],[410,129],[446,224],[419,376],[450,475],[365,507],[244,485],[147,430],[153,307],[125,185]],glass)+glassGlints([[176,113],[291,97],[401,138],[436,226],[410,375],[440,468],[362,497],[247,475],[157,427],[163,307],[135,188]])+rail('M138 153Q189 80 226 131M451 449Q400 527 365 483',t,15,true)
    case 22:return mirrorRect(99,59,402,459,t,35,7)+plank(80,457,440,82,t)+r(130,470,340,54,wood,4)+grain(137,477,326,40,t)+rail('M99 147H72V217M501 358H528V428',t,13,true)+bolt(300,505,t,7)
    case 23:return rail('M300 382V492',t,42)+fabricOval(300,251,180,192,t,true)+e(300,251,141,153,glass)+e(300,251,134,146,'none',t.metal,3)+glassGlints(ellipsePts(300,251,130,142))+fabric(272,403,56,95,t,19)+rope('M300 493V536M290 527l-14 31M300 527v34M310 527l14 31',t,4)
    default:throw new Error('未知平放镜具构造。')
  }
}

const canvasRect=(x:number,y:number,w:number,h:number,t:Palette)=>r(x,y,w,h,'#C9BE9B',1)+weave(roundedPts(x+2,y+2,w-4,h-4,1),{...t,clothLight:'#E3D8B4',clothDark:'#9C987A'},6)
function wallPicture(i:number,t:Palette):string{
  switch(i){
    case 0:return mirrorRect(71,115,458,370,t,37,5)+canvasRect(109,153,382,294,t)+p('M110 284Q202 208 291 281T490 263V446H110Z','#7C9278','#71806A',1)+p('M110 365L221 293 322 348 410 284 490 331V446H110Z','#596F62','#637661',1)+e(414,207,28,27,'#D4C59A','#B7AD87',1)+p('M111 411Q300 355 489 393V445H111Z','#A59A74','#8C8968',1)+weave(roundedPts(114,158,372,284,1),t,8)
    case 1:return woodPoly([[97,84],[503,84],[489,369],[300,534],[111,369]],t)+poly([[128,116],[472,116],[460,355],[300,493],[140,355]],'#8C8E76')+poly([[128,116],[292,116],[292,484],[140,355]],'#9C7861')+p('M181 181H419V338L300 427 181 338Z','#C9B68C')+p('M216 241L272 214 300 265 328 214 384 241 355 313 300 349 245 313Z','#6D7E69')+fibres([[134,122],[466,122],[454,352],[300,485],[146,352]],6,'#CFC29E',1,0)
    case 2:return mirrorRect(212,78,176,443,t,23,4)+mirrorRect(61,147,137,333,t,20,4)+mirrorRect(402,147,137,333,t,20,4)+canvasRect(236,102,128,395,t)+canvasRect(82,168,95,291,t)+canvasRect(423,168,95,291,t)+[129,300,471].map((x,n)=>e(x,245-n%2*49,n%2?30:22,n%2?34:24,'#C7B07A')+p(`M${x-31} 420V313L${x} 275 ${x+31} 313V420Z`,'#87937B')+p(`M${x-43} 420H${x+43}`,'none','#A69A75',8)).join('')+[204,396].map(x=>r(x-12,201,24,42,metal,4)+r(x-12,399,24,42,metal,4)).join('')
    case 3:return woodOval(300,300,233,233,t)+e(300,300,202,202,'#737E8A')+e(300,300,179,179,'none','#C7BC93',3)+e(300,300,111,111,'none','#C7BC93',2)+rep(20,n=>{const a=n*2.39996323,rr=41+((n*41)%142),x=300+rr*Math.cos(a),y=300+rr*Math.sin(a);return e(x,y,n%3?3:6,n%3?3:6,'#D9CBA3','#B6B098',1)})+p('M186 211L238 348 364 381 420 278 339 155 186 211M238 348L420 278M186 211L364 381','none','#B3B6A1',2)+weave(ellipsePts(300,300,198,198),t,10)
    case 4:return woodPoly([[78,141],[221,104],[382,126],[526,169],[513,415],[393,492],[232,466],[90,426]],t)+canvasRect(118,168,365,265,t)+p('M119 287Q236 241 482 276V431H119Z','#9BA282','#7B896D',1)+p('M144 397L175 229 193 395M247 422L269 204 293 422M361 422L389 222 411 422','none','#5F7461',15)+[[171,235],[266,213],[387,234]].map(([x,y],n)=>e(x,y,43+n*5,63,'#7C9477','#697F64',2)+e(x-19,y-19,29,35,'#A2AE87','#7D9476',1)).join('')+weave(roundedPts(122,173,357,254,1),t,7)
    case 5:return poly([[121,64],[479,64],[536,121],[536,479],[479,536],[121,536],[64,479],[64,121]],wood)+poly([[136,94],[464,94],[506,136],[506,464],[464,506],[136,506],[94,464],[94,136]],'#A59C80')+rep(36,n=>{const x=112+n%6*63,y=112+Math.floor(n/6)*63;return poly([[x+3,y+4],[x+55,y+1],[x+59,y+54],[x+4,y+59]],['#859B85','#A38F75','#B5AC86','#6F8881','#C2B592'][(n+Math.floor(n/6))%5],'#827E67',3)})+p('M118 399L245 250 349 348 470 178','none','#C7BE9A',13)
    case 6:return woodOval(300,300,222,237,t)+e(300,300,180,194,'#B19C7B')+e(300,300,165,180,'none',t.metal,6)+p('M172 449Q181 359 280 341L255 294Q215 288 225 240Q229 169 292 164Q349 160 358 214L385 249 354 265Q352 313 319 337Q391 366 419 449Z','#6F6C5E','#656554',1)+p('M245 212Q294 156 338 206L319 231Q266 214 245 260Z','#504F47','#504F47',1)+weave(ellipsePts(300,300,174,188),t,7)
    case 7:return r(66,112,468,376,wood,5)+r(82,128,436,344,metal,4)+r(98,144,404,312,wood,3)+canvasRect(119,165,362,270,t)+poly([[120,166],[300,166],[300,296],[120,422]],'#9AAE9D','#9AAE9D',0)+poly([[300,166],[480,166],[480,435],[380,435]],'#A28B78','#A28B78',0)+e(295,290,92,92,'#B8AC84','#8C8D72',2)+poly([[183,435],[394,218],[464,435]],'#6B7F77','#6B7F77',0)+p('M146 194H248V222M454 193H356V221','none',t.metal,6)+weave(roundedPts(124,170,352,260,1),t,8)
    default:throw new Error('未知平放画框构造。')
  }
}

export const FURNISHING_DETAILS_LICENSE_REF='MIT-Sceneweave-Furnishing-Details-Collection-1'
export const FURNISHING_DETAILS_LICENSE=`Sceneweave Furnishing Details Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG drawings of stools, benches, bookshelves, sofas, screens, rugs, flat curtains, flat mirrors and flat picture frames, authored with coding assistance. No third-party art or image pixels are included. Material fibres and wood grain are original vector geometry. Illustrative medieval, western fantasy and 1920s interpretations; technical self-check and human art acceptance are separate. Curtains, mirrors and pictures are independent flat decorative components and do not create wall attachments, hanging elevations, reflections of scene content, or movement permissions.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const defs=(t:Palette)=>`<defs>
<linearGradient id="wood" x1="0%" y1="0%" x2="24%" y2="100%"><stop offset="0%" stop-color="${t.light}"/><stop offset="38%" stop-color="${t.timber}"/><stop offset="100%" stop-color="${t.dark}"/></linearGradient>
<linearGradient id="cloth" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${t.clothLight}"/><stop offset="35%" stop-color="${t.cloth}"/><stop offset="100%" stop-color="${t.clothDark}"/></linearGradient>
<linearGradient id="metal" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#CEC8A5"/><stop offset="35%" stop-color="${t.metal}"/><stop offset="100%" stop-color="${t.dark}"/></linearGradient>
<linearGradient id="stone" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#B8BEA5"/><stop offset="45%" stop-color="#929D87"/><stop offset="100%" stop-color="#6E7B68"/></linearGradient>
<linearGradient id="glass" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#D5E0CA"/><stop offset="34%" stop-color="#B6C8B9"/><stop offset="70%" stop-color="#8DA99E"/><stop offset="100%" stop-color="#B9CEC0"/></linearGradient>
</defs>`
function artwork(design:FurnishingDetailsDesign,i:number):VisualSampleArt{
  const t=palettes[design.category==='wall-picture'?[0,6,7,11,8,9,21,20][i]:i]
  const body=({stool,bench,bookshelf,sofa,screen,rug,curtain,mirror,'wall-picture':wallPicture}[design.category])(i,t)
  const flat=['rug','curtain','mirror','wall-picture'].includes(design.category)
  return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
    sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm} ${design.heightMm}">${defs(t)}<g transform="scale(${design.widthMm/600} ${design.heightMm/600})">${body}</g></svg>`,
    footprintMm:{width:Math.round(design.widthMm*(design.category==='screen'?.98:.87)),height:Math.round(design.heightMm*(design.category==='screen'?.98:.87))},blocksMovement:!flat,blocksSight:false,renderLayer:flat?'ground':'object',shadowClass:flat?'none':'furniture',
    tags:['原创','家具与室内陈设',design.category,design.era,design.design,'正顶视','独立物件',...(flat?['平放装饰','不创建墙体附着或悬挂高程']:[]),...(design.category==='bookshelf'?['开放顶舱与顶面陈设']:[]),...(design.category==='screen'?['顶视隔屏','保守独立占地']:[])]}
}
export const FURNISHING_DETAILS_ART:readonly VisualSampleArt[]=freezeJson(FURNISHING_DETAILS_DESIGNS.map(design=>artwork(design,FURNISHING_DETAILS_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
