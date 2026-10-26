import { z } from 'zod'
import { applyVisualCommand, isVisualCommand, visualCommandSchemas, type VisualCommand } from '../visual/commands.js'
import type { PreparationContext } from '../ports/runtime.js'
import { cloneJson, inspectJsonInput } from '../validation/json.js'
import { applyCommandDraft, createBasePlacedProp, isEntityEditLocked, type BasePlacePropOptions, type BaseSceneCommand } from './base.js'
import type { PointMm } from '../model/scene.js'
import { canvasBoundsCommandSchema, applyCanvasBoundsCommand, type CanvasBoundsCommand } from './canvas-bounds.js'
import { sceneDisplayCommandSchema, applySceneDisplayCommand, type SceneDisplayCommand } from './scene-display.js'
import { annotationCommandSchemas, applyAnnotationCommand, isAnnotationCommand, type AnnotationCommand } from './annotations.js'
import { applyBuildingCommand, buildingCommandSchemas, isBuildingCommand, type BuildingCommand } from './building.js'
import { applyOutdoorCommand, isOutdoorCommand, outdoorCommandSchemas, type OutdoorCommand } from './outdoor.js'
import { geometryDocumentForValidation, geometryIdentityIds } from './domain.js'
import { entitiesInLayer, enumerateLayerEntities, orderedLayers, previewLayerMove, previewLayerRemoval } from './layers.js'
import { validateSceneDocument } from '../validation/scene.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import { COMMAND_LIMIT, LAYER_ENTITY_COLLECTIONS, USER_LAYER_LIMIT, type SceneDocument } from '../model/scene.js'

export type SceneCommand =
  | Exclude<BaseSceneCommand, { type: 'addProp' | 'setEditLock' }>
  | (Extract<BaseSceneCommand, { type: 'addProp' }> & { layerId?: string })
  | BuildingCommand
  | AnnotationCommand
  | CanvasBoundsCommand
  | SceneDisplayCommand
  | OutdoorCommand
  | VisualCommand
  | { type: 'setEditLock'; kind: 'vertex' | 'room' | 'wall' | 'opening' | 'note' | 'region' | 'prop' | 'prefabInstance' | 'scatterGroup' | 'terrainArea' | 'terrainEdge' | 'terrainConnection' | 'path'; id: string; locked: boolean }
  | { type: 'createLayer'; id: string; floorId: string; name: string }
  | { type: 'renameLayer'; id: string; name: string }
  | { type: 'setLayerLock'; id: string; locked: boolean }
  | { type: 'reorderLayers'; floorId: string; ids: string[] }
  | { type: 'moveEntitiesToLayer'; ids: string[]; layerId: string }
  | { type: 'removeLayer'; id: string; targetLayerId?: string }

export interface ApplySnapshotCommandsOptions extends ApplyCommandsOptions {
  /** Internal immediate preparation may defer no-op comparison to Workspace. */
  preserveNoopIdentity?: boolean
}

export interface ApplyCommandsOptions {
  /** Internal synchronous observer: inspect immediately; never mutate or retain the draft. */
  onOutdoorDraft?: (draft: Readonly<SceneDocument>, command: Readonly<OutdoorCommand | VisualCommand>) => void
}

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const integer = z.number().finite().refine(Number.isSafeInteger, '毫米坐标必须是安全整数')
const positive = integer.refine(value => value > 0, '尺寸必须大于零')
const angle = z.number().finite().min(0).lt(360)
const point = z.object({ x: integer, y: integer }).strict(), size = z.object({ width: positive, height: positive }).strict()
const version = z.object({ id, version: positive }).strict(), surfaceRef = z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict()
const kind = z.enum(['room', 'terrainArea'])
const name = z.string().transform(value => value.trim()).pipe(z.string().min(1).max(80))
const uniqueIds = z.array(id).refine(values => new Set(values).size === values.length, 'ID 不能重复')

