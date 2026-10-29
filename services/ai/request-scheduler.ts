import type { ProviderRequestScheduler } from './provider-types.js'

const aborted = () => new DOMException('Request scheduling interrupted', 'AbortError')
interface Waiter { signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: unknown) => void; abort: () => void }

/** Serial response-to-request cooldown shared by all tasks using this instance. No retries. */
export function createProviderCooldown(cooldownMs: number, options: { now?: () => number; lastCompletedAt?: number } = {}): ProviderRequestScheduler {
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 60_000
    || options.lastCompletedAt !== undefined && (!Number.isSafeInteger(options.lastCompletedAt) || options.lastCompletedAt < 0)) throw new Error('Invalid provider cooldown')
  const now = options.now ?? Date.now, queue: Waiter[] = []
  let lastCompletedAt = options.lastCompletedAt, occupied = false
  const pump = () => {
    if (occupied) return
    const waiter = queue.shift()
    if (!waiter) return
    waiter.signal.removeEventListener('abort', waiter.abort)
    occupied = true
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined
    const free = () => { occupied = false; pump() }
    waiter.abort = () => {
      if (settled) return
      settled = true; clearTimeout(timer); waiter.signal.removeEventListener('abort', waiter.abort)
      waiter.reject(aborted()); free()
    }
    waiter.signal.addEventListener('abort', waiter.abort, { once: true })
    if (waiter.signal.aborted) { waiter.abort(); return }
    const grant = () => {
      if (settled) return
      // A backward wall-clock adjustment cannot bypass the cooldown.
      const delay = lastCompletedAt === undefined ? 0 : Math.max(0, cooldownMs - Math.max(0, now() - lastCompletedAt))
      if (delay) { timer = setTimeout(grant, delay); return }
      settled = true; waiter.signal.removeEventListener('abort', waiter.abort)
      let released = false
      waiter.resolve(() => {
        if (released) return
        released = true; lastCompletedAt = now(); free()
      })
    }
    grant()
  }
  return { cooldownMs, acquire(signal) {
    if (signal.aborted) return Promise.reject(aborted())
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject, abort: () => {
        const index = queue.indexOf(waiter)
        if (index < 0) return
        queue.splice(index, 1); signal.removeEventListener('abort', waiter.abort); reject(aborted())
      } }
      signal.addEventListener('abort', waiter.abort, { once: true })
      queue.push(waiter)
      pump()
    })
  } }
}
