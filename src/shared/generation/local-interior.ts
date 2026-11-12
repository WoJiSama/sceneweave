import type { CompositionContent } from '../model/appearance.js'
import type { Prop, SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import type { TaskBudgetProfile } from '../budget/task-budget.js'
import type { OutputOwnership } from '../terrain-generation/contracts.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { roomPoints } from '../geometry/geometry.js'
import { clearArea, interiorEntityId } from './domains/interior/layout.js'
import { supportedInteriorLayoutVersion, type InteriorGenerationInput, type InteriorLayout } from './domains/interior/contracts.js'
import { furnishInterior, recommendInteriorFurniture, type InteriorFurnitureSlot } from './domains/interior/furnishing.js'
import { inspectInteriorConnections } from './domains/interior/connectivity.js'
import { assertLocalManaged, finishLocalOwnership, localOwner, type LocalDomainResult, type LocalWrite } from './local-common.js'

const slotKey = (slot: InteriorFurnitureSlot) => `furniture:${slot.requirementId}:${slot.role}:${slot.index}`
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

function realRectangle(document: SceneDocument, roomId: string) {
  const polygon = roomPoints(document, document.rooms[roomId]), xs = polygon.map(p => p.x), ys = polygon.map(p => p.y)
  const x = Math.min(...xs), y = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys)
  const signed = polygon.reduce((sum, p, i) => { const next = polygon[(i + 1) % polygon.length]; return sum + BigInt(p.x) * BigInt(next.y) - BigInt(next.x) * BigInt(p.y) }, 0n)
  if (polygon.some((p, i) => { const next = polygon[(i + 1) % polygon.length]; return p.x !== next.x && p.y !== next.y || p.x !== x && p.x !== right && p.y !== y && p.y !== bottom })
    || (signed < 0n ? -signed : signed) !== 2n * BigInt(right - x) * BigInt(bottom - y)) throw new Error('局部家具当前只支持真实矩形房间，不会以包围盒替代任意轮廓。')
  return { x, y, width: right - x, height: bottom - y }
}

/** Regenerate a single generated room's still-managed furniture slots. Existing
 * props retain their exact identities and every field other than position. */
