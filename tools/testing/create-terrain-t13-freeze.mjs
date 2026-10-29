import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const work = path.resolve(root, process.env.SCENEWEAVE_T13_FREEZE_DIR ?? 'work/terrain-t13-freeze')
if (!work.startsWith(`${path.resolve(root, 'work')}${path.sep}`)) throw new Error('T13 freeze output must stay under work/.')

const scope = [
  ['source', 'services/ai'],
  ['source', 'src/application/workspace'],
  ['source', 'src/editor/main'],
  ['source', 'src/platform/browser/render'],
  ['source', 'src/platform/browser/storage'],
  ['source', 'src/platform/browser/terrain-generation'],
  ['source', 'src/shared/ai'],
  ['source', 'src/shared/appearance'],
  ['source', 'src/shared/commands'],
  ['source', 'src/shared/geometry/dependencies.ts'],
  ['source', 'src/shared/geometry/scatter.ts'],
  ['source', 'src/shared/history'],
  ['source', 'src/shared/library'],
  ['source', 'src/shared/model'],
  ['source', 'src/shared/project'],
  ['source', 'src/shared/projection'],
  ['source', 'src/shared/terrain-generation'],
  ['source', 'src/shared/validation'],
  ['source', 'src/shared/visual'],
  ['test', 'src/application/workspace'],
  ['test', 'src/platform/browser/terrain-generation'],
  ['test', 'src/platform/browser/storage'],
  ['test', 'src/shared/ai'],
  ['test', 'src/shared/terrain-generation'],
  ['test', 'src/shared/visual'],
  ['test', 'tests/terrain-'],
  ['test', 'tests/helpers/terrain-authoring-fixture.ts'],
  ['tool', 'tools/testing'],
  ['asset-source', 'assets'],
  ['asset-build', 'public/assets'],
  ['build', 'dist'],
  ['contract-input', 'package.json'],
  ['contract-input', 'package-lock.json'],
  ['contract-input', 'tsconfig.json'],
  ['contract-input', 'tsconfig.ai.json'],
  ['contract-input', 'vite.config.ts'],
]

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => JSON.stringify(value)
const fileType = async file => {
  try { return await stat(file) } catch { return null }
}

async function filesUnder(relative) {
  const absolute = path.join(root, relative)
  const info = await fileType(absolute)
  if (!info?.isFile()) {
    const entries = []
    const walk = async directory => {
      if (!(await fileType(directory))?.isDirectory()) return
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name)
        if (item.isDirectory()) await walk(file)
        else if (item.isFile()) entries.push(file)
      }
    }
    await walk(absolute)
    return entries
  }
  return [absolute]
}

async function resolveEntry(category, target) {
  if (target === 'tests/terrain-') {
    return (await filesUnder('tests')).filter(file => path.basename(file).startsWith('terrain-'))
  }
  return filesUnder(target)
}

const entries = new Map()
for (const [category, target] of scope) {
  for (const file of await resolveEntry(category, target)) {
    const relative = path.relative(root, file).split(path.sep).join('/')
    if (relative.startsWith('work/') || relative === 'dist/manifest.json') continue
    const bytes = await readFile(file)
    entries.set(relative, { path: relative, category, sizeBytes: bytes.length, sha256: sha256(bytes) })
  }
}

const sorted = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path))
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const fingerprintInput = { format: 'sceneweave-t13-freeze', version: 1, stage: 'T13', entries: sorted }
const freezeSha256 = sha256(Buffer.from(canonical(fingerprintInput)))
const manifest = {
  ...fingerprintInput,
  sourceRevision,
  generatedAt: new Date().toISOString(),
  freezeSha256,
  scope: scope.map(([category, target]) => ({ category, target })),
  excluded: ['progress.md', 'task_plan.md', 'findings.md', 'todo.md', 'work/**', 'docs/**'],
  counts: sorted.reduce((counts, entry) => ({ ...counts, [entry.category]: (counts[entry.category] ?? 0) + 1 }), {}),
  status: 'complete',
  note: 'This manifest freezes the T13 runtime, tests, tools, source/build assets and contract inputs. Full Q4, visual readback, P3, full regression and formal performance remain M2-E work.'
}

await mkdir(work, { recursive: true })
await writeFile(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(path.join(work, 'freeze-sha256.txt'), `${freezeSha256}\n`)
console.log(JSON.stringify({ path: path.relative(root, path.join(work, 'manifest.json')), freezeSha256, entries: sorted.length, counts: manifest.counts }, null, 2))
