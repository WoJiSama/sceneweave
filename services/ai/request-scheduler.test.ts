import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderCooldown } from './request-scheduler.js'

afterEach(() => vi.useRealTimers())

describe('serial provider response cooldown', () => {
  it('starts immediately, holds the slot through a response, and measures cooldown from release', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const scheduler = createProviderCooldown(10000), signal = new AbortController().signal
    const release = await scheduler.acquire(signal), granted = vi.fn()
    const waiting = scheduler.acquire(signal).then(next => { granted(); return next })
    await vi.advanceTimersByTimeAsync(20000)
    expect(granted).not.toHaveBeenCalled()
    release(); release()
    await vi.advanceTimersByTimeAsync(9999)
    expect(granted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    const next = await waiting
    expect(granted).toHaveBeenCalledOnce()
    next()
  })

  it('honours a captured previous completion and removes cancelled queued and active waiters', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const scheduler = createProviderCooldown(10000, { lastCompletedAt: 1000 })
    const first = new AbortController(), second = new AbortController(), third = new AbortController()
    const a = scheduler.acquire(first.signal), aRejected = expect(a).rejects.toMatchObject({ name: 'AbortError' })
    const b = scheduler.acquire(second.signal), bRejected = expect(b).rejects.toMatchObject({ name: 'AbortError' })
    const granted = vi.fn(), c = scheduler.acquire(third.signal).then(release => { granted(); return release })
    second.abort(); await bRejected
    await vi.advanceTimersByTimeAsync(5000)
    first.abort(); await aRejected
    await vi.advanceTimersByTimeAsync(4999)
    expect(granted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    const release = await c
    expect(granted).toHaveBeenCalledOnce()
    release()
  })

  it('does not bypass the configured interval when the clock moves backward', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const scheduler = createProviderCooldown(10000, { lastCompletedAt: 1000 })
    const granted = vi.fn(), waiting = scheduler.acquire(new AbortController().signal).then(release => { granted(); return release })
    vi.setSystemTime(0)
    await vi.advanceTimersByTimeAsync(10000)
    expect(granted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    const release = await waiting
    expect(granted).toHaveBeenCalledOnce()
    release()
  })

  it('supports zero cooldown without overlapping requests or accepting an already aborted waiter', async () => {
    const scheduler = createProviderCooldown(0), abort = new AbortController()
    abort.abort()
    await expect(scheduler.acquire(abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const release = await scheduler.acquire(new AbortController().signal), granted = vi.fn()
    const waiting = scheduler.acquire(new AbortController().signal).then(next => { granted(); return next })
    await Promise.resolve()
    expect(granted).not.toHaveBeenCalled()
    release()
    const next = await waiting
    expect(granted).toHaveBeenCalledOnce()
    next()
  })

  it.each([-1, 60001, 1.5, NaN, Infinity])('rejects invalid cooldown %s before any request', value => {
    expect(() => createProviderCooldown(value)).toThrow('Invalid provider cooldown')
  })
})
