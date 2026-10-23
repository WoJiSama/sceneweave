#!/usr/bin/env python3
"""Independently verify archived C5 bytes using Python's standard library.

No product modules, browser, test, build, or measurement process is invoked.
Latency target misses remain valid observations; completeness and correctness
are checked separately from performance target compliance.
"""
from pathlib import Path
import collections
import datetime
import gzip
import hashlib
import io
import json
import math
import re
import struct
import sys
import traceback
import urllib.parse
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(__file__).resolve().parent
CONFIG_PATH = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else WORK / 'delivery-config.json'
CONFIG = json.loads(CONFIG_PATH.read_text())
OUT = (ROOT / CONFIG.get('evidenceDirectory', 'docs/evidence/m1-c5')).resolve()
assert OUT == ROOT / 'docs/evidence/m1-c5'
SHA = lambda raw: hashlib.sha256(raw).hexdigest()
READ = lambda candidate: json.loads(candidate.read_text())
CHECKS = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
PNG_CACHE = {}


def source_path(value):
    return (ROOT / value).resolve()


def canonical(value):
    # JavaScript's exported JSON already writes integral values as integers.
    # Sorting UTF-16 code units also covers non-ASCII user IDs deterministically.
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(key, ensure_ascii=False) + ':' + canonical(value[key]) for key in sorted(value, key=lambda key: key.encode('utf-16-be', 'surrogatepass'))) + '}'
    if isinstance(value, list):
        return '[' + ','.join(map(canonical, value)) + ']'
    if isinstance(value, float):
        assert math.isfinite(value)
        if value == 0:
            return '0'
        text = repr(value).lower()
        if 1e-6 <= abs(value) < 1e21:
            from decimal import Decimal
            return format(Decimal(text), 'f').rstrip('0').rstrip('.') if '.' in format(Decimal(text), 'f') else format(Decimal(text), 'f')
        mantissa, exponent = text.split('e')
        return mantissa.removesuffix('.0') + 'e' + ('+' if int(exponent) >= 0 else '-') + str(abs(int(exponent)))
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def verify_file(candidate, metadata, hash_key='sha256', size_key='bytes'):
    raw = candidate.read_bytes()
    assert len(raw) == metadata[size_key] and SHA(raw) == metadata[hash_key], str(candidate)
    return raw


def archived_raw(metadata):
    raw = verify_file(OUT / metadata['path'], metadata)
    if metadata.get('encoding') == 'gzip':
        raw = gzip.decompress(raw)
    assert len(raw) == metadata['rawBytes'] and SHA(raw) == metadata['rawSha256'], metadata['path']
    if metadata.get('source'):
        assert raw == source_path(metadata['source']).read_bytes(), metadata['source']
    return raw


def png_info(raw, pixels=False):
    digest = SHA(raw)
    if digest in PNG_CACHE and (not pixels or 'pixelHash' in PNG_CACHE[digest]):
        return PNG_CACHE[digest]
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    position, chunks, compressed, header = 8, [], [], None
    while position < len(raw):
        assert position + 12 <= len(raw)
        size = struct.unpack('>I', raw[position:position + 4])[0]
        kind = raw[position + 4:position + 8]
        assert position + 12 + size <= len(raw)
        payload = raw[position + 8:position + 8 + size]
        crc = struct.unpack('>I', raw[position + 8 + size:position + 12 + size])[0]
        assert zlib.crc32(kind + payload) & 0xffffffff == crc
        chunks.append(kind.decode('ascii'))
        if kind == b'IHDR':
            assert header is None and size == 13
            header = struct.unpack('>IIBBBBB', payload)
        if kind == b'IDAT':
            compressed.append(payload)
        position += size + 12
    assert position == len(raw) and chunks[0] == 'IHDR' and chunks[-1] == 'IEND'
    width, height, depth, color, compression, filtering, interlace = header
    assert width > 0 and height > 0 and compression == filtering == 0
    decoded = zlib.decompress(b''.join(compressed))
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    row_bytes = (width * channels * depth + 7) // 8
    if interlace == 0:
        assert len(decoded) == height * (row_bytes + 1)
        assert all(decoded[row * (row_bytes + 1)] <= 4 for row in range(height))
    else:
        assert interlace == 1 and decoded
    result = {'width': width, 'height': height, 'chunks': chunks, 'bytes': len(raw), 'sha256': digest}
    if pixels:
        assert depth == 8 and color == 6 and interlace == 0, 'Independent exported-pixel verification requires RGBA8 noninterlaced PNG.'
        previous, pixel_digest = bytearray(row_bytes), hashlib.sha256()
        for y in range(height):
            offset = y * (row_bytes + 1)
            filter_type = decoded[offset]
            row = bytearray(decoded[offset + 1:offset + 1 + row_bytes])
            if filter_type:
                for x in range(row_bytes):
                    left = row[x - 4] if x >= 4 else 0
                    above = previous[x]
                    corner = previous[x - 4] if x >= 4 else 0
                    if filter_type == 1:
                        predictor = left
                    elif filter_type == 2:
                        predictor = above
                    elif filter_type == 3:
                        predictor = (left + above) // 2
                    else:
                        p = left + above - corner
                        a, b, c = abs(p - left), abs(p - above), abs(p - corner)
                        predictor = left if a <= b and a <= c else above if b <= c else corner
                    row[x] = (row[x] + predictor) & 255
            pixel_digest.update(row)
            previous = row
        result['pixelHash'] = pixel_digest.hexdigest()
    PNG_CACHE[digest] = result
    return result


