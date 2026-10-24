import { describe, expect, it, vi } from 'vitest'
import { createChatProvider } from './chat-provider.js'
import { ProviderFailure, type ProviderInput } from './provider-types.js'

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
  it('rejects unsafe provider destinations and config before sending anything', () => {
    const fetcher = vi.fn<typeof fetch>()
    for (const baseUrl of ['http://example.test/v1', 'https://user:secret@example.test/v1', 'https://example.test/v1?x=1', 'https://example.test/v1#x', 'https://example.test/v1?', 'file:///tmp/test']) {
      expect(() => createChatProvider({ ...config, baseUrl }, fetcher)).toThrow(ProviderFailure)
    }
    for (const baseUrl of ['http://localhost:8080/v1', 'http://127.0.0.1:8080/v1', 'http://[::1]:8080/v1']) expect(() => createChatProvider({ ...config, baseUrl }, fetcher)).not.toThrow()
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
