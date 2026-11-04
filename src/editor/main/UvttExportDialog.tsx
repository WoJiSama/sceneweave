import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import { toBundle } from '../../application/workspace/project'
import { buildUvttPlan } from '../../shared/export/uvtt'
import { exportUvtt, UVTT_TARGET } from '../../platform/browser/export/uvtt'
import { exportPng } from '../../platform/browser/render/renderer'

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function UvttExportDialog({ project, onClose }: { project: EditableProject; onClose: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false), [working, setWorking] = useState(false), [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null), dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose
  const result = useMemo(() => { try { return { plan: buildUvttPlan(project.document, project.appearance) } } catch (error) { return { error: (error as Error).message } } }, [project])
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (controller.current) controller.current.abort(); else close.current() }
      if (event.key === 'Tab') {
        const elements = [...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') ?? []]
        const first = elements[0], last = elements.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { controller.current?.abort(); document.removeEventListener('keydown', key); origin?.focus() }
  }, [])
  const run = async (fallback: boolean) => {
    if (controller.current) return
    const abort = new AbortController(); controller.current = abort; setWorking(true); setMessage('正在验证完整资源并生成图片…')
    try {
      const blob = fallback ? await exportPng(toBundle(project), { audience: 'player', longEdgePx: 4096, signal: abort.signal }) : await exportUvtt(toBundle(project), abort.signal)
      download(blob, fallback ? 'sceneweave-player-map.png' : 'sceneweave-vtt.zip')
      setMessage(fallback ? '玩家 PNG 已生成。' : '导入包已生成；请按包内说明在目标软件核对。')
    } catch (error) { setMessage(abort.signal.aborted ? '已取消，工程保持不变。' : (error as Error).message) }
    finally { controller.current = null; setWorking(false) }
  }
  const plan = result.plan
  return <div className="modal-scrim"><div ref={dialog} className="modal uvtt-export-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label="VTT 导出预检">
    <h2>VTT 导出预检</h2>
    <p>{UVTT_TARGET.software} · {UVTT_TARGET.importer}</p>
    <p className="asset-muted">{UVTT_TARGET.verification}。当前工程 r{project.document.revision} 的独立导出副本。</p>
    {result.error && <p role="alert">{result.error}</p>}
    {plan && <>
      <p>{plan.widthPx} × {plan.heightPx} px · 每格 {plan.pixelsPerGrid} px · 每格 {plan.units.distancePerGrid} {plan.units.distanceUnit}</p>
      <p>墙段 {plan.report.counts.wallSegments} · 门窗 {plan.report.counts.portals} · 点光 {plan.report.counts.lights}</p>
      <p className="asset-muted">整格扩边保持世界原点与比例；底图去除格线、注记、门符号和点光。下载时完整检查资源。</p>
      {!!plan.report.blocked.length && <div role="alert"><strong>此场景不能安全导出结构包</strong><ul>{plan.report.blocked.map((value, i) => <li key={i}>{value}</li>)}</ul></div>}
      {!!plan.report.warnings.length && <div><strong>导入后的差异与处理</strong><ul>{plan.report.warnings.map((value, i) => <li key={i}>{value}</li>)}</ul></div>}
      {!plan.report.blocked.length && <label><input type="checkbox" checked={acknowledged} disabled={working} onChange={event => setAcknowledged(event.target.checked)}/>我已了解上述降级和导入后的检查事项</label>}
    </>}
    {message && <p role="status">{message}</p>}
    <div className="modal-actions">
      <button onClick={onClose} disabled={working}>关闭</button>
      {working && <button onClick={() => controller.current?.abort()}>取消导出</button>}
      <button onClick={() => void run(true)} disabled={working}>下载玩家 PNG 回退</button>
      <button className="primary" disabled={working || !plan || !!plan.report.blocked.length || !acknowledged} onClick={() => void run(false)}>下载 VTT 导入包</button>
    </div>
  </div></div>
}
