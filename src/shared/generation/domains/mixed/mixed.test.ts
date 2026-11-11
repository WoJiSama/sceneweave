import { describe, expect, it } from 'vitest'
import { domainExecutionFixture } from '../../../../../tools/testing/domain-execution-fixtures.js'
import { cloneJson, canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { createDomainExecutionRequest, executeDomainExecutionRequest } from '../../execution.js'
import { defaultMixedInput, defaultMixedInputV3, runMixedGeneration, normalizeMixedInput } from './index.js'
import type { SceneDocument } from '../../../model/scene.js'

const options = { profile: taskBudgetProfile('standard'), nowMilliseconds: () => 0 }
const source = (kind: 'forest' | 'volcano') => {
  const base = domainExecutionFixture(kind).base
  Object.values(base.floors)[0].boundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  base.exportBoundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  return base
}
describe('real mixed module composition', () => {
  it.each(['forest', 'volcano'] as const)('persists and exactly replays version 3 %s with a full-width normal door approach', kind => {
    const base = source(kind), before = canonicalJson(base), input = defaultMixedInputV3(base, kind, 'mixed-v3-fixed')
    expect(defaultMixedInput(base, kind).algorithmVersion).toBe(2)
    expect(input.algorithmVersion).toBe(3)
    input.parameters.building.arrangement.furniture = false
    if (kind === 'forest') input.parameters.approach.viaMm = [{ x: 10000, y: 22000 }, { x: 22000, y: 18000 }]
    const result = runMixedGeneration(base, input, options), document = cloneJson(result.candidate.document) as SceneDocument
    expect(validateSceneDocument(JSON.parse(JSON.stringify(document))).ok).toBe(true)
    const port = resolveBuildingEntrancePort(document, result.report.entranceOpeningId, input.parameters.approach.widthMm)
    const path = document.paths[result.report.approachPathId], last = path.centerlineMm.at(-1)!, previous = path.centerlineMm.at(-2)!
    expect(path.centerlineMm.slice(0, 1 + input.parameters.approach.viaMm.length)).toEqual([input.parameters.approach.fromMm, ...input.parameters.approach.viaMm])
    expect(last).toEqual(port.outsideMm)
    expect(Math.sign(last.x - previous.x)).toBe(Math.sign(port.insideMm.x - port.outsideMm.x))
    expect(Math.sign(last.y - previous.y)).toBe(Math.sign(port.insideMm.y - port.outsideMm.y))
    expect(Math.hypot(last.x - previous.x, last.y - previous.y)).toBeGreaterThanOrEqual(path.widthMm)
    for (const pointsMm of [path.centerlineMm, [...path.centerlineMm, port.insideMm]]) expect(checkTerrainRoute(document, { floorId: port.floorId, pointsMm, widthMm: path.widthMm }).ok).toBe(true)
    const recipes = Object.values(getLegacyGeneration(document)!.recipes)
    expect(recipes.find(recipe => recipe.algorithmId === 'mixed-layout')).toMatchObject({ recipeVersion: 3, algorithmVersion: 3 })
    expect(recipes.find(recipe => recipe.algorithmId === 'supported-interior')).toMatchObject({ recipeVersion: 2, algorithmVersion: 2 })
    expect(result.candidate.usage.gridNodes).toBeGreaterThan(0)
    expect(result.candidate.usage.intersectionPairs).toBeGreaterThan(0)
    const request = createDomainExecutionRequest({ requestId: 'mixed-v3', context: { workspaceId: 'test', checkpoint: 0, epoch: 1 }, domain: 'mixed', base, input, profile: options.profile })
    const replay = executeDomainExecutionRequest(request, { nowMilliseconds: () => 0 })
    expect(replay.result.resultHash).toBe(result.resultHash); expect(replay.result.candidate.document).toEqual(document)
    expect(canonicalJson(base)).toBe(before)
  }, 30000)

  it('refuses impossible version 3 explicit waypoints, cancellation and elapsed budgets without publishing a partial scene', () => {
    const base = source('volcano'), input = defaultMixedInputV3(base, 'volcano', 'mixed-v3-refuse'), before = canonicalJson(base)
    const blocked = cloneJson(input); blocked.parameters.approach.viaMm = [{ x: 1, y: 1 }]
    expect(() => runMixedGeneration(base, blocked, options)).toThrow(/净宽|支撑/)
    expect(() => runMixedGeneration(base, input, { ...options, signal: { aborted: true } })).toThrow(/取消/)
    let time = 0
    expect(() => runMixedGeneration(base, input, { ...options, nowMilliseconds: () => (time += 300001) })).toThrow(/时间超限/)
    expect(canonicalJson(base)).toBe(before)
  }, 30000)

  it('preserves the frozen version 1/2 forest and volcano replay fingerprints', () => {
    const fingerprints = [
      ['forest', 1,
        'e11eae7d95b696ad32485944f35ca01085350d576c6ed071f2fa7696edf9c305',
        'e855dca25dbb4396bd7582125e8a627c71a4f677d90fc8d2a3c8a3ce60a83b70'],
      ['forest', 2,
        '69ad58aa7ebeea4deb3e702c61bc81b21e0b56ca8bcd15fdf44163e9dc01f125',
        '0ea755231695949a5aec508fe5d6b74177dc961c6f4c3e24e8e5148a891a5f97'],
      ['volcano', 1,
        '21086fff0e05bfbf836467f95b45f26756a3754f6ca4bef0248568affa4c3527',
        'ddb190868783228d2c267b565def760a8cd56051655456cb9b60f111af6f60ff'],
      ['volcano', 2,
        '3147c0127f704348648684611583aa48c4af664887a357853375873aafa95aad',
        '59f0f96824609e617edbe392e9b5421dcf17197a9b74878eb02819ab0ea2fefb'],
    ] as const
    for (const [kind, algorithmVersion, resultHash, documentHash] of fingerprints) {
      const base = source(kind), input = defaultMixedInput(base, kind, 'mixed-legacy-fixed')
      input.algorithmVersion = algorithmVersion; input.parameters.building.arrangement.furniture = false
      const result = runMixedGeneration(base, input, options)
      expect(result.resultHash).toBe(resultHash); expect(result.candidate.documentHash).toBe(documentHash)
    }
  }, 30000)
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
