import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

/** Only an explicitly successful operation opts into expiry; errors stay visible. */
export default function WorkspaceNotice({ message, transient, onDismiss }: {
  message: string; transient: boolean; onDismiss: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!transient || hovered || focused) return
    const timer = window.setTimeout(onDismiss, 8000)
    return () => window.clearTimeout(timer)
  }, [message, transient, hovered, focused, onDismiss])
  return <div className="asset-notice" role={transient ? 'status' : 'alert'}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
    }}>
    <span>{message}</span><button aria-label="关闭工坊提示" onClick={onDismiss}><X size={16}/></button>
  </div>
}
