import { getLegacyGeneration } from './composition-contracts.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { emptyVisualSystem } from '../visual/types.js'
import { createEmptyGeneration, type GenerationRecipe, type GenerationReference } from './contracts.js'
import { generationInputHash, managedOutputHash, constraintInputHash } from './integrity.js'
import { assertTerrainBudget } from './cost.js'
import type { TerrainGenerationResult } from './generate.js'
import { visualBase } from '../visual/base.js'
/** Complete native-v3 materialization; no generator seed is a substitute for editable results. */
export function emptyTerrainDocument(input:SceneDocument):SceneDocument {
  if(input.schemaVersion!==2 || input.visual?.version!==1)throw new Error('地形升级从明确的完整v2基线开始。')
  const document=cloneJson(input)
  document.schemaVersion=3;document.mapMode='scene';document.generation=createEmptyGeneration();document.regional=null
  document.visual={version:2,base:cloneJson(input.visual),materializedEdges:{}}
  return document
}
export function composeTerrainDocument(base:SceneDocument,result:TerrainGenerationResult,birthToken:string) {
  const document=emptyTerrainDocument(result.document), system=getLegacyGeneration(document)!, floorId=Object.keys(document.floors)[0],layerId='visual-layer-ground'
  const recipeId='terrain-recipe',intentId='terrain-intent',ruleId='terrain-rule',constraintId='terrain-activity-constraint'
  const fields=(kind:string):GenerationReference['fieldGroup'] => kind==='prop'?'appearance':kind==='visualEdgeLook'?'appearance':'geometry'
  const mapKind=(kind:string):GenerationReference['kind']=>kind==='visualEdgeLook'?'visualEdgeLook' as GenerationReference['kind']:kind as GenerationReference['kind']
  const refs=result.managedTargets.map(target=>({kind:mapKind(target.kind),entityId:target.id,parentId:null,fieldGroup:fields(target.kind)}))
  const t3 = !['island', 'coast'].includes(result.input.kind), algorithmId = t3 ? 'terrain-scene-t3' : 'terrain-scene'
  const primaryBoundary = visualBase(result.document)!.boundaries[t3 ? 'terrain-high-curve' : 'terrain-coast-curve']
  if (!primaryBoundary) throw new Error('生成结果缺少确切主轮廓。')
  system.recipes[recipeId]={id:recipeId,recipeVersion:1,algorithmId,algorithmVersion:1,mapMode:'scene',seed:result.input.seed,
    parameters:{terrainKind:result.input.kind,seaElevationMm:0,landElevationMm:800,plateauElevationMm:2600,roughness:.18,densityFactor:.3,baySide:Math.abs(result.skeleton.bayDirection.x)>Math.abs(result.skeleton.bayDirection.y)?result.skeleton.bayDirection.x<0?'west':'east':result.skeleton.bayDirection.y<0?'north':'south'},
    materials:Object.values(document.materials).filter(m=>Object.values(document.terrainAreas).some(a=>a.surfaceStyle?.base.materialRef.id===m.id)).map((m):GenerationRecipe['materials'][number]=>({role:m.tags.includes('water')||m.tags.includes('水')?'water':m.tags.includes('sand')?'sand':m.tags.includes('grass')||m.id.includes('moss')?'grass':'rock',ref:{id:m.id,version:m.version}})),
    props:[...new Set(Object.values(document.props).flatMap(p=>p.definitionRef?[p.definitionRef.id]:[]))].map((id):GenerationRecipe['props'][number]=>({role:id.includes('tree-')?'tree':id.includes('grass-')?'shrub':'rock',ref:{id,version:document.propDefinitions[id].version}})),
    precision:{sampleSpacingMm:primaryBoundary.sampleSpacingMm,toleranceMm:primaryBoundary.toleranceMm,noiseCellMm:Math.round(Math.min(result.input.widthMm/result.skeleton.gridColumns,result.input.heightMm/result.skeleton.gridRows))}}
  system.intents[intentId]={id:intentId,floorId,visibility:'public',boundsMm:cloneJson(document.exportBoundsMm),
    skeleton:[{id:'terrain-land-skeleton',kind:'landmass',positionMm:{x:Math.round(result.input.widthMm/2),y:Math.round(result.input.heightMm/2)},radiusMm:Math.round(result.input.heightMm*.35),directionDeg:0},
      {id:'terrain-plateau-skeleton',kind:'plateau',positionMm:cloneJson(result.skeleton.plateauCenterMm),radiusMm:Math.round(result.input.heightMm*.14),directionDeg:0}],constraintIds:[constraintId],preserveIds:[]}
  system.rules[ruleId]={id:ruleId,floorId,layerId,visibility:'public',editLocked:false,kind:'terrain',recipeRef:{id:recipeId,version:1},inputs:[],outputs:refs,
    parameters:{widthMm:result.input.widthMm,minWidthMm:1500,maxWidthMm:result.input.widthMm,roughness:.18,densityFactor:.3},state:'active',inputHash:'0'.repeat(64),managedOutputHash:'0'.repeat(64)}
  for(const [i,ref] of refs.entries())system.ownership[`terrain-owner-${i}`]={id:`terrain-owner-${i}`,outputKey:`${birthToken}/${ref.kind}/${ref.entityId}`,ruleId,target:ref,
    managedFields:ref.kind==='prop'?['geometry','properties','appearance','source']:ref.kind==='visualEdgeLook'?['geometry','properties','appearance','source']:['geometry','properties','surface','source'],manualFields:[],state:'managed',birthToken}
  system.constraints[constraintId]={id:constraintId,floorId,visibility:'public',strength:'hard',kind:'activityArea',boundaryMm:cloneJson(result.activity.boundaryMm),clearanceMm:0}
  if (result.route) {
    const routeId = 'terrain-route-constraint'
    system.constraints[routeId] = { id: routeId, floorId, visibility: 'public', strength: 'hard', kind: 'route', pointsMm: cloneJson(result.route.pointsMm), minWidthMm: result.route.widthMm }
    system.intents[intentId].constraintIds.push(routeId)
    system.checks['terrain-route-check'] = { id: 'terrain-route-check', constraintId: routeId, state: 'passed', algorithmId: result.input.route?.crossing === 'ground' ? 'terrain-route-ground' : 'terrain-route', algorithmVersion: 1, inputHash: constraintInputHash(document, routeId), issues: [] }
  }
  const rule=system.rules[ruleId];rule.inputHash=generationInputHash(document,rule);rule.managedOutputHash=managedOutputHash(document,rule)
  system.checks['terrain-activity-check']={id:'terrain-activity-check',constraintId,state:'passed',algorithmId,algorithmVersion:1,inputHash:constraintInputHash(document,constraintId),issues:[]}
  const empty=emptyTerrainDocument(base);empty.visual={version:2,base:emptyVisualSystem(),materializedEdges:{}}
  return {document,cost:assertTerrainBudget(empty,document)}
}
