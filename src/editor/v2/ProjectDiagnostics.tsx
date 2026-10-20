import { CheckCircle2, ShieldAlert, X } from 'lucide-react'
import type { ProjectDiagnosticsV2 } from '../../io/v2/project-file'
import './project-diagnostics.css'

export interface ProjectDiagnosticsNoticeV2 { source: string; report: ProjectDiagnosticsV2 }

export default function ProjectDiagnostics({ notice, onClose, onChooseFile }: {
  notice: ProjectDiagnosticsNoticeV2; onClose: () => void; onChooseFile: () => void
}) {
  const { source, report } = notice, summary = report.summary
  const limited = report.issues.some(issue => issue.code === 'DIAGNOSTIC_LIMIT')
  return <section className={`asset-diagnostics ${report.complete ? 'complete' : 'incomplete'}`} aria-label="工程完整性检查">
    <div className="asset-diagnostics-heading">
      {report.complete ? <CheckCircle2 size={17}/> : <ShieldAlert size={17}/>}
      <div><strong>{report.complete ? '完整工程检查通过' : limited ? '工程未通过检查 · 问题清单' : `工程未通过检查 · ${report.issues.length} 项问题`}</strong><span>{source}</span></div>
      {!report.complete && <button className="secondary" onClick={onChooseFile}>选择修复后的工程</button>}
      <button className="icon-button" aria-label="关闭完整性检查" onClick={onClose}><X size={16}/></button>
    </div>
    {report.complete && summary ? <dl className="asset-diagnostics-summary">
      <div><dt>位图素材</dt><dd>{summary.assets} 项 · {summary.bitmapBlobs} 份图片</dd></div>
      <div><dt>固定定义</dt><dd>{summary.materials} 种材质 · {summary.propDefinitions} 件物件 · {summary.prefabDefinitions} 个组合 · {summary.styleThemes} 个主题</dd></div>
      <div><dt>来源许可</dt><dd>{summary.licenseBindings} 项绑定 · {summary.licenseTexts} 份文本</dd></div>
    </dl> : <>
      <p>补齐或修复所列内容后再打开完整工程。当前工程与存档未被替换。</p>
      <details open><summary>查看问题与依赖位置</summary><ol>{report.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>
        <span>{issue.message}</span>
        {(issue.entityId || issue.dependencyId || issue.path || issue.sha256) && <small>
          {issue.entityId && <span>对象：{issue.entityId}</span>}{issue.dependencyId && <span>依赖：{issue.dependencyId}</span>}
          {issue.path && <span>包内文件：{issue.path}</span>}{issue.sha256 && <span>图片标识：{issue.sha256}</span>}
        </small>}
      </li>)}</ol></details>
    </>}
  </section>
}
