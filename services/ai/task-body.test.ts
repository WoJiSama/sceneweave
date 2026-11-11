import { describe, expect, it, vi } from 'vitest'
import { createTaskBodyReader } from './task-body.js'

const headers = { 'Content-Type': 'application/json' }
function heldBody(signal: AbortSignal) {
  const cancelled = vi.fn(), pulled = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, pull: pulled, cancel: cancelled,
  }, { highWaterMark: 0 })
  return { request: new Request('http://local.test/v1/tasks', { method: 'POST', headers, body, signal, duplex: 'half' } as RequestInit), cancelled, pulled }
}

describe('task upload byte admission', () => {
  it('bounds combined upload buffers independently of request count and restores both reservations on cancellation', async () => {
    const read = createTaskBodyReader({ maxConcurrent: 3, maxBytes: 12, timeoutMs: 1000 })
    const controllers = Array.from({ length: 3 }, () => new AbortController())
    const bodies = controllers.map(controller => heldBody(controller.signal))
    const first = read(bodies[0].request, 6), second = read(bodies[1].request, 6)
    const firstResult = expect(first).rejects.toMatchObject({ code: 'request_cancelled' })
    const secondResult = expect(second).rejects.toMatchObject({ code: 'request_cancelled' })
    try {
      await expect(read(bodies[2].request, 6)).rejects.toMatchObject({ code: 'request_limit', status: 429 })
      expect(bodies[2].cancelled).toHaveBeenCalledOnce()
      expect(bodies[2].pulled).not.toHaveBeenCalled()
    } finally {
      controllers.forEach(controller => controller.abort())
      await Promise.all([firstResult, secondResult])
    }
    expect(bodies[0].cancelled).toHaveBeenCalledOnce()
    expect(bodies[1].cancelled).toHaveBeenCalledOnce()
    await expect(read(new Request('http://local.test/v1/tasks', { method: 'POST', headers, body: '{}' }), 12)).resolves.toEqual({})
  })

  it('releases admission after a malformed body and rejects byte overflow without awaiting sender cancellation', async () => {
    const read = createTaskBodyReader({ maxConcurrent: 1, maxBytes: 8 })
    const request = (body: string, declared?: string) => new Request('http://local.test/v1/tasks', {
      method: 'POST', headers: { ...headers, ...(declared ? { 'Content-Length': declared } : {}) }, body,
    })
    await expect(read(request('not-json'), 8)).rejects.toMatchObject({ code: 'invalid_request', status: 400 })
    await expect(read(request('{}', '3'), 8)).rejects.toMatchObject({ code: 'invalid_request', status: 400 })
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(9)) }, cancel })
    const oversized = new Request('http://local.test/v1/tasks', { method: 'POST', headers, body, duplex: 'half' } as RequestInit)
    await expect(read(oversized, 8)).rejects.toMatchObject({ code: 'request_limit', status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
    await expect(read(request('{}'), 8)).resolves.toEqual({})
  })
})
