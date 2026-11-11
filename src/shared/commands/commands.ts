import { floorCommandSchemas, isFloorCommand, applyFloorCommand, type FloorCommand } from '../floors/commands.js'
import { pathAttachmentCommandSchemas, isPathAttachmentCommand, applyPathAttachmentCommand, type PathAttachmentCommand } from '../path-attachments/commands.js'
import { followPathAttachments } from '../path-attachments/state.js'
import { createPathAttachmentTransactionBudget, pathAttachmentRowsChanged, mayMutatePathAttachments, type PathAttachmentTransactionBudget } from '../path-attachments/transaction-budget.js'
import { withAdditionalExecutionWorkObserver } from '../budget/task-budget.js'
import type { HistoryIdentity } from '../model/history.js'
import { assertCommandBudget, commandSelectionLimit, isManualTransactionBudget, measureCommandBudget, parseCommandBudgetProfile, type CommandBudgetMetadata, type CommandBudgetProfile } from '../budget/command-budget.js'
import { aggregateRepresentationCommandSchemas, applyAggregateRepresentationCommand, isAggregateRepresentationCommand, type AggregateRepresentationCommand } from '../aggregates/commands.js'
import { reconcileAggregateMembers } from '../aggregates/state.js'
import { applyNaturalAggregateCommand, isNaturalAggregateCommand, naturalAggregateCommandSchema, type NaturalAggregateCommand } from '../aggregates/natural-transform.js'
import { detachChangedOutputs } from '../terrain-generation/integrity.js'
import { pauseChangedCompositions } from '../terrain-generation/composition-lifecycle.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { z } from 'zod'
import { applyDecorationCommand, decorationCommandSchemas, isDecorationCommand, reconcileDecorationMembers, assertDecorationMemberUnlocked, type DecorationCommand } from '../decorations/commands.js'
import { applySurfaceRuleCommand, isSurfaceRuleCommand, surfaceRuleCommandSchemas, type SurfaceRuleCommand } from '../surface-rules/commands.js'
import { applyVisualCommand, isVisualCommand, visualCommandSchemas, type VisualCommand } from '../visual/commands.js'
import type { PreparationContext } from '../ports/runtime.js'
import { cloneJson, inspectJsonInput } from '../validation/json.js'
import { applyCommandDraft, createBasePlacedProp, isEntityEditLocked, type BasePlacePropOptions, type BaseSceneCommand } from './base.js'
import type { PointMm } from '../model/scene.js'
import type { AppearanceGraph, CompositionContent } from '../model/appearance.js'
import { certifyCompositionDraft } from '../validation/content.js'
import { canvasBoundsCommandSchema, applyCanvasBoundsCommand, type CanvasBoundsCommand } from './canvas-bounds.js'
import { sceneDisplayCommandSchema, applySceneDisplayCommand, type SceneDisplayCommand } from './scene-display.js'
import { sceneBackgroundCommandSchema, applySceneBackgroundCommand, type SceneBackgroundCommand } from './scene-background.js'
import { annotationCommandSchemas, applyAnnotationCommand, isAnnotationCommand, type AnnotationCommand } from './annotations.js'
import { applyBuildingCommand, buildingCommandSchemasForBudget, isBuildingCommand, type BuildingCommand } from './building.js'
import { applyOutdoorCommand, isOutdoorCommand, outdoorCommandSchemas, outdoorDependencies, type OutdoorCommand } from './outdoor.js'
import { refreshScene5TransitionsAfterPhysicalEdit } from '../visual/derived-transitions.js'
import { geometryDocumentForValidation, geometryIdentityIds } from './domain.js'
import { entitiesInLayer, enumerateLayerEntities, orderedLayers, previewLayerMove, previewLayerRemoval } from './layers.js'
import { validateSceneDocument } from '../validation/scene.js'
import { tryApplyPropUpdatesSnapshot, validateSceneDerivationSnapshot, validateSceneSnapshot } from '../validation/snapshots.js'
import { COMMAND_LIMIT, LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS, USER_LAYER_LIMIT, type SceneDocument } from '../model/scene.js'
import type { TransactionExecutionScope } from '../transaction/receipt.js'

