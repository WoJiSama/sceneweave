import type {Anchor,Issue,PointMm,SceneDocument} from '../model/scene.js'
import {openingEndpoints,roomPoints,terrainPoints} from './geometry.js'
import {checkRouteOnValidScene,searchRouteOnValidScene} from './terrain-travel.js'
import {PATH_CHECK_LIMITS} from './path-check-contracts.js'

const collections={vertex:'vertices',room:'rooms',wall:'walls',opening:'openings',prop:'props',region:'regions',note:'notes',terrainArea:'terrainAreas',terrainEdge:'terrainEdges',terrainConnection:'terrainConnections',path:'paths',prefabInstance:'prefabInstances',scatterGroup:'scatterGroups'}as const
const same=(a:PointMm,b:PointMm)=>a.x===b.x&&a.y===b.y
const center=(points:readonly PointMm[]):PointMm=>({x:(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,y:(Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))/2})
export interface ResolvedPathAnchor {point:PointMm;dependencyIds:string[]}
/** Physical anchors do not use audience projection or infer a landing beside a
 * blocking prop. Fractional centres require an explicit integer point instead. */
export function resolvePathAnchor(scene:SceneDocument,floorId:string,input:Anchor):ResolvedPathAnchor {
 const visited=new Set<string>();let anchor=input,position:PointMm|undefined
 while(anchor.type==='entity'){
  const {entityKind:kind,entityId:id}=anchor
  if(visited.has(id))throw Error('通路锚点的注记依赖形成循环。');visited.add(id)
  const entity=Object.hasOwn(scene[collections[kind]],id)?scene[collections[kind]][id]:undefined
  if(!entity||entity.floorId!==floorId)throw Error(`通路锚点必须引用同Floor的现存实体：${id}。`)
  if(kind==='note'){anchor=scene.notes[id].anchor;continue}
  switch(kind){
   case'vertex':{const v=scene.vertices[id];position={x:v.xMm,y:v.yMm};break}
   case'prop':position=scene.props[id].positionMm;break
   case'room':position=center(roomPoints(scene,scene.rooms[id]));break
   case'wall':{const w=scene.walls[id],a=scene.vertices[w.startVertexId],b=scene.vertices[w.endVertexId];position=center([{x:a.xMm,y:a.yMm},{x:b.xMm,y:b.yMm}]);break}
   case'opening':position=center(openingEndpoints(scene,scene.openings[id]));break
   case'region':position=center(scene.regions[id].boundaryMm);break
   case'terrainArea':position=center(terrainPoints(scene.terrainAreas[id]));break
   case'terrainEdge':{const edge=scene.terrainEdges[id],area=scene.terrainAreas[edge.source.areaId],i=area.boundaryMm.findIndex(v=>v.segmentId===edge.source.segmentId);position=center([area.boundaryMm[i].positionMm,area.boundaryMm[(i+1)%area.boundaryMm.length].positionMm]);break}
   case'terrainConnection':{const c=scene.terrainConnections[id];position=center([c.from.positionMm,c.to.positionMm]);break}
   case'path':position=center(scene.paths[id].centerlineMm);break
   case'prefabInstance':position=scene.prefabInstances[id].anchorMm;break
   case'scatterGroup':{const g=scene.scatterGroups[id],member=Object.entries(g.members).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,m])=>m).find(m=>m.propId!==null&&m.state!=='detached');if(member?.propId){visited.add(member.propId);position=scene.props[member.propId]?.positionMm}break}
  }
  break
 }
 if(anchor.type==='point')position=anchor.positionMm
 if(!position||![position.x,position.y].every(Number.isSafeInteger))throw Error('通路锚点没有确切整数毫米位置；请选择明确坐标。')
 const bounds=scene.floors[floorId]?.boundsMm
 if(!bounds||position.x<bounds.x||position.y<bounds.y||position.x>bounds.x+bounds.width||position.y>bounds.y+bounds.height)throw Error('通路端点须位于声明Floor的世界边界内。')
 return{point:{...position},dependencyIds:[...visited]}
}

export interface PathCheckEvidence {id:string;ok:boolean;status:'hint'|'found'|'unproved'|'budget'|'invalid';pointsMm:PointMm[];expandedNodes:number;issues:Issue[];dependencyIds:string[]}
/** Runs only after non-path geometry has passed. Hypothetical door states exist
 * in this detached view only and never mutate the saved/current document. */
