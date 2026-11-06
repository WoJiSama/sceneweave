import { useMemo } from 'react'
import { entityEditLockSources } from '../../shared/commands/layers'
import type { SceneDocument } from '../../shared/model/scene'
import { createEntityLabeler } from './entity-label'

type Props = { scene: SceneDocument; id: string; onSelect: (id: string) => void; onOpenLayers?: () => void }

/** Reports the existing selection lock closure without changing any lock. */
export default function EntityLockNotice({ scene, id, onSelect, onOpenLayers }: Props) {
  const sources = useMemo(() => entityEditLockSources(scene, id), [scene, id])
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  if (!sources.entityIds.length && !sources.layerIds.length) return null
  return <div className="entity-lock-notice" role="status" aria-label="编辑锁来源">
    <p>当前只能查看；以下编辑锁保护此对象及相关内容。</p>
    <ul>
      {sources.entityIds.map(sourceId => <li key={`entity-${sourceId}`}>{sourceId === id ? '此对象自身有编辑锁。' : scene.surfaceRules?.[sourceId] ? <>地表规则已锁定：{name(sourceId)}。请在「地形与布景 → 布置植被」的地表规则列表中解锁。</> : <>相关对象已锁定：<button type="button" className="asset-group-link" onClick={() => onSelect(sourceId)}>{name(sourceId)}</button></>}</li>)}
      {sources.layerIds.map(layerId => <li key={`layer-${layerId}`}>图层已锁定：{name(layerId)}</li>)}
    </ul>
    {sources.layerIds.length > 0 && (onOpenLayers ? <button type="button" className="secondary" onClick={onOpenLayers}>前往图层解锁</button> : <p>在导航的「图层」中解除相应图层锁。</p>)}
    <p className="asset-muted">解除一处锁后，其余相关编辑锁仍会保留。</p>
  </div>
}
