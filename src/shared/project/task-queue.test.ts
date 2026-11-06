import { describe, expect, it } from 'vitest'
import { WeightedTaskQueue } from './task-queue.js'

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
describe('bounded asynchronous work admission', () => {
  it('overlaps independent work while limiting active count and retaining FIFO order', async () => {
    const queue = new WeightedTaskQueue(2, 10), first = gate(), both = gate(), order: number[] = []
    let active = 0, peak = 0
    const jobs = [1, 2, 3, 4].map(id => queue.run(3, undefined, async () => {
      order.push(id); active++; peak = Math.max(peak, active)
      if (active === 2) both.release()
      await first.promise; active--; return id
    }))
    await both.promise
    expect(order).toEqual([1, 2]); expect(peak).toBe(2)
    first.release()
    expect(await Promise.all(jobs)).toEqual([1, 2, 3, 4]); expect(order).toEqual([1, 2, 3, 4]); expect(peak).toBe(2)
  })
  it('admits oversized tasks alone and does not bypass a waiting large task', async () => {
    const queue = new WeightedTaskQueue(2, 10), first = gate(), firstStarted = gate(), large = gate(), largeStarted = gate()
    const order: string[] = []
    const one = queue.run(4, undefined, async () => { order.push('first'); firstStarted.release(); await first.promise })
    const two = queue.run(100, undefined, async () => { order.push('large'); largeStarted.release(); await large.promise })
    const three = queue.run(1, undefined, () => { order.push('last') })
    await firstStarted.promise; expect(order).toEqual(['first'])
    first.release(); await largeStarted.promise; expect(order).toEqual(['first', 'large'])
    large.release(); await Promise.all([one, two, three]); expect(order).toEqual(['first', 'large', 'last'])
  })
  it('skips cancelled queued work and releases failed work before the next operation', async () => {
    const queue = new WeightedTaskQueue(1, 10), started = gate(), finish = gate(), signal = { aborted: false }
    const order: string[] = []
    const first = queue.run(1, undefined, async () => { started.release(); await finish.promise; throw new Error('actual failure') })
    const firstResult = first.catch(error => error.message)
    const cancelled = queue.run(1, signal, () => { order.push('cancelled') }).catch(error => error.name)
    const last = queue.run(1, undefined, () => { order.push('last') })
    await started.promise; signal.aborted = true; finish.release()
    expect(await firstResult).toBe('actual failure'); expect(await cancelled).toBe('AbortError')
    await last; expect(order).toEqual(['last'])
    expect(await queue.run(1, undefined, () => 'fresh')).toBe('fresh')
  })
})
