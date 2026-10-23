import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { summarizeC5 } from '../../tools/performance/summarize-c5.mjs'

const work = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(work, '../..')
const configPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(work, 'delivery-config.json')
const configRaw = await fs.readFile(configPath), config = JSON.parse(configRaw)
const performance = config.performance
const check = (condition, message) => { if (!condition) throw new Error(message) }
const sha = raw => createHash('sha256').update(raw).digest('hex')
const resolveSource = value => path.isAbsolute(value) ? value : path.resolve(root, value)
const reference = value => path.relative(root, value).split(path.sep).join('/')
const exists = async value => { try { await fs.access(value); return true } catch (error) { if (error.code !== 'ENOENT') throw error; return false } }
check(performance.completeFormalMatrix === false && performance.performanceGatePassed === false, 'Delivery configuration must retain failed performance conclusions')
check(Array.isArray(performance.batches) && performance.batches.length > 0, 'Expected configured performance batches')
const expectedRuns = performance.expectedRuns * performance.expectedCases.length
const batches = []
for (const batchConfig of performance.batches) {
  const dir = resolveSource(batchConfig.directory)
  const readRaw = async relative => {
    const target = path.resolve(dir, relative)
    check(!path.isAbsolute(relative) && target.startsWith(dir + path.sep), `Batch path escapes its directory: ${relative}`)
    return fs.readFile(target)
  }
  const read = async relative => JSON.parse(await readRaw(relative))
  const manifestRaw = await readRaw('manifest.json'), manifest = JSON.parse(manifestRaw)
  check(manifest.format === 'sceneweave-c5-performance' && manifest.status === batchConfig.status && manifest.status === 'failed', `Unexpected batch status: ${batchConfig.name}`)
  check(manifest.measurementClass === 'formal-c5-production-ui-observation', `Unexpected measurement class: ${batchConfig.name}`)
  check(manifest.results.length === batchConfig.expectedResults && manifest.failures.length === 1, `Unexpected batch results: ${batchConfig.name}`)
  check(!manifest.finishedAt && !(await exists(path.join(dir, 'summary.json'))), `Failed batch has a completed summary or finishedAt: ${batchConfig.name}`)
  check(manifest.config.runs === performance.expectedRuns && manifest.config.requestedCases.length === performance.expectedCases.length && performance.expectedCases.every(name => manifest.config.requestedCases.includes(name)), `Unexpected matrix configuration: ${batchConfig.name}`)
  for (const [name, count] of Object.entries(performance.expectedCounts)) check(manifest.config[name] === count, `Unexpected ${name} count: ${batchConfig.name}`)
  check(!manifest.config.diagnostic && !manifest.config.diagnosticProfile && !manifest.config.cpuProfile.enabled, `Diagnostic data cannot enter the report: ${batchConfig.name}`)
  check((manifest.config.waitTimeoutMs ?? 60000) === batchConfig.waitTimeoutMs, `Unexpected wait timeout: ${batchConfig.name}`)
  const failure = manifest.failures[0]
  check(failure.case === batchConfig.failureCase && failure.message.includes(batchConfig.failureMessageContains), `Unexpected failure: ${batchConfig.name}`)
  const elapsedMs = Date.parse(failure.at) - Date.parse(manifest.startedAt)
  check(Number.isFinite(elapsedMs) && elapsedMs >= 0, `Invalid batch timestamps: ${batchConfig.name}`)
  const runs = await Promise.all(manifest.results.map(async entry => ({ entry, run: await read(entry.path), resources: await read(entry.resourcePath) })))
  for (const {entry, run, resources} of runs) {
    check(run.case === entry.case && run.run === entry.run && run.finishedAt && !run.failure && !run.pendingAction, `Incomplete result cannot enter statistics: ${entry.path}`)
    check(run.samples.every(sample => sample.complete === true), `Incomplete samples in result: ${entry.path}`)
    check(JSON.stringify(resources.summary) === JSON.stringify(run.resources.summary), `Resource summaries disagree: ${entry.path}`)
  }
  const summary = summarizeC5(manifest, runs.map(item => item.run))
  for (const c of summary.cases) c.ordinaryEditTarget.formalMatrix = false
  const partialPath = failure.case + '-partial-failure.json', partialRaw = await readRaw(partialPath), partial = JSON.parse(partialRaw)
  check(partial.samples.length === batchConfig.partialSampleCount, `Unexpected partial sample count: ${batchConfig.name}`)
  check(JSON.stringify(partial.failure) === JSON.stringify(failure), `Partial failure differs from manifest: ${batchConfig.name}`)
  check(JSON.stringify(partial.pendingAction) === JSON.stringify(partial.failureEvidence.pendingAction), `Pending action differs from failure evidence: ${batchConfig.name}`)
  check(partial.pendingAction.kind === batchConfig.pendingKind && partial.pendingAction.ordinal === batchConfig.pendingOrdinal, `Unexpected pending action: ${batchConfig.name}`)
  const probe = partial.failureEvidence.probe
  check(probe.complete === batchConfig.probeComplete, `Unexpected pending probe state: ${batchConfig.name}`)
  const logPath = resolveSource(batchConfig.log), logExists = await exists(logPath), logRaw = logExists ? await fs.readFile(logPath) : null
  check(logExists === batchConfig.logExists, `Unexpected log availability: ${batchConfig.name}`)
  const completeSampleCount = runs.reduce((n, item) => n + item.run.samples.length, 0)
  const probeDuration = field => Number.isFinite(probe[field]) && Number.isFinite(probe.intent?.captureMs) ? probe[field] - probe.intent.captureMs : null
  const batchFacts = {
    name: batchConfig.name, directory: reference(dir), includeInFormalSubset: batchConfig.includeInFormalSubset === true,
    status: manifest.status, measurementClass: manifest.measurementClass, sourceRevision: manifest.sourceRevision,
    sourceManifestPath: reference(path.join(dir, 'manifest.json')), sourceManifestSha256: sha(manifestRaw),
    startedAt: manifest.startedAt, failureAt: failure.at, elapsedMs, finishedAt: null,
    completeFormalMatrix: false, performanceGatePassed: false,
    completedRuns: runs.length, expectedRuns, completeSampleCount, waitTimeoutMs: batchConfig.waitTimeoutMs,
    log: {path: reference(logPath), exists: logExists, bytes: logRaw?.length ?? null, sha256: logRaw ? sha(logRaw) : null,
      empty: logExists ? logRaw.length === 0 : null, status: !logExists ? 'missing' : logRaw.length === 0 ? 'empty' : 'nonempty'},
    failureKind: batchConfig.failureKind, failure,
    partial: {path: reference(path.join(dir, partialPath)), sha256: sha(partialRaw), sampleCount: partial.samples.length,
      excludedFromCompleteRunsAndStatistics: true, pendingAction: partial.pendingAction, failure: partial.failure,
      probe: {complete: probe.complete, kind: probe.kind, ordinal: probe.ordinal, expectedRevision: probe.expectedRevision ?? null,
        beforeRevision: probe.before?.revision ?? null, afterRevision: probe.after?.revision ?? null, afterSave: probe.after?.save ?? null,
        domainCommittedAtMs: probe.domainCommittedAtMs ?? null, intentCaptureMs: probe.intent?.captureMs ?? null,
        intentToDomainCommitMs: probeDuration('domainCommittedAtMs'), intentToSavedMs: probeDuration('savedReadyMs'), intentToDisplayProxyMs: probeDuration('displayProxyMs'),
        clockAtArm: probe.clockAtArm ?? null, clockAtDisplay: probe.clockAtDisplay ?? null}},
    includedResults: manifest.results, excludedFailures: manifest.failures, summary,
    boundary: batchConfig.includeInFormalSubset ? 'Complete runs of the failed original batch only. Partial and repaired batches are excluded; this is not a completed formal matrix.' : 'Separate repaired batch. Its complete runs are summarized independently and never pooled with the original formal subset; partial samples remain excluded.'
  }
  batches.push({config: batchConfig, manifest, runs, facts: batchFacts})
}
const included = batches.filter(batch => batch.facts.includeInFormalSubset)
check(included.length === 1, 'Expected one original formal subset; batches must not be pooled')
const original = included[0], {manifest, runs} = original, summary = original.facts.summary
const completedCases = summary.cases.filter(c => c.completedRuns > 0)
const num = value => Number.isFinite(value) ? value.toFixed(1) : '—'
const mib = value => Number.isFinite(value) ? (value / 1048576).toFixed(1) : '—'
const completeRunsAcrossBatches = batches.reduce((n, batch) => n + batch.facts.completedRuns, 0), completeSamplesAcrossBatches = batches.reduce((n, batch) => n + batch.facts.completeSampleCount, 0)
const lines = ['## 三批性能记录及失败边界', '', 'completeFormalMatrix=false，performanceGatePassed=false。三批均失败，没有finishedAt或summary.json。实际批次起止以下列startedAt与failure.at为准；elapsed包含宿主挂起，不能解释成产品操作时延。', '',
  '| 批次 | 状态 | 完整轮数/计划轮数 | 完整样本数 | startedAt UTC | failure.at UTC | elapsed ms |', '| --- | --- | --- | --- | --- | --- | --- |',
  ...batches.map(({facts: b}) => `| ${b.name} | ${b.status} | ${b.completedRuns}/${b.expectedRuns} | ${b.completeSampleCount} | ${b.startedAt} | ${b.failureAt} | ${b.elapsedMs} |`), '',
  '| 批次 | partial样本数 | pending kind / ordinal | probe complete | 失败类型/原因 | 批次日志 |', '| --- | --- | --- | --- | --- | --- |',
  ...batches.map(({facts: b}) => `| ${b.name} | ${b.partial.sampleCount} | ${b.partial.pendingAction.kind} / ${b.partial.pendingAction.ordinal} | ${b.partial.probe.complete} | ${b.failureKind}: ${b.failure.message.replace(/\|/g, '\\|').replace(/\s+/g, ' ')} | ${b.log.status === 'missing' ? '缺失' : b.log.status === 'empty' ? '空日志，0 bytes' : `${b.log.bytes} bytes`} |`), '',
  `原始子集只包含${original.facts.completedRuns}/${expectedRuns}轮、${original.facts.completeSampleCount}条完整操作观测。全部三批共${completeRunsAcrossBatches}个成功轮、${completeSamplesAcrossBatches}条完整观测，此处只作清点，不跨批合并统计。每批summary独立保留在formal-facts.json；下列详细p95表仅来自includeInFormalSubset=true的${original.facts.name}。`, '',
  '原始island-2000失败发生于首个保护恢复等待：探针最终complete=true、revision 29→30并显示本地已保存，但仍属60秒等待超时。两次补测分别因853553ms和898445ms宿主事件循环wall gap中断；第二次虽有完成探针，其wall/monotonic时钟不连续。所有partial及pending探针只保留现场，均不补入成功分布。', '',
  '## 原始正式批次的完整轮次子集', '', `实际批次起于${manifest.startedAt}，于${manifest.failures[0].at}失败；没有finishedAt或summary.json。以下仅统计${runs.length}/${expectedRuns}轮、${original.facts.completeSampleCount}条完整操作观测，CPU profile关闭。completeFormalMatrix=false，performanceGatePassed=false；不包含失败轮次或任何补测样本。`, '',
  `环境：Node ${manifest.node}，${manifest.device.platform} ${manifest.device.release}/${manifest.device.arch}，${manifest.device.cpu}，${manifest.device.logicalCpus}逻辑核，${(manifest.device.memoryBytes / 1073741824).toFixed(0)}GiB；Chrome ${[...new Set(runs.map(x => x.run.browser))].join('/')}；1512×982、DPR 1。每轮独立headless进程/profile，HTTP缓存禁用，未清OS缓存；无并行浏览器/测试/构建，caffeinate仅防空闲休眠。`, '',
  '| 负载 | 已完成轮数/计划轮数 | 普通编辑n | 框选/替换各n | 保护恢复n |', '| --- | --- | --- | --- | --- |',
  ...summary.cases.map(c => `| ${c.name} | ${c.completedRuns}/${manifest.config.runs} | ${c.ordinaryEditTarget.sampleCount} | ${c.statistics.marquee?.samples ?? 0} / ${c.statistics.replacement?.samples ?? 0} | ${c.statistics['restore-protect-adopt-save']?.samples ?? 0} |`), '',
  '下表数值为全部同case三轮合并nearest-rank p95，单位ms。普通编辑合并n30，每类选择n90；保护恢复n9，冷开/重开/单受众导出n3，后者均为小样本。领域提交和完整显示/保存代理分别记录，双rAF不是GPU或物理呈现。', '',
  '| 负载 | 普通领域n/p95 | 普通DOM p95 | 普通raster p95 | 普通保存 p95 | 普通显示代理p95 | 框选/替换显示代理p95 | 100ms领域目标 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |']
