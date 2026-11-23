import { describe, expect, it } from 'vitest'
import { runtime } from '../../application/workspace/test-fixtures.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { applyCommands } from '../commands/commands.js'
import { terrainShorelineCommands } from '../commands/terrain-shoreline.js'
import type { PointMm, TerrainArea } from '../model/scene.js'
import { projectEditorScene, projectScene } from './projection.js'
import { planProjectedShorelines } from './shorelines.js'

const floorId = 'visual-floor', groundLayer = 'visual-layer-ground', shoreLayer = 'shore-layer'
const rect = (x: number, y: number, w: number, h: number): PointMm[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const area = (id: string, points: PointMm[], priority: number, elevation: number): TerrainArea => ({
  id, floorId, visibility: 'public', editLocked: false, groundElevationMm: elevation, coveragePriority: priority,
  boundaryMm: points.map((positionMm, index) => ({ id: `${id}-p${index}`, segmentId: `${id}-s${index}`, positionMm })),
  surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1,
})
const waterSurface = { version: 1 as const, color: '#396F80', highlightColor: '#DAEBDE', clarity: .78,
  waveDirectionDeg: 12, waveSpacingMm: 2100, waveStrength: .35, seed: 'shoreline-test' }

function fixture(waterInside = false) {
  const scene = createRefinedBlankDocument('island', { sceneId: 'native-shoreline', title: 'Native shoreline', widthMm: 24000, heightMm: 18000,
    preset: 'narrative', now: '2026-11-18T00:00:00.000Z' })
  scene.terrainAreas.outer = area('outer', rect(500, 500, 22000, 16000), 0, 0)
  scene.terrainAreas.inner = area('inner', rect(6000, 5000, 6200, 5500), 1, waterInside ? 0 : 250)
  const water = scene.terrainAreas[waterInside ? 'inner' : 'outer']
  water.waterSurface = waterSurface; water.blocksMovement = true
  scene.entityLayers.outer = groundLayer; scene.entityLayers.inner = groundLayer
  scene.userLayers[shoreLayer] = { id: shoreLayer, floorId, name: 'Shore', order: Object.keys(scene.userLayers).length, editLocked: false }
  return scene
}
const idFor = ({ segmentId }: { segmentId: string }) => `shore-${segmentId}`

function sources(indices: number[]) {
  return indices.map(index => ({ areaId: 'inner', segmentId: `inner-s${index}` }))
}

describe('native terrain shorelines', () => {
  it('supplies the physical line-art shore for water painted only by material and rejects private shores', () => {
    const scene = fixture(true), water = scene.terrainAreas.inner
    const material = scene.materials['refined-material-island-material-shallows']
    delete water.waterSurface
    water.surfaceStyle = { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: material.defaultTileSizeMm,
      rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
    const projected = projectScene(scene, 'player', undefined, { floorId })
    expect(projected.lineArtShorelines).toHaveLength(4)
    expect(projected.lineArtShorelines).toContainEqual([{ x: 12200, y: 5000 }, { x: 12200, y: 10500 }])
    expect(planProjectedShorelines(projected)).toEqual([])
    water.visibility = 'gm'
    scene.regions.mask = { id: 'mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false,
      movementCostMultiplier: 1, boundaryMm: rect(0, 0, 24000, 18000) }
    scene.entityLayers.mask = groundLayer
    expect(projectScene(scene, 'player', undefined, { floorId }).lineArtShorelines).toBeUndefined()
    expect(projectScene(scene, 'gm', undefined, { floorId }).lineArtShorelines).toEqual(projected.lineArtShorelines)
  })

  it('joins a complete cliff shore and reads moved source points without writing any painted geometry', () => {
    const before = fixture()
    const next = applyCommands(before, terrainShorelineCommands(before, sources([0, 1, 2, 3]), true, idFor), runtime)
    expect(next.terrainAreas).toEqual(before.terrainAreas)
    expect(next.visual).toEqual(before.visual)
    expect(Object.values(next.terrainEdges).every(edge => edge.kind === 'cliff' && edge.blocksMovement)).toBe(true)
    const [paint] = planProjectedShorelines(projectScene(next, 'player', undefined, { floorId }))
    expect(paint).toMatchObject({ closed: true, dryAreaId: 'inner', wetAreaId: 'outer', waterInward: false })
    const changed = { x: 5040, y: 4010 }
    const moved = applyCommands(next, [{ type: 'moveTerrainPoint', areaId: 'inner', pointId: 'inner-p0', positionMm: changed }], runtime)
    expect(moved.terrainEdges).toEqual(next.terrainEdges)
    const [after] = planProjectedShorelines(projectScene(moved, 'player', undefined, { floorId }))
    expect(after.points).toContainEqual(changed)
    expect(after.points).not.toContainEqual({ x: 6000, y: 5000 })
  })

  it('paints inward when the source is water and clears and reapplies a single stored edge', () => {
    const before = fixture(true), requested = sources([1])
    const configured = applyCommands(before, terrainShorelineCommands(before, requested, true, idFor), runtime)
    const paints = planProjectedShorelines(projectScene(configured, 'player', undefined, { floorId }))
    expect(paints).toEqual([expect.objectContaining({ closed: false, waterInward: true, wetAreaId: 'inner', dryAreaId: 'outer', points: [{ x: 12200, y: 5000 }, { x: 12200, y: 10500 }] })])
    const cleared = applyCommands(configured, terrainShorelineCommands(configured, requested, false, idFor), runtime)
    expect(planProjectedShorelines(projectScene(cleared, 'player', undefined, { floorId }))).toEqual([])
    const reapplied = applyCommands(cleared, terrainShorelineCommands(cleared, requested, true, idFor), runtime)
    expect(planProjectedShorelines(projectScene(reapplied, 'player', undefined, { floorId }))).toEqual(paints)
  })

  it('filters secret or editor-hidden shore paint before joining it with visible segments', () => {
    const before = fixture(true)
    const next = applyCommands(before, terrainShorelineCommands(before, sources([0, 1, 2]), true, idFor), runtime)
    next.terrainEdges['shore-inner-s1'].visibility = 'gm'
    next.entityLayers['shore-inner-s1'] = shoreLayer
    next.regions.mask = { id: 'mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1,
      boundaryMm: rect(0, 0, 24000, 18000) }
    next.entityLayers.mask = groundLayer
    expect(planProjectedShorelines(projectScene(next, 'gm', undefined, { floorId }))).toHaveLength(1)
    const player = planProjectedShorelines(projectScene(next, 'player', undefined, { floorId }))
    expect(player.map(run => run.points.length)).toEqual([2, 2])
    expect(planProjectedShorelines(projectEditorScene(next, { floorId, hiddenLayerIds: new Set([shoreLayer]) }))).toEqual(player)
  })
})
