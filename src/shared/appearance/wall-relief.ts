import clipping from 'polygon-clipping'
import type { PointMm, MaterialPaint } from '../model/scene.js'
import type { WallGeometry } from '../geometry/wall-paint-geometry.js'
import { WALL_RELIEF_ADDITION_LIMIT, WALL_RELIEF_LIMIT_MM, wallSupportsRelief } from './wall-edge-profile.js'
import { assertWallReliefBudget, wallReliefJambReturns, wallReliefOpeningGuard } from './wall-relief-budget.js'
export type { WallGeometry } from '../geometry/wall-paint-geometry.js'

/** Paint-only fixed-v1 plan. Call only on an audience-owned complete wall network. */
type XY = [number, number]
const EPS = 1e-6
const at = (a: PointMm,b: PointMm,t: number): PointMm => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})
const ring = (ps: PointMm[]): XY[] => [...ps.map(p=>[p.x,p.y] as XY),[ps[0].x,ps[0].y]]
const mod = (v:number,n:number) => ((v%n)+n)%n
// Same fixed source's cell divisions; no wall identity, frame, crop or hidden inputs.
function random(seed:number,index:number){let v=Math.imul(seed^Math.imul(index+1,0x9e3779b1),0x45d9f3b);v^=v>>>16;return (Math.imul(v,0x45d9f3b)>>>0)/0x100000000}
function local(p:PointMm,paint:MaterialPaint){const a=-paint.rotationDeg*Math.PI/180,x=p.x-paint.originMm.x,y=p.y-paint.originMm.y;return {x:(x*Math.cos(a)-y*Math.sin(a))*512/paint.tileSizeMm.width,y:(x*Math.sin(a)+y*Math.cos(a))*512/paint.tileSizeMm.height}}
function rowCells(row:number){const r=mod(row,6),a=137+random(4134,r)*36,b=159+random(4146,r)*29;return {shift:r%2?75:-34,widths:[a,b,512-a-b]}}
function cellCuts(a:PointMm,b:PointMm,paint:MaterialPaint):number[]{
  const p=local(a,paint),q=local(b,paint),cuts=[0,1],dy=q.y-p.y,dx=q.x-p.x,h=512/6
  if(Math.abs(dy)/h>8192||Math.abs(dx)/128>8192)throw Error('块石外缘分段过密，请增大材质尺寸。')
  if(Math.abs(dy)>EPS)for(let r=Math.floor(Math.min(p.y,q.y)/h)+1;r<=Math.floor(Math.max(p.y,q.y)/h);r++)cuts.push((r*h-p.y)/dy)
  cuts.sort((a,b)=>a-b)
  const rows=[...cuts]
  if(Math.abs(dx)>EPS)for(let i=0;i<rows.length-1;i++){
    const t=(rows[i]+rows[i+1])/2,row=Math.floor((p.y+dy*t)/h),{shift,widths}=rowCells(row)
    const from=p.x+dx*rows[i],to=p.x+dx*rows[i+1],j0=Math.floor((Math.min(from,to)-shift)/512)-1,j1=Math.ceil((Math.max(from,to)-shift)/512)+1
    for(let j=j0;j<=j1;j++){let x=shift+j*512;for(const w of widths){const u=(x-p.x)/dx;if(u>rows[i]+EPS&&u<rows[i+1]-EPS)cuts.push(u);x+=w}}
  }
  if(cuts.length>8192)throw Error('块石外缘分段超过有限预算。')
  return [...new Set(cuts.map(v=>Math.max(0,Math.min(1,v))))].sort((a,b)=>a-b)
}
function inside(p:PointMm,ps:PointMm[]){let yes=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes}return yes}
function sections(a:PointMm,b:PointMm,geometry:WallGeometry[]){
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,len=Math.sqrt(l2),cuts=[0,1]
  for(const g of geometry)for(const ps of g.polygons)for(const p of ps){
    const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2
    if(t>EPS&&t<1-EPS&&Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)<.01*len)cuts.push(t)
  }
  cuts.sort((a,b)=>a-b)
  const result:{a:PointMm;b:PointMm;owner:number;key:string}[]=[]
  for(let i=0;i<cuts.length-1;i++){
    if((cuts[i+1]-cuts[i])*len<.01)continue
    const m=at(a,b,(cuts[i]+cuts[i+1])/2)
    let nx=dy/len,ny=-dx/len
    if(geometry.some(g=>g.polygons.some(p=>inside({x:m.x+nx*.01,y:m.y+ny*.01},p)))){nx=-nx;ny=-ny}
    const owner=geometry.findLastIndex(g=>g.polygons.some(p=>inside({x:m.x-nx*.02,y:m.y-ny*.02},p)))
    if(owner<0)continue
    const w=geometry[owner].wall,key=JSON.stringify([w.edgeProfile,w.style]),previous=result.at(-1)
    if(previous&&previous.key===key&&Math.hypot(previous.b.x-at(a,b,cuts[i]).x,previous.b.y-at(a,b,cuts[i]).y)<.01)previous.b=at(a,b,cuts[i+1])
    else result.push({a:at(a,b,cuts[i]),b:at(a,b,cuts[i+1]),owner,key})
  }
  return result
}
export function planWallRelief(geometry:WallGeometry[]):{geometry:WallGeometry[];additions:number;maxReachMm:number}{
  assertWallReliefBudget(geometry)
  const result=geometry.map(g=>({wall:g.wall,polygons:g.polygons.map(p=>p.map(q=>({...q})))}))
  const physical=geometry.flatMap(g=>g.polygons), polys=physical.map(p=>[ring(p)])
  if(!polys.length)return {geometry:result,additions:0,maxReachMm:WALL_RELIEF_LIMIT_MM}
  const union=clipping.union(polys[0],...polys.slice(1))
  const guards=geometry.flatMap(g=>g.wall.openings.map(o=>[ring(wallReliefOpeningGuard(o,g.wall.thicknessMm+WALL_RELIEF_LIMIT_MM*4))]))
  let additions=0
  const append=(owner:number,p:PointMm[])=>{
    const parts=guards.length?clipping.difference([ring(p)],...guards):[[ring(p)]]
    for(const polygon of parts)if(polygon.length===1){const ps=polygon[0].slice(0,-1).map(([x,y])=>({x,y}));if(ps.length>=3){result[owner].polygons.push(ps);additions++;if(additions>WALL_RELIEF_ADDITION_LIMIT)throw Error('块石外缘超过有限绘制预算。')}}
  }
  for(const polygon of union)for(const boundary of polygon)for(let i=0;i<boundary.length-1;i++){
    const ba={x:boundary[i][0],y:boundary[i][1]},bb={x:boundary[i+1][0],y:boundary[i+1][1]}
    for(const {a,b,owner} of sections(ba,bb,geometry)){
    const len=Math.hypot(b.x-a.x,b.y-a.y)
    if(len<2)continue
    let nx=(b.y-a.y)/len,ny=-(b.x-a.x)/len;const m=at(a,b,.5)
    if(physical.some(p=>inside({x:m.x+nx*.01,y:m.y+ny*.01},p))){nx=-nx;ny=-ny}
    if(owner<0||!wallSupportsRelief(geometry[owner].wall))continue
    const paint=geometry[owner].wall.style!.base,cuts=cellCuts(a,b,paint)
    for(let k=0;k<cuts.length-1;k++){
      const t0=cuts[k],t1=cuts[k+1],span=(t1-t0)*len
      if(span<30)continue
      const mid=local(at(a,b,(t0+t1)/2),paint),r=Math.floor(mid.y/(512/6)),cx=Math.floor(mid.x/60)
      const depth=16+random(4093+mod(r,6)*197,cx)*29,chip=Math.min(12,span*.12),gap=3
      const p=at(a,b,t0+gap/len),q=at(a,b,t1-gap/len),u={x:(b.x-a.x)/len,y:(b.y-a.y)/len}
      // A shallow beveled stone lip overlaps the existing body by 1mm.
      append(owner,[{x:p.x-nx,y:p.y-ny},{x:q.x-nx,y:q.y-ny},{x:q.x+nx*(depth-chip),y:q.y+ny*(depth-chip)},{x:q.x-u.x*chip+nx*depth,y:q.y-u.y*chip+ny*depth},{x:p.x+u.x*chip+nx*depth,y:p.y+u.y*chip+ny*depth},{x:p.x+nx*(depth-chip),y:p.y+ny*(depth-chip)}])
    }
  }
  }
  // Squared stone returns share the opening's exact interval; frames cover the inner face.
  for(let i=0;i<geometry.length;i++){
    const w=geometry[i].wall;if(!wallSupportsRelief(w))continue
    for(const polygon of wallReliefJambReturns(w))append(i,polygon)
  }
  return {geometry:result,additions,maxReachMm:WALL_RELIEF_LIMIT_MM}
}
