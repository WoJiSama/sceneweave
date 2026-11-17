import { SURFACES_TRACES_DESIGNS, type SurfacesTracesDesign } from '../assets/surfaces-traces-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

type Pt=readonly [number,number]
type Palette=readonly [string,string,string,string]
const S=600,TAU=Math.PI*2
const f=(v:number)=>Math.round(v*100)/100
const xy=(x:number,y:number)=>`${f(x)} ${f(y)}`
const random=(seed:number,i:number)=>{let h=(seed^Math.imul(i+1,0x9e3779b1))>>>0;h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;return (Math.imul(h,0x846ca68b)>>>0)/4294967296}
const blend=(a:string,b:string,t:number)=>'#'+[1,3,5].map(n=>Math.round(parseInt(a.slice(n,n+2),16)*(1-t)+parseInt(b.slice(n,n+2),16)*t).toString(16).padStart(2,'0')).join('')
const poly=(pts:readonly Pt[])=>pts.map(([x,y],i)=>`${i?'L':'M'}${xy(x,y)}`).join('')+'Z'
const rect=(x:number,y:number,w:number,h:number):Pt[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
const ellipse=(x:number,y:number,rx:number,ry:number)=>`M${xy(x-rx,y)}a${f(rx)} ${f(ry)} 0 1 0 ${f(rx*2)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-rx*2)} 0Z`
const smooth=(pts:readonly Pt[])=>{let d=`M${xy((pts[0][0]+pts.at(-1)![0])/2,(pts[0][1]+pts.at(-1)![1])/2)}`;for(let k=0;k<pts.length;k++){const a=pts[k],b=pts[(k+1)%pts.length];d+=`Q${xy(...a)} ${xy((a[0]+b[0])/2,(a[1]+b[1])/2)}`}return d+'Z'}
const lens=(x:number,y:number,rx:number,ry:number,angle:number,seed:number)=>smooth(Array.from({length:9},(_,n)=>{const a=n*TAU/9,r=.76+random(seed,n)*.24,u=Math.cos(a)*rx*r,v=Math.sin(a)*ry*r;return [x+u*Math.cos(angle)-v*Math.sin(angle),y+u*Math.sin(angle)+v*Math.cos(angle)] as Pt}))
class Paint {
 private readonly groups=new Map<string,string[]>()
 private readonly stamps:string[]=[]
 add(d:string,fill:string,opacity=1,stroke='none',width=1):void{if(!d)return;const key=`fill="${fill}" opacity="${opacity}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;const a=this.groups.get(key)??[];a.push(d);this.groups.set(key,a)}
 line(d:string,color:string,width=1,opacity=1):void{this.add(d,'none',opacity,color,width)}
 stamp(x:number,y:number,angle:number,sx:number,sy:number,draw:(q:Paint)=>void):void{const q=new Paint();draw(q);this.stamps.push(`<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)}) scale(${f(sx)} ${f(sy)})">${q.svg()}</g>`)}
 svg():string{return [...this.groups].sort(([a],[b])=>Number(a.startsWith('fill="none"'))-Number(b.startsWith('fill="none"'))).map(([a,p])=>`<path ${a} d="${p.join(' ')}"/>`).join('')+this.stamps.join('')}
}
/** Every mark crossing an edge is copied with the same pigment and seed to the opposite edge. */
function wrap(x:number,y:number,rx:number,ry:number,draw:(dx:number,dy:number)=>void):void{
 for(const dx of [-S,0,S])for(const dy of [-S,0,S])if(x+rx+dx>=0&&x-rx+dx<=S&&y+ry+dy>=0&&y-ry+dy<=S)draw(dx,dy)
}
function mottle(p:Paint,seed:number,t:Palette,count=24,size=130):void{
 for(let i=0;i<count;i++){const x=random(seed,i*6)*S,y=random(seed,i*6+1)*S,rx=size*(.45+random(seed,i*6+2)),ry=size*(.3+random(seed,i*6+3)),a=random(seed,i*6+4)*TAU,color=i%2?t[1]:t[2];wrap(x,y,Math.max(rx,ry),Math.max(rx,ry),(dx,dy)=>{for(let k=0;k<3;k++)p.add(lens(x+dx,y+dy,rx*(1-k*.13),ry*(1-k*.13),a,seed+i),color,.035)})}
}
function grain(p:Paint,seed:number,t:Palette,count=380,scale=1,opacity=.23):void{
 for(let i=0;i<count;i++){const x=random(seed,i*5)*S,y=random(seed,i*5+1)*S,rx=(.5+random(seed,i*5+2)*1.6)*scale,ry=rx*(.45+random(seed,i*5+3)*.55);wrap(x,y,rx+1,ry+1,(dx,dy)=>p.add(ellipse(x+dx,y+dy,rx,ry),t[i%4],opacity))}
}
function linearFibres(p:Paint,pts:readonly Pt[],angle:number,spacing:number,color:string,opacity=.27):void{
 const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),v=pts.map(([x,y])=>[x*c+y*s,-x*s+y*c]),low=Math.min(...v.map(q=>q[1])),high=Math.max(...v.map(q=>q[1]));let d=''
 for(let y=low+spacing*.63;y<high-spacing*.4;y+=spacing){const xs:number[]=[];for(let j=0;j<v.length;j++){const u=v[j],w=v[(j+1)%v.length];if((u[1]<=y&&w[1]>y)||(w[1]<=y&&u[1]>y))xs.push(u[0]+(y-u[1])*(w[0]-u[0])/(w[1]-u[1]))}xs.sort((u,w)=>u-w);for(let j=0;j+1<xs.length;j+=2){const x=xs[j]+2,end=xs[j+1]-2;if(end>x)d+=`M${xy(x*c-y*s,x*s+y*c)}L${xy(end*c-y*s,end*s+y*c)} `}}
 p.line(d,color,.6,opacity)
}
function tilePoly(p:Paint,pts:readonly Pt[],fill:string,stroke:string,sw=1.3,fibres?:{angle:number;color:string;spacing:number}):void{
 const minx=Math.min(...pts.map(q=>q[0])),maxx=Math.max(...pts.map(q=>q[0])),miny=Math.min(...pts.map(q=>q[1])),maxy=Math.max(...pts.map(q=>q[1]));wrap((minx+maxx)/2,(miny+maxy)/2,(maxx-minx)/2+sw,(maxy-miny)/2+sw,(dx,dy)=>{const q=pts.map(([x,y])=>[x+dx,y+dy] as Pt);p.add(poly(q),fill,1,stroke,sw);if(fibres)linearFibres(p,q,fibres.angle,fibres.spacing,fibres.color)})
}
function waves(p:Paint,seed:number,color:string,rows:number,amplitude:number,width:number,opacity:number,flow=1):void{
 for(let j=0;j<rows;j++){const y=j*S/rows,phase=random(seed,j)*TAU;let d='';for(const dy of [-S,0,S]){for(let k=0;k<=40;k++){const x=k*S/40,v=y+Math.sin(x/S*TAU*flow+phase)*amplitude+Math.sin(x/S*TAU*3+phase*.5)*amplitude*.14;d+=`${k?'L':'M'}${xy(x,v+dy)}`}}p.line(d,color,width,opacity)}
}
function voronoi(p:Paint,seed:number,t:Palette,nx:number,ny:number,rounded=false,inset=.92,faceVariation=1):void{
 const points=Array.from({length:nx*ny},(_,i)=>[(i%nx+.2+random(seed,i*2)*.6)*S/nx,(Math.floor(i/nx)+.2+random(seed,i*2+1)*.6)*S/ny] as Pt)
 for(let i=0;i<points.length;i++){const a=points[i];let pts:Pt[]=rect(a[0]-S/nx*2,a[1]-S/ny*2,S/nx*4,S/ny*4)
  for(let j=0;j<points.length;j++)for(const dx of [-S,0,S])for(const dy of [-S,0,S]){if(i===j&&dx===0&&dy===0)continue;const b:Pt=[points[j][0]+dx,points[j][1]+dy],vx=b[0]-a[0],vy=b[1]-a[1],bound=(b[0]*b[0]+b[1]*b[1]-a[0]*a[0]-a[1]*a[1])/2,next:Pt[]=[];for(let k=0;k<pts.length;k++){const u=pts[k],v=pts[(k+1)%pts.length],du=u[0]*vx+u[1]*vy-bound,dv=v[0]*vx+v[1]*vy-bound;if(du<=.0001)next.push(u);if((du<0)!==(dv<0)){const r=du/(du-dv);next.push([u[0]+(v[0]-u[0])*r,u[1]+(v[1]-u[1])*r])}}pts=next;if(!pts.length)break}
  const q=pts.map(([x,y])=>[a[0]+(x-a[0])*inset,a[1]+(y-a[1])*inset] as Pt),radius=Math.max(S/nx,S/ny)*1.7
  wrap(a[0],a[1],radius,radius,(dx,dy)=>{const v=q.map(([x,y])=>[x+dx,y+dy] as Pt),fill=blend(t[0],i%3===0?t[2]:t[1],(.13+random(seed,i)*.34)*faceVariation);p.add(rounded?smooth(v):poly(v),fill,1,blend(t[0],t[2],.35),.6);if(v.length>2)p.line(`M${xy(...v[0])}L${xy(...v[1])}`,t[1],1,.35);p.add(lens(a[0]+dx,a[1]+dy,S/nx*.28,S/ny*.21,.2,seed+i),t[1],.1)})
 }
}