const facts = {format: 'sceneweave-c5-formal-evidence-facts', version: 1, generatedAt: new Date().toISOString(),
  configuration: {path: reference(configPath), sha256: sha(configRaw)}, completeFormalMatrix: false, performanceGatePassed: false,
  expectedRunsPerBatch: expectedRuns,
  formalSubset: {batchNames: included.map(batch => batch.facts.name), completedRuns: original.facts.completedRuns, expectedRuns,
    sampleCount: original.facts.completeSampleCount, excludedBatchNames: batches.filter(batch => !batch.facts.includeInFormalSubset).map(batch => batch.facts.name),
    perRun: [], boundary: 'Only complete runs from the original failed batch enter the formal subset. Missing runs and all partial/repaired observations are excluded.'},
  allCompleteRunCounts: {completedRuns: completeRunsAcrossBatches, sampleCount: completeSamplesAcrossBatches, aggregateStatisticsComputed: false,
    boundary: 'Inventory only. Independent batches are never pooled into a latency distribution.'},
  batches: batches.map(batch => batch.facts), toolingDeviations: config.toolingDeviations ?? {},
  boundary: 'Derived report of configured failed performance batches. All summaries remain independent. No completed summary.json is created and mechanical evidence verification does not confer a performance pass.'}
for (const c of completedCases) {
  const s = c.statistics, o = s['ordinary-edit']
  lines.push(`| ${c.name} | ${o.intentToDomainCommitMs.n} / ${num(o.intentToDomainCommitMs.p95)} | ${num(o.intentToDomRevisionMs.p95)} | ${num(o.intentToRasterReadyMs.p95)} | ${num(o.intentToSavedMs.p95)} | ${num(o.intentToDisplayProxyMs.p95)} | ${num(s.marquee.intentToDisplayProxyMs.p95)} / ${num(s.replacement.intentToDisplayProxyMs.p95)} | ${c.ordinaryEditTarget.pooledObservedWithinTarget ? '达到' : '未达'} |`)
}
lines.push('', '| 负载/轮次 | 普通领域p95 | 普通显示代理p95 | 层重排领域p95 | 外观采用领域p95 | 保护恢复领域p95 | 保护恢复显示代理p95 |', '| --- | --- | --- | --- | --- | --- | --- |')
for (const c of completedCases) for (const r of c.runs) {
  const s = r.statistics, row = {case:c.name,run:r.run,ordinary:s['ordinary-edit'].intentToDomainCommitMs.p95,display:s['ordinary-edit'].intentToDisplayProxyMs.p95,reorder:s['layer-reorder'].intentToDomainCommitMs.p95,appearance:s['appearance-adopt'].intentToDomainCommitMs.p95,restore:s['restore-protect-adopt-save'].intentToDomainCommitMs.p95,restoreDisplay:s['restore-protect-adopt-save'].intentToDisplayProxyMs.p95}
  facts.formalSubset.perRun.push(row)
  lines.push(`| ${c.name} / ${r.run} | ${num(row.ordinary)} | ${num(row.display)} | ${num(row.reorder)} | ${num(row.appearance)} | ${num(row.restore)} | ${num(row.restoreDisplay)} |`)
}
lines.push('', '| 负载 | hide显示p95 n30 | reorder领域p95 n30 | 外观预览显示/采用领域p95 n15 | 命名完成p95 n3 | 读历史/预览恢复p95 n9 | 保护恢复领域/显示p95 n9 |', '| --- | --- | --- | --- | --- | --- | --- |')
for (const c of completedCases) {
  const s = c.statistics, v = (kind, metric='intentToDisplayProxyMs') => num(s[kind][metric].p95)
  lines.push(`| ${c.name} | ${v('layer-hide')} | ${v('layer-reorder','intentToDomainCommitMs')} | ${v('appearance-preview')} / ${v('appearance-adopt','intentToDomainCommitMs')} | ${v('named-snapshot')} | ${v('history-open')} / ${v('restore-preview')} | ${v('restore-protect-adopt-save','intentToDomainCommitMs')} / ${v('restore-protect-adopt-save')} |`)
}
lines.push('', '| 负载 | 冷包准备p95 n3 | 冷迁移/保存/raster p95 n3 | 手工本地重开p95 n3 | GM/玩家4K完成p95 各n3 | 右键/键盘菜单显示p95 n15/n15 |', '| --- | --- | --- | --- | --- | --- |')
for (const c of completedCases) {
  const s = c.statistics, v = kind => num(s[kind].intentToDisplayProxyMs.p95)
  lines.push(`| ${c.name} | ${v('cold-package-prepare')} | ${v('cold-import-save-raster')} | ${v('local-reopen')} | ${v('export-4k-gm')} / ${v('export-4k-player')} | ${v('pointer-menu')} / ${v('keyboard-menu')} |`)
}
lines.push('', '连续视口每case合并9次平移与9次缩放手势，每手势分别30个pointermove、20个wheel，均在rAF节奏发出。rAF和输入间隔包括自动化/观察开销，分别报告；不能解释成真实显示FPS。', '', '| 负载 | 平移活动rAF n/p95/max | 缩放活动rAF n/p95/max | 平移/缩放输入间隔p95 | 平移/缩放>33.334ms比例 |', '| --- | --- | --- | --- | --- |')
for (const c of completedCases) {
  const a=c.statistics['continuous-pan'], b=c.statistics['continuous-wheel'], fa=a.activeInputFrameGapMs, fb=b.activeInputFrameGapMs
  lines.push(`| ${c.name} | ${fa.n} / ${num(fa.p95)} / ${num(fa.max)} | ${fb.n} / ${num(fb.p95)} / ${num(fb.max)} | ${num(a.inputCaptureGapMs.p95)} / ${num(b.inputCaptureGapMs.p95)} | ${num(100*a.activeInputFrameGapsAbove33_334Fraction)}% / ${num(100*b.activeInputFrameGapsAbove33_334Fraction)}% |`)
}
lines.push('', '### 实际负载及资源峰值', '', '| 负载 | 世界mm | GM/玩家投影物件数 | 唯一原图/像素/编码字节 | 原材质/物件/组合定义数 |', '| --- | --- | --- | --- | --- |')
for (const c of completedCases) {
  const f=c.fixture
  lines.push(`| ${c.name} | ${f.worldBoundsMm.width}×${f.worldBoundsMm.height} | ${f.projectedPropCounts.gm} / ${f.projectedPropCounts.player} | ${f.uniqueImageCount} / ${f.uniqueImagePixels} / ${f.uniqueImageEncodedBytes} | ${f.materialDefinitionCount} / ${f.propDefinitionCount} / ${f.prefabDefinitionCount} |`)
}
lines.push('', '每轮完整UI迁为严格v6，保持500/2000物件；增加两个工作层，C5 Focus实际只迁入独立marker 1件，C5 Spare为空，测量的层规则/重排不绕过256预算。每轮1命名快照及3保护点，自动历史仍受20份上限。新增参数派生及所选历史完整字节见各final包和资源清单。源PNG透明覆盖、实际包hash与投影数在manifest保留；遮挡后的真正可见物件数未测。', '',
  '资源下表单位MiB。产品阶段和tooling-audit阶段分别取实际采样峰值，不能跨进程或阶段相加。RSS是独立进程树同时观测之和，可能重复共享映射；目标页JS堆不包括完整浏览器/GPU。全局峰值含跨阶段样本，阶段峰值排除跨界请求。', '',
  '| 负载 | 产品RSS / 页面堆峰值 | tooling RSS / 堆峰值 | 全局RSS / 堆峰值 | RSS/heap样本总数 | 采样错误 |', '| --- | --- | --- | --- | --- | --- |')
