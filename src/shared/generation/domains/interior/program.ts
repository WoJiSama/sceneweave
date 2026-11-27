import { DEFAULT_INTERIOR_CORRIDOR_ID, type InteriorLayout, type InteriorLayoutParameters, type InteriorProgram, type InteriorRectangle, type InteriorSide } from './contracts.js'
import { InteriorGenerationError, sharedWallLength } from './layout.js'
import type { PointMm } from '../../../model/scene.js'

export function programCorridorId(p: InteriorLayoutParameters) {
  return p.corridor.axis === 'none' ? undefined : p.program?.corridorId ?? DEFAULT_INTERIOR_CORRIDOR_ID
}

export const interiorWallRun = (widthMm: number, wallThicknessMm: number) =>
  widthMm + 2 * Math.max(100, Math.ceil(wallThicknessMm / 2) + 1)

export function exteriorWallLength(room: InteriorRectangle, boundary: InteriorRectangle, side: InteriorSide) {
  switch (side) {
    case 'north': return room.y === boundary.y ? room.width : 0
    case 'south': return room.y + room.height === boundary.y + boundary.height ? room.width : 0
    case 'west': return room.x === boundary.x ? room.height : 0
    case 'east': return room.x + room.width === boundary.x + boundary.width ? room.height : 0
  }
}

export const interiorSides = ['north', 'east', 'south', 'west'] as const

export function availableExteriorWall(room: InteriorRectangle, boundary: InteriorRectangle, side?: InteriorSide) {
  return side ? exteriorWallLength(room, boundary, side)
    : Math.max(...interiorSides.map(direction => exteriorWallLength(room, boundary, direction)))
}

export function programWallSide(p: InteriorLayoutParameters, a: PointMm, b: PointMm): InteriorSide | undefined {
  const inset = Math.ceil(p.wallThicknessMm / 2), bounds = p.boundsMm
  if (a.y === b.y) return a.y === bounds.y + inset ? 'north' : a.y === bounds.y + bounds.height - inset ? 'south' : undefined
  if (a.x === b.x) return a.x === bounds.x + inset ? 'west' : a.x === bounds.x + bounds.width - inset ? 'east' : undefined
}

/** Additional required contacts are derived from doors and oriented furniture. */
export function programRelations(p: InteriorLayoutParameters) {
  const contacts = new Map(p.relations.filter(row => row.kind === 'adjacent').map(row => [[row.a, row.b].sort().join('\0'), row]))
  const add = (a: string, b: string, minimumSharedWallMm: number) => {
    const key = [a, b].sort().join('\0')
    const existing = contacts.get(key)
    contacts.set(key, { a, b, kind: 'adjacent', minimumSharedWallMm: Math.max(existing?.minimumSharedWallMm ?? 0, minimumSharedWallMm) })
  }
  for (const door of p.program?.connections ?? []) add(door.a, door.b, interiorWallRun(door.widthMm ?? p.arrangement.doorWidthMm, p.wallThicknessMm))
  for (const furniture of p.program?.furnishings ?? []) if (furniture.counterNextTo) add(furniture.roomId, furniture.counterNextTo, 1)
  return [...p.relations.filter(row => row.kind !== 'adjacent'), ...contacts.values()]
}

