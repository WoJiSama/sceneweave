export type DomainOperationPhase = 'idle' | 'draft' | 'preparing' | 'review' | 'adopting'
export type DomainOperationState<P> = {
  readonly resetKey: number
  readonly error: string | null
} & (
  | { readonly phase: 'idle' | 'draft' | 'preparing'; readonly preview: null }
  | { readonly phase: 'review' | 'adopting'; readonly preview: P }
)
export type DomainOperationSnapshot<M extends object> = { readonly [K in keyof M]: DomainOperationState<M[K]> }
export interface DomainOperationLease {
  readonly epoch: number
  readonly checkpoint: number
  readonly signal: AbortSignal
  isCurrent(): boolean
  assertCurrent(): void
}
export interface DomainOperationSummary {
  busy: boolean
  hasDraft: boolean
  hasCandidate: boolean
  blocking: boolean
}
export function domainOperationView<S extends DomainOperationState<unknown>>(state: S) {
  return { ...state, busy: state.phase === 'preparing' || state.phase === 'adopting', dirty: state.phase === 'draft' || state.phase === 'preparing' }
}

interface Attempt { epoch: number; checkpoint: number; controller: AbortController }
const idle = (resetKey = 0): DomainOperationState<never> => ({ phase: 'idle', preview: null, resetKey, error: null })

/** UI operation ownership only. Workspace remains the owner of candidate validity,
 * protected adoption and persistence. Form values stay in their mounted panels. */
export class DomainOperationSession<M extends object> {
  private snapshot: DomainOperationSnapshot<M>
  private readonly listeners = new Set<() => void>()
  private readonly attempts = new Map<keyof M, Attempt>()
  private epoch = 0
  private source: { checkpoint: number; key: string }

  constructor(private readonly options: {
    domains: readonly (keyof M)[]
    checkpoint(): number
    sourceKey: string
    release: { [K in keyof M]: (preview: M[K]) => void }
  }) {
    this.snapshot = Object.fromEntries(options.domains.map(domain => [domain, idle()])) as DomainOperationSnapshot<M>
    this.source = { checkpoint: options.checkpoint(), key: options.sourceKey }
  }

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = (): DomainOperationSnapshot<M> => this.snapshot

  summary(except?: keyof M): DomainOperationSummary {
    const result = { busy: false, hasDraft: false, hasCandidate: false, blocking: false }
    for (const domain of this.options.domains) {
      if (domain === except) continue
      const state = this.snapshot[domain]
      result.busy ||= state.phase === 'preparing' || state.phase === 'adopting'
      result.hasDraft ||= state.phase === 'draft' || state.phase === 'preparing'
      result.hasCandidate ||= state.phase === 'review' || state.phase === 'adopting'
      result.blocking ||= state.phase !== 'idle'
    }
    return result
  }

  active(): { domain: keyof M; phase: Exclude<DomainOperationPhase, 'idle'> } | null {
    for (const domain of this.options.domains) {
      const phase = this.snapshot[domain].phase
      if (phase !== 'idle') return { domain, phase }
    }
    return null
  }

  currentPreview(): M[keyof M] | null {
    const current = this.active()
    return current ? this.snapshot[current.domain].preview : null
  }

  reportError<K extends keyof M>(domain: K, error: unknown): void {
    this.set(domain, { ...this.snapshot[domain], error: error instanceof Error ? error.message : String(error) })
  }

  change<K extends keyof M>(domain: K): boolean {
    if (this.summary(domain).blocking || this.snapshot[domain].phase === 'adopting') return false
    this.cancel(domain, { reset: false })
    this.set(domain, { phase: 'draft', preview: null, resetKey: this.snapshot[domain].resetKey, error: null })
    return true
  }

  cancel<K extends keyof M>(domain: K, options: { reset?: boolean } = {}): { domain: K; phase: DomainOperationPhase } | null {
    const state = this.snapshot[domain]
    // Saving is not a preview job. Cancellation must not imply durable rollback.
    if (state.phase === 'adopting') return null
    this.stop(domain)
    this.set(domain, idle(state.resetKey + (options.reset === false ? 0 : 1)))
    if (state.preview !== null) this.options.release[domain](state.preview)
    return state.phase === 'idle' ? null : { domain, phase: state.phase }
  }

