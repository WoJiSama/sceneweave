import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { applyCommandDraftV2, applySnapshotCommandsV2, createPlacedPropV2, isEntityEditLockedV2, type PlacePropOptionsV2, type SceneCommandV2 } from '../v2/commands'
import type { PointMm } from '../v2/types'
import { canvasBoundsCommandSchemaV3, applyCanvasBoundsCommandV3, type CanvasBoundsCommandV3 } from './canvas-bounds'
import { annotationCommandSchemasV3, applyAnnotationCommandV3, isAnnotationCommandV3, type AnnotationCommandV3 } from './annotations'
import { applyBuildingCommandV3, buildingCommandSchemasV3, isBuildingCommandV3, type BuildingCommandV3 } from './building'
import { applyOutdoorCommandV3, isOutdoorCommandV3, outdoorCommandSchemasV3, type OutdoorCommandV3 } from './outdoor'
import { geometryDocumentForValidationV3, geometryIdentityIdsV3 } from './domain'
import { toGeometryDocumentV2 } from './geometry-view'
import { entitiesInLayerV3, enumerateLayerEntitiesV3, orderedLayersV3, previewLayerMoveV3, previewLayerRemovalV3 } from './layers'
import { validateSceneV3 } from './schema'
import { validateSceneSnapshotV3 } from './snapshots'
import { COMMAND_LIMIT_V3, LAYER_ENTITY_COLLECTIONS_V3, USER_LAYER_LIMIT_V3, type SceneDocumentV3 } from './types'

export type SceneCommandV3 =
  | Exclude<SceneCommandV2, { type: 'addProp' | 'setEditLock' }>
  | (Extract<SceneCommandV2, { type: 'addProp' }> & { layerId?: string })
  | BuildingCommandV3
  | AnnotationCommandV3
  | CanvasBoundsCommandV3
  | OutdoorCommandV3
  | { type: 'setEditLock'; kind: 'vertex' | 'room' | 'wall' | 'opening' | 'note' | 'region' | 'prop' | 'prefabInstance' | 'scatterGroup' | 'terrainArea' | 'terrainEdge' | 'terrainConnection' | 'path'; id: string; locked: boolean }
  | { type: 'createLayer'; id: string; floorId: string; name: string }
  | { type: 'renameLayer'; id: string; name: string }
  | { type: 'setLayerLock'; id: string; locked: boolean }
  | { type: 'reorderLayers'; floorId: string; ids: string[] }
  | { type: 'moveEntitiesToLayer'; ids: string[]; layerId: string }
  | { type: 'removeLayer'; id: string; targetLayerId?: string }

export interface ApplyCommandsOptionsV3 {
  /** Internal synchronous observer: inspect immediately; never mutate or retain the draft. */
  onOutdoorDraft?: (draft: Readonly<SceneDocumentV3>, command: Readonly<OutdoorCommandV3>) => void
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
export const sceneCommandSchemaV3 = z.discriminatedUnion('type', [
  ...buildingCommandSchemasV3,
  ...annotationCommandSchemasV3,
  ...outdoorCommandSchemasV3,
  canvasBoundsCommandSchemaV3,
  z.object({ type: z.literal('moveVertex'), id, positionMm: point }).strict(),
  z.object({ type: z.literal('setWallThickness'), id, thicknessMm: positive }).strict(),
  z.object({ type: z.literal('reverseWall'), id }).strict(),
  z.object({ type: z.literal('splitWall'), id, positionMm: point, newVertexId: id, newWallId: id }).strict(),
  z.object({ type: z.literal('setSurfaceMaterial'), kind, id, materialRef: version }).strict(),
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
  z.object({ type: z.literal('reorderLayers'), floorId: id, ids: uniqueIds.max(USER_LAYER_LIMIT_V3) }).strict(),
  z.object({ type: z.literal('moveEntitiesToLayer'), ids: uniqueIds.min(1).max(COMMAND_LIMIT_V3), layerId: id }).strict(),
  z.object({ type: z.literal('removeLayer'), id, targetLayerId: id.optional() }).strict(),
])
export const commandsSchemaV3 = z.array(sceneCommandSchemaV3).max(COMMAND_LIMIT_V3, '单次事务最多 256 个操作')
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a), bk = Object.keys(b)
  return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
