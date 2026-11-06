import type { PointMm, PropDefinition, SceneDocument, VersionRef } from '../../../model/scene.js'
import { applyCommands } from '../../../commands/commands.js'
import { createBasePlacedProp } from '../../../commands/base.js'
import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { polygonDistance, polygonInside, polygonsOverlap, propFootprint, roomPoints, supportedPolygon } from '../../../geometry/geometry.js'
import { wallMovementPolygons } from '../../../geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { cloneJson } from '../../../validation/json.js'
import type { InteriorFurnitureRole, InteriorGenerationInput, InteriorLayout, InteriorRectangle } from './contracts.js'
import { InteriorGenerationError, interiorEntityId } from './layout.js'
import { checkInteriorCirculation, interiorDoorReservations, type InteriorConnectivityReport } from './connectivity.js'

export interface InteriorFurnishingRoom {
  requirementId: string
  roomId: string
  recommended: InteriorFurnitureRole[]
  placed: { propId: string; role: InteriorFurnitureRole; definitionRef: VersionRef }[]
  notes: string[]
}
export interface InteriorFurnishingReport {
  propIds: string[]
  rooms: InteriorFurnishingRoom[]
  notes: string[]
  testedPlacements: number
}

const roleName: Record<InteriorFurnitureRole, string> = { bed: '床', seat: '座椅', table: '桌子', storage: '收纳家具', work: '工作台', hearth: '炉台', shelf: '书架' }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const rectangle = (b: InteriorRectangle): PointMm[] => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]

/** First-generation suggestions only. Neither the purpose vocabulary nor these
 * area thresholds become constraints on later manual edits. */
export function recommendInteriorFurniture(purpose: string, clearAreaMm2: number): InteriorFurnitureRole[] {
  const area = clearAreaMm2 / 1_000_000, text = purpose.toLowerCase()
  if (area < 4 || /走廊|通道|corridor|hallway/.test(text)) return []
  const result: InteriorFurnitureRole[] = []
  const add = (threshold: number, ...roles: InteriorFurnitureRole[]) => { if (area >= threshold) result.push(...roles) }
  if (/卧室|客房|寝室|宿舍|bedroom|guest|dorm/.test(text)) {
    add(4, 'bed'); add(10, 'storage'); add(18, 'seat'); add(28, 'table'); add(40, 'bed')
  } else if (/书房|办公|研究|study|office|library/.test(text)) {
    add(4, 'work'); add(8, 'seat'); add(14, 'shelf'); add(28, 'shelf'); add(40, 'seat')
  } else if (/厨房|烹饪|kitchen/.test(text)) {
    add(4, 'work'); add(8, 'storage'); add(14, 'hearth'); add(28, 'work'); add(40, 'storage')
  } else if (/储藏|库房|仓库|storage|store|pantry/.test(text)) {
    add(4, 'storage'); add(12, 'storage'); add(24, 'storage'); add(40, 'storage')
  } else {
    add(4, 'table'); add(8, 'seat'); add(16, 'seat'); add(24, 'storage'); add(32, 'seat'); add(48, 'table')
  }
  return result.slice(0, 6)
}

/** A finite wall-oriented set. Candidate positions account for the immutable
 * physical offset and painted bounds; no scaling or arbitrary rotation occurs. */
