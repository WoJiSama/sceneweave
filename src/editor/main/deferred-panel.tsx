import { Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { lazyView } from '../main-shell/lazy-view'

export function lazyPanel<Props>(load: () => Promise<{ default: ComponentType<Props> }>, name: string) {
  return lazyView(load, () => <p role="alert">{name}加载失败。请检查网络后刷新页面。</p>)
}

/** Delay the first mount and retain the panel's local state on subsequent visits. */
export function DeferredPanel({ open, name, target, children }: {
  open: boolean; name: string; target?: HTMLElement | null; children: ReactNode
}) {
  const [opened, setOpened] = useState(open)
  useEffect(() => { if (open) setOpened(true) }, [open])
  if (!open && !opened) return null
  const loading = <p role="status">正在打开{name}…</p>
  return <Suspense fallback={target ? createPortal(loading, target) : loading}>{children}</Suspense>
}
