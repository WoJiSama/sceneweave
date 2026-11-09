export interface PreviewJob<T> {
  run(signal: AbortSignal): Promise<T>
  publish(value: T): void
  fail?(error: unknown): void
  onPending?(pending: boolean): void
}

export interface PreviewRequest { cancel(): void }

interface Attempt { controller: AbortController }
interface Task<T> {
  scope: object
  job: PreviewJob<T>
  state: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'
  eligibleAt: number
  attempt?: Attempt
  timer?: ReturnType<typeof setTimeout>
  value?: { owned: T }
}

/** One preview consumer owns its transient results. Scope is scheduling identity,
 * never a content/resource certificate. This owner cannot cancel a save job. */
export class PreviewScheduler<T> {
  private scope: object | null = null
  private main: Task<T> | null = null
  private refinement: Task<T> | null = null
  private activeMain?: Attempt
  private activeRefinement?: Attempt
  private busy = false

  constructor(private readonly release: (value: T) => void, private readonly refinementDelayMs = 300) {}

  /** Revoke old publication synchronously, before deferred rendering begins. */
  setScope(scope: object): void {
    if (scope === this.scope) return
    this.cancel(this.main)
    this.cancel(this.refinement)
    this.scope = scope
  }

  runMain(scope: object, job: PreviewJob<T>): PreviewRequest {
    this.setScope(scope)
    this.cancel(this.main)
    this.cancel(this.refinement)
    this.scope = scope
    const task = this.task(scope, job, 0)
    this.main = task
    this.scheduleMain()
    return { cancel: () => this.cancel(task) }
  }

  requestRefinement(scope: object, job: PreviewJob<T>): PreviewRequest {
    // A late effect from an old scene/audience must not revive that scope.
    if (scope !== this.scope || this.main?.state === 'failed') return { cancel() {} }
    this.cancel(this.refinement)
    const task = this.task(scope, job, this.refinementDelayMs)
    this.refinement = task
    job.onPending?.(true)
    this.scheduleRefinement()
    return { cancel: () => this.cancel(task) }
  }

  setBusy(busy: boolean): void {
    if (busy === this.busy) return
    this.busy = busy
    const task = this.refinement
    if (busy && task && (task.state === 'pending' || task.state === 'running')) {
      this.stopAttempt(task)
      task.state = 'pending'
    }
    if (!busy) this.scheduleRefinement()
  }

  /** Release this lifecycle's work/results. New explicit requests can start a
   * new lifecycle, including React's effect setup after a strict-mode cleanup. */
  dispose(): void {
    this.cancel(this.main)
    this.cancel(this.refinement)
    this.scope = null
  }

  private task(scope: object, job: PreviewJob<T>, delay: number): Task<T> {
    return { scope, job, state: 'pending', eligibleAt: Date.now() + delay }
  }

  private stopAttempt(task: Task<T>): void {
    if (task.timer !== undefined) clearTimeout(task.timer)
    task.timer = undefined
    task.attempt?.controller.abort()
    task.attempt = undefined
  }

  private cancel(task: Task<T> | null): void {
    if (!task || task.state === 'cancelled') return
    const pending = task.state === 'pending' || task.state === 'running'
    task.state = 'cancelled'
    this.stopAttempt(task)
    if (task.value) { this.release(task.value.owned); task.value = undefined }
    if (this.main === task) { this.main = null; this.scope = null; this.cancel(this.refinement) }
    if (this.refinement === task) this.refinement = null
    if (pending) task.job.onPending?.(false)
  }

  private scheduleRefinement(): void {
    const task = this.refinement
    if (!task || task.state !== 'pending' || task.timer !== undefined || this.busy || this.activeMain || this.activeRefinement || this.main?.state !== 'complete') return
    // Busy intervals do not restart the debounce deadline. The latest eligible
    // crop receives an opportunity as soon as higher-priority work is idle.
    task.timer = setTimeout(() => {
      task.timer = undefined
      if (this.refinement === task && task.scope === this.scope && !this.busy && !this.activeMain && !this.activeRefinement && this.main?.state === 'complete') this.start(task, 'refinement')
    }, Math.max(0, task.eligibleAt - Date.now()))
  }

  private scheduleMain(): void {
    if (!this.activeMain && this.main?.state === 'pending') this.start(this.main, 'main')
  }

  private start(task: Task<T>, kind: 'main' | 'refinement'): void {
    const attempt = { controller: new AbortController() }
    task.attempt = attempt
    task.state = 'running'
    if (kind === 'main') this.activeMain = attempt
    else this.activeRefinement = attempt
    const current = () => task.scope === this.scope && this[kind] === task && task.attempt === attempt && !attempt.controller.signal.aborted
    void (async () => {
      try {
        const value = await task.job.run(attempt.controller.signal)
        if (!current()) { this.release(value); return }
        task.attempt = undefined; task.state = 'complete'; task.value = { owned: value }
        task.job.onPending?.(false)
        task.job.publish(value)
      } catch (error) {
        if (current()) {
          task.attempt = undefined; task.state = 'failed'; task.job.onPending?.(false)
          if (kind === 'main') this.cancel(this.refinement)
          task.job.fail?.(error)
        }
      } finally {
        if (kind === 'main' && this.activeMain === attempt) this.activeMain = undefined
        if (kind === 'refinement' && this.activeRefinement === attempt) this.activeRefinement = undefined
        // Cancellation revokes publication immediately, but replacement work
        // waits for this lane's cleanup. At most one main and one draining
        // refinement run exist; rapid snapshot changes cannot fan out work.
        this.scheduleMain()
        this.scheduleRefinement()
      }
    })()
  }
}
