import { applyCommands, type SceneCommand } from '../../../shared/commands/commands.js'
import { createBasePlacedProp } from '../../../shared/commands/base.js'
import { prepareCompositionCommands } from '../../../application/workspace/prepare.js'
import { SCENE_COLLECTION_ITEMS } from '../../../shared/assets/scene-collection.js'
import { FURNITURE_STYLES, furnitureDefinitionId } from '../../../shared/assets/furniture-collection.js'
import { SURFACES_TRACES_DESIGNS, surfacesTracesDefinitionId } from '../../../shared/assets/surfaces-traces-collection.js'
import type { PathCheck, PointMm, Prop, SceneDocument, SurfaceRef, Visibility } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { HANDDRAWN_SURFACE_ART, handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'
import { runtime, validation } from '../runtime.js'
import { appendHanddrawnSurfaceDefinitions, HANDDRAWN_SURFACES_BATCH } from './handdrawn-surfaces-catalog.js'
import { createSceneCollectionSelectionDocument, materializeSceneCollectionDocument } from './scene-collection-catalog.js'

export const SCENARIO_FLOOR_ID = 'collection-floor'
export const SCENARIO_PROP_LAYER_ID = 'collection-props'
export const SCENARIO_STRUCTURE_LAYER_ID = 'collection-structure'
export type ScenarioRect = readonly [x: number, y: number, width: number, height: number]
export interface ScenarioRoom { id: string; name: string; bounds: ScenarioRect; material?: string; thicknessMm?: number; support?: string }
export interface ScenarioGround { id: string; name: string; bounds: ScenarioRect; boundary?: readonly PointMm[]; material?: string; priority?: number; tint?: string | null; blocksMovement?: boolean }
export interface ScenarioOpening { id: string; axis: 'x' | 'y'; lineMm: number; atMm: number; widthMm: number; kind: 'door' | 'window'; entrance?: boolean; secret?: boolean }
export interface ScenarioPath {id:string;centerlineMm:readonly PointMm[];widthMm:number;supportRefs:readonly SurfaceRef[];material?:string;tint?:string|null;renderOrder?:number;movementCostMultiplier?:number;visibility?:Visibility}
export interface ScenarioProp {
  id: string; category: string; x: number; y: number; support: string; rotation?: number
  /** Exact design key, or a zero-based index within the exact era. */
  variant?: string | number; style?: string; order?: number; visibility?: Visibility
  /** A static model does not create an opening, stair, bridge or elevated support. */
  decorative?: boolean; naturalFallback?: boolean
}
export interface ScenarioAttachment { hostId: string; heightMm: number; children: readonly { id: string; x: number; y: number }[] }
export interface ScenarioSpec {
  id: string; name: string; era: 'medieval' | 'fantasy' | '1920s'; widthMm: number; heightMm: number
  wallMaterial?: string
  rooms: readonly ScenarioRoom[]; grounds?: readonly ScenarioGround[]; openings: readonly ScenarioOpening[]; props: readonly ScenarioProp[]
  paths?:readonly ScenarioPath[]
  groups?: readonly { id: string; name: string; members: readonly string[] }[]
  lights?: readonly { id: string; x: number; y: number; radiusMm?: number; color?: string; intensity?: number }[]
  routes?: readonly Omit<PathCheck, 'floorId'>[]; attachments?: readonly ScenarioAttachment[]
  /** Fixed authored player masks, independent of private object bounds. */
  privacyMasks?: readonly {id:string;bounds:ScenarioRect}[]
  notes?: readonly { id: string; x: number; y: number; text: string; visibility?: Visibility }[]
}
const ownLicenseRef = 'MIT-Sceneweave-Representative-Scenarios-1'
const ownLicense = `Sceneweave Representative Scenarios, version 1
Copyright (c) 2026 Sceneweave contributors

Original authored scenario layouts, light parameters and editable combinations. Fixed artwork retains its separate source and exact license. Code-assisted creation; technical verification and user art acceptance are separate.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const origin = { kind: 'original' as const, attribution: 'Sceneweave用途场景v1；原创布局、真实独立物件与可拆组合；美术签收独立', canEmbed: true }
const furnitureCategories = new Set(['bed', 'table', 'chair', 'cabinet'])
const naturalCategories = new Set(['tree','shrub','rock','fallen-log','stump','stalagmite','grass-clump','fern-clump','flower-clump','fungus-clump','reed-clump','leaf-litter','shore-detail'])
const corners = ([x,y,w,h]: ScenarioRect): PointMm[] => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]
/** Exact surface source identity; no era, prefix or color substitution. */
function materialDefinitionId(key:string):string {
  if(SURFACES_TRACES_DESIGNS.some(row=>row.key===key&&row.kind==='material'))return surfacesTracesDefinitionId(key)
  if(HANDDRAWN_SURFACE_ART.some(row=>row.key===key))return handdrawnSurfaceDefinitionId(key)
  throw new Error(`未知场景地材：${key}`)
}
function selection(spec: ScenarioSpec, prop: ScenarioProp): string {
  if (furnitureCategories.has(prop.category)) {
    const style = FURNITURE_STYLES.find(row => row.id === prop.style)
    if (!style || style.era !== spec.era) throw new Error(`场景家具需要同年代明确固定风格：${prop.id}`)
    return furnitureDefinitionId(`${prop.category}-${style.id}`)
  }
  const matches = SCENE_COLLECTION_ITEMS.filter(row => row.category === prop.category && row.era === spec.era)
  const candidates = prop.naturalFallback && naturalCategories.has(prop.category) ? SCENE_COLLECTION_ITEMS.filter(row => row.category === prop.category) : matches
  const chosen = typeof prop.variant === 'string' ? candidates.find(row => row.key === prop.variant) : candidates[prop.variant ?? 0]
  if (!chosen) throw new Error(`场景缺少精确年代素材：${prop.id}/${prop.category}/${String(prop.variant ?? 0)}`)
  return chosen.definitionId
}
/** Declarative authored scenes. No generated display grid, implicit scale or fake passage. */
export function createSceneCollectionScenarioDocument(spec: ScenarioSpec, options: {sceneId?: string; now?: string} = {}): SceneDocument {
  const selections = spec.props.map(prop => selection(spec, prop))
  if (!selections.length) throw new Error('用途场景至少需要一件配套固定素材。')
  const surfaceKeys=[spec.wallMaterial??'old-limestone-flags',...spec.rooms.map(room=>room.material??'weathered-oak'),...(spec.grounds??[]).map(ground=>ground.material??'old-limestone-flags'),...(spec.paths??[]).flatMap(path=>path.material?[path.material]:[])]
  const surfaceIds=surfaceKeys.map(materialDefinitionId)
  const registeredSurfaces=surfaceKeys.filter(key=>SURFACES_TRACES_DESIGNS.some(row=>row.key===key&&row.kind==='material')).map(materialDefinitionId)
  let scene = createSceneCollectionSelectionDocument([...new Set([...selections,...registeredSurfaces])], {sceneId:options.sceneId ?? `representative-${spec.id}`,now:options.now})
  if(surfaceKeys.some(key=>HANDDRAWN_SURFACE_ART.some(row=>row.key===key)))scene=appendHanddrawnSurfaceDefinitions(scene)
  scene.title = spec.name
  const bounds = {x:0,y:0,width:spec.widthMm,height:spec.heightMm}
  scene.exportBoundsMm = {...bounds}; scene.floors[SCENARIO_FLOOR_ID].boundsMm = {...bounds}; scene.floors[SCENARIO_FLOOR_ID].name = spec.name
  let serial=0
  const stamp={ids:{nextId:()=>`scenario-${spec.id}-${++serial}`},clock:{now:()=>scene.updatedAt}}
  for(const ground of spec.grounds??[]){
    const materialId=materialDefinitionId(ground.material??'old-limestone-flags'),material=scene.materials[materialId]
    if(!material)throw new Error(`未知场景地材：${ground.material}`)
    scene.terrainAreas[ground.id]={id:ground.id,floorId:SCENARIO_FLOOR_ID,editLocked:false,visibility:'public',boundaryMm:(ground.boundary??corners(ground.bounds)).map((positionMm,index)=>({id:`${ground.id}-point-${index}`,segmentId:`${ground.id}-edge-${index}`,positionMm:cloneJson(positionMm)})),groundElevationMm:0,coveragePriority:ground.priority??0,blocksMovement:ground.blocksMovement??false,blocksSight:false,movementCostMultiplier:1,surfaceStyle:{base:{materialRef:{id:materialId,version:1},tileSizeMm:cloneJson(material.defaultTileSizeMm),rotationDeg:0,alignment:'world',originMm:{x:0,y:0},tint:ground.tint??null,opacity:1},overlays:[]}}
    scene.entityLayers[ground.id]=SCENARIO_STRUCTURE_LAYER_ID
  }
  for(const room of spec.rooms)scene=applyCommands(scene,[{type:'createRoom',id:room.id,floorId:SCENARIO_FLOOR_ID,layerId:SCENARIO_STRUCTURE_LAYER_ID,purpose:room.name,thicknessMm:room.thicknessMm??240,boundaryMm:corners(room.bounds),materialRef:{id:materialDefinitionId(room.material??'weathered-oak'),version:1},...(room.support?{supportRef:{kind:'terrainArea' as const,id:room.support}}:{})}],stamp)
  const wallMaterialId=materialDefinitionId(spec.wallMaterial??'old-limestone-flags')
  scene=applyCommands(scene,Object.values(scene.walls).map(wall=>({type:'setSurfaceMaterial' as const,kind:'wall' as const,id:wall.id,materialRef:{id:wallMaterialId,version:1}})),stamp)
  for(const opening of spec.openings){
    const wall=Object.values(scene.walls).find(wall=>{const a=scene.vertices[wall.startVertexId],b=scene.vertices[wall.endVertexId],vertical=opening.axis==='x';return (vertical?a.xMm===opening.lineMm&&b.xMm===opening.lineMm:a.yMm===opening.lineMm&&b.yMm===opening.lineMm)&&Math.min(vertical?a.yMm:a.xMm,vertical?b.yMm:b.xMm)<=opening.atMm&&Math.max(vertical?a.yMm:a.xMm,vertical?b.yMm:b.xMm)>=opening.atMm+opening.widthMm})
    if(!wall)throw new Error(`实际墙面不含完整开口：${opening.id}`)
    const a=scene.vertices[wall.startVertexId],b=scene.vertices[wall.endVertexId],start=opening.axis==='x'?a.yMm:a.xMm,end=opening.axis==='x'?b.yMm:b.xMm
    scene=applyCommands(scene,[{type:'addOpening',id:opening.id,wallId:wall.id,offsetReferenceVertexId:wall.startVertexId,offsetMm:start<end?opening.atMm-start:start-opening.atMm-opening.widthMm,widthMm:opening.widthMm,kind:opening.kind,...(opening.kind==='door'?{state:'open' as const}:{}),layerId:SCENARIO_STRUCTURE_LAYER_ID}],stamp)
    if(opening.secret){scene.openings[opening.id].secret=true;scene.openings[opening.id].revealed=false}
    if(opening.entrance)scene.constraints.entranceOpeningIds.push(opening.id)
  }
  if(new Set(spec.props.map(prop=>prop.id)).size!==spec.props.length)throw new Error('用途场景物件身份重复。')
  spec.props.forEach((row,index)=>{
    const support:SurfaceRef=scene.rooms[row.support]?{kind:'room',id:row.support}:{kind:'terrainArea',id:row.support}
    if(!scene.rooms[row.support]&&!scene.terrainAreas[row.support])throw new Error(`缺少物件显式支撑：${row.id}`)
    const prop=createBasePlacedProp(scene,selections[index],{x:row.x,y:row.y},{ids:{nextId:()=>row.id},clock:stamp.clock},{floorId:SCENARIO_FLOOR_ID,supportRef:support})
    prop.rotationDeg=((row.rotation??0)%360+360)%360;prop.renderOrder=row.order??0;prop.visibility=row.visibility??'public'
    if(support.kind==='room')prop.roomId=support.id
    scene.props[prop.id]=prop;scene.entityLayers[prop.id]=SCENARIO_PROP_LAYER_ID
    if(row.decorative){const id=`${row.id}-decoration-note`;scene.notes[id]={id,floorId:SCENARIO_FLOOR_ID,editLocked:false,visibility:'gm',kind:'note',anchor:{type:'entity',entityKind:'prop',entityId:prop.id},text:'静态装饰模型；不创建开口、高差连接、可进入建筑或可站立平台。'};scene.entityLayers[id]=SCENARIO_PROP_LAYER_ID}
  })
  for(const attachment of spec.attachments??[])for(const child of attachment.children){
    if(!scene.props[child.id]||!scene.props[attachment.hostId])throw new Error('台面物件或宿主不存在。')
    scene.props[child.id].renderOrder=Math.max(scene.props[child.id].renderOrder,scene.props[attachment.hostId].renderOrder+20)
  }
  for(const group of spec.groups??[]){
    if(group.members.length<2||new Set(group.members).size!==group.members.length)throw new Error('用途组合需要至少两个不同独立成员。')
    const members=group.members.map(id=>{const prop=scene.props[id];if(!prop)throw new Error(`组合成员不存在：${id}`);return prop})
    if(Object.values(scene.prefabInstances).some(instance=>Object.values(instance.members).some(member=>group.members.includes(member.propId??''))))throw new Error('用途场景同一物件不能重复归组。')
    const anchor=cloneJson(members[0].positionMm),definitionId=`${group.id}-definition`
    scene.prefabDefinitions[definitionId]={id:definitionId,catalogId:`prefab.sceneweave.representative.${spec.id}.${group.id}`,version:1,name:group.name,tags:['可拆组合',spec.era,spec.id],licenseRef:ownLicenseRef,origin:cloneJson(origin),members:members.map((prop,index)=>({key:`member-${index}`,propTemplate:propTemplate(prop,anchor)}))}
    scene.prefabInstances[group.id]={id:group.id,floorId:SCENARIO_FLOOR_ID,editLocked:false,visibility:members.some(prop=>prop.visibility==='gm')?'gm':'public',definitionRef:{id:definitionId,version:1},anchorMm:anchor,rotationDeg:0,members:Object.fromEntries(members.map((prop,index)=>[`member-${index}`,{propId:prop.id,overrideFields:[]}]))}
    scene.entityLayers[group.id]=SCENARIO_PROP_LAYER_ID
  }
  for(const light of spec.lights??[])visualBase(scene)!.lights[light.id]={id:light.id,floorId:SCENARIO_FLOOR_ID,layerId:SCENARIO_PROP_LAYER_ID,editLocked:false,visibility:'public',positionMm:{x:light.x,y:light.y},radiusMm:light.radiusMm??2400,color:light.color??'#E8BF80',intensity:light.intensity??.14,wallOcclusion:true,enabled:true}
  for(const note of spec.notes??[]){scene.notes[note.id]={id:note.id,floorId:SCENARIO_FLOOR_ID,editLocked:false,visibility:note.visibility??'gm',kind:'note',anchor:{type:'point',positionMm:{x:note.x,y:note.y}},text:note.text};scene.entityLayers[note.id]=SCENARIO_PROP_LAYER_ID}
  for(const mask of spec.privacyMasks??[]){scene.regions[mask.id]={id:mask.id,floorId:SCENARIO_FLOOR_ID,editLocked:false,visibility:'gm',kind:'manualMask',boundaryMm:corners(mask.bounds),blocksMovement:false,movementCostMultiplier:1};scene.entityLayers[mask.id]=SCENARIO_STRUCTURE_LAYER_ID}
  for(const path of spec.paths??[]){
    const materialId=path.material?materialDefinitionId(path.material):null,material=materialId?scene.materials[materialId]:null
    scene.paths[path.id]={id:path.id,floorId:SCENARIO_FLOOR_ID,editLocked:false,visibility:path.visibility??'public',centerlineMm:path.centerlineMm.map(point=>cloneJson(point)),widthMm:path.widthMm,supportRefs:path.supportRefs.map(ref=>cloneJson(ref)),movementCostMultiplier:path.movementCostMultiplier??1,renderOrder:path.renderOrder??0,
      surfaceStyle:materialId&&material?{base:{materialRef:{id:materialId,version:1},tileSizeMm:cloneJson(material.defaultTileSizeMm),rotationDeg:0,alignment:'world',originMm:{x:0,y:0},tint:path.tint??null,opacity:1},overlays:[]}:null}
    scene.entityLayers[path.id]=SCENARIO_STRUCTURE_LAYER_ID
  }
  scene.constraints.pathChecks=(spec.routes??[]).map(route=>({...cloneJson(route),floorId:SCENARIO_FLOOR_ID}))
  const materialIds=new Set(surfaceIds)
  scene.materials=Object.fromEntries(Object.entries(scene.materials).filter(([id])=>materialIds.has(id)))
  const assetIds=new Set([...Object.values(scene.materials).map(material=>material.textureAssetId),...Object.values(scene.propDefinitions).flatMap(def=>def.defaultAppearance.kind==='image'?[def.defaultAppearance.assetId]:[])])
  scene.assets=Object.fromEntries(Object.entries(scene.assets).filter(([id])=>assetIds.has(id)))
  const shadow=(offsetMm:number,blurMm:number,opacity:number)=>({directionDeg:48,offsetMm,blurMm,opacity,color:'#3F4438'})
  const themeId=`scenario-${spec.id}-theme`
  scene.styleThemes[themeId]={id:themeId,catalogId:`theme.sceneweave.representative.${spec.id}`,version:1,name:spec.name,licenseRef:ownLicenseRef,origin:cloneJson(origin),materialSuggestions:Object.keys(scene.materials).map(id=>({id,version:1})),propSuggestions:[],prefabSuggestions:[],outline:{widthMm:22,color:'#554C3D'},openingStyle:{doorStrokeWidthMm:18,windowStrokeWidthMm:14,frameWidthMm:55,doorFill:'#9F8862',windowFill:'#A0B4AD'},edgeStyles:{shore:{strokeWidthMm:10,bandWidthMm:80,color:'#CFC5A0'},cliff:{strokeWidthMm:18,bandWidthMm:160,color:'#5D654E'},materialTransition:{strokeWidthMm:0,bandWidthMm:0,color:'#A7AE8D'},path:{strokeWidthMm:8,bandWidthMm:0,color:'#776D53'}},shadowPresets:{none:shadow(0,0,0),furniture:shadow(75,55,.24),vegetation:shadow(150,85,.2),wall:shadow(100,70,.25)},terrainCliff:{directionDeg:48,offsetFactor:.15,maxOffsetMm:400,blurMm:70,opacity:.2,color:'#4E5C45'}}
  scene.activeStyleThemeRef={id:themeId,version:1};scene.revision=0
  const checked=validateSceneDocument(scene)
  if(!checked.ok)throw new Error(`用途场景 ${spec.id} 无效：${checked.errors.map(error=>`${error.entityId??''}:${error.code}:${error.message}`).join('；')}`)
  return checked.document
}
function propTemplate(prop:Prop,anchor:PointMm){
  return {definitionRef:cloneJson(prop.definitionRef),appearance:cloneJson(prop.appearance),positionMm:{x:prop.positionMm.x-anchor.x,y:prop.positionMm.y-anchor.y},rotationDeg:prop.rotationDeg,visualBoundsMm:cloneJson(prop.visualBoundsMm),footprintMm:cloneJson(prop.footprintMm),footprintOffsetMm:cloneJson(prop.footprintOffsetMm),blocksMovement:prop.blocksMovement,blocksSight:prop.blocksSight,renderLayer:prop.renderLayer,renderOrder:prop.renderOrder,shadowClass:prop.shadowClass,shadowOverride:cloneJson(prop.shadowOverride)}
}
export async function materializeSceneCollectionScenario(spec:ScenarioSpec,signal?:AbortSignal){
  signal?.throwIfAborted()
  const scene=createSceneCollectionScenarioDocument(spec,{sceneId:runtime.ids.nextId(),now:runtime.clock.now()})
  const handdrawn=HANDDRAWN_SURFACE_ART.filter(art=>!!scene.assets[HANDDRAWN_SURFACES_BATCH.assetId(art.key)])
  const project=await materializeSceneCollectionDocument(scene,[{artwork:[],assetId:key=>key,licenseText:ownLicense},...(handdrawn.length?[{...HANDDRAWN_SURFACES_BATCH,artwork:handdrawn}]:[])],signal)
  const commands:SceneCommand[]=[]
  for(const attachment of spec.attachments??[]){
    const host=project.document.props[attachment.hostId]
    if(!host)throw new Error(`台面支撑宿主不存在：${attachment.hostId}`)
    const halfW=Math.floor(host.footprintMm.width*.43),halfH=Math.floor(host.footprintMm.height*.43),surfaceId=`${attachment.hostId}-top-surface`
    commands.push({type:'addAttachmentSurface',id:surfaceId,owner:{kind:'prop',id:host.id},feature:{kind:'propTop',polygonLocalMm:[{x:-halfW,y:-halfH},{x:halfW,y:-halfH},{x:halfW,y:halfH},{x:-halfW,y:halfH}],heightLocalMm:attachment.heightMm},capabilities:['support']})
    for(const child of attachment.children)commands.push({type:'bindPropAttachment',id:`${child.id}-top-binding`,childId:child.id,surfaceId,mode:'support',follow:'follow',anchorState:'manual',anchor:{kind:'horizontal',localMm:{x:child.x,y:child.y},heightOffsetMm:0,rotationOffsetDeg:0}})
  }
  return commands.length?prepareCompositionCommands(project,commands,{runtime,validation,signal}):project
}