/** Explicit native command contract; unknown fields cannot hide a second operation. */
export const sceneCommandSchema = z.discriminatedUnion('type', [
  ...buildingCommandSchemas,
  ...annotationCommandSchemas,
  ...outdoorCommandSchemas,
  ...visualCommandSchemas,
  canvasBoundsCommandSchema,
  sceneDisplayCommandSchema,
  z.object({ type: z.literal('moveVertex'), id, positionMm: point }).strict(),
  z.object({ type: z.literal('setWallThickness'), id, thicknessMm: positive }).strict(),
  z.object({ type: z.literal('reverseWall'), id }).strict(),
  z.object({ type: z.literal('splitWall'), id, positionMm: point, newVertexId: id, newWallId: id }).strict(),
  z.object({ type: z.literal('setSurfaceMaterial'), kind: z.enum(['room', 'terrainArea', 'wall']), id, materialRef: version }).strict(),
  z.object({ type: z.literal('setSurfacePaint'), kind, id, changes: z.object({ rotationDeg: angle.optional(), originMm: point.optional(), tileSizeMm: size.optional() }).strict() }).strict(),
  z.object({ type: z.literal('moveTerrainPoint'), areaId: id, pointId: id, positionMm: point }).strict(),
  z.object({ type: z.literal('setTerrainElevation'), id, groundElevationMm: integer }).strict(),
  z.object({ type: z.literal('setConnectionBlocked'), id, blocksMovement: z.boolean() }).strict(),
  z.object({ type: z.literal('removeTerrainConnection'), id }).strict(),
  z.object({ type: z.literal('setOverlayBoundary'), kind, id, overlayId: id, boundaryMm: z.array(point).min(3).max(512) }).strict(),
  z.object({ type: z.literal('regenerateScatter'), id, densityFactor: z.number().finite().min(0).max(1).optional() }).strict(),
  z.object({ type: z.literal('addProp'), id, floorId: id, definitionRef: version, positionMm: point, rotationDeg: angle.optional(), supportRef: surfaceRef.optional(), layerId: id.optional() }).strict(),
  z.object({ type: z.literal('copyProp'), id, newId: id, offsetMm: point }).strict(),
  z.object({ type: z.literal('deleteProp'), id }).strict(),
  z.object({ type: z.literal('detachScatterMember'), groupId: id, propId: id }).strict(),
  z.object({ type: z.literal('setEditLock'), kind: z.enum(['vertex', 'room', 'wall', 'opening', 'note', 'region', 'prop', 'prefabInstance', 'scatterGroup', 'terrainArea', 'terrainEdge', 'terrainConnection', 'path']), id, locked: z.boolean() }).strict(),
  z.object({ type: z.literal('transformPrefab'), id, anchorMm: point.optional(), rotationDeg: angle.optional() }).strict(),
  z.object({ type: z.literal('unpackPrefab'), id }).strict(),
  z.object({ type: z.literal('updateProp'), id, changes: z.object({ positionMm: point.optional(), rotationDeg: angle.optional() }).strict() }).strict(),
  z.object({ type: z.literal('replacePropAppearance'), id, definitionRef: version }).strict(),
  z.object({ type: z.literal('createLayer'), id, floorId: id, name }).strict(),
  z.object({ type: z.literal('renameLayer'), id, name }).strict(),
  z.object({ type: z.literal('setLayerLock'), id, locked: z.boolean() }).strict(),
  z.object({ type: z.literal('reorderLayers'), floorId: id, ids: uniqueIds.max(USER_LAYER_LIMIT) }).strict(),
  z.object({ type: z.literal('moveEntitiesToLayer'), ids: uniqueIds.min(1).max(COMMAND_LIMIT), layerId: id }).strict(),
  z.object({ type: z.literal('removeLayer'), id, targetLayerId: id.optional() }).strict(),
])
export const commandsSchema = z.array(sceneCommandSchema).max(COMMAND_LIMIT, '单次事务最多 256 个操作')
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a), bk = Object.keys(b)
  return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
const layerTypes = new Set(['createLayer', 'renameLayer', 'reorderLayers', 'moveEntitiesToLayer', 'removeLayer'])
const category = (command: SceneCommand) => command.type === 'setSceneDisplay' ? 'display' : command.type === 'setEditLock' ? 'entity-lock' : command.type === 'setLayerLock' ? 'layer-lock' : layerTypes.has(command.type) ? 'organization' : 'content'
const needsOutdoorExpansion = (scene: SceneDocument, command: SceneCommand): command is OutdoorCommand => isOutdoorCommand(command)
  && ((command.type !== 'deleteProp' && command.type !== 'updateProp' && command.type !== 'replacePropAppearance') || Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === command.id)))

