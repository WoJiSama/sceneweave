import { describe, expect, it } from 'vitest'
import { domainExecutionFixture } from '../../../../../tools/testing/domain-execution-fixtures.js'
import { cloneJson, canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { createDomainExecutionRequest, executeDomainExecutionRequest } from '../../execution.js'
import { defaultMixedInput, runMixedGeneration, normalizeMixedInput } from './index.js'
import type { SceneDocument } from '../../../model/scene.js'

const options = { profile: taskBudgetProfile('standard'), nowMilliseconds: () => 0 }
const source = (kind: 'forest' | 'volcano') => {
  const base = domainExecutionFixture(kind).base
  Object.values(base.floors)[0].boundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  base.exportBoundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  return base
}
describe('real mixed module composition', () => {
  it.each(['forest', 'volcano'] as const)('delivers a deterministic %s building with native support, a real exterior doorway and a full-width approach', kind => {
    const base = source(kind), before = canonicalJson(base), input = defaultMixedInput(base, kind, 'mixed-test')
    input.parameters.building.arrangement.furniture = false
    const result = runMixedGeneration(base, input, options), document = cloneJson(result.candidate.document) as SceneDocument
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(result.report.roomIds.length).toBeGreaterThan(0)
    const room = document.rooms[result.report.roomIds[0]], support = document.terrainAreas[result.report.supportAreaId]
    expect(room.supportRef).toEqual({ kind: 'terrainArea', id: support.id }); expect(room.groundElevationMm).toBe(support.groundElevationMm)
    const port = resolveBuildingEntrancePort(document, result.report.entranceOpeningId, input.parameters.approach.widthMm), path = document.paths[result.report.approachPathId]
    expect(path.centerlineMm[0]).toEqual(input.parameters.approach.fromMm); expect(path.centerlineMm.at(-1)).toEqual(port.outsideMm)
    expect(checkTerrainRoute(document, { floorId: room.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).ok).toBe(true)
    expect(checkTerrainRoute(document, { floorId: room.floorId, pointsMm: [port.outsideMm, port.insideMm], widthMm: path.widthMm }).ok).toBe(true)
    const gen = getLegacyGeneration(document)!, buildingOwners = Object.values(gen.ownership).filter(owner => gen.rules[owner.ruleId].recipeRef.id === result.report.buildingRecipeId)
    expect(buildingOwners.some(owner => owner.target.entityId === support.id)).toBe(false)
    expect(Object.values(gen.ownership).filter(owner => owner.target.entityId === path.id)).toHaveLength(1)
    expect(Object.values(gen.recipes).some(recipe => 'domain' in recipe && recipe.domain === 'mixed')).toBe(true)
    expect(result.candidate.stages[0].beforeHash).toBe(result.candidate.sourceHash)
    expect(result.candidate.stages.at(-1)!.afterHash).toBe(result.candidate.documentHash)
    expect(result.candidate.usage.candidateAttempts).toBe(1)
    if (kind === 'forest') expect(result.report.propIds.length).toBeGreaterThan(0)
    const request = createDomainExecutionRequest({ requestId: 'mixed', context: { workspaceId: 'test', checkpoint: 0, epoch: 1 }, domain: 'mixed', base, input, profile: options.profile })
    const replay = executeDomainExecutionRequest(request, { nowMilliseconds: () => 0 })
    expect(replay.result.resultHash).toBe(result.resultHash); expect(replay.result.candidate.document).toEqual(document)
    expect(canonicalJson(base)).toBe(before)
  }, 30000)
  it('rejects unsupported sources, missing/wrong ports and real support/approach conflicts without mutating the base', () => {
    const base = source('volcano'), input = defaultMixedInput(base, 'volcano'), before = canonicalJson(base)
    const noEntrance = cloneJson(input); noEntrance.parameters.building.arrangement.entrance = false
    expect(() => normalizeMixedInput(noEntrance)).toThrow(/外门/)
    const wrongPort = cloneJson(input); wrongPort.parameters.approach.fromMm.x++
    expect(() => normalizeMixedInput(wrongPort)).toThrow(/锚点/)
    const noSupport = cloneJson(input); noSupport.parameters.building.boundsMm.x = 0
    expect(() => runMixedGeneration(base, noSupport, options)).toThrow()
    const blocked = cloneJson(input); blocked.parameters.approach.viaMm = [{ x: 1, y: 1 }]
    expect(() => runMixedGeneration(base, blocked, options)).toThrow(/净宽|支撑/)
    expect(() => runMixedGeneration(base, input, { ...options, signal: { aborted: true } })).toThrow(/取消/)
    let time = 0
    expect(() => runMixedGeneration(base, input, { ...options, nowMilliseconds: () => (time += 300001) })).toThrow(/时间超限/)
    expect(canonicalJson(base)).toBe(before)
  }, 30000)
})
