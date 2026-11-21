import { z } from 'zod'
import { canonicalJson, captureJson, freezeJson } from '../../validation/json.js'
import { sha256Text } from '../../validation/hash.js'
import { semanticGenerationCapabilities, semanticGenerationExample } from '../../generation/semantic-request.js'
import { WORKFLOW_DEFINITIONS } from './catalog.generated.js'
import { oceanDressingSettingsSchema } from '../../ocean/generation.js'

export const WorkflowRequirementSchema = z.enum(['forest-parameters', 'forest-generation', 'project-preview', 'project-delivery',
  'draft-read', 'draft-edit', 'draft-check', 'page-adopt', 'image-read', 'image-select', 'image-preview', 'image-build',
  'image-repair', 'image-repair-analysis', 'image-surface-refine', 'asset-refine', 'ocean-generation', 'floor-navigation'])
export type WorkflowRequirement = z.infer<typeof WorkflowRequirementSchema>
const text = z.string().min(1).max(4096), hash = z.string().regex(/^[a-f0-9]{64}$/)
const stepSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), title: text, requires: z.array(WorkflowRequirementSchema).min(1).max(8), produces: text, instructions: text }).strict()
const previewSchema = z.object({ path: z.string().regex(/^public\/assets\/workflows\/[a-z0-9-]+\.png$/), sha256: hash,
  width: z.number().int().positive(), height: z.number().int().positive(), audience: z.literal('player'),
  caption: text, provenance: z.string().regex(/^workflows\/examples\/[a-z0-9-]+\.json$/) }).strict()
const effectSchema = z.object({ id: text, status: z.enum(['historical', 'partial', 'unverified']), versionScope: text, inputScope: text,
  summary: text, limitations: z.array(text).max(16), reference: z.string().regex(/^docs\/[a-zA-Z0-9/#._-]+$/),
  checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), previews: z.array(previewSchema).max(8) }).strict()
const definitionSchema = z.object({ id: z.string().regex(/^sceneweave-[a-z0-9-]+$/), version: z.number().int().positive(),
  title: text, summary: text, tags: z.array(text).max(16), inputSchemaRef: text, source: text,
  steps: z.array(stepSchema).min(1).max(16), effects: z.array(effectSchema).max(16), definitionHash: hash }).strict()
export type WorkflowDefinition = z.infer<typeof definitionSchema>
export const WorkflowBindingSchema = definitionSchema.pick({ id: true, version: true, definitionHash: true })
export type WorkflowBinding = z.infer<typeof WorkflowBindingSchema>

const definitions = freezeJson(z.array(definitionSchema).parse(WORKFLOW_DEFINITIONS))
for (const { definitionHash, ...definition } of definitions) {
  if (sha256Text(canonicalJson(definition)) !== definitionHash) throw new Error('共享工作流定义摘要不匹配。')
}

export interface WorkflowCapability {
  state: 'available' | 'page-only' | 'not-connected' | 'missing-input' | 'not-authorized' | 'budget-exhausted'
  entry: string
  reason: string
  /** Names from the host's real catalogue, never accepted in model arguments. */
  toolNames?: string[]
}
export interface WorkflowHost {
  name: 'page' | 'conversation' | 'authoring' | 'harness' | 'image-mcp'
  capabilities: Partial<Record<WorkflowRequirement, WorkflowCapability>>
  tools: Array<{ name: string; parameters: Record<string, unknown> }>
  /** Redacted, host-owned current checkpoint; no whole scene or private text. */
  progress?: { taskId: string; generation: number; status: string; baselineHash: string | null;
    draftRevision: number | null; lastTool: { name: string; success: boolean } | null; unknown: boolean; remainingToolCalls: number | null }
}

export const WorkflowQuerySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), query: z.string().trim().max(120).optional() }).strict(),
  ...(['read', 'effects'] as const).map(action => z.object({ action: z.literal(action), workflowId: z.string().max(100), definitionHash: hash.optional() }).strict()),
  z.object({ action: z.literal('schema'), workflowId: z.string().max(100), toolName: z.string().max(128).optional(), definitionHash: hash.optional() }).strict(),
  z.object({ action: z.literal('step'), workflowId: z.string().max(100), stepId: z.string().max(64), definitionHash: hash.optional() }).strict(),
  z.object({ action: z.literal('progress') }).strict(),
])
export type WorkflowQuery = z.infer<typeof WorkflowQuerySchema>
export const WORKFLOW_DISCOVERY_TOOL = freezeJson({ name: 'sceneweave_workflow',
  description: 'Discover task workflows, actual host capability/limitations and evidence. Start with list, then read, step, schema or effects as needed. progress reads the current redacted checkpoint. Guidance grants no tools or edit rights.',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'read', 'step', 'effects', 'schema', 'progress'] },
    query: { type: 'string', maxLength: 120 }, workflowId: { type: 'string', maxLength: 100 }, stepId: { type: 'string', maxLength: 64 },
    toolName: { type: 'string', maxLength: 128 }, definitionHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, required: ['action'], additionalProperties: false },
})

