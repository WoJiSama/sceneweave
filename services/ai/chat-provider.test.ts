import { describe, expect, it, vi } from 'vitest'
import { createChatProvider } from './chat-provider.js'
import { PROVIDER_REASONING_BYTES, ProviderFailure, type ChatProviderConfig, type ProviderInput } from './provider-types.js'
import { AUTHORING_LIMITS } from '../../src/shared/ai/authoring-protocol.js'

const config = { baseUrl: 'https://example.test/v1/', apiKey: 'test-key-keep-private', model: 'test-grok' }
const tool = { name: 'connection_info', description: 'Read connection capability.', parameters: { type: 'object', properties: {}, additionalProperties: false } }
const input = (extra: Partial<ProviderInput> = {}): ProviderInput => ({ messages: [{ role: 'user', content: '你好' }], tools: [tool], maxOutputTokens: 128, signal: new AbortController().signal, onText: () => {}, ...extra })
const event = (delta: Record<string, unknown>, finish_reason: string | null = null) => ({ id: 'chatcmpl-test', choices: [{ index: 0, delta, finish_reason }] })
const wire = (...chunks: unknown[]) => chunks.map(chunk => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\r\n\r\n`).join('')
function streamingResponse(text: string, step = 7, headers: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return }
    controller.enqueue(bytes.slice(offset, offset += step))
  } })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...headers } })
}
const fakeFetch = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response)

describe('chat-completions provider adapter', () => {
  it('streams split Chinese text in callback order and accepts the separate usage tail', async () => {
    const callbacks: string[] = []
    let busy = false
    const fetcher = fakeFetch(streamingResponse(wire(event({ role: 'assistant' }), event({ content: '你好🌋' }), event({ content: '，场景。' }), event({}, 'stop'), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } }, '[DONE]'), 1, { 'x-request-id': 'request-safe-1' }))
    const result = await createChatProvider(config, fetcher).complete(input({ onText: async text => {
      expect(busy).toBe(false); busy = true
      await new Promise(resolve => setTimeout(resolve, 1))
      callbacks.push(text); busy = false
    } }))
    expect(callbacks).toEqual(['你好🌋', '，场景。'])
    expect(result).toEqual({ text: '你好🌋，场景。', finishReason: 'stop', toolCalls: [], usage: { inputTokens: 12, outputTokens: 7 }, requestId: 'request-safe-1' })
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe('https://example.test/v1/chat/completions')
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${config.apiKey}` } })
    expect(JSON.parse(options!.body as string)).toMatchObject({ model: config.model, stream: true, stream_options: { include_usage: true }, max_tokens: 128, tool_choice: 'auto', tools: [{ type: 'function', function: tool }] })
  })
  it('assembles multiple arbitrarily fragmented tool IDs, names and JSON; preserves the continuation messages exactly', async () => {
    const first = fakeFetch(streamingResponse(wire(
      event({ tool_calls: [{ index: 1, id: 'call_', type: 'function', function: { name: 'connection_', arguments: '{"文字":' } }, { index: 0, id: 'call_', function: { name: 'connection_', arguments: '{' } }] }),
      event({ tool_calls: [{ index: 0, id: 'a', function: { name: 'info', arguments: '}' } }, { index: 1, id: 'b', function: { name: 'info', arguments: '"工具🌋"}' } }] }),
      event({}, 'tool_calls'), '[DONE]'), 2))
    const result = await createChatProvider(config, first).complete(input())
    expect(result.toolCalls).toEqual([{ id: 'call_a', name: tool.name, arguments: '{}' }, { id: 'call_b', name: tool.name, arguments: '{"文字":"工具🌋"}' }])
    const messages: ProviderInput['messages'] = [...input().messages, { role: 'assistant', content: null, toolCalls: result.toolCalls }, { role: 'tool', content: '{"success":true}', toolCallId: 'call_a' }, { role: 'tool', content: '{"success":true}', toolCallId: 'call_b' }]
    const next = fakeFetch(streamingResponse(wire(event({ content: '已检查。' }), event({}, 'stop'), '[DONE]')))
    await createChatProvider(config, next).complete(input({ messages }))
    expect(JSON.parse(next.mock.calls[0]![1]!.body as string).messages).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: null, tool_calls: result.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) },
      { role: 'tool', content: '{"success":true}', tool_call_id: 'call_a' },
      { role: 'tool', content: '{"success":true}', tool_call_id: 'call_b' },
    ])
  })
  it('never surfaces hidden reasoning and reports unknown usage as null', async () => {
    const onText = vi.fn()
    const result = await createChatProvider(config, fakeFetch(streamingResponse(wire(event({ reasoning_content: 'private chain of thought' }), event({ content: '可见回答' }, 'stop'), '[DONE]')))).complete(input({ onText }))
    expect(result.text).toBe('可见回答')
    expect(onText).toHaveBeenCalledExactlyOnceWith('可见回答')
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null })
    expect(result).not.toHaveProperty('reasoningContent')
  })
  it('preserves opaque reasoning exactly across a real protocol tool-result continuation without visible callbacks', async () => {
    const firstText = 'private\n\t计划🌋\u0000{"tool":"not executable"}', onText = vi.fn(), mutable: ChatProviderConfig = { ...config, preserveReasoning: 'enabled' }
    const events = wire(event({ reasoning_content: firstText.slice(0, 12) }), event({ reasoning_content: firstText.slice(12) }),
      event({ tool_calls: [{ index: 0, id: 'call_a', function: { name: tool.name, arguments: '{}' } }] }), event({}, 'tool_calls'), '[DONE]')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(streamingResponse(events, 1)).mockResolvedValueOnce(streamingResponse(wire(event({ content: '公开答复' }, 'stop'), '[DONE]')))
    const provider = createChatProvider(mutable, fetcher)
    mutable.preserveReasoning = 'disabled'
    const first = await provider.complete(input({ onText }))
    expect(first.reasoningContent).toBe(firstText); expect(first.text).toBe(''); expect(onText).not.toHaveBeenCalled()
    const messages: ProviderInput['messages'] = [...input().messages, { role: 'assistant', content: null, reasoningContent: first.reasoningContent, toolCalls: first.toolCalls }, { role: 'tool', content: '{"success":true}', toolCallId: 'call_a' }]
    const second = await provider.complete(input({ messages, onText }))
    const body = JSON.parse(fetcher.mock.calls[1]![1]!.body as string)
    expect(body.messages).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: null, reasoning_content: firstText, tool_calls: [{ id: 'call_a', type: 'function', function: { name: tool.name, arguments: '{}' } }] },
      { role: 'tool', content: '{"success":true}', tool_call_id: 'call_a' },
    ])
    expect(second.text).toBe('公开答复'); expect(onText).toHaveBeenCalledExactlyOnceWith('公开答复')
    expect(first.toolCalls).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('ignores saved reasoning and never returns it when preservation is disabled', async () => {
    for (const preserveReasoning of [undefined, 'disabled'] as const) {
      const fetcher = fakeFetch(streamingResponse(wire(event({ reasoning_content: 'do not retain this' }), event({}, 'stop'), '[DONE]')))
      const result = await createChatProvider({ ...config, preserveReasoning }, fetcher).complete(input({ messages: [{ role: 'assistant', content: 'public history', reasoningContent: 'saved private continuation' }, ...input().messages] }))
      expect(result).not.toHaveProperty('reasoningContent')
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).messages[0]).toEqual({ role: 'assistant', content: 'public history' })
    }
  })
  it('bounds private reasoning independently of visible output and counts complete UTF-8 across delta splits', async () => {
    const parts = ['x'.repeat(PROVIDER_REASONING_BYTES - 4), '\ud83c', '\udf0b']
    const events = wire(...Array.from({ length: 8 }, (_, index) => event({ reasoning_content: parts[0].slice(index * 8192, (index + 1) * 8192) })),
      event({ reasoning_content: parts[1] }), event({ reasoning_content: parts[2] }), event({ content: 'ok' }, 'stop'), '[DONE]')
    const result = await createChatProvider({ ...config, preserveReasoning: 'enabled' }, fakeFetch(streamingResponse(events, 4096))).complete(input({ maxOutputTokens: 8192 }))
    expect(result.reasoningContent).toBe(parts.join('')); expect(new TextEncoder().encode(result.reasoningContent).byteLength).toBe(PROVIDER_REASONING_BYTES)
    const oversized = wire(...Array.from({ length: 9 }, () => event({ reasoning_content: '🌋'.repeat(2048) })), event({}, 'stop'), '[DONE]')
    const fetcher = fakeFetch(streamingResponse(oversized, 4096)), onText = vi.fn()
    await expect(createChatProvider({ ...config, preserveReasoning: 'enabled' }, fetcher).complete(input({ maxOutputTokens: 8192, onText }))).rejects.toMatchObject({ code: 'provider_limit', requestState: 'unknown' })
    expect(onText).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects malformed or late private reasoning and invalid retained history without exposing it', async () => {
    for (const value of [128, {}, []]) {
      const fetcher = fakeFetch(streamingResponse(wire(event({ reasoning_content: value }), event({}, 'stop'), '[DONE]')))
      await expect(createChatProvider({ ...config, preserveReasoning: 'enabled' }, fetcher).complete(input())).rejects.toMatchObject({ code: 'provider_protocol' })
      expect(fetcher).toHaveBeenCalledOnce()
    }
    await expect(createChatProvider({ ...config, preserveReasoning: 'enabled' }, fakeFetch(streamingResponse(wire(event({}, 'stop'), event({ reasoning_content: 'late' }), '[DONE]')))).complete(input())).rejects.toMatchObject({ code: 'provider_protocol' })
    const fetcher = vi.fn<typeof fetch>()
    for (const message of [
      { role: 'assistant' as const, content: null, reasoningContent: 128 as unknown as string },
      { role: 'user' as const, content: 'User text', reasoningContent: 'cannot be user data' },
      { role: 'assistant' as const, content: null, reasoningContent: 'x'.repeat(PROVIDER_REASONING_BYTES + 1) },
    ]) await expect(createChatProvider({ ...config, preserveReasoning: 'enabled' }, fetcher).complete(input({ messages: [message] }))).rejects.toMatchObject({ requestState: 'not_sent' })
    expect(fetcher).not.toHaveBeenCalled()
    for (const value of ['true', '', 128, null]) expect(() => createChatProvider({ ...config, preserveReasoning: value } as unknown as ChatProviderConfig, fetcher)).toThrow(ProviderFailure)
  })
  it.each([
    ['no DONE', wire(event({ content: 'partial' }), event({}, 'stop'))],
    ['no finish', wire(event({ content: 'partial' }), '[DONE]')],
    ['unfinished event', wire(event({ content: 'partial' }), event({}, 'stop')) + 'data: [DONE]\n'],
    ['truncated JSON', wire('{"choices":[')],
    ['length', wire(event({ content: 'partial' }, 'length'), '[DONE]')],
    ['filter', wire(event({}, 'content_filter'), '[DONE]')],
    ['unknown finish', wire(event({}, 'unexpected'), '[DONE]')],
    ['text after finish', wire(event({}, 'stop'), event({ content: 'late' }), '[DONE]')],
    ['multiple choices', wire({ choices: [{ index: 0, delta: {} }, { index: 1, delta: {} }] }, '[DONE]')],
    ['upstream error', wire({ error: { message: config.apiKey } })],
    ['invalid usage', wire(event({}, 'stop'), { choices: [], usage: { prompt_tokens: -1 } }, '[DONE]')],
  ])('fails closed for %s without exposing upstream values', async (_name, response) => {
    const fetcher = fakeFetch(streamingResponse(response))
    let error: unknown
    try { await createChatProvider(config, fetcher).complete(input()) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(ProviderFailure)
    expect((error as ProviderFailure).requestState).toBe('unknown')
    expect(String(error)).not.toContain(config.apiKey)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    { reason: 'partial JSON', calls: [{ index: 0, id: 'a', function: { name: tool.name, arguments: '{"half":' } }] },
    { reason: 'non-object JSON', calls: [{ index: 0, id: 'a', function: { name: tool.name, arguments: '[]' } }] },
    { reason: 'unknown tool', calls: [{ index: 0, id: 'a', function: { name: 'unknown_tool', arguments: '{}' } }] },
    { reason: 'duplicate IDs', calls: [{ index: 0, id: 'same', function: { name: tool.name, arguments: '{}' } }, { index: 1, id: 'same', function: { name: tool.name, arguments: '{}' } }] },
    { reason: 'ninth slot', calls: [{ index: 8, id: 'ninth', function: { name: tool.name, arguments: '{}' } }] },
  ])('rejects tool calls with $reason', async ({ calls }) => {
    await expect(createChatProvider(config, fakeFetch(streamingResponse(wire(event({ tool_calls: calls }), event({}, 'tool_calls'), '[DONE]')))).complete(input())).rejects.toBeInstanceOf(ProviderFailure)
  })
  it('rejects duplicate call IDs across distinct tool slots', async () => {
    const calls = [0, 1].map(index => ({ index, id: 'duplicate', function: { name: tool.name, arguments: '{}' } }))
    await expect(createChatProvider(config, fakeFetch(streamingResponse(wire(event({ tool_calls: calls }), event({}, 'tool_calls'), '[DONE]')))).complete(input())).rejects.toMatchObject({ code: 'provider_protocol' })
  })
  it('rejects tool/stop contradictions and absent tool calls', async () => {
    const calls = [{ index: 0, id: 'a', function: { name: tool.name, arguments: '{}' } }]
    for (const response of [wire(event({ tool_calls: calls }), event({}, 'stop'), '[DONE]'), wire(event({}, 'tool_calls'), '[DONE]')]) {
      await expect(createChatProvider(config, fakeFetch(streamingResponse(response))).complete(input())).rejects.toMatchObject({ code: 'provider_incomplete' })
    }
  })
  it('limits accumulated output and each tool argument, splitting visible callbacks to 8KiB', async () => {
    const texts: string[] = []
    const content = '🌋'.repeat(4000)
    await createChatProvider(config, fakeFetch(streamingResponse(wire(event({ content }), event({}, 'stop'), '[DONE]'), 1024))).complete(input({ onText: text => { texts.push(text) } }))
    expect(texts.join('')).toBe(content)
    expect(texts.every(text => new TextEncoder().encode(text).byteLength <= 8192)).toBe(true)
    const tooMuch = wire(...Array.from({ length: 9 }, () => event({ content: 'x'.repeat(8192) })), event({}, 'stop'), '[DONE]')
    await expect(createChatProvider(config, fakeFetch(streamingResponse(tooMuch, 4096))).complete(input())).rejects.toMatchObject({ code: 'provider_limit' })
    const toolCall = { index: 0, id: 'a', function: { name: tool.name, arguments: JSON.stringify({ huge: 'x'.repeat(8192) }) } }
    await expect(createChatProvider(config, fakeFetch(streamingResponse(wire(event({ tool_calls: [toolCall] }), event({}, 'tool_calls'), '[DONE]'), 4096))).complete(input())).rejects.toMatchObject({ code: 'provider_limit' })
  })
  it('uses the explicit large-output SSE envelope for bounded authoring reasoning without exposing it', async () => {
    const reasoning: unknown[] = Array.from({ length: 3000 }, (_, index) => event({ reasoning_content: `private-step-${index.toString().padStart(4, '0')}` }))
    reasoning.push(event({ content: '已完成草稿。' }, 'stop'), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3001 } }, '[DONE]')
    const fetcher = fakeFetch(streamingResponse(wire(...reasoning), 4096))
    const onText = vi.fn(), result = await createChatProvider(config, fetcher).complete(input({ maxOutputTokens: 4096, tools: [], onText }))
    expect(result).toMatchObject({ text: '已完成草稿。', finishReason: 'stop', toolCalls: [], usage: { inputTokens: 12, outputTokens: 3001 } })
    expect(onText).toHaveBeenCalledExactlyOnceWith('已完成草稿。')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).max_tokens).toBe(4096)
  })
  it('preserves tool calls and usage after more than 2048 private reasoning deltas', async () => {
    const events: unknown[] = Array.from({ length: 3000 }, () => event({ reasoning_content: 'hidden reasoning' }))
    events.push(event({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: tool.name, arguments: '{}' } }] }),
      event({}, 'tool_calls'), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3001 } }, '[DONE]')
    const onText = vi.fn(), fetcher = fakeFetch(streamingResponse(wire(...events), 4096))
    const result = await createChatProvider(config, fetcher).complete(input({ maxOutputTokens: 8192, onText }))
    expect(result).toMatchObject({ text: '', finishReason: 'tool_calls', toolCalls: [{ id: 'call_a', name: tool.name, arguments: '{}' }], usage: { inputTokens: 12, outputTokens: 3001 } })
    expect(onText).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('hidden reasoning')
  })
  it('keeps the standard SSE envelope for ordinary 1024-token requests', async () => {
    const many: unknown[] = Array.from({ length: 2049 }, () => event({ reasoning_content: 'private' }))
    many.push(event({ content: 'done' }, 'stop'), '[DONE]')
    await expect(createChatProvider(config, fakeFetch(streamingResponse(wire(...many), 4096))).complete(input({ maxOutputTokens: 1024, tools: [] }))).rejects.toMatchObject({ code: 'provider_limit' })
  })
  it('keeps large-output reasoning bounded and never retries after wire limits are reached', async () => {
    const tooMany: unknown[] = Array.from({ length: 16385 }, () => event({ reasoning_content: 'private' }))
    tooMany.push(event({}, 'stop'), '[DONE]')
    const tooLarge = `:${'x'.repeat(10000)}\n`.repeat(420) + wire(event({}, 'stop'), '[DONE]')
    for (const value of [wire(...tooMany), tooLarge]) {
      const fetcher = fakeFetch(streamingResponse(value, 65536)), onText = vi.fn()
      await expect(createChatProvider(config, fetcher).complete(input({ maxOutputTokens: 8192, onText }))).rejects.toMatchObject({ code: 'provider_limit' })
      expect(onText).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce()
    }
  })
  it('does not expand visible text or individual tool argument limits for large-output requests', async () => {
    const tooMuch = wire(...Array.from({ length: 9 }, () => event({ content: 'x'.repeat(8192) })), event({}, 'stop'), '[DONE]')
    const toolCall = { index: 0, id: 'a', function: { name: tool.name, arguments: JSON.stringify({ huge: 'x'.repeat(8192) }) } }
    for (const value of [tooMuch, wire(event({ tool_calls: [toolCall] }), event({}, 'tool_calls'), '[DONE]')]) {
      const fetcher = fakeFetch(streamingResponse(value, 4096))
      await expect(createChatProvider(config, fetcher).complete(input({ maxOutputTokens: 8192 }))).rejects.toMatchObject({ code: 'provider_limit' })
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })
  it('rejects unsafe provider destinations and config before sending anything', () => {
    const fetcher = vi.fn<typeof fetch>()
    for (const baseUrl of ['http://example.test/v1', 'https://user:secret@example.test/v1', 'https://example.test/v1?x=1', 'https://example.test/v1#x', 'https://example.test/v1?', 'file:///tmp/test']) {
      expect(() => createChatProvider({ ...config, baseUrl }, fetcher)).toThrow(ProviderFailure)
    }
    for (const baseUrl of ['http://localhost:8080/v1', 'http://127.0.0.1:8080/v1', 'http://[::1]:8080/v1']) expect(() => createChatProvider({ ...config, baseUrl }, fetcher)).not.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects invalid text or visual model identifiers before any request, including text-only requests', () => {
    const fetcher = vi.fn<typeof fetch>()
    for (const invalid of ['', ' ', 'glm 5.3', 'glm-5.3\n', 'glm-5.3\x7f', 'x'.repeat(129), null, 53]) {
      for (const field of ['model', 'visionModel'] as const) {
        let error: unknown
        try { createChatProvider({ ...config, [field]: invalid } as ChatProviderConfig, fetcher) } catch (caught) { error = caught }
        expect(error).toBeInstanceOf(ProviderFailure)
        expect(error).toMatchObject({ code: 'provider_config', requestState: 'not_sent' })
      }
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([1, 4096, AUTHORING_LIMITS.maxOutputTokensPerRequest])('sends the bounded explicit output budget unchanged (%s)', async maxOutputTokens => {
    const fetcher = fakeFetch(streamingResponse(wire(event({}, 'stop'), '[DONE]')))
    await createChatProvider(config, fetcher).complete(input({ maxOutputTokens }))
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).max_tokens).toBe(maxOutputTokens)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects unbounded or invalid output budgets before sending a provider request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    for (const maxOutputTokens of [0, -1, 1.5, NaN, Infinity, AUTHORING_LIMITS.maxOutputTokensPerRequest + 1]) {
      await expect(createChatProvider(config, fetcher).complete(input({ maxOutputTokens }))).rejects.toMatchObject({ code: 'provider_limit', requestState: 'not_sent' })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('returns safe HTTP/network errors, never retries and disposes unread bodies', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    const fetcher = fakeFetch(response)
    await expect(createChatProvider(config, fetcher).complete(input())).rejects.toMatchObject({ code: 'provider_response' })
    expect(cancelled).toBe(true)
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error(`Authorization Bearer ${config.apiKey}`))
    await expect(createChatProvider(config, network).complete(input())).rejects.toMatchObject({ code: 'provider_network', message: '模型服务连接失败，请先检查任务状态。', requestState: 'unknown' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(network).toHaveBeenCalledTimes(1)
  })
  it('cancels and releases a stalled body without leaking an external abort reason', async () => {
    let cancelled = false
    const abort = new AbortController()
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const running = createChatProvider(config, fakeFetch(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))).complete(input({ signal: abort.signal }))
    await new Promise(resolve => setTimeout(resolve, 0))
    abort.abort(new Error(config.apiKey))
    await expect(running).rejects.toMatchObject({ name: 'AbortError', message: '模型请求已取消。' })
    expect(cancelled).toBe(true)
    expect(body.locked).toBe(false)
  })
  it('preserves a local callback budget failure and still releases the response body', async () => {
    const response = streamingResponse(wire(event({ content: 'text' }), event({}, 'stop'), '[DONE]'))
    const localError = new Error('local-event-limit')
    await expect(createChatProvider(config, fakeFetch(response)).complete(input({ onText: () => { throw localError } }))).rejects.toBe(localError)
    expect(response.body!.locked).toBe(false)
  })
})
