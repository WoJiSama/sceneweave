from pathlib import Path
import datetime
import gzip
import hashlib
import io
import json
import re
import subprocess
import urllib.parse
import zipfile

root = Path.cwd()
out = root / 'docs/evidence/m1-c4'
sha = lambda value: hashlib.sha256(value).hexdigest()
baseline = json.loads((out / 'protected-baseline.json').read_text())
checks = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
# The report is itself linked by docs/31; create its output path before checking links.
(out / 'final-checks.json').touch(exist_ok=True)

protected = baseline['protected']
checks['protectedHistory'] = {'files': len(protected), 'mismatches': [name for name, digest in protected.items() if not (root / name).is_file() or sha((root / name).read_bytes()) != digest]}
checks['todo'] = {'sha256': sha((root / 'todo.md').read_bytes()), 'matchesStartingHash': sha((root / 'todo.md').read_bytes()) == baseline['todoSha256'], 'handling': 'Preserved without editing or restoring it; excluded only from this task whitespace check.'}
checks['head'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
checks['headMatchesStartingCommit'] = checks['head'] == baseline['head']
checks['version'] = json.loads((root / 'package.json').read_text())['version']
checks['gitBranch'] = subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip()
status = subprocess.check_output(['git', 'status', '--short'], text=True)
checks['gitStatus'] = status.splitlines()
checks['stagedFiles'] = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], text=True).splitlines()
checks['delivery'] = 'Local implementation and applicable verification only; no commit, push, release or C5 work.'

def markdown_lines(path):
    fenced = False
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if re.match(r'^\s*(```|~~~)', line):
            fenced = not fenced
            continue
        if not fenced:
            yield number, line

def anchors(path):
    result, counts = set(), {}
    for _, line in markdown_lines(path):
        match = re.match(r'^#{1,6}\s+(.+?)\s*#*$', line)
        if not match:
            continue
        title = re.sub(r'!?\[([^\]]+)\]\([^)]*\)', r'\1', match[1])
        title = re.sub(r'<[^>]+>', '', title).replace('`', '')
        value = re.sub(r'[^\w\-\s]', '', title.lower())
        value = re.sub(r'\s', '-', value)
        suffix = counts.get(value, 0)
        counts[value] = suffix + 1
        result.add(value if not suffix else f'{value}-{suffix}')
    return result

documents = [root / name for name in ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'task_plan.md', 'findings.md', 'progress.md']] + sorted((root / 'docs').glob('*.md'))
broken, checked, anchor_count = [], 0, 0
for file in documents:
    for line_number, line in markdown_lines(file):
        for match in re.finditer(r'\]\(([^)]+)\)', line):
            reference = match[1].strip()
            if reference.startswith('<') and '>' in reference:
                reference = reference[1:reference.index('>')]
            else:
                reference = reference.split(' "')[0].split(" '")[0]
            if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', reference):
                continue
            path_part, _, fragment = reference.partition('#')
            path_part, fragment = urllib.parse.unquote(path_part), urllib.parse.unquote(fragment)
            target = file if not path_part else Path(path_part) if path_part.startswith('/') else file.parent / path_part
            checked += 1
            if not target.exists():
                broken.append({'file': str(file.relative_to(root)), 'line': line_number, 'target': reference, 'reason': 'missing path'})
            elif fragment and target.suffix == '.md':
                anchor_count += 1
                if fragment not in anchors(target):
                    broken.append({'file': str(file.relative_to(root)), 'line': line_number, 'target': reference, 'reason': 'missing anchor'})
checks['markdownLinks'] = {'documents': len(documents), 'localReferences': checked, 'anchorReferences': anchor_count, 'broken': broken}

def cells(line):
    found, cell, code, escaped = [], '', 0, False
    position = 0
    for match in re.finditer(r'`+|\\.|\||[^`\\|]+|\\', line.strip()):
        token = match[0]
        if token.startswith('`'):
            code = 0 if code == len(token) else len(token) if code == 0 else code
            cell += token
        elif token == '|' and not code:
            found.append(cell.strip())
            cell = ''
        else:
            cell += token
    found.append(cell.strip())
    if not found[0]:
        found = found[1:]
    if found and not found[-1]:
        found = found[:-1]
    return found

table_issues, table_count = [], 0
for file in documents:
    table = []
    for number, line in list(markdown_lines(file)) + [(0, '')]:
        if line.strip().startswith('|'):
            table.append((number, cells(line)))
            continue
        if len(table) >= 2 and all(re.match(r'^:?-+:?$', value.replace(' ', '')) for value in table[1][1]):
            table_count += 1
            width = len(table[0][1])
            for row_number, values in table:
                if len(values) != width:
                    table_issues.append({'file': str(file.relative_to(root)), 'line': row_number, 'expected': width, 'actual': len(values)})
        table = []
checks['markdownTables'] = {'tables': table_count, 'issues': table_issues}

quality = (root / 'docs/09-quality-plan.md').read_text()
defined_qa = set()
for line in quality.splitlines():
    match = re.match(r'^\|\s*(QA-[A-Z]+-\d{2}(?:/\d{2})*)\s*\|', line)
    if match:
        first, *rest = match[1].split('/')
        defined_qa.add(first)
        defined_qa.update(first[:-2] + suffix for suffix in rest)