export function getWorkflow(id: string): WorkflowDefinition {
  const definition = definitions.find(value => value.id === id)
  if (!definition) throw new Error('未知工作流；请先读取当前目录。')
  return definition
}
export function workflowBinding(id: string): WorkflowBinding {
  const { version, definitionHash } = getWorkflow(id)
  return freezeJson({ id, version, definitionHash })
}
export function assertWorkflowBinding(raw: unknown): WorkflowBinding {
  const binding = WorkflowBindingSchema.parse(captureJson(raw)), actual = workflowBinding(binding.id)
  if (binding.version !== actual.version || binding.definitionHash !== actual.definitionHash) throw new Error('工作流定义已变化或版本不可用；保留原任务，请核对后再继续。')
  return freezeJson(binding)
}
export function workflowCapabilityHash(host: WorkflowHost): string {
  return sha256Text(canonicalJson({ name: host.name, capabilities: host.capabilities, tools: host.tools,
    checkpoint: host.progress ? { taskId: host.progress.taskId, generation: host.progress.generation, baselineHash: host.progress.baselineHash } : null }))
}
const capability = (host: WorkflowHost, requirement: WorkflowRequirement): WorkflowCapability => host.capabilities[requirement]
  ?? { state: 'not-connected', entry: '', reason: '当前宿主尚未接入此执行能力；可查看流程与其他入口。' }
const describeStep = (step: WorkflowDefinition['steps'][number], host: WorkflowHost) => ({ id: step.id, title: step.title,
  produces: step.produces, requirements: step.requires.map(id => ({ id, ...capability(host, id) })) })

/** Bounded summaries carry no full procedure, parameter catalogue or historic logs. */
export function listWorkflows(host: WorkflowHost, query = '') {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return definitions.filter(definition => terms.every(term => [definition.id, definition.title, definition.summary, ...definition.tags].join(' ').toLowerCase().includes(term)))
    .map(definition => ({ ...workflowBinding(definition.id), title: definition.title, summary: definition.summary,
      capabilities: [...new Set(definition.steps.flatMap(step => step.requires))].map(id => ({ id, ...capability(host, id) })) }))
}

/** The host supplies real schemas/availability. Model input can only select a
 * bounded definition/step; it cannot replace the host, grant or checkpoint. */
export function queryWorkflow(raw: unknown, host: WorkflowHost) {
  const query = WorkflowQuerySchema.parse(captureJson(raw))
  const envelope = { format: 'sceneweave-workflow-discovery', schemaVersion: 1, host: host.name, capabilityHash: workflowCapabilityHash(host) }
  if (query.action === 'list') return { ...envelope, workflows: listWorkflows(host, query.query) }
  if (query.action === 'progress') return { ...envelope, progress: host.progress ?? null,
    note: '进度来自当前宿主实际记录；工具成功不等于目视通过或主工程采用。' }
  const definition = getWorkflow(query.workflowId), binding = workflowBinding(definition.id)
  if (query.definitionHash && query.definitionHash !== binding.definitionHash) throw new Error('工作流定义摘要已变化，请重新读取目录并核对原进度。')
  const selected = { ...envelope, workflow: binding }
  if (query.action === 'effects') return { ...selected, effects: definition.effects,
    previewAvailability: '登记预览的path为仓库文件，页面使用去掉public/前缀的同源静态地址，构建核对实际PNG摘要和尺寸；读取图片仍需宿主视觉能力。空列表表示无可直接读取预览，历史/本机附件未证明可访问。',
    timing: null, cost: null, userAcceptance: 'unverified' }
  if (query.action === 'schema') {
    const names = new Set(definition.steps.flatMap(step => step.requires.flatMap(requirement => capability(host, requirement).toolNames ?? [])))
    return { ...selected, inputSchemaRef: definition.inputSchemaRef,
      ...(definition.inputSchemaRef === 'semanticGenerationRequestSchema' ? { inputSchema: semanticGenerationCapabilities().inputSchema, example: semanticGenerationExample() } : {}),
      ...(definition.inputSchemaRef === 'oceanDressingSettingsSchema' ? { inputSchema: z.toJSONSchema(oceanDressingSettingsSchema), example: { recipeVersion: 2, seed: 'terrain-v1-0', preset: 'calm', boat: true, creatures: true }, note: '此schema定义底图后的有限布景步骤；页面自然地形勾选海洋选项使用固定默认设置。宿主是否提供执行入口仍由capabilities决定。' } : {}),
      tools: host.tools.filter(tool => names.has(tool.name) && (!query.toolName || tool.name === query.toolName))
        .map(tool => query.toolName ? tool : { name: tool.name }),
      note: '工具详情已随宿主tools/list提供；本入口可用toolName按需读取单个schema。' }
  }
  if (query.action === 'step') {
    const step = definition.steps.find(value => value.id === query.stepId)
    if (!step) throw new Error('未知步骤；请读取工作流中的实际步骤ID。')
    return { ...selected, step: { ...describeStep(step, host), instructions: step.instructions } }
  }
  return { ...selected, title: definition.title, summary: definition.summary, inputSchemaRef: definition.inputSchemaRef,
    source: definition.source, steps: definition.steps.map(step => describeStep(step, host)),
    next: '按需读取step、schema或effects；先满足当前步骤的真实能力条件。' }
}

/** A short bootstrap replaces unconditional injection of all specialist text. */
export const WORKFLOW_DISCOVERY_INSTRUCTIONS = [
  'Shared Sceneweave workflows: sceneweave-project-creation@1. Start with sceneweave_workflow action=list to find the relevant workflow.',
  ...definitions.map(definition => `${definition.id}@${definition.version}: ${definition.summary}`),
  'Read only the needed workflow/step/schema/effects. Actual host tools, scope, inputs and remaining budgets decide execution; a workflow grants no capability.',
  'Use progress and actual tool results/previews to continue. Report unsupported requirements and unknown quality; preserve source data, checkpoints and unknown paid requests.',
].join('\n')
