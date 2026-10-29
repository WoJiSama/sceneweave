// Tool-only instrumentation. No application source or normal build is modified.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const diagnosticTargets = {
  'src/application/workspace/workspace.ts': ['execute', 'loadNamedSnapshot', 'createSnapshot', 'prepareRestore', 'applyRestore', 'createNamedSnapshot'],
  'src/application/workspace/prepare.ts': ['prepareCompositionCommands', 'materializeProject'],
  'src/application/workspace/project.ts': ['fromBundle', 'validateEditableProject', 'tryDeriveEditableProject'],
  'src/shared/appearance/commands.ts': ['applyCompositionDraftCommands'],
  'src/shared/visual/commands.ts': ['applyVisualCommand', 'visualCommandCost', 'inspectVisualChanges'],
  'src/shared/project/validate.ts': ['readProjectData', 'projectContentHash'],
  'src/shared/project/resources.ts': ['validateProjectBundles', 'tryDerivedProjectBundle', 'read', 'verifyBytes'],
  'src/shared/history/restore.ts': ['buildRestorePlan'],
  'src/platform/browser/storage/repository.ts': ['load', 'assembled', 'save', 'usageInTransaction', 'loadSnapshot', 'createSnapshot', 'checkProtection', 'assertSaved', 'putResources'],
  'src/platform/browser/images/adapter.ts': ['decode', 'transform', 'withDecodedRaster'],
  'src/platform/browser/ai/svg-raster.ts': ['rasterizeNormalizedSvg'],
  'src/platform/browser/render/renderer.ts': ['renderInternal'],
  'src/platform/browser/render/canvas-renderer.ts': ['decodeRequired', 'drawProjection', 'renderRasterProjection', 'encodePng'],
}

/** Installed by Playwright before navigating the isolated diagnostic page. */
export function installDiagnosticStageObserver() {
  let current = null
  const limit = 100_000
  Reflect.set(globalThis, '__sceneweaveDiagnosticStages', Object.freeze({
    start(kind, ordinal) {
      current = { kind, ordinal, startedAtMs: performance.now(), spans: [], open: new Set(), renderMetrics: [], dropped: 0 }
    },
    renderMetrics(metrics) { if (current) current.renderMetrics.push({ atMs: performance.now(), ...metrics }) },
    begin(name) {
      const owner = current
      if (!owner) return undefined
      if (owner.spans.length + owner.open.size >= limit) { owner.dropped++; return undefined }
      const span = { name, startMs: performance.now(), failed: false }
      owner.open.add(span)
      let ended = false
      return {
        value(value) { span.returnedValue = value !== undefined; return value },
        fail() { span.failed = true },
        end() {
          if (ended) return
          ended = true; span.endMs = performance.now(); owner.open.delete(span); owner.spans.push(span)
        },
      }
    },
    finish() {
      const owner = current
      if (!owner) throw new Error('No diagnostic stage window')
      current = null
      const endedAtMs = performance.now()
      return { kind: owner.kind, ordinal: owner.ordinal, startedAtMs: owner.startedAtMs, endedAtMs, dropped: owner.dropped,
        spans: owner.spans.map(span => ({ ...span })), renderMetrics: owner.renderMetrics,
        openAtEnd: [...owner.open].map(span => ({ ...span, clippedAtMs: endedAtMs })) }
    },
  }))
}

