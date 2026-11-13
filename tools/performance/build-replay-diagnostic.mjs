// Tool-only coarse counters. The original source and normal dist stay untouched.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import ts from 'typescript'
import MagicString from 'magic-string'
import { fingerprintPaths, assertFrozen, contentSha256 } from './frozen-input.mjs'

/** Installed once per diagnostic page/Worker realm, never a product proof. */
export function installReplayDiagnostic() {
  let stack = [], rows = new Map(), marks = new Map()
  const api = {
    reset() { if (stack.length) throw Error('Open replay diagnostic spans'); rows = new Map(); marks = new Map() },
    mark(name) { marks.set(name, (marks.get(name) ?? 0) + 1) },
    begin(name, size = 0) {
      const span = { name, start: performance.now(), children: 0 }, parent = stack.at(-1)
      stack.push(span)
      return { end() {
        if (stack.pop() !== span) throw Error('Non-synchronous replay diagnostic span')
        const ms = performance.now() - span.start
        if (parent) parent.children += ms
        const row = rows.get(name) ?? { name, count: 0, inclusiveMs: 0, selfMs: 0, inputSize: 0 }
        row.count++; row.inclusiveMs += ms; row.selfMs += ms - span.children; row.inputSize += size
        rows.set(name, row)
      } }
    },
    snapshot() { return { rows: [...rows.values()], marks: Object.fromEntries(marks), open: stack.length } },
  }
  Reflect.set(globalThis, '__sceneweaveReplayDiagnostic', Object.freeze(api))
}

const targets = {
  'src/shared/project/validate.ts': ['createProjectReplayValidator', 'validate', 'readProjectData', 'ownedJsonByteLength'],
  'src/shared/validation/json.ts': ['captureJson', 'inspectJsonInput', 'encodeUtf8'],
  'src/shared/validation/hash.ts': ['sha256Bytes'],
  'src/shared/validation/content.ts': ['certifyCompositionContent', 'readCompositionContent', 'tryCertifyPropReplayContent'],
  'src/shared/validation/snapshots.ts': ['validateFreshSceneSnapshot', 'tryValidatePropReplaySnapshot'],
  'src/shared/validation/scene.ts': ['validateSceneDocument'],
  'src/shared/geometry/geometry.ts': ['validateGeometry', 'validatePropMoveGeometry'],
  'src/shared/aggregates/scene-coordinates.ts': ['encodeProjectCoordinates', 'decodeProjectCoordinates', 'assertCoordinateRoundTrip'],
}
const optional = new Set(['tryCertifyPropReplayContent', 'tryValidatePropReplaySnapshot'])
const mark = name => `Reflect.get(globalThis,'__sceneweaveReplayDiagnostic')?.mark(${JSON.stringify(name)});`

