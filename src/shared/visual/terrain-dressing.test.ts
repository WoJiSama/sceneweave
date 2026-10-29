import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createTerrainDressingCatalogDocument, TERRAIN_DRESSING_ART, terrainDressingDefinitionId } from '../../platform/browser/content/terrain-dressing-catalog.js'
import { generateTerrainDocument } from '../terrain-generation/generate.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { createCompositionContent, addPropAppearanceSource } from '../appearance/graph.js'
import { canonicalJson } from '../validation/json.js'
import { planTerrainDressing } from './terrain-dressing.js'
import type { ScatterGroup } from '../model/scene.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'

function fixture() {
  const blank=createRefinedBlankDocument('island',{sceneId:'dressing-plan',title:'dressing',now:'2026-10-29T00:00:00.000Z',widthMm:48000,heightMm:36000,preset:'narrative'})
  const document=composeTerrainDocument(blank,generateTerrainDocument(blank,{sceneId:blank.sceneId,kind:'island',seed:'terrain-v1-0',widthMm:48000,heightMm:36000,algorithmVersion:2}),'dressing-base').document
  let serial=0
  const content=createCompositionContent(document,{ids:{nextId:()=>`dress-${++serial}`},clock:{now:()=>document.createdAt}}),catalog=createTerrainDressingCatalogDocument()
  Object.assign(content.document.assets,catalog.assets);Object.assign(content.document.propDefinitions,catalog.propDefinitions)
  for(const art of TERRAIN_DRESSING_ART){const def=content.document.propDefinitions[terrainDressingDefinitionId(art.key)];addPropAppearanceSource(content.appearance,{definitionRef:{id:def.id,version:def.version},appearance:def.defaultAppearance,visualBoundsMm:def.defaultVisualBoundsMm,shadowClass:def.defaultShadowClass,shadowOverride:null},null,art.presentation)}
  return content
}
describe('explicit terrain dressing command plan',()=>{
  it('plans visible shore/cliff changes and fixed multi-source groups without changing the input or existing props',()=>{
    const source=fixture(),before=canonicalJson(source),plan=planTerrainDressing(source,{sceneId:source.document.sceneId,floorId:'visual-floor',seed:'dressing-0'})
    expect(plan.commands.some(command=>command.type==='upsertVisualEdgeLook')).toBe(true)
    const groups=plan.commands.filter(command=>command.type==='createScatter')
    expect(groups.length).toBeGreaterThan(0)
    for(const group of groups){expect(group.algorithmVersion).toBe('scatter-cell-v2');expect(group.palette.length).toBe(6);expect(group.rotationRangeDeg).toEqual({min:0,max:0})}
    expect(plan.commands.some(command=>command.type==='upsertScatterExclusion')).toBe(true)
    expect(plan.commands.some(command=>command.type==='deleteProp'||command.type==='updateProp')).toBe(false)
    expect(canonicalJson(source)).toBe(before)
  })
  it('keeps an existing dressing group identity and authored configuration on repeated preview',()=>{
    const source=fixture(),first=planTerrainDressing(source,{sceneId:source.document.sceneId,floorId:'visual-floor',seed:'dressing-0'})
    const create=first.commands.find(command=>command.type==='createScatter');if(!create||create.type!=='createScatter')throw new Error('group required')
    const {type: _type,layerId:_layer,...configuration}=create
    source.document.scatterGroups[create.id]={...configuration,algorithmVersion:'scatter-cell-v2',editLocked:false,visibility:'public',gridOriginMm:{x:0,y:0},densityFactor:.11,minDistanceMm:700,rotationRangeDeg:{min:0,max:0},members:{deleted:{propId:null,state:'deleted',overrideFields:[]}},exclusions:[]} as ScatterGroup
    source.document.entityLayers[create.id]=create.layerId!
    const again=planTerrainDressing(source,{sceneId:source.document.sceneId,floorId:'visual-floor',seed:'different-new-seed'})
    expect(again.commands.some(command=>command.type==='createScatter'&&command.id===create.id)).toBe(false)
    expect(again.commands.some(command=>command.type==='configureScatter'&&command.id===create.id)).toBe(false)
    expect(again.commands.some(command=>command.type==='regenerateScatter'&&command.id===create.id)).toBe(true)
    expect(source.document.scatterGroups[create.id].members.deleted.state).toBe('deleted')
    expect(source.document.scatterGroups[create.id].densityFactor).toBe(.11)
  })
  it('adds current activity clearances to an existing group without overwriting prior exclusions',()=>{
    const source=fixture(),request={sceneId:source.document.sceneId,floorId:'visual-floor',seed:'dressing-0'},first=planTerrainDressing(source,request)
    const create=first.commands.find(command=>command.type==='createScatter');if(!create||create.type!=='createScatter')throw new Error('group required')
    const {type:_type,layerId:_layer,...configuration}=create
    const prior={id:'user-kept',boundaryMm:[{x:1000,y:1000},{x:2000,y:1000},{x:2000,y:2000},{x:1000,y:2000}],reason:'manual' as const,sourceCandidateKey:null}
    source.document.scatterGroups[create.id]={...configuration,algorithmVersion:'scatter-cell-v2',editLocked:false,visibility:'public',gridOriginMm:{x:0,y:0},densityFactor:.11,minDistanceMm:700,rotationRangeDeg:{min:0,max:0},members:{deleted:{propId:null,state:'deleted',overrideFields:[]}},exclusions:[prior]} as ScatterGroup
    source.document.entityLayers[create.id]=create.layerId!
    const groupBefore=canonicalJson(source.document.scatterGroups[create.id])
    const generation=getLegacyGeneration(source.document)
    if(!generation)throw new Error('legacy generation required')
    generation.constraints['new-activity']={id:'new-activity',floorId:'visual-floor',kind:'activityArea',visibility:'public',strength:'hard',clearanceMm:0,boundaryMm:[{x:8000,y:8000},{x:24000,y:8000},{x:24000,y:22000},{x:8000,y:22000}]}
    const next=planTerrainDressing(source,request),clearance=next.commands.filter(command=>command.type==='upsertScatterExclusion'&&command.groupId===create.id)
    expect(clearance.some(command=>command.type==='upsertScatterExclusion'&&command.exclusion.boundaryMm[0].x<8000&&command.exclusion.boundaryMm[2].x>24000)).toBe(true)
    expect(clearance.every(command=>command.type==='upsertScatterExclusion'&&command.exclusion.id!=='user-kept')).toBe(true)
    expect(canonicalJson(source.document.scatterGroups[create.id])).toBe(groupBefore)
  })
  it('does not rewrite locked looks or locked dressing groups',()=>{
    const source=fixture();for(const look of Object.values((source.document.visual as {base:{edgeLooks:Record<string,{editLocked:boolean}>}}).base.edgeLooks))look.editLocked=true
    const plan=planTerrainDressing(source,{sceneId:source.document.sceneId,floorId:'visual-floor',seed:'dressing-0'})
    expect(plan.commands.some(command=>command.type==='upsertVisualEdgeLook')).toBe(false)
    expect(plan.report.preservedIds.length).toBeGreaterThan(0)
  })
  it('keeps derived seed lengths within existing command contracts',()=>{
    const source=fixture(),plan=planTerrainDressing(source,{sceneId:source.document.sceneId,floorId:'visual-floor',seed:'x'.repeat(128)})
    for(const command of plan.commands){
      if(command.type==='createScatter')expect(command.seed.length).toBeLessThanOrEqual(128)
      if(command.type==='upsertVisualEdgeLook')expect(command.edgeLook.seed.length).toBeLessThanOrEqual(128)
    }
  })
})
