import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { PencilRuler } from 'lucide-react'
import { STRUCTURE_COLLECTIONS_V4, type StructureKindV4 } from '../../core/v4/structure-continuity'
import type { StructureRestoreModeV4 } from '../../core/v4/structure-restore'
import type { CompleteProjectV5, NamedSnapshotV5 } from '../../io/v5/types'
import type { SelectionSessionV2 } from '../v2/selection-session'
import VirtualEntityList from '../v2/VirtualEntityList'
import type { StructureRestoreInspectionV5, StructureRestorePreviewV5, WorkspaceV5 } from './workspace'

type Props = {
  project: CompleteProjectV5
  snapshot: NamedSnapshotV5
  workspace: WorkspaceV5
  session: SelectionSessionV2
  disabled: boolean
  onAction: (run: () => Promise<void>, source?: string) => Promise<void>
  onPreview: (preview: StructureRestorePreviewV5) => void
}
const kinds: Record<StructureKindV4, string> = { room: '房间', wall: '墙体', vertex: '顶点', opening: '门窗', note: '注记' }
const fields: Record<string, string> = {
  xMm: 'X 坐标', yMm: 'Y 坐标', thicknessMm: '墙厚', purpose: '房间名称', visibility: '可见性', accessExpectation: '连通要求',
  blocksMovement: '阻挡移动', blocksSight: '阻挡视线', offsetMm: '近端偏移', widthMm: '净宽', kind: '类型', state: '开关状态',
  locked: '通行锁', secret: '秘密', revealed: '已揭示', anchor: '坐标锚点', title: '标题', text: '内容', discovered: '发现状态',
}
const fieldLabel = (key: string) => fields[key] ?? key
function valueLabel(value: unknown): string {
  if (value == null) return '无'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (value === 'gm') return '仅主持人'
  if (value === 'public') return '玩家可见'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export default function StructureHistoryPanel({ project, snapshot, workspace, session, disabled, onAction, onPreview }: Props) {
  const canvasIds = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set()), [mode, setMode] = useState<StructureRestoreModeV4>('geometry')
  const [kind, setKind] = useState<StructureKindV4>('room')
  const [inspection, setInspection] = useState<StructureRestoreInspectionV5 | null>(null)
  const [dependenciesConfirmed, setDependenciesConfirmed] = useState(false), [layersConfirmed, setLayersConfirmed] = useState(false)
  const rows = useMemo(() => Object.entries(STRUCTURE_COLLECTIONS_V4).flatMap(([key, collection]) => Object.values(snapshot.project.document[collection]).flatMap(entity => {
    if (!Object.hasOwn(project.document[collection], entity.id)) return []
    const name = key === 'room' ? snapshot.project.document.rooms[entity.id].purpose || '未命名房间'
      : key === 'note' ? snapshot.project.document.notes[entity.id].title || snapshot.project.document.notes[entity.id].text.slice(0, 24)
        : key === 'opening' ? snapshot.project.document.openings[entity.id].kind === 'door' ? '门' : '窗' : kinds[key as StructureKindV4]
    return [{ id: entity.id, label: name, detail: kinds[key as StructureKindV4], kind: key as StructureKindV4 }]
  })), [project.document, snapshot.project.document])
  const rowIds = useMemo(() => new Set(rows.map(row => row.id)), [rows])
  const invalidate = () => { setInspection(null); setDependenciesConfirmed(false); setLayersConfirmed(false) }
  useEffect(() => { invalidate() }, [project.document, snapshot.id, snapshot.contentHash, selected, mode])
  const invalidCanvas = canvasIds.some(id => !rowIds.has(id)), overBudget = selected.size > 256
  return <div className="history-scope structure-history-scope" aria-label="结构恢复范围">
    <h3>{snapshot.name}<small>r{snapshot.sourceRevision} · 建筑结构</small></h3>
    <p className="history-empty">仅可使用本次打开期间建立的快照。重开工程、导入，或删除重建、改变所选结构连接后，请重新建立快照。</p>
    <label className="history-mode">恢复属性<select aria-label="结构恢复模式" disabled={disabled} value={mode} onChange={event => setMode(event.target.value as StructureRestoreModeV4)}><option value="geometry">位置与尺寸</option><option value="properties">位置、尺寸与业务属性</option></select></label>
    <p className="history-empty">{mode === 'geometry' ? '恢复顶点、墙厚、开口位置/净宽与坐标注记。' : '另恢复房间名称/可见性/连通声明，墙体阻挡、门窗状态/秘密及注记内容。'} 保留当前图层、材质、支撑、高程和编辑锁。</p>
    <div className="history-scope-tools"><button className="secondary" disabled={disabled || !canvasIds.length || invalidCanvas} onClick={() => setSelected(new Set(canvasIds))}>使用所选建筑 · {canvasIds.length}</button><button aria-label="清空结构恢复范围" disabled={disabled || !selected.size} onClick={() => setSelected(new Set())}>清空</button></div>
    <label className="history-mode">对象类型<select aria-label="历史建筑对象类型" value={kind} disabled={disabled} onChange={event => setKind(event.target.value as StructureKindV4)}>{Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <VirtualEntityList key={`${snapshot.id}-${kind}`} noun="建筑对象" selectionHint="Enter 切换所选" items={rows.filter(row => row.kind === kind)} selectedIds={selected} locateId={[...selected].find(id => rows.some(row => row.id === id && row.kind === kind)) ?? null} busy={disabled} onSelect={(id, operation) => setSelected(current => {
      const next = new Set(current)
      if (operation === 'subtract' || operation !== 'add' && next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })}/>
    <p className="history-picker-count" aria-live="polite">已选 {selected.size} 项建筑对象</p>
    {selected.size > 0 && <details className="history-selected-ids"><summary>完整结构请求 · {selected.size} 项</summary><textarea aria-label="结构恢复请求 ID" readOnly rows={4} value={[...selected].join('\n')}/></details>}
    {overBudget && <p role="alert" className="history-limit">超过单次 256 项选择上限；依赖展开后的操作仍须满足 256 条预算。</p>}
    <button className="secondary asset-wide" disabled={disabled || !selected.size || overBudget} onClick={() => void onAction(async () => {
      invalidate()
      setInspection(await workspace.inspectStructureRestore(snapshot.id, { ids: [...selected], mode }))
    }, '检查结构恢复依赖')}>检查完整结构依赖</button>
    {inspection && <div className="structure-restore-review" aria-label="结构恢复依赖确认">
      <p className="building-scope">{inspection.scope.rootIds.length} 项请求 · {inspection.scope.writeIds.length} 项写入范围 · {inspection.scope.commandCost} 条操作 · {inspection.scope.impacts.length} 项完整影响</p>
      <details className="history-selected-ids" open><summary>完整影响与字段</summary><textarea readOnly aria-label="结构恢复完整影响" rows={8} value={inspection.scope.impacts.map(impact => `${impact.role === 'root' ? '所选' : impact.role === 'geometry' ? '共享几何' : '依赖检查'} · ${kinds[impact.kind as StructureKindV4] ?? impact.kind} · ${impact.name} · ${impact.id}\n图层：${project.document.userLayers[impact.layerId]?.name ?? impact.layerId} · ${impact.fields.length ? impact.fields.map(fieldLabel).join('、') : '保留业务属性'}`).join('\n\n')}/></details>
      <label className="building-check"><input type="checkbox" aria-label="确认结构恢复全部依赖" checked={dependenciesConfirmed} disabled={disabled} onChange={event => setDependenciesConfirmed(event.target.checked)}/>已核对全部 {inspection.scope.dependencyIds.length} 项扩展依赖</label>
      {inspection.scope.requiredLayerIds.length > 0 && <><p className="building-scope">涉及其他图层或已移层：{inspection.scope.requiredLayerIds.map(id => project.document.userLayers[id]?.name ?? id).join(' · ')}</p><label className="building-check"><input type="checkbox" aria-label="确认结构恢复跨层影响" checked={layersConfirmed} disabled={disabled} onChange={event => setLayersConfirmed(event.target.checked)}/>确认上述图层的完整影响</label></>}
      <button className="primary asset-wide" disabled={disabled || !dependenciesConfirmed || inspection.scope.requiredLayerIds.length > 0 && !layersConfirmed} onClick={() => void onAction(async () => {
        workspace.assertCheckpoint(inspection.checkpoint)
        const preview = await workspace.prepareStructureRestore(snapshot.id, { ids: [...selected], mode,
          acknowledgedDependencyIds: inspection.scope.dependencyIds, confirmedLayerIds: inspection.scope.requiredLayerIds })
        if (preview.sourceContentHash !== inspection.sourceContentHash) { workspace.cancelStructureRestore(preview); throw new Error('源快照已变化，请重新检查完整依赖。') }
        onPreview(preview)
      }, '预览结构恢复')}>预览结构局部恢复</button>
    </div>}
  </div>
}

export function StructureRestoreChangesPanel({ preview, current }: { preview: StructureRestorePreviewV5; current: CompleteProjectV5 }) {
  const privacy = preview.plan.changes.filter(change => {
    const before = change.before as Record<string, unknown>, after = change.after as Record<string, unknown>
    return before.visibility === 'gm' && after.visibility === 'public' || before.secret === true && after.secret === false || before.revealed === false && after.revealed === true
  })
  return <section className="history-changes" aria-label="结构局部恢复差异">
    <div className="asset-section-heading"><PencilRuler size={16}/><h2>结构恢复差异</h2></div>
    <dl className="asset-facts"><dt>历史快照</dt><dd>{preview.snapshot.name} · r{preview.snapshot.sourceRevision}</dd><dt>当前修订</dt><dd>r{preview.currentRevision}</dd><dt>属性范围</dt><dd>{preview.plan.request.mode === 'geometry' ? '位置与尺寸' : '位置、尺寸与业务属性'}</dd><dt>实际变化</dt><dd>{preview.plan.changes.length} 项</dd><dt>依赖检查</dt><dd>{preview.plan.dependencyIds.length} 项</dd></dl>
    {privacy.length > 0 && <div className="history-privacy-review" role="alert"><strong>{privacy.length} 项恢复会改变玩家可见性或秘密揭示</strong><p>采用前请核对下方可见性、秘密和揭示字段。</p></div>}
    <p className="history-empty">保留当前图层、材质、支撑、高程、编辑锁，以及范围外的新编辑。采用前先保存当前保护快照。</p>
    {!preview.plan.changed && <p className="history-empty">所选属性与快照一致，无需恢复</p>}
    {preview.plan.changes.map(change => <article className="history-change" data-structure-restore-change-id={change.id} key={change.id}>
      <h3>{change.name}<small>{kinds[change.kind]}</small></h3><code>{change.id}</code><p className="history-empty">图层 · {current.document.userLayers[change.layerId]?.name ?? change.layerId}</p>
      <dl>{change.fields.map(key => <div key={key} data-change-field={key}><dt>{fieldLabel(key)}</dt><dd><span>{valueLabel((change.before as Record<string, unknown>)[key])}</span><b>→</b><span>{valueLabel((change.after as Record<string, unknown>)[key])}</span></dd></div>)}</dl>
    </article>)}
  </section>
}
