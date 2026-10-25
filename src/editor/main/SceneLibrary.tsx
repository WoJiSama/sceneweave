import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Layers3, Mountain, Move, PencilRuler, Sprout } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { EditableProject } from '../../application/workspace/project'
import { groupName } from './SceneInspector'
import { scatterName, terrainName } from './terrain-editing'
import VirtualEntityList from './VirtualEntityList'

type Props = {
  project: EditableProject | null; selected: string | null; selectedIds?: string[]; busy: boolean
  onSelect: (id: string | null, operation?: 'replace' | 'add' | 'subtract') => void
}
const EntityRow = memo(function EntityRow({ id, label, Icon, detail, selected, busy, onSelect }: { id: string; label: string; Icon: LucideIcon; detail?: string; selected: boolean; busy: boolean; onSelect: Props['onSelect'] }) {
  const icon = useMemo(() => <Icon size={14}/>, [Icon])
  return <button data-entity-id={id} disabled={busy} className={selected ? 'selected' : ''} onClick={event => onSelect(id, event.altKey ? 'subtract' : event.shiftKey ? 'add' : 'replace')} onKeyDown={event => { if (['Enter', ' '].includes(event.key) && (event.shiftKey || event.altKey)) { event.preventDefault(); onSelect(id, event.altKey ? 'subtract' : 'add') } }}>{icon}<span>{label}</span>{detail && <small>{detail}</small>}</button>
})
export default function SceneLibrary({ project, selected, selectedIds, busy, onSelect }: Props) {
  const [tab, setTab] = useState<'objects' | 'structure' | 'groups'>('objects')
  const scene = project?.document
  const selectedSet = useMemo(() => new Set(selectedIds ?? (selected ? [selected] : [])), [selectedIds, selected])
  const objectItems = useMemo(() => scene ? Object.values(scene.props).map(prop => ({ id: prop.id,
    label: prop.definitionRef ? scene.propDefinitions[prop.definitionRef.id].name : `符号物件 · ${prop.id}`,
    detail: prop.visibility === 'gm' ? 'GM' : undefined,
  })) : [], [scene])
  const locateId = scene ? (selectedIds ?? (selected ? [selected] : [])).find(id => Object.hasOwn(scene.props, id)) ?? null : null
  const selectRef = useRef(onSelect); selectRef.current = onSelect
  const selectRow = useCallback<Props['onSelect']>((id, operation) => selectRef.current(id, operation), [])
  const item = (id: string, label: string, Icon: LucideIcon = Move, detail?: string) => <EntityRow key={id} id={id} label={label} Icon={Icon} detail={detail} busy={busy} selected={selectedSet.has(id)} onSelect={selectRow}/>
  return <aside className="asset-library"><div className="asset-section-heading"><Layers3 size={16}/><h2>场景对象</h2></div>
    {scene && project && <><div className="asset-library-tabs" role="group" aria-label="场景对象分类"><button disabled={busy} aria-pressed={tab === 'objects'} onClick={() => setTab('objects')}>物件</button><button disabled={busy} aria-pressed={tab === 'groups'} onClick={() => setTab('groups')}>组合</button><button disabled={busy} aria-pressed={tab === 'structure'} onClick={() => setTab('structure')}>结构</button></div>
      <div className="asset-entity-list"><p className="asset-muted">Shift 点击 / Enter 增选 · Option/Alt 点击 / Enter 减选</p>
        {tab === 'objects' && <VirtualEntityList key={scene.sceneId} items={objectItems} selectedIds={selectedSet} locateId={locateId} busy={busy} onSelect={selectRow}/>}
        {tab === 'groups' && <>{Object.keys(scene.prefabInstances).map(id => item(id, groupName(project, id), Layers3, `${Object.values(scene.prefabInstances[id].members).filter(member => member.propId).length}件`))}{Object.values(scene.scatterGroups).map(group => item(group.id, scatterName(scene, group), Sprout, `${Object.values(group.members).filter(member => member.propId).length}件`))}{!Object.keys(scene.prefabInstances).length && !Object.keys(scene.scatterGroups).length && <p className="asset-muted">暂无组合，拆开的物件在「物件」中。</p>}</>}
        {tab === 'structure' && <>
          <h3>地面与铺装</h3>{Object.keys(scene.rooms).map((id, index) => item(id, id === 'study-room' ? '书房地面' : `房间地面 ${index + 1}`, Layers3))}{Object.values(scene.terrainAreas).map(area => item(area.id, terrainName(area.id), Layers3, `${area.groundElevationMm / 1000}m`))}
          {!!Object.keys(scene.terrainConnections).length && <h3>高差连接</h3>}{Object.values(scene.terrainConnections).map(connection => item(connection.id, connection.kind === 'stairs' ? '台阶连接' : '坡道连接', Mountain, `${connection.widthMm / 1000}m`))}
          {!!Object.keys(scene.terrainEdges).length && <details className="asset-details"><summary>岸线与崖边 <small>{Object.keys(scene.terrainEdges).length}</small></summary>{Object.values(scene.terrainEdges).map((edge, index) => item(edge.id, `${edge.shoreline ? '海岸' : edge.kind === 'cliff' ? '崖边' : '过渡'} ${index + 1}`, PencilRuler))}</details>}
          <h3>建筑墙体</h3>{Object.keys(scene.walls).map((id, index) => item(id, id === 'study-w1' ? '斜角墙与窗' : `墙体 ${index + 1}`, PencilRuler))}
          <h3>房间边界</h3>{Object.keys(scene.vertices).map((id, index) => item(id, id === 'study-v1' ? '斜角顶点 · 北端' : id === 'study-v2' ? '斜角顶点 · 东端' : `建筑顶点 ${index + 1}`, PencilRuler))}
          {!!Object.keys(scene.terrainAreas).length && <h3>开放表面轮廓</h3>}{Object.values(scene.terrainAreas).flatMap(area => area.boundaryMm.map((point, index) => item(point.id, `${terrainName(area.id).replace('铺装', '')}轮廓点 ${index + 1}`, PencilRuler)))}
        </>}
      </div></>}

  </aside>
}
