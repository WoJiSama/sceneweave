import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../../../model/scene.js'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { generationRecipeSchema } from '../../../terrain-generation/contracts.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { planBuildingEntranceApproaches } from '../../entrance-approach.js'
import { normalizeSupportedInteriorInput, rectanglePoints, runSupportedInteriorGeneration } from './index.js'
import type { SupportedInteriorGenerationInput } from './contracts.js'

const options = { profile: taskBudgetProfile('small'), nowMilliseconds: () => 0 }
function fixture() {
  const source = createShoreBlankDocument('island', { sceneId: 'entrance-selection', title: '外门接入', now: '2026-11-12T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
  const runtime = { ids: { nextId: () => 'entrance-native' }, clock: { now: () => source.updatedAt } }
  const base = applyCommands(source, [{ type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground',
    boundaryMm: rectanglePoints({ x: 0, y: 0, width: 20000, height: 16000 }), groundElevationMm: 0 }], runtime)
  const input: Extract<SupportedInteriorGenerationInput, { algorithmVersion: 10 }> = { version: 1, algorithmVersion: 10, seed: 'joint-entrance', parameters: {
    floorId: 'visual-floor', layerId: 'visual-layer-ground', boundsMm: { x: 6000, y: 4000, width: 8000, height: 8000 }, wallThicknessMm: 200,
    rooms: [{ id: 'main', purpose: '公共休息室', minAreaMm2: 1_000_000, maxAreaMm2: 100_000_000, minClearSideMm: 2000 }], relations: [],
    corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null },
    arrangement: { doors: true, entrance: true, furniture: false, doorWidthMm: 1400, clearWidthMm: 1000, palette: [] },
    supportRef: { kind: 'terrainArea', id: 'ground' }, entranceApproach: { fromMm: { x: 2000, y: 8000 }, viaMm: [], widthMm: 1000 },
  } }
  return { base, input, runtime }
}
describe('supported building exterior door and approach selection', () => {
  it.each([
    [{ x: 2000, y: 8000 }, 180], [{ x: 18000, y: 8000 }, 0],
    [{ x: 10000, y: 1000 }, 270], [{ x: 10000, y: 14000 }, 90],
  ] as const)('faces the actual arrival %j with a real full-width door and no source edits', (fromMm, direction) => {
    const { base, input } = fixture(), before = canonicalJson(base)
    input.parameters.entranceApproach.fromMm = fromMm
    const result = runSupportedInteriorGeneration(base, input, options)
    const document = cloneJson(result.candidate.document) as SceneDocument, port = resolveBuildingEntrancePort(document, result.report.connectivity.entranceOpeningId!, 1000)
    expect(port.directionDeg).toBe(direction)
    expect(checkTerrainRoute(document, { floorId: port.floorId, pointsMm: [fromMm, port.outsideMm, port.insideMm], widthMm: 1000 }).ok).toBe(true)
    expect(result.report.connectivity.routes.every(route => route.status === 'clear')).toBe(true)
    expect(result.candidate.usage.gridNodes).toBeGreaterThan(0); expect(result.candidate.usage.candidateAttempts).toBeLessThanOrEqual(4)
    expect(validateSceneDocument(document).ok).toBe(true); expect(canonicalJson(base)).toBe(before)
    const recipe = Object.values(getLegacyGeneration(document)!.recipes).find(row => row.algorithmId === 'supported-interior')!
    expect(recipe).toMatchObject({ recipeVersion: 10, algorithmVersion: 10, parameters: { entranceApproach: input.parameters.entranceApproach } })
    expect(generationRecipeSchema.safeParse(recipe).success).toBe(true)
  })

  it('uses the last explicit waypoint for arrival while retaining the full prefix and exact deterministic replay', () => {
    const { base, input } = fixture()
    input.parameters.entranceApproach.viaMm = [{ x: 18000, y: 2000 }, { x: 18000, y: 8000 }]
    input.parameters.entranceApproach.fromMm = { x: 2000, y: 2000 }
    const result = runSupportedInteriorGeneration(base, input, options), d = cloneJson(result.candidate.document) as SceneDocument
    const port = resolveBuildingEntrancePort(d, result.report.connectivity.entranceOpeningId!, 1000)
    expect(port.directionDeg).toBe(0)
    const plan = planBuildingEntranceApproaches({ port, ...input.parameters.entranceApproach, buildingBoundsMm: input.parameters.boundsMm, wallThicknessMm: 200 })
    expect(plan.variantsMm.some(pointsMm => checkTerrainRoute(d, { floorId: port.floorId, pointsMm: [...pointsMm, port.insideMm], widthMm: 1000 }).ok)).toBe(true)
    for (const points of plan.variantsMm) expect(points.slice(0, 3)).toEqual([input.parameters.entranceApproach.fromMm, ...input.parameters.entranceApproach.viaMm])
    expect(runSupportedInteriorGeneration(base, input, options)).toEqual(result)
  })

  it('rejects blocked explicit prefixes, unsupported old-version parameters, cancellation and actual work limits without changing the source', () => {
    const { base, input } = fixture(), before = canonicalJson(base)
    const old = { ...input, algorithmVersion: 9 }
    expect(() => normalizeSupportedInteriorInput(old)).toThrow(/输入无效/)
    expect(() => normalizeSupportedInteriorInput({ ...input, parameters: { ...input.parameters, entranceApproach: { ...input.parameters.entranceApproach, viaMm: Array(17).fill({ x: 2000, y: 2000 }) } } })).toThrow(/输入无效/)
    input.parameters.entranceApproach.viaMm = [{ x: 10000, y: 8000 }]
    expect(() => runSupportedInteriorGeneration(base, input, options)).toThrow(/有限外门/)
    input.parameters.entranceApproach.viaMm = []
    expect(() => runSupportedInteriorGeneration(base, input, { ...options, signal: { aborted: true } })).toThrow(/取消/)
    const profile = cloneJson(options.profile); profile.limits.gridNodes = 1
    expect(() => runSupportedInteriorGeneration(base, input, { ...options, profile })).toThrow(/预算|超限/)
    expect(canonicalJson(base)).toBe(before)
  })

  it('uses real physical obstruction checks rather than accepting the shortest geometric suggestion', () => {
    const { base, input, runtime } = fixture()
    const blocked = applyCommands(base, [{ type: 'createRegion', id: 'block-closest', floorId: 'visual-floor', layerId: 'visual-layer-ground', kind: 'hazard',
      boundaryMm: rectanglePoints({ x: 4200, y: 6900, width: 1300, height: 2200 }), blocksMovement: true }], runtime)
    const result = runSupportedInteriorGeneration(blocked, input, options), d = cloneJson(result.candidate.document) as SceneDocument
    const port = resolveBuildingEntrancePort(d, result.report.connectivity.entranceOpeningId!, 1000)
    const plan = planBuildingEntranceApproaches({ port, ...input.parameters.entranceApproach, buildingBoundsMm: input.parameters.boundsMm, wallThicknessMm: 200 })
    expect(plan.variantsMm.some(pointsMm => checkTerrainRoute(d, { floorId: port.floorId, pointsMm: [...pointsMm, port.insideMm], widthMm: 1000 }).ok)).toBe(true)
    expect(d.regions).toEqual(blocked.regions)
  })
})
