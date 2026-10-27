import { useEffect, useId, useRef, useState } from 'react'
import { Map, MapPin, Route, Trees } from 'lucide-react'
import type { PointMm, SceneDocument } from '../../shared/model/scene.js'
import type { RegionalEditRequest } from '../../shared/terrain-generation/regional-authoring.js'
import type { RegionalModel1 } from '../../shared/terrain-generation/contracts.js'
import type { RegionalDrillDownResult } from '../../shared/terrain-generation/regional-authoring.js'
import type { RegionalCandidate, RegionalCreateUiRequest, RegionalDrillDownUiRequest } from '../../application/workspace/regional.js'
import './regional.css'

type FeatureKind = 'area' | 'line' | 'landmark' | 'symbol'
const featureNames = { area: '区域面', line: '区域线', landmark: '地标', symbol: '图符' } as const
const presetNames = { riverlands: '河谷古道', lakewood: '林间湖区', highlands: '群山隘口' } as const
const newId = () => crypto.randomUUID()
const numberText = (mm: number) => (mm / 1000).toLocaleString() + ' 米'
interface Draft { kind: FeatureKind; id: string; type: string; points: PointMm[]; widthMm: number; actualWidthMm: number | null; name: string; description: string; definitionId: string; visibility: 'public' | 'gm'; editLocked: boolean; elevationMm: number; purpose: 'settlement' | 'ruin' | 'camp' | 'natural' | 'other'; renderOrder: number }
const newDraft = (kind: FeatureKind, scene: SceneDocument): Draft => {
  const box = scene.exportBoundsMm, x = Math.round(box.x + box.width * .3), y = Math.round(box.y + box.height * .3), step = Math.max(1000, Math.round(Math.min(box.width, box.height) * .08))
  return { kind, id: newId(), type: kind === 'line' ? 'road' : 'forest', points: kind === 'area' ? [{ x, y }, { x: x + step, y }, { x: x + step, y: y + step }, { x, y: y + step }] : kind === 'line' ? [{ x, y }, { x: x + step, y: y + step }] : [{ x, y }], widthMm: 25_000, actualWidthMm: null, name: '新地标', description: '', definitionId: Object.keys(scene.regional?.symbolDefinitions ?? {})[0] ?? '', visibility: 'public', editLocked: false, elevationMm: 0, purpose: 'other', renderOrder: 0 }
}
function readDraft(kind: FeatureKind, id: string, scene: SceneDocument): Draft {
  const draft = newDraft(kind, scene), regional = scene.regional!
  if (kind === 'area') { const row = regional.areas[id]; return { ...draft, id, type: row.kind, points: structuredClone(row.boundaryMm), visibility: row.visibility, editLocked: row.editLocked, elevationMm: row.relativeElevationMm ?? 0 } }
  if (kind === 'line') { const row = regional.lines[id]; return { ...draft, id, type: row.kind, points: row.pointsMm.map(point => ({ ...point.positionMm })), widthMm: row.displayWidthMm, actualWidthMm: row.actualWidthMm, visibility: row.visibility, editLocked: row.editLocked } }
  if (kind === 'landmark') { const row = regional.landmarks[id]; return { ...draft, id, points: [{ ...row.positionMm }], name: row.name, description: row.description, definitionId: row.definitionRef.id, purpose: row.purpose, visibility: row.visibility, editLocked: row.editLocked } }
  const row = regional.symbols[id]; return { ...draft, id, points: [{ ...row.positionMm }], definitionId: row.definitionRef.id, renderOrder: row.renderOrder, visibility: row.visibility, editLocked: row.editLocked }
}
function editRequest(scene: SceneDocument, draft: Draft, operationId: string, remove = false): RegionalEditRequest {
  const regional = scene.regional!, common = { kind: 'regionalEdit' as const, sceneId: scene.sceneId, operationId }
  if (remove) return { ...common, operation: ({ area: 'deleteArea', line: 'deleteLine', landmark: 'deleteLandmark', symbol: 'deleteSymbol' } as const)[draft.kind], entityId: draft.id }
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
  const fields = { id: draft.id, floorId, layerId, visibility: draft.visibility, editLocked: draft.editLocked }
  if (draft.kind === 'area') return { ...common, operation: 'upsertArea', area: { ...fields, ...regional.areas[draft.id], visibility: draft.visibility, editLocked: draft.editLocked, kind: draft.type as RegionalModel1['areas'][string]['kind'], boundaryMm: structuredClone(draft.points), relativeElevationMm: draft.elevationMm } }
  if (draft.kind === 'line') { const old = regional.lines[draft.id]; return { ...common, operation: 'upsertLine', line: { ...fields, ...old, visibility: draft.visibility, editLocked: draft.editLocked, kind: draft.type as RegionalModel1['lines'][string]['kind'], pointsMm: draft.points.map((positionMm, i) => ({ id: old?.pointsMm[i]?.id ?? draft.id + '-point-' + i, positionMm: { ...positionMm } })), displayWidthMm: draft.widthMm, actualWidthMm: draft.actualWidthMm } } }
  const definition = regional.symbolDefinitions[draft.definitionId]
  if (!definition) throw new Error('请选择完整的固定图符定义。')
  if (draft.kind === 'landmark') return { ...common, operation: 'upsertLandmark', landmark: { ...fields, ...regional.landmarks[draft.id], visibility: draft.visibility, editLocked: draft.editLocked, definitionRef: { id: definition.id, version: definition.version }, positionMm: { ...draft.points[0] }, name: draft.name, description: draft.description, purpose: draft.purpose } }
  const old = regional.symbols[draft.id]
  return { ...common, operation: 'upsertSymbol', symbol: { ...fields, definitionRef: { id: definition.id, version: definition.version }, positionMm: { ...draft.points[0] }, visualBoundsMm: { ...definition.visualBoundsMm }, renderOrder: draft.renderOrder, managementKey: old?.managementKey ?? null, sourceRef: old?.sourceRef ?? null } }
}