function checkedCommands(commands: readonly SceneCommand[]): SceneCommand[] {
  if (!Array.isArray(commands) || commands.length > COMMAND_LIMIT) throw new Error('编辑指令必须是数组，单次事务最多 256 个操作。')
  const issue = inspectJsonInput(commands)
  if (issue) throw new Error(`编辑指令无效：${issue.message}`)
  const checked = commandsSchema.safeParse(commands)
  if (!checked.success) throw new Error(`编辑指令无效：${checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；')}`)
  const parsed = checked.data as SceneCommand[]
  if (new Set(parsed.map(category)).size > 1) throw new Error('显示设置、图层组织、内容编辑、实体锁和图层锁须分别独立提交；不能同批解锁后编辑。')
  return parsed
}
function requiredLayer(scene: SceneDocument, id: string) {
  const layer = own(scene.userLayers, id)
  if (!layer) throw new Error(`用户图层不存在：${id}。`)
  return layer
}
function assertLayerUnlocked(scene: SceneDocument, id: string) {
  const layer = requiredLayer(scene, id)
  if (layer.editLocked) throw new Error(`用户图层已锁定：${id}；请先单独解锁。`)
  return layer
}
function restoreActualLocks(next: SceneDocument, source: SceneDocument, explicit: ReadonlyMap<string, boolean>) {
  const actual = new Map(enumerateLayerEntities(source).map(entity => [entity.id, entity.editLocked]))
  for (const collection of LAYER_ENTITY_COLLECTIONS) for (const entity of Object.values(next[collection])) {
    if (explicit.has(entity.id)) entity.editLocked = explicit.get(entity.id)!
    else if (actual.has(entity.id)) entity.editLocked = actual.get(entity.id)!
  }
}
function applyNativeContent(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext): SceneDocument {
  const memberships = { ...scene.entityLayers }, explicitLocks = new Map<string, boolean>(), baseCommands: BaseSceneCommand[] = []
  for (const command of commands) {
    if (command.type === 'addProp') {
      const target = command.layerId ?? orderedLayers(scene, command.floorId)[0]?.id
      if (!target) throw new Error('新物件必须选择同 Floor 的现存用户图层。')
      const layer = assertLayerUnlocked(scene, target)
      if (layer.floorId !== command.floorId) throw new Error('新物件与目标图层必须同 Floor。')
      memberships[command.id] = target
      const { layerId: _layerId, ...base } = command
      baseCommands.push(base)
    } else if (command.type === 'setEditLock') {
      const targetLayer = memberships[command.id]
      if (!targetLayer) throw new Error(`实体图层归属不存在：${command.id}。`)
      assertLayerUnlocked(scene, targetLayer)
      explicitLocks.set(command.id, command.locked); baseCommands.push(command as BaseSceneCommand)
    } else if (category(command) === 'content') {
      baseCommands.push(command as BaseSceneCommand)
      if (command.type === 'copyProp') memberships[command.newId] = memberships[command.id]
      else if (command.type === 'splitWall') { memberships[command.newVertexId] = memberships[command.id]; memberships[command.newWallId] = memberships[command.id] }
    } else throw new Error('此批次不能混入图层组织命令。')
  }
  const next = applyCommandDraft(cloneJson(geometryDocumentForValidation(scene, true)), baseCommands, context)
  next.userLayers = cloneJson(scene.userLayers)
  next.entityLayers = {}
  const present = new Set(enumerateLayerEntities(next).map(entity => entity.id))
  for (const id of present) if (Object.hasOwn(memberships, id)) next.entityLayers[id] = memberships[id]
  // Re-generated members inherit the fixed container layer. Suppressed records
  // remain in the group and never acquire independent membership entries.
  for (const group of [...Object.values(next.prefabInstances), ...Object.values(next.scatterGroups)]) {
    for (const member of Object.values(group.members)) if (member.propId !== null) next.entityLayers[member.propId] = next.entityLayers[group.id]
  }
  restoreActualLocks(next, scene, explicitLocks)
  return next
}
function changedRecords(before: Record<string, unknown>, after: Record<string, unknown>): number {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => !equal(before[id], after[id])).length
}
/** Complete persisted expansion for base content edits, including member overrides. */
function nativeCommandCost(before: SceneDocument, after: SceneDocument): number {
  let cost = 0
  for (const collection of LAYER_ENTITY_COLLECTIONS) {
    const a = before[collection], b = after[collection]
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!equal(a[id], b[id]) || before.entityLayers[id] !== after.entityLayers[id]) cost++
    }
  }
  for (const collection of ['prefabInstances', 'scatterGroups'] as const) {
    for (const id of new Set([...Object.keys(before[collection]), ...Object.keys(after[collection])])) {
      cost += changedRecords(before[collection][id]?.members ?? {}, after[collection][id]?.members ?? {})
    }
  }
  for (const id of new Set([...Object.keys(before.scatterGroups), ...Object.keys(after.scatterGroups)])) {
    const records = (scene: SceneDocument) => Object.fromEntries((scene.scatterGroups[id]?.exclusions ?? []).map(record => [record.id, record]))
    cost += changedRecords(records(before), records(after))
  }
  return cost
}
function applyContent(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options?: ApplyCommandsOptions): SceneDocument {
  // Entity locks are an independent transaction category; content cannot unlock itself.
  if (commands[0]?.type === 'setEditLock') {
    const next = cloneJson(scene), collections = { vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', note: 'notes', region: 'regions', prop: 'props', prefabInstance: 'prefabInstances', scatterGroup: 'scatterGroups', terrainArea: 'terrainAreas', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections', path: 'paths' } as const
    for (const command of commands) {
      if (command.type !== 'setEditLock') throw new Error('编辑锁须单独提交。')
      const entity = own(next[collections[command.kind]] as Record<string, { id: string; editLocked: boolean }>, command.id)
      if (!entity) throw new Error('编辑锁目标不存在或类型不符。')
      assertLayerUnlocked(next, next.entityLayers[command.id])
      if (entity.editLocked === command.locked) continue
      if (command.kind === 'prop') {
        const parents = [...Object.values(next.prefabInstances), ...Object.values(next.scatterGroups)].filter(group => Object.values(group.members).some(member => member.propId === command.id))
        if (parents.some(group => group.editLocked || next.userLayers[next.entityLayers[group.id]].editLocked)) throw new Error('物件所属组合、散布或其图层已锁定，不能修改成员编辑锁。')
      }
      entity.editLocked = command.locked
    }
    return next
  }
  let next = scene, owned = false, cost = 0
  // Native commands already produce a detached mutable scene. Only commands
  // that write in place need to acquire a draft before the first such write.
  const writable = () => {
    if (!owned) { next = cloneJson(next); owned = true }
    return next
  }
  const consume = (amount: number) => { cost += amount; if (cost > COMMAND_LIMIT) throw new Error('展开后的整体事务超过256条操作预算，不能拆批绕过。') }
  for (const command of commands) {
    if (isVisualCommand(command)) {
      consume(applyVisualCommand(writable(), command, context).commandCost)
      options?.onOutdoorDraft?.(next, command)
    } else if (needsOutdoorExpansion(next, command)) {
      consume(applyOutdoorCommand(writable(), command, context).commandCost)
      options?.onOutdoorDraft?.(next, command)
    } else if (isBuildingCommand(command)) consume(applyBuildingCommand(writable(), command).commandCost)
    else if (isAnnotationCommand(command)) {
      const before = cloneJson(writable())
      applyAnnotationCommand(next, command)
      consume(nativeCommandCost(before, next))
    } else if (command.type === 'setCanvasBounds') consume(applyCanvasBoundsCommand(writable(), command).commandCost)
    else {
      const before = next
      next = applyNativeContent(next, [command], context)
      owned = true
      consume(nativeCommandCost(before, next))
    }
  }
  return next
}
function applyOrganization(scene: SceneDocument, commands: readonly SceneCommand[]): SceneDocument {
  const next = cloneJson(scene)
  let cost = 0
  const consume = (amount: number) => { cost += amount; if (cost > COMMAND_LIMIT) throw new Error('展开后的整体事务超过 256 条操作预算，不能拆批绕过。') }
  for (const command of commands) {
    switch (command.type) {
      case 'createLayer': {
        consume(1)
        if (!Object.hasOwn(next.floors, command.floorId)) throw new Error('新图层所在 Floor 不存在。')
        if (Object.keys(next.userLayers).length >= USER_LAYER_LIMIT) throw new Error('用户图层总数最多 128，不能继续新建。')
        if (Object.hasOwn(next.userLayers, command.id) || geometryIdentityIds(next).has(command.id)) throw new Error('新图层须使用未占用的独立 ID。')
        next.userLayers[command.id] = { id: command.id, floorId: command.floorId, name: command.name, order: orderedLayers(next, command.floorId).length, editLocked: false }
        break
      }
      case 'renameLayer': consume(1); assertLayerUnlocked(next, command.id).name = command.name; break
      case 'reorderLayers': {
        consume(1)
        const layers = orderedLayers(next, command.floorId)
        if (!Object.hasOwn(next.floors, command.floorId) || command.ids.length !== layers.length || command.ids.some(id => !layers.some(layer => layer.id === id))) throw new Error('图层重排必须列出同 Floor 的全部图层且恰好一次。')
        const moved = command.ids.filter((id, index) => next.userLayers[id].order !== index)
        const changedIds = moved.flatMap(id => entitiesInLayer(next, id))
        for (const id of moved) assertLayerUnlocked(next, id)
        if (changedIds.length) {
          const domain = geometryDocumentForValidation(next, true)
          // Preview uses the same dependency-aware lock affordance; a locked
          // member cannot be visually reordered by changing its layer instead.
          const locked = changedIds.filter(id => isEntityEditLocked(domain, id))
          if (locked.length) throw new Error(`图层重排涉及已锁定实体或依赖：${locked.join('、')}。`)
        }
        command.ids.forEach((id, order) => { next.userLayers[id].order = order })
        break
      }
      case 'moveEntitiesToLayer': {
        const preview = previewLayerMove(next, command.ids, command.layerId)
        if (preview.reason) throw new Error(preview.reason)
        consume(preview.commandCost)
        for (const change of preview.changes) next.entityLayers[change.id] = change.toLayerId
        break
      }
      case 'removeLayer': {
        const preview = previewLayerRemoval(next, command.id, command.targetLayerId)
        if (preview.reason) throw new Error(preview.reason)
        consume(preview.commandCost)
        const floorId = next.userLayers[command.id].floorId
        for (const change of preview.changes) next.entityLayers[change.id] = change.toLayerId
        delete next.userLayers[command.id]
        orderedLayers(next, floorId).forEach((layer, order) => { layer.order = order })
        break
      }
      case 'setLayerLock': consume(1); requiredLayer(next, command.id).editLocked = command.locked; break
      default: throw new Error('图层组织批次不能混入内容或实体锁命令。')
    }
  }
  return next
}
function candidate(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options?: ApplyCommandsOptions): SceneDocument {
  if (commands[0]?.type === 'setSceneDisplay') {
    const next = cloneJson(scene)
    for (const command of commands) {
      if (command.type !== 'setSceneDisplay') throw new Error('显示设置须独立提交。')
      applySceneDisplayCommand(next, command)
    }
    return next
  }
  return commands.length && (category(commands[0]) === 'content' || category(commands[0]) === 'entity-lock') ? applyContent(scene, commands, context, options) : applyOrganization(scene, commands)
}
/** Detached mutable candidate; all-or-nothing native scene validation. Revision is committed by Workspace. */
export function applyCommands(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options?: ApplyCommandsOptions): SceneDocument {
  // Only the validator's independently owned immutable scene can reuse its
  // input proof. Caller-owned or cloned scenes still take the complete path.
  const source = validateSceneSnapshot(scene)
  if (!source.ok) throw new Error(`当前场景无效：${source.errors.map(issue => issue.message).join('；')}`)
  const next = candidate(source.document, checkedCommands(commands), context, options), result = validateSceneDocument(next)
  if (!result.ok) throw new Error(`事务未采用：${result.errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；')}`)
  return next
}
/** Certified immutable editor path; no-op batches preserve identity and consume no history. */
export function applySnapshotCommands(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options: ApplySnapshotCommandsOptions = {}): SceneDocument {
  const source = validateSceneSnapshot(scene)
  if (!source.ok) throw new Error(`当前场景无效：${source.errors.map(issue => issue.message).join('；')}`)
  const checked = checkedCommands(commands)
  if (!checked.length) return source.document
  const next = candidate(source.document, checked, context, options)
  if (options.preserveNoopIdentity !== false && equal(next, source.document)) return source.document
  const result = validateSceneSnapshot(next)
  if (!result.ok) throw new Error(`事务未采用：${result.errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；')}`)
  return result.document
}

