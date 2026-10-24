import { describe, expect, it } from 'vitest'
import { readSseData, SSE_LIMITS } from './sse.js'

const encode = new TextEncoder()
function fragmented(text: string, step = 1) {
  const bytes = encode.encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return }
    controller.enqueue(bytes.slice(offset, offset += step))
  } })
}
async function collect(body: ReadableStream<Uint8Array>, signal = new AbortController().signal) {
  const data: string[] = []
  for await (const item of readSseData(body, signal)) data.push(item)
  return data
}

describe('bounded SSE wire decoder', () => {
  it('handles byte-split UTF-8, CRLF and lone CR, comments, multiline data and a BOM', async () => {
    const text = '\ufeff: 心跳\r\nid: ignored\r\nevent: message\r\ndata: 你好🌋\r\ndata: 第二行\r\n\r\ndata: last\r\r'
    expect(await collect(fragmented(text))).toEqual(['你好🌋\n第二行', 'last'])
  })
  it('does not dispatch an unfinished event at EOF', async () => {
    expect(await collect(fragmented('data: partial\n'))).toEqual([])
  })
  it('rejects invalid UTF-8 without exposing wire bytes', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([100, 97, 116, 97, 58, 32, 0xff])); controller.close() } })
    await expect(collect(stream)).rejects.toMatchObject({ code: 'provider_protocol' })
  })
  it('limits line, event, response and event count independently', async () => {
    const cases = [
      `:${'x'.repeat(SSE_LIMITS.lineBytes)}\n\n`,
      `${Array.from({ length: 4 }, () => `data: ${'x'.repeat(20_000)}\n`).join('')}\n`,
      `:${'x'.repeat(10_000)}\n`.repeat(106),
      'data: x\n\n'.repeat(SSE_LIMITS.events + 1),
    ]
    for (const wire of cases) await expect(collect(fragmented(wire, 65536))).rejects.toMatchObject({ code: 'provider_limit' })
  })
  it('cancels a stalled reader on external abort and always releases its lock', async () => {
    const abort = new AbortController()
    let cancelled = 0
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled++ } })
    const reading = collect(stream, abort.signal)
    abort.abort(new Error('private abort reason'))
    await expect(reading).rejects.toMatchObject({ name: 'AbortError', message: '模型请求已取消。' })
    expect(cancelled).toBe(1)
    expect(stream.locked).toBe(false)
  })
  it('also cancels and unlocks on a consumer breaking after DONE', async () => {
    let cancelled = 0
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode.encode('data: [DONE]\n\n')) }, cancel() { cancelled++ } })
    for await (const _data of readSseData(stream, new AbortController().signal)) break
    expect(cancelled).toBe(1)
    expect(stream.locked).toBe(false)
  })
})