c4_docs = [root / name for name in ['README.md', 'AGENTS.md', 'docs/README.md', 'docs/04-scene-document.md', 'docs/06-storage-and-export.md', 'docs/07-roadmap.md', 'docs/09-quality-plan.md', 'docs/31-m1c-c4-validation.md']]
used_qa = set().union(*(set(re.findall(r'\bQA-[A-Z]+-\d{2}\b', path.read_text())) for path in c4_docs))
checks['qualityReferences'] = {'defined': len(defined_qa), 'referenced': len(used_qa), 'undefined': sorted(used_qa - defined_qa)}

owned = set()
for raw in subprocess.check_output(['git', 'diff', '--name-only'], text=True).splitlines():
    if raw != 'todo.md':
        owned.add(root / raw)
for directory in ['src/core/v6', 'src/editor/v6', 'src/io/v6']:
    owned.update(path for path in (root / directory).rglob('*') if path.is_file())
for pattern in ['c4-*']:
    owned.update(path for path in (root / 'tests').glob(pattern) if path.is_file())
owned.update(root / name for name in ['src/core/v3/outdoor.ts', 'src/core/v3/outdoor.test.ts', 'src/render/shared/paths.ts', 'src/render/v3/path-rendering.test.ts', 'docs/31-m1c-c4-validation.md'])
owned.update(path for path in out.rglob('*') if path.is_file() and path.name not in ['final-checks.json', 'evidence-verification.json'])
patterns = {
    'credential': re.compile(r'sk-[A-Za-z0-9_-]{24,}|(?:API_KEY|SECRET_KEY|ACCESS_TOKEN)\s*[:=]\s*[\'\"][A-Za-z0-9_/-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'personal-data-target': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b'),
}
hits, scanned, binary_or_large = [], 0, 0

def scan_text(name, raw):
    global scanned, binary_or_large
    try:
        body = raw.decode('utf-8')
    except UnicodeDecodeError:
        binary_or_large += 1
        return
    scanned += 1
    for line_number, line in enumerate(body.splitlines(), 1):
        for label, pattern in patterns.items():
            if pattern.search(line):
                hits.append({'path': name, 'line': line_number, 'pattern': label})

for path in sorted(owned):
    if not path.is_file():
        continue
    relative = str(path.relative_to(root))
    raw = path.read_bytes()
    if path.suffix == '.gz':
        scan_text(relative + ':decompressed', gzip.decompress(raw))
    elif path.suffix in {'.zip', '.sceneweave'} or zipfile.is_zipfile(io.BytesIO(raw)):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for name in archive.namelist():
                if Path(name).suffix in {'.json', '.md', '.txt', '.ts', '.tsx', '.js', '.mjs', '.yaml', '.yml'}:
                    scan_text(relative + ':' + name, archive.read(name))
    elif path.suffix in {'.md', '.json', '.ts', '.tsx', '.js', '.mjs', '.py', '.css', '.txt', '.log', '.yaml', '.yml'} or path.name == 'error-context':
        scan_text(relative, raw)
    else:
        binary_or_large += 1
checks['targetedCredentialAndPrivateDataScan'] = {'textPayloadsScanned': scanned, 'binaryPayloadsExcluded': binary_or_large, 'patterns': list(patterns), 'hits': hits, 'boundary': 'Targeted credential and private-data patterns only; this is not a universal PII classifier. Known local workspace paths and fixture GM text are deliberate evidence context, not credentials.'}

scoped_diff = subprocess.run(['git', 'diff', '--check', '--', '.', ':!todo.md'], text=True, capture_output=True)
full_diff = subprocess.run(['git', 'diff', '--check'], text=True, capture_output=True)
checks['whitespace'] = {'taskScopeExitCode': scoped_diff.returncode, 'taskScopeOutput': scoped_diff.stdout + scoped_diff.stderr, 'fullWorktreeExitCode': full_diff.returncode, 'fullWorktreeOutput': full_diff.stdout + full_diff.stderr}
untracked_paths = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '--', 'src', 'tests', 'docs/31-m1c-c4-validation.md'], text=True).splitlines()
untracked_whitespace = []
for name in untracked_paths:
    for line_number, line in enumerate((root / name).read_text().splitlines(), 1):
        if line.endswith((' ', '\t')):
            untracked_whitespace.append({'file': name, 'line': line_number})
checks['whitespace']['untrackedTextFilesChecked'] = len(untracked_paths)
checks['whitespace']['untrackedTrailingWhitespace'] = untracked_whitespace
checks['evidenceVerificationPassed'] = json.loads((out / 'evidence-verification.json').read_text())['allPassed']
checks['allPassed'] = all([
    len(protected) == 705,
    not checks['protectedHistory']['mismatches'],
    checks['todo']['matchesStartingHash'],
    checks['headMatchesStartingCommit'],
    checks['version'] == '0.2.0-m1-c4',
    not checks['stagedFiles'],
    not broken,
    not table_issues,
    not checks['qualityReferences']['undefined'],
    not hits,
    scoped_diff.returncode == 0,
    not untracked_whitespace,
    checks['evidenceVerificationPassed'],
])
(out / 'final-checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: checks[key] for key in ['allPassed', 'protectedHistory', 'todo', 'markdownLinks', 'markdownTables', 'qualityReferences', 'targetedCredentialAndPrivateDataScan', 'whitespace']}, ensure_ascii=False, indent=2))
assert checks['allPassed'], 'See docs/evidence/m1-c4/final-checks.json for failed mechanical checks.'