export type SceneCommand =
  | Exclude<BaseSceneCommand, { type: 'addProp' | 'setEditLock' }>
  | (Extract<BaseSceneCommand, { type: 'addProp' }> & { layerId?: string })
  | BuildingCommand
  | FloorCommand
  | PathAttachmentCommand
  | { type: 'initializeStructureIdentity' }
  | AggregateRepresentationCommand
  | NaturalAggregateCommand
  | AnnotationCommand
  | CanvasBoundsCommand
  | SceneDisplayCommand
  | SceneBackgroundCommand
  | { type: 'renameScene'; title: string }
  | OutdoorCommand
  | VisualCommand
  | DecorationCommand
  | SurfaceRuleCommand
  | { type: 'setEditLock'; kind: 'vertex' | 'room' | 'wall' | 'opening' | 'note' | 'region' | 'prop' | 'prefabInstance' | 'scatterGroup' | 'terrainArea' | 'terrainEdge' | 'terrainConnection' | 'path' | 'decoration' | 'decorationCluster' | 'surfaceRule' | 'pathAttachment'; id: string; locked: boolean }
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
  /** Fixed paint inputs from the fully validated composition; never a document certificate. */
  appearance?: AppearanceGraph
  /** Captured by the complete-composition owner; required by finite bind intent. */
  historyIdentity?: HistoryIdentity
  /** Explicit transaction envelope; omission retains the legacy expanded budget. */
  budget?: CommandBudgetProfile
  /** Internal complete-composition semantics for explicit group rotations. */
  fixedUprightPropIds?: ReadonlySet<string>
  /** Complete accounting evidence after the owning composition synchronizes
   * fixed sources. Both strict snapshots must match the actual scene delta. */
  budgetContent?: { before: CompositionContent; after: () => CompositionContent }
  /** Internal synchronous observer: inspect immediately; never mutate or retain the draft. */
  onOutdoorDraft?: (draft: Readonly<SceneDocument>, command: Readonly<OutdoorCommand | VisualCommand>) => void
  /** Includes base/building edits and runs after generation records are reconciled. */
  onSceneDraft?: (draft: Readonly<SceneDocument>, command: Readonly<SceneCommand>, commandCost: number, scope?: TransactionExecutionScope) => void
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
function sceneSchemaForBudget(budget?: CommandBudgetProfile): z.ZodType<SceneCommand> {
  return z.discriminatedUnion('type', [
    ...buildingCommandSchemasForBudget(budget),
    ...aggregateRepresentationCommandSchemas,
    naturalAggregateCommandSchema,
    ...annotationCommandSchemas,
    ...outdoorCommandSchemas,
    ...visualCommandSchemas,
    ...decorationCommandSchemas,
    ...surfaceRuleCommandSchemas,
    ...floorCommandSchemas,
    ...pathAttachmentCommandSchemas,
    z.object({ type: z.literal('initializeStructureIdentity') }).strict(),
    canvasBoundsCommandSchema,
    sceneDisplayCommandSchema,
    sceneBackgroundCommandSchema,
    z.object({ type: z.literal('renameScene'), title: z.string().trim().min(1).max(120) }).strict(),
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
    z.object({ type: z.literal('setEditLock'), kind: z.enum(['vertex', 'room', 'wall', 'opening', 'note', 'region', 'prop', 'prefabInstance', 'scatterGroup', 'terrainArea', 'terrainEdge', 'terrainConnection', 'path', 'decoration', 'decorationCluster', 'surfaceRule', 'pathAttachment']), id, locked: z.boolean() }).strict(),
    z.object({ type: z.literal('transformPrefab'), id, anchorMm: point.optional(), rotationDeg: angle.optional() }).strict(),
    z.object({ type: z.literal('unpackPrefab'), id }).strict(),
    z.object({ type: z.literal('updateProp'), id, changes: z.object({ positionMm: point.optional(), rotationDeg: angle.optional() }).strict() }).strict(),
    z.object({ type: z.literal('replacePropAppearance'), id, definitionRef: version }).strict(),
    z.object({ type: z.literal('createLayer'), id, floorId: id, name }).strict(),
    z.object({ type: z.literal('renameLayer'), id, name }).strict(),
    z.object({ type: z.literal('setLayerLock'), id, locked: z.boolean() }).strict(),
    z.object({ type: z.literal('reorderLayers'), floorId: id, ids: uniqueIds.max(USER_LAYER_LIMIT) }).strict(),
    z.object({ type: z.literal('moveEntitiesToLayer'), ids: uniqueIds.min(1).max(commandSelectionLimit(budget)), layerId: id }).strict(),
    z.object({ type: z.literal('removeLayer'), id, targetLayerId: id.optional() }).strict(),
])
}
export const sceneCommandSchema = sceneSchemaForBudget()
const manualCommandSchemas = new Map<number, z.ZodType<SceneCommand>>()
export function sceneCommandSchemaForBudget(budget?: CommandBudgetProfile): z.ZodType<SceneCommand> {
  const limit = commandSelectionLimit(budget)
  if (limit === COMMAND_LIMIT) return sceneCommandSchema
  let schema = manualCommandSchemas.get(limit)
  if (!schema) { schema = sceneSchemaForBudget(budget); manualCommandSchemas.set(limit, schema) }
  return schema
}
export const commandsSchema = z.array(sceneCommandSchema).max(COMMAND_LIMIT, '单次事务最多 256 个操作')
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a), bk = Object.keys(b)
  return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
