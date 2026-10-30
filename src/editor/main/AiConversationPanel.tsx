import { useEffect, useId, useRef, useState } from 'react'
import {
  AI_LIMITS, CreateTaskSchema, isTerminalTask, utf8Size,
  type ConnectionInfo, type CreateTaskRequest, type ReasoningEffort, type TaskContext, type TaskSnapshot, type TaskStatus,
} from '../../shared/ai/protocol'
import { AiClient, AiClientError, describeTaskError, safeAiError, supportsContinuation, continuationIdentity, sameBudgetIdentity } from '../../platform/browser/ai/client'
import AiAuthoringPane, { type AiAuthoringHost } from './AiAuthoringPane'
import { AUTHORING_LIMITS } from '../../shared/ai/authoring-protocol'
import { renderPublicVision } from '../../platform/browser/ai/public-vision'
import type { VisionInput } from '../../shared/ai/vision'
import './ai-conversation.css'

export interface AiConversationPanelProps { context: TaskContext; disabled?: boolean; authoring?: AiAuthoringHost }
const labels: Record<TaskStatus, string> = { running: '正在回复', paused: '已暂停', completed: '已完成', cancelled: '已取消', failed: '未完成', expired: '已过期', waiting_browser: '等待本机校验', ready: '草稿可审阅采用', applying: '正在采用', applied: '已采用' }
const defaultUrl = () => import.meta.env.VITE_SCENEWEAVE_AI_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '')
const sceneOf = (context: TaskContext) => context?.sceneId ?? null
const cancelled = (error: unknown) => error instanceof Error && error.name === 'AbortError'
const effortLabel = (effort: ReasoningEffort | null) => effort === null ? '模型默认（未指定等级）' : ({ low: '低 · low', high: '高 · high', max: '最高 · max' })[effort]