export function normalizeInteriorProgram(p: InteriorLayoutParameters): InteriorProgram | undefined {
  const program = p.program
  if (!program) return
  const roomIds = new Set(p.rooms.map(row => row.id)), corridorId = programCorridorId(p), ids = new Set(roomIds)
  const conflict = (message: string): never => { throw new InteriorGenerationError('contradiction', message) }
  if (program.corridorId && !corridorId) conflict('命名的走廊需要指定横向或纵向走廊。')
  if (corridorId) {
    if (ids.has(corridorId)) conflict(`走廊 ID「${corridorId}」与房间重复。`)
    ids.add(corridorId)
  }
  if (program.entrances && p.arrangement.entranceRoomRequirementId !== undefined) conflict('分别指定外门时，请把主入口房间写在外门需求中。')
  if (program.entrances?.length && !p.arrangement.entrance) conflict('指定外门需要启用建筑入口。')
  if (program.connections?.length && !p.arrangement.doors) conflict('指定内门需要启用房间之间的门。')
  if (program.furnishings?.length && !p.arrangement.furniture) conflict('指定家具组需要启用安排家具。')
  if (program.entrances && new Set(program.entrances.map(row => row.id)).size !== program.entrances.length) conflict('外门需求 ID 重复。')
  if ((program.entrances?.filter(entry => entry.role === 'main').length ?? 0) > 1) conflict('有多个对外通路时只需标记一个主入口，其余可标为辅助入口。')
  const width = (value = p.arrangement.doorWidthMm) => {
    if (value < p.arrangement.clearWidthMm) conflict(`指定门宽 ${value} mm 小于通路净宽 ${p.arrangement.clearWidthMm} mm。`)
  }
  for (const entry of program.entrances ?? []) {
    if (!ids.has(entry.roomId)) conflict(`外门「${entry.id}」引用的空间「${entry.roomId}」不存在。`)
    width(entry.widthMm)
  }
  const connections = program.connections?.map(row => {
    const [a, b] = [row.a, row.b].sort()
    if (a === b || !ids.has(a) || !ids.has(b)) conflict(`内门须引用不同且存在的两个空间「${a}」和「${b}」。`)
    if (p.relations.some(relation => relation.kind !== 'adjacent' && relation.a === a && relation.b === b)) conflict(`「${a}」和「${b}」的内门与房间关系冲突。`)
    width(row.widthMm)
    if ((a === corridorId || b === corridorId) && p.corridor.clearWidthMm < p.arrangement.clearWidthMm) conflict(`走廊净宽 ${p.corridor.clearWidthMm} mm 小于指定通路净宽 ${p.arrangement.clearWidthMm} mm。`)
    return { ...row, a, b }
  }).sort((a, b) => compare(a.a, b.a) || compare(a.b, b.b))
  if (connections && new Set(connections.map(row => `${row.a}\0${row.b}`)).size !== connections.length) conflict('两空间之间的内门需求重复。')
  const furnishings = program.furnishings?.toSorted((a, b) => compare(a.roomId, b.roomId))
  if (furnishings && new Set(furnishings.map(row => row.roomId)).size !== furnishings.length) conflict('同一房间的家具需求重复。')
  for (const row of furnishings ?? []) {
    if (!roomIds.has(row.roomId) || row.counterNextTo && (row.roomId === row.counterNextTo || !roomIds.has(row.counterNextTo))) conflict(`家具组「${row.roomId}」须引用实际房间，服务台须指向不同的相邻房间。`)
    if (row.counterNextTo && p.relations.some(relation => relation.kind === 'separate' && [relation.a, relation.b].includes(row.roomId)
      && [relation.a, relation.b].includes(row.counterNextTo!))) conflict(`「${row.roomId}」的服务台需要与「${row.counterNextTo}」共墙。`)
  }
  return { ...program, ...(connections ? { connections } : {}), ...(furnishings ? { furnishings } : {}),
    ...(program.entrances ? { entrances: program.entrances.toSorted((a, b) => compare(a.id, b.id)) } : {}) }
}

export function checkInteriorProgramLayout(p: InteriorLayoutParameters, layout: InteriorLayout, boundary: InteriorRectangle) {
  if (!p.program) return []
  const rows = new Map(layout.rooms.map(row => [row.requirementId, row.boundsMm]))
  const corridorId = programCorridorId(p)
  if (corridorId && layout.corridors[0]) rows.set(corridorId, layout.corridors[0].boundsMm)
  const issues: string[] = []
  for (const relation of programRelations(p)) {
    if (relation.kind !== 'adjacent') continue
    const a = rows.get(relation.a), b = rows.get(relation.b)
    if (!a || !b || sharedWallLength(a, b) < Math.max(1, relation.minimumSharedWallMm)) issues.push(`「${relation.a}」与「${relation.b}」缺少所需的足宽共墙。`)
  }
  for (const entry of p.program.entrances ?? []) {
    const room = rows.get(entry.roomId), minimum = interiorWallRun(entry.widthMm ?? p.arrangement.doorWidthMm, p.wallThicknessMm)
    if (!room || availableExteriorWall(room, boundary, entry.side) < minimum) issues.push(`「${entry.roomId}」没有容纳外门「${entry.id}」的指定外墙。`)
  }
  return issues
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
