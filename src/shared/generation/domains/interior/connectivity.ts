import type { Opening, PointMm, SceneDocument, Wall } from '../../../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS } from '../../../model/scene.js'
import { applyCommands, type SceneCommand } from '../../../commands/commands.js'
import { captureExecutionBudget, measureBudgetGeometry, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { cloneJson, canonicalJson } from '../../../validation/json.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { corridor, coveredEverywhere, openingEndpoints, pathPolygon, pointInPolygon, roomPoints } from '../../../geometry/geometry.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { interiorEntityId, InteriorGenerationError } from './layout.js'
import { rankExteriorEntranceProposals } from './entrance-selection.js'
import { INTERIOR_PROGRAM_VERSION, type BuildingEntranceApproach, type InteriorGenerationInput, type InteriorLayout, type InteriorSide } from './contracts.js'
import { replanInteriorRoomRoute } from './connectivity-routing.js'
import { checkFloorEdgeDoorRoute, floorEdgeDoorStart, roomOwnsInteriorWall } from './entrance-clearance.js'
import { defaultOpeningHeight } from '../../../model/building-height.js'
import { WIDE_DOOR_MM } from '../../../model/door-presentation.js'
import { programCorridorId, programWallSide } from './program.js'

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
  entrances?: { requirementId: string; openingId: string; roomId: string; role: 'main' | 'service'; side: InteriorSide }[]
  routes: InteriorCirculationRoute[]
  notes: string[]
}
type Options = { profile: TaskBudgetProfile; checkCancelled: () => void; entranceApproach?: BuildingEntranceApproach; avoidPaintedBodies?: boolean }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const unique = (messages: string[]) => [...new Set(messages)]
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const owners = (document: SceneDocument, wall: Wall) => Object.values(document.rooms)
  .filter(room => roomOwnsInteriorWall(room, wall)).map(room => room.id).sort(compare)
const center = (document: SceneDocument, roomId: string): PointMm => {
  const points = roomPoints(document, document.rooms[roomId]), xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.min(...xs) + Math.floor((Math.max(...xs) - Math.min(...xs)) / 2), y: Math.min(...ys) + Math.floor((Math.max(...ys) - Math.min(...ys)) / 2) }
}

/** The symbol swings into a room that can accommodate the leaf. Two leaves
 * split a broad opening's span; a shallow junction can use the frame alone. */
function planDoorPresentation(document: SceneDocument, wall: Wall, roomIds: readonly string[], widthMm: number, clearWidthMm: number): Opening['presentation'] {
  const a = document.vertices[wall.startVertexId], b = document.vertices[wall.endVertexId]
  const axis = a.xMm === b.xMm ? 'x' : 'y', coordinate = axis === 'x' ? a.xMm : a.yMm
  const candidates = roomIds.map(roomId => {
    const roomCenter = center(document, roomId), depth = Math.abs(roomCenter[axis] - coordinate) * 2 - Math.ceil(wall.thicknessMm / 2)
    const cross = (b.xMm - a.xMm) * (roomCenter.y - a.yMm) - (b.yMm - a.yMm) * (roomCenter.x - a.xMm)
    return { depth, side: cross < 0 ? 'left' as const : 'right' as const }
  }).sort((a, b) => b.depth - a.depth)
  const kind = widthMm > WIDE_DOOR_MM ? 'double' : 'single'
  const fit = candidates.find(row => row.depth >= Math.ceil(widthMm / (kind === 'double' ? 2 : 1)) + Math.ceil(clearWidthMm / 2))
  return fit ? { kind, side: fit.side } : { kind: 'frame' }
}

