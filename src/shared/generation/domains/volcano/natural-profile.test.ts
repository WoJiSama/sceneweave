import { describe, expect, it } from 'vitest'
import { createVolcanicSurfacesCatalogDocument } from '../../../../platform/browser/content/volcanic-surfaces-catalog.js'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { measureCommandBudget, selectManualTransactionBudget } from '../../../budget/command-budget.js'
import { polygonsOverlap, polygonInside, terrainPoints } from '../../../geometry/geometry.js'
import { assertTerrainConnectionClearances, checkTerrainRoute, checkTerrainTravel } from '../../../geometry/terrain-travel.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { visualBase } from '../../../visual/base.js'
import { sampleVisualBoundary } from '../../../visual/geometry.js'
import { projectScene } from '../../../projection/projection.js'
import type { SceneDocument } from '../../../model/scene.js'
import { createNaturalVolcanoProfile, naturalVolcanoFinishCommands } from './natural-profile.js'
import { checkVolcanoResult, normalizeVolcanoInput, runVolcanoGeneration } from './index.js'

const now = '2026-11-12T00:00:00.000Z'
function source() {
  const base = createVolcanicSurfacesCatalogDocument({ sceneId: 'natural-volcano-test', now })
  const bounds = { x: 0, y: 0, width: 50000, height: 38000 }
  Object.values(base.floors)[0].boundsMm = { ...bounds }; base.exportBoundsMm = { ...bounds }
  return base
}
describe('explicit natural volcano authoring', () => {
  it('keeps bounded sampled rings, nesting and the original input immutable', () => {
    const base = source(), before = canonicalJson(base), profile = createNaturalVolcanoProfile(base)
    expect(createNaturalVolcanoProfile(base)).toEqual(profile)
    expect(normalizeVolcanoInput(profile.input)).toEqual(profile.input)
    expect(canonicalJson(base)).toBe(before)
    for (const ring of [profile.input.parameters.mountain.boundaryMm, profile.input.parameters.crater.boundaryMm, profile.input.parameters.platform.boundaryMm]) {
      expect(ring.length).toBeGreaterThan(8); expect(ring.length).toBeLessThanOrEqual(64)
      expect(ring.every(p => Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y))).toBe(true)
    }
    expect(profile.input.parameters.flow).toBeNull()
    for (const boundary of Object.values(profile.contours)) {
      expect(boundary.toleranceMm).toBe(20)
      expect(boundary.sampleSpacingMm).toBeLessThanOrEqual(1000)
      expect(sampleVisualBoundary(boundary).points.length).toBeLessThanOrEqual(256)
    }
  })
  it('uses native curves, matching lava policy and real natural-rock stairs while preserving full-width travel', () => {
    const base = source(), profile = createNaturalVolcanoProfile(base)
    const generated = runVolcanoGeneration(base, profile.input, { profile: taskBudgetProfile('standard'), nowMilliseconds: () => 0 })
    const before = cloneJson(generated.candidate.document) as SceneDocument
    let serial = 0
    const commands = naturalVolcanoFinishCommands(before, profile, generated.report), budget = selectManualTransactionBudget(before)
    expect(budget.semanticTargets).toBe(256)
    expect(commands.length).toBeLessThanOrEqual(256)
    const final = applyCommands(before, commands, {
      clock: { now: () => now }, ids: { nextId: () => `natural-volcano-edit-${++serial}` },
    }, { budget })
    expect(measureCommandBudget(before, final, undefined, {}, budget).semanticTargets).toBeLessThanOrEqual(256)
    expect(validateSceneDocument(final).ok).toBe(true)
    checkVolcanoResult(final, profile.input, generated.report)
    const lava = final.terrainAreas[profile.lavaAreaId], hazard = final.regions[profile.lavaRegionId]
    expect(lava.groundElevationMm).toBe(profile.input.parameters.crater.elevationMm)
    expect(lava.blocksMovement).toBe(false)
    expect(hazard).toMatchObject({ kind: 'hazard', blocksMovement: true, movementCostMultiplier: 4 })
    expect(hazard.boundaryMm).toEqual(terrainPoints(lava))
    expect(polygonInside(terrainPoints(lava), terrainPoints(final.terrainAreas[generated.report.craterAreaId]))).toBe(true)
    expect(polygonsOverlap(terrainPoints(lava), terrainPoints(final.terrainAreas[generated.report.platformAreaId]))).toBe(false)
    for (const [key, id] of [['mountain', generated.report.mountainAreaId], ['crater', generated.report.craterAreaId], ['platform', generated.report.platformAreaId]] as const) {
      expect(terrainPoints(final.terrainAreas[id])).toEqual(sampleVisualBoundary(profile.contours[key]).points)
      const { boundaryMm: _old, ...oldPolicy } = before.terrainAreas[id], { boundaryMm: _next, surfaceStyle: _style, ...nextPolicy } = final.terrainAreas[id]
      const { surfaceStyle: _oldStyle, ...physicalPolicy } = oldPolicy
      expect(nextPolicy).toEqual(physicalPolicy)
    }
    const craterRegion = generated.report.regionIds[0]
    expect(final.regions[craterRegion]).toEqual({ ...before.regions[craterRegion], boundaryMm: terrainPoints(final.terrainAreas[generated.report.craterAreaId]) })
    expect(Object.values(final.terrainEdges)).toHaveLength(0)
    const projectedEdges = projectScene(final, 'player').edges
    expect(projectedEdges.length).toBeGreaterThan(100)
    expect(projectedEdges.every(edge => edge.kind === 'cliff' && edge.elevationMm !== edge.neighborElevationMm)).toBe(true)
    const blockedCrossing = { floorId: profile.input.parameters.floorId, from: { x: 5000, y: 11000 }, to: { x: 17000, y: 11000 }, widthMm: 800 }
    expect(checkTerrainTravel(before, blockedCrossing).ok).toBe(false)
    expect(checkTerrainTravel(final, blockedCrossing).ok).toBe(false)
    const authored = cloneJson(before) as SceneDocument
    Object.values(authored.terrainEdges)[0].blocksSight = true
    expect(() => naturalVolcanoFinishCommands(authored, profile, generated.report)).toThrow('人工语义')
    for (const id of generated.report.pathIds) {
      const path = final.paths[id]
      expect(checkTerrainRoute(final, { floorId: path.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).ok).toBe(true)
    }
    for (const id of generated.report.connectionIds) expect(final.terrainConnections[id].route).toMatchObject({ stairStyle: 'naturalRock', renderProfile: 'naturalRockSteps4' })
    assertTerrainConnectionClearances(final, generated.report.connectionIds.map(connectionId => ({ connectionId,
      minWidthMm: profile.input.parameters.route.widthMm, approachDepthMm: Math.floor(profile.input.parameters.route.widthMm / 3) })))
    expect(Object.values(visualBase(final)!.edgeLooks)).toHaveLength(3)
  }, 30_000)
})
