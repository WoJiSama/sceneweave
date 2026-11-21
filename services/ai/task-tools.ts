import { z } from 'zod'
import type { ConnectionInfo } from '../../src/shared/ai/protocol.js'
import { FOREST_ACTION_TOOL } from '../../src/shared/ai/forest-loop.js'
import { WORKFLOW_DISCOVERY_TOOL } from '../../src/shared/ai/workflows/catalog.js'
import { getAuthoringTools } from './authoring-tools.js'
import type { ProviderToolDefinition } from './provider-types.js'
import type { StoredTask } from './store.js'
import { publicScreenshotReference, visualReviewV4Tools } from './visual-review.js'

export const connectionArguments = z.object({ topic: z.literal('connection') }).strict()
const connectionTool: ProviderToolDefinition = { name: 'sceneweave_connection_info', description: 'Read this Sceneweave connection and its actual supported capabilities. This does not read or change any scene.', parameters: { type: 'object', properties: { topic: { type: 'string', enum: ['connection'] } }, required: ['topic'], additionalProperties: false } }
const visualReviewNames = new Set(visualReviewV4Tools.map(tool => tool.name))

function visualReviewReadiness(task: StoredTask, connection: ConnectionInfo) {
  if (connection.capabilities.vision !== 'enabled' || !connection.capabilities.visualReviewVersions?.includes(1)) {
    return { code: 'vision_disabled', screenshotRef: null } as const
  }
  const screenshotRef = publicScreenshotReference(task)
  return { code: screenshotRef ? null : 'stale_screenshot', screenshotRef } as const
}

export function taskToolCatalog(task: StoredTask, connection: ConnectionInfo) {
  const configured: ProviderToolDefinition[] = task.forestLoop ? [FOREST_ACTION_TOOL]
    : task.authoring ? [...getAuthoringTools(task.authoring.start.scope, task.authoring.start.schemaVersion), WORKFLOW_DISCOVERY_TOOL]
      : [connectionTool, WORKFLOW_DISCOVERY_TOOL]
  const hasVisualReview = configured.some(tool => visualReviewNames.has(tool.name))
  const review = hasVisualReview ? visualReviewReadiness(task, connection) : null
  return {
    tools: configured.filter(tool => !visualReviewNames.has(tool.name) || !review?.code),
    screenshotRef: review?.screenshotRef ?? null,
    rejection(name: string, current: StoredTask) {
      if (!configured.some(tool => tool.name === name)) return 'unsupported_tool' as const
      // A preceding tool in the same turn can change the draft. An initially
      // unavailable tool also has to wait for a new model turn and catalogue.
      return visualReviewNames.has(name) ? review?.code ?? visualReviewReadiness(current, connection).code : null
    },
  }
}
