import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import type { ImagePixels } from '../../shared/image-import/pixels'
import type { VectorRefinementOptions } from '../../shared/asset-refinement/vector'
import { parseVectorStructurePlan, type VectorStructurePlan } from '../../shared/asset-refinement/structure-plan'
import type { ImageEditCapabilities } from '../../shared/asset-refinement/model-protocol'
import { inspectImageEnhancementTarget, readImageEnhancementSource, type ImageEnhancementSource, type ImageEnhancementTarget } from '../../platform/browser/content/image-enhancement'
import { generateVectorRefinementCandidate, generateStructuredVectorCandidate, generateModelRefinementCandidate, type ImageRefinementCandidate } from '../../platform/browser/content/image-refinement'
import { getImageEditCapabilities, ImageEditClientError, type ImageEditRequestStateEvent } from '../../platform/browser/content/image-refinement-model'
import './image-refinement-panel.css'

export interface ImageRefinementUnknownRequest { id: string; service: string; state: ImageEditRequestStateEvent['state'] }
export interface ImageRefinementPanelProps {
  project: EditableProject
  target: ImageEnhancementTarget
  disabled: boolean
  onPreview: (source: ImageEnhancementSource, candidate: ImageRefinementCandidate, signal?: AbortSignal) => Promise<void>
  onPendingChange?: (pending: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
  previewContext?: 'scene' | 'asset'
  unknownRequests?: readonly ImageRefinementUnknownRequest[]
  onUnknownRequest?: (request: ImageRefinementUnknownRequest) => void
}

type Route = 'structure' | 'vector' | 'model'
type Basis = ImageEnhancementSource['basis']
type Result = { source: ImageEnhancementSource; candidate: ImageRefinementCandidate; options?: VectorRefinementOptions; planText?: string; prompt?: string }
type Operation = 'load' | 'structure' | 'vector' | 'capabilities' | 'model' | 'preview'
const defaultOptions: VectorRefinementOptions = { colors: 24, curveTolerancePx: .45 }
const sameOptions = (a: VectorRefinementOptions, b: VectorRefinementOptions) => a.colors === b.colors && a.curveTolerancePx === b.curveTolerancePx
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '精修未完成，请检查输入。'

/** Both images share the source coordinate frame, without stretching returned pixels. */
function PixelCanvas({ pixels, source, zoom, label }: { pixels: ImagePixels; source: ImagePixels; zoom: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = pixels.width; canvas.height = pixels.height
    const context = canvas.getContext('2d')!
    const image = context.createImageData(pixels.width, pixels.height)
    image.data.set(pixels.data); context.putImageData(image, 0, 0)
  }, [pixels])
  return <div className="image-refinement-raster" style={{ width: zoom === 'fit' ? '100%' : source.width * Number(zoom) / 100, aspectRatio: `${source.width} / ${source.height}` }}><canvas ref={ref} aria-label={label}/></div>
}