export async function buildReplayDiagnostic(source, output) {
  if (![source, output].every(value => value && path.isAbsolute(value)) || output === path.join(source, 'dist')
    || output === source || output.startsWith(source + path.sep)) throw Error('Use an independent absolute diagnostic output')
  await fs.mkdir(output, { recursive: true })
  if ((await fs.readdir(output)).length) throw Error('Preserve old evidence; output must be empty')
  const frozen = await fingerprintPaths(source, ['src', 'public', 'assets', 'package.json', 'package-lock.json', 'vite.config.ts'])
  const expected = new Set()
  for (const [file, names] of Object.entries(targets)) {
    const code = await fs.readFile(path.join(source, file), 'utf8')
    for (const name of names) if (!optional.has(name) || code.includes(`function ${name}(`)) expected.add(`${file}#${name}`)
  }
  const transformed = [], seen = new Set(), branches = new Set()
  function plugin(role) {
    const localSeen = new Set()
    return { name: `sceneweave-replay-diagnostic-${role}`, enforce: 'pre', transform(code, id) {
      const relative = path.relative(source, id.split('?')[0]).split(path.sep).join('/')
      if (relative === 'src/platform/browser/storage/history-audit-worker.ts') {
        const needle = 'const result = await auditHistoryMessage(event.data)'
        if (!code.includes(needle)) throw Error('Unknown actual history Worker result boundary')
        return { code: code.replace(needle, `Reflect.get(globalThis,'__sceneweaveReplayDiagnostic')?.reset();${needle};
          console.log('SCENEWEAVE_REPLAY_DIAGNOSTIC '+JSON.stringify({realm:'worker',trace:Reflect.get(globalThis,'__sceneweaveReplayDiagnostic')?.snapshot(),documentBytes:result.documentBytes}))`), map: null }
      }
      if (!targets[relative]) return null
      // The normal build graph is preserved. Both main and Worker transforms
      // install their own realm-local counters through the common JSON module.
      if (relative === 'src/shared/project/validate.ts') {
        const replace = (needle, value, name) => {
          if (!code.includes(needle) || code.indexOf(needle) !== code.lastIndexOf(needle)) throw Error(`Missing/duplicate replay branch ${name}`)
          code = code.replace(needle, value); branches.add(`${role}:${name}`)
        }
        replace('const entry = entries.splice(index, 1)[0];', `${mark('replay.metadataHit')}const entry = entries.splice(index, 1)[0];`, 'metadataHit')
        if (code.includes('let derived: ProjectData | undefined')) {
          replace('const baseline = certifyCompositionContent(projectContent(previous))', `${mark('replay.finiteAttempt')}const baseline = certifyCompositionContent(projectContent(previous))`, 'finiteAttempt')
          replace('if (content) {', `if (content) {${mark('replay.finiteSuccess')}`, 'finiteSuccess')
          replace('if (!derived) completeMisses++', `if (!derived) {${mark('replay.full')}completeMisses++}`, 'full')
        } else replace('const project = freezeJson(readProjectData(captured, false, true))', `${mark('replay.full')}const project = freezeJson(readProjectData(captured, false, true))`, 'full')
      }
      const ast = ts.createSourceFile(relative, code, ts.ScriptTarget.Latest, true), edits = new MagicString(code)
      function visit(node) {
        const name = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name ? node.name.getText(ast)
          : ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(ast) : null
        const key = `${relative}#${name}`
        if (node.body && expected.has(key)) {
          if (node.modifiers?.some(value => value.kind === ts.SyntaxKind.AsyncKeyword)) throw Error(`Async diagnostic target ${key}`)
          const unique = `${role}:${key}`
          if (localSeen.has(unique)) throw Error(`Duplicate diagnostic target ${unique}`)
          localSeen.add(unique)
          seen.add(unique); transformed.push({ role, file: relative, name })
          const size = name === 'sha256Bytes' ? ',bytes.length' : name === 'encodeUtf8' ? ',text.length' : ''
          const start = `const __replaySpan=Reflect.get(globalThis,'__sceneweaveReplayDiagnostic')?.begin(${JSON.stringify(key)}${size});try{`
          const end = '}finally{__replaySpan?.end()}'
          if (ts.isBlock(node.body)) { edits.appendLeft(node.body.getStart(ast) + 1, start); edits.prependLeft(node.body.end - 1, end) }
          else { edits.prependLeft(node.body.getStart(ast), `{${start}return (`); edits.appendRight(node.body.end, `);${end}}`) }
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
      if (relative === 'src/shared/validation/json.ts') edits.prepend(`(${installReplayDiagnostic.toString()})();\n`)
      return { code: edits.toString(), map: null }
    } }
  }
  await build({ root: source, configFile: path.join(source, 'vite.config.ts'), plugins: [plugin('page')],
    worker: { plugins: () => [plugin('worker')] }, build: { outDir: output, emptyOutDir: false } })
  for (const key of expected) for (const role of ['page', 'worker']) if (!seen.has(`${role}:${key}`)) throw Error(`Missing ${role} target ${key}`)
  assertFrozen(frozen, await fingerprintPaths(source, ['src', 'public', 'assets', 'package.json', 'package-lock.json', 'vite.config.ts']), 'diagnostic source')
  const metadata = { format: 'sceneweave-replay-attribution-build', version: 1, source, builtAt: new Date().toISOString(), frozen,
    transformed, branches: [...branches], toolSha256: contentSha256(await fs.readFile(fileURLToPath(import.meta.url))),
    limitations: ['Explicit instrumented build only; no normal-performance conclusion.', 'Coarse synchronous counters/timers; self contains uninstrumented work, GC and scheduling.',
      'Page and Worker states are independent. Branch counts are observations, never validation evidence. No project/resource values are recorded.'] }
  await fs.writeFile(path.join(output, 'diagnostic-replay.json'), JSON.stringify(metadata, null, 2), { flag: 'wx' })
  return metadata
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), arg = key => args[args.indexOf(key) + 1]
  if (args.includes('--help')) console.log('node tools/performance/build-replay-diagnostic.mjs --source ABS_FROZEN --output ABS_NEW_DIST; isolated main/Worker coarse counters, attribution only')
  else { const metadata = await buildReplayDiagnostic(arg('--source'), arg('--output')); console.log(`Replay diagnostic built: ${metadata.transformed.length} coarse boundaries; no normal-source mutation`) }
}
