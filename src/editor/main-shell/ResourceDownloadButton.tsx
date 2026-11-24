import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import SceneweaveLoading from './SceneweaveLoading'
import './resource-download-dialog.css'

export default function ResourceDownloadButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Download size={15} aria-hidden="true"/>自选下载
    </button>
    {open && createPortal(<ResourceDownloadDialog onClose={() => setOpen(false)}/>, document.body)}
  </>
}

function ResourceDownloadDialog({ onClose }: { onClose: () => void }) {
  const heading = useId(), dialog = useRef<HTMLDialogElement>(null)
  const [Panel, setPanel] = useState<typeof import('./ResourceDownloadPanel')['default']>()
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0)
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { element.close() }
  }, [])
  useEffect(() => {
    let active = true
    setFailed(false)
    void import('./ResourceDownloadPanel').then(module => { if (active) setPanel(() => module.default) },
      () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [attempt])
  return <dialog className="modal resource-download-dialog" ref={dialog} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (event.key === 'Escape' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault()
      event.stopPropagation()
    }}>
    <div className="modal-heading"><h2 id={heading}>自选下载</h2>
      <button className="icon-button" type="button" aria-label="关闭自选下载" onClick={onClose}><X size={18}/></button></div>
    {Panel ? <Panel/> : failed ? <div role="alert">素材目录加载失败。<button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>
      : <SceneweaveLoading label="正在打开素材下载目录…"/>}
  </dialog>
}
