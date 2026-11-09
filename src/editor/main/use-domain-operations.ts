import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DomainPreviewMap } from '../../application/workspace/workspace'
import { domainGenerationKinds, type DomainGenerationKind } from '../../shared/generation/domains/registry.js'
import { DomainOperationSession } from './domain-operation-session'

export const GENERATION_DOMAINS = domainGenerationKinds
export type GenerationDomain = DomainGenerationKind

export function useDomainOperations(options: {
  sourceKey: string
  checkpoint(): number
  release: { [K in GenerationDomain]: (preview: DomainPreviewMap[K]) => void }
}) {
  const current = useRef(options)
  current.current = options
  const [operations] = useState(() => new DomainOperationSession<DomainPreviewMap>({
    domains: GENERATION_DOMAINS, sourceKey: options.sourceKey, checkpoint: () => current.current.checkpoint(),
    release: {
      interior: preview => current.current.release.interior(preview), forest: preview => current.current.release.forest(preview),
      volcano: preview => current.current.release.volcano(preview), mixed: preview => current.current.release.mixed(preview),
    },
  }))
  const state = useSyncExternalStore(operations.subscribe, operations.getSnapshot)
  const checkpoint = options.checkpoint()
  useEffect(() => { operations.invalidateSource(checkpoint, options.sourceKey) }, [operations, checkpoint, options.sourceKey])
  useEffect(() => () => operations.dispose(), [operations])
  return { operations, state }
}