export default function RegionalPanel({ document, busy, error, candidate, sourceComparison, disabled = false, onPreviewCreate, onPreviewEdit, onPreviewDrillDown, onCompareSource, onAdopt, onCancel, onDraftChange }: {
  document: SceneDocument | null; busy: boolean; error: string | null; candidate: RegionalCandidate | null; sourceComparison?: string | null; disabled?: boolean
  onPreviewCreate: (request: RegionalCreateUiRequest) => Promise<void> | void; onPreviewEdit: (request: RegionalEditRequest) => Promise<void> | void
  onPreviewDrillDown: (request: RegionalDrillDownUiRequest) => Promise<void> | void; onCompareSource: () => Promise<void> | void
  onAdopt: () => Promise<void> | void; onCancel: () => void; onDraftChange?: (dirty: boolean) => void
}) {
  const heading = useId(), [preset, setPreset] = useState<RegionalCreateUiRequest['preset']>('riverlands'), [seed, setSeed] = useState('regional-2026-1')
  const [widthKm, setWidthKm] = useState(10), [heightKm, setHeightKm] = useState(8), [draft, setDraft] = useState<Draft | null>(null), [selected, setSelected] = useState('')
  const [selectionMm, setSelection] = useState({ x: 0, y: 0, width: 500_000, height: 500_000 }), [localError, setLocalError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false), [submittedKey, setSubmittedKey] = useState<string | null>(null)
  const operation = useRef(newId()), sceneId = document?.sceneId, regional = document?.mapMode === 'regional' ? document.regional : null
  const source = Object.values(document?.generation?.sourceLinks ?? {})[0]
  const key = JSON.stringify({ preset, seed, widthKm, heightKm, draft, selectionMm })
  const matches = !!candidate && key === submittedKey
  useEffect(() => { setDraft(null); setSelected(''); setDirty(false); setSubmittedKey(null); setConfirmed(false); operation.current = newId(); if (document) setSelection({ x: document.exportBoundsMm.x, y: document.exportBoundsMm.y, width: Math.min(500_000, document.exportBoundsMm.width), height: Math.min(500_000, document.exportBoundsMm.height) }) }, [sceneId])
  useEffect(() => { setConfirmed(false) }, [key, candidate])
  useEffect(() => { onDraftChange?.(dirty) }, [dirty, onDraftChange])
  const change = <T,>(setter: (value: T) => void, value: T) => { setter(value); setDirty(true); setConfirmed(false) }
  const alter = (values: Partial<Draft>) => { if (draft) change(setDraft, { ...draft, ...values }) }
  const run = async (action: () => Promise<void> | void, preview = false) => { setLocalError(null); try { await action(); if (preview) setSubmittedKey(key) } catch (failure) { setLocalError(failure instanceof Error ? failure.message : String(failure)) } }
  const cancel = () => { onCancel(); setDraft(null); setSelected(''); setDirty(false); setConfirmed(false); setSubmittedKey(null); setLocalError(null); operation.current = newId() }
  const number = (label: string, value: number, update: (value: number) => void, min?: number, max?: number, step = 1) => <label>{label}<input type="number" aria-label={label} value={value} min={min} max={max} step={step} onChange={event => update(Number(event.target.value))}/></label>
  const features = regional ? ([['area', regional.areas], ['line', regional.lines], ['landmark', regional.landmarks], ['symbol', regional.symbols]] as const).flatMap(([kind, collection]) => Object.values(collection).map(row => ({ kind, id: row.id, label: featureNames[kind] + ' · ' + ('name' in row ? row.name : 'kind' in row ? row.kind : regional.symbolDefinitions[row.definitionRef.id]?.name ?? row.id) }))) : []
  const draftValid = !!draft && draft.points.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))
  const drillResult = candidate?.kind === 'drillDown' ? candidate.result as RegionalDrillDownResult : null
  const drillSourceCount = drillResult?.sourceLink.inherited.length ?? 0
  const drillDocument = drillResult?.document
  const materialization = candidate?.materialization
  const sourceOnlyEntries = materialization?.entries.filter(entry => entry.status === 'sourceOnly') ?? []
  const partialEntries = materialization?.entries.filter(entry => entry.status === 'partial') ?? []
  return <section className="regional-panel" aria-labelledby={heading}>
    <div className="asset-section-heading"><Map size={17}/><h2 id={heading}>区域地图</h2></div>
    <p className="regional-intro">用区域面、道路、山脊与直立图符规划旅程；选定小范围后，按原比例下钻成独立场景。</p>
    <fieldset disabled={busy || disabled}><legend>新建独立区域地图</legend>
      <label>区域配方<select aria-label="区域配方" value={preset} onChange={event => change(setPreset, event.target.value as RegionalCreateUiRequest['preset'])}>{Object.entries(presetNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <div className="regional-pair">{number('区域宽 km', widthKm, value => change(setWidthKm, value), .5, 50, .1)}{number('区域高 km', heightKm, value => change(setHeightKm, value), .5, 50, .1)}</div>
      <label>区域种子<input aria-label="区域种子" value={seed} maxLength={128} onChange={event => change(setSeed, event.target.value)}/></label>
      <button type="button" className="primary asset-wide" disabled={!seed.trim() || ![widthKm, heightKm].every(value => value >= .5 && value <= 50 && Number.isSafeInteger(value * 1_000_000))} onClick={() => void run(() => onPreviewCreate({ preset, seed, widthMm: Math.round(widthKm * 1_000_000), heightMm: Math.round(heightKm * 1_000_000) }), true)}>预览独立区域地图</button>
    </fieldset>
    {regional && document && <><fieldset disabled={busy || disabled}><legend>编辑面、线、地标和图符</legend>
      <label>区域实体<select aria-label="区域实体" value={selected} onChange={event => { const value = event.target.value; setSelected(value); const found = features.find(row => row.kind + ':' + row.id === value); change(setDraft, found ? readDraft(found.kind, found.id, document) : null) }}><option value="">选择现存实体</option>{features.map(row => <option key={row.kind + ':' + row.id} value={row.kind + ':' + row.id}>{row.label}</option>)}</select></label>
      <div className="regional-add" role="group" aria-label="新增区域实体">{(['area', 'line', 'landmark', 'symbol'] as const).map(kind => <button type="button" className="secondary" key={kind} onClick={() => { setSelected(''); change(setDraft, newDraft(kind, document)) }}>{kind === 'area' ? <Trees size={13}/> : kind === 'line' ? <Route size={13}/> : <MapPin size={13}/>}新增{featureNames[kind]}</button>)}</div>
      {draft && <div className="regional-edit">
        <h3>{selected ? '修改' : '新增'}{featureNames[draft.kind]}</h3>
        {draft.kind === 'area' || draft.kind === 'line' ? <label>地貌类型<select aria-label="区域地貌类型" value={draft.type} onChange={event => alter({ type: event.target.value })}>{(draft.kind === 'area' ? [['land', '陆地'], ['water', '水域'], ['forest', '森林'], ['hill', '丘陵']] : [['river', '河流'], ['ridge', '山脊'], ['road', '道路']]).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> : <label>固定原创图符<select aria-label="区域固定图符" value={draft.definitionId} onChange={event => alter({ definitionId: event.target.value })}>{Object.values(regional.symbolDefinitions).map(row => <option key={row.id} value={row.id}>{row.name} · v{row.version}</option>)}</select></label>}
        {draft.kind === 'landmark' && <><label>地标名称<input aria-label="区域地标名称" maxLength={120} value={draft.name} onChange={event => alter({ name: event.target.value })}/></label><label>地标说明<textarea aria-label="区域地标说明" maxLength={2000} value={draft.description} onChange={event => alter({ description: event.target.value })}/></label><label>地标用途<select aria-label="区域地标用途" value={draft.purpose} onChange={event => alter({ purpose: event.target.value as Draft['purpose'] })}>{[['settlement', '聚落'], ['ruin', '古迹'], ['camp', '营地'], ['natural', '自然地标'], ['other', '其他']].map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label></>}
        <details open><summary>{draft.kind === 'area' ? '边界顶点' : draft.kind === 'line' ? '线控制点' : '锚点坐标'} · 整数毫米</summary>{draft.points.map((point, i) => <div className="regional-pair" key={i}>{(['x', 'y'] as const).map(axis => number('区域点 ' + (i + 1) + ' ' + axis.toUpperCase() + ' mm', point[axis], value => alter({ points: draft.points.map((row, index) => index === i ? { ...row, [axis]: value } : row) })))}</div>)}{(draft.kind === 'area' || draft.kind === 'line') && <div className="regional-pair"><button type="button" className="secondary" disabled={draft.points.length >= 128} onClick={() => { const last = draft.points.at(-1)!; alter({ points: [...draft.points, { x: Math.min(document.exportBoundsMm.x + document.exportBoundsMm.width, last.x + 1000), y: Math.min(document.exportBoundsMm.y + document.exportBoundsMm.height, last.y + 1000) }] }) }}>添加控制点</button><button type="button" className="secondary" disabled={draft.points.length <= (draft.kind === 'area' ? 3 : 2)} onClick={() => alter({ points: draft.points.slice(0, -1) })}>移除末点</button></div>}</details>
        {draft.kind === 'area' && number('区域相对高程 mm', draft.elevationMm, value => alter({ elevationMm: value }))}
        {draft.kind === 'line' && <>{number('区域显示线宽 mm', draft.widthMm, value => alter({ widthMm: value }), 1)}<label><input type="checkbox" aria-label="区域实际线宽已知" checked={draft.actualWidthMm !== null} onChange={event => alter({ actualWidthMm: event.target.checked ? 5000 : null })}/>实际宽度已知</label>{draft.actualWidthMm !== null && number('区域实际线宽 mm', draft.actualWidthMm, value => alter({ actualWidthMm: value }), 1)}<p className="regional-hint">显示线宽用于制图；未知实际宽度时，下钻会明确保留估算标记。</p></>}
        {draft.kind === 'symbol' && number('区域图符绘制顺序', draft.renderOrder, value => alter({ renderOrder: value }))}
        <label>可见范围<select aria-label="区域可见范围" value={draft.visibility} onChange={event => alter({ visibility: event.target.value as Draft['visibility'] })}><option value="public">玩家与主持人</option><option value="gm">仅主持人</option></select></label>
        <label><input type="checkbox" aria-label="区域编辑锁定" checked={draft.editLocked} onChange={event => alter({ editLocked: event.target.checked })}/>采用后锁定此实体</label>
        <button type="button" className="primary asset-wide" disabled={!draftValid} onClick={() => void run(() => onPreviewEdit(editRequest(document, draft, operation.current)), true)}>预览区域实体修改</button>
        {selected && <button type="button" className="secondary asset-wide" onClick={() => void run(() => onPreviewEdit(editRequest(document, draft, operation.current, true)), true)}>预览删除区域实体</button>}
      </div>}
    </fieldset>
    <fieldset disabled={busy || disabled}><legend>选区下钻为独立场景</legend><p className="regional-hint">仅继承公开内容。最多 500 × 500 米，只平移坐标，保持实际长度；区域道路不代表人物已经可以通行。</p>
      <div className="regional-pair">{number('下钻 X mm', selectionMm.x, value => change(setSelection, { ...selectionMm, x: value }))}{number('下钻 Y mm', selectionMm.y, value => change(setSelection, { ...selectionMm, y: value }))}</div>
      <div className="regional-pair">{number('下钻宽 mm', selectionMm.width, value => change(setSelection, { ...selectionMm, width: value }), 1, 500_000)}{number('下钻高 mm', selectionMm.height, value => change(setSelection, { ...selectionMm, height: value }), 1, 500_000)}</div>
      <p className="regional-hint">实际选区：{numberText(selectionMm.width)} × {numberText(selectionMm.height)}。下钻会先保存完整来源快照，再按边界、孔洞、宽度、支撑、许可和预算检查物化可表达的内容；无法安全物化的内容仍保留来源快照。</p>
      <button type="button" className="primary asset-wide" disabled={Object.values(selectionMm).some(value => !Number.isSafeInteger(value)) || selectionMm.width <= 0 || selectionMm.height <= 0 || selectionMm.width > 500_000 || selectionMm.height > 500_000} onClick={() => void run(() => onPreviewDrillDown({ selectionMm: { ...selectionMm }, includePrivate: false }), true)}>预览独立下钻场景</button>
    </fieldset></>}
    {source && <article className="regional-source"><h3>区域来源</h3><p>来源版本 {source.sourceRevision} · 原始选区 {numberText(source.selectionMm.width)} × {numberText(source.selectionMm.height)}</p><p>当前子图独立保存，不会自动写回父图。</p><button type="button" className="secondary asset-wide" disabled={busy || disabled} onClick={() => void run(onCompareSource)}>核对父图来源</button>{sourceComparison && <p role="status">{sourceComparison}</p>}</article>}
    {busy && <p role="status">正在校验区域候选与真实资源…</p>}
    {(localError || error) && <p className="asset-form-error" role="alert">{localError || error}</p>}
    {candidate && <article className="regional-candidate" aria-label="区域候选"><h3>{candidate.label}</h3><p>{candidate.kind === 'edit' ? '保护当前工程后，一次采用同工程修改。' : '保存独立完整工程；当前工程先保全。'}展开成本 {candidate.cost.total} / {candidate.cost.limit}。</p>{candidate.kind === 'drillDown' && <><p>来源快照 {drillSourceCount} 条；已物化 {materialization?.materializedCount ?? 0} 条，部分物化 {materialization?.partialCount ?? 0} 条，仅保留来源 {materialization?.sourceOnlyCount ?? 0} 条。场景包含 {Object.keys(drillDocument?.terrainAreas ?? {}).length} 个地形面、{Object.keys(drillDocument?.paths ?? {}).length} 条路径、{Object.keys(drillDocument?.props ?? {}).length} 个非阻挡物件和 {Object.keys(drillDocument?.notes ?? {}).length} 条说明。实际尺寸保持，不按区域比例缩小。</p>{partialEntries.length > 0 && <details><summary>部分物化的内容</summary><ul>{partialEntries.map(entry => <li key={entry.sourceFeatureId}>{entry.label}：{entry.reason}</li>)}</ul></details>}{sourceOnlyEntries.length > 0 && <details><summary>仅保留来源的内容</summary><ul>{sourceOnlyEntries.map(entry => <li key={entry.sourceFeatureId}>{entry.label}：{entry.reason}</li>)}</ul></details>}</>}{!matches && <p className="regional-hint">输入已改变，请重新预览。</p>}<label><input type="checkbox" aria-label="确认区域候选范围" checked={confirmed} disabled={!matches || busy || disabled} onChange={event => setConfirmed(event.target.checked)}/>已核对范围、私密性和独立保存方式</label><button type="button" className="primary asset-wide" disabled={!confirmed || !matches || busy || disabled} onClick={() => void run(onAdopt)}>{candidate.kind === 'edit' ? '保护并采用区域修改' : '保存并打开独立区域候选'}</button></article>}
    {(dirty || candidate || busy) && <button type="button" className="secondary asset-wide" onClick={cancel}>取消区域候选</button>}
  </section>
}
