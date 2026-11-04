import { z } from 'zod'
import { PublicScreenshotRefV4Schema } from '../../shared/ai/authoring-closeout'
import type { ToolResult } from '../../shared/ai/protocol'
import { sameBudgetIdentity } from '../../platform/browser/ai/client'

const issue = z.object({ observation: z.string().max(1000), uncertainty: z.string().max(500),
  target: z.union([z.object({ kind: z.literal('entities'), ids: z.array(z.string().max(256)).max(256) }).strict(),
    z.object({ kind: z.literal('region'), boundsMm: PublicScreenshotRefV4Schema.shape.boundsMm }).strict()]) }).strict()
const review = z.object({ issues: z.array(issue).max(16),
  omissions: z.array(z.object({ requirementIndex: z.number().int().min(0).max(15), status: z.enum(['pending', 'unsupported', 'unreviewed']), reason: z.string().max(500) }).strict()).max(16),
  actualOperationCost: z.number().int().nonnegative(), atDraftRevision: z.number().int().nonnegative(),
  atContentHash: z.string().regex(/^[a-f0-9]{64}$/), screenshotBinding: PublicScreenshotRefV4Schema,
  appearance: z.literal('unconfirmed'), observation: z.literal('unverified'),
})

/** A model observation is never a project credential, automatic edit or visual acceptance. */
export default function AiDraftReview({ tool, taskId, generation, draftRevision, contentHash, authoring }: {
  tool: ToolResult; taskId: string; generation: number; draftRevision?: number; contentHash?: string; authoring?: unknown
}) {
  if (tool.name !== 'sceneweave_visual_review' || !tool.success) return null
  let value: z.infer<typeof review>
  try { value = review.parse(JSON.parse(tool.output)) } catch { return null }
  const current = value.screenshotBinding.taskId === taskId && value.screenshotBinding.generation === generation
    && value.screenshotBinding.draft.expectedGeneration === generation && sameBudgetIdentity(value.screenshotBinding.draft, authoring)
    && value.atDraftRevision === draftRevision && value.atContentHash === contentHash
    && value.screenshotBinding.draft.draftRevision === value.atDraftRevision
    && value.screenshotBinding.draft.contentHash === value.atContentHash
  return <section className="ai-visual-review" aria-label="AI 实际画面复核">
    <strong>模型画面观察 · 外观待人工确认</strong>
    <p>玩家 PNG · 草稿 {value.atDraftRevision} · {value.screenshotBinding.width} × {value.screenshotBinding.height} px。{current ? '图片与当前任务和草稿一致。' : '此报告属于历史草稿或代次，不能据此修改当前内容。'}</p>
    <ol>{value.issues.map((item, index) => <li key={index}><p>{item.observation}</p><p>不确定性：{item.uncertainty}</p><small>{item.target.kind === 'entities' ? `公开目标 ${item.target.ids.length} 项` : `明确区域 ${item.target.boundsMm.width} × ${item.target.boundsMm.height} mm`}</small></li>)}</ol>
    {!!value.omissions.length && <><p>仍未独立确认的要求：</p><ol>{value.omissions.map(item => <li key={item.requirementIndex}>清单第 {item.requirementIndex + 1} 项 · {({ pending: '待完成', unsupported: '暂不支持', unreviewed: '待人工核对' } as const)[item.status]}：{item.reason}</li>)}</ol></>}
    <p>有限修正候选的实际操作成本：{value.actualOperationCost}。该复核仅提出候选；后续修正须重新核对原图和完整草稿身份，并进入正常事务账本。</p>
    <small>模型文字和结构验证均不代表画面验收通过；最终采用仍须本机真实资源校验、人工审阅和保护快照。</small>
  </section>
}
