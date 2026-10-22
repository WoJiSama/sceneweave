import { describe, expect, it } from 'vitest'
import { C2_DOORS, C2_EXPORT_BOUNDS, C2_FLOOR, C2_LAYER, C2_ROOMS, C2_WINDOWS, c2RoomIdsAtWall, createScn01DocumentC2, createScn01ProjectC2 } from '../../../tests/c2-fixtures'
import { assertDoorwayClearancesV2 } from '../v2/doorway-clearance'
import { openingEndpointsV2, roomPointsV2 } from '../v2/geometry'
import { createBlankDocumentV2 } from '../../editor/v2/blank-project'
import { applyCommandsV3, applySnapshotCommandsV3, type SceneCommandV3 } from './commands'
import { toGeometryDocumentV2 } from './geometry-view'
import { migrateSceneV2 } from './migration'
import { validateSceneV3 } from './schema'
import { LAYER_ENTITY_COLLECTIONS_V3 } from './types'
import { projectSceneV3 } from '../../render/v3/projection'
import { exportProjectV4, importProjectV4 } from '../../io/v4/project-file'

const apply = (scene: ReturnType<typeof createScn01DocumentC2>, ...commands: SceneCommandV3[]) => applyCommandsV3(scene, commands)
const edgeKey = (a: string, b: string) => [a, b].sort().join('\0')
function empty() {
  const source = createBlankDocumentV2({ title: 'C2 polygon test', widthMm: 20000, heightMm: 20000, preset: 'investigation', sceneId: 'polygon-source' })
  source.assets = {}; source.propDefinitions = {}
  return migrateSceneV2(source, { sceneId: 'polygon-c2' })
}

