import type { SceneCommand } from '../commands/commands.js'
import type { Prop, PropDefinition, SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { effectiveEditLocked } from '../commands/layers.js'
import { roomPoints, polygonsOverlap, propFootprint } from '../geometry/geometry.js'
import { captureJson } from '../validation/json.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { furnishInterior } from '../generation/domains/interior/furnishing.js'
import { inspectInteriorConnections } from '../generation/domains/interior/connectivity.js'
import type { InteriorGenerationInput } from '../generation/domains/interior/contracts.js'
import { roomFurnishingRequestSchema, furnishingRoleNames, type FurnishingRole, type RoomFurnishingPlan } from './contracts.js'

export function roomFurnishingProps(document: SceneDocument, roomId: string): Prop[] {
  const room = document.rooms[roomId]
  if (!room) return []
  return Object.values(document.props).filter(prop => prop.floorId === room.floorId && (prop.roomId === roomId
    || prop.supportRef.kind === 'room' && prop.supportRef.id === roomId || polygonsOverlap(propFootprint(prop), roomPoints(document, room))))
}
export function furnishingMoveReason(document: SceneDocument, roomId: string, id: string): string | null {
  const prop = document.props[id]
  if (!prop || prop.roomId !== roomId || prop.supportRef.kind !== 'room' || prop.supportRef.id !== roomId) return '仅能明确移动本房间内、由本房间支撑的物件。'
  if (effectiveEditLocked(document, id)) return '物件、图层或祖先已锁定。'
  if (Object.values(document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id))
    || Object.values(document.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === id))
    || Object.values(document.decorationClusters).some(group => Object.values(group.members).some(member => member.entityId === id))) return '组合或散布成员须先明确拆开，不能单独重排。'
  if (Object.values(document.attachments ?? {}).some(row => row.child.id === id) || Object.values(document.attachmentSurfaces ?? {}).some(row => row.owner.id === id)) return '附着及宿主不支持独立重排。'
  return null
}
export function furnishingDefinitionRole(definition: PropDefinition | undefined): FurnishingRole | null {
  if (!definition) return null
  const text = [definition.name, ...definition.tags].join(' ').toLowerCase()
  if (/床边|nightstand/.test(text)) return 'storage'
  const matches: [FurnishingRole, RegExp][] = [['bed', /床|\bbed\b/], ['hearth', /炉|灶|hearth|stove/], ['shelf', /搁架|书架|食材架|布草架|shelf|rack/],
    ['work', /工作台|备餐台|洗漱台|书桌|书写桌|写字桌|counter|prep|desk|wash/], ['seat', /椅|凳|chair|seat/], ['table', /餐桌|小桌|桌子|table/], ['storage', /柜|储物|布草箱|cupboard|cabinet|storage|chest/]]
  return matches.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

/** Explicit advisory functions over actual current geometry. This does not
 * regenerate a room, claim ownership of existing content or copy a template. */
export function planRoomFurnishing(document: SceneDocument, raw: unknown, runtime: PreparationContext, checkCancelled: () => void = () => {}) {
  const request = roomFurnishingRequestSchema.parse(captureJson(raw)), room = document.rooms[request.roomId]
  if (!validateSceneDocument(document).ok || !room || document.mapMode !== 'scene') throw new Error('请选择当前严格场景中的真实房间。')
  if (document.aggregateCoordinates) throw new Error('请先明确解除房间层级组，再使用现有房间布置。')
  if (effectiveEditLocked(document, room.id) || document.userLayers[request.layerId]?.floorId !== room.floorId || document.userLayers[request.layerId].editLocked)
    throw new Error('房间、图层或依赖已锁定，或目标图层不在同一楼层。')
  const support = room.supportRef.id
  if (effectiveEditLocked(document, support)) throw new Error('房间实际支撑已锁定。')
  const points = roomPoints(document, room)
  if (points.some((point, i) => { const next = points[(i + 1) % points.length]; return point.x !== next.x && point.y !== next.y })) throw new Error('当前布置支持实际正交房间；斜边房间保留手工编辑。')
  const boundsMm = { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) }
  const walls = Object.values(document.walls).filter(wall => room.boundaryVertexIds.includes(wall.startVertexId) && room.boundaryVertexIds.includes(wall.endVertexId))
  const thickness = Math.max(1, ...walls.map(wall => wall.thicknessMm)), props = roomFurnishingProps(document, room.id).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const movable = new Set(request.movableIds)
  for (const id of movable) { const reason = furnishingMoveReason(document, room.id, id); if (reason) throw new Error(reason) }
  for (const row of request.functions) if (document.propDefinitions[row.definitionRef.id]?.version !== row.definitionRef.version) throw new Error('请选择实际存在的固定素材及版本。')
  const old = room.furnishingPlan?.slots ?? [], restore = new Set(request.restoreDeletedKeys), used = new Set<string>(), notes: string[] = []
  for (const key of restore) if (!old.some(slot => slot.key === key && !document.props[slot.propId])) throw new Error('重新允许的槽位没有确切删除记录。')
  const slots: { key: string; role: FurnishingRole; propId: string; existing: string | null; skipped: boolean }[] = []
  for (const fn of request.functions) for (let n = 0; n < fn.count; n++) {
    const key = `${fn.role}:${n}`, memory = old.find(slot => slot.key === key), prior = memory && document.props[memory.propId]
    let prop = prior && props.some(row => row.id === prior.id) ? prior : undefined
    if (!memory) prop = props.find(row => !used.has(row.id) && (row.definitionRef?.id === fn.definitionRef.id && row.definitionRef.version === fn.definitionRef.version
      || furnishingDefinitionRole(document.propDefinitions[row.definitionRef?.id ?? '']) === fn.role))
    if (prop) used.add(prop.id)
    const suppressed = !!memory && !prop && !restore.has(key)
    if (suppressed) notes.push(`保留${furnishingRoleNames[fn.role]}的人工删除或移出记录：${key}。`)
    const skipped = suppressed || !!prop && !movable.has(prop.id)
    slots.push({ key, role: fn.role, propId: prop?.id ?? (suppressed ? memory!.propId : runtime.ids.nextId()), existing: prop?.id ?? null, skipped })
  }
  if (request.movableIds.some(id => !slots.some(slot => slot.existing === id && !slot.skipped))) throw new Error('已勾选家具未对应所选功能，请调整功能或取消其移动授权。')
  if ([...restore].some(key => !slots.some(slot => slot.key === key))) throw new Error('重新允许的已删槽位须包含在本次明确功能数量中。')
  const ids = new Set(Object.keys(document.props))
  for (const slot of slots.filter(slot => !slot.skipped && !slot.existing)) {
    if (ids.has(slot.propId)) throw new Error('新家具身份重复。')
    ids.add(slot.propId)
  }
  const input: InteriorGenerationInput = { version: 1, algorithmVersion: 20, seed: request.variation, parameters: { floorId: room.floorId, layerId: request.layerId,
    boundsMm: document.floors[room.floorId].boundsMm, wallThicknessMm: thickness,
    rooms: [{ id: 'existing-room', purpose: request.purpose, minAreaMm2: 1, maxAreaMm2: 1_000_000_000_000, minClearSideMm: 1 }], relations: [],
    corridor: { axis: 'none', clearWidthMm: 1000 }, materials: { floor: null, wall: null }, arrangement: { doors: false, entrance: false, furniture: true, doorWidthMm: 1000, clearWidthMm: 1000,
      palette: [...request.functions.map(fn => ({ role: fn.role, ref: fn.definitionRef })), ...slots.flatMap(slot => slot.existing && document.props[slot.existing].definitionRef ? [{ role: slot.role, ref: document.props[slot.existing].definitionRef! }] : [])]
        .filter((row, i, all) => all.findIndex(other => other.role === row.role && other.ref.id === row.ref.id && other.ref.version === row.ref.version) === i) } } }
  const layout = { rooms: [{ requirementId: 'existing-room', roomId: room.id, boundsMm, clearAreaMm2: Math.max(1, (boundsMm.width - thickness) * (boundsMm.height - thickness)) }], corridors: [] }
  const options = { profile: taskBudgetProfile('small'), checkCancelled }, connectivity = inspectInteriorConnections(document, input, layout, options)
  const result = furnishInterior(document, input, layout, connectivity, { ...options, rankSalt: request.variation,
    rolesForRoom: () => slots.map(slot => slot.role), propIdForSlot: slot => slots[slot.index].skipped ? null : slots[slot.index].propId,
    existingPropForSlot: slot => slots[slot.index].skipped ? null : slots[slot.index].existing })
  const commands: SceneCommand[] = [], added: string[] = [], moved: string[] = [], missing: string[] = []
  const memory = new Map(old.map(slot => [slot.key, slot]))
  for (const slot of slots) {
    if (slot.skipped) { if (slot.existing) memory.set(slot.key, { key: slot.key, role: slot.role, propId: slot.existing }); continue }
    const prop = result.document.props[slot.propId]
    if (!prop || !result.report.propIds.includes(slot.propId)) {
      if (slot.existing) throw new Error('未找到同时保全所选现存家具与通路的候选；本次不移动任何物件。')
      missing.push(`${furnishingRoleNames[slot.role]} ${slot.key}`); continue
    }
    if (slot.existing) {
      if (canonicalJson(document.props[prop.id].positionMm) !== canonicalJson(prop.positionMm)) { commands.push({ type: 'updateProp', id: prop.id, changes: { positionMm: prop.positionMm } }); moved.push(prop.id) }
    } else {
      commands.push({ type: 'addProp', id: prop.id, floorId: room.floorId, layerId: request.layerId, definitionRef: prop.definitionRef!, positionMm: prop.positionMm, rotationDeg: prop.rotationDeg, supportRef: { kind: 'room', id: room.id } }); added.push(prop.id)
    }
    memory.set(slot.key, { key: slot.key, role: slot.role, propId: prop.id })
  }
  const furnishingPlan: RoomFurnishingPlan = { algorithmId: 'room-furnishing', algorithmVersion: 1, purpose: request.purpose, slots: [...memory.values()] }
  if (furnishingPlan.slots.length > 64) throw new Error('布置记忆超过64槽位；请保留当前内容并使用独立新房间。')
  if (canonicalJson(room.furnishingPlan ?? null) !== canonicalJson(furnishingPlan)) commands.push({ type: 'updateRoom', id: room.id, changes: { furnishingPlan } })
  return { commands, addedIds: added, movedIds: moved, preservedIds: props.filter(prop => !moved.includes(prop.id)).map(prop => prop.id), missing,
    notes: [...notes, ...result.report.notes, ...(result.connectivity ?? connectivity).notes], report: result.report, purpose: request.purpose,
    circulation: result.connectivity ?? connectivity, input, layout,
    routes: { clear: (result.connectivity ?? connectivity).routes.filter(route => route.status === 'clear').length, total: (result.connectivity ?? connectivity).routes.length } }
}
