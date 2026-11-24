import { lazy, type ComponentType } from 'react'

export function lazyView<Props>(load: () => Promise<{ default: ComponentType<Props> }>, loadFailed: ComponentType<Props>) {
  return lazy(() => load().catch(() => ({ default: loadFailed })))
}
