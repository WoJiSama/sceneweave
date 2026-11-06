import fs from 'node:fs/promises'
import path from 'node:path'

const directory = process.argv[2]
if (!directory || !path.isAbsolute(directory)) throw new Error('Usage: node tools/performance/summarize-aggregate.mjs ABS_OUTPUT_DIRECTORY')
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
if (manifest.format !== 'sceneweave-aggregate-development-observation') throw new Error('Unknown observation format')
const rows = []
for (const result of manifest.results) {
  for (const measurement of result.metrics?.samples ?? []) {
    const phase = result.metrics.resources.summary.byPhase[measurement.kind]
    rows.push({ case: result.name, caseStatus: result.status, operation: measurement.kind, status: measurement.status,
      detailCount: result.fixture.summary.actualDetailCount, fullProps: result.fixture.summary.counts.props,
      decorations: result.fixture.summary.counts.decorations, groupMembers: result.fixture.summary.aggregateMembers,
      domainCommitMs: measurement.sample?.intentToDomainCommitMs ?? null,
      savedMs: measurement.sample?.intentToSavedMs ?? null, displayProxyMs: measurement.sample?.intentToDisplayProxyMs ?? null,
      survivingProcessCpuMs: measurement.cpu?.survivingProcessCpuMs ?? null,
      bornProcessCpuMs: measurement.cpu?.newlyObservedProcessCpuMs ?? null,
      cpuContinuity: measurement.cpu?.completeProcessContinuity ?? false,
      sampledRssPeakBytes: phase?.rssPeakBytes ?? null, sampledJsHeapPeakBytes: phase?.jsHeapPeakUsedBytes ?? null,
      resourceSampleCounts: { rss: phase?.processSampleCount ?? 0, heap: phase?.heapSampleCount ?? 0 },
      ...(measurement.kind === 'group-adopt' ? { storage: result.storage.group } : measurement.kind === 'local-edit' ? { storage: result.storage.local }
        : measurement.kind === 'bulk-32-adopt' ? { storage: result.storage.bulk32 } : {}) })
  }
}
console.log(JSON.stringify({ measurementClass: manifest.measurementClass, status: manifest.status,
  inputFingerprint: manifest.inputFingerprint, device: manifest.device,
  notes: ['Each operation has one observation. No percentiles or speedup comparison.', 'CPU brackets include automation and sampler overhead. Incomplete process continuity is retained.',
    'Product phase peaks exclude audit/setup phases and samples spanning a phase boundary. Null means no sample.', 'Storage entries report logical committed block payload growth and distinct changed final rows, never physical write volume.'], rows }, null, 2))
