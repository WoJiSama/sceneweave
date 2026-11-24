import { useEffect, useRef, useState } from 'react'
import type { MixedPreview } from '../../application/workspace/workspace.js'
import type { SemanticGenerationRequest } from '../../shared/generation/semantic-request.js'
import type { AiConnection } from './AiConversationPanel.js'
import { safeAiError } from '../../platform/browser/ai/client.js'
import { FOREST_USER_STOP, forestLoopOutcome, lookupForestDecisions, type ForestLoopCandidate,
  type ForestLoopObserver, type ForestLoopOutcome } from '../../platform/browser/ai/forest-loop.js'
import { forestLoopStore, type StoredForestLoop } from '../../platform/browser/ai/forest-loop-store.js'
import { assertWorkflowBinding } from '../../shared/ai/workflows/catalog.js'
import { canonicalJson } from '../../shared/validation/json.js'
import type { FurnitureRejectionReason } from '../../shared/generation/forest-furniture-contract.js'

const roles = { bed: '床', seat: '座椅', table: '桌子', storage: '储物', work: '工作台', hearth: '炉灶', shelf: '置物架' }
const rejectionLabels: Record<FurnitureRejectionReason, string> = {
  'protected-slot': '保留人工修改、删除或锁定', 'missing-definition': '缺少匹配的固定素材',
  'support-or-bounds': '支撑不足或越过房间边界', 'use-space-outside': '使用空间超出房间',
  'physical-clearance': '家具、门前或通路净空冲突', 'reserved-use-space': '占用已保留的使用空间',
  'painted-overlap': '实际外观轮廓重叠', 'seat-group-unavailable': '无法形成可使用的桌椅组合',
  'bed-access-unavailable': '床边无法到达', 'native-command': '编辑校验未通过',
  circulation: '无法保持完整通路净宽', 'furniture-access': '家具使用位置不可达',
}

type ForestLoopCommand = { kind: 'start'; request: SemanticGenerationRequest } | { kind: 'review' | 'resume'; runId: string; revision: number }
export type RunForestLoop = (command: ForestLoopCommand, observer: ForestLoopObserver<MixedPreview>, signal: AbortSignal) => Promise<ForestLoopOutcome<MixedPreview> | null>

function CandidateCard({ value, index, selected }: { value: ForestLoopCandidate<MixedPreview>; index: number; selected: boolean }) {
  const [imageUrl, setImageUrl] = useState(''), [archiveUrl, setArchiveUrl] = useState('')
  useEffect(() => {
    const image = URL.createObjectURL(value.image), archive = URL.createObjectURL(new Blob([value.archive.slice().buffer], { type: 'application/octet-stream' }))
    setImageUrl(image); setArchiveUrl(archive)
    return () => { URL.revokeObjectURL(image); URL.revokeObjectURL(archive) }
  }, [value.image, value.archive])
  return <article className="forest-loop-candidate" aria-label={`自动候选 ${index + 1}`}>
    <strong>候选 {index + 1}{selected ? ' · 模型选择' : ''}</strong>
    <p>种子 {value.receipt.seed} · {value.receipt.entities.rooms}个房间、{value.receipt.entities.props}件物件</p>
    {value.receipt.repairRoomId && <p>本候选修正了一个指定房间的家具，建筑保持。</p>}
    {imageUrl && <a href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt={`候选${index + 1}的实际玩家预览，视觉质量待审阅`} style={{ width: '100%', height: 'auto' }}/></a>}
    {value.receipt.notes.length ? <ul aria-label={`候选${index + 1}实际问题`}>{value.receipt.notes.map((note, row) => <li key={row}>{note}</li>)}</ul> : <p>生成器未报告缺项，实际画面仍需审阅。</p>}
    {value.receipt.diagnostics && <details aria-label={`候选${index + 1}逐房家具诊断`}><summary>逐房家具目标与实际 · 缺 {value.receipt.diagnostics.deficit} 件</summary>
      {value.receipt.diagnostics.rooms.map((room, roomIndex) => <section key={room.roomId} aria-label={`房间${roomIndex + 1}家具诊断`}>
        <strong>房间 {roomIndex + 1} · {room.purpose}</strong>
        <table><thead><tr><th>家具</th><th>目标</th><th>实际</th><th>缺项</th></tr></thead><tbody>{room.roles.map(role =>
          <tr key={role.role}><td>{roles[role.role]}</td><td>{role.expected}</td><td>{role.actual}</td><td>{role.deficit}</td></tr>)}</tbody></table>
        {room.roles.filter(role => role.deficit > 0).map(role => <p key={role.role}>{roles[role.role]}：{role.rejections.length
          ? role.rejections.map(row => `${rejectionLabels[row.reason]}（${row.count}次）`).join('；') : '有限搜索未找到可采用的位置。'}</p>)}
        {!room.repairable && room.roles.some(role => role.deficit > 0) && <p>当前没有可安全自动修正的家具槽位，缺项保留供你审阅。</p>}
      </section>)}
      <p className="asset-muted">拒绝次数来自有限摆位检查；不表示已穷尽所有可能布局。</p>
    </details>}
    {archiveUrl && <a href={archiveUrl} download={`林中建筑-候选${index + 1}.sceneweave`}>下载此候选的完整工程</a>}
  </article>
}

