// Keep the historical C5 statistics implementation and its nearest-rank method.
// Native evidence has its own format and does not upgrade historical results.
import { distribution, summarizeC5 } from './summarize-c5.mjs'

export function summarizeNativeM2(manifest, runs) {
  const summary = summarizeC5(manifest, runs)
  summary.format = 'sceneweave-native-m2-performance-summary'
  summary.sourceFingerprint = manifest.sourceFingerprint
  summary.buildFingerprint = manifest.buildFingerprint
  summary.fixturePreparation = manifest.fixturePreparation
  const visualV2 = manifest.config.fixtureMode === 'exact-native-visual-v2'
  summary.completeFormalMatrix = manifest.measurementClass === (visualV2 ? 'formal-visual-v2-production-ui-observation' : 'formal-native-m2-production-ui-observation')
    && manifest.status === 'complete' && manifest.buildUnchangedAfterMeasurement && manifest.sourceUnchangedAfterMeasurement
    && manifest.runnersUnchangedAfterMeasurement
    && manifest.cases.length === 4 && runs.length === manifest.cases.length * manifest.config.runs
  for (const item of summary.cases) item.ordinaryEditTarget.formalMatrix = summary.completeFormalMatrix
  if (visualV2) {
    summary.format = 'sceneweave-visual-v2-performance-summary'
    summary.interpretation.push('These are newly prepared strict complete-v2/SceneDocument2/visual1 Q1/Q2 workloads. Synthetic added-object density, original artwork sizes, curves, sampled points, overlays and effects are stated per fixture. Historical complete-v1 timings are not reused. Curve drag/draft, preview, adoption/save and ordinary UI undo have independent distributions; interior decorative-border results do not prove terrain or building topology editing.')
    for (const item of summary.cases) item.ordinaryEditTarget.requiredForOrdinary500Gate = item.fixture.propCount === 500
    // Extend only the new native-v2 summary; the frozen C5 interpretation stays unchanged.
    for (const item of summary.cases) {
      const selected = runs.filter(run => run.case === item.name)
      const curveGaps = samples => samples.filter(sample => sample.kind === 'continuous-curve-draft').flatMap(sample => {
        const events = sample.events.filter(event => event.type === 'pointermove')
        return events.slice(1).map((event, index) => event.captureMs - events[index].captureMs)
      })
      if (item.statistics['continuous-curve-draft']) item.statistics['continuous-curve-draft'].inputCaptureGapMs = distribution(curveGaps(selected.flatMap(run => run.samples)))
      for (const run of item.runs) if (run.statistics['continuous-curve-draft']) run.statistics['continuous-curve-draft'].inputCaptureGapMs = distribution(curveGaps(selected.find(source => source.run === run.run).samples))
    }
  }
  summary.interpretation.push(`Fixture preparation is tooling, outside all measured cold native imports and product distributions. The recorded method for this run is: ${manifest.config.fixturePreparation}`)
  summary.interpretation.push('Completing the matrix never grants a performance pass. Every 500-object case must separately satisfy the 100 ms exact-domain target, and continuous frame scheduling observations remain distinct from physical presentation.')
  return summary
}
