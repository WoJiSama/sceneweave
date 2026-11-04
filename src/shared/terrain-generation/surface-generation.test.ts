import { describe,expect,it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { TASK_BUDGET_PROFILES } from '../budget/task-budget.js'
import { canonicalJson,cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { visualBase } from '../visual/base.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { generateTerrainDocumentV4,terrainGenerationInputV4Schema } from './generate.js'
import { composeTerrainDocument } from './compose.js'
import { compositionPresetV4,compositionPresetV4Schema } from './composition-presets.js'
import { materializeTerrainComposition } from './composition-materialize.js'
import { compositionInputHash,compositionOutputHash,dependencyInputHash,terrainRequirementInputHash } from './composition-integrity.js'
import { getLegacyGeneration } from './composition-contracts.js'
import { generationInputHash,managedOutputHash } from './integrity.js'
import { compositionPresetV5,generateTerrainDocumentV5,materializeTerrainCompositionV5,terrainGenerationInputV5Schema,
  terrainGenerationResultV5Schema,terrainPhysicalProjection } from './surface-generation.js'

const blank=(palette:'island'|'coast'='island')=>createShoreBlankDocument(palette,{sceneId:'shore-generation',title:'固定岸面5',
  now:'2026-10-30T00:00:00.000Z',widthMm:24000,heightMm:18000,preset:'narrative'})
const request=(kind='island',profileId:'small'|'standard'|'expanded'='standard')=>({sceneId:'shore-generation',seed:'terrain-v1-0',kind,
  widthMm:24000,heightMm:18000,algorithmVersion:5,budgetProfileId:profileId,quality:'standard'})
const shoreIds=new Set<string>(Object.values(SHORE_MATERIAL_IDS))

describe('explicit surface generation 5',()=>{
  it('rejects the explicit small island before returning a partial candidate without changing the registered limit or v4 output',()=>{
    const base=blank(),input=request('island','small'),before=canonicalJson(base)
    expect(()=>generateTerrainDocumentV5(base,input)).toThrow(/intersectionPairs/)
    expect(TASK_BUDGET_PROFILES.small.limits.intersectionPairs).toBe(2000000)
    expect(generateTerrainDocumentV4(base,{...input,algorithmVersion:4}).input.algorithmVersion).toBe(4)
    expect(canonicalJson(base)).toBe(before)
  })
  it.each(['standard','expanded'] as const)('preserves v4 physical fields, openings and exact old output at %s',profileId=>{
    const base=blank(),input=request('island',profileId),before=canonicalJson(base)
    const physical=generateTerrainDocumentV4(base,{...input,algorithmVersion:4}),old=canonicalJson(physical)
    const styled=generateTerrainDocumentV5(base,input)
    expect(terrainPhysicalProjection(styled.document)).toEqual(terrainPhysicalProjection(physical.document))
    expect(styled.document.terrainConnections).toEqual(expect.objectContaining(Object.fromEntries(Object.entries(physical.document.terrainConnections).map(([id,row])=>[id,expect.objectContaining({from:row.from,to:row.to,widthMm:row.widthMm,blocksMovement:row.blocksMovement})]))))
    expect(Object.values(styled.document.terrainAreas).every(area=>area.surfaceStyle&&shoreIds.has(area.surfaceStyle.base.materialRef.id))).toBe(true)
    expect(Object.values(styled.document.terrainAreas).some(area=>(area.surfaceStyle?.overlays.length??0)>0)).toBe(true)
    expect(styled.executionUsage.fieldEvaluations).toBe(physical.executionUsage!.fieldEvaluations)
    expect(styled.executionUsage.intersectionPairs).toBeGreaterThan(physical.executionUsage!.intersectionPairs)
    expect(styled.document.constraints).toEqual(physical.document.constraints)
    expect(styled.cost.legacyTotal).toBe(styled.cost.physicalEntities+styled.cost.terrainPoints+styled.cost.terrainSegments+styled.cost.pathPoints+
      styled.cost.visualEntities+styled.cost.curveSegments+styled.cost.overlays+styled.cost.environmentChanges)
    expect(canonicalJson(generateTerrainDocumentV4(base,{...input,algorithmVersion:4}))).toBe(old)
    expect(canonicalJson(base)).toBe(before)
    const composed=composeTerrainDocument(base,styled,'surface-v5-birth',TASK_BUDGET_PROFILES[profileId]),generation=getLegacyGeneration(composed.document)!
    expect(validateSceneDocument(composed.document).ok).toBe(true)
    expect(generation.recipes['terrain-recipe'].recipeVersion).toBe(5)
    expect(generation.recipes['terrain-recipe'].materials.every(row=>shoreIds.has(row.ref.id))).toBe(true)
    expect(generation.rules['terrain-rule'].inputHash).toBe(generationInputHash(composed.document,generation.rules['terrain-rule']))
    expect(generation.rules['terrain-rule'].managedOutputHash).toBe(managedOutputHash(composed.document,generation.rules['terrain-rule']))
    for(const target of styled.managedTargets)expect(Object.values(generation.ownership).some(row=>row.target.entityId===target.id&&row.state==='managed')).toBe(true)
    expect(terrainGenerationInputV4Schema.safeParse(input).success).toBe(false)
    expect(terrainGenerationInputV5Schema.safeParse({...input,algorithmVersion:4}).success).toBe(false)
    const tampered=cloneJson(styled);tampered.cost.overlays++
    expect(terrainGenerationResultV5Schema.safeParse(tampered).success).toBe(false)
  })

  it('keeps the complete recipe and ownership hashes stable under reordered JSON maps',()=>{
    const base=blank(),result=generateTerrainDocumentV5(base,request()),reordered=cloneJson(result)
    reordered.document.materials=Object.fromEntries(Object.entries(reordered.document.materials).reverse())
    reordered.document.props=Object.fromEntries(Object.entries(reordered.document.props).reverse())
    reordered.document.terrainAreas=Object.fromEntries(Object.entries(reordered.document.terrainAreas).reverse())
    const original=composeTerrainDocument(base,result,'same-v5-birth',TASK_BUDGET_PROFILES.standard)
    const reversed=composeTerrainDocument(base,reordered,'same-v5-birth',TASK_BUDGET_PROFILES.standard)
    expect(canonicalJson(original)).toBe(canonicalJson(reversed))
  })

  it.each(['terrain-v1-1','terrain-v1-2','terrain-v1-3','terrain-v1-4'])('keeps the remaining fixed physical island %s without visual-budget bypass',seed=>{
    const base=blank(),input={...request(),seed},physical=generateTerrainDocumentV4(base,{...input,algorithmVersion:4})
    const styled=generateTerrainDocumentV5(base,input)
    expect(terrainPhysicalProjection(styled.document)).toEqual(terrainPhysicalProjection(physical.document))
    expect(validateSceneDocument(composeTerrainDocument(base,styled,'fixed-v5-birth',TASK_BUDGET_PROFILES.standard).document).ok).toBe(true)
  })

  it.each(['coast','river','lake','forest','hill','mixed'])('supports %s with identical physical support',kind=>{
    const base=blank(kind==='coast'?'coast':'island'),input=request(kind),physical=generateTerrainDocumentV4(base,{...input,algorithmVersion:4})
    const styled=generateTerrainDocumentV5(base,input)
    expect(terrainPhysicalProjection(styled.document)).toEqual(terrainPhysicalProjection(physical.document))
    expect(validateSceneDocument(styled.document).ok).toBe(true)
    expect(visualBase(styled.document)!.environment).not.toEqual(visualBase(physical.document)!.environment)
  })

  it.each(['archipelago','forestValley','grassRidge','tidalCoast'] as const)('refreshes complete native output closure for %s',preset=>{
    const base=blank(),raw={sceneId:base.sceneId,seed:'shore-compose-fixed',preset,widthMm:24000,heightMm:18000,recipeVersion:5,budgetProfileId:'small',quality:'standard'}
    const oldPreset=compositionPresetV4({...raw,recipeVersion:4}),newPreset=compositionPresetV5(raw),profile=preset==='tidalCoast'?'tidal-v2':'plain'
    const physical=materializeTerrainComposition(base,oldPreset.input,oldPreset.requirements,oldPreset.name,profile,4,TASK_BUDGET_PROFILES.small),old=canonicalJson(physical)
    const styled=materializeTerrainCompositionV5(base,newPreset.input,newPreset.requirements,newPreset.name,profile,5,TASK_BUDGET_PROFILES.small)
    expect(terrainPhysicalProjection(styled.document)).toEqual(terrainPhysicalProjection(physical.document))
    expect(validateSceneDocument(styled.document).ok).toBe(true)
    expect(compositionPresetV4Schema.safeParse(raw).success).toBe(false)
    const generation=styled.document.generation
    if(generation?.version!==5)throw new Error('Expected native generation5')
    const composition=generation.compositions['t9-composition']
    expect(composition.recipeRef.version).toBe(5)
    expect(generation.legacy.recipes[composition.recipeRef.id].materials.every(row=>shoreIds.has(row.ref.id))).toBe(true)
    expect(composition.inputHash).toBe(compositionInputHash(styled.document,composition))
    expect(composition.outputHash).toBe(compositionOutputHash(styled.document,composition))
    for(const dependency of Object.values(generation.dependencies)){
      expect(dependency.inputHash).toBe(dependencyInputHash(styled.document,dependency))
      expect(dependency.writes).toEqual(composition.outputRefs)
    }
    for(const check of Object.values(generation.checks))expect(check.inputHash).toBe(terrainRequirementInputHash(styled.document,generation.requirements[check.requirementId]))
    for(const id of Object.keys(visualBase(styled.document)!.boundaries))expect(composition.outputRefs.some(row=>row.entityId===id&&row.fieldGroup==='geometry')).toBe(true)
    for(const id of Object.keys(visualBase(styled.document)!.edgeLooks))expect(composition.outputRefs.some(row=>row.entityId===id&&row.fieldGroup==='appearance')).toBe(true)
    expect(canonicalJson(materializeTerrainComposition(base,oldPreset.input,oldPreset.requirements,oldPreset.name,profile,4,TASK_BUDGET_PROFILES.small))).toBe(old)
  })
})
