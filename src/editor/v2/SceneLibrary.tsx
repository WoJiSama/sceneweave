import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Layers3, Mountain, Move, PencilRuler, Plus, Sprout } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { groupName } from './SceneInspector'
import { scatterNameV2, terrainNameV2 } from './terrain-editing'
import VirtualEntityList from './VirtualEntityList'

type Props = {
  project: CompleteProjectV2 | null; selected: string | null; selectedIds?: string[]; busy: boolean
  recent: { sceneId: string; title: string; revision: number; savedAt: number }[]
  onStudy: () => void; onIsland: () => void; onCalibration: () => void; onMigrate: () => void
  onOpen: (id: string) => void; onSelect: (id: string | null, operation?: 'replace' | 'add' | 'subtract') => void
  onNew: () => void; onPlace: (definitionId: string) => void; placingId: string | null; canPlace: boolean; definitionFilter?: (definition: CompleteProjectV2['document']['propDefinitions'][string]) => boolean
}
const EntityRow = memo(function EntityRow({ id, label, Icon, detail, selected, busy, onSelect }: { id: string; label: string; Icon: LucideIcon; detail?: string; selected: boolean; busy: boolean; onSelect: Props['onSelect'] }) {
  const icon = useMemo(() => <Icon size={14}/>, [Icon])
  return <button data-entity-id={id} disabled={busy} className={selected ? 'selected' : ''} onClick={event => onSelect(id, event.altKey ? 'subtract' : event.shiftKey ? 'add' : 'replace')} onKeyDown={event => { if (['Enter', ' '].includes(event.key) && (event.shiftKey || event.altKey)) { event.preventDefault(); onSelect(id, event.altKey ? 'subtract' : 'add') } }}>{icon}<span>{label}</span>{detail && <small>{detail}</small>}</button>
})
export default function SceneLibrary({ project, selected, selectedIds, busy, recent, onStudy, onIsland, onCalibration, onMigrate, onOpen, onSelect, onNew, onPlace, placingId, canPlace, definitionFilter }: Props) {
  const [tab, setTab] = useState<'objects' | 'structure' | 'groups' | 'place'>('objects')
  const scene = project?.document
  const selectedSet = useMemo(() => new Set(selectedIds ?? (selected ? [selected] : [])), [selectedIds, selected])
  const objectItems = useMemo(() => scene ? Object.values(scene.props).map(prop => ({ id: prop.id,
    label: prop.definitionRef ? scene.propDefinitions[prop.definitionRef.id].name : `符号物件 · ${prop.id}`,
    detail: prop.visibility === 'gm' ? 'GM' : undefined,
  })) : [], [scene])
  const locateId = scene ? (selectedIds ?? (selected ? [selected] : [])).find(id => Object.hasOwn(scene.props, id)) ?? null : null
  const selectRef = useRef(onSelect); selectRef.current = onSelect
  const selectRow = useCallback<Props['onSelect']>((id, operation) => selectRef.current(id, operation), [])
  useEffect(() => { setTab(scene && !Object.keys(scene.props).length ? 'place' : 'objects') }, [scene?.sceneId])
  const item = (id: string, label: string, Icon: LucideIcon = Move, detail?: string) => <EntityRow key={id} id={id} label={label} Icon={Icon} detail={detail} busy={busy} selected={selectedSet.has(id)} onSelect={selectRow}/>
  return <aside className="asset-library"><div className="asset-section-heading"><Layers3 size={16}/><h2>场景与组件</h2></div>
    <button className="primary asset-blank-button" disabled={busy} onClick={onNew}><Plus size={16}/>新建空白场景</button>
    {scene && project && <><div className="asset-library-tabs" role="group" aria-label="场景对象分类"><button disabled={busy} aria-pressed={tab === 'place'} onClick={() => setTab('place')}>放置</button><button disabled={busy} aria-pressed={tab === 'objects'} onClick={() => setTab('objects')}>物件</button><button disabled={busy} aria-pressed={tab === 'groups'} onClick={() => setTab('groups')}>组合</button><button disabled={busy} aria-pressed={tab === 'structure'} onClick={() => setTab('structure')}>结构</button></div>
      <div className="asset-entity-list">{tab !== 'place' && <p className="asset-muted">Shift 点击 / Enter 增选 · Option/Alt 点击 / Enter 减选</p>}
        {tab === 'place' && <><p className="asset-muted">选择素材后在画布预览放置，或在右侧输入位置。</p>{Object.values(scene.propDefinitions).filter(definition => !definitionFilter || definitionFilter(definition)).map(definition => <button key={definition.id} aria-label={`放置${definition.name}`} aria-pressed={placingId === definition.id} disabled={busy || !canPlace} onClick={() => onPlace(definition.id)} className={placingId === definition.id ? 'selected' : ''}><Plus size={14}/><span>{definition.name}<small className="asset-definition-size">{definition.defaultFootprintMm.width} × {definition.defaultFootprintMm.height} mm</small></span></button>)}{!Object.keys(scene.propDefinitions).length && <p className="asset-muted">此工程尚无可放置的物件定义。空白场景自带内置素材。</p>}</>}
        {tab === 'objects' && <VirtualEntityList key={scene.sceneId} items={objectItems} selectedIds={selectedSet} locateId={locateId} busy={busy} onSelect={selectRow}/>}
        {tab === 'groups' && <>{Object.keys(scene.prefabInstances).map(id => item(id, groupName(project, id), Layers3, `${Object.values(scene.prefabInstances[id].members).filter(member => member.propId).length}件`))}{Object.values(scene.scatterGroups).map(group => item(group.id, scatterNameV2(scene, group), Sprout, `${Object.values(group.members).filter(member => member.propId).length}件`))}{!Object.keys(scene.prefabInstances).length && !Object.keys(scene.scatterGroups).length && <p className="asset-muted">暂无组合，拆开的物件在「物件」中。</p>}</>}
        {tab === 'structure' && <>
          <h3>地面与铺装</h3>{Object.keys(scene.rooms).map((id, index) => item(id, id === 'study-room' ? '书房地面' : `房间地面 ${index + 1}`, Layers3))}{Object.values(scene.terrainAreas).map(area => item(area.id, terrainNameV2(area.id), Layers3, `${area.groundElevationMm / 1000}m`))}
          {!!Object.keys(scene.terrainConnections).length && <h3>高差连接</h3>}{Object.values(scene.terrainConnections).map(connection => item(connection.id, connection.kind === 'stairs' ? '台阶连接' : '坡道连接', Mountain, `${connection.widthMm / 1000}m`))}
          {!!Object.keys(scene.terrainEdges).length && <details className="asset-details"><summary>岸线与崖边 <small>{Object.keys(scene.terrainEdges).length}</small></summary>{Object.values(scene.terrainEdges).map((edge, index) => item(edge.id, `${edge.shoreline ? '海岸' : edge.kind === 'cliff' ? '崖边' : '过渡'} ${index + 1}`, PencilRuler))}</details>}
          <h3>建筑墙体</h3>{Object.keys(scene.walls).map((id, index) => item(id, id === 'study-w1' ? '斜角墙与窗' : `墙体 ${index + 1}`, PencilRuler))}
          <h3>房间边界</h3>{Object.keys(scene.vertices).map((id, index) => item(id, id === 'study-v1' ? '斜角顶点 · 北端' : id === 'study-v2' ? '斜角顶点 · 东端' : `建筑顶点 ${index + 1}`, PencilRuler))}
          {!!Object.keys(scene.terrainAreas).length && <h3>开放表面轮廓</h3>}{Object.values(scene.terrainAreas).flatMap(area => area.boundaryMm.map((point, index) => item(point.id, `${terrainNameV2(area.id).replace('铺装', '')}轮廓点 ${index + 1}`, PencilRuler)))}
        </>}
      </div></>}
    <button className="asset-study-card" disabled={busy} onClick={onStudy}><div className="asset-study-illustration"><i className="study-room"/><i className="study-terrace"/><i className="study-desk"/><i className="study-rug"/></div><strong>书房与露台</strong><span>打开可编辑建筑样板</span><small>厚墙 · 斜窗 · 木石铺装 · 组件组合</small></button>
    <button className="asset-island-card" disabled={busy} onClick={onIsland}><div className="asset-island-illustration"><i className="island-shallow"/><i className="island-low"/><i className="island-high"/><i className="island-tree"/><i className="island-stairs"/></div><strong>双层岩岛</strong><span>打开可编辑室外样板</span><small>台地与悬崖 · 草岩浅水 · 植被散布</small></button>
    <details className="asset-details asset-project-tools" open><summary>工程工具与 B1 校样</summary><button className="asset-new-card" disabled={busy} onClick={onCalibration}><strong>木纹书房</strong><span>打开材质校样</span><small>B1 · 3 张位图 · 2 件家具</small></button><button className="secondary asset-migrate" disabled={busy} onClick={onMigrate}><FolderOpen size={15}/>迁移当前 M0 场景</button></details>
    <details className="asset-details asset-recents" open={!scene}><summary>最近的完整工程 <small>{recent.length}</small></summary><div className="asset-recent">{recent.length ? recent.map(record => <button key={record.sceneId} disabled={busy} className={record.sceneId === scene?.sceneId ? 'selected' : ''} onClick={() => onOpen(record.sceneId)}><FolderOpen size={15}/><span>{record.title}<small>r{record.revision} · {new Date(record.savedAt).toLocaleDateString('zh-CN')}</small></span></button>) : <p>尚无素材工程。可从样板开始。</p>}</div></details>

  </aside>
}