export async function buildDiagnosticStages(outputDirectory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  if (!outputDirectory || !path.isAbsolute(outputDirectory) || path.resolve(outputDirectory) === path.join(root, 'dist')) throw new Error('Use a separate absolute diagnostic output directory, never normal dist')
  try { if ((await fs.readdir(outputDirectory)).length) throw new Error('Diagnostic output must be empty') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const [{ build }, { default: ts }, { default: MagicString }] = await Promise.all([import('vite'), import('typescript'), import('magic-string')])
  const transformed = [], expected = new Set(Object.entries(diagnosticTargets).flatMap(([name, symbols]) => symbols.map(symbol => `${name}#${symbol}`)))
  await build({ configFile: path.join(root, 'vite.config.ts'), plugins: [{
    name: 'sceneweave-diagnostic-stages', enforce: 'pre',
    transform(code, id) {
      const name = path.relative(root, id.split('?')[0]).split(path.sep).join('/'), symbols = diagnosticTargets[name]
      if (!symbols) return null
      const source = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const edits = new MagicString(code), selected = []
      function symbol(node) {
        if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText(source).replace(/^['"]|['"]$/g, '')
        if (ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text
        return null
      }
      function visit(node) {
        const label = symbol(node)
        if (node.body && symbols.includes(label)) selected.push({ node, label })
        ts.forEachChild(node, visit)
      }
      visit(source)
      for (const { node, label } of selected) {
        const key = `${name}#${label}`, variable = '__swDiagnosticSpan', body = node.body
        if (!expected.delete(key)) throw new Error(`Unexpected duplicate diagnostic boundary ${key}`)
        transformed.push({ name, symbol: label, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 })
        const start = `const ${variable}=Reflect.get(globalThis,'__sceneweaveDiagnosticStages')?.begin(${JSON.stringify(key)});try{`
        const end = `}catch(__swDiagnosticError){${variable}?.fail();throw __swDiagnosticError}finally{${variable}?.end()}`
        const isAsync = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
        if (ts.isBlock(body)) {
          const renderMetrics = name.endsWith('/render/renderer.ts') && label === 'renderInternal'
            ? `const __swOriginalMetrics=options.onMetrics;options={...options,onMetrics:(metrics)=>{Reflect.get(globalThis,'__sceneweaveDiagnosticStages')?.renderMetrics(metrics);__swOriginalMetrics?.(metrics)}};` : ''
          edits.appendLeft(body.getStart(source) + 1, start + renderMetrics); edits.appendLeft(body.end - 1, end)
          // Await direct returned promises so async inclusive time ends on settlement.
          // The extra await/microtask overhead is part of this diagnostic only.
          function returns(child) {
            if (child !== body && ts.isFunctionLike(child)) return
            if (ts.isReturnStatement(child) && child.expression) {
              const expression = child.expression
              if (isAsync && !ts.isAwaitExpression(expression)) { edits.prependLeft(expression.getStart(source), 'await ('); edits.appendRight(expression.end, ')') }
              if (label === 'tryDerivedProjectBundle' || label === 'tryDeriveEditableProject') {
                edits.prependLeft(expression.getStart(source), `${variable} ? ${variable}.value(`)
                edits.appendRight(expression.end, `) : (${expression.getText(source)})`)
              }
            }
            ts.forEachChild(child, returns)
          }
          returns(body)
        } else {
          edits.prependLeft(body.getStart(source), `{${start}return (`); edits.appendRight(body.end, `);${end}}`)
        }
      }
      return { code: edits.toString(), map: edits.generateMap({ hires: true, source: id, includeContent: true }) }
    },
  }], build: { outDir: outputDirectory, emptyOutDir: false, sourcemap: true } })
  if (expected.size) throw new Error(`Missing diagnostic boundaries: ${[...expected].join(', ')}`)
  const sourceFiles = await Promise.all(Object.keys(diagnosticTargets).sort().map(async name => ({ name, sha256: createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex') })))
  const metadata = { format: 'sceneweave-diagnostic-stages', version: 1, builtAt: new Date().toISOString(), transformed, sourceFiles,
    limitations: ['Separate instrumented production UI build; never formal performance.', 'Function durations include awaited descendants and can overlap; do not sum nested stages.', 'Async direct returns await settlement; added microtasks and timers affect timing.', 'Raw spans contain code names and timestamps only; no document, resource bytes or credentials.', 'Open spans at window end are clipped, never reported as completed.'] }
  await fs.writeFile(path.join(outputDirectory, 'diagnostic-stages.json'), JSON.stringify(metadata, null, 2), { flag: 'wx' })
  return metadata
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--out-dir')
  const metadata = await buildDiagnosticStages(index < 0 ? null : process.argv[index + 1])
  console.log(`Diagnostic build: ${metadata.transformed.length} boundaries; normal source/dist unchanged`)
}
