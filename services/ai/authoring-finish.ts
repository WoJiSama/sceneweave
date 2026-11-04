import { AuthoringCloseoutV4Schema, type AuthoringCloseoutV4 } from '../../src/shared/ai/authoring-closeout.js'
import { authoringProjectHash, remainingAuthoringOperations } from '../../src/shared/ai/authoring.js'
import type { StoredTask } from './store.js'

/** Read the last fully installed state. A budget finish must not spend a new
 * validation/model round or erase the valid generated baseline when A is zero. */
export function buildAuthoringCloseout(task: StoredTask, reason: AuthoringCloseoutV4['reason'], remainingExecutionMs: number,
  limits: { modelRequests: number; toolCalls: number }): AuthoringCloseoutV4 {
  const authoring = task.authoring!
  if (authoring.start.schemaVersion !== 4 || authoring.state.schemaVersion !== 4) throw new Error('Unsupported closeout protocol')
  const start = authoring.start, state = authoring.state
  const beforeHash = start.source.version === 3 ? authoringProjectHash(start.source.blank) : start.baseContentHash
  return AuthoringCloseoutV4Schema.parse({ reason, draftRevision: state.draftRevision, contentHash: state.contentHash,
    reviewable: state.contentHash !== beforeHash, requestOutcome: task.snapshot.usage.requests === 0 ? 'not_sent'
      : task.completedRequests < task.snapshot.usage.requests ? 'unknown' : 'finished',
    remainingOperations: Math.max(0, remainingAuthoringOperations(start, state)),
    remainingModelRequests: Math.max(0, limits.modelRequests - task.snapshot.usage.requests),
    remainingToolCalls: Math.max(0, limits.toolCalls - task.toolAttempts), remainingExecutionMs: Math.max(0, Math.floor(remainingExecutionMs)),
    requirements: (start.brief?.requirements ?? []).map((_, index) => {
      const claim = authoring.plan?.requirements.find(item => item.index === index)
      return { index, status: claim?.state === 'unsupported' ? 'unsupported' : claim?.state === 'pending' || !claim ? 'pending' : 'needs_human_review' }
    }), appearanceReview: 'unconfirmed' })
}
