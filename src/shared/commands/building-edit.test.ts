import { toCurrentSceneDocument } from '../model/current-scene.js'
import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { openingEndpoints } from '../geometry/geometry.js'
import type { Decoration, DecorationCluster, PointMm, Room, SceneDocument, Wall } from '../model/scene.js'
import { validateSceneDocument } from '../validation/scene.js'
import { applyCommands, type SceneCommand } from './commands.js'
import { applyBuildingCommand, buildingDependants, inspectBuildingChanges, previewBuildingCommands } from './building.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { sampleVisualBoundary } from '../visual/geometry.js'

const floorId = 'blank-floor', layerId = 'layer-default-0'
let sequence = 0
const runtime = () => ({ ids: { nextId: () => `building-test-${++sequence}` }, clock: { now: () => '2026-11-02T00:00:00.000Z' } })
function native(scene: ReturnType<typeof layerSceneV3>): SceneDocument {
  return toCurrentSceneDocument({ ...cloneJson(scene), format: 'sceneweave-scene' })
}
function fixture(): SceneDocument {
  const scene = native(layerSceneV3())
  delete scene.props.item; delete scene.entityLayers.item
  return scene
}
function room(id: string, boundaryMm: PointMm[]): SceneCommand {
  return { type: 'createRoom', id, floorId, layerId, boundaryMm, thicknessMm: 200 }
}
function apply(scene: SceneDocument, ...commands: SceneCommand[]): SceneDocument { return applyCommands(scene, commands, runtime()) }
function adjacentRooms(): SceneDocument {
  return apply(fixture(),
    room('a', [{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 8000 }, { x: 2000, y: 8000 }]),
    room('b', [{ x: 8000, y: 2000 }, { x: 14000, y: 2000 }, { x: 14000, y: 8000 }, { x: 8000, y: 8000 }]))
}
function ownsWall(room: Room, wall: Wall): boolean {
  return room.boundaryVertexIds.some((id, i, ids) => id === wall.startVertexId && ids[(i + 1) % ids.length] === wall.endVertexId || id === wall.endVertexId && ids[(i + 1) % ids.length] === wall.startVertexId)
}
function sharedWall(scene: SceneDocument): Wall {
  const value = Object.values(scene.walls).find(wall => ownsWall(scene.rooms.a, wall) && ownsWall(scene.rooms.b, wall))
  if (!value) throw new Error('Expected one shared wall')
  return value
}
function addNote(scene: SceneDocument, id: string, entityKind: 'prop' | 'note' | 'wall', entityId: string) {
  scene.notes[id] = { id, floorId, editLocked: false, anchor: { type: 'entity', entityKind, entityId }, kind: 'note', text: id, visibility: 'gm' }
  scene.entityLayers[id] = layerId
}
function wallAt(scene: SceneDocument, a: PointMm, b: PointMm): Wall {
  const find = (id: string, p: PointMm) => scene.vertices[id].xMm === p.x && scene.vertices[id].yMm === p.y
  const wall = Object.values(scene.walls).find(item => find(item.startVertexId, a) && find(item.endVertexId, b) || find(item.startVertexId, b) && find(item.endVertexId, a))
  if (!wall) throw new Error(`Expected wall ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
  return wall
}

describe('native building edits', () => {
  it('reports a transformed room path, its visual source and unchanged edge look on their real layers', () => {
    const source = adjacentRooms()
    source.userLayers.visualLayer = { id: 'visualLayer', floorId, name: '曲线与边带', order: 1, editLocked: false }
    const start = { x: 3000, y: 4000 }, end = { x: 6000, y: 4000 }
    source.visual.base.base.boundaries.curve = { id: 'curve', floorId, layerId: 'visualLayer', editLocked: false, visibility: 'public',
      closed: false, sampleSpacingMm: 1000, toleranceMm: 100, binding: { kind: 'path', pathId: 'road' },
      segments: [{ id: 'curve-segment', start, control1: start, control2: end, end }] }
    source.visual.base.base.edgeLooks.look = { id: 'look', floorId, layerId: 'visualLayer', editLocked: false, visibility: 'public',
      boundaryId: 'curve', kind: 'path', side: 'both', widthMm: 100, color: '#112233', accentColor: '#445566', opacity: 1, intensity: 1, seed: 'fixed', repeatMm: 500, enabled: true }
    source.paths.road = { id: 'road', floorId, editLocked: false, visibility: 'public', centerlineMm: sampleVisualBoundary(source.visual.base.base.boundaries.curve).points,
      widthMm: 200, supportRefs: [{ kind: 'room', id: 'a' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    source.entityLayers.road = layerId
    expect(validateSceneDocument(source).ok).toBe(true)
    const next = cloneJson(source)
    applyBuildingCommand(next, { type: 'transformBuilding', id: 'a', offsetMm: { x: 500, y: 0 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 0 })
    const impact = inspectBuildingChanges(source, next)
    expect(impact.affectedIds).toEqual(expect.arrayContaining(['a', 'b', 'road', 'curve', 'look']))
    expect(impact.changedIds).toContain('curve'); expect(impact.changedIds).not.toContain('look')
    expect(impact.layerIds).toEqual(expect.arrayContaining([layerId, 'visualLayer']))
    expect(next.visual.base.base.edgeLooks.look).toEqual(source.visual.base.base.edgeLooks.look)
  })

  it('transforms a shared building with the attached opening and room-supported objects in one exact quarter-turn', () => {
    let source = adjacentRooms()
    const wall = sharedWall(source)
    source = apply(source, { type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1000, widthMm: 1200, kind: 'door' })
    source.props.item = { ...cloneJson(layerSceneV3().props.item), supportRef: { kind: 'room', id: 'a' }, roomId: 'a', positionMm: { x: 4000, y: 4000 } }
    source.entityLayers.item = layerId
    addNote(source, 'prop-note', 'prop', 'item'); addNote(source, 'note-note', 'note', 'prop-note')
    expect(validateSceneDocument(source).ok).toBe(true)
    const beforeDoor = openingEndpoints(source, source.openings.door)
    const command: SceneCommand = { type: 'transformBuilding', id: 'a', offsetMm: { x: 10000, y: 0 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 1 }
    const preview = previewBuildingCommands(source, [command as Extract<SceneCommand, { type: 'transformBuilding' }>])
    expect(preview.reason).toBeNull()
    for (const id of ['a', 'b', wall.id, source.openings.door.id, 'item', 'prop-note', 'note-note']) expect(preview.affectedIds).toContain(id)
    const next = apply(source, command)
    expect(validateSceneDocument(next).ok).toBe(true)
    expect(next.props.item.positionMm).toEqual({ x: 6000, y: 4000 })
    expect(next.props.item.rotationDeg).toBe(90)
    expect(next.openings.door).toMatchObject({ wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1000 })
    expect(openingEndpoints(next, next.openings.door)).toEqual(beforeDoor.map(point => ({ x: 10000 - point.y, y: point.x })))
    expect(Object.values(next.walls).filter(item => ownsWall(next.rooms.a, item) && ownsWall(next.rooms.b, item))).toHaveLength(1)
    expect(source.props.item.positionMm).toEqual({ x: 4000, y: 4000 })
  })

  it('refuses locked support dependencies and does not mutate the candidate source', () => {
    const source = adjacentRooms()
    source.props.item = { ...cloneJson(layerSceneV3().props.item), supportRef: { kind: 'room', id: 'a' }, roomId: 'a', positionMm: { x: 4000, y: 4000 }, editLocked: true }
    source.entityLayers.item = layerId
    const before = canonicalJson(source)
    const impact = previewBuildingCommands(source, [{ type: 'transformBuilding', id: 'a', offsetMm: { x: 1000, y: 0 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 0 }])
    expect(impact.reason).toMatch(/锁定/)
    expect(canonicalJson(source)).toBe(before)
  })

  it('deletes only the selected room, keeps shared walls, and refuses implicit dependency loss', () => {
    const source = adjacentRooms(), shared = sharedWall(source), external = Object.values(source.walls).find(wall => ownsWall(source.rooms.a, wall) && !ownsWall(source.rooms.b, wall))!
    const withDoor = apply(source, { type: 'addOpening', id: 'outer-door', wallId: external.id, offsetReferenceVertexId: external.startVertexId, offsetMm: 1000, widthMm: 1200, kind: 'door' })
    const before = canonicalJson(withDoor)
    const refused = previewBuildingCommands(withDoor, [{ type: 'deleteRoom', id: 'a', removeOrphanWalls: true }])
    expect(refused.reason).toMatch(/门窗/)
    expect(canonicalJson(withDoor)).toBe(before)
    const next = apply(withDoor, { type: 'deleteRoom', id: 'a' })
    expect(next.rooms.a).toBeUndefined()
    expect(next.rooms.b).toBeDefined()
    expect(next.walls[shared.id]).toBeDefined()
    expect(next.walls[external.id]).toBeDefined()
    expect(next.openings['outer-door']).toBeDefined()
    expect(validateSceneDocument(next).ok).toBe(true)
  })

  it('refuses deleting a room with support references and only deletes an orphan wall explicitly', () => {
    let source = adjacentRooms()
    source.props.item = { ...cloneJson(layerSceneV3().props.item), supportRef: { kind: 'room', id: 'a' }, roomId: 'a', positionMm: { x: 4000, y: 4000 } }
    source.entityLayers.item = layerId
    addNote(source, 'room-note', 'note', 'room-note-parent')
    source.notes['room-note'].anchor = { type: 'entity', entityKind: 'room', entityId: 'a' }
    const refused = previewBuildingCommands(source, [{ type: 'deleteRoom', id: 'a' }])
    expect(refused.reason).toMatch(/支撑对象或注记/)
    delete source.props.item; delete source.entityLayers.item
    delete source.notes['room-note']; delete source.entityLayers['room-note']
    const shared = sharedWall(source), next = apply(source, { type: 'deleteRoom', id: 'a', removeOrphanWalls: true })
    expect(next.rooms.a).toBeUndefined(); expect(next.rooms.b).toBeDefined()
    expect(next.walls[shared.id]).toBeDefined()
    expect(Object.values(next.walls).filter(wall => ownsWall(source.rooms.a, wall) && !ownsWall(source.rooms.b, wall))).toHaveLength(0)
    expect(validateSceneDocument(next).ok).toBe(true)
  })

  it('deletes a free wall but rejects a wall still used by a room boundary', () => {
    let source = adjacentRooms()
    const free: Wall = { id: 'free-wall', floorId, editLocked: false, startVertexId: 'free-a', endVertexId: 'free-b', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    source.vertices['free-a'] = { id: 'free-a', floorId, editLocked: false, xMm: 15000, yMm: 15000 }
    source.vertices['free-b'] = { id: 'free-b', floorId, editLocked: false, xMm: 18000, yMm: 15000 }
    source.walls[free.id] = free; source.entityLayers[free.id] = layerId; source.entityLayers['free-a'] = layerId; source.entityLayers['free-b'] = layerId
    expect(validateSceneDocument(source).ok).toBe(true)
    const deleted = apply(source, { type: 'deleteWall', id: free.id })
    expect(deleted.walls[free.id]).toBeUndefined()
    expect(deleted.vertices['free-a']).toBeDefined()
    expect(previewBuildingCommands(source, [{ type: 'deleteWall', id: sharedWall(source).id }]).reason).toMatch(/房间边界/)
  })

  it('merges compatible collinear room walls and preserves an attached opening in exact millimetres', () => {
    let source = apply(fixture(), room('long-room', [{ x: 2000, y: 2000 }, { x: 4000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 8000 }, { x: 2000, y: 8000 }]))
    const left = wallAt(source, { x: 2000, y: 2000 }, { x: 4000, y: 2000 }), right = wallAt(source, { x: 4000, y: 2000 }, { x: 8000, y: 2000 })
    source = apply(source, { type: 'addOpening', id: 'window', wallId: right.id, offsetReferenceVertexId: right.startVertexId, offsetMm: 500, widthMm: 1000, kind: 'window' })
    const before = openingEndpoints(source, source.openings.window)
    const next = apply(source, { type: 'repairBuildingTopology', id: 'long-room', operation: 'mergeCollinear' })
    expect(next.walls[left.id]).toMatchObject({ startVertexId: source.walls[left.id].startVertexId, endVertexId: source.walls[right.id].endVertexId })
    expect(next.walls[right.id]).toBeUndefined()
    expect(next.openings.window).toMatchObject({ wallId: left.id, offsetReferenceVertexId: left.startVertexId, offsetMm: 2500 })
    expect(openingEndpoints(next, next.openings.window)).toEqual(before)
    expect(next.rooms['long-room'].boundaryVertexIds).not.toContain(source.walls[right.id].startVertexId)
    expect(validateSceneDocument(next).ok).toBe(true)
  })

  it('refuses collinear wall merging when either wall carries an entity-anchored note', () => {
    const source = apply(fixture(), room('long-room', [{ x: 2000, y: 2000 }, { x: 4000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 8000 }, { x: 2000, y: 8000 }]))
    const left = wallAt(source, { x: 2000, y: 2000 }, { x: 4000, y: 2000 })
    addNote(source, 'wall-note', 'wall', left.id)
    const before = canonicalJson(source)
    const impact = previewBuildingCommands(source, [{ type: 'repairBuildingTopology', id: 'long-room', operation: 'mergeCollinear' }])
    expect(impact.reason).toMatch(/墙锚定注记/)
    expect(canonicalJson(source)).toBe(before)
  })

  it('splits an exact T junction in the same transaction and refuses a split through an opening', () => {
    const make = (openingWidth: number) => {
      let scene = fixture()
      scene.vertices['host-a'] = { id: 'host-a', floorId, editLocked: false, xMm: 2000, yMm: 15000 }
      scene.vertices['host-b'] = { id: 'host-b', floorId, editLocked: false, xMm: 8000, yMm: 15000 }
      scene.vertices['branch-top'] = { id: 'branch-top', floorId, editLocked: false, xMm: 12000, yMm: 12000 }
      scene.vertices['branch-end'] = { id: 'branch-end', floorId, editLocked: false, xMm: 12000, yMm: 15000 }
      scene.walls.host = { id: 'host', floorId, editLocked: false, startVertexId: 'host-a', endVertexId: 'host-b', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
      scene.walls.branch = { id: 'branch', floorId, editLocked: false, startVertexId: 'branch-top', endVertexId: 'branch-end', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
      for (const id of ['host-a', 'host-b', 'host', 'branch-top', 'branch-end', 'branch']) scene.entityLayers[id] = layerId
      if (openingWidth) scene = apply(scene, { type: 'addOpening', id: 'door', wallId: 'host', offsetReferenceVertexId: 'host-a', offsetMm: 1000, widthMm: openingWidth, kind: 'door' })
      return scene
    }
    const source = make(1000), beforeDoor = openingEndpoints(source, source.openings.door)
    const next = apply(source,
      { type: 'moveVertex', id: 'branch-end', positionMm: { x: 5000, y: 15000 } },
      { type: 'repairBuildingTopology', id: 'branch', operation: 'splitJunctions' })
    expect(Object.values(next.walls).filter(wall => wall.id.startsWith('host'))).toHaveLength(2)
    expect(next.walls['branch'].endVertexId).toBe('branch-end')
    expect(Object.values(next.walls).filter(wall => wall.startVertexId === 'branch-end' || wall.endVertexId === 'branch-end')).toHaveLength(3)
    expect(openingEndpoints(next, next.openings.door)).toEqual(beforeDoor)
    expect(validateSceneDocument(next).ok).toBe(true)
    const crossing = make(3000), before = canonicalJson(crossing)
    expect(() => apply(crossing,
      { type: 'moveVertex', id: 'branch-end', positionMm: { x: 5000, y: 15000 } },
      { type: 'repairBuildingTopology', id: 'branch', operation: 'splitJunctions' })).toThrow(/跨越T型拆分点/)
    expect(canonicalJson(crossing)).toBe(before)
  })

  it('keeps an opening ending exactly at a T junction when its intermediate sum exceeds safe integers', () => {
    let source = fixture()
    source.floors[floorId].boundsMm = { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }
    source.constraints.wallEndClearanceMm = 0
    const k = 1801439850948199, junction = { x: 100 + 4 * k, y: 100 + 3 * k }
    for (const [id, point] of Object.entries({
      'host-a': { x: 100, y: 100 }, 'host-b': { x: 100 + 4 * (k + 1), y: 100 + 3 * (k + 1) },
      'branch-top': { x: junction.x + 100, y: junction.y + 1000 }, 'branch-end': { x: junction.x, y: junction.y + 100 },
    })) {
      source.vertices[id] = { id, floorId, editLocked: false, xMm: point.x, yMm: point.y }
      source.entityLayers[id] = layerId
    }
    for (const id of ['host', 'branch']) {
      source.walls[id] = { id, floorId, editLocked: false, startVertexId: `${id}-${id === 'host' ? 'a' : 'top'}`, endVertexId: `${id}-${id === 'host' ? 'b' : 'end'}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
      source.entityLayers[id] = layerId
    }
    expect(validateSceneDocument(source).ok).toBe(true)
    source = apply(source, { type: 'addOpening', id: 'door', wallId: 'host', offsetReferenceVertexId: 'host-a', offsetMm: 4503599627370497, widthMm: 4503599627370498, kind: 'door' })
    const before = canonicalJson(source), next = apply(source,
      { type: 'moveVertex', id: 'branch-end', positionMm: junction },
      { type: 'repairBuildingTopology', id: 'branch', operation: 'splitJunctions' })
    expect(next.openings.door).toEqual(source.openings.door)
    expect(next.walls.host.endVertexId).toBe('branch-end')
    expect(Object.values(next.walls).filter(wall => wall.startVertexId === 'branch-end' || wall.endVertexId === 'branch-end')).toHaveLength(3)
    expect(validateSceneDocument(next).ok).toBe(true)
    expect(canonicalJson(source)).toBe(before)
  })

  it('includes supported decorations, clusters, grouped members and recursive notes in the transform lock/impact closure', () => {
    const scene = adjacentRooms()
    scene.props.item = { ...cloneJson(layerSceneV3().props.item), supportRef: { kind: 'room', id: 'a' }, roomId: 'a', positionMm: { x: 4000, y: 4000 } }
    scene.entityLayers.item = layerId
    const decoration: Decoration = { id: 'grass', floorId, editLocked: false, visibility: 'gm', definitionRef: { id: 'image-definition', version: 1 }, supportRef: { kind: 'room', id: 'a' }, positionMm: { x: 5000, y: 5000 }, rotationDeg: 0, scalePpm: 1000000, renderOrder: 0 }
    const cluster: DecorationCluster = { id: 'cluster', floorId, editLocked: false, visibility: 'gm', supportRef: { kind: 'room', id: 'a' }, boundsMm: { x: 3000, y: 3000, width: 3000, height: 3000 }, seed: 'fixed', algorithmVersion: 'cluster-v1', palette: [], maxInstances: 1, spacingMm: 100, clusterRadiusMm: 500, clearanceMm: 0, members: { slot: { kind: 'decoration', entityId: 'grass', state: 'manual' } } }
    scene.decorations = { grass: decoration }; scene.decorationClusters = { cluster }
    scene.entityLayers.grass = layerId; scene.entityLayers.cluster = layerId
    addNote(scene, 'decoration-note', 'note', 'cluster')
    const dependencies = buildingDependants(scene, Object.values(scene.walls).filter(wall => ownsWall(scene.rooms.a, wall)).map(wall => wall.id), ['a'])
    expect(dependencies).toEqual(expect.arrayContaining(['grass', 'cluster', 'decoration-note']))
    const impact = applyBuildingCommand(scene, { type: 'transformBuilding', id: 'a', offsetMm: { x: 1000, y: 0 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 0 })
    expect(impact.affectedIds).toEqual(expect.arrayContaining(['grass', 'cluster', 'decoration-note']))
    expect(scene.decorations!.grass.positionMm).toEqual({ x: 6000, y: 5000 })
    expect(scene.decorationClusters!.cluster.boundsMm).toEqual({ x: 4000, y: 3000, width: 3000, height: 3000 })
    scene.decorations!.grass.editLocked = true
    expect(() => applyBuildingCommand(scene, { type: 'transformBuilding', id: 'a', offsetMm: { x: 1000, y: 0 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 0 })).toThrow(/锁定/)
  })

  it('rejects transformations whose expanded changes exceed the shared 256-operation bound', () => {
    let scene = apply(fixture(), room('a', [{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 8000 }, { x: 2000, y: 8000 }]))
    const template = cloneJson(layerSceneV3().props.item)
    template.supportRef = { kind: 'room', id: 'a' }; template.roomId = 'a'; template.positionMm = { x: 4000, y: 4000 }
    scene.props.item = template; scene.entityLayers.item = layerId
    for (let index = 0; index < 260; index++) {
      const id = `budget-prop-${index}`
      scene.props[id] = { ...cloneJson(template), id }
      scene.entityLayers[id] = layerId
    }
    expect(validateSceneDocument(scene).ok).toBe(true)
    const before = canonicalJson(scene), impact = previewBuildingCommands(scene, [{ type: 'transformBuilding', id: 'a', offsetMm: { x: 1000, y: 0 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 0 }])
    expect(impact.reason).toMatch(/256/)
    expect(canonicalJson(scene)).toBe(before)
  })
})
