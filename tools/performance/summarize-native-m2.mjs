// Keep the historical C5 statistics implementation and its nearest-rank method.
// Native evidence has its own format and does not upgrade historical results.
import { summarizeC5 } from './summarize-c5.mjs'

export function summarizeNativeM2(manifest, runs) {
  const summary = summarizeC5(manifest, runs)
  summary.format = 'sceneweave-native-m2-performance-summary'
  summary.sourceFingerprint = manifest.sourceFingerprint
  summary.buildFingerprint = manifest.buildFingerprint
  summary.fixturePreparation = manifest.fixturePreparation
  summary.completeFormalMatrix = manifest.measurementClass === 'formal-native-m2-production-ui-observation'
    && manifest.status === 'complete' && manifest.buildUnchangedAfterMeasurement && manifest.sourceUnchangedAfterMeasurement
    && manifest.runnersUnchangedAfterMeasurement
    && manifest.cases.length === 4 && runs.length === manifest.cases.length * manifest.config.runs
  for (const item of summary.cases) item.ordinaryEditTarget.formalMatrix = summary.completeFormalMatrix
  summary.interpretation.push(`Fixture preparation is tooling, outside all measured cold native imports and product distributions. The recorded method for this run is: ${manifest.config.fixturePreparation}`)
  summary.interpretation.push('Completing the matrix never grants a performance pass. Every 500-object case must separately satisfy the 100 ms exact-domain target, and continuous frame scheduling observations remain distinct from physical presentation.')
  return summary
}
