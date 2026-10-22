import { validateSceneV2 } from '../v2/schema'
import { geometryIdentityIdsV3 } from './domain'
import { validateSceneV3 } from './schema'
import { LAYER_ENTITY_COLLECTIONS_V3, USER_LAYER_LIMIT_V3, type SceneDocumentV3 } from './types'

/** Complete geometry copy; package bytes, licenses and source provenance remain IO responsibilities. */
export function migrateSceneV2(input: unknown, options: { sceneId?: string; now?: string } = {}): SceneDocumentV3 {
  const checked = validateSceneV2(input)
  if (!checked.ok) throw new Error(`v2 迁移失败：${checked.errors.map(issue => `${issue.code}: ${issue.message}`).join('；')}`)
  const source = checked.document, sceneId = options.sceneId ?? crypto.randomUUID(), stamp = options.now ?? new Date().toISOString()
  if (sceneId === source.sceneId) throw new Error('迁移必须创建独立 sceneId，原工程身份保留。')
  const document: SceneDocumentV3 = { ...structuredClone(source), schemaVersion: 3, sceneId, revision: 0, createdAt: stamp, updatedAt: stamp, userLayers: {}, entityLayers: {} }
  if (Object.keys(document.floors).length > USER_LAYER_LIMIT_V3) throw new Error('Floor 数量超过 128 层迁移预算。')
  const occupied = geometryIdentityIdsV3(document), byFloor = new Map<string, string>()
  for (const [index, floor] of Object.values(document.floors).entries()) {
    let suffix = index, id = `layer-default-${suffix}`
    while (occupied.has(id)) { suffix++; id = `layer-default-${suffix}` }
    occupied.add(id); byFloor.set(floor.id, id)
    document.userLayers[id] = { id, floorId: floor.id, name: '默认图层', order: 0, editLocked: false }
  }
  for (const collection of LAYER_ENTITY_COLLECTIONS_V3) for (const entity of Object.values(document[collection])) document.entityLayers[entity.id] = byFloor.get(entity.floorId)!
  const result = validateSceneV3(document)
  if (!result.ok) throw new Error(`v3 迁移校验失败：${result.errors.map(issue => `${issue.code}: ${issue.message}`).join('；')}`)
  return result.document
}
