import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { domainExecutionFixture } from '../../../../tools/testing/domain-execution-fixtures.js'
import {
  createDomainExecutionRequest, domainGenerationCapabilities, executeDomainExecutionRequest,
  type DomainExecutionRequest, type DomainExecutionResponse, type DomainGenerationKind,
} from '../../../shared/generation/execution.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { createDomainGenerationClient, type DomainGenerationClient, type DomainGenerationClientOptions, type DomainGenerationWorker } from './client.js'
import { executeDomainGenerationWorkerRequest } from './worker.js'

const domains = ['interior', 'forest', 'volcano'] as const
const request = (domain: DomainGenerationKind = 'interior', requestId = `client-${domain}`) => createDomainExecutionRequest({
  requestId, context: { workspaceId: 'current-workspace', checkpoint: 4, epoch: 7 }, domain, ...domainExecutionFixture(domain),
})
const generated = new Map<DomainGenerationKind, DomainExecutionResponse>()
beforeAll(() => {
  for (const domain of domains) generated.set(domain, executeDomainExecutionRequest(request(domain), { nowMilliseconds: () => 0 }))
}, 30_000)
function responseFor(input: DomainExecutionRequest): DomainExecutionResponse {
  return cloneJson({ ...generated.get(input.domain)!, requestId: input.requestId, context: input.context, requestHash: input.requestHash })
}
class MockWorker implements DomainGenerationWorker {
  onmessage: DomainGenerationWorker['onmessage'] = null
  onerror: DomainGenerationWorker['onerror'] = null
  onmessageerror: DomainGenerationWorker['onmessageerror'] = null
  posted: DomainExecutionRequest[] = []
  terminate = vi.fn()
  postMessage = vi.fn((value: unknown) => { this.posted.push(cloneJson(value) as DomainExecutionRequest) })
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>) }
}
const clients: DomainGenerationClient[] = []
function setup(options: Omit<DomainGenerationClientOptions, 'createWorker'> = {}) {
  const workers: MockWorker[] = [], createWorker = vi.fn(() => { const worker = new MockWorker(); workers.push(worker); return worker })
  const client = createDomainGenerationClient({ ...options, createWorker }); clients.push(client)
  return { client, workers, createWorker }
}
function released(worker: MockWorker) {
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull()
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const server = { baseUrl: 'https://generation.example', token: 'session-token' }
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('unified domain generation transports', () => {
  it.each(domains)('runs the exact shared %s implementation in Worker and accepts only its request', async domain => {
    const { client, workers } = setup(), source = request(domain), pending = client.execute(source), worker = workers[0]
    const response = executeDomainGenerationWorkerRequest(worker.posted[0])
    if ('type' in response) throw new Error(response.error.message)
    expect(response.result.resultHash).toBe(generated.get(domain)!.result.resultHash)
    expect(canonicalJson(response.result.candidate.document)).toBe(canonicalJson(generated.get(domain)!.result.candidate.document))
    worker.emit(response)
    const result = await pending
    expect(result.domain).toBe(domain); expect(Object.isFrozen(result.result.candidate.document)).toBe(true)
    released(worker)
  }, 30_000)

  it('captures requests and results independently and rejects hostile or modified input before allocating', async () => {
    const { client, workers, createWorker } = setup(), source = cloneJson(request()), before = canonicalJson(source)
    const pending = client.execute(source), worker = workers[0], response = responseFor(worker.posted[0])
    source.input.seed = 'changed-after-dispatch'
    expect(canonicalJson(worker.posted[0])).toBe(before)
    worker.emit(response)
    const accepted = await pending
    ;(response.result.candidate.document as { title: string }).title = 'changed-after-delivery'
    expect(accepted.result.candidate.document.title).not.toBe('changed-after-delivery')
    const hostile = cloneJson(request()), read = vi.fn(() => hostile.input)
    Object.defineProperty(hostile, 'input', { enumerable: true, get: read })
    await expect(client.execute(hostile)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(read).not.toHaveBeenCalled()
    const corrupt = cloneJson(request()); corrupt.input.seed = 'different'
    await expect(client.execute(corrupt)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('rejects foreign correlation, malformed candidates and unknown response fields', async () => {
    const alterations: ((value: DomainExecutionResponse) => void)[] = [
      value => { value.requestId = 'another-request' }, value => { value.context.epoch++ },
      value => { value.requestHash = 'f'.repeat(64) }, value => { value.domain = 'forest' },
    ]
    for (const alter of alterations) {
      const { client, workers } = setup(), source = request(), pending = client.execute(source), response = responseFor(source)
      alter(response); workers[0].emit(response)
      await expect(pending).rejects.toMatchObject({ code: 'stale' }); released(workers[0])
    }
    const { client, workers } = setup(), source = request(), pending = client.execute(source), response = responseFor(source)
    ;(response.result.candidate.document as { title: string }).title += 'tampered'; workers[0].emit(response)
    await expect(pending).rejects.toMatchObject({ code: 'protocol' }); released(workers[0])
    const second = client.execute(source)
    workers[1].emit({ ...responseFor(source), trusted: true })
    await expect(second).rejects.toMatchObject({ code: 'protocol' }); released(workers[1])
  })

  it('checks the host baseline before dispatch and again at receipt', async () => {
    const { client, workers } = setup(); let current = true
    const source = request(), pending = client.execute(source, { isCurrent: () => current })
    current = false; workers[0].emit(responseFor(source))
    await expect(pending).rejects.toMatchObject({ code: 'stale' }); released(workers[0])
    await expect(client.execute(source, { isCurrent: () => { throw new Error('unmounted') } })).rejects.toMatchObject({ code: 'stale' })
    expect(workers).toHaveLength(1)
  })

  it('preserves a bound domain failure without accepting an error from another request', async () => {
    const { client, workers } = setup(), source = request(), pending = client.execute(source)
    const failure = { protocolVersion: 1, type: 'error', requestId: source.requestId, context: source.context,
      requestHash: source.requestHash, domain: source.domain, error: { code: 'generation_failed', message: '指定净面积与范围矛盾。' } }
    workers[0].emit(failure)
    await expect(pending).rejects.toMatchObject({ code: 'generation_failed', message: failure.error.message }); released(workers[0])
    const next = client.execute(source); workers[1].emit({ ...failure, requestId: 'foreign' })
    await expect(next).rejects.toMatchObject({ code: 'stale' }); released(workers[1])
  })

  it('cancels, replaces and disposes one-shot Workers without accepting queued callbacks', async () => {
    const { client, workers, createWorker } = setup(), source = request(), signal = new AbortController()
    signal.abort()
    await expect(client.execute(source, { signal: signal.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(createWorker).not.toHaveBeenCalled()
    const first = client.execute(source), firstFailure = expect(first).rejects.toMatchObject({ name: 'AbortError' }), queued = workers[0].onmessage!
    const second = client.execute(source), secondFailure = expect(second).rejects.toMatchObject({ name: 'AbortError' })
    queued({ data: responseFor(source) } as MessageEvent<unknown>)
    client.dispose(); await firstFailure; await secondFailure
    released(workers[0]); released(workers[1])
    await expect(client.execute(source)).rejects.toMatchObject({ code: 'disposed' })
  })

  it('releases timeout and external abort even if Worker termination throws', async () => {
    vi.useFakeTimers()
    const { client, workers } = setup(), source = request(), pending = client.execute(source, { timeoutMs: 30 })
    workers[0].terminate.mockImplementation(() => { throw new Error('already gone') })
    const failure = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(30); await failure; released(workers[0]); expect(vi.getTimerCount()).toBe(0)
    const controller = new AbortController(), next = client.execute(source, { signal: controller.signal }), aborted = expect(next).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await aborted; released(workers[1]); expect(vi.getTimerCount()).toBe(0)
  })

  it('negotiates exact server capabilities, then sends one normalized request without using Worker', async () => {
    const source = request('forest'), fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(domainGenerationCapabilities('server'))).mockResolvedValueOnce(json(responseFor(source)))
    const { client, createWorker } = setup({ fetch: fetcher }), response = await client.execute(source, { server })
    expect(response.result.resultHash).toBe(generated.get('forest')!.result.resultHash)
    expect(fetcher).toHaveBeenCalledTimes(2); expect(createWorker).not.toHaveBeenCalled()
    expect(fetcher.mock.calls[0][0]).toBe(`${server.baseUrl}/v1/generation/capabilities`)
    expect(fetcher.mock.calls[1][0]).toBe(`${server.baseUrl}/v1/generation`)
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST', body: canonicalJson(source), credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' } })
  })

  it('stops before generation when capabilities or a streamed JSON response exceed the contract', async () => {
    const malformed = { ...domainGenerationCapabilities('server'), aiTools: ['implicit-authoring'] }
    for (const response of [json(malformed), new Response(' '.repeat(65_537), { headers: { 'Content-Type': 'application/json', 'Content-Length': '1' } }),
      new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } })]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response), { client, createWorker } = setup({ fetch: fetcher })
      await expect(client.execute(request(), { server })).rejects.toMatchObject({ code: 'protocol' })
      expect(fetcher).toHaveBeenCalledTimes(1); expect(createWorker).not.toHaveBeenCalled()
    }
  })

  it('keeps server domain failures readable and never retries a failed POST or falls back to Worker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(domainGenerationCapabilities('server')))
      .mockResolvedValueOnce(json({ schemaVersion: 1, error: { code: 'generation_contradiction', message: '指定范围无法满足房间关系。', retryable: false, requestState: 'not_sent' } }, 400))
    const { client, createWorker } = setup({ fetch: fetcher })
    await expect(client.execute(request(), { server })).rejects.toMatchObject({ code: 'generation_failed', message: '指定范围无法满足房间关系。' })
    expect(fetcher).toHaveBeenCalledTimes(2); expect(createWorker).not.toHaveBeenCalled()
  })

  it('cancels a server capability stream and rejects unsafe addresses before any network call', async () => {
    const canceled = vi.fn(), response = new Response(new ReadableStream({ cancel: canceled }), { headers: { 'Content-Type': 'application/json' } })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response), { client, createWorker } = setup({ fetch: fetcher })
    const pending = client.execute(request(), { server }), failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(response.body?.locked).toBe(true))
    client.cancel(); await failure; expect(canceled).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1); expect(createWorker).not.toHaveBeenCalled()
    await expect(client.execute(request(), { server: { ...server, baseUrl: 'http://remote.example' } })).rejects.toMatchObject({ code: 'configuration' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
