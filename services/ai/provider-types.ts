export interface ProviderToolCall { id: string; name: string; arguments: string }
export interface ProviderToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ProviderMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; images?: VisionInput[]; toolCalls?: ProviderToolCall[]; toolCallId?: string; reasoningContent?: string }
export interface ProviderTokenUsage { inputTokens: number | null; outputTokens: number | null }
export interface ProviderCompletion { text: string; toolCalls: ProviderToolCall[]; finishReason: 'stop' | 'tool_calls'; usage: ProviderTokenUsage; requestId: string | null; reasoningContent?: string }
export interface ProviderInput { messages: ProviderMessage[]; tools: ProviderToolDefinition[]; maxOutputTokens: number; reasoningEffort?: ProviderReasoningEffort | null; signal: AbortSignal; onText: (text: string) => void | Promise<void> }
export interface ProviderAdapter { complete(input: ProviderInput): Promise<ProviderCompletion> }
/** Acquire before building/counting a request; release only after its response settles. */
export interface ProviderRequestScheduler { readonly cooldownMs: number; acquire(signal: AbortSignal): Promise<() => void> }
export type ProviderReasoningEffort = 'low' | 'high' | 'max'
export interface ChatProviderConfig { baseUrl: string; apiKey: string; model: string; visionModel?: string; vision?: 'unverified' | 'disabled' | 'enabled'; preserveReasoning?: 'enabled' | 'disabled'; reasoningEffort?: ProviderReasoningEffort }
export const PROVIDER_REASONING_BYTES = 64 * 1024
export const isProviderModel = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[\x00-\x20\x7f]/.test(value)
export const isProviderReasoningEffort = (value: unknown): value is ProviderReasoningEffort => value === 'low' || value === 'high' || value === 'max'
export class ProviderFailure extends Error {
  constructor(public readonly code: string, message: string, public readonly requestState: 'not_sent' | 'unknown' | 'finished' = 'unknown') { super(message); this.name = 'ProviderFailure' }
}
import type { VisionInput } from '../../src/shared/ai/vision.js'
