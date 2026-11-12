import { WorkspaceReview } from '../workspace/WorkspacePresentation'
import { useId, useState } from 'react'
import type { MixedPreview } from '../../application/workspace/workspace'
import GenerationParameterAssistant from './GenerationParameterAssistant'
import type { AiConnection } from './AiConversationPanel'
import './terrain-generation.css'
import './volcano-generation.css'

import type { MixedGenerationUiRequest } from '../../application/workspace/generation-intent.js'
export type { MixedGenerationUiRequest } from '../../application/workspace/generation-intent.js'
const initial = (): MixedGenerationUiRequest => ({ title: '林中驿站', environment: 'forest', widthMm: 40000, heightMm: 32000, seed: 'mixed-1', roomCount: 1, purpose: '驿站休息室', furniture: true, vegetationMultiplier: 1, algorithmVersion: 4, woodlandDistribution: 'uniform' })

export default function MixedGenerationPanel({ busy, disabled, error, candidate, dirty, onGenerate, onAdopt, onCancel, onChange, aiConnection = null }: {
  busy: boolean; disabled: boolean; error: string | null; candidate: MixedPreview | null; dirty: boolean
  aiConnection?: AiConnection | null
  onGenerate: (input: MixedGenerationUiRequest) => void | Promise<void>
  onAdopt: () => void | Promise<void>; onCancel: () => void; onChange: () => void
}) {
  const [input, setInput] = useState(initial)
  const [formRevision, setFormRevision] = useState(0)
  const { algorithmVersion, woodlandDistribution, ...assistantParameters } = input
  const validationId = useId()
  const locked = busy || disabled
  const change = <K extends keyof MixedGenerationUiRequest>(key: K, value: MixedGenerationUiRequest[K]) => {
    if (locked) return
    onChange(); setFormRevision(value => value + 1); setInput(current => ({ ...current, [key]: value }))
  }
  const validationReason = (() => {
    if (!input.title.trim() || input.title.trim().length > 120) return '请填写工程名称，最多120个字符。'
    if (!input.seed.trim() || input.seed.trim().length > 128) return '请填写生成种子，最多128个字符。'
    if (![input.widthMm, input.heightMm].every(value => Number.isSafeInteger(value) && value >= 20000 && value <= 100000)) return '混合地图宽和高须为20–100米，请调整地图尺寸。'
    if (!(Number.isInteger(input.roomCount) && input.roomCount >= 1 && input.roomCount <= 4)) return '房间数量须为1–4的整数，请调整房间数量。'
    if (!input.purpose.trim() || input.purpose.trim().length > 120) return '请填写房间用途，最多120个字符。'
    if (!(Number.isFinite(input.vegetationMultiplier) && input.vegetationMultiplier >= 0 && input.vegetationMultiplier <= 2)) return input.environment === 'forest' ? '植被密度倍率须为0–2，请调整密度倍率。' : '植被密度倍率须为0–2，请切换到「林中建筑」调整密度倍率。'
    return null
  })()
  const valid = validationReason === null
  const feedback = error && <><p className="asset-error" role="alert">{error}</p><p className="asset-muted">请按提示修改参数后重新预览，或选择「取消混合场景」返回当前工程。</p></>
  const cancelAction = <button className="secondary asset-wide" disabled={disabled} onClick={onCancel}>取消混合场景</button>
  return <section className="terrain-generation-panel volcano-generation-panel" aria-label="混合场景生成">
    <h2>混合场景</h2>
    <p>把真实地面、建筑外门和室外路线组合为同一张可编辑地图；森林植被会避开实际建筑和通路。</p>
    <details className="workspace-detail-disclosure workspace-generation-help"><summary>生成与后续编辑说明</summary><p className="asset-muted">首次建议的门、家具和路线保存后可自由删改；不会自动补回。新版在门外预留直入段，沿门面垂直方向接入，并核查完整净宽。当前支持一个建筑与同楼层的森林或火山。</p></details>
    <div hidden={input.environment !== 'forest'}><GenerationParameterAssistant connection={aiConnection} parameters={{ ...assistantParameters, environment: 'forest' }} formRevision={formRevision} disabled={locked || input.environment !== 'forest'} onApply={parameters => { if (!locked) { onChange(); setFormRevision(value => value + 1); setInput(current => ({ ...current, ...parameters })) } }}/></div>
    {dirty && !busy && !candidate && !error && <p className="terrain-generation-notice" role="status">参数已修改，请预览当前设置。当前工程尚未改变。</p>}
    <form onSubmit={event => { event.preventDefault(); if (valid && !locked) void onGenerate({ ...input, title: input.title.trim(), seed: input.seed.trim(), purpose: input.purpose.trim() }) }}>
      <fieldset disabled={locked}><legend>场景与建筑需求</legend>
        <label>工程名称<input aria-label="混合工程名称" value={input.title} maxLength={120} onChange={event => change('title', event.target.value)}/></label>
        <label>室外环境<select aria-label="混合场景环境" value={input.environment} onChange={event => change('environment', event.target.value as MixedGenerationUiRequest['environment'])}><option value="forest">林中建筑</option><option value="volcano">火山平台建筑</option></select></label>
        <label>布置与接路<select aria-label="混合接路算法版本" value={algorithmVersion} onChange={event => change('algorithmVersion', Number(event.target.value) as 2 | 3 | 4)}><option value="4">预留座位与使用空间 · 树木优先</option><option value="3">门前垂直直入 · 第3版</option><option value="2">原版接路 · 第2版</option></select></label>
        <div className="volcano-field-pair"><label>地图宽（米）<input aria-label="混合地图宽米" type="number" min="20" max="100" step="1" value={input.widthMm / 1000} onChange={event => change('widthMm', Math.round(Number(event.target.value) * 1000))}/></label><label>地图高（米）<input aria-label="混合地图高米" type="number" min="20" max="100" step="1" value={input.heightMm / 1000} onChange={event => change('heightMm', Math.round(Number(event.target.value) * 1000))}/></label></div>
        <label>生成种子<input aria-label="混合生成种子" value={input.seed} maxLength={128} onChange={event => change('seed', event.target.value)}/></label>
        <label>房间数量<input aria-label="混合建筑房间数量" type="number" min="1" max="4" step="1" value={input.roomCount} onChange={event => change('roomCount', Number(event.target.value))}/></label>
        <label>房间用途<input aria-label="混合建筑房间用途" value={input.purpose} maxLength={120} onChange={event => change('purpose', event.target.value)}/></label>
        <label className="volcano-check"><input aria-label="混合建筑建议家具" type="checkbox" checked={input.furniture} onChange={event => change('furniture', event.target.checked)}/>按用途和面积建议家具</label>
        {input.environment === 'forest' && <label>植被密度倍率<input aria-label="混合森林密度倍率" type="number" min="0" max="2" step="0.1" value={input.vegetationMultiplier} onChange={event => change('vegetationMultiplier', Number(event.target.value))}/></label>}
        {input.environment === 'forest' && <label>植被分布<select aria-label="混合森林植被分布" value={woodlandDistribution ?? 'uniform'} onChange={event => change('woodlandDistribution', event.target.value as NonNullable<MixedGenerationUiRequest['woodlandDistribution']>)}><option value="uniform">均匀散布</option><option value="copses">疏密林地</option></select></label>}
        {input.environment === 'forest' && woodlandDistribution === 'copses' && <p className="asset-muted">把同一目标数量集中为两片不规则树群及灌草过渡，建筑与通路继续避让。区域不足会说明，实际数量以候选为准。</p>}
        <p className="asset-muted">房间、支撑或足宽接入不成立时会说明冲突，可调整需求后重新预览。</p>
        {!candidate && validationReason && <p id={validationId} className="asset-form-error" role="status">{validationReason}</p>}
        <button className="primary asset-wide" type="submit" disabled={!valid} aria-describedby={!candidate && validationReason ? validationId : undefined}>{busy ? '正在准备混合场景…' : '预览混合场景'}</button>
      </fieldset>
    </form>
    {!candidate && feedback}
    {candidate && <WorkspaceReview><div className="volcano-generation-panel workspace-review-panel">{feedback}<div className="volcano-candidate" aria-label="混合候选摘要"><div className="workspace-review-body"><h3>候选 · {candidate.report.environment === 'forest' ? '林中建筑' : '火山平台建筑'}</h3>
      <p>画布展示完整候选，当前工程尚未改变。</p>
      <p aria-label="混合实际生成结果">实际生成 {candidate.report.roomIds.length} 个房间、{candidate.report.openingIds.length} 处门、{candidate.report.propIds.length} 件物件；建筑在真实地面上，外门接入路线已核查完整净宽。</p>
      {candidate.report.notes.length > 0 && <ul aria-label="混合生成说明">{candidate.report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      </div>
      <div className="workspace-review-actions">
      <button className="primary asset-wide" disabled={busy || disabled} onClick={() => void onAdopt()}>保存混合场景为新工程</button>
        {cancelAction}
      </div>
    </div></div></WorkspaceReview>}
    {!candidate && (dirty || busy) && cancelAction}
  </section>
}
