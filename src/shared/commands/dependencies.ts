import { inspectDependencies as inspectDomainDependencies, type DependencyIssue, type LicenseSubject } from '../geometry/dependencies.js'
import type { Editable } from '../model/scene.js'
import { geometryDocumentForValidation, geometryIdentityIds } from './domain.js'
import { LAYER_ENTITY_COLLECTIONS, USER_LAYER_LIMIT, type SceneDocument } from '../model/scene.js'

export type { DependencyIssue }
export type { LicenseSubject }

/** Requires the native scene shape first; keeps the complete adopted resource closure. */
export function inspectDependencies(scene: SceneDocument): { errors: DependencyIssue[]; assetIds: string[]; subjects: LicenseSubject[] } {
  const common = inspectDomainDependencies(geometryDocumentForValidation(scene))
  const errors = [...common.errors]
  const error = (code: string, message: string, entityId?: string) => errors.push({ code, message, ...(entityId ? { entityId } : {}) })
  const entities = new Map<string, Editable>()
  for (const collection of LAYER_ENTITY_COLLECTIONS) for (const entity of Object.values(scene[collection])) entities.set(entity.id, entity)
  const layers = Object.values(scene.userLayers), geometryIds = geometryIdentityIds(scene)
  if (layers.length > USER_LAYER_LIMIT) error('LAYER_BUDGET', '用户图层总数不得超过 128。')
  for (const [key, layer] of Object.entries(scene.userLayers)) {
    if (key !== layer.id) error('LAYER_ID_KEY_MISMATCH', '图层集合键必须等于图层 id。', layer.id)
    if (geometryIds.has(layer.id)) error('DUPLICATE_ID', '图层 ID 不得与既有实体、定义或内嵌身份重复。', layer.id)
    if (!Object.hasOwn(scene.floors, layer.floorId)) error('MISSING_FLOOR', '图层所在 Floor 不存在。', layer.id)
  }
  for (const floor of Object.values(scene.floors)) {
    const ordered = layers.filter(layer => layer.floorId === floor.id).sort((a, b) => a.order - b.order)
    if (!ordered.length) error('MISSING_DEFAULT_LAYER', '每个 Floor 至少须保留一个用户图层。', floor.id)
    if (ordered.some((layer, index) => layer.order !== index)) error('LAYER_ORDER', '同 Floor 的图层顺序必须为从 0 开始的连续整数。', floor.id)
  }
  for (const [entityId, layerId] of Object.entries(scene.entityLayers)) {
    const entity = entities.get(entityId), layer = Object.hasOwn(scene.userLayers, layerId) ? scene.userLayers[layerId] : undefined
    if (!entity) error('UNKNOWN_LAYER_MEMBER', '图层归属只可登记现存顶层可编辑实体，不能登记内嵌控制点。', entityId)
    if (!layer) error('MISSING_LAYER', '实体所属用户图层不存在。', entityId)
    else if (entity && entity.floorId !== layer.floorId) error('CROSS_FLOOR_LAYER', '实体与所属用户图层必须同 Floor。', entityId)
  }
  for (const id of entities.keys()) if (!Object.hasOwn(scene.entityLayers, id)) error('MISSING_LAYER_MEMBERSHIP', '每个可编辑顶层实体必须恰有一个用户图层归属。', id)
  for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) {
    for (const member of Object.values(group.members)) if (member.propId !== null && scene.entityLayers[member.propId] !== scene.entityLayers[group.id]) {
      error('GROUP_LAYER_MISMATCH', '组合或散布容器与全部现存成员必须同层。', group.id)
    }
  }
  return { errors, assetIds: common.assetIds, subjects: common.subjects }
}

export const validateDependencies = (scene: SceneDocument): DependencyIssue[] => inspectDependencies(scene).errors
export function collectDependencies(scene: SceneDocument): { assetIds: string[]; subjects: LicenseSubject[] } {
  const result = inspectDependencies(scene)
  if (result.errors.length) throw new Error(result.errors.map(issue => `${issue.code}: ${issue.message}`).join('\n'))
  return { assetIds: result.assetIds, subjects: result.subjects }
}
