import type { BoundsMm, EntityKind, Note, PointMm, Prop, Region, SceneDocument, Visibility, Wall } from '../core/types'

export type Audience = 'gm' | 'player'
export interface RenderRoom { id: string; points: PointMm[]; visibility: Visibility }
export interface RenderOpening {
  id: string; offsetMm: number; widthMm: number; kind: 'door' | 'window'
  state: 'open' | 'closed'; secret: boolean
}
export interface RenderWall {
  id: string; start: PointMm; end: PointMm; thicknessMm: number; openings: RenderOpening[]
}
export interface RenderNote {
  id: string; positionMm: PointMm; text: string; title?: string
  kind: Note['kind']; visibility: Visibility
}
export interface RenderRegion {
  id: string; boundaryMm: PointMm[]; kind: Region['kind']; visibility: Visibility
  blocksMovement: boolean
}
/** A disposable drawing model. A player projection never retains its source document. */
export interface RenderProjection {
  audience: Audience; bounds: BoundsMm; gridSizeMm: number; rooms: RenderRoom[]
  walls: RenderWall[]; props: Prop[]; notes: RenderNote[]; regions: RenderRegion[]
  masks: PointMm[][]; diagnostics: string[]; sourceRevision: number
}

const EPSILON = 0.001
const clonePoint = (point: PointMm): PointMm => ({ x: point.x, y: point.y })
const samePoint = (a: PointMm, b: PointMm) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
const pointsBounds = (points: PointMm[]): BoundsMm => {
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
const pointInsideRect = (point: PointMm, rect: BoundsMm): boolean => point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height
const overlapBounds = (a: BoundsMm, b: BoundsMm): BoundsMm | undefined => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x
  const height = Math.min(a.y + a.height, b.y + b.height) - y
  return width > EPSILON && height > EPSILON ? { x, y, width, height } : undefined
}

/** Collinear editing vertices do not become a side channel in a player drawing. */
function simplifyRing(points: PointMm[]): PointMm[] {
  return points.filter((point, index) => {
    const before = points[(index + points.length - 1) % points.length], after = points[(index + 1) % points.length]
    return Math.abs((point.x - before.x) * (after.y - point.y) - (point.y - before.y) * (after.x - point.x)) > EPSILON
  }).map(clonePoint)
}

function maskRectangle(points: PointMm[]): BoundsMm {
  const ring = simplifyRing(points)
  if (ring.length !== 4 || ring.some((point, index) => {
    const next = ring[(index + 1) % ring.length]
    return point.x !== next.x && point.y !== next.y
  })) throw new Error('玩家导出不安全：M0 遮罩必须是主持人预设的整块轴对齐矩形。')
  const box = pointsBounds(ring)
  if (box.width <= 0 || box.height <= 0) throw new Error('玩家导出不安全：遮罩面积必须大于零。')
  return box
}

/** Check a rectangle against a union without assuming one mask contains everything. */
function isCovered(bounds: BoundsMm, rectangles: BoundsMm[]): boolean {
  const cuts = [...new Set([bounds.x, bounds.x + bounds.width, ...rectangles.flatMap(r => [r.x, r.x + r.width])])]
    .filter(x => x >= bounds.x && x <= bounds.x + bounds.width).sort((a, b) => a - b)
  for (let index = 0; index < cuts.length - 1; index++) {
    const midpoint = (cuts[index] + cuts[index + 1]) / 2
    const intervals = rectangles.filter(r => midpoint >= r.x && midpoint <= r.x + r.width)
      .map(r => [r.y, r.y + r.height]).sort((a, b) => a[0] - b[0])
    let coveredTo = bounds.y
    for (const [start, end] of intervals) {
      if (start > coveredTo + EPSILON) break
      coveredTo = Math.max(coveredTo, end)
    }
    if (coveredTo < bounds.y + bounds.height - EPSILON) return false
  }
  return cuts.length > 1
}

