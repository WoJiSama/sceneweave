import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { validateSceneDocument } from '../validation/scene.js'
import { BUDGET_DIMENSIONS, TASK_BUDGET_PROFILES, TaskBudgetProfileSchema, assertTaskBudget, captureExecutionBudget,
  emptyBudgetUsage, getTaskBudgetProfile, measureTaskBudget, selectTaskBudget, taskSemanticTargets } from './task-budget.js'
import { withExecutionWorkObserver, type BudgetUsage } from './task-budget.js'

const blank = () => createRefinedBlankDocument('island', { sceneId: 'budget-model', title: '预算',
  now: '2026-10-30T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })

describe('registered task budget admission', () => {
  it('binds complete independent limits to a versioned immutable profile hash', () => {
    for (const profile of Object.values(TASK_BUDGET_PROFILES)) {
      const { profileHash, ...body } = profile
      expect(profileHash).toBe(sha256Text(canonicalJson(body)))
      expect(TaskBudgetProfileSchema.parse(profile)).toEqual(profile)
      expect(Object.isFrozen(profile.limits)).toBe(true)
      const changed = structuredClone(profile)
      changed.limits.geometryPoints++
      expect(TaskBudgetProfileSchema.safeParse(changed).success).toBe(false)
      changed.profileHash = sha256Text(canonicalJson({ ...body, limits: changed.limits }))
      expect(TaskBudgetProfileSchema.safeParse(changed).success).toBe(false)
      expect(TaskBudgetProfileSchema.safeParse({ ...profile, countingVersion: 1 }).success).toBe(false)
      expect(TaskBudgetProfileSchema.safeParse({ ...profile, added: true }).success).toBe(false)
    }
  })

  it.each(BUDGET_DIMENSIONS)('rejects only the exceeded %s dimension, without a mixed score', dimension => {
    const profile = TASK_BUDGET_PROFILES.small, usage = emptyBudgetUsage()
    usage[dimension] = profile.limits[dimension]
    expect(assertTaskBudget(profile, usage)).toEqual(usage)
    expect(() => assertTaskBudget(profile, { ...usage, [dimension]: usage[dimension] + 1 })).toThrow(dimension)
  })

  it('charges work cumulatively and atomically, and refuses invalid or unknown counters', () => {
    const meter = captureExecutionBudget(TASK_BUDGET_PROFILES.small)
    meter.charge({ fieldEvaluations: 100, gridNodes: 100 })
    const accepted = meter.snapshot()
    expect(() => meter.charge({ fieldEvaluations: TASK_BUDGET_PROFILES.small.limits.fieldEvaluations })).toThrow('fieldEvaluations')
    expect(meter.snapshot()).toEqual(accepted)
    expect(() => meter.charge({ gridNodes: -1 })).toThrow()
    expect(() => meter.charge({ gridNodes: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    expect(() => meter.charge({ surprise: 1 } as never)).toThrow()
    meter.charge({ fieldEvaluations: 10 })
    expect(meter.snapshot().fieldEvaluations).toBe(110)
    expect(accepted.fieldEvaluations).toBe(100)
  })

  it('makes automatic selection replayable while explicit selection remains exact', () => {
    const task = { task: 'generation' as const, widthMm: 120000, heightMm: 90000, quality: 'detailed' as const }
    expect(selectTaskBudget({ ...task, device: 'constrained' }).profileId).toBe('small')
    expect(selectTaskBudget({ ...task, device: 'expanded' }).profileId).toBe('expanded')
    expect(getTaskBudgetProfile('expanded').semanticTargets).toBe(2048)
    expect(getTaskBudgetProfile('standard').semanticTargets).toBe(1024)
    expect(() => selectTaskBudget({ ...task, widthMm: Infinity, device: 'expanded' })).toThrow()
  })

  it('observes successful work once and restores synchronous scopes on success and failure', () => {
    const outer:Partial<BudgetUsage>[]=[],inner:Partial<BudgetUsage>[]=[],meter=captureExecutionBudget(TASK_BUDGET_PROFILES.small)
    const value=withExecutionWorkObserver(delta=>outer.push(delta),()=>{
      meter.charge({gridNodes:2,geometryPoints:8,activeExecutionMs:1})
      withExecutionWorkObserver(delta=>inner.push(delta),()=>meter.charge({fieldEvaluations:3}))
      expect(()=>meter.charge({gridNodes:TASK_BUDGET_PROFILES.small.limits.gridNodes})).toThrow()
      meter.snapshot();meter.snapshot()
      meter.charge({intersectionPairs:4})
      return 'complete'
    })
    expect(value).toBe('complete')
    expect(outer).toEqual([{gridNodes:2},{intersectionPairs:4}])
    expect(inner).toEqual([{fieldEvaluations:3}])
    expect(()=>withExecutionWorkObserver(delta=>outer.push(delta),()=>{meter.charge({candidateAttempts:1});throw new Error('later failure')})).toThrow('later failure')
    expect(outer.at(-1)).toEqual({candidateAttempts:1})
    expect(()=>withExecutionWorkObserver(delta=>outer.push(delta),()=>Promise.resolve())).toThrow('Promise')
    meter.charge({dependencyRefs:5})
    expect(outer).toHaveLength(3)
  })

  it('keeps changed geometry and retained source bytes independent from editable targets', () => {
    const before = blank(), after = structuredClone(before)
    const ring = Array.from({ length: 200 }, (_, index) => ({ id: `p${index}`, segmentId: `s${index}`,
      positionMm: { x: Math.round(12000 + Math.cos(index * Math.PI / 100) * 4000), y: Math.round(9000 + Math.sin(index * Math.PI / 100) * 4000) } }))
    after.terrainAreas.land = { id: 'land', floorId: 'visual-floor', editLocked: false, visibility: 'public', boundaryMm: ring,
      groundElevationMm: 800, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    after.entityLayers.land = 'visual-layer-ground'
    const usage = measureTaskBudget(before, after)
    expect(taskSemanticTargets(before, after)).toEqual(['terrainArea:land'])
    expect(usage.semanticTargets).toBe(1)
    expect(usage.geometryPoints).toBe(200)
    expect(usage.intersectionPairs).toBeGreaterThan(200)
    expect(usage.metadataBytes).toBeGreaterThan(0)
    expect(usage.assetBytes).toBe(0) // domain asset references do not prove stored bytes
    const simplified = structuredClone(after)
    simplified.terrainAreas.land.boundaryMm = ring.slice(0, 3)
    expect(measureTaskBudget(after, simplified).geometryPoints).toBe(200)
    expect(measureTaskBudget(after, after).geometryPoints).toBe(0)
  })

  it('refuses valid visual geometry expansion well below the semantic target limit', () => {
    const before = blank(), after = structuredClone(before)
    if(after.visual?.version!==3)throw new Error('Expected current visual fixture')
    const ring=Array.from({length:128},(_,index)=>({x:Math.round(12000+Math.cos(index*Math.PI/64)*4000),y:Math.round(9000+Math.sin(index*Math.PI/64)*4000)}))
    for(let index=0;index<16;index++){
      after.visual.base.base.fogs[`fog-${index}`]={id:`fog-${index}`,floorId:'visual-floor',layerId:'visual-layer-details',visibility:'public',
      editLocked:false,boundaryMm:structuredClone(ring),color:'#FFFFFF',opacity:.5,directionDeg:0,scaleMm:1000,seed:`fog-${index}`,enabled:true}
      after.visual.base.base.filters[`filter-${index}`]={id:`filter-${index}`,floorId:'visual-floor',layerId:'visual-layer-details',visibility:'public',editLocked:false,
        target:{kind:'region',boundaryMm:structuredClone(ring)},preset:'neutral',exposure:1,saturation:1,contrast:1,vignette:0,grain:0,seed:`filter-${index}`,enabled:true}
    }
    after.visual.base.base.lights.one={id:'one',floorId:'visual-floor',layerId:'visual-layer-details',visibility:'public',editLocked:false,
      positionMm:{x:12000,y:9000},radiusMm:1000,color:'#FFFFFF',intensity:1,wallOcclusion:false,enabled:true}
    expect(validateSceneDocument(after).ok).toBe(true)
    const usage=measureTaskBudget(before,after)
    expect(usage.semanticTargets).toBe(33)
    expect(usage.geometryPoints).toBe(4097)
    expect(()=>assertTaskBudget(TASK_BUDGET_PROFILES.small,usage)).toThrow('geometryPoints')
  })
})
