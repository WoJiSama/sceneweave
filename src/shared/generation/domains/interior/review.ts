import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { openingEndpoints, polygonDistance, polygonInside, propFootprint, roomPoints } from '../../../geometry/geometry.js'
import { reliefBounds } from '../../../geometry/terrain-relief.js'
import type { Prop, SceneDocument } from '../../../model/scene.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { INTERIOR_PROGRAM_VERSION, INTERIOR_SEATS_PER_GROUP, type InteriorGenerationInput, type InteriorLayout } from './contracts.js'
import { inspectInteriorConnections } from './connectivity.js'
import { interiorFurnitureRoles } from './furnishing.js'
import { counterFitsSharedWall, isServiceCounter } from './furnishing-counter.js'
import { furnitureBoundsPolygon } from './furnishing-poses.js'
import { furnitureUseSpacePolygon, furnitureWorkingSpacePolygon } from './furnishing-use-space.js'
import { planSavedFurnitureAccess } from './review-access.js'
import { checkInteriorLayout, clearArea, interiorEntityId, rectanglePoints } from './layout.js'
import { programCorridorId, programWallSide } from './program.js'

/** Read the current geometry, openings and bodies. Neither the receipt's
 * planned route nor the number of accepted placements serves as evidence. */
export function reviewSavedInterior(document: SceneDocument, floorId: string, seed: string, profile: TaskBudgetProfile) {
  const generation = getLegacyGeneration(document)
  const recipe = Object.values(generation?.recipes ?? {}).find(row => 'domain' in row && row.domain === 'interior' && row.algorithmId === 'interior-layout'
    && row.algorithmVersion === INTERIOR_PROGRAM_VERSION && row.parameters.floorId === floorId && row.seed === seed)
  if (!recipe || !('domain' in recipe) || recipe.domain !== 'interior' || recipe.algorithmId !== 'interior-layout'
    || recipe.algorithmVersion !== INTERIOR_PROGRAM_VERSION || !recipe.parameters.program) throw new Error('保存工程缺少对应的结构化室内配方。')
  const p = recipe.parameters, program = p.program!, width = p.arrangement.clearWidthMm
  const input: InteriorGenerationInput = { version: 1, algorithmVersion: INTERIOR_PROGRAM_VERSION, seed, parameters: p }
  const id = (key: string) => interiorEntityId(document.sceneId, seed, key)
  const checkCancelled = () => {}
  const meter = captureExecutionBudget(profile), charge = () => meter.charge({ fieldEvaluations: 1, intersectionPairs: 1 })
  const issues: string[] = []
  const roomIds = new Map(p.rooms.map(room => [room.id, id(`room:${room.id}`)]))
  const corridorId = programCorridorId(p)
  if (corridorId) roomIds.set(corridorId, id('corridor'))
  const rooms = [...roomIds].flatMap(([requirementId, roomId]) => {
    const room = document.rooms[roomId]
    if (!room || room.floorId !== floorId) { issues.push(`缺少声明的空间「${requirementId}」。`); return [] }
    const boundsMm = reliefBounds(roomPoints(document, room))
    return [{ requirementId, roomId, boundsMm, clearAreaMm2: clearArea(boundsMm, p.wallThicknessMm) }]
  })
  const layout: InteriorLayout = { rooms: rooms.filter(row => row.requirementId !== corridorId), corridors: rooms.filter(row => row.requirementId === corridorId) }
  issues.push(...checkInteriorLayout(input, layout))
  if (program.roomLabels) for (const { requirementId, roomId } of rooms) {
    if (!Object.values(document.notes).some(note => note.kind === 'label' && note.visibility === 'public' && note.anchor.type === 'entity'
      && note.anchor.entityKind === 'room' && note.anchor.entityId === roomId)) issues.push(`空间「${requirementId}」缺少公开房间标注。`)
  }
  const routes = inspectInteriorConnections(document, input, layout, { profile, checkCancelled }).routes
  const passage = (openingId: string, a: string | null, b: string) => routes.find(route => route.openingId === openingId && route.status === 'clear'
    && (route.fromRoomId === a && route.toRoomId === b || route.toRoomId === a && route.fromRoomId === b))
  const entrances = (program.entrances ?? []).map(entry => {
    const openingId = id(`entrance:${entry.id}`), opening = document.openings[openingId], roomId = roomIds.get(entry.roomId)!
    const side = opening && programWallSide(p, ...openingEndpoints(document, opening))
    const clear = !!opening && !!side && (!entry.side || side === entry.side) && opening.widthMm === (entry.widthMm ?? p.arrangement.doorWidthMm)
      && document.constraints.entranceOpeningIds.includes(openingId) && !!passage(openingId, null, roomId)
    if (!clear) issues.push(`外门「${entry.id}」的目标房间、朝向或 ${width} mm 通路未通过。`)
    return { id: entry.id, role: entry.role, roomId, side: side ?? null, openingId: opening ? openingId : null, widthMm: opening?.widthMm ?? null, ok: clear }
  })
  const connections = (program.connections ?? []).map(entry => {
    const a = roomIds.get(entry.a)!, b = roomIds.get(entry.b)!, doorWidth = entry.widthMm ?? p.arrangement.doorWidthMm
    const found = routes.find(route => document.openings[route.openingId]?.widthMm === doorWidth && passage(route.openingId, a, b))
    if (!found) issues.push(`「${entry.a}」至「${entry.b}」的 ${doorWidth} mm 门洞或 ${width} mm 通路未通过。`)
    return { a: entry.a, b: entry.b, openingId: found?.openingId ?? null, widthMm: doorWidth, pointsMm: found?.pointsMm ?? [], ok: !!found }
  })
  if (program.connections === undefined && program.entrances?.length) {
    for (const route of routes) if (route.status !== 'clear') issues.push(`门「${route.openingId}」的 ${width} mm 通路未通过。`)
  }
  const furnishings = (program.furnishings ?? []).map(entry => {
    const row = rooms.find(value => value.requirementId === entry.roomId), room = row && document.rooms[row.roomId]
    if (!row || !room) return { roomId: entry.roomId, groups: [], counterId: null, ok: false }
    const polygon = roomPoints(document, room), requirement = p.rooms.find(value => value.id === entry.roomId)!
    const slots = interiorFurnitureRoles(input, requirement, row.clearAreaMm2).map((role, index) => {
      const prop = document.props[id(`furniture:${entry.roomId}:${role}:${index}`)]
      const matches = prop && p.arrangement.palette.some(item => item.role === role && prop.definitionRef?.id === item.ref.id && prop.definitionRef.version === item.ref.version)
      return { role, prop: matches ? prop : undefined }
    })
    const inRoom = (prop: Prop | undefined): prop is Prop => !!prop && prop.floorId === floorId && prop.supportRef.kind === 'room' && prop.supportRef.id === room.id
      && polygonInside(propFootprint(prop), polygon)
    const tables = slots.filter(slot => slot.role === 'table').map(slot => slot.prop).filter(inRoom)
    const seats = slots.filter(slot => slot.role === 'seat').map(slot => slot.prop).filter(inRoom)
    const access = planSavedFurnitureAccess(document, room.id, checkCancelled, meter)
    const byTable = new Map(tables.map(table => [table.id, [] as Prop[]]))
    if (entry.seatingGroups) for (const seat of seats) {
      const nearest = tables.map(table => { charge(); return { table, gap: polygonDistance(propFootprint(table), propFootprint(seat)) } }).sort((a, b) => a.gap - b.gap || a.table.id.localeCompare(b.table.id))[0]
      if (nearest && nearest.gap < width && polygonInside(furnitureUseSpacePolygon(seat, seat), polygon) && access(seat, true)) byTable.get(nearest.table.id)!.push(seat)
    }
    const groups = entry.seatingGroups ? tables.map(table => {
      const assigned = byTable.get(table.id)!
      return { tableId: table.id, seatIds: assigned.map(seat => seat.id), body: rectanglePoints(reliefBounds([table, ...assigned].flatMap(prop => [...propFootprint(prop), ...furnitureBoundsPolygon(prop.visualBoundsMm, prop)]))) }
    }) : []
    const distances = groups.flatMap((group, index) => groups.slice(index + 1).map(other => { charge(); return polygonDistance(group.body, other.body) }))
    const spaced = distances.every(distance => distance >= width)
    const seatingOk = !entry.seatingGroups || groups.length === entry.seatingGroups && groups.every(group => group.seatIds.length === INTERIOR_SEATS_PER_GROUP) && spaced
    if (!seatingOk) issues.push(`「${entry.roomId}」的完整桌椅组、组间净距或座席接入未通过。`)
    const counter = entry.counterNextTo ? slots[0]?.prop : undefined, neighbor = rooms.find(value => value.requirementId === entry.counterNextTo)
    const definition = counter?.definitionRef && document.propDefinitions[counter.definitionRef.id]
    const counterOk = !entry.counterNextTo || !!(inRoom(counter) && neighbor && definition && isServiceCounter(definition)
      && counterFitsSharedWall(row.boundsMm, neighbor.boundsMm, counter, Math.ceil(p.wallThicknessMm / 2) + 101, Math.floor(width / 2))
      && polygonInside(furnitureWorkingSpacePolygon(counter, counter), polygon) && access(counter, false))
    if (!counterOk) issues.push(`「${entry.roomId}」的柜台位置或使用通路未通过。`)
    return { roomId: entry.roomId, groups: groups.map(({ tableId, seatIds }) => ({ tableId, seatIds })), minimumGroupGapMm: distances.length ? Math.floor(Math.min(...distances)) : null,
      counterId: counter?.id ?? null, ok: seatingOk && counterOk }
  })
  return { ok: issues.length === 0, clearWidthMm: width, entrances, connections, furnishings, issues }
}