describe('C2 command-built SCN-01 geometry and semantics', () => {
  it('builds the specified seven rooms with unique shared topology and complete layer memberships', () => {
    const scene = createScn01DocumentC2(), checked = validateSceneV3(scene)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.warnings).toEqual([])
    expect(Object.keys(scene.rooms)).toEqual(C2_ROOMS.map(room => room.id))
    expect(Object.values(scene.vertices)).toHaveLength(14); expect(Object.values(scene.walls)).toHaveLength(20)
    const vertices = Object.values(scene.vertices).map(vertex => `${vertex.floorId}:${vertex.xMm},${vertex.yMm}`)
    expect(new Set(vertices).size).toBe(vertices.length)
    const walls = Object.values(scene.walls).map(wall => edgeKey(wall.startVertexId, wall.endVertexId))
    expect(new Set(walls).size).toBe(walls.length)
    expect(Object.values(scene.walls).every(wall => wall.thicknessMm === 100)).toBe(true)
    for (const room of C2_ROOMS) {
      const points = roomPointsV2(scene, scene.rooms[room.id])
      expect({ x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
        width: Math.max(...points.map(p => p.x)) - room.x, height: Math.max(...points.map(p => p.y)) - room.y })
        .toEqual({ x: room.x, y: room.y, width: room.width, height: room.height })
      expect(scene.rooms[room.id].accessExpectation).toBe('required')
    }
    const ids = LAYER_ENTITY_COLLECTIONS_V3.flatMap(collection => Object.keys(scene[collection]))
    expect(Object.keys(scene.entityLayers).sort()).toEqual(ids.sort())
    expect(Object.values(scene.entityLayers).every(id => id === C2_LAYER)).toBe(true)
    expect(scene.exportBoundsMm).toEqual(C2_EXPORT_BOUNDS)
  })

  it('keeps all nine door centers, widths, shared-wall owners, secret state and three exterior windows exact', () => {
    const scene = createScn01DocumentC2()
    expect(Object.values(scene.openings)).toHaveLength(12)
    for (const door of C2_DOORS) {
      const opening = scene.openings[door.id], wall = scene.walls[opening.wallId], [a, b] = openingEndpointsV2(scene, opening)
      expect({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }).toEqual(door.center)
      expect(opening.widthMm).toBe(door.width); expect(opening.kind).toBe('door')
      expect(c2RoomIdsAtWall(scene, wall)).toEqual([...door.rooms].sort())
      expect(opening.secret).toBe(door.id.endsWith('-HS')); expect(opening.revealed).toBe(false)
      expect(opening.state).toBe('closed'); expect(opening.locked).toBe(false)
      expect([wall.startVertexId, wall.endVertexId]).toContain(opening.offsetReferenceVertexId)
    }
    for (const window of C2_WINDOWS) {
      const opening = scene.openings[window.id], wall = scene.walls[opening.wallId]
      expect(opening).toMatchObject({ kind: 'window', widthMm: 1200, secret: false })
      expect(c2RoomIdsAtWall(scene, wall)).toHaveLength(1)
    }
    expect(scene.constraints.entranceOpeningIds).toEqual(['outside-H1'])
    expect(scene.rooms.HS.visibility).toBe('gm')
    // Centreline corridor 1300 mm minus the two 50 mm wall halves is 1200 mm.
    expect(C2_ROOMS.find(room => room.id === 'HS')!.height - 100).toBe(1200)
  })

  it('keeps declared net doorways clear of actual wall bands and blocking furniture', () => {
    const scene = createScn01DocumentC2(), domain = toGeometryDocumentV2(scene)
    expect(() => assertDoorwayClearancesV2(domain, C2_DOORS.map(door => ({ openingId: door.id, minWidthMm: door.width, approachDepthMm: 300 })))).not.toThrow()
    const blocked = structuredClone(scene)
    // Keep the whole 800 mm footprint inside H6, while overlapping the 300 mm door approach.
    blocked.props['H6-desk'].positionMm = { x: 15000, y: 6500 }
    expect(() => assertDoorwayClearancesV2(toGeometryDocumentV2(blocked), [{ openingId: 'H4-H6', minWidthMm: 900, approachDepthMm: 300 }])).toThrow(/H6-desk/)
  })

  it('validates ordinary structural access separately from current closed and secret doors', () => {
    const scene = createScn01DocumentC2(), open = apply(scene, ...C2_DOORS.filter(door => !door.id.endsWith('-HS'))
      .map((door): SceneCommandV3 => ({ type: 'updateOpening', id: door.id, changes: { state: 'open' } })))
    const graph = new Map<string, Set<string>>()
    for (const opening of Object.values(open.openings)) {
      if (opening.kind !== 'door' || opening.state !== 'open' || opening.locked || opening.secret) continue
      const owners = c2RoomIdsAtWall(open, open.walls[opening.wallId])
      if (owners.length === 2) for (let i = 0; i < 2; i++) { const neighbors = graph.get(owners[i]) ?? new Set<string>(); neighbors.add(owners[1 - i]); graph.set(owners[i], neighbors) }
    }
    const reachable = new Set(['H1']), queue = ['H1']
    for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next) }
    expect([...reachable].sort()).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
    expect(open.openings['H5-HS'].state).toBe('closed'); expect(open.openings['H6-HS'].state).toBe('closed')
    expect(Object.values(scene.openings).every(opening => opening.state === 'closed')).toBe(true)
    expect(() => apply(scene, { type: 'setEntranceOpenings', ids: ['H1-H2'] })).toThrow(/入口|一个房间/)
  })

  it('rejects overlapping, too narrow, endpoint and bad-reference openings atomically', () => {
    const scene = createScn01DocumentC2(), before = structuredClone(scene), door = scene.openings['H1-H2']
    expect(() => apply(scene, { type: 'updateOpening', id: door.id, changes: { widthMm: 899 } })).toThrow(/门净宽|约束/)
    expect(() => apply(scene, { type: 'updateOpening', id: door.id, changes: { offsetMm: 0 } })).toThrow(/端部|间隙|超界/)
    expect(() => apply(scene, { type: 'addOpening', id: 'overlap', wallId: door.wallId, offsetReferenceVertexId: door.offsetReferenceVertexId,
      offsetMm: door.offsetMm + 100, widthMm: 900, kind: 'door', layerId: C2_LAYER })).toThrow(/重叠/)
    expect(() => apply(scene, { type: 'updateOpening', id: door.id, changes: { offsetReferenceVertexId: 'not-a-wall-end' } })).toThrow(/基准|端点|顶点/)
    expect(() => apply(scene, { type: 'updateRoom', id: 'H1', changes: { purpose: 'must roll back' } },
      { type: 'updateOpening', id: door.id, changes: { widthMm: 899 } })).toThrow()
    expect(scene).toEqual(before)
  })

  it('preserves opening world placement across wall reversal and legal splitting, rejecting a cut through its interval', () => {
    const scene = createScn01DocumentC2(), opening = scene.openings['H1-H2'], wall = scene.walls[opening.wallId]
    const endpoints = openingEndpointsV2(scene, opening)
    const reversed = apply(scene, { type: 'reverseWall', id: wall.id })
    expect(openingEndpointsV2(reversed, reversed.openings[opening.id])).toEqual(endpoints)
    expect(reversed.openings[opening.id]).toEqual(opening)
    const split = apply(scene, { type: 'splitWall', id: wall.id, positionMm: { x: 6000, y: 4500 }, newVertexId: 'legal-split-v', newWallId: 'legal-split-wall' })
    openingEndpointsV2(split, split.openings[opening.id]).forEach((point, i) => {
      expect(point.x).toBeCloseTo(endpoints[i].x, 8); expect(point.y).toBeCloseTo(endpoints[i].y, 8)
    })
    expect(split.entityLayers['legal-split-v']).toBe(C2_LAYER); expect(split.entityLayers['legal-split-wall']).toBe(C2_LAYER)
    expect(() => apply(scene, { type: 'splitWall', id: wall.id, positionMm: { x: 6000, y: 3000 }, newVertexId: 'bad-cut-v', newWallId: 'bad-cut-wall' })).toThrow(/跨越拆分点/)
  })

  it('protects shared-room, attached-opening and target-layer locks through every building edit', () => {
    const scene = createScn01DocumentC2(), secret = scene.openings['H5-HS'], wall = scene.walls[secret.wallId], vertex = scene.vertices[wall.startVertexId]
    const roomLocked = structuredClone(scene); roomLocked.rooms.HS.editLocked = true
    expect(() => apply(roomLocked, { type: 'setWallThickness', id: wall.id, thicknessMm: 150 })).toThrow(/锁定/)
    expect(() => apply(roomLocked, { type: 'moveVertex', id: vertex.id, positionMm: { x: vertex.xMm, y: vertex.yMm + 50 } })).toThrow(/锁定/)
    const openingLocked = structuredClone(scene); openingLocked.openings[secret.id].editLocked = true
    expect(() => apply(openingLocked, { type: 'updateOpening', id: secret.id, changes: { widthMm: 1000 } })).toThrow(/锁定/)
    expect(() => apply(openingLocked, { type: 'deleteOpening', id: secret.id })).toThrow(/锁定/)
    const layerLocked = structuredClone(scene); layerLocked.userLayers[C2_LAYER].editLocked = true
    expect(() => apply(layerLocked, { type: 'createRoom', id: 'new', floorId: C2_FLOOR, layerId: C2_LAYER, thicknessMm: 100,
      boundaryMm: [{ x: -1500, y: -1500 }, { x: -500, y: -1500 }, { x: -500, y: -500 }, { x: -1500, y: -500 }] })).toThrow(/锁定/)
    expect(() => apply(layerLocked, { type: 'updateRoom', id: 'H1', changes: { purpose: 'blocked' } })).toThrow(/锁定/)
    expect(() => apply(layerLocked, { type: 'updateOpening', id: 'H1-H2', changes: { state: 'open' } })).toThrow(/锁定/)
  })

  it('keeps draft isolation legal and rejects invalid/self-crossing, overlapping or boundary-exceeding room candidates', () => {
    const scene = empty(), room: SceneCommandV3 = { type: 'createRoom', id: 'draft', floorId: C2_FLOOR, layerId: C2_LAYER,
      thicknessMm: 100, boundaryMm: [{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 6000, y: 4000 }, { x: 1000, y: 5000 }] }
    const next = apply(scene, room), checked = validateSceneV3(next)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.warnings).toContainEqual(expect.objectContaining({ code: 'DRAFT_ACCESS', entityId: 'draft' }))
    expect(() => apply(next, { type: 'updateRoom', id: 'draft', changes: { accessExpectation: 'required' } })).toThrow(/连通|入口|到达/)
    expect(() => apply(next, { ...room, id: 'overlap' })).toThrow(/重叠|占用|复用/)
    expect(() => apply(scene, { ...room, boundaryMm: [{ x: 1000, y: 1000 }, { x: 5000, y: 5000 }, { x: 1000, y: 5000 }, { x: 5000, y: 1000 }] })).toThrow(/多边形|轮廓|相交|面积/)
    expect(() => apply(scene, { ...room, boundaryMm: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 5000 }, { x: 0, y: 5000 }] })).toThrow(/边界|越过/)
    expect(scene.rooms).toEqual({})
  })

  it('preserves snapshot identity for no-op building properties and rejects unknown hidden fields', () => {
    const scene = createScn01DocumentC2(), certified = applySnapshotCommandsV3(scene, [])
    expect(applySnapshotCommandsV3(certified, [{ type: 'updateRoom', id: 'H1', changes: { purpose: certified.rooms.H1.purpose } }])).toBe(certified)
    expect(applySnapshotCommandsV3(certified, [{ type: 'updateOpening', id: 'outside-H1', changes: { state: 'closed' } }])).toBe(certified)
    expect(() => apply(scene, { type: 'updateOpening', id: 'outside-H1', changes: { widthMm: 1200, editLocked: false } } as never)).toThrow(/指令无效/)
  })
})

