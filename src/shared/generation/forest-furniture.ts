import type { SceneDocument } from '../model/scene.js'
import { taskBudgetProfile, type TaskBudgetProfile } from '../budget/task-budget.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { openingEndpoints, roomPoints } from '../geometry/geometry.js'
import { cloneJson, freezeJson } from '../validation/json.js'
import { hashGenerationValue } from './contracts.js'
import { clearArea } from './domains/interior/layout.js'
import { supportedInteriorLayoutVersion, type InteriorGenerationInput, type InteriorLayout } from './domains/interior/contracts.js'
import { furnishInterior, recommendInteriorFurniture } from './domains/interior/furnishing.js'
import { inspectInteriorConnections } from './domains/interior/connectivity.js'
import { ForestFurnitureDiagnosticsSchema, type ForestFurnitureDiagnostics, type FurnitureRejectionReason } from './forest-furniture-contract.js'
export { ForestFurnitureDiagnosticsSchema, type ForestFurnitureDiagnostics } from './forest-furniture-contract.js'

const sorted = <T>(values: T[]) => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
const roleName = { bed: '床', seat: '座椅', table: '桌子', storage: '收纳家具', work: '工作台', hearth: '炉台', shelf: '书架' }

/** Read-only, finite diagnostics. Counts always describe the supplied document.
 * Rejection counters describe a dry placement probe of its unfilled slots;
 * successful probe placements are never counted as delivered furniture. */
