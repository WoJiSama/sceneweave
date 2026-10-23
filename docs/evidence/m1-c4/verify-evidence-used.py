from pathlib import Path
import collections
import datetime
import gzip
import hashlib
import io
import json
import struct
import zipfile
import zlib

root = Path.cwd()
out = root / 'docs/evidence/m1-c4'
sha = lambda value: hashlib.sha256(value).hexdigest()
read = lambda path: json.loads(path.read_text())
canonical = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
checks = {}

def verify_bytes(path, metadata, hash_key='sha256', length_key='bytes'):
    data = path.read_bytes()
    assert sha(data) == metadata[hash_key], str(path)
    assert len(data) == metadata[length_key], str(path)
    return data

for name, expected in [('source-fingerprints.json', 371), ('build-fingerprints.json', 48)]:
    entries = read(out / name)['files']
    assert len(entries) == expected
    for name_in_root, metadata in entries.items():
        verify_bytes(root / name_in_root, metadata)
    checks[name] = {'files': len(entries), 'allHashesAndSizesMatch': True}

index = read(out / 'evidence-index.json')
for metadata in index['rawReports']:
    packed = verify_bytes(out / metadata['path'], metadata)
    raw = gzip.decompress(packed)
    assert sha(raw) == metadata['rawSha256']
    assert len(raw) == metadata['rawBytes']
    assert raw == (root / metadata['source']).read_bytes()
for metadata in index['attachments']:
    verify_bytes(out / metadata['path'], metadata)
checks['archives'] = {'losslessGzipReports': len(index['rawReports']), 'archivedAttachments': len(index['attachments']), 'allHashesAndSizesMatch': True}

unit = json.loads(gzip.decompress((out / 'unit-final-corrected.json.gz').read_bytes()))
assert len(unit['testResults']) == 81
assert unit['numTotalTests'] == unit['numPassedTests'] == 969
assert unit['numFailedTests'] == unit['numPendingTests'] == 0
checks['unit'] = {'files': 81, 'passedTests': 969, 'failedTests': 0, 'durationSecondsFromLog': 21.14}
assert '✓ built in' in gzip.decompress((out / 'build-final-corrected.log.gz').read_bytes()).decode()

reporter_results = []
for metadata in index['reporters']:
    raw = verify_bytes(out / metadata['path'], metadata)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        assert len(set(archive.namelist())) == len(archive.namelist()) == metadata['reportMembers']
        report = json.loads(archive.read('report.json'))
        files = [json.loads(archive.read(name)) for name in archive.namelist() if name != 'report.json']
    assert report['stats'] == metadata['stats']
    assert sum(len(file['tests']) for file in files) == report['stats']['total']
    summary = read(out / metadata['path'].replace('.report.zip', '-summary.json'))
    assert summary['_sceneweaveEvidence']['rawReporterSha256'] == sha(raw)
    local_attachments = 0
    for file in summary['files']:
        for test in file['tests']:
            for result in test['results']:
                for attachment in result.get('attachments', []):
                    if 'source' in attachment:
                        verify_bytes(root / attachment['source'], attachment)
                        local_attachments += 1
                    if 'archivedPath' in attachment:
                        verify_bytes(out / attachment['archivedPath'], attachment)
    cohort = [file for file in files if file['fileName'].startswith('c4-')]
    if metadata['path'] == 'chromium-final-corrected.report.zip':
        assert report['stats'] == {'total': 162, 'expected': 162, 'unexpected': 0, 'flaky': 0, 'skipped': 0, 'ok': True}
        assert {file['fileName']: len(file['tests']) for file in cohort} == {'c4-renderer.spec.ts': 3, 'c4-storage.spec.ts': 4, 'c4-workbench.spec.ts': 7}
        assert all(test['outcome'] == 'expected' for file in files for test in file['tests'])
        assert len(list((out / 'chromium-final-corrected-artifacts').glob('*.json'))) == 14
        assert len(list((out / 'chromium-final-corrected-artifacts').glob('*.png'))) == 4
    reporter_results.append({'path': metadata['path'], 'stats': report['stats'], 'members': metadata['reportMembers'], 'localExternalAttachmentsVerified': local_attachments, 'crcAndHashVerified': True})
checks['browserReporters'] = reporter_results

