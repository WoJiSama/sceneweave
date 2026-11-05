import { useState } from 'react'
import type { VolcanoPreview } from '../../application/workspace/workspace'
import './terrain-generation.css'
import './volcano-generation.css'

export interface VolcanoGenerationUiRequest {
  title: string; widthMm: number; heightMm: number; seed: string
  mountainElevationMm: number; craterElevationMm: number
  craterWidthPercent: number; craterHeightPercent: number; craterCenterYPercent: number
  routeWidthMm: number; connectionKind: 'stairs' | 'ramp'
  craterHazard: boolean; craterBlocksMovement: boolean; craterMovementCostMultiplier: number
  flowEnabled: boolean; flowWidthMm: number; lavaAppearance: 'cold' | 'hot'
  flowHazard: boolean; flowBlocksMovement: boolean; flowMovementCostMultiplier: number
}
const mm = (value: string) => Math.round(Number(value) * 1000)
const initial = (): VolcanoGenerationUiRequest => ({
  title: '火山活动区', widthMm: 40000, heightMm: 32000, seed: 'volcano-1',
  mountainElevationMm: 2000, craterElevationMm: 500,
  craterWidthPercent: 25, craterHeightPercent: 40, craterCenterYPercent: 50,
  routeWidthMm: 1500, connectionKind: 'stairs',
  craterHazard: true, craterBlocksMovement: false, craterMovementCostMultiplier: 2,
  flowEnabled: true, flowWidthMm: 1400, lavaAppearance: 'hot',
  flowHazard: true, flowBlocksMovement: true, flowMovementCostMultiplier: 3,
})

