import { describe, expect, it } from 'vitest'
import data from '../../../../platform/browser/content/scenes-data.json'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { sceneSchema, validateSceneDocument } from '../../../validation/scene.js'
import { supportedPolygon, terrainPoints } from '../../../geometry/geometry.js'
import { reliefBounds } from '../../../geometry/terrain-relief.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { createSpaceContext } from '../../space.js'
import type { SceneDocument } from '../../../model/scene.js'
import { defaultVolcanoInput, reviewSavedVolcano, runVolcanoGeneration, volcanoEntityId, VolcanoGenerationError, VOLCANO_DEFAULTS, type VolcanoDesign } from './index.js'
import { calderaLayout } from './caldera.js'
import { createDomainExecutionRequest, executeDomainExecutionRequest } from '../../execution.js'
import { volcanoGenerationRecipeSchema } from '../../../terrain-generation/contracts.js'

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

describe('volcano first-generation relief', () => {
  it.each([['cinder-basin-58', 40, 'stairs'], ['volcano-1', 36, 'stairs'], ['broken-ridge-23', 40, 'ramp']] as const)(
    'preserves the complete routes, platform and lava rules for %s', (seed, craterHeightPercent, kind) => {
      const base = source(), input = defaultVolcanoInput(base, seed), p = input.parameters
      const halfHeight = p.boundsMm.height * craterHeightPercent / 200
      p.crater.boundaryMm[0].y = p.crater.boundaryMm[1].y = 16000 - halfHeight
      p.crater.boundaryMm[2].y = p.crater.boundaryMm[3].y = 16000 + halfHeight
      p.crater.elevationMm = 500
      p.descent.kind = p.ascent.kind = kind
      p.flow!.widthMm = 1400
      const layout = calderaLayout(p, seed)
      expect(layout).toBeDefined()
      Object.assign(p, layout)
      const result = runVolcanoGeneration(base, input, options), scene = result.candidate.document as SceneDocument
      expect(scene.terrainAreas[result.report.mountainAreaId].relief?.offsetsMm.some(height => height > 1000)).toBe(true)
      expect(scene.terrainAreas[result.report.craterAreaId].groundElevationMm).toBe(500)
      const lava = scene.terrainAreas[result.report.flowAreaId!]
      expect(lava.boundaryMm.length).toBeGreaterThan(16)
      expect(scene.regions[volcanoEntityId(base.sceneId, seed, 'region:flow')]).toMatchObject({ kind: 'hazard', blocksMovement: true,
        movementCostMultiplier: 3, boundaryMm: lava.boundaryMm.map(point => point.positionMm) })
      for (const id of result.report.connectionIds) expect(scene.terrainConnections[id]).toMatchObject({ kind, widthMm: 1500 })
      for (const id of result.report.pathIds) {
        const path = scene.paths[id]
        expect(checkTerrainRoute(scene, { floorId: path.floorId, widthMm: path.widthMm, pointsMm: path.centerlineMm }).ok).toBe(true)
      }
      expect(runVolcanoGeneration(base, input, options).resultHash).toBe(result.resultHash)
    }, 30000)
})

const adaptiveInput = (base: SceneDocument, overrides: Partial<VolcanoDesign> = {}) => {
  const { shape, entranceSide, breachSide, craterWidthPercent, craterHeightPercent, craterCenterYPercent } = VOLCANO_DEFAULTS
  const original = defaultVolcanoInput(base, VOLCANO_DEFAULTS.seed), p = original.parameters
  p.mountain.elevationMm = VOLCANO_DEFAULTS.mountainElevationMm
  p.crater.elevationMm = VOLCANO_DEFAULTS.craterElevationMm
  p.ascent.kind = p.descent.kind = VOLCANO_DEFAULTS.connectionKind
  p.flow!.widthMm = VOLCANO_DEFAULTS.flowWidthMm
  return { ...original, algorithmVersion: 2 as const, design: { shape, entranceSide, breachSide, craterWidthPercent, craterHeightPercent, craterCenterYPercent, ...overrides } }
}

