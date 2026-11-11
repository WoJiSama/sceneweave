import type { PointMm, Prop, PropDefinition, SceneDocument, VersionRef } from '../../../model/scene.js'
import { applyCommands } from '../../../commands/commands.js'
import { createBasePlacedProp } from '../../../commands/base.js'
import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { polygonDistance, polygonInside, polygonsOverlap, propFootprint, roomPoints, supportedPolygon } from '../../../geometry/geometry.js'
import { wallMovementPolygons } from '../../../geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { cloneJson } from '../../../validation/json.js'
import type { InteriorFurnitureRole, InteriorGenerationInput, InteriorLayout, InteriorRectangle } from './contracts.js'
import { InteriorGenerationError, interiorEntityId } from './layout.js'
import { hashGenerationValue } from '../../contracts.js'
import { checkInteriorCirculation, interiorDoorReservations, type InteriorConnectivityReport } from './connectivity.js'
import { furnitureBoundsPolygon, furniturePoseCandidates, type FurnitureAnchor } from './furnishing-poses.js'

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

/** Rank only explicitly supplied fixed definitions. Purpose changes a finite
 * suggestion preference, never the definition's dimensions or physical role. */
function purposePreference(purpose: string, role: InteriorFurnitureRole, definition: PropDefinition | undefined): number {
  if (!definition) return 1
  const text = purpose.toLowerCase(), metadata = [definition.name, ...definition.tags].join(' ').toLowerCase()
  const kitchen = /厨房|烹饪|kitchen/.test(text), study = /书房|办公|研究|study|office|library/.test(text)
  if (role === 'work' && kitchen) return /厨房|备餐|烹饪|kitchen|prep|counter/.test(metadata) ? 0 : 1
  if (role === 'work' && study) return /书桌|书房|办公|写作|desk|study|office|writing/.test(metadata) ? 0 : 1
  if (role === 'table' && /餐厅|餐室|酒馆|dining|tavern/.test(text)) return /餐桌|餐厅|长桌|dining|long/.test(metadata) ? 0 : 1
  return 0
}

/** First-generation suggestions only. Neither the purpose vocabulary nor these
 * area thresholds become constraints on later manual edits. */
