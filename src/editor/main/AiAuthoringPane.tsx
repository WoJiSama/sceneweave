import AiScopeFields, { initialExtendedScope, extendedAuthoringScope } from './AiScopeFields'
import { useEffect, useRef, useState } from 'react'
import type { Workspace } from '../../application/workspace/workspace'
import type { AtomicAuthorization, AtomicCandidate } from '../../application/workspace/atomic'
import type { EditableProject } from '../../application/workspace/project'
import type { Prop } from '../../shared/model/scene'
import { toBundle } from '../../application/workspace/project'
import { exportProject } from '../../shared/project/file'
import { validation } from '../../platform/browser/runtime'
import { AiClient, safeAiError } from '../../platform/browser/ai/client'
import { AUTHORING_LIMITS, type AuthoringScope, type DraftClaim } from '../../shared/ai/authoring-protocol'
import { AI_LIMITS, isTerminalTask, utf8Size, type CreateTaskRequest, type TaskSnapshot } from '../../shared/ai/protocol'

export interface AiAuthoringHost {
  workspace: Workspace
  sessionKey: number
  project: EditableProject
  selectedIds: readonly string[]
  layerId: string
  canPrepare: () => boolean
  onPreview: (candidate: AtomicCandidate | null) => void
  onAdopted: () => void
  onCritical: (busy: boolean) => void
}
interface Props { client: AiClient | null; task: TaskSnapshot | null; host?: AiAuthoringHost; disabled: boolean; onTask: (task: TaskSnapshot, client: AiClient) => void }
const message = (error: unknown) => error instanceof Error && error.name !== 'AiClientError' ? error.message : safeAiError(error)
const stamp = (candidate: AtomicCandidate) => ({ expectedGeneration: candidate.generation, draftRevision: candidate.draftRevision, contentHash: candidate.contentHash })
const stop = (task: TaskSnapshot | null) => !task || isTerminalTask(task.status)
const rowProp = (value: unknown): Prop | null => value && typeof value === 'object' && 'prop' in value ? (value as { prop: Prop | null }).prop : null
const describeProp = (prop: Prop | null) => prop ? `位置 (${prop.positionMm.x}, ${prop.positionMm.y}) mm · 旋转 ${prop.rotationDeg}° · 透明度 ${prop.appearance.opacity}` : '无此物件'
const collectionLabel: Record<string, string> = { props: '独立物件', rooms: '房间', walls: '墙体', vertices: '墙体顶点', openings: '门窗', notes: '主持人文字', regions: '区域/遮罩', terrainAreas: '地形区域', terrainEdges: '地形边界', terrainConnections: '地形连接', paths: '道路/路径', scatterGroups: '散布组', prefabInstances: '组合实例', authoringSources: 'SVG来源', assets: '场景素材', assetBytes: '图片制品', propDefinitions: '固定素材版本', constraints: '场景关系' }
const changeAction = (collection: string | undefined, change: AtomicCandidate['changes'][number]) => collection === 'props'
  ? !rowProp(change.before) ? '新增' : !rowProp(change.after) ? '删除' : '调整'
  : change.before === null ? '新增' : change.after === null ? '删除' : '调整'


