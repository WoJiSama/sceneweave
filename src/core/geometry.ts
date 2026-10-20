import type { BoundsMm, Issue, Opening, PointMm, Room, SceneDocument, Wall } from './types'

/** Integer input geometry uses exact comparisons. Half millimetres occur only in derived centre-line clearances. */
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined

export const netClearance = (distanceMm: number, thicknessA: number, thicknessB: number): number => distanceMm - (thicknessA + thicknessB) / 2

export function wallLength(scene: SceneDocument, wall: Wall): number {
  const a = own(scene.vertices, wall.startVertexId), b = own(scene.vertices, wall.endVertexId)
  if (!a || !b) throw new Error(`Wall ${wall.id} references a missing vertex`)
  return Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm)
}
export function roomPoints(scene: SceneDocument, room: Room): PointMm[] {
  return room.boundaryVertexIds.map(id => {
    const v = own(scene.vertices, id)
    if (!v) throw new Error(`Room ${room.id} references missing vertex ${id}`)
    return { x: v.xMm, y: v.yMm }
  })
}
export function openingEndpoints(scene: SceneDocument, opening: Opening): [PointMm, PointMm] {
  const wall = own(scene.walls, opening.wallId)
  if (!wall) throw new Error(`Opening ${opening.id} references a missing wall`)
  const start = own(scene.vertices, wall.startVertexId), end = own(scene.vertices, wall.endVertexId)
  if (!start || !end) throw new Error(`Opening ${opening.id} references missing wall vertices`)
  const length = wallLength(scene, wall)
  if (!length) throw new Error(`Opening ${opening.id} has a zero-length wall`)
  const at = (offset: number): PointMm => ({ x: start.xMm + (end.xMm - start.xMm) / length * offset, y: start.yMm + (end.yMm - start.yMm) / length * offset })
  return [at(opening.offsetMm), at(opening.offsetMm + opening.widthMm)]
}

export function signedArea(points: PointMm[]): number {
  // Integer arithmetic keeps exact winding/zero tests, including translated large coordinates.
  let twiceArea = 0n
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    twiceArea += BigInt(a.x) * BigInt(b.y) - BigInt(b.x) * BigInt(a.y)
  }
  return Number(twiceArea) / 2
}
const samePoint = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const cross = (a: PointMm, b: PointMm, c: PointMm) => {
  if ([a.x, a.y, b.x, b.y, c.x, c.y].every(Number.isInteger)) return Number((BigInt(b.x) - BigInt(a.x)) * (BigInt(c.y) - BigInt(a.y)) - (BigInt(b.y) - BigInt(a.y)) * (BigInt(c.x) - BigInt(a.x)))
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
const between = (value: number, a: number, b: number) => value >= Math.min(a, b) && value <= Math.max(a, b)
const onSegment = (p: PointMm, a: PointMm, b: PointMm) => cross(a, b, p) === 0 && between(p.x, a.x, b.x) && between(p.y, a.y, b.y)
function segmentsMeet(a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean {
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b)
  return (ac * ad < 0 && ca * cb < 0) || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d)
}
export function pointInPolygon(point: PointMm, polygon: PointMm[], includeBoundary = true): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i]
    if (onSegment(point, a, b)) return includeBoundary
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
export const pointInBounds = (p: PointMm, b: BoundsMm): boolean => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height

