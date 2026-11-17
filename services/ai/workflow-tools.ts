import type { StoredTask } from './store.js'
import { getAuthoringTools } from './authoring-tools.js'
import { publicScreenshotReference } from './visual-review.js'
import type { ConnectionInfo } from '../../src/shared/ai/protocol.js'
import { assertWorkflowBinding, queryWorkflow, WorkflowQuerySchema, workflowBinding } from '../../src/shared/ai/workflows/catalog.js'
import { toolWorkflowHost } from '../../src/shared/ai/workflows/hosts.js'

export function workflowTaskHost(task: StoredTask, connection: ConnectionInfo, remainingToolCalls: number) {
  let tools = task.authoring ? getAuthoringTools(task.authoring.start.scope, task.authoring.start.schemaVersion) : []
  if (!publicScreenshotReference(task) || connection.capabilities.vision !== 'enabled' || !connection.capabilities.visualReviewVersions?.includes(1)) {
    tools = tools.filter(tool => !['sceneweave_visual_review', 'sceneweave_apply_visual_correction'].includes(tool.name))
  }
  const state = task.authoring?.state, lastTool = task.snapshot.tools.at(-1)
  return toolWorkflowHost(task.authoring ? 'authoring' : 'conversation', tools, { remainingToolCalls, progress: {
    taskId: task.snapshot.id, generation: task.snapshot.generation, status: task.snapshot.status,
    baselineHash: state?.contentHash ?? null, draftRevision: state?.draftRevision ?? null,
    lastTool: lastTool ? { name: lastTool.name, success: lastTool.success } : null,
    unknown: task.snapshot.usage.unknown, remainingToolCalls,
  } })
}

export function executeWorkflowQuery(task: StoredTask, raw: unknown, connection: ConnectionInfo, remainingToolCalls: number) {
  const query = WorkflowQuerySchema.parse(raw)
  const prior = 'workflowId' in query ? task.workflowBindings?.find(binding => binding.id === query.workflowId) : undefined
  if (prior) assertWorkflowBinding(prior)
  const output = queryWorkflow(query, workflowTaskHost(task, connection, remainingToolCalls))
  const serialized = JSON.stringify(output)
  if (serialized.length > 8192) throw new Error('工作流详情超过单次输出上限；请按step或单个工具schema读取。')
  if ('workflowId' in query && !prior) (task.workflowBindings ??= []).push(workflowBinding(query.workflowId))
  return serialized
}
