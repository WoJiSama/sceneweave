import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronRight, Download, Mountain, RefreshCw, Waves, X } from 'lucide-react'
import { TERRAIN_FIXED_SEEDS, type TerrainGenerationInput } from '../../shared/terrain-generation/generate'
import './terrain-generation.css'

export type TerrainGenerationKind = 'island' | 'coast' | 'river' | 'lake' | 'forest' | 'hill' | 'mixed'
export type TerrainGenerationRequest = { seed: string; kind: TerrainGenerationKind; route?: TerrainGenerationInput['route'] }
export const TERRAIN_GENERATION_REVIEW_SEEDS = TERRAIN_FIXED_SEEDS
const KIND_OPTIONS: readonly { value: TerrainGenerationKind; label: string; detail: string }[] = [
  { value: 'island', label: '岩岛', detail: '海湾 · 高台 · 登高通路' },
  { value: 'coast', label: '海岸', detail: '岸线 · 沙滩 · 活动空地' },
  { value: 'river', label: '河谷', detail: '河道 · 浅滩 · 两岸地面' },
  { value: 'lake', label: '内湖', detail: '湖岸 · 高地 · 静水边界' },
  { value: 'forest', label: '森林', detail: '林缘 · 林间空地 · 丘台' },
  { value: 'hill', label: '丘陵', detail: '缓坡 · 高差 · 坡顶活动区' },
  { value: 'mixed', label: '混合', detail: '河谷 · 林地 · 高差连接' },
]

export interface TerrainGenerationCandidateSummary extends TerrainGenerationRequest {
  id: string
  name: string
  widthMm: number
  heightMm: number
  terrainCount: number
  propCount: number
  connectionCount: number
  cost: { total: number; limit?: number; items?: readonly { label: string; value: number }[] }
  checks?: readonly { label: string; status: 'passed' | 'failed' | 'unchecked'; detail?: string }[]
  canAdopt?: boolean
}

export interface TerrainGenerationPanelProps {
  busy: boolean
  error: string | null
  candidate: TerrainGenerationCandidateSummary | null
  onGenerate: (request: TerrainGenerationRequest) => void | Promise<void>
  onAdopt: () => void | Promise<void>
  onCancel: () => void
  onExport?: () => void | Promise<void>
  disabled?: boolean
  disabledReason?: string
}

const checkLabels = { passed: '已满足', failed: '需要调整', unchecked: '尚未检查' } as const
const costLabels: Record<string, string> = {
  physicalAndVisual: '地形、轮廓与布景',
  'generation.recipes': '生成设置',
  'generation.intents': '地貌安排',
  'generation.rules': '生成关系与输出',
  'generation.ownership': '自动结果管理',
  'generation.constraints': '活动区域要求',
  'generation.checks': '要求检查',
}
const aborted = (failure: unknown) => failure instanceof Error && failure.name === 'AbortError'