export function recommendInteriorFurniture(purpose: string, clearAreaMm2: number, algorithmVersion: InteriorGenerationInput['algorithmVersion'] = 2): InteriorFurnitureRole[] {
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
  if (algorithmVersion !== 4) return result.slice(0, 6)
  // Retain the original recommendation prefix, then extend larger rooms by
  // functional units. Full and local generation share these exact indices.
  // These are finite initial suggestions, never density or occupancy duties.
  if (/卧室|客房|寝室|宿舍|bedroom|guest|dorm/.test(text)) {
    add(40, 'storage'); add(60, 'bed', 'storage'); add(85, 'bed', 'storage')
  } else if (/书房|办公|研究|study|office|library/.test(text)) {
    add(24, 'work', 'seat'); add(45, 'work', 'seat', 'storage'); add(70, 'work', 'seat', 'shelf'); add(95, 'work', 'seat')
  } else if (/厨房|烹饪|kitchen/.test(text)) {
    add(20, 'shelf'); add(35, 'work', 'storage'); add(55, 'work', 'shelf'); add(80, 'work', 'storage')
  } else if (/储藏|库房|仓库|storage|store|pantry/.test(text)) {
    add(16, 'shelf'); add(28, 'shelf'); add(40, 'shelf', 'storage'); add(55, 'shelf', 'storage'); add(75, 'shelf', 'storage')
  } else {
    // The legacy second table gains its own seats; additional dining groups
    // scale with usable room area rather than scattering solitary furniture.
    add(28, 'table', 'seat', 'seat'); add(48, 'seat', 'seat'); add(70, 'table', 'seat', 'seat'); add(95, 'storage')
  }
  return result.slice(0, 16)
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
    const roomReport: InteriorFurnishingRoom = { requirementId: row.requirementId, roomId: row.roomId, recommended: recommendInteriorFurniture(requirement.purpose, row.clearAreaMm2, input.algorithmVersion), placed: [], notes: [] }
    report.rooms.push(roomReport)
    const slots = roomReport.recommended.map((role, index) => ({ role, index }))
    // Resolve every work/table anchor before its seats. Keep the original slot
    // indices for identities and local protection, rather than re-indexing the
    // recipe when a later table is brought forward for placement.
    if (input.algorithmVersion === 4) {
      const order = (role: InteriorFurnitureRole) => role === 'work' || role === 'table' || role === 'bed' || role === 'hearth' ? 0 : role === 'seat' ? 1 : 2
      slots.sort((a, b) => order(a.role) - order(b.role) || a.index - b.index)
    }
    for (const { index, role } of slots) {
      options.checkCancelled()
      if (report.propIds.length >= 64) { roomReport.notes.push('已达到本次64件家具建议上限，其余建议保留为空。'); break }
      const slot = { requirementId: row.requirementId, role, index }, existingId = options.existingPropForSlot?.(slot) ?? null
      const propId = options.propIdForSlot ? options.propIdForSlot(slot) : interiorEntityId(document.sceneId, input.seed, `furniture:${row.requirementId}:${role}:${index}`)
      if (propId === null) { roomReport.notes.push(`${roleName[role]}槽位已人工保留、锁定或删除，本次不改写。`); continue }
      const existing = existingId ? next.props[existingId] : undefined
      if (existingId && (!existing || existingId !== propId)) throw new InteriorGenerationError('invalid-input', '局部家具槽位引用缺少对应存活物件。')
      const available = palette.filter(item => item.role === role && (!existing || item.ref.id === existing.definitionRef?.id && item.ref.version === existing.definitionRef.version))
      if (input.algorithmVersion === 4) available.sort((a, b) => purposePreference(requirement.purpose, role, next.propDefinitions[a.ref.id])
        - purposePreference(requirement.purpose, role, next.propDefinitions[b.ref.id])
        || compare(hashGenerationValue(['interior-furniture', input.seed, row.requirementId, role, index, a.ref]),
          hashGenerationValue(['interior-furniture', input.seed, row.requirementId, role, index, b.ref])))
      if (!available.length) { roomReport.notes.push(`未提供${roleName[role]}的固定素材，本次保留空位。`); continue }
      let placed = false, invalid = false
      for (const item of available) {
        const definition = next.propDefinitions[item.ref.id]
        if (!definition || definition.version !== item.ref.version) { invalid = true; continue }
        const rank = (key: string) => {
          const positionKey = options.rankSalt === undefined ? `position:${row.requirementId}:${role}:${index}:${key}` : `position:${row.requirementId}:${role}:${index}:${options.rankSalt}:${key}`
          // Entity identity stays scene-scoped; layout choice belongs to the
          // semantic seed. Legacy recipes retain their exact original ranking.
          return input.algorithmVersion === 2 ? interiorEntityId(document.sceneId, input.seed, positionKey) : hashGenerationValue(['interior-position', input.seed, positionKey])
        }
        const composed = input.algorithmVersion === 4
        const anchors: (FurnitureAnchor & Prop)[] = composed ? Object.values(next.props).filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === row.roomId && prop.id !== existingId)
          .flatMap(prop => {
            const roles = palette.filter(entry => (entry.role === 'work' || entry.role === 'table') && entry.ref.id === prop.definitionRef?.id && entry.ref.version === prop.definitionRef.version)
            return roles.length ? [{ ...prop, role: roles[0].role as 'work' | 'table', seatingLoad: 0 }] : []
          }) : []
        if (composed && role === 'seat') {
          // Give an unserved surface a first seat before adding more around an
          // occupied one. This transient preference reads real current seats,
          // including protected/manual ones; it creates no persistent duty.
          anchors.sort((a, b) => a.positionMm.y - b.positionMm.y || a.positionMm.x - b.positionMm.x || a.rotationDeg - b.rotationDeg)
          const seats = Object.values(next.props).filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === row.roomId && prop.id !== existingId
            && palette.some(entry => entry.role === 'seat' && entry.ref.id === prop.definitionRef?.id && entry.ref.version === prop.definitionRef.version))
          for (const seat of seats) {
            const footprint = propFootprint(seat)
            const nearest = anchors.map(anchor => {
              meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
              return { anchor, distance: polygonDistance(footprint, propFootprint(anchor)) }
            }).sort((a, b) => a.distance - b.distance)[0]
            if (nearest && nearest.distance <= 900) nearest.anchor.seatingLoad!++
          }
        }
        const poses = composed ? furniturePoseCandidates(row.boundsMm, existing ?? { visualBoundsMm: definition.defaultVisualBoundsMm,
          footprintMm: definition.defaultFootprintMm, footprintOffsetMm: definition.defaultFootprintOffsetMm }, inset, role, anchors, rank, existing?.rotationDeg,
          roomReport.recommended.filter(role => role === 'seat').length > 1)
          : placementPositions(row.boundsMm, definition, inset, rank).map(positionMm => ({ positionMm, rotationDeg: existing?.rotationDeg ?? 0 }))
        for (const { positionMm, rotationDeg } of poses) {
          options.checkCancelled(); report.testedPlacements++; meter.charge({ gridNodes: 1, fieldEvaluations: 1 })
          const prop = existing ? { ...cloneJson(existing), positionMm } : createBasePlacedProp(next, definition.id, positionMm, context, { id: propId, rotationDeg, supportRef: { kind: 'room', id: row.roomId } })
          const physical = propFootprint(prop), visual = composed ? furnitureBoundsPolygon(prop.visualBoundsMm, prop)
            : rectangle({ x: positionMm.x + prop.visualBoundsMm.x, y: positionMm.y + prop.visualBoundsMm.y, width: prop.visualBoundsMm.width, height: prop.visualBoundsMm.height })
          if (!supportedPolygon(next, physical, prop.supportRef, p.floorId) || !polygonInside(visual, floorPolygon) || !polygonInside(physical, roomPoints(next, room))) continue
          if (composed && !polygonInside(visual, roomPoints(next, room))) continue
          const other = Object.values(next.props).filter(value => value.floorId === p.floorId && value.id !== existingId).map(propFootprint)
          const blockers = [...solids, ...reservations, ...other]
          let blocked = false
          for (const polygon of blockers) {
            meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
            if (polygonsOverlap(physical, polygon) || polygonDistance(physical, polygon) < 100) { blocked = true; break }
          }
          if (blocked) continue
          if (composed) {
            const paintedBlockers = [...solids, ...reservations, ...Object.values(next.props).filter(value => value.floorId === p.floorId
              && value.id !== existingId && value.blocksMovement && value.renderLayer !== 'ground').map(value => furnitureBoundsPolygon(value.visualBoundsMm, value))]
            for (const polygon of paintedBlockers) {
              meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
              if (polygonsOverlap(visual, polygon)) { blocked = true; break }
            }
            if (blocked) continue
          }
          // Native creation performs complete support/lock/definition validation.
          // Its failures are data/budget failures and must not be swallowed.
          const candidate = applyCommands(next, existingId ? [{ type: 'updateProp', id: existingId, changes: { positionMm } }] : [{ type: 'addProp', id: propId, floorId: p.floorId, layerId: p.layerId, definitionRef: cloneJson(item.ref), positionMm,
            rotationDeg, supportRef: { kind: 'room', id: row.roomId } }], context, { budget: options.profile })
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