function placementPositions(bounds: InteriorRectangle, definition: PropDefinition, inset: number, rank: (key: string) => string): PointMm[] {
  const shape = { minX: Math.min(definition.defaultFootprintOffsetMm.x - definition.defaultFootprintMm.width / 2, definition.defaultVisualBoundsMm.x),
    maxX: Math.max(definition.defaultFootprintOffsetMm.x + definition.defaultFootprintMm.width / 2, definition.defaultVisualBoundsMm.x + definition.defaultVisualBoundsMm.width),
    minY: Math.min(definition.defaultFootprintOffsetMm.y - definition.defaultFootprintMm.height / 2, definition.defaultVisualBoundsMm.y),
    maxY: Math.max(definition.defaultFootprintOffsetMm.y + definition.defaultFootprintMm.height / 2, definition.defaultVisualBoundsMm.y + definition.defaultVisualBoundsMm.height) }
  const left = Math.ceil(bounds.x + inset - shape.minX), right = Math.floor(bounds.x + bounds.width - inset - shape.maxX)
  const top = Math.ceil(bounds.y + inset - shape.minY), bottom = Math.floor(bounds.y + bounds.height - inset - shape.maxY)
  if (left > right || top > bottom) return []
  const points: PointMm[] = []
  // Corners and walls first leave the central circulation area available.
  for (const fraction of [0, 1, .25, .75, .5]) {
    const x = Math.round(left + (right - left) * fraction), y = Math.round(top + (bottom - top) * fraction)
    points.push({ x, y: top }, { x, y: bottom }, { x: left, y }, { x: right, y })
  }
  for (const fy of [.25, .75, .5]) for (const fx of [.25, .75, .5]) points.push({ x: Math.round(left + (right - left) * fx), y: Math.round(top + (bottom - top) * fy) })
  const unique = [...new Map(points.map(point => [`${point.x}/${point.y}`, point])).values()]
  const boundary = (point: PointMm) => point.x === left || point.x === right || point.y === top || point.y === bottom
  return unique.sort((a, b) => Number(boundary(b)) - Number(boundary(a)) || compare(rank(`${a.x}/${a.y}`), rank(`${b.x}/${b.y}`)))
}

/** Adds ordinary editable props once. Missing palette roles or a failed finite
 * placement are reported as suggestions left unfilled, never persistent duties. */
