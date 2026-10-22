import { describe, expect, it } from 'vitest'
import { openingEndpointsV2, roomPointsV2 } from '../v2/geometry'
import { buildingDependantsV3, previewBuildingCommandsV3, type BuildingCommandV3 } from './building'
import { applyCommandsV3, applySnapshotCommandsV3, type SceneCommandV3 } from './commands'
import { validateSceneV3 } from './schema'
import { validateSceneSnapshotV3 } from './snapshots'
import { layerSceneV3, symbolPropV3 } from './test-fixtures'
import type { PointMm, SceneDocumentV3, WallV2 } from './types'

const floorId = 'blank-floor'
const rectangle = (x = 1000, y = 1000, width = 6000, height = 6000): PointMm[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
const room = (id: string, boundaryMm = rectangle(), options: Partial<Extract<BuildingCommandV3, { type: 'createRoom' }>> = {}): BuildingCommandV3 => ({
  type: 'createRoom', id, floorId, boundaryMm, thicknessMm: 200, ...options,
})
const apply = (scene: SceneDocumentV3, ...commands: SceneCommandV3[]) => applyCommandsV3(scene, commands)
function blank(): SceneDocumentV3 {
  const scene = layerSceneV3()
  delete scene.props.item; delete scene.entityLayers.item
  return scene
}
function base(boundary = rectangle(), scene = blank()) { return apply(scene, room('a', boundary)) }
function wallBetween(scene: SceneDocumentV3, a: PointMm, b: PointMm): WallV2 {
  const same = (id: string, p: PointMm) => scene.vertices[id].xMm === p.x && scene.vertices[id].yMm === p.y
  const matches = Object.values(scene.walls).filter(wall => same(wall.startVertexId, a) && same(wall.endVertexId, b) || same(wall.startVertexId, b) && same(wall.endVertexId, a))
  if (matches.length !== 1) throw new Error(`Expected one wall between ${JSON.stringify(a)} and ${JSON.stringify(b)}.`)
  return matches[0]
}
function addDoor(scene: SceneDocumentV3, wall: WallV2, options: Partial<Extract<BuildingCommandV3, { type: 'addOpening' }>> = {}) {
  return apply(scene, { type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 2000, widthMm: 1200, kind: 'door', ...options })
}
const area = (points: PointMm[]) => points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0)

