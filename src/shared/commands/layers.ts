import { entityEditLockBlockerIds, isEntityEditLocked } from './base.js'
import { assertCommandBudget, commandSelectionLimit, isManualTransactionBudget, measureCommandBudget, parseCommandBudgetProfile, type CommandBudgetProfile } from '../budget/command-budget.js'
import type { Editable } from '../model/scene.js'
import { geometryDocumentForValidation } from './domain.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import { COMMAND_LIMIT, LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS, type SceneDocument, type UserLayer } from '../model/scene.js'

const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined

/** Top-level members only; embedded terrain control points inherit their area. */
export function enumerateLayerEntities(scene: SceneDocument): Editable[] {
  return [...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS].flatMap(collection => Object.values(scene[collection] ?? {}))
}
export function layerIdForEntity(scene: SceneDocument, entityId: string): string | null {
  const direct = own(scene.entityLayers, entityId)
  if (direct !== undefined) return direct
  const area = Object.values(scene.terrainAreas).find(area => area.boundaryMm.some(point => point.id === entityId))
  return area ? own(scene.entityLayers, area.id) ?? null : null
}
export function orderedLayers(scene: SceneDocument, floorId?: string): UserLayer[] {
  return Object.values(scene.userLayers).filter(layer => floorId === undefined || layer.floorId === floorId)
    .sort((a, b) => a.floorId.localeCompare(b.floorId) || a.order - b.order || a.id.localeCompare(b.id))
}
export function entitiesInLayer(scene: SceneDocument, layerId: string): string[] {
  return enumerateLayerEntities(scene).filter(entity => scene.entityLayers[entity.id] === layerId).map(entity => entity.id)
}
export const layerEntityIds = entitiesInLayer
export function effectiveLayerLocked(scene: SceneDocument, entityId: string): boolean {
  const layerId = layerIdForEntity(scene, entityId)
  return layerId !== null && !!own(scene.userLayers, layerId)?.editLocked
}
/** Includes structural/support/anchor/container dependants, as content commands do. */
export function effectiveEditLocked(scene: SceneDocument, entityId: string): boolean {
  return isEntityEditLocked(geometryDocumentForValidation(scene, true), entityId)
}

/** The same selection closure, retaining the distinction between object and layer locks. */
export function entityEditLockSources(scene: SceneDocument, entityId: string): { entityIds: string[]; layerIds: string[] } {
  const blockerIds = new Set(entityEditLockBlockerIds(geometryDocumentForValidation(scene, true), entityId))
  const entityIds: string[] = [], layerIds = new Set<string>()
  for (const entity of enumerateLayerEntities(scene)) {
    if (!blockerIds.has(entity.id)) continue
    if (entity.editLocked) entityIds.push(entity.id)
    const layerId = layerIdForEntity(scene, entity.id)
    if (layerId !== null && scene.userLayers[layerId]?.editLocked) layerIds.add(layerId)
  }
  return { entityIds, layerIds: [...layerIds] }
}

/** The only membership expansion: whole live containers, never unrelated support furniture. */
export function layerMoveClosure(scene: SceneDocument, ids: readonly string[]): string[] {
  const known = new Map(enumerateLayerEntities(scene).map(entity => [entity.id, entity]))
  const groups = [
    ...[...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].map(group => ({ id: group.id, members: Object.values(group.members).flatMap(member => member.propId === null ? [] : [member.propId]) })),
    ...Object.values(scene.decorationClusters ?? {}).map(group => ({ id: group.id, members: [
      ...Object.values(group.members).flatMap(member => member.entityId === null || member.state === 'detached' || member.state === 'deleted' ? [] : [member.entityId]),
      ...Object.values(scene.surfaceRules ?? {}).filter(rule => rule.field !== 'material' && rule.clusterId === group.id).map(rule => rule.id),
    ] })),
  ]
  const ownerByProp = new Map<string, string>()
  for (const group of groups) for (const id of group.members) ownerByProp.set(id, group.id)
  const groupById = new Map(groups.map(group => [group.id, group]))
  const result = new Set<string>()
  for (const inputId of ids) {
    const area = known.has(inputId) ? null : Object.values(scene.terrainAreas).find(area => area.boundaryMm.some(point => point.id === inputId))
    const id = area?.id ?? inputId
    if (!known.has(id)) throw new Error(`移层实体不存在：${inputId}。`)
    const ownerId = ownerByProp.get(id) ?? id, group = groupById.get(ownerId)
    result.add(ownerId)
    if (group) for (const memberId of group.members) result.add(memberId)
  }
  return [...result]
}

export interface LayerMovePreview {
  /** Complete stable-ID operation scope, including expanded live group members. */
  ids: string[]
  expandedIds: string[]
  requestedIds: string[]
  layerId: string
  changes: { id: string; fromLayerId: string; toLayerId: string }[]
  blockedIds: string[]
  commandCost: number
  reason: string | null
}

