/** Current complete-v1 QA copies. Legacy B4 is only a geometry recipe source.
 * Source archives stay byte-for-byte intact. Each pair gets a fresh authoring
 * lineage; this does not manufacture continuity with the source project. */
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {unzipSync,zipSync} from 'fflate'
import type {ProjectData} from '../src/shared/model/project'
import type {Appearance,PointMm,PrefabDefinition,PropTemplate,Prop,SceneDocument,SurfaceRef,TerrainArea} from '../src/shared/model/scene'
import {LAYER_ENTITY_COLLECTIONS} from '../src/shared/model/scene'
import {validateSceneDocument} from '../src/shared/validation/scene'
import {createCompositionContent} from '../src/shared/appearance/graph'
import {validateProjectData} from '../src/shared/project/validate'
import {canonicalJson} from '../src/shared/validation/json'
import {projectScene} from '../src/shared/projection/projection'
const {PNG}=createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
type Variant='a'|'b'
type FixtureProject=ProjectData&{files:Record<string,Uint8Array>}
const stamp='2026-11-14T00:00:00.000Z'
const sourceMarker=(variant:Variant)=>`PRIVATE-SOURCE-PROMPT-CURRENT-${variant.toUpperCase()}`
const STUDY_IDS={floor:'study-floor',room:'study-room'}
const ISLAND_IDS={floor:'island-floor',high:'island-high',scatterTrees:'island-trees'}
const rectangle=(x:number,y:number,width:number,height:number):PointMm[]=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}]
export const fixtureCases=['VIS-01-S01','VIS-02-S01','VIS-02-S02','SCN-04-S02'] as const
function bind(project: FixtureProject, kind: 'asset' | 'material' | 'propDefinition' | 'prefabDefinition', id: string) {
  const original = project.licenseBindings.find(item => item.licenseRef === 'MIT')
  if (!original) throw new Error('隐私副本需要原样板 MIT 许可文本。')
  project.licenseBindings.push({ ...original, subjectKind: kind, subjectId: id })
}

function secretRaster(project: FixtureProject, id: string, variant: Variant, texture: boolean) {
  const pixelWidth = variant === 'a' ? 64 : 96, pixelHeight = variant === 'a' ? 64 : 48
  const raster = new PNG({ width: pixelWidth, height: pixelHeight })
  for(let y=0;y<pixelHeight;y++)for(let x=0;x<pixelWidth;x++){
    const painted=texture || (x>=7&&y>=9&&x<pixelWidth-11&&y<pixelHeight-11)
    const rgba=variant==='a'?(x%12<5?[228,184,121,255]:[161,94,66,255]):(x%12<5?[154,192,184,255]:[71,108,156,255])
    raster.data.set(painted?rgba:[0,0,0,0],(y*pixelWidth+x)*4)
  }
  const bytes = PNG.sync.write(raster), sha256 = digest(bytes), first=Object.values(project.document.assets)[0]
  project.document.assets[id] = { ...first, id, sha256, pixelWidth, pixelHeight, logicalSizeMm:{width:1000,height:1000},origin:{kind:'original',attribution:sourceMarker(variant),canEmbed:true} }
  project.assets[sha256]={sha256,mimeType:'image/png',sizeBytes:bytes.length,pixelWidth,pixelHeight}
  project.files[`assets/${sha256}.png`]=bytes
  bind(project,'asset',id)
}

