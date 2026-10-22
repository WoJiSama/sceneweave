import { isEntityEditLockedV2 } from '../v2/commands'
import type { Editable } from '../v2/types'
import { toGeometryDocumentV2 } from './geometry-view'
import { validateSceneSnapshotV3 } from './snapshots'
import { COMMAND_LIMIT_V3, LAYER_ENTITY_COLLECTIONS_V3, type SceneDocumentV3, type UserLayerV3 } from './types'

const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined

/** Top-level members only; embedded terrain control points inherit their area. */
export function enumerateLayerEntitiesV3(scene: SceneDocumentV3): Editable[] {
  return LAYER_ENTITY_COLLECTIONS_V3.flatMap(collection => Object.values(scene[collection]))
}
export function layerIdForEntityV3(scene: SceneDocumentV3, entityId: string): string | null {
  const direct = own(scene.entityLayers, entityId)
  if (direct !== undefined) return direct
  const area = Object.values(scene.terrainAreas).find(area => area.boundaryMm.some(point => point.id === entityId))
  return area ? own(scene.entityLayers, area.id) ?? null : null
}
export const layerIdForEntity = layerIdForEntityV3
export function orderedLayersV3(scene: SceneDocumentV3, floorId?: string): UserLayerV3[] {
  return Object.values(scene.userLayers).filter(layer => floorId === undefined || layer.floorId === floorId)
    .sort((a, b) => a.floorId.localeCompare(b.floorId) || a.order - b.order || a.id.localeCompare(b.id))
}
export function entitiesInLayerV3(scene: SceneDocumentV3, layerId: string): string[] {
  return enumerateLayerEntitiesV3(scene).filter(entity => scene.entityLayers[entity.id] === layerId).map(entity => entity.id)
}
export const layerEntityIdsV3 = entitiesInLayerV3
export function effectiveLayerLockedV3(scene: SceneDocumentV3, entityId: string): boolean {
  const layerId = layerIdForEntityV3(scene, entityId)
  return layerId !== null && !!own(scene.userLayers, layerId)?.editLocked
}
/** Includes structural/support/anchor/container dependants, as content commands do. */
export function effectiveEditLockedV3(scene: SceneDocumentV3, entityId: string): boolean {
  return isEntityEditLockedV2(toGeometryDocumentV2(scene, { effectiveLocks: true }), entityId)
}

/** The only membership expansion: whole live containers, never unrelated support furniture. */
export function layerMoveClosureV3(scene: SceneDocumentV3, ids: readonly string[]): string[] {
  const known = new Map(enumerateLayerEntitiesV3(scene).map(entity => [entity.id, entity]))
  const groups = [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]
  const ownerByProp = new Map<string, string>()
  for (const group of groups) for (const member of Object.values(group.members)) if (member.propId !== null) ownerByProp.set(member.propId, group.id)
  const groupById = new Map(groups.map(group => [group.id, group]))
  const result = new Set<string>()
  for (const inputId of ids) {
    const area = known.has(inputId) ? null : Object.values(scene.terrainAreas).find(area => area.boundaryMm.some(point => point.id === inputId))
    const id = area?.id ?? inputId
    if (!known.has(id)) throw new Error(`移层实体不存在：${inputId}。`)
    const ownerId = ownerByProp.get(id) ?? id, group = groupById.get(ownerId)
    result.add(ownerId)
    if (group) for (const member of Object.values(group.members)) if (member.propId !== null) result.add(member.propId)
  }
  return [...result]
}

