import { z } from 'zod'
import type { CompositionCommand, CompositionContent } from '../model/appearance.js'
import type { PointMm, TerrainArea } from '../model/scene.js'
import type { VisualBoundary, VisualEdgeLook } from './types.js'
import { visualBase } from './base.js'
import { sampleVisualBoundary, signedVisualArea } from './geometry.js'
import { corridor, pathPolygon, polygonsOverlap, terrainPoints } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { definitionPresentation, presentationBounds, propPresentation } from '../appearance/presentation.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'

export const terrainDressingInputSchema = z.object({ sceneId: z.string().min(1).max(256), floorId: z.string().min(1).max(256), seed: z.string().min(1).max(128) }).strict()
export type TerrainDressingInput = z.infer<typeof terrainDressingInputSchema>
export interface TerrainDressingReport { boundaryIds: string[]; groupIds: string[]; preservedIds: string[]; notes: string[] }
const rectangle = (left:number,top:number,right:number,bottom:number):PointMm[] => [{x:Math.round(left),y:Math.round(top)},{x:Math.round(right),y:Math.round(top)},{x:Math.round(right),y:Math.round(bottom)},{x:Math.round(left),y:Math.round(bottom)}]
const extent = (points:PointMm[]) => ({left:Math.min(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))})

/** A finite ordinary-command recipe. It never replaces a saved generator result,
 * deletes existing props, or creates a fresh group to bypass authored slots. */