/** Server metadata is untrusted: replay against the exact local grant and owned image bytes. */
export default function AiAuthoringPane({ client, task, host, disabled, onTask }: Props) {
  const [extended, setExtended] = useState(initialExtendedScope)
  const [prompt, setPrompt] = useState(''), [consent, setConsent] = useState(false), [placing, setPlacing] = useState(false)
  const [targets, setTargets] = useState<string[]>([]), [definitions, setDefinitions] = useState<string[]>([])
  const [opacity, setOpacity] = useState(true), [transform, setTransform] = useState(true), [deleting, setDeleting] = useState(false)
  const [support, setSupport] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [candidate, setCandidate] = useState<AtomicCandidate | null>(null), [reviewed, setReviewed] = useState(false)
  const [pending, setPending] = useState<CreateTaskRequest | null>(null)
  const [receipt, setReceipt] = useState<{ taskId: string; claim: DraftClaim; sceneId: string; revision: number; client: AiClient } | null>(null)
  const grants = useRef(new Map<string, AtomicAuthorization>()), lastHost = useRef(host), lastTask = useRef(task), lastClient = useRef(client)
  const controller = useRef<AbortController | null>(null), mounted = useRef(true), serial = useRef(0)
  lastHost.current = host; lastTask.current = task; lastClient.current = client
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; controller.current?.abort() } }, [])
  const preview = (next: AtomicCandidate | null) => { setCandidate(next); setReviewed(false); lastHost.current?.onPreview(next) }
  useEffect(() => {
    controller.current?.abort(); serial.current++; grants.current.clear(); setBusy(false); setPending(null); setReceipt(null); setTargets([]); setDefinitions([]); setConsent(false); setExtended(initialExtendedScope()); preview(null)
  }, [host?.project.document.sceneId, host?.sessionKey, client])
  const head = task?.authoring ? `${task.id}:${task.generation}:${task.authoring.draftRevision}:${task.authoring.contentHash}` : ''
  const fetchPreview = async (reattach = false) => {
    const active = lastClient.current, selected = lastTask.current, local = lastHost.current
    if (!active || !selected?.authoring || !local || selected.authoring.draftRevision === 0) return
    controller.current?.abort(); const abort = new AbortController(), current = ++serial.current; controller.current = abort
    const valid = () => mounted.current && !abort.signal.aborted && current === serial.current && lastClient.current === active && lastTask.current?.id === selected.id && lastTask.current?.generation === selected.generation && lastTask.current?.authoring?.contentHash === selected.authoring?.contentHash
    setBusy(true); setError(''); let received = false
    try {
      const draft = await active.draft(selected.id, abort.signal)
      if (!valid()) return
      let grant = grants.current.get(draft.start.seed)
      if (reattach) { grant = await local.workspace.reattachAtomic(draft.start); grants.current.set(draft.start.seed, grant) }
      if (!grant) { preview(null); setNotice('此任务尚未绑定当前本机基线。请明确重新绑定并校验；主工程有新修改时会拒绝旧基线采用。'); return }
      received = true
      const next = await local.workspace.prepareAtomicCandidate(grant, draft, { signal: abort.signal })
      if (!valid()) { local.workspace.cancelAtomicCandidate(next); return }
      preview(next); setNotice(`本机重放及实际素材校验通过：草稿 ${next.draftRevision}，${next.changes.length} 件差异。`)

    } catch (failure) { if (valid()) { preview(null); setError(message(failure)); if (received && selected.status === 'waiting_browser') void active.validateDraft(selected.id, { expectedGeneration: selected.generation, draftRevision: selected.authoring!.draftRevision, contentHash: selected.authoring!.contentHash, valid: false }).then(value => { if (valid()) onTask(value, active) }).catch(() => undefined) } }
    finally { if (mounted.current && current === serial.current) setBusy(false) }
  }
  useEffect(() => { setCandidate(null); setReviewed(false); if (head) void fetchPreview(); else { controller.current?.abort(); serial.current++; setBusy(false); lastHost.current?.onPreview(null) } }, [head, client])
  // Waiting may arrive after the last draft event, without changing the draft head.
  useEffect(() => {
    if (task?.status !== 'waiting_browser' || !candidate || !client || candidate.generation !== task.generation || candidate.contentHash !== task.authoring?.contentHash) return
    const abort = new AbortController()
    void client.validateDraft(task.id, { ...stamp(candidate), valid: true }, abort.signal).then(value => { if (!abort.signal.aborted && lastTask.current?.id === value.id) onTask(value, client) }).catch(failure => { if (!abort.signal.aborted) setError(message(failure)) })
    return () => abort.abort()
  }, [task?.status, candidate])
  const start = async (retry?: CreateTaskRequest) => {
    const local = lastHost.current, active = lastClient.current
    if (!local || !active || busy || disabled || !stop(lastTask.current) || !retry && (!consent || !local.canPrepare())) return
    setBusy(true); setError(''); const current = ++serial.current, abort = new AbortController(); controller.current = abort
    const valid = () => mounted.current && current === serial.current && !abort.signal.aborted && lastHost.current?.project.document.sceneId === local.project.document.sceneId && lastClient.current === active
    try {
      let payload = retry
      if (!payload) {
        const floorId = Object.keys(local.project.document.floors)[0], [kind, ...parts] = support.split(':')
        const operations: AuthoringScope['operations'] = [...(transform ? ['transform' as const] : []), ...(opacity ? ['opacity' as const] : []), ...(deleting ? ['delete' as const] : []), ...(placing ? ['place' as const] : [])]
        if (placing && (!parts.length || !definitions.length)) throw new Error('请明确选择放置表面和允许使用的素材。')
        const scope: AuthoringScope = { ...extendedAuthoringScope(extended, local.project, floorId, local.layerId, definitions), targetIds: targets, operations, placement: placing ? { floorId, layerId: local.layerId, supportRef: { kind: kind as 'floor' | 'room' | 'terrainArea', id: parts.join(':') }, boundsMm: extended.bounds ?? local.project.document.exportBoundsMm, definitionIds: definitions } : null }
        const grant = await local.workspace.authorizeAtomic(scope); grants.current.clear(); grants.current.set(grant.start.seed, grant)
        payload = { schemaVersion: 1, clientRequestId: crypto.randomUUID(), prompt, context: { sceneId: grant.currentSceneId, revision: grant.currentRevision, audience: 'public' }, authoring: grant.start }
      }
      if (!valid()) return
      setPending(payload)
      const value = await active.create(payload, abort.signal)
      if (valid()) { setPending(null); setReceipt(null); onTask(value, active); setNotice('独立草稿任务已创建。模型步骤不会写入主工程。') }
    } catch (failure) { if (valid()) { setError(message(failure)); setNotice('创建结果不明时，保留同一请求重试或查询最近任务；不会自动再调用模型。') } }
    finally { if (mounted.current && current === serial.current) setBusy(false) }
  }
  const ack = async (value: NonNullable<typeof receipt>) => {
    const active = value.client
    const updated = await active.appliedDraft(value.taskId, { ...value.claim, sceneId: value.sceneId, revision: value.revision })
    if (lastTask.current?.id === updated.id) onTask(updated, active)
    setReceipt(previous => previous?.taskId === value.taskId && previous.claim.claimId === value.claim.claimId ? null : previous)
  }
  const adopt = async () => {
    if (!host || !client || !candidate || !task || task.status !== 'ready' || !reviewed || busy || disabled) return
    const selected = candidate, active = client, local = host, claim: DraftClaim = { ...stamp(selected), claimId: crypto.randomUUID() }
    setBusy(true); local.onCritical(true); setError(''); let committed = false, claimAttempted = false
    try {
      const result = await local.workspace.adoptAtomicCandidate(selected, { claim: () => { claimAttempted = true; return active.claimDraft(selected.taskId, claim) } })
      committed = true
      // Observe save rejection immediately while the independent server receipt is sent.
      const saved = result.save.then(() => null, failure => failure as unknown)
      const value = { taskId: selected.taskId, claim, sceneId: selected.currentSceneId, revision: result.revision, client: active }
      setReceipt(value); preview(null); local.onAdopted()
      let acknowledged = true
      try { await ack(value) } catch { acknowledged = false }
      const failed = await saved
      if (failed) throw new Error(`主工程已在内存中采用，撤销和保护点保留；保存未完成：${message(failed)}`)
      setNotice(`已作为一次事务采用到 r${result.revision}，保护快照和保存已完成。${acknowledged ? '' : '服务器回执未确认，请仅重发采用回执。'}`)
    } catch (failure) {
      setError(message(failure))
      if (!committed && claimAttempted) { try { const updated = await active.releaseDraft(selected.taskId, claim); if (lastTask.current?.id === updated.id) onTask(updated, active) } catch { setNotice('本机未采用。租约释放未确认，请刷新任务；租约到期后可明确释放。') } }
    } finally { setBusy(false); local.onCritical(false) }
  }
  const finishPaused = async () => {
    if (!client || !candidate || !task || task.status !== 'paused' || task.authoring?.claim || busy || disabled) return
    const active = client, selected = task, checked = candidate
    setBusy(true); setError('')
    try {
      const updated = await active.validateDraft(selected.id, { ...stamp(checked), valid: true })
      if (lastClient.current === active && lastTask.current?.id === selected.id) { onTask(updated, active); setNotice('已结束生成，当前有效草稿可审阅采用；没有发起新的模型请求。') }
    } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  const release = async () => {
    if (!client || !task?.authoring?.claim || busy) return
    setBusy(true); setError('')
    try {
      const claim = task.authoring.claim
      onTask(await client.releaseDraft(task.id, { expectedGeneration: claim.generation, draftRevision: claim.draftRevision, contentHash: claim.contentHash, claimId: claim.claimId }), client)
      setNotice('已明确释放旧采用租约；它以后不能再确认采用。')
    } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  const backup = async () => {
    if (!candidate || busy) return
    setBusy(true); setError('')
    try {
      const bytes = await exportProject(toBundle(candidate.project), validation)
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })), anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'sceneweave-ai-draft.sceneweave'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
      setNotice('已下载完整草稿备份；通过普通导入打开为独立副本。')
    } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  const scene = host?.project.document, available = scene ? Object.values(scene.propDefinitions).filter(definition => !definition.tags.includes('sceneweave:retained-appearance')) : []
  const whole = scene ? Object.values(scene.props).filter(prop => prop.visibility === 'public' && !Object.values(scene.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === prop.id)) && !Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === prop.id))).map(prop => prop.id) : []
  const toggleDefinition = (id: string) => setDefinitions(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id])
  return <section className="ai-authoring" aria-label="AI 场景草稿">
    <h3>场景草稿</h3>
    <p>先授权对象和素材，AI 分步修改独立草稿。检查差异后，保护当前并作为一次事务采用。</p>
    {host && <details open={!task?.authoring}><summary>新任务的授权范围</summary>
      <div className="ai-actions"><button disabled={busy || disabled} onClick={() => setTargets([...host.selectedIds])}>使用画布选中对象</button><button disabled={busy || disabled} onClick={() => setTargets(whole)}>授权全部独立公开物件</button><button disabled={busy || disabled} onClick={() => setTargets([])}>清空对象范围</button></div>
      <p>已授权 {targets.length} 件：{targets.join('、') || '无现存对象'}。秘密、组合/散布成员、锁定及带注记/路径依赖的对象会整笔拒绝。</p>
      <div className="ai-actions"><label className="ai-check"><input type="checkbox" checked={transform} onChange={e => setTransform(e.target.checked)}/>移动 / 旋转</label><label className="ai-check"><input type="checkbox" checked={opacity} onChange={e => setOpacity(e.target.checked)}/>透明度</label><label className="ai-check"><input type="checkbox" checked={deleting} onChange={e => setDeleting(e.target.checked)}/>允许删除</label></div>
      <label className="ai-check"><input type="checkbox" checked={placing} onChange={e => setPlacing(e.target.checked)}/>允许使用明确素材放置新物件</label>
      {placing && <><label>放置表面<select aria-label="AI 放置表面" value={support} onChange={e => setSupport(e.target.value)}><option value="">请选择</option>{Object.keys(scene?.floors ?? {}).map(id => <option key={id} value={`floor:${id}`}>Floor · {scene?.floors[id].name}</option>)}{Object.values(scene?.rooms ?? {}).map(room => <option key={room.id} value={`room:${room.id}`}>房间 · {room.id}</option>)}{Object.values(scene?.terrainAreas ?? {}).map(area => <option key={area.id} value={`terrainArea:${area.id}`}>地形 · {area.id}</option>)}</select></label><p>当前图层 {host.layerId}；放置限制为当前导出范围 {scene?.exportBoundsMm.width} × {scene?.exportBoundsMm.height} mm。只接受公开支撑与完整几何。</p></>}
      {(placing || extended.scene) && <><details><summary>授权本工程素材（{definitions.length}）</summary><button disabled={busy || disabled} onClick={() => setDefinitions(available.map(value => value.id))}>授权本工程全部物件素材</button>{available.map(definition => <label className="ai-check" key={definition.id}><input type="checkbox" checked={definitions.includes(definition.id)} onChange={() => toggleDefinition(definition.id)}/>{definition.name}</label>)}</details></>}
      <AiScopeFields value={extended} onChange={setExtended} project={host.project} selectedIds={host.selectedIds} disabled={busy || disabled}/>
      <label>草稿要求<textarea aria-label="AI 草稿要求" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="例如：把选中的椅子向右移动500毫米，并将透明度改为0.8。"/></label>
      <p className="ai-disclosure">发送范围：自有后端接收本次要求、完整工程元数据（含主持人字段）及授权范围，用于完整校验；不发送图片字节或历史快照。模型仅接收授权公开对象、必要支撑几何、授权素材名称/标签/尺寸及工具结果。任务保留七日，可删除。</p>
      <label className="ai-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容</label>
      <small>固定技能 v1：独立物件 / 完整场景 / SVG与同化 · 最多16轮模型请求、64次工具、累计300秒、256条实际操作。</small>
      {pending ? <div className="ai-actions"><button disabled={busy || disabled || !client} onClick={() => void start(pending)}>重试同一草稿请求</button><button disabled={busy} onClick={() => { setPending(null); setNotice('已停止本地重试，请查询服务器任务确认创建结果。') }}>停止草稿重试</button></div> : <button disabled={!client || disabled || busy || !stop(task) || !consent || !prompt.trim() || utf8Size(prompt) > AI_LIMITS.promptBytes || !targets.length && !placing && !extended.scene && !extended.artwork} onClick={() => void start()}>创建独立草稿任务</button>}
    </details>}
    {task?.authoring && <><p>草稿 {task.authoring.draftRevision} · 实际操作 {task.authoring.operationCost}/{AUTHORING_LIMITS.operations} · 改动目标 {task.authoring.changedIds.length} 件。主工程只在最终采用时改变。</p>
      <button disabled={!client || !host || busy || disabled || !task.authoring.draftRevision} onClick={() => void fetchPreview(true)}>重新绑定并校验草稿</button>
      {candidate && <><p>本机完整校验通过，读依赖 {candidate.readIds.length} 项，写目标 {candidate.writeIds.length} 项。</p><ul aria-label="AI 草稿差异">{candidate.changes.map(change => { const collection = change.collection ?? 'props', prop = rowProp(change.after) ?? rowProp(change.before), action = changeAction(collection, change); return <li key={`${collection}:${change.id}`}><strong>{collectionLabel[collection] ?? collection} · {prop?.definitionRef ? candidate.project.document.propDefinitions[prop.definitionRef.id]?.name ?? '物件' : change.id} · {action}</strong>{collection === 'props' && <><p>原：{describeProp(rowProp(change.before))}</p><p>新：{describeProp(rowProp(change.after))}</p></>}<p>变化字段：{change.fields.join('、') || '关系'}</p><details><summary>对象 ID 与完整差异</summary><small>{change.id}</small><pre>{JSON.stringify({ before: change.before, after: change.after }, null, 2)}</pre></details></li> })}</ul><button disabled={busy} onClick={() => void backup()}>下载完整草稿备份</button>{task.status === 'paused' && !task.authoring.claim && <button disabled={disabled || busy} onClick={() => void finishPaused()}>结束生成并审阅当前草稿</button>}<label className="ai-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)}/>已检查范围和差异，采用前创建保护快照</label><button disabled={disabled || busy || !reviewed || task.status !== 'ready' || candidate.contentHash !== task.authoring.contentHash || candidate.generation !== task.generation || !candidate.changes.length} onClick={() => void adopt()}>保护当前并一次采用 AI 草稿</button></>}
      {task.authoring.claim && !receipt && <><p>有尚未确认的采用租约。若当前工程已经采用，请保留任务并核对工程；释放后不能再补认旧租约。</p><button disabled={busy || disabled} onClick={() => void release()}>确认本机未采用并释放租约</button></>}
    </>}
    {receipt && <button disabled={busy} onClick={() => { void ack(receipt).catch(failure => setError(message(failure))) }}>仅向原后端重发采用回执</button>}
    {busy && <p role="status">正在校验或处理草稿…</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="ai-error">{error}</p>}
  </section>
}
