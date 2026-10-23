from pathlib import Path
import base64, datetime, gzip, hashlib, io, json, re, shutil, subprocess, zipfile

root = Path.cwd()
work = root / 'work/c4-20261022'
out = root / 'docs/evidence/m1-c4'
out.mkdir(parents=True, exist_ok=True)
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
sha = lambda value: hashlib.sha256(value).hexdigest()
index = {'capturedAt': now, 'rawReports': [], 'reporters': [], 'attachments': [], 'productionRuns': []}

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def fingerprint(path):
    data = path.read_bytes()
    return {'path': str(path.relative_to(out)), 'bytes': len(data), 'sha256': sha(data)}

for source in sorted(work.iterdir()):
    if not source.is_file() or source.suffix not in ('.log', '.json', '.txt'):
        continue
    if not (source.name.startswith(('unit-', 'build-', 'chromium-', 'typecheck-', 'scatter-identity-', 'production-'))):
        continue
    data = source.read_bytes()
    target = out / (source.name + '.gz')
    target.write_bytes(gzip.compress(data, mtime=0))
    assert gzip.decompress(target.read_bytes()) == data
    index['rawReports'].append({**fingerprint(target), 'source': str(source.relative_to(root)), 'rawBytes': len(data), 'rawSha256': sha(data)})

def archive_report(directory, target_name, cohort=None, keep_artifacts=False, keep_failure=False):
    source = work / directory
    html = source / 'index.html'
    if html.exists():
        content = html.read_text()
        value = re.search(r'<script id="playwrightReportBase64" type="application/zip">(.*?)</script>', content, re.S).group(1).strip()
        raw = base64.b64decode(value.split(',', 1)[-1])
    else:
        raw = (source / 'report.zip').read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        report = json.loads(archive.read('report.json'))
        details = [json.loads(archive.read(n)) for n in archive.namelist() if n != 'report.json']
    target = out / (target_name + '.report.zip')
    target.write_bytes(raw)
    item = {**fingerprint(target), 'source': str(source.relative_to(root)), 'startTime': report['startTime'], 'durationMs': report['duration'], 'stats': report['stats'], 'reportMembers': len(details) + 1}
    all_files = []
    attachment_root = out / (target_name + '-artifacts')
    for f in details:
        tests = []
        for test in f['tests']:
            summary = {k: v for k, v in test.items() if k != 'results'}
            summary['results'] = []
            is_cohort = cohort is not None and f['fileName'].startswith(cohort)
            for result in test['results']:
                rr = {k: v for k, v in result.items() if k not in ('steps', 'attachments')}
                rr['attachments'] = []
                for attachment in result.get('attachments', []):
                    a = {k: v for k, v in attachment.items() if k != 'body'}
                    data = None
                    if 'path' in attachment:
                        original = source / attachment['path']
                        data = original.read_bytes()
                        a['source'] = str(original.relative_to(root))
                    elif 'body' in attachment:
                        body = attachment['body']
                        data = body.encode('utf-8') if isinstance(body, str) else bytes(body)
                        a['inlineBodyInRawReporter'] = True
                    if data is not None:
                        a.update({'bytes': len(data), 'sha256': sha(data)})
                        if (keep_artifacts and is_cohort) or (keep_failure and test['outcome'] == 'unexpected'):
                            name = Path(attachment['name']).name
                            if attachment['contentType'] == 'application/json' and not name.endswith('.json'):
                                name += '.json'
                            dest = attachment_root / name
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            if dest.exists():
                                assert dest.read_bytes() == data
                            else:
                                dest.write_bytes(data)
                            a['archivedPath'] = str(dest.relative_to(out))
                            index['attachments'].append({**fingerprint(dest), 'test': test['title'], 'reporter': target.name})
                    rr['attachments'].append(a)
                summary['results'].append(rr)
            tests.append(summary)
        all_files.append({'fileName': f['fileName'], 'fileId': f['fileId'], 'tests': tests})
    summary = {k: v for k, v in report.items() if k != 'files'}
    summary.update({'files': all_files, '_sceneweaveEvidence': {'rawReporter': target.name, 'rawReporterSha256': sha(raw), 'attachmentPolicy': 'Raw reporter ZIP preserves all original per-file JSON and inline bodies. Final C4 attachments are also archived by name; other existing-cohort external attachments retain their actual byte hash and original local path in this summary.'}})
    write_json(out / (target_name + '-summary.json'), summary)
    if cohort:
        item['cohortTests'] = sum(len(f['tests']) for f in details if f['fileName'].startswith(cohort))
    index['reporters'].append(item)
    return item

