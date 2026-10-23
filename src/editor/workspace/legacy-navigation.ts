import { useEffect, useRef } from 'react'

type Leave = (internal: boolean) => Promise<void>
let handler: Leave | null = null

/** Compatibility editors participate in the same route guard, including browser navigation. */
export function useLegacyNavigationGuard(leave: Leave, enabled = true, pending = false, revision?: number) {
  const latest = useRef(leave)
  latest.current = leave
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => {
    if (enabled) window.dispatchEvent(new Event('sceneweave:legacy-commit'))
  }, [enabled, revision])
  useEffect(() => {
    if (!enabled) return
    const registered: Leave = internal => latest.current(internal)
    handler = registered
    const unload = (event: BeforeUnloadEvent) => {
      if (pendingRef.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', unload)
    return () => { if (handler === registered) handler = null; window.removeEventListener('beforeunload', unload) }
  }, [enabled])
}

export async function leaveLegacySession(internal = false) {
  if (!handler) throw new Error('编辑器正在初始化，请稍后再切换。')
  await handler(internal)
}
