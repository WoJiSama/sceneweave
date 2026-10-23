import { useMemo, useState } from 'react'
import type { CompositionCommandV6 } from '../../core/v6/types'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { buildAuthoringPlanV6, type AuthoringRecipeIdV6 } from './authoring-recipes'
import './AuthoringGuide.css'

export interface AuthoringGuideProps {
  project: CompleteProjectV6
  disabled: boolean
  onPreview: (commands: CompositionCommandV6[], description: string) => void
  onAdoptRequiredCatalog?: (catalogIds: string[]) => void
}
export default function AuthoringGuide({ project, disabled, onPreview, onAdoptRequiredCatalog }: AuthoringGuideProps) {
  const [recipe, setRecipe] = useState<AuthoringRecipeIdV6>('scn-01')
  const plan = useMemo(() => buildAuthoringPlanV6(project, recipe), [project, recipe])
  const completed = plan.stages.filter(stage => stage.status === 'complete').length
  const next = plan.stages.find(stage => stage.status === 'ready' || stage.status === 'blocked')
  return <section className="authoring-guide" aria-label="场景分步制作">
    <h3>从空白分步制作</h3>
    <p>选择固定基线，逐步查看坐标、预览并采用。现有场景不会被样板替换。</p>
    <label className="asset-select">制作基线<select aria-label="制作基线" value={recipe} disabled={disabled} onChange={event => setRecipe(event.target.value as AuthoringRecipeIdV6)}>
      <option value="scn-01">SCN-01 雾灯宅</option><option value="scn-04">SCN-04 海岸哨所</option>
    </select></label>
    <p role="status">当前内容匹配 {completed}/{plan.stages.length} 步{next ? `；下一步：${next.title}` : '；固定制作步骤已匹配，仍须完成保存、往返与验收检查。'}</p>
    {!!plan.missingCatalogIds.length && <div className="authoring-guide-catalog"><p>雾灯宅基础家具尚缺 {plan.missingCatalogIds.length} 件固定素材；从内置素材库采用后才能预览布景。</p>
      {onAdoptRequiredCatalog && <button className="secondary asset-wide" disabled={disabled} onClick={() => onAdoptRequiredCatalog([...plan.missingCatalogIds])}>预览采用缺少的室内素材</button>}
    </div>}
    <ol>{plan.stages.map(stage => <li key={stage.id} data-authoring-stage={stage.id} data-status={stage.status}>
      <details open={stage.status === 'ready' || stage.status === 'blocked'}>
        <summary><span>{stage.title}</span><small>{stage.status === 'complete' ? '已匹配' : stage.status === 'ready' ? '可预览' : stage.status === 'blocked' ? '需处理' : '待前序'}</small></summary>
        {stage.instructions.map((text, index) => <p key={index}>{text}</p>)}
        {stage.reason && <p className="authoring-guide-reason">{stage.reason}</p>}
        {stage.status === 'ready' && <button className="secondary asset-wide" disabled={disabled} onClick={() => onPreview(structuredClone(stage.commands), `${plan.title}：${stage.title}`)}>预览本步 · {stage.commands.length} 条指令</button>}
      </details>
    </li>)}</ol>
    <details><summary>制作范围与后续检查</summary>{plan.limitations.map(text => <p key={text}>{text}</p>)}</details>
  </section>
}
