export type OperationRejectionCode = 'outside_scope' | 'locked_dependency' | 'operation_budget' | 'invalid_geometry' | 'invalid_svg' | 'stale_generation' | 'stale_candidate'

/** Carries a stable classification alongside the local diagnostic. Public callers still redact the message. */
export class OperationRejected extends Error {
  constructor(readonly code: OperationRejectionCode, message: string) {
    super(message)
    this.name = 'OperationRejected'
  }
}