const layerTypes = new Set(['createLayer', 'renameLayer', 'reorderLayers', 'moveEntitiesToLayer', 'removeLayer'])
const category = (command: SceneCommandV3) => command.type === 'setEditLock' ? 'entity-lock' : command.type === 'setLayerLock' ? 'layer-lock' : layerTypes.has(command.type) ? 'organization' : 'content'
const needsOutdoorExpansion = (scene: SceneDocumentV3, command: SceneCommandV3): command is OutdoorCommandV3 => isOutdoorCommandV3(command)
  && ((command.type !== 'deleteProp' && command.type !== 'updateProp' && command.type !== 'replacePropAppearance') || Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === command.id)))

function checkedCommands(commands: readonly SceneCommandV3[]): SceneCommandV3[] {
  if (!Array.isArray(commands) || commands.length > COMMAND_LIMIT_V3) throw new Error('编辑指令必须是数组，单次事务最多 256 个操作。')
  const issue = inspectJsonInput(commands)
  if (issue) throw new Error(`编辑指令无效：${issue.message}`)
  const checked = commandsSchemaV3.safeParse(commands)
  if (!checked.success) throw new Error(`编辑指令无效：${checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；')}`)
  const parsed = checked.data as SceneCommandV3[]
  if (new Set(parsed.map(category)).size > 1) throw new Error('图层组织、内容编辑、实体锁和图层锁须分别独立提交；不能同批解锁后编辑。')
  return parsed
}
function requiredLayer(scene: SceneDocumentV3, id: string) {
  const layer = own(scene.userLayers, id)
  if (!layer) throw new Error(`用户图层不存在：${id}。`)
  return layer
}
function assertLayerUnlocked(scene: SceneDocumentV3, id: string) {
  const layer = requiredLayer(scene, id)
  if (layer.editLocked) throw new Error(`用户图层已锁定：${id}；请先单独解锁。`)
  return layer
}
function restoreActualLocks(next: SceneDocumentV3, source: SceneDocumentV3, explicit: ReadonlyMap<string, boolean>) {
  const actual = new Map(enumerateLayerEntitiesV3(source).map(entity => [entity.id, entity.editLocked]))
  for (const collection of LAYER_ENTITY_COLLECTIONS_V3) for (const entity of Object.values(next[collection])) {
    if (explicit.has(entity.id)) entity.editLocked = explicit.get(entity.id)!
    else if (actual.has(entity.id)) entity.editLocked = actual.get(entity.id)!
  }
}
function applyLegacyContent(scene: SceneDocumentV3, commands: readonly SceneCommandV3[], draftOnly = false): SceneDocumentV3 {
  const memberships = { ...scene.entityLayers }, explicitLocks = new Map<string, boolean>(), legacy: SceneCommandV2[] = []
  for (const command of commands) {
    if (command.type === 'addProp') {
      const target = command.layerId ?? orderedLayersV3(scene, command.floorId)[0]?.id
      if (!target) throw new Error('新物件必须选择同 Floor 的现存用户图层。')
      const layer = assertLayerUnlocked(scene, target)
      if (layer.floorId !== command.floorId) throw new Error('新物件与目标图层必须同 Floor。')
      memberships[command.id] = target
      const { layerId: _layerId, ...base } = command
      legacy.push(base)
    } else if (command.type === 'setEditLock') {
      const targetLayer = memberships[command.id]
      if (!targetLayer) throw new Error(`实体图层归属不存在：${command.id}。`)
      assertLayerUnlocked(scene, targetLayer)
      explicitLocks.set(command.id, command.locked); legacy.push(command as SceneCommandV2)
    } else if (category(command) === 'content') {
      legacy.push(command as SceneCommandV2)
      if (command.type === 'copyProp') memberships[command.newId] = memberships[command.id]
      else if (command.type === 'splitWall') { memberships[command.newVertexId] = memberships[command.id]; memberships[command.newWallId] = memberships[command.id] }
    } else throw new Error('此批次不能混入图层组织命令。')
  }
  const result = draftOnly
    ? applyCommandDraftV2(structuredClone(geometryDocumentForValidationV3(scene, true)), legacy)
    : applySnapshotCommandsV2(toGeometryDocumentV2(scene, { effectiveLocks: true }), legacy)
  const { schemaVersion: _version, ...domain } = structuredClone(result)
  const next: SceneDocumentV3 = { ...domain, schemaVersion: 3, userLayers: structuredClone(scene.userLayers), entityLayers: {} }
  const present = new Set(enumerateLayerEntitiesV3(next).map(entity => entity.id))
  for (const id of present) if (Object.hasOwn(memberships, id)) next.entityLayers[id] = memberships[id]
  // Re-generated members inherit the fixed container layer. Suppressed records
  // remain in the group and never acquire independent membership entries.
  for (const group of [...Object.values(next.prefabInstances), ...Object.values(next.scatterGroups)]) {
    for (const member of Object.values(group.members)) if (member.propId !== null) next.entityLayers[member.propId] = next.entityLayers[group.id]
  }
  restoreActualLocks(next, scene, explicitLocks)
  return next
}
function applyContent(scene: SceneDocumentV3, commands: readonly SceneCommandV3[], options?: ApplyCommandsOptionsV3): SceneDocumentV3 {
  // Keep the certified legacy path unchanged for the common prop-only workload.
  if (commands[0]?.type === 'setEditLock') {
    const next = structuredClone(scene), collections = { vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', note: 'notes', region: 'regions', prop: 'props', prefabInstance: 'prefabInstances', scatterGroup: 'scatterGroups', terrainArea: 'terrainAreas', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections', path: 'paths' } as const
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
  if (!commands.some(command => isBuildingCommandV3(command) || isAnnotationCommandV3(command) || needsOutdoorExpansion(scene, command) || command.type === 'setCanvasBounds')) return applyLegacyContent(scene, commands)
  let next = structuredClone(scene), cost = 0, pending: SceneCommandV3[] = []
  const consume = (amount: number) => { cost += amount; if (cost > COMMAND_LIMIT_V3) throw new Error('展开后的整体事务超过256条操作预算，不能拆批绕过。') }
  const flush = () => { if (pending.length) { consume(pending.length); next = applyLegacyContent(next, pending, true); pending = [] } }
  for (const command of commands) {
    if (needsOutdoorExpansion(next, command)) { flush(); consume(applyOutdoorCommandV3(next, command).commandCost); options?.onOutdoorDraft?.(next, command) }
    else if (isBuildingCommandV3(command)) { flush(); consume(applyBuildingCommandV3(next, command).commandCost) }
    else if (isAnnotationCommandV3(command)) { flush(); applyAnnotationCommandV3(next, command); consume(1) }
    else if (command.type === 'setCanvasBounds') { flush(); consume(applyCanvasBoundsCommandV3(next, command).commandCost) }
    else pending.push(command)
  }
  flush()
  return next
}
function applyOrganization(scene: SceneDocumentV3, commands: readonly SceneCommandV3[]): SceneDocumentV3 {
  const next = structuredClone(scene)
  let cost = 0
  const consume = (amount: number) => { cost += amount; if (cost > COMMAND_LIMIT_V3) throw new Error('展开后的整体事务超过 256 条操作预算，不能拆批绕过。') }
  for (const command of commands) {
    switch (command.type) {
      case 'createLayer': {
        consume(1)
        if (!Object.hasOwn(next.floors, command.floorId)) throw new Error('新图层所在 Floor 不存在。')
        if (Object.keys(next.userLayers).length >= USER_LAYER_LIMIT_V3) throw new Error('用户图层总数最多 128，不能继续新建。')
        if (Object.hasOwn(next.userLayers, command.id) || geometryIdentityIdsV3(next).has(command.id)) throw new Error('新图层须使用未占用的独立 ID。')
        next.userLayers[command.id] = { id: command.id, floorId: command.floorId, name: command.name, order: orderedLayersV3(next, command.floorId).length, editLocked: false }
        break
      }
      case 'renameLayer': consume(1); assertLayerUnlocked(next, command.id).name = command.name; break
      case 'reorderLayers': {
        consume(1)
        const layers = orderedLayersV3(next, command.floorId)
        if (!Object.hasOwn(next.floors, command.floorId) || command.ids.length !== layers.length || command.ids.some(id => !layers.some(layer => layer.id === id))) throw new Error('图层重排必须列出同 Floor 的全部图层且恰好一次。')
        const moved = command.ids.filter((id, index) => next.userLayers[id].order !== index)
        const changedIds = moved.flatMap(id => entitiesInLayerV3(next, id))
        for (const id of moved) assertLayerUnlocked(next, id)
        if (changedIds.length) {
          const domain = toGeometryDocumentV2(next, { effectiveLocks: true })
          // Preview uses the same dependency-aware lock affordance; a locked
          // member cannot be visually reordered by changing its layer instead.
          const locked = changedIds.filter(id => isEntityEditLockedV2(domain, id))
          if (locked.length) throw new Error(`图层重排涉及已锁定实体或依赖：${locked.join('、')}。`)
        }
        command.ids.forEach((id, order) => { next.userLayers[id].order = order })
        break
      }
      case 'moveEntitiesToLayer': {
        const preview = previewLayerMoveV3(next, command.ids, command.layerId)
        if (preview.reason) throw new Error(preview.reason)
        consume(preview.commandCost)
        for (const change of preview.changes) next.entityLayers[change.id] = change.toLayerId
        break
      }
      case 'removeLayer': {
        const preview = previewLayerRemovalV3(next, command.id, command.targetLayerId)
        if (preview.reason) throw new Error(preview.reason)
        consume(preview.commandCost)
        const floorId = next.userLayers[command.id].floorId
        for (const change of preview.changes) next.entityLayers[change.id] = change.toLayerId
        delete next.userLayers[command.id]
        orderedLayersV3(next, floorId).forEach((layer, order) => { layer.order = order })
        break
      }
      case 'setLayerLock': consume(1); requiredLayer(next, command.id).editLocked = command.locked; break
      default: throw new Error('图层组织批次不能混入内容或实体锁命令。')
    }
  }
  return next
}
function candidate(scene: SceneDocumentV3, commands: readonly SceneCommandV3[], options?: ApplyCommandsOptionsV3): SceneDocumentV3 {
  return commands.length && (category(commands[0]) === 'content' || category(commands[0]) === 'entity-lock') ? applyContent(scene, commands, options) : applyOrganization(scene, commands)
}
/** Detached mutable candidate; all-or-nothing native v3 validation. Revision is committed by Workspace. */
export function applyCommandsV3(scene: SceneDocumentV3, commands: readonly SceneCommandV3[], options?: ApplyCommandsOptionsV3): SceneDocumentV3 {
  const source = validateSceneV3(scene)
  if (!source.ok) throw new Error(`当前场景无效：${source.errors.map(issue => issue.message).join('；')}`)
  const next = candidate(source.document, checkedCommands(commands), options), result = validateSceneV3(next)
  if (!result.ok) throw new Error(`事务未采用：${result.errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；')}`)
  return next
}
/** Certified immutable editor path; no-op batches preserve identity and consume no history. */
export function applySnapshotCommandsV3(scene: SceneDocumentV3, commands: readonly SceneCommandV3[]): SceneDocumentV3 {
  const source = validateSceneSnapshotV3(scene)
  if (!source.ok) throw new Error(`当前场景无效：${source.errors.map(issue => issue.message).join('；')}`)
  const checked = checkedCommands(commands)
  if (!checked.length) return source.document
  const next = candidate(source.document, checked)
  if (equal(next, source.document)) return source.document
  const result = validateSceneSnapshotV3(next)
  if (!result.ok) throw new Error(`事务未采用：${result.errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；')}`)
  return result.document
}

export type PlacePropOptionsV3 = PlacePropOptionsV2 & { layerId?: string }
const placementOptionsV3 = z.object({ id: id.optional(), rotationDeg: angle.optional(), supportRef: surfaceRef.optional(), layerId: id.optional() }).strict()

/** Transient ghost only; adoption checks the explicit target layer and full dependencies again. */
export function createPlacedPropV3(scene: SceneDocumentV3, definitionId: string, positionMm: PointMm, options: PlacePropOptionsV3 = {}) {
  const issue = inspectJsonInput({ definitionId, positionMm, options })
  if (issue) throw new Error(`放置参数无效：${issue.message}`)
  const checked = placementOptionsV3.safeParse(options)
  if (!checked.success) throw new Error(`放置参数无效：${checked.error.issues.map(issue => issue.message).join('；')}`)
  const { layerId, ...placementOptions } = checked.data
  const target = layerId === undefined ? orderedLayersV3(scene)[0] : assertLayerUnlocked(scene, layerId)
  if (!target) throw new Error('待放置物件须有现存目标图层。')
  assertLayerUnlocked(scene, target.id)
  const domain = toGeometryDocumentV2(scene, { effectiveLocks: true })
  // The shared strict M1 geometry contract currently admits exactly one Floor.
  // Never strip or rearrange a caller's Floor map to make an invalid source fit.
  return createPlacedPropV2(domain, definitionId, positionMm, placementOptions)
}

export { toGeometryDocumentV2 } from './geometry-view'
