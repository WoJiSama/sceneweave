#!/usr/bin/env python3
"""Archive C5 evidence only. Configuration is documented in delivery-config.json.

Run from the repository root after all serial measurement batches finish.
Raw evidence is immutable: an existing archive payload may only be identical.
Derived indexes can be regenerated. This script never writes C4 evidence.
"""
from pathlib import Path
import base64
import datetime
import gzip
import hashlib
import io
import json
import platform
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(__file__).resolve().parent
CONFIG_PATH = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else WORK / 'delivery-config.json'
CONFIG = json.loads(CONFIG_PATH.read_text())
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()
SHA = lambda value: hashlib.sha256(value).hexdigest()

assert CONFIG['performance']['completeFormalMatrix'] is False
assert CONFIG['performance']['performanceGatePassed'] is False


def path(value):
    candidate = Path(value)
    return (ROOT / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()


def reference(value):
    try:
        return value.relative_to(ROOT).as_posix()
    except ValueError:
        return str(value)


OUT = path(CONFIG.get('evidenceDirectory', 'docs/evidence/m1-c5'))
assert OUT == ROOT / 'docs/evidence/m1-c5', 'Only the independent C5 evidence directory may be written.'
OUT.mkdir(parents=True, exist_ok=True)
INDEX = {'format': 'sceneweave-c5-evidence', 'version': 1, 'capturedAt': NOW,
         'completeFormalMatrix': False, 'performanceGatePassed': False,
         'rawReports': [], 'reporters': [], 'attachments': [], 'productionRuns': [], 'scripts': []}
TEXT_SUFFIXES = {'.json', '.jsonl', '.log', '.txt', '.md', '.cpuprofile', '.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.py', '.map', '.svg'}


def write_json(target, value):
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def store_bytes(raw, destination, source=None, compress=False):
    target = OUT / destination
    assert target.resolve().is_relative_to(OUT)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = gzip.compress(raw, mtime=0) if compress else raw
    if target.exists():
        assert target.read_bytes() == payload, f'Refusing to replace earlier evidence: {target}'
    else:
        target.write_bytes(payload)
    if compress:
        assert gzip.decompress(target.read_bytes()) == raw
    item = {'path': target.relative_to(OUT).as_posix(), 'bytes': len(payload), 'sha256': SHA(payload),
            'rawBytes': len(raw), 'rawSha256': SHA(raw), 'encoding': 'gzip' if compress else 'identity'}
    if source is not None:
        item['source'] = reference(source)
    return item


def store(source, destination, compress=False):
    return store_bytes(source.read_bytes(), destination, source, compress)


def preserve_tree(directory, destination):
    files = []
    for source in sorted(directory.rglob('*')):
        if not source.is_file():
            continue
        relative = source.relative_to(directory).as_posix()
        compress = source.suffix in TEXT_SUFFIXES
        metadata = store(source, destination + '/' + relative + ('.gz' if compress else ''), compress=compress)
        metadata['originalPath'] = relative
        files.append(metadata)
    return files


def command(args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    return result.stdout.strip() if result.returncode == 0 else {'unavailable': result.stderr.strip(), 'exitCode': result.returncode}


baseline_path = path(CONFIG.get('baseline', reference(WORK / 'baseline.json')))
source_baseline_path = path(CONFIG.get('sourceBaseline', reference(WORK / 'final-source-baseline.json')))
baseline = json.loads(baseline_path.read_text())
frozen = json.loads(source_baseline_path.read_text())
assert len(baseline['protected']) == CONFIG.get('expectedProtectedFiles', 826)
assert command(['git', 'rev-parse', 'HEAD']) == frozen['head'] == baseline['head']
assert json.loads((ROOT / 'package.json').read_text())['version'] == frozen['version']
for source, name in [(CONFIG_PATH, 'delivery-config.json'), (baseline_path, 'protected-baseline.json'), (source_baseline_path, 'final-source-baseline.json')]:
    store(source, name)

production_root = path(CONFIG['production']['directory'])
performance_batches_config = CONFIG['performance']['batches']
performance_roots = [path(batch['directory']) for batch in performance_batches_config]
final_report_directory = path(CONFIG['browser']['directory'])
assert production_root.is_dir() and all(directory.is_dir() for directory in performance_roots)
diagnostic_roots = sorted(candidate for candidate in WORK.glob('perf-diagnostic-*') if candidate.is_dir())
assert all(not any(candidate.resolve().is_relative_to(root) or root.is_relative_to(candidate.resolve()) for root in performance_roots)
           for candidate in diagnostic_roots), 'Diagnostic and formal performance trees must be independent.'
analysis_sources = [WORK / 'cpu-analysis.json', WORK / 'cpu-analysis.md']
baseline_dist = WORK / 'cpu-baseline-dist'

# Keep every batch log/JSON once. Browser and production/performance trees have
# dedicated preservation below; trace viewer code is not another measurement.
raw_report_sources = set()


def store_raw_report(source):
    source = source.resolve()
    if source in raw_report_sources:
        return
    assert source.is_file(), f'Missing configured raw report: {source}'
    if source.is_relative_to(WORK):
        relative = source.relative_to(WORK).as_posix()
    else:
        relative = 'configured/' + SHA(reference(source).encode())[:12] + '-' + source.name
    INDEX['rawReports'].append(store(source, 'raw/' + relative + '.gz', compress=True))
    raw_report_sources.add(source)


for source in sorted(WORK.rglob('*')):
    if not source.is_file() or source.suffix not in {'.log', '.json', '.txt', '.md'}:
        continue
    relative = source.relative_to(WORK)
    if any(part.endswith(('-report', '-results')) or part == '__pycache__' for part in relative.parts[:-1]):
        continue
    if source.is_relative_to(production_root) or any(source.is_relative_to(root) for root in performance_roots):
        continue
    if any(source.is_relative_to(directory) for directory in diagnostic_roots) or source.is_relative_to(baseline_dist) or source in analysis_sources:
        continue
    store_raw_report(source)
for value in [CONFIG['unit']['json'], CONFIG['unit']['log'], CONFIG['build']['log']]:
    store_raw_report(path(value))


def reporter_bytes(directory):
    packed = directory / 'report.zip'
    if packed.is_file():
        return packed.read_bytes()
    html = (directory / 'index.html').read_text()
    match = re.search(r'<script id="playwrightReportBase64" type="application/zip">(.*?)</script>', html, re.S)
    assert match, f'No raw Playwright ZIP in {directory}'
    return base64.b64decode(match[1].strip().split(',', 1)[-1], validate=True)


report_directories = {final_report_directory}
for html in WORK.rglob('index.html'):
    if 'playwrightReportBase64' in html.read_text():
        report_directories.add(html.parent)
for packed in WORK.rglob('report.zip'):
    report_directories.add(packed.parent)

for directory in sorted(report_directories):
    raw = reporter_bytes(directory)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        assert len(set(names)) == len(names)
        report = json.loads(archive.read('report.json'))
        details = [json.loads(archive.read(name)) for name in names if name != 'report.json']
    label = re.sub(r'[^A-Za-z0-9_.-]', '-', directory.name) + '-' + SHA(reference(directory).encode())[:8]
    metadata = store_bytes(raw, f'browser/{label}.report.zip')
    metadata.update({'source': reference(directory), 'isFinal': directory == final_report_directory,
                     'stats': report['stats'], 'reportMembers': len(names), 'startTime': report.get('startTime'), 'durationMs': report.get('duration')})
    cohort, files = {}, []
    for detail in details:
        file_name = Path(detail['fileName']).name
        is_cohort = file_name.startswith('c5-')
        if is_cohort:
            cohort[file_name] = cohort.get(file_name, 0) + len(detail['tests'])
        tests = []
        for test in detail['tests']:
            test_summary = {key: value for key, value in test.items() if key != 'results'}
            test_summary['results'] = []
            for result in test['results']:
                result_summary = {key: value for key, value in result.items() if key not in {'steps', 'attachments'}}
                result_summary['attachments'] = []
                for attachment in result.get('attachments', []):
                    item = {key: value for key, value in attachment.items() if key != 'body'}
                    original = None
                    if 'path' in attachment:
                        original = (directory / attachment['path']).resolve()
                        payload = original.read_bytes()
                        item['source'] = reference(original)
                    elif 'body' in attachment:
                        body = attachment['body']
                        payload = body.encode() if isinstance(body, str) else bytes(body)
                        item['inlineBodyInRawReporter'] = True
                    else:
                        result_summary['attachments'].append(item)
                        continue
                    item.update({'bytes': len(payload), 'sha256': SHA(payload)})
                    failing = test.get('outcome') == 'unexpected' or result.get('status') in {'failed', 'timedOut', 'interrupted'}
                    is_trace = attachment.get('name') == 'trace'
                    keep = (metadata['isFinal'] and is_cohort or failing) and (not is_trace or failing)
                    if keep:
                        suffix = Path(attachment.get('path', attachment['name'])).suffix
                        if not suffix:
                            suffix = {'application/json': '.json', 'image/png': '.png', 'text/markdown': '.md', 'application/zip': '.zip'}.get(attachment['contentType'], '.txt')
                        kept = store_bytes(payload, f'attachments/{SHA(payload)}{suffix}', original)
                        item['archivedPath'] = kept['path']
                        INDEX['attachments'].append({**kept, 'test': test['title'], 'reporter': metadata['path'], 'name': attachment['name'], 'failure': failing})
                    result_summary['attachments'].append(item)
                test_summary['results'].append(result_summary)
            tests.append(test_summary)
        files.append({'fileName': detail['fileName'], 'fileId': detail.get('fileId'), 'tests': tests})
    summary = {key: value for key, value in report.items() if key != 'files'}
    summary.update({'files': files, '_sceneweaveEvidence': {'rawReporter': metadata['path'], 'rawReporterSha256': SHA(raw),
                    'attachmentPolicy': 'Every original reporter JSON and inline body is retained. Final C5 and failing-test attachments are content-addressed; other cohort external bytes retain actual local source path/hash/size. Traces are retained only for failures, without duplicated trace copies.'}})
    summary_path = f'browser/{label}-summary.json'
    write_json(OUT / summary_path, summary)
    metadata.update({'summaryPath': summary_path, 'cohortTests': cohort})
    if metadata['isFinal']:
        expected = CONFIG['browser']['expectedTotal']
        assert report['stats'] == {'total': expected, 'expected': expected, 'unexpected': 0, 'flaky': 0, 'skipped': 0, 'ok': True}
        assert cohort == CONFIG['browser']['expectedCohort']
        assert not report.get('errors')
    INDEX['reporters'].append(metadata)

source_files = {}
configured_deviations = CONFIG.get('toolingDeviations', {})
source_deviations = {}
for name, expected in frozen['files'].items():
    source = path(name)
    raw = source.read_bytes()
    actual = SHA(raw)
    if actual != expected:
        deviation = configured_deviations.get(name)
        assert deviation and deviation['frozenSha256'] == expected, f'Unconfigured frozen source change: {name}'
        assert deviation['currentSha256'] == actual and deviation['currentBytes'] == len(raw), f'Configured current tool changed: {name}'
        assert name.startswith('tools/performance/') and deviation['reason'], f'Only an explained runner-only tooling deviation is supported: {name}'
        source_deviations[name] = deviation
    source_files[name] = {'sha256': actual, 'bytes': len(raw), 'frozenSha256': expected, 'matchesFrozenSource': actual == expected}
assert set(source_deviations) == set(configured_deviations), 'Configured tooling deviations must exactly describe current source mismatches.'
write_json(OUT / 'source-fingerprints.json', {'capturedAt': NOW, 'head': frozen['head'], 'version': frozen['version'], 'files': source_files,
           'toolingDeviations': source_deviations,
           'boundary': 'Current actual bytes are fingerprinted. The frozen source hash remains separate; a changed runner is not represented as the original tool used for the final regression or initial formal batch.'})
dist = path(CONFIG['build'].get('directory', 'dist'))
write_json(OUT / 'build-fingerprints.json', {'capturedAt': NOW, 'head': frozen['head'], 'version': frozen['version'], 'sourceFingerprintFile': 'source-fingerprints.json',
           'files': {reference(source): {'bytes': source.stat().st_size, 'sha256': SHA(source.read_bytes())} for source in sorted(dist.rglob('*')) if source.is_file()}})

for directory in sorted(production_root.iterdir()):
    if not directory.is_dir() or not (directory / 'report.json').is_file():
        continue
    report = json.loads((directory / 'report.json').read_text())
    is_final = directory.name == CONFIG['production']['finalRun']
    files = [store(source, 'production-ui/' + directory.name + '/' + source.relative_to(directory).as_posix()) for source in sorted(directory.rglob('*')) if source.is_file()]
    INDEX['productionRuns'].append({'path': 'production-ui/' + directory.name, 'source': reference(directory), 'isFinal': is_final, 'status': report['status'], 'files': files})
assert sum(run['isFinal'] for run in INDEX['productionRuns']) == 1
assert next(run for run in INDEX['productionRuns'] if run['isFinal'])['status'] == 'passed'

performance_batches = []
runner_exceptions = {(item['batch'], item['path']): item for item in CONFIG['performance'].get('runnerHashExceptions', [])}
assert len(runner_exceptions) == len(CONFIG['performance'].get('runnerHashExceptions', []))
used_runner_exceptions = set()
for batch_config in performance_batches_config:
    name = batch_config['name']
    directory = path(batch_config['directory'])
    manifest_source = directory / 'manifest.json'
    assert manifest_source.is_file(), f'Missing performance manifest: {directory}'
    manifest = json.loads(manifest_source.read_text())
    assert manifest['status'] == batch_config['status']
    assert len(manifest.get('results', [])) == batch_config['expectedResults']
    assert manifest.get('measurementClass') == 'formal-c5-production-ui-observation'
    failure_text = '\n'.join(failure.get('message', '') for failure in manifest.get('failures', []))
    assert batch_config['failureMessageContains'] in failure_text
    log_source = path(batch_config['log'])
    assert log_source.is_file() == batch_config['logExists']
    files = preserve_tree(directory, 'performance/' + name)
    log_metadata = None
    if log_source.is_file():
        log_metadata = store(log_source, 'performance/logs/' + name + '.log.gz', compress=True)
    runners = []
    for declared in manifest.get('runners', []):
        source = path(declared['path'])
        snapshot = {**declared, 'originalBytesAvailable': False}
        if source.is_file():
            raw = source.read_bytes()
            snapshot['currentSourceSha256AtArchive'] = SHA(raw)
            if len(raw) == declared['sizeBytes'] and SHA(raw) == declared['sha256']:
                metadata = store(source, 'performance/runners/' + name + '-' + SHA(raw) + '-' + source.name)
                snapshot.update({'originalBytesAvailable': True, 'archivedFile': metadata})
            else:
                exception = runner_exceptions.get((name, declared['path']))
                assert exception and exception['declaredSha256'] == declared['sha256'] and exception['currentSha256'] == SHA(raw), f'Unconfigured runner mismatch: {name}/{declared["path"]}'
                assert declared['path'] in source_deviations and exception['reason'], f'Runner mismatch lacks a frozen-source explanation: {name}/{declared["path"]}'
                used_runner_exceptions.add((name, declared['path']))
                current = store(source, 'performance/runners-current/' + name + '-' + SHA(raw) + '-' + source.name)
                snapshot['currentSourceArchived'] = current
        if not snapshot['originalBytesAvailable']:
            assert (name, declared['path']) in used_runner_exceptions, f'Unconfigured missing original runner: {name}/{declared["path"]}'
            snapshot['boundary'] = 'Historical runner bytes are unavailable when the current source differs from the batch declaration; the declared hash and current hash are retained without treating current bytes as the original runner.'
        runners.append(snapshot)
    performance_batches.append({
        'name': name,
        'source': reference(directory),
        'path': 'performance/' + name,
        'status': manifest['status'],
        'measurementClass': manifest['measurementClass'],
        'manifestSha256': SHA(manifest_source.read_bytes()),
        'manifestPath': 'performance/' + name + '/manifest.json.gz',
        'files': files,
        'log': {'configured': reference(log_source), 'exists': log_source.is_file(), 'archived': log_metadata},
        'runners': runners,
        'expectedResults': batch_config['expectedResults'],
        'failureKind': batch_config['failureKind'],
        'failureCase': batch_config['failureCase']
    })
assert used_runner_exceptions == set(runner_exceptions), 'Every configured runner hash exception must describe one actual mismatch.'
formal_reports = []
for name in ['formal-facts.json', 'formal-tables.md']:
    source = WORK / name
    assert source.is_file(), f'Missing derived formal report: {source}'
    metadata = store(source, 'performance/' + name + '.gz', compress=True)
    formal_reports.append(metadata)
INDEX['performance'] = {
    'batches': performance_batches,
    'formalReports': formal_reports,
    'expectedMatrix': {key: value for key, value in CONFIG['performance'].items() if key != 'batches'},
    'completeFormalMatrix': False,
    'performanceGatePassed': False,
    'interpretation': 'Every configured performance batch is retained, including failed and partial runs. Mechanical evidence verification is independent of the performance target; the formal matrix is incomplete and the performance gate remains failed.'
}


diagnostics = {'measurementClass': 'diagnostic-only-excluded-from-formal-matrix', 'runs': [], 'analysisFiles': [],
               'interpretation': 'Every diagnostic byte, failed batch, CPU profile and its original baseline build is preserved separately. Diagnostic completion and profiling never confer formal target compliance.'}
for directory in diagnostic_roots:
    manifest_source = directory / 'manifest.json'
    assert manifest_source.is_file(), f'Missing diagnostic manifest: {directory}'
    diagnostic_manifest = json.loads(manifest_source.read_text())
    assert diagnostic_manifest['measurementClass'] != 'formal-c5-production-ui-observation'
    destination = 'diagnostics/' + directory.name
    files = preserve_tree(directory, destination)
    batch_files = []
    for source in sorted(WORK.glob(directory.name + '.*')):
        if source.is_file():
            compress = source.suffix in TEXT_SUFFIXES
            batch_files.append(store(source, destination + '/batch/' + source.name + ('.gz' if compress else ''), compress=compress))
    runners = []
    for declared in diagnostic_manifest.get('runners', []):
        source = path(declared['path'])
        snapshot = {**declared, 'originalBytesAvailable': False}
        if source.is_file():
            raw = source.read_bytes()
            snapshot['currentSourceSha256AtArchive'] = SHA(raw)
            if len(raw) == declared['sizeBytes'] and SHA(raw) == declared['sha256']:
                metadata = store(source, 'diagnostics/runners/' + SHA(raw) + '-' + source.name + '.gz', compress=True)
                snapshot.update({'originalBytesAvailable': True, 'archivedFile': metadata})
        if not snapshot['originalBytesAvailable']:
            snapshot['boundary'] = 'Historical runner bytes cannot be reconstructed from the current tool. Its actual manifest declaration and original failure/output bytes remain preserved; no current revision is mislabeled as the original.'
        runners.append(snapshot)
    diagnostics['runs'].append({'name': directory.name, 'source': reference(directory), 'path': destination,
                               'status': diagnostic_manifest['status'], 'measurementClass': diagnostic_manifest['measurementClass'],
                               'manifestSha256': SHA(manifest_source.read_bytes()), 'manifestPath': destination + '/manifest.json.gz',
                               'files': files, 'batchFiles': batch_files, 'runners': runners})
for source in analysis_sources:
    assert source.is_file(), f'Missing CPU analysis evidence: {source}'
    diagnostics['analysisFiles'].append(store(source, 'diagnostics/' + source.name + '.gz', compress=True))
assert baseline_dist.is_dir(), 'Preserve the actual CPU-profile baseline dist before archiving.'
baseline_files = preserve_tree(baseline_dist, 'diagnostics/cpu-baseline-dist')
assert baseline_files, 'CPU baseline dist cannot be empty.'
diagnostics['baselineDist'] = {'source': reference(baseline_dist), 'path': 'diagnostics/cpu-baseline-dist', 'files': baseline_files}
INDEX['diagnostics'] = diagnostics

for name in ['archive-evidence.py', 'verify-evidence.py', 'final-checks.py', 'report-formal.mjs', 'freeze-source.mjs']:
    source = WORK / name
    # A rerun after script hardening must retain the previous immutable snapshot
    # instead of replacing it with a different byte sequence.
    digest = SHA(source.read_bytes())
    INDEX['scripts'].append(store(source, f'scripts/{Path(name).stem}-{digest}{Path(name).suffix}'))
write_json(OUT / 'environment.json', {'capturedAt': NOW, 'platform': platform.platform(), 'machine': platform.machine(), 'python': sys.version,
           'node': command(['node', '--version']), 'npm': command(['npm', '--version']), 'gitHead': command(['git', 'rev-parse', 'HEAD']),
           'configuration': 'delivery-config.json', 'executionBoundary': 'Evidence was generated by the configured serial batches; this archiver starts no browser, test, build or measurement.'})
write_json(OUT / 'evidence-index.json', INDEX)
print(json.dumps({'rawReports': len(INDEX['rawReports']), 'reporters': len(INDEX['reporters']), 'attachments': len(INDEX['attachments']),
                  'productionRuns': len(INDEX['productionRuns']), 'performanceBatches': len(performance_batches),
                  'performanceFiles': sum(len(batch['files']) for batch in performance_batches), 'diagnosticRuns': len(diagnostics['runs']),
                  'diagnosticFiles': sum(len(run['files']) + len(run['batchFiles']) for run in diagnostics['runs']),
                  'cpuBaselineFiles': len(baseline_files), 'sourceFiles': len(source_files)}, ensure_ascii=False))
