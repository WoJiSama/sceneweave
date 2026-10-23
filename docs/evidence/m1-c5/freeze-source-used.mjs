import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = process.cwd(), files = {}
async function capture(relative) {
  const target = path.join(root, relative), stat = await fs.stat(target)
  if (stat.isDirectory()) {
    for (const name of (await fs.readdir(target)).sort()) await capture(path.join(relative, name))
  } else if (stat.isFile()) files[relative] = createHash('sha256').update(await fs.readFile(target)).digest('hex')
}
for (const relative of ['src', 'tests', 'tools', '.github', 'package.json', 'package-lock.json', 'index.html', '.nvmrc', 'playwright.config.ts', 'vite.config.ts', 'vite.performance.config.ts', 'tsconfig.json']) await capture(relative)
const frozen = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), version: JSON.parse(await fs.readFile('package.json', 'utf8')).version,
  capturedAt: new Date().toISOString(), files }
await fs.writeFile('work/c5-20261022/final-source-baseline.json', JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ files: Object.keys(files).length, head: frozen.head, version: frozen.version }))
