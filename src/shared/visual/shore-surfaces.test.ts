import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { captureExecutionBudget, TASK_BUDGET_PROFILES } from '../budget/task-budget.js'
import { terrainPoints, pointInPolygon } from '../geometry/geometry.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { generateTerrainDocumentV4 } from '../terrain-generation/generate.js'
import { compositionPresetV4 } from '../terrain-generation/composition-presets.js'
import { materializeTerrainComposition } from '../terrain-generation/composition-materialize.js'
import { SHORE_MATERIAL_IDS } from './shore-art.js'
import { applyShoreSurfaceRecipe } from './shore-surfaces.js'
import { sampleVisualBoundary, terrainBoundaryChain } from './geometry.js'
import { visualBase } from './base.js'

/** Pure scene fixture. Actual source/PNG/bytes/permission proof belongs to the
 * separate complete-project and real browser materialization checks. */
function blank(palette: 'island' | 'coast' = 'island') {
  const scene = createRefinedBlankDocument(palette, { sceneId: 'shore-recipe', title: '新岸崖保存配方', now: '2026-10-30T00:00:00.000Z',
    widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const source = cloneJson(Object.values(scene.materials)[0])
  for (const [key, id] of Object.entries(SHORE_MATERIAL_IDS)) scene.materials[id] = { ...cloneJson(source), id, catalogId: `material.sceneweave.${id}`, version: 1,
    name: key, tags: [key], defaultTileSizeMm: { width: 3200, height: 3200 } }
  return scene
}
function physical(scene: SceneDocument) {
  return { terrain: Object.fromEntries(Object.entries(scene.terrainAreas).map(([id, { surfaceStyle: _style, ...area }]) => [id, area])),
    edges: scene.terrainEdges, paths: scene.paths, connections: scene.terrainConnections, props: scene.props, layers: scene.entityLayers }
}
describe('generation-5 frozen shore surface recipe', () => {
  it.each(['island','coast','river','lake','forest','hill','mixed'] as const)('saves %s surface details without moving physical geometry or changing input', kind => {
    const base = blank(kind === 'coast' ? 'coast' : 'island')
    const source = generateTerrainDocumentV4(base, { sceneId: base.sceneId, kind, seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000,
      algorithmVersion: 4, quality: 'standard', budgetProfileId: 'small' }).document
    const before = canonicalJson(source), meter = captureExecutionBudget(TASK_BUDGET_PROFILES.small)
    const next = applyShoreSurfaceRecipe(source, 'shore-fixed', { meter })
    expect(canonicalJson(source)).toBe(before)
    expect(physical(next)).toEqual(physical(source))
    const checked = validateSceneDocument(next)
    expect(checked.ok ? [] : checked.errors).toEqual([])
    expect(canonicalJson(applyShoreSurfaceRecipe(source, 'shore-fixed'))).toBe(canonicalJson(next))
    expect(meter.snapshot().dependencyRefs).toBeGreaterThan(0)
    if (kind === 'island' || kind === 'coast') expect(meter.snapshot().intersectionPairs).toBeGreaterThan(0)
    if (kind === 'island' || kind === 'coast') expect(next.terrainAreas['terrain-water'].surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.waterDeep)
    if (kind === 'island') {
      expect(next.terrainAreas['terrain-low'].surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.rockDry)
      expect(next.terrainAreas['terrain-high'].surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.grass)
      for (const area of Object.values(next.terrainAreas).filter(area => area.id.startsWith('terrain-reef-'))) expect(area.surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.rockDry)
    }
    if (kind === 'coast') expect(next.terrainAreas['terrain-low'].surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.sandDry)
    for (const area of Object.values(next.terrainAreas)) if (area.id.includes('shallow') && !area.blocksMovement) expect(area.surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.waterShallow)
    for (const area of Object.values(next.terrainAreas)) if (area.surfaceStyle) {
      expect(area.surfaceStyle.base.opacity).toBe(1)
      expect(area.surfaceStyle.base.alignment).toBe('world')
      for (const row of area.surfaceStyle.overlays) expect(row.boundaryMm.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
    }
    expect(visualBase(next)!.environment.lightDirectionDeg).toBe(135)
  })
  it('keeps exact rock identity despite moss-themed tags and saves joined shallow chunks covering convex shore joins', () => {
    const base = blank(), source = generateTerrainDocumentV4(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000,
      heightMm: 18000, algorithmVersion: 4, quality: 'standard', budgetProfileId: 'small' }).document
    const strata = source.materials['refined-material-island-material-strata']
    strata.name = '苔岛草木主题中的裸岩'
    strata.tags.push('岬湾苔岛', 'grass', 'moss')
    const next = applyShoreSurfaceRecipe(source, 'joined-coast'), low = next.terrainAreas['terrain-low'], water = next.terrainAreas['terrain-water']
    expect(low.surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.rockDry)
    const strips = water.surfaceStyle!.overlays.filter(row => row.paint.materialRef.id === SHORE_MATERIAL_IDS.waterShallow)
    expect(strips.length).toBeGreaterThan(0)
    expect(strips.length).toBeLessThan(low.boundaryMm.length / 3)
    expect(strips.every(row => row.paint.opacity === 1 && row.paint.alignment === 'world')).toBe(true)
    const waterMaterials = new Set<string>([SHORE_MATERIAL_IDS.waterDeep, SHORE_MATERIAL_IDS.waterShallow])
    const ring = terrainPoints(low), land = Object.values(next.terrainAreas).filter(area => !waterMaterials.has(area.surfaceStyle!.base.materialRef.id))
    let checked = 0
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], before = ring[(i + ring.length - 1) % ring.length], after = ring[(i + 1) % ring.length]
      const dx1 = p.x - before.x, dy1 = p.y - before.y, dx2 = after.x - p.x, dy2 = after.y - p.y
      if (dx1 * dy2 - dy1 * dx2 <= 0) continue
      const first = Math.hypot(dx1, dy1), second = Math.hypot(dx2, dy2), x = dy1 / first + dy2 / second, y = -dx1 / first - dx2 / second, length = Math.hypot(x, y)
      const sample = { x: Math.round(p.x + x / length * 500), y: Math.round(p.y + y / length * 500) }
      if (!pointInPolygon(sample, terrainPoints(water)) || land.some(area => pointInPolygon(sample, terrainPoints(area)))) continue
      expect(strips.some(row => pointInPolygon(sample, row.boundaryMm))).toBe(true)
      checked++
    }
    expect(checked).toBeGreaterThan(10)
  })
  it.each(['archipelago','forestValley','grassRidge','tidalCoast'] as const)('adds exact saved boundaries to %s composition without modifying current requirements or outputs', preset => {
    const base = blank(), generated = compositionPresetV4({ sceneId: base.sceneId, seed: 'composition-v4-fixed', preset,
      widthMm: 24000, heightMm: 18000, recipeVersion: 4, budgetProfileId: 'small', quality: 'standard' })
    const source = materializeTerrainComposition(base, generated.input, generated.requirements, generated.name, preset === 'tidalCoast' ? 'tidal-v2' : 'plain', 4, TASK_BUDGET_PROFILES.small).document
    const before = canonicalJson(source), next = applyShoreSurfaceRecipe(source, 'composition-shore')
    expect(canonicalJson(source)).toBe(before)
    expect(physical(next)).toEqual(physical(source))
    if (next.terrainAreas['t9-sea']) expect(next.terrainAreas['t9-sea'].surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.waterDeep)
    for (const area of Object.values(next.terrainAreas)) if (area.id.includes('shallow') && !area.blocksMovement) expect(area.surfaceStyle!.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.waterShallow)
    for (const boundary of Object.values(visualBase(next)!.boundaries)) if (boundary.binding.kind === 'terrain') {
      const sampled = sampleVisualBoundary(boundary).points
      for (const side of boundary.binding.sides) expect(terrainBoundaryChain(next.terrainAreas[side.areaId], side, boundary.closed).map(point => point.positionMm)).toEqual(side.reverse ? [...sampled].reverse() : sampled)
    }
    // Its original composition ledger is intentionally updated by the owning
    // generation-5 wrapper after the new complete appearances are fixed.
    expect(next.generation).toEqual(source.generation)
  })
  it('splits a >32-edge contour into exact open chains, preserving every original segment once', () => {
    const base = blank(), source = generateTerrainDocumentV4(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000,
      heightMm: 18000, algorithmVersion: 4, quality: 'standard', budgetProfileId: 'small' }).document
    const visual = visualBase(source)!, low = source.terrainAreas['terrain-low']
    for (const [id, boundary] of Object.entries(visual.boundaries)) if (boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => side.areaId === low.id)) {
      delete visual.boundaries[id]
      for (const [key, look] of Object.entries(visual.edgeLooks)) if (look.boundaryId === id) delete visual.edgeLooks[key]
    }
    const next = applyShoreSurfaceRecipe(source, 'open-chain'), made = Object.values(visualBase(next)!.boundaries).filter(row => row.binding.kind === 'terrain' && row.binding.sides.some(side => side.areaId === low.id))
    expect(terrainPoints(low).length).toBeGreaterThan(32)
    expect(made.length).toBeGreaterThan(1)
    expect(made.every(row => !row.closed && row.segments.length <= 32)).toBe(true)
    expect(made.reduce((sum, row) => sum + row.segments.length, 0)).toBe(low.boundaryMm.length)
    expect(validateSceneDocument(next).ok).toBe(true)
  })
  it('rejects private terrain instead of baking its shape into a public wet strip', () => {
    const base = blank(), source = generateTerrainDocumentV4(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000,
      heightMm: 18000, algorithmVersion: 4, quality: 'standard', budgetProfileId: 'small' }).document
    source.terrainAreas['terrain-high'].visibility = 'gm'
    expect(() => applyShoreSurfaceRecipe(source, 'private')).toThrow('私密地形')
  })
})