export function inspectPathChecks(scene:SceneDocument):{errors:Issue[];checks:PathCheckEvidence[]} {
 const errors:Issue[]=[],checks:PathCheckEvidence[]=[];let remainingNodes=PATH_CHECK_LIMITS.totalNodes
 for(const check of scene.constraints.pathChecks){
  const label=check.name?`通路「${check.name}」`:`通路${check.id}`
  const result:PathCheckEvidence={id:check.id,ok:false,status:'invalid',pointsMm:[],expandedNodes:0,issues:[],dependencyIds:[]}
  const fail=(code:string,message:string)=>{const issue={code,message:`${label}：${message}`,entityId:check.id};errors.push(issue);result.issues.push(issue)}
  try{
   if(scene.mapMode!=='scene')throw Error('区域地图不接受场景级通路硬声明。')
   if(!Object.hasOwn(scene.floors,check.floorId))throw Error('通路声明的Floor不存在。')
   const from=resolvePathAnchor(scene,check.floorId,check.from),to=resolvePathAnchor(scene,check.floorId,check.to)
   result.dependencyIds=[...new Set([check.floorId,...from.dependencyIds,...to.dependencyIds,...check.assumedOpenDoorIds])]
   if(same(from.point,to.point))throw Error('通路起点和终点必须不同。')
   if(check.mode==='structural'&&check.assumedOpenDoorIds.length)throw Error('结构模式已假设有效门可开启，不能再混入当前模式的额外门集合。')
   for(const id of check.assumedOpenDoorIds){const door=Object.hasOwn(scene.openings,id)?scene.openings[id]:undefined;if(!door||door.kind!=='door'||door.floorId!==check.floorId)throw Error(`假设可开启的门必须真实存在且同Floor：${id}。`)}
   const assumed=new Set(check.assumedOpenDoorIds),openings=Object.fromEntries(Object.entries(scene.openings).map(([id,o])=>[id,o.floorId===check.floorId&&o.kind==='door'&&(check.mode==='structural'||assumed.has(id))?{...o,state:'open'as const,locked:false}:o]))
   if(check.mode==='structural')result.dependencyIds=[...new Set([...result.dependencyIds,...Object.values(scene.openings).filter(o=>o.floorId===check.floorId&&o.kind==='door').map(o=>o.id)])]
   const view:SceneDocument={...scene,openings}
   const candidateIssues:Issue[]=[]
   const prove=(pointsMm:PointMm[])=>{const tested=checkRouteOnValidScene(view,{floorId:check.floorId,pointsMm,widthMm:check.clearanceMm});if(tested.ok){result.ok=true;result.status='hint';result.pointsMm=pointsMm}else candidateIssues.push(...tested.issues)}
   if(check.routeHintMm){const hint=check.routeHintMm.map(p=>({...p}));hint[0]=from.point;hint[hint.length-1]=to.point;prove(hint)}
   // A valid direct band already proves existence, irrespective of movement
   // cost. Do not spend a search budget optimizing a sufficient witness.
   if(!result.ok)prove([from.point,to.point])
   if(!result.ok){
    if(remainingNodes<=0){result.status='budget';fail('PATH_CHECK_BUDGET','通路检查达到本次总搜索预算，未能证明可通；未宣称数学上无路。')}
    else{const searched=searchRouteOnValidScene(view,{floorId:check.floorId,from:from.point,to:to.point,widthMm:check.clearanceMm,gridMm:Math.min(1000,Math.max(100,Math.floor(check.clearanceMm/2))),maxNodes:Math.min(PATH_CHECK_LIMITS.nodesPerCheck,remainingNodes)});remainingNodes-=searched.expandedNodes;result.expandedNodes=searched.expandedNodes
     if(searched.ok){result.ok=true;result.status='found';result.pointsMm=searched.points}
     else{result.status=searched.status==='budget'?'budget':searched.status==='invalid'?'invalid':'unproved';fail(result.status==='budget'?'PATH_CHECK_BUDGET':result.status==='invalid'?'INVALID_PATH_CHECK':'PATH_CHECK_UNPROVED',`未能证明声明的${check.clearanceMm} mm通路可通：${searched.issues.map(v=>v.message).join('；')}`)}
    }
   }
   if(!result.ok){
    const seen=new Set<string>()
    for(const issue of candidateIssues){const key=issue.code+'|'+issue.entityId;if(seen.has(key))continue;seen.add(key)
     const diagnostic:Issue={...issue,message:`${label}的候选路线检查：${issue.entityId?`${issue.entityId}：`:''}${issue.message}；这不证明其他路线均受此障碍阻挡。`}
     result.issues.push(diagnostic);errors.push(diagnostic)
    }
   }
  }catch(cause){fail('INVALID_PATH_CHECK',cause instanceof Error?cause.message:String(cause))}
  checks.push(result)
 }
 return{errors,checks}
}