const palettes:Record<string,readonly Palette[]>={
 'wood-surface':[
  ['#8D7252','#AF9670','#6E5942','#BCA47D'],['#AC9064','#C4AC7E','#876F4F','#D0B98B'],['#71543E','#9B7854','#554431','#AD8D65'],['#AC9A72','#C8B78B','#877958','#D2C29C'],
  ['#897256','#AD9670','#67563E','#BDA47A'],['#817967','#ABA28A','#605D50','#BDB29C'],['#92988A','#BAC0AC','#717B70','#CACBB7'],['#AC8963','#C9A97E','#856449','#D2B58C'],
 ],
 'stone-surface':[
  ['#777D75','#9DA294','#555F58','#B2B2A1'],['#A6A48E','#C3C1A7','#828777','#D1CBB0'],['#6B7B79','#94A4A0','#4F6463','#B3B8AD'],['#65716A','#88938A','#46584F','#A4AB9B'],
  ['#B6C3B4','#D6DBCE','#879F94','#DCE0D4'],['#AD9875','#CABB95','#89795F','#D4C3A1'],['#888F80','#B6B8A2','#606B60','#C8C5AB'],['#B1B5A7','#D3D3BF','#7E8F86','#BBB29E'],
 ],
 'brick-surface':[
  ['#A37757','#BA9570','#795B49','#C6AA82'],['#AD8E68','#C5AA80','#867052','#D2BE97'],['#796B57','#A49370','#574F43','#BCAB83'],['#A38163','#C1A082','#7E6956','#C7B39A'],
  ['#9C825F','#BAA278','#78694F','#C9B18A'],['#A58269','#C9AC87','#71695B','#B69C7E'],['#9D795F','#C1A17C','#7C6353','#C5AC8B'],['#86938B','#B0B9A8','#616E67','#C2C8B6'],
 ],
 'earth-surface':[
  ['#897B5C','#A29472','#6E684E','#B2A17B'],['#A49170','#BDA887','#7E745C','#CAB799'],['#5C6650','#819071','#424E3E','#A0936B'],['#5B5A45','#807C59','#403F32','#9B916C'],
  ['#A57C57','#B99A70','#7C664B','#C6AC82'],['#B6AD8F','#D1CAB1','#958B6E','#C5B690'],['#757766','#989D88','#555F55','#A5A38A'],['#7C7D6E','#9C9F8C','#575F57','#B4B09A'],
 ],
 'sand-surface':[
  ['#C6B283','#DECCA1','#A9936D','#E8DDB8'],['#D3C5A0','#E9DFC0','#B4A589','#F1E7CC'],['#A79F82','#C0BA9A','#8B896F','#D5CFB1'],['#676C65','#8B9387','#49564F','#A6ABA1'],
  ['#B89767','#D4B283','#947C56','#DFCAA1'],['#B7AA85','#D0C3A2','#928E71','#DED1AC'],['#B2B3A0','#D0D1B9','#8F998D','#E1DCC2'],['#D8CFB2','#ECE4CC','#B8B29B','#F4ECD5'],
 ],
 'grass-surface':[
  ['#6D8057','#91A071','#4D6547','#B0B283'],['#7C8558','#A6AA72','#596A43','#C2BB83'],['#AAA06D','#C8BF8C','#827C55','#D8CFA3'],['#576F50','#7F9568','#3F5942','#9CAB7E'],
  ['#657F52','#8DA568','#455F41','#B4B784'],['#60795A','#8CA078','#405E47','#A7AF8B'],['#707F65','#97A38A','#4E6554','#A1939D'],['#8C9C81','#BDC9AE','#667D68','#D3DAC5'],
 ],
 'snow-surface':[
  ['#E2E8DA','#F1F3E8','#BDCFCC','#D7E2DA'],['#D6DED2','#EBEDE0','#B0C1BA','#F0F0E1'],['#DDE4D7','#F1F2E5','#B1C3BD','#CCD9D0'],['#D5E1D8','#EFF2E8','#B1C6C4','#C7D8D0'],
  ['#D6E0D6','#F0F1E3','#ADC2BD','#E7ECE0'],['#DFE4D4','#F0EEDF','#B5C7B7','#938B6A'],['#BCC6BA','#DBDFCE','#8F9D91','#B8AE94'],['#C3D6D0','#E6EDE0','#92B2AE','#D5E3D7'],
 ],
 'water-surface':[
  ['#658D82','#A7BC9E','#3D706B','#C4D0B6'],['#5F9188','#A2C2AF','#3D736E','#C0D4BC'],['#8F9475','#B9BB95','#687D66','#CFCEAA'],['#536E5D','#8AA174','#37594D','#ABB38A'],
  ['#84AAA0','#BDCFB5','#5C8B84','#CDD8BD'],['#4F7E80','#8BA7A1','#345E67','#B0C0B0'],['#698F90','#B2C7BB','#47787B','#DBDDD0'],['#708F8C','#ADC2B5','#4B6B69','#C7D0BC'],
 ],
}
function woodSurface(p:Paint,i:number,seed:number,t:Palette):void{
 if(i===0){
  // A 3m tile contains twelve 250mm planks; each row has two independently toned lengths.
  // Joints wrap with the plank so the tile boundary never creates an extra end seam.
  for(let row=0;row<12;row++){
   const y=row*50,start=random(seed,row*5)*S,length=250+random(seed,row*5+1)*100
   for(let part=0;part<2;part++){
    const x=start+(part?length:0),w=part?S-length:length,r=random(seed,row*5+part+2)
    tilePoly(p,rect(x,y,w,50),blend(t[0],r<.4?t[2]:t[1],.035+r*.17),blend(t[0],t[2],.38),.55)
   }
   for(let n=0;n<7;n++){
    const yy=y+5+n*6,phase=random(seed+29,row*7+n)*TAU;let d=''
    for(let k=0;k<=40;k++){const x=k*S/40,v=yy+Math.sin(x/S*TAU*2+phase)*.9+Math.sin(x/S*TAU*5+phase)*.3;d+=`${k?'L':'M'}${xy(x,v)}`}
    p.line(d,n%3===0?t[2]:t[3],n%2?.45:.65,.14)
   }
   for(let n=0;n<7;n++){
    const x=random(seed+51,row*14+n*2)*S,yy=y+7+random(seed+51,row*14+n*2+1)*35
    wrap(x,yy,8,2,(dx,dy)=>p.add(lens(x+dx,yy+dy,3+random(seed+71,row*7+n)*5,.6,.04,seed+row*7+n),t[3],.16))
   }
  }
  grain(p,seed+6,t,220,.55,.12);return
 }
 if(i===7){
  mottle(p,seed,t,26,100)
  // Fine compressed cork flecks span 4–14mm in the 1800mm tile, with no stone-like outlines.
  for(let n=0;n<1500;n++){
   const x=random(seed,n*5)*S,y=random(seed,n*5+1)*S,r=.65+random(seed,n*5+2)*1.65,a=random(seed,n*5+3)*TAU
   wrap(x,y,r+1,r+1,(dx,dy)=>p.add(poly(Array.from({length:5},(_,k)=>{const aa=a+k*TAU/5,rr=r*(.65+random(seed+n,k)*.35);return [x+dx+Math.cos(aa)*rr,y+dy+Math.sin(aa)*rr*.8] as Pt})),blend(t[0],n%3===0?t[2]:t[1],.2+random(seed,n*5+4)*.28),.72))
  }
  grain(p,seed+1,t,600,.4,.2);return
 }
 if(i===2||i===6){const w=i===2?75:150,h=i===2?37.5:75;for(let x=0;x<S;x+=w)for(let y=0;y<S;y+=h){const odd=Math.round(x/w)%2,dir=i===6?1:odd?-1:1;const pts:Pt[]=[[x,y],[x+w,y+dir*w],[x+w,y+dir*w+h],[x,y+h]];tilePoly(p,pts,t[(Math.round(x/w)+Math.round(y/h))%2],t[2],1.1,{angle:dir*45,color:t[3],spacing:6})}grain(p,seed+3,t,160,.7,.15);return}
 if(i===3){for(let x=0;x<S;x+=150)for(let y=0;y<S;y+=150){const turn=(x+y)/150%2;for(let k=0;k<3;k++)tilePoly(p,rect(x+(turn?k*50:0),y+(turn?0:k*50),turn?50:150,turn?150:50),t[(x/150+y/150+k)%2],t[2],1,{angle:turn?90:0,color:t[3],spacing:5})}grain(p,seed,t,170,.8,.16);return}
 if(i===4){for(let j=0;j<6;j++)for(let k=0;k<6;k++){const x=k*100+(j%2)*50,y=j*100;tilePoly(p,rect(x+1,y+1,98,98),t[(j+k)%2],t[2],1.1);const cx=x+43+random(seed,j*6+k)*20,cy=y+45;wrap(cx,cy,61,61,(dx,dy)=>{for(let n=1;n<7;n++)p.line(ellipse(cx+dx,cy+dy,n*7.4,n*6.5),n%2?t[1]:t[2],.8,.45);p.line(`M${xy(cx+dx+4,cy+dy)}l28 -21m-24 24l-21 24`,t[2],1,.5)})}grain(p,seed,t,210,.8,.2);return}
 const count=i===1?16:i===5?10:8,step=S/count
 for(let row=0;row<count;row++){const y=row*step,joint=(row%2?180:430)+(i===5?random(seed,row)*27:0);tilePoly(p,rect(0,y,S,step),row%3===0?t[1]:t[0],t[2],1.2)
  for(let n=0;n<(i===1?5:9);n++){const yy=y+4+n*(step-8)/(i===1?5:9);let d='';for(let k=0;k<=32;k++){const x=k*S/32,v=yy+Math.sin(x/S*TAU*2+row+n)*1.4+Math.sin(x/S*TAU*5+n)*.4;d+=`${k?'L':'M'}${xy(x,v)}`}p.line(d,n%3===0?t[2]:t[3],n%2?.65:1,.3)}
  wrap(joint,y+step/2,1,step/2+2,(dx,dy)=>p.line(`M${xy(joint+dx,y+dy)}v${f(step)}`,t[2],1.2,.8))
  if(i===1||i===5){const cx=(joint+83)%S,cy=y+step*.56;wrap(cx,cy,22,10,(dx,dy)=>{for(let n=1;n<4;n++)p.line(ellipse(cx+dx,cy+dy,n*5.4,n*1.8),t[2],.7,.5)})}
  if(i===5){p.line(`M${xy(joint+24,y+5)}l76 2 42 -3m-90 23l90 -1`,t[2],1,.7);for(const x of [joint+5,(joint+283)%S])p.add(ellipse(x,y+5,1.4,1.4),t[2],.8)}
 }grain(p,seed+6,t,180,.7,.16)
}
function stoneSurface(p:Paint,i:number,seed:number,t:Palette):void{
 if(i===0||i===6){voronoi(p,seed,t,i===0?5:8,i===0?5:9,true,i===0?.95:.87);grain(p,seed+1,t,650,i===0?1.1:.7,.3);return}
 if(i===1||i===3){const sx=i===1?200:75,sy=i===1?120:75;for(let j=0;j<S/sy;j++)for(let k=0;k<S/sx;k++){const x=k*sx+(j%2)*sx/2,y=j*sy;tilePoly(p,rect(x+2,y+2,sx-4,sy-4),t[(j+k)%2],t[2],.7)}mottle(p,seed,t,26,80);grain(p,seed+1,t,600,i===1?1.1:.9,.3);return}
 if(i===7){grain(p,seed,t,500,.7,.19);for(let k=0;k<290;k++){const x=random(seed,k*6)*S,y=random(seed,k*6+1)*S,rr=2+random(seed,k*6+2)*7;wrap(x,y,rr*2,rr*2,(dx,dy)=>p.add(poly(Array.from({length:5},(_,n)=>{const a=n*TAU/5,r=rr*(.6+random(seed+k,n)*.5);return [x+dx+Math.cos(a)*r,y+dy+Math.sin(a)*r] as Pt})),t[k%4],.7))}return}
 mottle(p,seed,t,28,140)
 if(i===2){waves(p,seed,t[2],26,7,1,.28,3);waves(p,seed+8,t[1],15,13,.8,.35,2);for(let n=0;n<22;n++){const x=random(seed,n*4)*S,y=random(seed,n*4+1)*S;wrap(x,y,60,28,(dx,dy)=>p.line(`M${xy(x+dx-46,y+dy+9)}l31 -7 8 -11 35 -4`,t[2],.8,.5))}}
 if(i===4){waves(p,seed,t[2],7,23,1.5,.3,2);waves(p,seed+13,t[1],10,31,3,.3,1);waves(p,seed+31,t[2],13,36,.55,.2,2)}
 if(i===5){waves(p,seed,t[1],18,7,8,.26,2);waves(p,seed+3,t[2],31,6,1,.3,1);for(let n=0;n<19;n++){const x=random(seed,n*2)*S,y=random(seed,n*2+1)*S;wrap(x,y,15,50,(dx,dy)=>p.line(`M${xy(x+dx,y+dy-35)}l4 21 -9 19 3 27`,t[2],.7,.4))}}
 grain(p,seed+44,t,i===5?650:360,i===5?.9:.7,.2)
}
function brickSurface(p:Paint,i:number,seed:number,t:Palette):void{
 p.add(poly(rect(0,0,S,S)),i===7?'#A6AC9B':'#9C957D')
 if(i===1){
  for(let row=0;row<4;row++)for(let col=0;col<4;col++){
   const x=col*150+(row%2)*75,y=row*150,r=random(seed,row*4+col),fill=blend(t[0],r<.35?t[2]:t[1],.035+r*.13)
   tilePoly(p,rect(x+1.3,y+1.3,147.4,147.4),fill,blend(t[0],t[2],.3),.45)
   wrap(x+75,y+75,78,78,(dx,dy)=>{
    p.add(lens(x+dx+75,y+dy+70,46,39,.3,seed+row*4+col),t[1],.035)
    p.line(`M${xy(x+dx+7,y+dy+11)}l13 -3m114 123l8 -7`,t[3],.7,.2)
   })
  }
  mottle(p,seed+37,t,34,42);grain(p,seed+1,t,700,.65,.19);return
 }
 if(i===5){voronoi(p,seed,t,9,9,false,.9);grain(p,seed+1,t,620,.8,.24);return}
 if(i===4){const w=75,h=37.5;for(let x=0;x<S;x+=w)for(let y=0;y<S;y+=h){const dir=(x/w)%2?-1:1;tilePoly(p,[[x+1,y+2],[x+w-1,y+dir*w+2],[x+w-1,y+dir*w+h-2],[x+1,y+h-2]],t[(x/w+y/h)%2],t[2],.55)}grain(p,seed,t,700,.7,.25);return}
 if(i===6){for(let row=0;row<8;row++)for(let col=0;col<4;col++){const x=col*150+(row%2)*75,y=row*75;tilePoly(p,[[x-73,y],[x,y-73],[x+73,y],[x,y+73]],blend(t[0],t[1],random(seed,row*4+col)*.45),t[2],.55)}grain(p,seed,t,700,.7,.25);return}
 if(i===7){for(let col=0;col<8;col++)for(let row=0;row<6;row++){const x=col*75,y=row*100+(col%2)*50;tilePoly(p,[[x-48,y],[x-24,y-48],[x+24,y-48],[x+48,y],[x+24,y+48],[x-24,y+48]],blend(t[0],t[1],random(seed,col*6+row)*.5),t[2],.6)}grain(p,seed,t,340,.7,.18);return}
 if(i===2){for(let x=0;x<S;x+=100)for(let y=0;y<S;y+=100){const turn=(x+y)/100%2;for(let k=0;k<2;k++)tilePoly(p,rect(x+(turn?k*50:0)+2,y+(turn?0:k*50)+2,turn?46:96,turn?96:46),t[(x/100+y/100+k)%2],t[2],.7)}grain(p,seed,t,550,.8,.25);return}
 const sy=i===1?150:50
 for(let row=0;row<S/sy;row++){const y=row*sy;if(i===3){for(let cell=0;cell<4;cell++){const x=cell*150+(row%2)*75;tilePoly(p,rect(x+2,y+2,96,46),t[(cell+row)%2],t[2],.7);tilePoly(p,rect(x+102,y+2,46,46),t[(cell+row+1)%2],t[2],.7)}}else{const sx=i===1?150:150;for(let col=0;col<4;col++){const x=col*sx+(row%2)*sx/2;tilePoly(p,rect(x+2,y+2,sx-4,sy-4),t[(row+col)%2],t[2],.7)}}}
 mottle(p,seed,t,28,45);grain(p,seed+1,t,700,.7,.25)
}
function organicBits(p:Paint,seed:number,t:Palette,count:number,kind:'leaf'|'twig'|'grit'|'shell'):void{
 for(let i=0;i<count;i++){const x=random(seed,i*5)*S,y=random(seed,i*5+1)*S,a=random(seed,i*5+2)*TAU,size=3+random(seed,i*5+3)*11;wrap(x,y,size*2,size*2,(dx,dy)=>{if(kind==='twig'){const u=Math.cos(a)*size,v=Math.sin(a)*size;p.line(`M${xy(x+dx-u,y+dy-v)}l${xy(u*2,v*2)}m${xy(-u*.7,-v*.7)}l${xy(-v*.4,u*.4)}`,t[i%2?2:3],.8,.7)}else if(kind==='leaf'){p.add(lens(x+dx,y+dy,size,size*.36,a,seed+i),t[i%3],.6);p.line(`M${xy(x+dx-Math.cos(a)*size*.7,y+dy-Math.sin(a)*size*.7)}l${xy(Math.cos(a)*size*1.4,Math.sin(a)*size*1.4)}`,t[3],.6,.45)}else{p.add(kind==='shell'?lens(x+dx,y+dy,size*.6,size*.28,a,seed+i):poly(Array.from({length:5},(_,n)=>[x+dx+Math.cos(a+n*TAU/5)*size*.5,y+dy+Math.sin(a+n*TAU/5)*size*.42] as Pt)),t[i%4],.65);if(kind==='shell')p.line(`M${xy(x+dx-2,y+dy-1)}l4 2`,t[2],.6,.6)}})}
}
function earthSurface(p:Paint,i:number,seed:number,t:Palette):void{
 mottle(p,seed,t,40,i===6?95:120)
 if(i===0){
  // Broad, feathered compacted/dusty patches remain visible at room scale without a stamped icon edge.
  for(let n=0;n<18;n++){
   const x=random(seed+71,n*5)*S,y=random(seed+71,n*5+1)*S,rx=62+random(seed+71,n*5+2)*95,ry=35+random(seed+71,n*5+3)*65,a=random(seed+71,n*5+4)*TAU
   wrap(x,y,Math.max(rx,ry),Math.max(rx,ry),(dx,dy)=>{for(let k=0;k<7;k++)p.add(lens(x+dx,y+dy,rx*(1-k*.09),ry*(1-k*.09),a,seed+n),n%3===0?t[2]:t[1],.018+k*.007+n*.00019)})
  }
  mottle(p,seed+33,t,32,38)
 }
 if(i===1){voronoi(p,seed,t,7,7,false,.97,.35);mottle(p,seed+3,t,24,80)}
 if(i===2){organicBits(p,seed+4,['#626C4E','#909574','#3F503E','#A39A72'],100,'leaf');organicBits(p,seed+8,t,55,'twig')}
 if(i===3){for(let n=0;n<110;n++){const x=random(seed,n*3)*S,y=random(seed,n*3+1)*S;wrap(x,y,30,30,(dx,dy)=>p.line(`M${xy(x+dx-19,y+dy+7)}q21 -20 42 -4`,n%2?t[1]:t[2],.8,.35))}}
 if(i===4||i===5||i===7)organicBits(p,seed+9,t,i===7?145:95,'grit')
 if(i===6){for(let n=0;n<25;n++){const x=random(seed,n*3)*S,y=random(seed,n*3+1)*S;wrap(x,y,45,30,(dx,dy)=>{p.add(lens(x+dx,y+dy,38,23,.15,seed+n),t[2],.24);p.line(`M${xy(x+dx-20,y+dy-3)}q16 -5 33 -1`,t[1],1,.35)})}waves(p,seed,t[2],28,5,.6,.13,3)}
 if(i===0||i===7){for(let n=0;n<70;n++){const x=random(seed,n*2)*S,y=random(seed,n*2+1)*S;wrap(x,y,15,5,(dx,dy)=>p.line(`M${xy(x+dx-10,y+dy)}l${xy(8+random(seed,n)*16,-1)}`,t[n%2?1:2],.8,.3))}}
 grain(p,seed+23,t,i===5?900:680,i===4?1.2:.9,.25)
}
function sandSurface(p:Paint,i:number,seed:number,t:Palette):void{
 mottle(p,seed,t,24,120)
 if(i===0||i===4){waves(p,seed,t[2],i===0?20:12,i===0?13:23,i===0?4:7,.19,2);waves(p,seed,t[1],i===0?20:12,i===0?13:23,1.3,.42,2)}
 if(i===2){waves(p,seed,t[2],22,7,.6,.15,2);organicBits(p,seed+8,t,85,'shell')}
 if(i===3||i===5||i===6)organicBits(p,seed+13,t,i===5?140:i===6?120:50,'grit')
 if(i===7){organicBits(p,seed+9,t,190,'shell');organicBits(p,seed+17,t,65,'grit')}
 grain(p,seed+33,t,i===1?1200:950,i===1?.85:i===7?1.3:1,.25)
}
function grassSurface(p:Paint,i:number,seed:number,t:Palette):void{
 mottle(p,seed,t,32,100);grain(p,seed+7,t,250,.8,.2)
 const count=i===3?260:i===4?115:i===2?160:210
 for(let n=0;n<count;n++){const x=random(seed,n*4)*S,y=random(seed,n*4+1)*S,a=random(seed,n*4+2)*TAU,len=i===2?20:i===5?19:i===3?4:10;wrap(x,y,len*2,len*2,(dx,dy)=>{
  if(i===4){for(let k=0;k<3;k++){const aa=k*TAU/3;const u=x+dx+Math.cos(aa)*5,v=y+dy+Math.sin(aa)*5;p.add(ellipse(u,v,4.4,3.2),t[(n+k)%2],.8);p.line(`M${xy(x+dx,y+dy)}L${xy(u,v)}`,t[3],.5,.35)}}
  else if(i===3){for(let k=0;k<4;k++)p.add(lens(x+dx+(k%2)*4,y+dy+Math.floor(k/2)*4,3.6,2,random(seed,n+k),seed+n+k),t[(n+k)%3],.7)}
  else for(let k=0;k<(i===1?6:4);k++){const aa=a+(k-1.5)*.43,l=len*(.65+random(seed+n,k)*.7),u=Math.cos(aa)*l,v=Math.sin(aa)*l;p.line(`M${xy(x+dx,y+dy)}q${xy(u*.22-v*.13,v*.22+u*.13)} ${xy(u,v)}`,t[(n+k)%4],i===1?1.5:i===2?.9:1,.73);if(i===7)p.line(`M${xy(x+dx+u*.7,y+dy+v*.7)}l${xy(u*.3,v*.3)}`,t[3],.7,.7)}
 })}
 if(i===2||i===5)organicBits(p,seed+13,[t[0],t[3],t[2],t[1]],60,'twig')
 if(i===6){organicBits(p,seed+3,t,100,'twig');for(let n=0;n<100;n++){const x=random(seed+9,n*2)*S,y=random(seed+9,n*2+1)*S;wrap(x,y,3,3,(dx,dy)=>p.add(ellipse(x+dx,y+dy,1.8,1.5),n%2?'#9E8A9A':'#746D86',.7))}}
}
function snowSurface(p:Paint,i:number,seed:number,t:Palette):void{
 mottle(p,seed,t,i===0?35:29,i===0?150:100)
 if(i===2||i===7){voronoi(p,seed,t,i===7?4:6,i===7?4:6,false,i===7?.994:.985,i===7?.13:.25);mottle(p,seed+2,t,36,100)}
 if(i===3){waves(p,seed,t[2],16,13,9,.12,2);waves(p,seed,t[1],16,13,2,.4,2)}
 if(i===1){for(let n=0;n<65;n++){const x=random(seed,n*3)*S,y=random(seed,n*3+1)*S;wrap(x,y,25,20,(dx,dy)=>{p.add(lens(x+dx,y+dy,19,13,.2,seed+n),t[2],.12);p.line(`M${xy(x+dx-10,y+dy+4)}q12 3 23 -2`,t[1],2,.4)})}}
 if(i===4){for(let n=0;n<750;n++){const x=random(seed,n*3)*S,y=random(seed,n*3+1)*S,r=1+random(seed,n*3+2)*3;wrap(x,y,r+1,r+1,(dx,dy)=>{p.add(ellipse(x+dx,y+dy,r,r*.7),t[n%3],.34);p.line(`M${xy(x+dx-r*.5,y+dy-r*.3)}l${f(r*.6)} -.3`,t[1],.6,.55)})}}
 if(i===5){mottle(p,seed+5,[t[0],t[3],t[3],t[2]],16,25);organicBits(p,seed+9,['#B6B79A','#B8AD87','#7F805F','#9F9572'],100,'twig')}
 if(i===6){mottle(p,seed+5,[t[0],t[3],t[2],t[3]],38,37);organicBits(p,seed+15,['#A5AE9C','#D4D8C3','#8B9786','#C2C9B9'],85,'grit')}
 grain(p,seed+17,t,i===0?600:420,i===0?.8:1.1,.24)
}
function waterSurface(p:Paint,i:number,seed:number,t:Palette):void{
 mottle(p,seed,t,36,i===5?160:115)
 if(i===4){voronoi(p,seed,['#8FA99C','#AFBCAA','#758D81','#C4CCAF'],9,10,true,.8);p.add(poly(rect(0,0,S,S)),t[0],.35)}
 if(i===3){for(let n=0;n<80;n++){const x=random(seed,n*4)*S,y=random(seed,n*4+1)*S;wrap(x,y,27,25,(dx,dy)=>{for(let k=0;k<4;k++)p.add(ellipse(x+dx+Math.cos(k*2.4)*8,y+dy+Math.sin(k*2.4)*7,3.5+k%2,2.8),k%2?'#81966B':'#A4AE81',.83)})}}
 if(i===0){for(let n=0;n<30;n++){const x=random(seed,n*4)*S,y=random(seed,n*4+1)*S,r=7+random(seed,n*4+2)*25;wrap(x,y,r+1,r*.4+1,(dx,dy)=>{p.line(`M${xy(x+dx-r,y+dy)}q${xy(r,-r*.45)} ${xy(r*2,0)}`,t[1],1,.42);p.line(`M${xy(x+dx-r*.67,y+dy+r*.2)}q${xy(r*.67,r*.22)} ${xy(r*1.34,0)}`,t[2],.6,.3)})}}
 if(i===1||i===2||i===4||i===5||i===6){waves(p,seed,t[2],i===5?12:20,i===5?16:9,i===5?9:2,.18,i===5?1:2);waves(p,seed+3,t[1],i===5?10:23,i===5?19:8,i===5?2:1,.28,i===5?1:2)}
 if(i===7){for(let n=0;n<80;n++){const x=random(seed,n*3)*S,y=random(seed,n*3+1)*S,len=8+random(seed,n*3+2)*38;wrap(x,y,len,8,(dx,dy)=>p.line(`M${xy(x+dx-len*.5,y+dy)}q${xy(len*.5,-3)} ${xy(len,0)}`,t[n%3],n%3===0?4:1.1,.32))}waves(p,seed,t[2],15,8,2,.15,2)}
 if(i===2||i===6){for(let n=0;n<(i===6?140:30);n++){const x=random(seed+18,n*4)*S,y=random(seed+18,n*4+1)*S,len=3+random(seed+18,n*4+2)*19;wrap(x,y,len,9,(dx,dy)=>{p.line(`M${xy(x+dx-len*.5,y+dy)}q${xy(len*.3,-4)} ${xy(len,0)}`,t[3],i===6?1.7:.7,.42);p.add(ellipse(x+dx+len*.6,y+dy+3,.9,.65),t[1],.55)})}}
 grain(p,seed+49,t,220,.65,.11)
}