for (const c of completedCases) {
  const r=c.resources, selected=runs.filter(x=>x.run.case===c.name), pc=selected.reduce((n,x)=>n+x.resources.summary.processSampleCount,0),hc=selected.reduce((n,x)=>n+x.resources.summary.heapSampleCount,0)
  lines.push(`| ${c.name} | ${mib(r.productPhaseRssSampledPeakBytes)} / ${mib(r.productPhaseJsHeapSampledPeakUsedBytes)} | ${mib(r.toolingAuditRssSampledPeakBytes)} / ${mib(r.toolingAuditJsHeapSampledPeakUsedBytes)} | ${mib(r.globalRssSampledPeakBytesIncludingBoundariesAndTooling)} / ${mib(r.globalJsHeapSampledPeakUsedBytesIncludingBoundariesAndTooling)} | ${pc} / ${hc} | ${r.samplingErrors} |`)
}
lines.push('', '| 负载/轮次 | RSS间隔p95/max ms | JS堆间隔p95/max ms | 跨阶段RSS/堆样本排除数 |', '| --- | --- | --- | --- |')
for (const {run,resources} of runs) {
  const r=resources.summary
  lines.push(`| ${run.case} / ${run.run} | ${num(r.processSamplingIntervalsMs.p95)} / ${num(r.processSamplingIntervalsMs.max)} | ${num(r.heapSamplingIntervalsMs.p95)} / ${num(r.heapSamplingIntervalsMs.max)} | ${r.phaseBoundaryProcessSamples} / ${r.phaseBoundaryHeapSamples} |`)
}
lines.push('', '目标采样间隔RSS100ms/JS堆200ms，表中是真实间隔；主线程阻塞期间getMetrics响应会变宽。每个阶段的峰值、poll持续时间、起止时间及全部raw均保留，采样间瞬时峰值、去重物理内存和GPU/Metal峰值仍缺证据。', '')
await fs.writeFile(path.join(work,'formal-tables.md'),lines.join('\n')+'\n')
await fs.writeFile(path.join(work,'formal-facts.json'),JSON.stringify(facts,null,2)+'\n')
console.log(JSON.stringify({completeFormalMatrix:false,performanceGatePassed:false,formalSubset:facts.formalSubset,
  allCompleteRunCounts:facts.allCompleteRunCounts,batches:facts.batches.map(batch=>({name:batch.name,completedRuns:batch.completedRuns,expectedRuns:batch.expectedRuns,completeSampleCount:batch.completeSampleCount,partialSampleCount:batch.partial.sampleCount,logStatus:batch.log.status})),
  ordinaryTargets:summary.cases.map(x=>({name:x.name,...x.ordinaryEditTarget}))}))