function propBounds(prop: Prop): BoundsMm {
  const radians = prop.rotationDeg * Math.PI / 180
  const width = Math.abs(Math.cos(radians)) * prop.footprintMm.width + Math.abs(Math.sin(radians)) * prop.footprintMm.height
  const height = Math.abs(Math.sin(radians)) * prop.footprintMm.width + Math.abs(Math.cos(radians)) * prop.footprintMm.height
  return { x: prop.positionMm.x - width / 2, y: prop.positionMm.y - height / 2, width, height }
}

function vertexPoint(scene: SceneDocument, id: string): PointMm {
  const vertex = scene.vertices[id]
  if (!vertex) throw new Error('渲染失败：墙或房间引用了不存在的顶点。')
  return { x: vertex.xMm, y: vertex.yMm }
}
function wallPoints(scene: SceneDocument, wall: Wall): [PointMm, PointMm] {
  return [vertexPoint(scene, wall.startVertexId), vertexPoint(scene, wall.endVertexId)]
}
function wallOpenings(scene: SceneDocument, wall: Wall, audience: Audience): RenderOpening[] {
  return Object.values(scene.openings).filter(opening => opening.wallId === wall.id && (audience === 'gm' || !opening.secret || opening.revealed))
    .map(opening => ({ id: opening.id, offsetMm: opening.offsetMm, widthMm: opening.widthMm, kind: opening.kind, state: opening.state, secret: audience === 'gm' && opening.secret }))
    .sort((a, b) => a.offsetMm - b.offsetMm || a.id.localeCompare(b.id))
}

type Boundary = { start: PointMm; end: PointMm }
function boundaryOverlap(wall: Boundary, boundary: Boundary): [number, number] | undefined {
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  if (!length) return
  const relativeStart = { x: boundary.start.x - wall.start.x, y: boundary.start.y - wall.start.y }
  const relativeEnd = { x: boundary.end.x - wall.start.x, y: boundary.end.y - wall.start.y }
  if (Math.abs(dx * relativeStart.y - dy * relativeStart.x) > EPSILON * length || Math.abs(dx * relativeEnd.y - dy * relativeEnd.x) > EPSILON * length) return
  const edgeStart = (relativeStart.x * dx + relativeStart.y * dy) / length
  const edgeEnd = (relativeEnd.x * dx + relativeEnd.y * dy) / length
  const low = Math.max(0, Math.min(edgeStart, edgeEnd))
  const high = Math.min(length, Math.max(edgeStart, edgeEnd))
  if (high - low <= EPSILON) return
  return [low, high]
}

function wallCoveredByMasks(start: PointMm, end: PointMm, thicknessMm: number, rectangles: BoundsMm[]): boolean {
  const box = pointsBounds([start, end])
  // Coverage includes the stroke, so a wall on the visible mask border is retained.
  return isCovered({ x: box.x - thicknessMm / 2, y: box.y - thicknessMm / 2, width: box.width + thicknessMm, height: box.height + thicknessMm }, rectangles)
}

