export interface ProviderToolCall { id: string; name: string; arguments: string }
export interface ProviderToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ProviderMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; toolCalls?: ProviderToolCall[]; toolCallId?: string }
export interface ProviderTokenUsage { inputTokens: number | null; outputTokens: number | null }
export interface ProviderCompletion { text: string; toolCalls: ProviderToolCall[]; finishReason: 'stop' | 'tool_calls'; usage: ProviderTokenUsage; requestId: string | null }
export interface ProviderInput { messages: ProviderMessage[]; tools: ProviderToolDefinition[]; maxOutputTokens: number; signal: AbortSignal; onText: (text: string) => void | Promise<void> }
export interface ProviderAdapter { complete(input: ProviderInput): Promise<ProviderCompletion> }
export interface ChatProviderConfig { baseUrl: string; apiKey: string; model: string }
export class ProviderFailure extends Error {
  constructor(public readonly code: string, message: string, public readonly requestState: 'not_sent' | 'unknown' | 'finished' = 'unknown') { super(message); this.name = 'ProviderFailure' }
}