function polygonIssues(points: PointMm[], id: string, orthogonal: boolean): Issue[] {
  const errors: Issue[] = []
  const add = (code: string, message: string) => errors.push({ code, message, entityId: id })
  if (points.length < 3 || new Set(points.map(p => `${p.x},${p.y}`)).size !== points.length) add('INVALID_POLYGON', '多边形至少需要三个不同顶点，末尾不能重复起点。')
  const area = signedArea(points)
  if (area === 0 || (orthogonal && area < 0)) add('POLYGON_WINDING', orthogonal ? '房间必须有正面积并按视觉顺时针排列。' : '区域必须具有非零面积。')
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (samePoint(a, b)) add('ZERO_LENGTH_EDGE', '多边形不能含零长边。')
    if (orthogonal && a.x !== b.x && a.y !== b.y) add('NON_ORTHOGONAL_ROOM', 'M0 房间边必须水平或竖直。')
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
      if (segmentsMeet(a, b, points[j], points[(j + 1) % points.length])) add('SELF_INTERSECTION', '多边形不能自交或自接触。')
    }
    // Adjacent collinear segments may continue through a shared-wall split, but cannot double back.
    const c = points[(i + 2) % points.length]
    if (cross(a, b, c) === 0 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) add('SELF_INTERSECTION', '相邻边不能沿原路折返。')
  }
  return errors
}

