import { createAggregateObserver } from './aggregate-observer.mjs'

/** Same read-only trusted-event/CPU/block observer, with explicit current-matrix
 * provenance and a host-suspension guard. This wrapper never changes the product. */
export async function createCurrentFormalObserver(options) {
  const observer = await createAggregateObserver(options)
  const clockGaps = []
  let last = performance.now(), phase = 'setup'
  const timer = setInterval(() => {
    const current = performance.now(), elapsedMs = current - last
    if (elapsedMs > 5000) clockGaps.push({ phase, at: new Date().toISOString(), elapsedMs })
    last = current
  }, 500)
  timer.unref()
  return {
    ...observer,
    setPhase(next) { phase = next; observer.setPhase(next) },
    async measure(kind, config, action) {
      const previous = phase; phase = kind
      try {
        const result = await observer.measure(kind, config, action)
        result.measurementClass = 'current-v1-trusted-production-ui-sample'
        if (clockGaps.length) throw new Error('Host clock gap above 5 seconds; retained samples cannot establish a formal result.')
        return result
      } finally { phase = previous }
    },
    async stop() {
      clearInterval(timer)
      const result = await observer.stop()
      return { ...result, samples: result.samples.map(sample => ({ ...sample, measurementClass: 'current-v1-trusted-production-ui-sample' })),
        measurementClass: 'current-v1-trusted-production-ui-samples', clockGaps,
        notes: result.notes.filter(note => !note.startsWith('These observations')).concat([
          'The caller separately establishes fixture, repetition and coverage completeness. A complete matrix is never an automatic threshold, capacity or visual acceptance pass.',
          'Clock gaps above 5 seconds invalidate formal timing. Network errors, process CPU discontinuities and missing resource samples are retained without retry.',
        ]) }
    },
  }
}
