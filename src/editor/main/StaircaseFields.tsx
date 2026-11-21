import { useId, useRef, useState, type PointerEvent } from 'react'
import type { PointMm } from '../../shared/model/scene'
import type { StaircaseConfig, StaircaseCover } from '../../shared/stairs/contracts'
import { STAIRCASE_MATERIALS, STAIRCASE_PRESETS } from '../../shared/stairs/catalog'
import './StaircaseTools.css'

const coverLabels: Record<StaircaseCover['kind'], string> = { 'reveal-ground': '露出底层', earth: '泥土覆盖', grass: '草地覆盖', rock: '岩石覆盖' }
const coverColors: Record<StaircaseCover['kind'], string> = { 'reveal-ground': '#dfcfaa', earth: '#936d47', grass: '#6d8b45', rock: '#7c807e' }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const pathLength = (points: readonly PointMm[] = []) => points.slice(1).reduce((length, point, index) => length + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0)
const toDiagram = (point: PointMm) => ({ x: 20 + point.x / 1_000_000 * 960, y: 28 + (500_000 - point.y) / 1_000_000 * 192 })
const polygonText = (points: PointMm[]) => points.map(point => { const view = toDiagram(point); return `${view.x},${view.y}` }).join(' ')

/** Shared controls for a new stair and the selected stair. The unfolded cover
 * board stores local polygons, so covering is reversible and follows bends. */