export interface LayerMovePreviewV3 {
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
export function previewLayerMoveV3(scene: SceneDocumentV3, ids: readonly string[], layerId: string): LayerMovePreviewV3 {
  const preview: LayerMovePreviewV3 = { ids: [], expandedIds: [], requestedIds: [...ids], layerId, changes: [], blockedIds: [], commandCost: 0, reason: null }
  const fail = (message: string) => { preview.reason = message; return preview }
  const checked = validateSceneSnapshotV3(scene)
  if (!checked.ok) return fail(`场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const source = checked.document, target = own(source.userLayers, layerId)
  if (!ids.length) return fail('请先选择要移动的对象。')
  try { preview.ids = layerMoveClosureV3(source, ids); preview.expandedIds = [...preview.ids] }
  catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  preview.commandCost = preview.ids.length
  // Even a refused proposal exposes its complete affected scope. Never truncate
  // the preview to the first 256 entries or let the raw seed count hide siblings.
  if (ids.length > COMMAND_LIMIT_V3) return fail('一次移层最多选择 256 个操作单元，不可拆批绕过。')
  if (preview.commandCost > COMMAND_LIMIT_V3) return fail(`移层展开为 ${preview.commandCost} 个实体，超过单次 256 条操作预算。`)
  if (!target) return fail('目标用户图层不存在。')
  preview.changes = preview.ids.filter(id => source.entityLayers[id] !== layerId).map(id => ({ id, fromLayerId: source.entityLayers[id], toLayerId: layerId }))
  const byId = new Map(enumerateLayerEntitiesV3(source).map(entity => [entity.id, entity]))
  if (preview.ids.some(id => byId.get(id)!.floorId !== target.floorId)) return fail('对象与目标图层必须属于同一 Floor。')
  const domain = toGeometryDocumentV2(source, { effectiveLocks: true })
  preview.blockedIds = preview.ids.filter(id => isEntityEditLockedV2(domain, id))
  if (target.editLocked || preview.blockedIds.length) return fail(`移层涉及已锁定的图层、实体或依赖${preview.blockedIds.length ? `：${preview.blockedIds.join('、')}` : ''}。`)
  return preview
}

export interface LayerRemovalPreviewV3 extends LayerMovePreviewV3 { removedLayerId: string }
export function previewLayerRemovalV3(scene: SceneDocumentV3, id: string, targetLayerId?: string): LayerRemovalPreviewV3 {
  const empty: LayerRemovalPreviewV3 = { ids: [], expandedIds: [], requestedIds: [], layerId: targetLayerId ?? '', changes: [], blockedIds: [], commandCost: 1, reason: null, removedLayerId: id }
  const checked = validateSceneSnapshotV3(scene)
  if (!checked.ok) { empty.reason = '当前场景未通过完整校验。'; return empty }
  const source = checked.document, layer = own(source.userLayers, id)
  if (!layer) { empty.reason = '待删除图层不存在。'; return empty }
  if (orderedLayersV3(source, layer.floorId).length <= 1) { empty.reason = '每个 Floor 至少须保留一个用户图层。'; return empty }
  if (layer.editLocked) { empty.reason = '待删除图层已锁定，请先单独解锁。'; return empty }
  const ids = entitiesInLayerV3(source, id)
  if (targetLayerId === id) { empty.reason = '删除图层的迁移目标不能是自身。'; return empty }
  if (targetLayerId !== undefined) {
    const target = own(source.userLayers, targetLayerId)
    if (!target || target.floorId !== layer.floorId) { empty.reason = '迁移目标必须是同 Floor 的现存图层。'; return empty }
    if (target.editLocked) { empty.reason = '迁移目标图层已锁定。'; return empty }
  }
  if (!ids.length) return empty
  if (targetLayerId === undefined) { empty.ids = ids; empty.expandedIds = [...ids]; empty.reason = '图层仍有内容，请明确选择迁移目标；不支持删除整层内容。'; return empty }
  const move = previewLayerMoveV3(source, ids, targetLayerId)
  const result = { ...move, commandCost: move.commandCost + 1, removedLayerId: id }
  if (!result.reason && result.commandCost > COMMAND_LIMIT_V3) result.reason = '整体移层加删层超过单次 256 条操作预算，不能拆批绕过。'
  return result
}
export const planDeleteLayerV3 = previewLayerRemovalV3
export { toGeometryDocumentV2 } from './geometry-view'
