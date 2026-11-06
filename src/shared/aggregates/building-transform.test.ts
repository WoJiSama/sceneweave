import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent, listRequiredVariants, resolveAppearance } from '../appearance/graph.js'
import { applyBuildingCommand, buildingAggregateMembers, inspectAggregateBuilding } from '../commands/building.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { openingEndpoints } from '../geometry/geometry.js'
import type { SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { localToWorldPoint, reparentAggregateFrame } from './coordinates.js'
import { decodeSceneCoordinates, encodeSceneCoordinates } from './scene-coordinates.js'
import { aggregateWorldFrames } from './state.js'

function building(): SceneDocument {
  const scene = fixture({ building: true }).project.document, layer = scene.entityLayers.room
  Object.assign(scene.props.item, { positionMm: { x: 4500, y: 4500 }, roomId: 'room', supportRef: { kind: 'room', id: 'room' } })
  scene.props.other.positionMm = { x: 16000, y: 16000 }
  scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
    offsetMm: 1000, widthMm: 1200, kind: 'door', state: 'closed', locked: true, secret: true, revealed: false }
  scene.notes.clue = { id: 'clue', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'GM clue', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
  scene.paths.road = { id: 'road', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    centerlineMm: [{ x: 4500, y: 7000 }, { x: 7500, y: 7000 }], widthMm: 400, supportRefs: [{ kind: 'room', id: 'room' }],
    surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  scene.entityLayers.door = layer; scene.entityLayers.clue = layer; scene.entityLayers.road = layer
  return applyCommands(scene, [{ type: 'createAggregateGroup', group: { id: 'building', floorId: 'blank-floor', parentId: null,
    frame: { translationMm: { x: 6500, y: 6500 }, quarterTurns: 0 }, editLocked: false, members: buildingAggregateMembers(scene, 'room') } }], runtime)
}
const move: SceneCommand = { type: 'transformAggregateBuilding', id: 'building', offsetMm: { x: 1000, y: 300 }, pivotMm: { x: 6500, y: 6500 }, quarterTurns: 1 }

describe('complete building aggregate transforms', () => {
  it('keeps read-only terrain support notes outside the moving ownership closure', () => {
    const scene = building()
    scene.terrainAreas.ground = { id: 'ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 0, y: 0 }, { x: 19000, y: 0 }, { x: 19000, y: 19000 }, { x: 0, y: 19000 }]
        .map((positionMm, index) => ({ id: `ground-p-${index}`, segmentId: `ground-s-${index}`, positionMm })),
      groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.rooms.room.supportRef = { kind: 'terrainArea', id: 'ground' }
    scene.props.other.supportRef = { kind: 'terrainArea', id: 'ground' }
    scene.entityLayers.ground = scene.entityLayers.room
    scene.notes['ground-note'] = { ...cloneJson(scene.notes.clue), id: 'ground-note', anchor: { type: 'entity', entityKind: 'terrainArea', entityId: 'ground' } }
    scene.notes['ground-note-child'] = { ...cloneJson(scene.notes.clue), id: 'ground-note-child', anchor: { type: 'entity', entityKind: 'note', entityId: 'ground-note' } }
    scene.entityLayers['ground-note'] = scene.entityLayers.room; scene.entityLayers['ground-note-child'] = scene.entityLayers.room
    const members = buildingAggregateMembers(scene, 'room')
    expect(members.map(ref => ref.id)).not.toContain('ground-note')
    expect(members.map(ref => ref.id)).not.toContain('ground-note-child')
    expect(members.map(ref => ref.id)).toContain('clue')
    const next = applyCommands(scene, [move], runtime)
    expect(next.notes['ground-note']).toEqual(scene.notes['ground-note'])
    expect(next.notes['ground-note-child']).toEqual(scene.notes['ground-note-child'])
    expect(next.terrainAreas.ground).toEqual(scene.terrainAreas.ground)
  })
  it('preserves all local member geometry and nested frames while moving the actual building, door, furniture and road', () => {
    let scene = building()
    scene = applyCommands(scene, [{ type: 'createAggregateGroup', group: { id: 'parent', floorId: 'blank-floor', parentId: null,
      frame: { translationMm: { x: 200, y: -300 }, quarterTurns: 1 }, members: [], editLocked: false } },
    { type: 'reparentAggregateGroup', id: 'building', parentId: 'parent' }], runtime)
    const state = scene.aggregateCoordinates!, members = state.groups.building.members
    state.groups.furniture = { id: 'furniture', floorId: 'blank-floor', parentId: 'building', editLocked: false,
      frame: { translationMm: { x: 90, y: -20 }, quarterTurns: 3 }, members: members.filter(ref => ['prop', 'note', 'path'].includes(ref.kind)) }
    state.groups.building.members = members.filter(ref => !['prop', 'note', 'path'].includes(ref.kind))
    const before = canonicalJson(scene), local = encodeSceneCoordinates(scene), door = openingEndpoints(scene, scene.openings.door)
    const next = applyCommands(scene, [move], runtime), encoded = encodeSceneCoordinates(next)
    const worldFrame = { translationMm: { x: 7500, y: 6800 }, quarterTurns: 1 as const }
    expect(aggregateWorldFrames(next.aggregateCoordinates!).get('building')).toEqual(worldFrame)
    expect(next.aggregateCoordinates!.groups.building.frame).toEqual(reparentAggregateFrame(worldFrame, aggregateWorldFrames(state).get('parent')!))
    expect(next.aggregateCoordinates!.groups.furniture).toEqual(state.groups.furniture)
    for (const { kind, id } of inspectAggregateBuilding(scene, 'building').members) {
      const collections = { vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', prop: 'props', note: 'notes', path: 'paths' } as const
      if (kind in collections) {
        const collection = collections[kind as keyof typeof collections]
        expect(encoded[collection][id], `${kind}:${id}`).toEqual(local[collection][id])
      }
    }
    expect(next.props.item.positionMm).toEqual({ x: 9500, y: 4800 })
    expect(next.props.item.rotationDeg).toBe((scene.props.item.rotationDeg + 90) % 360)
    expect(next.props.other).toEqual(scene.props.other)
    expect(next.openings.door).toEqual(scene.openings.door)
    const transform = (point: { x: number; y: number }) => ({ x: 14000 - point.y, y: point.x + 300 })
    expect(openingEndpoints(next, next.openings.door)).toEqual(door.map(transform))
    expect(next.paths.road.centerlineMm).toEqual(scene.paths.road.centerlineMm.map(transform))
    expect(decodeSceneCoordinates(encoded)).toEqual(next)
    expect(validateSceneDocument(next).ok).toBe(true)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('rejects incomplete/shared ownership, extra members and new supported dependants without absorbing them', () => {
    for (const mode of ['missing-wall', 'extra', 'new-dependant'] as const) {
      const scene = building(), group = scene.aggregateCoordinates!.groups.building
      if (mode === 'missing-wall') group.members = group.members.filter(ref => ref.id !== 'wall-2')
      else if (mode === 'extra') group.members.push({ kind: 'prop', id: 'other' })
      else Object.assign(scene.props.other, { positionMm: { x: 8000, y: 8000 }, supportRef: { kind: 'room', id: 'room' }, roomId: 'room' })
      const before = canonicalJson(scene)
      expect(() => applyCommands(scene, [move], runtime), mode).toThrow(/完整拥有/)
      expect(canonicalJson(scene)).toBe(before)
    }
  })

  it('checks member, recursive note and layer locks even when the container itself is unlocked', () => {
    for (const mode of ['prop', 'note', 'layer'] as const) {
      const scene = building()
      if (mode === 'prop') scene.props.item.editLocked = true
      if (mode === 'note') scene.notes.clue.editLocked = true
      if (mode === 'layer') scene.userLayers[scene.entityLayers.item].editLocked = true
      const before = canonicalJson(scene)
      expect(() => applyCommands(scene, [move], runtime)).toThrow(/锁/)
      expect(canonicalJson(scene)).toBe(before)
    }
  })

  it('refuses actual new-location external blockers and a full-width road clipping the moved wall', () => {
    for (const mode of ['prop', 'road'] as const) {
      const scene = building()
      if (mode === 'prop') {
        scene.props.other.positionMm = { x: 11000, y: 6000 }; scene.props.other.blocksMovement = true
      } else {
        scene.paths.external = { ...cloneJson(scene.paths.road), id: 'external', centerlineMm: [{ x: 11500, y: 2000 }, { x: 11500, y: 11000 }],
          supportRefs: [{ kind: 'floor', id: 'blank-floor' }] }
        scene.entityLayers.external = scene.entityLayers.road
      }
      expect(validateSceneDocument(scene).ok).toBe(true)
      const before = canonicalJson(scene)
      expect(() => applyCommands(scene, [{ ...move, offsetMm: { x: 2000, y: 0 }, quarterTurns: 0 }], runtime)).toThrow(/整栋.*冲突/)
      expect(canonicalJson(scene)).toBe(before)
    }
  })

  it('requires one-ended external terrain connections to be resolved explicitly before moving any member', () => {
    const scene = building()
    // Exercise the detached command's refusal before any geometry mutation;
    // the owning public path additionally validates all connection domains.
    scene.terrainConnections.external = { id: 'external', floorId: 'blank-floor', editLocked: false, visibility: 'public', kind: 'stairs',
      from: { surfaceRef: { kind: 'room', id: 'room' }, positionMm: { x: 4500, y: 4000 } },
      to: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 4500, y: 2000 } },
      widthMm: 600, openingId: 'door', blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    scene.entityLayers.external = scene.entityLayers.road
    scene.aggregateCoordinates!.groups.building.members = buildingAggregateMembers(scene, 'room')
    const before = canonicalJson(scene)
    expect(() => applyBuildingCommand(scene, move as Extract<SceneCommand, { type: 'transformAggregateBuilding' }>)).toThrow(/只有一端/)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('rejects unsupported angles, unknown fields, unsafe coordinates and invalid final support atomically', () => {
    const scene = building(), before = canonicalJson(scene)
    for (const command of [{ ...move, quarterTurns: 0.5 }, { ...move, scale: 2 }, { ...move, offsetMm: { x: Number.MAX_SAFE_INTEGER, y: 0 } },
      { ...move, offsetMm: { x: -10000, y: 0 } }]) {
      expect(() => applyCommands(scene, [command as SceneCommand], runtime)).toThrow()
      expect(canonicalJson(scene)).toBe(before)
    }
    expect(applyCommands(scene, [{ ...move, offsetMm: { x: 0, y: 0 }, quarterTurns: 0 }], runtime)).toEqual(scene)
  })

  it('moves fixed surface sources without baking effective overrides and preserves identity tokens', () => {
    const scene = building(), base = fixture({ image: true }).project.document
    scene.assets = cloneJson(base.assets)
    scene.materials.tile = { id: 'tile', catalogId: 'test.aggregate', version: 1, name: 'Tile', tags: [], licenseRef: 'fixture-license', origin: cloneJson(base.assets.image.origin),
      textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
    scene.rooms.room.floorStyle = { base: { materialRef: { id: 'tile', version: 1 }, tint: null, opacity: 1, alignment: 'surface', originMm: { x: 4000, y: 4000 }, rotationDeg: 0, tileSizeMm: { width: 1000, height: 1000 } }, overlays: [] }
    let content = createCompositionContent(scene, runtime)
    content.appearance.instanceAdjustments.room = [{ id: 'room-tint', kind: 'tint', enabled: true, value: '#778899' }]
    for (const variant of listRequiredVariants(content)) {
      content.appearance.variants[variant.id] = variant
      content.document.assets[variant.outputAssetId] = { ...cloneJson(content.document.assets[variant.sourceAssetId]), id: variant.outputAssetId }
    }
    content = resolveAppearance(content)
    const sourceId = content.appearance.surfaceSources.room, material = content.document.rooms.room.floorStyle!.base.materialRef
    expect(material.id).toMatch(/^composition-material-/)
    const result = resolveAppearance(applyCompositionCommands(content, [move], runtime))
    expect(result.historyIdentity).toEqual(content.historyIdentity)
    const transformed = result.appearance.sources[result.appearance.surfaceSources.room]
    expect(transformed).toMatchObject({ kind: 'surface', parentSourceId: sourceId, snapshot: { base: { materialRef: { id: 'tile', version: 1 }, tint: null, originMm: { x: 10000, y: 4300 }, rotationDeg: 90 } } })
    expect(result.appearance.sources[sourceId]).toEqual(content.appearance.sources[sourceId])
    expect(result.appearance.instanceAdjustments).toEqual(content.appearance.instanceAdjustments)
    expect(result.document.rooms.room.floorStyle!.base.materialRef).toEqual(material)
    expect(result.document.rooms.room.floorStyle!.base.originMm).toEqual({ x: 10000, y: 4300 })
    expect(result.document.format).toBe('sceneweave-scene')
    expect(result.document.schemaVersion).toBe(1)
    // A normal inner edit still changes a member without moving the group frame.
    const edited = applyCompositionCommands(result, [{ type: 'updateProp', id: 'item', changes: { positionMm: localToWorldPoint(inspectAggregateBuilding(result.document, 'building').frame, { x: -1000, y: -1000 }) } }], runtime)
    expect(edited.document.aggregateCoordinates).toEqual(result.document.aggregateCoordinates)
  })
})
