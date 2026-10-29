import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../model/scene.js'
import type { ProjectData } from '../model/project.js'
import { createAppearanceGraph } from '../appearance/graph.js'
import { advanceHistoryIdentity, createHistoryIdentity, createHistoryIdentityTrace, validateHistoryIdentity } from '../history/identity.js'
import { projectDataSchema, validateProjectData } from '../project/validate.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { validateSceneDocument } from '../validation/scene.js'
import { emptyVisualSystem } from '../visual/types.js'
import { createEmptyGeneration5, generation5Schema, legacyTerrainView, type GenerationSystem5, type TerrainComposition, type TerrainThreshold, type VisualSystem3 } from './composition-contracts.js'
import { compositionInputHash, compositionOutputHash, dependencyInputHash, terrainRequirementInputHash, thresholdInputHash, validateCompositionContracts } from './composition-integrity.js'
import { planTerrainComposition } from './composition-field.js'
import { evaluateTerrainRequirement } from './composition-requirements.js'

const stamp='2026-10-29T00:00:00.000Z', blankHash='0'.repeat(64)
let sequence=0
const context=()=>({ids:{nextId:()=>`composition-contract-${++sequence}`},clock:{now:()=>stamp}})
type Scene4=SceneDocument&{schemaVersion:4;generation:GenerationSystem5;visual:VisualSystem3}
function blank():Scene4 {
  const bounds={x:0,y:0,width:12000,height:12000}
  return {format:'sceneweave-scene',schemaVersion:4,sceneId:'composition-scene',revision:0,title:'Strict composition fixture',createdAt:stamp,updatedAt:stamp,
    units:{world:'mm',display:'m',gridSizeMm:1000,snapMm:100,gridVisible:false},exportBoundsMm:bounds,
    floors:{floor:{id:'floor',name:'Ground',boundsMm:bounds}},vertices:{},rooms:{},walls:{},openings:{},props:{},regions:{},notes:{},assets:{},propDefinitions:{},materials:{},
    terrainAreas:{},terrainEdges:{},terrainConnections:{},paths:{},prefabDefinitions:{},prefabInstances:{},scatterGroups:{},styleThemes:{},activeStyleThemeRef:null,
    userLayers:{layer:{id:'layer',floorId:'floor',name:'Ground',order:0,editLocked:false}},entityLayers:{},
    presetSnapshot:{presetId:'fixture',presetVersion:1,distanceMode:'metric',source:'Original test fixture',gridSizeMm:1000},constraints:{entranceOpeningIds:[],wallEndClearanceMm:0,pathChecks:[]},
    mapMode:'scene',regional:null,generation:createEmptyGeneration5(),visual:{version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{}}}
}
function fixture():Scene4 {
  const scene=blank(),g=scene.generation
  g.features.feature={id:'feature',floorId:'floor',layerId:'layer',visibility:'public',editLocked:false,kind:'landmass',shape:{kind:'ellipse',centerMm:{x:6000,y:6000},radiusXMm:4000,radiusYMm:3000,rotationMilliDeg:0},elevationMm:500,roughnessPpm:0,seedKey:'stable-feature'}
  g.legacy.recipes.recipe={id:'recipe',recipeVersion:1,algorithmId:'terrain-compose',algorithmVersion:1,mapMode:'scene',seed:'strict',parameters:{terrainKind:'mixed',seaElevationMm:0,landElevationMm:500,plateauElevationMm:1000,roughness:0,densityFactor:0,baySide:'west'},materials:[],props:[],precision:{sampleSpacingMm:2000,toleranceMm:100,noiseCellMm:2000}}
  scene.terrainAreas.land={id:'land',floorId:'floor',editLocked:false,visibility:'public',boundaryMm:[{x:2000,y:2000},{x:10000,y:2000},{x:10000,y:10000},{x:2000,y:10000}].map((positionMm,i)=>({id:`land-p${i}`,segmentId:`land-s${i}`,positionMm})),groundElevationMm:500,coveragePriority:1,surfaceStyle:null,blocksMovement:false,blocksSight:false,movementCostMultiplier:1}
  scene.entityLayers.land='layer'
  const row:TerrainComposition={id:'composition',floorId:'floor',layerId:'layer',visibility:'public',editLocked:false,recipeRef:{id:'recipe',version:1},seed:'strict',boundsMm:cloneJson(scene.exportBoundsMm),algorithmId:'terrain-compose',algorithmVersion:1,precision:{sampleSpacingMm:2000,toleranceMm:100,noiseCellMm:2000},baseElevationMm:500,members:[{featureId:'feature',field:'land',operation:'add',weightPpm:1000000}],thresholdIds:[],requirementIds:['requirement'],outputRefs:[{kind:'terrainArea',entityId:'land',parentId:null,fieldGroup:'geometry'}],state:'active',inputHash:blankHash,outputHash:blankHash}
  g.compositions[row.id]=row
  g.requirements.requirement={id:'requirement',compositionId:row.id,kind:'componentCount',surface:'land',excludeBoundaryTouching:false,expected:1,strength:'hard'}
  const evaluation=evaluateTerrainRequirement(scene,g.requirements.requirement)
  g.checks.check={id:'check',requirementId:'requirement',algorithmId:'terrain-requirement',algorithmVersion:1,...evaluation,inputHash:terrainRequirementInputHash(scene,g.requirements.requirement)}
  g.dependencies.dependency={id:'dependency',compositionId:row.id,featureIds:['feature'],thresholdIds:[],reads:[],writes:cloneJson(row.outputRefs),transitionIds:[],scopeMm:cloneJson(scene.exportBoundsMm),haloMm:2000,algorithmId:'terrain-dependencies',algorithmVersion:1,inputHash:blankHash}
  refresh(scene)
  return scene
}
function refresh(scene:Scene4):void {
  for(const row of Object.values(scene.generation.thresholds))row.inputHash=thresholdInputHash(row)
  for(const row of Object.values(scene.generation.dependencies))row.inputHash=dependencyInputHash(scene,row)
  for(const row of Object.values(scene.generation.compositions))row.inputHash=compositionInputHash(scene,row)
}
function project(scene=fixture()):ProjectData {
  const historyIdentity=createHistoryIdentity(scene,context())
  for(const row of Object.values(scene.generation.compositions))row.outputHash=compositionOutputHash(scene,row,historyIdentity)
  return {format:'sceneweave-complete-project',schemaVersion:4,document:scene,historyIdentity,appearance:createAppearanceGraph(scene),assets:{},licenses:{},licenseBindings:[],authoringSources:{}}
}

