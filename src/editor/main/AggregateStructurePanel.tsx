import { useEffect, useMemo, useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { AggregateEntityRef } from '../../shared/model/aggregate'
import type { SceneDocument } from '../../shared/model/scene'
import { inspectAggregateCopy, planAggregateCopy } from '../../shared/aggregates/group-copy'
import { NumberInput } from '../native-canvas/controls'
import { createEntityLabeler } from './entity-label'
import { newId } from './runtime'

type Props = {
  scene: SceneDocument
  disabled: boolean
  onPreview: (commands: SceneCommand[], description: string) => void
  onSelect: (id: string) => void
}
const memberKey = (member: AggregateEntityRef) => `${member.kind}:${member.id}`

/** Ownership-only partitions do not cut physical geometry or reset member IDs.
 * Every action enters the normal complete-candidate review and atomic adoption.
 */
export default function AggregateStructurePanel({ scene, disabled, onPreview, onSelect }: Props) {
  const groups = Object.values(scene.aggregateCoordinates?.groups ?? {})
  const [groupId, setGroupId] = useState(''), [selected, setSelected] = useState<string[]>([]), [mergeIds, setMergeIds] = useState<string[]>([])
  const [parentId, setParentId] = useState(''), [offset, setOffset] = useState({ x: 1000, y: 0 }), [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = groups.find(group => group.id === groupId) ?? groups[0]
  const label = useMemo(() => createEntityLabeler(scene), [scene])
  const groupLabel = (id: string) => {
    const index = groups.findIndex(group => group.id === id), member = groups[index]?.members[0]
    return `${member ? label(member.id) : '空组'} · 组 ${index + 1}`
  }
  useEffect(() => {
    setSelected([]); setMergeIds([]); setParentId(current?.parentId ?? ''); setConfirmed(false); setError(null)
  }, [scene.sceneId, scene.revision, current?.id, current?.parentId])
  const children = groups.filter(group => group.parentId === current?.id)
  const siblings = groups.filter(group => current && group.id !== current.id && group.floorId === current.floorId && group.parentId === current.parentId)
  const descendants = new Set(current ? [current.id] : [])
  for (let changed = true; changed;) {
    changed = false
    for (const group of groups) if (group.parentId !== null && descendants.has(group.parentId) && !descendants.has(group.id)) { descendants.add(group.id); changed = true }
  }
  const copyScope = useMemo(() => {
    if (!current) return { scope: null, reason: null }
    try { return { scope: inspectAggregateCopy(scene, current.id), reason: null } }
    catch (cause) { return { scope: null, reason: cause instanceof Error ? cause.message : String(cause) } }
  }, [scene, current?.id])
  const toggle = (value: string, values: string[], update: (next: string[]) => void) => update(values.includes(value) ? values.filter(item => item !== value) : [...values, value])
  const run = (prepare: () => SceneCommand[], description: string) => {
    if (disabled || !current) return
    try { setError(null); onPreview(prepare(), description) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const split = () => run(() => {
    const selectedMembers = current!.members.filter(member => selected.includes(memberKey(member)))
    const otherMembers = current!.members.filter(member => !selected.includes(memberKey(member)))
    const selectedChildren = children.filter(child => selected.includes(`group:${child.id}`)).map(child => child.id)
    const otherChildren = children.filter(child => !selected.includes(`group:${child.id}`)).map(child => child.id)
    if (!selectedMembers.length && !selectedChildren.length || !otherMembers.length && !otherChildren.length) throw new Error('请选择拆出部分，并至少留一项给另一组。')
    return [{ type: 'splitAggregateGroup', id: current!.id, parts: [
      { id: newId(), members: selectedMembers, childGroupIds: selectedChildren },
      { id: newId(), members: otherMembers, childGroupIds: otherChildren },
    ] }]
  }, `拆分组 · ${current ? groupLabel(current.id) : ''}`)
  const copy = () => run(() => {
    if (!copyScope.scope || copyScope.scope.externalRefs.length && !confirmed) throw new Error('请先确认复制后继续使用的外部支撑和锚点。')
    const idMap = Object.fromEntries([...copyScope.scope.groupIds, ...copyScope.scope.members.map(member => member.id)].map(id => [id, newId()]))
    return planAggregateCopy(scene, current!.id, { offsetMm: offset, idMap, externalRefs: copyScope.scope.externalRefs })
  }, `复制组 · ${current ? groupLabel(current.id) : ''}`)
  return <details className="building-details" aria-label="组结构工具">
    <summary>组结构与复制</summary>
    <p className="asset-muted">拆分、合并、换父级和解组保留物件及世界坐标；新容器使用新身份。这里只调整成员归属，不切割墙或地形。</p>
    {!current ? <p className="asset-muted">先创建建筑组或自然组，再调整结构。</p> : <fieldset disabled={disabled}>
      <label className="building-field">当前组<select data-aggregate-session-control aria-label="结构操作组" value={current.id} onChange={event => setGroupId(event.target.value)}>{groups.map(group => <option key={group.id} value={group.id}>{groupLabel(group.id)}</option>)}</select></label>
      <details className="building-details"><summary>进入成员与子组</summary><div className="building-entity-list" aria-label="结构组内部对象">{current.members.map(member => <button type="button" key={memberKey(member)} onClick={() => onSelect(member.id)}>{label(member.id)}</button>)}{children.map(child => <button type="button" key={child.id} onClick={() => setGroupId(child.id)}>进入 {groupLabel(child.id)}</button>)}</div></details>
      <details className="building-details"><summary>拆成两组</summary><p className="asset-muted">勾选要拆出的一部分；未勾选内容进入另一新组。子组整体保留，跨界支撑、注记和共享墙仍按完整工程检查。</p>
        <div aria-label="拆分组成员">{current.members.map(member => <label className="building-check" key={memberKey(member)}><input type="checkbox" aria-label={`拆出 ${label(member.id)}`} checked={selected.includes(memberKey(member))} onChange={() => toggle(memberKey(member), selected, setSelected)}/>{label(member.id)}</label>)}{children.map(child => <label className="building-check" key={child.id}><input type="checkbox" aria-label={`拆出子组 ${groupLabel(child.id)}`} checked={selected.includes(`group:${child.id}`)} onChange={() => toggle(`group:${child.id}`, selected, setSelected)}/>{groupLabel(child.id)}（完整子组）</label>)}</div>
        <button type="button" className="secondary asset-wide" onClick={split}>预览拆分组</button>
      </details>
      <details className="building-details"><summary>合并同级组</summary><p className="asset-muted">当前组与下方勾选的同级组合成一个新组，原成员和子组继续可编辑。</p>{siblings.length ? siblings.map(group => <label className="building-check" key={group.id}><input type="checkbox" aria-label={`合并 ${groupLabel(group.id)}`} checked={mergeIds.includes(group.id)} onChange={() => toggle(group.id, mergeIds, setMergeIds)}/>{groupLabel(group.id)}</label>) : <p className="asset-muted">当前没有同 Floor、同父级的其他组。</p>}
        <button type="button" className="secondary asset-wide" disabled={!mergeIds.length} onClick={() => run(() => [{ type: 'mergeAggregateGroups', ids: [current.id, ...mergeIds], newId: newId() }], `合并 ${mergeIds.length + 1} 个组`)}>预览合并组</button>
      </details>
      <details className="building-details"><summary>换父级或解组</summary><label className="building-field">新的父组<select aria-label="新的父组" value={parentId} onChange={event => setParentId(event.target.value)}><option value="">世界坐标（顶层）</option>{groups.filter(group => group.floorId === current.floorId && !descendants.has(group.id)).map(group => <option key={group.id} value={group.id}>{groupLabel(group.id)}</option>)}</select></label>
        <button type="button" className="secondary asset-wide" disabled={(parentId || null) === current.parentId} onClick={() => run(() => [{ type: 'reparentAggregateGroup', id: current.id, parentId: parentId || null }], `更换父组 · ${groupLabel(current.id)}`)}>预览更换父组</button>
        <button type="button" className="secondary asset-wide" onClick={() => run(() => [{ type: 'dissolveAggregateGroup', id: current.id }], `解组 · ${groupLabel(current.id)}`)}>预览解组并保留成员</button>
      </details>
      <details className="building-details"><summary>复制物件与注记组</summary><p className="asset-muted">复制当前实际内容及完整子组树，保留固定外观和当前人工位置；支持独立物件及注记。副本继续使用原图层和明确确认的外部支撑。</p>
        {copyScope.reason ? <p className="history-limit">{copyScope.reason}</p> : <>
          <NumberInput displayUnit={scene.units.display} label="组复制偏移 X" value={offset.x} onCommit={x => setOffset(value => ({ ...value, x }))}/>
          <NumberInput displayUnit={scene.units.display} label="组复制偏移 Y" value={offset.y} onCommit={y => setOffset(value => ({ ...value, y }))}/>
          {copyScope.scope!.externalRefs.length > 0 && <><p className="asset-muted">继续引用：{copyScope.scope!.externalRefs.map(ref => label(ref.id)).join('、')}。</p><label className="building-check"><input type="checkbox" aria-label="确认组复制外部引用" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>确认保留以上外部支撑和锚点</label></>}
          <button type="button" className="secondary asset-wide" disabled={!!copyScope.scope!.externalRefs.length && !confirmed} onClick={copy}>预览复制组</button>
        </>}
      </details>
    </fieldset>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </details>
}
