import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import { toBundle } from '../../application/workspace/project'
import { buildUvttPlan } from '../../shared/export/uvtt'
import { exportUvtt, exportUvttFloors, UVTT_TARGET } from '../../platform/browser/export/uvtt'
import { exportPng } from '../../platform/browser/render/renderer'
import { downloadFile } from '../main-shell/recovery-file'
import { storageBytes } from '../../platform/browser/storage/local-retention'

export default function UvttExportDialog({ project, floorId, onClose }: { project: EditableProject; floorId: string; onClose: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false), [working, setWorking] = useState(false), [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null), dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose
  const [wideMap, setWideMap] = useState(false), [allFloors, setAllFloors] = useState(false)
  const result = useMemo(() => {
    const floors = allFloors ? Object.keys(project.document.floors) : [floorId]
    try {
      return { plans: floors.map(id => ({ id, plan: buildUvttPlan(project.document, project.appearance, id, wideMap) })) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '无法检查 VTT 导出范围。' }
    }
  }, [project, floorId, wideMap, allFloors])
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); if (controller.current) controller.current.abort(); else close.current() }
      if (event.key === 'Tab') {
        const elements = [...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') ?? []]
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
      const bundle = toBundle(project)
      const blob = fallback
        ? await exportPng(bundle, { audience: 'player', floorId, longEdgePx: 4096, signal: abort.signal })
        : allFloors ? await exportUvttFloors(bundle, abort.signal, wideMap) : await exportUvtt(bundle, abort.signal, floorId, wideMap)
      abort.signal.throwIfAborted()
      downloadFile(blob, fallback ? 'sceneweave-player-map.png' : allFloors ? 'sceneweave-vtt-floors.zip' : 'sceneweave-vtt.zip')
      setMessage(fallback ? `玩家 PNG 已生成 · ${storageBytes(blob.size)}。` : `导入包已生成 · ${storageBytes(blob.size)}。请按包内说明在目标软件核对。`)
    } catch (error) { setMessage(abort.signal.aborted ? '已取消，工程保持不变。' : (error as Error).message) }
    finally { controller.current = null; setWorking(false) }
  }
  const blocked = result.plans?.some(({ plan }) => plan.report.blocked.length)
  const warnings = [...new Set(result.plans?.flatMap(({ plan }) => plan.report.warnings))]
  return <div className="modal-scrim workspace-modal-scrim"><div ref={dialog} className="modal workspace-modal uvtt-export-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label="VTT 导出预检">
    <h2>VTT 导出预检</h2>
    <p>{UVTT_TARGET.software} · {UVTT_TARGET.importer}</p>
    <p className="asset-muted">{UVTT_TARGET.verification}。工程 r{project.document.revision}。备用玩家 PNG 使用「{project.document.floors[floorId].name}」的导出范围。</p>
    {result.error && <p role="alert">{result.error}</p>}
    {Object.keys(project.document.floors).length > 1 && <label>导出楼层<select disabled={working} value={allFloors ? 'all' : 'current'} onChange={event => { setAllFloors(event.target.value === 'all'); setAcknowledged(false) }}>
      <option value="current">当前楼层</option><option value="all">全部楼层 · 各自导入</option>
    </select></label>}
    <label>格线清晰度<select disabled={working} value={wideMap ? 'wide' : 'standard'} onChange={event => { setWideMap(event.target.value === 'wide'); setAcknowledged(false) }}>
      <option value="standard">标准 · 至少 50 像素/格</option><option value="wide">大型地图 · 至少 25 像素/格</option>
    </select></label>
    {result.plans && <>
      {result.plans.map(({ id, plan }) => <div key={id}>
        {allFloors && <h3>{project.document.floors[id].name}</h3>}
        {plan.geometry && <>
          <p>{plan.widthPx} × {plan.heightPx} px · 每格 {plan.pixelsPerGrid} px · 每格 {plan.units.distancePerGrid} {plan.units.distanceUnit}</p>
          <p>墙段 {plan.report.counts.wallSegments} · 门窗 {plan.report.counts.portals} · 点光 {plan.report.counts.lights}</p>
        </>}
        {!!plan.report.blocked.length && <div role="alert"><strong>此楼层无法导出结构包</strong><ul>{plan.report.blocked.map(value => <li key={value}>{value}</li>)}</ul></div>}
      </div>)}
      <p className="asset-muted">整格扩边保持世界原点与比例；底图去除格线、注记、门符号和点光。下载时完整检查资源。</p>
      <div><strong>导入后的差异与处理</strong><ul>{warnings.map(value => <li key={value}>{value}</li>)}</ul></div>
      {!blocked && <label><input type="checkbox" checked={acknowledged} disabled={working} onChange={event => setAcknowledged(event.target.checked)}/>我已了解上述降级和导入后的检查事项</label>}
    </>}
    {message && <p role="status">{message}</p>}
    <div className="modal-actions">
      <button className="secondary" onClick={onClose} disabled={working}>关闭</button>
      {working && <button className="secondary" onClick={() => controller.current?.abort()}>取消导出</button>}
      <button className="secondary" onClick={() => void run(true)} disabled={working}>下载玩家 PNG 回退</button>
      <button className="primary" disabled={working || !result.plans || blocked || !acknowledged} onClick={() => void run(false)}>下载 VTT 导入包</button>
    </div>
  </div></div>
}