function openWallRuns(document: SceneDocument, wall: Wall, length: number, separation: number) {
  const occupied = Object.values(document.openings).filter(opening => opening.wallId === wall.id).map(opening => {
    const start = opening.offsetReferenceVertexId === wall.startVertexId ? opening.offsetMm : length - opening.offsetMm - opening.widthMm
    return { start, end: start + opening.widthMm }
  }).sort((a, b) => a.start - b.start)
  let start = separation
  return [...occupied, { start: length, end: length }].map(item => {
    const run = { start, end: item.start - separation }
    start = Math.max(start, item.end + separation)
    return run
  })
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
function exteriorApproach(document: SceneDocument, input: InteriorGenerationInput, openingId: string, toRoomId: string,
  midpoint: PointMm, toAnchor: PointMm): { point: PointMm; atFloorEdge: boolean } {
  const edge = input.algorithmVersion >= 21
    ? floorEdgeDoorStart(document, document.rooms[toRoomId], document.walls[document.openings[openingId].wallId], toAnchor) : undefined
  return edge ? { point: edge, atFloorEdge: true }
    : { point: { x: midpoint.x - (toAnchor.x - midpoint.x), y: midpoint.y - (toAnchor.y - midpoint.y) }, atFloorEdge: false }
}
const routeCheckCount = (input: InteriorGenerationInput, route: InteriorCirculationRoute) =>
  input.algorithmVersion >= 21 && route.fromRoomId === null && route.widthMm % 2 !== 0 ? 2 : 1
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
  const request = { floorId: input.parameters.floorId, pointsMm: route.pointsMm, widthMm: route.widthMm }
  const rooms = [route.toRoomId, ...(route.fromRoomId ? [route.fromRoomId] : [])].map(id => roomPoints(document, document.rooms[id]))
  let edgeApproach: PointMm | undefined
  if (route.fromRoomId === null) {
    const { midpoint, normal, depth } = openingFrame(document, route.openingId, route.widthMm)
    const inner = roomAnchor(document, route.toRoomId, midpoint, normal, depth)
    const approach = exteriorApproach(document, input, route.openingId, route.toRoomId, midpoint, inner)
    rooms.push(routeBand(request.floorId, [inner, approach.point], route.widthMm))
    if (approach.atFloorEdge && same(route.from, approach.point)) edgeApproach = inner
  }
  const checked = edgeApproach ? checkFloorEdgeDoorRoute(document, request, edgeApproach) : checkTerrainRoute(document, request)
  // The v2 recipe hashes the report, including this original route diagnostic.
  const notes = checked.issues.map(issue => input.algorithmVersion === 2 && issue.code === 'TERRAIN_NOT_WALKABLE' && issue.entityId === undefined
    ? '整条净宽带必须留在世界内的可步行有效支撑面；水面或阻挡地形不能普通穿越。' : issue.message)
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
  return { openingIds: [...report.openingIds], entranceOpeningId: report.entranceOpeningId, ...(report.entrances ? { entrances: cloneJson(report.entrances) } : {}), routes,
    notes: unique([...report.notes.filter(note => !note.startsWith('通路建议未完成：')), ...routes.filter(route => route.status !== 'clear').map(route => `通路建议未完成：${route.notes.join('；')}`)]) }
}

/** v17 may replace the generation-time path while retaining its exact door,
 * endpoints, rooms and full width. No document or incoming report is mutated.
 * Each joined alternative still reaches the independent complete route check. */