export function regenerateRoomFurniture(content: CompositionContent, request: { recipeId: string; roomId: string; variation: string }, runtime: PreparationContext,
  options: { profile: TaskBudgetProfile; checkCancelled: () => void }): LocalDomainResult {
  options.checkCancelled()
  if (!request.variation || request.variation.length > 128) throw new Error('家具变化种子须为1–128字符。')
  const before = content.document, gen = getLegacyGeneration(before)!, recipe = gen.recipes[request.recipeId], room = before.rooms[request.roomId]
  if (!recipe || !('domain' in recipe) || recipe.domain !== 'interior' || !room) throw new Error('局部家具须明确选择生成室内配方中的存活房间。')
  const roomOwner = localOwner(before, 'room', room.id), roomRule = gen.rules[roomOwner.ruleId]
  if (roomRule?.recipeRef.id !== recipe.id || ['deleted', 'detached'].includes(roomOwner.state)) throw new Error('所选房间不属于指定的连续生成结果。')
  if (room.editLocked || before.userLayers[before.entityLayers[room.id]]?.editLocked || roomRule.editLocked || before.userLayers[roomRule.layerId]?.editLocked) throw new Error('房间、生成规则或图层已锁定。')
  const requirement = recipe.parameters.rooms.find(row => roomOwner.outputKey === `${recipe.id}:room:${row.id}`)
  if (!requirement) throw new Error('所选房间缺少真实稳定需求映射。')
  // Terrain support belongs to the supported-interior replay contract, while
  // furnishing reads the actual current Room and its recursive support chain.
  // Never feed the extra parameter into strict interior-layout@2 inputs.
  const parameters = cloneJson(recipe.parameters)
  if ('supportRef' in parameters) delete (parameters as Partial<typeof parameters>).supportRef
  const input: InteriorGenerationInput = { version: 1, algorithmVersion: recipe.algorithmId === 'supported-interior' ? supportedInteriorLayoutVersion(recipe.algorithmVersion) : recipe.algorithmVersion, seed: recipe.seed, parameters }
  const boundsMm = realRectangle(before, room.id), wallThickness = Math.max(input.parameters.wallThicknessMm, ...Object.values(before.walls).filter(wall => room.boundaryVertexIds.some((id, index, ring) =>
    id === wall.startVertexId && ring[(index + 1) % ring.length] === wall.endVertexId || id === wall.endVertexId && ring[(index + 1) % ring.length] === wall.startVertexId)).map(wall => wall.thicknessMm))
  input.parameters.wallThicknessMm = wallThickness
  input.parameters.rooms = [{ ...cloneJson(requirement), purpose: room.purpose }]
  input.parameters.arrangement.furniture = true
  const layout: InteriorLayout = { rooms: [{ requirementId: requirement.id, roomId: room.id, boundsMm, clearAreaMm2: clearArea(boundsMm, wallThickness) }], corridors: [] }
  const connectivity = inspectInteriorConnections(before, input, layout, options)
  for (const row of input.parameters.arrangement.palette) if (before.propDefinitions[row.ref.id]?.version !== row.ref.version) throw new Error('局部家具固定素材缺失或版本不符。')
  const readIds = new Set<string>([recipe.id, room.id, before.entityLayers[room.id], roomOwner.id, roomOwner.ruleId, ...room.boundaryVertexIds, ...connectivity.openingIds,
    ...input.parameters.arrangement.palette.map(row => row.ref.id)])
  const readSupport = (id: string) => {
    const surface = before.rooms[id] ?? before.terrainAreas[id]
    readIds.add(id)
    if (surface) {
      readIds.add(before.entityLayers[id])
      if (recipe.algorithmId === 'supported-interior' && (surface.editLocked || before.userLayers[before.entityLayers[id]]?.editLocked)) throw new Error('局部家具的真实支撑地形或图层已锁定。')
      if ('supportRef' in surface) readSupport(surface.supportRef.id)
    }
  }
  readSupport(room.supportRef.id)
  // Current full-width door/circulation checks consume the outdoor physical
  // scene as well as room walls and furniture. Expose that real read closure
  // for supported buildings; these records remain strictly read-only.
  if (recipe.algorithmId === 'supported-interior' || input.algorithmVersion >= 8) for (const collection of ['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'regions'] as const) {
    for (const entity of Object.values(before[collection])) if (entity.floorId === room.floorId) {
      readIds.add(entity.id); readIds.add(before.entityLayers[entity.id])
    }
  }
  for (const route of connectivity.routes) for (const id of [route.fromRoomId, route.toRoomId]) if (id) {
    readIds.add(id)
    readSupport(before.rooms[id].supportRef.id)
    for (const vertexId of before.rooms[id].boundaryVertexIds) readIds.add(vertexId)
  }
  for (const wall of Object.values(before.walls).filter(wall => wall.floorId === room.floorId)) { readIds.add(wall.id); readIds.add(wall.startVertexId); readIds.add(wall.endVertexId) }
  for (const prop of Object.values(before.props).filter(prop => prop.floorId === room.floorId)) readIds.add(prop.id)
  const owners = Object.values(gen.ownership).filter(owner => gen.rules[owner.ruleId]?.recipeRef.id === recipe.id && owner.target.kind === 'prop')
  const slots = new Map<string, { owner?: OutputOwnership; prop?: Prop; propId?: string; suppressed: boolean }>(), used = geometryIdentityIds(before)
  for (const id of Object.keys(content.historyIdentity.propTokens)) used.add(id)
  const currentRoles = recommendInteriorFurniture(room.purpose, layout.rooms[0].clearAreaMm2, input.algorithmVersion)
  // Include original-role slots so a changed room purpose cannot bypass a
  // previously deleted or manually reserved furniture slot with a new identity.
  const originalRoles = recommendInteriorFurniture(requirement.purpose, layout.rooms[0].clearAreaMm2, input.algorithmVersion)
  const notes: string[] = []
  for (const [index, role] of currentRoles.entries()) {
    const slot = { requirementId: requirement.id, role, index }, key = slotKey(slot), stableKey = `${recipe.id}:${key}`
    const originalId = interiorEntityId(before.sceneId, recipe.seed, key)
    const records = owners.filter(owner => owner.outputKey === stableKey || owner.target.entityId === originalId)
    if (records.length > 1) throw new Error('家具槽位对应多个生成归属，不能猜测覆盖。')
    const owner = records[0], prop = owner ? before.props[owner.target.entityId] : undefined
    if (owner) { readIds.add(owner.id); readIds.add(owner.ruleId) }
    let suppressed = false
    if (owner) {
      suppressed = !prop || owner.state !== 'managed' || owner.manualFields.length > 0 || prop.roomId !== room.id || prop.supportRef.kind !== 'room' || prop.supportRef.id !== room.id
      if (!suppressed) {
        try { assertLocalManaged(content, 'prop', prop!.id, ['geometry'], true) } catch { suppressed = true }
      }
    } else if (content.historyIdentity.propTokens[originalId] || originalRoles[index] && originalRoles[index] !== role && owners.some(row => row.target.entityId === interiorEntityId(before.sceneId, recipe.seed, `furniture:${requirement.id}:${originalRoles[index]}:${index}`))) suppressed = true
    if (prop && !suppressed) {
      // Whole-prop manual overrides and membership take precedence even when a
      // document-only ownership record has no appearance field projection.
      const sourceId = content.appearance.propSources[prop.id], source = sourceId && content.appearance.sources[sourceId]
      if (sourceId) readIds.add(sourceId)
      readIds.add(before.entityLayers[prop.id])
      if ((content.appearance.instanceAdjustments[prop.id]?.length ?? 0) > 0 || source && source.parentSourceId !== null
        || Object.values(before.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === prop.id))
        || Object.values(before.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === prop.id))) suppressed = true
    }
    slots.set(key, { owner, prop, propId: prop?.id, suppressed })
    if (suppressed) notes.push(`保留人工修改、删除、退出或锁定家具槽位：${key}`)
  }
  const allocate = (slot: InteriorFurnitureSlot): string | null => {
    const row = slots.get(slotKey(slot))!
    if (row.suppressed) return null
    if (!row.propId) { const fresh = runtime.ids.nextId(); if (used.has(fresh)) throw new Error('新家具须分配未使用的真实出生身份。'); used.add(fresh); row.propId = fresh }
    return row.propId
  }
  const result = furnishInterior(before, input, layout, connectivity, { ...options, rankSalt: request.variation, propIdForSlot: allocate,
    existingPropForSlot: slot => slots.get(slotKey(slot))?.prop?.id ?? null })
  const writes: LocalWrite[] = []
  for (const row of slots.values()) if (!row.suppressed && row.propId) {
    const prop = result.document.props[row.propId]
    if (row.prop && !result.report.propIds.includes(row.propId)) throw new Error('有限家具摆位未找到保全现存成员与当前通路的结果，候选拒绝。')
    if (!prop) continue
    if (!row.prop) writes.push({ kind: 'prop', entityId: prop.id, fields: ['geometry', 'properties', 'appearance', 'source'] })
    else if (!equal(prop, row.prop)) writes.push({ kind: 'prop', entityId: prop.id, fields: ['geometry'] })
  }
  finishLocalOwnership(before, result.document, writes, recipe.id)
  const nextGen = getLegacyGeneration(result.document)!
  // New furniture uses the same requirement/role/index key on future runs;
  // fresh entity IDs remain distinct from that stable slot identity.
  for (const [key, row] of slots) if (!row.prop && row.propId && result.document.props[row.propId]) {
    const owner = Object.values(nextGen.ownership).find(owner => owner.target.kind === 'prop' && owner.target.entityId === row.propId)
    if (owner) owner.outputKey = `${recipe.id}:${key}`
  }
  // outputKey participates in the managed hash.
  finishLocalOwnership(result.document, result.document, [], recipe.id)
  const checked = validateSceneDocument(result.document)
  if (!checked.ok) throw new Error(`局部家具完整结果无效：${checked.errors.map(issue => issue.message).join('；')}`)
  return { document: result.document, writes, readIds: [...readIds].sort(), notes: [...notes, ...connectivity.notes, ...result.report.notes] }
}
