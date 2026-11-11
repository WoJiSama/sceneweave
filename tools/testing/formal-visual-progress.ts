import { closeSync, linkSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type Failure = { message: string; stack?: string }
type Phase = { name: string; status: string; startedMs: number; elapsedMs?: number; facts?: unknown }
type Operation = Phase & { phase: string; failure?: Failure }

function failure(value: unknown): Failure {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return { message: String(value.message), ...('stack' in value && typeof value.stack === 'string' ? { stack: value.stack } : {}) }
  }
  return { message: String(value) }
}

/** Synchronous atomic checkpoints do not depend on the browser completing its
 * cancelled operation. These diagnostic wall times are not performance evidence. */
export class FormalVisualProgress {
  private readonly path: string
  private readonly now: () => number
  private readonly started: number
  private readonly state: {
    format: string; version: number; scope: string; metadata: Record<string, unknown>; status: string;
    startedAt: string; elapsedMs: number; completeFactsArtifact: string | null; firstFailure: Failure | null;
    phases: Phase[]; operations: Operation[]; errors: Failure[]; cleanupErrors: Failure[]; recordingErrors: Failure[]
  }

  constructor(path: string, metadata: Record<string, unknown>, now: () => number = () => performance.now()) {
    this.path = path; this.now = now; this.started = now()
    this.state = { format: 'sceneweave-formal-visual-progress', version: 1,
      scope: 'Diagnostic phase progress and actual completed observations only; partial data never replaces full technical facts, visual acceptance, P3 or formal performance.',
      metadata: structuredClone(metadata), status: 'running', startedAt: new Date().toISOString(), elapsedMs: 0,
      completeFactsArtifact: null, firstFailure: null, phases: [], operations: [], errors: [], cleanupErrors: [], recordingErrors: [] }
    mkdirSync(dirname(path), { recursive: true })
    // Each Playwright test gets its own outputPath. Refuse stale output rather
    // than overwriting evidence from an earlier execution.
    this.persist(true)
  }

  private elapsed() { return this.now() - this.started }
  private bytes() {
    this.state.elapsedMs = this.elapsed()
    return `${JSON.stringify(this.state, null, 2)}\n`
  }
  private persist(initial = false) {
    const pending = `${this.path}.pending-${process.pid}`
    let owned = false
    try {
      const descriptor = openSync(pending, 'wx'); owned = true
      try { writeFileSync(descriptor, this.bytes()) } finally { closeSync(descriptor) }
      if (initial) { linkSync(pending, this.path); rmSync(pending) }
      else renameSync(pending, this.path)
    } catch (error) {
      if (owned) {
        try { rmSync(pending, { force: true }) } catch { /* Preserve the original write or publication failure. */ }
      }
      throw error
    }
  }
  private preserveFailure(value: unknown) {
    this.state.firstFailure ??= failure(value)
    try { this.persist() } catch (error) { this.state.recordingErrors.push(failure(error)) }
  }

  begin(name: string) {
    if (this.state.status !== 'running') return
    if (this.state.phases.at(-1)?.status === 'running') throw new Error('Complete the current visual phase before starting another.')
    this.state.phases.push({ name, status: 'running', startedMs: this.elapsed() }); this.persist()
  }

  complete(facts: unknown) {
    if (this.state.status !== 'running') return
    const phase = this.state.phases.at(-1)
    if (!phase || phase.status !== 'running') throw new Error('No running visual phase to complete.')
    phase.status = 'complete'; phase.elapsedMs = this.elapsed() - phase.startedMs; phase.facts = structuredClone(facts); this.persist()
  }

  async measure<T>(name: string, run: () => Promise<T>, summarize?: (result: T) => unknown): Promise<T> {
    if (this.state.status !== 'running') throw new Error('Visual progress is finalized; no later operation may start.')
    const operation: Operation = { name, phase: this.state.phases.at(-1)?.name ?? 'setup', status: 'running', startedMs: this.elapsed() }
    this.state.operations.push(operation); this.persist()
    try {
      const result = await run()
      if (this.state.status === 'running') {
        operation.status = 'complete'; operation.elapsedMs = this.elapsed() - operation.startedMs
        if (summarize) operation.facts = structuredClone(summarize(result))
        this.persist()
      }
      return result
    } catch (error) {
      if (this.state.status === 'running') {
        operation.status = 'failed'; operation.elapsedMs = this.elapsed() - operation.startedMs; operation.failure = failure(error)
        this.preserveFailure(error)
      }
      throw error
    }
  }

  /** Resource cleanup always runs, including after timeout finalization or a
   * checkpoint write failure. Only the actual cleanup failure may reject it. */
  async cleanup<T>(name: string, run: () => Promise<T>): Promise<T> {
    if (this.state.status !== 'running') return run()
    const operation: Operation = { name, phase: this.state.phases.at(-1)?.name ?? 'setup', status: 'running', startedMs: this.elapsed() }
    this.state.operations.push(operation)
    try { this.persist() } catch (error) { this.state.recordingErrors.push(failure(error)) }
    try {
      const result = await run()
      if (this.state.status === 'running') {
        operation.status = 'complete'; operation.elapsedMs = this.elapsed() - operation.startedMs
        try { this.persist() } catch (error) { this.state.recordingErrors.push(failure(error)) }
      }
      return result
    } catch (error) {
      if (this.state.status === 'running') {
        operation.status = 'failed'; operation.elapsedMs = this.elapsed() - operation.startedMs; operation.failure = failure(error)
        this.cleanupFailed(error)
      }
      throw error
    }
  }

  cleanupFailed(value: unknown) {
    if (this.state.status !== 'running') return
    this.state.cleanupErrors.push(failure(value)); this.preserveFailure(value)
  }

  failed(value: unknown) {
    if (this.state.status === 'running') this.preserveFailure(value)
  }

  factsWritten(artifact: string) {
    if (this.state.status !== 'running') return
    this.state.completeFactsArtifact = artifact; this.persist()
  }

  finish(status: string, errors: unknown[]) {
    if (this.state.status !== 'running') return
    const at = this.elapsed()
    this.state.status = status; this.state.errors = errors.map(failure)
    // Playwright knows the actual primary timeout/assertion. An operation may
    // only have observed a later "context closed" rejection during cancellation.
    this.state.firstFailure = this.state.errors[0] ?? this.state.firstFailure
    for (const phase of this.state.phases) if (phase.status === 'running') {
      phase.status = status === 'failed' ? 'failed' : 'interrupted'; phase.elapsedMs = at - phase.startedMs
    }
    for (const operation of this.state.operations) if (operation.status === 'running') {
      operation.status = 'interrupted'; operation.elapsedMs = at - operation.startedMs
    }
    this.persist()
  }
}