export function replanInteriorCirculation(document: SceneDocument, input: InteriorGenerationInput, layout: InteriorLayout,
  report: InteriorConnectivityReport, options: Options): InteriorConnectivityReport {
  const meter = captureExecutionBudget(options.profile)
  const sceneWork = Object.keys(document.walls).length + Object.keys(document.props).length + Object.keys(document.regions).length + Object.keys(document.rooms).length
  const chargeCheck = (routes: InteriorCirculationRoute[]) => {
    for (const route of routes) { options.checkCancelled(); meter.charge({ fieldEvaluations: routeCheckCount(input, route) * (sceneWork + route.pointsMm.length) }) }
  }
  chargeCheck(report.routes)
  const checked = checkInteriorCirculation(document, input, layout, report)
  for (const route of checked.routes) {
    options.checkCancelled(); meter.charge({ fieldEvaluations: 1 })
    if (route.status === 'clear') continue
    const opening = document.openings[route.openingId]
    if (!opening || opening.kind !== 'door' || opening.state !== 'open' || opening.locked || opening.widthMm < route.widthMm
      || !document.rooms[route.toRoomId] || route.fromRoomId !== null && !document.rooms[route.fromRoomId]) continue
    const wall = document.walls[opening.wallId]
    if (!wall) continue
    const attached = owners(document, wall)
    if (!attached.includes(route.toRoomId) || (route.fromRoomId === null ? attached.length !== 1 : !attached.includes(route.fromRoomId))) continue
    const { midpoint, normal, depth } = openingFrame(document, route.openingId, route.widthMm)
    const toAnchor = roomAnchor(document, route.toRoomId, midpoint, normal, depth)
    const fromAnchor = route.fromRoomId ? roomAnchor(document, route.fromRoomId, midpoint, normal, depth)
      : exteriorApproach(document, input, route.openingId, route.toRoomId, midpoint, toAnchor).point
    const to = replanInteriorRoomRoute(document, { roomId: route.toRoomId, openingId: route.openingId,
      start: toAnchor, end: route.to, widthMm: route.widthMm }, options)
    if (!to) continue
    const from = route.fromRoomId ? replanInteriorRoomRoute(document, { roomId: route.fromRoomId, openingId: route.openingId,
      start: fromAnchor, end: route.from, widthMm: route.widthMm }, options) : [fromAnchor]
    if (!from) continue
    const pointsMm = compact([...from].reverse().concat(to))
    options.checkCancelled()
    meter.charge({ fieldEvaluations: routeCheckCount(input, route) * (sceneWork + pointsMm.length) })
    const notes = checkRoute(document, input, { ...route, pointsMm })
    if (!notes.length) { route.pointsMm = pointsMm; route.status = 'clear'; route.notes = [] }
  }
  chargeCheck(checked.routes)
  return checkInteriorCirculation(document, input, layout, checked)
}

/** Full aperture and approach footprints for optional furnishing placement.
 * These are transient reservations, not persistent required path checks. */
