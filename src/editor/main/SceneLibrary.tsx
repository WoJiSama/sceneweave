import { useCallback, useMemo, useRef, useState } from 'react'
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
  layerFilter?: string
}
export default function SceneLibrary({ project, selected, selectedIds, busy, onSelect, hiddenIds, excludedIds, onOpenLayers, layerFilter }: Props) {
  const [tab, setTab] = useState<'all' | 'objects' | 'structure' | 'groups' | 'geometry'>('all')
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
    result.objects = [...Object.values(scene.props).map(prop => item(prop.id, prop.visibility === 'gm' ? '物件 · 仅主持人' : '物件')), ...Object.values(scene.decorations).map(decoration => item(decoration.id, decoration.visibility === 'gm' ? '装饰 · 仅主持人' : '装饰'))]
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
    if (layerFilter) for (const kind of Object.keys(result) as (keyof typeof result)[]) result[kind] = result[kind].filter(row => layerIdForEntity(scene, row.id) === layerFilter)
    return result
  }, [scene, hiddenIds, excludedIds, layerFilter])
  const shown = useMemo(() => tab === 'all' ? [...lists.objects, ...lists.groups, ...lists.structure, ...lists.geometry] : lists[tab], [lists, tab])
  const selectRef = useRef(onSelect); selectRef.current = onSelect
  const selectRow = useCallback<Props['onSelect']>((id, operation) => { setBlockedId(id && excludedIds?.has(id) ? id : null); selectRef.current(id, operation) }, [excludedIds])
  const selectedIn = (items: VirtualEntityItem[]) => items.find(item => selectedSet.has(item.id))?.id ?? null
  return <aside className="asset-library scene-library"><div className="asset-section-heading"><Layers3 size={16}/><h2>场景对象</h2></div>
    {scene && <><div className="asset-library-tabs" role="group" aria-label="场景对象分类">{(['all', 'objects', 'groups', 'structure', 'geometry'] as const).map(kind => <button type="button" key={kind} aria-pressed={tab === kind} onClick={() => setTab(kind)}>{{ all: '全部', objects: '物件与装饰', groups: '组合', structure: '结构', geometry: '顶点与边缘' }[kind]}</button>)}</div>
      {layerFilter && <p className="scene-library-filter" role="status">当前浏览 · {scene.userLayers[layerFilter]?.name ?? '已移除图层'}。此筛选不会改变绘制图层或画布选区。</p>}
      <div className="asset-entity-list">
        {blockedId && scene && excludedIds?.has(blockedId) && <div className="scene-selection-blocked" role="status"><p>「{createEntityLabeler(scene)(blockedId)}」{hiddenIds?.has(blockedId) ? '已在编辑视图中隐藏。请显示所属图层、退出独显，或检查其支撑和附着对象是否隐藏。' : '在当前选择范围外。请切换当前绘制图层，或改为「所有可见图层」。'}</p>{onOpenLayers && <button type="button" className="secondary" onClick={onOpenLayers}>调整图层与选择范围</button>}</div>}
        <VirtualEntityList key={scene.sceneId} items={shown} noun="对象" selectedIds={selectedSet} locateId={selectedIn(shown)} busy={busy} searchDisabled={false} onSelect={selectRow}/>
        <details className="workspace-detail-disclosure scene-object-help"><summary>对象选择与浏览说明</summary><p className="asset-muted">按住 Shift 再点击、按 Enter 或空格可增选；按住 Option / Alt 可减选。</p>{Object.keys(scene.surfaceRules).length > 0 && <p className="asset-muted">地面铺装与植被分布规则在「地形 → 布景」中查看和调整。</p>}</details>
      </div></>}
  </aside>
}