describe('adaptive natural crater generation', () => {
  it('replays the default map through the worker contract and checks its saved passage and eastern notch', () => {
    const base = source(), input = adaptiveInput(base)
    const request = createDomainExecutionRequest({ requestId: 'caldera', context: { workspaceId: 'test', checkpoint: 0, epoch: 1 },
      domain: 'volcano', base, input, profile: options.profile })
    const result = executeDomainExecutionRequest(request, options).result, document = result.candidate.document as SceneDocument
    const p = input.parameters, report = result.report, review = reviewSavedVolcano(document, p.floorId)!
    expect(report).toMatchObject({ shape: 'natural', breachSide: 'east' })
    expect(terrainPoints(document.terrainAreas[report.mountainAreaId]).length).toBeGreaterThan(4)
    expect(reliefBounds(terrainPoints(document.terrainAreas[report.craterAreaId])).width).toBe(12800)
    expect(review.routeChecks.map(row => [row.ok, row.traversal?.stepCount])).toEqual([[true, 11], [true, 12]])
    expect(review.breach).toMatchObject({ side: 'east', ok: true })
    expect(review.breach!.lowElevationMm).toBeLessThan(1000)
    const saved = volcanoGenerationRecipeSchema.parse(getLegacyGeneration(document)!.recipes[volcanoEntityId(base.sceneId, input.seed, 'recipe')])
    expect(saved).toMatchObject({ recipeVersion: 2, algorithmVersion: 2 })
    expect(volcanoGenerationRecipeSchema.safeParse({ ...saved, recipeVersion: 1 }).success).toBe(false)
    const replay = runVolcanoGeneration(base, { version: 1, algorithmVersion: 2, seed: input.seed, parameters: saved.parameters }, options)
    expect(replay.candidate.documentHash).toEqual(result.candidate.documentHash)
    const edited = cloneJson(document)
    delete edited.paths[report.pathIds[0]]
    expect(reviewSavedVolcano(edited, p.floorId)?.routeChecks[0].ok).toBe(false)
  }, 30000)

  it('fits a 40 percent crater by trying another real layout at the requested size', () => {
    const base = source(), input = adaptiveInput(base, { craterWidthPercent: 40, craterHeightPercent: 34, craterCenterYPercent: 52 })
    const result = runVolcanoGeneration(base, input, options), crater = result.candidate.document.terrainAreas[result.report.craterAreaId]
    expect(result.report.shape).toBe('natural')
    expect(reliefBounds(crater.boundaryMm.map(point => point.positionMm)).width).toBe(16000)
    expect(result.candidate.usage.candidateAttempts).toBeGreaterThan(1)
    expect(result.candidate.usage.candidateAttempts).toBeLessThanOrEqual(options.profile.limits.candidateAttempts)
    expect(result.candidate.usage.intersectionPairs).toBeGreaterThan(0)
  }, 30000)

  it('keeps wide passages and lava, and places an independent southern breach', () => {
    const base = source(), input = adaptiveInput(base, { entranceSide: 'east', breachSide: 'south' })
    input.parameters.route.widthMm = 3000
    input.parameters.flow!.widthMm = 3800
    const { candidate, report } = runVolcanoGeneration(base, input, options), scene = candidate.document as SceneDocument
    const review = reviewSavedVolcano(scene, input.parameters.floorId)!
    expect(review.routeChecks.every(row => row.ok && row.widthMm === 3000)).toBe(true)
    expect(scene.paths[report.pathIds[0]].centerlineMm[0].x).toBeGreaterThan(32000)
    expect(review.breach).toMatchObject({ side: 'south', ok: true })
    const saved = getLegacyGeneration(scene)!.recipes[volcanoEntityId(base.sceneId, input.seed, 'recipe')]
    expect(saved).toMatchObject({ parameters: { route: { widthMm: 3000 }, flow: { widthMm: 3800 } } })
  }, 30000)

  it('accepts a larger lava width when its complete band fits the basin', () => {
    const base = source(), bounds = { x: 0, y: 0, width: 120000, height: 96000 }
    Object.values(base.floors)[0].boundsMm = bounds
    base.exportBoundsMm = bounds
    const input = adaptiveInput(base)
    input.parameters.flow!.widthMm = 11000
    expect(runVolcanoGeneration(base, input, options).report).toMatchObject({ shape: 'natural', flowAreaId: expect.any(String) })
  }, 30000)

  it('checks real ramp grade and reports genuine shape conflicts without downgrading', () => {
    const base = source(), input = adaptiveInput(base)
    input.parameters.ascent.kind = input.parameters.descent.kind = 'ramp'
    const result = runVolcanoGeneration(base, input, options)
    expect(result.report.traversal?.every(row => row.kind === 'ramp' && row.riseMm * 2 <= row.runMm)).toBe(true)
    const tooHigh = cloneJson(input)
    tooHigh.parameters.mountain.elevationMm = 6200
    expect(() => runVolcanoGeneration(base, tooHigh, options)).toThrow(/纵坡过陡.*至少需要 12400 mm/)
    expect(() => runVolcanoGeneration(base, adaptiveInput(base, { craterWidthPercent: 80 }), options)).toThrow(/自然火口.*未找到满足请求的候选/)
    const terrace = runVolcanoGeneration(base, adaptiveInput(base, { shape: 'terrace', breachSide: 'none' }), options)
    expect(terrace.report.shape).toBe('terrace')
    expect(terrace.candidate.document.terrainAreas[terrace.report.mountainAreaId].boundaryMm).toHaveLength(4)
  }, 30000)
})