function publicWalls(scene: SceneDocument, rooms: RenderRoom[], rectangles: BoundsMm[]): RenderWall[] {
  const boundaries = rooms.flatMap(room => room.points.map((start, index) => ({ start, end: room.points[(index + 1) % room.points.length] })))
  const allRoomBoundaries = Object.values(scene.rooms).flatMap(room => room.boundaryVertexIds.map((id, index) => ({
    start: vertexPoint(scene, id), end: vertexPoint(scene, room.boundaryVertexIds[(index + 1) % room.boundaryVertexIds.length]),
  })))
  const pieces: RenderWall[] = []
  for (const wall of Object.values(scene.walls)) {
    const [start, end] = wallPoints(scene, wall)
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length }
    const independent = !allRoomBoundaries.some(boundary => boundaryOverlap({ start, end }, boundary))
    if (independent && wallCoveredByMasks(start, end, wall.thicknessMm, rectangles)) continue
    const intervals = independent ? [[0, length] as [number, number]] : boundaries.map(boundary => boundaryOverlap({ start, end }, boundary)).filter((item): item is [number, number] => Boolean(item)).sort((a, b) => a[0] - b[0])
    const union: [number, number][] = []
    for (const interval of intervals) {
      const last = union.at(-1)
      if (last && interval[0] <= last[1] + EPSILON) last[1] = Math.max(last[1], interval[1])
      else union.push([...interval])
    }
    for (const [from, to] of union) {
      const openings = wallOpenings(scene, wall, 'player').filter(opening => opening.offsetMm >= from && opening.offsetMm + opening.widthMm <= to)
        .map(opening => ({ ...opening, offsetMm: opening.offsetMm - from }))
      pieces.push({ id: '', start: { x: start.x + direction.x * from, y: start.y + direction.y * from }, end: { x: start.x + direction.x * to, y: start.y + direction.y * to }, thicknessMm: wall.thicknessMm, openings })
    }
  }
  // Canonical direction/order removes secret-driven wall splitting from the projection.
  for (const piece of pieces) {
    if (piece.start.x > piece.end.x || piece.start.y > piece.end.y) {
      const length = Math.hypot(piece.end.x - piece.start.x, piece.end.y - piece.start.y)
      ;[piece.start, piece.end] = [piece.end, piece.start]
      piece.openings = piece.openings.map(opening => ({ ...opening, offsetMm: length - opening.offsetMm - opening.widthMm })).sort((a, b) => a.offsetMm - b.offsetMm)
    }
  }
  pieces.sort((a, b) => a.start.y - b.start.y || a.start.x - b.start.x || a.end.y - b.end.y || a.end.x - b.end.x)
  const merged: RenderWall[] = []
  for (const piece of pieces) {
    const existing = merged.find(wall => wall.thicknessMm === piece.thicknessMm && samePoint(wall.end, piece.start) &&
      (wall.start.x === wall.end.x && piece.start.x === piece.end.x || wall.start.y === wall.end.y && piece.start.y === piece.end.y))
    if (existing) {
      const previousLength = Math.hypot(existing.end.x - existing.start.x, existing.end.y - existing.start.y)
      existing.end = piece.end
      existing.openings.push(...piece.openings.map(opening => ({ ...opening, offsetMm: previousLength + opening.offsetMm })))
    } else if (!merged.some(wall => samePoint(wall.start, piece.start) && samePoint(wall.end, piece.end) && wall.thicknessMm === piece.thicknessMm)) merged.push(piece)
  }
  return merged.map((wall, index) => ({ ...wall, id: `public-wall-${index}`, openings: wall.openings.sort((a, b) => a.offsetMm - b.offsetMm) }))
}

