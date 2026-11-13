import type { PointMm, SceneDocument, Wall } from '../../../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS } from '../../../model/scene.js'
import { applyCommands } from '../../../commands/commands.js'
import { captureExecutionBudget, measureBudgetGeometry, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { cloneJson, canonicalJson } from '../../../validation/json.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { corridor, coveredEverywhere, openingEndpoints, pathPolygon, pointInPolygon, roomPoints } from '../../../geometry/geometry.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { interiorEntityId, InteriorGenerationError } from './layout.js'
import { rankExteriorEntranceProposals } from './entrance-selection.js'
import type { BuildingEntranceApproach, InteriorGenerationInput, InteriorLayout } from './contracts.js'
import { replanInteriorRoomRoute } from './connectivity-routing.js'

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
type Options = { profile: TaskBudgetProfile; checkCancelled: () => void; entranceApproach?: BuildingEntranceApproach; avoidPaintedBodies?: boolean }
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

/** v17 may replace the generation-time path while retaining its exact door,
 * endpoints, rooms and full width. No document or incoming report is mutated.
 * Each joined alternative still reaches the independent complete route check. */
export function replanInteriorCirculation(document: SceneDocument, input: InteriorGenerationInput, layout: InteriorLayout,
  report: InteriorConnectivityReport, options: Options): InteriorConnectivityReport {
  const meter = captureExecutionBudget(options.profile)
  const sceneWork = Object.keys(document.walls).length + Object.keys(document.props).length + Object.keys(document.regions).length + Object.keys(document.rooms).length
  const chargeCheck = (routes: InteriorCirculationRoute[]) => {
    for (const route of routes) { options.checkCancelled(); meter.charge({ fieldEvaluations: sceneWork + route.pointsMm.length }) }
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
      : { x: midpoint.x - (toAnchor.x - midpoint.x), y: midpoint.y - (toAnchor.y - midpoint.y) }
    const to = replanInteriorRoomRoute(document, { roomId: route.toRoomId, openingId: route.openingId,
      start: toAnchor, end: route.to, widthMm: route.widthMm }, options)
    if (!to) continue
    const from = route.fromRoomId ? replanInteriorRoomRoute(document, { roomId: route.fromRoomId, openingId: route.openingId,
      start: fromAnchor, end: route.from, widthMm: route.widthMm }, options) : [fromAnchor]
    if (!from) continue
    const pointsMm = compact([...from].reverse().concat(to))
    options.checkCancelled()
    meter.charge({ fieldEvaluations: sceneWork + pointsMm.length })
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
  const forbidden = new Set(p.relations.filter(row => row.kind === 'no-direct-connection').map(row => [roomByDemand.get(row.a), roomByDemand.get(row.b)].sort().join('\0')))
  const tick = () => { options.checkCancelled(); meter.charge({ fieldEvaluations: 1 }) }
  const walls = Object.values(next.walls).filter(wall => wall.floorId === p.floorId).map(wall => {
    tick()
    const start = next.vertices[wall.startVertexId], end = next.vertices[wall.endVertexId], rooms = owners(next, wall).filter(id => actual.has(id)).sort(roomOrder)
    // Equal-length wall selection must follow geometry, rather than random
    // native IDs. Preserve the ID tie break for the old replay contract.
    const stableKey = canonicalJson([[start.xMm, start.yMm], [end.xMm, end.yMm]].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    return { wall, rooms, stableKey, length: Math.abs(end.xMm - start.xMm) + Math.abs(end.yMm - start.yMm) }
  }).sort((a, b) => b.length - a.length || compare(input.algorithmVersion === 2 ? a.wall.id : a.stableKey, input.algorithmVersion === 2 ? b.wall.id : b.stableKey))
  const createDoorDraft = (wall: Wall, offsetMm?: number): { id: string; document: SceneDocument } | null => {
    tick()
    const a = next.vertices[wall.startVertexId], b = next.vertices[wall.endVertexId]
    if (a.xMm !== b.xMm && a.yMm !== b.yMm) { notes.push('当前建议门只支持已物化的正交墙段。'); return null }
    const length = Math.abs(a.xMm - b.xMm) + Math.abs(a.yMm - b.yMm), clearance = Math.max(next.constraints.wallEndClearanceMm, Math.ceil(wall.thicknessMm / 2) + 1)
    if (arrangement.doorWidthMm < (next.constraints.minDoorWidthMm ?? 1) || length < arrangement.doorWidthMm + 2 * clearance) return null
    const id = interiorEntityId(next.sceneId, input.seed, `door:${wall.id}`)
    const offset = offsetMm ?? Math.floor((length - arrangement.doorWidthMm) / 2)
    const result = applyCommands(next, [{ type: 'addOpening', id, wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: offset, widthMm: arrangement.doorWidthMm,
      kind: 'door', state: 'open', locked: false, secret: false, revealed: false, layerId: p.layerId }], { ids: { nextId: () => id }, clock: { now: () => document.updatedAt } }, { budget: options.profile })
    return { id, document: result }
  }
  const createDoor = (wall: Wall): string | null => {
    const result = createDoorDraft(wall)
    if (!result) return null
    next = result.document; report.openingIds.push(result.id)
    return result.id
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
    if (options.entranceApproach) {
      const approach = options.entranceApproach
      if (arrangement.doorWidthMm < approach.widthMm) throw new InteriorGenerationError('contradiction', '实际门洞净宽小于接入路线。')
      const proposals = rankExteriorEntranceProposals(next, walls, p.boundsMm, arrangement.doorWidthMm, approach, options)
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
    } else for (const row of walls) {
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
