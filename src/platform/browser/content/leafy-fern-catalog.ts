import type { EditableProject } from '../../../application/workspace/project.js'
import { captureEditableDraft, validateEditableProject } from '../../../application/workspace/project.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import { geometryIdentityIds } from '../../../shared/commands/domain.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { LEAFY_FERN_ART, LEAFY_FERN_ASSET_ID, LEAFY_FERN_DEFINITION_ID, LEAFY_FERN_LICENSE, LEAFY_FERN_LICENSE_REF, LEAFY_FERN_SPEC } from '../../../shared/visual/leafy-fern-art.js'
import { runtime, validation } from '../runtime.js'
import { materializeVisualArtBatches, type VisualArtBatch } from './visual-art-project.js'

export { LEAFY_FERN_ART, LEAFY_FERN_SPEC, LEAFY_FERN_ASSET_ID, LEAFY_FERN_DEFINITION_ID, LEAFY_FERN_LICENSE } from '../../../shared/visual/leafy-fern-art.js'
const origin = {kind:'original' as const,attribution:'Sceneweave 舒叶羽状蕨v1；独立原创实心羽状叶SVG及确切根锚、毫米尺寸和占地，不替换既有六件植被源',canEmbed:true}
export const leafyFernAssetId = (key: string) => `leafy-fern-v1-art-${key}`
export const LEAFY_FERN_BATCH: VisualArtBatch = Object.freeze({artwork:LEAFY_FERN_ART,licenseText:LEAFY_FERN_LICENSE,assetId:leafyFernAssetId})
function records() {
  const spec=LEAFY_FERN_SPEC
  return {asset:{id:LEAFY_FERN_ASSET_ID,sha256:'0'.repeat(64),mimeType:'image/png' as const,pixelWidth:512,pixelHeight:512,
    logicalSizeMm:{width:spec.widthMm,height:spec.heightMm},licenseRef:LEAFY_FERN_LICENSE_REF,origin:cloneJson(origin)},
  definition:{id:LEAFY_FERN_DEFINITION_ID,catalogId:spec.catalogId,version:spec.version,name:spec.name,tags:[...LEAFY_FERN_ART[0].tags!],licenseRef:LEAFY_FERN_LICENSE_REF,origin:cloneJson(origin),
    defaultAppearance:{kind:'image' as const,assetId:LEAFY_FERN_ASSET_ID,tint:null,opacity:1},defaultVisualBoundsMm:cloneJson(spec.visualBoundsMm),
    defaultFootprintMm:cloneJson(spec.footprintMm),defaultFootprintOffsetMm:{x:0,y:0},defaultBlocksMovement:spec.blocksMovement,defaultBlocksSight:spec.blocksSight,
    defaultRenderLayer:spec.renderLayer,defaultShadowClass:spec.shadowClass}}
}
function checked(input: SceneDocument): SceneDocument {
  const result=validateSceneDocument(input)
  if(!result.ok)throw new Error(`舒叶蕨目录无效：${result.errors.map(issue=>issue.message).join('；')}`)
  return result.document
}
/** New construction only; ordinary existing-project use adopts the catalogue. */
export function appendLeafyFernDefinition(input: SceneDocument): SceneDocument {
  const source=checked(input),scene=cloneJson(source),occupied=geometryIdentityIds(source),fixed=records()
  for(const value of [LEAFY_FERN_ASSET_ID,LEAFY_FERN_DEFINITION_ID]) if(occupied.has(value)||scene.userLayers[value]) throw new Error('舒叶蕨固定身份已存在，不覆盖旧源或其他记录。')
  scene.assets[fixed.asset.id]=fixed.asset;scene.propDefinitions[fixed.definition.id]=fixed.definition
  return checked(scene)
}
export function createLeafyFernCatalogDocument(options:{sceneId?:string;now?:string}={}):SceneDocument {
  const now=options.now??'2026-11-10T00:00:00.000Z',floorId='leafy-fern-floor',layerId='leafy-fern-layer',bounds={x:0,y:0,width:24000,height:18000}
  return appendLeafyFernDefinition(toCurrentSceneDocument({format:'sceneweave-scene',schemaVersion:1,sceneId:options.sceneId??'leafy-fern-v1-catalog',revision:0,title:'舒叶羽状蕨 · 独立原创素材',createdAt:now,updatedAt:now,
    units:{world:'mm',display:'m',gridSizeMm:1000,snapMm:100,gridVisible:false},exportBoundsMm:{...bounds},floors:{[floorId]:{id:floorId,name:'目录空白地面',boundsMm:{...bounds}}},
    userLayers:{[layerId]:{id:layerId,floorId,name:'舒叶蕨目录',order:0,editLocked:false}},entityLayers:{},vertices:{},rooms:{},walls:{},openings:{},props:{},regions:{},notes:{},
    terrainAreas:{},terrainEdges:{},terrainConnections:{},paths:{},prefabDefinitions:{},prefabInstances:{},scatterGroups:{},assets:{},propDefinitions:{},materials:{},styleThemes:{},activeStyleThemeRef:null,
    presetSnapshot:{presetId:'sceneweave-leafy-fern',presetVersion:1,distanceMode:'metric',source:origin.attribution,gridSizeMm:1000},constraints:{entranceOpeningIds:[],wallEndClearanceMm:100,pathChecks:[]},visual:emptyVisualSystem()}))
}
/** Materialize a new scene with this exact fixed source and all explicit base batches. */
export async function materializeLeafyFernScene(scene:SceneDocument,baseBatches:readonly VisualArtBatch[]=[],signal?:AbortSignal):Promise<EditableProject> {
  signal?.throwIfAborted()
  const fixed=records(),asset=scene.assets[LEAFY_FERN_ASSET_ID]
  if(canonicalJson(scene.propDefinitions[LEAFY_FERN_DEFINITION_ID]??null)!==canonicalJson(fixed.definition)||!asset||canonicalJson({...asset,sha256:fixed.asset.sha256})!==canonicalJson(fixed.asset)) throw new Error('舒叶蕨固定定义或标定不匹配。')
  const materialized=await materializeVisualArtBatches(cloneJson(scene),[...baseBatches,LEAFY_FERN_BATCH],signal),project=captureEditableDraft(materialized),definition=project.document.propDefinitions[LEAFY_FERN_DEFINITION_ID]
  addPropAppearanceSource(project.appearance,{definitionRef:{id:definition.id,version:definition.version},appearance:cloneJson(definition.defaultAppearance),visualBoundsMm:cloneJson(definition.defaultVisualBoundsMm),shadowClass:definition.defaultShadowClass,shadowOverride:null},null,cloneJson(LEAFY_FERN_SPEC.presentation))
  return validateEditableProject(project,{...validation,signal})
}
export async function createLeafyFernCatalogProject(signal?:AbortSignal):Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeLeafyFernScene(createLeafyFernCatalogDocument({sceneId:runtime.ids.nextId(),now:runtime.clock.now()}),[],signal)
}