function dots(p:Paint,seed:number,colors:readonly string[],n:number,rx=190,ry=200,opacity=.4,size=2):void{
 for(let k=0;k<n;k++){const a=random(seed,k*4)*TAU,r=Math.sqrt(random(seed,k*4+1)),x=300+Math.cos(a)*rx*r,y=300+Math.sin(a)*ry*r,rr=.5+random(seed,k*4+2)*size;p.add(ellipse(x,y,rr,rr*(.4+random(seed,k*4+3)*.6)),colors[k%colors.length],opacity)}
}
function footprints(p:Paint,i:number,seed:number):void{
 const color=i===3?'#7E8378':i===7?'#68766A':'#77674E',dark=i===3?'#656E65':'#5F5947',light='#B6A784'
 const foot=(q:Paint)=>{
  if(i===0){q.add(smooth([[-23,-24],[-25,-2],[-15,12],[-17,31],[1,43],[21,34],[20,10],[27,-18],[16,-30]]),color,.58);for(let n=0;n<5;n++)q.add(ellipse(-22+n*11,-40+(n-2)*1.7,6.3-n*.55,7.5-n*.6),color,.56);q.add(lens(-8,3,7,22,.1,seed),light,.13)}
  else if(i===2){q.line('M-24 24Q-38 -2 -19 -29Q0 -45 22 -27Q37 -7 25 23',dark,7,.63);q.line('M-18 19Q-28 -3 -13 -23M18 19Q27 -1 13 -23',light,1.1,.45);q.add(ellipse(0,17,5,10),color,.33)}
  else if(i===4){q.add(lens(0,16,25,20,.1,seed),color,.55);for(let n=0;n<3;n++){const x=(n-1)*20;q.add(lens(x,-19,8,29,(n-1)*.34,seed+n),color,.54);q.add(poly([[x-3,-42],[x,-53],[x+3,-42]]),dark,.5)}}
  else if(i===5){q.add(smooth([[-25,21],[-19,6],[0,-2],[20,8],[26,26],[5,33],[-5,32]]),color,.58);for(let n=0;n<4;n++){const x=-25+n*16,y=-15-Math.sin(n/3*Math.PI)*11;q.add(ellipse(x,y,7.6,10),color,.58);q.add(poly([[x-2,y-13],[x,y-22],[x+2,y-13]]),dark,.46)}}
  else{
   const narrow=i===6,wide=i===7;q.add(smooth([[-22,-31],[-28,-10],[-24,8],[-13,21],[12,22],[25,7],[27,-16],[19,-34],[0,-39]]),color,.62);q.add(poly([[-17,30],[17,30],[18,45],[-18,45]]),color,.58)
   if(i===1||wide){for(let k=0;k<6;k++)q.line(`M-20 ${-26+k*8}h40`,dark,wide?4:2.1,.6);if(wide)for(let k=-1;k<=1;k++)q.line(`M${k*12} -32V17`,light,2,.4)}
   if(i===3){q.add(poly([[-20,-28],[0,-50],[20,-28]]),color,.57);for(let k=0;k<5;k++)q.line(`M-22 ${-25+k*9}q22 6 44 0`,dark,1.6,.65)}
   if(narrow){for(let k=0;k<8;k++)q.line(`M${-17+k*5} -25l-4 36`,dark,.8,.5);q.line('M-10 34H10',dark,1.3,.6)}
  }
 }
 const rows=i===2||i===5?4:3
 for(let n=0;n<rows;n++)for(let side=0;side<2;side++)p.stamp(side?389:211,92+n*(410/rows)+(side?50:0),side?8:-9,.96*(side?-1:1),.94,foot)
 dots(p,seed,[color,light],35,133,218,.3,1.6)
}
function dragMarks(p:Paint,i:number,seed:number):void{
 const d='#79745B',l='#B3AA88',m='#92896C'
 const groove=(x:number,w:number,curve=0)=>{p.line(`M${x} 75Q${x+curve} 235 ${x-curve*.25} 527`,d,w,.24);p.line(`M${x-3} 77Q${x+curve-4} 234 ${x-curve*.25-4} 525`,l,1.2,.43);for(let n=0;n<7;n++)p.line(`M${x-w*.45+random(seed,n)*w} ${93+n*58}l${f(curve*.03)} ${26+random(seed,n+8)*30}`,d,.65,.5)}
 switch(i){
  case 0:groove(297,83,27);groove(325,19,16);p.add(lens(286,510,78,17,.03,seed),m,.19);break
  case 1:groove(172,30,7);groove(428,30,7);for(let n=0;n<11;n++)p.line(`M183 ${105+n*37}l228 ${n%2?7:-4}`,d,.75,.23);break
  case 2:for(let n=0;n<3;n++)groove(268+n*26,4,10+n*6);p.line('M287 91Q301 250 287 485',l,1.3,.6);break
  case 3:for(let n=0;n<21;n++){const x=137+n*15;p.line(`M${x} 488Q${271+n*2} ${250+n*3} ${316+n*2} ${93+n*2}`,n%3?m:l,1.3,.22)}break
  case 4:for(let n=0;n<13;n++){const y=86+n*33,x=284+Math.sin(n*.7)*32;p.add(ellipse(x,y,12,n%2?5:11),'none',.38,d,1.4);p.line(`M${x+4} ${y+6}l7 13`,m,1.2,.35)}break
  case 5:groove(209,38,43);groove(380,41,-31);p.add(lens(190,496,23,31,.2,seed),m,.35);p.add(lens(388,521,24,20,-.1,seed+4),m,.4);break
  case 6:groove(147,18,142);groove(389,18,142);for(let n=0;n<13;n++){const y=86+n*32;p.line(`M${157+Math.sin(n*.15)*31} ${y}l14 3M${399+Math.sin(n*.15)*31} ${y}l14 3`,d,1,.28)}break
  case 7:for(let n=0;n<16;n++){const x=118+n*25;p.line(`M${x} 95Q${210+n*6} 285 ${250+n*7} 491`,d,1.4,.4)}p.add(lens(304,502,140,34,.05,seed),m,.26);dots(p,seed,[m,d,l],170,180,40,.47,2.8);break
 }
 dots(p,seed+31,[d,m,l],85,178,213,.34,1.9)
}
function bloodTraces(p:Paint,i:number,seed:number):void{
 const dry=i===4,red=dry?'#715447':'#8C4540',dark=dry?'#60483C':'#632F32',light=dry?'#AA866A':'#B57A65'
 const blob=(x:number,y:number,rx:number,ry:number,a=0,opacity=.64)=>{p.add(lens(x,y,rx,ry,a,seed+Math.round(x)),dark,opacity);p.add(lens(x,y,rx*.77,ry*.72,a,seed+Math.round(x)),red,opacity*.65)}
 switch(i){
  case 0:for(let n=0;n<12;n++){const y=75+n*38,x=290+Math.sin(n*.8)*35,r=4+random(seed,n)*11;blob(x,y,r,r*.75,.2);if(n%3===0)p.add(lens(x+4,y-11,2,10,-.2,seed+n),red,.6)}break
  case 1:blob(294,298,178,126,.2);blob(435,308,47,24,-.4);blob(211,404,37,20,.1);p.line('M181 239Q276 171 380 242',light,1.4,.3);break
  case 2:for(let n=0;n<19;n++){const x=173+n*12;p.line(`M${x} 127Q${191+n*11} 300 ${232+n*8} ${491-random(seed,n)*67}`,n%4===0?light:red,n%3===0?8:3,.4)}blob(299,153,96,34,.1,.4);break
  case 3:for(let n=0;n<5;n++)p.stamp(n%2?385:216,105+n*88,n%2?9:-8,1,.9,q=>{q.add(smooth([[-25,-33],[-29,2],[-12,23],[13,23],[28,4],[26,-31],[0,-44]]),red,.62-n*.07);q.add(poly([[-18,32],[18,32],[17,47],[-17,47]]),red,.56-n*.06);for(let k=0;k<4;k++)q.line(`M-20 ${-24+k*10}h40`,dark,2,.4-n*.04)});break
  case 4:for(let n=0;n<7;n++){const a=n*2.4,x=300+Math.cos(a)*(60+n*15),y=300+Math.sin(a)*(55+n*11),rx=24+random(seed,n)*42;blob(x,y,rx,rx*.67,a,.46);p.line(lens(x,y,rx*.76,rx*.51,a,seed+Math.round(x)),light,.7,.34);p.line(`M${x-9} ${y-8}l5 13 -4 10m8 -9 12 4`,dark,.65,.5)}break
  case 5:for(let n=0;n<80;n++){const a=-2.8+random(seed,n*4)*2.2,r=35+random(seed,n*4+1)*330,x=433+Math.cos(a)*r,y=492+Math.sin(a)*r,rr=1+random(seed,n*4+2)*4;if(x>46&&x<554&&y>46&&y<554)blob(x,y,rr*(1+r/220),rr,a,.58)}break
  case 6:for(let n=0;n<14;n++){const rx=130+n*4,ry=70+n*7;p.line(`M${f(300-rx)} ${f(350-n*3)}Q${f(300)} ${f(350-ry*2-n*3)} ${f(300+rx)} ${f(350-n*3)}`,n%3===0?dark:red,n%2?2:5,.2)}break
  case 7:p.line('M286 78Q329 203 287 315T314 509',red,4,.65);p.line('M293 84Q332 208 294 314T319 506',dark,1.3,.5);blob(314,513,29,20,.2);for(let n=0;n<11;n++)blob(290+Math.sin(n*.7)*21,86+n*36,3+random(seed,n)*4,2.5);break
 }
 dots(p,seed+23,[red,dark],i===1?35:24,222,217,.5,2.3)
}
function sootTraces(p:Paint,i:number,seed:number):void{
 const dark='#4F5148',mid='#777869',light='#A7A28B'
 const haze=(x:number,y:number,rx:number,ry:number,a=0)=>{for(let n=0;n<5;n++)p.add(lens(x,y,rx*(1-n*.13),ry*(1-n*.13),a,seed+Math.round(x)),n%2?mid:dark,.055)}
 switch(i){
  case 0:haze(301,329,233,152);for(let n=0;n<27;n++){const a=Math.PI*1.07+n/26*Math.PI*.86,r=90+random(seed,n)*170;p.line(`M300 420l${xy(Math.cos(a)*r,Math.sin(a)*r)}`,dark,1,.22)}break
  case 1:for(let n=0;n<18;n++){const x=150+n*15,y=159+random(seed,n)*63;p.line(`M${x} ${y}q55 109 86 ${180+random(seed,n+2)*47}`,dark,n%3?3:9,.28);haze(x+30,y+100,20,81,-.4)}break
  case 2:for(let n=0;n<5;n++)p.line(ellipse(300,302,127+n*5,112+n*4),n%2?mid:dark,4,.15);haze(300,302,168,151);break
  case 3:for(let n=0;n<30;n++){const a=random(seed,n*3)*TAU,r=Math.sqrt(random(seed,n*3+1))*200,x=300+Math.cos(a)*r,y=300+Math.sin(a)*r,rr=2+random(seed,n*3+2)*11;haze(x,y,rr*1.7,rr);p.add(lens(x,y,rr*.4,rr*.45,a,seed+n),dark,.47)}break
  case 4:haze(300,300,237,172);dots(p,seed,[light,mid,'#C0BBA1'],330,231,176,.5,3);break
  case 5:haze(300,300,150,143);for(let n=0;n<23;n++){const a=n*TAU/23,r=145+random(seed,n)*85;p.line(`M${xy(300+Math.cos(a)*48,300+Math.sin(a)*48)}l${xy(Math.cos(a)*r,Math.sin(a)*r)}`,dark,n%3?2:4,.24)}break
  case 6:for(let n=0;n<21;n++)p.line(`M${112+n*5} ${405+n*2}Q${250+n*4} ${151+n*3} ${492+n*.6} ${253+n*3}`,n%4?mid:light,1.7,.3);break
  case 7:for(let n=0;n<13;n++){const a=random(seed,n*3)*TAU,r=Math.sqrt(random(seed,n*3+1))*170,x=300+Math.cos(a)*r,y=300+Math.sin(a)*r,rr=5+random(seed,n*3+2)*36;p.add(lens(x,y,rr,rr*.6,a,seed+n),'#5A5140',.38);haze(x,y,rr*1.5,rr)}break
 }
 dots(p,seed+4,[dark,mid,light],i===4?90:150,237,218,.4,1.8)
}
function webs(p:Paint,i:number,seed:number):void{
 const dark='#8F927F',light='#D1D1B8',milk='#E4DFCB'
 const cx=i===0?123:i===3?344:300,cy=i===0?133:i===3?307:285,rx=i===2?243:i===5?249:219,ry=i===2||i===5?117:213,n=i===6?18:12
 const start=i===0?0:0,end=i===0?Math.PI*.53:TAU
 const point=(a:number,r:number):Pt=>[cx+Math.cos(a)*rx*r,cy+Math.sin(a)*ry*r]
 const curve=(a:number,b:number,r:number)=>{const u=point(a,r),v=point(b,r),m=point((a+b)/2,r*.86);return `M${xy(...u)}Q${xy(...m)} ${xy(...v)}`}
 for(let k=0;k<n;k++){const a=start+(end-start)*k/(i===0?n-1:n);if(i===1&&k===4||i===4&&k%4===0)continue;const u=point(a,1);p.line(`M${cx} ${cy}L${xy(...u)}`,dark,1.6,.4);p.line(`M${cx} ${cy}L${xy(...u)}`,light,.65,.65)}
 for(let ring=1;ring<(i===6?13:8);ring++)for(let k=0;k<(i===0?n-1:n);k++){if(i===1&&k>=3&&k<=4||i===4&&(k+ring)%4===0)continue;const a=start+(end-start)*k/(i===0?n-1:n),b=start+(end-start)*(k+1)/(i===0?n-1:n),r=ring/(i===6?13:8)*(1+Math.sin(k*3+ring)*.025);p.line(curve(a,b,r),dark,1.3,.35);p.line(curve(a,b,r),light,.55,.65)}
 if(i===3){for(let k=1;k<8;k++)p.line(ellipse(cx,cy,10+k*4,6+k*3),light,.7,.6);p.add(ellipse(cx,cy,8,7),'none',1)}
 if(i===4){p.line('M112 127Q175 229 213 385M456 156Q395 310 475 434',light,.7,.6)}
 if(i===5){p.line('M48 170Q282 329 553 176M50 417Q300 262 554 413',light,1,.6)}
 if(i===6)dots(p,seed,['#9D9D85','#C9C6AA'],90,185,185,.7,1.1)
 if(i===7)for(let k=0;k<35;k++){const a=random(seed,k)*TAU,r=.2+random(seed,k+7)*.75,[x,y]=point(a,r);p.add(ellipse(x,y,1.4+random(seed,k+3)*2.2,1.1+random(seed,k+5)*2),milk,.8);p.add(ellipse(x-.6,y-.6,.65,.55),'#F2ECD5',.8)}
}
function glassShards(p:Paint,i:number,seed:number):void{
 const palettes:readonly Palette[]=[['#8FAFA0','#D2DCC3','#637F73','#DFE8CF'],['#A2834F','#D4BB78','#756342','#E0C890'],['#667F9C','#B0C5CD','#445A78','#D4DCD6'],['#9ABBB2','#D4E0CD','#6B8C85','#EBEDDA'],['#BEC7BB','#E1DFCB','#7F8E8A','#F0ECD5'],['#937974','#C3B4A1','#596C78','#D4D2B6'],['#8B9E97','#CDD4C2','#596F6D','#E3E4CF'],['#9FB7B1','#D3DFCE','#738F8A','#E6EADA']]
 const t=palettes[i],n=i===3?18:i===6?24:29
 for(let k=0;k<n;k++){const a=random(seed,k*5)*TAU,r=Math.sqrt(random(seed,k*5+1))*210,x=300+Math.cos(a)*r,y=300+Math.sin(a)*r,sz=(i===3&&k<3?75:9+random(seed,k*5+2)*29),stretch=i===6?2.4:1,rot=random(seed,k*5+3)*360;p.stamp(x,y,rot,1,1,q=>{
  const pts:Pt[]=[[-sz*.6,-sz*.3],[sz*.55,-sz*.54],[sz*.7,sz*.1],[sz*.12,sz*.5],[-sz*.42,sz*.3]].map(([u,v])=>[u*stretch,v] as Pt)
  const base=i===5?[t[0],'#74898E','#A29264'][k%3]:t[0];q.add(poly(pts),base,i===4?.72:.34,t[2],.65);q.line(`M${xy(...pts[0])}L${xy(...pts[1])}L${xy(...pts[2])}`,t[3],.9,.85);q.line(`M${-sz*.25} ${-sz*.15}l${sz*.62} ${sz*.35}`,t[1],.7,.65)
  if(i===1||i===2)q.line(`M${-sz*.4} ${sz*.1}q${sz*.4} ${-sz*.25} ${sz*.85} 0`,t[1],1.4,.6)
  if(i===3)q.line(`M${-sz*.3} ${-sz*.3}l${sz*.22} ${sz*.4} ${sz*.5} ${sz*.1}m${-sz*.5} ${-sz*.1}l${-sz*.05} ${sz*.3}`,t[3],.65,.65)
  if(i===4)q.add(lens(0,0,sz*.28,sz*.14,.1,seed+k),t[2],.25)
  if(i===5&&k%3===0)q.line(`M${xy(...pts[0])}L${xy(...pts[1])}`,t[2],2,.75)
  if(i===7)linearFibres(q,pts,0,5,t[1],.7)
 })}
 dots(p,seed+7,[t[0],t[1],t[3]],85,222,209,.5,1.6)
 if(i===1||i===2)p.stamp(365,372,25,1,1,q=>{q.line('M-39 19Q-55 -22 -20 -38Q19 -55 44 -17',t[2],8,.6);q.line('M-39 19Q-55 -22 -20 -38Q19 -55 44 -17',t[1],3,.65)})
}
function papers(p:Paint,i:number,seed:number):void{
 const t:Palette=i===0?['#B9A176','#D2BF98','#8B7758','#E0CFAA']:i===6?['#B5AA8D','#D1C6AA','#807E6A','#DED5BB']:['#C5B28B','#DFD0AB','#8E8060','#ECE0BE'],n=i===4?7:i===6?6:i===2?9:4
 for(let k=0;k<n;k++){const a=random(seed,k*3)*TAU,rr=Math.sqrt(random(seed,k*3+1))*137,x=300+Math.cos(a)*rr,y=300+Math.sin(a)*rr,w=i===4?75:i===2?63:100+random(seed,k*3+2)*42,h=i===4?105:i===2?62:125+random(seed,k+6)*46,angle=(random(seed,k+11)-.5)*75
  p.stamp(x,y,angle,1,1,q=>{
   const pts:Pt[]=i===0?[[-w/2+7,-h/2],[-w/2+31,-h/2+5],[w/2-13,-h/2+2],[w/2,-h/2+11],[w/2-4,h/2-15],[w/2-19,h/2],[-w/2+3,h/2-7],[-w/2-3,-h/2+17]]:i===2?[[-w/2,-h/2+13],[-w/2+17,-h/2+19],[0,-h/2],[w/2-9,-h/2+8],[w/2,h/2-7],[w/2-20,h/2-13],[-w/2+11,h/2]]:rect(-w/2,-h/2,w,h)
   q.add(poly(pts),t[1],.93,t[2],.8);q.line(`M${-w/2+5} ${h/2-5}h${w-12}`,t[0],2,.38)
   if(i===4){q.line(poly(rect(-w/2+7,-h/2+8,w-14,h-16)),t[2],.6,.45);for(let j=0;j<k%4+1;j++)q.add(poly([[0,-h/4+j*14],[-4,-h/4+6+j*14],[0,-h/4+12+j*14],[4,-h/4+6+j*14]]),k%2?'#917051':'#7D826B',.65)}
   else if(i===3){q.line(`M${-w*.3} ${h*.24}q${w*.2} ${-h*.35} ${w*.4} ${-h*.12}t${w*.24} ${-h*.23}M${-w*.2} ${-h*.3}q${w*.1} ${h*.25} ${w*.4} ${h*.42}`,t[2],.8,.55);q.line(`M${-w*.2} ${-h*.35}v${h*.7}M${-w*.36} 0h${w*.72}`,t[0],.65,.45)}
   else{const columns=i===6?3:i===1?2:1;for(let col=0;col<columns;col++){const left=-w*.36+col*w*.72/columns;for(let line=0;line<9;line++)q.line(`M${left} ${-h*.33+line*h*.074}h${w*.72/columns*(.65+random(seed+k,col*11+line)*.25)}`,t[2],line===0&&i===7?2:.65,line===0&&i===7?.65:.47)}if(i===1)q.line(`M0 ${-h*.4}v${h*.8}`,t[0],.6,.5);if(i===7)q.line(poly(rect(-w*.42,-h*.43,w*.84,h*.86)),t[2],1,.55)}
   if(i===5){q.add(poly([[-w/2,-h/2],[-w/2+12,-h/2-6],[-w/2+14,h/2],[-w/2+2,h/2+5]]),t[0],.82);q.line(`M${w/2-9} ${-h/2+1}q14 ${h*.45} 0 ${h-2}`,t[0],3,.5)}
   if(i!==0&&i!==2)q.line(`M${-w*.4} ${h*.04}l${w*.8} -4`,t[0],.7,.48)
  })
 }
 if(i===2)p.stamp(428,448,15,1,1,q=>{q.add(lens(0,0,17,15,.2,seed),'#A17B50',.9,'#755E43',.7);q.add(ellipse(0,0,8,8),'none',1,'#C1A371',.6)})
}
function rubbleTraces(p:Paint,i:number,seed:number):void{
 const ts:readonly Palette[]=[['#979E8D','#C1C5AA','#707C70','#D0CBAF'],['#A07858','#C2A07C','#756B56','#D0B795'],['#6E8581','#A1B1A3','#4B6663','#C0C5AF'],['#ABA58D','#D0C9AC','#858673','#E1D4B4'],['#9B7D55','#C5AD7C','#6E6249','#D5C296'],['#A2805F','#C5A580','#796F5C','#D4BE98'],['#BDBCA7','#E1D9BC','#92998A','#C6B791'],['#61685E','#939989','#404F49','#B1AE96']]
 const t=ts[i],n=i===3?50:i===7?39:25
 dots(p,seed+31,t,160,220,197,.5,1.9)
 for(let k=0;k<n;k++){const a=random(seed,k*5)*TAU,r=Math.sqrt(random(seed,k*5+1))*198,x=300+Math.cos(a)*r,y=300+Math.sin(a)*r,sz=5+random(seed,k*5+2)*(i===3?15:34),rot=random(seed,k*5+3)*360;p.stamp(x,y,rot,1,1,q=>{
  const pts:Pt[]=i===4?[[-sz*.15,-sz*1.5],[sz*.12,-sz*.4],[sz*.3,sz*1.15],[0,sz*1.7],[-sz*.2,sz*.5]]:i===1&&k%3===0?rect(-sz*.7,-sz*.35,sz*1.4,sz*.7):[[-sz*.7,-sz*.3],[-sz*.2,-sz*.65],[sz*.7,-sz*.2],[sz*.5,sz*.45],[-sz*.25,sz*.6]]
  q.add(poly(pts),t[k%2],.94,t[2],.75);q.add(poly([pts[0],pts[1],[sz*.05,sz*.03],pts.at(-1)!]),t[1],.45);q.line(`M${xy(...pts[0])}L${xy(...pts[1])}L${xy(...pts[2])}`,t[3],.7,.62)
  if(i===2)q.line(`M${-sz*.45} 0l${sz*.8} ${-sz*.15}m${-sz*.6} ${sz*.25}l${sz*.45} ${-sz*.06}`,t[2],.65,.6)
  if(i===4){linearFibres(q,pts,90,3,t[2],.6);q.line(`M0 ${-sz*.9}l1 ${sz*2}`,t[3],.7,.6)}
  if(i===5){q.line(`M${-sz*.45} ${-sz*.1}q${sz*.4} ${-sz*.5} ${sz*.9} ${-sz*.08}`,t[2],1.4,.5);q.line(`M${-sz*.45} ${sz*.05}q${sz*.4} ${-sz*.42} ${sz*.9} ${-sz*.08}`,t[3],.8,.6)}
  if(i===6)q.add(poly([pts[0],pts[1],[sz*.22,-sz*.15],[-sz*.2,sz*.03]]),'#B7A27F',.5)
  if(i===7)for(let j=0;j<4;j++)q.add(ellipse(-sz*.3+j*sz*.18,-sz*.05+(j%2)*sz*.21,sz*.08,sz*.07),t[2],.8)
 })}
}
const materialDraw=[woodSurface,stoneSurface,brickSurface,earthSurface,sandSurface,grassSurface,snowSurface,waterSurface]
const traceDraw=[footprints,dragMarks,bloodTraces,sootTraces,webs,glassShards,papers,rubbleTraces]
const surfaceCategories=['wood-surface','stone-surface','brick-surface','earth-surface','sand-surface','grass-surface','snow-surface','water-surface']
const traceCategories=['footprint','drag-mark','blood-trace','soot','cobweb','broken-glass','scattered-paper','rubble']
function art(design:SurfacesTracesDesign,index:number):VisualSampleArt{
 const categoryIndex=surfaceCategories.indexOf(design.category),traceIndex=traceCategories.indexOf(design.category),seed=index*137+Math.max(categoryIndex,0)*991+Math.max(traceIndex,0)*1999+17
 const p=new Paint()
 if(categoryIndex>=0){const t=palettes[design.category][index];p.add(poly(rect(0,0,S,S)),t[0]);materialDraw[categoryIndex](p,index,seed,t);return {key:design.key,name:design.name,kind:'material',widthMm:design.widthMm,heightMm:design.heightMm,sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${p.svg()}</svg>`,tags:['原创','无缝平铺地材',design.category,design.era,design.design,'仅视觉材质','不声明地形/水体/高程/滑行语义']}}
 traceDraw[traceIndex](p,index,seed)
 return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${p.svg()}</svg>`,footprintMm:{width:Math.round(design.widthMm*.98),height:Math.round(design.heightMm*.98)},blocksMovement:false,blocksSight:false,renderLayer:'ground',shadowClass:'none',tags:['原创','透明场景痕迹',design.category,design.era,design.design,'不自动创建秘密','需GM明确语义','不改变地形/通行']}
}
export const SURFACES_TRACES_ART:readonly VisualSampleArt[]=freezeJson(SURFACES_TRACES_DESIGNS.map((d,i)=>art(d,i%8)))
export const SURFACES_TRACES_LICENSE_REF='MIT-Sceneweave-Surfaces-Traces-Collection-1'
export const SURFACES_TRACES_LICENSE=`Sceneweave Surfaces and Traces Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original deterministic seamless material tiles and transparent scene trace artwork authored in code for Sceneweave with coding assistance. No third-party image pixels or artwork are included. Materials are decorative pigments only; water, snow and traces create no terrain, elevation, movement, hazard, secrecy or gameplay state without an explicit scene contract.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
