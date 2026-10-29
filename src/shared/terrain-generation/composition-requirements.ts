import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { SceneDocument, PointMm, Path } from '../model/scene.js'
import type { TerrainRequirement } from './composition-contracts.js'
import { corridor, pathPolygon, polygonsOverlap, propFootprint, terrainPoints } from '../geometry/geometry.js'
import { wallMovementPolygons } from '../geometry/doorway-clearance.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { resolveGenerationEntity, resolveGenerationTarget } from './integrity.js'

const ring = (points: PointMm[]): MultiPolygon => [[points.map(p => [p.x, p.y])]]
const box = (b: { x: number; y: number; width: number; height: number }): MultiPolygon => ring([{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}])
const union = (a: MultiPolygon,b: MultiPolygon): MultiPolygon => !a.length ? b : !b.length ? a : polygonClipping.union(a,b)
const difference = (a: MultiPolygon,b: MultiPolygon): MultiPolygon => !a.length ? [] : !b.length ? a : polygonClipping.difference(a,b)
export const effectivePolygonArea = (polygons: MultiPolygon): number => polygons.reduce((total,poly) => total + poly.reduce((sum,r,i) => {const area=Math.abs(r.reduce((s,p,j)=>{const q=r[(j+1)%r.length];return s+p[0]*q[1]-p[1]*q[0]},0))/2;return sum+(i===0?area:-area)},0),0)

/** Highest-priority actual physical surfaces, clipped to the composition. Holes stay holes. */
export function effectiveCompositionSurfaces(document: SceneDocument,compositionId: string): { land:MultiPolygon;water:MultiPolygon } {
  if(document.generation?.version!==5)throw new Error('真实组合检查需要 generation5。')
  const composition=document.generation.compositions[compositionId]
  if(!composition)throw new Error('组合要求没有所属组合。')
  const bounds=box(composition.boundsMm),recipe=document.generation.legacy.recipes[composition.recipeRef.id]
  const waterMaterials=new Set(recipe?.materials.filter(m=>m.role==='water').map(m=>m.ref.id)??[])
  let covered:MultiPolygon=[],land:MultiPolygon=[],water:MultiPolygon=[]
  const areas=Object.values(document.terrainAreas).filter(a=>a.floorId===composition.floorId).sort((a,b)=>b.coveragePriority-a.coveragePriority||(a.id<b.id?-1:1))
  for(const area of areas){
    const clipped=polygonClipping.intersection(ring(terrainPoints(area)),bounds),effective=difference(clipped,covered)
    const isWater=!!area.surfaceStyle && waterMaterials.has(area.surfaceStyle.base.materialRef.id)
    if(isWater)water=union(water,effective);else land=union(land,effective)
    covered=union(covered,clipped)
  }
  // The real Floor remains valid land where no generated surface covers it.
  land=union(land,difference(bounds,covered))
  water=difference(water,land)
  return {land,water}
}