export function planTerrainDressing(content:Pick<CompositionContent,'document'|'appearance'>,raw:unknown):{commands:CompositionCommand[];input:TerrainDressingInput;report:TerrainDressingReport} {
  const input=terrainDressingInputSchema.parse(raw),scene=content.document,floor=scene.floors[input.floorId],visual=visualBase(scene)
  if(scene.sceneId!==input.sceneId||!floor||scene.schemaVersion<3||scene.mapMode!=='scene'||!visual||content.appearance.version!==2)throw new Error('地形层次与布景需要匹配的完整v3/v4场景和当前Floor。')
  const definitions=Object.values(scene.propDefinitions).filter(def=>def.version===1&&def.catalogId.startsWith('prop.sceneweave.terrain-dressing.')).sort((a,b)=>a.catalogId.localeCompare(b.catalogId))
  if(definitions.length!==6)throw new Error('地形布景须先在同一候选采用六个固定树岩来源。')
  let paintLeft=0,paintRight=0,paintTop=0,paintBottom=0
  for(const def of definitions){
    const presentation=definitionPresentation(content.appearance,{id:def.id,version:def.version})
    if(presentation?.mode!=='nearSide')throw new Error(`布景固定根锚缺失：${def.id}`)
    const b=presentationBounds({visualBoundsMm:def.defaultVisualBoundsMm},presentation)
    paintLeft=Math.max(paintLeft,-b.x);paintRight=Math.max(paintRight,b.x+b.width);paintTop=Math.max(paintTop,-b.y);paintBottom=Math.max(paintBottom,b.y+b.height)
  }
  const commands:CompositionCommand[]=[],report:TerrainDressingReport={boundaryIds:[],groupIds:[],preservedIds:[],notes:[]},visibility=createPublicVisibility(scene)
  const layers=Object.values(scene.userLayers).filter(layer=>layer.floorId===floor.id&&!layer.editLocked).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))
  if(!layers.length)throw new Error('当前Floor没有可写入的用户图层。')
  const ground=layers[0].id,propsLayer=layers.find(layer=>layer.id.includes('props'))?.id??layers.at(-1)!.id
  const locked=(id:string)=>{const layer=scene.userLayers[scene.entityLayers[id]];const entity=scene.terrainAreas[id]??scene.scatterGroups[id];return !!entity?.editLocked||!!layer?.editLocked}
  const water=(area:TerrainArea)=>{
    const material=area.surfaceStyle&&scene.materials[area.surfaceStyle.base.materialRef.id]
    return !!material&&/(water|shallows|海水|浅水|深水|湖水)/i.test([material.name,...material.tags].join(' '))
  }
  const areas=Object.values(scene.terrainAreas).filter(area=>area.floorId===floor.id&&visibility.terrainArea(area.id)),land=areas.filter(area=>!water(area)&&!area.blocksMovement&&area.groundElevationMm>0)
  if(!land.length)throw new Error('当前Floor没有可布景的公开陆地。')
  const token=(purpose:string,id:string)=>`terrain-dressing-v1-${purpose}-${sha256Text(canonicalJson([scene.sceneId,floor.id,id])).slice(0,16)}`
  const seed=(purpose:string)=>{
    const value=`terrain-dressing-v1/${input.seed}/${purpose}`
    return value.length<=128?value:`terrain-dressing-v1/${sha256Text(canonicalJson([input.seed,purpose]))}`
  }
  for(const area of land){
    if(locked(area.id)){report.preservedIds.push(area.id);continue}
    const points=terrainPoints(area)
    let boundary=Object.values(visual.boundaries).find(row=>row.visibility==='public'&&row.binding.kind==='terrain'&&row.binding.sides.some(side=>side.areaId===area.id))
    if(!boundary){
      const id=token('boundary',area.id)
      if(points.length>32||points.some((p,i)=>Math.hypot(points[(i+1)%points.length].x-p.x,points[(i+1)%points.length].y-p.y)>20000)){report.notes.push(`${area.id}轮廓超出有限直线边带范围，保留原边缘。`);continue}
      boundary={id,floorId:floor.id,layerId:ground,visibility:'public',editLocked:false,closed:true,segments:points.map((p,i)=>({id:`${id}-s${i}`,start:{...p},control1:{...p},control2:{...points[(i+1)%points.length]},end:{...points[(i+1)%points.length]}})),sampleSpacingMm:20000,toleranceMm:1000,binding:{kind:'terrain',sides:[{areaId:area.id,startPointId:area.boundaryMm[0].id,endPointId:area.boundaryMm[0].id,reverse:false}]}}
      if(canonicalJson(sampleVisualBoundary(boundary).points)!==canonicalJson(points))throw new Error('新边带与保存物理轮廓不一致。')
      commands.push({type:'upsertVisualBoundary',boundary})
    }
    if(boundary.editLocked||scene.userLayers[boundary.layerId]?.editLocked){report.preservedIds.push(boundary.id);continue}
    report.boundaryIds.push(boundary.id)
    const shoreline=area.groundElevationMm===Math.min(...land.map(value=>value.groundElevationMm))
    for(const kind of (shoreline?['shore','cliff']:['cliff','grass']) as VisualEdgeLook['kind'][]){
      const previous=Object.values(visual.edgeLooks).find(look=>look.boundaryId===boundary!.id&&look.kind===kind)
      if(previous&&(previous.editLocked||scene.userLayers[previous.layerId]?.editLocked)){report.preservedIds.push(previous.id);continue}
      // Saved materialized representations own their purpose; never add a
      // duplicate legacy look beside them or reinterpret frozen transitions.
      const legacy=scene.visual?.version===2?scene.visual:scene.visual?.version===3?scene.visual.base:null
      if(legacy?.version===2&&Object.values(legacy.materializedEdges).some(edge=>edge.boundaryId===boundary!.id&&edge.kind===kind)){report.notes.push(`${boundary.id}的${kind}已物化，保持原表示。`);continue}
      if(scene.visual?.version===3&&Object.values(scene.visual.transitions).some(edge=>edge.enabled&&edge.boundaryId===boundary!.id&&edge.kind===kind)){report.notes.push(`${boundary.id}的${kind}已有固定过渡，保持原表示。`);continue}
      const id=previous?.id??token(kind,boundary.id),look:VisualEdgeLook={...(previous??{id,floorId:floor.id,layerId:ground,visibility:'public',editLocked:false,boundaryId:boundary.id,side:'right',seed:seed(kind),enabled:true}),kind,
        widthMm:kind==='shore'?650:kind==='cliff'?800:420,color:kind==='shore'?'#7FAFA5':kind==='cliff'?'#786D58':'#6E8A5C',accentColor:kind==='shore'?'#DCE7CF':kind==='cliff'?'#CDBE9C':'#B8C58C',opacity:kind==='shore'?.55:.88,intensity:kind==='shore'?.4:.8,repeatMm:kind==='shore'?1400:kind==='cliff'?430:360}
      if(kind==='grass'&&!previous)look.side='left'
      if(!previous||canonicalJson(previous)!==canonicalJson(look))commands.push({type:'upsertVisualEdgeLook',edgeLook:look})
    }
  }
  const sorted=[...land].sort((a,b)=>Math.abs(signedVisualArea(terrainPoints(b)))-Math.abs(signedVisualArea(terrainPoints(a))))
  const selected=sorted.slice(0,3) // Separate supports retain separate persistent groups.
  const reserved:PointMm[][]=[]
  for(const c of Object.values(scene.terrainConnections))if(c.floorId===floor.id&&c.visibility==='public'&&visibility.surface(c.from.surfaceRef)&&visibility.surface(c.to.surfaceRef)&&(!c.openingId||!scene.openings[c.openingId]?.secret||scene.openings[c.openingId]?.revealed))reserved.push(corridor(c.from.positionMm,c.to.positionMm,c.widthMm))
  for(const path of Object.values(scene.paths))if(path.floorId===floor.id&&visibility.path(path.id))reserved.push(pathPolygon(path))
  for(const room of Object.values(scene.rooms))if(room.floorId===floor.id&&visibility.room(room.id))reserved.push(room.boundaryVertexIds.map(id=>({x:scene.vertices[id].xMm,y:scene.vertices[id].yMm})))
  for(const constraint of Object.values(getLegacyGeneration(scene)?.constraints??{}))if(constraint.floorId===floor.id&&constraint.visibility==='public'&&constraint.kind==='activityArea'){
    const b=extent(constraint.boundaryMm),clearance=constraint.clearanceMm
    reserved.push(rectangle(b.left-clearance,b.top-clearance,b.right+clearance,b.bottom+clearance))
  }
  for(const area of selected){
    if(locked(area.id)){report.preservedIds.push(area.id);continue}
    const id=token('grove',area.id),existing=scene.scatterGroups[id]
    if(existing){
      if(existing.domain.kind!=='area'||existing.domain.areaId!==area.id)throw new Error('布景组身份已被其他内容使用。')
      if(locked(id)){report.preservedIds.push(id);continue}
    }else{
      const palette=definitions.map((def,index)=>({key:`dressing-${index}`,propDefinitionRef:{id:def.id,version:def.version},weight:def.defaultRenderLayer==='canopy'?1:2}))
      commands.push({type:'createScatter',id,floorId:floor.id,layerId:propsLayer,visibility:'public',domain:{kind:'area',areaId:area.id},palette,seed:seed(area.id),algorithmVersion:'scatter-cell-v2',gridOriginMm:{x:floor.boundsMm.x,y:floor.boundsMm.y},cellSizeMm:Math.max(2400,Math.round(Math.min(floor.boundsMm.width,floor.boundsMm.height)/800)*100),densityFactor:.55,minDistanceMm:850,rotationRangeDeg:{min:0,max:0}})
    }
    // Recompute required clearances for current roads/activity areas on repeat,
    // including larger authored palette/member appearances. Existing exclusions
    // are append-only here: user edits and deletion suppression stay intact.
    let left=paintLeft,right=paintRight,top=paintTop,bottom=paintBottom
    const expandPaint=(bounds:{x:number;y:number;width:number;height:number})=>{left=Math.max(left,-bounds.x);right=Math.max(right,bounds.x+bounds.width);top=Math.max(top,-bounds.y);bottom=Math.max(bottom,bounds.y+bounds.height)}
    if(existing){
      for(const slot of existing.palette){const def=scene.propDefinitions[slot.propDefinitionRef.id];expandPaint(presentationBounds({visualBoundsMm:def.defaultVisualBoundsMm},definitionPresentation(content.appearance,slot.propDefinitionRef)))}
      for(const member of Object.values(existing.members)){const prop=member.propId&&scene.props[member.propId];if(prop&&visibility.prop(prop))expandPaint(presentationBounds(prop,propPresentation(content.appearance,prop.id)))}
    }
    const b=floor.boundsMm,areaRing=terrainPoints(area),expanded=reserved.map(points=>{const r=extent(points);return rectangle(r.left-right,r.top-bottom,r.right+left,r.bottom+top)})
    expanded.push(rectangle(b.x,b.y,b.x+left,b.y+b.height),rectangle(b.x+b.width-right,b.y,b.x+b.width,b.y+b.height),rectangle(b.x,b.y,b.x+b.width,b.y+top),rectangle(b.x,b.y+b.height-bottom,b.x+b.width,b.y+b.height))
    const added=new Set<string>()
    for(const ring of expanded.filter(ring=>polygonsOverlap(ring,areaRing))){
      const exclusionId=`${id}-clear-${sha256Text(canonicalJson(ring)).slice(0,16)}`
      if(added.has(exclusionId))continue
      added.add(exclusionId)
      const previous=existing?.exclusions.find(exclusion=>exclusion.id===exclusionId)
      if(previous){if(canonicalJson(previous.boundaryMm)!==canonicalJson(ring))throw new Error('既有布景净空记录已人工改变；请明确处理该排除区后再整理。');continue}
      commands.push({type:'upsertScatterExclusion',groupId:id,exclusion:{id:exclusionId,boundaryMm:ring,reason:'entrance'}})
    }
    commands.push({type:'regenerateScatter',id});report.groupIds.push(id)
  }
  if(!commands.length)throw new Error('没有可预览的未锁定地形整理；已保留现有内容。')
  report.notes.push('既有物件保持；已有布景组保留配置、人工/删除/退出记录，只更新允许的受管成员。')
  return {commands:cloneJson(commands),input,report}
}
