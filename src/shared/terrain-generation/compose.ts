import { getLegacyGeneration } from './composition-contracts.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { emptyVisualSystem } from '../visual/types.js'
import { type NaturalGenerationRecipe, type GenerationReference } from './contracts.js'
import { generationInputHash, managedOutputHash, constraintInputHash } from './integrity.js'
import { terrainCommandCost } from './cost.js'
import { assertTaskBudget, measureTaskBudget, taskBudgetProfile, taskSemanticTargets, type TaskBudgetProfile } from '../budget/task-budget.js'
import type { TerrainGenerationResult } from './generate.js'
import { visualBase } from '../visual/base.js'
/** Complete current materialization; no generator seed is a substitute for editable results. */
export function emptyTerrainDocument(input:SceneDocument):SceneDocument {
  if(input.generation?.version!==5 || input.visual?.version!==3)throw new Error('地形生成需要完整生成和视觉基线。')
  const document=cloneJson(input)
  return document
}
export function composeTerrainDocument(base:SceneDocument,result:TerrainGenerationResult,birthToken:string,budget?:TaskBudgetProfile) {
  const document=emptyTerrainDocument(result.document), system=getLegacyGeneration(document)!, floorId=Object.keys(document.floors)[0],layerId='visual-layer-ground'
  const recipeId='terrain-recipe',intentId='terrain-intent',ruleId='terrain-rule',constraintId='terrain-activity-constraint'
  const fields=(kind:string):GenerationReference['fieldGroup'] => kind==='prop'?'appearance':kind==='visualEdgeLook'?'appearance':'geometry'
  const mapKind=(kind:string):GenerationReference['kind']=>kind==='visualEdgeLook'?'visualEdgeLook' as GenerationReference['kind']:kind as GenerationReference['kind']
  const refs=result.managedTargets.map(target=>({kind:mapKind(target.kind),entityId:target.id,parentId:null,fieldGroup:fields(target.kind)}))
  const t3 = !['island', 'coast'].includes(result.input.kind), algorithmId = t3 ? 'terrain-scene-t3' : 'terrain-scene'
  const algorithmVersion = result.input.algorithmVersion ?? 1
  const roughness = !t3 && algorithmVersion >= 2 ? result.input.kind === 'island' ? .018 : .008 : .18
  const primaryBoundary = visualBase(result.document)!.boundaries[t3 ? 'terrain-high-curve' : 'terrain-coast-curve']
  if (!primaryBoundary) throw new Error('生成结果缺少确切主轮廓。')
  const surfaceMaterials=algorithmVersion===5?new Set([
    ...Object.values(document.terrainAreas),...Object.values(document.terrainEdges),...Object.values(document.terrainConnections),...Object.values(document.paths),
  ].flatMap(row=>row.surfaceStyle?[row.surfaceStyle.base.materialRef.id,...row.surfaceStyle.overlays.map(overlay=>overlay.paint.materialRef.id)]:[])):null
  system.recipes[recipeId]={id:recipeId,recipeVersion:algorithmVersion,algorithmId,algorithmVersion,mapMode:'scene',seed:result.input.seed,
    parameters:{terrainKind:result.input.kind,seaElevationMm:0,landElevationMm:800,plateauElevationMm:2600,roughness,densityFactor:.3,baySide:Math.abs(result.skeleton.bayDirection.x)>Math.abs(result.skeleton.bayDirection.y)?result.skeleton.bayDirection.x<0?'west':'east':result.skeleton.bayDirection.y<0?'north':'south'},
    materials:Object.values(document.materials).filter(m=>surfaceMaterials?surfaceMaterials.has(m.id):Object.values(document.terrainAreas).some(a=>a.surfaceStyle?.base.materialRef.id===m.id)).map((m):NaturalGenerationRecipe['materials'][number]=>({role:m.tags.includes('water')||m.tags.includes('水')?'water':m.tags.includes('sand')?'sand':m.tags.includes('grass')||m.id.includes('moss')?'grass':'rock',ref:{id:m.id,version:m.version}})),
    props:[...new Set(Object.values(document.props).flatMap(p=>p.definitionRef?[p.definitionRef.id]:[]))].map((id):NaturalGenerationRecipe['props'][number]=>({role:id.includes('tree-')?'tree':id.includes('grass-')?'shrub':'rock',ref:{id,version:document.propDefinitions[id].version}})),
    precision:{sampleSpacingMm:primaryBoundary.sampleSpacingMm,toleranceMm:primaryBoundary.toleranceMm,noiseCellMm:Math.round(Math.min(result.input.widthMm/result.skeleton.gridColumns,result.input.heightMm/result.skeleton.gridRows))}}
  if (algorithmVersion === 4 || algorithmVersion === 5) {
    // JSON object order cannot decide persisted recipe-array meaning. The new
    // algorithm keeps its material/definition recipe in deterministic ID order;
    // legacy algorithms retain their original declared array order.
    const byReference = (a: {ref:{id:string}}, b: {ref:{id:string}}) => a.ref.id < b.ref.id ? -1 : a.ref.id > b.ref.id ? 1 : 0
    system.recipes[recipeId].materials.sort(byReference)
    system.recipes[recipeId].props.sort(byReference)
  }
  system.intents[intentId]={id:intentId,floorId,visibility:'public',boundsMm:cloneJson(document.exportBoundsMm),
    skeleton:[{id:'terrain-land-skeleton',kind:'landmass',positionMm:{x:Math.round(result.input.widthMm/2),y:Math.round(result.input.heightMm/2)},radiusMm:Math.round(result.input.heightMm*.35),directionDeg:0},
      {id:'terrain-plateau-skeleton',kind:'plateau',positionMm:cloneJson(result.skeleton.plateauCenterMm),radiusMm:Math.round(result.input.heightMm*.14),directionDeg:0}],constraintIds:[constraintId],preserveIds:[]}
  system.rules[ruleId]={id:ruleId,floorId,layerId,visibility:'public',editLocked:false,kind:'terrain',recipeRef:{id:recipeId,version:algorithmVersion},inputs:[],outputs:refs,
    parameters:{widthMm:result.input.widthMm,minWidthMm:1500,maxWidthMm:result.input.widthMm,roughness,densityFactor:.3},state:'active',inputHash:'0'.repeat(64),managedOutputHash:'0'.repeat(64)}
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
  system.checks['terrain-activity-check']={id:'terrain-activity-check',constraintId,state:'passed',algorithmId,algorithmVersion,inputHash:constraintInputHash(document,constraintId),issues:[]}
  const empty=emptyTerrainDocument(base);empty.visual={version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{}}
  if(result.input.algorithmVersion===4||result.input.algorithmVersion===5){
    const profile=budget??taskBudgetProfile(result.input.budgetProfileId)
    if(profile.profileId!==result.input.budgetProfileId)throw new Error('生成预算档位不同。')
    const usage=assertTaskBudget(profile,measureTaskBudget(empty,document,undefined,result.executionUsage))
    const targets=taskSemanticTargets(empty,document)
    return {document,cost:{items:Object.fromEntries(targets.map(target=>[target,1])),total:targets.length,limit:profile.semanticTargets},usage}
  }
  const cost=terrainCommandCost(empty,document)
  // A detached draft reports the full current estimate. Installation owns the
  // real metadata-aware admission gate; old domain replays may exceed it.
  return {document,cost}
}
