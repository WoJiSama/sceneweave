import { createContext, useContext, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Presentation = {
  reviewTarget: HTMLElement | null
  aiReviewActive?: boolean
  registerReview: (id: string) => () => void
}
export const WorkspacePresentationContext = createContext<Presentation | null>(null)

/** Relocates presentation only; each owner retains its candidate and commit handler. */
export function WorkspaceReview({ children, kind = 'generation' }: { children: ReactNode; kind?: 'generation' | 'ai' }) {
  const context = useContext(WorkspacePresentationContext), id = useId()
  const register = context?.registerReview
  useEffect(() => register?.(id), [register, id])
  const hidden = !!context?.aiReviewActive && kind === 'generation'
  return context ? context.reviewTarget ? createPortal(<div className="workspace-review-slot" data-review-kind={kind} hidden={hidden} inert={hidden}>{children}</div>, context.reviewTarget) : null : <>{children}</>
}
