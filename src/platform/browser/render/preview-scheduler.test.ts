import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewScheduler, type PreviewJob } from './preview-scheduler.js'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fixture() {
  const release = vi.fn(), scheduler = new PreviewScheduler<string>(release)
  const job = (run: PreviewJob<string>['run'] = async () => 'image') => ({ run: vi.fn(run), publish: vi.fn(), fail: vi.fn(), onPending: vi.fn() })
  return { scheduler, release, job }
}

afterEach(() => vi.useRealTimers())

describe('preview work lifecycle', () => {
  it('publishes only the latest scene/snapshot/audience owner and releases late results', async () => {
    const { scheduler, release, job } = fixture(), old = deferred<string>(), next = deferred<string>()
    const gm = job(() => old.promise), player = job(() => next.promise)
    scheduler.runMain({}, gm)
    scheduler.runMain({}, player)
    expect(gm.run.mock.calls[0][0].aborted).toBe(true)
    expect(player.run).not.toHaveBeenCalled()
    next.resolve('player'); await next.promise
    old.resolve('secret-gm'); await old.promise
    await Promise.resolve()
    expect(player.publish).toHaveBeenCalledExactlyOnceWith('player')
    expect(gm.publish).not.toHaveBeenCalled(); expect(gm.fail).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledExactlyOnceWith('secret-gm')
    scheduler.dispose()
    expect(release.mock.calls).toEqual([['secret-gm'], ['player']])
  })

  it('does not let a stale failure or stale refinement revive a replaced owner', async () => {
    vi.useFakeTimers()
    const { scheduler, job } = fixture(), oldScope = {}, nextScope = {}, old = deferred<string>()
    const first = job(() => old.promise), latest = job(), staleCrop = job()
    scheduler.runMain(oldScope, first)
    scheduler.runMain(nextScope, latest)
    old.reject(new Error('old decoder failed')); await old.promise.catch(() => {})
    scheduler.requestRefinement(oldScope, staleCrop)
    await vi.advanceTimersByTimeAsync(1000)
    expect(first.fail).not.toHaveBeenCalled(); expect(staleCrop.run).not.toHaveBeenCalled()
    expect(latest.publish).toHaveBeenCalledOnce()
    scheduler.dispose()
  })

  it('revokes an old committed scope before the replacement render has started', async () => {
    const { scheduler, release, job } = fixture(), pending = deferred<string>(), old = job(() => pending.promise), nextScope = {}
    scheduler.runMain({}, old)
    scheduler.setScope(nextScope)
    expect(old.run.mock.calls[0][0].aborted).toBe(true)
    pending.resolve('old audience'); await pending.promise
    expect(old.publish).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledExactlyOnceWith('old audience')
    const latest = job()
    scheduler.runMain(nextScope, latest); await Promise.resolve()
    expect(latest.publish).toHaveBeenCalledOnce()
    scheduler.dispose()
  })

  it('lets main rendering finish before the latest deferred refinement starts', async () => {
    vi.useFakeTimers()
    const { scheduler, job } = fixture(), scope = {}, main = deferred<string>()
    scheduler.runMain(scope, job(() => main.promise))
    const obsolete = job(), latest = job()
    scheduler.requestRefinement(scope, obsolete)
    scheduler.requestRefinement(scope, latest)
    await vi.advanceTimersByTimeAsync(1000)
    expect(latest.run).not.toHaveBeenCalled()
    main.resolve('main'); await main.promise
    await vi.advanceTimersByTimeAsync(0)
    expect(obsolete.run).not.toHaveBeenCalled()
    expect(latest.run).toHaveBeenCalledOnce(); expect(latest.publish).toHaveBeenCalledOnce()
    expect(latest.onPending.mock.calls).toEqual([[true], [false]])
    scheduler.dispose()
  })

  it('retains the latest crop while save/interaction is busy without restarting its wait deadline', async () => {
    vi.useFakeTimers()
    const { scheduler, job } = fixture(), scope = {}
    scheduler.runMain(scope, job()); await Promise.resolve()
    scheduler.setBusy(true)
    const obsolete = job(), latest = job()
    scheduler.requestRefinement(scope, obsolete)
    await vi.advanceTimersByTimeAsync(400)
    scheduler.requestRefinement(scope, latest)
    await vi.advanceTimersByTimeAsync(500)
    scheduler.setBusy(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(obsolete.run).not.toHaveBeenCalled()
    expect(latest.run).toHaveBeenCalledOnce(); expect(latest.publish).toHaveBeenCalledOnce()
    scheduler.dispose()
  })

  it('cancels an in-flight crop consumer, ignores late work, and retries it when priority work ends', async () => {
    vi.useFakeTimers()
    const { scheduler, release, job } = fixture(), scope = {}, first = deferred<string>(), resumed = deferred<string>()
    scheduler.runMain(scope, job()); await Promise.resolve()
    const crop = job(vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => resumed.promise))
    scheduler.requestRefinement(scope, crop)
    await vi.advanceTimersByTimeAsync(300)
    const signal = crop.run.mock.calls[0][0]
    scheduler.setBusy(true)
    expect(signal.aborted).toBe(true)
    first.resolve('obsolete crop'); await first.promise
    expect(crop.publish).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledWith('obsolete crop')
    expect(crop.onPending.mock.calls).toEqual([[true]])
    scheduler.setBusy(false); await vi.advanceTimersByTimeAsync(0)
    resumed.resolve('current crop'); await resumed.promise
    expect(crop.publish).toHaveBeenCalledExactlyOnceWith('current crop')
    expect(crop.onPending.mock.calls).toEqual([[true], [false]])
    scheduler.dispose()
  })

  it('preempts old detail for a new main image and releases each published image once', async () => {
    vi.useFakeTimers()
    const { scheduler, release, job } = fixture(), scope = {}, pending = deferred<string>()
    scheduler.runMain(scope, job(async () => 'first main')); await Promise.resolve()
    const detail = job(() => pending.promise)
    scheduler.requestRefinement(scope, detail); await vi.advanceTimersByTimeAsync(300)
    const next = scheduler.runMain({}, job(async () => 'next main'))
    expect(detail.run.mock.calls[0][0].aborted).toBe(true)
    pending.resolve('late detail'); await pending.promise
    next.cancel(); next.cancel(); scheduler.dispose()
    expect(detail.publish).not.toHaveBeenCalled()
    expect(release.mock.calls).toEqual([['first main'], ['late detail'], ['next main']])
  })

  it('drains late results after teardown and can start a fresh effect lifecycle', async () => {
    const { scheduler, release, job } = fixture(), pending = deferred<string>(), old = job(() => pending.promise)
    const request = scheduler.runMain({}, old)
    scheduler.dispose(); request.cancel()
    const latest = job(async () => 'new lifecycle')
    scheduler.runMain({}, latest)
    pending.resolve('late'); await pending.promise
    await Promise.resolve()
    expect(old.publish).not.toHaveBeenCalled(); expect(old.fail).not.toHaveBeenCalled()
    expect(latest.publish).toHaveBeenCalledExactlyOnceWith('new lifecycle')
    expect(release).toHaveBeenCalledExactlyOnceWith('late')
    scheduler.dispose()
  })

  it('bounds active work and coalesces rapid main requests while a cancelled decoder drains', async () => {
    const { scheduler, release, job } = fixture(), pending = deferred<string>(), first = job(() => pending.promise)
    scheduler.runMain({}, first)
    const skipped = Array.from({ length: 20 }, () => job())
    for (const candidate of skipped) scheduler.runMain({}, candidate)
    const latest = job(async () => 'latest')
    scheduler.runMain({}, latest)
    expect(skipped.every(candidate => candidate.run.mock.calls.length === 0)).toBe(true)
    expect(latest.run).not.toHaveBeenCalled()
    pending.resolve('drained'); await pending.promise; await Promise.resolve()
    expect(latest.publish).toHaveBeenCalledExactlyOnceWith('latest')
    expect(release).toHaveBeenCalledExactlyOnceWith('drained')
    scheduler.dispose()
  })

  it('reports a current failure once and permits a later request to recover', async () => {
    const { scheduler, job } = fixture(), error = new Error('actual decoder failure'), failed = job(async () => { throw error })
    scheduler.runMain({}, failed); await Promise.resolve()
    expect(failed.fail).toHaveBeenCalledExactlyOnceWith(error); expect(failed.publish).not.toHaveBeenCalled()
    const latest = job()
    scheduler.runMain({}, latest); await Promise.resolve()
    expect(latest.publish).toHaveBeenCalledOnce()
    scheduler.dispose()
  })

  it('does not substitute a crop for a failed or cancelled complete main image', async () => {
    vi.useFakeTimers()
    const { scheduler, job } = fixture(), scope = {}, main = deferred<string>(), crop = job()
    scheduler.runMain(scope, job(() => main.promise))
    scheduler.requestRefinement(scope, crop)
    main.reject(new Error('invalid complete image')); await main.promise.catch(() => {})
    const late = job(); scheduler.requestRefinement(scope, late)
    await vi.advanceTimersByTimeAsync(1000)
    expect(crop.run).not.toHaveBeenCalled(); expect(late.run).not.toHaveBeenCalled()
    expect(crop.onPending.mock.calls).toEqual([[true], [false]])
    const nextScope = {}, request = scheduler.runMain(nextScope, job())
    await Promise.resolve(); request.cancel()
    scheduler.requestRefinement(nextScope, late)
    await vi.advanceTimersByTimeAsync(1000)
    expect(late.run).not.toHaveBeenCalled()
    scheduler.dispose()
  })
})