export interface TerrainRequirementEvaluation { state:'passed'|'failed'|'unchecked';issues:{code:string;message:string;entityId:string|null}[] }
/** Match the physical movement geometry; audience and appearance do not remove blockers. */
function channelObstacle(document:SceneDocument,floorId:string,polygon:PointMm[]):string|null {
  for(const prop of Object.values(document.props))if(prop.floorId===floorId&&prop.blocksMovement&&polygonsOverlap(polygon,propFootprint(prop)))return prop.id
  for(const region of Object.values(document.regions))if(region.floorId===floorId&&region.blocksMovement&&polygonsOverlap(polygon,region.boundaryMm))return region.id
  for(const wall of wallMovementPolygons(document,true))if(wall.floorId===floorId&&polygonsOverlap(polygon,wall.polygon))return wall.entityId
  for(const connection of Object.values(document.terrainConnections))if(connection.floorId===floorId&&connection.blocksMovement
    &&polygonsOverlap(polygon,corridor(connection.from.positionMm,connection.to.positionMm,connection.widthMm)))return connection.id
  return null
}
export function evaluateTerrainRequirement(document: SceneDocument,requirement:TerrainRequirement): TerrainRequirementEvaluation {
  const fail=(code:string,message:string):TerrainRequirementEvaluation=>({state:'failed',issues:[{code,message,entityId:requirement.id}]})
  if(document.generation?.version!==5)return fail('COMPOSITION_REQUIRED','需要完整组合工程。')
  const composition=document.generation.compositions[requirement.compositionId]
  if(!composition)return fail('COMPOSITION_MISSING','要求的所属组合不存在。')
  try{
    if(requirement.kind==='legacyConstraint'){
      const constraint=document.generation.legacy.constraints[requirement.constraintId]
      if(!constraint||constraint.strength!=='hard'||constraint.floorId!==composition.floorId)return fail('LEGACY_REQUIREMENT','必须引用同 Floor 的真实既有硬约束。')
      // Explicit preservation hashes contain their complete predicate. Recompute
      // the current target instead of accepting any stored passed receipt.
      if(constraint.kind==='preserveGeometry'||constraint.kind==='preserveEntity'){
        const value=constraint.kind==='preserveGeometry'?resolveGenerationTarget(document,{...constraint.target,fieldGroup:'geometry'}):resolveGenerationEntity(document,constraint.target)
        const expected=constraint.kind==='preserveGeometry'?constraint.geometryHash:constraint.contentHash
        return value&&sha256Text(canonicalJson(value))===expected?{state:'passed',issues:[]}:fail('LEGACY_PRESERVATION','既有硬约束的实际目标已删除或内容已变化。')
      }
      const checks=Object.values(document.generation.legacy.checks).filter(c=>c.constraintId===constraint.id)
      if(constraint.kind!=='route'||!checks.length||checks.some(c=>c.algorithmVersion!==1||(c.algorithmId!=='terrain-route'&&c.algorithmId!=='terrain-route-ground'))){
        return fail('LEGACY_CHECK_UNSUPPORTED','既有硬约束没有可完整重算的已知检查器，不能采用已存通过回执。')
      }
      const checked=checkTerrainRoute(document,{floorId:constraint.floorId,pointsMm:constraint.pointsMm,widthMm:constraint.minWidthMm})
      if(!checked.ok)return {state:'failed',issues:checked.issues.map(issue=>({code:issue.code,message:issue.message,entityId:issue.entityId??constraint.id}))}
      if(checks.some(c=>c.algorithmId==='terrain-route-ground')&&checked.supportRefs.some(ref=>ref.id==='terrain-shallow'))return fail('LEGACY_ROUTE_GROUND','既有路线要求只走地面，当前完整净宽带进入浅水。')
      return {state:'passed',issues:[]}
    }
    const surfaces=effectiveCompositionSurfaces(document,composition.id),b=composition.boundsMm
    if(requirement.kind==='channelWidth'){
      const polygon=pathPolygon({centerlineMm:requirement.pointsMm,widthMm:requirement.minWidthMm} as Path)
      if(polygon.length<3)return fail('CHANNEL_GEOMETRY','水道走廊退化或回折。')
      const corridor=ring(polygon),outside=difference(corridor,surfaces.water)
      // Complete square caps and miter/bevel joins, not sampled center points.
      if(effectivePolygonArea(outside)>0.0001)return fail('CHANNEL_WIDTH','完整水道走廊（含端帽与转角）未达到要求净宽。')
      const blocking=channelObstacle(document,composition.floorId,polygon)
      if(blocking)return {state:'failed',issues:[{code:'CHANNEL_OBSTACLE',message:'完整水道净宽带被物件真实占地、实际墙体/门、阻挡区域或连接侵入。',entityId:blocking}]}
      return {state:'passed',issues:[]}
    }
    const components=surfaces[requirement.surface].filter(poly=>!requirement.excludeBoundaryTouching||!poly[0].some(([x,y])=>x<=b.x||y<=b.y||x>=b.x+b.width||y>=b.y+b.height))
    if(requirement.kind==='componentCount'&&components.length!==requirement.expected)return fail('COMPONENT_COUNT',`真实${requirement.surface==='land'?'陆地':'水域'}分量为${components.length}，要求${requirement.expected}。`)
    if(requirement.kind==='minimumComponentArea'&&(!components.length||components.some(poly=>effectivePolygonArea([poly])<requirement.minAreaMm2)))return fail('COMPONENT_AREA','至少一个真实有效分量面积不足。')
    return {state:'passed',issues:[]}
  }catch(error){return fail('REQUIREMENT_GEOMETRY',error instanceof Error?error.message:'无法完整核验实际几何。')}
}