def png_info(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, chunks, dimensions, image_data = 8, [], None, []
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + size]
        expected_crc = struct.unpack('>I', data[pos + 8 + size:pos + 12 + size])[0]
        assert zlib.crc32(kind + payload) & 0xffffffff == expected_crc
        chunks.append(kind.decode('ascii'))
        if kind == b'IHDR':
            dimensions = struct.unpack('>II', payload[:8])
        if kind == b'IDAT':
            image_data.append(payload)
        pos += size + 12
    assert pos == len(data) and chunks[-1] == 'IEND'
    assert zlib.decompress(b''.join(image_data))
    return dimensions, chunks

def verify_package(path):
    raw = path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        assert len(names) == len(set(names))
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['containerVersion'] == 6 and manifest['documentSchemaVersion'] == 3 and manifest['profile'] == 'm1-outdoor'
        assert len(manifest['entries']) == len({entry['path'] for entry in manifest['entries']})
        assert set(names) == {'manifest.json', *(entry['path'] for entry in manifest['entries'])}
        assert not any('migration' in name or 'original' in name for name in names)
        blobs = {entry['path']: archive.read(entry['path']) for entry in manifest['entries']}
        for entry in manifest['entries']:
            assert len(blobs[entry['path']]) == entry['sizeBytes']
            assert sha(blobs[entry['path']]) == entry['sha256']
        images, licenses = {}, {}
        for entry in manifest['entries']:
            if entry['role'] == 'asset':
                assert entry['mimeType'] == 'image/png'
                (width, height), _ = png_info(blobs[entry['path']])
                images[entry['sha256']] = {'sha256': entry['sha256'], 'mimeType': entry['mimeType'], 'sizeBytes': entry['sizeBytes'], 'pixelWidth': width, 'pixelHeight': height}
            elif entry['role'] == 'license':
                licenses[entry['sha256']] = {'sha256': entry['sha256'], 'text': blobs[entry['path']].decode('utf-8')}

        def content(scene_path, identity_path, appearance_path, refs, bindings):
            document = json.loads(blobs[scene_path])
            identity = json.loads(blobs[identity_path])
            appearance = json.loads(blobs[appearance_path])
            assert document['schemaVersion'] == 3 and identity['version'] == 3 and appearance['version'] == 1
            assert set(identity) == {'version', 'lineageId', 'rootSceneId', 'propTokens', 'prefabTokens', 'outdoorTokens'}
            selected_images = {digest: images[digest] for digest in refs['assetHashes']}
            selected_licenses = {digest: licenses[digest] for digest in refs['licenseHashes']}
            assert len(selected_images) == len(refs['assetHashes']) and len(selected_licenses) == len(refs['licenseHashes'])
            subjects = {}
            for kind, key in [('asset', 'assets'), ('material', 'materials'), ('propDefinition', 'propDefinitions'), ('prefabDefinition', 'prefabDefinitions'), ('styleTheme', 'styleThemes')]:
                for subject_id, subject in document[key].items():
                    subjects[(kind, subject_id)] = subject
            assert len(bindings) == len(subjects)
            assert {(binding['subjectKind'], binding['subjectId']) for binding in bindings} == set(subjects)
            for binding in bindings:
                subject = subjects[(binding['subjectKind'], binding['subjectId'])]
                assert binding['licenseRef'] == subject['licenseRef'] and binding['embedding'] == 'allowed' and subject['origin']['canEmbed']
                digest = binding['licensePath'].removeprefix('licenses/').removesuffix('.txt')
                assert digest in selected_licenses and binding['licensePath'] in blobs
            for asset in document['assets'].values():
                actual = selected_images[asset['sha256']]
                assert all(actual[key] == asset[key] for key in ('sha256', 'mimeType', 'pixelWidth', 'pixelHeight'))
            assert set(refs['assetHashes']) == {asset['sha256'] for asset in document['assets'].values()}
            for prop_id in document['props']:
                assert identity['propTokens'][prop_id] and appearance['sources'][appearance['propSources'][prop_id]]
            for prefab_id in document['prefabInstances']:
                assert identity['prefabTokens'][prefab_id]
            for variant in appearance['variants'].values():
                source, target = document['assets'][variant['sourceAssetId']], document['assets'][variant['outputAssetId']]
                assert all(source[key] == target[key] for key in ('origin', 'licenseRef', 'logicalSizeMm'))
            return {'document': document, 'historyIdentity': identity, 'appearance': appearance, 'assets': selected_images, 'licenses': selected_licenses, 'licenseBindings': bindings}

        history = json.loads(blobs['history.json']) if 'history.json' in blobs else None
        refs = history['current'] if history else {'assetHashes': list(images), 'licenseHashes': list(licenses)}
        current = content('scene.json', 'identity.json', 'appearance.json', refs, manifest['licenseBindings'])
        assert manifest['sceneId'] == current['document']['sceneId'] and manifest['revision'] == current['document']['revision']
        snapshot_results = []
        used_images, used_licenses = set(refs['assetHashes']), set(refs['licenseHashes'])
        if history:
            assert manifest['packageMode'] == 'history'
            for snapshot in history['snapshots']:
                historic = content(snapshot['scenePath'], snapshot['identityPath'], snapshot['appearancePath'], snapshot, snapshot['licenseBindings'])
                digest = sha(canonical(historic).encode('utf-8'))
                assert digest == snapshot['summary']['contentHash']
                assert historic['document']['revision'] == snapshot['summary']['sourceRevision']
                assert historic['historyIdentity']['lineageId'] == snapshot['summary']['lineageId']
                snapshot_results.append({'id': snapshot['summary']['id'], 'contentHash': digest})
                used_images.update(snapshot['assetHashes'])
                used_licenses.update(snapshot['licenseHashes'])
        else:
            assert manifest['packageMode'] == 'complete'
        assert used_images == set(images) and used_licenses == set(licenses)
        return {'path': str(path.relative_to(out)), 'bytes': len(raw), 'sha256': sha(raw), 'contentHash': sha(canonical(current).encode('utf-8')), 'revision': current['document']['revision'], 'entries': len(manifest['entries']), 'images': len(images), 'licenses': len(licenses), 'snapshots': snapshot_results, 'crcManifestResourceLicenseClosureVerified': True}

