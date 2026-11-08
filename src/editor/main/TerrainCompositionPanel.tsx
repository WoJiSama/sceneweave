import { WorkspaceReview } from '../workspace/WorkspacePresentation'
import { useEffect, useId, useRef, useState } from 'react'
import type { CompositionPresetInput } from '../../shared/terrain-generation/composition-presets'
import type { TerrainPreview } from '../../application/workspace/terrain'
export default function TerrainCompositionPanel({ busy, disabled = false, disabledReason, error, candidate, onGenerate, onAdopt, onCancel, onExport }: {
  busy: boolean; disabled?: boolean; disabledReason?: string | null; error?: string | null; candidate: TerrainPreview | null
  onGenerate: (input: Omit<CompositionPresetInput, 'sceneId'>) => Promise<void>
  onAdopt: () => Promise<void>; onCancel: () => void; onExport: () => Promise<void>
}) {
  const [preset, setPreset] = useState<CompositionPresetInput['preset']>('archipelago'), [seed, setSeed] = useState('terrain-compose-0'), [count, setCount] = useState(3)
  const [pending, setPending] = useState<'generate' | 'adopt' | 'export' | null>(null), [localError, setLocalError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const failureRef = useRef<HTMLDivElement | null>(null)
  const operation = useRef(0), running = useRef(false), noticeId = useId()
  const active = candidate?.composition, occupied = busy || pending !== null
  const failure = localError || error
  useEffect(() => {
    const feedback = failureRef.current
    if (failure && !occupied && feedback && !feedback.closest('[hidden]')) feedback.scrollIntoView({ block: 'nearest' })
  }, [failure, occupied])
  const cleanSeed = seed.trim(), validSeed = cleanSeed.length > 0 && cleanSeed.length <= 128
  const matches = !!active && active.preset === preset && active.seed === cleanSeed && active.islandCount === count
  const checks = candidate?.project.document.generation?.version === 5 ? Object.values(candidate.project.document.generation.checks) : []
  const run = async (kind: 'generate' | 'adopt' | 'export', action: () => Promise<void>) => {
    if (occupied || disabled || running.current) return
    const epoch = ++operation.current
    running.current = true; setPending(kind); setLocalError(null); setNotice(null)
    try { await action() }
    catch (failure) { if (epoch === operation.current) setLocalError(failure instanceof Error ? failure.message : '本次操作未完成，请重新预览。') }
    finally { if (epoch === operation.current) { running.current = false; setPending(null) } }
  }
  const cancel = () => {
    if (pending === 'adopt' || pending === 'export') return
    const generating = pending === 'generate' || busy
    operation.current++; running.current = false; setPending(null); setLocalError(null)
    try { onCancel(); setNotice(generating ? '已取消地貌组合生成，当前工程未改变。' : '已取消组合预览，当前工程未改变。') }
    catch (failure) { setLocalError(failure instanceof Error ? failure.message : '取消未完成，请重试。') }
  }
  const feedback = <>
    {occupied && <div className="terrain-generation-progress" role="status" aria-label="地貌组合处理状态">
      <span>{pending === 'adopt' ? '正在保存地貌组合…' : pending === 'export' ? '正在导出组合候选…' : '正在生成地貌组合预览…'}</span>
      {!candidate && pending !== 'adopt' && pending !== 'export' && <button className="secondary" type="button" onClick={cancel}>取消地貌组合生成</button>}
    </div>}
    {disabled && disabledReason && <p className="terrain-generation-notice" role="status">{disabledReason}</p>}
    {notice && !occupied && !localError && !error && <p className="terrain-generation-notice" role="status" aria-label="地貌组合操作结果">{notice}</p>}
    {failure && <div ref={failureRef}><p className="asset-form-error terrain-generation-error" role="alert">{failure}</p><p className="asset-muted">本次操作未完成，未自动重试。可按提示调整参数后点击「重新预览地貌组合」，或取消组合预览继续编辑当前工程。</p>{!candidate && !occupied && <button className="secondary" disabled={disabled} onClick={cancel}>取消组合预览</button>}</div>}
  </>
  return <section className="terrain-generation-panel" aria-label="通用地貌组合">
    <h2 className="terrain-generation-heading">通用地貌组合</h2>
    <p className="terrain-generation-intro">从群岛、森林河谷或草岩丘陵开始。先检查真实分量与水道，再保存为独立工程。</p>
    <form onSubmit={event => { event.preventDefault(); if (validSeed) void run('generate', () => onGenerate({ preset, seed: cleanSeed, widthMm: 48000, heightMm: 36000, islandCount: count })) }}>
      <fieldset disabled={occupied || disabled}>
        <label className="terrain-generation-size">地貌组合<select aria-label="地貌组合类型" value={preset} onChange={event => setPreset(event.target.value as CompositionPresetInput['preset'])}><option value="archipelago">群岛海岸</option><option value="forestValley">森林河谷</option><option value="grassRidge">草岩丘陵</option><option value="tidalCoast">浅湾台地</option></select></label>
        <label className="terrain-generation-seed">组合种子<input aria-label="组合种子" value={seed} maxLength={128} onChange={event => setSeed(event.target.value)}/></label>
        {preset === 'archipelago' && <label className="terrain-generation-size">岛屿数量<select aria-label="组合岛屿数量" value={count} onChange={event => setCount(Number(event.target.value))}><option value={2}>2</option><option value={3}>3</option></select></label>}
        <small className="terrain-generation-hint">48 × 36 米。保存完整轮廓、高程、冻结阈值和身份；超过编辑量上限的方案会拒绝。</small>
        {!validSeed && <p className="terrain-generation-notice" role="status">请填写组合种子，最多128个字符。</p>}
        <button className="primary terrain-generation-submit" type="submit" disabled={!validSeed}>{failure ? '重新预览地貌组合' : '预览地貌组合'}</button>
      </fieldset>
    </form>
    {!candidate && feedback}

    {active && candidate && <WorkspaceReview><div className="terrain-generation-panel workspace-review-panel">{feedback}<article className="terrain-generation-candidate" aria-label="地貌组合候选">
      <div className="workspace-review-body">
      <h3>{candidate.project.document.title}</h3>
      <p>画布展示当前候选，原工程尚未改变。确认后保存并打开独立新工程。</p>
      <p>{Object.keys(candidate.project.document.terrainAreas).length} 个真实地形面 · {candidate.baseMap?.version === 3 ? '编辑目标' : '展开'} {candidate.cost.total}/{candidate.baseMap?.operationLimit ?? 256}</p>
      <p>{checks.filter(check => check.state === 'passed').length}/{checks.length} 个硬要求通过</p>
      {!matches && <p className="terrain-generation-notice" id={noticeId} role="status">设置已改变，画布仍显示上次候选。请重新预览后再保存为新工程。</p>}
      </div>
      <div className="terrain-generation-actions workspace-review-actions">
        <button className="primary" disabled={disabled || occupied || !matches} aria-describedby={!matches ? noticeId : undefined} onClick={() => void run('adopt', onAdopt)}>采用地貌组合</button>
        <button className="secondary" disabled={disabled || occupied} onClick={() => void run('export', onExport)}>导出组合候选</button>
        <button className="secondary" disabled={occupied || disabled} onClick={cancel}>取消组合预览</button>
      </div>
    </article></div></WorkspaceReview>}
  </section>
}
