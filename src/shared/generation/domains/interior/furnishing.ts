import type { PointMm, Prop, PropDefinition, SceneDocument, VersionRef } from '../../../model/scene.js'
import { applyCommands } from '../../../commands/commands.js'
import { createBasePlacedProp } from '../../../commands/base.js'
import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { pathPolygon, polygonDistance, polygonInside, polygonsOverlap, propFootprint, roomPoints, supportedPolygon } from '../../../geometry/geometry.js'
import { wallMovementPolygons } from '../../../geometry/doorway-clearance.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { cloneJson } from '../../../validation/json.js'
import type { InteriorFurnitureRole, InteriorGenerationInput, InteriorLayout, InteriorRectangle } from './contracts.js'
import { InteriorGenerationError, interiorEntityId } from './layout.js'
import { hashGenerationValue } from '../../contracts.js'
import { checkInteriorCirculation, replanInteriorCirculation, interiorDoorReservations, type InteriorConnectivityReport } from './connectivity.js'
import { furnitureBoundsPolygon, furniturePoseCandidates, type FurnitureAnchor } from './furnishing-poses.js'
import { furnitureUseSpacePolygon, furnitureWorkingSpacePolygon, planFurnitureSeats, type FurnitureSeatReservation } from './furnishing-use-space.js'
import { isKitchenPurpose, kitchenFurnitureGroupCandidates, kitchenCornerCandidates, kitchenOpposingCandidates } from './furnishing-groups.js'
import { bedroomStorageCandidates, isBedroomPurpose, planBedroomAccess, type BedroomAccess } from './furnishing-bedroom.js'
import { findFurnitureAccess, furnitureApproachPoint, roomDoorPorts, type FurnitureAccessRoute, type InteriorFurnitureAccess } from './furnishing-circulation.js'
import { bedroomGroupPoseCandidates } from './furnishing-bedroom-group.js'
import { mayAffectInteriorRoom } from './furnishing-spatial.js'
import { diningGroupCandidates, isDiningPurpose, isSeatedGroupPurpose, preferDiningOrientation, singleSidedSeatRotation } from './furnishing-composition.js'
import { kitchenParallelRunCandidates, kitchenWallRowCandidates } from './furnishing-kitchen-rows.js'

