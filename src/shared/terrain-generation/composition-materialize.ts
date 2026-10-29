import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { SceneDocument, PointMm, SurfaceStyle } from '../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS } from '../model/scene.js'
import { captureJson } from '../validation/json.js'
import { segmentCuts } from '../geometry/geometry.js'
import { signedVisualArea } from '../visual/geometry.js'
import { createEmptyGeneration5, type TerrainRequirement, type TerrainComposition, type TerrainDependency } from './composition-contracts.js'
import { planTerrainComposition, extractCompositionFieldLevel, recomputeCompositionThreshold, type TerrainCompositionInput, type TerrainCompositionPlan } from './composition-field.js'
import { emptyTerrainDocument } from './compose.js'
import { compositionInputHash, dependencyInputHash, thresholdInputHash, terrainRequirementInputHash } from './composition-integrity.js'
import { evaluateTerrainRequirement } from './composition-requirements.js'

export function emptyCompositionDocument(input:SceneDocument):SceneDocument {
 const legacy=input.schemaVersion===2?emptyTerrainDocument(input):captureJson(input)
 if(legacy.schemaVersion!==3||legacy.visual?.version!==2||!legacy.generation||legacy.generation.version===5)throw new Error('组合升级需要完整v3工程。')
 return {...legacy,schemaVersion:4,generation:createEmptyGeneration5(legacy.generation),visual:{version:3,base:legacy.visual,transitions:{}}}
}
const ring=(points:PointMm[]):MultiPolygon=>[[points.map(p=>[p.x,p.y])]]
/** Full physical output. Holes use higher-priority real water; no implicit filled lake. */
export function materializeTerrainComposition(base:SceneDocument,input:TerrainCompositionInput,requirements:TerrainRequirement[],title:string,profile:'plain'|'tidal'='plain'):{document:SceneDocument;plan:TerrainCompositionPlan} {
 if(base.schemaVersion!==2||LAYER_ENTITY_COLLECTIONS.some(key=>Object.keys(base[key]).length))throw new Error('新组合必须从独立同源完整空白开始。')
 const plan=planTerrainComposition(input),document=emptyCompositionDocument(base)
 const levels=[...new Set(input.members.filter(m=>m.field==='elevation'&&m.operation!=='subtract').map(m=>input.features[m.featureId].elevationMm))]
 levels.sort((a,b)=>a-b)
 if(levels.some(level=>level<=input.baseElevationMm))throw new Error('高地分带必须高于低地；负向高程需通过明确湖盆/河谷物化。')
 const elevatedLevel=levels[0]??input.baseElevationMm
 if(document.generation?.version!==5)throw new Error('需要generation5。')
 const system=document.generation,b=input.boundsMm,compositionId='t9-composition',floorId='visual-floor',layerId='visual-layer-ground'
 if(JSON.stringify(document.exportBoundsMm)!==JSON.stringify(b))throw new Error('组合范围须与独立空白一致。')
 document.title=title
 const material=(role:'water'|'land'|'high'|'forest')=>{
  const suffix={water:'shallows',land:'strata',high:'moss',forest:'moss'}[role],key=`refined-material-island-material-${suffix}`
  if(!document.materials[key])throw new Error(`组合缺少确切固定材质${key}。`)
  return document.materials[key]
 }
 const paint=(role:'water'|'land'|'high'|'forest'):SurfaceStyle=>{const m=material(role);return {base:{materialRef:{id:m.id,version:m.version},tileSizeMm:captureJson(m.defaultTileSizeMm),rotationDeg:0,alignment:'world',originMm:{x:0,y:0},tint:null,opacity:1},overlays:[]}}
 const add=(id:string,points:PointMm[],priority:number,elevation:number,role:'water'|'land'|'high'|'forest')=>{
  if(signedVisualArea(points)<0)points=points.slice().reverse()
  document.terrainAreas[id]={id,floorId,editLocked:false,visibility:'public',boundaryMm:points.map((positionMm,i)=>({id:`${id}-p${i}`,segmentId:`${id}-s${i}`,positionMm:captureJson(positionMm)})),groundElevationMm:elevation,coveragePriority:priority,surfaceStyle:paint(role),blocksMovement:role==='water',blocksSight:false,movementCostMultiplier:1}
  document.entityLayers[id]=layerId
 }
 add('t9-sea',[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}],0,0,'water')
 let priority=10
 if(profile==='tidal'){
  const threshold=plan.thresholds.land!
  const shallow=extractCompositionFieldLevel(threshold.sourceInput,'land',Math.max(-1000000,threshold.valueQ-70000))
  for(const [i,poly] of shallow.entries()){
   if(poly.holes.length)throw new Error('浅滩分带含孔洞，须减少复杂交叠。')
   add(`t9-shallow-${i}`,poly.outer,priority++,200,'water');document.terrainAreas[`t9-shallow-${i}`].blocksMovement=false
  }
 }
 const polygons=plan.fields.land.polygons.slice().sort((a,c)=>Math.abs(signedVisualArea(c.outer))-Math.abs(signedVisualArea(a.outer)))
 for(const [i,polygon] of polygons.entries()){
  add(`t9-land-${i}`,polygon.outer,priority++,input.baseElevationMm,'land')
  for(const [j,hole] of polygon.holes.entries())add(`t9-lake-${i}-${j}`,hole,priority++,0,'water')
 }
 if(profile==='tidal'){
  const threshold=plan.thresholds.land!
  const lowland=extractCompositionFieldLevel(threshold.sourceInput,'land',Math.min(1000000,threshold.valueQ+80000))
  for(const [i,poly] of lowland.entries()){
   if(poly.holes.length)throw new Error('低地分带含孔洞，须减少复杂交叠。')
   add(`t9-lowland-${i}`,poly.outer,priority++,800,'land')
  }
 }
 const landMulti:MultiPolygon=polygons.map(poly=>[poly.outer,...poly.holes].map(points=>points.map(p=>[p.x,p.y])))
 const bands:{field:'elevation'|'vegetation';role:'high'|'forest';elevation:number;polygons:typeof plan.fields.land.polygons}[]=[]
 for(const [index,elevation] of levels.entries()){
  const threshold=plan.thresholds.elevation!
  const levelQ=index===0?threshold.valueQ:recomputeCompositionThreshold(threshold.sourceInput,'elevation',Math.round(threshold.targetCoveragePpm*(levels.length-index)/levels.length),threshold.grid)
  const currentSource={algorithmId:'terrain-compose' as const,algorithmVersion:1 as const,seed:input.seed,precision:input.precision,boundsMm:input.boundsMm,baseElevationMm:input.baseElevationMm,members:input.members,features:input.features}
  const levelPolygons=index===0?plan.fields.elevation.polygons:extractCompositionFieldLevel(currentSource,'elevation',levelQ)
  bands.push({field:'elevation',role:'high',elevation,polygons:levelPolygons})
 }
 bands.push({field:'vegetation',role:'forest',elevation:input.baseElevationMm,polygons:plan.fields.vegetation.polygons})
 const pointsOf=(closed:number[][]):PointMm[]=>{
  const points=closed.map(([x,y])=>({x:Math.round(x),y:Math.round(y)}))
  if(points.length>1&&points[0].x===points.at(-1)!.x&&points[0].y===points.at(-1)!.y)points.pop()
  return points.filter((p,i)=>i===0||p.x!==points[i-1].x||p.y!==points[i-1].y)
 }
 for(const [bandIndex,{field,role,elevation,polygons:source}] of bands.entries()){
  if(!source.length)continue
  const raw:MultiPolygon=source.map(poly=>[poly.outer,...poly.holes].map(points=>points.map(p=>[p.x,p.y])))
  const clipped=landMulti.length?polygonClipping.intersection(raw,landMulti):[]
  // Capture the exact underlying mosaic before adding this band. Restoring a
  // hole replays these real surfaces in their original priority order.
  const supports=Object.values(document.terrainAreas).map(area=>captureJson(area)).sort((a,c)=>a.coveragePriority-c.coveragePriority)
  let part=0
  const overlay=(polygons:MultiPolygon,height:number)=>{
   for(const poly of polygons){
    const id=`t9-${field}-${bandIndex}-${part++}`
    add(id,pointsOf(poly[0]),priority++,height,role)
    for(const [holeIndex,hole] of poly.slice(1).entries()){
     let remaining:MultiPolygon=[[hole]]
     const pieces:{support:typeof supports[number];polygon:MultiPolygon[number]}[]=[]
     for(const support of supports.slice().reverse()){
      if(!remaining.length)break
      const supportRing=ring(support.boundaryMm.map(p=>p.positionMm))
      for(const polygon of polygonClipping.intersection(remaining,supportRing))pieces.push({support,polygon})
      remaining=polygonClipping.difference(remaining,supportRing)
     }
     if(remaining.length)throw new Error('孔洞缺少完整下层支撑。')
     // Prefer only visible pieces. A holed inherited piece falls back to an
     // exact ordered replay; those additional real pieces still cost budget.
     const restore=pieces.some(piece=>piece.polygon.length!==1)?supports.flatMap(support=>polygonClipping.intersection([[hole]],ring(support.boundaryMm.map(p=>p.positionMm))).map(polygon=>({support,polygon}))):pieces
     for(const [pieceIndex,{support,polygon}] of restore.entries()){
      if(polygon.length!==1)throw new Error('继承支撑分片含孔洞，无法证明等价物化。')
      const restoreId=`${id}-hole-${holeIndex}-${pieceIndex}`
      add(restoreId,pointsOf(polygon[0]),priority++,support.groundElevationMm,'land')
      Object.assign(document.terrainAreas[restoreId],{surfaceStyle:captureJson(support.surfaceStyle),blocksMovement:support.blocksMovement,blocksSight:support.blocksSight,movementCostMultiplier:support.movementCostMultiplier})
     }
    }
   }
  }
  if(field==='vegetation'){
   // Reapply forest through the same ordered support mosaic, inheriting each
   // exact physical elevation. Water is excluded by the complete land mask.
   for(const support of supports){
    if(support.surfaceStyle?.base.materialRef.id===material('water').id)continue
    overlay(polygonClipping.intersection(clipped,ring(support.boundaryMm.map(p=>p.positionMm))),support.groundElevationMm)
   }
  }else overlay(clipped,elevation)
 }
 // Every real intersection and collinear endpoint is persisted in both rings.
 // This is creation of new geometry, not an implicit repair on load.
 const rings=Object.values(document.terrainAreas).map(a=>a.boundaryMm.map(p=>p.positionMm))
 for(const area of Object.values(document.terrainAreas)){
  const source=area.boundaryMm.map(p=>p.positionMm),positions:PointMm[]=[]
  for(let i=0;i<source.length;i++){
   const a=source[i],end=source[(i+1)%source.length],cuts=segmentCuts(a,end,rings.flatMap(r=>r.map((p,j)=>[p,r[(j+1)%r.length]] as [PointMm,PointMm])))
   for(const t of cuts.slice(0,-1)){
    const point={x:Math.round(a.x+(end.x-a.x)*t),y:Math.round(a.y+(end.y-a.y)*t)}
    if(!positions.length||positions.at(-1)!.x!==point.x||positions.at(-1)!.y!==point.y)positions.push(point)
   }
  }
  area.boundaryMm=positions.map((positionMm,i)=>({id:`${area.id}-p${i}`,segmentId:`${area.id}-s${i}`,positionMm}))
 }
 const recipeId='t9-recipe'
 system.legacy.recipes[recipeId]={id:recipeId,recipeVersion:1,algorithmId:'terrain-compose',algorithmVersion:1,mapMode:'scene',seed:input.seed,parameters:{terrainKind:profile==='tidal'?'coast':'mixed',seaElevationMm:0,landElevationMm:input.baseElevationMm,plateauElevationMm:elevatedLevel,roughness:.12,densityFactor:0,baySide:'west'},materials:([['water','water'],['land','rock'],['high','grass']] as const).map(([role,kind])=>({role:kind,ref:{id:material(role).id,version:material(role).version}})),props:[],precision:captureJson(input.precision)}
 system.features=captureJson(input.features)
 const outputRefs=Object.keys(document.terrainAreas).flatMap(entityId=>(['geometry','properties','surface'] as const).map(fieldGroup=>({kind:'terrainArea' as const,entityId,parentId:null,fieldGroup})))
 const composition:TerrainComposition={id:compositionId,floorId,layerId,visibility:'public',editLocked:false,recipeRef:{id:recipeId,version:1},seed:input.seed,boundsMm:captureJson(b),algorithmId:'terrain-compose',algorithmVersion:1,precision:captureJson(input.precision),baseElevationMm:input.baseElevationMm,members:captureJson(input.members),thresholdIds:[],requirementIds:requirements.map(r=>r.id),outputRefs,state:'active',inputHash:'0'.repeat(64),outputHash:'0'.repeat(64)}
 system.compositions[compositionId]=composition
 for(const [field,threshold] of Object.entries(plan.thresholds)){
  const id=`t9-threshold-${field}`,row={id,compositionId,...captureJson(threshold),inputHash:'0'.repeat(64)}
  row.inputHash=thresholdInputHash(row);system.thresholds[id]=row;composition.thresholdIds.push(id)
 }
 system.requirements=Object.fromEntries(requirements.map(r=>[r.id,captureJson(r)]))
 const dependency:TerrainDependency={id:'t9-dependency',compositionId,featureIds:Object.keys(system.features).sort(),thresholdIds:[...composition.thresholdIds],reads:[],writes:captureJson(outputRefs),transitionIds:[],scopeMm:captureJson(b),haloMm:Math.max(input.precision.sampleSpacingMm,input.precision.noiseCellMm*4,input.precision.toleranceMm),algorithmId:'terrain-dependencies',algorithmVersion:1,inputHash:'0'.repeat(64)}
 system.dependencies[dependency.id]=dependency;dependency.inputHash=dependencyInputHash(document,dependency)
 for(const requirement of requirements){
  const evaluation=evaluateTerrainRequirement(document,requirement)
  if(evaluation.state!=='passed')throw new Error(evaluation.issues.map(i=>i.message).join('；'))
  const id=`${requirement.id}-check`;system.checks[id]={id,requirementId:requirement.id,algorithmId:'terrain-requirement',algorithmVersion:1,...evaluation,inputHash:terrainRequirementInputHash(document,requirement)}
 }
 composition.inputHash=compositionInputHash(document,composition)
 return {document,plan}
}
