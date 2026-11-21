import type { StoredTask } from './store.js'
import { taskToolCatalog } from './task-tools.js'
import { ToolRejected } from './tool-rejection.js'
import type { ConnectionInfo } from '../../src/shared/ai/protocol.js'
import { assertWorkflowBinding, queryWorkflow, WorkflowQuerySchema, workflowBinding } from '../../src/shared/ai/workflows/catalog.js'
import { toolWorkflowHost } from '../../src/shared/ai/workflows/hosts.js'

export function workflowTaskHost(task: StoredTask, connection: ConnectionInfo, remainingToolCalls: number) {
  const { tools } = taskToolCatalog(task, connection)
  const state = task.authoring?.state, lastTool = task.snapshot.tools.at(-1)
  return toolWorkflowHost(task.authoring ? 'authoring' : 'conversation', tools, { remainingToolCalls, progress: {
    taskId: task.snapshot.id, generation: task.snapshot.generation, status: task.snapshot.status,
    baselineHash: state?.contentHash ?? null, draftRevision: state?.draftRevision ?? null,
    lastTool: lastTool ? { name: lastTool.name, success: lastTool.success } : null,
    unknown: task.snapshot.usage.unknown, remainingToolCalls,
  } })
}

export function executeWorkflowQuery(task: StoredTask, raw: unknown, connection: ConnectionInfo, remainingToolCalls: number) {
  const parsed = WorkflowQuerySchema.safeParse(raw)
  if (!parsed.success) throw new ToolRejected('invalid_arguments')
  const query = parsed.data
  const prior = 'workflowId' in query ? task.workflowBindings?.find(binding => binding.id === query.workflowId) : undefined
  if (prior) assertWorkflowBinding(prior)
  const output = queryWorkflow(query, workflowTaskHost(task, connection, remainingToolCalls))
  const serialized = JSON.stringify(output)
  if (serialized.length > 8192) throw new ToolRejected('tool_output_limit')
  if ('workflowId' in query && !prior) (task.workflowBindings ??= []).push(workflowBinding(query.workflowId))
  return serialized
}