export function diagnoseForestFurniture(document: SceneDocument, options: { profile?: TaskBudgetProfile; checkCancelled?: () => void } = {}): ForestFurnitureDiagnostics {
  const checkCancelled = options.checkCancelled ?? (() => {}), profile = options.profile ?? taskBudgetProfile('standard')
  checkCancelled()
  const generation = getLegacyGeneration(document)
  const rooms: ForestFurnitureDiagnostics['rooms'] = []
  if (generation) for (const room of Object.values(document.rooms).sort((a, b) => a.id.localeCompare(b.id))) {
    checkCancelled()
    const owner = Object.values(generation.ownership).find(row => row.target.kind === 'room' && row.target.entityId === room.id)
    const rule = owner && generation.rules[owner.ruleId], recipe = rule && generation.recipes[rule.recipeRef.id]
    if (!owner || !rule || !recipe || !('domain' in recipe) || recipe.domain !== 'interior') continue
    const requirement = recipe.parameters.rooms.find(row => owner.outputKey === `${recipe.id}:room:${row.id}`)
    if (!requirement) continue
    const points = roomPoints(document, room), xs = points.map(p => p.x), ys = points.map(p => p.y)
    const boundsMm = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    const rectangle = points.length === 4 && points.every((p, i) => p.x === points[(i + 1) % points.length].x || p.y === points[(i + 1) % points.length].y)
    const wallThicknessMm = Math.max(recipe.parameters.wallThicknessMm, ...Object.values(document.walls).filter(wall => room.boundaryVertexIds.some((id, i, ring) =>
      id === wall.startVertexId && ring[(i + 1) % ring.length] === wall.endVertexId || id === wall.endVertexId && ring[(i + 1) % ring.length] === wall.startVertexId)).map(w => w.thicknessMm))
    const algorithmVersion = recipe.algorithmId === 'supported-interior' ? supportedInteriorLayoutVersion(recipe.algorithmVersion) : recipe.algorithmVersion
    const recommended = recipe.parameters.arrangement.furniture ? recommendInteriorFurniture(room.purpose, clearArea(boundsMm, wallThicknessMm), algorithmVersion) : []
    const palette = recipe.parameters.arrangement.palette
    const actualProps = Object.values(document.props).filter(prop => prop.roomId === room.id && prop.supportRef.kind === 'room' && prop.supportRef.id === room.id)
    const roles: ForestFurnitureDiagnostics['rooms'][number]['roles'] = [...new Set(recommended)].map(role => {
      const expected = recommended.filter(value => value === role).length
      const actual = actualProps.filter(prop => palette.some(row => row.role === role && row.ref.id === prop.definitionRef?.id && row.ref.version === prop.definitionRef.version)).length
      return { role, expected, actual, deficit: Math.max(0, expected - actual), rejections: [] }
    })
    const locked = room.editLocked || document.userLayers[document.entityLayers[room.id]]?.editLocked || rule.editLocked || document.userLayers[rule.layerId]?.editLocked
    const notes: string[] = []
    let repairable = rectangle && !locked && roles.some(role => role.deficit > 0)
    if (!rectangle) notes.push('当前家具修正只支持真实矩形房间。')
    if (locked) notes.push('房间、规则或图层已锁定，不能修正。')
    if (repairable) {
      const parameters = cloneJson(recipe.parameters)
      if ('supportRef' in parameters) delete (parameters as Partial<typeof parameters>).supportRef
      if ('entranceApproach' in parameters) delete (parameters as Partial<typeof parameters>).entranceApproach
      if ('entranceRoomRequirementId' in parameters.arrangement) delete parameters.arrangement.entranceRoomRequirementId
      parameters.rooms = [{ ...cloneJson(requirement), purpose: room.purpose }]
      parameters.wallThicknessMm = wallThicknessMm
      parameters.arrangement.furniture = true
      const input: InteriorGenerationInput = { version: 1, algorithmVersion, seed: recipe.seed, parameters }
      const layout: InteriorLayout = { rooms: [{ requirementId: requirement.id, roomId: room.id, boundsMm, clearAreaMm2: clearArea(boundsMm, wallThicknessMm) }], corridors: [] }
      const connectivity = inspectInteriorConnections(document, input, layout, { profile, checkCancelled })
      let availableSlots = 0
      const counters = new Map<string, number>()
      const reject = (role: string, reason: FurnitureRejectionReason) => counters.set(`${role}/${reason}`, (counters.get(`${role}/${reason}`) ?? 0) + 1)
      furnishInterior(document, input, layout, connectivity, { profile, checkCancelled,
        propIdForSlot(slot) {
          const key = `${recipe.id}:furniture:${slot.requirementId}:${slot.role}:${slot.index}`
          const existing = Object.values(generation.ownership).find(row => row.outputKey === key)
          if (existing) {
            if (!document.props[existing.target.entityId] || existing.state !== 'managed' || existing.manualFields.length) reject(slot.role, 'protected-slot')
            return null
          }
          availableSlots++
          return `diagnostic-${hashGenerationValue([room.id, key]).slice(0, 32)}`
        },
        onRejection(_room, role, reason) { if (reason !== 'protected-slot') reject(role, reason) },
      })
      for (const role of roles) if (role.deficit) role.rejections = [...counters].filter(([key]) => key.startsWith(`${role.role}/`))
        .map(([key, count]) => ({ reason: key.split('/')[1] as FurnitureRejectionReason, count }))
      if (!availableSlots) { repairable = false; notes.push('空缺槽位已人工删除、退出或保护，本次不会补回。') }
    }
    rooms.push({ roomId: room.id, recipeId: recipe.id, requirementId: requirement.id, purpose: room.purpose, repairable, roles, notes })
  }
  const structureHash = hashGenerationValue({
    floors: sorted(Object.values(document.floors).map(floor => floor.boundsMm)),
    rooms: sorted(Object.values(document.rooms).map(room => ({ purpose: room.purpose, points: roomPoints(document, room), editLocked: room.editLocked }))),
    walls: sorted(Object.values(document.walls).map(wall => ({ points: [wall.startVertexId, wall.endVertexId].map(id => ({ x: document.vertices[id].xMm, y: document.vertices[id].yMm })), thicknessMm: wall.thicknessMm, editLocked: wall.editLocked }))),
    openings: sorted(Object.values(document.openings).map(opening => ({ points: openingEndpoints(document, opening), kind: opening.kind, widthMm: opening.widthMm, state: opening.state, locked: opening.locked, editLocked: opening.editLocked }))),
  })
  const deficit = rooms.reduce((total, room) => total + room.roles.reduce((n, role) => n + role.deficit, 0), 0)
  const outcomeHash = hashGenerationValue({ structureHash, rooms: sorted(rooms.map(room => ({ requirementId: room.requirementId, purpose: room.purpose,
    roles: room.roles.map(({ role, expected, actual, deficit }) => ({ role, expected, actual, deficit })) }))) })
  checkCancelled()
  return freezeJson(ForestFurnitureDiagnosticsSchema.parse({ structureHash, outcomeHash, deficit, rooms }))
}

/** Replace stale finite-furniture warnings with current document deficits. */
export function forestFurnitureNotes(diagnostics: ForestFurnitureDiagnostics, originalNotes: readonly string[]): string[] {
  const notes = originalNotes.filter(note => !/在有限摆位中未找到|未提供.*的固定素材.*保留空位|完整两席座位组在有限候选|：(床|座椅|桌子|收纳家具|工作台|炉台|书架)目标\d+件，实际\d+件，缺\d+件。/.test(note))
  for (const room of diagnostics.rooms) for (const role of room.roles) if (role.deficit) notes.push(`${room.purpose}：${roleName[role.role]}目标${role.expected}件，实际${role.actual}件，缺${role.deficit}件。${room.repairable ? '可尝试受保护家具修正。' : '当前没有可自动修正的空缺槽位。'}`)
  return [...new Set(notes)].slice(0, 16).map(note => note.slice(0, 512))
}
