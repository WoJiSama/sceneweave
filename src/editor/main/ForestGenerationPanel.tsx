import { WorkspaceReview } from '../workspace/WorkspacePresentation'
import { useId, useRef, useState } from 'react'
import type { ForestPreview } from '../../application/workspace/workspace'
import './terrain-generation.css'
import './forest-generation.css'

export interface ForestGenerationUiRequest {
  title: string
  widthMm: number
  heightMm: number
  seed: string
  clearings: Array<{ id: string; boundsMm: { x: number; y: number; width: number; height: number } }>
  entranceSide: 'west' | 'east' | 'north' | 'south'
  routeWidthMm: number
  treeCoveragePpm: number
  shrubCoveragePpm: number
  grassCoveragePpm: number
}

const initialClearings = (): ForestGenerationUiRequest['clearings'] => [
  { id: 'clearing-1', boundsMm: { x: 12000, y: 9000, width: 8000, height: 6000 } },
]
const mm = (metres: string) => Math.round(Number(metres) * 1000)
const ppm = (percent: string) => Math.round(Number(percent) * 10000)
const roleName = (role: string) => role === 'tree' ? '树木' : role === 'shrub' ? '灌木' : '草簇'

/** The host captures the request, prepares fixed resources and owns adoption. */
export default function ForestGenerationPanel({ busy, disabled, error, candidate, dirty, onGenerate, onAdopt, onCancel, onChange }: {
  busy: boolean; disabled: boolean; error: string | null; candidate: ForestPreview | null; dirty: boolean
  onGenerate: (input: ForestGenerationUiRequest) => void | Promise<void>
  onAdopt: () => void | Promise<void>; onCancel: () => void; onChange: () => void
}) {
  const [title, setTitle] = useState('森林营地'), [seed, setSeed] = useState('forest-1')
  const [widthMm, setWidthMm] = useState(32000), [heightMm, setHeightMm] = useState(24000)
  const [clearings, setClearings] = useState(initialClearings)
  const [entranceSide, setEntranceSide] = useState<ForestGenerationUiRequest['entranceSide']>('west')
  const [routeWidthMm, setRouteWidthMm] = useState(1800)
  const [treeCoveragePpm, setTreeCoveragePpm] = useState(80000), [shrubCoveragePpm, setShrubCoveragePpm] = useState(10000), [grassCoveragePpm, setGrassCoveragePpm] = useState(1000)
  const nextClearing = useRef(2)
  const validationId = useId()
  const locked = busy || disabled, cleanTitle = title.trim(), cleanSeed = seed.trim()
  const change = (apply: () => void) => { if (locked) return; onChange(); apply() }
  const updateClearing = (id: string, patch: Partial<ForestGenerationUiRequest['clearings'][number]['boundsMm']>) => change(() => setClearings(current => current.map(row => row.id === id ? { ...row, boundsMm: { ...row.boundsMm, ...patch } } : row)))
  const validationReason = (() => {
    if (!cleanTitle || cleanTitle.length > 120) return '请填写工程名称，最多120个字符。'
    if (!cleanSeed || cleanSeed.length > 128) return '请填写生成种子，最多128个字符。'
    if (![widthMm, heightMm].every(value => Number.isSafeInteger(value) && value >= 1000 && value <= 200000)) return '地图宽和高须为1–200米，请调整地图尺寸。'
    if (clearings.length < 1 || clearings.length > 4) return '请保留1–4块活动空地。'
    for (const [index, { boundsMm: b }] of clearings.entries()) {
      if (![b.x, b.y, b.width, b.height].every(Number.isSafeInteger)) return `空地${index + 1}的位置或尺寸无效，请重新填写数值。`
      if (b.x < 0 || b.y < 0) return `空地${index + 1}的位置须从地图左上角起算且不小于0，请调整位置。`
      if (b.width <= 0 || b.height <= 0) return `空地${index + 1}的宽和高须大于0，请调整空地尺寸。`
      if (b.x + b.width > widthMm || b.y + b.height > heightMm) return `空地${index + 1}超出地图范围，请调整空地位置、尺寸或扩大地图。`
    }
    if (!(Number.isSafeInteger(routeWidthMm) && routeWidthMm > 0 && routeWidthMm <= 10000)) return '路线净宽须大于0且不超过10米，请调整净宽。'
    if (![treeCoveragePpm, shrubCoveragePpm, grassCoveragePpm].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000)) return '树木、灌木和草簇的目标覆盖须为0–100%，请调整覆盖比例。'
    return null
  })()
  const valid = validationReason === null
  const feedback = error && <><p className="asset-error" role="alert">{error}</p><p className="asset-muted">请按提示修改参数后重新预览，或选择「取消森林与营地」返回当前工程。</p></>
  const cancelAction = <button className="secondary asset-wide" disabled={disabled} onClick={onCancel}>取消森林与营地</button>
  return <section className="terrain-generation-panel forest-generation-panel" aria-label="森林与营地生成">
    <h2>森林与营地</h2>
    <p>先留出活动空地与入口路线，再在真实地面上布置树木、灌木和草簇。</p>
    <p className="asset-muted">覆盖目标与实际数量分别显示。空间不足会说明缺项；保存后可继续移动或删除，不会自动补回。</p>
    {dirty && !busy && !candidate && !error && <p className="terrain-generation-notice" role="status">参数已修改，请预览当前设置。当前工程尚未改变。</p>}
    <form onSubmit={event => { event.preventDefault(); if (valid && !locked) void onGenerate({ title: cleanTitle, widthMm, heightMm, seed: cleanSeed, clearings: clearings.map(row => ({ ...row, boundsMm: { ...row.boundsMm } })), entranceSide, routeWidthMm, treeCoveragePpm, shrubCoveragePpm, grassCoveragePpm }) }}>
      <fieldset disabled={locked}>
        <legend>地图与活动空间</legend>
        <label>工程名称<input aria-label="森林工程名称" value={title} maxLength={120} onChange={event => change(() => setTitle(event.target.value))}/></label>
        <div className="forest-field-pair">
          <label>地图宽（米）<input aria-label="森林地图宽米" type="number" min="1" max="200" step="0.1" value={widthMm / 1000} onChange={event => change(() => setWidthMm(mm(event.target.value)))}/></label>
          <label>地图高（米）<input aria-label="森林地图高米" type="number" min="1" max="200" step="0.1" value={heightMm / 1000} onChange={event => change(() => setHeightMm(mm(event.target.value)))}/></label>
        </div>
        <label>生成种子<input aria-label="森林生成种子" value={seed} maxLength={128} onChange={event => change(() => setSeed(event.target.value))}/></label>
        <h3>活动空地 · {clearings.length}</h3>
        <p className="asset-muted">位置从地图左上角起算。空地须完整留在地图内，树木与草灌会避让空地和路线。</p>
        {clearings.map((clearing, index) => <fieldset className="forest-clearing" key={clearing.id}>
          <legend>空地 {index + 1}</legend>
          <div className="forest-field-pair">
            <label>横向位置（米）<input aria-label={`空地${index + 1}横向位置米`} type="number" min="0" step="0.1" value={clearing.boundsMm.x / 1000} onChange={event => updateClearing(clearing.id, { x: mm(event.target.value) })}/></label>
            <label>纵向位置（米）<input aria-label={`空地${index + 1}纵向位置米`} type="number" min="0" step="0.1" value={clearing.boundsMm.y / 1000} onChange={event => updateClearing(clearing.id, { y: mm(event.target.value) })}/></label>
          </div>
          <div className="forest-field-pair">
            <label>空地宽（米）<input aria-label={`空地${index + 1}宽米`} type="number" min="0.1" step="0.1" value={clearing.boundsMm.width / 1000} onChange={event => updateClearing(clearing.id, { width: mm(event.target.value) })}/></label>
            <label>空地高（米）<input aria-label={`空地${index + 1}高米`} type="number" min="0.1" step="0.1" value={clearing.boundsMm.height / 1000} onChange={event => updateClearing(clearing.id, { height: mm(event.target.value) })}/></label>
          </div>
          <button className="secondary" type="button" disabled={clearings.length <= 1} onClick={() => change(() => setClearings(current => current.filter(row => row.id !== clearing.id)))}>移除空地 {index + 1}</button>
        </fieldset>)}
        <button className="secondary asset-wide" type="button" disabled={clearings.length >= 4} onClick={() => change(() => {
          const sequence = nextClearing.current++, id = `clearing-${sequence}`, width = Math.min(4000, widthMm), height = Math.min(4000, heightMm)
          const x = sequence % 2 ? Math.max(0, widthMm - width - 1000) : Math.min(1000, Math.max(0, widthMm - width))
          const y = sequence > 3 ? Math.max(0, heightMm - height - 1000) : Math.min(1000, Math.max(0, heightMm - height))
          setClearings(current => [...current, { id, boundsMm: { x, y, width, height } }])
        })}>增加活动空地</button>
        <h3>入口与路线</h3>
        <label>入口方向<select aria-label="森林入口方向" value={entranceSide} onChange={event => change(() => setEntranceSide(event.target.value as ForestGenerationUiRequest['entranceSide']))}><option value="west">西侧</option><option value="east">东侧</option><option value="north">北侧</option><option value="south">南侧</option></select></label>
        <label>路线净宽（米）<input aria-label="森林路线净宽米" type="number" min="0.1" max="10" step="0.1" value={routeWidthMm / 1000} onChange={event => change(() => setRouteWidthMm(mm(event.target.value)))}/></label>
        <h3>植被覆盖目标</h3>
        <label>树木（%）<input aria-label="森林树木覆盖百分比" type="number" min="0" max="100" step="0.1" value={treeCoveragePpm / 10000} onChange={event => change(() => setTreeCoveragePpm(ppm(event.target.value)))}/></label>
        <div className="forest-field-pair">
          <label>灌木（%）<input aria-label="森林灌木覆盖百分比" type="number" min="0" max="100" step="0.1" value={shrubCoveragePpm / 10000} onChange={event => change(() => setShrubCoveragePpm(ppm(event.target.value)))}/></label>
          <label>草簇（%）<input aria-label="森林草簇覆盖百分比" type="number" min="0" max="100" step="0.1" value={grassCoveragePpm / 10000} onChange={event => change(() => setGrassCoveragePpm(ppm(event.target.value)))}/></label>
        </div>
        <p className="asset-muted">覆盖目标按所用素材尺寸换算。实际布置还受支撑、占地与净空影响；超出生成容量时会明确说明。</p>
        {!candidate && validationReason && <p id={validationId} className="asset-form-error" role="status">{validationReason}</p>}
        <button className="primary asset-wide" type="submit" disabled={!valid} aria-describedby={!candidate && validationReason ? validationId : undefined}>{busy ? '正在准备森林与营地…' : '预览森林与营地'}</button>
      </fieldset>
    </form>
    {!candidate && feedback}
    {candidate && <WorkspaceReview><div className="forest-generation-panel workspace-review-panel">{feedback}<div className="forest-candidate" aria-label="森林与营地候选摘要"><div className="workspace-review-body"><h3>候选 · {candidate.input.parameters.clearings.length} 处空地</h3>
      <p>画布展示完整候选，当前工程尚未改变。</p>
      <p aria-label="森林实际生成结果">实际安排 {candidate.report.pathIds.length} 条路线、{candidate.report.propIds.length} 棵树和 {candidate.report.decorationIds.length} 处轻量草灌。</p>
      <ul aria-label="森林植被目标与实际数量">{candidate.report.vegetation.map(row => <li key={`${row.zoneId}:${row.role}:${row.ruleId}`}>{roleName(row.role)}：目标 {row.requested}，实际 {row.placed}。</li>)}</ul>
      {candidate.report.notes.length > 0 && <div aria-label="森林未完成建议"><h3>布置说明</h3><ul>{candidate.report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
      <p className="asset-muted">保存后可自由修改空地、道路或植被，已删除的内容不会在重开时自动恢复。</p>
      </div>
      <div className="workspace-review-actions">
      <button className="primary asset-wide" disabled={busy || disabled} onClick={() => void onAdopt()}>保存为新工程</button>
        {cancelAction}
      </div>
    </div></div></WorkspaceReview>}
    {!candidate && (dirty || busy) && cancelAction}
  </section>
}
