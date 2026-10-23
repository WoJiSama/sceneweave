#!/usr/bin/env python3
"""Mechanical C5 delivery checks; preserves baseline history and todo verbatim."""
from pathlib import Path
import datetime
import gzip
import hashlib
import io
import json
import re
import subprocess
import sys
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(__file__).resolve().parent
CONFIG_PATH = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else WORK / 'delivery-config.json'
CONFIG = json.loads(CONFIG_PATH.read_text())
OUT = (ROOT / CONFIG.get('evidenceDirectory', 'docs/evidence/m1-c5')).resolve()
assert OUT == ROOT / 'docs/evidence/m1-c5'
OUT.mkdir(parents=True, exist_ok=True)
# The report can be linked by the C5 validation document during this very check.
(OUT / 'final-checks.json').touch(exist_ok=True)
SHA = lambda raw: hashlib.sha256(raw).hexdigest()
CHECKS = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
baseline = json.loads((OUT / 'protected-baseline.json').read_text())
frozen = json.loads((OUT / 'final-source-baseline.json').read_text())


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


protected = baseline['protected']
CHECKS['protectedHistory'] = {'files': len(protected), 'expectedFiles': CONFIG.get('expectedProtectedFiles', 826),
    'mismatches': [name for name, digest in protected.items() if not (ROOT / name).is_file() or SHA((ROOT / name).read_bytes()) != digest]}
todo_hash = SHA((ROOT / 'todo.md').read_bytes())
CHECKS['todo'] = {'sha256': todo_hash, 'matchesStartingHash': todo_hash == baseline['todoSha256'],
    'handling': 'Preserved byte-for-byte without editing or restoring; excluded only from task whitespace scope.'}
CHECKS['head'] = git('rev-parse', 'HEAD')
CHECKS['headMatchesStartingAndFrozenCommit'] = CHECKS['head'] == baseline['head'] == frozen['head']
CHECKS['version'] = json.loads((ROOT / 'package.json').read_text())['version']
CHECKS['versionMatchesFrozenSource'] = CHECKS['version'] == frozen['version']
CHECKS['gitBranch'] = git('branch', '--show-current')
CHECKS['gitStatus'] = git('status', '--short').splitlines()
CHECKS['stagedFiles'] = git('diff', '--cached', '--name-only').splitlines()
source_changes = [name for name, digest in frozen['files'].items() if not (ROOT / name).is_file() or SHA((ROOT / name).read_bytes()) != digest]
configured_deviations = CONFIG.get('toolingDeviations', {})
verified_deviations, invalid_deviations = {}, []
for name, deviation in configured_deviations.items():
    candidate = ROOT / name
    if (name not in source_changes or not candidate.is_file() or not name.startswith('tools/performance/')
            or frozen['files'].get(name) != deviation.get('frozenSha256') or not deviation.get('reason')
            or SHA(candidate.read_bytes()) != deviation.get('currentSha256') or candidate.stat().st_size != deviation.get('currentBytes')):
        invalid_deviations.append(name)
    else:
        verified_deviations[name] = deviation
CHECKS['configuredToolingDeviations'] = {'verified': verified_deviations, 'invalid': invalid_deviations,
    'boundary': 'The frozen original runner hash and current configurable-timeout runner are distinct; this allowance does not relabel current bytes as the original formal runner.'}
CHECKS['frozenSourceMismatches'] = sorted(set(source_changes) - set(verified_deviations))
CHECKS['delivery'] = 'Local C5 implementation and applicable verification; these checks do not commit, push, deploy or confer complete M1 acceptance.'


def markdown_lines(candidate):
    fence = None
    for number, line in enumerate(candidate.read_text().splitlines(), 1):
        match = re.match(r'^\s*(`{3,}|~{3,})', line)
        if match:
            token = match[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        if fence is None:
            yield number, line


def anchors(candidate):
    result, counts = set(), {}
    for _, line in markdown_lines(candidate):
        match = re.match(r'^#{1,6}\s+(.+?)\s*#*$', line)
        if not match:
            continue
        title = re.sub(r'!?\[([^\]]+)\]\([^)]*\)', r'\1', match[1])
        title = re.sub(r'<[^>]+>', '', title).replace('`', '')
        value = re.sub(r'[^\w\-\s]', '', title.lower())
        value = re.sub(r'\s', '-', value)
        suffix = counts.get(value, 0); counts[value] = suffix + 1
        result.add(value if suffix == 0 else f'{value}-{suffix}')
    return result


documents = [ROOT / name for name in ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'task_plan.md', 'findings.md', 'progress.md'] if (ROOT / name).is_file()]
documents += sorted((ROOT / 'docs').glob('*.md'))
documents.append(WORK / 'formal-tables.md')
broken, references, anchor_references = [], 0, 0
for candidate in documents:
    for number, line in markdown_lines(candidate):
        for match in re.finditer(r'\]\(([^)]+)\)', line):
            value = match[1].strip()
            value = value[1:value.index('>')] if value.startswith('<') and '>' in value else value.split(' "')[0].split(" '")[0]
            if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', value):
                continue
            target_name, _, fragment = value.partition('#')
            target_name, fragment = urllib.parse.unquote(target_name), urllib.parse.unquote(fragment)
            target = candidate if not target_name else Path(target_name) if target_name.startswith('/') else candidate.parent / target_name
            references += 1
            if not target.exists():
                broken.append({'file': str(candidate.relative_to(ROOT)), 'line': number, 'target': value, 'reason': 'missing path'})
            elif fragment and target.suffix == '.md':
                anchor_references += 1
                if fragment not in anchors(target):
                    broken.append({'file': str(candidate.relative_to(ROOT)), 'line': number, 'target': value, 'reason': 'missing anchor'})
