import { useEffect, useRef, useState } from 'react'
import { CreateTaskSchema, isTerminalTask, type CreateTaskRequest, type TaskSnapshot } from '../../shared/ai/protocol.js'
import { generationParameterBaseline, generationParameterPrompt, parseGenerationParameterResponse,
  GENERATION_PARAMETER_LABELS, type GenerationParameters, type GenerationParameterDraft } from '../../shared/ai/generation-parameters.js'
import { semanticGenerationCapabilities } from '../../shared/generation/semantic-request.js'
import { AiClientError, safeAiError, type AiClient } from '../../platform/browser/ai/client.js'
import type { AiConnection } from './AiConversationPanel.js'

interface PendingParameters {
  payload: CreateTaskRequest; baseline: string; formRevision: number; parameters: GenerationParameters; description: string; baseUrl: string
}
interface CandidateParameters { draft: GenerationParameterDraft; request: PendingParameters }
const cancelled = (error: unknown) => error instanceof Error && error.name === 'AbortError'
const baselineOf = (value: unknown) => { try { return generationParameterBaseline(value) } catch { return null } }
const valueLabel = (key: keyof GenerationParameters, value: GenerationParameters[keyof GenerationParameters]) =>
  key === 'environment' ? '林中建筑' : key === 'furniture' ? value ? '开启' : '关闭' : key === 'widthMm' || key === 'heightMm' ? `${Number(value) / 1000} 米` : String(value)

/** A normal text task proposes form data. Only the existing user-triggered
 * generator can create a map; this component receives no project or write API. */