function smallProp(id: string, floorId: string, supportRef: SurfaceRef, positionMm: PointMm, appearance: Appearance, variant: Variant): Prop {
  return { id, floorId, editLocked: false, definitionRef: { id: 'b4-private-prop-definition', version: 1 }, appearance: structuredClone(appearance),
    positionMm, rotationDeg: variant === 'a' ? 0 : 47, visualBoundsMm: { x: -180, y: -130, width: 360, height: 260 },
    footprintMm: { width: 120, height: 100 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false,
    visibility: 'gm', supportRef: { ...supportRef }, renderLayer: 'object', renderOrder: 40, shadowClass: 'furniture',
    shadowOverride: { directionDeg: 45, offsetMm: variant === 'a' ? 60 : 120, blurMm: variant === 'a' ? 20 : 30, opacity: variant === 'a' ? .3 : .45, color: '#24313A' } }
}

function template(prop: Prop): PropTemplate {
  const { definitionRef, appearance, positionMm, rotationDeg, visualBoundsMm, footprintMm, footprintOffsetMm, blocksMovement, blocksSight, renderLayer, renderOrder, shadowClass, shadowOverride } = prop
  return structuredClone({ definitionRef, appearance, positionMm, rotationDeg, visualBoundsMm, footprintMm, footprintOffsetMm, blocksMovement, blocksSight, renderLayer, renderOrder, shadowClass, shadowOverride })
}

function addPrefab(project: FixtureProject, id: string, props: Prop[], visibility: 'public' | 'gm') {
  const scene = project.document, definitionId = `${id}-definition`
  const definition: PrefabDefinition = { id: definitionId, catalogId: definitionId, version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'B4 original privacy fixture', canEmbed: true }, name: id, tags: [], members: props.map((prop, i) => ({ key: `member-${i}`, propTemplate: template(prop) })) }
  scene.prefabDefinitions[definitionId] = definition; bind(project, 'prefabDefinition', definitionId)
  scene.prefabInstances[id] = { id, floorId: props[0].floorId, editLocked: false, visibility, definitionRef: { id: definitionId, version: 1 }, anchorMm: { ...props[0].positionMm }, rotationDeg: 0, members: {} }
  for (const [i, prop] of props.entries()) { scene.props[prop.id] = prop; scene.prefabInstances[id].members[`member-${i}`] = { propId: prop.id, overrideFields: [] } }
}

function hiddenNotes(scene: SceneDocument, floorId: string, variant: Variant) {
  scene.notes['b4-secret-note'] = { id: 'b4-secret-note', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: 'b4-secret-object' }, kind: 'clue', title: `S-${variant.toUpperCase()}`, text: `S-${variant}`, visibility: 'gm' }
  scene.notes['b4-dependent-public-note'] = { id: 'b4-dependent-public-note', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prefabInstance', entityId: 'b4-hidden-prefab' }, kind: 'label', text: `D-${variant}`, visibility: 'public' }
  scene.notes['b4-nested-public-note'] = { id: 'b4-nested-public-note', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'note', entityId: 'b4-dependent-public-note' }, kind: 'label', text: `N-${variant}`, visibility: 'public' }
  scene.generationMetadata = { generatorVersion: 'b4-privacy-fixture-v1', seed: `PRIVATE-SEED-${variant}`, summary: sourceMarker(variant), adoptedAt: stamp }
}