CHECKS['markdownLinks'] = {'documents': len(documents), 'localReferences': references, 'anchorReferences': anchor_references, 'broken': broken}


def cells(line):
    found, current, code = [], '', 0
    for match in re.finditer(r'`+|\\.|\||[^`\\|]+|\\', line.strip()):
        token = match[0]
        if token.startswith('`'):
            code = 0 if code == len(token) else len(token) if code == 0 else code
            current += token
        elif token == '|' and code == 0:
            found.append(current.strip()); current = ''
        else:
            current += token
    found.append(current.strip())
    if found and not found[0]:
        found.pop(0)
    if found and not found[-1]:
        found.pop()
    return found


table_issues, table_count = [], 0
for candidate in documents:
    table = []
    for number, line in [*markdown_lines(candidate), (0, '')]:
        if line.strip().startswith('|'):
            table.append((number, cells(line)))
            continue
        if len(table) >= 2 and table[1][1] and all(re.fullmatch(r':?-+:?', value.replace(' ', '')) for value in table[1][1]):
            table_count += 1
            width = len(table[0][1])
            table_issues.extend({'file': str(candidate.relative_to(ROOT)), 'line': row, 'expected': width, 'actual': len(values)} for row, values in table if len(values) != width)
        table = []
CHECKS['markdownTables'] = {'tables': table_count, 'issues': table_issues}

defined_qa = set()
for line in (ROOT / 'docs/09-quality-plan.md').read_text().splitlines():
    match = re.match(r'^\|\s*(QA-[A-Z]+-\d{2}(?:/\d{2})*)\s*\|', line)
    if match:
        first, *rest = match[1].split('/')
        defined_qa.add(first); defined_qa.update(first[:-2] + suffix for suffix in rest)
used_qa = set()
for candidate in documents:
    used_qa.update(re.findall(r'\bQA-[A-Z]+-\d{2}\b', candidate.read_text()))
CHECKS['qualityReferences'] = {'defined': len(defined_qa), 'referenced': len(used_qa), 'undefined': sorted(used_qa - defined_qa)}

owned = {ROOT / name for name in git('diff', '--name-only').splitlines() if name != 'todo.md'}
owned.update(ROOT / name for name in git('ls-files', '--others', '--exclude-standard', '--', 'src', 'tests', 'tools', 'docs').splitlines())
owned.update(candidate for candidate in OUT.rglob('*') if candidate.is_file() and candidate.name not in {'final-checks.json', 'evidence-verification.json'})
delivery_files = ['archive-evidence.py', 'verify-evidence.py', 'final-checks.py', 'report-formal.mjs', 'freeze-source.mjs', 'delivery-config.json', 'formal-facts.json', 'formal-tables.md']
owned.update(WORK / name for name in delivery_files)
patterns = {
    'credential': re.compile(r'sk-[A-Za-z0-9_-]{24,}|(?:API_KEY|SECRET_KEY|ACCESS_TOKEN)\s*[:=]\s*[\'\"][A-Za-z0-9_/-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'provider-token': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b'),
    'contextual-personal-contact': re.compile(r'(?:身份证|手机号|联系电话)\s*[:：=]\s*[\'\"]?\d{11,18}\b|(?:个人邮箱|privateEmail)\s*[:：=]\s*[\'\"]?[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', re.I),
}
hits, skipped, scanned = [], [], 0
text_suffixes = {'.md', '.json', '.jsonl', '.ts', '.tsx', '.js', '.mjs', '.py', '.css', '.txt', '.log', '.yaml', '.yml', '.html'}