def package_entries(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        assert len(names) == len(set(names))
        assert all(not name.startswith('/') and '..' not in Path(name).parts for name in names)
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['format'] == 'sceneweave-project'
        assert len(manifest['entries']) == len({entry['path'] for entry in manifest['entries']})
        assert set(names) == {'manifest.json', *(entry['path'] for entry in manifest['entries'])}
        blobs = {}
        for entry in manifest['entries']:
            value = archive.read(entry['path'])
            assert len(value) == entry['sizeBytes'] and SHA(value) == entry['sha256']
            blobs[entry['path']] = value
        return manifest, blobs


def verify_package(raw, label):
    manifest, blobs = package_entries(raw)
    assert manifest['containerVersion'] == 6 and manifest['documentSchemaVersion'] == 3 and manifest['profile'] == 'm1-outdoor'
    assert not any('migration' in name or 'original' in name for name in blobs)
    images, licenses = {}, {}
    for entry in manifest['entries']:
        if entry['role'] == 'asset':
            assert entry['mimeType'] == 'image/png', 'This fixture verifier explicitly supports the produced PNG assets.'
            info = png_info(blobs[entry['path']])
            images[entry['sha256']] = {'sha256': entry['sha256'], 'mimeType': entry['mimeType'], 'sizeBytes': entry['sizeBytes'], 'pixelWidth': info['width'], 'pixelHeight': info['height']}
        elif entry['role'] == 'license':
            licenses[entry['sha256']] = {'sha256': entry['sha256'], 'text': blobs[entry['path']].decode('utf-8')}

    def content(scene_path, identity_path, appearance_path, refs, bindings):
        document, identity, appearance = (json.loads(blobs[name]) for name in [scene_path, identity_path, appearance_path])
        assert document['schemaVersion'] == 3 and identity['version'] == 3 and appearance['version'] == 1
        assert set(identity) == {'version', 'lineageId', 'rootSceneId', 'propTokens', 'prefabTokens', 'outdoorTokens'}
        selected_images = {digest: images[digest] for digest in refs['assetHashes']}
        selected_licenses = {digest: licenses[digest] for digest in refs['licenseHashes']}
        assert len(selected_images) == len(refs['assetHashes']) and len(selected_licenses) == len(refs['licenseHashes'])
        subjects = {(kind, entity_id): entity for kind, key in [('asset', 'assets'), ('material', 'materials'), ('propDefinition', 'propDefinitions'), ('prefabDefinition', 'prefabDefinitions'), ('styleTheme', 'styleThemes')] for entity_id, entity in document[key].items()}
        assert len(bindings) == len(subjects)
        assert {(binding['subjectKind'], binding['subjectId']) for binding in bindings} == set(subjects)
        for binding in bindings:
            subject = subjects[(binding['subjectKind'], binding['subjectId'])]
            assert binding['licenseRef'] == subject['licenseRef'] and binding['embedding'] == 'allowed' and subject['origin']['canEmbed']
            license_hash = binding['licensePath'].removeprefix('licenses/').removesuffix('.txt')
            assert license_hash in selected_licenses and binding['licensePath'] in blobs
        for asset in document['assets'].values():
            assert all(selected_images[asset['sha256']][key] == asset[key] for key in ['sha256', 'mimeType', 'pixelWidth', 'pixelHeight'])
        assert set(selected_images) == {asset['sha256'] for asset in document['assets'].values()}
        assert set(selected_licenses) == {binding['licensePath'].removeprefix('licenses/').removesuffix('.txt') for binding in bindings}
        for entity_id in document['props']:
            assert identity['propTokens'][entity_id] and appearance['sources'][appearance['propSources'][entity_id]]
        for entity_id in document['prefabInstances']:
            assert identity['prefabTokens'][entity_id]
        for collection in ['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'scatterGroups']:
            for entity_id in document[collection]:
                assert identity['outdoorTokens'][entity_id]['token'] and identity['outdoorTokens'][entity_id]['topologyToken']
        for variant in appearance['variants'].values():
            source, target = document['assets'][variant['sourceAssetId']], document['assets'][variant['outputAssetId']]
            assert all(source[key] == target[key] for key in ['origin', 'licenseRef', 'logicalSizeMm'])
        return {'document': document, 'historyIdentity': identity, 'appearance': appearance, 'assets': selected_images, 'licenses': selected_licenses, 'licenseBindings': bindings}

    history = json.loads(blobs['history.json']) if 'history.json' in blobs else None
    refs = history['current'] if history else {'assetHashes': list(images), 'licenseHashes': list(licenses)}
    current = content('scene.json', 'identity.json', 'appearance.json', refs, manifest['licenseBindings'])
    assert manifest['sceneId'] == current['document']['sceneId'] and manifest['revision'] == current['document']['revision']
    snapshots, used_images, used_licenses = [], set(refs['assetHashes']), set(refs['licenseHashes'])
    if history:
        assert manifest['packageMode'] == 'history'
        assert len(history['snapshots']) == len({item['summary']['id'] for item in history['snapshots']})
        for item in history['snapshots']:
            historical = content(item['scenePath'], item['identityPath'], item['appearancePath'], item, item['licenseBindings'])
            digest = SHA(canonical(historical).encode())
            assert digest == item['summary']['contentHash']
            assert historical['document']['revision'] == item['summary']['sourceRevision']
            assert historical['historyIdentity']['lineageId'] == item['summary']['lineageId']
            snapshots.append({'id': item['summary']['id'], 'name': item['summary']['name'],
                              'contentHash': digest, 'sourceRevision': item['summary']['sourceRevision']})
            used_images.update(item['assetHashes']); used_licenses.update(item['licenseHashes'])
    else:
        assert manifest['packageMode'] == 'complete'
    assert used_images == set(images) and used_licenses == set(licenses)
    return {'path': label, 'sha256': SHA(raw), 'bytes': len(raw), 'contentHash': SHA(canonical(current).encode()),
            'revision': current['document']['revision'], 'entries': len(manifest['entries']), 'images': len(images), 'licenses': len(licenses), 'snapshots': snapshots}


def run():
    index = READ(OUT / 'evidence-index.json')
    assert index['format'] == 'sceneweave-c5-evidence' and index['version'] == 1
    assert index['completeFormalMatrix'] is False and index['performanceGatePassed'] is False
    assert (OUT / 'delivery-config.json').read_bytes() == CONFIG_PATH.read_bytes()
    for name in ['source-fingerprints.json', 'build-fingerprints.json']:
        fingerprint = READ(OUT / name)
        assert fingerprint['files']
        for file_name, metadata in fingerprint['files'].items():
            verify_file(source_path(file_name), metadata)
        CHECKS[name] = {'files': len(fingerprint['files']), 'allHashesAndSizesMatch': True}
    frozen = READ(OUT / 'final-source-baseline.json')
    fingerprints = READ(OUT / 'source-fingerprints.json')
    assert frozen['files'] == {name: value['frozenSha256'] for name, value in fingerprints['files'].items()}
    deviations = {name: CONFIG.get('toolingDeviations', {}).get(name) for name, value in fingerprints['files'].items() if value['sha256'] != value['frozenSha256']}
    assert deviations == CONFIG.get('toolingDeviations', {}) == fingerprints['toolingDeviations']
    for name, value in fingerprints['files'].items():
        assert value['matchesFrozenSource'] == (value['sha256'] == value['frozenSha256'])
        if name in deviations:
            deviation = deviations[name]
            assert deviation and name.startswith('tools/performance/') and deviation['reason']
            assert value['sha256'] == deviation['currentSha256'] and value['bytes'] == deviation['currentBytes']
            assert value['frozenSha256'] == deviation['frozenSha256']
    CHECKS['frozenSource'] = {'files': len(frozen['files']), 'unchangedFiles': len(frozen['files']) - len(deviations),
                             'configuredToolingDeviations': deviations, 'unconfiguredChanges': []}
    baseline = READ(OUT / 'protected-baseline.json')
    assert len(baseline['protected']) == CONFIG.get('expectedProtectedFiles', 826)
    for file_name, digest in baseline['protected'].items():
        assert SHA(source_path(file_name).read_bytes()) == digest
    assert SHA((ROOT / 'todo.md').read_bytes()) == baseline['todoSha256']
    CHECKS['protectedHistory'] = {'files': len(baseline['protected']), 'todoMatches': True}
    raw_sources = {}
    for metadata in index['rawReports']:
        raw_sources[source_path(metadata['source'])] = archived_raw(metadata)
    for metadata in index['attachments']:
        archived_raw(metadata)
    CHECKS['archives'] = {'rawReports': len(index['rawReports']), 'attachments': len(index['attachments']), 'losslessAndHashesMatch': True}
    unit = json.loads(raw_sources[source_path(CONFIG['unit']['json'])])
    assert len(unit['testResults']) == CONFIG['unit']['expectedFiles']
    assert unit['numTotalTests'] == unit['numPassedTests'] == CONFIG['unit']['expectedTests']
    assert unit['numFailedTests'] == unit['numPendingTests'] == 0 and unit['success']
    assert all(result['status'] == 'passed' for result in unit['testResults'])
    assert source_path(CONFIG['unit']['log']) in raw_sources
    assert CONFIG['build'].get('successPattern', '✓ built in') in raw_sources[source_path(CONFIG['build']['log'])].decode()
    CHECKS['unitAndBuild'] = {'unitFiles': len(unit['testResults']), 'passedTests': unit['numPassedTests'], 'productionBuildLogSuccessMarker': True}
    reporter_checks = []
    for metadata in index['reporters']:
        raw = verify_file(OUT / metadata['path'], metadata)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            assert archive.testzip() is None
            names = archive.namelist()
            assert len(names) == len(set(names)) == metadata['reportMembers']
            report = json.loads(archive.read('report.json'))
            details = [json.loads(archive.read(name)) for name in names if name != 'report.json']
        assert report['stats'] == metadata['stats']
        assert sum(len(detail['tests']) for detail in details) == report['stats']['total']
        summary = READ(OUT / metadata['summaryPath'])
        assert summary['_sceneweaveEvidence']['rawReporterSha256'] == SHA(raw)
        assert summary['stats'] == report['stats']
        for detail in summary['files']:
            for test in detail['tests']:
                for result in test['results']:
                    for attachment in result.get('attachments', []):
                        if attachment.get('source'):
                            verify_file(source_path(attachment['source']), attachment)
                        if attachment.get('archivedPath'):
                            verify_file(OUT / attachment['archivedPath'], attachment)
        if metadata['isFinal']:
            total = CONFIG['browser']['expectedTotal']
            assert report['stats'] == {'total': total, 'expected': total, 'unexpected': 0, 'flaky': 0, 'skipped': 0, 'ok': True}
            assert metadata['cohortTests'] == CONFIG['browser']['expectedCohort']
            assert all(test['outcome'] == 'expected' for detail in details for test in detail['tests']) and not report.get('errors')
        reporter_checks.append({'path': metadata['path'], 'stats': report['stats'], 'members': len(names), 'isFinal': metadata['isFinal'], 'crcVerified': True})
    assert sum(item['isFinal'] for item in reporter_checks) == 1
    CHECKS['browserReporters'] = reporter_checks
    production_checks = []
    for entry in index['productionRuns']:
        for metadata in entry['files']:
            archived_raw(metadata)
        directory = OUT / entry['path']
        report = READ(directory / 'report.json')
        assert report['status'] == entry['status']
        if not entry['isFinal']:
            production_checks.append({'path': entry['path'], 'status': report['status'], 'diagnosticFilesPreserved': True})
            continue
        assert report['status'] == 'passed' and not report['productDevApiKeys'] and not report['errors']
        assert not [error for error in report['httpErrors'] if not error['url'].endswith('/favicon.ico') or error['status'] != 404]
        assert not [error for error in report['consoleErrors'] if not error['url'].endswith('/favicon.ico')]
        assert report['reopened']['sameCompleteContent']
        packages = [verify_package(candidate.read_bytes(), candidate.relative_to(OUT).as_posix()) for candidate in sorted(directory.glob('*.sceneweave'))]
        selected = next(item for item in packages if item['path'].endswith('/selected-history.sceneweave'))
        assert all(selected[key] == report['archive'][key] for key in ['bytes', 'sha256', 'contentHash'])
        reported_snapshots = report['archive']['selectedSnapshots']
        assert len(reported_snapshots) == len({item['id'] for item in reported_snapshots})
        assert {item['id']: item for item in selected['snapshots']} == {
            item['id']: {'id': item['id'], 'name': item['name'], 'contentHash': item['hash'],
                         'sourceRevision': item['sourceRevision']} for item in reported_snapshots}
        assert selected['contentHash'] == report['reopened']['contentHash']
        pngs = {}
        for audience in ['gm', 'player']:
            info = png_info((directory / (audience + '-4k.png')).read_bytes(), pixels=True)
            assert max(info['width'], info['height']) == 4096
            assert all(info[key] == report['png'][audience][key] for key in ['width', 'height', 'sha256', 'bytes', 'pixelHash'])
            assert set(info['chunks']) == {'IHDR', 'IDAT', 'IEND'}
            pngs[audience] = info
        assert pngs['gm']['pixelHash'] == pngs['player']['pixelHash']
        production_checks.append({'path': entry['path'], 'status': 'passed', 'isFinal': True, 'packages': packages, 'pngs': pngs, 'independentPngFilterDecode': True})
    assert sum(item.get('isFinal', False) for item in production_checks) == 1
    CHECKS['productionRuns'] = production_checks
    verify_diagnostics(index)
    verify_performance(index, frozen)
    CHECKS['scripts'] = []
    for metadata in index['scripts']:
        archived_raw(metadata)
        CHECKS['scripts'].append({'path': metadata['path'], 'sha256': metadata['sha256']})


def verify_diagnostics(index):
    diagnostics = index['diagnostics']
    assert diagnostics['measurementClass'] == 'diagnostic-only-excluded-from-formal-matrix'
    expected_roots = {candidate.resolve() for candidate in WORK.glob('perf-diagnostic-*') if candidate.is_dir()}
    assert {source_path(run['source']) for run in diagnostics['runs']} == expected_roots
    assert len(diagnostics['runs']) == len(expected_roots)
    formal_roots = [source_path(item['source']) for item in index['performance']['batches']]
    text_suffixes = {'.json', '.jsonl', '.log', '.txt', '.md', '.cpuprofile', '.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.py', '.map', '.svg'}

    def verify_tree(source, destination, files):
        expected = {candidate.relative_to(source).as_posix() for candidate in source.rglob('*') if candidate.is_file()}
        assert len(files) == len({item['originalPath'] for item in files})
        assert {item['originalPath'] for item in files} == expected
        contents = {}
        for metadata in files:
            relative = metadata['originalPath']
            assert not Path(relative).is_absolute() and '..' not in Path(relative).parts
            original = source / relative
            assert source_path(metadata['source']) == original.resolve()
            compressed = original.suffix in text_suffixes
            assert metadata['encoding'] == ('gzip' if compressed else 'identity')
            assert metadata['path'] == destination + '/' + relative + ('.gz' if compressed else '')
            contents[relative] = archived_raw(metadata)
        return contents

    run_checks = []
    for run in diagnostics['runs']:
        source = source_path(run['source'])
        assert all(not source.is_relative_to(formal_root) and not formal_root.is_relative_to(source) for formal_root in formal_roots)
        assert run['path'] == 'diagnostics/' + source.name
        contents = verify_tree(source, run['path'], run['files'])
        manifest = json.loads(contents['manifest.json'])
        assert SHA(contents['manifest.json']) == run['manifestSha256']
        assert run['manifestPath'] == run['path'] + '/manifest.json.gz'
        assert run['status'] == manifest['status'] and run['measurementClass'] == manifest['measurementClass']
        assert run['measurementClass'] != 'formal-c5-production-ui-observation'
        batch_sources = {candidate.resolve() for candidate in WORK.glob(source.name + '.*') if candidate.is_file()}
        assert len(run['batchFiles']) == len({item['source'] for item in run['batchFiles']}) == len(batch_sources)
        assert {source_path(item['source']) for item in run['batchFiles']} == batch_sources
        for metadata in run['batchFiles']:
            original = source_path(metadata['source'])
            compressed = original.suffix in text_suffixes
            assert metadata['path'] == run['path'] + '/batch/' + original.name + ('.gz' if compressed else '')
            assert metadata['encoding'] == ('gzip' if compressed else 'identity')
            archived_raw(metadata)
        declared_runners = manifest.get('runners', [])
        assert len(run['runners']) == len(declared_runners)
        original_runners = 0
        for snapshot, declared in zip(run['runners'], declared_runners):
            assert {key: snapshot[key] for key in declared} == declared
            if snapshot['originalBytesAvailable']:
                raw = archived_raw(snapshot['archivedFile'])
                assert len(raw) == declared['sizeBytes'] and SHA(raw) == declared['sha256']
                assert snapshot['currentSourceSha256AtArchive'] == declared['sha256']
                original_runners += 1
            else:
                assert 'archivedFile' not in snapshot and snapshot['boundary']
                if 'currentSourceSha256AtArchive' in snapshot:
                    assert SHA(source_path(declared['path']).read_bytes()) == snapshot['currentSourceSha256AtArchive']
        run_checks.append({'name': run['name'], 'status': run['status'], 'measurementClass': run['measurementClass'],
                           'files': len(run['files']), 'batchFiles': len(run['batchFiles']),
                           'cpuProfiles': sum(name.endswith('.cpuprofile') for name in contents),
                           'declaredRunners': len(declared_runners), 'availableOriginalRunners': original_runners,
                           'allOriginalBytesPreserved': True, 'excludedFromFormalMatrix': True})
    expected_analysis = {WORK / name for name in ['cpu-analysis.json', 'cpu-analysis.md']}
    assert len(diagnostics['analysisFiles']) == len(expected_analysis)
    assert {source_path(item['source']) for item in diagnostics['analysisFiles']} == expected_analysis
    for metadata in diagnostics['analysisFiles']:
        assert metadata['encoding'] == 'gzip' and metadata['path'] == 'diagnostics/' + source_path(metadata['source']).name + '.gz'
        archived_raw(metadata)
    baseline = diagnostics['baselineDist']
    assert source_path(baseline['source']) == WORK / 'cpu-baseline-dist' and baseline['path'] == 'diagnostics/cpu-baseline-dist'
    baseline_contents = verify_tree(source_path(baseline['source']), baseline['path'], baseline['files'])
    assert baseline_contents
    CHECKS['diagnostics'] = {'runs': run_checks, 'analysisFiles': len(diagnostics['analysisFiles']), 'cpuBaselineBuildFiles': len(baseline_contents),
                             'allHashesAndOriginalTreeMembershipVerified': True,
                             'boundary': 'Original diagnostic and CPU-profile baseline bytes are checked independently of the final build. Historical tools are retained only when their declared original hash matches; unavailable original tool bytes are explicitly reported, never reconstructed or equated with formal evidence.'}


def verify_performance(index, frozen):
    performance = index['performance']
    config = CONFIG['performance']
    configured = {item['name']: item for item in config['batches']}
    archived_batches = {item['name']: item for item in performance['batches']}
    assert set(archived_batches) == set(configured)
    assert performance['completeFormalMatrix'] is False
    assert performance['expectedMatrix'] == {key: value for key, value in config.items() if key != 'batches'}

    def batch_data(batch_entry, relative):
        entries = {item['originalPath']: item for item in batch_entry['files']}
        assert relative in entries, (batch_entry['name'], relative)
        return archived_raw(entries[relative])

    def batch_read(batch_entry, relative):
        return json.loads(batch_data(batch_entry, relative))

    build_files = READ(OUT / 'build-fingerprints.json')['files']
    dist = source_path(CONFIG['build'].get('directory', 'dist'))
    runner_exceptions = {(item['batch'], item['path']): item for item in config.get('runnerHashExceptions', [])}
    assert len(runner_exceptions) == len(config.get('runnerHashExceptions', []))
    batch_facts = {}
    run_checks = []
    complete_runs = 0
    complete_samples = 0
    for name, batch_config in configured.items():
        batch_entry = archived_batches[name]
        entries = {item['originalPath']: item for item in batch_entry['files']}
        for metadata in entries.values():
            archived_raw(metadata)
        manifest_raw = batch_data(batch_entry, 'manifest.json')
        manifest = json.loads(manifest_raw)
        assert batch_entry['source'] == batch_config['directory']
        assert batch_entry['status'] == manifest['status'] == batch_config['status'] == 'failed'
        assert batch_entry['measurementClass'] == manifest['measurementClass'] == 'formal-c5-production-ui-observation'
        assert batch_entry['manifestSha256'] == SHA(manifest_raw)
        assert manifest['sourceRevision'] == frozen['head']
        assert len(manifest.get('results', [])) == batch_config['expectedResults']
        assert len(manifest.get('failures', [])) == 1 and not manifest.get('finishedAt')
        assert 'summary.json' not in entries
        failure_text = '\n'.join(item.get('message', '') for item in manifest['failures'])
        assert batch_config['failureMessageContains'] in failure_text
        assert not manifest['config']['diagnostic'] and not manifest['config']['diagnosticProfile'] and not manifest['config']['cpuProfile']['enabled']
        assert manifest['config']['runs'] == config['expectedRuns']
        assert set(manifest['config']['requestedCases']) == set(config['expectedCases'])
        assert {item['name'] for item in manifest['cases']} == set(config['expectedCases'])
        for key, count in config['expectedCounts'].items():
            assert manifest['config'][key] == count
        assert (manifest['config'].get('waitTimeoutMs') or 60000) == batch_config['waitTimeoutMs']
        assert len(manifest['build']) == len({item['path'] for item in manifest['build']}) == len(build_files)
        for item in manifest['build']:
            expected = build_files[str((dist / item['path']).relative_to(ROOT))]
            assert expected == {'bytes': item['sizeBytes'], 'sha256': item['sha256']}

        declared_runners = manifest.get('runners', [])
        assert len(batch_entry['runners']) == len(declared_runners)
        for snapshot, declared in zip(batch_entry['runners'], declared_runners):
            assert {key: snapshot[key] for key in declared} == declared
            exception = runner_exceptions.get((name, declared['path']))
            if snapshot['originalBytesAvailable']:
                assert exception is None
                raw = archived_raw(snapshot['archivedFile'])
                assert len(raw) == declared['sizeBytes'] and SHA(raw) == declared['sha256']
                assert snapshot['currentSourceSha256AtArchive'] == declared['sha256']
            else:
                assert exception is not None
                assert 'archivedFile' not in snapshot and snapshot.get('boundary')
                assert exception['declaredSha256'] == declared['sha256'] and exception['currentSha256'] == snapshot.get('currentSourceSha256AtArchive')
                current = snapshot.get('currentSourceArchived')
                assert current and archived_raw(current) == source_path(declared['path']).read_bytes()
                assert current['sha256'] == exception['currentSha256']
        assert {(name, declared['path']) for declared in declared_runners if not any(item['originalBytesAvailable'] for item in batch_entry['runners'] if item.get('path') == declared['path'])} <= set(runner_exceptions)

        for case in manifest['cases']:
            artifact = case['artifact']
            raw = batch_data(batch_entry, artifact['path'])
            assert len(raw) == artifact['sizeBytes'] and SHA(raw) == artifact['sha256']
            container, blobs = package_entries(raw)
            document = json.loads(blobs['scene.json'])
            assert container['containerVersion'] == 2 and document['schemaVersion'] == 2
            assert len(document['props']) == case['summary']['propCount']

        pairs, ordinary_by_case = set(), collections.defaultdict(list)
        batch_run_checks = []
        for item in manifest['results']:
            pair = (item['case'], item['run'])
            assert pair not in pairs and item['case'] in config['expectedCases']
            assert 1 <= item['run'] <= config['expectedRuns']; pairs.add(pair)
            run = batch_read(batch_entry, item['path'])
            assert run['case'] == item['case'] and run['run'] == item['run'] and not run['errors'] and not run.get('failure')
            verify_network_audit(run, manifest['config']['networkAudit'])
            assert run.get('finishedAt') and not run.get('pendingAction')
            assert run['correctness'] and all(value is True for value in run['correctness'].values())
            assert run['resources']['path'] == item['resourcePath']
            resources = batch_read(batch_entry, item['resourcePath'])
            assert resources['summary'] == run['resources']['summary']
            assert len(resources['samples']) == resources['summary']['processSampleCount']
            assert len(resources['heapSamples']) == resources['summary']['heapSampleCount']
            assert len(resources['errors']) == resources['summary']['errorCount'] == 0
            counts = collections.Counter(sample['kind'] for sample in run['samples'])
            expected = {'marquee': 'selections', 'replacement': 'selections', 'ordinary-edit': 'edits', 'layer-hide': 'layers', 'layer-reorder': 'layers',
                        'appearance-preview': 'appearances', 'appearance-adopt': 'appearances', 'history-open': 'restores', 'restore-preview': 'restores',
                        'restore-protect-adopt-save': 'restores', 'continuous-pan': 'gestures', 'continuous-wheel': 'gestures', 'menu-dismiss': 'menus'}
            for kind, field in expected.items():
                assert counts[kind] == manifest['config'][field], (pair, kind, counts[kind])
            assert counts['pointer-menu'] + counts['keyboard-menu'] == manifest['config']['menus']
            assert counts['export-4k-gm'] == counts['export-4k-player'] == 1
            for sample in run['samples']:
                assert sample['complete'] and sample['intent']['trusted'] and all(event['trusted'] for event in sample['events'])
                assert abs(sample['browserClockDiscontinuityMs']) <= 250
                if sample['kind'] == 'ordinary-edit':
                    duration = sample['domainCommittedAtMs'] - sample['intent']['captureMs']
                    assert math.isclose(duration, sample['intentToDomainCommitMs'], rel_tol=1e-12, abs_tol=1e-7)
                    assert sample['after']['transactionRevision'] == sample['after']['revision'] == sample['expectedRevision']
                    ordinary_by_case[item['case']].append(duration)
            for exported in run['exports']:
                raw = batch_data(batch_entry, exported['path'])
                assert len(raw) == exported['sizeBytes'] and SHA(raw) == exported['sha256']
                info = png_info(raw)
                assert (info['width'], info['height']) == (exported['width'], exported['height']) and max(info['width'], info['height']) == 4096
            for audit in run.get('auditArtifacts', []):
                batch_data(batch_entry, audit['path'])
            for package in [run['selectionPackages']['before'], run['selectionPackages']['after'], run['finalPackage']]:
                raw = batch_data(batch_entry, package['path'])
                assert len(raw) == package['sizeBytes'] and SHA(raw) == package['sha256']
                verify_package(raw, package['path'])
            batch_run_checks.append({'case': item['case'], 'run': item['run'], 'samples': len(run['samples']), 'kindCounts': dict(counts), 'resourceSamples': len(resources['samples']), 'resourceHeapSamples': len(resources['heapSamples'])})
        assert pairs == {(case, run) for case in config['expectedCases'] for run in range(1, config['expectedRuns'] + 1) if (case, run) in pairs}
        failure = manifest['failures'][0]
        partial_path = failure['case'] + '-partial-failure.json'
        partial = batch_read(batch_entry, partial_path)
        assert len(partial['samples']) == batch_config['partialSampleCount']
        assert partial['failure'] == failure
        assert partial['pendingAction'] == partial['failureEvidence']['pendingAction']
        assert partial['pendingAction']['kind'] == batch_config['pendingKind'] and partial['pendingAction']['ordinal'] == batch_config['pendingOrdinal']
        assert partial['failureEvidence']['probe']['complete'] is batch_config['probeComplete']
        complete_runs += len(manifest['results'])
        complete_samples += sum(len(batch_read(batch_entry, item['path'])['samples']) for item in manifest['results'])
        batch_run_checks.append({'partialSamples': len(partial['samples']), 'partialExcludedFromStatistics': True})
        run_checks.append({'batch': name, 'runs': batch_run_checks, 'completedRuns': len(manifest['results']), 'completeSamples': sum(item['samples'] for item in batch_run_checks if 'samples' in item)})
        batch_facts[name] = {'manifest': manifest, 'manifestSha256': SHA(manifest_raw), 'completeRuns': len(manifest['results']), 'completeSamples': sum(len(batch_read(batch_entry, item['path'])['samples']) for item in manifest['results']), 'partial': partial}

    report_entries = {Path(item['path']).name: item for item in performance['formalReports']}
    assert set(report_entries) == {'formal-facts.json.gz', 'formal-tables.md.gz'}
    facts_raw = archived_raw(report_entries['formal-facts.json.gz'])
    tables_raw = archived_raw(report_entries['formal-tables.md.gz'])
    facts = json.loads(facts_raw)
    tables = tables_raw.decode('utf-8')
    assert facts['format'] == 'sceneweave-c5-formal-evidence-facts' and facts['version'] == 1
    assert facts['completeFormalMatrix'] is False and facts['performanceGatePassed'] is False
    assert facts['configuration']['sha256'] == SHA(CONFIG_PATH.read_bytes())
    assert set(facts['batches'][i]['name'] for i in range(len(facts['batches']))) == set(configured)
    assert facts['formalSubset']['batchNames'] == [name for name, item in configured.items() if item['includeInFormalSubset']]
    assert facts['formalSubset']['completedRuns'] == batch_facts[facts['formalSubset']['batchNames'][0]]['completeRuns']
    assert facts['formalSubset']['sampleCount'] == batch_facts[facts['formalSubset']['batchNames'][0]]['completeSamples']
    assert facts['allCompleteRunCounts'] == {'completedRuns': complete_runs, 'sampleCount': complete_samples, 'aggregateStatisticsComputed': False,
                                              'boundary': facts['allCompleteRunCounts']['boundary']}
    facts_by_name = {item['name']: item for item in facts['batches']}
    for name, item in configured.items():
        fact = facts_by_name[name]
        actual = batch_facts[name]
        assert fact['sourceManifestSha256'] == actual['manifestSha256']
        assert fact['completedRuns'] == actual['completeRuns'] and fact['completeSampleCount'] == actual['completeSamples']
        assert fact['includedResults'] == actual['manifest']['results'] and fact['excludedFailures'] == actual['manifest']['failures']
        assert fact['partial']['sampleCount'] == len(actual['partial']['samples'])
    assert 'completeFormalMatrix=false' in tables and 'performanceGatePassed=false' in tables
    assert all(name in tables for name in configured)
    CHECKS['performance'] = {'completeFormalMatrix': False, 'performanceGatePassed': False, 'batches': run_checks,
                              'formalReports': {'facts': len(facts['batches']), 'tablesBytes': len(tables_raw), 'factsBytes': len(facts_raw)},
                              'completedRunsAcrossBatches': complete_runs, 'completeSamplesAcrossBatches': complete_samples,
                              'boundary': 'All failed batches and partial observations are preserved independently. Derived formal reports are checked for completeness and explicitly retain the failed performance conclusion; no successful summary or target pass is inferred.'}


def verify_network_audit(run, policy):
    audit = run['networkAudit']
    assert audit['policy'] == policy
    assert audit['pageResponseCount'] == len(run['httpResponses']) and audit['cdpResponseCount'] == len(run['cdpNetworkResponses'])
    responses = [{**entry, 'observer': 'playwright-page'} for entry in run['httpResponses']]
    responses += [{**entry, 'observer': 'target-cdp'} for entry in run['cdpNetworkResponses']]
    document_origins = {(parsed.scheme, parsed.netloc) for entry in responses
                        if entry['resourceType'].lower() == 'document'
                        for parsed in [urllib.parse.urlsplit(entry['url'])]}
    assert len(document_origins) == 1
    origin = next(iter(document_origins))

    def incidental(entry):
        parsed = urllib.parse.urlsplit(entry['url'])
        return (policy['allowIncidentalFavicon404'] and entry['status'] == 404
                and (parsed.scheme, parsed.netloc) == origin and parsed.path == '/favicon.ico' and not parsed.query)

    errors = [entry for entry in responses if entry['status'] >= 400]
    assert audit['incidentalFavicon404Responses'] == [entry for entry in errors if incidental(entry)]
    assert audit['productHttpErrors'] == [entry for entry in errors if not incidental(entry)] == []
    known_urls = {entry['url'] for entry in errors if incidental(entry)}

    def incidental_error(entry):
        return ((entry.get('url') or entry.get('location', {}).get('url')) in known_urls
                and 'Failed to load resource' in entry['text'] and re.search(r'\b404\b', entry['text']))

    assert run['consoleErrors'] == [entry['text'] for entry in run['consoleErrorEvents']]
    for entries, allowed_key, unexpected_key in [
        (run['consoleErrorEvents'], 'incidentalFaviconConsoleErrors', 'unexpectedConsoleErrors'),
        (run['browserLogErrors'], 'incidentalFaviconBrowserLogErrors', 'unexpectedBrowserLogErrors'),
    ]:
        assert audit[allowed_key] == [entry for entry in entries if incidental_error(entry)]
        assert audit[unexpected_key] == [entry for entry in entries if not incidental_error(entry)] == []
    assert audit['canceledRequests'] == [entry for entry in run['requestFailures'] if entry['failure'] == 'net::ERR_ABORTED']
    assert audit['unexpectedRequestFailures'] == [entry for entry in run['requestFailures'] if entry['failure'] != 'net::ERR_ABORTED'] == []


try:
    run()
    CHECKS['allPassed'] = True
except Exception as error:
    CHECKS['allPassed'] = False
    CHECKS['failure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'evidence-verification.json').write_text(json.dumps(CHECKS, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'allPassed': CHECKS['allPassed'], 'checks': list(CHECKS), 'failure': CHECKS.get('failure')}, ensure_ascii=False))
sys.exit(0 if CHECKS['allPassed'] else 1)
