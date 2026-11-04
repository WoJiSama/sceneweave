import { AuthoringStartV4Schema, AuthoringStateV4Schema } from '../../src/shared/ai/authoring-protocol-v4.js'
import { authoringProjectHash, authoringSummary } from '../../src/shared/ai/authoring.js'
import { TaskSnapshotSchema } from '../../src/shared/ai/protocol.js'
import { accumulateContinuationUsage } from '../../src/shared/ai/budget-policy.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import type { StoredTask } from './store.js'

const digest = (value: unknown) => sha256Text(canonicalJson(value))
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right)
/** Verify the installed private checkpoint without re-executing a budget-bound
 * draft. Geometry/resources were validated before installation; the browser
 * still performs full cold resource/replay validation before a claim. */
export function assertPersistedAuthoringV4(task: StoredTask): void {
  if (task.authoring?.start.schemaVersion !== 4 && task.authoring?.state.schemaVersion !== 4) return
  const authoring = task.authoring!
  const start = AuthoringStartV4Schema.parse(authoring.start), state = AuthoringStateV4Schema.parse(authoring.state)
  TaskSnapshotSchema.parse(task.snapshot)
  const fail = (): never => { throw new Error('Invalid installed authoring checkpoint') }
  const sourceHash = digest(start.source), policyHash = start.policy.policyHash
  if (authoringProjectHash(start.project) !== start.baseContentHash || start.source.projectHash !== start.baseContentHash
    || authoringProjectHash(start.source.project) !== start.baseContentHash
    || state.sourceHash !== sourceHash || state.policyHash !== policyHash || state.draftRevision !== state.steps.length
    || !same(task.snapshot.authoring, authoringSummary(start, state, authoring.claim?.lease ?? null, authoring.plan, authoring.closeout))) fail()
  const execution = authoring.executionCheckpoint
  if (!execution || execution.schemaVersion !== 4 || !same(task.snapshot.executionCheckpoint, execution)
    || execution.taskId !== task.snapshot.id || execution.flowId !== start.source.flowId || execution.generation !== task.snapshot.generation
    || execution.modelRequests !== task.snapshot.usage.requests || execution.completedRequests !== task.completedRequests
    || execution.toolAttempts !== task.toolAttempts || execution.outputBytes !== task.outputBytes
    || execution.policyHash !== policyHash || execution.sourceHash !== sourceHash
    || execution.ledgerHeadHash !== state.ledgerHeadHash || execution.budgetStateHash !== state.budgetStateHash) fail()
  let previousHash = digest({ capability: start.capability, sourceHash, policyHash }), afterHash = '', aiCost = 0
  const operations = state.steps.flatMap((step, index) => {
    if (step.index !== index + 1 || state.steps.some((other, at) => at < index && other.stepId === step.stepId)) fail()
    return step.operations.map((operation, operationIndex) => ({ operation, operationId: `ai-${digest([step.stepId, operationIndex])}` }))
  })
  if (state.ledger.length !== operations.length + 1) fail()
  let usage = state.ledger[0].usage
  for (const [index, entry] of state.ledger.entries()) {
    const { entryHash, ...body } = entry
    if (entry.sequence !== index + 1 || entry.previousHash !== previousHash || digest(body) !== entryHash) fail()
    if (index === 0) {
      if (entry.category !== (start.source.version === 3 ? 'generation' : 'baseline') || entry.operationHash !== sourceHash || entry.afterHash !== start.baseContentHash
        || entry.beforeHash !== (start.source.version === 3 ? authoringProjectHash(start.source.blank) : start.baseContentHash)
        || entry.operationId !== `${start.source.version === 3 ? 'generation' : 'baseline'}-${sourceHash}`) fail()
    } else {
      const operation = operations[index - 1]
      if (entry.category !== 'ai' || entry.operationId !== operation.operationId || entry.operationHash !== digest(operation.operation)
        || entry.beforeHash !== afterHash) fail()
      aiCost += entry.semanticCost
      usage = accumulateContinuationUsage(usage, entry.usage)
    }
    previousHash = entryHash; afterHash = entry.afterHash
  }
  if (previousHash !== state.ledgerHeadHash || afterHash !== state.contentHash || state.budget.aiCost !== aiCost
    || state.budget.generationCost !== state.ledger[0].semanticCost || state.operationCost !== state.budget.generationCost + aiCost
    || !same(usage, state.budget.usage) || state.budgetStateHash !== digest({ capability: start.capability, policyHash, sourceHash,
      ledgerHeadHash: state.ledgerHeadHash, budget: state.budget })) fail()
  if (authoring.closeout && (authoring.closeout.draftRevision !== state.draftRevision || authoring.closeout.contentHash !== state.contentHash)) fail()
}