def scan(name, raw):
    global scanned
    if len(raw) > 64 * 1024 * 1024:
        skipped.append({'path': name, 'reason': 'text payload exceeds 64 MiB'}); return
    try:
        body = raw.decode('utf-8')
    except UnicodeDecodeError:
        skipped.append({'path': name, 'reason': 'binary'}); return
    scanned += 1
    for number, line in enumerate(body.splitlines(), 1):
        for label, pattern in patterns.items():
            if pattern.search(line):
                hits.append({'path': name, 'line': number, 'pattern': label})


scan_errors = []
for candidate in sorted(owned):
    if not candidate.is_file():
        continue
    name = str(candidate.relative_to(ROOT))
    try:
        raw = candidate.read_bytes()
        if candidate.suffix == '.gz':
            scan(name + ':decompressed', gzip.decompress(raw))
        elif candidate.suffix in {'.zip', '.sceneweave'}:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                for member in archive.namelist():
                    if Path(member).suffix in text_suffixes:
                        scan(name + ':' + member, archive.read(member))
        elif candidate.suffix in text_suffixes or candidate.name.startswith('.env'):
            scan(name, raw)
        else:
            skipped.append({'path': name, 'reason': 'nontext file'})
    except Exception as error:
        scan_errors.append({'path': name, 'error': str(error)})
CHECKS['targetedCredentialAndPrivateDataScan'] = {'textPayloadsScanned': scanned, 'skipped': skipped, 'patterns': list(patterns), 'hits': hits, 'errors': scan_errors,
    'boundary': 'Targeted credential/provider/contact patterns only, not a universal PII classifier. Local workspace paths and deliberately retained fictional GM text are evidence context.'}

scoped = subprocess.run(['git', 'diff', '--check', '--', '.', ':!todo.md'], cwd=ROOT, text=True, capture_output=True)
full = subprocess.run(['git', 'diff', '--check'], cwd=ROOT, text=True, capture_output=True)
untracked = git('ls-files', '--others', '--exclude-standard', '--', 'src', 'tests', 'tools', 'docs').splitlines()
whitespace = []
checked_text = 0
for candidate in sorted({ROOT / name for name in untracked} | {WORK / name for name in delivery_files}):
    if candidate.suffix not in text_suffixes or not candidate.is_file():
        continue
    checked_text += 1
    for number, line in enumerate(candidate.read_text().splitlines(), 1):
        if line.endswith((' ', '\t')):
            whitespace.append({'file': str(candidate.relative_to(ROOT)), 'line': number})
CHECKS['whitespace'] = {'taskScopeExitCode': scoped.returncode, 'taskScopeOutput': scoped.stdout + scoped.stderr,
    'fullWorktreeExitCode': full.returncode, 'fullWorktreeOutput': full.stdout + full.stderr,
    'untrackedTextFilesChecked': checked_text, 'untrackedTrailingWhitespace': whitespace}
verification = json.loads((OUT / 'evidence-verification.json').read_text())
index = json.loads((OUT / 'evidence-index.json').read_text())
facts = json.loads((WORK / 'formal-facts.json').read_text())
CHECKS['evidenceVerificationPassed'] = verification['allPassed']
CHECKS['performanceConclusions'] = {'completeFormalMatrix': False, 'performanceGatePassed': False,
    'flagsRetained': all(value.get('completeFormalMatrix') is False and value.get('performanceGatePassed') is False
                         for value in [CONFIG['performance'], index, index.get('performance', {}), facts, verification.get('performance', {})]),
    'batchNames': [item['name'] for item in CONFIG['performance']['batches']],
    'boundary': 'Evidence integrity checks may pass while the formal matrix remains incomplete and the performance gate remains failed.'}
CHECKS['allPassed'] = all([len(protected) == CONFIG.get('expectedProtectedFiles', 826), not CHECKS['protectedHistory']['mismatches'],
    CHECKS['todo']['matchesStartingHash'], CHECKS['headMatchesStartingAndFrozenCommit'], CHECKS['versionMatchesFrozenSource'],
    not CHECKS['frozenSourceMismatches'], not invalid_deviations, not CHECKS['stagedFiles'], not broken, not table_issues, not CHECKS['qualityReferences']['undefined'],
    not hits, not scan_errors, scoped.returncode == 0, not whitespace, CHECKS['evidenceVerificationPassed'], CHECKS['performanceConclusions']['flagsRetained']])
(OUT / 'final-checks.json').write_text(json.dumps(CHECKS, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: CHECKS[key] for key in ['allPassed', 'protectedHistory', 'todo', 'markdownLinks', 'markdownTables', 'qualityReferences', 'whitespace']}, ensure_ascii=False))
sys.exit(0 if CHECKS['allPassed'] else 1)
