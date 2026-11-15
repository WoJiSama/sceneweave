import ts from 'typescript'
import MagicString from 'magic-string'

export const coldSaveTargets = {
  'src/platform/browser/storage/storage-audit.ts': ['capture', 'confirm'],
  'src/platform/browser/storage/repository.ts': ['prepareAccounting', 'auditCapturedTotals', 'rowCost', 'putResources', 'addCurrent'],
  'src/platform/browser/storage/content-context.ts': ['prepareEncodedSnapshot'],
  'src/platform/browser/storage/content-blocks.ts': ['checkedContentBlock', 'parseContentBlock', 'assembleProjectContent'],
  'src/platform/browser/storage/history-audit-client.ts': ['auditCapturedHistoryInWorker'],
  'src/platform/browser/storage/history-audit-message.ts': ['auditHistoryMessage'],
  'src/platform/browser/storage/history-records.ts': ['auditHistoryRecords', 'rebuildFromMap', 'readCheckpoint'],
  'src/shared/project/validate.ts': ['readProjectData'],
  'src/shared/project/delta.ts': ['capture', 'apply'],
  'src/shared/validation/hash.ts': ['sha256Bytes'],
}

export function installColdSaveDiagnostic() {
  let active = null
  Reflect.set(globalThis, '__sceneweaveColdSave', {
    reset() { if (active) throw Error('Cold diagnostic already active'); active = { functions: {}, captures: [], native: {} } },
    call(name, run, bytes) {
      if (!active) return run()
      const owner = active, start = performance.now()
      const finish = () => {
        const row = owner.functions[name] ??= { count: 0, inclusiveMs: 0, maxMs: 0, inputBytes: 0 }
        const ms = performance.now() - start; row.count++; row.inclusiveMs += ms; row.maxMs = Math.max(row.maxMs, ms)
        if (Number.isSafeInteger(bytes)) row.inputBytes += bytes
      }
      try { const value = run(); if (value && typeof value.then === 'function') return value.then(v => { finish(); return v }, e => { finish(); throw e }); finish(); return value }
      catch (error) { finish(); throw error }
    },
    capture(rows) {
      if (!active) return
      if (!rows) { active.captures.push({ overflow: true }); return }
      active.captures.push({ overflow: false, tables: [...rows].map(([table, values]) => ({ table, rows: values.length,
        binaryBytes: values.reduce((n, row) => n + (row?.bytes instanceof Uint8Array ? row.bytes.length : 0), 0) })) })
    },
    native(name, ms) {
      if (!active) return
      const row = active.native[name] ??= { count: 0, inclusiveMs: 0, maxMs: 0 }
      row.count++; row.inclusiveMs += ms; row.maxMs = Math.max(row.maxMs, ms)
    },
    finish() { if (!active) throw Error('Cold diagnostic inactive'); const result = active; active = null; return result },
  })
}

export function instrumentColdSave(input, file) {
  const names = coldSaveTargets[file]; if (!names) throw Error(`Unknown cold boundary file ${file}`)
  let code = input
  if (file.endsWith('/storage-audit.ts')) {
    const boundary = '  if (!rows) return'
    if (code.split(boundary).length !== 2) throw Error('Cold capture boundary drift')
    code = code.replace(boundary, "  Reflect.get(globalThis, '__sceneweaveColdSave').capture(rows);\n" + boundary)
  }
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true), edits = new MagicString(code), seen = new Set()
  function visit(node) {
    const name = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name ? node.name.getText(ast)
      : ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(ast) : null
    if (node.body && names.includes(name)) {
      if (seen.has(name) || !ts.isBlock(node.body)) throw Error(`Ambiguous cold boundary ${file}#${name}`)
      seen.add(name)
      const async = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''
      const bytes = name === 'sha256Bytes' ? ', bytes.length' : ''
      edits.appendLeft(node.body.getStart(ast) + 1, `return Reflect.get(globalThis,'__sceneweaveColdSave').call('${file.split('/').at(-1)}#${name}',${async}()=>{`)
      edits.prependLeft(node.body.end - 1, `}${bytes});`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const name of names) if (!seen.has(name)) throw Error(`Missing cold boundary ${file}#${name}`)
  return `if(!Reflect.get(globalThis,'__sceneweaveColdSave'))(${installColdSaveDiagnostic.toString()})();\n` + edits.toString()
}

export function instrumentColdWorker(code) {
  const boundary = 'const result = await auditHistoryMessage(event.data)'
  if (code.split(boundary).length !== 2) throw Error('Cold Worker boundary drift')
  return code.replace(boundary, `const __cold=Reflect.get(globalThis,'__sceneweaveColdSave');__cold.reset();\n${boundary}\nconsole.log('SCENEWEAVE_COLD_WORKER '+JSON.stringify(__cold.finish()))`)
}
