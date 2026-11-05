import { describe, expect, it } from 'vitest'
import data from '../../../../platform/browser/content/scenes-data.json'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { sceneSchema, validateSceneDocument } from '../../../validation/scene.js'
import { supportedPolygon } from '../../../geometry/geometry.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { createSpaceContext } from '../../space.js'
import type { SceneDocument } from '../../../model/scene.js'
import { defaultVolcanoInput, runVolcanoGeneration, volcanoEntityId, VolcanoGenerationError } from './index.js'

const options = { profile: taskBudgetProfile('standard'), nowMilliseconds: () => 0 }
const stamp = '2026-11-05T00:00:00.000Z'
function source() {
  const document = createShoreBlankDocument('island', { sceneId: 'volcano-shared-test', title: '火山结构', now: stamp, widthMm: 40000, heightMm: 32000, preset: 'narrative' })
  for (const id of ['content-m-basalt', 'content-m-volcanic-ash', 'content-m-lava', 'content-m-lava-hot']) {
    const material = data.scenes.volcano.document.materials[id as keyof typeof data.scenes.volcano.document.materials]
    document.materials[id] = sceneSchema.shape.materials.valueType.parse(material)
    document.assets[material.textureAssetId] = sceneSchema.shape.assets.valueType.parse(data.scenes.volcano.document.assets[material.textureAssetId as keyof typeof data.scenes.volcano.document.assets])
  }
  return document
}
const physical = (document: SceneDocument) => Object.fromEntries((['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'regions'] as const).map(collection => [collection, Object.fromEntries(Object.entries(document[collection]).map(([id, value]) => [id, Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'surfaceStyle'))]))]))

describe('volcano discrete geometry and explicit policy', () => {
  it('replays a real lower crater, full-width connections, activity platform and external port without changing the source', () => {
    const base = source(), before = canonicalJson(base), input = defaultVolcanoInput(base), first = runVolcanoGeneration(base, input, options)
    expect(runVolcanoGeneration(base, input, options)).toEqual(first)
    expect(canonicalJson(base)).toBe(before)
    const document = cloneJson(first.candidate.document) as SceneDocument, report = first.report
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(document.terrainAreas[report.craterAreaId].groundElevationMm).toBeLessThan(document.terrainAreas[report.groundAreaId].groundElevationMm)
    expect(document.terrainAreas[report.craterAreaId].groundElevationMm).toBeLessThan(document.terrainAreas[report.mountainAreaId].groundElevationMm)
    expect(supportedPolygon(document, input.parameters.platform.boundaryMm, { kind: 'terrainArea', id: report.platformAreaId }, input.parameters.floorId)).toBe(true)
    for (const pathId of report.pathIds) {
      const path = document.paths[pathId]
      expect(checkTerrainRoute(document, { floorId: path.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).ok).toBe(true)
    }
    const port = createSpaceContext(document).artifacts.filter(row => row.kind === 'port' && row.payload.role === 'entrance')
    expect(port).toHaveLength(1)
    // The entrance is an initial suggestion. A later legal edit can invalidate
    // its support; keep the draft but do not publish a stale space fact.
    const groundBoundary = cloneJson(document.terrainAreas[report.groundAreaId].boundaryMm)
    groundBoundary[0].positionMm.x = 5000; groundBoundary[3].positionMm.x = 5000
    const edited = applyCommands(document, [
      { type: 'deleteOutdoorEntity', kind: 'path', id: report.pathIds[0] },
      { type: 'updateTerrainArea', id: report.groundAreaId, changes: { boundaryMm: groundBoundary } },
    ], { clock: { now: () => stamp }, ids: { nextId: () => crypto.randomUUID() } })
    expect(validateSceneDocument(edited).ok).toBe(true)
    expect(createSpaceContext(edited).artifacts.filter(row => row.kind === 'port' && row.payload.role === 'entrance')).toHaveLength(0)
    expect(report.connectionIds).toHaveLength(2)
    expect(getLegacyGeneration(document)!.recipes[volcanoEntityId(base.sceneId, input.seed, 'recipe')]).toMatchObject({ domain: 'volcano', algorithmVersion: 1, recipeVersion: 1 })
  }, 30000)
  it('changes actual crater and flow geometry, while a lava material change alone preserves all physical policy', () => {
    const base = source(), input = defaultVolcanoInput(base), first = runVolcanoGeneration(base, input, options)
    const changed = cloneJson(input)
    changed.parameters.crater.boundaryMm[0].y += 1000; changed.parameters.crater.boundaryMm[1].y += 1000
    changed.parameters.flow!.widthMm = 1600
    const second = runVolcanoGeneration(base, changed, options)
    expect(second.candidate.document.terrainAreas[second.report.craterAreaId].boundaryMm.map(p => p.positionMm)).not.toEqual(first.candidate.document.terrainAreas[first.report.craterAreaId].boundaryMm.map(p => p.positionMm))
    expect(second.candidate.document.terrainAreas[second.report.flowAreaId!].boundaryMm.map(p => p.positionMm)).not.toEqual(first.candidate.document.terrainAreas[first.report.flowAreaId!].boundaryMm.map(p => p.positionMm))
    const material = cloneJson(input); material.parameters.materials.flow = { id: 'content-m-lava', version: 1 }
    const painted = runVolcanoGeneration(base, material, options)
    expect(physical(painted.candidate.document as SceneDocument)).toEqual(physical(first.candidate.document as SceneDocument))
    expect(painted.candidate.document.terrainAreas[painted.report.flowAreaId!].surfaceStyle).not.toEqual(first.candidate.document.terrainAreas[first.report.flowAreaId!].surfaceStyle)
    expect(first.candidate.document.regions[volcanoEntityId(base.sceneId, input.seed, 'region:crater')]).toMatchObject({ kind: 'hazard', blocksMovement: false, movementCostMultiplier: 2 })
  }, 30000)
  it('refuses explicit full-width route blockers, third support at a connection, and cancelled work without publishing', () => {
    const base = source(), before = canonicalJson(base), blocked = defaultVolcanoInput(base)
    blocked.parameters.regions.push({ id: 'block-entry', boundaryMm: [{ x: 3500, y: 14000 }, { x: 5000, y: 14000 }, { x: 5000, y: 18000 }, { x: 3500, y: 18000 }], hazard: false, blocksMovement: true, movementCostMultiplier: 1 })
    expect(() => runVolcanoGeneration(base, blocked, options)).toThrow(/净宽|阻挡/)
    const third = defaultVolcanoInput(base)
    third.parameters.flow!.centerlineMm = [{ x: 23800, y: 15000 }, { x: 23800, y: 17000 }]
    expect(() => runVolcanoGeneration(base, third, options)).toThrow()
    expect(() => runVolcanoGeneration(base, defaultVolcanoInput(base), { ...options, signal: { aborted: true } })).toThrow()
    expect(canonicalJson(base)).toBe(before)
    const invalid = defaultVolcanoInput(base); invalid.parameters.crater.elevationMm = 3000
    try { runVolcanoGeneration(base, invalid, options); throw new Error('expected refusal') } catch (error) { expect(error).toBeInstanceOf(VolcanoGenerationError); expect((error as VolcanoGenerationError).code).toBe('contradiction') }
  }, 30000)
  it('persists manual danger changes and deletions through normal native ownership hooks without regeneration', () => {
    const base = source(), input = defaultVolcanoInput(base), result = runVolcanoGeneration(base, input, options), id = result.report.regionIds[0]
    const runtime = { clock: { now: () => stamp }, ids: { nextId: () => crypto.randomUUID() } }
    let document = applyCommands(cloneJson(result.candidate.document) as SceneDocument, [{ type: 'updateRegion', id, changes: { kind: 'terrain', blocksMovement: false, movementCostMultiplier: 1 } }], runtime)
    expect(document.regions[id]).toMatchObject({ kind: 'terrain', movementCostMultiplier: 1 })
    let owner = Object.values(getLegacyGeneration(document)!.ownership).find(row => row.target.entityId === id)!
    expect(owner.state).toBe('manual'); expect(owner.manualFields).toContain('properties')
    document = applyCommands(document, [{ type: 'deleteOutdoorEntity', kind: 'region', id }], runtime)
    owner = Object.values(getLegacyGeneration(document)!.ownership).find(row => row.target.entityId === id)!
    expect(document.regions[id]).toBeUndefined(); expect(owner.state).toBe('deleted'); expect(owner.birthToken).toBeTruthy()
    expect(validateSceneDocument(document).ok).toBe(true)
  }, 30000)
})
