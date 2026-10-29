import { z } from 'zod'
import type { TerrainCompositionInput, TerrainCompositionFeature } from './composition-field.js'
import type { TerrainRequirement } from './composition-contracts.js'
export const compositionPresetSchema=z.object({sceneId:z.string().min(1).max(256),seed:z.string().min(1).max(128),preset:z.enum(['archipelago','forestValley','grassRidge','tidalCoast']),widthMm:z.number().int().min(24000).max(120000),heightMm:z.number().int().min(18000).max(90000),islandCount:z.number().int().min(2).max(3).default(3)}).strict().refine(v=>v.widthMm/v.heightMm>=1&&v.widthMm/v.heightMm<=1.8,'宽高比须为1–1.8。')
export type CompositionPresetInput=z.infer<typeof compositionPresetSchema>
export function compositionPreset(raw:unknown):{request:CompositionPresetInput;input:TerrainCompositionInput;requirements:TerrainRequirement[];name:string}{
 const request=compositionPresetSchema.parse(raw),w=request.widthMm,h=request.heightMm,scale=Math.min(w/48000,h/36000),features:TerrainCompositionInput['features']={},members:TerrainCompositionInput['members']=[]
 const point=(x:number,y:number)=>({x:Math.round(w*x),y:Math.round(h*y)})
 const add=(id:string,kind:TerrainCompositionFeature['kind'],shape:TerrainCompositionFeature['shape'],field:'land'|'elevation'|'vegetation',operation:'add'|'subtract'|'max',elevationMm=600)=>{features[id]={id,kind,shape,floorId:'visual-floor',layerId:'visual-layer-ground',visibility:'public',editLocked:false,elevationMm,roughnessPpm:120000,seedKey:id} as TerrainCompositionFeature;members.push({featureId:id,field,operation,weightPpm:1000000})}
 const ellipse=(x:number,y:number,rx:number,ry:number)=>({kind:'ellipse' as const,centerMm:point(x,y),radiusXMm:Math.round(w*rx),radiusYMm:Math.round(h*ry),rotationMilliDeg:0})
 const requirements:TerrainRequirement[]=[],compositionId='t9-composition'
 const count=(surface:'land'|'water',expected:number,excludeBoundaryTouching:boolean)=>requirements.push({id:`t9-${surface}-count`,compositionId,kind:'componentCount',strength:'hard',surface,expected,excludeBoundaryTouching})
 let landCoveragePpm=300000,elevationCoveragePpm=25000,name=''
 if(request.preset==='tidalCoast'){
  add('t9-tidal-land','landmass',ellipse(.5,.5,.36,.38),'land','add');add('t9-tidal-plateau','plateau',ellipse(.5,.45,.15,.14),'elevation','max',1800)
  landCoveragePpm=290000;elevationCoveragePpm=22000;count('land',1,true);name='浅湾台地'
 }else if(request.preset==='archipelago'){
  add('t9-island-west','landmass',ellipse(.23,.39,.18,.27),'land','add');add('t9-island-east','landmass',ellipse(.76,.66,.15,.21),'land','max')
  if(request.islandCount===3)add('t9-island-north','landmass',ellipse(.70,.20,.115,.13),'land','max')
  landCoveragePpm=request.islandCount===3?250000:220000;count('land',request.islandCount,true)
  requirements.push({id:'t9-island-area',compositionId,kind:'minimumComponentArea',strength:'hard',surface:'land',excludeBoundaryTouching:true,minAreaMm2:Math.round(w*h*.017)})
  requirements.push({id:'t9-channel',compositionId,kind:'channelWidth',strength:'hard',pointsMm:[point(.5,.12),point(.5,.86)],minWidthMm:Math.round(1800*scale)})
  name='群岛海岸'
 }else{
  add('t9-mainland','landmass',ellipse(.5,.5,4,4),'land','add');landCoveragePpm=900000
  if(request.preset==='forestValley'){
   add('t9-river','riverValley',{kind:'corridor',pointsMm:[point(.48,0),point(.54,1)],widthMm:Math.round(w*.20)},'land','subtract')
   add('t9-forest','forest',ellipse(.22,.45,.13,.20),'vegetation','add');add('t9-clearing','clearing',ellipse(.22,.45,.035,.055),'vegetation','subtract')
   count('land',2,false);name='森林河谷'
  }else{
   add('t9-lake','lakeBasin',ellipse(.72,.62,.17,.19),'land','subtract');landCoveragePpm=940000
   add('t9-ridge','ridge',{kind:'corridor',pointsMm:[point(.2,.32),point(.35,.43),point(.43,.69)],widthMm:Math.round(w*.20)},'elevation','max',3200)
   elevationCoveragePpm=55000;count('water',1,true);name='草岩丘陵'
  }
 }
 const input:TerrainCompositionInput={seed:request.seed,boundsMm:{x:0,y:0,width:w,height:h},baseElevationMm:600,precision:{sampleSpacingMm:Math.max(1,Math.round(Math.max(w,h)/48)),toleranceMm:Math.max(1,Math.round((request.preset==='tidalCoast'?5000:2600)*scale)),noiseCellMm:Math.max(1,Math.round(5000*scale))},features,members,landCoveragePpm,elevationCoveragePpm}
 return {request,input,requirements,name}
}
