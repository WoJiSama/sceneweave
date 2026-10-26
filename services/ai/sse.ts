import { ProviderFailure } from './provider-types.js'

export const SSE_LIMITS = Object.freeze({ responseBytes: 1024 * 1024, lineBytes: 32 * 1024, eventBytes: 64 * 1024, events: 2048 })
export const SSE_LARGE_OUTPUT_LIMITS = Object.freeze({ ...SSE_LIMITS, responseBytes: 4 * 1024 * 1024, events: 16384 })
export type SseOutputMode = 'standard' | 'large-output'

export function providerAbort(): Error {
  const error = new Error('模型请求已取消。')
  error.name = 'AbortError'
  return error
}

const protocolFailure = () => new ProviderFailure('provider_protocol', '模型服务返回了不完整或不支持的流式响应。')
const limitFailure = () => new ProviderFailure('provider_limit', '模型服务响应超过允许的大小。')

/** Incremental UTF-8/SSE decoder. No upstream text is included in errors. */
export async function* readSseData(body: ReadableStream<Uint8Array>, signal: AbortSignal, mode: SseOutputMode = 'standard'): AsyncGenerator<string> {
  if (signal.aborted) throw providerAbort()
  if (mode !== 'standard' && mode !== 'large-output') throw new ProviderFailure('provider_config', '模型服务配置无效。', 'not_sent')
  const limits = mode === 'large-output' ? SSE_LARGE_OUTPUT_LIMITS : SSE_LIMITS
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let total = 0, lineBytes = 0, eventBytes = 0, events = 0
  let line = '', skipLf = false
  let data: string[] = []
  const ready: string[] = []
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const acceptLine = () => {
    if (line === '') {
      if (data.length) {
        if (++events > limits.events) throw limitFailure()
        ready.push(data.join('\n'))
      }
      data = []; eventBytes = 0
    } else if (!line.startsWith(':')) {
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'data') {
        eventBytes += encoder.encode(value).byteLength + 1
        if (eventBytes > limits.eventBytes) throw limitFailure()
        data.push(value)
      }
    }
    line = ''; lineBytes = 0
  }
  const acceptText = (text: string) => {
    for (const char of text) {
      if (skipLf) { skipLf = false; if (char === '\n') continue }
      if (char === '\r' || char === '\n') { acceptLine(); skipLf = char === '\r' }
      else {
        lineBytes += encoder.encode(char).byteLength
        if (lineBytes > limits.lineBytes) throw limitFailure()
        line += char
      }
    }
  }
  try {
    while (true) {
      if (signal.aborted) throw providerAbort()
      const { done, value } = await reader.read()
      if (signal.aborted) throw providerAbort()
      if (done) {
        try { acceptText(decoder.decode()) } catch (error) { if (error instanceof ProviderFailure) throw error; throw protocolFailure() }
        while (ready.length) yield ready.shift()!
        // SSE does not dispatch an event without its final blank line.
        return
      }
      total += value.byteLength
      if (total > limits.responseBytes) throw limitFailure()
      try { acceptText(decoder.decode(value, { stream: true })) } catch (error) { if (error instanceof ProviderFailure) throw error; throw protocolFailure() }
      while (ready.length) {
        if (signal.aborted) throw providerAbort()
        yield ready.shift()!
      }
    }
  } catch (error) {
    if (signal.aborted) throw providerAbort()
    if (error instanceof ProviderFailure) throw error
    throw new ProviderFailure('provider_network', '模型服务连接中断，请先检查任务状态。')
  } finally {
    signal.removeEventListener('abort', abort)
    try { await reader.cancel() } catch { /* Already errored or aborted. */ }
    reader.releaseLock()
  }
}
