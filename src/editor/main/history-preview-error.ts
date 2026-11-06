import type { SceneDocument } from '../../shared/model/scene'
import { entityEditLockSources } from '../../shared/commands/layers'
import { createEntityLabeler } from './entity-label'

const prefixes = [
  '恢复目标图层已锁定：', '恢复物件的支撑依赖或图层已锁定：',
  '当前恢复对象、父组合或图层已锁定：', '当前恢复对象的父组合或图层已锁定：',
  '全景环境恢复涉及锁定图层：', '恢复图层已锁定：', '结构恢复涉及已锁定实体或图层：',
]

/** Translate only known lock errors, using the current real lock closure. */
export function historyPreviewError(error: unknown, scene: SceneDocument): unknown {
  if (!(error instanceof Error) || error.name === 'AbortError') return error
  const prefix = prefixes.find(value => error.message.startsWith(value))
  if (!prefix) return error
  const id = error.message.slice(prefix.length).replace(/。$/, '')
  const label = createEntityLabeler(scene)
  const sources = scene.userLayers[id]
    ? { entityIds: [], layerIds: [id] } : entityEditLockSources(scene, id)
  const targets = [
    ...sources.entityIds.map(target => `对象「${label(target)}」`),
    ...sources.layerIds.map(target => `图层「${label(target)}」`),
  ]
  return new Error(`历史恢复涉及编辑锁：${targets.length ? targets.join('、') : `「${label(id)}」`}。请在对象属性或「图层」中解除相应编辑锁，再重新预览。`, { cause: error })
}
