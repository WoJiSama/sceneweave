import { useState } from 'react'
import { Layers3 } from 'lucide-react'
import type { CompositionCommand } from '../../shared/model/appearance'
import type { EditableProject } from '../../application/workspace/project'
import type { PointMm, SurfaceRef } from '../../shared/model/scene'
import { changedPrefabRevisionMembers, type PrefabRevisionChange } from '../../shared/appearance/prefab-revisions'
import { createEntityLabeler } from './entity-label'

export const prefabRevisionFieldLabels = { sightOccluder: '视线遮挡', appearance: '物件外观' }

export default function PrefabPanel({ project, ids, layerId, disabled, placementDefinitionId, placementRoom, onCancelPlacement, onPreview, onSelect, onPublishRevision, onSyncRevision }: {
  project: EditableProject; ids: readonly string[]; layerId: string; disabled: boolean; placementDefinitionId?: string | null
  placementRoom?: { id: string; anchorMm: PointMm }; onCancelPlacement?: () => void
  onPreview: (commands: CompositionCommand[], description: string) => void; onSelect: (id: string) => void
  onPublishRevision?: (id: string, changes: PrefabRevisionChange[]) => void; onSyncRevision?: (id: string) => void
}) {
  const scene = project.document, [name, setName] = useState('我的组合'), [definitionId, setDefinitionId] = useState('')
  const [x, setX] = useState(String(placementRoom?.anchorMm.x ?? 1000)), [y, setY] = useState(String(placementRoom?.anchorMm.y ?? 1000))
  const [rotation, setRotation] = useState('0'), [support, setSupport] = useState(placementRoom ? JSON.stringify({ kind: 'room', id: placementRoom.id }) : '')
  const group = ids.length === 1 ? scene.prefabInstances[ids[0]] : undefined, effectiveDefinitionId = placementDefinitionId ?? definitionId, definition = scene.prefabDefinitions[effectiveDefinitionId]
  const [selectedChanges, setSelectedChanges] = useState<{ groupId: string; changes: PrefabRevisionChange[] } | null>(null)
  const canRevise = group && !scene.prefabDefinitions[group.definitionRef.id].pathStyle
  const availableChanges = canRevise && onPublishRevision ? changedPrefabRevisionMembers(scene, group.id) : []
  const changes = group && selectedChanges?.groupId === group.id ? selectedChanges.changes.filter(({ key, field }) =>
    availableChanges.some(change => change.key === key && change.field === field)) : []
  const entityName = createEntityLabeler(scene)
  const floorId = scene.userLayers[layerId]?.floorId
  const members = new Set([...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].flatMap(item => Object.values(item.members).flatMap(member => member.propId ? [member.propId] : [])))
  const canCreate = ids.length > 0 && ids.every(id => !!scene.props[id] && !members.has(id)), anchor = canCreate ? { x: Math.round(ids.reduce((sum, id) => sum + scene.props[id].positionMm.x, 0) / ids.length), y: Math.round(ids.reduce((sum, id) => sum + scene.props[id].positionMm.y, 0) / ids.length) } : { x: 0, y: 0 }
  const instantiate = () => {
    if (!definition) return
    const layer = scene.userLayers[layerId], parsed = support ? JSON.parse(support) as SurfaceRef : { kind: 'floor' as const, id: layer.floorId }
    onPreview([{ type: 'instantiatePrefab', id: `prefab-${crypto.randomUUID()}`, definitionRef: { id: definition.id, version: definition.version }, memberIds: Object.fromEntries(definition.members.map(member => [member.key, `prop-${crypto.randomUUID()}`])), anchorMm: { x: Number(x), y: Number(y) }, rotationDeg: Number(rotation), layerId, supportRef: parsed }], `放置固定组合 · ${definition.name} v${definition.version}`)
  }
  const placementForm = <form onSubmit={event => { event.preventDefault(); instantiate() }}>
    <label>组合版本<select aria-label="放置组合版本" value={effectiveDefinitionId} onChange={event => setDefinitionId(event.target.value)} disabled={!!placementDefinitionId}>
      <option value="">选择固定定义</option>
      {Object.values(scene.prefabDefinitions).map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
    </select></label>
    <label>放在哪个表面<select aria-label="组合支撑表面" value={support} onChange={event => setSupport(event.target.value)}>
      <option value="">当前楼层 · {scene.floors[floorId]?.name ?? floorId}</option>
      {Object.values(scene.floors).filter(item => item.id === floorId).map(item => <option key={item.id} value={JSON.stringify({ kind: 'floor', id: item.id })}>楼层 · {item.name}</option>)}
      {Object.values(scene.rooms).filter(item => item.floorId === floorId).map(item => <option key={item.id} value={JSON.stringify({ kind: 'room', id: item.id })}>房间 · {item.purpose || item.id}</option>)}
      {Object.values(scene.terrainAreas).filter(item => item.floorId === floorId).map(item => <option key={item.id} value={JSON.stringify({ kind: 'terrainArea', id: item.id })}>地形 · {entityName(item.id)}</option>)}
    </select></label>
    <div className="composition-fields">
      <label>锚点 X mm<input aria-label="组合放置X" type="number" step="1" value={x} onChange={event => setX(event.target.value)}/></label>
      <label>锚点 Y mm<input aria-label="组合放置Y" type="number" step="1" value={y} onChange={event => setY(event.target.value)}/></label>
    </div>
    <label>角度 °<input aria-label="组合放置角度" type="number" min="0" max="359.999" step="1" value={rotation} onChange={event => setRotation(event.target.value)}/></label>
    <button className="primary asset-wide" type="submit" disabled={disabled || !definition || !scene.userLayers[layerId]}>预览放置组合</button>
    {onCancelPlacement && <button className="secondary asset-wide" type="button" onClick={onCancelPlacement}>退出放置</button>}
  </form>
  if (placementDefinitionId) return <section className="prefab-panel" aria-label="放置固定组合">
    <div className="asset-section-heading"><Layers3 size={16}/><h2>放置固定组合</h2></div>
    <fieldset disabled={disabled}>{placementForm}</fieldset>
  </section>
  return <section className="prefab-panel" aria-label="固定组合工具"><div className="asset-section-heading"><Layers3 size={16}/><h2>固定组合</h2></div><fieldset disabled={disabled}>
    <p className="asset-muted">从独立物件保存固定版本。复制保留当前成员、人工外观和删除记录；拆开保留物件身份。</p>
    {canRevise && (onPublishRevision || onSyncRevision) && <details className="asset-details">
      <summary>模块版本 · v{group.definitionRef.version}</summary>
      {availableChanges.length > 0 && <fieldset>
        <legend>更新原模块</legend>
        {availableChanges.map(({ key, propId, field }) => {
          const selected = changes.some(change => change.key === key && change.field === field)
          const label = field === 'sightOccluder' && !scene.props[propId].sightOccluder ? '移除视线遮挡' : prefabRevisionFieldLabels[field]
          return <label className="composition-check" key={JSON.stringify([key, field])}>
            <input type="checkbox" checked={selected} onChange={event => setSelectedChanges({
              groupId: group.id, changes: event.target.checked ? [...changes, { key, field }] : changes.filter(change => change.key !== key || change.field !== field),
            })}/>{entityName(propId)} · {label}
          </label>
        })}
        <button type="button" className="secondary asset-wide" disabled={!changes.length} onClick={() => onPublishRevision?.(group.id, changes)}>预览发布模块新版</button>
      </fieldset>}
      {onSyncRevision && <button type="button" className="secondary asset-wide"
        disabled={group.editLocked || scene.userLayers[scene.entityLayers[group.id]]?.editLocked}
        onClick={() => onSyncRevision(group.id)}>预览同步这个实例</button>}
    </details>}
    <form onSubmit={event => { event.preventDefault(); if (canCreate) onPreview([{ type: 'createPrefab', id: `prefab-${crypto.randomUUID()}`, definitionId: `prefab-definition-${crypto.randomUUID()}`, name: name.trim(), ids: [...ids], anchorMm: anchor }], `保存所选为固定组合 · ${name.trim()}`) }}><label>组合名称<input aria-label="新组合名称" value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label><button className="secondary asset-wide" type="submit" disabled={disabled || !canCreate || !name.trim()}>预览保存组合 · {ids.length} 件</button>{ids.length > 0 && !canCreate && !group && <p className="asset-muted">只可将未归属组合或散布的独立物件保存为组合。</p>}</form>
    {group && <div className="composition-source"><h3>{scene.prefabDefinitions[group.definitionRef.id].name} · v{group.definitionRef.version}</h3><p className="asset-muted">{Object.values(group.members).filter(member => member.propId).length} 个现存成员 / {Object.values(group.members).filter(member => !member.propId).length} 个删除记录</p><button className="secondary asset-wide" disabled={disabled} onClick={() => onPreview([{ type: 'duplicatePrefab', id: group.id, newId: `prefab-${crypto.randomUUID()}`, memberIds: Object.fromEntries(Object.entries(group.members).filter(([, member]) => member.propId).map(([key]) => [key, `prop-${crypto.randomUUID()}`])), offsetMm: { x: 300, y: 300 } }], '复制当前组合 · 偏移 300, 300 mm')}>预览复制整个组合</button><button className="secondary asset-wide" disabled={disabled} onClick={() => onPreview([{ type: 'unpackPrefab', id: group.id }], '拆开组合，保留当前成员与覆盖')}>预览拆开组合</button><button className="secondary asset-wide" disabled={disabled} onClick={() => onPreview([{ type: 'deletePrefab', id: group.id, memberIds: Object.values(group.members).flatMap(member => member.propId ? [member.propId] : []) }], '删除组合及明确列出的全部现存成员')}>预览删除整个组合</button><details><summary>成员与人工记录</summary>{Object.entries(group.members).map(([key, member]) => <div key={key}><p><code>{key}</code> · {member.propId ?? '已删除'}<small> · {member.overrideFields.join(', ') || '无实例覆盖'}</small></p>{member.propId && <><button className="secondary asset-wide" disabled={disabled} onClick={() => onSelect(member.propId!)}>选择成员 {key}</button><button className="secondary asset-wide" disabled={disabled} onClick={() => onPreview([{ type: 'detachPrefabMember', groupId: group.id, propId: member.propId! }], `成员退出组合 · ${key}`)}>预览成员退出 {key}</button></>}<button className="secondary asset-wide" disabled={disabled} onClick={() => onPreview([{ type: 'resetPrefabMember', groupId: group.id, key, ...(!member.propId ? { newId: `prop-${crypto.randomUUID()}`, supportRef: support ? JSON.parse(support) as SurfaceRef : { kind: 'floor' as const, id: scene.userLayers[layerId].floorId } } : {}) }], `${member.propId ? '重置当前成员' : '按固定模板新建成员（新身份）'} · ${key}`)}>预览{member.propId ? '重置' : '新建'}成员 {key}</button>{!member.propId && <small>新建使用下方明确支撑表面，分配新身份；历史重建请到局部恢复。</small>}</div>)}</details></div>}
    <details className="asset-details"><summary>放置固定组合</summary>{placementForm}</details>
  </fieldset></section>
}