/** Conversation stays outside project/history storage. Hidden resource tabs keep this component mounted. */
export default function AiConversationPanel({ context, disabled: externalDisabled = false, authoring }: AiConversationPanelProps) {
  const [critical, setCritical] = useState(false)
  const disabled = externalDisabled || critical
  const [baseUrl, setBaseUrl] = useState(defaultUrl), [token, setToken] = useState('')
  const [client, setClient] = useState<AiClient | null>(null), [connection, setConnection] = useState<ConnectionInfo | null>(null)
  const [task, setTask] = useState<TaskSnapshot | null>(null), [tasks, setTasks] = useState<TaskSnapshot[]>([])
  const [prompt, setPrompt] = useState(''), [addition, setAddition] = useState(''), [pending, setPending] = useState<CreateTaskRequest | null>(null)
  const [lookupId, setLookupId] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [streamState, setStreamState] = useState<'idle' | 'connected' | 'reconnecting' | 'disconnected'>('idle')
  const [startedTools, setStartedTools] = useState<{ callId: string; name: string }[]>([])
  const [deleteConfirmation, setDeleteConfirmation] = useState(false), [resumeConfirmed, setResumeConfirmed] = useState(false)
  const [resumeVision, setResumeVision] = useState(false)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('')
  const reasoningHintId = useId(), supportsReasoning = connection?.capabilities.taskReasoningEffort === true
  const selectedReasoningEffort = supportsReasoning && reasoningEffort ? reasoningEffort : undefined
  const contextRef = useRef(context), sceneRef = useRef(sceneOf(context)), clientRef = useRef<AiClient | null>(null), taskRef = useRef<TaskSnapshot | null>(null)
  const operation = useRef(0), request = useRef<AbortController | null>(null), stream = useRef<AbortController | null>(null), mounted = useRef(true)
  contextRef.current = context; sceneRef.current = sceneOf(context)

  const stopReading = () => { stream.current?.abort(); stream.current = null }
  const invalidate = () => { operation.current += 1; request.current?.abort(); request.current = null; stopReading() }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; invalidate() }
  }, [])
  useEffect(() => {
    invalidate(); taskRef.current = null; setTask(null); setTasks([]); setPending(null); setStartedTools([])
    setBusy(false); setStreamState('idle'); setError(''); setAddition(''); setPrompt(''); setLookupId(''); setDeleteConfirmation(false); setResumeConfirmed(false)
    setNotice('服务器已有任务可通过“查询最近任务”取回；切换工程只停止本地读取。')
  }, [context?.sceneId])

  const begin = () => {
    operation.current += 1; request.current?.abort()
    const controller = new AbortController(), generation = operation.current, scene = sceneRef.current
    request.current = controller; setBusy(true); setError('')
    return { controller, valid: () => mounted.current && !controller.signal.aborted && operation.current === generation && sceneRef.current === scene,
      finish: () => { if (mounted.current && operation.current === generation) { setBusy(false); request.current = null } } }
  }
  const applySnapshot = (snapshot: TaskSnapshot, active: AiClient) => {
    if (!mounted.current || clientRef.current !== active || sceneOf(snapshot.context) !== sceneRef.current || taskRef.current?.id !== snapshot.id) return false
    const previous = taskRef.current
    if (snapshot.generation < previous.generation || snapshot.generation === previous.generation && snapshot.lastSequence < previous.lastSequence) return false
    const before = continuationIdentity(previous.authoring), after = continuationIdentity(snapshot.authoring)
    if (!!before !== !!after || before && (!after || before.policyHash !== after.policyHash || before.sourceHash !== after.sourceHash)) { setError('任务接续版本或底图来源已变化，已停止更新；请保留原任务并重新校验。'); return false }
    taskRef.current = snapshot; setTask(snapshot); return true
  }
  const follow = (snapshot: TaskSnapshot, active: AiClient) => {
    stopReading(); setStartedTools([])
    if (isTerminalTask(snapshot.status) || snapshot.status === 'paused') { setStreamState('idle'); return }
    const controller = new AbortController(); stream.current = controller
    const valid = () => mounted.current && !controller.signal.aborted && stream.current === controller && clientRef.current === active && sceneOf(snapshot.context) === sceneRef.current && taskRef.current?.id === snapshot.id
    void active.follow(snapshot, {
      onSnapshot: value => { if (valid()) applySnapshot(value, active) },
      onEvent: event => { if (!valid()) return; if (event.type === 'tool_started') setStartedTools(values => [...values.filter(value => value.callId !== event.data.callId), event.data]); if (event.type === 'tool_result') setStartedTools(values => values.filter(value => value.callId !== event.data.callId)) },
      onConnection: value => { if (valid()) setStreamState(value) },
    }, controller.signal).then(() => { if (valid()) { setStreamState('idle'); setStartedTools([]) } }).catch(failure => {
      if (valid() && !cancelled(failure)) { setStreamState('disconnected'); setError(safeAiError(failure)) }
    })
  }
  const select = (snapshot: TaskSnapshot, active: AiClient) => {
    if (sceneOf(snapshot.context) !== sceneRef.current) throw new AiClientError('protocol', '服务器返回了其他工程的任务，已停止显示。')
    stopReading(); taskRef.current = snapshot; setTask(snapshot); setDeleteConfirmation(false); setResumeConfirmed(false); setResumeVision(false); setAddition(''); follow(snapshot, active)
  }
  const disconnect = () => {
    invalidate(); clientRef.current = null; setClient(null); setConnection(null); setBusy(false); setStreamState('idle'); setStartedTools([]); setDeleteConfirmation(false); taskRef.current = null; setTask(null); setTasks([])
    setNotice('本地连接已断开，服务器任务继续按自身状态运行；重新连接后可查询。')
  }
  const stopLocal = () => { invalidate(); setBusy(false); setStreamState('disconnected'); setStartedTools([]); setNotice('已停止本地读取。服务器任务不会自动取消；创建结果未知时仍可用同一请求 ID 重试。') }
  const connect = async () => {
    disconnect(); const action = begin()
    try {
      const next = new AiClient(baseUrl, token), info = await next.capabilities(action.controller.signal)
      if (!action.valid()) return
      clientRef.current = next; setClient(next); setConnection(info); taskRef.current = null; setTask(null); setTasks([])
      setNotice('已连接。发送后会流式显示回复；可进行文字对话，或明确授权后创建独立场景草稿。')
    } catch (failure) { if (action.valid() && !cancelled(failure)) setError(safeAiError(failure)) } finally { action.finish() }
  }
  const list = async () => {
    if (!client || busy) return
    const active = client, action = begin()
    try {
      const values = await active.list(sceneRef.current, action.controller.signal)
      if (action.valid() && clientRef.current === active) { setTasks(values.filter(value => sceneOf(value.context) === sceneRef.current)); setNotice('已读取当前工程最近至多 20 个任务；选择“查看任务”不会再次调用模型。') }
    } catch (failure) { if (action.valid() && !cancelled(failure)) setError(safeAiError(failure)) } finally { action.finish() }
  }
  const refresh = async (id: string) => {
    if (!client || busy) return
    const active = client, action = begin(); stopReading()
    try { const known = taskRef.current?.id === id ? taskRef.current : tasks.find(value => value.id === id); const value = await active.snapshot(id, action.controller.signal, continuationIdentity(known?.authoring) ? 2 : 1); if (action.valid() && clientRef.current === active) select(value, active) }
    catch (failure) { if (action.valid() && !cancelled(failure)) { setError(safeAiError(failure)); setStreamState('disconnected') } } finally { action.finish() }
  }
  const lookup = async () => {
    const id = lookupId.trim()
    if (!client || busy || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) return
    const active = client, action = begin(); stopReading()
    try {
      const value = await active.lookupSnapshot(id, action.controller.signal)
      if (action.valid() && clientRef.current === active) { select(value, active); setNotice('已按任务 ID 读取原有进度，没有发起模型请求。') }
    } catch (failure) { if (action.valid() && !cancelled(failure)) setError(safeAiError(failure)) } finally { action.finish() }
  }
  const send = async (retry?: CreateTaskRequest) => {
    if (!client || busy || disabled || !retry && pending || task && ['running', 'paused', 'waiting_browser', 'ready', 'applying'].includes(task.status)) return
    let payload: CreateTaskRequest
    try { payload = retry ?? CreateTaskSchema.parse({ schemaVersion: 1, clientRequestId: crypto.randomUUID(), prompt, context: contextRef.current, ...(selectedReasoningEffort ? { reasoningEffort: selectedReasoningEffort } : {}) }) }
    catch { setError('请输入本次对话文字，UTF-8 大小最多 16KiB。'); return }
    if (sceneOf(payload.context) !== sceneRef.current) return
    const active = client, action = begin(); stopReading(); setPending(payload)
    try {
      const value = await active.create(payload, action.controller.signal)
      if (action.valid() && clientRef.current === active) { setPending(null); setPrompt(''); select(value, active); setNotice('任务已创建，主工程保持当前状态。') }
    } catch (failure) {
      if (action.valid() && !cancelled(failure)) {
        if (failure instanceof AiClientError && failure.requestState === 'not_sent') setPending(null)
        setError(safeAiError(failure)); setNotice('若创建结果未知，请用“重试本次发送”查询同一请求。重试保留请求 ID，不会新建第二次模型请求。')
      }
    } finally { action.finish() }
  }
  const control = async (kind: 'pause' | 'cancel' | 'resume') => {
    if (!client || !task || busy || disabled) return
    const active = client, selected = task, action = begin(); stopReading()
    try {
      if (kind === 'resume' && selected.executionCheckpoint?.uncertain === true) throw new AiClientError('execution_unknown', '执行实耗存在未知值，不能继续发起模型请求；原有检查点与草稿保留，可继续查看或备份。')
      if (kind === 'resume' && continuationIdentity(selected.authoring) && !supportsContinuation(await active.capabilities(action.controller.signal), 'authoring')) throw new AiClientError('unsupported_continuation', '后端当前不支持此底图接续策略，已停止继续请求；原任务和底图保留。')
      let vision: VisionInput | undefined
      if (kind === 'resume' && resumeVision) {
        if (connection?.capabilities.vision !== 'enabled' || !selected.authoring || !authoring) throw new Error('当前任务未具备公开截图回读条件。')
        const local = authoring.workspace, checkpoint = local.checkpoint(), draft = await active.draft(selected.id, action.controller.signal, continuationIdentity(selected.authoring) ? 2 : 1)
        if (draft.generation !== selected.generation || draft.state.contentHash !== selected.authoring.contentHash || !sameBudgetIdentity(selected.authoring, draft.state)) throw new Error('草稿或预算账本已变化，请刷新后重新回读。')
        const grant = await local.reattachAtomic(draft.start)
        const bounds = draft.start.scope.visual?.boundsMm ?? draft.start.scope.scene?.boundsMm ?? draft.start.scope.artwork?.boundsMm ?? draft.start.scope.placement?.boundsMm
        if (!bounds) throw new Error('当前任务未明确授权截图范围。')
        const prepared = draft.state.draftRevision ? await local.prepareAtomicCandidate(grant, draft, { signal: action.controller.signal }) : null
        try { vision = await renderPublicVision(prepared?.project ?? authoring.project, bounds, action.controller.signal, { draftRevision: draft.state.draftRevision, contentHash: draft.state.contentHash }) }
        finally { if (prepared) local.cancelAtomicCandidate(prepared) }
        local.assertCheckpoint(checkpoint)
        if (!action.valid()) return
      }
      const value = await active.control(selected.id, { schemaVersion: 1, expectedGeneration: selected.generation, action: kind, ...(kind === 'resume' && addition.trim() ? { prompt: addition } : {}), ...(vision ? { vision } : {}) }, action.controller.signal, continuationIdentity(selected.authoring) ? 2 : 1)
      if (action.valid() && clientRef.current === active && taskRef.current?.id === selected.id) {
        if (value.id !== selected.id || value.generation < selected.generation || !applySnapshot(value, active)) throw new AiClientError('protocol', '任务控制响应不匹配，请刷新完整任务。')
        setResumeConfirmed(false); setResumeVision(false); setAddition(''); setNotice(kind === 'resume' ? '已明确继续，可能产生新的模型费用。' : kind === 'pause' ? '已暂停，最后确认的文字保留。' : '已取消，已发生的模型用量仍可能计费。'); follow(value, active)
      }
    } catch (failure) { if (action.valid() && !cancelled(failure)) { setError(safeAiError(failure)); setStreamState('disconnected'); setNotice('控制结果未确认，请先刷新任务；不会自动重发控制或模型请求。') } } finally { action.finish() }
  }
  const remove = async () => {
    if (!client || !task || busy || disabled || !deleteConfirmation) return
    const active = client, selected = task, action = begin(); stopReading()
    try {
      await active.delete(selected.id, action.controller.signal)
      if (action.valid() && clientRef.current === active && taskRef.current?.id === selected.id) { taskRef.current = null; setTask(null); setTasks(values => values.filter(value => value.id !== selected.id)); setDeleteConfirmation(false); setStreamState('idle'); setNotice('服务器已确认删除任务正文、对话与私有制品。本机工程不受影响。' + (continuationIdentity(selected.authoring) ? '此底图流程不含正文的防重置摘要保留至七日到期。' : '')) }
    } catch (failure) { if (action.valid() && !cancelled(failure)) { setError(safeAiError(failure)); setNotice('删除尚未确认，请刷新任务查询结果。') } } finally { action.finish() }
  }
  const promptBytes = utf8Size(prompt), additionBytes = utf8Size(addition), activeTask = task && ['running', 'paused', 'waiting_browser', 'ready', 'applying'].includes(task.status)
  const connected = !!client && !!connection
  return <section className="ai-conversation" aria-label="AI 对话面板">
    <header><h3>AI 对话</h3><p>流式对话与独立场景草稿</p></header>
    <details className="ai-connection" open={!connected}>
      <summary>连接设置{connected ? ` · ${connection.model}` : ' · 尚未连接'}</summary>
      <label>自有后端地址<input aria-label="AI 后端地址" type="url" disabled={busy || !!pending || disabled} value={baseUrl} placeholder="https://ai.example.com" autoComplete="off" spellCheck={false} onChange={event => { disconnect(); setBaseUrl(event.target.value) }} /></label>
      <label>后端应用凭据<input aria-label="AI 应用凭据" type="password" disabled={busy || !!pending || disabled} value={token} autoComplete="off" spellCheck={false} onChange={event => { disconnect(); setToken(event.target.value) }} /></label>
      <p>填写自有后端签发的应用凭据；模型供应商密钥只配置在服务器。此处凭据仅留在本次页面内存，刷新后清除。</p>
      <div className="ai-actions"><button type="button" disabled={disabled || busy || !!pending || !baseUrl.trim() || !token.trim()} onClick={() => void connect()}>连接 AI 后端</button>{connected && <button type="button" disabled={busy || !!pending || disabled} onClick={disconnect}>断开本地连接</button>}</div>
    </details>
    <p className="ai-disclosure">普通对话发送范围：自有后端接收本次文字及工程 ID、修订号；模型只接收对话文字和只读连接工具结果，工程 ID 与修订号仅用于后端绑定。普通对话不上传地图、素材或快照；场景草稿需另行明确授权元数据。服务器保留任务 7 日，可主动删除。</p>
    <p className="ai-context">{context ? `当前工程 ${context.sceneId} · 修订 ${context.revision}` : '未打开工程，仅发送文字。'}{connection ? ` · 文字模型 ${connection.model}${connection.visionModel ? ` · 视觉模型 ${connection.visionModel}` : ''}` : ''}</p>
    <div className="ai-reasoning">
      <label>新任务思考程度<select aria-label="AI 思考程度" aria-describedby={reasoningHintId} value={reasoningEffort} disabled={!supportsReasoning || busy || disabled} onChange={event => setReasoningEffort(event.target.value as ReasoningEffort | '')}>
        <option value="">跟随服务设置{supportsReasoning ? ` · ${effortLabel(connection.reasoningEffort ?? null)}` : ''}</option>
        <option value="low">低 · low</option><option value="high">高 · high</option><option value="max">最高 · max</option>
      </select></label>
      <p id={reasoningHintId}>请选择模型支持的思考程度。此设置适用于新建的对话和场景草稿；已有任务、继续和同一请求重试保持原设置。较高程度可能增加等待和用量，不保证质量或完成时间。{!supportsReasoning && (connected ? '当前后端尚不支持页面选择，请更新后端后重连。' : '连接后可选择。')}</p>
    </div>
    {notice && <p role="status">{notice}</p>}{error && <p className="ai-error" role="alert">{error}</p>}
    <div className="ai-actions"><button type="button" disabled={!connected || busy || disabled} onClick={() => void list()}>查询最近任务</button>{(busy || streamState === 'connected' || streamState === 'reconnecting') && <button type="button" onClick={stopLocal}>停止本地读取</button>}{task && <button type="button" disabled={!connected || busy || disabled} onClick={() => void refresh(task.id)}>{streamState === 'disconnected' ? '重新连接' : '刷新任务'}</button>}</div>
    <details><summary>按任务 ID 查询</summary><label>任务 ID<input aria-label="AI 任务 ID" value={lookupId} maxLength={128} autoComplete="off" spellCheck={false} disabled={busy || disabled} onChange={event => setLookupId(event.target.value)}/></label><p>只读取当前工程已有任务；不会继续生成或重置预算。最近任务集合过大时仍可单独查询。</p><button type="button" disabled={!connected || busy || disabled || !/^[A-Za-z0-9_.:-]{1,128}$/.test(lookupId.trim())} onClick={() => void lookup()}>按任务 ID 只读查询</button></details>
    {tasks.length > 0 && <ul className="ai-recent" aria-label="当前工程 AI 最近任务">{tasks.map(value => <li key={value.id}><span>{new Date(value.createdAt).toLocaleString()} · {labels[value.status]}</span><button type="button" disabled={busy || disabled || !connected} aria-label={`查看任务 ${value.id}`} onClick={() => void refresh(value.id)}>查看任务</button></li>)}</ul>}
    {task && <article className="ai-task" aria-label="AI 当前任务">
      <div className="ai-task-heading"><strong>{labels[task.status]}</strong><span>{streamState === 'reconnecting' ? '连接中断，正在重连' : streamState === 'connected' ? '实时连接中' : streamState === 'disconnected' ? '连接已断开' : '检查点已保留'}</span></div>
      <small>任务 {task.id} · 发起修订 {task.context?.revision ?? '无'} · 代次 {task.generation}</small>
      <small aria-label="当前任务思考程度">本任务思考程度：{task.reasoningEffort === undefined ? '未记录（已有任务）' : effortLabel(task.reasoningEffort)}</small>
      {task.context && context && task.context.revision !== context.revision && <p>工程已有新修订；此任务仍使用发起时的上下文。旧草稿不能覆盖新修改，需基于当前工程重新创建任务。</p>}
      <pre className="ai-response" aria-label="AI 回复文字">{task.text || '等待模型回复…'}</pre>
      {(task.tools.length > 0 || startedTools.length > 0) && <div className="ai-tools" aria-label={task.authoring ? 'AI 工具进度' : 'AI 只读工具进度'}>{startedTools.map(value => <p key={value.callId}>工具 {value.name}：执行中</p>)}{task.tools.map(value => <div key={value.callId}><strong>工具 {value.name}：{value.success ? '完成' : '失败'}</strong><pre>{value.output}</pre></div>)}</div>}
      {task.error && <p className="ai-error">{describeTaskError(task.error.code)}{task.error.requestState === 'unknown' ? ' 上一付费请求结果未知，不会自动重发。' : ''}</p>}
      {task.executionCheckpoint?.uncertain === true && <p role="status">执行实耗存在未知值，不能继续发起模型请求。可以只读查看检查点、检查或备份已有草稿；不会自动重发。</p>}
      <p className="ai-usage" aria-label="AI 用量">模型请求 {task.usage.requests}/{task.authoring ? AUTHORING_LIMITS.modelRequests : AI_LIMITS.modelRequests}；输入 token {task.usage.inputTokens ?? '未知'}，输出 token {task.usage.outputTokens ?? '未知'}。{task.usage.unknown ? '部分或全部用量未知，不能按零计费。' : '此处为服务返回的实际 token 记录，未换算价格。'}</p>
      <small>保留至 {new Date(task.expiresAt).toLocaleString()}</small>
      <div className="ai-actions">{['running', 'waiting_browser', 'ready'].includes(task.status) && <button type="button" disabled={!connected || busy || disabled} onClick={() => void control('pause')}>暂停回复</button>}{activeTask && task.status !== 'applying' && <button type="button" disabled={!connected || busy || disabled} onClick={() => void control('cancel')}>取消任务</button>}</div>
      {task.status === 'paused' && !task.authoring?.claim && <div className="ai-resume"><label>补充要求（可留空）<textarea aria-label="AI 继续补充要求" value={addition} maxLength={AI_LIMITS.promptBytes} disabled={busy || disabled} onChange={event => setAddition(event.target.value)} /></label><small>{additionBytes}/{AI_LIMITS.promptBytes} 字节</small>{task.authoring && <label className="ai-check"><input type="checkbox" aria-label="AI 继续发送公开截图" checked={resumeVision} disabled={busy || disabled || connection?.capabilities.vision !== 'enabled'} onChange={e => setResumeVision(e.target.checked)}/>另行同意发送本次草稿明确范围的实际玩家画面给模型供应商，用于回看修正（任务累计最多4张）</label>}<label className="ai-check"><input type="checkbox" checked={resumeConfirmed} disabled={busy || disabled} onChange={event => setResumeConfirmed(event.target.checked)} />我确认继续会发起新的模型请求，可能产生费用；上一请求未知时不会自动重发。</label><button type="button" disabled={!connected || busy || disabled || task.executionCheckpoint?.uncertain === true || !resumeConfirmed || additionBytes > AI_LIMITS.promptBytes} onClick={() => void control('resume')}>确认继续任务</button></div>}
      {!deleteConfirmation ? <button type="button" className="ai-delete" disabled={!connected || busy || disabled || task.status === 'applying'} onClick={() => setDeleteConfirmation(true)}>删除服务器任务</button> : <div className="ai-delete-confirm"><p>删除会终止此任务，并删除服务器保存的对话、草稿、检查点与私有制品。{continuationIdentity(task.authoring) && '此底图流程不含正文的防重置摘要保留至七日到期，删除不会重置预算。'}此操作不能恢复。</p><div className="ai-actions"><button type="button" disabled={!connected || busy || disabled} onClick={() => void remove()}>确认删除服务器任务</button><button type="button" disabled={busy} onClick={() => setDeleteConfirmation(false)}>保留任务</button></div></div>}
    </article>}
    {pending ? <div className="ai-pending"><p>本次创建请求尚未确认。重试使用同一个请求 ID，不会主动创建另一个任务。</p><div className="ai-actions"><button type="button" disabled={!connected || busy || disabled} onClick={() => void send(pending)}>重试本次发送</button><button type="button" disabled={busy} onClick={() => { setPending(null); setNotice('已停止本地重试。服务器可能已创建任务，请先查询最近任务；不会自动取消服务器任务。') }}>停止本地重试</button></div></div> : <form className="ai-compose" onSubmit={event => { event.preventDefault(); void send() }}><label>本次对话<textarea aria-label="AI 对话输入" value={prompt} maxLength={AI_LIMITS.promptBytes} disabled={busy || disabled} placeholder="描述你的想法，或请求检查连接…" onChange={event => setPrompt(event.target.value)} /></label><small>{promptBytes}/{AI_LIMITS.promptBytes} 字节</small>{activeTask && <p>当前任务尚未结束。暂停后可补充并明确继续，或取消后再发送新任务。</p>}<button type="submit" disabled={!connected || busy || disabled || !!activeTask || !prompt.trim() || promptBytes > AI_LIMITS.promptBytes}>发送新任务</button></form>}
    <AiAuthoringPane reasoningEffort={selectedReasoningEffort} visionEnabled={connection?.capabilities.vision === 'enabled'} continuationSupported={!!connection && supportsContinuation(connection, 'authoring')} client={connection?.capabilities.sceneDraft ? client : null} task={task} host={authoring ? { ...authoring, onCritical: value => { setCritical(value); authoring.onCritical(value) } } : undefined} disabled={externalDisabled || busy || !!pending} onTask={(value, active) => { if (clientRef.current !== active) return; if (taskRef.current?.id === value.id) { if (applySnapshot(value, active)) follow(value, active) } else select(value, active) }}/>
    <p className="ai-footnote">草稿支持明确授权的物件、建筑、室外、组合、散布、主持人文字，以及 SVG 制作和素材风格同化。隐藏面板保留对话；断开连接或切换工程只停止本地读取，取消服务器任务请使用“取消任务”。</p>
  </section>
}
