import { useEffect, useState } from 'react'

export type StarterCatalog = typeof import('../../platform/browser/content/starter-catalog')

const loadStarter = () => import('../../platform/browser/content/starter-catalog')
export const loadBuiltinIndex = () => import('../../platform/browser/content/builtin-index').then(module => module.default)

export function useCatalogModule<T>(load: () => Promise<T>, enabled: boolean, demanded: boolean) {
  const [catalog, setCatalog] = useState<T>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || !demanded || catalog) return
    let active = true
    setError('')
    void load().then(value => {
      if (active) setCatalog(() => value)
    }, reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [load, enabled, demanded, catalog, attempt])
  return { catalog: enabled ? catalog : undefined, error: enabled && demanded ? error : '', retry: () => setAttempt(value => value + 1) }
}

export function useStarterCatalog(enabled: boolean, demanded: boolean) {
  return useCatalogModule(loadStarter, enabled, demanded)
}