export default function StaircaseFields({ value, onChange, centerlineMm, widthMm }: {
  value: StaircaseConfig; onChange: (value: StaircaseConfig) => void; centerlineMm?: PointMm[]; widthMm?: number
}) {
  const [coverKind, setCoverKind] = useState<StaircaseCover['kind']>('reveal-ground')
  const [dragEnd, setDragEnd] = useState<PointMm | null>(null), dragStart = useRef<PointMm | null>(null)
  const [rangeStart, setRangeStart] = useState('20'), [rangeEnd, setRangeEnd] = useState('40')
  const [sideStart, setSideStart] = useState('0'), [sideEnd, setSideEnd] = useState('50')
  const [error, setError] = useState(''), addedIds = useRef<string[]>([]), titleId = useId(), descriptionId = useId()
  const length = pathLength(centerlineMm) * (value.range ? (value.range.endPpm - value.range.startPpm) / 1_000_000 : 1)
  const hasLength = Number.isFinite(length) && length > 0
  const stepCount = value.layout.kind === 'stretch' ? value.layout.stepCount : hasLength && value.layout.treadDepthMm > 0 ? Math.ceil(length / value.layout.treadDepthMm) : 0
  const diagramSteps = clamp(Number.isFinite(stepCount) ? stepCount : 1, 1, 48)
  const undoId = addedIds.current.filter(id => value.covers.some(cover => cover.id === id)).at(-1)
  const change = (patch: Partial<StaircaseConfig>) => { setError(''); onChange({ ...value, ...patch }) }
  const addRectangle = (start: PointMm, end: PointMm) => {
    if (value.covers.length >= 32) { setError('最多保留32处覆盖，请先移除一处。'); return }
    const lowX = Math.min(start.x, end.x), highX = Math.max(start.x, end.x), lowY = Math.min(start.y, end.y), highY = Math.max(start.y, end.y)
    if (![lowX, highX, lowY, highY].every(Number.isSafeInteger) || lowX < 0 || highX > 1_000_000 || lowY < -500_000 || highY > 500_000 || lowX === highX || lowY === highY) {
      setError('请设置有长度和宽度的覆盖区域；纵向、横向百分比须在0–100之间。'); return
    }
    const id = `stair-cover-${crypto.randomUUID()}`
    addedIds.current.push(id)
    change({ covers: [...value.covers, { id, kind: coverKind, pointsPpm: [{ x: lowX, y: lowY }, { x: highX, y: lowY }, { x: highX, y: highY }, { x: lowX, y: highY }] }] })
  }
  const pointerPoint = (event: PointerEvent<SVGSVGElement>): PointMm | null => {
    const matrix = event.currentTarget.getScreenCTM()
    if (!matrix) return null
    const screen = event.currentTarget.createSVGPoint(); screen.x = event.clientX; screen.y = event.clientY
    const local = screen.matrixTransform(matrix.inverse())
    return { x: Math.round(clamp((local.x - 20) / 960, 0, 1) * 1_000_000), y: Math.round(clamp((220 - local.y) / 192, 0, 1) * 1_000_000 - 500_000) }
  }
  const cancelDrag = () => { dragStart.current = null; setDragEnd(null) }
  const draftPolygon = dragStart.current && dragEnd ? [dragStart.current, { x: dragEnd.x, y: dragStart.current.y }, dragEnd, { x: dragStart.current.x, y: dragEnd.y }] : null
  return <div className="staircase-fields" data-staircase-fields>
    <label className="composition-check"><input type="checkbox" checked={!!value.range} onChange={event => {
      const { range: _range, ...settings } = value
      setError('')
      onChange(event.target.checked ? { ...settings, range: { startPpm: 250_000, endPpm: 750_000 } } : settings)
    }}/>只铺路线的一段</label>
    {value.range && <div className="composition-fields">
      <label>铺阶起点（%）<input type="number" min="0" max="100" step="0.1" value={value.range.startPpm / 10_000}
        onChange={event => change({ range: { ...value.range!, startPpm: Math.round(Number(event.target.value) * 10_000) } })}/></label>
      <label>铺阶终点（%）<input type="number" min="0" max="100" step="0.1" value={value.range.endPpm / 10_000}
        onChange={event => change({ range: { ...value.range!, endPpm: Math.round(Number(event.target.value) * 10_000) } })}/></label>
    </div>}
    <div className="composition-fields">
      <label>阶梯样式<select aria-label="阶梯样式" value={value.preset} onChange={event => change({ preset: event.target.value as StaircaseConfig['preset'] })}>{STAIRCASE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <label>阶梯材质<select aria-label="阶梯材质" value={value.material} onChange={event => change({ material: event.target.value as StaircaseConfig['material'] })}>{STAIRCASE_MATERIALS.map(material => <option key={material.id} value={material.id}>{material.label}</option>)}</select></label>
    </div>
    <label>续接方式<select aria-label="阶梯续接方式" value={value.layout.kind} disabled={!hasLength} onChange={event => {
      if (event.target.value === value.layout.kind || !hasLength) return
      change({ layout: event.target.value === 'repeat'
        ? { kind: 'repeat', treadDepthMm: clamp(Math.round(length / Math.max(1, stepCount)), 50, 2000) }
        : { kind: 'stretch', stepCount: clamp(stepCount, 1, 512) } })
    }}><option value="repeat">不拉伸续接 · 保持单级深度</option><option value="stretch">拉伸续接 · 保持级数</option></select></label>
    {!hasLength && <small>先设置路线，再切换续接方式。</small>}
    {value.layout.kind === 'repeat'
      ? <label>单级踏面深度（毫米）<input aria-label="阶梯踏面深度毫米" type="number" min="50" max="2000" step="1" value={value.layout.treadDepthMm} onChange={event => change({ layout: { kind: 'repeat', treadDepthMm: Number(event.target.value) } })}/><small>延长路线会增加级数，踏面和材质保持原有尺度。</small></label>
      : <label>固定级数<input aria-label="阶梯固定级数" type="number" min="1" max="512" step="1" value={value.layout.stepCount} onChange={event => change({ layout: { kind: 'stretch', stepCount: Number(event.target.value) } })}/><small>延长路线会加深每级踏面，材质纹理保持独立尺度。</small></label>}
    <label>材质纹理尺度（毫米）<input aria-label="阶梯纹理尺度毫米" type="number" min="50" max="4000" step="1" value={value.textureScaleMm} onChange={event => change({ textureScaleMm: Number(event.target.value) })}/></label>
    {hasLength && <p className="asset-muted" aria-live="polite">铺阶约 {Math.round(length).toLocaleString()} 毫米{widthMm && widthMm > 0 ? ` · 宽 ${widthMm.toLocaleString()} 毫米` : ''} · {stepCount} 级{value.layout.kind === 'stretch' && stepCount > 0 ? ` · 每级约 ${Math.round(length / stepCount)} 毫米` : ''}。</p>}
    {stepCount > 512 && <p className="asset-form-error" role="alert">当前路线超过512级，请增大踏面深度或缩短路线。</p>}
    <details className="staircase-covers">
      <summary>局部覆盖与露出底层 · {value.covers.length}/32</summary>
      <p className="asset-muted">在阶梯展开示意图上拖出矩形。覆盖沿路线从起点到终点排列，随弯曲和伸长保留相对位置；清除覆盖可恢复完整阶梯。</p>
      <label>覆盖方式<select aria-label="阶梯覆盖方式" value={coverKind} onChange={event => setCoverKind(event.target.value as StaircaseCover['kind'])}>{Object.entries(coverLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <svg className="staircase-cover-board" data-testid="staircase-cover-board" viewBox="0 0 1000 260" role="img" aria-labelledby={`${titleId} ${descriptionId}`} onPointerDown={event => {
        if (event.button !== 0 || value.covers.length >= 32 || event.currentTarget.closest('fieldset[disabled]')) return
        const point = pointerPoint(event); if (!point) return
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); dragStart.current = point; setDragEnd(point); setError('')
      }} onPointerMove={event => { if (dragStart.current) setDragEnd(pointerPoint(event)) }} onPointerUp={event => {
        const start = dragStart.current, end = pointerPoint(event)
        cancelDrag()
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        if (start && end && !event.currentTarget.closest('fieldset[disabled]')) addRectangle(start, end)
      }} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
        <title id={titleId}>阶梯展开示意图</title><desc id={descriptionId}>横向从起点到终点，纵向从阶梯左侧到右侧；也可使用下方百分比输入添加覆盖。</desc>
        <rect x="20" y="28" width="960" height="192" rx="2" fill="#c9c0ac" stroke="#554c3e" strokeWidth="3"/>
        {Array.from({ length: diagramSteps - 1 }, (_, index) => <line key={index} x1={20 + 960 * (index + 1) / diagramSteps} x2={20 + 960 * (index + 1) / diagramSteps} y1="28" y2="220" stroke="#6a6050" strokeWidth="3"/>)}
        {value.covers.map(cover => <polygon key={cover.id} points={polygonText(cover.pointsPpm)} fill={coverColors[cover.kind]} fillOpacity="0.85" stroke="#332f2a" strokeWidth="2" strokeDasharray={cover.kind === 'reveal-ground' ? '10 5' : undefined}/>)}
        {draftPolygon && <polygon points={polygonText(draftPolygon)} fill={coverColors[coverKind]} fillOpacity="0.7" stroke="#171b23" strokeWidth="4" strokeDasharray="10 5"/>}
        <text x="20" y="248">起点</text><text x="980" y="248" textAnchor="end">终点</text><text x="500" y="20" textAnchor="middle">左侧</text><text x="500" y="248" textAnchor="middle">右侧</text>
      </svg>
      <details><summary>用百分比添加覆盖</summary>
        <div className="composition-fields"><label>路线起点（%）<input aria-label="阶梯覆盖路线起点百分比" type="number" min="0" max="100" step="0.1" value={rangeStart} onChange={event => setRangeStart(event.target.value)}/></label><label>路线终点（%）<input aria-label="阶梯覆盖路线终点百分比" type="number" min="0" max="100" step="0.1" value={rangeEnd} onChange={event => setRangeEnd(event.target.value)}/></label></div>
        <div className="composition-fields"><label>横向起点（左→右 %）<input aria-label="阶梯覆盖横向起点百分比" type="number" min="0" max="100" step="0.1" value={sideStart} onChange={event => setSideStart(event.target.value)}/></label><label>横向终点（左→右 %）<input aria-label="阶梯覆盖横向终点百分比" type="number" min="0" max="100" step="0.1" value={sideEnd} onChange={event => setSideEnd(event.target.value)}/></label></div>
        <button type="button" className="secondary asset-wide" disabled={value.covers.length >= 32} onClick={() => {
          if ([rangeStart, rangeEnd, sideStart, sideEnd].some(input => input.trim() === '' || !Number.isFinite(Number(input)) || Number(input) < 0 || Number(input) > 100)) { setError('请填写四个0–100的百分比。'); return }
          addRectangle({ x: Math.round(Number(rangeStart) * 10_000), y: 500_000 - Math.round(Number(sideStart) * 10_000) }, { x: Math.round(Number(rangeEnd) * 10_000), y: 500_000 - Math.round(Number(sideEnd) * 10_000) })
        }}>添加矩形覆盖</button>
      </details>
      <div className="staircase-actions"><button type="button" className="secondary" disabled={!undoId} onClick={() => { if (undoId) { addedIds.current = addedIds.current.filter(id => id !== undoId); change({ covers: value.covers.filter(cover => cover.id !== undoId) }) } }}>撤回刚加的覆盖</button><button type="button" className="secondary" disabled={!value.covers.length} onClick={() => { addedIds.current = []; change({ covers: [] }) }}>清除覆盖，恢复阶梯</button></div>
      {value.covers.length > 0 && <ol className="staircase-cover-list">{value.covers.map((cover, index) => <li key={cover.id}><span>{index + 1}. {coverLabels[cover.kind]}</span><button type="button" className="secondary" aria-label={`移除第${index + 1}处阶梯覆盖`} onClick={() => change({ covers: value.covers.filter(item => item.id !== cover.id) })}>移除</button></li>)}</ol>}
    </details>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </div>
}
