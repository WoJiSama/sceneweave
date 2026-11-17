import { useEffect, useRef, useState } from 'react'
import type { MixedPreview } from '../../application/workspace/workspace.js'
import type { SemanticGenerationRequest } from '../../shared/generation/semantic-request.js'
import type { AiConnection } from './AiConversationPanel.js'
import { safeAiError } from '../../platform/browser/ai/client.js'
import type { ForestLoopCandidate, ForestLoopObserver, ForestLoopOutcome } from '../../platform/browser/ai/forest-loop.js'
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

export type RunForestLoop = (request: SemanticGenerationRequest, observer: ForestLoopObserver<MixedPreview>, signal: AbortSignal) => Promise<ForestLoopOutcome<MixedPreview> | null>

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
  const [approved, setApproved] = useState(false), [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<ForestLoopOutcome<MixedPreview> | null>(null), [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const controller = useRef<AbortController | null>(null), mounted = useRef(true), epoch = useRef(0)
  const connectionRef = useRef(connection); connectionRef.current = connection
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  useEffect(() => { controller.current?.abort(); setApproved(false) }, [connection?.client])
  const start = async () => {
    if (!approved || !connection || !request || unavailableReason || disabled || running || outcome) return
    const abort = new AbortController(), operation = ++epoch.current
    controller.current = abort; setRunning(true); setError(''); setApproved(false)
    try {
      const result = await onRun(request, value => { if (mounted.current && epoch.current === operation) setOutcome(value) }, abort.signal)
      if (mounted.current && epoch.current === operation && result) setOutcome(result)
    } catch (failure) {
      if (mounted.current && epoch.current === operation) setError(failure instanceof Error ? failure.message : '本轮未完成，当前工程保留。')
    } finally {
      if (mounted.current && epoch.current === operation) setRunning(false)
      if (controller.current === abort) controller.current = null
    }
  }
  const lookup = async () => {
    if (!outcome || !connection || running || checking) return
    const client = connection.client; setChecking(true); setError('')
    try {
      const decisions = []
      for (const record of outcome.decisions) {
        const snapshot = record.taskId ? await client.snapshot(record.taskId) : await client.findByClientRequestId(record.clientRequestId)
        if (connectionRef.current?.client !== client || !mounted.current) return
        if (!snapshot || snapshot.clientRequestId !== record.clientRequestId) { decisions.push(record); continue }
        decisions.push({ ...record, taskId: snapshot.id, requests: snapshot.usage.requests,
          inputTokens: snapshot.usage.inputTokens, outputTokens: snapshot.usage.outputTokens,
          unknown: snapshot.usage.unknown || !['completed', 'failed', 'cancelled'].includes(snapshot.status) })
      }
      const updated = { ...outcome, decisions, requests: decisions.reduce((sum, value) => sum + value.requests, 0),
        inputTokens: decisions.some(value => value.inputTokens === null) ? null : decisions.reduce((sum, value) => sum + value.inputTokens!, 0),
        outputTokens: decisions.some(value => value.outputTokens === null) ? null : decisions.reduce((sum, value) => sum + value.outputTokens!, 0),
        unknown: decisions.some(value => value.unknown) }
      setOutcome(updated)
    } catch (failure) { if (mounted.current) setError(safeAiError(failure)) }
    finally { if (mounted.current) setChecking(false) }
  }
  return <details className="workspace-detail-disclosure" aria-label="林中建筑自动候选闭环">
    <summary>让模型比较候选并调整</summary>
    <p>模型读取逐房家具目标、实际数量和摆位受阻原因，选择换种子或修正指定房间，再交给你审阅。连续无改善时停止尝试；尺寸、房间数、用途、家具和植被目标保持。</p>
    {!connection && <p className="asset-muted">请先到「AI」连接后端，再返回这里开始。</p>}
    {unavailableReason && <p role="status">{unavailableReason}</p>}
    {!outcome && <><label className="volcano-check"><input aria-label="允许本轮有限自动候选" type="checkbox" checked={approved} disabled={disabled || running} onChange={event => setApproved(event.target.checked)}/>
      允许本轮最多3次本机生成或家具修正、4次模型决策，最终由我审阅保存</label>
      <button type="button" className="secondary asset-wide" disabled={!connection || !request || !!unavailableReason || disabled || running || !approved} onClick={() => void start()}>开始自动候选比较</button></>}
    {running && <button type="button" className="secondary asset-wide" onClick={() => controller.current?.abort()}>停止自动比较并保留候选</button>}
    {error && <p role="alert" className="asset-error">{error}</p>}
    {outcome && <section aria-label="自动候选真实进度" aria-live="polite">
      <p>{running ? outcome.state.status === 'generating' ? '本机正在生成并校验候选…' : '模型正在根据当前状态选择下一动作…'
        : outcome.state.status === 'finished' ? '模型已完成比较，候选等待你审阅保存。' : outcome.state.stopReason ?? '本轮已结束，已有候选保留。'}</p>
      <p>累计生成或修正 {outcome.state.attemptsUsed}/3次 · 模型决策 {outcome.decisions.length}/4次 · 实际模型请求 {outcome.requests}次</p>
      <p>输入 {outcome.inputTokens ?? '未知'} / 输出 {outcome.outputTokens ?? '未知'} token · 已用 {(outcome.elapsedMs / 1000).toFixed(1)}秒</p>
      {outcome.unknown && <p>原模型请求仍有未确认项，停止自动执行；不会重发或开始新一轮。</p>}
      <details><summary>查看模型决策与原任务记录</summary><ol>{outcome.decisions.map(record => <li key={record.clientRequestId}>
        {record.action ? `${record.action.kind === 'generate' ? '生成候选' : record.action.kind === 'repair-furniture' ? '修正指定房间家具' : '结束并选择'}：${record.action.reason}` : '等候合法动作'}
        <small> · 请求 {record.clientRequestId}{record.taskId ? ` · 任务 ${record.taskId}` : ' · 创建结果尚未确认'}</small>
      </li>)}</ol></details>
      {outcome.state.failures.map((failure, index) => <p key={index} className="asset-error">种子 {failure.seed} 未完成：{failure.message}</p>)}
      {outcome.candidates.map((value, index) => <CandidateCard key={value.receipt.candidateId} value={value} index={index} selected={outcome.state.selectedCandidateId === value.receipt.candidateId}/>)}
      <p className="asset-muted">预览来自实际候选，模型本轮只收到结构诊断；没有进行模型看图审核。生成说明数量不代表美术质量。</p>
      {!running && <button type="button" className="secondary asset-wide" disabled={!connection || checking} onClick={() => void lookup()}>只读查询原模型任务</button>}
      {!running && !outcome.unknown && <button type="button" className="secondary asset-wide" disabled={disabled || checking} onClick={() => { setOutcome(null); setApproved(false); setError('') }}>结束本轮并重新设置</button>}
    </section>}
  </details>
}