export type PlacePropOptions = BasePlacePropOptions & { layerId?: string }
const placementOptionsSchema = z.object({ id: id.optional(), rotationDeg: angle.optional(), supportRef: surfaceRef.optional(), layerId: id.optional() }).strict()

/** Transient ghost only; adoption checks the explicit target layer and full dependencies again. */
export function createPlacedProp(scene: SceneDocument, definitionId: string, positionMm: PointMm, context: PreparationContext, options: PlacePropOptions = {}) {
  const issue = inspectJsonInput({ definitionId, positionMm, options })
  if (issue) throw new Error(`放置参数无效：${issue.message}`)
  const source = validateSceneSnapshot(scene)
  if (!source.ok) throw new Error(`当前场景无效：${source.errors.map(issue => issue.message).join('；')}`)
  const checked = placementOptionsSchema.safeParse(options)
  if (!checked.success) throw new Error(`放置参数无效：${checked.error.issues.map(issue => issue.message).join('；')}`)
  const { layerId, ...placementOptions } = checked.data
  const target = layerId === undefined ? orderedLayers(source.document)[0] : assertLayerUnlocked(source.document, layerId)
  if (!target) throw new Error('待放置物件须有现存目标图层。')
  assertLayerUnlocked(source.document, target.id)
  const domain = geometryDocumentForValidation(source.document, true)
  // The shared strict M1 geometry contract currently admits exactly one Floor.
  // Never strip or rearrange a caller's Floor map to make an invalid source fit.
  return createBasePlacedProp(domain, definitionId, positionMm, context, placementOptions)
}
