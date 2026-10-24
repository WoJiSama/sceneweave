import { AI_LIMITS, utf8Size } from '../../src/shared/ai/protocol.js'
import { ProviderFailure, type ChatProviderConfig, type ProviderAdapter, type ProviderCompletion, type ProviderInput, type ProviderToolCall, type ProviderTokenUsage } from './provider-types.js'
import { providerAbort, readSseData } from './sse.js'

const ARGUMENT_BYTES = 8192
const safeId = /^[A-Za-z0-9_.:-]{1,128}$/
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const failure = (code = 'provider_protocol', state: 'not_sent' | 'unknown' | 'finished' = 'unknown') => new ProviderFailure(code,
  code === 'provider_limit' ? '模型服务响应超过允许的大小。' : code === 'provider_config' ? '模型服务配置无效。' : code === 'provider_incomplete' ? '模型输出未完整结束，请检查任务后再继续。' : '模型服务返回了不完整或不支持的响应。', state)

function endpoint(config: ChatProviderConfig): string {
  let url: URL
  try { url = new URL(config.baseUrl) } catch { throw failure('provider_config', 'not_sent') }
  if (url.username || url.password || url.href.includes('?') || url.href.includes('#') || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || !config.apiKey || config.apiKey.length > 4096 || /[\x00-\x20\x7f]/.test(config.apiKey)
    || !config.model || config.model.length > 128 || /[\x00-\x1f\x7f]/.test(config.model)) throw failure('provider_config', 'not_sent')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`
  return url.toString()
}

function requestBody(input: ProviderInput, model: string) {
  if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > AI_LIMITS.maxOutputTokensPerRequest) throw failure('provider_limit', 'not_sent')
  const tools = input.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
  return {
    model, messages: input.messages.map(message => ({ role: message.role, content: message.content,
      ...(message.toolCalls ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    })), stream: true, stream_options: { include_usage: true }, max_tokens: input.maxOutputTokens,
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
  }
}

function usageOf(value: unknown): ProviderTokenUsage {
  if (!object(value)) throw failure()
  const token = (entry: unknown) => {
    if (entry === undefined || entry === null) return null
    if (!Number.isSafeInteger(entry) || (entry as number) < 0) throw failure()
    return entry as number
  }
  return { inputTokens: token(value.prompt_tokens), outputTokens: token(value.completion_tokens) }
}

// Bound each public text callback separately; the wire may contain a large delta.
async function emitText(text: string, input: ProviderInput) {
  let part = '', size = 0
  for (const char of text) {
    const bytes = utf8Size(char)
    if (size + bytes > 8192) {
      if (input.signal.aborted) throw providerAbort()
      await input.onText(part); part = ''; size = 0
    }
    part += char; size += bytes
  }
  if (part) { if (input.signal.aborted) throw providerAbort(); await input.onText(part) }
}

export function createChatProvider(config: ChatProviderConfig, fetchImpl: typeof fetch = fetch): ProviderAdapter {
  const url = endpoint(config)
  // Capture configuration once; callers cannot mutate the active provider.
  const { model, apiKey } = config
  return { async complete(input): Promise<ProviderCompletion> {
    if (input.signal.aborted) throw providerAbort()
    const payload = requestBody(input, model)
    let response: Response
    try {
      response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(payload), signal: input.signal })
    } catch {
      if (input.signal.aborted) throw providerAbort()
      throw new ProviderFailure('provider_network', '模型服务连接失败，请先检查任务状态。')
    }
    if (input.signal.aborted) { try { await response.body?.cancel() } catch { /* Disposed. */ }; throw providerAbort() }
    if (!response.ok || !response.body || !/^text\/event-stream(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) {
      try { await response.body?.cancel() } catch { /* Disposed without reading unsafe response text. */ }
      throw new ProviderFailure(response.status === 429 ? 'provider_rate_limit' : 'provider_response', '模型服务未接受流式请求，请检查服务配置和用量。')
    }
    const headerId = response.headers.get('x-request-id')
    let requestId = headerId && safeId.test(headerId) ? headerId : null
    let usage: ProviderTokenUsage = { inputTokens: null, outputTokens: null }
    let text = '', outputBytes = 0, finish: 'stop' | 'tool_calls' | null = null, done = false
    let callbackFailed = false, callbackError: unknown
    const callbackInput: ProviderInput = { ...input, onText: async part => {
      try { await input.onText(part) } catch (error) { callbackFailed = true; callbackError = error; throw error }
    } }
    const calls = new Map<number, ProviderToolCall>()
    try {
      for await (const data of readSseData(response.body, input.signal)) {
        if (data === '[DONE]') { done = true; break }
        let chunk: unknown
        try { chunk = JSON.parse(data) } catch { throw failure() }
        if (!object(chunk) || chunk.error !== undefined || !Array.isArray(chunk.choices) || chunk.choices.length > 1) throw failure()
        if (!requestId && typeof chunk.id === 'string' && safeId.test(chunk.id)) requestId = chunk.id
        if (chunk.usage !== undefined && chunk.usage !== null) usage = usageOf(chunk.usage)
        if (!chunk.choices.length) { if (!chunk.usage || !finish) throw failure(); continue }
        const choice: unknown = chunk.choices[0]
        if (!object(choice) || choice.index !== 0 || !object(choice.delta)) throw failure()
        const delta = choice.delta
        if (delta.role !== undefined && delta.role !== 'assistant') throw failure()
        if (delta.function_call !== undefined || (delta.refusal !== undefined && delta.refusal !== null && delta.refusal !== '')) throw failure()
        if (delta.content !== undefined && delta.content !== null && typeof delta.content !== 'string') throw failure()
        if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) throw failure()
        const content = typeof delta.content === 'string' ? delta.content : ''
        const toolDeltas = (delta.tool_calls ?? []) as unknown[]
        if (finish && (content || toolDeltas.length || choice.finish_reason != null)) throw failure()
        if (content) {
          outputBytes += utf8Size(content)
          if (outputBytes > AI_LIMITS.outputBytes) throw failure('provider_limit')
          text += content
          await emitText(content, callbackInput)
        }
        for (const entry of toolDeltas) {
          if (!object(entry) || !Number.isInteger(entry.index) || (entry.index as number) < 0 || (entry.index as number) >= AI_LIMITS.toolCalls
            || (entry.type !== undefined && entry.type !== 'function')) throw failure()
          const index = entry.index as number
          const call = calls.get(index) ?? { id: '', name: '', arguments: '' }
          if (entry.id !== undefined) { if (typeof entry.id !== 'string') throw failure(); call.id += entry.id }
          if (entry.function !== undefined) {
            if (!object(entry.function)) throw failure()
            const fn = entry.function
            if (fn.name !== undefined) { if (typeof fn.name !== 'string') throw failure(); call.name += fn.name }
            if (fn.arguments !== undefined) {
              if (typeof fn.arguments !== 'string') throw failure()
              outputBytes += utf8Size(fn.arguments)
              if (outputBytes > AI_LIMITS.outputBytes) throw failure('provider_limit')
              call.arguments += fn.arguments
            }
          }
          if (call.id.length > 128 || call.name.length > 128 || utf8Size(call.arguments) > ARGUMENT_BYTES) throw failure('provider_limit')
          calls.set(index, call)
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') throw failure('provider_incomplete')
          finish = choice.finish_reason
        }
      }
      if (input.signal.aborted) throw providerAbort()
      if (!done || !finish || (finish === 'stop' && calls.size > 0) || (finish === 'tool_calls' && calls.size === 0)) throw failure('provider_incomplete')
      const ids = new Set<string>()
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([index, call], offset) => {
        if (index !== offset || !safeId.test(call.id) || !safeId.test(call.name) || ids.has(call.id) || !input.tools.some(tool => tool.name === call.name)) throw failure()
        let args: unknown
        try { args = JSON.parse(call.arguments) } catch { throw failure() }
        if (!object(args)) throw failure()
        ids.add(call.id)
        return call
      })
      return { text, toolCalls, finishReason: finish, usage, requestId }
    } catch (error) {
      if (input.signal.aborted) throw providerAbort()
      // This error came from trusted local storage/budget code, never the provider.
      if (callbackFailed) throw callbackError
      if (error instanceof ProviderFailure) throw error
      throw failure()
    }
  } }
}
