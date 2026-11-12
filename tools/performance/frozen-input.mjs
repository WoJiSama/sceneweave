import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const contentSha256 = bytes => createHash('sha256').update(bytes).digest('hex')
/** Only explicit roots; never traverses dependencies, junctions or user data. */
export async function fingerprintPaths(root, paths) {
  const rows = []
  async function visit(relative) {
    const file = path.resolve(root, relative)
    if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Fingerprint path escapes its declared root')
    const stat = await fs.lstat(file)
    if (stat.isSymbolicLink()) throw new Error(`Fingerprint cannot follow a symbolic link: ${relative}`)
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort()) await visit(path.posix.join(relative.replaceAll('\\', '/'), name))
    } else if (stat.isFile()) {
      const bytes = await fs.readFile(file); rows.push({ path: relative.replaceAll('\\', '/'), byteLength: bytes.length, sha256: contentSha256(bytes) })
    }
  }
  for (const relative of paths) await visit(relative)
  return rows.sort((a, b) => a.path.localeCompare(b.path))
}
export const MODULE_SOURCE_PATHS = ['src', 'public', 'assets', 'package.json', 'package-lock.json', 'vite.config.ts', 'tools/testing', 'tools/harness']
export function assertFrozen(expected, actual, label) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Frozen ${label} drift; retained run cannot be treated as valid performance evidence`)
}
