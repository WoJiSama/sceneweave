import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { sha256Text } from '../validation/hash.js'
import { visualBase } from '../visual/base.js'
import { sampleVisualBoundary } from '../visual/geometry.js'
import { requiredBaseMapSelector } from '../ai/protocol.js'
import { getLegacyGeneration } from './composition-contracts.js'
import { prepareBaseMapRequestV3, executeBaseMapRequestV3, parseBaseMapResponseV3 } from './base-map-v3.js'
import { validateSceneDocument } from '../validation/scene.js'
import { corridor, polygonDistance, propFootprint, supportedPolygon, validateGeometry } from '../geometry/geometry.js'
import { TERRAIN_FIXED_SEEDS } from './generate.js'
import { generateTerrainDocumentV5 } from './surface-generation.js'
import { generateTerrainDocumentV8, terrainGenerationInputV8Schema, terrainGenerationResultV8Schema } from './forest-generation-v8.js'

const input = (seed: string, widthMm = 24000, heightMm = 18000) => ({ sceneId:'forest-layout8', kind:'forest' as const,
  seed, widthMm, heightMm, algorithmVersion:8 as const, budgetProfileId:'standard' as const, quality:'standard' as const })
const blank = (request: ReturnType<typeof input>) => createShoreBlankDocument('island', { title:'森林骨架对照',
  sceneId:request.sceneId, widthMm:request.widthMm, heightMm:request.heightMm, now:'2026-11-14T00:00:00.000Z', preset:'narrative' })
const geometry = (result: ReturnType<typeof generateTerrainDocumentV8>) => canonicalJson(Object.values(result.document.terrainAreas)
  .map(a => ({ elevation:a.groundElevationMm, points:a.boundaryMm.map(p => p.positionMm) })))

describe('independent forest layout8', () => {
  it.each(TERRAIN_FIXED_SEEDS)('%s keeps the full clearing, ramp, scenery support and deterministic result', seed => {
    const request=input(seed), base=blank(request), before=canonicalJson(base), first=generateTerrainDocumentV8(base,request)
    expect(canonicalJson(base)).toBe(before)
    expect(canonicalJson(generateTerrainDocumentV8(JSON.parse(before),request))).toBe(canonicalJson(first))
    expect(terrainGenerationResultV8Schema.safeParse(first).success).toBe(true)
    expect(validateSceneDocument(first.document).ok).toBe(true)
    expect(validateGeometry(first.document).errors).toEqual([])
    expect(supportedPolygon(first.document,first.activity.boundaryMm,first.activity.supportRef,'visual-floor')).toBe(true)
    const ramp=first.document.terrainConnections['terrain-stairs']
    expect(ramp.widthMm).toBe(1500)
    expect(polygonDistance(corridor(ramp.from.positionMm,ramp.to.positionMm,ramp.widthMm),first.activity.boundaryMm)).toBeGreaterThan(0)
    expect(Object.values(first.document.props).length).toBeGreaterThanOrEqual(4)
    for(const prop of Object.values(first.document.props)){
      expect(supportedPolygon(first.document,propFootprint(prop),prop.supportRef,prop.floorId)).toBe(true)
      expect(polygonDistance(propFootprint(prop),first.activity.boundaryMm)).toBeGreaterThanOrEqual(300)
    }
  },30000)
  it('has five different landform arrangements before considering props, and keeps v5 unchanged', () => {
    const results=TERRAIN_FIXED_SEEDS.map(seed => {const r=input(seed);return generateTerrainDocumentV8(blank(r),r)})
    expect(new Set(results.map(geometry)).size).toBe(5)
    expect(new Set(results.map(r=>canonicalJson(r.activity.boundaryMm))).size).toBe(5)
    const old=TERRAIN_FIXED_SEEDS.map(seed=>{const r=input(seed);return generateTerrainDocumentV5(blank(r),{...r,algorithmVersion:5})})
    expect(new Set(old.map(r=>canonicalJson(Object.values(r.document.terrainAreas).map(a=>a.boundaryMm.map(p=>p.positionMm))))).size).toBe(1)
    const r=input(TERRAIN_FIXED_SEEDS[0]), original=canonicalJson(generateTerrainDocumentV5(blank(r),{...r,algorithmVersion:5}))
    generateTerrainDocumentV8(blank(r),r)
    expect(canonicalJson(generateTerrainDocumentV5(blank(r),{...r,algorithmVersion:5}))).toBe(original)
  },30000)
  it.each([[36000,20000],[36000,36000],[120000,90000]])('keeps an unselected seed valid at %i by %i', (width,height) => {
    const r=input('forest-independent-20261114',width,height), result=generateTerrainDocumentV8(blank(r),r)
    expect(validateGeometry(result.document).errors).toEqual([])
    expect(supportedPolygon(result.document,result.activity.boundaryMm,result.activity.supportRef,'visual-floor')).toBe(true)
  },30000)
  it.each([[36000,20000],[36000,36000],[48000,36000],[120000,90000]])('keeps all five layout families at %i by %i within the actual native limits', (width,height) => {
    for(const seed of TERRAIN_FIXED_SEEDS){
      const r=input(seed,width,height), result=generateTerrainDocumentV8(blank(r),r), visual=visualBase(result.document)!
      expect(validateGeometry(result.document).errors).toEqual([])
      for(const look of Object.values(visual.edgeLooks))expect(Math.ceil(sampleVisualBoundary(visual.boundaries[look.boundaryId]).lengthMm/look.repeatMm)).toBeLessThanOrEqual(1024)
    }
  },60000)
  it('replays the exact forest8 transport and refuses a forged result even with a recomputed result hash', () => {
    const r=input(TERRAIN_FIXED_SEEDS[2]), base=blank(r), request=prepareBaseMapRequestV3({ requestId:'forest8-request', flowId:'forest8-flow',
      workspaceSceneId:'current-workspace', checkpoint:2, operationEpoch:3, profile:taskBudgetProfile('standard'), base,
      generation:{kind:'terrain',input:r} })
    expect(request.algorithm).toEqual({id:'terrain-scene-t3',version:8,recipeVersion:8})
    expect(requiredBaseMapSelector(request.generation)).toBe('terrain-scene-v8')
    const response=executeBaseMapRequestV3(request)
    expect(parseBaseMapResponseV3(request,JSON.parse(canonicalJson(response)))).toEqual(response)
    if(response.result.kind!=='terrain')throw Error('Expected terrain')
    expect(getLegacyGeneration(response.result.terrain.document)!.recipes).toEqual({})
    const forged=cloneJson(response)
    if(forged.result.kind!=='terrain')throw Error('Expected terrain')
    forged.result.terrain.skeleton.name='forged-layout'
    const {profileHash,flowId,generation,result,domainCost,generationBudget}=forged
    forged.resultHash=sha256Text(canonicalJson({profileHash,flowId,generation,result,domainCost,generationBudget}))
    expect(()=>parseBaseMapResponseV3(request,forged)).toThrow(/重放不同/)
  },60000)
  it('rejects using the forest selector for another kind or weakening its result cost', () => {
    const r=input(TERRAIN_FIXED_SEEDS[0])
    expect(terrainGenerationInputV8Schema.safeParse({...r,kind:'mixed'}).success).toBe(false)
    expect(terrainGenerationInputV8Schema.safeParse({...r,algorithmVersion:5}).success).toBe(false)
    const result=generateTerrainDocumentV8(blank(r),r)
    expect(terrainGenerationResultV8Schema.safeParse({...result,cost:{...result.cost,total:0}}).success).toBe(false)
  },30000)
})