  async run<K extends keyof M>(domain: K, prepare: (lease: DomainOperationLease) => Promise<M[K]>): Promise<M[K] | null> {
    const state = this.snapshot[domain]
    if (state.phase === 'preparing' || state.phase === 'adopting') return null
    if (this.summary(domain).blocking) {
      this.reportError(domain, '其他地图操作尚未结束，请先采用或取消当前候选或参数修改。')
      return null
    }
    this.cancel(domain, { reset: false })
    const attempt: Attempt = { epoch: ++this.epoch, checkpoint: this.options.checkpoint(), controller: new AbortController() }
    this.attempts.set(domain, attempt)
    const current = () => this.attempts.get(domain) === attempt && !attempt.controller.signal.aborted && attempt.checkpoint === this.options.checkpoint()
    const lease: DomainOperationLease = { epoch: attempt.epoch, checkpoint: attempt.checkpoint, signal: attempt.controller.signal, isCurrent: current,
      assertCurrent: () => { if (!current()) throw new Error('地图生成操作已取消或工程基线已改变。') } }
    this.set(domain, { phase: 'preparing', preview: null, resetKey: state.resetKey, error: null })
    try {
      const preview = await prepare(lease)
      if (!current()) {
        this.options.release[domain](preview)
        if (this.attempts.get(domain) === attempt) this.cancel(domain)
        return null
      }
      this.attempts.delete(domain)
      this.set(domain, { phase: 'review', preview, resetKey: state.resetKey, error: null })
      return preview
    } catch (error) {
      if (current()) {
        this.attempts.delete(domain)
        this.set(domain, { phase: 'draft', preview: null, resetKey: state.resetKey, error: error instanceof Error ? error.message : String(error) })
      } else if (this.attempts.get(domain) === attempt) this.cancel(domain)
      return null
    }
  }

  async adopt<K extends keyof M>(domain: K, apply: (preview: M[K]) => Promise<void>): Promise<boolean> {
    const state = this.snapshot[domain]
    if (state.phase !== 'review' || this.summary(domain).blocking) return false
    const attempt: Attempt = { epoch: ++this.epoch, checkpoint: this.options.checkpoint(), controller: new AbortController() }
    this.attempts.set(domain, attempt)
    this.set(domain, { ...state, phase: 'adopting' })
    try {
      await apply(state.preview)
      if (this.attempts.get(domain) !== attempt) return false
      this.attempts.delete(domain)
      this.set(domain, idle(state.resetKey + 1))
      return true
    } catch (error) {
      if (this.attempts.get(domain) === attempt) {
        this.attempts.delete(domain)
        this.set(domain, { phase: 'draft', preview: null, resetKey: state.resetKey, error: error instanceof Error ? error.message : String(error) })
        this.options.release[domain](state.preview)
      }
      throw error
    }
  }

  invalidateSource(checkpoint: number, sourceKey: string): void {
    if (checkpoint === this.source.checkpoint && sourceKey === this.source.key) return
    this.source = { checkpoint, key: sourceKey }
    for (const domain of this.options.domains) {
      const phase = this.snapshot[domain].phase
      // Workspace may publish the adopted project before its promise resolves.
      // It owns CAS; our adopting operation must be allowed to finish.
      // A different source also resets each mounted panel's previously entered
      // fields, even if its last candidate was silently cleared by settings.
      if (phase !== 'adopting') this.cancel(domain)
    }
  }

  /** Ends this lifecycle without making the store unusable after effect re-setup. */
  dispose(): void {
    for (const domain of this.options.domains) {
      const state = this.snapshot[domain]
      this.stop(domain)
      this.set(domain, idle(state.resetKey))
      if (state.preview !== null) this.options.release[domain](state.preview)
    }
  }

  private stop(domain: keyof M): void {
    const attempt = this.attempts.get(domain)
    this.attempts.delete(domain)
    attempt?.controller.abort()
  }

  private set<K extends keyof M>(domain: K, state: DomainOperationState<M[K]>): void {
    this.snapshot = { ...this.snapshot, [domain]: state }
    for (const listener of this.listeners) listener()
  }
}
