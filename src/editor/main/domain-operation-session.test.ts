import { describe, expect, it, vi } from 'vitest'
import { DomainOperationSession, domainOperationView, type DomainOperationLease } from './domain-operation-session'

const domains = ['interior', 'forest', 'volcano', 'mixed'] as const
type Domain = typeof domains[number]
type Previews = { [K in Domain]: { domain: K; sequence: number } }
const preview = <K extends Domain>(domain: K, sequence = 1): Previews[K] => ({ domain, sequence }) as Previews[K]
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  let checkpoint = 4
  const release = { interior: vi.fn(), forest: vi.fn(), volcano: vi.fn(), mixed: vi.fn() }
  const session = new DomainOperationSession<Previews>({ domains, checkpoint: () => checkpoint, sourceKey: 'scene:1', release })
  return { session, release, changeSource: (key = 'scene:2') => { checkpoint++; session.invalidateSource(checkpoint, key) },
    changeCheckpoint: () => { checkpoint++ }, checkpoint: () => checkpoint }
}

describe('domain operation session', () => {
  it.each(domains)('%s preserves form reset identity through preparation and resets only after adoption', async domain => {
    const { session, release } = setup(), input = preview(domain), preparing = deferred<Previews[typeof domain]>()
    expect(session.change(domain)).toBe(true)
    expect(domainOperationView(session.getSnapshot()[domain])).toMatchObject({ phase: 'draft', dirty: true, resetKey: 0 })
    const run = session.run(domain, () => preparing.promise)
    expect(domainOperationView(session.getSnapshot()[domain])).toMatchObject({ phase: 'preparing', busy: true, dirty: true, resetKey: 0 })
    preparing.resolve(input)
    expect(await run).toBe(input)
    expect(domainOperationView(session.getSnapshot()[domain])).toMatchObject({ phase: 'review', busy: false, dirty: false, preview: input })
    const apply = vi.fn(async (value: Previews[typeof domain]) => { expect(value).toBe(input) })
    expect(await session.adopt(domain, apply)).toBe(true)
    expect(apply).toHaveBeenCalledOnce()
    expect(session.getSnapshot()[domain]).toMatchObject({ phase: 'idle', resetKey: 1, error: null, preview: null })
    for (const other of domains.filter(value => value !== domain)) expect(session.getSnapshot()[other].resetKey).toBe(0)
    expect(release[domain]).not.toHaveBeenCalled()
  })

  it('owns a single domain across dirty forms, pending work and review, including synchronous double clicks', async () => {
    const { session } = setup(), ready = deferred<Previews['forest']>(), duplicate = vi.fn(async () => preview('forest', 2))
    session.change('forest')
    expect(session.change('interior')).toBe(false)
    expect(session.summary('forest').blocking).toBe(false)
    expect(session.summary('interior')).toMatchObject({ hasDraft: true, blocking: true })
    const run = session.run('forest', () => ready.promise)
    expect(await session.run('forest', duplicate)).toBeNull()
    expect(await session.run('mixed', async () => preview('mixed'))).toBeNull()
    expect(duplicate).not.toHaveBeenCalled()
    ready.resolve(preview('forest')); await run
    expect(session.active()).toEqual({ domain: 'forest', phase: 'review' })
    expect(session.currentPreview()).toEqual(preview('forest'))
    expect(await session.run('volcano', async () => preview('volcano'))).toBeNull()
    expect(session.getSnapshot().forest.phase).toBe('review')
    expect(session.summary('forest').blocking).toBe(false)
  })

  it('cancels synchronously and releases a late result without replacing a newer request', async () => {
    const { session, release } = setup(), old = deferred<Previews['mixed']>(), next = deferred<Previews['mixed']>()
    let oldLease!: DomainOperationLease, nextLease!: DomainOperationLease
    const first = session.run('mixed', lease => { oldLease = lease; return old.promise })
    expect(session.cancel('mixed')).toEqual({ domain: 'mixed', phase: 'preparing' })
    expect(oldLease.signal.aborted).toBe(true)
    expect(oldLease.isCurrent()).toBe(false)
    const second = session.run('mixed', lease => { nextLease = lease; return next.promise })
    expect(nextLease.epoch).toBeGreaterThan(oldLease.epoch)
    const stale = preview('mixed'), current = preview('mixed', 2)
    old.resolve(stale)
    expect(await first).toBeNull()
    expect(release.mixed).toHaveBeenCalledExactlyOnceWith(stale)
    expect(session.getSnapshot().mixed.phase).toBe('preparing')
    next.resolve(current); expect(await second).toBe(current)
    expect(session.getSnapshot().mixed.preview).toBe(current)
    expect(session.getSnapshot().mixed.error).toBeNull()
  })

  it('ignores an old rejection and does not automatically retry failed preparation', async () => {
    const { session } = setup(), old = deferred<Previews['interior']>(), next = deferred<Previews['interior']>()
    const first = session.run('interior', () => old.promise)
    session.cancel('interior', { reset: false })
    const prepare = vi.fn(() => next.promise), second = session.run('interior', prepare)
    old.reject(new Error('old request')); await first
    expect(session.getSnapshot().interior.error).toBeNull()
    next.reject(new Error('invalid room requirement')); expect(await second).toBeNull()
    expect(prepare).toHaveBeenCalledOnce()
    expect(domainOperationView(session.getSnapshot().interior)).toMatchObject({ phase: 'draft', dirty: true, busy: false, resetKey: 0, error: 'invalid room requirement' })
  })

  it('parameter changes release the old review and retain fields until explicit cancellation', async () => {
    const { session, release } = setup(), old = preview('volcano')
    await session.run('volcano', async () => old)
    expect(session.change('volcano')).toBe(true)
    expect(release.volcano).toHaveBeenCalledExactlyOnceWith(old)
    expect(session.getSnapshot().volcano).toMatchObject({ phase: 'draft', resetKey: 0, preview: null, error: null })
    expect(session.cancel('volcano')).toEqual({ domain: 'volcano', phase: 'draft' })
    expect(session.getSnapshot().volcano.resetKey).toBe(1)
    expect(session.currentPreview()).toBeNull()
    expect(release.volcano).toHaveBeenCalledOnce()
    expect(session.summary()).toEqual({ busy: false, hasDraft: false, hasCandidate: false, blocking: false })
  })

  it('invalidates drafts and review on source changes, and cannot publish against a changed checkpoint before an effect runs', async () => {
    const fixture = setup(), { session, release } = fixture
    session.change('forest'); fixture.changeSource()
    expect(session.getSnapshot().forest).toMatchObject({ phase: 'idle', resetKey: 1 })
    const reviewed = preview('interior'); await session.run('interior', async () => reviewed)
    fixture.changeSource('other-scene:1')
    expect(release.interior).toHaveBeenCalledExactlyOnceWith(reviewed)
    const pending = deferred<Previews['mixed']>(), stale = preview('mixed')
    const run = session.run('mixed', () => pending.promise)
    fixture.changeCheckpoint(); pending.resolve(stale)
    expect(await run).toBeNull()
    expect(release.mixed).toHaveBeenCalledExactlyOnceWith(stale)
    expect(session.getSnapshot().mixed.phase).toBe('idle')
  })

  it('does not cancel its own adoption when Workspace publishes a new project before resolving', async () => {
    const fixture = setup(), { session, release } = fixture, saved = deferred<void>()
    await session.run('mixed', async () => preview('mixed'))
    const adopt = session.adopt('mixed', async () => { fixture.changeSource('adopted-project:0'); await saved.promise })
    expect(session.getSnapshot().mixed.phase).toBe('adopting')
    expect(session.cancel('mixed')).toBeNull()
    expect(await session.adopt('mixed', async () => {})).toBe(false)
    expect(session.change('mixed')).toBe(false)
    expect(release.mixed).not.toHaveBeenCalled()
    saved.resolve(); expect(await adopt).toBe(true)
    expect(session.getSnapshot().mixed).toMatchObject({ phase: 'idle', resetKey: 1 })
  })

  it('adoption failure releases the candidate, preserves form fields and exposes the actual failure', async () => {
    const { session, release } = setup(), candidate = preview('forest')
    await session.run('forest', async () => candidate)
    await expect(session.adopt('forest', async () => { throw new Error('quota exceeded') })).rejects.toThrow('quota exceeded')
    expect(session.getSnapshot().forest).toMatchObject({ phase: 'draft', resetKey: 0, preview: null, error: 'quota exceeded' })
    expect(release.forest).toHaveBeenCalledExactlyOnceWith(candidate)
    expect(session.change('forest')).toBe(true)
    expect(session.getSnapshot().forest.error).toBeNull()
    expect(await session.run('forest', async () => preview('forest', 2))).toEqual(preview('forest', 2))
  })

  it('disposes in-flight work and is usable after a StrictMode effect re-setup', async () => {
    const { session, release } = setup(), pending = deferred<Previews['volcano']>()
    let lease!: DomainOperationLease
    const run = session.run('volcano', value => { lease = value; return pending.promise })
    session.dispose(); session.dispose()
    expect(lease.signal.aborted).toBe(true)
    expect(() => lease.assertCurrent()).toThrow('已取消')
    const stale = preview('volcano'); pending.resolve(stale)
    expect(await run).toBeNull()
    expect(release.volcano).toHaveBeenCalledExactlyOnceWith(stale)
    const next = preview('interior'); expect(await session.run('interior', async () => next)).toBe(next)
    session.dispose(); session.dispose()
    expect(release.interior).toHaveBeenCalledExactlyOnceWith(next)
  })
})