/** Decompose a simple orthogonal polygon into disjoint, open-interior rectangles. */
function polygonRectangles(points: PointMm[]): BoundsMm[] {
  const ys = [...new Set(points.map(p => p.y))].sort((a, b) => a - b)
  const rectangles: BoundsMm[] = []
  for (let j = 0; j < ys.length - 1; j++) {
    const xs: number[] = []
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length]
      if (Math.min(a.y, b.y) <= ys[j] && Math.max(a.y, b.y) > ys[j]) xs.push(a.x)
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) rectangles.push({ x: xs[i], y: ys[j], width: xs[i + 1] - xs[i], height: ys[j + 1] - ys[j] })
  }
  return rectangles
}
const overlapRect = (a: BoundsMm, b: BoundsMm) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)
const edgeKey = (a: string, b: string) => a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`

/** Schema has already checked shape; this checks references and actual geometry without repairing the input. */
export function validateGeometry(scene: SceneDocument): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [], warnings: Issue[] = []
  const error = (code: string, message: string, entityId?: string) => errors.push({ code, message, ...(entityId ? { entityId } : {}) })
  const floors = Object.values(scene.floors)
  if (floors.length !== 1) error('UNSUPPORTED_FLOORS', 'M0 仅支持恰好一层，不能自动合并或省略楼层。')
  if (scene.constraints.pathChecks.length) error('UNSUPPORTED_PATH_CHECK', 'M0 尚未实现占地与门状态的路径验证，不能接受 pathChecks 硬约束。')
  if (scene.constraints.minPathWidthMm !== undefined) error('UNSUPPORTED_PATH_CLEARANCE', 'M0 尚未实现全图通行净宽验证，不能接受 minPathWidthMm 硬约束。')
  const allIds = new Set<string>()
  if (!Number.isSafeInteger(scene.exportBoundsMm.x + scene.exportBoundsMm.width) || !Number.isSafeInteger(scene.exportBoundsMm.y + scene.exportBoundsMm.height)) error('UNSAFE_BOUNDS', '导出边界端点必须在安全整数范围内。')
  for (const collection of ['floors', 'vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes', 'assets'] as const) {
    for (const [key, entity] of Object.entries(scene[collection])) {
      if (key !== entity.id) error('ID_KEY_MISMATCH', '集合键必须等于实体 id。', entity.id)
      if (allIds.has(entity.id)) error('DUPLICATE_ID', '不同实体必须使用不同的稳定 ID。', entity.id)
      allIds.add(entity.id)
      if ('floorId' in entity && !own(scene.floors, entity.floorId)) error('MISSING_FLOOR', '实体引用的楼层不存在。', entity.id)
    }
  }
  for (const floor of floors) {
    if (!Number.isSafeInteger(floor.boundsMm.x + floor.boundsMm.width) || !Number.isSafeInteger(floor.boundsMm.y + floor.boundsMm.height)) error('UNSAFE_BOUNDS', '边界端点必须在安全整数范围内。', floor.id)
  }
  const withinFloor = (p: PointMm, floorId: string, id: string) => {
    const floor = own(scene.floors, floorId)
    if (floor && !pointInBounds(p, floor.boundsMm)) error('OUTSIDE_FLOOR', '实体几何越过楼层世界边界。', id)
  }
  const coordinates = new Set<string>()
  for (const vertex of Object.values(scene.vertices)) {
    withinFloor({ x: vertex.xMm, y: vertex.yMm }, vertex.floorId, vertex.id)
    const coordinate = `${vertex.floorId}:${vertex.xMm},${vertex.yMm}`
    if (coordinates.has(coordinate)) error('COINCIDENT_VERTICES', '同层重合顶点必须共享同一 ID。', vertex.id)
    coordinates.add(coordinate)
  }
  const edgeWalls = new Map<string, Wall[]>()
  const validWalls: { wall: Wall; a: PointMm; b: PointMm }[] = []
  for (const wall of Object.values(scene.walls)) {
    const a = own(scene.vertices, wall.startVertexId), b = own(scene.vertices, wall.endVertexId)
    if (!a || !b) { error('MISSING_VERTEX', '墙引用的顶点不存在。', wall.id); continue }
    if (a.floorId !== wall.floorId || b.floorId !== wall.floorId) error('CROSS_FLOOR_REFERENCE', '墙和两端顶点必须在同一楼层。', wall.id)
    if (a.xMm === b.xMm && a.yMm === b.yMm) error('ZERO_LENGTH_WALL', '墙长必须大于零。', wall.id)
    if (a.xMm !== b.xMm && a.yMm !== b.yMm) error('NON_ORTHOGONAL_WALL', 'M0 墙必须水平或竖直。', wall.id)
    const key = edgeKey(wall.startVertexId, wall.endVertexId)
    edgeWalls.set(key, [...(edgeWalls.get(key) ?? []), wall])
    validWalls.push({ wall, a: { x: a.xMm, y: a.yMm }, b: { x: b.xMm, y: b.yMm } })
  }
  for (const walls of edgeWalls.values()) if (walls.length > 1) error('DUPLICATE_WALL', '共享边只能有一条墙。', walls[1].id)
  for (let i = 0; i < validWalls.length; i++) {
    const u = validWalls[i]
    for (let j = i + 1; j < validWalls.length; j++) {
      const v = validWalls[j]
      if (u.wall.floorId !== v.wall.floorId || !segmentsMeet(u.a, u.b, v.a, v.b)) continue
      const collinear = cross(u.a, u.b, v.a) === 0 && cross(u.a, u.b, v.b) === 0
      const axis: 'x' | 'y' = u.a.x === u.b.x ? 'y' : 'x'
      const positiveOverlap = collinear && Math.min(Math.max(u.a[axis], u.b[axis]), Math.max(v.a[axis], v.b[axis])) > Math.max(Math.min(u.a[axis], u.b[axis]), Math.min(v.a[axis], v.b[axis]))
      if (positiveOverlap) { error('OVERLAPPING_WALLS', '墙段重叠；部分共墙必须先拆分并复用同一段。', v.wall.id); continue }
      const endpointShared = [u.wall.startVertexId, u.wall.endVertexId].some(id => id === v.wall.startVertexId || id === v.wall.endVertexId)
      if (!endpointShared) error('UNSPLIT_INTERSECTION', '墙交点必须拆分并共享同一顶点。', v.wall.id)
    }
  }
  const wallRooms = new Map<string, string[]>()
  const validRooms: { room: Room; rectangles: BoundsMm[] }[] = []
  for (const room of Object.values(scene.rooms)) {
    let valid = true
    for (const id of room.boundaryVertexIds) {
      const vertex = own(scene.vertices, id)
      if (!vertex) { error('MISSING_VERTEX', '房间引用的顶点不存在。', room.id); valid = false }
      else if (vertex.floorId !== room.floorId) error('CROSS_FLOOR_REFERENCE', '房间顶点必须在同一楼层。', room.id)
    }
    if (!valid) continue
    const points = roomPoints(scene, room)
    const polygonErrors = polygonIssues(points, room.id, true)
    errors.push(...polygonErrors)
    for (let i = 0; i < room.boundaryVertexIds.length; i++) {
      const a = room.boundaryVertexIds[i], b = room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length]
      const walls = edgeWalls.get(edgeKey(a, b)) ?? []
      if (walls.length !== 1) error('ROOM_WALL_MISMATCH', '房间每条边必须恰好对应一条墙，部分共墙须同步拆分房间环。', room.id)
      else wallRooms.set(walls[0].id, [...(wallRooms.get(walls[0].id) ?? []), room.id])
    }
    if (!polygonErrors.length) validRooms.push({ room, rectangles: polygonRectangles(points) })
    if (room.accessExpectation === 'unspecified') warnings.push({ code: 'DRAFT_ACCESS', message: '草稿房间尚未声明结构连通要求。', entityId: room.id })
  }
  for (const [wallId, rooms] of wallRooms) if (rooms.length > 2) error('WALL_ADJACENCY', '一条墙不能邻接超过两个房间。', wallId)
  for (let i = 0; i < validRooms.length; i++) {
    for (let j = i + 1; j < validRooms.length; j++) {
      const a = validRooms[i], b = validRooms[j]
      if (a.room.floorId === b.room.floorId && a.rectangles.some(r => b.rectangles.some(s => overlapRect(r, s)))) error('ROOM_OVERLAP', '同层房间内部面积不能重叠。', b.room.id)
    }
  }
  const openingsByWall = new Map<string, Opening[]>()
  for (const opening of Object.values(scene.openings)) {
    const wall = own(scene.walls, opening.wallId)
    if (!wall) { error('MISSING_WALL', '门窗附着的墙不存在。', opening.id); continue }
    if (wall.floorId !== opening.floorId) error('CROSS_FLOOR_REFERENCE', '门窗必须与附着墙同层。', opening.id)
    if (!own(scene.vertices, wall.startVertexId) || !own(scene.vertices, wall.endVertexId)) continue
    const length = wallLength(scene, wall), clearance = scene.constraints.wallEndClearanceMm
    if (opening.offsetMm < clearance || opening.offsetMm + opening.widthMm > length - clearance) error('OPENING_CLEARANCE', '门窗越过墙端或不满足当前墙端安全间隙。', opening.id)
    if (opening.kind === 'door' && scene.constraints.minDoorWidthMm !== undefined && opening.widthMm < scene.constraints.minDoorWidthMm) error('DOOR_WIDTH', '门净宽小于当前配置的最小门宽。', opening.id)
    openingsByWall.set(wall.id, [...(openingsByWall.get(wall.id) ?? []), opening])
  }
  for (const openings of openingsByWall.values()) {
    openings.sort((a, b) => a.offsetMm - b.offsetMm)
    for (let i = 1; i < openings.length; i++) if (openings[i].offsetMm < openings[i - 1].offsetMm + openings[i - 1].widthMm) error('OPENING_OVERLAP', '同一墙上的门窗开口不能重叠。', openings[i].id)
  }
  const graph = new Map<string, Set<string>>()
  const reachable = new Set<string>(), entrances = new Set(scene.constraints.entranceOpeningIds)
  for (const entranceId of entrances) {
    const entrance = own(scene.openings, entranceId)
    if (!entrance || entrance.kind !== 'door') { error('INVALID_ENTRANCE', '入口必须引用真实门。', entranceId); continue }
    const adjacent = wallRooms.get(entrance.wallId) ?? []
    if (adjacent.length !== 1) error('INVALID_ENTRANCE', '入口门必须位于一个房间与外部之间。', entranceId)
    else reachable.add(adjacent[0])
  }
  for (const wall of Object.values(scene.walls)) {
    const rooms = wallRooms.get(wall.id) ?? []
    if (rooms.length !== 2) continue
    // Structural access ignores present state/locks/secrets, never modifies any of them.
    if (!wall.blocksMovement || (openingsByWall.get(wall.id) ?? []).some(o => o.kind === 'door')) {
      for (let i = 0; i < 2; i++) { const neighbours = graph.get(rooms[i]) ?? new Set<string>(); neighbours.add(rooms[1 - i]); graph.set(rooms[i], neighbours) }
    }
  }
  const queue = [...reachable]
  for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next) }
  for (const room of Object.values(scene.rooms)) if (room.accessExpectation === 'required' && !reachable.has(room.id)) error('REQUIRED_UNREACHABLE', 'required 房间必须通过结构连接到显式外部入口（关闭或上锁的真实门仍算结构连接）。', room.id)
  for (const prop of Object.values(scene.props)) {
    if (prop.assetId !== null && !own(scene.assets, prop.assetId)) warnings.push({ code: 'MISSING_ASSET', message: '物件素材缺失，将使用占位显示；不能宣称视觉导出完整。', entityId: prop.id })
    if (prop.roomId !== undefined) {
      const room = own(scene.rooms, prop.roomId)
      if (!room) error('MISSING_ROOM', '物件归属房间不存在。', prop.id)
      else if (room.floorId !== prop.floorId) error('CROSS_FLOOR_REFERENCE', '物件归属房间必须同层。', prop.id)
    }
    const rad = prop.rotationDeg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad)
    for (const dx of [-prop.footprintMm.width / 2, prop.footprintMm.width / 2]) for (const dy of [-prop.footprintMm.height / 2, prop.footprintMm.height / 2]) {
      // Rotation produces floating point corners. Only this boundary comparison uses a sub-nanometre epsilon.
      const x = prop.positionMm.x + dx * cos - dy * sin, y = prop.positionMm.y + dx * sin + dy * cos
      const bounds = own(scene.floors, prop.floorId)?.boundsMm
      if (bounds && (x < bounds.x - 1e-6 || y < bounds.y - 1e-6 || x > bounds.x + bounds.width + 1e-6 || y > bounds.y + bounds.height + 1e-6)) { error('OUTSIDE_FLOOR', '物件旋转后的真实占地越过楼层世界边界。', prop.id); break }
    }
  }
  for (const region of Object.values(scene.regions)) {
    errors.push(...polygonIssues(region.boundaryMm, region.id, false))
    for (const p of region.boundaryMm) withinFloor(p, region.floorId, region.id)
    if (region.kind === 'manualMask' && (region.blocksMovement || region.movementCostMultiplier !== 1)) error('MASK_MOVEMENT', '人工遮罩不能改变实际移动阻挡或代价。', region.id)
  }
  for (const note of Object.values(scene.notes)) {
    if (note.anchor.type === 'point') withinFloor(note.anchor.positionMm, note.floorId, note.id)
    else {
      const collections = { vertex: scene.vertices, room: scene.rooms, wall: scene.walls, opening: scene.openings, prop: scene.props, region: scene.regions, note: scene.notes }
      const target = own<import('./types').Editable>(collections[note.anchor.entityKind], note.anchor.entityId)
      if (!target) error('MISSING_ANCHOR', '注记锚点实体不存在。', note.id)
      else if (target.floorId !== note.floorId) error('CROSS_FLOOR_REFERENCE', '注记锚点必须在同一楼层。', note.id)
      if (note.anchor.entityKind === 'note') {
        const seen = new Set([note.id]); let current = own(scene.notes, note.anchor.entityId)
        while (current && current.anchor.type === 'entity' && current.anchor.entityKind === 'note') {
          if (seen.has(current.id)) { error('CYCLIC_ANCHOR', '注记锚点不能循环引用。', note.id); break }
          seen.add(current.id); current = own(scene.notes, current.anchor.entityId)
        }
      }
    }
  }
  return { errors, warnings }
}
