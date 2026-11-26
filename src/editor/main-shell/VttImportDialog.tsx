import { useEffect, useRef, useState } from 'react'
import './project-storage.css'

export type VttImportInput = { title: string; gridMm: number; attribution: string; license: string; foundry?: { backdrop: File; origin: { x: number; y: number } } }
export default function VttImportDialog({ file, onImport, onClose }: {
  file: File; onImport(file: File, input: VttImportInput, signal: AbortSignal): Promise<void>; onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null), operation = useRef<AbortController | null>(null)
  const [grid, setGrid] = useState('1524'), [attribution, setAttribution] = useState(''), [license, setLicense] = useState('')
  const [backdrop, setBackdrop] = useState<File>(), [x, setX] = useState(''), [y, setY] = useState('')
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const foundry = file.name.toLowerCase().endsWith('.json')
  useEffect(() => {
    const node = dialog.current!
    node.showModal()
    return () => { operation.current?.abort(); node.close() }
  }, [])
  const cancel = () => { if (!operation.current) onClose(); else operation.current.abort() }
  return <dialog ref={dialog} className="project-storage-dialog" aria-labelledby="vtt-import-title" onCancel={event => { event.preventDefault(); cancel() }}>
    <h2 id="vtt-import-title">导入 VTT 地图</h2>
    <p>{file.name}</p>
    <p>{foundry ? '选择 Foundry 单层方格场景的本地底图。场景中的物件、棋子和日志需要另行处理。' : '在新工程中建立底图、墙线、门窗和点光。'} 源位图可能已画入秘密，交付前请核对玩家视角。</p>
    <form className="vtt-import-form" onSubmit={async event => {
      event.preventDefault()
      if (!accepted || operation.current || foundry && (!backdrop || !x || !y)) return
      const controller = new AbortController()
      operation.current = controller; setBusy(true); setError('')
      try {
        await onImport(file, { title: file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || '导入的 VTT 地图',
          gridMm: Number(grid), attribution, license,
          ...(foundry && backdrop ? { foundry: { backdrop, origin: { x: Number(x), y: Number(y) } } } : {}),
        }, controller.signal)
        onClose()
      } catch (failure) {
        setError(controller.signal.aborted ? '已取消 VTT 导入。' : failure instanceof Error ? failure.message : 'VTT 导入失败。')
      } finally { operation.current = null; setBusy(false) }
    }}>
      {foundry && <>
        <label>本地底图<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} required onChange={event => setBackdrop(event.target.files?.[0])}/></label>
        <p>输入 Foundry 画布中底图左上角的像素坐标。没有场景留边时，两项都填 0。</p>
        <label>底图原点 X（像素）<input type="number" step="1" value={x} disabled={busy} required onChange={event => setX(event.target.value)}/></label>
        <label>底图原点 Y（像素）<input type="number" step="1" value={y} disabled={busy} required onChange={event => setY(event.target.value)}/></label>
      </>}
      <label>每格毫米数<input type="number" min="100" max="10000" step="1" value={grid} disabled={busy} required onChange={event => setGrid(event.target.value)}/></label>
      <label>素材来源<input value={attribution} disabled={busy} maxLength={240} required onChange={event => setAttribution(event.target.value)}/></label>
      <label>许可或使用授权<textarea value={license} disabled={busy} maxLength={4000} required onChange={event => setLicense(event.target.value)}/></label>
      <label className="vtt-import-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)}/>我确认有权在工程和备份中使用这份底图。</label>
      {error && <p role="alert">{error}</p>}
      <div className="project-storage-actions">
        <button type="submit" className="primary" disabled={busy || !accepted}>{busy ? '正在校验并保存…' : '导入为新工程'}</button>
        <button type="button" className="secondary" onClick={cancel}>取消</button>
      </div>
    </form>
  </dialog>
}
