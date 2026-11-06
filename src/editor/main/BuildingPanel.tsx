import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MousePointer2, PencilRuler, Plus, Ruler, X } from 'lucide-react'
import { newId } from './runtime'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import { NumberInput } from '../native-canvas/controls'
import { finishOrthogonalBoundary, formatDistanceMm, parseBoundary, rectangleFromPoints, rectanglePoints, rulerDistance, type BuildingSketch } from '../native-canvas/building-session'
import AggregateBuildingPanel from './AggregateBuildingPanel'
import AggregateStructurePanel from './AggregateStructurePanel'
import './building.css'

type Props = { scene: SceneDocument; layerId: string; disabled: boolean; sketch: BuildingSketch | null; onSketch: (sketch: BuildingSketch | null) => void; onPreview: (commands: SceneCommand[], description: string) => void; onSelect: (id: string) => void; onSelectMany?: (ids: string[]) => void; onFinishReady?: (finish: (() => void) | null) => void }
export default function BuildingPanel({ scene, layerId, disabled, sketch, onSketch, onPreview, onSelect, onSelectMany, onFinishReady }: Props) {
  const [shape, setShape] = useState<'rectangle' | 'polygon' | 'orthogonal'>('rectangle'), [purpose, setPurpose] = useState('新房间'), [thickness, setThickness] = useState(100)
  const [rect, setRect] = useState({ x: 1000, y: 1000, width: 4000, height: 3000 }), [boundary, setBoundary] = useState('1000,1000\n5000,1000\n5500,4000\n1000,4000')
  const [support, setSupport] = useState(`floor:${Object.keys(scene.floors)[0]}`), [material, setMaterial] = useState(''), [error, setError] = useState<string | null>(null)
  const [world, setWorld] = useState({ ...scene.floors[Object.keys(scene.floors)[0]].boundsMm }), [exportBounds, setExportBounds] = useState({ ...scene.exportBoundsMm })
  const [mask, setMask] = useState({ x: 1000, y: 1000, width: 3000, height: 3000 })
  const [noteText, setNoteText] = useState(''), [noteVisibility, setNoteVisibility] = useState<'public' | 'gm'>('gm'), [notePoint, setNotePoint] = useState({ x: 3000, y: 3000 })
  const floorId = scene.userLayers[layerId]?.floorId ?? Object.keys(scene.floors)[0]
  const layerLocked = !scene.userLayers[layerId] || scene.userLayers[layerId].editLocked
  const orphanWalls = Object.values(scene.walls).filter(wall => !Object.values(scene.rooms).some(room => room.boundaryVertexIds.some((id, index, ids) => id === wall.startVertexId && ids[(index + 1) % ids.length] === wall.endVertexId || id === wall.endVertexId && ids[(index + 1) % ids.length] === wall.startVertexId)))
  const run = (commands: SceneCommand[], description: string) => { setError(null); onPreview(commands, description) }
  const previewRoom = () => {
    if (disabled || layerLocked) return
    try {
      const drawing = sketch && sketch.kind !== 'ruler' ? sketch : null
      const currentShape = drawing?.kind ?? shape
      const currentRectangle = drawing?.kind === 'rectangle' && drawing.points.length === 2 ? rectangleFromPoints(drawing.points[0], drawing.points[1]) : rect
      const currentBoundary = drawing && drawing.kind !== 'rectangle' && drawing.points.length ? drawing.points.map(point => `${point.x},${point.y}`).join('\n') : boundary
      const boundaryMm = currentShape === 'rectangle' ? rectanglePoints(currentRectangle) : currentShape === 'orthogonal' ? finishOrthogonalBoundary(parseBoundary(currentBoundary)) : parseBoundary(currentBoundary)
      const [kind, id] = support.split(':')
      run([{ type: 'createRoom', id: newId(), floorId, boundaryMm, thicknessMm: thickness, layerId, purpose, supportRef: { kind: kind as 'floor' | 'terrainArea', id }, ...(material ? { materialRef: { id: material, version: scene.materials[material].version } } : {}) }], `新建${purpose || '房间'}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const finishReady = !disabled && !layerLocked && !!sketch && sketch.kind !== 'ruler' && (sketch.kind === 'rectangle' ? sketch.points.length === 2 : sketch.points.length >= 3)
  const finishRef = useRef<(() => void) | null>(null), finishListener = useRef(onFinishReady)
  useLayoutEffect(() => { finishRef.current = finishReady ? previewRoom : null; finishListener.current = onFinishReady })
  const finish = useCallback(() => finishRef.current?.(), [])
  useLayoutEffect(() => {
    finishListener.current?.(finishReady ? finish : null)
    return () => { finishListener.current?.(null) }
  }, [finishReady, finish])
  useLayoutEffect(() => () => { finishRef.current = null }, [])
  useEffect(() => { setWorld({ ...scene.floors[floorId].boundsMm }); setExportBounds({ ...scene.exportBoundsMm }) }, [scene.revision, floorId])
  useEffect(() => {
    if (!sketch || sketch.kind === 'ruler') return
    setShape(sketch.kind)
    if (sketch.kind === 'rectangle' && sketch.points.length === 2) setRect(rectangleFromPoints(sketch.points[0], sketch.points[1]))
    if ((sketch.kind === 'polygon' || sketch.kind === 'orthogonal') && sketch.points.length) setBoundary(sketch.points.map(p => `${p.x},${p.y}`).join('\n'))
  }, [sketch?.kind, sketch?.points])
  const endpoints = sketch?.kind === 'ruler' && sketch.points.length ? [sketch.points[0], sketch.points[1] ?? sketch.cursor].filter(Boolean) : []
  const measure = endpoints.length === 2 ? rulerDistance(endpoints[0]!, endpoints[1]!) : null
  return <section className="building-panel" aria-label="建筑工具">
    <div className="asset-section-heading"><PencilRuler size={16}/><h2>建筑工具</h2></div>
    <p className="asset-muted">画房间后，选中墙添加门窗。尺寸用{scene.units.display === 'ft' ? '英尺' : '米'}，墙厚用厘米；预览后确认采用。</p>
    <form onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing && event.keyCode !== 229) event.preventDefault()
    }} onSubmit={event => { event.preventDefault(); previewRoom() }}>
      <fieldset className="workspace-form-fields" disabled={disabled || layerLocked}>
        <div className="workspace-form-pair"><label className="building-field">房间名称<input aria-label="房间名称" value={purpose} maxLength={200} onChange={event => setPurpose(event.target.value)}/></label>
        <label className="building-field">形状<select aria-label="房间形状" value={shape} onChange={event => { setShape(event.target.value as typeof shape); onSketch(null) }}><option value="rectangle">矩形</option><option value="orthogonal">正交多边形</option><option value="polygon">多边形 / 斜边</option></select></label></div>
        {shape === 'orthogonal' && <p className="asset-muted">逐点按水平或垂直方向吸附。闭合时先垂直转离末段，再接回起点；需要时补一个直角拐点，重复或自交则拒绝。虚线包含待补的闭合边。</p>}
        {shape === 'rectangle' && <div className="workspace-form-pair">{(['width', 'height'] as const).map((key, index) => <NumberInput displayUnit={scene.units.display} key={key} label={['房间宽度', '房间高度'][index]} value={rect[key]} onCommit={value => { onSketch(null); setRect(current => ({ ...current, [key]: value })) }}/>)}</div>}
        <div className="workspace-form-pair"><NumberInput displayUnit="cm" label="新房间墙厚" value={thickness} onCommit={setThickness}/>
        <label className="building-field">地板材质<select aria-label="新房间地板材质" value={material} onChange={event => setMaterial(event.target.value)}><option value="">基础地板</option>{Object.values(scene.materials).filter(m => m.applicableSurfaces.includes('room')).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        </div><label className="building-field">房间建在哪个地面<select aria-label="房间支撑表面" value={support} onChange={event => setSupport(event.target.value)}>{Object.values(scene.floors).map(floor => <option key={floor.id} value={`floor:${floor.id}`}>基础地面 · {floor.name}</option>)}{Object.values(scene.terrainAreas).map((area, index) => <option key={area.id} value={`terrainArea:${area.id}`}>地形 {index + 1} · 高度 {formatDistanceMm(area.groundElevationMm, scene.units.display)}</option>)}</select></label>
      </fieldset>
      <div className="building-tools"><button type="button" className="secondary" aria-pressed={sketch?.kind !== 'ruler' && !!sketch} disabled={disabled || layerLocked} onClick={() => onSketch({ kind: shape, points: [], cursor: null })}><MousePointer2 size={14}/>在图上画房间</button><button type="button" className="secondary" aria-pressed={sketch?.kind === 'ruler'} disabled={disabled} onClick={() => onSketch({ kind: 'ruler', points: [], cursor: null })}><Ruler size={14}/>量尺</button></div>
      {sketch && <div className="building-sketch-status" role="status"><span>{sketch.kind === 'ruler' ? '依次点击起点与终点' : sketch.kind === 'rectangle' ? `点击矩形对角 · ${sketch.points.length}/2` : `${sketch.kind === 'orthogonal' ? '水平/垂直锁向 · ' : ''}依次点击顶点 · ${sketch.points.length} 点`}</span><button type="button" aria-label="取消绘图或量尺" onClick={() => onSketch(null)}><X size={14}/></button>{measure && <output aria-label="量尺结果">{formatDistanceMm(measure.distanceMm, scene.units.display)}<small>ΔX {measure.dxMm} · ΔY {measure.dyMm} mm</small></output>}</div>}
      <button className="primary asset-wide" type="submit" disabled={disabled || layerLocked}><Plus size={14}/>预览新房间</button>
      <details className="building-details workspace-advanced"><summary>{shape === 'rectangle' ? '精确位置' : '精确输入顶点坐标'}</summary><fieldset disabled={disabled || layerLocked}>{shape === 'rectangle' ? <div className="workspace-form-pair">{(['x', 'y'] as const).map((key, index) => <NumberInput displayUnit={scene.units.display} key={key} label={['房间起点 X', '房间起点 Y'][index]} value={rect[key]} onCommit={value => { onSketch(null); setRect(current => ({ ...current, [key]: value })) }}/>)}</div> : <label className="building-field">每行 x,y（mm）<textarea aria-label="房间多边形顶点" rows={5} value={boundary} onChange={event => { onSketch(null); setBoundary(event.target.value) }}/></label>}</fieldset></details>
    </form>
    <AggregateBuildingPanel scene={scene} disabled={disabled} onPreview={run} onSelect={onSelect} onSelectMany={onSelectMany}/>
    <AggregateStructurePanel scene={scene} disabled={disabled} onPreview={run} onSelect={onSelect}/>
    {layerLocked && <p className="history-limit">当前图层已锁定，请先选择可编辑图层。</p>}
    <details className="building-details"><summary>世界与导出范围</summary><p className="asset-muted">世界范围须容纳真实墙厚；双受众共享固定导出范围。坐标可为负数。</p><fieldset disabled={disabled || layerLocked}><h3>世界范围</h3>{(['x', 'y', 'width', 'height'] as const).map((key, i) => <NumberInput displayUnit={scene.units.display} key={key} label={['世界起点 X', '世界起点 Y', '世界宽度', '世界高度'][i]} value={world[key]} onCommit={value => setWorld(p => ({ ...p, [key]: value }))}/>)}<h3>导出范围</h3>{(['x', 'y', 'width', 'height'] as const).map((key, i) => <NumberInput displayUnit={scene.units.display} key={key} label={['导出起点 X', '导出起点 Y', '导出宽度', '导出高度'][i]} value={exportBounds[key]} onCommit={value => setExportBounds(p => ({ ...p, [key]: value }))}/>)}<button className="secondary asset-wide" onClick={() => run([{ type: 'setCanvasBounds', floorId, floorBoundsMm: world, exportBoundsMm: exportBounds }], '修改世界与固定导出范围')}>预览画布范围</button></fieldset></details>
    <details className="building-details"><summary>固定玩家遮罩</summary><p className="asset-muted">遮罩覆盖秘密几何、墙厚与阴影。玩家出图仍会检查覆盖范围。</p><fieldset disabled={disabled || layerLocked}>{(['x', 'y', 'width', 'height'] as const).map((key, index) => <NumberInput displayUnit={scene.units.display} key={key} label={['遮罩 X', '遮罩 Y', '遮罩宽度', '遮罩高度'][index]} value={mask[key]} onCommit={value => setMask(current => ({ ...current, [key]: value }))}/>)}<button className="secondary asset-wide" onClick={() => run([{ type: 'upsertManualMask', id: newId(), floorId, boundsMm: mask, layerId }], '新增固定玩家遮罩')}>预览新增遮罩</button></fieldset></details>
    <details className="building-details"><summary>文字与线索</summary><fieldset disabled={disabled || layerLocked}><label className="building-field">内容<textarea aria-label="新注记内容" value={noteText} onChange={event => setNoteText(event.target.value)} rows={3}/></label><label className="building-field">可见性<select aria-label="新注记可见性" value={noteVisibility} onChange={event => setNoteVisibility(event.target.value as typeof noteVisibility)}><option value="gm">仅主持人</option><option value="public">玩家可见</option></select></label><NumberInput displayUnit={scene.units.display} label="新注记 X" value={notePoint.x} onCommit={x => setNotePoint(p => ({ ...p, x }))}/><NumberInput displayUnit={scene.units.display} label="新注记 Y" value={notePoint.y} onCommit={y => setNotePoint(p => ({ ...p, y }))}/><button className="secondary asset-wide" disabled={!noteText.trim()} onClick={() => run([{ type: 'createNote', id: newId(), floorId, layerId, anchor: { type: 'point', positionMm: notePoint }, kind: 'note', text: noteText, visibility: noteVisibility }], '新增文字注记')}>预览新增注记</button></fieldset></details>
    <div className="building-entity-list" aria-label="建筑对象列表"><h3>房间与墙门</h3>{Object.values(scene.rooms).map(room => <details key={room.id} data-building-room-id={room.id}><summary><button disabled={disabled} onClick={() => onSelect(room.id)}>{room.purpose || '未命名房间'}</button></summary>{Object.values(scene.walls).filter(wall => room.boundaryVertexIds.some((id, i) => id === wall.startVertexId && room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length] === wall.endVertexId || id === wall.endVertexId && room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length] === wall.startVertexId)).map((wall, i) => <div key={wall.id}><button disabled={disabled} data-building-wall-id={wall.id} onClick={() => onSelect(wall.id)}>墙 {i + 1} · {wall.thicknessMm} mm</button>{Object.values(scene.openings).filter(o => o.wallId === wall.id).map(o => <button key={o.id} data-building-opening-id={o.id} disabled={disabled} onClick={() => onSelect(o.id)}>{o.kind === 'door' ? '门' : '窗'} · {o.widthMm} mm{o.secret ? ' · 秘密' : ''}</button>)}</div>)}</details>)}{Object.values(scene.regions).filter(r => r.kind === 'manualMask').map((r, i) => <button key={r.id} disabled={disabled} onClick={() => onSelect(r.id)}>固定遮罩 {i + 1}</button>)}{Object.values(scene.notes).map(note => <button key={note.id} disabled={disabled} onClick={() => onSelect(note.id)}>注记 · {note.title || note.text.slice(0, 18)}</button>)}</div>
    {orphanWalls.length > 0 && <div className="building-entity-list" aria-label="独立墙列表"><h3>独立墙</h3>{orphanWalls.map((wall, index) => <button key={wall.id} data-building-wall-id={wall.id} disabled={disabled} onClick={() => onSelect(wall.id)}>独立墙 {index + 1} · {wall.thicknessMm} mm</button>)}</div>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </section>
}