function addPrivateMaterial(project: FixtureProject, textureId: string, variant: Variant) {
  const id = 'b4-private-material', scene = project.document
  scene.materials[id] = { id, catalogId: id, version: 1, name: sourceMarker(variant), tags: ['private'], licenseRef: 'MIT', origin: { kind: 'original', attribution: sourceMarker(variant), canEmbed: true }, textureAssetId: textureId, defaultTileSizeMm: { width: 500, height: 500 }, applicableSurfaces: ['terrain', 'wall'] }
  bind(project, 'material', id)
  return { base: { materialRef: { id, version: 1 }, tileSizeMm: { width: 500, height: 500 }, rotationDeg: variant === 'a' ? 0 : 90, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
}

function addStudyPrivateGeometry(project: FixtureProject, variant: Variant) {
  const scene = project.document, floorId = STUDY_IDS.floor, support = { kind: 'room' as const, id: STUDY_IDS.room }, appearance: Appearance = { kind: 'image', assetId: 'b4-private-object-image', opacity: 1, tint: null }
  scene.regions['b4-fixed-mask'] = { id: 'b4-fixed-mask', floorId, editLocked: false, boundaryMm: rectangle(1800, 1400, 2400, 2600), kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
  scene.props['b4-secret-object'] = smallProp('b4-secret-object', floorId, support, variant === 'a' ? { x: 3000, y: 2800 } : { x: 3250, y: 2860 }, appearance, variant)
  const members = [smallProp('b4-inherited-member-0', floorId, support, { x: 2670, y: 2200 }, appearance, variant), smallProp('b4-inherited-member-1', floorId, support, { x: 3310, y: 2200 }, appearance, variant)]
  members.forEach(prop => { prop.visibility = 'public' }); addPrefab(project, 'b4-hidden-prefab', members, 'gm')
  addPrefab(project, 'b4-public-prefab', [smallProp('b4-private-member', floorId, support, { x: 3590, y: 3260 }, appearance, variant)], 'public')
  for (const [i, x] of [2700, 3250].entries()) scene.vertices[`b4-private-wall-v${i}`] = { id: `b4-private-wall-v${i}`, floorId, editLocked: false, xMm: x, yMm: 3350 }
  scene.walls['b4-private-wall'] = { id: 'b4-private-wall', floorId, editLocked: false, startVertexId: 'b4-private-wall-v0', endVertexId: 'b4-private-wall-v1', thicknessMm: 60, blocksMovement: false, blocksSight: false, topStyle: addPrivateMaterial(project, 'b4-private-texture-image', variant) }
  hiddenNotes(scene, floorId, variant)
}

function addIslandPrivateGeometry(project: FixtureProject, variant: Variant, plateau: boolean) {
  const scene = project.document, floorId = ISLAND_IDS.floor, support = { kind: 'terrainArea' as const, id: ISLAND_IDS.high }, appearance: Appearance = { kind: 'image', assetId: 'b4-private-object-image', opacity: 1, tint: null }
  scene.regions['b4-fixed-mask'] = { id: 'b4-fixed-mask', floorId, editLocked: false, boundaryMm: rectangle(19000, 7000, 5500, 5000), kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
  scene.props['b4-secret-object'] = smallProp('b4-secret-object', floorId, plateau ? { kind: 'terrainArea', id: 'b4-private-plateau' } : support, variant === 'a' ? { x: 21200, y: 9400 } : { x: 21600, y: 9700 }, appearance, variant)
  const members = [smallProp('b4-inherited-member-0', floorId, support, { x: 22900, y: 9300 }, appearance, variant), smallProp('b4-inherited-member-1', floorId, support, { x: 23000, y: 10000 }, appearance, variant)]
  members.forEach(prop => { prop.visibility = 'public' }); addPrefab(project, 'b4-hidden-prefab', members, 'gm')
  addPrefab(project, 'b4-public-prefab', [smallProp('b4-private-member', floorId, support, { x: 23100, y: 10800 }, appearance, variant)], 'public')
  const scatter = structuredClone(scene.scatterGroups[ISLAND_IDS.scatterTrees]), scatterProp = smallProp('b4-inherited-scatter', floorId, support, { x: 22000, y: 11300 }, appearance, variant)
  scatterProp.visibility = 'public'; scene.props[scatterProp.id] = scatterProp
  scatter.id = 'b4-hidden-scatter'; scatter.visibility = 'gm'; scatter.seed = `PRIVATE-SCATTER-${variant}`; scatter.densityFactor = variant === 'a' ? .1 : .95
  scatter.exclusions = []
  scatter.palette = [{ key: 'private-prop', propDefinitionRef: { id: 'b4-private-prop-definition', version: 1 }, weight: 1 }]
  scatter.members = { ['a'.repeat(64)]: { propId: scatterProp.id, state: variant === 'a' ? 'managed' : 'manual', overrideFields: variant === 'a' ? [] : ['positionMm', 'appearance'] } }
  scene.scatterGroups[scatter.id] = scatter
  const style = addPrivateMaterial(project, 'b4-private-texture-image', variant)
  if (plateau) {
    const positions = variant === 'a' ? rectangle(20500, 8500, 1500, 2000) : [{ x: 20700, y: 8700 }, { x: 22400, y: 8600 }, { x: 22300, y: 10700 }, { x: 20500, y: 10400 }]
    const area: TerrainArea = { ...structuredClone(scene.terrainAreas[ISLAND_IDS.high]), id: 'b4-private-plateau', visibility: 'gm', groundElevationMm: variant === 'a' ? 3500 : 4300, coveragePriority: variant === 'a' ? 20 : 25, surfaceStyle: style,
      boundaryMm: positions.map((positionMm, i) => ({ id: `b4-private-plateau-v${i}`, segmentId: `b4-private-plateau-s${i}`, positionMm })) }
    scene.terrainAreas[area.id] = area
    scene.terrainEdges['b4-private-edge'] = { id: 'b4-private-edge', floorId, editLocked: false, visibility: 'gm', source: { areaId: area.id, segmentId: area.boundaryMm[0].segmentId }, neighborAreaId: ISLAND_IDS.high, kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: structuredClone(style), styleOverride: { strokeWidthMm: variant === 'a' ? 20 : 35, color: variant === 'a' ? '#54482C' : '#38526C', bandWidthMm: variant === 'a' ? 200 : 300 } }
  } else {
    // A small independent masked wall exercises a private material without changing public terrain/support.
    for (const [i, x] of [21600, 22200].entries()) scene.vertices[`b4-private-wall-v${i}`] = { id: `b4-private-wall-v${i}`, floorId, editLocked: false, xMm: x, yMm: 10800 }
    scene.walls['b4-private-wall'] = { id: 'b4-private-wall', floorId, editLocked: false, startVertexId: 'b4-private-wall-v0', endVertexId: 'b4-private-wall-v1', thicknessMm: 60, blocksMovement: false, blocksSight: false, topStyle: style }
  }
  hiddenNotes(scene, floorId, variant)
}


async function readSource(path:string):Promise<FixtureProject>{
 const files=unzipSync(new Uint8Array(await readFile(path))),json=(p:string)=>JSON.parse(new TextDecoder().decode(files[p])),m=json('manifest.json')
 const licenses=Object.fromEntries(m.entries.filter((e:any)=>e.role==='license').map((e:any)=>[e.sha256,{sha256:e.sha256,text:new TextDecoder().decode(files[e.path])}]))
 return{format:'sceneweave-complete-project',schemaVersion:1,document:json('scene.json'),historyIdentity:json('identity.json'),appearance:json('appearance.json'),assets:m.assetRecords,licenses,licenseBindings:m.licenseBindings,authoringSources:json('sources.json'),files}
}
function addOutpost(project:FixtureProject,variant:Variant){
 const s=project.document,floorId=Object.keys(s.floors)[0],room=Object.values(s.rooms).find(r=>r.purpose.includes('储物'))??Object.values(s.rooms).find(r=>r.id.includes('store'))
 if(!room)throw Error('Fixed outpost storeroom missing')
 s.regions['b4-fixed-mask']={id:'b4-fixed-mask',floorId,editLocked:false,boundaryMm:rectangle(12500,7500,3000,4000),kind:'manualMask',visibility:'gm',blocksMovement:false,movementCostMultiplier:1}
 s.props['b4-secret-object']=smallProp('b4-secret-object',floorId,{kind:'room',id:room.id},variant==='a'?{x:13700,y:9000}:{x:14300,y:9700},{kind:'image',assetId:'b4-private-object-image',opacity:1,tint:null},variant)
 s.notes['b4-secret-note']={id:'b4-secret-note',floorId,editLocked:false,anchor:{type:'entity',entityKind:'prop',entityId:'b4-secret-object'},kind:'clue',text:`S-${variant}`,visibility:'gm'}
}
export async function createCurrentPrivacyInputs(root:string){
 await mkdir(root+'/inputs',{recursive:true})
 const sources={study:'local-data/scenes/书房与露台-VIS01-技术核对-20261114/原始样板.sceneweave',island:'local-data/scenes/双层岩岛-VIS02-技术核对-20261114/原始样板.sceneweave',outpost:'local-data/scenes/海岸哨所-SCN04-独立接入修正-20261113/原固定基线.sceneweave'}
 const rows:any[]=[]
 for(const name of fixtureCases){
  const sourcePath=name.startsWith('VIS-01')?sources.study:name.startsWith('VIS-02')?sources.island:sources.outpost
  const original=await readSource(sourcePath),originalPropIds=Object.keys(original.document.props),publicRelocations:any[]=[],rejectedAttempts:any[]=[]
  for(const variant of ['a','b'] as const){
   const project=structuredClone(original),scene=project.document
   scene.sceneId=`current-privacy-${name.toLowerCase()}`;scene.revision=41;scene.createdAt=stamp;scene.updatedAt=stamp
   // S02 isolates only plateau height/contour/coverage/derived edge; other secrets are identical.
   const detailVariant=name==='VIS-02-S02'?'a':variant
   secretRaster(project,'b4-private-object-image',detailVariant,false)
   if(name!=='SCN-04-S02')secretRaster(project,'b4-private-texture-image',detailVariant,true)
   scene.propDefinitions['b4-private-prop-definition']={id:'b4-private-prop-definition',catalogId:'current-privacy-prop',version:1,name:sourceMarker(detailVariant),tags:[],licenseRef:'MIT',origin:{kind:'original',attribution:sourceMarker(detailVariant),canEmbed:true},defaultAppearance:{kind:'image',assetId:'b4-private-object-image',opacity:1,tint:null},defaultVisualBoundsMm:{x:-180,y:-130,width:360,height:260},defaultFootprintMm:{width:120,height:100},defaultFootprintOffsetMm:{x:0,y:0},defaultBlocksMovement:false,defaultBlocksSight:false,defaultRenderLayer:'object',defaultShadowClass:'furniture'}
   bind(project,'propDefinition','b4-private-prop-definition')
   if(name==='VIS-01-S01')addStudyPrivateGeometry(project,detailVariant)
   else if(name==='SCN-04-S02')addOutpost(project,detailVariant)
   else{
    addIslandPrivateGeometry(project,detailVariant,name==='VIS-02-S02')
    if(name==='VIS-02-S02'&&variant==='b'){
     const a=scene.terrainAreas['b4-private-plateau'];a.groundElevationMm=4300;a.coveragePriority=25
     a.boundaryMm.forEach((p,i)=>p.positionMm=[{x:20700,y:8700},{x:22400,y:8600},{x:22300,y:10700},{x:20500,y:10400}][i])
    }
   }
   for(const c of LAYER_ENTITY_COLLECTIONS)for(const e of Object.values(scene[c]))scene.entityLayers[e.id]??=Object.keys(scene.userLayers)[0]
   let checked=validateSceneDocument(scene)
   if(!checked.ok&&name==='VIS-02-S02'){
    rejectedAttempts.push({variant,errors:checked.errors,publicTreeUnmoved:true})
    const tree=Object.values(scene.props).find(p=>p.positionMm.x===20277&&p.positionMm.y===10303)
    if(!tree)throw Error('Recorded S02 tree absent: '+JSON.stringify(checked.errors))
    const from={...tree.positionMm};tree.positionMm={x:19800,y:10303}
    publicRelocations.push({variant,id:tree.id,from,to:tree.positionMm,reason:'Current strict validator rejects private plateau overlapping original public support; identical explicit 477mm QA-only relocation in both variants.'})
    checked=validateSceneDocument(scene)
   }
   if(!checked.ok)throw Error(name+'/'+variant+': '+JSON.stringify(checked.errors))
   let sequence=0
   const composed=createCompositionContent(checked.document,{ids:{nextId:()=>`current-privacy-${name.toLowerCase()}-${sequence++}`},clock:{now:()=>stamp}})
   const{files,...data}=project
   const complete=validateProjectData({...data,...composed})
   const m=JSON.parse(new TextDecoder().decode(files['manifest.json']))
   for(const[path,data]of Object.entries({'scene.json':complete.document,'identity.json':complete.historyIdentity,'appearance.json':complete.appearance}))files[path]=new TextEncoder().encode(canonicalJson(data))
   m.assetRecords=complete.assets;m.licenseBindings=complete.licenseBindings;m.sceneId=complete.document.sceneId;m.revision=41
   for(const[path,bytes]of Object.entries(files))if(path!=='manifest.json'){
    let entry=m.entries.find((r:any)=>r.path===path)
    if(!entry){entry={path,role:'asset',mimeType:'image/png'};m.entries.push(entry)}
    entry.sha256=digest(bytes);entry.sizeBytes=bytes.length
   }
   files['manifest.json']=new TextEncoder().encode(canonicalJson(m))
   const bytes=zipSync(files,{level:6}),path=`${root}/inputs/${name}-${variant}.sceneweave`
   await writeFile(path,bytes,{flag:'wx'})
   const projection=projectScene(complete.document,'player',complete.appearance)
   await writeFile(`${root}/inputs/${name}-${variant}-player-projection.json`,canonicalJson(projection)+'\n',{flag:'wx'})
   rows.push({name,variant,path,sha256:digest(bytes),sourcePath,sourceSha256:digest(await readFile(sourcePath)),freshQaLineage:true,originalPropIds,originalPropsPreserved:originalPropIds.every(id=>canonicalJson(complete.document.props[id])===canonicalJson(original.document.props[id])||publicRelocations.some(r=>r.id===id)),publicRelocations:publicRelocations.filter(r=>r.variant===variant),rejectedAttempts:rejectedAttempts.filter(r=>r.variant===variant),revision:41,mask:complete.document.regions['b4-fixed-mask'].boundaryMm,bounds:complete.document.exportBoundsMm,props:Object.keys(complete.document.props).length})
  }
 }
 await writeFile(root+'/inputs.json',JSON.stringify({cases:rows,scope:'Four fixed current complete-v1 paired private mutations. Production samples and source archives unchanged. Full bytes/pixels validated by normal UI import, render, save and cold-open.',userP3:false},null,2)+'\n',{flag:'wx'})
 return rows
}
