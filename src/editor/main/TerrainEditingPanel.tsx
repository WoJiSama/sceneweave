import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Paintbrush, RefreshCw, X } from 'lucide-react'
import type { BoundsMm, PointMm, SceneDocument } from '../../shared/model/scene'
import type { TerrainEditRequest, TerrainEditResult } from '../../shared/terrain-generation/edit'
import { terrainTopologyDependencies } from '../../shared/terrain-generation/topology'
import type { TerrainTopologyRequest } from '../../shared/terrain-generation/contracts'
import { terrainPoints } from '../../shared/geometry/geometry'
import { polygonBoolean } from '../../shared/geometry/polygon-boolean'
import { visualBase } from '../../shared/visual/base'
import type { VisualBoundary } from '../../shared/visual/types'
import type { CanvasTerrainBrush } from '../native-canvas/AssetCanvas'
import type { CanvasWorldTool } from '../native-canvas/building-session'
import { newId } from './runtime'
import './terrain-editing.css'

export interface TerrainEditCanvasSession {
  brush?: CanvasTerrainBrush
  boundary?: VisualBoundary
  onBoundaryChange?: (value: VisualBoundary) => void
  onBoundaryFinish?: (value: VisualBoundary) => void
  scopeTool?: CanvasWorldTool
}
const modes = { addLand: '添陆', digWater: '挖水', paintGrass: '铺草', clearArea: '清出空地' } as const
const links = { contour: '只改轮廓', transitions: '轮廓及相关过渡', scenery: '同步过渡并调整失去支撑的自动布景' } as const
const pointNames = { start: '起点', control1: '控制点一', control2: '控制点二', end: '终点' } as const
const areaLabel = (scene: SceneDocument, id: string) => { const area = scene.terrainAreas[id]; if (!area) return id; const material = area.surfaceStyle?.base.materialRef; return `${material ? scene.materials[material.id]?.name ?? '地形' : '地形'} · 高程 ${area.groundElevationMm / 1000} 米` }
const mm = (value: number) => `${(value / 1000).toFixed(2).replace(/\.?0+$/, '')} 米`