describe('C2 native v3 building transactions', () => {
  it.each([false, true])('normalizes drawn direction (reversed=%s) while retaining a simple concave outline', reversed => {
    const points = [{ x: 1000, y: 1000 }, { x: 9000, y: 1000 }, { x: 9000, y: 5000 }, { x: 5000, y: 5000 }, { x: 5000, y: 9000 }, { x: 1000, y: 9000 }]
    const source = blank(), before = structuredClone(source), next = apply(source, room('a', reversed ? [...points].reverse() : points))
    expect(area(roomPointsV2(next, next.rooms.a))).toBeGreaterThan(0)
    expect(new Set(roomPointsV2(next, next.rooms.a).map(p => `${p.x},${p.y}`))).toEqual(new Set(points.map(p => `${p.x},${p.y}`)))
    expect(Object.keys(next.vertices)).toHaveLength(6); expect(Object.keys(next.walls)).toHaveLength(6)
    expect(next.rooms.a).toMatchObject({ accessExpectation: 'unspecified', groundElevationMm: 0, supportRef: { kind: 'floor', id: floorId }, floorStyle: null })
    expect(next.revision).toBe(source.revision); expect(source).toEqual(before)
  })

  it('rejects self intersections, repeated points, backtracking, overlap and floor overflow atomically', () => {
    const source = base(), before = structuredClone(source)
    const invalid = [
      [{ x: 9000, y: 1000 }, { x: 15000, y: 7000 }, { x: 9000, y: 7000 }, { x: 15000, y: 1000 }],
      [{ x: 9000, y: 1000 }, { x: 15000, y: 1000 }, { x: 9000, y: 1000 }, { x: 15000, y: 7000 }],
      [{ x: 9000, y: 1000 }, { x: 15000, y: 1000 }, { x: 12000, y: 1000 }, { x: 15000, y: 7000 }, { x: 9000, y: 7000 }],
      rectangle(3000, 3000), rectangle(18000, 18000),
    ]
    for (const points of invalid) expect(() => apply(source, room('bad', points))).toThrow()
    expect(() => apply(source, room('fraction', rectangle().map((p, i) => i ? p : { ...p, x: 1000.5 })))).toThrow(/安全整数/)
    expect(source).toEqual(before)
  })

  it('reuses the full common edge and stable vertex identities without duplicate walls', () => {
    const source = base(), common = wallBetween(source, { x: 7000, y: 1000 }, { x: 7000, y: 7000 })
    const next = apply(source, room('b', rectangle(7000, 1000)))
    expect(Object.keys(next.rooms)).toHaveLength(2); expect(Object.keys(next.vertices)).toHaveLength(6); expect(Object.keys(next.walls)).toHaveLength(7)
    expect(next.walls[common.id]).toEqual(common)
    expect(next.rooms.b.boundaryVertexIds).toContain(common.startVertexId); expect(next.rooms.b.boundaryVertexIds).toContain(common.endVertexId)
    expect(validateSceneV3(next).ok).toBe(true)
    expect(() => apply(source, room('bad', rectangle(7000, 1000), { thicknessMm: 300 }))).toThrow(/厚度/)
  })

  it('preserves collinear boundary points and expands a larger edge across several existing walls', () => {
    const points = [{ x: 1000, y: 1000 }, { x: 7000, y: 1000 }, { x: 7000, y: 4000 }, { x: 7000, y: 7000 }, { x: 1000, y: 7000 }]
    const source = base(points), next = apply(source, room('b', rectangle(7000, 1000)))
    expect(source.rooms.a.boundaryVertexIds).toHaveLength(5); expect(next.rooms.b.boundaryVertexIds).toHaveLength(5)
    expect(Object.keys(next.vertices)).toHaveLength(7); expect(Object.keys(next.walls)).toHaveLength(8)
    const common = Object.values(next.walls).filter(wall => next.vertices[wall.startVertexId].xMm === 7000 && next.vertices[wall.endVertexId].xMm === 7000)
    expect(common).toHaveLength(2); expect(validateSceneV3(next).ok).toBe(true)
  })

  it('adopts only an applicable fixed room material and never duplicates wall overlay identities during splitting', () => {
    const source = blank(), origin = { kind: 'original' as const, attribution: 'Sceneweave tests', canEmbed: true }
    source.assets.texture = { id: 'texture', sha256: 'a'.repeat(64), mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'MIT', origin }
    source.materials.wood = { id: 'wood', catalogId: 'test.wood', version: 1, licenseRef: 'MIT', origin, name: '木纹', tags: [], textureAssetId: 'texture', defaultTileSizeMm: { width: 1000, height: 2000 }, applicableSurfaces: ['room', 'wall'] }
    const next = apply(source, room('a', rectangle(1000, 1000, 6000, 12000), { materialRef: { id: 'wood', version: 1 } }))
    expect(next.rooms.a.floorStyle).toMatchObject({ base: { materialRef: { id: 'wood', version: 1 }, tileSizeMm: { width: 1000, height: 2000 } }, overlays: [] })
    expect(() => apply(source, room('a', rectangle(), { materialRef: { id: 'wood', version: 2 } }))).toThrow(/固定版本/)
    const wrongSurface = structuredClone(source); wrongSurface.materials.wood.applicableSurfaces = ['wall']
    expect(() => apply(wrongSurface, room('a', rectangle(), { materialRef: { id: 'wood', version: 1 } }))).toThrow(/适用固定版本/)
    const wall = wallBetween(next, { x: 7000, y: 1000 }, { x: 7000, y: 13000 }), basePaint = next.rooms.a.floorStyle!.base
    next.walls[wall.id].topStyle = { base: structuredClone(basePaint), overlays: [{ id: 'wall-overlay', boundaryMm: rectangle(6900, 2000, 200, 1000), paint: structuredClone(basePaint), blendWidthMm: 0, renderOrder: 0 }] }
    expect(validateSceneV3(next).ok).toBe(true)
    expect(() => apply(next, room('b', rectangle(7000, 4000, 6000, 6000)))).toThrow(/局部材质覆盖/)
    expect(next.walls[wall.id].topStyle?.overlays).toHaveLength(1)
  })

  it('rejects ambiguous coincident vertex identities instead of silently merging them', () => {
    const source = base(), existing = source.vertices[source.rooms.a.boundaryVertexIds[1]], layerId = source.entityLayers.a
    source.vertices.coincident = { ...existing, id: 'coincident' }; source.entityLayers.coincident = layerId
    expect(validateSceneV3(source).ok).toBe(true)
    const before = structuredClone(source)
    expect(() => apply(source, room('b', rectangle(7000, 1000)))).toThrow(/不同顶点身份/)
    expect(source).toEqual(before)
  })

  it('splits a partial common edge, updates the old room and inherits old structural layers', () => {
    const source = apply(base(rectangle(1000, 1000, 6000, 12000)), { type: 'createLayer', id: 'new-layer', floorId, name: '新增房间' })
    const oldLayer = source.entityLayers.a, common = wallBetween(source, { x: 7000, y: 1000 }, { x: 7000, y: 13000 })
    const command = room('b', rectangle(7000, 4000, 6000, 6000), { layerId: 'new-layer' }), preview = previewBuildingCommandsV3(source, [command])
    expect(preview.reason).toBeNull(); expect(preview.layerIds).toEqual([oldLayer, 'new-layer'].sort())
    expect(preview.affectedIds).toContain('a'); expect(preview.changedIds).toEqual(['a', common.id].sort()); expect(preview.commandCost).toBe(12)
    const next = apply(source, command)
    expect(next.rooms.a.boundaryVertexIds).toHaveLength(6); expect(Object.keys(next.walls)).toHaveLength(9); expect(Object.keys(next.vertices)).toHaveLength(8)
    const originalStart = next.walls[common.id]
    expect(originalStart.startVertexId).toBe(common.startVertexId); expect(next.vertices[originalStart.endVertexId].yMm).toBe(4000)
    for (const wall of Object.values(next.walls).filter(wall => next.vertices[wall.startVertexId].xMm === 7000 && next.vertices[wall.endVertexId].xMm === 7000)) {
      expect(next.entityLayers[wall.id]).toBe(oldLayer)
      expect(next.entityLayers[wall.startVertexId]).toBe(oldLayer); expect(next.entityLayers[wall.endVertexId]).toBe(oldLayer)
    }
    expect(next.entityLayers.b).toBe('new-layer')
  })

  it.each(['start', 'end'] as const)('keeps real opening endpoints and all door state when splitting from %s reference', reference => {
    const empty = base(rectangle(1000, 1000, 6000, 12000)), wall = wallBetween(empty, { x: 7000, y: 1000 }, { x: 7000, y: 13000 })
    const source = addDoor(empty, wall, { offsetReferenceVertexId: reference === 'start' ? wall.startVertexId : wall.endVertexId, offsetMm: 5000, locked: true, secret: true, revealed: true, state: 'open' })
    const endpoints = openingEndpointsV2(source, source.openings.door), next = apply(source, room('b', rectangle(7000, 4000, 6000, 6000)))
    for (const [index, actual] of openingEndpointsV2(next, next.openings.door).entries()) {
      expect(actual.x).toBeCloseTo(endpoints[index].x, 10); expect(actual.y).toBeCloseTo(endpoints[index].y, 10)
    }
    expect(next.openings.door).toMatchObject({ offsetMm: 2000, widthMm: 1200, kind: 'door', locked: true, secret: true, revealed: true, state: 'open' })
    expect(next.openings.door.wallId).not.toBe(wall.id)
  })

  it('refuses a split inside an opening and refuses rounding a diagonal reference distance', () => {
    const empty = base(rectangle(1000, 1000, 6000, 12000)), wall = wallBetween(empty, { x: 7000, y: 1000 }, { x: 7000, y: 13000 })
    const source = addDoor(empty, wall, { offsetMm: 2500 }), before = structuredClone(source)
    expect(() => apply(source, room('b', rectangle(7000, 4000, 6000, 6000)))).toThrow(/跨越拆分点/)
    expect(source).toEqual(before)
    const diagonal = base([{ x: 2000, y: 2000 }, { x: 12000, y: 12000 }, { x: 2000, y: 12000 }])
    const diagonalWall = wallBetween(diagonal, { x: 2000, y: 2000 }, { x: 12000, y: 12000 })
    const withOpening = addDoor(diagonal, diagonalWall, { offsetMm: 8000, widthMm: 1000 }), diagonalBefore = structuredClone(withOpening)
    expect(() => apply(withOpening, room('b', [{ x: 5000, y: 5000 }, { x: 12000, y: 5000 }, { x: 12000, y: 12000 }]))).toThrow(/拒绝近似重映射/)
    expect(withOpening).toEqual(diagonalBefore)
  })

  it('uses final native geometry validation for openings, including both attachment endpoints', () => {
    const source = base(), wall = Object.values(source.walls)[0], before = structuredClone(source)
    const valid = addDoor(source, wall)
    expect(() => addDoor(source, wall, { offsetMm: 0 })).toThrow(/安全间隙/)
    expect(() => addDoor(source, wall, { offsetMm: 5500 })).toThrow(/超界/)
    expect(() => addDoor(source, wall, { widthMm: 1 })).toThrow(/门净宽/)
    expect(() => addDoor(source, wall, { offsetReferenceVertexId: 'missing' })).toThrow(/稳定基准/)
    expect(() => apply(valid, { type: 'addOpening', id: 'overlap', wallId: wall.id, offsetReferenceVertexId: wall.endVertexId, offsetMm: 3000, widthMm: 1200, kind: 'window' })).toThrow(/重叠/)
    const moved = apply(valid, { type: 'updateOpening', id: 'door', changes: { offsetReferenceVertexId: wall.endVertexId, offsetMm: 1000, widthMm: 1400, state: 'open', locked: true, secret: true } })
    expect(moved.openings.door).toMatchObject({ offsetReferenceVertexId: wall.endVertexId, offsetMm: 1000, widthMm: 1400, state: 'open', locked: true, secret: true })
    const another = Object.values(source.walls)[1]
    expect(() => apply(moved, { type: 'updateOpening', id: 'door', changes: { wallId: another.id, offsetReferenceVertexId: wall.startVertexId } })).toThrow(/稳定基准/)
    const attached = apply(moved, { type: 'updateOpening', id: 'door', changes: { wallId: another.id, offsetReferenceVertexId: another.startVertexId } })
    expect(attached.openings.door.wallId).toBe(another.id)
    expect(apply(attached, { type: 'deleteOpening', id: 'door' }).openings).toEqual({})
    expect(source).toEqual(before)
  })

  it('requires real exterior entrances, preserves required connectivity and removes references explicitly', () => {
    let source = base(), wall = wallBetween(source, { x: 7000, y: 1000 }, { x: 7000, y: 7000 })
    source = addDoor(source, wall)
    expect(() => apply(source, { type: 'updateRoom', id: 'a', changes: { accessExpectation: 'required' } })).toThrow(/结构连接/)
    source = apply(source, { type: 'setEntranceOpenings', ids: ['door'] }, { type: 'updateRoom', id: 'a', changes: { accessExpectation: 'required' } })
    expect(source.constraints.entranceOpeningIds).toEqual(['door'])
    expect(() => apply(source, room('b', rectangle(7000, 1000)))).toThrow(/入口须为恰好一个房间/)
    expect(() => apply(source, { type: 'deleteOpening', id: 'door' })).toThrow(/显式入口引用/)
    source = apply(source, { type: 'createNote', id: 'door-note', floorId, anchor: { type: 'entity', entityKind: 'opening', entityId: 'door' }, kind: 'note', text: '入口', visibility: 'gm' })
    expect(() => apply(source, { type: 'setEntranceOpenings', ids: [] }, { type: 'updateRoom', id: 'a', changes: { accessExpectation: 'unspecified' } }, { type: 'deleteOpening', id: 'door' })).toThrow(/注记/)
    const next = apply(source, { type: 'deleteNote', id: 'door-note' }, { type: 'setEntranceOpenings', ids: [] }, { type: 'updateRoom', id: 'a', changes: { accessExpectation: 'unspecified' } }, { type: 'deleteOpening', id: 'door' })
    expect(next.openings).toEqual({}); expect(next.constraints.entranceOpeningIds).toEqual([])
  })

  it('rejects crossing a standalone wall rather than implicitly changing unrelated topology', () => {
    const source = blank(), layerId = Object.keys(source.userLayers)[0]
    source.vertices.left = { id: 'left', floorId, xMm: 2000, yMm: 5000, editLocked: false }; source.vertices.right = { id: 'right', floorId, xMm: 14000, yMm: 5000, editLocked: false }
    source.walls.standalone = { id: 'standalone', floorId, startVertexId: 'left', endVertexId: 'right', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null, editLocked: false }
    for (const id of ['left', 'right', 'standalone']) source.entityLayers[id] = layerId
    expect(validateSceneV3(source).ok).toBe(true)
    expect(() => apply(source, room('a'))).toThrow(/穿过现有墙/)
  })

  it('protects IDs and measures the expanded budget across the whole atomic batch', () => {
    const source = blank(), layerId = Object.keys(source.userLayers)[0]
    source.props['a:vertex:0'] = symbolPropV3('a:vertex:0', 15000, 15000); source.entityLayers['a:vertex:0'] = layerId
    expect(() => apply(source, room('a'))).toThrow(/未占用/)
    expect(() => apply(blank(), room('x'.repeat(250)))).toThrow(/不超过256/)
    const points = [
      ...Array.from({ length: 32 }, (_, i) => ({ x: 1000 + i * 400, y: 1000 })),
      ...Array.from({ length: 32 }, (_, i) => ({ x: 13800, y: 1000 + i * 400 })),
      ...Array.from({ length: 32 }, (_, i) => ({ x: 13800 - i * 400, y: 13800 })),
      ...Array.from({ length: 32 }, (_, i) => ({ x: 1000, y: 13800 - i * 400 })),
    ]
    const preview = previewBuildingCommandsV3(blank(), [room('large', points)])
    expect(preview.commandCost).toBe(257); expect(preview.reason).toMatch(/256/)
    expect(() => apply(blank(), room('large', points))).toThrow(/256/)
    const many = Array.from({ length: 29 }, (_, i) => room(`room-${i}`, rectangle(1000 + i % 6 * 3000, 1000 + Math.floor(i / 6) * 3000, 2000, 2000)))
    const empty = blank(), before = structuredClone(empty)
    expect(() => apply(empty, ...many)).toThrow(/256/); expect(empty).toEqual(before)
  })

  it.each(['room', 'wall', 'vertex', 'opening', 'prop', 'note'] as const)('enforces %s edit locks over the building dependency closure', kind => {
    let scene = base(rectangle(1000, 1000, 8000, 8000), layerSceneV3()), wall = Object.values(scene.walls)[0]
    scene.props.item.supportRef = { kind: 'room', id: 'a' }; scene.props.item.roomId = 'a'
    scene = addDoor(scene, wall)
    scene = apply(scene, { type: 'createNote', id: 'anchor-note', floorId, anchor: { type: 'entity', entityKind: 'room', entityId: 'a' }, kind: 'note', text: '注记', visibility: 'gm' })
    const id = { room: 'a', wall: wall.id, vertex: wall.startVertexId, opening: 'door', prop: 'item', note: 'anchor-note' }[kind]
    scene = apply(scene, { type: 'setEditLock', kind, id, locked: true })
    const command: BuildingCommandV3 = { type: 'updateRoom', id: 'a', changes: { purpose: '修改用途' } }, before = structuredClone(scene)
    const preview = previewBuildingCommandsV3(scene, [command])
    expect(preview.affectedIds).toContain(id); expect(preview.reason).toMatch(/锁定/)
    expect(() => apply(scene, command)).toThrow(/锁定/); expect(scene).toEqual(before)
  })

  it('reports cross-layer locked dependencies, a locked creation target and recursive anchored notes', () => {
    let scene = apply(base(), { type: 'createLayer', id: 'other-layer', floorId, name: '保护层' })
    scene = apply(scene,
      { type: 'createNote', id: 'first-note', floorId, anchor: { type: 'entity', entityKind: 'room', entityId: 'a' }, kind: 'note', text: '第一层', visibility: 'gm' },
      { type: 'createNote', id: 'second-note', floorId, anchor: { type: 'entity', entityKind: 'note', entityId: 'first-note' }, kind: 'note', text: '第二层', visibility: 'gm', layerId: 'other-layer' },
    )
    scene = apply(scene, { type: 'setLayerLock', id: 'other-layer', locked: true })
    const command = room('b', rectangle(7000, 1000)), wall = Object.values(scene.walls)[0]
    expect(buildingDependantsV3(scene, [wall.id])).toEqual(expect.arrayContaining(['first-note', 'second-note', 'a']))
    const preview = previewBuildingCommandsV3(scene, [command])
    expect(preview.affectedIds).toContain('second-note'); expect(preview.layerIds).toContain('other-layer'); expect(preview.reason).toMatch(/锁定/)
    expect(() => apply(scene, command)).toThrow(/锁定/)
    const targetPreview = previewBuildingCommandsV3(scene, [room('isolated', rectangle(12000, 12000), { layerId: 'other-layer' })])
    expect(targetPreview.createdIds).toContain('isolated'); expect(targetPreview.reason).toMatch(/图层/)
  })

  it('uses explicit terrain support, matching elevation and complete containment without reparenting props', () => {
    const scene = layerSceneV3(), layerId = scene.entityLayers.item
    scene.terrainAreas.pad = { id: 'pad', floorId, editLocked: false, visibility: 'public',
      boundaryMm: rectangle(1000, 1000, 16000, 16000).map((positionMm, i) => ({ id: `pad-point-${i}`, segmentId: `pad-segment-${i}`, positionMm })),
      groundElevationMm: 1000, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.entityLayers.pad = layerId; scene.props.item.supportRef = { kind: 'terrainArea', id: 'pad' }
    expect(validateSceneV3(scene).ok).toBe(true)
    expect(() => apply(scene, room('a', rectangle(3000, 3000)))).toThrow(/支撑|高程/)
    const next = apply(scene, room('a', rectangle(3000, 3000), { supportRef: { kind: 'terrainArea', id: 'pad' } }))
    expect(next.rooms.a.groundElevationMm).toBe(1000); expect(next.props.item).toEqual(scene.props.item)
    expect(() => apply(scene, room('a', rectangle(15000, 15000, 3000, 3000), { supportRef: { kind: 'terrainArea', id: 'pad' } }))).toThrow(/支撑|高程/)
    const locked = apply(scene, { type: 'setEditLock', kind: 'terrainArea', id: 'pad', locked: true })
    expect(() => apply(locked, room('a', rectangle(3000, 3000), { supportRef: { kind: 'terrainArea', id: 'pad' } }))).toThrow(/锁定/)
  })

  it('validates a mixed building, legacy and annotation transaction only at its final state', () => {
    const source = layerSceneV3(), before = structuredClone(source)
    const next = apply(source,
      room('a', rectangle(), { accessExpectation: 'required' }),
      { type: 'updateProp', id: 'item', changes: { rotationDeg: 45 } },
      { type: 'addOpening', id: 'door', wallId: 'a:wall:0', offsetReferenceVertexId: 'a:vertex:0', offsetMm: 2000, widthMm: 1200, kind: 'door' },
      { type: 'setEntranceOpenings', ids: ['door'] },
      { type: 'createNote', id: 'note', floorId, anchor: { type: 'entity', entityKind: 'room', entityId: 'a' }, kind: 'clue', text: '线索', visibility: 'gm' },
      { type: 'upsertManualMask', id: 'mask', floorId, boundsMm: { x: 14000, y: 14000, width: 1000, height: 1000 } },
    )
    expect(next.props.item.rotationDeg).toBe(45); expect(next.notes.note.anchor).toEqual({ type: 'entity', entityKind: 'room', entityId: 'a' }); expect(next.regions.mask.kind).toBe('manualMask')
    expect(validateSceneV3(next).ok).toBe(true); expect(source).toEqual(before)
    expect(() => apply(source, room('a', rectangle(), { accessExpectation: 'required' }), { type: 'updateProp', id: 'item', changes: { rotationDeg: 45 } })).toThrow(/结构连接/)
    expect(source).toEqual(before)
  })

  it('keeps certified no-op identity and strictly rejects injected fields or mixed unlock/edit batches', () => {
    const scene = base(), checked = validateSceneSnapshotV3(scene)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    expect(applySnapshotCommandsV3(checked.document, [{ type: 'updateRoom', id: 'a', changes: { purpose: scene.rooms.a.purpose } }])).toBe(checked.document)
    expect(() => apply(scene, { type: 'updateRoom', id: 'a', changes: { purpose: 'bad', groundElevationMm: 10 } } as unknown as SceneCommandV3)).toThrow(/指令无效/)
    expect(() => apply(scene, { type: 'setEditLock', kind: 'room', id: 'a', locked: false }, { type: 'updateRoom', id: 'a', changes: { purpose: 'bad' } })).toThrow(/须分别独立提交/)
  })
})
