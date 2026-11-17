import { applyCommands } from '../../../shared/commands/commands.js'
import type { SceneCommand } from '../../../shared/commands/commands.js'
import { prepareCompositionCommands } from '../../../application/workspace/prepare.js'
import { createBasePlacedProp } from '../../../shared/commands/base.js'
import { SCENE_COLLECTION_ITEMS } from '../../../shared/assets/scene-collection.js'
import { furnitureAssetId, furnitureDefinitionId } from '../../../shared/assets/furniture-collection.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { visualBase } from '../../../shared/visual/base.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { HANDDRAWN_SURFACE_ART, handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'
import { FURNITURE_COLLECTION_ART, FURNITURE_COLLECTION_LICENSE } from '../../../shared/visual/furniture-collection-art.js'
import { runtime, validation } from '../runtime.js'
import { appendHanddrawnSurfaceDefinitions, HANDDRAWN_SURFACES_BATCH } from './handdrawn-surfaces-catalog.js'
import { createFurnitureCollectionDocument } from './furniture-collection-catalog.js'
import { createSceneCollectionSelectionDocument, materializeSceneCollectionDocument } from './scene-collection-catalog.js'

export const SCENE_COLLECTION_LIVING_SCENES = [
  { id: 'medieval-kitchen-wash', name: '中世纪旅舍后厨与洗衣间', era: 'medieval', style: 'wayside-inn' },
  { id: 'fantasy-kitchen-wash', name: '精灵炊事与泉浴工房', era: 'fantasy', style: 'elven' },
  { id: 'period-kitchen-wash', name: '1920年代公寓厨房与洗浴', era: '1920s', style: 'boarding-house' },
] as const
const floorId = 'collection-floor', layerId = 'collection-props', structureLayer = 'collection-structure'

/** Purposeful equipment trial: real shared wall, doors, clear working routes and
 * independent contents. A drawn tabletop does not create an elevated support. */
export function createSceneCollectionLivingDocument(id: string, options: {sceneId?: string; now?: string} = {}): SceneDocument {
  const layout = SCENE_COLLECTION_LIVING_SCENES.find(row => row.id === id)
  if (!layout) throw new Error('未知厨房与卫浴场景。')
  const choose = (category: string, offset = 0) => {
    const row = SCENE_COLLECTION_ITEMS.filter(item => item.category === category && item.era === layout.era)[offset]
    if (!row) throw new Error(`配套生活场景缺少固定素材：${category}`)
    return row
  }
  const categories = ['stove','oven','prep-counter','sink','bar-counter','wine-rack','brew-vessel','pot','tableware','food','bottle',
    'bathtub','washstand','toilet','laundry-trough','drying-rack','ewer','towel','cleaning-tool',
    'chandelier','wall-lamp','table-lamp','floor-lamp','lantern','candelabrum','fireplace','firewood','coal-scuttle','shelf','barrel','basket','sack']
  const rows = categories.map(category => choose(category))
  let scene = appendHanddrawnSurfaceDefinitions(createSceneCollectionSelectionDocument(rows.map(row => row.definitionId), options))
  scene.title = layout.name
  const bounds = {x:0,y:0,width:24000,height:18000}; scene.floors[floorId].boundsMm = bounds; scene.exportBoundsMm = {...bounds}
  const furniture = createFurnitureCollectionDocument({ styleId: layout.style })
  for (const category of ['table','chair','cabinet']) {
    const key = `${category}-${layout.style}`, asset = furnitureAssetId(key), definition = furnitureDefinitionId(key)
    scene.assets[asset] = cloneJson(furniture.assets[asset]); scene.propDefinitions[definition] = cloneJson(furniture.propDefinitions[definition])
  }
  let serial=0
  const stamp={ids:{nextId:()=>`living-structure-${++serial}`},clock:{now:()=>scene.updatedAt}}
  const room=(id:string,name:string,x0:number,x1:number,material:string)=>({type:'createRoom' as const,id,floorId,layerId:structureLayer,purpose:name,thicknessMm:220,
    boundaryMm:[{x:x0,y:2000},{x:x1,y:2000},{x:x1,y:16000},{x:x0,y:16000}],materialRef:{id:handdrawnSurfaceDefinitionId(material),version:1}})
  scene=applyCommands(scene,[room('living-kitchen','烹饪、备餐与就餐',2000,14000,'weathered-oak'),room('living-wash','洗浴、洗衣与清洁',14000,22000,'old-limestone-flags')],stamp)
  const walls=Object.values(scene.walls)
  const shared=walls.find(w=>scene.vertices[w.startVertexId].xMm===14000&&scene.vertices[w.endVertexId].xMm===14000)!
  const front=walls.find(w=>scene.vertices[w.startVertexId].yMm===16000&&scene.vertices[w.endVertexId].yMm===16000&&Math.min(scene.vertices[w.startVertexId].xMm,scene.vertices[w.endVertexId].xMm)<14000)!
  const kitchenWindow=walls.find(w=>scene.vertices[w.startVertexId].yMm===2000&&scene.vertices[w.endVertexId].yMm===2000&&scene.vertices[w.startVertexId].xMm<14000)!
  const east=walls.find(w=>scene.vertices[w.startVertexId].xMm===22000&&scene.vertices[w.endVertexId].xMm===22000)!
  const opening=(wall:typeof shared,id:string,coordinate:number,width:number,kind:'door'|'window')=>{
    const a=scene.vertices[wall.startVertexId],b=scene.vertices[wall.endVertexId],vertical=a.xMm===b.xMm
    const origin=vertical?a.yMm:a.xMm,end=vertical?b.yMm:b.xMm
    const offset=origin<end?coordinate-origin:origin-coordinate-width
    return{type:'addOpening' as const,id,wallId:wall.id,offsetReferenceVertexId:wall.startVertexId,offsetMm:offset,widthMm:width,kind,...(kind==='door'?{state:'open' as const}:{}),layerId:structureLayer}
  }
  scene=applyCommands(scene,[opening(front,'living-front-door',7400,1600,'door'),opening(shared,'living-wash-door',9200,1600,'door'),opening(kitchenWindow,'living-kitchen-window',8300,1800,'window'),opening(east,'living-wash-window',7200,1800,'window')],stamp)
  const place=(definitionId:string,x:number,y:number,rotation:number,roomId:string,suffix='',order=0)=>{
    const prop=createBasePlacedProp(scene,definitionId,{x,y},{ids:{nextId:()=>`living-${definitionId}${suffix}`},clock:stamp.clock},{floorId,supportRef:{kind:'room',id:roomId}})
    prop.rotationDeg=rotation;prop.roomId=roomId;prop.renderOrder=order;scene.props[prop.id]=prop;scene.entityLayers[prop.id]=layerId
    return prop
  }
  const add=(category:string,x:number,y:number,rotation=0,wash=false,order=0)=>place(choose(category).definitionId,x,y,rotation,wash?'living-wash':'living-kitchen','',order)
  add('stove',3800,3500);add('oven',6900,3500);add('sink',11000,3500);add('prep-counter',8600,6400)
  add('wine-rack',3600,6500,90);add('bar-counter',11100,13200);add('brew-vessel',3700,13200)
  add('shelf',3500,9500,90);add('barrel',5300,13200);add('basket',6000,14300);add('sack',3100,11100)
  add('pot',8700,6400,0,false,20);add('food',8100,6400,0,false,21);add('bottle',10900,13100,0,false,20)
  const table=place(furnitureDefinitionId(`table-${layout.style}`),8500,10600,0,'living-kitchen')
  place(furnitureDefinitionId(`chair-${layout.style}`),8500,11750,0,'living-kitchen','-south')
  place(furnitureDefinitionId(`chair-${layout.style}`),8500,9450,180,'living-kitchen','-north')
  place(furnitureDefinitionId(`cabinet-${layout.style}`),12400,6500,90,'living-kitchen')
  add('tableware',table.positionMm.x,table.positionMm.y,0,false,20)
  add('bathtub',18200,3800,0,true);add('washstand',20400,7000,90,true);add('toilet',20600,13800,0,true)
  add('laundry-trough',15900,13200,90,true);add('drying-rack',18200,13200,90,true)
  add('ewer',20250,7000,0,true,20);add('towel',18100,5100,0,true);add('cleaning-tool',15700,14600,0,true)
  add('chandelier',8300,8200);add('wall-lamp',13200,3500);add('table-lamp',12400,6500,0,false,20)
  add('floor-lamp',12700,15100);add('lantern',16100,7000,0,true);add('candelabrum',11400,13200,0,false,21)
  add('fireplace',10400,15100);add('firewood',11600,15100);add('coal-scuttle',12300,14200)
  for(const [index,[x,y]]of [[3800,4100],[11000,12800],[16200,7000]].entries()){
    const id=`living-light-${index}`;visualBase(scene)!.lights[id]={id,floorId,layerId,visibility:'public',editLocked:false,positionMm:{x,y},radiusMm:2300,color:'#E7BE82',intensity:.16,wallOcclusion:true,enabled:true}
  }
  // An explicit straight route followed by one turn is checked against actual
  // furniture footprints, wall thickness and the shared opening on every edit.
  scene.constraints.entranceOpeningIds=['living-front-door']
  scene.constraints.pathChecks=[{id:'living-working-route',name:'后厨到洗浴间工作通路',floorId,from:{type:'point',positionMm:{x:8200,y:16900}},to:{type:'point',positionMm:{x:18000,y:10000}},clearanceMm:1000,mode:'current',assumedOpenDoorIds:[],routeHintMm:[{x:8200,y:16900},{x:8200,y:13500},{x:7000,y:13500},{x:7000,y:8000},{x:12200,y:8000},{x:12200,y:10000},{x:18000,y:10000}]}]
  const usedMaterials=new Set(['weathered-oak','old-limestone-flags'].map(handdrawnSurfaceDefinitionId))
  scene.materials=Object.fromEntries(Object.entries(scene.materials).filter(([id])=>usedMaterials.has(id)))
  const usedAssets=new Set([...Object.values(scene.propDefinitions).flatMap(row=>row.defaultAppearance.kind==='image'?[row.defaultAppearance.assetId]:[]),...Object.values(scene.materials).map(row=>row.textureAssetId)])
  scene.assets=Object.fromEntries(Object.entries(scene.assets).filter(([id])=>usedAssets.has(id)));scene.revision=0
  const result=validateSceneDocument(scene)
  if(!result.ok)throw new Error(`生活场景无效：${result.errors.map(row=>`${row.entityId??''}:${row.code}:${row.message}`).join('；')}`)
  return result.document
}
export async function createSceneCollectionLivingProject(id:string,signal?:AbortSignal){
  signal?.throwIfAborted()
  const scene=createSceneCollectionLivingDocument(id,{sceneId:runtime.ids.nextId(),now:runtime.clock.now()})
  const project=await materializeSceneCollectionDocument(scene,[{...HANDDRAWN_SURFACES_BATCH,artwork:HANDDRAWN_SURFACE_ART.filter(row=>!!scene.assets[HANDDRAWN_SURFACES_BATCH.assetId(row.key)])},
    {artwork:FURNITURE_COLLECTION_ART.filter(row=>!!scene.assets[furnitureAssetId(row.key)]),assetId:furnitureAssetId,licenseText:FURNITURE_COLLECTION_LICENSE,rasterLongEdgePx:1024}],signal)
  const commands:SceneCommand[]=[]
  const prop=(category:string)=>Object.values(project.document.props).find(row=>row.definitionRef&&project.document.propDefinitions[row.definitionRef.id].tags.includes(category))!
  const bind=(hostId:string,children:readonly {id:string; x:number; y:number}[],height:number)=>{
    const host=project.document.props[hostId],w=Math.floor(host.footprintMm.width*.8/2),h=Math.floor(host.footprintMm.height*.8/2),surfaceId=`living-top-${hostId}`
    commands.push({type:'addAttachmentSurface',id:surfaceId,owner:{kind:'prop',id:hostId},feature:{kind:'propTop',polygonLocalMm:[{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}],heightLocalMm:height},capabilities:['support']})
    for(const child of children)commands.push({type:'bindPropAttachment',id:`living-on-${child.id}`,childId:child.id,surfaceId,mode:'support',follow:'follow',anchorState:'manual',anchor:{kind:'horizontal',localMm:{x:child.x,y:child.y},heightOffsetMm:0,rotationOffsetDeg:0}})
  }
  bind(prop('prep-counter').id,[{id:prop('pot').id,x:350,y:0},{id:prop('food').id,x:-350,y:0}],850)
  bind(Object.values(project.document.props).find(row=>row.definitionRef?.id===furnitureDefinitionId(`table-${SCENE_COLLECTION_LIVING_SCENES.find(row=>row.id===id)!.style}`))!.id,[{id:prop('tableware').id,x:0,y:0}],750)
  bind(prop('bar-counter').id,[{id:prop('bottle').id,x:-250,y:0},{id:prop('candelabrum').id,x:300,y:0}],1000)
  return prepareCompositionCommands(project,commands,{runtime,validation,signal})
}
