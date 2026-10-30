import { describe, expect, it } from 'vitest'
import { BaseMapExecutionClock } from './base-map-clock.js'

describe('local generated-map execution checkpoint', () => {
  it('retains failed/cancelled work and excludes user review without resetting the flow', () => {
    let now = 0
    const clock = new BaseMapExecutionClock(100, () => now)
    expect(() => clock.begin('missing')).toThrow()
    clock.initialize('flow', 40)
    const abort = { aborted: false }, first = clock.begin('flow', abort)
    expect(() => clock.begin('flow')).toThrow()
    now = 20; abort.aborted = true
    expect(first.signal.aborted).toBe(true)
    first.finish(); first.finish()
    now = 2000
    const second = clock.begin('flow')
    now = 2039; expect(second.signal.aborted).toBe(false)
    now = 2040; expect(second.signal.aborted).toBe(true)
    second.finish()
    expect(() => clock.begin('flow')).toThrow(/用尽/)
    expect(() => clock.initialize('flow', 0)).toThrow()
  })
})