final = archive_report('chromium-final-corrected-report', 'chromium-final-corrected', 'c4-', True)
assert final['stats'] == {'total': 162, 'expected': 162, 'unexpected': 0, 'flaky': 0, 'skipped': 0, 'ok': True}
assert final['cohortTests'] == 14
earlier = archive_report('chromium-final-report', 'chromium-earlier-c4', 'c4-')
assert earlier['stats']['expected'] == 12
archive_report('chromium-delivery-report', 'chromium-earlier-full', keep_failure=True)

for name in ['protected-baseline.json', 'final-corrected-source-baseline.json', 'delivery-source-baseline.json']:
    shutil.copyfile(work / name, out / name)
frozen = json.loads((work / 'final-corrected-source-baseline.json').read_text())
source_files = {}
for name, digest in frozen['files'].items():
    data = (root / name).read_bytes()
    assert sha(data) == digest, name
    source_files[name] = {'sha256': digest, 'bytes': len(data)}
write_json(out / 'source-fingerprints.json', {'capturedAt': now, 'head': frozen['head'], 'version': '0.2.0-m1-c4', 'scope': 'Same frozen application, tests, assets and build configuration for corrected unit/build/full Chrome and final production UI. Documentation is checked separately.', 'files': source_files})
write_json(out / 'build-fingerprints.json', {'capturedAt': now, 'head': frozen['head'], 'version': '0.2.0-m1-c4', 'command': 'npm run build', 'sourceFingerprintFile': 'source-fingerprints.json', 'files': {str(p.relative_to(root)): {'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in sorted((root / 'dist').rglob('*')) if p.is_file()}})

for run in sorted((work / 'production-ui').iterdir()):
    if not run.is_dir():
        continue
    report = json.loads((run / 'report.json').read_text())
    target = out / 'production-ui' / run.name
    shutil.copytree(run, target, dirs_exist_ok=True)
    index['productionRuns'].append({'path': str(target.relative_to(out)), 'status': report['status'], 'startedAt': report['startedAt'], 'finishedAt': report['finishedAt'], 'finalCorrectedSource': run.name == 'run-2026-10-22T14-50-23-377Z', 'files': [fingerprint(p) for p in sorted(target.rglob('*')) if p.is_file()]})
assert index['productionRuns'][-1]['status'] == 'passed'

def command(args):
    return subprocess.check_output(args, text=True).strip()

write_json(out / 'environment.json', {'capturedAt': now, 'os': command(['sw_vers']), 'architecture': command(['uname', '-m']), 'hardwareModel': command(['sysctl', '-n', 'hw.model']), 'cpu': command(['sysctl', '-n', 'machdep.cpu.brand_string']), 'memoryBytes': int(command(['sysctl', '-n', 'hw.memsize'])), 'node': command(['node', '--version']), 'npm': command(['npm', '--version']), 'browser': 'Google Chrome 156.0.8078.47', 'playwrightVersion': json.loads((root / 'node_modules/@playwright/test/package.json').read_text())['version'], 'unitCommand': 'npm test -- --reporter=default --reporter=json --outputFile=work/c4-20261022/unit-final-corrected.json', 'buildCommand': 'npm run build', 'browserCommand': 'SCENEWEAVE_BROWSER_CHANNEL=chrome PLAYWRIGHT_HTML_OUTPUT_DIR=work/c4-20261022/chromium-final-corrected-report npm run test:e2e -- --output=work/c4-20261022/chromium-final-corrected-results', 'browserWorkers': 1, 'productionCommand': 'node work/c4-20261022/production-runner.mjs', 'productionServe': 'npm run preview -- --port 4173 --strictPort', 'formalPerformanceSampling': False, 'executionBoundary': 'Browser batches, build and production runs were serial. Unit test files used the configured Vitest worker pool within their own batch. No whole-interaction performance or capacity claim.'})
write_json(out / 'evidence-index.json', index)
print(json.dumps({'reports': len(index['rawReports']), 'reporters': index['reporters'], 'attachments': len(index['attachments']), 'productionRuns': len(index['productionRuns']), 'sourceFiles': len(source_files), 'totalBytes': sum(p.stat().st_size for p in out.rglob('*') if p.is_file())}, ensure_ascii=False, indent=2))