/** Read-only preview; acceptance recomputes it against the Workspace checkpoint. */
export function previewLayerMove(scene: SceneDocument, ids: readonly string[], layerId: string, budget?: CommandBudgetProfile): LayerMovePreview {
  const preview: LayerMovePreview = { ids: [], expandedIds: [], requestedIds: [...ids], layerId, changes: [], blockedIds: [], commandCost: 0, reason: null }
  const fail = (message: string) => { preview.reason = message; return preview }
  if (budget) try { parseCommandBudgetProfile(budget) } catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  const checked = validateSceneSnapshot(scene)
  if (!checked.ok) return fail(`场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const source = checked.document, target = own(source.userLayers, layerId)
  if (!ids.length) return fail('请先选择要移动的对象。')
  try { preview.ids = layerMoveClosure(source, ids); preview.expandedIds = [...preview.ids] }
  catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  preview.commandCost = preview.ids.length
  // Even a refused proposal exposes its complete affected scope. Never truncate
  // the preview to the first 256 entries or let the raw seed count hide siblings.
  const selectionLimit = commandSelectionLimit(budget)
  if (ids.length > selectionLimit) return fail(`一次移层最多选择 ${selectionLimit} 个操作单元，不可拆批绕过。`)
  if (!isManualTransactionBudget(budget) && preview.commandCost > COMMAND_LIMIT) return fail(`移层展开为 ${preview.commandCost} 个实体，超过单次 256 条操作预算。`)
  if (!target) return fail('目标用户图层不存在。')
  preview.changes = preview.ids.filter(id => source.entityLayers[id] !== layerId).map(id => ({ id, fromLayerId: source.entityLayers[id], toLayerId: layerId }))
  const byId = new Map(enumerateLayerEntities(source).map(entity => [entity.id, entity]))
  if (preview.ids.some(id => byId.get(id)!.floorId !== target.floorId)) return fail('对象与目标图层必须属于同一 Floor。')
  const domain = geometryDocumentForValidation(source, true)
  preview.blockedIds = preview.ids.filter(id => isEntityEditLocked(domain, id))
  if (target.editLocked || preview.blockedIds.length) return fail(`移层涉及已锁定的图层、实体或依赖${preview.blockedIds.length ? `：${preview.blockedIds.join('、')}` : ''}。`)
  if (isManualTransactionBudget(budget)) {
    const next = { ...source, entityLayers: { ...source.entityLayers } }
    for (const change of preview.changes) next.entityLayers[change.id] = change.toLayerId
    try { assertCommandBudget(budget, measureCommandBudget(source, next, undefined, undefined, budget)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  }
  return preview
}

export interface LayerRemovalPreview extends LayerMovePreview { removedLayerId: string }
export function previewLayerRemoval(scene: SceneDocument, id: string, targetLayerId?: string, budget?: CommandBudgetProfile): LayerRemovalPreview {
  const empty: LayerRemovalPreview = { ids: [], expandedIds: [], requestedIds: [], layerId: targetLayerId ?? '', changes: [], blockedIds: [], commandCost: 1, reason: null, removedLayerId: id }
  if (budget) try { parseCommandBudgetProfile(budget) } catch (error) { empty.reason = error instanceof Error ? error.message : String(error); return empty }
  const checked = validateSceneSnapshot(scene)
  if (!checked.ok) { empty.reason = '当前场景未通过完整校验。'; return empty }
  const source = checked.document, layer = own(source.userLayers, id)
  if (!layer) { empty.reason = '待删除图层不存在。'; return empty }
  if (orderedLayers(source, layer.floorId).length <= 1) { empty.reason = '每个 Floor 至少须保留一个用户图层。'; return empty }
  if (layer.editLocked) { empty.reason = '待删除图层已锁定，请先单独解锁。'; return empty }
  const ids = entitiesInLayer(source, id)
  if (targetLayerId === id) { empty.reason = '删除图层的迁移目标不能是自身。'; return empty }
  if (targetLayerId !== undefined) {
    const target = own(source.userLayers, targetLayerId)
    if (!target || target.floorId !== layer.floorId) { empty.reason = '迁移目标必须是同 Floor 的现存图层。'; return empty }
    if (target.editLocked) { empty.reason = '迁移目标图层已锁定。'; return empty }
  }
  if (!ids.length) return empty
  if (targetLayerId === undefined) { empty.ids = ids; empty.expandedIds = [...ids]; empty.reason = '图层仍有内容，请明确选择迁移目标；不支持删除整层内容。'; return empty }
  const move = previewLayerMove(source, ids, targetLayerId, budget)
  const result = { ...move, commandCost: move.commandCost + 1, removedLayerId: id }
  if (!isManualTransactionBudget(budget) && !result.reason && result.commandCost > COMMAND_LIMIT) result.reason = '整体移层加删层超过单次 256 条操作预算，不能拆批绕过。'
  if (isManualTransactionBudget(budget) && !result.reason) {
    const next = { ...source, entityLayers: { ...source.entityLayers }, userLayers: { ...source.userLayers } }
    for (const change of result.changes) next.entityLayers[change.id] = change.toLayerId
    delete next.userLayers[id]
    orderedLayers(next, layer.floorId).forEach((row, order) => { next.userLayers[row.id] = { ...row, order } })
    try { assertCommandBudget(budget, measureCommandBudget(source, next, undefined, undefined, budget)) }
    catch (error) { result.reason = error instanceof Error ? error.message : String(error) }
  }
  return result
}
export const planDeleteLayer = previewLayerRemoval
