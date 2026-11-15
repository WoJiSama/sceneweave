import { describe, expect, it } from 'vitest'
import builtin from '../../platform/browser/content/builtin-data.json'
import type { SceneDocument, TerrainArea } from '../model/scene.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { emptyVisualSystem } from './types.js'
import { visualBase } from './base.js'
import { applyCommands } from '../commands/commands.js'
import { terrainCliffStyleCommands, terrainCliffBindings } from './terrain-cliff-style.js'
import { validateSceneDocument } from '../validation/scene.js'

function fixture(count = 4) {
  const scene = toCurrentSceneDocument(structuredClone(builtin.project.document) as unknown as SceneDocument)
  const floorId = Object.keys(scene.floors)[0], layerId = 'cliff-layer'
  scene.floors[floorId].boundsMm = { x: -10000, y: -10000, width: 30000, height: 30000 }; scene.exportBoundsMm = { ...scene.floors[floorId].boundsMm }
  scene.userLayers = { [layerId]: { id: layerId, floorId, name: '地形层', order: 0, editLocked: false } }
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.paths = {}; scene.terrainConnections = {}
  scene.terrainAreas = {}; scene.terrainEdges = {}; scene.props = {}; scene.notes = {}; scene.regions = {}
  scene.prefabInstances = {}; scene.scatterGroups = {}; scene.decorations = {}; scene.decorationClusters = {}; scene.surfaceRules = {}
  scene.entityLayers = {}; scene.constraints = { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }
  scene.generation = createEmptyGeneration5(); scene.visual = { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }
  delete scene.aggregateCoordinates
  const positions = count === 4 ? [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 }]
    : Array.from({ length: count }, (_, i) => ({ x: Math.round(4000 + 3500 * Math.cos(i / count * Math.PI * 2)), y: Math.round(4000 + 3500 * Math.sin(i / count * Math.PI * 2)) }))
  const area: TerrainArea = { id: 'independent-terrain', floorId, editLocked: false, visibility: 'public', groundElevationMm: 2300, coveragePriority: 1,
    boundaryMm: positions.map((positionMm, index) => ({ id: `point-${index}`, segmentId: `edge-${index}`, positionMm })),
    surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainAreas[area.id] = area; scene.entityLayers[area.id] = layerId
  let sequence = 0
  const context = { ids: { nextId: () => 'new-cliff-' + ++sequence }, clock: { now: () => '2026-11-13T00:00:00.000Z' } }
  const propose = (value: SceneDocument = scene) => terrainCliffStyleCommands(value, { areaId: area.id, profile: 'rockRelief9' }, context.ids.nextId)
  return { scene, area, floorId, layerId, context, propose }
}

