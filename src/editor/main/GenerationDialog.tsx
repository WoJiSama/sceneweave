import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import './generation-dialog.css'

export default function GenerationDialog({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const heading = useId()
  useEffect(() => {
    const dialog = ref.current!
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return <dialog ref={ref} className="workspace-modal generation-dialog" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onKeyDown={event => {
      if (event.key === 'Escape' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault()
      event.stopPropagation()
    }}>
    <header className="generation-dialog-header">
      <h2 id={heading}>{title}</h2>
      <button className="icon-button" type="button" aria-label="关闭生成设置" onClick={onClose}><X size={18}/></button>
    </header>
    <div className="generation-dialog-body">{children}</div>
  </dialog>
}