export interface InteriorFurnishingRoom {
  requirementId: string
  roomId: string
  recommended: InteriorFurnitureRole[]
  placed: { propId: string; role: InteriorFurnitureRole; definitionRef: VersionRef }[]
  notes: string[]
  circulation?: InteriorFurnitureAccess[]
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
  if (algorithmVersion < 4) return result.slice(0, 6)
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
  options: InteriorFurnishingOptions): { document: SceneDocument; report: InteriorFurnishingReport; connectivity?: InteriorConnectivityReport } {
  options.checkCancelled()
  if (!validateSceneDocument(document).ok) throw new InteriorGenerationError('invalid-input', '家具建议需要严格合法的实际室内场景。')
  const report: InteriorFurnishingReport = { propIds: [], rooms: [], notes: [], testedPlacements: 0 }
  let next = cloneJson(document), currentConnectivity = connectivity
  if (!input.parameters.arrangement.furniture) return { document: next, report, ...(input.algorithmVersion >= 17 ? { connectivity: currentConnectivity } : {}) }
  const meter = captureExecutionBudget(options.profile), p = input.parameters, inset = Math.ceil(p.wallThicknessMm / 2) + 100
  const palette = [...p.arrangement.palette].sort((a, b) => compare(a.role, b.role) || compare(a.ref.id, b.ref.id) || a.ref.version - b.ref.version)
  const floorReservations = interiorDoorReservations(next, connectivity, p.arrangement.clearWidthMm)
  const floorSolids = wallMovementPolygons(next, true).filter(row => row.floorId === p.floorId).map(row => row.polygon)
  const floorPolygon = rectangle(next.floors[p.floorId].boundsMm)
  const context = { ids: { nextId: () => { throw new Error('家具建议必须提供稳定ID。') } }, clock: { now: () => document.updatedAt } }
  for (const row of [...layout.rooms].sort((a, b) => compare(a.requirementId, b.requirementId))) {
    options.checkCancelled()
    const requirement = p.rooms.find(room => room.id === row.requirementId), room = next.rooms[row.roomId]
    if (!requirement || !room) throw new InteriorGenerationError('invalid-input', '家具建议缺少真实房间或需求。')
    const relevant = (polygon: PointMm[]) => {
      meter.charge({ fieldEvaluations: 1 }); options.checkCancelled()
      return mayAffectInteriorRoom(polygon, row.boundsMm)
    }
    const solids = input.algorithmVersion >= 10 ? floorSolids.filter(relevant) : floorSolids
    const reservations = input.algorithmVersion >= 10 ? floorReservations.filter(relevant) : floorReservations
    // Only this room is edited during its pass. Capture the conservative halo
    // of external bodies AND painted envelopes once; new or moved room members
    // always participate. Full native support, lock and route checks still read
    // the complete current document, including distant resources and obstacles.
    const nearExternal = new Set(input.algorithmVersion >= 10 ? Object.values(next.props).filter(prop => prop.floorId === p.floorId)
      .filter(prop => relevant(propFootprint(prop)) || prop.renderLayer !== 'ground' && relevant(furnitureBoundsPolygon(prop.visualBoundsMm, prop))).map(prop => prop.id) : [])
    const spatialProps = (document = next) => input.algorithmVersion >= 10 ? Object.values(document.props).filter(prop => nearExternal.has(prop.id)
      || prop.supportRef.kind === 'room' && prop.supportRef.id === row.roomId) : Object.values(document.props)
    const roomReport: InteriorFurnishingRoom = { requirementId: row.requirementId, roomId: row.roomId, recommended: recommendInteriorFurniture(requirement.purpose, row.clearAreaMm2, input.algorithmVersion), placed: [], notes: [] }
    report.rooms.push(roomReport)
    const slots = roomReport.recommended.map((role, index) => ({ role, index }))
    // Resolve every work/table anchor before its seats. Keep the original slot
    // indices for identities and local protection, rather than re-indexing the
    // recipe when a later table is brought forward for placement.
    if (input.algorithmVersion >= 4) {
      const order = (role: InteriorFurnitureRole) => role === 'work' || role === 'table' || role === 'bed' || role === 'hearth' ? 0 : role === 'seat' ? 1 : 2
      // Complete bed/storage units before adding another bed or an optional
      // table. Kitchens follow the functional recommendation sequence so later
      // counters cannot consume every cupboard/working-group continuation.
      // Stable slot indices, including protected and deleted ones, never change.
      const unitOrder = (role: InteriorFurnitureRole) => role === 'bed' || role === 'storage' ? 0 : order(role) + 1
      const primaryBed = slots.find(slot => slot.role === 'bed')?.index, primaryStorage = slots.find(slot => slot.role === 'storage')?.index
      const bedroomOrder = (slot: typeof slots[number]) => slot.index === primaryBed || slot.index === primaryStorage ? 0
        : slot.role === 'table' || slot.role === 'work' ? 1 : slot.role === 'seat' ? 2 : 3
      // Keep the first work/storage/hearth unit, then fit full worktops before
      // small cupboards and long optional shelves consume the remaining runs.
      // Slot IDs and recommendations are unchanged, including local exclusions.
      const kitchenOrder = (slot: typeof slots[number]) => slot.index <= 2 ? slot.index
        : slot.role === 'work' || slot.role === 'hearth' ? 3 : slot.role === 'storage' ? 4 : 5
      const kitchenFunctionOrder = (slot: typeof slots[number]) => slot.role === 'hearth' ? 0 : slot.role === 'work' ? 1 : slot.role === 'storage' ? 2 : 3
      slots.sort((a, b) => input.algorithmVersion >= 11 && isBedroomPurpose(requirement.purpose) ? bedroomOrder(a) - bedroomOrder(b) || a.index - b.index
        : input.algorithmVersion >= 18 && isKitchenPurpose(requirement.purpose) ? kitchenFunctionOrder(a) - kitchenFunctionOrder(b) || a.index - b.index
        : input.algorithmVersion >= 15 && isKitchenPurpose(requirement.purpose) ? kitchenOrder(a) - kitchenOrder(b) || a.index - b.index
        : input.algorithmVersion >= 9 && isKitchenPurpose(requirement.purpose) ? a.index - b.index
        : input.algorithmVersion >= 9 && isBedroomPurpose(requirement.purpose) ? unitOrder(a.role) - unitOrder(b.role) || a.index - b.index
          : order(a.role) - order(b.role) || a.index - b.index)
    }
    const useSpaces: FurnitureSeatReservation[] = [], reserveUseSpace = input.algorithmVersion >= 5
    const functionalGroups = input.algorithmVersion >= 6, kitchen = functionalGroups && isKitchenPurpose(requirement.purpose)
    const bedroom = input.algorithmVersion >= 7 && isBedroomPurpose(requirement.purpose)
    const connectedUse = input.algorithmVersion >= 8
    const completeDining = input.algorithmVersion >= 18 && isDiningPurpose(requirement.purpose)
    const completeSeatedRoom = input.algorithmVersion >= 19 && isSeatedGroupPurpose(requirement.purpose)
    const bedAccess = new Map<string, BedroomAccess>()
    const accessRoutes = new Map<string, FurnitureAccessRoute>()
    const seatCount = slots.filter(slot => slot.role === 'seat').length
    const anchorCount = slots.filter(slot => slot.role === 'table' || slot.role === 'work').length
    const seatsPerAnchor = Math.min(4, Math.ceil(seatCount / Math.max(1, anchorCount)))
    const seatDefinitions = palette.filter(item => item.role === 'seat').flatMap(item => {
      const definition = next.propDefinitions[item.ref.id]
      return definition?.version === item.ref.version ? [definition] : []
    })
    const routeBands = reserveUseSpace ? currentConnectivity.routes.filter(route => route.status === 'clear').map(route => pathPolygon({
      id: 'furnishing-route-reservation', floorId: p.floorId, editLocked: false, visibility: 'public', centerlineMm: route.pointsMm, widthMm: route.widthMm,
      supportRefs: [{ kind: 'floor', id: p.floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 })) : []
    const roleProps = (wanted: InteriorFurnitureRole) => spatialProps().filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === row.roomId
      && palette.some(item => item.role === wanted && item.ref.id === prop.definitionRef?.id && item.ref.version === prop.definitionRef.version))
    const ports = connectedUse ? roomDoorPorts(next, row.roomId, 600, options.checkCancelled,
      pairs => meter.charge({ fieldEvaluations: pairs })) : []
    const findAccess = (targetMm: PointMm, document = next, extra: PointMm[][] = [], retainedRoute?: FurnitureAccessRoute) => findFurnitureAccess({
      roomPolygon: roomPoints(document, room), targetMm, ports,
      retainedRoute, graphMode: input.algorithmVersion >= 13 ? 'bounded-lazy' : undefined,
      blockers: [...solids, ...extra, ...spatialProps(document).filter(prop => prop.floorId === p.floorId && prop.blocksMovement)
        .flatMap(prop => [propFootprint(prop), ...(prop.renderLayer === 'ground' ? [] : [furnitureBoundsPolygon(prop.visualBoundsMm, prop)])]),
        ...Object.values(document.regions).filter(region => region.floorId === p.floorId && region.blocksMovement).map(region => region.boundaryMm)],
      checkCancelled: options.checkCancelled,
      chargeNode: () => { report.testedPlacements++; meter.charge({ gridNodes: 1, fieldEvaluations: 1 }) },
      chargePair: () => meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 }),
      checkNative: (pointsMm, widthMm) => {
        meter.charge({ fieldEvaluations: Object.keys(document.walls).length + Object.keys(document.props).length + Object.keys(document.terrainAreas).length + pointsMm.length })
        options.checkCancelled()
        return checkTerrainRoute(document, { floorId: p.floorId, pointsMm, widthMm }).ok
      },
    })
    const planBed = (prop: Prop, rank: (key: string) => string) => planBedroomAccess({ shape: prop, pose: prop, roomPolygon: roomPoints(next, room),
      centerMm: { x: Math.round(row.boundsMm.x + row.boundsMm.width / 2), y: Math.round(row.boundsMm.y + row.boundsMm.height / 2) },
      blockers: [...solids, ...(connectedUse ? [] : reservations), propFootprint(prop), furnitureBoundsPolygon(prop.visualBoundsMm, prop),
        ...spatialProps().filter(value => value.floorId === p.floorId && value.id !== prop.id && value.blocksMovement)
          .flatMap(value => [propFootprint(value), ...(value.renderLayer === 'ground' ? [] : [furnitureBoundsPolygon(value.visualBoundsMm, value)])]),
        ...Object.values(next.regions).filter(value => value.floorId === p.floorId && value.blocksMovement).map(value => value.boundaryMm)], rank,
      ...(connectedUse && ports.length ? { routeTo: (entry: PointMm) => {
        // The proposed bed is a real obstacle even before its native command.
        const document = { ...next, props: { ...next.props, [prop.id]: prop } }
        return findAccess(entry, document)
      } } : {}),
      checkCancelled: options.checkCancelled, chargeCandidate: () => { report.testedPlacements++; meter.charge({ gridNodes: 1, fieldEvaluations: 1 }) },
      chargePair: () => meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 }) })
    // Protected beds remain read-only anchors. Preserve any currently usable
    // bedside route without treating an already inaccessible manual draft as
    // invalid or moving the bed to repair it.
    if (bedroom) for (const bed of roleProps('bed')) {
      const access = planBed(bed, key => hashGenerationValue(['bed-access', input.seed, row.requirementId, key]))
      if (access) bedAccess.set(bed.id, access)
      else roomReport.notes.push(connectedUse && ports.length ? '保留床当前未找到完整床侧使用带及到真实门口的有限通路，本次不强制改动。'
        : '保留床当前未找到完整床侧使用带及到房间中心的有限通路，本次不强制改动。')
    }
    if (connectedUse) for (const prop of spatialProps().filter(value => value.supportRef.kind === 'room' && value.supportRef.id === row.roomId)) {
      const role = palette.find(item => item.ref.id === prop.definitionRef?.id && item.ref.version === prop.definitionRef.version)?.role
      if (!role || role === 'table' || role === 'work' && seatCount > 0) continue
      const access = role === 'bed' ? bedAccess.get(prop.id) : undefined
      const target = access?.pointsMm.at(-1) ?? (role !== 'bed' ? furnitureApproachPoint(prop, prop, role === 'seat') : undefined)
      const route = target ? findAccess(target) : undefined
      if (route) accessRoutes.set(prop.id, route)
      if (role !== 'bed') useSpaces.push({ anchorKey: prop.id, positionMm: prop.positionMm, rotationDeg: prop.rotationDeg,
        definitionRef: cloneJson(prop.definitionRef!), usePolygon: role === 'seat' ? furnitureUseSpacePolygon(prop, prop) : furnitureWorkingSpacePolygon(prop, prop), claimed: true })
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
      if (input.algorithmVersion >= 4) available.sort((a, b) => purposePreference(requirement.purpose, role, next.propDefinitions[a.ref.id])
        - purposePreference(requirement.purpose, role, next.propDefinitions[b.ref.id])
        || compare(hashGenerationValue(['interior-furniture', input.seed, row.requirementId, role, index, a.ref]),
          hashGenerationValue(['interior-furniture', input.seed, row.requirementId, role, index, b.ref])))
      if (functionalGroups && role === 'seat') {
        const promisedDefinition = (ref: VersionRef) => useSpaces.some(space => !space.claimed && space.definitionRef.id === ref.id
          && space.definitionRef.version === ref.version && (existing === undefined || existing.rotationDeg === space.rotationDeg))
        available.sort((a, b) => Number(promisedDefinition(b.ref)) - Number(promisedDefinition(a.ref)))
      }
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
        const composed = input.algorithmVersion >= 4
        const anchors: (FurnitureAnchor & Prop)[] = composed ? spatialProps().filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === row.roomId && prop.id !== existingId)
          .flatMap(prop => {
            const roles = palette.filter(entry => (entry.role === 'work' || entry.role === 'table') && entry.ref.id === prop.definitionRef?.id && entry.ref.version === prop.definitionRef.version)
            return roles.length ? [{ ...prop, role: roles[0].role as 'work' | 'table', seatingLoad: 0 }] : []
          }) : []
        if (composed && role === 'seat') {
          // Give an unserved surface a first seat before adding more around an
          // occupied one. This transient preference reads real current seats,
          // including protected/manual ones; it creates no persistent duty.
          anchors.sort((a, b) => a.positionMm.y - b.positionMm.y || a.positionMm.x - b.positionMm.x || a.rotationDeg - b.rotationDeg)
          const seats = spatialProps().filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === row.roomId && prop.id !== existingId
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
        const shape = existing ?? { visualBoundsMm: definition.defaultVisualBoundsMm,
          footprintMm: definition.defaultFootprintMm, footprintOffsetMm: definition.defaultFootprintOffsetMm }
        const kitchenAnchors = kitchen ? spatialProps().filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === row.roomId && prop.id !== existingId)
          .flatMap(prop => {
            const entry = palette.find(item => ['work', 'hearth', 'storage', 'shelf'].includes(item.role)
              && item.ref.id === prop.definitionRef?.id && item.ref.version === prop.definitionRef.version)
            return entry ? [{ ...prop, role: entry.role }] : []
          }) : []
        const rowOptions = { bounds: row.boundsMm, shape, inset, role, anchors: kitchenAnchors, rank, retainedRotation: existing?.rotationDeg,
          checkCancelled: options.checkCancelled, charge: () => meter.charge({ fieldEvaluations: 1 }) }
        const kitchenShapes = input.algorithmVersion >= 15 && kitchen ? palette.filter(entry => ['work', 'hearth', 'storage', 'shelf'].includes(entry.role)).flatMap(entry => {
          const fixed = next.propDefinitions[entry.ref.id]
          return fixed?.version === entry.ref.version ? [{ visualBoundsMm: fixed.defaultVisualBoundsMm,
            footprintMm: fixed.defaultFootprintMm, footprintOffsetMm: fixed.defaultFootprintOffsetMm }] : []
        }) : []
        const groupPoses = kitchen ? [...kitchenFurnitureGroupCandidates(row.boundsMm, shape, inset, role, kitchenAnchors, rank, existing?.rotationDeg),
          ...(input.algorithmVersion >= 15 ? kitchenParallelRunCandidates({ ...rowOptions, shapes: kitchenShapes }) : []),
          ...(input.algorithmVersion >= 15 ? kitchenWallRowCandidates(rowOptions) : []),
          ...(input.algorithmVersion >= 12 ? kitchenOpposingCandidates(row.boundsMm, shape, inset, role, kitchenAnchors, rank, existing?.rotationDeg) : []),
          ...(input.algorithmVersion >= 11 ? kitchenCornerCandidates(row.boundsMm, shape, inset, role, kitchenAnchors, rank, existing?.rotationDeg) : [])] : []
        const beds = bedroom && role === 'storage' ? roleProps('bed').map(bed => ({ ...bed, storageLoad: 0 })) : []
        for (const storage of beds.length ? roleProps('storage').filter(prop => prop.id !== existingId) : []) {
          const nearest = beds.map(bed => ({ bed, distance: polygonDistance(propFootprint(storage), propFootprint(bed)) }))
            .sort((a, b) => a.distance - b.distance || a.bed.positionMm.y - b.bed.positionMm.y || a.bed.positionMm.x - b.bed.positionMm.x)[0]
          if (nearest && nearest.distance <= 900) nearest.bed.storageLoad++
        }
        const bedsidePoses = beds.length ? bedroomStorageCandidates(row.boundsMm, shape, inset, beds, rank, existing?.rotationDeg) : []
        const poses = composed ? furniturePoseCandidates(row.boundsMm, shape, inset, role, anchors, rank, existing?.rotationDeg,
          roomReport.recommended.filter(role => role === 'seat').length > 1, completeDining)
          : placementPositions(row.boundsMm, definition, inset, rank).map(positionMm => ({ positionMm, rotationDeg: existing?.rotationDeg ?? 0 }))
        const seatedGroup = completeSeatedRoom && (role === 'table' || role === 'work')
        const seatedAnchors = seatedGroup ? anchors.map(anchor => ({ ...anchor, role: 'table' as const })) : anchors
        const seatedPoses = seatedGroup ? diningGroupCandidates({ bounds: row.boundsMm, inset, shape, seats: seatDefinitions,
          anchors: seatedAnchors, tableCount: anchorCount, rank, retainedRotation: existing?.rotationDeg,
          alignToBounds: true, singleSided: role === 'work', checkCancelled: options.checkCancelled,
          charge: () => meter.charge({ fieldEvaluations: 1 }) }) : []
        const poseKey = (pose: { positionMm: PointMm; rotationDeg: number }) => `${pose.positionMm.x}/${pose.positionMm.y}/${pose.rotationDeg}`
        const seatedPoseKeys = new Set(seatedPoses.map(poseKey))
        const diningPoses = input.algorithmVersion >= 12 && role === 'table' && isDiningPurpose(requirement.purpose)
          ? diningGroupCandidates({ bounds: row.boundsMm, inset, shape, seats: seatDefinitions, anchors, tableCount: anchorCount, rank,
            retainedRotation: existing?.rotationDeg, alignToBounds: completeDining, checkCancelled: options.checkCancelled,
            charge: () => meter.charge({ fieldEvaluations: 1 }) }) : []
        if (input.algorithmVersion >= 12 && role === 'table' && isDiningPurpose(requirement.purpose)) {
          const orientation = anchors.filter(a => a.role === 'table' && Number.isInteger(a.rotationDeg / 90))
            .sort((a, b) => a.positionMm.y - b.positionMm.y || a.positionMm.x - b.positionMm.x)[0]?.rotationDeg
          if (orientation !== undefined) {
            meter.charge({ fieldEvaluations: poses.length })
            const parallel = (pose: typeof poses[number]) => Number(((pose.rotationDeg - orientation) % 180 + 180) % 180 === 0)
            poses.sort((a, b) => parallel(b) - parallel(a))
          }
        }
        if (input.algorithmVersion >= 12 && kitchen && kitchenAnchors.length) {
          const primary = kitchenAnchors.filter(anchor => anchor.role === 'work' || anchor.role === 'hearth')
          const references = primary.length ? primary : kitchenAnchors
          const distances = new Map(poses.map(pose => {
            const polygon = furnitureBoundsPolygon(shape.visualBoundsMm, pose)
            const distance = Math.min(...references.map(anchor => {
              options.checkCancelled(); meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
              return polygonDistance(polygon, furnitureBoundsPolygon(anchor.visualBoundsMm, anchor))
            }))
            return [pose, distance] as const
          }))
          poses.sort((a, b) => distances.get(a)! - distances.get(b)!)
        }
        const promised = reserveUseSpace && role === 'seat' ? useSpaces.filter(space => !space.claimed && space.definitionRef.id === definition.id
          && space.definitionRef.version === definition.version && (existing?.rotationDeg === undefined || existing.rotationDeg === space.rotationDeg)) : []
        // Give each reserved work/table group its first real chair before
        // filling the second place of an already served group.
        promised.sort((a, b) => useSpaces.filter(space => space.claimed && space.anchorKey === a.anchorKey).length
          - useSpaces.filter(space => space.claimed && space.anchorKey === b.anchorKey).length)
        // A tighter new route reservation must not force a live managed member
        // out of an already valid position during local re-layout.
        const groupedBeds = input.algorithmVersion >= 9 && bedroom && role === 'bed' && roomReport.recommended.includes('storage')
          ? bedroomGroupPoseCandidates(row.boundsMm, shape, palette.filter(item => item.role === 'storage').flatMap(item => {
            const source = next.propDefinitions[item.ref.id]
            return source?.version === item.ref.version ? [{ visualBoundsMm: source.defaultVisualBoundsMm,
              footprintMm: source.defaultFootprintMm, footprintOffsetMm: source.defaultFootprintOffsetMm }] : []
          }), inset, rank, existing?.rotationDeg) : []
        const allPoses = [...groupedBeds, ...promised, ...groupPoses, ...bedsidePoses, ...diningPoses, ...seatedPoses, ...poses, ...(connectedUse && existing ? [existing] : [])]
        let orderedPoses = input.algorithmVersion >= 9 ? [...new Map(allPoses.map(pose => [`${pose.positionMm.x}/${pose.positionMm.y}/${pose.rotationDeg}`, pose])).values()] : allPoses
        if (input.algorithmVersion >= 14 && role === 'table' && isDiningPurpose(requirement.purpose) || seatedGroup) {
          orderedPoses = preferDiningOrientation({ poses: orderedPoses, shape, anchors: seatedAnchors, checkCancelled: options.checkCancelled,
            charge: () => meter.charge({ fieldEvaluations: 1 }) })
        }
        // Prefer a complete two-seat dining group across the finite poses.
        // A single-seat group remains an explicit fallback in smaller rooms.
        const seatMinimums = (completeDining || seatedGroup) && role === 'table' && !existing ? [2, 1] : [1]
        const seatPasses = seatMinimums.flatMap(minimumSeats => orderedPoses.map(pose => ({ ...pose, minimumSeats })))
        for (const { positionMm, rotationDeg, minimumSeats } of seatPasses) {
          options.checkCancelled(); report.testedPlacements++; meter.charge({ gridNodes: 1, fieldEvaluations: 1 })
          const prop = existing ? { ...cloneJson(existing), positionMm } : createBasePlacedProp(next, definition.id, positionMm, context, { id: propId, rotationDeg, supportRef: { kind: 'room', id: row.roomId } })
          const physical = propFootprint(prop), visual = composed ? furnitureBoundsPolygon(prop.visualBoundsMm, prop)
            : rectangle({ x: positionMm.x + prop.visualBoundsMm.x, y: positionMm.y + prop.visualBoundsMm.y, width: prop.visualBoundsMm.width, height: prop.visualBoundsMm.height })
          if (!supportedPolygon(next, physical, prop.supportRef, p.floorId) || !polygonInside(visual, floorPolygon) || !polygonInside(physical, roomPoints(next, room))) continue
          if (composed && !polygonInside(visual, roomPoints(next, room))) continue
          const ownUseSpace = reserveUseSpace && role === 'seat' ? promised.find(space => space.positionMm.x === positionMm.x && space.positionMm.y === positionMm.y && space.rotationDeg === rotationDeg) : undefined
          const usePolygon = !reserveUseSpace ? undefined : role === 'seat' ? furnitureUseSpacePolygon(prop, prop)
            : role === 'hearth' || role === 'work' && seatCount === 0 || bedroom && role === 'storage' || connectedUse && (role === 'storage' || role === 'shelf') ? furnitureWorkingSpacePolygon(prop, prop) : undefined
          if (usePolygon && !polygonInside(usePolygon, roomPoints(next, room))) continue
          const other = spatialProps().filter(value => value.floorId === p.floorId && value.id !== existingId).map(propFootprint)
          const blockers = [...solids, ...reservations, ...other]
          let blocked = false
          for (const polygon of blockers) {
            meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
            if (polygonsOverlap(physical, polygon) || polygonDistance(physical, polygon) < 100) { blocked = true; break }
          }
          if (blocked) continue
          if (bedroom) for (const [id, access] of bedAccess) {
            if (id === existingId) continue
            for (const polygon of connectedUse ? [access.usePolygon] : [access.usePolygon, access.routePolygon]) {
              meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
              if (polygonsOverlap(physical, polygon) || polygonsOverlap(visual, polygon)) { blocked = true; break }
            }
            if (blocked) break
          }
          if (blocked) continue
          if (reserveUseSpace) {
            for (const space of useSpaces) {
              if (space === ownUseSpace || connectedUse && space.anchorKey === existingId) continue
              meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
              if (polygonsOverlap(usePolygon ?? physical, space.usePolygon) || polygonsOverlap(visual, space.usePolygon)
                || input.algorithmVersion >= 11 && (polygonDistance(physical, space.usePolygon) < 100 || polygonDistance(visual, space.usePolygon) < 100)) { blocked = true; break }
            }
            if (blocked) continue
            if (usePolygon) for (const polygon of [...blockers, ...spatialProps().filter(value => value.floorId === p.floorId
              && value.id !== existingId && value.blocksMovement && value.renderLayer !== 'ground').map(value => furnitureBoundsPolygon(value.visualBoundsMm, value))]) {
              meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
              if (polygonsOverlap(usePolygon, polygon) || polygonDistance(usePolygon, polygon) < 100) { blocked = true; break }
            }
            if (blocked) continue
          }
          if (composed) {
            const paintedBlockers = [...solids, ...reservations, ...spatialProps().filter(value => value.floorId === p.floorId
              && value.id !== existingId && value.blocksMovement && value.renderLayer !== 'ground').map(value => furnitureBoundsPolygon(value.visualBoundsMm, value))]
            for (const polygon of paintedBlockers) {
              meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
              if (polygonsOverlap(visual, polygon)) { blocked = true; break }
            }
            if (blocked) continue
          }
          const anchorsLeft = slots.slice(slots.findIndex(slot => slot.index === index)).filter(slot => slot.role === 'table' || slot.role === 'work').length
          const seatQuota = functionalGroups ? Math.min(4, Math.ceil(Math.max(0, seatCount - useSpaces.filter(space => !space.claimed).length) / Math.max(1, anchorsLeft))) : seatsPerAnchor
          const needsSeatPlan = reserveUseSpace && !existing && (role === 'table' || role === 'work') && seatQuota > 0 && seatDefinitions.length > 0
          const isSeatedPose = seatedGroup && seatedPoseKeys.has(poseKey(prop))
          const proposedSeatRotation = isSeatedPose && role === 'work' ? singleSidedSeatRotation(shape, prop) : undefined
          const planned = needsSeatPlan
            ? planFurnitureSeats({ anchorKey: propId, anchor: { ...prop, role }, seats: seatDefinitions, count: seatQuota, bounds: row.boundsMm, inset,
              roomPolygon: roomPoints(next, room), blockers: [...blockers, physical, visual, ...useSpaces.map(space => space.usePolygon),
                ...spatialProps().filter(value => value.floorId === p.floorId && value.id !== existingId && value.blocksMovement
                  && value.renderLayer !== 'ground').map(value => furnitureBoundsPolygon(value.visualBoundsMm, value))],
              routeBands: [...(completeDining || isSeatedPose ? [] : routeBands), ...[...bedAccess.values()].flatMap(access => connectedUse ? [access.usePolygon] : [access.usePolygon, access.routePolygon])], rank,
              fitSeatToEdge: completeDining, seatRotationDeg: proposedSeatRotation,
              checkCancelled: options.checkCancelled, chargeCandidate: () => { report.testedPlacements++; meter.charge({ gridNodes: 1, fieldEvaluations: 1 }) },
              chargePair: () => meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 }) }) : []
          if (needsSeatPlan && planned.length < Math.min(minimumSeats, seatQuota)) continue
          const bedsideAccess = bedroom && role === 'bed' ? planBed(prop, rank) : undefined
          if (bedroom && role === 'bed' && !bedsideAccess) continue
          // Native creation performs complete support/lock/definition validation.
          // Its failures are data/budget failures and must not be swallowed.
          const candidate = applyCommands(next, existingId ? [{ type: 'updateProp', id: existingId, changes: { positionMm } }] : [{ type: 'addProp', id: propId, floorId: p.floorId, layerId: p.layerId, definitionRef: cloneJson(item.ref), positionMm,
            rotationDeg, supportRef: { kind: 'room', id: row.roomId } }], context, { budget: options.profile })
          if (bedsideAccess) {
            meter.charge({ fieldEvaluations: Object.keys(candidate.walls).length + Object.keys(candidate.props).length + bedsideAccess.pointsMm.length })
            if (!checkTerrainRoute(candidate, { floorId: p.floorId, pointsMm: bedsideAccess.pointsMm, widthMm: 600 }).ok) continue
          }
          meter.charge({ fieldEvaluations: currentConnectivity.routes.reduce((sum, route) => sum + route.pointsMm.length, 0) })
          options.checkCancelled()
          // Read-only physical preview includes the promised whole seat bodies.
          // A table cannot claim a route that its reserved chairs would block.
          let routeDocument = candidate
          if (completeDining || completeSeatedRoom) {
            routeDocument = { ...candidate, props: { ...candidate.props } }
            for (const [i, space] of [...useSpaces.filter(space => !space.claimed && space !== ownUseSpace), ...planned].entries()) {
              options.checkCancelled(); meter.charge({ fieldEvaluations: 1 })
              let attempt = 0, id: string
              do {
                options.checkCancelled(); meter.charge({ fieldEvaluations: 1 })
                id = interiorEntityId(document.sceneId, input.seed, `reserved-seat:${row.requirementId}:${i}:${attempt++}`)
              }
              while (routeDocument.props[id])
              routeDocument.props[id] = createBasePlacedProp(candidate, space.definitionRef.id, space.positionMm, context,
                { id, rotationDeg: space.rotationDeg, supportRef: { kind: 'room', id: row.roomId } })
            }
          }
          const checked = input.algorithmVersion >= 17 ? replanInteriorCirculation(routeDocument, input, layout, currentConnectivity, options)
            : checkInteriorCirculation(candidate, input, layout, connectivity)
          options.checkCancelled()
          if (!checked.routes.every((route, at) => currentConnectivity.routes[at]?.status !== 'clear' || route.status === 'clear')) continue
          const newRoutes = new Map<string, FurnitureAccessRoute>()
          if (connectedUse && ports.length) {
            const pendingSeats = [...useSpaces.filter(space => !space.claimed && space !== ownUseSpace), ...planned]
            const plannedBlockers = pendingSeats.flatMap(space => {
              const shape = next.propDefinitions[space.definitionRef.id]
              return [furnitureBoundsPolygon(shape.defaultVisualBoundsMm, space),
                furnitureBoundsPolygon({ x: shape.defaultFootprintOffsetMm.x - shape.defaultFootprintMm.width / 2,
                  y: shape.defaultFootprintOffsetMm.y - shape.defaultFootprintMm.height / 2, ...shape.defaultFootprintMm }, space)]
            })
            // Preserve the actual connection, rather than freezing an arbitrary
            // early diagonal through a later bedside/kitchen grouping position.
            // An affected route must be replaced in full before acceptance.
            for (const [id, route] of accessRoutes) {
              if (id === existingId) continue
              meter.charge({ intersectionPairs: 1, fieldEvaluations: 1 })
              if (![physical, visual, ...plannedBlockers].some(polygon => polygonsOverlap(polygon, route.polygon))) continue
              const replacement = findAccess(route.pointsMm.at(-1)!, candidate, plannedBlockers, route)
              if (!replacement) { blocked = true; break }
              newRoutes.set(id, replacement)
            }
            if (blocked) continue
            const target = bedsideAccess?.pointsMm.at(-1) ?? (usePolygon ? furnitureApproachPoint(prop, prop, role === 'seat') : undefined)
            if (target) {
              const route = findAccess(target, candidate, plannedBlockers)
              if (!route) continue
              newRoutes.set(propId, route)
            }
            const seatShapes = planned.map(space => ({ space, shape: next.propDefinitions[space.definitionRef.id] }))
            for (const { space, shape } of seatShapes) {
              const route = findAccess(furnitureApproachPoint({ visualBoundsMm: shape.defaultVisualBoundsMm,
                footprintMm: shape.defaultFootprintMm, footprintOffsetMm: shape.defaultFootprintOffsetMm }, space, true), candidate, plannedBlockers)
              if (!route) { blocked = true; break }
              newRoutes.set(`planned:${space.anchorKey}:${space.positionMm.x}/${space.positionMm.y}/${space.rotationDeg}`, route)
            }
            if (blocked) continue
          }
          if (reserveUseSpace && usePolygon) {
            if (ownUseSpace) ownUseSpace.claimed = true
            else useSpaces.push({ anchorKey: propId, positionMm, rotationDeg, definitionRef: cloneJson(item.ref), usePolygon, claimed: true })
          }
          useSpaces.push(...planned)
          if (bedsideAccess) bedAccess.set(propId, bedsideAccess)
          for (const [id, route] of newRoutes) {
            accessRoutes.set(id, route)
            const access = bedAccess.get(id)
            if (access) bedAccess.set(id, { ...access, pointsMm: route.pointsMm, routePolygon: route.polygon })
          }
          if (kitchen && kitchenAnchors.length && ['work', 'hearth', 'storage', 'shelf'].includes(role)
            && !groupPoses.some(pose => pose.rotationDeg === rotationDeg && pose.positionMm.x === positionMm.x && pose.positionMm.y === positionMm.y)) {
            roomReport.notes.push(`${roleName[role]}未找到可接续现有厨房工作组的合法位置，本次采用独立摆位。`)
          }
          if (bedroom && role === 'storage' && beds.length && !bedsidePoses.some(pose => pose.rotationDeg === rotationDeg
            && pose.positionMm.x === positionMm.x && pose.positionMm.y === positionMm.y)) {
            roomReport.notes.push('收纳家具未找到合法床边组合位置，本次采用独立摆位并保留取物空间。')
          }
          if (completeDining && needsSeatPlan && planned.length < Math.min(2, seatQuota)) roomReport.notes.push('完整两席座位组在有限候选中未找到合法位置，本桌保留已验证的较少座位。')
          if (input.algorithmVersion >= 17) currentConnectivity = checked
          next = candidate; report.propIds.push(propId); roomReport.placed.push({ propId, role, definitionRef: cloneJson(item.ref) }); placed = true; break
        }
        if (placed) break
      }
      if (!placed) roomReport.notes.push(invalid ? `${roleName[role]}的固定素材引用失效，未添加该建议。` : `${roleName[role]}在有限摆位中未找到同时满足支撑、门前带和通路净空${reserveUseSpace ? '及座位使用空间' : ''}${bedroom ? '、床侧使用及取物空间' : ''}的位置。`)
    }
    if (connectedUse) {
      roomReport.circulation = []
      for (const prop of spatialProps().filter(value => value.supportRef.kind === 'room' && value.supportRef.id === row.roomId)) {
        const role = palette.find(item => item.ref.id === prop.definitionRef?.id && item.ref.version === prop.definitionRef.version)?.role
        if (!role || role === 'table' || role === 'work' && seatCount > 0) continue
        const access = role === 'bed' ? bedAccess.get(prop.id) : undefined
        const target = access?.pointsMm.at(-1) ?? (role !== 'bed' ? furnitureApproachPoint(prop, prop, role === 'seat') : undefined)
        const route = target ? findAccess(target, next, [], accessRoutes.get(prop.id)) : undefined
        const notes = route ? [] : [ports.length ? '有限全宽绕行未找到门口到该家具使用区的连接；保留人工内容，不强移。' : '房间没有通过当前门状态、净宽和实际支撑检查的门口；保留为可编辑草稿。']
        roomReport.circulation.push({ propId: prop.id, role, openingId: route?.openingId ?? null, pointsMm: route?.pointsMm ?? [],
          widthMm: 600, status: route ? 'clear' : 'unavailable', notes })
        roomReport.notes.push(...notes)
      }
    }
    roomReport.notes = [...new Set(roomReport.notes)]
    report.notes.push(...roomReport.notes.map(note => `${requirement.purpose}：${note}`))
  }
  return { document: next, report, ...(input.algorithmVersion >= 17 ? { connectivity: currentConnectivity } : {}) }
}