/** A presentation-only panel. The host owns candidates, resources, adoption and saving. */
export default function TerrainGenerationPanel({
  busy, error, candidate, onGenerate, onAdopt, onCancel, onExport, disabled = false, disabledReason,
}: TerrainGenerationPanelProps) {
  const headingId = useId(), seedHintId = useId(), settingsHintId = useId()
  const [kind, setKind] = useState<TerrainGenerationRequest['kind']>('island')
  const [seed, setSeed] = useState<string>(TERRAIN_GENERATION_REVIEW_SEEDS[0])
  const [routeEnabled, setRouteEnabled] = useState(false)
  const [route, setRoute] = useState<NonNullable<TerrainGenerationInput['route']>>({ from: { x: 3000, y: 13500 }, to: { x: 21000, y: 13500 }, widthMm: 1000, crossing: 'ford' })
  const [pending, setPending] = useState<'generate' | 'adopt' | 'export' | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const operation = useRef(0), running = useRef(false), mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operation.current++ }
  }, [])

  const occupied = busy || pending !== null
  const cleanSeed = seed.trim()
  const validSeed = cleanSeed.length > 0 && cleanSeed.length <= 128
  const supportsRoute = kind !== 'island' && kind !== 'coast'
  const activeRoute = supportsRoute && routeEnabled ? route : undefined
  const validRoute = !activeRoute || [route.from.x, route.from.y, route.to.x, route.to.y, route.widthMm].every(Number.isSafeInteger)
    && route.widthMm >= 400 && route.widthMm <= 3000 && [route.from.x, route.to.x].every(value => value >= 0 && value <= 24000)
    && [route.from.y, route.to.y].every(value => value >= 0 && value <= 18000) && (route.from.x !== route.to.x || route.from.y !== route.to.y)
  const selectedIndex = TERRAIN_GENERATION_REVIEW_SEEDS.findIndex(value => value === cleanSeed)
  const candidateMatches = candidate !== null && candidate.seed === cleanSeed && candidate.kind === kind && JSON.stringify(candidate.route) === JSON.stringify(activeRoute)
  const requestedLimit = candidate?.cost.limit ?? 256
  const costLimit = Number.isSafeInteger(requestedLimit) && requestedLimit >= 0 ? Math.min(requestedLimit, 256) : 0
  const candidateAllowed = candidate !== null && candidate.canAdopt !== false
    && Number.isSafeInteger(candidate.cost.total) && candidate.cost.total >= 0 && candidate.cost.total <= costLimit
    && !candidate.checks?.some(check => check.status !== 'passed')

  const run = async (action: 'generate' | 'adopt' | 'export', perform: () => void | Promise<void>) => {
    if (running.current || busy || disabled) return
    const epoch = ++operation.current
    running.current = true; setPending(action); setLocalError(null)
    try { await perform() }
    catch (failure) {
      if (mounted.current && epoch === operation.current && !aborted(failure)) {
        setLocalError(failure instanceof Error ? failure.message : '本次操作未完成，请重新查看方案。')
      }
    } finally {
      if (epoch === operation.current) {
        running.current = false
        if (mounted.current) setPending(null)
      }
    }
  }
  const generate = (nextSeed = cleanSeed) => {
    if (!nextSeed.trim() || nextSeed.trim().length > 128 || !validRoute) return
    setSeed(nextSeed.trim())
    void run('generate', () => onGenerate({ seed: nextSeed.trim(), kind, ...(activeRoute ? { route: structuredClone(activeRoute) } : {}) }))
  }
  const cancel = () => {
    if (pending === 'adopt' || pending === 'export') return
    operation.current++; running.current = false; setPending(null); setLocalError(null)
    try { onCancel() }
    catch (failure) { setLocalError(failure instanceof Error ? failure.message : '取消未完成，请重试。') }
  }

  return <section className="terrain-generation-panel" aria-labelledby={headingId}>
    <div className="asset-section-heading terrain-generation-heading">
      <Mountain size={17} aria-hidden="true"/>
      <h2 id={headingId}>生成自然地形</h2>
    </div>
    <p className="terrain-generation-intro">从岸线、河湖、森林或丘陵开始，保留高差与活动空地，生成后继续编辑。</p>
    <form aria-label="地形生成设置" aria-busy={occupied} onSubmit={event => { event.preventDefault(); if (validSeed) generate() }}>
      <fieldset disabled={disabled || occupied}>
        <legend>地形类型</legend>
        <div className="terrain-generation-kinds" role="group" aria-label="地形类型">
          {KIND_OPTIONS.map(option => <button key={option.value} type="button" aria-label={`选择${option.label}地形`} aria-pressed={kind === option.value}
            onClick={() => { setKind(option.value); setLocalError(null) }}>
            {option.value === 'coast' || option.value === 'river' || option.value === 'lake' ? <Waves size={17} aria-hidden="true"/> : <Mountain size={17} aria-hidden="true"/>}
            <span>{option.label}<small>{option.detail}</small></span>
          </button>)}
        </div>
        {supportsRoute && <div className="terrain-generation-route">
          <label className="terrain-route-toggle"><input type="checkbox" aria-label="生成指定路线" checked={routeEnabled} onChange={event => setRouteEnabled(event.target.checked)}/>生成指定路线</label>
          {routeEnabled && <>
            <small>输入整数毫米坐标。先寻找可行路线，再检查道路转角和完整净宽；找不到时保留当前工程。</small>
            {(['from', 'to'] as const).map(endpoint => <div className="terrain-route-point" key={endpoint}><span>{endpoint === 'from' ? '起点' : '终点'}</span>{(['x', 'y'] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" step="100" min="0" max={axis === 'x' ? 24000 : 18000} aria-label={`路线${endpoint === 'from' ? '起点' : '终点'}${axis.toUpperCase()}`} value={route[endpoint][axis]} onChange={event => setRoute(value => ({ ...value, [endpoint]: { ...value[endpoint], [axis]: Number(event.target.value) } }))}/></label>)}</div>)}
            <label>通行净宽（毫米）<input type="number" step="100" min="400" max="3000" aria-label="路线净宽" value={route.widthMm} onChange={event => setRoute(value => ({ ...value, widthMm: Number(event.target.value) }))}/></label>
            <label>渡水方式<select aria-label="路线渡水方式" value={route.crossing} onChange={event => setRoute(value => ({ ...value, crossing: event.target.value as typeof route.crossing }))}><option value="ground">只走地面</option><option value="ford">允许真实浅滩</option><option value="bridge">需要桥梁（当前未支持）</option></select></label>
            {!validRoute && <p className="terrain-generation-notice">请填写范围内的不同整数端点和400–3000毫米净宽。</p>}
          </>}
        </div>}
        <label className="terrain-generation-seed">方案种子
          <input aria-label="地形方案种子" aria-describedby={seedHintId} autoComplete="off" spellCheck={false} value={seed} maxLength={128}
            onChange={event => { setSeed(event.target.value); setLocalError(null) }}/>
        </label>
        <small id={seedHintId} className="terrain-generation-hint">相同素材和设置下，使用同一种子可重现构图。</small>
        <button className="primary terrain-generation-submit" type="submit" disabled={!validSeed || !validRoute} aria-label="生成地形预览">
          <RefreshCw size={14} aria-hidden="true"/>生成预览
        </button>
      </fieldset>
    </form>

    <details className="terrain-generation-series">
      <summary>对比五份固定方案</summary>
      <p>逐份生成并查看构图，可导出当前方案后继续比较。</p>
      <div className="terrain-generation-seeds" role="group" aria-label="五份固定地形方案">
        {TERRAIN_GENERATION_REVIEW_SEEDS.map((value, index) => <button key={value} type="button" aria-label={`生成第 ${index + 1} 份固定地形方案`}
          aria-pressed={cleanSeed === value} disabled={disabled || occupied} onClick={() => generate(value)}>{index + 1}</button>)}
      </div>
      {selectedIndex >= 0 && selectedIndex < TERRAIN_GENERATION_REVIEW_SEEDS.length - 1 && <button className="secondary terrain-generation-next" type="button"
        disabled={disabled || occupied} aria-label={`生成下一份固定地形方案 ${selectedIndex + 2}`} onClick={() => generate(TERRAIN_GENERATION_REVIEW_SEEDS[selectedIndex + 1])}>
        查看下一份<ChevronRight size={14} aria-hidden="true"/>
      </button>}
    </details>

    {occupied && <div className="terrain-generation-progress" role="status">
      <span>{pending === 'adopt' ? '正在采用方案…' : pending === 'export' ? '正在准备导出…' : '正在生成地形预览…'}</span>
      {pending !== 'adopt' && pending !== 'export' && <button type="button" className="secondary" aria-label="取消地形生成" onClick={cancel}><X size={13} aria-hidden="true"/>取消</button>}
    </div>}
    {disabled && disabledReason && <p className="terrain-generation-notice" role="status">{disabledReason}</p>}
    {(localError || error) && <p className="asset-form-error terrain-generation-error" role="alert">{localError || error}</p>}

    {candidate && <article className="terrain-generation-candidate" aria-label="当前地形候选">
      <div className="terrain-generation-candidate-heading"><span>当前预览</span><strong>{candidate.name}</strong></div>
      <p className="terrain-generation-candidate-seed">{KIND_OPTIONS.find(option => option.value === candidate.kind)?.label ?? candidate.kind} · {candidate.seed}</p>
      <dl className="terrain-generation-facts">
        <div><dt>场景大小</dt><dd>{candidate.widthMm / 1000} × {candidate.heightMm / 1000} 米</dd></div>
        <div><dt>地形分区</dt><dd>{candidate.terrainCount}</dd></div>
        <div><dt>树石物件</dt><dd>{candidate.propCount}</dd></div>
        <div><dt>高差连接</dt><dd>{candidate.connectionCount}</dd></div>
      </dl>
      {!!candidate.checks?.length && <ul className="terrain-generation-checks" aria-label="地形要求检查">{candidate.checks.map((check, index) =>
        <li key={`${check.label}-${index}`} data-status={check.status}><span>{check.label}</span><strong>{checkLabels[check.status]}</strong>{check.detail && <small>{check.detail}</small>}</li>,
      )}</ul>}
      <details className="terrain-generation-cost"><summary>制作明细</summary>
        <dl><div><dt>本次编辑量</dt><dd>{candidate.cost.total} / {costLimit}</dd></div>{candidate.cost.items?.map((item, index) =>
          <div key={`${item.label}-${index}`}><dt>{costLabels[item.label] ?? '其他内容'}</dt><dd>{item.value}</dd></div>,
        )}</dl>
      </details>
      {!candidateMatches && <p className="terrain-generation-notice" id={settingsHintId}>设置已改变，请重新生成后采用。</p>}
      {candidateMatches && !candidateAllowed && <p className="terrain-generation-notice" id={settingsHintId}>此方案仍有未解决的检查项，暂时不能采用。</p>}
      <div className="terrain-generation-actions">
        <button className="primary" type="button" disabled={disabled || occupied || !candidateMatches || !candidateAllowed}
          aria-describedby={!candidateMatches || !candidateAllowed ? settingsHintId : undefined} aria-label="采用当前地形方案" onClick={() => void run('adopt', onAdopt)}><Check size={14} aria-hidden="true"/>采用此方案</button>
        {onExport && <button className="secondary" type="button" disabled={disabled || occupied} aria-label="导出当前地形候选" onClick={() => void run('export', onExport)}><Download size={14} aria-hidden="true"/>导出候选</button>}
        <button className="secondary" type="button" disabled={occupied} aria-label="取消当前地形候选" onClick={cancel}>取消预览</button>
      </div>
    </article>}
  </section>
}
