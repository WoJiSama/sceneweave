from pathlib import Path
import gzip
import hashlib
import json
import re
import struct
import subprocess
import unicodedata
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[3]
evidence = root / 'docs/evidence/m1-c1d'

def read(path):
    return json.loads(path.read_text())

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()

index = read(evidence / 'verification-index.json')
for item in index['sourceFiles']:
    target = evidence / item['path']
    source = Path(item['source'])
    if item.get('compression'):
        value = hashlib.sha256()
        count = 0
        with gzip.open(target, 'rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                value.update(block)
                count += len(block)
        assert value.hexdigest() == item['uncompressedSha256'] == digest(source)
        assert count == item['uncompressedBytes'] == source.stat().st_size
        gzip_check = {'bytes': count, 'sha256': value.hexdigest(), 'sourceMatches': True}
    else:
        assert target.stat().st_size == item['bytes'] == source.stat().st_size
        assert digest(target) == item['sourceSha256'] == digest(source)

attachments = read(evidence / 'browser/attachment-index.json')
for item in attachments:
    target = evidence / item['path']
    assert digest(target) == item['sha256']
    assert target.stat().st_size == item['bytes']

diagnostics = read(evidence / 'diagnostic/local-artifacts.json')
for item in diagnostics:
    source = Path(item['source'])
    assert digest(source) == item['sha256']
    assert source.stat().st_size == item['bytes']
    if item.get('archivedPath'):
        assert digest(evidence / item['archivedPath']) == item['sha256']

summaries = {name: read(evidence / f'browser/{name}-summary.json') for name in ['full-run', 'c1d-target', 'b4-target']}
all_cases = {(item['file'], item['title']) for item in summaries['full-run']['cases']}
passed = {(item['file'], item['title']) for summary in summaries.values() for item in summary['cases']
          if item['status'] == 'expected' and any(result['status'] == 'passed' for result in item['results'])}
assert len(all_cases) == 121 and all_cases <= passed
assert [summaries[name]['stats']['unexpected'] for name in ['full-run', 'c1d-target', 'b4-target']] == [1, 0, 0]

production = read(evidence / 'production-ui/report.json')
assert production['status'] == 'passed' and production['productDevApisAbsent']
assert production['errors'] == production['httpErrors'] == []
assert production['narrowDocumentWidth'] == 390
assert production['cancelPreservesRevisionAndHistory']
assert [production[key] for key in ['beforeRestoreRevision','adoptedRevision','undoneRevision','redoneRevision']] == [2,3,4,5]
assert production['backup']['laterLayerRetained'] and production['backup']['allEntryHashesVerified']
assert production['backup']['selectedNames'] == ['露台陈设 · 初稿']
screenshots = []
for name in production['screenshots']:
    path = evidence / 'production-ui' / name
    raw = path.read_bytes()
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', raw[16:24])
    screenshots.append({'path': 'production-ui/' + name, 'width': width, 'height': height, 'sha256': digest(path)})

markdown = [root / name for name in ['README.md','AGENTS.md','CONTRIBUTING.md']] + sorted((root / 'docs').glob('*.md'))
link_pattern = re.compile(r'!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)')

def anchor_set(path):
    text = path.read_text()
    found = set(re.findall(r'<(?:a|[a-z]+)\b[^>]*\bid=[\"\']([^\"\']+)[\"\']', text))
    counts = {}
    in_fence = False
    for line in text.splitlines():
        if re.match(r'^\s*(```|~~~)', line):
            in_fence = not in_fence
        if in_fence:
            continue
        heading = re.match(r'^#{1,6}\s+(.+?)(?:\s+#+)?$', line)
        if not heading:
            continue
        label = re.sub(r'<[^>]+>', '', heading.group(1)).replace('`', '').lower()
        label = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', label)
        label = ''.join(char for char in label if unicodedata.category(char)[0] not in 'PS' or char in '_-')
        slug = re.sub(r'\s', '-', label)
        suffix = counts.get(slug, 0)
        counts[slug] = suffix + 1
        found.add(slug if suffix == 0 else f'{slug}-{suffix}')
    return found

local_links = 0
anchor_links = 0
link_errors = []
cache = {}
for source in markdown:
    for match in link_pattern.finditer(source.read_text()):
        target = match.group(1) or match.group(2)
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc:
            continue
        target_path = unquote(parsed.path)
        path = (source.parent / target_path).resolve() if target_path else source
        local_links += 1
        if not path.exists():
            link_errors.append({'source': str(source.relative_to(root)), 'target': target, 'reason': 'missing path'})
            continue
        if parsed.fragment and path.suffix == '.md':
            anchor_links += 1
            anchors = cache.setdefault(path, anchor_set(path))
            if unquote(parsed.fragment) not in anchors:
                link_errors.append({'source': str(source.relative_to(root)), 'target': target, 'reason': 'missing anchor'})

fingerprints = read(evidence / 'source-fingerprints.json')['files']
for item in fingerprints:
    assert digest(root / item['path']) == item['sha256']

tracked_whitespace = subprocess.run(['git','diff','--check','--','.',':!todo.md'], cwd=root, capture_output=True, text=True)
full_whitespace = subprocess.run(['git','diff','--check'], cwd=root, capture_output=True, text=True)
assert tracked_whitespace.returncode == 0, tracked_whitespace.stdout
assert not full_whitespace.stdout or 'todo.md:' in full_whitespace.stdout
scoped_files = [root / item['path'] for item in fingerprints] + [root / 'docs/27-m1c-c1d-validation.md']
secrets = re.compile(r'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|sk-[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{24,}|AKIA[A-Z0-9]{16}')
secret_hits = []
whitespace_hits = []
for path in scoped_files:
    text = path.read_text()
    if secrets.search(text):
        secret_hits.append(str(path.relative_to(root)))
    if re.search(r'[ \t]+$', text, re.M) or not text.endswith('\n') or text.endswith('\n\n'):
        whitespace_hits.append(str(path.relative_to(root)))
assert not secret_hits and not whitespace_hits, (secret_hits, whitespace_hits)
assert not link_errors, link_errors
assert subprocess.check_output(['git','diff','--cached','--name-only'], cwd=root, text=True).splitlines() == ['todo.md']
assert not subprocess.check_output(['git','diff','--name-only','--','LICENSE','public'], cwd=root, text=True).strip()

result = {
    'version': 1,
    'status': 'passed',
    'scope': 'Archival, reference and consistency checks only; no new browser/performance run',
    'markdownFiles': len(markdown), 'localLinks': local_links, 'anchorLinks': anchor_links, 'linkErrors': link_errors,
    'sourceLogCopiesChecked': len(index['sourceFiles']) - 1,
    'fullReporterLosslessGzip': gzip_check,
    'attachmentsChecked': len(attachments), 'localDiagnosticsChecked': len(diagnostics),
    'uniqueFullBrowserCases': len(all_cases), 'allFullCasesPassedAcrossRuns': all_cases <= passed,
    'singleAllGreenFullRun': False,
    'productionUiPassed': True, 'productionScreenshots': screenshots,
    'sourceFingerprintsChecked': len(fingerprints), 'scopedWhitespaceErrors': whitespace_hits,
    'trackedDiffWhitespaceExcludingTodo': 'passed', 'preexistingTodoWarningPreserved': full_whitespace.stdout,
    'targetedCredentialPatterns': {'filesChecked': len(scoped_files), 'hits': secret_hits, 'comprehensiveAudit': False},
    'trackedLicenseAndPublicAssetDiff': [], 'stagedFiles': ['todo.md'],
    'commit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=root, text=True).strip(),
    'committedOrPushedByThisTask': False,
    'limits': ['No full interaction or history workflow performance measurement', 'No real quota exhaustion, PWA cold start, IME, cross-browser or small-group acceptance claim'],
}
(evidence / 'final-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: result[key] for key in ['status','markdownFiles','localLinks','anchorLinks','attachmentsChecked','localDiagnosticsChecked','sourceFingerprintsChecked','uniqueFullBrowserCases']}, ensure_ascii=False, indent=2))
