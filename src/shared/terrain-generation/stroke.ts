import type { PointMm } from '../model/scene.js'
import { pathPolygon } from '../geometry/geometry.js'
import { assertSimpleVisualPolyline } from '../visual/geometry.js'

/** Quantized canonical world-space corners, independent of duplicate/collinear device samples. */
export function normalizeTerrainStroke(points: readonly PointMm[]): PointMm[] {
  const simplified:PointMm[]=[]
  for(const p of points){
    const next={x:Math.round(p.x/10)*10,y:Math.round(p.y/10)*10},last=simplified.at(-1)
    if(last&&next.x===last.x&&next.y===last.y)continue
    simplified.push(next)
    while(simplified.length>2){
      const [a,b,c]=simplified.slice(-3),cross=BigInt(b.x-a.x)*BigInt(c.y-b.y)-BigInt(b.y-a.y)*BigInt(c.x-b.x)
      if(cross!==0n||(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)<0)break
      simplified.splice(simplified.length-2,1)
    }
  }
  return simplified
}

/** The same finite brush footprint is checked on preview, adoption and cold import. */
export function terrainStrokePolygon(stroke:{pointsMm:PointMm[];radiusMm:number}):PointMm[]{
  if(stroke.pointsMm.length===1)return Array.from({length:16},(_,index)=>({x:Math.round(stroke.pointsMm[0].x+Math.cos(index*Math.PI/8)*stroke.radiusMm),y:Math.round(stroke.pointsMm[0].y+Math.sin(index*Math.PI/8)*stroke.radiusMm)}))
  const polygon=pathPolygon({centerlineMm:stroke.pointsMm,widthMm:stroke.radiusMm*2} as Parameters<typeof pathPolygon>[0]).map(p=>({x:Math.round(p.x),y:Math.round(p.y)}))
  assertSimpleVisualPolyline(polygon,true)
  return polygon
}