const layerTypes = new Set(['createLayer', 'renameLayer', 'reorderLayers', 'moveEntitiesToLayer', 'removeLayer'])
const category = (command: SceneCommand) => command.type === 'setSceneDisplay' || command.type === 'setSceneBackground' || command.type === 'renameScene' ? 'display' : command.type === 'setEditLock' ? 'entity-lock' : command.type === 'setLayerLock' ? 'layer-lock' : layerTypes.has(command.type) ? 'organization' : 'content'
const needsOutdoorExpansion = (scene: SceneDocument, command: SceneCommand): command is OutdoorCommand => isOutdoorCommand(command)
  && ((command.type !== 'deleteProp' && command.type !== 'updateProp' && command.type !== 'replacePropAppearance') || Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === command.id)))

/** Internal detached-candidate hook, shared with complete prefab/appearance edits. */
export function refreshNativeDerivedTransitions(before: SceneDocument, after: SceneDocument): number {
  const impact = refreshScene5TransitionsAfterPhysicalEdit(before, after)
  if (!impact.changedIds.length) return 0
  const byId = new Map(enumerateLayerEntities(before).map(entity => [entity.id, entity]))
  const dependencies = new Set([...outdoorDependencies(before, impact.affectedIds), ...outdoorDependencies(after, impact.affectedIds)])
  const locked = [...dependencies].filter(id => byId.get(id)?.editLocked || byId.has(id) && before.userLayers[before.entityLayers[id]]?.editLocked)
  if (locked.length) throw new Error(`物理修改影响锁定的派生支撑或遮挡依赖：${locked.join('、')}。`)
  return impact.commandCost
}