/** Filtering happens before any drawing, including entity-anchored public notes. */
export function projectScene(scene: SceneDocument, audience: Audience): RenderProjection {
  if (audience !== 'gm' && audience !== 'player') throw new Error('必须明确选择主持人或玩家输出。')
  if (Object.keys(scene.floors).length !== 1) throw new Error('M0 渲染仅支持单楼层场景。')
  const bounds = { ...scene.exportBoundsMm }
  if (Object.values(bounds).some(value => !Number.isFinite(value)) || bounds.width <= 0 || bounds.height <= 0) throw new Error('导出边界必须是有效的固定矩形。')
  const maskRegions = Object.values(scene.regions).filter(region => region.kind === 'manualMask')
  const masks = maskRegions.map(region => region.boundaryMm.map(clonePoint))
  const rectangles = audience === 'player' ? masks.map(maskRectangle) : []
  const maskedPoint = (point: PointMm) => rectangles.some(rect => pointInsideRect(point, rect))
  const visibleRoom = (id: string) => audience === 'gm' || scene.rooms[id]?.visibility === 'public'
  const diagnostics: string[] = []
  const rooms: RenderRoom[] = Object.values(scene.rooms).filter(room => visibleRoom(room.id)).map(room => ({ id: room.id, points: simplifyRing(room.boundaryVertexIds.map(id => vertexPoint(scene, id))), visibility: room.visibility }))
  const walls: RenderWall[] = audience === 'player' ? publicWalls(scene, rooms, rectangles) : Object.values(scene.walls).map(wall => {
    const [start, end] = wallPoints(scene, wall)
    return { id: wall.id, start, end, thicknessMm: wall.thicknessMm, openings: wallOpenings(scene, wall, audience) }
  })
  const visibleProps = Object.values(scene.props).filter(prop => audience === 'gm' || prop.visibility === 'public' && (!prop.roomId || visibleRoom(prop.roomId)) && !maskedPoint(prop.positionMm))
  const props = visibleProps.map(prop => ({ ...prop, positionMm: clonePoint(prop.positionMm), footprintMm: { ...prop.footprintMm }, ...(audience === 'player' ? { editLocked: false } : {}) }))
  const visibleRegions = Object.values(scene.regions).filter(region => region.kind !== 'manualMask' && (audience === 'gm' || region.visibility === 'public'))
  const regions = visibleRegions.map(region => ({ id: region.id, boundaryMm: region.boundaryMm.map(clonePoint), kind: region.kind, visibility: region.visibility, blocksMovement: region.blocksMovement }))

  if (audience === 'player') {
    const hiddenBounds: BoundsMm[] = [
      ...Object.values(scene.rooms).filter(room => room.visibility !== 'public').map(room => pointsBounds(room.boundaryVertexIds.map(id => vertexPoint(scene, id)))),
      ...Object.values(scene.props).filter(prop => prop.visibility !== 'public' || prop.roomId && !visibleRoom(prop.roomId)).map(propBounds),
      ...Object.values(scene.regions).filter(region => region.kind !== 'manualMask' && region.visibility !== 'public').map(region => pointsBounds(region.boundaryMm)),
    ]
    if (hiddenBounds.some(hidden => {
      const cropped = overlapBounds(hidden, bounds)
      return cropped && !isCovered(cropped, rectangles)
    })) throw new Error('玩家导出不安全：固定整块遮罩未覆盖隐藏空间或物件。请扩大主持人遮罩后重试。')
  }

  const visiblePropIds = new Set(props.map(prop => prop.id))
  const visibleRegionIds = new Set(regions.map(region => region.id))
  const visibleOpeningIds = new Set(walls.flatMap(wall => wall.openings.map(opening => opening.id)))
  const publicVertices = new Set(Object.values(scene.rooms).filter(room => room.visibility === 'public').flatMap(room => room.boundaryVertexIds))
  const publicBoundaries = rooms.flatMap(room => room.points.map((start, index) => ({ start, end: room.points[(index + 1) % room.points.length] })))
  const allRoomBoundaries = Object.values(scene.rooms).flatMap(room => room.boundaryVertexIds.map((id, index) => ({
    start: vertexPoint(scene, id), end: vertexPoint(scene, room.boundaryVertexIds[(index + 1) % room.boundaryVertexIds.length]),
  })))
  const wallIsIndependent = (id: string) => {
    const wall = scene.walls[id]
    if (!wall) return false
    const [start, end] = wallPoints(scene, wall)
    return !allRoomBoundaries.some(boundary => boundaryOverlap({ start, end }, boundary))
  }
  const wallIsPublic = (id: string) => {
    const wall = scene.walls[id]
    if (!wall) return false
    const [start, end] = wallPoints(scene, wall)
    if (wallIsIndependent(id) && wallCoveredByMasks(start, end, wall.thicknessMm, rectangles)) return false
    return wallIsIndependent(id) || publicBoundaries.some(boundary => Boolean(boundaryOverlap({ start, end }, boundary)))
  }
  const midpoint = (start: PointMm, end: PointMm): PointMm => ({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })
  const entityPosition = (kind: EntityKind, id: string, seen: Set<string>, noteKind: Note['kind']): PointMm | undefined => {
    if (kind === 'room') {
      const room = scene.rooms[id]
      if (!room || !visibleRoom(id)) return
      const box = pointsBounds(room.boundaryVertexIds.map(vertexId => vertexPoint(scene, vertexId)))
      return { x: box.x + box.width / 2, y: noteKind === 'label' ? box.y + Math.min(950, box.height / 2) : box.y + box.height / 2 }
    }
    if (kind === 'prop') return visiblePropIds.has(id) ? clonePoint(scene.props[id].positionMm) : undefined
    if (kind === 'region') {
      if (!visibleRegionIds.has(id)) return
      const box = pointsBounds(scene.regions[id].boundaryMm)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    if (kind === 'vertex') return scene.vertices[id] && (audience === 'gm' || publicVertices.has(id)) ? vertexPoint(scene, id) : undefined
    if (kind === 'wall') {
      const wall = scene.walls[id]
      if (!wall || audience === 'player' && !wallIsPublic(id)) return
      const [start, end] = wallPoints(scene, wall)
      const position = midpoint(start, end)
      if (audience === 'player' && !wallIsIndependent(id) && !publicBoundaries.some(boundary => {
        const box = pointsBounds([boundary.start, boundary.end])
        return pointInsideRect(position, box)
      })) return
      return position
    }
    if (kind === 'opening') {
      const opening = scene.openings[id]
      if (!opening || audience === 'player' && !visibleOpeningIds.has(id)) return
      const wall = scene.walls[opening.wallId]
      if (!wall) return
      const [start, end] = wallPoints(scene, wall)
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      const offset = (opening.offsetMm + opening.widthMm / 2) / length
      return { x: start.x + (end.x - start.x) * offset, y: start.y + (end.y - start.y) * offset }
    }
    const note = scene.notes[id]
    if (!note || seen.has(id) || audience === 'player' && note.visibility !== 'public') return
    seen.add(id)
    return resolveNote(note, seen)
  }
  const resolveNote = (note: Note, seen = new Set<string>()): PointMm | undefined => note.anchor.type === 'point'
    ? clonePoint(note.anchor.positionMm) : entityPosition(note.anchor.entityKind, note.anchor.entityId, seen, note.kind)
  const notes: RenderNote[] = []
  for (const note of Object.values(scene.notes)) {
    if (audience === 'player' && note.visibility !== 'public') continue
    const anchorPosition = resolveNote(note, new Set([note.id]))
    // Keep a clue badge beside its target rather than over the target's room label.
    const positionMm = anchorPosition ? { x: anchorPosition.x, y: anchorPosition.y - (note.kind === 'clue' ? 400 : 0) } : undefined
    if (!positionMm || audience === 'player' && (maskedPoint(positionMm) || anchorPosition && maskedPoint(anchorPosition))) {
      if (audience === 'gm') diagnostics.push(`注记 ${note.id} 的锚点不可显示。`)
      continue
    }
    notes.push({ id: note.id, positionMm, text: note.text, ...(note.title ? { title: note.title } : {}), kind: note.kind, visibility: note.visibility })
  }
  if (audience === 'gm') {
    try {
      const playerNoteIds = new Set(projectScene(scene, 'player').notes.map(note => note.id))
      for (const note of Object.values(scene.notes).filter(note => note.visibility === 'public' && !playerNoteIds.has(note.id))) {
        diagnostics.push(`公开注记 ${note.id} 锚定隐藏对象或遮罩区域，将从玩家投影剔除。`)
      }
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : '玩家投影暂不可导出，请检查遮罩与公开信息。')
    }
  }
  return { audience, bounds, gridSizeMm: scene.units.gridSizeMm, rooms, walls, props, notes, regions, masks, diagnostics, sourceRevision: scene.revision }
}
