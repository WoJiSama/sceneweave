import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DomainPreviewMap, LocalGenerationPreview } from '../../application/workspace/workspace'
import { domainGenerationKinds, type DomainGenerationKind } from '../../shared/generation/domains/kinds.js'
import { DomainOperationSession } from './domain-operation-session'

export const GENERATION_DOMAINS = domainGenerationKinds
export type GenerationDomain = DomainGenerationKind
export type GenerationOperationPreviewMap = DomainPreviewMap & { local: LocalGenerationPreview }
export type GenerationOperation = keyof GenerationOperationPreviewMap

const generationOperations = [...GENERATION_DOMAINS, 'local'] as const

export function useDomainOperations(options: {
  sourceKey: string
  checkpoint(): number
  release: { [K in GenerationOperation]: (preview: GenerationOperationPreviewMap[K]) => void }
}) {
  const current = useRef(options)
  current.current = options
  const [operations] = useState(() => new DomainOperationSession<GenerationOperationPreviewMap>({
    domains: generationOperations, sourceKey: options.sourceKey, checkpoint: () => current.current.checkpoint(),
    release: {
      interior: preview => current.current.release.interior(preview), forest: preview => current.current.release.forest(preview),
      volcano: preview => current.current.release.volcano(preview), mixed: preview => current.current.release.mixed(preview),
      local: preview => current.current.release.local(preview),
    },
  }))
  const state = useSyncExternalStore(operations.subscribe, operations.getSnapshot)
  const checkpoint = options.checkpoint()
  useEffect(() => { operations.invalidateSource(checkpoint, options.sourceKey) }, [operations, checkpoint, options.sourceKey])
  useEffect(() => () => operations.dispose(), [operations])
  return { operations, state }
}