export default function GenerationParameterAssistant({ connection, parameters, formRevision, disabled, onApply }: {
  connection: AiConnection | null; parameters: GenerationParameters; formRevision: number; disabled: boolean; onApply: (value: GenerationParameters) => void
}) {
  const [description, setDescription] = useState(''), [pending, setPending] = useState<PendingParameters | null>(null)
  const [task, setTask] = useState<TaskSnapshot | null>(null), [candidate, setCandidate] = useState<CandidateParameters | null>(null)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null), operation = useRef(0), mounted = useRef(false)
  const connectionRef = useRef(connection), pendingRef = useRef(pending), taskRef = useRef(task)
  connectionRef.current = connection; pendingRef.current = pending; taskRef.current = task
  const invalidate = () => { operation.current++; controller.current?.abort(); controller.current = null }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; invalidate() } }, [])
  useEffect(() => {
    invalidate(); setBusy(false)
    if (pendingRef.current && !isTerminalTask(taskRef.current?.status ?? 'running')) setNotice('连接已变化，本地读取已停止；原任务保留，请查询已有任务。')
  }, [connection?.client])
  const begin = (client: AiClient) => {
    invalidate()
    const abort = new AbortController(), epoch = operation.current
    controller.current = abort; setBusy(true); setError('')
    return { abort, valid: () => mounted.current && operation.current === epoch && !abort.signal.aborted && connectionRef.current?.client === client,
      finish: () => { if (mounted.current && operation.current === epoch) { setBusy(false); controller.current = null } } }
  }
  const acceptSnapshot = (snapshot: TaskSnapshot, request: PendingParameters) => {
    if (snapshot.clientRequestId !== request.payload.clientRequestId || snapshot.context !== null || snapshot.authoring) throw new Error('参数任务身份不匹配，原表单保留。')
    const previous = taskRef.current
    if (previous?.id === snapshot.id && (snapshot.generation < previous.generation || snapshot.generation === previous.generation && snapshot.lastSequence < previous.lastSequence)) return
    taskRef.current = snapshot; setTask(snapshot)
    if (snapshot.status === 'completed') {
      try {
        const draft = parseGenerationParameterResponse(snapshot.text, request.parameters)
        setCandidate({ draft, request }); setError(''); setNotice('参数草稿已就绪，请检查后填入表单，再自行预览生成。')
      } catch (failure) {
        setCandidate(null); setError(failure instanceof Error ? failure.message : 'AI参数不可用，原表单保留。')
        setNotice('没有产生可用参数草稿；请直接修改下方表单。')
      }
    } else if (isTerminalTask(snapshot.status) || snapshot.status === 'paused') {
      setNotice(snapshot.usage.unknown ? '任务已停止，模型用量仍有未知项；原文和表单保留。' : '任务未产出可用参数，原文和表单保留，可直接手填。')
    }
  }
  const follow = async (snapshot: TaskSnapshot, request: PendingParameters, client: AiClient, action: ReturnType<typeof begin>) => {
    if (!action.valid()) return
    acceptSnapshot(snapshot, request)
    if (!isTerminalTask(snapshot.status) && snapshot.status !== 'paused') await client.follow(snapshot, {
      onSnapshot: value => { if (action.valid()) acceptSnapshot(value, request) },
    }, action.abort.signal)
  }
  const unresolved = !!pending && (!task || !isTerminalTask(task.status))
  const send = async () => {
    if (!connection || disabled || busy || unresolved) return
    const client = connection.client
    let request: PendingParameters
    try {
      const baseline = generationParameterBaseline(parameters), captured = JSON.parse(baseline) as GenerationParameters
      request = { payload: CreateTaskSchema.parse({ schemaVersion: 1, clientRequestId: crypto.randomUUID(),
        prompt: generationParameterPrompt(description, captured), context: null }), baseline, parameters: captured,
        description, formRevision, baseUrl: client.baseUrl }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '请检查地图需求与当前表单。'); return }
    pendingRef.current = request; setPending(request); taskRef.current = null; setTask(null); setCandidate(null)
    const action = begin(client); setNotice('正在解析参数；只发送需求文字与当前生成表单。')
    try {
      const snapshot = await client.create(request.payload, action.abort.signal)
      await follow(snapshot, request, client, action)
    } catch (failure) {
      if (!action.valid()) return
      const notSent = failure instanceof AiClientError && failure.requestState === 'not_sent' && !taskRef.current
      if (notSent) { pendingRef.current = null; setPending(null) }
      setError(cancelled(failure) ? '本地读取已停止。' : failure instanceof AiClientError ? safeAiError(failure) : failure instanceof Error ? failure.message : '解析失败，原表单保留。')
      if (!taskRef.current) setNotice(notSent ? '请求尚未发送，原文和表单保留；可检查连接后再次提交。' : '创建结果未确认时保留原请求编号；仅查询已有任务，不自动重发。')
    } finally { action.finish() }
  }
  const lookup = async () => {
    if (!connection || !pending || busy || pending.baseUrl !== connection.client.baseUrl) return
    const client = connection.client, request = pending, action = begin(client)
    try {
      let snapshot: TaskSnapshot | undefined
      if (taskRef.current) snapshot = await client.snapshot(taskRef.current.id, action.abort.signal)
      else snapshot = await client.findByClientRequestId(request.payload.clientRequestId, action.abort.signal)
      if (!action.valid()) return
      if (!snapshot) { setNotice('尚未找到原请求，结果仍未知；不会创建新请求，可稍后再次查询。'); return }
      await follow(snapshot, request, client, action)
    } catch (failure) { if (action.valid()) setError(failure instanceof AiClientError ? safeAiError(failure) : failure instanceof Error ? failure.message : '无法读取已有任务。') }
    finally { action.finish() }
  }
  const cancel = async () => {
    if (!connection || !pending || !taskRef.current || isTerminalTask(taskRef.current.status) || pending.baseUrl !== connection.client.baseUrl) return
    const client = connection.client, current = taskRef.current, request = pending, action = begin(client)
    try {
      const snapshot = await client.control(current.id, { schemaVersion: 1, expectedGeneration: current.generation, action: 'cancel' }, action.abort.signal)
      if (action.valid()) acceptSnapshot(snapshot, request)
    } catch (failure) { if (action.valid()) { setError(failure instanceof AiClientError ? safeAiError(failure) : '取消未确认，请查询已有任务。'); setNotice('取消结果未知，原任务和用量保留，不自动重发。') } }
    finally { action.finish() }
  }
  const stale = !!candidate && (formRevision !== candidate.request.formRevision || baselineOf(parameters) !== candidate.request.baseline || description !== candidate.request.description)
  return <details className="workspace-detail-disclosure" aria-label="自然语言填参数试验">
    <summary>用自然语言填写参数 · 实验</summary>
    <p className="asset-muted">输入需求后先检查参数草稿。只发送需求文字和下方生成表单，不发送当前地图、图片或历史。</p>
    {!connection && <p className="asset-muted">请先到「AI」模块连接后端，再返回这里解析参数；也可直接填写下方表单。</p>}
    <label>地图需求<textarea aria-label="参数解析地图需求" value={description} maxLength={6000} onChange={event => setDescription(event.target.value)} placeholder="例如：40×32米林中哨站，两间休息室，树林稍密，需要帐篷"/></label>
    <button type="button" className="secondary asset-wide" disabled={!connection || disabled || busy || unresolved || !description.trim()} onClick={() => void send()}>{busy ? '正在读取参数任务…' : '解析为参数草稿'}</button>
    {pending && <><p className="asset-muted">请求编号：{pending.payload.clientRequestId}{task && ` · 任务 ${task.id}`}</p>
      <button type="button" className="secondary asset-wide" disabled={!connection || busy || pending.baseUrl !== connection.client.baseUrl} onClick={() => void lookup()}>查询已有参数任务</button></>}
    {busy && <button type="button" className="secondary asset-wide" onClick={() => { invalidate(); setBusy(false); setNotice('已停止本地读取，服务器任务仍可能运行；可查询原任务或取消服务器任务。') }}>停止本地读取</button>}
    {task && !isTerminalTask(task.status) && <button type="button" className="secondary asset-wide" disabled={!connection || pending?.baseUrl !== connection.client.baseUrl} onClick={() => void cancel()}>取消服务器参数任务</button>}
    {task && <p className="asset-muted">模型请求 {task.usage.requests} 次 · 输入 {task.usage.inputTokens ?? '未知'} / 输出 {task.usage.outputTokens ?? '未知'} token{task.usage.unknown ? ' · 含未确认用量' : ''}</p>}
    {notice && <p role="status" className="asset-muted">{notice}</p>}{error && <p role="alert" className="asset-error">{error}</p>}
    {candidate && <section aria-label="待确认生成参数"><h3>待确认参数</h3>
      <dl>{(Object.keys(candidate.draft.parameters) as Array<keyof GenerationParameters>).map(key => <div key={key}><dt>{GENERATION_PARAMETER_LABELS[key]}</dt><dd>{valueLabel(key, candidate.draft.parameters[key])}</dd></div>)}</dl>
      {candidate.draft.defaults.length > 0 && <p>沿用当前表单：{candidate.draft.defaults.map(key => GENERATION_PARAMETER_LABELS[key]).join('、')}。</p>}
      {candidate.draft.ambiguities.length > 0 && <><p>需要确认</p><ul>{candidate.draft.ambiguities.map((value, index) => <li key={index}>{value}</li>)}</ul></>}
      {candidate.draft.unsupported.length > 0 && <><p>未支持要求</p><ul>{candidate.draft.unsupported.map((value, index) => <li key={index}>{value}</li>)}</ul></>}
      {stale && <p role="status">需求或表单已修改，请重新解析；旧草稿不能覆盖新参数。</p>}
      <button type="button" className="secondary asset-wide" disabled={disabled || busy || stale} onClick={() => { if (!stale && !disabled) { onApply({ ...candidate.draft.parameters }); setCandidate(null); setNotice('已填入参数。请继续检查或修改，再点击「预览混合场景」。') } }}>填入生成参数</button>
    </section>}
    <p className="asset-muted">当前支持范围</p><ul className="asset-muted">{semanticGenerationCapabilities().limitations.map(value => <li key={value}>{value}</li>)}</ul>
  </details>
}
