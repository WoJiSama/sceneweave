import type { SceneDocument } from '../../shared/model/scene'
import { createEntityLabeler } from './entity-label'

/** Keep domain validation intact while making its lock targets usable in the UI. */
export function outdoorPreviewError(error: unknown, scene: SceneDocument): unknown {
  const prefix = '室外事务涉及锁定实体、图层或真实依赖：'
  if (!(error instanceof Error) || !error.message.startsWith(prefix)) return error
  const label = createEntityLabeler(scene)
  const targets = error.message.slice(prefix.length).replace(/。$/, '').split('、')
  return new Error(`${prefix}${targets.map(id => `「${label(id)}」`).join('、')}。请在对象属性或「图层」中解除编辑锁，再重新预览。`, { cause: error })
}
