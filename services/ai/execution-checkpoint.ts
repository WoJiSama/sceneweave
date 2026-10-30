import { z } from 'zod'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import { TaskExecutionCheckpointBodySchema, TaskExecutionCheckpointSchema } from '../../src/shared/ai/protocol.js'

const body = TaskExecutionCheckpointBodySchema
export const AuthoringExecutionCheckpointSchema = TaskExecutionCheckpointSchema
export type AuthoringExecutionCheckpoint = z.infer<typeof AuthoringExecutionCheckpointSchema>
export type ExecutionCheckpointInput = z.infer<typeof body>

/** Server-owned cumulative work. Client receipts never supply any of these counters. */
export function recordAuthoringExecution(input: ExecutionCheckpointInput, previous?: AuthoringExecutionCheckpoint): AuthoringExecutionCheckpoint {
  const captured = body.parse(input), next = { ...captured, uncertain: captured.uncertain ?? false }
  if (previous) {
    const old = AuthoringExecutionCheckpointSchema.parse(previous), { checkpointHash: _hash, ...oldBody } = old
    if (sha256Text(canonicalJson(oldBody)) !== old.checkpointHash) throw new Error('Invalid execution checkpoint')
    if (next.flowId !== old.flowId || next.taskId !== old.taskId || next.policyHash !== old.policyHash || next.sourceHash !== old.sourceHash
      || next.generation < old.generation || next.initializationMs !== old.initializationMs) throw new Error('Execution checkpoint identity changed')
    if (old.uncertain === true && !next.uncertain) throw new Error('Unknown execution consumption cannot be cleared')
    for (const key of ['activeRuntimeMs', 'modelRequests', 'completedRequests', 'toolAttempts', 'outputBytes'] as const) {
      if (next[key] < old[key]) throw new Error('Execution consumption cannot be reset')
    }
  }
  if (next.completedRequests > next.modelRequests || next.activeRuntimeMs < next.initializationMs) throw new Error('Invalid execution counters')
  return { ...next, checkpointHash: sha256Text(canonicalJson(next)) }
}