export default function TerrainEditingPanel({ scene, busy, adopting = false, disabled, error, candidate, onPreview, onAdopt, onCancel, onCanvasSession, onDraftChange }: {
  scene: SceneDocument; busy: boolean; adopting?: boolean; disabled: boolean; error: string | null; candidate: TerrainEditResult | null
  onPreview: (request: TerrainEditRequest) => Promise<void>; onAdopt: () => Promise<void>; onCancel: () => void
  onCanvasSession: (value: TerrainEditCanvasSession | null) => void; onDraftChange: (dirty: boolean) => void
}) {
  const heading = useId()
  const areas = Object.values(scene.terrainAreas), materials = Object.values(scene.materials).filter(value => value.applicableSurfaces.includes('terrain'))
  const boundaries = Object.values(visualBase(scene)?.boundaries ?? {}).filter(value => value.binding.kind === 'terrain')
  const [tool, setTool] = useState<'brush' | 'contour' | 'surroundings' | 'topology' | null>(null)
  const [surroundingsSeed, setSurroundingsSeed] = useState('courtyard-surroundings-1')
  const [displacementMm, setDisplacementMm] = useState(300)
  const [surroundingsBoundaries, setSurroundingsBoundaries] = useState<string[]>([])
  const [regenerateScenery, setRegenerateScenery] = useState(true)
  const [mode, setMode] = useState<keyof typeof modes>('addLand')
  const [targetAreaId, setTargetAreaId] = useState(() => areas.find(area => area.groundElevationMm > 0)?.id ?? areas[0]?.id ?? '')
  const [materialId, setMaterialId] = useState(() => materials.find(value => /grass|草/.test(value.name + value.tags.join(' ')))?.id ?? materials[0]?.id ?? '')
  const [radiusMm, setRadiusMm] = useState(600)
  const [strokes, setStrokes] = useState<{ pointsMm: PointMm[]; radiusMm: number }[]>([])
  const strokesRef = useRef(strokes); strokesRef.current = strokes
  const [boundary, setBoundary] = useState<VisualBoundary | null>(null), [segmentIndex, setSegmentIndex] = useState(0)
  const [scopeMm, setScopeMm] = useState<BoundsMm>(() => ({ ...scene.exportBoundsMm }))
  const [scopePoints, setScopePoints] = useState<PointMm[] | null>(null), [scopeCursor, setScopeCursor] = useState<PointMm | null>(null)
  const [linkMode, setLinkMode] = useState<TerrainEditRequest['linkMode']>('scenery')
  const [numericPoint, setNumericPoint] = useState<PointMm>(() => ({ x: Math.round(scene.exportBoundsMm.x + scene.exportBoundsMm.width / 2), y: Math.round(scene.exportBoundsMm.y + scene.exportBoundsMm.height / 2) }))
  const [topologyOperation, setTopologyOperation] = useState<TerrainTopologyRequest['operation']>('difference')
  const [topologyAreaIds, setTopologyAreaIds] = useState<string[]>(() => targetAreaId ? [targetAreaId] : [])
  const [topologyTemplateAreaId, setTopologyTemplateAreaId] = useState(() => targetAreaId)
  const [topologyClipText, setTopologyClipText] = useState('')
  const [topologyHoleMaterialId, setTopologyHoleMaterialId] = useState(() => materials[0]?.id ?? '')
  const [topologyHoleElevationMm, setTopologyHoleElevationMm] = useState(0)
  const [topologyHoleBlocksMovement, setTopologyHoleBlocksMovement] = useState(true)
  const [topologyHoleMovementCost, setTopologyHoleMovementCost] = useState(2)
  const [topologyRebindings, setTopologyRebindings] = useState<Record<string, number>>({})
  const [confirmed, setConfirmed] = useState(false), [localError, setLocalError] = useState<string | null>(null)
  const [submittedKey, setSubmittedKey] = useState<string | null>(null)
  const operationId = useRef(newId()), callbacks = useRef({ onPreview, onCancel, onCanvasSession, onDraftChange })
  callbacks.current = { onPreview, onCancel, onCanvasSession, onDraftChange }
  const target = scene.terrainAreas[targetAreaId]
  const elevationMm = target?.groundElevationMm ?? 0
  const topologyAreas = areas.filter(area => topologyAreaIds.includes(area.id))
  const topologyDeps = tool === 'topology' ? terrainTopologyDependencies(scene, topologyAreaIds) : []
  const floorId = (tool === 'surroundings' ? boundaries.find(row => row.id === surroundingsBoundaries[0])?.floorId : tool === 'topology' ? topologyAreas[0]?.floorId : boundary?.floorId) ?? target?.floorId ?? Object.keys(scene.floors)[0]
  const valid = Number.isSafeInteger(radiusMm) && radiusMm >= 100 && radiusMm <= 10000 && Number.isSafeInteger(elevationMm)
    && [scopeMm.x, scopeMm.y, scopeMm.width, scopeMm.height].every(Number.isSafeInteger) && scopeMm.width > 0 && scopeMm.height > 0
  const surroundingsValid = surroundingsSeed.trim().length > 0 && surroundingsSeed.length <= 128 && Number.isSafeInteger(displacementMm) && displacementMm >= 10 && displacementMm <= 1500 && surroundingsBoundaries.length > 0 && surroundingsBoundaries.length <= 32
  const dirty = tool !== null || scopePoints !== null
  const parseClip = (value = topologyClipText): PointMm[] | null => {
    const points = value.split(/\s*;\s*|\n+/).map(row => row.trim()).filter(Boolean).map(row => row.split(/\s*,\s*|\s+/).map(Number))
    if (points.length < 3 || points.some(row => row.length !== 2 || row.some(value => !Number.isSafeInteger(value)))) return null
    return points.map(([x, y]) => ({ x, y }))
  }
  const topologyMaterial = scene.materials[topologyHoleMaterialId]
  const topologyOutput = useMemo(() => {
    if (tool !== 'topology') return null
    const clip = parseClip()
    if (!clip || !topologyAreas.length) return null
    try {
      const result = polygonBoolean({ operation: topologyOperation, subject: topologyAreas.map(terrainPoints), clip: [clip] })
      return { labels: result.polygons.flatMap((polygon, index) => [`组件 ${index + 1}`, ...polygon.holes.map((_, holeIndex) => `组件 ${index + 1} 的孔洞 ${holeIndex + 1}`)]), componentCount: result.polygons.length, holeCount: result.polygons.reduce((sum, polygon) => sum + polygon.holes.length, 0), error: null }
    } catch (failure) { return { labels: [], componentCount: 0, holeCount: 0, error: failure instanceof Error ? failure.message : String(failure) } }
  }, [tool, topologyClipText, topologyOperation, scene, JSON.stringify(topologyAreaIds)])
  const topologyDefaultClip = (area = topologyAreas[0]) => {
    if (!area) return ''
    const points = area.boundaryMm.map(point => point.positionMm)
    const xs = points.map(point => point.x), ys = points.map(point => point.y)
    const x = Math.min(...xs), y = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys)
    return `${x},${y}\n${right},${y}\n${right},${bottom}\n${x},${bottom}`
  }
  const topologyValid = topologyAreaIds.length >= 1 && topologyAreaIds.length <= 8 && topologyAreas.length === topologyAreaIds.length && topologyAreas.every(area => area.floorId === floorId)
    && topologyTemplateAreaId.length > 0 && topologyAreaIds.includes(topologyTemplateAreaId) && !!topologyMaterial && topologyMaterial.applicableSurfaces.includes('terrain')
    && Number.isSafeInteger(topologyHoleElevationMm) && Number.isFinite(topologyHoleMovementCost) && topologyHoleMovementCost >= .1 && topologyHoleMovementCost <= 100
    && !!parseClip() && !!topologyOutput?.labels.length && !topologyOutput.error && topologyDeps.length <= 128 && topologyDeps.every(row => Number.isInteger(topologyRebindings[JSON.stringify(row)] ?? -1) && (topologyRebindings[JSON.stringify(row)] ?? -1) >= 0 && (topologyRebindings[JSON.stringify(row)] ?? -1) < topologyOutput.labels.length)
  const topologyRequest = (nextClip = parseClip()): TerrainTopologyRequest | null => {
    if (!nextClip || !topologyValid) return null
    return { kind: 'topology', sceneId: scene.sceneId, operationId: operationId.current, floorId, scopeMm: { ...scopeMm }, linkMode: 'transitions', operation: topologyOperation,
      areaIds: [...topologyAreaIds], templateAreaId: topologyTemplateAreaId, clip: [nextClip],
      holeSurface: { materialRef: { id: topologyHoleMaterialId, version: topologyMaterial!.version }, elevationMm: topologyHoleElevationMm, blocksMovement: topologyHoleBlocksMovement, movementCostMultiplier: topologyHoleMovementCost },
      rebindings: topologyDeps.map(row => ({ ...row, outputIndex: topologyRebindings[JSON.stringify(row)] ?? 0 })) }
  }
  const requestKey = (nextStrokes = strokes, nextBoundary = boundary) => JSON.stringify(tool === 'surroundings' ? { tool, floorId, scopeMm, seed: surroundingsSeed, displacementMm, surroundingsBoundaries, regenerateScenery } : tool === 'contour' ? { tool, floorId, scopeMm, linkMode, boundary: nextBoundary } : tool === 'topology' ? { tool, floorId, scopeMm, operation: topologyOperation, areaIds: topologyAreaIds, templateAreaId: topologyTemplateAreaId, clip: parseClip(), holeMaterial: topologyHoleMaterialId, holeElevationMm: topologyHoleElevationMm, holeBlocksMovement: topologyHoleBlocksMovement, holeMovementCost: topologyHoleMovementCost, rebindings: topologyRebindings } : { tool, mode, targetAreaId, materialId: mode === 'paintGrass' ? materialId : target?.surfaceStyle?.base.materialRef ?? null, scopeMm, linkMode, strokes: nextStrokes })
  const settingsKey = requestKey()
  const candidateMatches = !!candidate && submittedKey === settingsKey
  useEffect(() => { callbacks.current.onDraftChange(dirty) }, [dirty])
  useEffect(() => () => { callbacks.current.onCanvasSession(null); callbacks.current.onDraftChange(false) }, [])
  useEffect(() => { setConfirmed(false) }, [candidate])
  useEffect(() => { setConfirmed(false) }, [settingsKey])
  const cancel = () => {
    callbacks.current.onCancel(); setTool(null); setStrokes([]); strokesRef.current = []; setBoundary(null); setSurroundingsBoundaries([]); setTopologyAreaIds(targetAreaId ? [targetAreaId] : []); setTopologyTemplateAreaId(targetAreaId); setTopologyRebindings({}); setScopePoints(null); setScopeCursor(null); setConfirmed(false); setSubmittedKey(null); setLocalError(null); operationId.current = newId()
  }
  const submit = async (nextStrokes = strokesRef.current, nextBoundary = boundary) => {
    if (busy || disabled || !valid || !floorId || (tool === 'surroundings' ? !surroundingsValid : tool === 'topology' ? !topologyValid : !targetAreaId)) return
    setLocalError(null); setConfirmed(false)
    const common = { sceneId: scene.sceneId, operationId: operationId.current, floorId, scopeMm: { ...scopeMm }, linkMode }
    const nextKey = requestKey(nextStrokes, nextBoundary)
    try {
      if (tool === 'surroundings') await callbacks.current.onPreview({ ...common, kind: 'surroundings', linkMode: 'scenery', seed: surroundingsSeed, maxDisplacementMm: displacementMm, boundaryIds: surroundingsBoundaries, regenerateScenery })
      else if (tool === 'contour' && nextBoundary) await callbacks.current.onPreview({ ...common, kind: 'contour', boundary: nextBoundary })
      else if (tool === 'topology') { const request = topologyRequest(); if (!request) return; await callbacks.current.onPreview(request) }
      else if (nextStrokes.length) await callbacks.current.onPreview({ ...common, kind: 'brush', mode, targetAreaId, materialRef: mode === 'paintGrass' ? materials.find(value => value.id === materialId) ? { id: materialId, version: scene.materials[materialId].version } : null : mode === 'addLand' || mode === 'digWater' ? target?.surfaceStyle?.base.materialRef ?? null : null, elevationMm: mode === 'addLand' || mode === 'digWater' ? elevationMm : null, strokes: nextStrokes })
      setSubmittedKey(nextKey)
    } catch (failure) { setLocalError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const appendStroke = (pointsMm: PointMm[]) => {
    if (busy || disabled || !valid) return
    if (strokesRef.current.length >= 32) { setLocalError('本次已达 32 笔；请采用或取消当前候选后继续。'); return }
    const next = [...strokesRef.current, { pointsMm, radiusMm }]; strokesRef.current = next; setStrokes(next); void submit(next)
  }
  const canvasSession = useMemo<TerrainEditCanvasSession | null>(() => {
    if (!dirty || disabled || busy) return null
    if (scopePoints) return { scopeTool: { kind: 'rectangle', points: scopePoints, cursor: scopeCursor, snapMm: 100, label: '框定本次可写范围 · 点击两个角点 · Escape 取消', onCancel: () => { setScopePoints(null); setScopeCursor(null) }, onPoint: point => {
      if (!scopePoints.length) setScopePoints([point])
      else { const first = scopePoints[0]; setScopeMm({ x: Math.min(first.x, point.x), y: Math.min(first.y, point.y), width: Math.max(1, Math.abs(point.x - first.x)), height: Math.max(1, Math.abs(point.y - first.y)) }); setScopePoints(null); setScopeCursor(null) }
    }, onMove: setScopeCursor } }
    if (tool === 'brush') return { brush: { radiusMm, strokes, scope: scopeMm, label: `${modes[mode]} · 拖动画笔 · 抬笔预览 · Escape 取消`, onStroke: appendStroke, onCancel: cancel, onError: setLocalError } }
    if (tool === 'contour' && boundary) return { boundary, onBoundaryChange: setBoundary, onBoundaryFinish: value => { setBoundary(value); void submit(strokesRef.current, value) } }
    return null
  }, [tool, boundary, scopePoints, scopeCursor, radiusMm, strokes, mode, scopeMm, linkMode, materialId, elevationMm, targetAreaId, busy, disabled])
  useEffect(() => { callbacks.current.onCanvasSession(canvasSession) }, [canvasSession])
  const labels = (ids: readonly string[]) => ids.map(id => (scene.terrainAreas[id] ? areaLabel(scene, id) : undefined) ?? (scene.props[id]?.definitionRef ? scene.propDefinitions[scene.props[id].definitionRef!.id]?.name : undefined) ?? id)
  const number = (label: string, value: number, change: (next: number) => void, min?: number, max?: number) => <label>{label}<input aria-label={`地形编辑${label}`} type="number" value={value} min={min} max={max} step={1} onChange={event => { change(Number(event.target.value)); setConfirmed(false) }}/></label>
  return <section className="terrain-editing-panel" aria-labelledby={heading}>
    <div className="asset-section-heading"><Paintbrush size={17}/><h2 id={heading}>局部地形编辑</h2></div>
    <p className="terrain-editing-intro">先画范围与笔画，查看岸线、过渡和树石的联动，再一次采用。手工与锁定内容保持。</p>
    <fieldset disabled={disabled || busy}>
      <legend>选择工具</legend>
      <button type="button" className="secondary asset-wide" aria-label="既有建筑周边重生成" aria-pressed={tool === 'surroundings'} disabled={strokes.length > 0 || tool === 'contour'} onClick={() => { setTool('surroundings'); setSurroundingsBoundaries(current => current.length ? current : boundaries.filter(row => row.floorId === floorId).slice(0, 1).map(row => row.id)) }}>既有建筑周边重生成</button>
      <button type="button" className="secondary asset-wide" aria-label="复杂地形拓扑" aria-pressed={tool === 'topology'} disabled={strokes.length > 0 || tool === 'contour'} onClick={() => { setTool('topology'); setTopologyAreaIds(current => current.length ? current : targetAreaId ? [targetAreaId] : []); setTopologyClipText(current => current.trim() ? current : topologyDefaultClip(areas.find(area => area.id === targetAreaId))) }}>复杂地形拓扑 · 合并/挖孔/取交集</button>
      {tool === 'surroundings' && <div className="terrain-editing-surroundings"><p className="terrain-editing-hint">在当前地图内重做选定岸线与自动树石。建筑、门、院路、手工和锁定物件保持原位；先核对下方范围和完整影响。</p><label>周边生成种子<input aria-label="周边生成种子" value={surroundingsSeed} maxLength={128} onChange={event => setSurroundingsSeed(event.target.value)}/></label>{number('周边最大位移 mm', displacementMm, setDisplacementMm, 10, 1500)}<fieldset><legend>允许重做的轮廓</legend>{boundaries.filter(row => row.floorId === floorId).map((row, index) => <label key={row.id}><input type="checkbox" aria-label={`周边轮廓 ${index + 1}`} checked={surroundingsBoundaries.includes(row.id)} onChange={event => setSurroundingsBoundaries(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))}/>{row.binding.kind === 'terrain' ? row.binding.sides.map(side => areaLabel(scene, side.areaId)).join(' / ') : ''}</label>)}</fieldset><label><input type="checkbox" aria-label="重做周边自动布景" checked={regenerateScenery} onChange={event => setRegenerateScenery(event.target.checked)}/>调整范围内可自动管理的树石</label></div>}
      {tool === 'topology' && <div className="terrain-editing-topology"><p className="terrain-editing-hint">布尔结果会替换所选地形并生成新的组件/孔洞身份。terrain-edge、视觉曲线和其他依赖不能暗删，若仍存在会由核心拒绝，请先单独解除。</p><label>布尔操作<select aria-label="复杂拓扑操作" value={topologyOperation} onChange={event => setTopologyOperation(event.target.value as TerrainTopologyRequest['operation'])}><option value="union">合并地块</option><option value="difference">挖出孔洞</option><option value="intersection">取交集</option></select></label><fieldset><legend>输入地块（至少一块）</legend>{areas.filter(area => area.floorId === floorId).map(area => <label key={area.id}><input type="checkbox" aria-label={`拓扑输入 ${area.id}`} checked={topologyAreaIds.includes(area.id)} onChange={event => { const next = event.target.checked ? [...topologyAreaIds, area.id] : topologyAreaIds.filter(id => id !== area.id); setTopologyAreaIds(next); if (!next.includes(topologyTemplateAreaId)) setTopologyTemplateAreaId(next[0] ?? ''); setTopologyRebindings({}) }}/>{areaLabel(scene, area.id)}</label>)}</fieldset><label>模板地块<select aria-label="拓扑模板地块" value={topologyTemplateAreaId} onChange={event => setTopologyTemplateAreaId(event.target.value)}>{topologyAreas.map(area => <option key={area.id} value={area.id}>{areaLabel(scene, area.id)}</option>)}</select></label><label>Clip 多边形（每行 `x,y`，不重复首点）<textarea aria-label="拓扑 clip 多边形" rows={4} value={topologyClipText} onChange={event => setTopologyClipText(event.target.value)} placeholder="10000,10000\n16000,10000\n16000,14000\n10000,14000"/></label><div className="terrain-editing-pair"><label>孔洞材质<select aria-label="拓扑孔洞材质" value={topologyHoleMaterialId} onChange={event => setTopologyHoleMaterialId(event.target.value)}>{materials.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>{number('孔洞高程 mm', topologyHoleElevationMm, setTopologyHoleElevationMm)}{number('孔洞移动成本', topologyHoleMovementCost, setTopologyHoleMovementCost, .1, 100)}</div><label className="terrain-editing-confirm"><input type="checkbox" aria-label="拓扑孔洞阻挡移动" checked={topologyHoleBlocksMovement} onChange={event => setTopologyHoleBlocksMovement(event.target.checked)}/>孔洞阻挡移动</label>{topologyOutput?.error && <p className="asset-form-error">{topologyOutput.error}</p>}{topologyOutput && !topologyOutput.error && <p className="terrain-editing-hint">几何草算：{topologyOutput.componentCount} 个组件、{topologyOutput.holeCount} 个孔洞；完整几何与依赖将在预览时重新校验。</p>}<fieldset><legend>每个支撑槽绑定输出组件</legend>{topologyDeps.map(row => { const key = JSON.stringify(row); return <label key={key}>{row.kind} · {row.entityId} · 原地块 {row.previousAreaId}<select aria-label={`拓扑重绑 ${row.kind} ${row.entityId}`} value={topologyRebindings[key] ?? ''} onChange={event => setTopologyRebindings(current => ({ ...current, [key]: event.target.value === '' ? -1 : Number(event.target.value) }))}><option value="">明确选择输出组件或孔洞</option>{topologyOutput?.labels.map((label, index) => <option key={index} value={index}>{label}</option>)}</select></label> })}</fieldset></div>}
      <div hidden={tool === 'surroundings' || tool === 'topology'}>
      <div className="terrain-editing-modes" role="group" aria-label="地形笔刷">{Object.entries(modes).map(([value, name]) => <button key={value} type="button" aria-pressed={tool === 'brush' && mode === value} disabled={strokes.length > 0 && mode !== value || tool === 'contour'} onClick={() => { setMode(value as keyof typeof modes); setTool('brush') }}>{name}</button>)}</div>
      <label>作用地形<select aria-label="地形编辑作用地形" value={targetAreaId} disabled={strokes.length > 0 || tool === 'contour'} onChange={event => setTargetAreaId(event.target.value)}>{areas.map(area => <option key={area.id} value={area.id}>{areaLabel(scene, area.id)}</option>)}</select></label>
      <div className="terrain-editing-pair">{number('笔刷半径 mm', radiusMm, setRadiusMm, 100, 10000)}<label>目标高程 mm<input aria-label="地形编辑目标高程 mm" type="number" value={elevationMm} readOnly disabled/></label></div>
      <label>地面材质<select aria-label="地形编辑地面材质" disabled={mode !== 'paintGrass' || tool === 'contour'} value={mode === 'paintGrass' ? materialId : target?.surfaceStyle?.base.materialRef?.id ?? ''} onChange={event => setMaterialId(event.target.value)}><option value="">沿用当前地面</option>{materials.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
      <p className="terrain-editing-hint">添陆和挖水只推拉现有岸线，沿用所选地形的材质与高程；暂不创建独立内湖，也不拆分或合并地块。铺草覆盖所选材质；清空保留地面与人工内容。</p>
      <details><summary>键盘落笔</summary><div className="terrain-editing-pair">{number('落笔 X mm', numericPoint.x, value => setNumericPoint(current => ({ ...current, x: value })))}{number('落笔 Y mm', numericPoint.y, value => setNumericPoint(current => ({ ...current, y: value })))}</div><button type="button" className="secondary asset-wide" disabled={tool !== 'brush' || !valid || !Number.isSafeInteger(numericPoint.x) || !Number.isSafeInteger(numericPoint.y)} onClick={() => appendStroke([{ ...numericPoint }])}>添加落笔并预览</button></details>
      <label>或编辑已有轮廓<select aria-label="地形编辑轮廓" value={boundary?.id ?? ''} disabled={strokes.length > 0} onChange={event => { const value = boundaries.find(item => item.id === event.target.value); setBoundary(value ? structuredClone(value) : null); setTool(value ? 'contour' : null); setSegmentIndex(0) }}><option value="">选择岸线或高台曲线</option>{boundaries.map((value, index) => <option key={value.id} value={value.id}>{value.binding.kind === 'terrain' ? value.binding.sides.map(side => areaLabel(scene, side.areaId)).join(' / ') : ''} · 曲线 {index + 1}</option>)}</select></label>
      {boundary && <details><summary>轮廓控制点数值</summary><label>曲线段<select aria-label="地形编辑曲线段" value={segmentIndex} onChange={event => setSegmentIndex(Number(event.target.value))}>{boundary.segments.map((segment, index) => <option key={segment.id} value={index}>第 {index + 1} 段</option>)}</select></label>{(['start', 'control1', 'control2', 'end'] as const).map(key => <div className="terrain-editing-pair" key={key}>{(['x', 'y'] as const).map(axis => number(`${pointNames[key]} ${axis.toUpperCase()} mm`, boundary.segments[segmentIndex][key][axis], value => {
        const next = structuredClone(boundary), segment = next.segments[segmentIndex], point = { ...segment[key], [axis]: value }, dx = point.x - segment[key].x, dy = point.y - segment[key].y
        segment[key] = point
        if (key === 'start') { segment.control1.x += dx; segment.control1.y += dy; if (segmentIndex > 0 || next.closed) { const previous = next.segments[(segmentIndex + next.segments.length - 1) % next.segments.length]; previous.end = { ...point }; previous.control2.x += dx; previous.control2.y += dy } }
        if (key === 'end') { segment.control2.x += dx; segment.control2.y += dy; if (segmentIndex < next.segments.length - 1 || next.closed) { const following = next.segments[(segmentIndex + 1) % next.segments.length]; following.start = { ...point }; following.control1.x += dx; following.control1.y += dy } }
        setBoundary(next)
      }))}</div>)}</details>}
      </div>
      <details className="terrain-editing-scope" open><summary>本次可写范围</summary><div className="terrain-editing-pair">{number('范围 X mm', scopeMm.x, value => setScopeMm(current => ({ ...current, x: value })))}{number('范围 Y mm', scopeMm.y, value => setScopeMm(current => ({ ...current, y: value })))}</div><div className="terrain-editing-pair">{number('范围宽 mm', scopeMm.width, value => setScopeMm(current => ({ ...current, width: value })), 1)}{number('范围高 mm', scopeMm.height, value => setScopeMm(current => ({ ...current, height: value })), 1)}</div><button type="button" className="secondary asset-wide" disabled={!!candidate} onClick={() => { setScopePoints([]); setScopeCursor(null) }}>在地图框定范围</button></details>
      {tool !== 'surroundings' && tool !== 'topology' && <label>联动内容<select aria-label="地形编辑联动内容" value={linkMode} onChange={event => setLinkMode(event.target.value as TerrainEditRequest['linkMode'])}>{Object.entries(links).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <button type="button" className="primary asset-wide" aria-label="预览局部地形修改" disabled={!valid || (tool === 'surroundings' ? !surroundingsValid : tool === 'topology' ? !topologyValid : !strokes.length && !boundary)} onClick={() => void submit()}><RefreshCw size={14}/>重新预览本次修改</button>
    </fieldset>
    {tool && <p className="terrain-editing-hint" role="status">{tool === 'topology' ? '每个依赖槽需明确选择输出地形；确认完整影响后保护并一次采用。' : tool === 'brush' ? `当前 ${modes[mode]} · ${strokes.length} / 32 笔；抬笔后自动预览，可继续同类笔画。` : tool === 'surroundings' ? '周边重生成候选沿用当前工程，确认影响后保护并一次采用。' : '拖动地图上的曲线控制点，抬起后自动预览。'}</p>}
    {busy && <p className="terrain-generation-progress" role="status">正在计算联动并校验完整工程…</p>}
    {(localError || error) && <p role="alert" className="asset-form-error">{localError || error}</p>}
    {candidate && <article className="terrain-editing-impact" aria-label="本次地形影响"><h3>本次影响</h3>{scene.generation?.version === 1 && <p>本次同时保存新版地形笔画记录；采用前保留完整保护点，一次撤销可回到原状态。</p>}<p>编辑量 {candidate.cost.total} / {candidate.cost.limit} · 范围 {mm(candidate.impact.writeBoundsMm.width)} × {mm(candidate.impact.writeBoundsMm.height)}</p>{([['实际写入', candidate.impact.writeIds], ['保留的内容', candidate.impact.preservedIds], ['只读依赖', candidate.impact.readIds]] as const).map(([label, ids]) => <details key={label}><summary>{label} · {ids.length}</summary>{ids.length ? <ul>{labels(ids).map((label, index) => <li key={`${ids[index]}-${index}`}>{label}</li>)}</ul> : <p>无</p>}</details>)}<div className="terrain-editing-conflicts"><strong>需要解决的冲突 · {candidate.impact.conflicts.length}</strong>{candidate.impact.conflicts.map((conflict, index) => <p key={index}>{conflict.message}</p>)}</div>{!candidateMatches && <p className="terrain-generation-notice">设置或笔画已改变，请重新预览后采用。</p>}<label className="terrain-editing-confirm"><input aria-label="确认本次地形影响范围" type="checkbox" checked={confirmed} disabled={!candidateMatches || busy || disabled || !!candidate.impact.conflicts.length} onChange={event => setConfirmed(event.target.checked)}/>已查看实际写入、保留内容与依赖，确认本次范围</label><button className="primary asset-wide" type="button" aria-label="保护并采用地形修改" disabled={!candidateMatches || !confirmed || busy || disabled || !!candidate.impact.conflicts.length} onClick={() => void onAdopt().catch(failure => setLocalError(failure instanceof Error ? failure.message : String(failure)))}><Check size={14}/>保护当前并一次采用</button></article>}
    {(dirty || busy || candidate) && <button type="button" className="secondary asset-wide" aria-label="取消本次地形修改" disabled={adopting} onClick={cancel}><X size={14}/>{busy ? '取消计算与草稿' : '取消本次地形修改'}</button>}
  </section>
}
