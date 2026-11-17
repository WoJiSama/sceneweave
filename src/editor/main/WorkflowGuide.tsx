import { useState } from 'react'
import { getWorkflow, listWorkflows, queryWorkflow, type WorkflowHost, type WorkflowRequirement } from '../../shared/ai/workflows/catalog'
import { pageWorkflowHost } from '../../shared/ai/workflows/hosts'
import type { TaskSnapshot } from '../../shared/ai/protocol'
import './workflow-guide.css'

const labels = { available: '本入口可用', 'page-only': '页面操作', 'not-connected': '尚未接线', 'missing-input': '缺少输入', 'not-authorized': '尚未授权', 'budget-exhausted': '预算已用完' }
const effectLabels = { historical: '历史冻结证据', partial: '有限效果，仍需审阅', unverified: '效果未验收' }
const capabilityLabels: Record<WorkflowRequirement, string> = {
  'forest-parameters': '准备林中建筑参数', 'forest-generation': '生成林中建筑', 'project-preview': '查看工程候选',
  'project-delivery': '保存与交付工程', 'draft-read': '读取授权草稿', 'draft-edit': '修改授权草稿',
  'draft-check': '检查草稿', 'page-adopt': '审阅并采用', 'image-read': '读取原图与断点',
  'image-select': '选区、切割与补底', 'image-preview': '查看物件预览', 'image-build': '保全工作包与工程', 'asset-refine': '优化素材候选',
  'ocean-generation': '生成静态海洋候选', 'floor-navigation': '关联楼层入口与定位',
}

export default function WorkflowGuide({ workflowId, host = pageWorkflowHost(), onSelect, task, feedback }: {
  workflowId: string; host?: WorkflowHost; onSelect?: (id: string) => void; task?: TaskSnapshot | null; feedback?: string
}) {
  const [stepId, setStepId] = useState<string | null>(null)
  const definition = getWorkflow(workflowId), catalogue = listWorkflows(host)
  const selected = catalogue.find(value => value.id === workflowId)!
  const activeTaskBinding = task?.workflow
  const stale = activeTaskBinding?.id === definition.id && activeTaskBinding.definitionHash !== definition.definitionHash
  const detail = stepId ? definition.steps.find(step => step.id === stepId) : undefined
  return <details className="workspace-detail-disclosure workflow-guide" aria-label="共享工作流与能力">
    <summary>制作工作流 · 当前能力与效果</summary>
    {onSelect ? <label>选择工作流<select aria-label="选择制作工作流" value={workflowId} onChange={event => { setStepId(null); onSelect(event.target.value) }}>
      {catalogue.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
    </select></label> : <h3>{definition.title}</h3>}
    <p>{definition.summary}</p>
    {host.name === 'conversation' && <p className="asset-muted">以下为普通对话的执行入口；场景草稿按另行建立的真实授权执行。</p>}
    <ul aria-label="当前可用能力">{selected.capabilities.map(value => <li key={value.id}><strong>{capabilityLabels[value.id]}</strong> · {labels[value.state]}<br/>{value.entry}<br/>{value.reason}</li>)}</ul>
    <details><summary>步骤与完成依据</summary><ol>{definition.steps.map(step => <li key={step.id}>
      <button type="button" className="secondary" aria-expanded={detail?.id === step.id} onClick={() => setStepId(detail?.id === step.id ? null : step.id)}>{step.title}</button>
      {detail?.id === step.id && <><p>{step.instructions}</p><p className="asset-muted">完成依据：{step.produces}</p></>}
    </li>)}</ol></details>
    <details aria-label="工作流效果依据"><summary>效果依据与已知限制</summary>{definition.effects.map(effect => <article key={effect.id}>
      <p><strong>{effectLabels[effect.status]}</strong> · {effect.summary}</p>
      <p className="asset-muted">适用版本：{effect.versionScope}<br/>适用输入：{effect.inputScope}<br/>检查日期：{effect.checkedOn ?? '未登记实测日期'}</p>
      <ul>{effect.limitations.map(value => <li key={value}>{value}</li>)}</ul>
      <a href={`https://github.com/WoJiSama/sceneweave/blob/main/${effect.reference}`} target="_blank" rel="noreferrer">查看证据来源</a>
      {effect.previews.map(preview => <figure key={preview.path}>
        <a href={`${import.meta.env.BASE_URL}${preview.path.slice('public/'.length)}`} target="_blank" rel="noreferrer">
          <img src={`${import.meta.env.BASE_URL}${preview.path.slice('public/'.length)}`} alt={preview.caption} width={preview.width} height={preview.height} loading="lazy"/>
        </a><figcaption>{preview.caption}</figcaption>
      </figure>)}
      {!effect.previews.length && <p className="asset-muted">尚无本目录可直接读取的效果预览。请查看本次实际候选，视觉质量与用户签收另判。</p>}
    </article>)}</details>
    <details><summary>外部助手调用资料</summary><pre>{JSON.stringify(queryWorkflow({ action: 'schema', workflowId }, host), null, 2)}</pre></details>
    {task && <section aria-label="工作流实际任务进度"><p>实际任务：{task.id} · 代次 {task.generation} · {task.status}</p>
      {activeTaskBinding && <p className="asset-muted">任务流程：{activeTaskBinding.id}@{activeTaskBinding.version}{stale ? ' · 定义已变化，保留任务并核对后继续' : ''}</p>}
      {task.authoring && <p>真实草稿修订 {task.authoring.draftRevision}；采用前仍须检查差异及资源。</p>}
      <p>已返回工具结果 {task.tools.length} 条 · 模型请求 {task.usage.requests} 次{task.usage.unknown ? ' · 用量或请求含未知项' : ''}</p>
      {task.tools.at(-1) && <p>最近工具：{task.tools.at(-1)!.name} · {task.tools.at(-1)!.success ? '调用成功，质量仍需审阅' : '调用未通过，请查看诊断'}</p>}
      <p className="asset-muted">继续使用下方原任务的查询、暂停或继续按钮；不会创建新任务来重置进度。</p>
    </section>}
    {feedback && <p role="status" aria-label="工作流当前结果">{feedback}</p>}
  </details>
}
