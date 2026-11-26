import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(root, 'src')
const sourceRelative = path => relative(sourceRoot, path).replaceAll('\\', '/')
const allowedPackages = new Set(['zod', 'fflate', 'polygon-clipping'])
// This helper is shared by workspace and storage tests.
// Production modules must never acquire that dependency through the helper.
const testSupport = new Set(['application/workspace/test-fixtures'])
const files = []
async function walk(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, item.name)
    if (item.isDirectory()) await walk(path)
    else if (['.ts', '.tsx'].includes(extname(path)) && !/\.test\.tsx?$/.test(path)
      && !testSupport.has(sourceRelative(path).replace(/\.tsx?$/, ''))) files.push(path)
  }
}
for (const layer of ['shared', 'application']) await walk(resolve(sourceRoot, layer))

// Imports of types obey the same ownership boundary as runtime imports. Ports
// belong to their consumers; the browser composition root supplies adapters.
for (const path of files) {
  const layer = sourceRelative(path).split('/')[0]
  const syntax = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const inspect = specifier => {
    const targetPath = specifier.startsWith('.') ? sourceRelative(resolve(dirname(path), specifier)) : null
    if (targetPath && testSupport.has(targetPath.replace(/\.[jt]sx?$/, ''))) throw new Error(`生产模块不能依赖测试夹具：${relative(root, path)} → ${specifier}`)
    const target = targetPath?.split('/')[0]
    const valid = target ? target === 'shared' || layer === 'application' && target === 'application' : allowedPackages.has(specifier)
    if (!valid) throw new Error(`架构依赖越界：${relative(root, path)} → ${specifier}`)
  }
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) inspect(node.moduleSpecifier.text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) inspect(node.argument.literal.text)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error(`架构层不接受动态模块路径：${relative(root, path)}`)
      inspect(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
}
process.stdout.write(`共享/应用层依赖边界通过（${files.length} 个源码模块）。\n`)
