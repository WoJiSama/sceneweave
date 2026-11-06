import type { PointMm, SceneDocument, Wall } from '../../../model/scene.js'
import { applyCommands } from '../../../commands/commands.js'
import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { cloneJson } from '../../../validation/json.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { corridor, coveredEverywhere, openingEndpoints, pathPolygon, pointInPolygon, roomPoints } from '../../../geometry/geometry.js'
import { interiorEntityId } from './layout.js'
import type { InteriorGenerationInput, InteriorLayout } from './contracts.js'

export interface InteriorCirculationRoute {
  id: string
  fromRoomId: string | null
  toRoomId: string
  openingId: string
  from: PointMm
  to: PointMm
  pointsMm: PointMm[]
  widthMm: number
  /** Generation-time evidence only. It imposes no persistent travel constraint. */
  status: 'clear' | 'unavailable'
  notes: string[]
}
export interface InteriorConnectivityReport {
  openingIds: string[]
  entranceOpeningId: string | null
  routes: InteriorCirculationRoute[]
  notes: string[]
}
type Options = { profile: TaskBudgetProfile; checkCancelled: () => void }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const unique = (messages: string[]) => [...new Set(messages)]
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const owners = (document: SceneDocument, wall: Wall) => Object.values(document.rooms).filter(room => room.boundaryVertexIds.some((id, index, ids) => {
  const next = ids[(index + 1) % ids.length]
  return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
})).map(room => room.id).sort(compare)
const center = (document: SceneDocument, roomId: string): PointMm => {
  const points = roomPoints(document, document.rooms[roomId]), xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.min(...xs) + Math.floor((Math.max(...xs) - Math.min(...xs)) / 2), y: Math.min(...ys) + Math.floor((Math.max(...ys) - Math.min(...ys)) / 2) }
}
function compact(points: PointMm[]): PointMm[] {
  const result: PointMm[] = []
  for (const point of points) {
    if (result.length && same(result[result.length - 1], point)) continue
    result.push(point)
    while (result.length >= 3) {
      const [a, b, c] = result.slice(-3)
      if ((b.x - a.x) * (c.y - b.y) !== (b.y - a.y) * (c.x - b.x) || (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) <= 0) break
      result.splice(result.length - 2, 1)
    }
  }
  return result
}
function openingFrame(document: SceneDocument, openingId: string, widthMm: number) {
  const opening = document.openings[openingId], wall = document.walls[opening.wallId], [a, b] = openingEndpoints(document, opening)
  const midpoint = { x: a.x + Math.round((b.x - a.x) / 2), y: a.y + Math.round((b.y - a.y) / 2) }
  const normal = a.x === b.x ? { x: 1, y: 0 } : { x: 0, y: 1 }
  const depth = Math.ceil(wall.thicknessMm / 2) + Math.ceil(widthMm / 2) + 1
  return { midpoint, normal, depth }
}
function roomAnchor(document: SceneDocument, roomId: string, midpoint: PointMm, normal: PointMm, depth: number) {
  const c = center(document, roomId), sign = (c.x - midpoint.x) * normal.x + (c.y - midpoint.y) * normal.y >= 0 ? 1 : -1
  return { x: midpoint.x + normal.x * depth * sign, y: midpoint.y + normal.y * depth * sign }
}
function routeBand(floorId: string, pointsMm: PointMm[], widthMm: number) {
  return pathPolygon({ id: 'interior-circulation-check', floorId, editLocked: false, visibility: 'public', centerlineMm: pointsMm, widthMm,
    supportRefs: [{ kind: 'floor', id: floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 })
}
/** The band must stay in the two actual rooms. Only an entrance may use its
 * explicit short outside approach; no route can wander around outer walls. */
function checkRoute(document: SceneDocument, input: InteriorGenerationInput, route: InteriorCirculationRoute): string[] {
  const opening = document.openings[route.openingId]
  if (!opening || opening.kind !== 'door') return ['生成时使用的门已不存在。']
  if (opening.state !== 'open' || opening.locked) return ['门当前关闭或上锁，不能作为可行走净空证据。']
  if (opening.widthMm < route.widthMm) return [`实际门净宽${opening.widthMm}毫米小于建议通路${route.widthMm}毫米。`]
  if (!document.rooms[route.toRoomId] || route.fromRoomId !== null && !document.rooms[route.fromRoomId]) return ['通路引用的实际房间已不存在。']
  const wall = document.walls[opening.wallId], attachedRooms = owners(document, wall)
  if (!attachedRooms.includes(route.toRoomId) || (route.fromRoomId === null ? attachedRooms.length !== 1 : !attachedRooms.includes(route.fromRoomId))) return ['通路引用的门不再附着于声明的实际房间。']
  if (route.pointsMm.length < 2) return ['有限通路候选未找到符合净宽的折线。']
  if (!same(route.pointsMm[0], route.from) || !same(route.pointsMm[route.pointsMm.length - 1], route.to)) return ['通路端点与实际建议折线不一致。']
  const [near, far] = openingEndpoints(document, opening), vertical = near.x === far.x
  const coordinate = vertical ? 'x' : 'y', along = vertical ? 'y' : 'x', boundary = near[coordinate]
  const crossed = route.pointsMm.slice(1).some((b, index) => {
    const a = route.pointsMm[index]
    if ((a[coordinate] - boundary) * (b[coordinate] - boundary) >= 0) return false
    const t = (boundary - a[coordinate]) / (b[coordinate] - a[coordinate]), at = a[along] + (b[along] - a[along]) * t
    return at >= Math.min(near[along], far[along]) + route.widthMm / 2 && at <= Math.max(near[along], far[along]) - route.widthMm / 2
  })
  if (!crossed) return ['建议净宽折线没有实际穿过所引用的门洞。']
  const checked = checkTerrainRoute(document, { floorId: input.parameters.floorId, pointsMm: route.pointsMm, widthMm: route.widthMm })
  const notes = checked.issues.map(issue => issue.message)
  const rooms = [route.toRoomId, ...(route.fromRoomId ? [route.fromRoomId] : [])].map(id => roomPoints(document, document.rooms[id]))
  if (route.fromRoomId === null) {
    const { midpoint, normal, depth } = openingFrame(document, route.openingId, route.widthMm)
    const a = roomAnchor(document, route.toRoomId, midpoint, normal, depth), b = { x: midpoint.x - (a.x - midpoint.x), y: midpoint.y - (a.y - midpoint.y) }
    rooms.push(routeBand(input.parameters.floorId, [a, b], route.widthMm))
  }
  const band = routeBand(input.parameters.floorId, route.pointsMm, route.widthMm)
  if (!coveredEverywhere(band, rooms, point => rooms.some(polygon => pointInPolygon(point, polygon)))) notes.push('完整净宽带超出本门两侧实际房间及明确入口预留区。')
  return unique(notes)
}

/** Recheck existing read-only route suggestions against real current doors,
 * walls and rotated furniture. This never changes the document or repairs it. */
export function checkInteriorCirculation(document: SceneDocument, input: InteriorGenerationInput, _layout: InteriorLayout, report: InteriorConnectivityReport): InteriorConnectivityReport {
  const routes = report.routes.map(route => {
    const notes = checkRoute(document, input, route)
    return { ...cloneJson(route), status: notes.length ? 'unavailable' as const : 'clear' as const, notes }
  })
  return { openingIds: [...report.openingIds], entranceOpeningId: report.entranceOpeningId, routes,
    notes: unique([...report.notes.filter(note => !note.startsWith('通路建议未完成：')), ...routes.filter(route => route.status !== 'clear').map(route => `通路建议未完成：${route.notes.join('；')}`)]) }
}

/** Full aperture and approach footprints for optional furnishing placement.
 * These are transient reservations, not persistent required path checks. */
export function interiorDoorReservations(document: SceneDocument, report: InteriorConnectivityReport, widthMm: number): PointMm[][] {
  return report.openingIds.flatMap(id => {
    const opening = document.openings[id]
    if (!opening || opening.kind !== 'door') return []
    const { midpoint, normal, depth } = openingFrame(document, id, widthMm)
    return [corridor({ x: midpoint.x - normal.x * depth, y: midpoint.y - normal.y * depth }, { x: midpoint.x + normal.x * depth, y: midpoint.y + normal.y * depth }, Math.max(widthMm, opening.widthMm))]
  })
}

/** Read current doors and finite route suggestions without creating, opening or
 * restoring any door. Local furnishing protects only routes currently clear. */
export function inspectInteriorConnections(document: SceneDocument, input: InteriorGenerationInput, layout: InteriorLayout, options: Options): InteriorConnectivityReport {
  const meter = captureExecutionBudget(options.profile), actual = new Set([...layout.rooms, ...layout.corridors].map(row => row.roomId))
  const report: InteriorConnectivityReport = { openingIds: [], entranceOpeningId: null, routes: [], notes: [] }
  for (const opening of Object.values(document.openings).sort((a, b) => compare(a.id, b.id))) {
    options.checkCancelled(); meter.charge({ fieldEvaluations: 1 })
    if (opening.floorId !== input.parameters.floorId || opening.kind !== 'door') continue
    const wall = document.walls[opening.wallId], rooms = owners(document, wall), selected = rooms.filter(id => actual.has(id))
    if (!selected.length || rooms.length > 2) continue
    report.openingIds.push(opening.id)
    const toRoomId = selected[0], fromRoomId = rooms.find(id => id !== toRoomId) ?? null
    const widthMm = input.parameters.arrangement.clearWidthMm, { midpoint, normal, depth } = openingFrame(document, opening.id, widthMm)
    const to = center(document, toRoomId), toAnchor = roomAnchor(document, toRoomId, midpoint, normal, depth)
    const fromAnchor = fromRoomId ? roomAnchor(document, fromRoomId, midpoint, normal, depth) : { x: midpoint.x - (toAnchor.x - midpoint.x), y: midpoint.y - (toAnchor.y - midpoint.y) }
    const from = fromRoomId ? center(document, fromRoomId) : fromAnchor
    const route: InteriorCirculationRoute = { id: interiorEntityId(document.sceneId, input.seed, `current-route:${opening.id}:${toRoomId}`), fromRoomId, toRoomId, openingId: opening.id,
      from, to, pointsMm: [], widthMm, status: 'unavailable', notes: [] }
    for (const points of [[from, fromAnchor, toAnchor, to], [from, { x: fromAnchor.x, y: from.y }, fromAnchor, toAnchor, { x: toAnchor.x, y: to.y }, to],
      [from, { x: from.x, y: fromAnchor.y }, fromAnchor, toAnchor, { x: to.x, y: toAnchor.y }, to]]) {
      options.checkCancelled(); meter.charge({ gridNodes: 1, fieldEvaluations: Object.keys(document.walls).length + Object.keys(document.props).length + points.length })
      route.pointsMm = compact(points); route.notes = checkRoute(document, input, route)
      if (!route.notes.length) { route.status = 'clear'; break }
    }
    report.routes.push(route)
    if (fromRoomId === null && report.entranceOpeningId === null) report.entranceOpeningId = opening.id
  }
  report.notes = report.routes.filter(route => route.status !== 'clear').map(route => `当前通路建议未完成：${route.notes.join('；')}`)
  return report
}

export function arrangeInteriorConnections(document: SceneDocument, input: InteriorGenerationInput, layout: InteriorLayout, options: Options): { document: SceneDocument; report: InteriorConnectivityReport } {
  let next = cloneJson(document)
  const p = input.parameters, arrangement = p.arrangement, meter = captureExecutionBudget(options.profile), notes: string[] = []
  const report: InteriorConnectivityReport = { openingIds: [], entranceOpeningId: null, routes: [], notes }
  const roomIds = [...layout.rooms, ...layout.corridors].map(row => row.roomId).sort(compare), actual = new Set(roomIds)
  const roomByDemand = new Map(layout.rooms.map(room => [room.requirementId, room.roomId]))
  const forbidden = new Set(p.relations.filter(row => row.kind === 'no-direct-connection').map(row => [roomByDemand.get(row.a), roomByDemand.get(row.b)].sort().join('\0')))
  const tick = () => { options.checkCancelled(); meter.charge({ fieldEvaluations: 1 }) }
  const walls = Object.values(next.walls).filter(wall => wall.floorId === p.floorId).map(wall => {
    tick()
    const start = next.vertices[wall.startVertexId], end = next.vertices[wall.endVertexId], rooms = owners(next, wall).filter(id => actual.has(id))
    return { wall, rooms, length: Math.abs(end.xMm - start.xMm) + Math.abs(end.yMm - start.yMm) }
  }).sort((a, b) => b.length - a.length || compare(a.wall.id, b.wall.id))
  const createDoor = (wall: Wall): string | null => {
    tick()
    const a = next.vertices[wall.startVertexId], b = next.vertices[wall.endVertexId]
    if (a.xMm !== b.xMm && a.yMm !== b.yMm) { notes.push('当前建议门只支持已物化的正交墙段。'); return null }
    const length = Math.abs(a.xMm - b.xMm) + Math.abs(a.yMm - b.yMm), clearance = Math.max(next.constraints.wallEndClearanceMm, Math.ceil(wall.thicknessMm / 2) + 1)
    if (arrangement.doorWidthMm < (next.constraints.minDoorWidthMm ?? 1) || length < arrangement.doorWidthMm + 2 * clearance) return null
    const id = interiorEntityId(next.sceneId, input.seed, `door:${wall.id}`)
    const offset = Math.floor((length - arrangement.doorWidthMm) / 2)
    next = applyCommands(next, [{ type: 'addOpening', id, wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: offset, widthMm: arrangement.doorWidthMm,
      kind: 'door', state: 'open', locked: false, secret: false, revealed: false, layerId: p.layerId }], { ids: { nextId: () => id }, clock: { now: () => document.updatedAt } }, { budget: options.profile })
    report.openingIds.push(id)
    return id
  }
  const routesFor = (openingId: string, fromRoomId: string | null, toRoomId: string): InteriorCirculationRoute => {
    const widthMm = arrangement.clearWidthMm, { midpoint, normal, depth } = openingFrame(next, openingId, widthMm)
    const to = center(next, toRoomId), toAnchor = roomAnchor(next, toRoomId, midpoint, normal, depth)
    const fromAnchor = fromRoomId ? roomAnchor(next, fromRoomId, midpoint, normal, depth) : { x: midpoint.x - (toAnchor.x - midpoint.x), y: midpoint.y - (toAnchor.y - midpoint.y) }
    const from = fromRoomId ? center(next, fromRoomId) : fromAnchor
    const route: InteriorCirculationRoute = { id: interiorEntityId(next.sceneId, input.seed, `route:${openingId}`), fromRoomId, toRoomId, openingId, from, to, pointsMm: [], widthMm, status: 'unavailable', notes: [] }
    const variants = [
      [from, fromAnchor, toAnchor, to],
      [from, { x: fromAnchor.x, y: from.y }, fromAnchor, toAnchor, { x: toAnchor.x, y: to.y }, to],
      [from, { x: from.x, y: fromAnchor.y }, fromAnchor, toAnchor, { x: to.x, y: toAnchor.y }, to],
    ]
    for (const points of variants) {
      tick(); meter.charge({ gridNodes: 1, fieldEvaluations: next ? Object.keys(next.walls).length + Object.keys(next.props).length + points.length : points.length })
      route.pointsMm = compact(points)
      route.notes = checkRoute(next, input, route)
      if (!route.notes.length) { route.status = 'clear'; break }
    }
    return route
  }
  // A deterministic spanning forest selects real common wall segments. A
  // missing feasible edge remains a suggestion gap, never a false door graph.
  const parents = new Map(roomIds.map(id => [id, id]))
  const root = (id: string): string => { const parent = parents.get(id)!; return parent === id ? id : root(parent) }
  if (arrangement.doors) for (const row of walls) {
    if (row.rooms.length !== 2 || forbidden.has([...row.rooms].sort().join('\0')) || root(row.rooms[0]) === root(row.rooms[1])) continue
    const id = createDoor(row.wall)
    if (!id) continue
    parents.set(root(row.rooms[1]), root(row.rooms[0]))
    report.routes.push(routesFor(id, row.rooms[0], row.rooms[1]))
  }
  if (arrangement.doors && roomIds.length > 1 && new Set(roomIds.map(root)).size > 1) notes.push('部分房间未找到足长、满足端部间隙且允许连接的共墙；保留布局，可手工调整门。')
  if (arrangement.entrance) {
    for (const row of walls) {
      if (row.rooms.length !== 1) continue
      const id = createDoor(row.wall)
      if (!id) continue
      report.entranceOpeningId = id; report.routes.push(routesFor(id, null, row.rooms[0])); break
    }
    if (report.entranceOpeningId === null) notes.push('未找到足长且满足端部间隙的外墙入口；保留布局，可手工添加入口。')
  }
  for (const route of report.routes) if (route.status !== 'clear') notes.push(`通路建议未完成：${route.notes.join('；')}`)
  options.checkCancelled()
  return { document: next, report: { ...report, notes: unique(notes) } }
}