describe('terrain-selected cliff style proposals', () => {
  it.each([4, 40])('automatically binds all %i original edges without moving, rotating or replacing the saved terrain', count => {
    const { scene, area, context, propose } = fixture(count), before = structuredClone(scene)
    expect(validateSceneDocument(scene).ok).toBe(true)
    const commands = propose(), changed = applyCommands(scene, commands, context)
    expect(commands.filter(command => command.type === 'upsertVisualBoundary')).toHaveLength(count === 4 ? 1 : 2)
    expect(changed.terrainAreas).toEqual(before.terrainAreas)
    expect(changed.terrainConnections).toEqual(before.terrainConnections); expect(changed.terrainEdges).toEqual(before.terrainEdges)
    expect(changed.materials).toEqual(before.materials); expect(changed.assets).toEqual(before.assets)
    expect(changed.entityLayers).toEqual(before.entityLayers); expect(scene).toEqual(before)
    expect(validateSceneDocument(changed).ok).toBe(true)
    expect(propose(changed)).toEqual([])
    expect(terrainCliffBindings(changed, area.id).every(item => item.looks.length === 1)).toBe(true)
  })

  it('switches only the explicitly chosen existing boundary, preserving custom paint, privacy, disabled state and other styles', () => {
    const { scene, area, context, propose } = fixture(40), bound = applyCommands(scene, propose(), context), visual = visualBase(bound)!
    const [first, other] = terrainCliffBindings(bound, area.id), look = first.looks[0]
    Object.assign(look, { opacity: .43, intensity: .56, widthMm: 730, repeatMm: 510, seed: 'authored-seed', color: '#123456', accentColor: '#ABCDEF', visibility: 'gm', enabled: false })
    const before = structuredClone(bound)
    const commands = terrainCliffStyleCommands(bound, { areaId: area.id, boundaryId: first.boundary.id, profile: 'rockRelief7' }, context.ids.nextId)
    expect(commands).toEqual([{ type: 'upsertVisualEdgeLook', edgeLook: { ...look, renderProfile: 'rockRelief7' } }])
    const changed = applyCommands(bound, commands, context)
    expect(visualBase(changed)!.edgeLooks[other.looks[0].id]).toEqual(other.looks[0])
    expect(visualBase(changed)!.boundaries).toEqual(visual.boundaries); expect(changed.terrainAreas).toEqual(bound.terrainAreas)
    expect(bound).toEqual(before)
  })

  it('uses existing bindings without a look, adds only missing segments, and never rebinds existing terrain controls', () => {
    const { scene, area, context, propose } = fixture(40), all = applyCommands(scene, propose(), context), visual = visualBase(all)!
    const [keep, remove] = terrainCliffBindings(all, area.id)
    delete visual.edgeLooks[keep.looks[0].id]; delete visual.edgeLooks[remove.looks[0].id]; delete visual.boundaries[remove.boundary.id]
    const old = structuredClone(all), commands = propose(all), next = applyCommands(all, commands, context)
    expect(commands.filter(command => command.type === 'upsertVisualBoundary')).toHaveLength(1)
    expect(visualBase(next)!.boundaries[keep.boundary.id]).toEqual(keep.boundary)
    expect(next.terrainAreas).toEqual(old.terrainAreas); expect(validateSceneDocument(next).ok).toBe(true)
    expect(propose(next)).toEqual([])
  })

  it('keeps both terrains and the shared binding when changing its private cliff, and enforces the neighboring layer lock at adoption', () => {
    const { scene, area, floorId, layerId, context } = fixture()
    const neighbor = structuredClone(area)
    neighbor.id = 'neighbor'; neighbor.groundElevationMm = 0; neighbor.coveragePriority = 2
    neighbor.boundaryMm = [{ x: 8000, y: 0 }, { x: 14000, y: 0 }, { x: 14000, y: 6000 }, { x: 8000, y: 6000 }]
      .map((positionMm, i) => ({ id: `neighbor-point-${i}`, segmentId: `neighbor-edge-${i}`, positionMm }))
    scene.terrainAreas[neighbor.id] = neighbor
    scene.userLayers['neighbor-layer'] = { ...scene.userLayers[layerId], id: 'neighbor-layer', order: 1 }
    scene.entityLayers[neighbor.id] = 'neighbor-layer'
    const visual = visualBase(scene)!, start = { x: 8000, y: 0 }, end = { x: 8000, y: 6000 }
    visual.boundaries.shared = { id: 'shared', floorId, layerId, visibility: 'gm', editLocked: false, closed: false,
      sampleSpacingMm: 20000, toleranceMm: 1,
      binding: { kind: 'terrain', sides: [
        { areaId: area.id, startPointId: area.boundaryMm[1].id, endPointId: area.boundaryMm[2].id, reverse: false },
        { areaId: neighbor.id, startPointId: neighbor.boundaryMm[3].id, endPointId: neighbor.boundaryMm[0].id, reverse: true },
      ] }, segments: [{ id: 'shared-segment', start, control1: start, control2: end, end }] }
    expect(validateSceneDocument(scene).ok).toBe(true)
    const before = structuredClone(scene)
    const commands = terrainCliffStyleCommands(scene, { areaId: area.id, boundaryId: 'shared', profile: 'rockRelief7' }, context.ids.nextId)
    const adopted = applyCommands(scene, commands, context), look = terrainCliffBindings(adopted, area.id)[0].looks[0]
    expect(commands).toHaveLength(1); expect(look.visibility).toBe('gm')
    expect(adopted.terrainAreas).toEqual(before.terrainAreas)
    expect(visualBase(adopted)!.boundaries).toEqual(visual.boundaries)
    expect(validateSceneDocument(adopted).ok).toBe(true)
    scene.userLayers['neighbor-layer'].editLocked = true
    const locked = structuredClone(scene)
    expect(() => applyCommands(scene, commands, context)).toThrow(/锁定/)
    expect(scene).toEqual(locked)
  })

  it('rejects locked/invalid/stale scopes and refuses implicit resampling of a long original edge', () => {
    const { scene, area, layerId, context, propose } = fixture()
    area.editLocked = true; expect(propose).toThrow('锁定'); area.editLocked = false
    scene.userLayers[layerId].editLocked = true; expect(propose).toThrow('锁定'); scene.userLayers[layerId].editLocked = false
    expect(() => terrainCliffStyleCommands(scene, { areaId: '__proto__', profile: 'rockRelief9' }, context.ids.nextId)).toThrow('完整地形')
    expect(() => terrainCliffStyleCommands(scene, { areaId: area.id, profile: 'rockRelief9', boundaryId: 'missing' }, context.ids.nextId)).toThrow('失效')
    const bound = applyCommands(scene, propose(), context), item = terrainCliffBindings(bound, area.id)[0]
    item.looks[0].editLocked = true; expect(() => propose(bound)).toThrow('锁定')
    item.looks[0].editLocked = false; item.boundary.editLocked = true; expect(() => propose(bound)).toThrow('锁定')
    area.boundaryMm[1].positionMm.x = 25000
    const before = structuredClone(scene); expect(propose).toThrow('20米'); expect(scene).toEqual(before)
  })
})
