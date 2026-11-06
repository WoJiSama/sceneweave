import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layers3 } from 'lucide-react'
import type { EditableProject } from '../../application/workspace/project'
import { createEntityLabeler } from './entity-label'
import { enumerateLayerEntities, layerIdForEntity } from '../../shared/commands/layers'
import VirtualEntityList from './VirtualEntityList'
import type { VirtualEntityItem } from './VirtualEntityList'

type Props = {
  project: EditableProject | null; selected: string | null; selectedIds?: string[]; busy: boolean
  onSelect: (id: string | null, operation?: 'replace' | 'add' | 'subtract') => void
  hiddenIds?: ReadonlySet<string>; excludedIds?: ReadonlySet<string>; onOpenLayers?: () => void
}
export default function SceneLibrary({ project, selected, selectedIds, busy, onSelect, hiddenIds, excludedIds, onOpenLayers }: Props) {
  const [tab, setTab] = useState<'objects' | 'structure' | 'groups'>('objects')
  const [geometryOpen, setGeometryOpen] = useState(false)
  const [blockedId, setBlockedId] = useState<string | null>(null)
  const scene = project?.document
  const selectedSet = useMemo(() => new Set(selectedIds ?? (selected ? [selected] : [])), [selectedIds, selected])
  const lists = useMemo(() => {
    const result: Record<'objects' | 'groups' | 'structure' | 'geometry', VirtualEntityItem[]> = { objects: [], groups: [], structure: [], geometry: [] }
    if (!scene) return result
    const label = createEntityLabeler(scene)
    const entities = new Map(enumerateLayerEntities(scene).map(entity => [entity.id, entity]))
    const item = (id: string, detail?: string) => {
      const layerId = layerIdForEntity(scene, id), layer = layerId ? scene.userLayers[layerId] : undefined
      const state = hiddenIds?.has(id) ? '视图已隐藏' : excludedIds?.has(id) ? '选择范围外' : layer?.editLocked ? '图层已锁定' : entities.get(id)?.editLocked ? '自身已锁定' : null
      return { id, label: label(id), detail: [detail, state].filter(Boolean).join(' · ') || undefined }
    }
    result.objects = Object.values(scene.props).map(prop => item(prop.id, prop.visibility === 'gm' ? '仅主持人' : undefined))
    result.groups = [
      ...Object.values(scene.prefabInstances).map(group => item(group.id, `组合 · ${Object.values(group.members).filter(member => member.propId).length} 件`)),
      ...Object.values(scene.scatterGroups).map(group => item(group.id, `散布 · ${Object.values(group.members).filter(member => member.propId).length} 件`)),
      ...Object.values(scene.decorationClusters).map(group => item(group.id, `布景 · ${Object.values(group.members).filter(member => member.entityId).length} 件`)),
    ]
    const structureKinds = { rooms: '房间', terrainAreas: '地形', terrainConnections: '高差连接', paths: '道路', walls: '墙体', openings: '门窗', regions: '区域', notes: '注记' } as const
    result.structure = Object.entries(structureKinds).flatMap(([collection, kind]) => Object.keys(scene[collection as keyof typeof structureKinds]).map(id => item(id, kind)))
    result.geometry = [
      ...Object.keys(scene.terrainEdges).map(id => item(id, '地形边缘')),
      ...Object.keys(scene.vertices).map(id => item(id, '建筑顶点')),
      ...Object.values(scene.terrainAreas).flatMap(area => area.boundaryMm.map(point => item(point.id, '地形轮廓点'))),
    ]
    return result
  }, [scene, hiddenIds, excludedIds])
  const geometryIds = useMemo(() => new Set(lists.geometry.map(item => item.id)), [lists.geometry])
  const selectedGeometryId = [...selectedSet].find(id => geometryIds.has(id))
  useEffect(() => { if (selectedGeometryId) setGeometryOpen(true) }, [selectedGeometryId])
  const selectRef = useRef(onSelect); selectRef.current = onSelect
  const selectRow = useCallback<Props['onSelect']>((id, operation) => { setBlockedId(id && excludedIds?.has(id) ? id : null); selectRef.current(id, operation) }, [excludedIds])
  const selectedIn = (items: VirtualEntityItem[]) => items.find(item => selectedSet.has(item.id))?.id ?? null
  return <aside className="asset-library"><div className="asset-section-heading"><Layers3 size={16}/><h2>场景对象</h2></div>
    {scene && <><div className="asset-library-tabs" role="group" aria-label="场景对象分类"><button disabled={busy} aria-pressed={tab === 'objects'} onClick={() => setTab('objects')}>物件</button><button disabled={busy} aria-pressed={tab === 'groups'} onClick={() => setTab('groups')}>组合</button><button disabled={busy} aria-pressed={tab === 'structure'} onClick={() => setTab('structure')}>结构</button></div>
      <div className="asset-entity-list"><p className="asset-muted">按住 Shift 再点击、按 Enter 或空格可增选；按住 Option / Alt 可减选。</p>
        {blockedId && scene && excludedIds?.has(blockedId) && <div className="scene-selection-blocked" role="status"><p>「{createEntityLabeler(scene)(blockedId)}」{hiddenIds?.has(blockedId) ? '已在编辑视图中隐藏。请显示所属图层、退出独显，或检查其支撑和附着对象是否隐藏。' : '在当前选择范围外。请切换当前图层，或改为「所有可见图层」。'}</p>{onOpenLayers && <button type="button" className="secondary" onClick={onOpenLayers}>调整图层与选择范围</button>}</div>}
        <VirtualEntityList key={`${scene.sceneId}-${tab}`} items={lists[tab]} noun={tab === 'objects' ? '物件' : tab === 'groups' ? '组合' : '结构'} selectedIds={selectedSet} locateId={selectedIn(lists[tab])} busy={busy} onSelect={selectRow}/>
        {tab === 'structure' && <details className="asset-details" open={geometryOpen} onToggle={event => setGeometryOpen(event.currentTarget.open)}><summary>顶点与边缘 · {lists.geometry.length} 项</summary><p className="asset-muted">用于精确调整建筑和地形轮廓。</p>{geometryOpen && <VirtualEntityList key={`${scene.sceneId}-geometry`} items={lists.geometry} noun="顶点与边缘" selectedIds={selectedSet} locateId={selectedIn(lists.geometry)} busy={busy} onSelect={selectRow}/>}</details>}
      </div></>}
  </aside>
}