export interface InteriorFurnitureSlot { requirementId: string; role: InteriorFurnitureRole; index: number }
export interface InteriorFurnishingOptions {
  profile: TaskBudgetProfile; checkCancelled: () => void
  /** Local regeneration may retain live slots or suppress protected/tombstoned slots. */
  propIdForSlot?: (slot: InteriorFurnitureSlot) => string | null
  existingPropForSlot?: (slot: InteriorFurnitureSlot) => string | null
  rankSalt?: string
}
export function furnishInterior(document: SceneDocument, input: InteriorGenerationInput, layout: InteriorLayout, connectivity: InteriorConnectivityReport,
  options: InteriorFurnishingOptions): { document: SceneDocument; report: InteriorFurnishingReport } {
  options.checkCancelled()
  if (!validateSceneDocument(document).ok) throw new InteriorGenerationError('invalid-input', '家具建议需要严格合法的实际室内场景。')
  const report: InteriorFurnishingReport = { propIds: [], rooms: [], notes: [], testedPlacements: 0 }
  let next = cloneJson(document)
  if (!input.parameters.arrangement.furniture) return { document: next, report }
  const meter = captureExecutionBudget(options.profile), p = input.parameters, inset = Math.ceil(p.wallThicknessMm / 2) + 100
  const palette = [...p.arrangement.palette].sort((a, b) => compare(a.role, b.role) || compare(a.ref.id, b.ref.id) || a.ref.version - b.ref.version)
  const reservations = interiorDoorReservations(next, connectivity, p.arrangement.clearWidthMm)
  const solids = wallMovementPolygons(next, true).filter(row => row.floorId === p.floorId).map(row => row.polygon)
  const floorPolygon = rectangle(next.floors[p.floorId].boundsMm)
  const context = { ids: { nextId: () => { throw new Error('家具建议必须提供稳定ID。') } }, clock: { now: () => document.updatedAt } }
  for (const row of [...layout.rooms].sort((a, b) => compare(a.requirementId, b.requirementId))) {
    options.checkCancelled()
    const requirement = p.rooms.find(room => room.id === row.requirementId), room = next.rooms[row.roomId]
    if (!requirement || !room) throw new InteriorGenerationError('invalid-input', '家具建议缺少真实房间或需求。')
    const roomReport: InteriorFurnishingRoom = { requirementId: row.requirementId, roomId: row.roomId, recommended: recommendInteriorFurniture(requirement.purpose, row.clearAreaMm2), placed: [], notes: [] }
    report.rooms.push(roomReport)
    for (const [index, role] of roomReport.recommended.entries()) {
      options.checkCancelled()
      if (report.propIds.length >= 64) { roomReport.notes.push('已达到本次64件家具建议上限，其余建议保留为空。'); break }
      const slot = { requirementId: row.requirementId, role, index }, existingId = options.existingPropForSlot?.(slot) ?? null
      const propId = options.propIdForSlot ? options.propIdForSlot(slot) : interiorEntityId(document.sceneId, input.seed, `furniture:${row.requirementId}:${role}:${index}`)
      if (propId === null) { roomReport.notes.push(`${roleName[role]}槽位已人工保留、锁定或删除，本次不改写。`); continue }
      const existing = existingId ? next.props[existingId] : undefined
      if (existingId && (!existing || existingId !== propId)) throw new InteriorGenerationError('invalid-input', '局部家具槽位引用缺少对应存活物件。')
      const available = palette.filter(item => item.role === role && (!existing || item.ref.id === existing.definitionRef?.id && item.ref.version === existing.definitionRef.version))
      if (!available.length) { roomReport.notes.push(`未提供${roleName[role]}的固定素材，本次保留空位。`); continue }
      let placed = false, invalid = false
      for (const item of available) {
        const definition = next.propDefinitions[item.ref.id]
        if (!definition || definition.version !== item.ref.version) { invalid = true; continue }
        const rank = (key: string) => interiorEntityId(document.sceneId, input.seed, options.rankSalt === undefined ? `position:${row.requirementId}:${role}:${index}:${key}` : `position:${row.requirementId}:${role}:${index}:${options.rankSalt}:${key}`)
        for (const positionMm of placementPositions(row.boundsMm, definition, inset, rank)) {
          options.checkCancelled(); report.testedPlacements++; meter.charge({ gridNodes: 1, fieldEvaluations: 1 })
          const prop = existing ? { ...cloneJson(existing), positionMm } : createBasePlacedProp(next, definition.id, positionMm, context, { id: propId, rotationDeg: 0, supportRef: { kind: 'room', id: row.roomId } })
          const physical = propFootprint(prop), visual = rectangle({ x: positionMm.x + prop.visualBoundsMm.x, y: positionMm.y + prop.visualBoundsMm.y, width: prop.visualBoundsMm.width, height: prop.visualBoundsMm.height })
          if (!supportedPolygon(next, physical, prop.supportRef, p.floorId) || !polygonInside(visual, floorPolygon) || !polygonInside(physical, roomPoints(next, room))) continue
          const other = Object.values(next.props).filter(value => value.floorId === p.floorId && value.id !== existingId).map(propFootprint)
          const blockers = [...solids, ...reservations, ...other]
          let blocked = false
          for (const polygon of blockers) {
            meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
            if (polygonsOverlap(physical, polygon) || polygonDistance(physical, polygon) < 100) { blocked = true; break }
          }
          if (blocked) continue
          // Native creation performs complete support/lock/definition validation.
          // Its failures are data/budget failures and must not be swallowed.
          const candidate = applyCommands(next, existingId ? [{ type: 'updateProp', id: existingId, changes: { positionMm } }] : [{ type: 'addProp', id: propId, floorId: p.floorId, layerId: p.layerId, definitionRef: cloneJson(item.ref), positionMm,
            rotationDeg: 0, supportRef: { kind: 'room', id: row.roomId } }], context, { budget: options.profile })
          meter.charge({ fieldEvaluations: connectivity.routes.reduce((sum, route) => sum + route.pointsMm.length, 0) })
          options.checkCancelled()
          const checked = checkInteriorCirculation(candidate, input, layout, connectivity)
          options.checkCancelled()
          if (!checked.routes.every((route, at) => connectivity.routes[at]?.status !== 'clear' || route.status === 'clear')) continue
          next = candidate; report.propIds.push(propId); roomReport.placed.push({ propId, role, definitionRef: cloneJson(item.ref) }); placed = true; break
        }
        if (placed) break
      }
      if (!placed) roomReport.notes.push(invalid ? `${roleName[role]}的固定素材引用失效，未添加该建议。` : `${roleName[role]}在有限摆位中未找到同时满足支撑、门前带和通路净空的位置。`)
    }
    roomReport.notes = [...new Set(roomReport.notes)]
    report.notes.push(...roomReport.notes.map(note => `${requirement.purpose}：${note}`))
  }
  return { document: next, report }
}
