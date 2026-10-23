"""Read archives in place; independently recompute comparisons and source hashes."""
import base64
import hashlib
import io
import json
import math
import statistics
import struct
import tarfile
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'docs/evidence/m1-c5-perf1'
checks = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def read_archive(name):
    with tarfile.open(OUT / name, 'r:gz') as archive:
        files = {m.name: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
    return files


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def check_packages(files, label):
    for name, payload in files.items():
        if not name.endswith('.sceneweave'):
            continue
        with zipfile.ZipFile(io.BytesIO(payload)) as package:
            paths = package.namelist()
            manifest = json.loads(package.read('manifest.json'))
            declared = manifest['entries']
            check(len(paths) == len(set(paths)) and set(paths) == {'manifest.json', *[e['path'] for e in declared]}, f'{label} complete declared package entries {name}')
            for entry in declared:
                data = package.read(entry['path'])
                check(len(data) == entry['sizeBytes'] and digest(data) == entry['sha256'], f'{label} package exact entry {name}/{entry["path"]}')
                if entry['role'] == 'license':
                    check(bool(data.decode('utf-8').strip()), f'{label} package UTF8 license {name}/{entry["path"]}')


def check_png(payload, width, height, label):
    check(payload[:8] == b'\x89PNG\r\n\x1a\n', label + ' PNG signature')
    offset, kinds = 8, []
    while offset < len(payload):
        size = struct.unpack_from('>I', payload, offset)[0]
        kind = payload[offset + 4:offset + 8]
        check(offset + size + 12 <= len(payload), label + ' bounded PNG chunk')
        actual_crc = zlib.crc32(payload[offset + 4:offset + 8 + size]) & 0xffffffff
        check(actual_crc == struct.unpack_from('>I', payload, offset + size + 8)[0], label + ' PNG chunk CRC')
        if kind == b'IHDR':
            check(struct.unpack_from('>II', payload, offset + 8) == (width, height), label + ' PNG dimensions')
        kinds.append(kind)
        offset += size + 12
    check(offset == len(payload) and kinds[0] == b'IHDR' and kinds[-1] == b'IEND' and all(k in [b'IHDR', b'IDAT', b'IEND'] for k in kinds), label + ' no PNG textual metadata or trailing bytes')


index = json.loads((OUT / 'index.json').read_text())['files']
for name, declared in index.items():
    payload = (OUT / name).read_bytes()
    check(len(payload) == declared['sizeBytes'] and digest(payload) == declared['sha256'], f'evidence hash: {name}')
check(set(index) == {str(p.relative_to(OUT)) for p in OUT.rglob('*') if p.is_file() and p.name not in ['index.json', 'verification.json', 'final-checks.json']}, 'complete evidence file set')

baseline = json.loads((OUT / 'baseline.json').read_text())
frozen = json.loads((OUT / 'frozen-application.json').read_text())
for name, expected, prefix in [('baseline-source', baseline['source'], ''), ('baseline-dist', baseline['dist'], ''), ('current-source', frozen['source'], ''), ('current-dist', frozen['dist'], 'dist/')]:
    files = read_archive(name + '.tar.gz')
    actual = {prefix + p: digest(data) for p, data in files.items()}
    check(actual == expected, f'{name} complete archived fingerprints')
for name, expected in frozen['source'].items():
    check(digest((ROOT / name).read_bytes()) == expected, f'current application unchanged: {name}')
for name, expected in frozen['dist'].items():
    check(digest((ROOT / name).read_bytes()) == expected, f'current build unchanged: {name}')
allowed_current_docs = {'docs/README.md', 'docs/06-storage-and-export.md', 'docs/07-roadmap.md', 'docs/09-quality-plan.md'}
protected = {p: h for p, h in baseline['protectedHistory'].items() if p not in allowed_current_docs}
check(all((ROOT / p).is_file() and digest((ROOT / p).read_bytes()) == h for p, h in protected.items()), f'{len(protected)} prior report/evidence/other document fingerprints unchanged')
external_change = json.loads((OUT / 'external-worktree-change.json').read_text())
check(external_change['baselineSha256'] == baseline['todoSha256'] and external_change['writtenByThisBatch'] is False, 'todo external change explicitly recorded')
check(digest((ROOT / 'todo.md').read_bytes()) == external_change['observedSha256'], 'todo preserved at independently observed external revision')

comparison = json.loads((OUT / 'comparison.json').read_text())
check(comparison['completeFormalMatrix'] is False and comparison['performanceGatePassed'] is False, 'diagnostic cannot pass formal performance gate')
manifests, results = {}, {}
for phase in ['before', 'after']:
    files = read_archive(f'performance-{phase}.tar.gz')
    manifest, result = json.loads(files['manifest.json']), json.loads(files['study-500-run-1.json'])
    manifests[phase], results[phase] = manifest, result
    check(manifest['status'] == 'complete' and bool(manifest['finishedAt']) and not manifest['failures'] and manifest['buildUnchangedAfterMeasurement'], f'{phase} run complete with frozen build')
    check(manifest['measurementClass'] == 'diagnostic-c5-production-ui' and not manifest['config']['diagnosticProfile'], f'{phase} normal production diagnostic without profiling')
    check(len(result['samples']) == 36 and all(result['correctness'].values()), f'{phase} all observations and correctness retained')
    check(not result['errors'] and not result['networkAudit']['productHttpErrors'] and not result['networkAudit']['unexpectedConsoleErrors'] and not result['networkAudit']['unexpectedRequestFailures'], f'{phase} product error audit')
    for kind, fields in comparison['comparison'][phase]['operations'].items():
        samples = [s for s in result['samples'] if s['kind'] == kind]
        for field, expected in fields.items():
            values = [s[field] for s in samples if s.get(field) is not None]
            actual = {'n': len(values), 'min': min(values), 'median': statistics.median(values), 'max': max(values), 'p95': sorted(values)[math.ceil(.95 * len(values)) - 1], 'values': values}
            check(actual == expected, f'{phase} independently recomputed {kind}/{field}')
    for sample in result['samples']:
        check(sample['intent']['trusted'] and abs(sample['browserClockDiscontinuityMs']) <= 250, f'{phase} trusted intent and clocks {sample["kind"]}/{sample["ordinal"]}')
        if sample.get('domainCommit'):
            check(sample['after']['revision'] == sample['expectedRevision'] == sample['after']['transactionRevision'], f'{phase} matching transaction revision {sample["kind"]}/{sample["ordinal"]}')
    for export in result['exports']:
        check(digest(files[export['path']]) == export['sha256'], f'{phase} PNG exact bytes {export["audience"]}')
        check_png(files[export['path']], export['width'], export['height'], phase + ' ' + export['audience'])
    check_packages(files, phase)
    resource = json.loads(files['study-500-run-1-resources.json'])['summary']
    product = {k: v for k, v in resource['byPhase'].items() if k != 'idle' and not k.startswith('tooling-')}
    for metric in ['rssPeakBytes', 'jsHeapPeakUsedBytes']:
        value, label = max((v[metric], k) for k, v in product.items() if v.get(metric) is not None)
        check(comparison['comparison'][phase]['productResources'][metric] == {'value': value, 'phase': label}, f'{phase} product-only resource peak {metric}')
    check(resource['errorCount'] == 0, f'{phase} resource sampling no errors')
for key in ['config', 'device', 'runners']:
    check(manifests['before'][key] == manifests['after'][key], f'identical before/after {key}')
check(manifests['before']['cases'][0]['summary'] == manifests['after']['cases'][0]['summary'] and results['before']['browser'] == results['after']['browser'], 'identical fixture and browser')
check([e['sha256'] for e in results['before']['exports']] == [e['sha256'] for e in results['after']['exports']], 'before/after dual audience PNG bytes identical')
for field, expected in comparison['ordinaryEditReduction'].items():
    before = comparison['comparison']['before']['operations']['ordinary-edit'][field]
    after = comparison['comparison']['after']['operations']['ordinary-edit'][field]
    check(expected == {'medianPercent': (1 - after['median'] / before['median']) * 100, 'p95Percent': (1 - after['p95'] / before['p95']) * 100}, 'independent reduction calculation ' + field)
check(all(sample['intentToDomainCommitMs'] > 100 for sample in results['after']['samples'] if sample['kind'] == 'ordinary-edit'), 'all ordinary edits remain above 100ms')

reports = read_archive('chrome-reports.tar.gz')
attachments, passed = {}, 0


def visit(suite):
    global passed
    for child in suite.get('suites', []):
        visit(child)
    for spec in suite.get('specs', []):
        for test in spec['tests']:
            check(len(test['results']) == 1 and test['results'][0]['status'] == 'passed', 'Chrome pass without retry: ' + spec['title'])
            passed += 1
            for attachment in test['results'][0].get('attachments', []):
                if attachment['contentType'] == 'application/json':
                    attachments[attachment['name']] = json.loads(base64.b64decode(attachment['body']))


for name, payload in reports.items():
    report = json.loads(payload)
    check(report['stats']['unexpected'] == report['stats']['skipped'] == report['stats']['flaky'] == 0, name + ' reporter counts')
    visit(report)
check(passed == 20, '20 actual Chrome regression passes')
decode = attachments['c5-resource-closure-decode-boundaries.json']
check(decode['reusedDecodes'] == 0 and decode['publicDecodes'] == decode['cloneDecodes'] == decode['replacedRecordDecodes'] == decode['mixedDecodes'] == 1, 'native byte proof reuse and invalidation measured')
pixels = attachments['c5-resource-reuse-variant-pixels.json']
check(pixels['firstDecodes'] == pixels['secondDecodes'] == 2 and pixels['sourcePixel'] == [200, 100, 50, 255] and pixels['derivedPixel'] == [100, 50, 25, 255], 'actual variant pixels still decoded each validation')
persistence = attachments['c5-owned-workspace-persistence.json']
check(persistence['ownedClosureShared'] and persistence['revisions'] == [0, 1, 2, 3, 4] and persistence['contentHashMatch'] and persistence['reopenedOriginalBytesMatch'], 'real workspace persistence and exact originals')
production = read_archive('production-ui.tar.gz')
production_report = json.loads(next(data for name, data in production.items() if name.endswith('/report.json')))
check_packages(production, 'production')
check(production_report['status'] == 'passed' and not production_report['errors'] and not production_report['productDevApiKeys'], 'normal production full UI passed without dev API')
check(production_report['reopened']['sameCompleteContent'] and production_report['restore']['protectionCount'] == 1, 'production reopen and protection')
check(production_report['png']['gm']['pixelHash'] == production_report['png']['player']['pixelHash'], 'public production scene paired pixels')
result = {'allPassed': True, 'checks': checks, 'protectedPriorFiles': len(protected), 'currentDocumentUpdates': sorted(allowed_current_docs), 'sourceFiles': len(frozen['source']), 'distFiles': len(frozen['dist']), 'actualChromePasses': passed, 'todoUnchangedFromBaseline': False, 'externalChange': external_change, 'completeFormalMatrix': False, 'performanceGatePassed': False}
(OUT / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(f'All {len(checks)} evidence checks passed; formal performance gate remains false')