/** Local review drafts only. The host owns protected adoption and final persistence. */
export default function ImageRefinementPanel({ project, target, disabled, onPreview, onPendingChange, onDirtyChange, previewContext = 'scene', unknownRequests: retainedUnknownRequests, onUnknownRequest }: ImageRefinementPanelProps) {
  const [route, setRoute] = useState<Route>('structure'), [vectorRoute, setVectorRoute] = useState<'structure' | 'vector'>('structure'), [basis, setBasis] = useState<Basis>('original')
  const [planText, setPlanText] = useState('')
  const [source, setSource] = useState<ImageEnhancementSource | null>(null)
  const [options, setOptions] = useState<VectorRefinementOptions>(defaultOptions)
  const [prompt, setPrompt] = useState(''), [baseUrl, setBaseUrl] = useState(''), [token, setToken] = useState('')
  const [capability, setCapability] = useState<{ baseUrl: string; token: string; value: ImageEditCapabilities } | null>(null)
  const [consent, setConsent] = useState(false), [results, setResults] = useState<Partial<Record<Route, Result>>>({})
  const [localUnknownRequests, setLocalUnknownRequests] = useState<ImageRefinementUnknownRequest[]>([])
  const unknownRequests = retainedUnknownRequests ?? localUnknownRequests
  const [pending, setPending] = useState<Operation | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [reload, setReload] = useState<Basis | null>(null), [background, setBackground] = useState('checker'), [zoom, setZoom] = useState('fit')
  const [svgUrl, setSvgUrl] = useState('')
  const operation = useRef<AbortController | null>(null), epoch = useRef(0), mounted = useRef(false)
  const sourceViewport = useRef<HTMLDivElement>(null), candidateViewport = useRef<HTMLDivElement>(null)
  const info = useMemo(() => inspectImageEnhancementTarget(project, target), [project, target.kind, target.id])
  const latest = useRef({ project, target, info }); latest.current = { project, target, info }
  const pendingCallback = useRef(onPendingChange), dirtyCallback = useRef(onDirtyChange)
  pendingCallback.current = onPendingChange; dirtyCallback.current = onDirtyChange
  const unknownRequestCallback = useRef(onUnknownRequest); unknownRequestCallback.current = onUnknownRequest
  const result = results[route], stale = !!source && (!info || info.baseline !== source.baseline)
  const sourcePixels = source?.canonicalPixels ?? source?.pixels
  const currentRefinement = info ? project.document.assets[info.assetId]?.imageRefinement : undefined
  const savedPlan = currentRefinement?.kind === 'vector' && currentRefinement.algorithm === 'structure-plan-v1' ? currentRefinement.plan : undefined
  const editing = disabled || pending !== null
  const dirty = !!results.structure || !!results.vector || !!results.model || !!planText.trim() || !!prompt.trim() || !sameOptions(options, defaultOptions)
  const parametersChanged = !!result && (route === 'structure' ? result.planText !== planText : route === 'vector' ? !result.options || !sameOptions(result.options, options) : result.prompt !== prompt.trim())
  const parsedPlan = useMemo((): { plan?: VectorStructurePlan; error?: string } => {
    if (!planText.trim()) return {}
    try {
      if (new TextEncoder().encode(planText).length > 1_048_576) throw new Error('结构稿超过1 MiB。')
      return { plan: parseVectorStructurePlan(JSON.parse(planText)) }
    } catch (reason) { return { error: errorMessage(reason) } }
  }, [planText])
  const connected = capability && capability.baseUrl === baseUrl && capability.token === token ? capability.value : null
  const promptValid = prompt.trim().length > 0 && prompt.trim().length <= 2000 && new TextEncoder().encode(prompt.trim()).length <= 8192
  const candidateStale = !!result && (!source || result.source !== source || stale)

  useEffect(() => { pendingCallback.current?.(pending !== null) }, [pending])
  useEffect(() => { dirtyCallback.current?.(dirty) }, [dirty])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pendingCallback.current?.(false); dirtyCallback.current?.(false) } }, [])
  useEffect(() => {
    if (!result?.candidate.sourceSvg) { setSvgUrl(''); return }
    const url = URL.createObjectURL(new Blob([result.candidate.sourceSvg], { type: 'image/svg+xml' }))
    setSvgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result?.candidate.sourceSvg])
  useEffect(() => { setConsent(false) }, [source, baseUrl, token, prompt, stale])

  const stop = () => {
    epoch.current++; operation.current?.abort(); operation.current = null; setPending(null); setConsent(false)
  }
  const load = async (nextBasis: Basis) => {
    stop()
    const controller = new AbortController(), stamp = ++epoch.current, captured = latest.current
    operation.current = controller; setPending('load'); setError(''); setNotice(''); setSource(null); setResults({}); setBasis(nextBasis); setReload(null)
    try {
      const value = await readImageEnhancementSource(captured.project, captured.target, nextBasis, controller.signal)
      if (!controller.signal.aborted && stamp === epoch.current) setSource(value)
    } catch (reason) { if (!controller.signal.aborted && stamp === epoch.current) setError(errorMessage(reason)) }
    finally { if (stamp === epoch.current) { operation.current = null; setPending(null) } }
  }
  useEffect(() => {
    void load('original')
    return () => { epoch.current++; operation.current?.abort(); operation.current = null }
  }, [target.kind, target.id])
  // A target edit may happen while the request is in flight. Never publish its result into a newer baseline.
  useEffect(() => {
    if (!stale) return
    setConsent(false)
    if (operation.current && pending !== 'load') {
      const wasModel = pending === 'model'; stop()
      setNotice(wasModel ? '素材基线已变化，已停止等待。服务可能仍在处理或计费；不会自动重发。' : '素材基线已变化，已停止当前精修；请重新读取。')
    }
  }, [stale])

  const checkConnection = async () => {
    if (disabled || operation.current || !baseUrl.trim() || !token.trim()) return
    const controller = new AbortController(), stamp = ++epoch.current, connection = { baseUrl, token }
    operation.current = controller; setPending('capabilities'); setError(''); setNotice(''); setCapability(null); setConsent(false)
    try {
      const value = await getImageEditCapabilities(connection, controller.signal)
      if (controller.signal.aborted || stamp !== epoch.current) return
      setCapability({ ...connection, value })
      setNotice(value.available ? '服务支持图片补画。检查连接没有上传图片，生成前请确认下方发送范围。' : '此应用服务尚未配置图片补画模型，请在服务端配置后重新检查。')
    } catch (reason) { if (!controller.signal.aborted && stamp === epoch.current) setError(errorMessage(reason)) }
    finally { if (stamp === epoch.current) { operation.current = null; setPending(null) } }
  }
  const generate = async () => {
    if (!source || stale || disabled || operation.current) return
    if (route === 'model' && (!connected?.available || !consent || !promptValid)) return
    const controller = new AbortController(), stamp = ++epoch.current, capturedSource = source, capturedRoute = route
    if (route === 'structure' && !parsedPlan.plan) return
    const capturedOptions = { ...options }, capturedPrompt = prompt.trim(), capturedPlanText = planText
    const rememberRequest = (event: ImageEditRequestStateEvent) => {
      const request = { id: event.clientRequestId, service: baseUrl, state: event.state }
      if (unknownRequestCallback.current) unknownRequestCallback.current(request)
      else if (mounted.current) setLocalUnknownRequests(current => {
        const index = current.findIndex(value => value.id === request.id && value.service === request.service)
        return index < 0 ? [...current, request] : current.map((value, at) => at === index ? request : value)
      })
    }
    operation.current = controller; setPending(route); setError(''); setNotice(''); setConsent(false)
    try {
      const candidate = capturedRoute === 'structure'
        ? await generateStructuredVectorCandidate(capturedSource, parsedPlan.plan, controller.signal)
        : capturedRoute === 'vector'
        ? await generateVectorRefinementCandidate(capturedSource, capturedOptions, controller.signal)
        : await generateModelRefinementCandidate(capturedSource, { baseUrl, token }, capturedPrompt, controller.signal, undefined, rememberRequest)
      if (controller.signal.aborted || stamp !== epoch.current) return
      if (latest.current.info?.baseline !== capturedSource.baseline) throw new Error('素材已经修改，本次结果不能采用。请重新读取精修基线。')
      setResults(current => ({ ...current, [capturedRoute]: { source: capturedSource, candidate, ...(capturedRoute === 'structure' ? { planText: capturedPlanText } : capturedRoute === 'vector' ? { options: capturedOptions } : { prompt: capturedPrompt }) } }))
      setNotice(capturedRoute === 'structure' ? '已按结构稿重绘。轮廓与透明区域可以变化；请核对造型、推断细节与黑白底边缘，尚未修改素材。' : capturedRoute === 'vector' ? '像素描摹候选已生成。它会保留原图的模糊与杂边，请勿将其当作精细重绘。' : '模型候选已返回。补画可能改变轮廓与细节，请逐项对照；尚未修改素材。')
    } catch (reason) {
      if (capturedRoute === 'model' && reason instanceof ImageEditClientError && reason.requestState !== 'not_sent' && reason.clientRequestId) {
        rememberRequest({ clientRequestId: reason.clientRequestId, state: reason.requestState })
      }
      if (!controller.signal.aborted && stamp === epoch.current) {
        setError(errorMessage(reason)); if (capturedRoute === 'model') setNotice('本次不会自动重发。若请求已发出，费用和服务处理状态以应用服务记录为准；请先核对。')
      }
    } finally { if (stamp === epoch.current) { operation.current = null; setPending(null) } }
  }
  const preview = async () => {
    if (!result || candidateStale || parametersChanged || disabled || operation.current) return
    const controller = new AbortController(), stamp = ++epoch.current
    operation.current = controller; setPending('preview'); setError('')
    try {
      await onPreview(result.source, result.candidate, controller.signal)
      if (!controller.signal.aborted && stamp === epoch.current) setNotice(previewContext === 'asset' ? '候选已放入编辑草稿，保存个人素材副本后才持久化。' : '候选已送到场景审阅，请在场景中采用或取消。')
    } catch (reason) { if (!controller.signal.aborted && stamp === epoch.current) setError(errorMessage(reason)) }
    finally { if (stamp === epoch.current) { operation.current = null; setPending(null) } }
  }
  const requestLoad = (nextBasis: Basis) => { if (results.structure || results.vector || results.model) setReload(nextBasis); else void load(nextBasis) }
  const syncScroll = (from: HTMLDivElement, to: HTMLDivElement | null) => {
    if (!to) return
    if (Math.abs(to.scrollLeft - from.scrollLeft) > 1) to.scrollLeft = from.scrollLeft
    if (Math.abs(to.scrollTop - from.scrollTop) > 1) to.scrollTop = from.scrollTop
  }

  return <section className="image-refinement-panel" aria-label="素材图像精修">
    <header><h3>进一步精修</h3><p>从保留原图重建或补画；原件、占地和场景通行规则继续保留。</p></header>
    <div role="group" aria-label="素材精修路线" className="image-refinement-routes"><button type="button" aria-label="矢量重建" aria-pressed={route !== 'model'} onClick={() => { setRoute(vectorRoute); setError(''); setNotice('') }}>矢量重建{(results.structure || results.vector) && <small>有候选</small>}</button><button type="button" aria-label="模型补画" aria-pressed={route === 'model'} onClick={() => { setRoute('model'); setError(''); setNotice('') }}>模型补画{results.model && <small>有候选</small>}</button></div>
    <div className="image-refinement-baseline"><label>精修依据<select aria-label="精修图像依据" disabled={editing} value={basis} onChange={event => requestLoad(event.target.value as Basis)}><option value="original">保留原图</option><option value="current">当前结果</option>{savedPlan && <option value="savedStructure">已保存结构稿来源</option>}</select></label><button type="button" disabled={editing} onClick={() => requestLoad(basis)}>重新读取精修基线</button></div>
    {stale && <p role="status" className="image-refinement-warning">此素材已修改，旧候选仅供对照。重新读取后才能生成或采用。</p>}
    {reload && <div role="alertdialog" aria-label="重新读取精修基线确认" className="image-refinement-warning"><p>重新读取将丢弃两条路线的现有候选，参数和补画要求保留。</p><button type="button" disabled={editing} onClick={() => void load(reload)}>丢弃候选并重新读取</button><button type="button" onClick={() => setReload(null)}>保留当前候选</button></div>}
    {pending && <div role="status" className="image-refinement-progress"><span>{pending === 'load' ? '正在读取精修原图…' : pending === 'capabilities' ? '正在检查补画服务…' : pending === 'structure' ? '正在按结构稿重绘…' : pending === 'vector' ? '正在描摹像素…' : pending === 'model' ? '已开始一次补画请求，正在等待服务…' : '正在准备精修候选…'}</span><button type="button" onClick={() => { const model = pending === 'model'; stop(); setNotice(model ? '已停止等待。服务可能仍在处理或计费；结果未确认，不会自动重发。' : '已取消本次精修处理。') }}>取消精修处理</button></div>}
    {error && <p role="alert" className="image-refinement-error">{error}</p>}
    <div hidden={route === 'model'}>
      <p className="image-refinement-hint">无需图片编辑模型、服务地址或访问凭据。结构重绘依据视觉分析后的曲线、色面与重复细节重新画图；像素描摹只转换现有像素，不补出结构。</p>
      <label className="image-refinement-method">SVG 重建方式<select aria-label="SVG重建方式" disabled={editing} value={vectorRoute} onChange={event => { const next = event.target.value as 'structure' | 'vector'; setVectorRoute(next); setRoute(next); setError(''); setNotice('') }}><option value="structure">结构重绘</option><option value="vector">像素描摹（保留原图缺陷）</option></select></label>
      <div hidden={route !== 'structure'} className="image-refinement-structure">
        <p className="image-refinement-hint">载入已分析的结构稿，在本机重画轮廓、描边和细节。当前需要人工或视觉助手提供结构稿，尚未自动识别图片。原图保留，推断部分单独列出。</p>
        <label>载入结构稿<input aria-label="载入SVG结构稿" type="file" accept=".json,application/json" disabled={editing || stale || !source} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
          try { if (file.size > 1_048_576) throw new Error('结构稿超过1 MiB。'); setPlanText(await file.text()); setError(''); setNotice('结构稿已载入，请审阅后生成。') } catch (reason) { setError(errorMessage(reason)) }
        }}/></label>
        {savedPlan && <button type="button" disabled={editing || stale || !source || savedPlan.source.sha256 !== source.sourceSha256} onClick={() => { setPlanText(JSON.stringify(savedPlan, null, 2)); setError(''); setNotice('已读取此素材保存的结构稿，可继续编辑后重新生成。') }}>读取已保存结构稿</button>}
        {savedPlan && source && savedPlan.source.sha256 !== source.sourceSha256 && <p className="image-refinement-hint">继续编辑此稿，请先将精修依据切换为「已保存结构稿来源」。</p>}
        {parsedPlan.error && <p role="alert" className="image-refinement-error">{parsedPlan.error}</p>}
        {parsedPlan.plan && <div className="image-refinement-structure-review" aria-label="结构稿审阅"><p>{parsedPlan.plan.summary}</p><p>{parsedPlan.plan.elements.filter(e => e.evidence === 'observed').length} 项依据原图 · {parsedPlan.plan.elements.filter(e => e.evidence === 'inferred').length} 项含推断</p><details><summary>查看重绘部件与推断</summary><ul>{parsedPlan.plan.elements.map(element => <li key={element.id}><strong>{element.name}</strong> · {element.evidence === 'observed' ? '依据原图' : '含推断'}<p>{element.reason}</p></li>)}</ul></details></div>}
        <details className="image-refinement-plan-source"><summary>结构稿与来源</summary>{source && sourcePixels && <p>来源 {sourcePixels.width} × {sourcePixels.height} px · <code>{source.sourceSha256}</code></p>}<textarea aria-label="SVG结构稿源码" rows={7} value={planText} maxLength={1_048_576} disabled={editing || stale} onChange={event => setPlanText(event.target.value)} spellCheck={false}/></details>
        <button type="button" className="primary" disabled={!source || !parsedPlan.plan || editing || stale} onClick={() => void generate()}>生成结构重绘候选</button>
      </div>
      <div hidden={route !== 'vector'}>
      <fieldset disabled={editing || stale} className="image-refinement-vector-settings"><legend>矢量重建参数</legend><label>颜色数量<input aria-label="矢量颜色数量" type="number" min={8} max={48} step={1} value={options.colors} onChange={event => setOptions({ ...options, colors: Math.max(8, Math.min(48, Math.round(Number(event.target.value) || 8))) })}/></label><label>曲线容差（原图像素）<input aria-label="矢量曲线容差" type="number" min={0} max={.49} step={.01} value={options.curveTolerancePx} onChange={event => setOptions({ ...options, curveTolerancePx: Math.max(0, Math.min(.49, Number(event.target.value) || 0)) })}/></label><p>容差 0 保留源网格折线。容差增大允许有限拟合，不保证每个细节都适合曲线。</p></fieldset>
      <button type="button" className="primary" disabled={!source || editing || stale} onClick={() => void generate()}>生成矢量候选</button>
      </div>
    </div>
    <div hidden={route !== 'model'}>
      <p className="image-refinement-hint">由已配置的应用服务调用图片模型。服务未配置时不生成候选，也不会用本地示例替代模型结果。</p>
      <fieldset disabled={editing} className="image-refinement-connection"><legend>补画应用服务</legend><label>应用服务地址<input aria-label="补画应用服务地址" type="url" value={baseUrl} autoComplete="off" spellCheck={false} placeholder="https://ai.example.com" onChange={event => { setBaseUrl(event.target.value); setCapability(null); setConsent(false) }}/></label><label>应用访问凭据<input aria-label="补画应用访问凭据" type="password" value={token} maxLength={4096} autoComplete="off" spellCheck={false} onChange={event => { setToken(event.target.value); setCapability(null); setConsent(false) }}/></label><p>填写此应用服务的访问凭据。供应商密钥由服务端管理；地址和访问凭据仅保存在当前编辑器内存中。</p><div className="image-refinement-connection-actions"><button type="button" disabled={editing || !baseUrl.trim() || !token.trim()} onClick={() => void checkConnection()}>检查补画服务</button><button type="button" disabled={editing || !baseUrl && !token} onClick={() => { setBaseUrl(''); setToken(''); setCapability(null); setConsent(false) }}>清除补画连接</button></div></fieldset>
      {connected && <p role="status" className="image-refinement-hint">{connected.available ? `补画服务可用 · ${connected.model ?? '模型由服务配置'}` : '此服务未配置可用的图片补画模型，请联系应用服务维护者完成配置。'}</p>}
      {!!unknownRequests.length && <div className="image-refinement-warning" aria-label="补画请求记录"><p>请求记录在本次编辑中保留。取消等待或拒绝候选不会撤销已发出的模型处理与费用；再次生成前请先核对。</p>{(['unknown', 'finished', 'not_sent'] as const).map(state => <div key={state} aria-label={state === 'unknown' ? '结果未确认的补画请求' : state === 'finished' ? '已完成的补画请求' : '未发送到模型的补画请求'}><ul>{unknownRequests.filter(request => request.state === state).map(request => <li key={`${request.service}:${request.id}`}>{state === 'unknown' ? '结果未确认' : state === 'finished' ? '服务已返回' : '服务拒绝，未发送到模型'} · {request.service} · <code>{request.id}</code></li>)}</ul></div>)}</div>}
      <label className="image-refinement-prompt">补画要求<textarea aria-label="模型补画要求" rows={4} value={prompt} maxLength={2000} disabled={editing || stale} placeholder="说明要保留的轮廓、描边、材质与需要补足的部分。" onChange={event => { setPrompt(event.target.value); setConsent(false) }}/></label>
      <p className="image-refinement-hint">最多 2000 字符、UTF-8 8 KiB。请检查返回图是否改变形状、孔洞、材质或阴影；补画内容需要人工审阅。</p>
      <div className="image-refinement-consent"><p>点击生成将把当前精修依据的完整图片与补画要求上传至 <strong>{baseUrl || '尚未填写的应用服务'}</strong>，由该服务交给图片模型。每次只发送一次生成请求，可能产生费用；取消等待或网络中断后，服务仍可能处理和计费，程序不会自动重发。</p><label><input aria-label="同意本次图片上传与可能计费" type="checkbox" checked={consent} disabled={!source || editing || stale || !connected?.available || !promptValid} onChange={event => setConsent(event.target.checked)}/>我同意本次图片上传与可能计费</label></div>
      <button type="button" className="primary" disabled={!source || editing || stale || !connected?.available || !promptValid || !consent} onClick={() => void generate()}>上传并生成一次补画候选</button>
    </div>
    <div className="image-refinement-view-controls"><label>检查背景<select aria-label="精修检查背景" value={background} onChange={event => setBackground(event.target.value)}><option value="checker">透明棋盘</option><option value="white">白色</option><option value="black">黑色</option></select></label><label>同步缩放<select aria-label="精修对照缩放" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">适应宽度</option><option value="100">100%</option><option value="200">200%</option><option value="400">400%</option></select></label></div>
    {source && sourcePixels && <div className="image-refinement-comparison" data-background={background}><figure><figcaption>{source.basis === 'original' ? '保留原图' : source.basis === 'savedStructure' ? '已保存结构稿来源' : '当前结果'} · {sourcePixels.width} × {sourcePixels.height} px</figcaption><div className="image-refinement-pixel-view" ref={sourceViewport} onScroll={event => syncScroll(event.currentTarget, candidateViewport.current)}><PixelCanvas pixels={sourcePixels} source={sourcePixels} zoom={zoom} label="精修原图对照画布"/></div></figure><figure><figcaption>{result ? `${result.candidate.label} · ${result.candidate.pixels.width} × ${result.candidate.pixels.height} px` : '尚未生成此路线候选'}</figcaption><div className="image-refinement-pixel-view" ref={candidateViewport} onScroll={event => syncScroll(event.currentTarget, sourceViewport.current)}>{result ? <PixelCanvas pixels={result.candidate.pixels} source={sourcePixels} zoom={zoom} label="精修候选对照画布"/> : <p>生成后在相同原图坐标框中对照，返回图片按比例显示。</p>}</div></figure></div>}
    {result?.candidate.vectorStats && <details className="image-refinement-diagnostics"><summary>算法与误差记录</summary><p>这些记录用于复查重建，不能衡量细节改善或画质。色阶偏差在源像素采样处计算，不是曲线渲染后的全图误差。</p><dl className="image-refinement-stats" aria-label="矢量重建统计">{([
      ['pathCount', '路径数'], ['sourcePathCommandCount', '源路径指令'], ['pathCommandCount', '输出路径指令'], ['quadraticCurveCount', '二次曲线'], ['protectedCornerCount', '保留拐角'], ['maxCurveDeviationPx', '最大曲线偏差（像素）'],
      ['tonalRegionCount', '初始连通区域'], ['mergedRegionCount', '合并区域'], ['gradientCount', '渐变填色'], ['maxGradientChannelError', '源色阶拟合最大通道偏差（0–255）'],
      ['observedElements', '依据原图的部件'], ['inferredElements', '含推断的部件'],
    ] as const).filter(([key]) => Number.isFinite(result.candidate.vectorStats![key])).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Number(result.candidate.vectorStats![key].toFixed(3))}</dd></div>)}</dl></details>}
    {result && <><p className="image-refinement-hint">两侧使用相同原图坐标框；候选原生分辨率见上方，宽高比略有差异时保留留白，不拉伸。{result.candidate.model && ` 模型：${result.candidate.model}。`}{result.candidate.requestId && ` 请求标识：${result.candidate.requestId}。`}</p>{parametersChanged && <p role="status" className="image-refinement-warning">参数或补画要求已修改，当前仍显示上一次候选。重新生成后再采用，或恢复原参数。</p>}{result.candidate.sourceSvg && <details className="image-refinement-svg"><summary>候选 SVG 源码</summary><textarea aria-label="精修候选SVG源码" readOnly rows={10} value={result.candidate.sourceSvg}/>{svgUrl && <a href={svgUrl} download="sceneweave-vector-candidate.svg">下载候选 SVG</a>}<p>此源码对应当前矢量候选；下载不会修改工程或保存个人素材。</p></details>}<div className="image-refinement-actions"><button type="button" className="primary" disabled={editing || candidateStale || parametersChanged} onClick={() => void preview()}>{previewContext === 'asset' ? '放入编辑草稿' : '在场景中预览'}</button><button type="button" disabled={editing} onClick={() => { setResults(current => { const next = { ...current }; delete next[route]; return next }); setNotice('本路线候选已丢弃，其他路线草稿保留。') }}>丢弃本路线候选</button></div></>}
    {dirty && <button type="button" className="image-refinement-discard" disabled={editing} onClick={() => { setResults({}); setOptions(defaultOptions); setPlanText(''); setPrompt(''); setConsent(false); setReload(null); setError(''); setNotice('两条路线的候选、结构稿、参数和补画要求已清理。') }}>丢弃全部精修草稿</button>}
    {notice && <p role="status" className="image-refinement-hint">{notice}</p>}
  </section>
}