production = []
for run in index['productionRuns']:
    directory = out / run['path']
    for metadata in run['files']:
        verify_bytes(out / metadata['path'], metadata)
    report = read(directory / 'report.json')
    assert report['status'] == 'passed' and not report['productDevApiKeys'] and not report['errors'] and not report['httpErrors']
    assert report['reopened']['sameCompleteContent']
    packages = [verify_package(path) for path in sorted(directory.glob('*.sceneweave'))]
    selected = next(package for package in packages if package['path'].endswith('/selected-history.sceneweave'))
    assert all(selected[key] == report['archive'][key] for key in ('bytes', 'sha256', 'contentHash'))
    assert selected['contentHash'] == report['reopened']['contentHash']
    for audience in ['gm', 'player']:
        data = (directory / (audience + '-4k.png')).read_bytes()
        info = report['png'][audience]
        (width, height), chunks = png_info(data)
        assert width == info['width'] == 4096 and height == info['height'] == 3072
        assert len(data) == info['bytes'] and sha(data) == info['sha256']
        assert set(chunks) == {'IHDR', 'IDAT', 'IEND'}
    assert report['png']['gm']['pixelHash'] == report['png']['player']['pixelHash']
    production.append({'path': run['path'], 'finalCorrectedSource': run['finalCorrectedSource'], 'packages': packages, 'nativeImageDecodeEvidence': 'report.json and runner-used.mjs; this independent check verifies PNG header/CRC/IDAT, not a second browser run', 'allRecordedFileHashesMatch': True})
checks['productionRuns'] = production
checks['verificationScripts'] = []
for name in ['archive-evidence.py', 'verify-evidence.py', 'final-checks.py']:
    original = (root / 'work/c4-20261022' / name).read_bytes()
    archived = out / (name[:-3] + '-used.py')
    assert original == archived.read_bytes()
    checks['verificationScripts'].append({'path': archived.name, 'bytes': len(original), 'sha256': sha(original)})
checks['capturedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
checks['allPassed'] = True
(out / 'evidence-verification.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'allPassed': True, 'sourceFiles': 371, 'buildFiles': 48, 'rawReports': len(index['rawReports']), 'reporters': len(reporter_results), 'attachments': len(index['attachments']), 'productionRuns': len(production), 'productionPackages': sum(len(run['packages']) for run in production)}))
