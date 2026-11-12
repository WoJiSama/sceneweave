import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { sha, check } from './production-pair-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const argument = (name, fallback = '') => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/prepare-production-pair.mjs --output ABS_EMPTY_DIRECTORY --optimization encoding-owner|wall-paint|workflow|representation-worker|history-endpoint|history-total|replay-encoding|content-equality|history-boundaries')
  console.log('Copies current tracked files and performance tools into two isolated repositories, reverse-checks/applies only the selected baseline patch, and runs the normal architecture/type/Vite build steps serially. The live workspace is never reverted. Dependencies are linked from the existing locked installation.')
  process.exit(0)
}
const output = argument('--output'), optimization = argument('--optimization')
check(output && path.isAbsolute(output) && output.startsWith(`${root}${path.sep}work${path.sep}`), 'Expected an isolated absolute --output under repository work/')
check(['encoding-owner', 'wall-paint', 'workflow', 'representation-worker', 'history-endpoint', 'history-total', 'replay-encoding', 'content-equality', 'history-boundaries'].includes(optimization), 'Choose an explicit optimization scope')
await fs.mkdir(output, { recursive: true })
check((await fs.readdir(output)).length === 0, 'Existing evidence will not be overwritten')
const record = { format: 'sceneweave-normal-production-pair-preparation', version: 1, status: 'running', optimization,
  startedAt: new Date().toISOString(), node: process.version, files: [], builds: [] }
const write = () => fs.writeFile(path.join(output, 'preparation.json'), JSON.stringify(record, null, 2))
await write()
async function collect(folder, prefix) {
  const files = []
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...await collect(path.join(folder, entry.name), file))
    else if (entry.isFile()) files.push(file)
  }
  return files
}
async function build(directory, side) {
  const log = await fs.open(path.join(output, `build-${side}.log`), 'wx')
  const commands = [['tools/check-architecture.mjs'], ['node_modules/typescript/bin/tsc', '-b'],
    ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.ai.json', '--noEmit'], ['node_modules/vite/bin/vite.js', 'build']]
  try {
    for (const command of commands) {
      console.log(`Normal build ${side}: ${command.join(' ')}`)
      const child = spawn(process.execPath, command, { cwd: directory, windowsHide: true, stdio: ['ignore', log.fd, log.fd] })
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
      check(code === 0, `Normal build failed (${side}): ${command.join(' ')}`)
    }
  } finally { await log.close() }
}
try {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const files = [...new Set([...tracked, ...await collect(path.join(root, 'tools/performance'), 'tools/performance')])].sort()
  for (const file of files) {
    check(!path.isAbsolute(file) && !file.split('/').includes('..'), 'Invalid tracked path')
    const bytes = await fs.readFile(path.join(root, file)); record.files.push({ path: file, sha256: sha(bytes), byteLength: bytes.length })
    for (const side of ['before', 'after']) { const target = path.join(output, side, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes, { flag: 'wx' }) }
  }
  record.sourceFingerprint = sha(JSON.stringify(record.files))
  record.patch = `tools/performance/baselines/${optimization}-${['workflow', 'representation-worker', 'history-endpoint', 'history-total', 'replay-encoding', 'content-equality', 'history-boundaries'].includes(optimization) ? '20261112' : '20261111'}.patch`
  record.patchSha256 = sha(await fs.readFile(path.join(root, record.patch)))
  for (const side of ['before', 'after']) {
    const directory = path.join(output, side)
    execFileSync('git', ['init', '--quiet'], { cwd: directory })
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: directory })
    await fs.symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  }
  const baseline = path.join(output, 'before'), patch = path.join(root, record.patch)
  execFileSync('git', ['apply', '--reverse', '--check', patch], { cwd: baseline })
  execFileSync('git', ['apply', '--reverse', patch], { cwd: baseline })
  if (optimization === 'encoding-owner') {
    // The new regression test calls the optimized bundle signature, which did
    // not exist before this patch. Preserve it outside the baseline source;
    // the current workspace and after-side test remain intact. No config or
    // production module is altered to bypass the normal type/build steps.
    record.baselineTestPreservation = 'src/platform/browser/storage/content-encoding-reuse.test.ts'
    await fs.rename(path.join(baseline, record.baselineTestPreservation), path.join(output, 'baseline-optimized-test.ts.txt'))
  }
  for (const side of ['before', 'after']) {
    await build(path.join(output, side), side); record.builds.push({ side, status: 'complete' }); await write()
  }
  for (const file of record.files) check(sha(await fs.readFile(path.join(root, file.path))) === file.sha256, `Workspace changed during capture: ${file.path}`)
  record.status = 'complete'
} catch (error) { record.status = 'failed'; record.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally { record.endedAt = new Date().toISOString(); await write() }
