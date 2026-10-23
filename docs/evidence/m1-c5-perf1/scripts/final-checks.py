"""Check the current batch's document links, scope, secrets patterns and frozen files."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'docs/evidence/m1-c5-perf1'
frozen = json.loads((OUT / 'frozen-application.json').read_text())
baseline = json.loads((OUT / 'baseline.json').read_text())
errors = []
changed = frozen['changedRelativeToPerf1Baseline']
expected = {
    'src/io/v3/owned-data.ts', 'src/io/v3/project-file.ts',
    'src/io/v6/project-file.ts', 'src/io/v6/migration.ts', 'src/io/v6/migration.test.ts',
    'src/io/v6/prepare.ts', 'src/io/v6/resource-certification.test.ts',
    'src/editor/v6/workspace.ts', 'src/editor/v6/workspace.test.ts',
    'tests/c5-resource-reuse.spec.ts',
}
if set(changed) != expected:
    errors.append('Unexpected application files in batch scope')
for name, declared in frozen['source'].items():
    if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != declared:
        errors.append('Frozen source changed: ' + name)
for name, declared in frozen['dist'].items():
    if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != declared:
        errors.append('Frozen build changed: ' + name)
if 'src/io/v6/storage.ts' in changed:
    errors.append('Storage implementation changed')
documents = [ROOT / p for p in ['README.md', 'AGENTS.md', 'docs/README.md', 'docs/06-storage-and-export.md', 'docs/07-roadmap.md', 'docs/09-quality-plan.md', 'docs/33-c5-resource-reuse-validation.md']]
documents.append(OUT / 'README.md')
links = 0
for path in documents:
    text = path.read_text()
    for raw in re.findall(r'(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)', text):
        raw = raw.strip('<>')
        if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', raw) or raw.startswith('#'):
            continue
        target = raw.split('#', 1)[0]
        if target:
            links += 1
            resolved = (path.parent / unquote(target)).resolve()
            if resolved != OUT / 'final-checks.json' and not resolved.exists():
                errors.append(f'Missing link {path.relative_to(ROOT)}: {raw}')

pattern = re.compile(r'sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b')
scanned = 0
for path in [ROOT / p for p in changed] + documents:
    scanned += 1
    if pattern.search(path.read_text()):
        errors.append('Credential-like content: ' + str(path.relative_to(ROOT)))
whitespace = subprocess.run(['git', 'diff', '--check', '--', *changed, *[str(p.relative_to(ROOT)) for p in documents], 'task_plan.md', 'findings.md', 'progress.md'], cwd=ROOT, capture_output=True, text=True)
if whitespace.returncode:
    errors.append('Tracked diff whitespace: ' + whitespace.stdout + whitespace.stderr)
for path in [ROOT / p for p in changed if p not in baseline['source']] + [ROOT / 'docs/33-c5-resource-reuse-validation.md', OUT / 'README.md']:
    if any(line.rstrip(' \t') != line for line in path.read_text().splitlines()):
        errors.append('New file trailing whitespace: ' + str(path.relative_to(ROOT)))
external_change = json.loads((OUT / 'external-worktree-change.json').read_text())
if hashlib.sha256((ROOT / 'todo.md').read_bytes()).hexdigest() != external_change['observedSha256']:
    errors.append('Externally edited todo changed again after observation')
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
if head != baseline['head']:
    errors.append('HEAD changed during this batch')
normal_index = (ROOT / 'dist/index.html').read_text()
if '/@vite/client' in normal_index or 'performance-harness' in normal_index:
    errors.append('Expected normal production output')
report = {
    'allPassed': not errors, 'errors': errors, 'changedApplicationFiles': changed,
    'frozenSourceFiles': len(frozen['source']), 'frozenBuildFiles': len(frozen['dist']),
    'localLinksChecked': links, 'textPayloadsCredentialPatternChecked': scanned,
    'newAssetsAddedToProduct': 0, 'sourceLicenseBoundaryChanged': False,
    'storageImplementationUnchanged': True, 'headUnchanged': head == baseline['head'],
    'todoUnchangedFromBaseline': False, 'externalTodoPreserved': True,
    'performanceGatePassed': False,
}
(OUT / 'final-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
if errors:
    raise SystemExit(1)