describe('C2 privacy and complete project contract', () => {
  it('uses an independently built six-room reference and fixed masks rather than the private room outline', () => {
    const scene = createScn01DocumentC2(), reference = createScn01DocumentC2({ publicReference: true })
    const gm = projectSceneV3(scene, 'gm'), player = projectSceneV3(scene, 'player'), expected = projectSceneV3(reference, 'player')
    expect(gm.rooms.map(room => room.id)).toContain('HS'); expect(player.rooms.map(room => room.id)).not.toContain('HS')
    expect(gm.walls.flatMap(wall => wall.openings).filter(opening => opening.secret)).toHaveLength(2)
    expect(player.walls.flatMap(wall => wall.openings).some(opening => opening.secret)).toBe(false)
    expect(player.walls).toEqual(expected.walls); expect(player.rooms).toEqual(expected.rooms)
    expect(player.props).toEqual(expected.props); expect(player.notes).toEqual([])
    expect(player.bounds).toEqual(C2_EXPORT_BOUNDS); expect(player.masks).toEqual(expected.masks)
    expect(scene.notes.C1.visibility).toBe('gm'); expect(scene.notes.C2.visibility).toBe('gm'); expect(scene.notes.C3.visibility).toBe('gm')
  })

  it('fails closed if fixed masking no longer covers private walls, floor, decoration or shadows', () => {
    const scene = createScn01DocumentC2(), maskId = 'SCN01-fixed-mask'
    delete scene.regions[maskId]; delete scene.entityLayers[maskId]
    expect(() => projectSceneV3(scene, 'player')).toThrow(/固定遮罩未覆盖/)
    expect(() => projectSceneV3(scene, 'gm')).not.toThrow()
  })

  it('roundtrips all seven rooms, topology, openings, privacy and identity through a strict v4 complete package', async () => {
    const project = createScn01ProjectC2(), before = structuredClone(project.document)
    const reopened = await importProjectV4(await exportProjectV4(project))
    expect(reopened.document).toEqual(project.document); expect(reopened.historyIdentity).toEqual(project.historyIdentity)
    expect(reopened.assets).toEqual({}); expect(reopened.licenses).toEqual({}); expect(project.document).toEqual(before)
    expect(projectSceneV3(reopened.document, 'player').walls).toEqual(projectSceneV3(project.document, 'player').walls)
  })
})
