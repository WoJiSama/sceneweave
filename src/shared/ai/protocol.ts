import { z } from 'zod'
import { AUTHORING_LIMITS, AuthoringStartSchema, AuthoringSummarySchema } from './authoring-protocol.js'
import { VisionInputSchema } from './vision.js'

// Conversation and explicitly scoped scene/artwork drafts use separate execution budgets.
export const AI_LIMITS = Object.freeze({ promptBytes: 16_384, requestBytes: 32_768, outputBytes: 65_536,
  modelRequests: 4, toolCalls: 8, maxOutputTokensPerRequest: 1024, events: 2048,
  executionMs: 120_000, retentionDays: 7, taskBytes: 16 * 1024 * 1024, storageBytes: 256 * 1024 * 1024, tasks: 256 })
export const utf8Size = (text: string) => { let bytes = 0; for (const char of text) { const point = char.codePointAt(0)!; bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4 }; return bytes }
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/)
const prompt = z.string().trim().min(1).max(16_384).refine(value => utf8Size(value) <= AI_LIMITS.promptBytes, '请求文字超过16KiB。')
export const TaskContextSchema = z.object({ sceneId: id, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), audience: z.literal('public') }).strict().nullable()
export const ReasoningEffortSchema = z.enum(['low', 'high', 'max'])
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>
export const CreateTaskSchema = z.object({ schemaVersion: z.literal(1), clientRequestId: z.string().uuid(), prompt, context: TaskContextSchema, reasoningEffort: ReasoningEffortSchema.optional(), authoring: AuthoringStartSchema.optional(), vision: VisionInputSchema.optional() }).strict()
export type CreateTaskRequest = z.infer<typeof CreateTaskSchema>
export type TaskContext = z.infer<typeof TaskContextSchema>
export const TaskStatusSchema = z.enum(['running', 'paused', 'completed', 'cancelled', 'failed', 'expired', 'waiting_browser', 'ready', 'applying', 'applied'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>
export const isTerminalTask = (status: TaskStatus) => ['completed', 'cancelled', 'failed', 'expired', 'applied'].includes(status)
export const AiErrorSchema = z.object({ code: z.string().min(1).max(64), message: z.string().max(512), retryable: z.boolean(), requestState: z.enum(['not_sent', 'unknown', 'finished']) }).strict()
export type AiError = z.infer<typeof AiErrorSchema>
export const TaskUsageSchema = z.object({ inputTokens: z.number().int().min(0).nullable(), outputTokens: z.number().int().min(0).nullable(), requests: z.number().int().min(0), unknown: z.boolean() }).strict()
export type TaskUsage = z.infer<typeof TaskUsageSchema>
export const ToolResultSchema = z.object({ callId: id, name: id, success: z.boolean(), output: z.string().max(8192) }).strict()
export type ToolResult = z.infer<typeof ToolResultSchema>
const envelope = { schemaVersion: z.literal(1), taskId: id, sequence: z.number().int().positive(), generation: z.number().int().positive() }
export const TaskEventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('text_delta'), data: z.object({ text: z.string().max(8192) }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('tool_started'), data: z.object({ callId: id, name: id }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('tool_result'), data: ToolResultSchema }).strict(),
  z.object({ ...envelope, type: z.literal('status'), data: z.object({ status: TaskStatusSchema, reason: z.string().max(512).nullable() }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('usage'), data: TaskUsageSchema }).strict(),
  z.object({ ...envelope, type: z.literal('error'), data: AiErrorSchema }).strict(),
  z.object({ ...envelope, type: z.literal('draft_updated'), data: AuthoringSummarySchema }).strict(),
])
export type TaskEvent = z.infer<typeof TaskEventSchema>
export const TaskSnapshotSchema = z.object({ schemaVersion: z.literal(1), id, clientRequestId: z.string().uuid(), context: TaskContextSchema, reasoningEffort: ReasoningEffortSchema.nullable().optional(),
  status: TaskStatusSchema, generation: z.number().int().positive(), lastSequence: z.number().int().min(0),
  text: z.string().refine(value => utf8Size(value) <= AI_LIMITS.outputBytes), tools: z.array(ToolResultSchema).max(AUTHORING_LIMITS.toolCalls),
  usage: TaskUsageSchema, error: AiErrorSchema.nullable(), createdAt: z.number().int().min(0), updatedAt: z.number().int().min(0), expiresAt: z.number().int().min(0), authoring: AuthoringSummarySchema.optional() }).strict().superRefine((value, ctx) => {
    if (!value.authoring && value.tools.length > AI_LIMITS.toolCalls) ctx.addIssue({ code: 'custom', path: ['tools'], message: 'Conversation tool budget exceeded.' })
  })
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>
export const ControlTaskSchema = z.object({ schemaVersion: z.literal(1), expectedGeneration: z.number().int().positive(), action: z.enum(['pause', 'cancel', 'resume']), prompt: prompt.optional(), vision: VisionInputSchema.optional() }).strict()
export type ControlTaskRequest = z.infer<typeof ControlTaskSchema>
export const ConnectionInfoSchema = z.object({ schemaVersion: z.literal(1), model: z.string().min(1).max(128), visionModel: z.string().min(1).max(128).optional(), reasoningEffort: ReasoningEffortSchema.nullable().optional(), authoringOutputTokens: z.number().int().min(1).max(AUTHORING_LIMITS.maxOutputTokensPerRequest).optional(), protocol: z.literal('chat-completions'),
  capabilities: z.object({ conversation: z.literal(true), connectionTool: z.literal(true), sceneDraft: z.boolean(), svg: z.literal(true), vision: z.enum(['unverified', 'disabled', 'enabled']), taskReasoningEffort: z.literal(true).optional() }).strict(),
  retentionDays: z.literal(7), limits: z.object({ modelRequests: z.literal(4), toolCalls: z.literal(8), executionMs: z.literal(120000), promptBytes: z.literal(16384), outputBytes: z.literal(65536) }).strict() }).strict()
export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>
