"""Archive this batch without modifying any previous C5 evidence."""
import hashlib
import json
import shutil
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'docs/evidence/m1-c5-perf1'
WORK = ROOT / 'work/c5-perf1-20261023'


def archive(name, paths):
    destination = OUT / name
    if destination.exists():
        raise RuntimeError(f'Refusing to overwrite {destination}')
    with tarfile.open(destination, 'w:gz') as target:
        for origin, relative in sorted(paths, key=lambda item: item[1]):
            target.add(origin, arcname=relative, recursive=False)


def tree(path):
    return [(p, str(p.relative_to(path))) for p in path.rglob('*') if p.is_file()]


baseline = json.loads((WORK / 'baseline.json').read_text())
frozen = json.loads((WORK / 'frozen-application.json').read_text())
archive('baseline-source.tar.gz', tree(WORK / 'baseline-source'))
archive('baseline-dist.tar.gz', tree(WORK / 'baseline-dist'))
archive('current-source.tar.gz', [(ROOT / p, p) for p in frozen['source']])
archive('current-dist.tar.gz', tree(ROOT / 'dist'))
archive('performance-before.tar.gz', tree(WORK / 'performance-before'))
archive('performance-after.tar.gz', tree(WORK / 'performance-after'))
archive('production-ui.tar.gz', tree(WORK / 'production-ui'))
archive('chrome-reports.tar.gz', [(WORK / p, p) for p in ['chrome-new-initial.json', 'chrome-regression.json']])
archive('validation-logs.tar.gz', [(p, p.name) for p in WORK.glob('*.log')])
for name in ['baseline.json', 'frozen-application.json', 'comparison.json', 'production-serving.json', 'design.md']:
    if (OUT / name).exists():
        raise RuntimeError(f'Refusing to overwrite {name}')
    shutil.copyfile(WORK / name, OUT / name)
entries = {}
for p in sorted(OUT.rglob('*')):
    if p.is_file() and p.name not in ['index.json', 'verification.json', 'final-checks.json']:
        payload = p.read_bytes()
        entries[str(p.relative_to(OUT))] = {'sizeBytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
(OUT / 'index.json').write_text(json.dumps({'format': 'sceneweave-c5-perf1-evidence', 'version': 1, 'files': entries}, indent=2) + '\n')
print(f'Archived {len(entries)} independent evidence files')