export default function ForestLoopAssistant({ connection, request, unavailableReason, disabled, onRun }: {
  connection: AiConnection | null; request: SemanticGenerationRequest | null; unavailableReason: string | null
  disabled: boolean; onRun: RunForestLoop
}) {
  const [saved, setSaved] = useState<StoredForestLoop | null>()
  const [storeError, setStoreError] = useState('')
  const [approved, setApproved] = useState(false)
  const [operation, setOperation] = useState<'review' | 'start' | 'resume' | 'lookup' | 'archive' | null>(null)
  const [result, setResult] = useState<ForestLoopOutcome<MixedPreview> | null>(null), [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const subscription = forestLoopStore.observe(setSaved, failure => setStoreError(safeAiError(failure)))
    return () => { mounted.current = false; controller.current?.abort(); subscription.unsubscribe() }
  }, [])
  useEffect(() => { controller.current?.abort(); setApproved(false) }, [connection?.client])
  useEffect(() => { setApproved(false) }, [request?.parameters.seed])
  const running = operation === 'start' || operation === 'resume'
  const sameRun = saved && result?.state.runId === saved.checkpoint.state.runId
  const outcome = running && result ? result : saved ? forestLoopOutcome(saved.checkpoint,
    sameRun ? result.candidates.filter(value => saved.checkpoint.state.receipts.some(receipt => receipt.candidateId === value.receipt.candidateId)) : [],
    sameRun ? result.notice : null) : null
  const sameEndpoint = !!connection && connection.client.baseUrl === saved?.endpoint
  const run = async (kind: NonNullable<typeof operation>, work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort; setOperation(kind); setError(''); setApproved(false)
    try { await work(abort.signal) }
    catch (failure) { if (mounted.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : '无法读取或保存本轮断点。') }
    finally {
      if (controller.current === abort) controller.current = null
      if (mounted.current) setOperation(null)
    }
  }
  const execute = (command: ForestLoopCommand) => run(command.kind, async signal => {
    const update = (value: ForestLoopOutcome<MixedPreview>) => { if (mounted.current) setResult(value) }
    const next = await onRun(command, update, signal)
    if (next) update(next)
  })
  const openSaved = (kind: 'review' | 'resume') => {
    if (saved && !disabled && (kind === 'review' || sameEndpoint)) void execute({ kind, runId: saved.checkpoint.state.runId, revision: saved.revision })
  }
  const lookup = () => {
    if (!saved || !connection || !sameEndpoint) return
    void run('lookup', signal => forestLoopStore.exclusive(async () => {
      const current = await forestLoopStore.active()
      if (!current || current.checkpoint.state.runId !== saved.checkpoint.state.runId || current.revision !== saved.revision) {
        throw new Error('林中建筑断点已变化，请重新读取后继续。')
      }
      const next = await lookupForestDecisions(current.checkpoint, current.workflow, connection.client, signal)
      if (canonicalJson(next) !== canonicalJson(current.checkpoint)) await forestLoopStore.commit(current, next, undefined, signal)
      if (mounted.current) setResult(previous => previous && { ...previous, notice: null })
    }))
  }
  const archive = () => {
    if (!saved || outcome?.unknown) return
    void run('archive', signal => forestLoopStore.exclusive(async () => {
      signal.throwIfAborted()
      await forestLoopStore.archive(saved.checkpoint.state.runId, saved.revision)
      if (mounted.current) setResult(null)
    }))
  }
  let bindingError = ''
  if (saved) {
    try { assertWorkflowBinding(saved.workflow) }
    catch (failure) { bindingError = failure instanceof Error ? failure.message : '无法读取本轮流程定义。' }
  }
  const canContinue = outcome?.state.status === 'ready' || outcome?.state.status === 'generating'
  const waiting = outcome?.decisions.at(-1)?.action === null && (canContinue || outcome.unknown)
  return <details className="workspace-detail-disclosure" aria-label="林中建筑自动候选闭环">
    <summary>让模型比较候选并调整</summary>
    <p>自动候选使用同一套地表、路线和房间铺装。模型比较家具需求与实际摆位。看完候选后可关闭生成窗口，到画布审阅并保存为独立工程。</p>
    {!connection && <p className="asset-muted">开始或继续模型决策前，请在「AI」连接后端。</p>}
    {connection && saved && !sameEndpoint && <p role="status">请连接本轮使用的 AI 后端 {saved.endpoint}。</p>}
    {saved === undefined && !storeError && <p role="status">正在读取本机断点…</p>}
    {saved === null && !running && <>
      {unavailableReason && <p role="status">{unavailableReason}</p>}
      <label className="volcano-check"><input aria-label="允许本轮有限自动候选" type="checkbox" checked={approved} disabled={disabled || !!operation} onChange={event => setApproved(event.target.checked)}/>
        允许本轮最多3次生成或家具修正、4次模型决策，最终由我审阅保存</label>
      <button type="button" className="secondary asset-wide" disabled={!connection || !request || !!unavailableReason || disabled || !!operation || !approved}
        onClick={() => { if (request && approved) void execute({ kind: 'start', request }) }}>开始自动候选比较</button>
    </>}
    {running && <button type="button" className="secondary asset-wide" onClick={() => controller.current?.abort(FOREST_USER_STOP)}>停止自动比较并保留候选</button>}
    {(error || storeError || bindingError) && <p role="alert" className="asset-error">{error || storeError || bindingError}</p>}
    {saved && outcome && <section aria-label="自动候选真实进度" aria-live="polite">
      {operation === 'review' && <p role="status">正在冷读完整候选工程并恢复预览…</p>}
      <p>{running ? outcome.state.status === 'generating' ? '本机正在生成并校验候选…' : '正在处理本轮模型决策…'
        : outcome.state.status === 'finished' ? '模型已选定候选，等待你审阅或保存。'
        : outcome.state.status === 'stopped' ? outcome.state.stopReason : '本机断点可接续。'}</p>
      {outcome.notice && !running && <p role="status">{outcome.notice}</p>}
      <p>{outcome.state.request.parameters.title} · {outcome.state.request.parameters.widthMm / 1000} × {outcome.state.request.parameters.heightMm / 1000} 米 · {outcome.state.request.parameters.roomCount} 个房间 · {outcome.state.request.parameters.purpose}</p>
      <p>候选 {outcome.state.receipts.length} 个 · 已用生成与修正 {outcome.state.attemptsUsed}/{outcome.state.limits.maxCandidates} 次 · 模型决策已占用 {outcome.decisions.length}/{outcome.state.limits.maxDecisions} 次</p>
      <p>已记录模型请求 {outcome.requests} 次 · 输入 {outcome.inputTokens ?? '未知'} / 输出 {outcome.outputTokens ?? '未知'} token · 已用 {(outcome.elapsedMs / 1000).toFixed(1)} 秒</p>
      {outcome.unknown && <p>原模型请求仍有未确认项。继续时先查询原请求。</p>}
      {!operation && outcome.state.receipts.length > 0 && <button type="button" className="secondary asset-wide" disabled={disabled} onClick={() => openSaved('review')}>恢复候选预览</button>}
      {!operation && canContinue && <button type="button" className="secondary asset-wide" disabled={disabled || !sameEndpoint || !!bindingError} onClick={() => openSaved('resume')}>继续本轮并使用剩余模型额度</button>}
      <details><summary>查看模型决策与原任务记录</summary><ol>{outcome.decisions.map(record => <li key={record.clientRequestId}>
        {record.action ? `${record.action.kind === 'generate' ? '生成候选' : record.action.kind === 'repair-furniture' ? '修正指定房间家具' : '结束并选择'}：${record.action.reason}` : '等候合法动作'}
        <small> · 请求 {record.clientRequestId}{record.taskId ? ` · 任务 ${record.taskId}` : ' · 创建结果尚未确认'}</small>
      </li>)}</ol></details>
      {outcome.state.failures.map((failure, index) => <p key={index} className="asset-error">种子 {failure.seed} 未完成：{failure.message}</p>)}
      {outcome.candidates.map((value, index) => <CandidateCard key={value.receipt.candidateId} value={value} index={index} selected={outcome.state.selectedCandidateId === value.receipt.candidateId}/>)}
      <p className="asset-muted">预览来自实际候选，模型本轮只收到结构诊断；没有进行模型看图审核。生成说明数量不代表美术质量。</p>
      {!operation && waiting && <button type="button" className="secondary asset-wide" disabled={!sameEndpoint} onClick={lookup}>只读查询原模型任务</button>}
      {!operation && <button type="button" className="secondary asset-wide" disabled={disabled || outcome.unknown} onClick={archive}>归档本轮并设置新任务</button>}
    </section>}
  </details>
}
