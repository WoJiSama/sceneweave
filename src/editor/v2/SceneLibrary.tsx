import { useState } from 'react'
import { FolderOpen, Layers3, Move, PencilRuler } from 'lucide-react'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { groupName, propName } from './SceneInspector'

type Props = {
  project: CompleteProjectV2 | null; selected: string | null; busy: boolean
  recent: { sceneId: string; title: string; revision: number; savedAt: number }[]
  onStudy: () => void; onCalibration: () => void; onMigrate: () => void
  onOpen: (id: string) => void; onSelect: (id: string | null) => void
}
export default function SceneLibrary({ project, selected, busy, recent, onStudy, onCalibration, onMigrate, onOpen, onSelect }: Props) {
  const [tab, setTab] = useState<'objects' | 'structure' | 'groups'>('objects')
  const scene = project?.document
  const item = (id: string, label: string, icon = <Move size={14}/>, detail?: string) => <button key={id} data-entity-id={id} disabled={busy} className={id === selected ? 'selected' : ''} onClick={() => onSelect(id)}>{icon}<span>{label}</span>{detail && <small>{detail}</small>}</button>
  return <aside className="asset-library"><div className="asset-section-heading"><Layers3 size={16}/><h2>场景与组件</h2></div>
    <button className="asset-study-card" disabled={busy} onClick={onStudy}><div className="asset-study-illustration"><i className="study-room"/><i className="study-terrace"/><i className="study-desk"/><i className="study-rug"/></div><strong>书房与露台</strong><span>打开可编辑建筑样板</span><small>厚墙 · 斜窗 · 木石铺装 · 组件组合</small></button>
    <details className="asset-details asset-project-tools" open><summary>工程工具与 B1 校样</summary><button className="asset-new-card" disabled={busy} onClick={onCalibration}><strong>木纹书房</strong><span>打开材质校样</span><small>B1 · 3 张位图 · 2 件家具</small></button><button className="secondary asset-migrate" disabled={busy} onClick={onMigrate}><FolderOpen size={15}/>迁移当前 M0 场景</button></details>
    <details className="asset-details asset-recents" open={!scene}><summary>最近的完整工程 <small>{recent.length}</small></summary><div className="asset-recent">{recent.length ? recent.map(record => <button key={record.sceneId} disabled={busy} className={record.sceneId === scene?.sceneId ? 'selected' : ''} onClick={() => onOpen(record.sceneId)}><FolderOpen size={15}/><span>{record.title}<small>r{record.revision} · {new Date(record.savedAt).toLocaleDateString('zh-CN')}</small></span></button>) : <p>尚无素材工程。可从样板开始。</p>}</div></details>
    {scene && project && <><div className="asset-library-tabs" role="group" aria-label="场景对象分类"><button disabled={busy} aria-pressed={tab === 'objects'} onClick={() => setTab('objects')}>物件</button><button disabled={busy} aria-pressed={tab === 'groups'} onClick={() => setTab('groups')}>组合</button><button disabled={busy} aria-pressed={tab === 'structure'} onClick={() => setTab('structure')}>结构</button></div>
      <div className="asset-entity-list">
        {tab === 'objects' && Object.values(scene.props).map(prop => item(prop.id, propName(project, prop.id), <Move size={14}/>, prop.visibility === 'gm' ? 'GM' : undefined))}
        {tab === 'groups' && (Object.keys(scene.prefabInstances).length ? Object.keys(scene.prefabInstances).map(id => item(id, groupName(project, id), <Layers3 size={14}/>, `${Object.values(scene.prefabInstances[id].members).filter(member => member.propId).length}件`)) : <p className="asset-muted">暂无组合，拆开的物件在「物件」中。</p>)}
        {tab === 'structure' && <>
          <h3>地面与铺装</h3>{Object.keys(scene.rooms).map((id, index) => item(id, id === 'study-room' ? '书房地面' : `房间地面 ${index + 1}`, <Layers3 size={14}/>))}{Object.keys(scene.terrainAreas).map((id, index) => item(id, id === 'terrace-area' ? '露台铺装' : `开放表面 ${index + 1}`, <Layers3 size={14}/>))}
          <h3>建筑墙体</h3>{Object.keys(scene.walls).map((id, index) => item(id, id === 'study-w1' ? '斜角墙与窗' : `墙体 ${index + 1}`, <PencilRuler size={14}/>))}
          <h3>房间边界</h3>{Object.keys(scene.vertices).map((id, index) => item(id, id === 'study-v1' ? '斜角顶点 · 北端' : id === 'study-v2' ? '斜角顶点 · 东端' : `建筑顶点 ${index + 1}`, <PencilRuler size={14}/>))}
          {!!Object.keys(scene.terrainAreas).length && <h3>开放表面轮廓</h3>}{Object.values(scene.terrainAreas).flatMap(area => area.boundaryMm.map((point, index) => item(point.id, `${area.id === 'terrace-area' ? '露台' : '表面'}轮廓点 ${index + 1}`, <PencilRuler size={14}/>)))}
        </>}
      </div></>}
  </aside>
}
