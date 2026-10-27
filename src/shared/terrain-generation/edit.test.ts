import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { generateTerrainDocument, TERRAIN_FIXED_SEEDS } from './generate.js'
import { composeTerrainDocument } from './compose.js'
import { prepareTerrainEdit, terrainEditRequestSchema, normalizeTerrainStroke, type TerrainEditRequest } from './edit.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { visualBase } from '../visual/base.js'
import { constraintInputHash, detachChangedOutputs, generationInputHash, managedOutputHash, materializedBoundaryHash } from './integrity.js'
import { generationV1Schema } from './contracts.js'
import { sampleVisualBoundary } from '../visual/geometry.js'
import { propFootprint, supportedPolygon } from '../geometry/geometry.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { projectScene } from '../projection/projection.js'

const base = () => { const blank=createRefinedBlankDocument('island',{title:'T2 core',sceneId:'terrain-edit-core',now:'2026-10-26T00:00:00.000Z',widthMm:24000,heightMm:18000,preset:'narrative'});return composeTerrainDocument(blank,generateTerrainDocument(blank,{sceneId:blank.sceneId,kind:'island',seed:TERRAIN_FIXED_SEEDS[0]}),'test-birth').document }
function brush(scene:ReturnType<typeof base>,mode:'addLand'|'digWater'|'paintGrass'|'clearArea',point={x:2000,y:2000},radiusMm=300):TerrainEditRequest{return terrainEditRequestSchema.parse({kind:'brush',sceneId:scene.sceneId,operationId:`test-${mode}`,floorId:'visual-floor',scopeMm:scene.exportBoundsMm,linkMode:'scenery',mode,targetAreaId:'terrain-low',materialRef:null,elevationMm:null,strokes:[{pointsMm:[point],radiusMm}]})}
describe('bounded terrain editing T2 pure core',()=>{
 it('canonicalizes angled and repeated device samples idempotently',()=>{
  const points=[{x:0,y:0},{x:400,y:200},{x:600,y:800}]
  expect(normalizeTerrainStroke(normalizeTerrainStroke(points))).toEqual(normalizeTerrainStroke(points))
  expect(normalizeTerrainStroke([{x:0,y:0},{x:200,y:100},{x:400,y:200},{x:600,y:800}])).toEqual(normalizeTerrainStroke(points))
 })
 it('persists a strict explicit generation2 stroke, charges conversion and survives cold validation',()=>{
  const scene=base(),before=canonicalJson(scene),request=brush(scene,'clearArea'),result=prepareTerrainEdit(scene,request)
  expect(result.document.generation!.version).toBe(2);expect(result.cost.items['generation.version']).toBe(1)
  expect(result.cost.items['generation.strokes']).toBeGreaterThan(1)
  expect(generationV1Schema.safeParse({...scene.generation,strokes:{}}).success).toBe(false)
  expect(validateSceneDocument(JSON.parse(canonicalJson(result.document))).ok).toBe(true)
  expect(canonicalJson(scene)).toBe(before);expect(prepareTerrainEdit(scene,request)).toEqual(result)
  expect(()=>prepareTerrainEdit(result.document,request)).toThrow(/身份|采用/)
 })
 it('rejects tampered persisted brush scope, identity and normalization, and omits generation metadata from player output',()=>{
  const result=prepareTerrainEdit(base(),brush(base(),'clearArea'))
  if(result.document.generation?.version!==2)throw new Error('fixture')
  const id=Object.keys(result.document.generation.strokes)[0]
  for(const change of ['scope','index','points'] as const){
    const tampered=cloneJson(result.document)
    if(tampered.generation?.version!==2)throw new Error('fixture')
    const stroke=tampered.generation.strokes[id]
    if(change==='scope')stroke.scopeMm={x:0,y:0,width:100,height:100}
    else if(change==='index')stroke.strokeIndex=1
    else stroke.pointsMm.push(cloneJson(stroke.pointsMm[0]))
    expect(validateSceneDocument(tampered).ok).toBe(false)
  }
  const player=projectScene(result.document,'player')
  expect(JSON.stringify(player)).not.toContain('operationId')
  expect(JSON.stringify(player)).not.toContain('test-clearArea')
  expect(Object.hasOwn(player,'generation')).toBe(false)
 })
 it('moves the actual existing contour and derived physical samples without rebuilding the seed',()=>{
  const scene=base(),boundary=cloneJson(visualBase(scene)!.boundaries['terrain-coast-curve'])
  boundary.segments[0].control1.x+=50
  const result=prepareTerrainEdit(scene,{kind:'contour',sceneId:scene.sceneId,operationId:'test-contour',floorId:'visual-floor',scopeMm:scene.exportBoundsMm,linkMode:'transitions',boundary})
  expect(result.document.terrainAreas['terrain-low'].boundaryMm).not.toEqual(scene.terrainAreas['terrain-low'].boundaryMm)
  expect(result.document.terrainAreas['terrain-high']).toEqual(scene.terrainAreas['terrain-high'])
  expect(result.document.props).toEqual(scene.props);expect(validateSceneDocument(result.document).ok).toBe(true)
 })
 it.each(['addLand','digWater'] as const)('has a real local %s path from current coastal geometry',mode=>{
  const scene=base(),curve=visualBase(scene)!.boundaries['terrain-coast-curve'],point=curve.segments[0].control1
  const result=prepareTerrainEdit(scene,brush(scene,mode,point,700))
  expect(result.document.terrainAreas['terrain-low']).not.toEqual(scene.terrainAreas['terrain-low'])
  expect(result.document.terrainAreas['terrain-high']).toEqual(scene.terrainAreas['terrain-high'])
  const areaSize=(area:typeof scene.terrainAreas[string])=>Math.abs(area.boundaryMm.reduce((sum,point,index,points)=>{const next=points[(index+1)%points.length].positionMm;return sum+point.positionMm.x*next.y-next.x*point.positionMm.y},0))
  if(mode==='addLand')expect(areaSize(result.document.terrainAreas['terrain-low'])).toBeGreaterThan(areaSize(scene.terrainAreas['terrain-low']))
  else expect(areaSize(result.document.terrainAreas['terrain-low'])).toBeLessThan(areaSize(scene.terrainAreas['terrain-low']))
  expect(validateSceneDocument(result.document).ok).toBe(true)
 })
 it('refuses non-shape metadata and request Floor changes at the terrain contour boundary',()=>{
  const scene=base(),before=canonicalJson(scene),original=visualBase(scene)!.boundaries['terrain-coast-curve']
  for(const key of ['floorId','layerId','visibility','editLocked','sampleSpacingMm','toleranceMm'] as const){
    const boundary=cloneJson(original)
    if(key==='floorId'||key==='layerId')boundary[key]='other-target'
    else if(key==='visibility')boundary.visibility='gm'
    else if(key==='editLocked')boundary.editLocked=true
    else boundary[key]+=1
    expect(()=>prepareTerrainEdit(scene,{kind:'contour',sceneId:scene.sceneId,operationId:`metadata-${key}`,floorId:original.floorId,scopeMm:scene.exportBoundsMm,linkMode:'transitions',boundary})).toThrow(/只允许修改控制点/)
  }
  expect(()=>prepareTerrainEdit(scene,{kind:'contour',sceneId:scene.sceneId,operationId:'cross-floor',floorId:'other-floor',scopeMm:scene.exportBoundsMm,linkMode:'transitions',boundary:cloneJson(original)})).toThrow(/Floor/)
  expect(canonicalJson(scene)).toBe(before)
 })
 it('adds a local fixed material overlay without changing physical support or trees',()=>{
  const scene=base(),area=scene.terrainAreas['terrain-high'],constraint=Object.values(scene.generation!.constraints).find(row=>row.kind==='activityArea')!
  if(constraint.kind!=='activityArea')throw new Error('fixture')
  const point={x:Math.round(constraint.boundaryMm.reduce((s,p)=>s+p.x,0)/4),y:Math.round(constraint.boundaryMm.reduce((s,p)=>s+p.y,0)/4)}
  const request=brush(scene,'paintGrass',point,300)
  if(request.kind!=='brush')throw new Error('fixture')
  request.targetAreaId=area.id;request.materialRef=cloneJson(area.surfaceStyle!.base.materialRef)
  const result=prepareTerrainEdit(scene,request)
  expect(result.document.terrainAreas[area.id].surfaceStyle!.overlays).toHaveLength(1)
  expect(result.document.terrainAreas[area.id].boundaryMm).toEqual(area.boundaryMm);expect(result.document.props).toEqual(scene.props)
 })
 it('preserves manual moved and locked objects while clearing managed objects with stable keys and world exclusions',()=>{
  const scene=base(),ids=Object.keys(scene.props),moved=cloneJson(scene)
  moved.props[ids[0]].positionMm.x+=10;detachChangedOutputs(scene,moved)
  const keep=moved.props[ids[0]],request=brush(moved,'clearArea',keep.positionMm,400)
  const result=prepareTerrainEdit(moved,request)
  expect(result.document.props[keep.id]).toEqual(keep)
  const managedId=ids[2],managed=moved.props[managedId],clear=brush(moved,'clearArea',managed.positionMm,1500)
  clear.operationId='test-clear-managed'
  const deleted=prepareTerrainEdit(moved,clear)
  expect(deleted.document.props[managedId]).toBeUndefined()
  const owner=Object.values(deleted.document.generation!.ownership).find(owner=>owner.target.entityId===managedId)!
  expect(owner.state).toBe('deleted');expect(Object.values(deleted.document.generation!.exclusions).some(row=>row.candidateKey===owner.outputKey&&row.boundaryMm.length===4)).toBe(true)
 })
 it('rejects out of scope changes, rule locks, manual shoreline auto changes and budgets atomically',()=>{
  const scene=base(),before=canonicalJson(scene),curve=visualBase(scene)!.boundaries['terrain-coast-curve'],point=curve.segments[0].control1,request=brush(scene,'addLand',point,700)
  request.scopeMm={x:0,y:0,width:100,height:100};expect(()=>prepareTerrainEdit(scene,request)).toThrow(/范围/)
  const locked=cloneJson(scene);locked.generation!.rules['terrain-rule'].editLocked=true
  expect(()=>prepareTerrainEdit(locked,brush(locked,'clearArea'))).toThrow(/锁/)
  const manual=cloneJson(scene);manual.terrainAreas['terrain-low'].surfaceStyle!.base.tint='#ff0000';detachChangedOutputs(scene,manual)
  expect(canonicalJson(scene)).toBe(before)
  const many=brush(scene,'clearArea');if(many.kind!=='brush')throw new Error('fixture');many.strokes=Array.from({length:32},()=>cloneJson(many.strokes[0]))
  expect(()=>prepareTerrainEdit(scene,many)).toThrow(/256/)
 })
 it('edits a coast after manual move, deletion and locking without reviving or changing these objects',()=>{
  const scene=base(),manual=cloneJson(scene),ids=Object.keys(scene.props)
  manual.props[ids[0]].positionMm.x+=10;delete manual.props[ids[1]];delete manual.entityLayers[ids[1]];manual.props[ids[2]].editLocked=true
  detachChangedOutputs(scene,manual)
  const boundary=cloneJson(visualBase(manual)!.boundaries['terrain-coast-curve']);boundary.segments[0].control1.x+=50
  const result=prepareTerrainEdit(manual,{kind:'contour',sceneId:manual.sceneId,operationId:'manual-then-coast',floorId:'visual-floor',scopeMm:manual.exportBoundsMm,linkMode:'scenery',boundary})
  expect(result.document.props).toEqual(manual.props)
  expect(result.document.generation!.exclusions).toEqual(manual.generation!.exclusions)
  expect(result.document.terrainAreas['terrain-high']).toEqual(manual.terrainAreas['terrain-high'])
 })
 it('rechecks a hard route after geometry edits and refreshes only the supported route checker',()=>{
  const scene=base(),curve=visualBase(scene)!.boundaries['terrain-coast-curve']
  const activity=scene.generation!.constraints['terrain-activity-constraint']
  if(activity.kind!=='activityArea')throw new Error('fixture')
  const center=activity.boundaryMm.reduce((sum,p)=>({x:sum.x+p.x/4,y:sum.y+p.y/4}),{x:0,y:0})
  const id='required-route'
  scene.generation!.constraints[id]={id,floorId:'visual-floor',visibility:'public',strength:'hard',kind:'route',pointsMm:[{x:center.x-500,y:center.y},{x:center.x+500,y:center.y}],minWidthMm:500}
  for(const algorithmId of ['terrain-route','future-route']){
   const checkId=`${algorithmId}-check`
   scene.generation!.checks[checkId]={id:checkId,constraintId:id,state:'passed',algorithmId,algorithmVersion:1,inputHash:constraintInputHash(scene,id),issues:[]}
  }
  const result=prepareTerrainEdit(scene,brush(scene,'addLand',curve.segments[0].control1,700))
  const known=result.document.generation!.checks['terrain-route-check'],unknown=result.document.generation!.checks['future-route-check']
  expect(known.state).toBe('passed');expect(known.inputHash).toBe(constraintInputHash(result.document,id));expect(known.issues).toEqual([])
  expect(known.inputHash).not.toBe(scene.generation!.checks['terrain-route-check'].inputHash)
  expect(unknown.state).toBe('unchecked');expect(validateSceneDocument(result.document).ok).toBe(true)
 })
 it('atomically refuses a hard route whose real full width is not walkable',()=>{
  const scene=base(),curve=visualBase(scene)!.boundaries['terrain-coast-curve']
  scene.generation!.constraints['required-route']={id:'required-route',floorId:'visual-floor',visibility:'public',strength:'hard',kind:'route',pointsMm:[{x:1000,y:1000},{x:2000,y:1000}],minWidthMm:1000}
  const request=brush(scene,'addLand',curve.segments[0].control1,700),before=canonicalJson(scene)
  expect(()=>prepareTerrainEdit(scene,request)).toThrow(/路线的完整净宽/)
  expect(canonicalJson(scene)).toBe(before)
 })
 it('atomically rejects a contour edit that removes support beneath a previously valid hard route',()=>{
  const scene=base(),boundary=cloneJson(visualBase(scene)!.boundaries['terrain-coast-curve']);boundary.segments[0].control1.x+=500
  const request:TerrainEditRequest={kind:'contour',sceneId:scene.sceneId,operationId:'route-support-coast',floorId:'visual-floor',scopeMm:scene.exportBoundsMm,linkMode:'scenery',boundary}
  const after=prepareTerrainEdit(scene,request).document,support={kind:'terrainArea' as const,id:'terrain-low'}
  let points:{x:number;y:number}[]|undefined
  for(const sample of sampleVisualBoundary(visualBase(scene)!.boundaries['terrain-coast-curve']).points.slice(0,8)){
   for(let dx=-120;dx<=120&&!points;dx+=10)for(let dy=-120;dy<=120&&!points;dy+=10){
    const x=sample.x+dx,y=sample.y+dy,band=[{x:x-10,y:y-5},{x:x+10,y:y-5},{x:x+10,y:y+5},{x:x-10,y:y+5}]
    if(!supportedPolygon(scene,band,support,'visual-floor')||supportedPolygon(after,band,support,'visual-floor'))continue
    const candidate=[{x:x-5,y},{x:x+5,y}]
    if(checkTerrainRoute(scene,{floorId:'visual-floor',pointsMm:candidate,widthMm:10}).ok&&!checkTerrainRoute(after,{floorId:'visual-floor',pointsMm:candidate,widthMm:10}).ok)points=candidate
   }
   if(points)break
  }
  expect(points).toBeDefined()
  if(!points)throw new Error('fixture')
  scene.generation!.constraints['supported-route']={id:'supported-route',floorId:'visual-floor',visibility:'public',strength:'hard',kind:'route',pointsMm:points,minWidthMm:10}
  const before=canonicalJson(scene)
  expect(()=>prepareTerrainEdit(scene,request)).toThrow(/路线的完整净宽/)
  expect(canonicalJson(scene)).toBe(before)
 })
 it('keeps unimplemented hard port checks as an atomic rejection after physical changes',()=>{
  const scene=base(),curve=visualBase(scene)!.boundaries['terrain-coast-curve']
  scene.generation!.constraints['required-port']={id:'required-port',floorId:'visual-floor',visibility:'public',strength:'hard',kind:'port',positionMm:{x:1000,y:1000},directionDeg:0,widthMm:1000}
  const request=brush(scene,'addLand',curve.segments[0].control1,700),before=canonicalJson(scene)
  expect(()=>prepareTerrainEdit(scene,request)).toThrow(/端口约束需要完整重验/)
  expect(canonicalJson(scene)).toBe(before)
 })
 it.each([['future-terrain',1],['terrain-scene',2],['terrain-scene-t3',2]] as const)('rejects unsupported dependent algorithm %s@%s without refreshing its hashes',(algorithmId,algorithmVersion)=>{
  const scene=base(),curve=visualBase(scene)!.boundaries['terrain-coast-curve'],recipe=scene.generation!.recipes['terrain-recipe'],rule=scene.generation!.rules['terrain-rule']
  recipe.algorithmId=algorithmId;recipe.algorithmVersion=algorithmVersion;rule.inputHash=generationInputHash(scene,rule)
  const before=canonicalJson(scene)
  expect(()=>prepareTerrainEdit(scene,brush(scene,'addLand',curve.segments[0].control1,700))).toThrow(/相关规则须独立重算/)
  expect(canonicalJson(scene)).toBe(before)
 })
 it('updates an authorized materialized edge source hash and preserves manual or locked edges by rejecting',()=>{
  const scene=base(),curve=visualBase(scene)!.boundaries['terrain-coast-curve'],points=sampleVisualBoundary(curve).points.slice(0,3)
  if(scene.visual?.version!==2)throw new Error('fixture')
  scene.visual.materializedEdges['local-edge']={id:'local-edge',floorId:'visual-floor',layerId:'visual-layer-ground',visibility:'public',editLocked:false,boundaryId:curve.id,inputHash:materializedBoundaryHash(curve),kind:'path',polygons:[],strokes:[{id:'local-edge-stroke',pointsMm:cloneJson(points),widthMm:50,color:'#AABBCC',opacity:1}],materialRef:null,fillColor:'#AABBCC',opacity:1}
  const boundary=cloneJson(curve);boundary.segments[0].control1.x+=50
  const request:TerrainEditRequest={kind:'contour',sceneId:scene.sceneId,operationId:'edge-coast',floorId:'visual-floor',scopeMm:scene.exportBoundsMm,linkMode:'transitions',boundary}
  expect(()=>prepareTerrainEdit(scene,request)).toThrow(/人工/)
  const ref={kind:'materializedEdge' as const,entityId:'local-edge',parentId:null,fieldGroup:'geometry' as const},rule=scene.generation!.rules['terrain-rule']
  rule.outputs.push(ref);scene.generation!.ownership['local-edge-owner']={id:'local-edge-owner',outputKey:'test/local-edge',ruleId:rule.id,target:ref,managedFields:['geometry','source'],manualFields:[],state:'managed',birthToken:'edge-birth'}
  rule.managedOutputHash=managedOutputHash(scene,rule)
  const result=prepareTerrainEdit(scene,request)
  if(result.document.visual?.version!==2)throw new Error('fixture')
  expect(result.document.visual.materializedEdges['local-edge'].inputHash).toBe(materializedBoundaryHash(boundary))
  expect(result.document.visual.materializedEdges['local-edge'].strokes).not.toEqual(scene.visual.materializedEdges['local-edge'].strokes)
  scene.visual.materializedEdges['local-edge'].editLocked=true;rule.managedOutputHash=managedOutputHash(scene,rule)
  expect(()=>prepareTerrainEdit(scene,request)).toThrow(/锁/)
 })
 it('relocates only a managed prop losing support and refuses manual or locked support loss',()=>{
  const scene=base(),boundary=cloneJson(visualBase(scene)!.boundaries['terrain-coast-curve']);boundary.segments[0].control1.x+=500
  const request:TerrainEditRequest={kind:'contour',sceneId:scene.sceneId,operationId:'support-coast',floorId:'visual-floor',scopeMm:scene.exportBoundsMm,linkMode:'scenery',boundary}
  const after=prepareTerrainEdit(scene,request).document,prop=Object.values(scene.props).find(prop=>prop.supportRef.kind==='terrainArea'&&prop.supportRef.id==='terrain-low')!
  prop.footprintMm={width:10,height:10};prop.footprintOffsetMm={x:0,y:0}
  let found=false
  for(const sample of sampleVisualBoundary(visualBase(scene)!.boundaries['terrain-coast-curve']).points.slice(0,8)){
    for(let dx=-120;dx<=120&&!found;dx+=10)for(let dy=-120;dy<=120&&!found;dy+=10){
      prop.positionMm={x:sample.x+dx,y:sample.y+dy}
      if(supportedPolygon(scene,propFootprint(prop),prop.supportRef,prop.floorId)&&!supportedPolygon(after,propFootprint(prop),prop.supportRef,prop.floorId))found=true
    }
    if(found)break
  }
  expect(found).toBe(true)
  for(const check of Object.values(scene.generation!.checks))check.state='unchecked'
  const rule=scene.generation!.rules['terrain-rule'];rule.managedOutputHash=managedOutputHash(scene,rule)
  const result=prepareTerrainEdit(scene,request)
  expect(result.document.props[prop.id].positionMm).not.toEqual(prop.positionMm)
  expect(supportedPolygon(result.document,propFootprint(result.document.props[prop.id]),prop.supportRef,prop.floorId)).toBe(true)
  const locked=cloneJson(scene);locked.props[prop.id].editLocked=true;locked.generation!.rules[rule.id].managedOutputHash=managedOutputHash(locked,locked.generation!.rules[rule.id])
  expect(()=>prepareTerrainEdit(locked,request)).toThrow(/锁/)
  const manual=cloneJson(scene);manual.props[prop.id].rotationDeg+=1;detachChangedOutputs(scene,manual)
  expect(()=>prepareTerrainEdit(manual,request)).toThrow(/人工/)
 })
})