function checkedCommands(commands: readonly SceneCommand[], budget?: CommandBudgetProfile): SceneCommand[] {
  const limit = commandSelectionLimit(budget)
  if (!Array.isArray(commands) || commands.length > limit) throw new Error(`编辑指令必须是数组，单次事务最多 ${limit} 个操作。`)
  const issue = inspectJsonInput(commands)
  if (issue) throw new Error(`编辑指令无效：${issue.message}`)
  const checked = (limit === COMMAND_LIMIT ? commandsSchema : z.array(sceneCommandSchemaForBudget(budget)).max(limit)).safeParse(commands)
  if (!checked.success) throw new Error(`编辑指令无效：${checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；')}`)
  const parsed = checked.data as SceneCommand[]
  if (parsed.some(command => command.type === 'bindPathAttachment' || command.type === 'initializeStructureIdentity') && parsed.length !== 1) throw new Error('建立结构身份或门路绑定须独立预览采用；绑定命令内部一次修改道路与关系。')
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
  for (const collection of [...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS]) for (const entity of Object.values(next[collection] ?? {})) {
    if (explicit.has(entity.id)) entity.editLocked = explicit.get(entity.id)!
    else if (actual.has(entity.id)) entity.editLocked = actual.get(entity.id)!
  }
}
function applyNativeContent(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options?: ApplyCommandsOptions): SceneDocument {
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
  const next = applyCommandDraft(cloneJson(geometryDocumentForValidation(scene, true)), baseCommands, context, options?.fixedUprightPropIds)
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
  for (const collection of [...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS]) {
    const a = before[collection] ?? {}, b = after[collection] ?? {}
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
function applyContent(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options?: ApplyCommandsOptions, relationBudget?: PathAttachmentTransactionBudget): SceneDocument {
  // Entity locks are an independent transaction category; content cannot unlock itself.
  if (commands[0]?.type === 'setEditLock') {
    const next = cloneJson(scene), collections = { vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', note: 'notes', region: 'regions', prop: 'props', prefabInstance: 'prefabInstances', scatterGroup: 'scatterGroups', terrainArea: 'terrainAreas', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections', path: 'paths', decoration: 'decorations', decorationCluster: 'decorationClusters', surfaceRule: 'surfaceRules', pathAttachment: 'pathAttachments' } as const
    let cost = 0
    for (const command of commands) {
      if (command.type !== 'setEditLock') throw new Error('编辑锁须单独提交。')
      const beforeTerrain = cloneJson(next)
      const entity = own((next[collections[command.kind]] ?? {}) as Record<string, { id: string; editLocked: boolean }>, command.id)
      if (!entity) throw new Error('编辑锁目标不存在或类型不符。')
      const lockLayerId = command.kind === 'pathAttachment' ? next.entityLayers[next.pathAttachments![command.id].pathId] : next.entityLayers[command.id]
      assertLayerUnlocked(next, lockLayerId)
      if (entity.editLocked !== command.locked) {
        assertDecorationMemberUnlocked(next, command.id)
        if (command.kind === 'prop') {
          const parents = [...Object.values(next.prefabInstances), ...Object.values(next.scatterGroups)].filter(group => Object.values(group.members).some(member => member.propId === command.id))
          if (parents.some(group => group.editLocked || next.userLayers[next.entityLayers[group.id]].editLocked)) throw new Error('物件所属组合、散布或其图层已锁定，不能修改成员编辑锁。')
        }
        entity.editLocked = command.locked
      }
      if (beforeTerrain) {
        reconcileDecorationMembers(beforeTerrain, next)
        refreshNativeDerivedTransitions(beforeTerrain, next)
        detachChangedOutputs(beforeTerrain, next)
        pauseChangedCompositions(beforeTerrain, next)
        // Reconcile and charge every transition, including changes later undone
        // in this same batch. A repeated lock request still consumes one step.
        const commandCost = Math.max(1, terrainCommandCost(beforeTerrain, next).total)
        cost += commandCost
        if (!options?.budget && !relationBudget && cost > COMMAND_LIMIT) throw new Error('锁与生成记录累计展开超过256。')
        options?.onSceneDraft?.(next, command, commandCost)
      }
    }
    if (!options?.budget && !relationBudget?.active && cost > COMMAND_LIMIT) throw new Error('锁与生成记录累计展开超过256。')
    return next
  }
  let next = cloneJson(scene), cost = 0
  const consume = (amount: number) => { cost += amount; if (!options?.budget && !relationBudget && cost > COMMAND_LIMIT) throw new Error('展开后的整体事务超过256条操作预算，不能拆批绕过。') }
  for (const command of commands) {
    const beforeTerrain=cloneJson(next)
    let commandCost: number
    let scope: TransactionExecutionScope | undefined
    const derivedHandled = isVisualCommand(command) || needsOutdoorExpansion(next, command) || isBuildingCommand(command) || isNaturalAggregateCommand(command)
    if (command.type === 'initializeStructureIdentity') {
      if (!options?.historyIdentity) throw new Error('建立当前结构身份必须从完整工程事务准备。')
      commandCost = 1
    } else if (isFloorCommand(command)) {
      commandCost = applyFloorCommand(next, command, { appearance: options?.appearance }).commandCost
    } else if (isPathAttachmentCommand(command)) {
      const impact = applyPathAttachmentCommand(next, command, options?.historyIdentity)
      commandCost = impact.commandCost
    } else if (isAggregateRepresentationCommand(command)) {
      commandCost = applyAggregateRepresentationCommand(next, command).commandCost
    } else if (isNaturalAggregateCommand(command)) {
      commandCost = applyNaturalAggregateCommand(next, command, { fixedUprightIds: options?.fixedUprightPropIds }).commandCost
    } else if (isSurfaceRuleCommand(command)) {
      commandCost = applySurfaceRuleCommand(next, command, context, options?.appearance, options?.budget).commandCost
    } else if (isDecorationCommand(command)) {
      commandCost = applyDecorationCommand(next, command, context, options?.appearance, options?.budget).commandCost
    } else if (isVisualCommand(command)) {
      commandCost = applyVisualCommand(next, command, context, options?.budget).commandCost
      options?.onOutdoorDraft?.(next, command)
    } else if (needsOutdoorExpansion(next, command)) {
      let attachmentCost = 0
      const attachmentDependencies = new Set<string>()
      if (command.type === 'deleteOutdoorEntity' && command.kind === 'path') {
        // Deleting a road owns its finite relation closure. Detach while the
        // complete path/door dependencies still exist, so the same lock checks
        // run before the private draft loses either authoritative record.
        for (const row of Object.values(next.pathAttachments ?? {})) if (row.pathId === command.id) {
          const detached = applyPathAttachmentCommand(next, { type: 'detachPathAttachment', id: row.id })
          attachmentCost += detached.commandCost; attachmentDependencies.add(row.id)
          detached.dependencyIds.forEach(id => attachmentDependencies.add(id))
        }
      }
      const impact = applyOutdoorCommand(next, command, context, options?.budget)
      commandCost = impact.commandCost + attachmentCost
      scope = { owner: 'outdoor', affectedIds: [...new Set([...impact.affectedIds, ...attachmentDependencies])].sort() }
      options?.onOutdoorDraft?.(next, command)
    } else if (isBuildingCommand(command)) {
      const impact = applyBuildingCommand(next, command, options?.fixedUprightPropIds)
      commandCost = impact.commandCost
      scope = { owner: 'building', affectedIds: impact.affectedIds }
    }
    else if (isAnnotationCommand(command)) {
      const before = cloneJson(next)
      applyAnnotationCommand(next, command)
      commandCost = nativeCommandCost(before, next)
    } else if (command.type === 'setCanvasBounds') commandCost = applyCanvasBoundsCommand(next, command).commandCost
    else {
      const before = next
      next = applyNativeContent(next, [command], context, options)
      commandCost = nativeCommandCost(before, next)
    }
    if (Object.keys(beforeTerrain.pathAttachments ?? {}).length || Object.keys(next.pathAttachments ?? {}).length) {
      // Keep the complete physical calculation scene coherent before the
      // finite planner reads it; follow changes are reconciled again below.
      detachChangedOutputs(beforeTerrain, next)
      pauseChangedCompositions(beforeTerrain, next)
      next = followPathAttachments(beforeTerrain, next).document
    }
    let chargedCost = commandCost
    if (beforeTerrain) {
      if (!isDecorationCommand(command) && !isSurfaceRuleCommand(command)) reconcileDecorationMembers(beforeTerrain, next)
      if (!derivedHandled) commandCost += refreshNativeDerivedTransitions(beforeTerrain, next)
      detachChangedOutputs(beforeTerrain, next)
      pauseChangedCompositions(beforeTerrain, next)
      reconcileAggregateMembers(beforeTerrain, next)
      const expanded = terrainCommandCost(beforeTerrain, next)
      // Charge no-ops together with every real per-command expansion. Comparing
      // only the final net delta loses earlier edits and repeated requests.
      chargedCost = Math.max(1, commandCost, expanded.items.physicalAndVisual) + expanded.total - expanded.items.physicalAndVisual
      consume(chargedCost)
    } else {
      consume(commandCost)
    }
    options?.onSceneDraft?.(next, command, chargedCost, scope)
  }
  if (!options?.budget && !relationBudget?.active && cost > COMMAND_LIMIT) throw new Error('展开后的整体事务超过256条操作预算，不能拆批绕过。')
  return next
}
function applyOrganization(scene: SceneDocument, commands: readonly SceneCommand[], options?: ApplyCommandsOptions): SceneDocument {
  const next = cloneJson(scene)
  let cost = 0
  const consume = (amount: number) => { cost += amount; if (!options?.budget && cost > COMMAND_LIMIT) throw new Error('展开后的整体事务超过 256 条操作预算，不能拆批绕过。') }
  const consumeCommand = (amount: number) => consume(Math.max(1, amount))
  for (const command of commands) {
    const beforeCost = cost
    const beforeTerrain=cloneJson(next)
    switch (command.type) {
      case 'createLayer': {
        consumeCommand(1)
        if (!Object.hasOwn(next.floors, command.floorId)) throw new Error('新图层所在 Floor 不存在。')
        if (Object.keys(next.userLayers).length >= USER_LAYER_LIMIT) throw new Error('用户图层总数最多 128，不能继续新建。')
        if (Object.hasOwn(next.userLayers, command.id) || geometryIdentityIds(next).has(command.id)) throw new Error('新图层须使用未占用的独立 ID。')
        next.userLayers[command.id] = { id: command.id, floorId: command.floorId, name: command.name, order: orderedLayers(next, command.floorId).length, editLocked: false }
        break
      }
      case 'renameLayer': consumeCommand(1); assertLayerUnlocked(next, command.id).name = command.name; break
      case 'reorderLayers': {
        consumeCommand(1)
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
        const preview = previewLayerMove(next, command.ids, command.layerId, options?.budget)
        if (preview.reason) throw new Error(preview.reason)
        consumeCommand(preview.commandCost)
        for (const change of preview.changes) next.entityLayers[change.id] = change.toLayerId
        break
      }
      case 'removeLayer': {
        const preview = previewLayerRemoval(next, command.id, command.targetLayerId, options?.budget)
        if (preview.reason) throw new Error(preview.reason)
        consumeCommand(preview.commandCost)
        const floorId = next.userLayers[command.id].floorId
        for (const change of preview.changes) next.entityLayers[change.id] = change.toLayerId
        delete next.userLayers[command.id]
        orderedLayers(next, floorId).forEach((layer, order) => { layer.order = order })
        break
      }
      case 'setLayerLock': consumeCommand(1); requiredLayer(next, command.id).editLocked = command.locked; break
      default: throw new Error('图层组织批次不能混入内容或实体锁命令。')
    }
    if(beforeTerrain) { detachChangedOutputs(beforeTerrain,next); pauseChangedCompositions(beforeTerrain,next); const all=terrainCommandCost(beforeTerrain,next); consume(all.total-all.items.physicalAndVisual) }
    options?.onSceneDraft?.(next, command, cost - beforeCost)
  }
  return next
}
function candidate(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options?: ApplyCommandsOptions, relationBudget?: PathAttachmentTransactionBudget): SceneDocument {
  if (commands[0]?.type === 'setSceneDisplay' || commands[0]?.type === 'setSceneBackground' || commands[0]?.type === 'renameScene') {
    const next = cloneJson(scene)
    for (const command of commands) {
      if (command.type === 'renameScene') next.title = command.title
      else if (command.type === 'setSceneDisplay') applySceneDisplayCommand(next, command)
      else if (command.type === 'setSceneBackground') applySceneBackgroundCommand(next, command)
      else throw new Error('工程设置须独立提交。')
      options?.onSceneDraft?.(next, command, 1)
    }
    return next
  }
  return commands.length && (category(commands[0]) === 'content' || category(commands[0]) === 'entity-lock') ? applyContent(scene, commands, context, options, relationBudget) : applyOrganization(scene, commands, options)
}

/** An internal meter observes real owned steps before a read-only callback can
 * alter them. Complete owners still synchronize identity/source metadata first. */
function pathAttachmentBudgetScope(scene: SceneDocument, commands: readonly SceneCommand[], options?: ApplyCommandsOptions) {
  if (!mayMutatePathAttachments(scene, commands)) return null
  const meter = createPathAttachmentTransactionBudget()
  let previousDocument = scene
  let previousContent = options?.budgetContent ? certifyCompositionDraft(options.budgetContent.before) : undefined
  if (previousContent && !equal(previousContent.document, scene)) throw new Error('门路事务的完整计量基线与实际场景不一致。')
  const scoped: ApplyCommandsOptions = { ...options,
    ...(options?.onOutdoorDraft ? { onOutdoorDraft: (draft: Readonly<SceneDocument>, command: Readonly<OutdoorCommand | VisualCommand>) => {
      const expected = canonicalDraft(draft)
      options.onOutdoorDraft!(draft, command)
      if (!equal(expected, draft)) throw new Error('事务观察回调只能读取候选，不能修改场景。')
    } } : {}),
    onSceneDraft: (draft, command, cost, scope) => {
      const captured = canonicalDraft(draft)
      const changed = pathAttachmentRowsChanged(previousDocument, captured)
      if ((meter.active || changed) && commands.length > COMMAND_LIMIT) throw new Error('门路事务输入指令最多256条，不能借调用方档位扩大。')
      meter.activate(changed)
      options?.onSceneDraft?.(draft, command, cost, scope)
      if (!equal(captured, draft)) throw new Error('事务观察回调只能读取候选，不能修改场景。')
      const content = options?.budgetContent ? certifyCompositionDraft(options.budgetContent.after()) : undefined
      if (content && !equal(content.document, captured)) throw new Error('门路事务的完整计量结果与实际场景不一致。')
      meter.step(previousDocument, captured, previousContent && content ? { before: previousContent, after: content } : undefined)
      previousDocument = content?.document ?? captured; previousContent = content
    },
  }
  return { meter, options: scoped,
    run: <T>(callback: () => T) => withAdditionalExecutionWorkObserver(delta => meter.observeExecution(delta), callback),
    finish: (document: SceneDocument) => {
      if (!equal(previousDocument, document)) throw new Error('门路事务缺少实际完整步骤计量，未采用候选。')
      meter.finish()
    },
  }
}
const canonicalDraft = (draft: Readonly<SceneDocument>): SceneDocument => cloneJson(draft)
/** A full strict accounting pair must describe the exact materialized delta. */
function manualBudgetMetadata(before: SceneDocument, after: SceneDocument, options: ApplyCommandsOptions | undefined): CommandBudgetMetadata | undefined {
  if (!isManualTransactionBudget(options?.budget) || !options.budgetContent) return undefined
  const first = certifyCompositionDraft(options.budgetContent.before), second = certifyCompositionDraft(options.budgetContent.after())
  if (!equal(first.document, before) || !equal(second.document, after)) throw new Error('普通事务的完整内容计量与实际场景变化不一致；事务未采用。')
  return { before: first, after: second }
}
/** Detached mutable candidate; all-or-nothing native scene validation. Revision is committed by Workspace. */
export function applyCommands(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options?: ApplyCommandsOptions): SceneDocument {
  // Only the validator's independently owned immutable scene can reuse its
  // input proof. Caller-owned or cloned scenes still take the complete path.
  if (options?.budget) parseCommandBudgetProfile(options.budget)
  const source = validateSceneSnapshot(scene)
  if (!source.ok) throw new Error(`当前场景无效：${source.errors.map(issue => issue.message).join('；')}`)
  const checked = checkedCommands(commands, options?.budget), relationScope = pathAttachmentBudgetScope(source.document, checked, options)
  const next = relationScope ? relationScope.run(() => candidate(source.document, checked, context, relationScope.options, relationScope.meter))
    : candidate(source.document, checked, context, options)
  relationScope?.finish(next)
  const result = validateSceneDocument(next)
  if (!result.ok) throw new Error(`事务未采用：${result.errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；')}`)
  if (options?.budget) assertCommandBudget(options.budget, measureCommandBudget(source.document, next, manualBudgetMetadata(source.document, next, options), undefined, options.budget))
  return next
}
/** Certified immutable editor path; no-op batches preserve identity and consume no history. */
export function applySnapshotCommands(scene: SceneDocument, commands: readonly SceneCommand[], context: PreparationContext, options: ApplySnapshotCommandsOptions = {}): SceneDocument {
  if (options?.budget) parseCommandBudgetProfile(options.budget)
  const source = validateSceneSnapshot(scene)
  if (!source.ok) throw new Error(`当前场景无效：${source.errors.map(issue => issue.message).join('；')}`)
  const checked = checkedCommands(commands, options.budget)
  if (!checked.length) return source.document
  const relationScope = pathAttachmentBudgetScope(source.document, checked, options), observedOptions = relationScope?.options ?? options
  const propTransaction = tryApplyPropUpdatesSnapshot(source.document, checked)
  if (propTransaction && (propTransaction.result !== source.document || options.preserveNoopIdentity !== false)) {
    for (const step of propTransaction.steps) observedOptions.onSceneDraft?.(step.after, step.command, 1)
    relationScope?.finish(propTransaction.result)
    if (options.budget) assertCommandBudget(options.budget, measureCommandBudget(source.document, propTransaction.result, manualBudgetMetadata(source.document, propTransaction.result, options), undefined, options.budget))
    return propTransaction.result
  }
  const next = relationScope ? relationScope.run(() => candidate(source.document, checked, context, observedOptions, relationScope.meter))
    : candidate(source.document, checked, context, options)
  relationScope?.finish(next)
  if (options.preserveNoopIdentity !== false && equal(next, source.document)) return source.document
  const result = checked.every(command => command.type === 'updateProp')
    ? validateSceneDerivationSnapshot(next, source.document) : validateSceneSnapshot(next)
  if (!result.ok) throw new Error(`事务未采用：${result.errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；')}`)
  if (options.budget) assertCommandBudget(options.budget, measureCommandBudget(source.document, result.document, manualBudgetMetadata(source.document, result.document, options), undefined, options.budget))
  return result.document
}

export type PlacePropOptions = BasePlacePropOptions & { layerId?: string }
const placementOptionsSchema = z.object({ floorId: id.optional(), id: id.optional(), rotationDeg: angle.optional(), supportRef: surfaceRef.optional(), layerId: id.optional() }).strict()

/** Transient ghost only; adoption checks the explicit target layer and full dependencies again. */
export function createPlacedProp(scene: SceneDocument, definitionId: string, positionMm: PointMm, context: PreparationContext, options: PlacePropOptions = {}) {
  const issue = inspectJsonInput({ definitionId, positionMm, options })
  if (issue) throw new Error(`放置参数无效：${issue.message}`)
  const source = validateSceneSnapshot(scene)
  if (!source.ok) throw new Error(`当前场景无效：${source.errors.map(issue => issue.message).join('；')}`)
  const checked = placementOptionsSchema.safeParse(options)
  if (!checked.success) throw new Error(`放置参数无效：${checked.error.issues.map(issue => issue.message).join('；')}`)
  const { layerId, ...placementOptions } = checked.data
  const requestedFloor = placementOptions.floorId
  if (!layerId && !requestedFloor && Object.keys(source.document.floors).length > 1) throw new Error('多Floor放置必须明确选择图层或目标Floor。')
  const target = layerId === undefined ? orderedLayers(source.document, requestedFloor)[0] : assertLayerUnlocked(source.document, layerId)
  if (!target) throw new Error('待放置物件须有现存目标图层。')
  assertLayerUnlocked(source.document, target.id)
  const domain = geometryDocumentForValidation(source.document, true)
  if (requestedFloor && requestedFloor !== target.floorId) throw new Error('物件目标Floor与显式图层不一致。')
  return createBasePlacedProp(domain, definitionId, positionMm, context, { ...placementOptions, floorId: target.floorId })
}
