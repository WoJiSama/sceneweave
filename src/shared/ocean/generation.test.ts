import { describe, it, expect, vi } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createOceanDocument } from '../../platform/browser/content/ocean-sample.js'
import { generateTerrainDocumentV5 } from '../terrain-generation/surface-generation.js'
import { planOceanDressing } from './generation.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { applyCommands } from '../commands/commands.js'
import { validateSceneDocument } from '../validation/scene.js'
import { floorEntrances } from '../floors/links.js'
import { createShipInteriorDocument } from '../../platform/browser/content/ship-interior.js'

vi.mock('../../platform/browser/runtime.js', () => ({ runtime: { ids: { nextId: () => 'ocean-stage-unit' }, clock: { now: () => '2026-11-17T00:00:00.000Z' } }, validation: {} }))
const context = { ids: { nextId: () => 'stage-unused' }, clock: { now: () => '2026-11-17T00:00:00.000Z' } }
const settings = { recipeVersion: 1 as const, seed: 'terrain-v1-0', preset: 'calm' as const, boat: true, creatures: true }
function fixture(kind: 'coast' | 'island', widthMm = 36000, heightMm = 24000, seed = settings.seed) {
  const base = createShoreBlankDocument(kind, { sceneId: 'ocean-stage-unit', title: 'Ocean generation', widthMm, heightMm, preset: 'narrative' })
  const generated = generateTerrainDocumentV5(base, { seed,
    sceneId: base.sceneId, kind, widthMm, heightMm, algorithmVersion: 5, budgetProfileId: 'standard', quality: 'standard' })
  const sources = createOceanDocument()
  Object.assign(generated.document.assets, sources.assets); Object.assign(generated.document.propDefinitions, sources.propDefinitions)
  return generated.document
}
describe('ordinary terrain followed by finite marine dressing', () => {
  for (const kind of ['coast', 'island'] as const) for (const [width, height] of [[36000, 20000], [48000, 36000]]) for (const seed of ['ocean-final-0', 'ocean-final-1', 'ocean-final-2']) {
    it(`recipe2 ${kind} ${width}x${height} ${seed} retains real sizes and deterministic finite placement`, () => {
      const scene = fixture(kind, width, height, seed), options = { ...settings, recipeVersion: 2 as const, seed }
      const plan = planOceanDressing(scene, options)
      expect(planOceanDressing(scene, options)).toEqual(plan)
      const result = applyCommands(scene, plan.commands, context)
      expect(validateSceneDocument(result).ok).toBe(true)
      expect(plan.report.placed.length).toBeGreaterThan(0)
      expect(plan.report.placed.length + plan.report.skipped.length).toBe(5)
      expect(plan.report.attempts).toBeLessThanOrEqual(480)
      for (const prop of Object.values(result.props).filter(p => p.waterAppearance)) {
        expect(prop.visualBoundsMm).toEqual(result.propDefinitions[prop.definitionRef!.id].defaultVisualBoundsMm)
      }
    })
  }
  for (const kind of ['coast', 'island'] as const) it(`uses ${kind} geometry, fixed props and ordinary validated commands deterministically`, () => {
    const scene = fixture(kind), before = canonicalJson(scene)
    const plan = planOceanDressing(scene, settings)
    expect(planOceanDressing(scene, settings)).toEqual(plan)
    expect(canonicalJson(scene)).toBe(before)
    const dressed = applyCommands(scene, plan.commands, context)
    expect(validateSceneDocument(dressed).ok).toBe(true)
    expect(plan.report.waterCount).toBeGreaterThan(0)
    expect(plan.report.placed.length).toBeGreaterThan(0)
    expect(plan.report.placed.length + plan.report.skipped.length).toBe(5)
    for (const area of Object.values(scene.terrainAreas)) {
      const after = dressed.terrainAreas[area.id]
      expect(after.boundaryMm).toEqual(area.boundaryMm); expect(after.surfaceStyle).toEqual(area.surfaceStyle)
      expect(after.blocksMovement).toBe(area.blocksMovement); expect(after.groundElevationMm).toBe(area.groundElevationMm)
    }
    expect(() => planOceanDressing(dressed, settings)).toThrow(/已有水面/)
    const locked = cloneJson(scene); Object.values(locked.userLayers).forEach(layer => { layer.editLocked = true })
    expect(() => applyCommands(locked, plan.commands, context)).toThrow(/锁定/)
  })
  it('returns the same exact coordinates when traversing either side of a Floor link', () => {
    const scene = createShipInteriorDocument(), deck = floorEntrances(scene, 'collection-floor')[0]
    const back = floorEntrances(scene, deck.targetFloorId).find(row => row.link.id === deck.link.id)!
    expect(deck.targetMm).toEqual(back.positionMm); expect(back.targetMm).toEqual(deck.positionMm)
    expect(back.targetFloorId).toBe('collection-floor')
  })
})