describe('strict complete-v4 terrain composition contracts',()=>{
  it('accepts only scene4 / generation5 / visual3 / identity3 / appearance2 and preserves unknown-field rejection',()=>{
    const current=project()
    expect(validateProjectData(current)).toEqual(current)
    expect(projectDataSchema.safeParse(current).success).toBe(true)
    for(const mutate of [
      (p:ProjectData)=>{p.historyIdentity.version=2},
      (p:ProjectData)=>{p.appearance.version=1},
      (p:ProjectData)=>{p.document.visual=(p.document.visual as VisualSystem3).base},
      (p:ProjectData)=>{p.document.schemaVersion=3},
      (p:ProjectData)=>{Object.assign(p.document.generation!,{recipes:{}})},
    ]){const invalid=cloneJson(current);mutate(invalid);expect(()=>validateProjectData(invalid)).toThrow()}
    expect(generation5Schema.safeParse({...createEmptyGeneration5(),extra:{}}).success).toBe(false)
  })
  it('rejects malformed T10 transition records while allowing the strict visual3 slot',()=>{
    const scene=blank()
    Object.assign(scene.visual.transitions,{future:{id:'future'}})
    expect(validateSceneDocument(scene).ok).toBe(false)
    expect(validateCompositionContracts(scene).some(issue=>issue.code==='TRANSITION_BOUNDARY')).toBe(true)
  })
  it('recomputes frozen threshold values rather than trusting a matching input hash',()=>{
    const scene=fixture(),composition=scene.generation.compositions.composition
    const plan=planTerrainComposition({seed:composition.seed,precision:composition.precision,boundsMm:composition.boundsMm,baseElevationMm:500,members:composition.members,features:scene.generation.features,landCoveragePpm:400000,elevationCoveragePpm:0})
    const threshold:TerrainThreshold={id:'threshold',compositionId:composition.id,...plan.thresholds.land!,inputHash:blankHash}
    scene.generation.thresholds[threshold.id]=threshold;composition.thresholdIds.push(threshold.id);scene.generation.dependencies.dependency.thresholdIds.push(threshold.id);refresh(scene)
    expect(validateSceneDocument(scene).ok).toBe(true)
    threshold.valueQ=threshold.valueQ===1000000?999999:threshold.valueQ+1
    refresh(scene)
    expect(validateCompositionContracts(scene).some(issue=>issue.code==='COMPOSITION_THRESHOLD_VALUE')).toBe(true)
  })
  it('rejects forged requirement receipts even when inputHash has been recomputed',()=>{
    const scene=fixture()
    scene.generation.requirements.requirement={id:'requirement',compositionId:'composition',kind:'componentCount',surface:'land',excludeBoundaryTouching:false,expected:2,strength:'hard'}
    scene.generation.checks.check.inputHash=terrainRequirementInputHash(scene,scene.generation.requirements.requirement)
    refresh(scene)
    const issues=validateCompositionContracts(scene)
    expect(issues.some(issue=>issue.code==='COMPOSITION_REQUIREMENT_RECEIPT')).toBe(true)
    expect(issues.some(issue=>issue.code==='COMPOSITION_HARD_REQUIREMENT')).toBe(true)
  })
  it('validates an adopted baseline as its strict frozen prior value rather than the current output',()=>{
    const scene=fixture(),dependency=scene.generation.dependencies.dependency,target=scene.generation.compositions.composition.outputRefs[0]
    const snapshot={boundaryMm:cloneJson(scene.terrainAreas.land.boundaryMm),groundElevationMm:300}
    dependency.reads.push({target:cloneJson(target),role:'baseline',snapshot,contentHash:sha256Text(canonicalJson(snapshot))});refresh(scene)
    expect(validateSceneDocument(scene).ok).toBe(true)
    Object.assign(snapshot,{extra:'opaque future fields'})
    dependency.reads[0].contentHash=sha256Text(canonicalJson(snapshot));refresh(scene)
    expect(validateCompositionContracts(scene).some(issue=>issue.code==='COMPOSITION_READ_SNAPSHOT')).toBe(true)
  })
  it('copies all identity2 pools exactly into identity3 and adds only real terrain births',()=>{
    const scene=fixture(),oldScene=cloneJson(legacyTerrainView(scene)),oldIdentity=createHistoryIdentity(oldScene,context())
    const upgraded={...cloneJson(oldIdentity),version:3 as const,terrainTokens:{}}
    const empty=blank();empty.generation.legacy=cloneJson(scene.generation.legacy);empty.terrainAreas=cloneJson(scene.terrainAreas);empty.entityLayers=cloneJson(scene.entityLayers)
    expect(()=>validateHistoryIdentity(upgraded,empty)).not.toThrow()
    for(const field of ['propTokens','prefabTokens','outdoorTokens','generationTokens','regionalTokens','presentationTokens'] as const)expect(upgraded[field]).toEqual(oldIdentity[field])
    const identity=createHistoryIdentity(scene,context())
    expect(Object.keys(identity.terrainTokens!).sort()).toEqual(['check','composition','dependency','feature','requirement'])
  })
  it('changes a feature topology token on geometry edit and does not restore it after a change back',()=>{
    const before=fixture(),identity=createHistoryIdentity(before,context()),changed=cloneJson(before)
    changed.generation.features.feature.shape={kind:'ellipse',centerMm:{x:6500,y:6000},radiusXMm:4000,radiusYMm:3000,rotationMilliDeg:0};refresh(changed)
    const advanced=advanceHistoryIdentity(identity,before,changed,context())
    expect(advanced.terrainTokens!.feature.token).toBe(identity.terrainTokens!.feature.token)
    expect(advanced.terrainTokens!.feature.topologyToken).not.toBe(identity.terrainTokens!.feature.topologyToken)
    const trace=createHistoryIdentityTrace(identity,before,context());trace.observe(changed)
    const back=trace.finish(before)
    expect(back.terrainTokens!.feature.topologyHash).toBe(identity.terrainTokens!.feature.topologyHash)
    expect(back.terrainTokens!.feature.topologyToken).not.toBe(identity.terrainTokens!.feature.topologyToken)
  })
  it('binds output receipts to the full new identity pool as well as materialized output',()=>{
    const current=project(),changed=cloneJson(current)
    changed.historyIdentity.terrainTokens!.feature.token='different-new-birth'
    expect(()=>validateProjectData(changed)).toThrow(/回执/)
    const moved=cloneJson(current);moved.document.terrainAreas.land.boundaryMm[0].positionMm.x+=100
    expect(()=>validateProjectData(moved)).toThrow()
  })
})