export function interiorDoorReservations(document: SceneDocument, report: InteriorConnectivityReport, widthMm: number): PointMm[][] {
  return report.openingIds.flatMap(id => {
    const opening = document.openings[id]
    if (!opening || opening.kind !== 'door') return []
    const { midpoint, normal, depth } = openingFrame(document, id, widthMm)
    const pose = opening.presentation, leafDepth = opening.state !== 'open' || !pose || pose.kind === 'frame' ? 0 : opening.widthMm / (pose.kind === 'double' ? 2 : 1)
    const [a, b] = leafDepth ? openingEndpoints(document, opening) : [midpoint, midpoint]
    const rightSign = normal.x ? Math.sign(a.y - b.y) : Math.sign(b.x - a.x)
    const sign = pose && pose.kind !== 'frame' && pose.side === 'right' ? rightSign : -rightSign
    const startDepth = sign < 0 ? Math.max(depth, leafDepth) : depth, endDepth = sign > 0 ? Math.max(depth, leafDepth) : depth
    return [corridor({ x: midpoint.x - normal.x * startDepth, y: midpoint.y - normal.y * startDepth }, { x: midpoint.x + normal.x * endDepth, y: midpoint.y + normal.y * endDepth }, Math.max(widthMm, opening.widthMm))]
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
    const fromAnchor = fromRoomId ? roomAnchor(document, fromRoomId, midpoint, normal, depth)
      : exteriorApproach(document, input, opening.id, toRoomId, midpoint, toAnchor).point
    const from = fromRoomId ? center(document, fromRoomId) : fromAnchor
    const route: InteriorCirculationRoute = { id: interiorEntityId(document.sceneId, input.seed, `current-route:${opening.id}:${toRoomId}`), fromRoomId, toRoomId, openingId: opening.id,
      from, to, pointsMm: [], widthMm, status: 'unavailable', notes: [] }
    for (const points of [[from, fromAnchor, toAnchor, to], [from, { x: fromAnchor.x, y: from.y }, fromAnchor, toAnchor, { x: toAnchor.x, y: to.y }, to],
      [from, { x: from.x, y: fromAnchor.y }, fromAnchor, toAnchor, { x: to.x, y: toAnchor.y }, to]]) {
      options.checkCancelled(); meter.charge({ gridNodes: 1, fieldEvaluations: routeCheckCount(input, route) * (Object.keys(document.walls).length + Object.keys(document.props).length + points.length) })
      route.pointsMm = compact(points); route.notes = checkRoute(document, input, route)
      if (!route.notes.length) { route.status = 'clear'; break }
    }
    report.routes.push(route)
    if (fromRoomId === null && report.entranceOpeningId === null) report.entranceOpeningId = opening.id
  }
  // A current-route inspection proves physical passage. Pure image overhangs
  // are placement preferences and cannot invalidate otherwise clear travel.
  const result = input.algorithmVersion >= 17 ? replanInteriorCirculation(document, input, layout, report, { ...options, avoidPaintedBodies: false }) : report
  result.notes = result.routes.filter(route => route.status !== 'clear').map(route => `当前通路建议未完成：${route.notes.join('；')}`)
  return result
}

export function arrangeInteriorConnections(document: SceneDocument, input: InteriorGenerationInput, layout: InteriorLayout, options: Options): { document: SceneDocument; report: InteriorConnectivityReport } {
  let next = cloneJson(document)
  const p = input.parameters, arrangement = p.arrangement, meter = captureExecutionBudget(options.profile), notes: string[] = []
  const report: InteriorConnectivityReport = { openingIds: [], entranceOpeningId: null, routes: [], notes }
  const semanticRooms = new Map([...layout.rooms.map(row => [row.roomId, `room:${row.requirementId}`] as const), ...layout.corridors.map(row => [row.roomId, 'corridor'] as const)])
  const roomOrder = (a: string, b: string) => input.algorithmVersion === 2 ? compare(a, b) : compare(semanticRooms.get(a)!, semanticRooms.get(b)!)
  const roomIds = [...layout.rooms, ...layout.corridors].map(row => row.roomId).sort(roomOrder), actual = new Set(roomIds)
  const roomByDemand = new Map(layout.rooms.map(room => [room.requirementId, room.roomId]))
  const corridorId = programCorridorId(p)
  if (p.program && corridorId && layout.corridors[0]) roomByDemand.set(corridorId, layout.corridors[0].roomId)
  if (arrangement.entranceRoomRequirementId !== undefined && (!arrangement.entrance || !roomByDemand.has(arrangement.entranceRoomRequirementId))) throw new InteriorGenerationError('invalid-input', '指定入口房间须引用现存需求，并启用对外入口。')
  const forbidden = new Set(p.relations.filter(row => row.kind === 'no-direct-connection').map(row => [roomByDemand.get(row.a), roomByDemand.get(row.b)].sort().join('\0')))
  const tick = () => { options.checkCancelled(); meter.charge({ fieldEvaluations: 1 }) }
  const walls = Object.values(next.walls).filter(wall => wall.floorId === p.floorId).map(wall => {
    tick()
    const start = next.vertices[wall.startVertexId], end = next.vertices[wall.endVertexId], rooms = owners(next, wall).filter(id => actual.has(id)).sort(roomOrder)
    // Equal-length wall selection must follow geometry, rather than random
    // native IDs. Preserve the ID tie break for the old replay contract.
    const stableKey = canonicalJson([[start.xMm, start.yMm], [end.xMm, end.yMm]].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    const exteriorSide = programWallSide(p, { x: start.xMm, y: start.yMm }, { x: end.xMm, y: end.yMm })
    return { wall, rooms, stableKey, exteriorSide, length: Math.abs(end.xMm - start.xMm) + Math.abs(end.yMm - start.yMm) }
  }).sort((a, b) => b.length - a.length || compare(input.algorithmVersion === 2 ? a.wall.id : a.stableKey, input.algorithmVersion === 2 ? b.wall.id : b.stableKey))
  const createDoorDraft = (wall: Wall, offsetMm?: number, widthMm = arrangement.doorWidthMm, key = `door:${wall.id}`): { id: string; document: SceneDocument } | null => {
    tick()
    const a = next.vertices[wall.startVertexId], b = next.vertices[wall.endVertexId]
    if (a.xMm !== b.xMm && a.yMm !== b.yMm) { notes.push('当前建议门只支持已物化的正交墙段。'); return null }
    const length = Math.abs(a.xMm - b.xMm) + Math.abs(a.yMm - b.yMm), clearance = Math.max(next.constraints.wallEndClearanceMm, Math.ceil(wall.thicknessMm / 2) + 1)
    if (widthMm < (next.constraints.minDoorWidthMm ?? 1) || length < widthMm + 2 * clearance) return null
    const id = interiorEntityId(next.sceneId, input.seed, key)
    const offset = offsetMm ?? Math.floor((length - widthMm) / 2)
    const result = applyCommands(next, [{ type: 'addOpening', id, wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: offset, widthMm,
      kind: 'door', state: 'open', locked: false, secret: false, revealed: false, layerId: p.layerId,
      ...(input.algorithmVersion >= INTERIOR_PROGRAM_VERSION ? { presentation: planDoorPresentation(next, wall, owners(next, wall), widthMm, arrangement.clearWidthMm) } : {}),
      ...(p.wallHeightMm === undefined ? {} : { vertical: defaultOpeningHeight(wall, 'door') }) }], { ids: { nextId: () => id }, clock: { now: () => document.updatedAt } }, { budget: options.profile })
    return { id, document: result }
  }
  const createDoor = (wall: Wall, offsetMm?: number, widthMm?: number, key?: string): string | null => {
    const result = createDoorDraft(wall, offsetMm, widthMm, key)
    if (!result) return null
    next = result.document; report.openingIds.push(result.id)
    return result.id
  }
  const routesFor = (openingId: string, fromRoomId: string | null, toRoomId: string): InteriorCirculationRoute => {
    const widthMm = arrangement.clearWidthMm, { midpoint, normal, depth } = openingFrame(next, openingId, widthMm)
    const to = center(next, toRoomId), toAnchor = roomAnchor(next, toRoomId, midpoint, normal, depth)
    const fromAnchor = fromRoomId ? roomAnchor(next, fromRoomId, midpoint, normal, depth)
      : exteriorApproach(next, input, openingId, toRoomId, midpoint, toAnchor).point
    const from = fromRoomId ? center(next, fromRoomId) : fromAnchor
    const route: InteriorCirculationRoute = { id: interiorEntityId(next.sceneId, input.seed, `route:${openingId}`), fromRoomId, toRoomId, openingId, from, to, pointsMm: [], widthMm, status: 'unavailable', notes: [] }
    const variants = [
      [from, fromAnchor, toAnchor, to],
      [from, { x: fromAnchor.x, y: from.y }, fromAnchor, toAnchor, { x: toAnchor.x, y: to.y }, to],
      [from, { x: from.x, y: fromAnchor.y }, fromAnchor, toAnchor, { x: to.x, y: toAnchor.y }, to],
    ]
    for (const points of variants) {
      tick(); meter.charge({ gridNodes: 1, fieldEvaluations: routeCheckCount(input, route) * (Object.keys(next.walls).length + Object.keys(next.props).length + points.length) })
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
  const requestedDoors = p.program?.connections
  if (requestedDoors) for (const demand of requestedDoors) {
    const a = roomByDemand.get(demand.a), b = roomByDemand.get(demand.b)
    const widthMm = demand.widthMm ?? arrangement.doorWidthMm
    const row = walls.find(row => row.rooms.length === 2 && row.rooms.includes(a!) && row.rooms.includes(b!)
      && row.length >= widthMm + 2 * Math.max(next.constraints.wallEndClearanceMm, Math.ceil(row.wall.thicknessMm / 2) + 1))
    const besideCounter = p.program?.furnishings?.some(item => [demand.a, demand.b].includes(item.roomId)
      && item.counterNextTo !== undefined && item.counterNextTo !== item.roomId && [demand.a, demand.b].includes(item.counterNextTo))
    const clearance = row && Math.max(next.constraints.wallEndClearanceMm, Math.ceil(row.wall.thicknessMm / 2) + 1)
    const offset = besideCounter && row && clearance !== undefined ? Math.min(row.length - widthMm - clearance,
      Math.max(clearance, Math.ceil(arrangement.clearWidthMm / 2))) : undefined
    const id = row ? createDoor(row.wall, offset, widthMm) : null
    if (!id || !a || !b) throw new InteriorGenerationError('search-exhausted', `「${demand.a}」与「${demand.b}」之间没有容纳 ${widthMm} mm 门洞的实际共墙。`)
    report.routes.push(routesFor(id, a, b))
  }
  else if (arrangement.doors) for (const row of walls) {
    if (row.rooms.length !== 2 || forbidden.has([...row.rooms].sort().join('\0')) || root(row.rooms[0]) === root(row.rooms[1])) continue
    const id = createDoor(row.wall)
    if (!id) continue
    parents.set(root(row.rooms[1]), root(row.rooms[0]))
    report.routes.push(routesFor(id, row.rooms[0], row.rooms[1]))
  }
  if (!requestedDoors && arrangement.doors && roomIds.length > 1 && new Set(roomIds.map(root)).size > 1) notes.push('部分房间未找到足长、满足端部间隙且允许连接的共墙；保留布局，可手工调整门。')
  const entrances = p.program?.entrances
  if (entrances?.length) {
    const placed: NonNullable<InteriorConnectivityReport['entrances']> = []
    for (const entry of entrances.toSorted((a, b) => Number(!!b.side) - Number(!!a.side) || (b.widthMm ?? arrangement.doorWidthMm) - (a.widthMm ?? arrangement.doorWidthMm) || compare(a.id, b.id))) {
      const roomId = roomByDemand.get(entry.roomId)!, widthMm = entry.widthMm ?? arrangement.doorWidthMm
      const candidates = walls.filter(row => row.rooms.length === 1 && row.rooms[0] === roomId && row.exteriorSide && (!entry.side || row.exteriorSide === entry.side))
      for (const row of candidates) {
        const clearance = Math.max(next.constraints.wallEndClearanceMm, Math.ceil(row.wall.thicknessMm / 2) + 1)
        const spaces = openWallRuns(next, row.wall, row.length, clearance).filter(run => run.end - run.start >= widthMm)
          .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
        const space = spaces[0]
        if (!space) continue
        const needsSpace = entrances.some(other => other.id !== entry.id && other.roomId === entry.roomId && (!other.side || other.side === row.exteriorSide)
          && !placed.some(value => value.requirementId === other.id))
        const offset = needsSpace ? space.start : Math.floor((space.start + space.end - widthMm) / 2)
        const id = createDoor(row.wall, offset, widthMm, `entrance:${entry.id}`)
        if (!id) continue
        placed.push({ requirementId: entry.id, openingId: id, roomId, role: entry.role, side: row.exteriorSide! })
        report.routes.push(routesFor(id, null, roomId))
        break
      }
      if (!placed.some(value => value.requirementId === entry.id)) throw new InteriorGenerationError('search-exhausted', `「${entry.roomId}」没有可用外墙段容纳外门「${entry.id}」的 ${widthMm} mm 门洞。`)
    }
    report.entrances = placed
    report.entranceOpeningId = (placed.find(row => row.role === 'main') ?? placed[0]).openingId
    next = applyCommands(next, [{ type: 'setEntranceOpenings', ids: [...next.constraints.entranceOpeningIds, ...placed.map(row => row.openingId)] }],
      { ids: { nextId: () => report.entranceOpeningId! }, clock: { now: () => document.updatedAt } }, { budget: options.profile })
  } else if (arrangement.entrance) {
    const requiredRoomId = arrangement.entranceRoomRequirementId === undefined ? undefined : roomByDemand.get(arrangement.entranceRoomRequirementId)
    const entranceWalls = requiredRoomId === undefined ? walls : walls.filter(row => row.rooms.length === 1 && row.rooms[0] === requiredRoomId)
    if (options.entranceApproach) {
      const approach = options.entranceApproach
      if (arrangement.doorWidthMm < approach.widthMm) throw new InteriorGenerationError('contradiction', '实际门洞净宽小于接入路线。')
      const proposals = rankExteriorEntranceProposals(next, entranceWalls, p.boundsMm, arrangement.doorWidthMm, approach, options)
      const retainedSegments = LAYER_ENTITY_COLLECTIONS.reduce((sum, key) => sum + Object.values(next[key]).reduce((n, row) => n + measureBudgetGeometry(row).geometrySegments, 0), 0)
      const failures: string[] = []
      for (const proposal of proposals) {
        tick(); meter.charge({ gridNodes: 1, fieldEvaluations: Object.keys(next.walls).length + Object.keys(next.props).length + proposal.pointsMm.length,
          intersectionPairs: 2 * (retainedSegments + 6 * (proposal.pointsMm.length + 1)) ** 2 })
        const draft = createDoorDraft(proposal.wall, proposal.offsetMm)
        if (!draft) continue
        let port
        try { port = resolveBuildingEntrancePort(draft.document, draft.id, approach.widthMm) }
        catch (error) { failures.push(error instanceof Error ? error.message : String(error)); continue }
        const route = checkTerrainRoute(draft.document, { floorId: p.floorId, pointsMm: proposal.pointsMm, widthMm: approach.widthMm })
        const joined = checkTerrainRoute(draft.document, { floorId: p.floorId, pointsMm: [...proposal.pointsMm, port.insideMm], widthMm: approach.widthMm })
        if (!route.ok || !joined.ok) { failures.push(...route.issues.map(row => row.message), ...joined.issues.map(row => row.message)); continue }
        next = draft.document; report.openingIds.push(draft.id); report.entranceOpeningId = draft.id
        report.routes.push(routesFor(draft.id, null, port.roomId)); break
      }
      if (!report.entranceOpeningId) throw new InteriorGenerationError('search-exhausted', `有限外门与接入候选未找到完整净宽路线：${unique(failures).join('；') || '请调整入口、折点或建筑范围。'}`)
    } else for (const row of entranceWalls) {
      if (row.rooms.length !== 1) continue
      const id = createDoor(row.wall)
      if (!id) continue
      report.entranceOpeningId = id; report.routes.push(routesFor(id, null, row.rooms[0])); break
    }
    if (arrangement.entranceRoomRequirementId !== undefined) {
      if (requiredRoomId === undefined || report.entranceOpeningId === null) throw new InteriorGenerationError('search-exhausted', '指定入口房间没有可采用的足宽外门；未改用其他房间，请调整需求。')
      next = applyCommands(next, [{ type: 'setEntranceOpenings', ids: [...next.constraints.entranceOpeningIds, report.entranceOpeningId] }], { ids: { nextId: () => report.entranceOpeningId! }, clock: { now: () => document.updatedAt } }, { budget: options.profile })
    } else if (report.entranceOpeningId === null) notes.push('未找到足长且满足端部间隙的外墙入口；保留布局，可手工添加入口。')
  }
  if (p.program && p.program.exteriorWindows !== false) {
    const windows: SceneCommand[] = []
    for (const { wall, rooms, exteriorSide, length } of walls) {
      tick()
      if (!exteriorSide || rooms.length !== 1) continue
      const clearance = Math.max(next.constraints.wallEndClearanceMm, wall.thicknessMm * 2, 400)
      const runs = openWallRuns(next, wall, length, clearance)
      for (const run of runs) {
        const length = run.end - run.start
        if (length < 1500) continue
        const count = Math.max(1, Math.floor(length / 4400)), pitch = length / count
        const widthMm = Math.min(1600, Math.round(pitch * .44))
        for (let index = 0; index < count; index++) {
          tick()
          const offsetMm = Math.round(run.start + pitch * (index + .5) - widthMm / 2)
          windows.push({ type: 'addOpening', id: interiorEntityId(next.sceneId, input.seed, `window:${wall.id}:${offsetMm}`),
            wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm, widthMm, kind: 'window', layerId: p.layerId,
            ...(p.wallHeightMm === undefined ? {} : { vertical: defaultOpeningHeight(wall, 'window') }) })
        }
      }
    }
    if (windows.length) next = applyCommands(next, windows, { ids: { nextId: () => { throw new Error('生成窗户须有确定身份。') } }, clock: { now: () => document.updatedAt } }, { budget: options.profile })
  }
  for (const route of report.routes) if (route.status !== 'clear') notes.push(`通路建议未完成：${route.notes.join('；')}`)
  options.checkCancelled()
  const result = { ...report, notes: unique(notes) }
  return { document: next, report: p.program ? replanInteriorCirculation(next, input, layout, result, options) : result }
}