export default function VolcanoGenerationPanel({ busy, disabled, error, candidate, dirty, onGenerate, onAdopt, onCancel, onChange }: {
  busy: boolean; disabled: boolean; error: string | null; candidate: VolcanoPreview | null; dirty: boolean
  onGenerate: (input: VolcanoGenerationUiRequest) => void | Promise<void>
  onAdopt: () => void | Promise<void>; onCancel: () => void; onChange: () => void
}) {
  const [input, setInput] = useState(initial)
  const locked = busy || disabled
  const change = <K extends keyof VolcanoGenerationUiRequest>(key: K, value: VolcanoGenerationUiRequest[K]) => {
    if (locked) return
    onChange(); setInput(current => ({ ...current, [key]: value }))
  }
  const valid = !!input.title.trim() && input.title.trim().length <= 120 && !!input.seed.trim() && input.seed.trim().length <= 128
    && [input.widthMm, input.heightMm].every(value => Number.isSafeInteger(value) && value >= 1000 && value <= 200000)
    && [input.mountainElevationMm, input.craterElevationMm].every(value => Number.isSafeInteger(value) && Math.abs(value) <= 100000)
    && [input.craterWidthPercent, input.craterHeightPercent, input.craterCenterYPercent].every(value => Number.isFinite(value) && value > 0 && value < 100)
    && [input.routeWidthMm, ...(input.flowEnabled ? [input.flowWidthMm] : [])].every(value => Number.isSafeInteger(value) && value > 0 && value <= 10000)
    && [input.craterMovementCostMultiplier, ...(input.flowEnabled ? [input.flowMovementCostMultiplier] : [])].every(value => Number.isFinite(value) && value >= 1 && value <= 100)
  const p = candidate?.input.parameters
  return <section className="terrain-generation-panel volcano-generation-panel" aria-label="火山生成">
    <h2>火山</h2>
    <p>生成单火口、离散高台、活动平台和真实阶梯或坡道，核对指定路线的完整净宽。</p>
    <p className="asset-muted">熔岩外观、危险标记、阻挡和移动代价分别设置。保存后可自由删改，不会自动补回。</p>
    <form onSubmit={event => { event.preventDefault(); if (valid && !locked) void onGenerate({ ...input, title: input.title.trim(), seed: input.seed.trim() }) }}>
      <fieldset disabled={locked}>
        <legend>地图与火口</legend>
        <label>工程名称<input aria-label="火山工程名称" value={input.title} maxLength={120} onChange={event => change('title', event.target.value)}/></label>
        <div className="volcano-field-pair">
          <label>地图宽（米）<input aria-label="火山地图宽米" type="number" min="1" max="200" step="0.1" value={input.widthMm / 1000} onChange={event => change('widthMm', mm(event.target.value))}/></label>
          <label>地图高（米）<input aria-label="火山地图高米" type="number" min="1" max="200" step="0.1" value={input.heightMm / 1000} onChange={event => change('heightMm', mm(event.target.value))}/></label>
        </div>
        <label>生成种子<input aria-label="火山生成种子" value={input.seed} maxLength={128} onChange={event => change('seed', event.target.value)}/></label>
        <div className="volcano-field-pair">
          <label>山体高程（米）<input aria-label="山体高程米" type="number" min="-100" max="100" step="0.1" value={input.mountainElevationMm / 1000} onChange={event => change('mountainElevationMm', mm(event.target.value))}/></label>
          <label>火口高程（米）<input aria-label="火口高程米" type="number" min="-100" max="100" step="0.1" value={input.craterElevationMm / 1000} onChange={event => change('craterElevationMm', mm(event.target.value))}/></label>
        </div>
        <p className="asset-muted">地面基准为 0 米。火口须低于山体；平台位于山体西侧。火口尺寸和位置会改变真实轮廓及下行连接。</p>
        <div className="volcano-field-pair">
          <label>火口宽占地图（%）<input aria-label="火口宽百分比" type="number" min="1" max="99" step="1" value={input.craterWidthPercent} onChange={event => change('craterWidthPercent', Number(event.target.value))}/></label>
          <label>火口高占地图（%）<input aria-label="火口高百分比" type="number" min="1" max="99" step="1" value={input.craterHeightPercent} onChange={event => change('craterHeightPercent', Number(event.target.value))}/></label>
        </div>
        <label>火口纵向中心（%）<input aria-label="火口纵向中心百分比" type="number" min="1" max="99" step="1" value={input.craterCenterYPercent} onChange={event => change('craterCenterYPercent', Number(event.target.value))}/></label>
        <h3>入口与通路</h3>
        <div className="volcano-field-pair">
          <label>路线净宽（米）<input aria-label="火山路线净宽米" type="number" min="0.1" max="10" step="0.1" value={input.routeWidthMm / 1000} onChange={event => change('routeWidthMm', mm(event.target.value))}/></label>
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
            <label>流道宽（米）<input aria-label="流道宽米" type="number" min="0.1" max="10" step="0.1" value={input.flowWidthMm / 1000} onChange={event => change('flowWidthMm', mm(event.target.value))}/></label>
            <label>熔岩外观<select aria-label="熔岩外观" value={input.lavaAppearance} onChange={event => change('lavaAppearance', event.target.value as VolcanoGenerationUiRequest['lavaAppearance'])}><option value="cold">冷壳熔岩</option><option value="hot">热裂熔岩</option></select></label>
          </div>
          <label className="volcano-check"><input aria-label="流道标记危险" type="checkbox" checked={input.flowHazard} onChange={event => change('flowHazard', event.target.checked)}/>标记为危险</label>
          <label className="volcano-check"><input aria-label="流道阻挡移动" type="checkbox" checked={input.flowBlocksMovement} onChange={event => change('flowBlocksMovement', event.target.checked)}/>阻挡移动</label>
          <label>移动代价倍率<input aria-label="流道移动代价倍率" type="number" min="1" max="100" step="0.1" value={input.flowMovementCostMultiplier} onChange={event => change('flowMovementCostMultiplier', Number(event.target.value))}/></label>
        </fieldset>
        <p className="asset-muted">流道位于火口东侧，独立于西侧路线。尺寸过大、支撑或净空不足时会明确拒绝；移动代价不代表已提供全图最优寻路。</p>
        <button className="primary asset-wide" type="submit" disabled={!valid}>{busy ? '正在准备火山…' : '预览火山'}</button>
      </fieldset>
    </form>
    {error && <p className="asset-error" role="alert">{error}</p>}
    {candidate && p && <div className="volcano-candidate" aria-label="火山候选摘要"><h3>候选 · 单火口与活动平台</h3>
      <p>画布展示完整候选，当前工程尚未改变。</p>
      <p aria-label="火山实际生成结果">实际生成 {candidate.report.connectionIds.length} 处高差连接、{candidate.report.pathIds.length} 条路线及 {candidate.report.regionIds.length} 个通行策略区域。</p>
      <p>山体高程 {p.mountain.elevationMm / 1000} 米，火口高程 {p.crater.elevationMm / 1000} 米；指定路线净宽 {p.route.widthMm / 1000} 米已检查。</p>
      <p aria-label="火山危险与外观设置">火口{p.crater.hazard ? '标记危险' : '不标记危险'}，{p.crater.blocksMovement ? '阻挡移动' : '允许移动'}，代价 ×{p.crater.movementCostMultiplier}。{p.flow ? `流道${p.flow.hazard ? '标记危险' : '不标记危险'}，${p.flow.blocksMovement ? '阻挡移动' : '允许移动'}，代价 ×${p.flow.movementCostMultiplier}。` : '未生成流道。'}</p>
      {candidate.report.notes.length > 0 && <ul aria-label="火山生成说明">{candidate.report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      <button className="primary asset-wide" disabled={busy || disabled} onClick={() => void onAdopt()}>保存为新工程</button>
    </div>}
    {(dirty || busy || candidate) && <button className="secondary asset-wide" disabled={disabled} onClick={onCancel}>取消火山</button>}
  </section>
}
