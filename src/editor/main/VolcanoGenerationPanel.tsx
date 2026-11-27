import type { SizeMm } from '../../shared/model/scene'
import { VOLCANO_DEFAULTS, type VolcanoSide } from '../../shared/generation/domains/volcano/contracts'
import { WorkspaceReview } from '../workspace/WorkspacePresentation'
import { useId, useState } from 'react'
import type { VolcanoPreview } from '../../application/workspace/workspace'
import './terrain-generation.css'
import './volcano-generation.css'

import type { VolcanoGenerationUiRequest } from '../../application/workspace/generation-intent.js'
export type { VolcanoGenerationUiRequest } from '../../application/workspace/generation-intent.js'
const mm = (value: string) => Math.round(Number(value) * 1000)
const initial = (): VolcanoGenerationUiRequest => ({
  ...VOLCANO_DEFAULTS, title: '火山活动区',
})
const sideNames: Record<VolcanoSide, string> = { west: '西', east: '东', north: '北', south: '南' }
const sideOptions = Object.entries(sideNames).map(([side, label]) => <option key={side} value={side}>{label}侧</option>)

export default function VolcanoGenerationPanel({ busy, disabled, error, candidate, dirty, canvasSize, onGenerate, onAdopt, onCancel, onChange }: {
  busy: boolean; disabled: boolean; error: string | null; candidate: VolcanoPreview | null; dirty: boolean; canvasSize?: SizeMm
  onGenerate: (input: VolcanoGenerationUiRequest) => void | Promise<void>
  onAdopt: () => void | Promise<void>; onCancel: () => void; onChange: () => void
}) {
  const [draft, setInput] = useState(initial)
  const input = canvasSize ? { ...draft, widthMm: canvasSize.width, heightMm: canvasSize.height } : draft
  const validationId = useId()
  const locked = busy || disabled
  const change = <K extends keyof VolcanoGenerationUiRequest>(key: K, value: VolcanoGenerationUiRequest[K]) => {
    if (locked) return
    onChange(); setInput(current => ({ ...current, [key]: value }))
  }
  const validationReason = (() => {
    if (!input.title.trim() || input.title.trim().length > 120) return '请填写工程名称，最多120个字符。'
    if (!input.seed.trim() || input.seed.trim().length > 128) return '请填写生成种子，最多128个字符。'
    if (![input.widthMm, input.heightMm].every(value => Number.isSafeInteger(value) && value >= 1000 && value <= 200000)) return '地图宽和高须为1–200米，请调整地图尺寸。'
    if (![input.mountainElevationMm, input.craterElevationMm].every(value => Number.isSafeInteger(value) && Math.abs(value) <= 100000)) return '山体和火口高程须在-100至100米之间，请调整高程。'
    if (![input.craterWidthPercent, input.craterHeightPercent, input.craterCenterYPercent].every(value => Number.isFinite(value) && value > 0 && value < 100)) return '火口宽、高和纵向位置须大于0%且小于100%，请调整火口比例。'
    if (![input.routeWidthMm, ...(input.flowEnabled ? [input.flowWidthMm] : [])].every(value => Number.isSafeInteger(value) && value > 0)) return '路线净宽和已启用的流道宽度须为正整数毫米，请调整宽度。'
    if (![input.craterMovementCostMultiplier, ...(input.flowEnabled ? [input.flowMovementCostMultiplier] : [])].every(value => Number.isFinite(value) && value >= 1 && value <= 100)) return '火口和已启用流道的移动代价倍率须为1–100，请调整倍率。'
    return null
  })()
  const valid = validationReason === null
  const p = candidate?.input.parameters
  const feedback = error && <><p className="asset-error" role="alert">{error}</p><p className="asset-muted">请按提示修改参数后重新预览，或选择「取消火山」返回当前工程。</p></>
  const cancelAction = <button className="secondary asset-wide" disabled={disabled} onClick={onCancel}>取消火山</button>
  return <section className="terrain-generation-panel volcano-generation-panel" aria-label="火山生成">
    <h2>火山</h2>
    <p>生成自然火口、观测台和登高路线。净宽和高差按实际地形检查，无法放下时会指出冲突。</p>
    <details className="workspace-detail-disclosure workspace-generation-help"><summary>生成与后续编辑说明</summary><p className="asset-muted">熔岩外观、危险标记、阻挡和移动代价分别设置。保存后可自由删改，不会自动补回。</p></details>
    {dirty && !busy && !candidate && !error && <p className="terrain-generation-notice" role="status">参数已修改，请预览当前设置。当前工程尚未改变。</p>}
    <form onSubmit={event => { event.preventDefault(); if (valid && !locked) void onGenerate({ ...input, title: input.title.trim(), seed: input.seed.trim(),
      breachSide: input.shape === 'terrace' ? 'none' : input.breachSide ?? VOLCANO_DEFAULTS.breachSide }) }}>
      <fieldset disabled={locked}>
        <legend>地图与火口</legend>
        {!canvasSize && <>
        <label>工程名称<input aria-label="火山工程名称" value={input.title} maxLength={120} onChange={event => change('title', event.target.value)}/></label>
        <div className="volcano-field-pair">
          <label>地图宽（米）<input aria-label="火山地图宽米" type="number" min="1" max="200" step="0.1" value={input.widthMm / 1000} onChange={event => change('widthMm', mm(event.target.value))}/></label>
          <label>地图高（米）<input aria-label="火山地图高米" type="number" min="1" max="200" step="0.1" value={input.heightMm / 1000} onChange={event => change('heightMm', mm(event.target.value))}/></label>
        </div>
        </>}
        <label>生成种子<input aria-label="火山生成种子" value={input.seed} maxLength={128} onChange={event => change('seed', event.target.value)}/></label>
        <div className="volcano-field-pair">
          <label>地形形状<select value={input.shape} onChange={event => change('shape', event.target.value as VolcanoGenerationUiRequest['shape'])}><option value="natural">自然火口</option><option value="terrace">简化台地</option></select></label>
          {input.shape === 'natural' && <label>塌口方向<select value={input.breachSide} onChange={event => change('breachSide', event.target.value as VolcanoGenerationUiRequest['breachSide'])}><option value="none">无指定塌口</option>{sideOptions}</select></label>}
        </div>
        <div className="volcano-field-pair">
          <label>山体高程（米）<input aria-label="山体高程米" type="number" min="-100" max="100" step="0.1" value={input.mountainElevationMm / 1000} onChange={event => change('mountainElevationMm', mm(event.target.value))}/></label>
          <label>火口高程（米）<input aria-label="火口高程米" type="number" min="-100" max="100" step="0.1" value={input.craterElevationMm / 1000} onChange={event => change('craterElevationMm', mm(event.target.value))}/></label>
        </div>
        <p className="asset-muted">地面基准为 0 米。山体高程设定观测台的高度，岩脊可以更高。火口比例沿入口方向取宽，垂直于入口方向取高。</p>
        <div className="volcano-field-pair">
          <label>火口宽占地图（%）<input aria-label="火口宽百分比" type="number" min="0" max="100" step="any" value={input.craterWidthPercent} onChange={event => change('craterWidthPercent', Number(event.target.value))}/></label>
          <label>火口高占地图（%）<input aria-label="火口高百分比" type="number" min="0" max="100" step="any" value={input.craterHeightPercent} onChange={event => change('craterHeightPercent', Number(event.target.value))}/></label>
        </div>
        <label>火口纵向中心（%）<input aria-label="火口纵向中心百分比" type="number" min="0" max="100" step="any" value={input.craterCenterYPercent} onChange={event => change('craterCenterYPercent', Number(event.target.value))}/></label>
        <h3>入口与通路</h3>
        <label>入口方向<select value={input.entranceSide} onChange={event => change('entranceSide', event.target.value as VolcanoSide)}>{sideOptions}</select></label>
        <div className="volcano-field-pair">
          <label>路线净宽（米）<input aria-label="火山路线净宽米" type="number" min="0.001" step="0.001" value={input.routeWidthMm / 1000} onChange={event => change('routeWidthMm', mm(event.target.value))}/></label>
          <label>高差连接<select aria-label="火山高差连接类型" value={input.connectionKind} onChange={event => change('connectionKind', event.target.value as VolcanoGenerationUiRequest['connectionKind'])}><option value="stairs">阶梯</option><option value="ramp">坡道</option></select></label>
        </div>
        <h3>火口通行策略</h3>
        <label className="volcano-check"><input aria-label="火口标记危险" type="checkbox" checked={input.craterHazard} onChange={event => change('craterHazard', event.target.checked)}/>标记为危险</label>
        <label className="volcano-check"><input aria-label="火口阻挡移动" type="checkbox" checked={input.craterBlocksMovement} onChange={event => change('craterBlocksMovement', event.target.checked)}/>阻挡移动</label>
        <label>移动代价倍率<input aria-label="火口移动代价倍率" type="number" min="1" max="100" step="0.1" value={input.craterMovementCostMultiplier} onChange={event => change('craterMovementCostMultiplier', Number(event.target.value))}/></label>
        <p className="asset-muted">初次生成包含下火口路线。阻挡火口或用流道封住路线时会拒绝该候选，并说明冲突。</p>
        <h3>火口内流道</h3>
        <label className="volcano-check"><input aria-label="生成火口内流道" type="checkbox" checked={input.flowEnabled} onChange={event => change('flowEnabled', event.target.checked)}/>生成流道</label>
        <fieldset disabled={!input.flowEnabled}>
          <legend>流道外观与策略</legend>
          <div className="volcano-field-pair">
          <label>流道最宽处（米）<input aria-label="流道宽米" type="number" min="0.001" step="0.001" value={input.flowWidthMm / 1000} onChange={event => change('flowWidthMm', mm(event.target.value))}/></label>
            <label>熔岩外观<select aria-label="熔岩外观" value={input.lavaAppearance} onChange={event => change('lavaAppearance', event.target.value as VolcanoGenerationUiRequest['lavaAppearance'])}><option value="cold">冷壳熔岩</option><option value="hot">热裂熔岩</option></select></label>
          </div>
          <label className="volcano-check"><input aria-label="流道标记危险" type="checkbox" checked={input.flowHazard} onChange={event => change('flowHazard', event.target.checked)}/>标记为危险</label>
          <label className="volcano-check"><input aria-label="流道阻挡移动" type="checkbox" checked={input.flowBlocksMovement} onChange={event => change('flowBlocksMovement', event.target.checked)}/>阻挡移动</label>
          <label>移动代价倍率<input aria-label="流道移动代价倍率" type="number" min="1" max="100" step="0.1" value={input.flowMovementCostMultiplier} onChange={event => change('flowMovementCostMultiplier', Number(event.target.value))}/></label>
        </fieldset>
        <p className="asset-muted">流道须完整留在火口内，程序会检查与下行路线之间的实际净空。</p>
        {!candidate && validationReason && <p id={validationId} className="asset-form-error" role="status">{validationReason}</p>}
        <button className="primary asset-wide" type="submit" disabled={!valid} aria-describedby={!candidate && validationReason ? validationId : undefined}>{busy ? '正在准备火山…' : '预览火山'}</button>
      </fieldset>
    </form>
    {!candidate && feedback}
    {candidate && p && <WorkspaceReview><div className="volcano-generation-panel workspace-review-panel">{feedback}<div className="volcano-candidate" aria-label="火山候选摘要"><div className="workspace-review-body"><h3>候选 · 单火口与活动平台</h3>
      <p>画布展示完整候选，当前工程尚未改变。</p>
      <p aria-label="火山地形形状">{(candidate.report.shape ?? (p.relief ? 'natural' : 'terrace')) === 'terrace' ? '简化台地' : '自然火口'}{candidate.report.breachSide && `，${sideNames[candidate.report.breachSide]}侧塌口`}</p>
      <p aria-label="火山实际生成结果">实际生成 {candidate.report.connectionIds.length} 处高差连接、{candidate.report.pathIds.length} 条路线及 {candidate.report.regionIds.length} 个通行策略区域。</p>
      <p>山体基准 {p.mountain.elevationMm / 1000} 米，火口底部 {p.crater.elevationMm / 1000} 米。指定路线净宽 {p.route.widthMm / 1000} 米已检查。</p>
      {candidate.report.traversal && <ul aria-label="火山连接高差与水平距离">{candidate.report.traversal.map((row, index) => <li key={row.id}>{index ? '观测台到火口' : '入口到观测台'}，高差 {row.riseMm / 1000} 米，水平距离 {row.runMm / 1000} 米，{row.kind === 'ramp' ? `纵坡 ${Math.round(row.riseMm / row.runMm * 100)}%` : `${row.stepCount} 级踏步`}</li>)}</ul>}
      <p aria-label="火山危险与外观设置">火口{p.crater.hazard ? '标记危险' : '不标记危险'}，{p.crater.blocksMovement ? '阻挡移动' : '允许移动'}，代价 ×{p.crater.movementCostMultiplier}。{p.flow ? `流道${p.flow.hazard ? '标记危险' : '不标记危险'}，${p.flow.blocksMovement ? '阻挡移动' : '允许移动'}，代价 ×${p.flow.movementCostMultiplier}。` : '未生成流道。'}</p>
      {candidate.report.notes.length > 0 && <ul aria-label="火山生成说明">{candidate.report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      </div>
      <div className="workspace-review-actions">
      {!canvasSize && <button className="primary asset-wide" disabled={busy || disabled} onClick={() => void onAdopt()}>保存为新工程</button>}
        {cancelAction}
      </div>
    </div></div></WorkspaceReview>}
    {!candidate && (dirty || busy) && cancelAction}
  </section>
}
