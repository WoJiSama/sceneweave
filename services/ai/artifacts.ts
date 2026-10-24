import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A reserved private root; M2-1 has no endpoint capable of creating or serving artifacts. */
export class PrivateArtifacts {
  readonly root: string
  constructor(dataDir: string) {
    this.root = join(resolve(dataDir), 'artifacts')
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    if (lstatSync(this.root).isSymbolicLink() || !statSync(this.root).isDirectory()) throw new Error('Invalid private storage')
    chmodSync(this.root, 0o700)
  }
  removeTask(id: string) {
    if (!uuid.test(id)) throw new Error('Invalid task identity')
    rmSync(join(this.root, id), { recursive: true, force: true })
  }
  taskBytes(id: string) {
    if (!uuid.test(id)) throw new Error('Invalid task identity')
    return physicalBytes(join(this.root, id))
  }
  cleanOrphans(liveIds: ReadonlySet<string>) {
    for (const name of readdirSync(this.root)) if (!uuid.test(name) || !liveIds.has(name)) rmSync(join(this.root, name), { recursive: true, force: true })
  }
}
export function physicalBytes(path: string): number {
  if (!existsSync(path)) return 0
  const info = lstatSync(path)
  if (info.isSymbolicLink()) throw new Error('Invalid private storage')
  if (!info.isDirectory()) return info.size
  return readdirSync(path).reduce((total, entry) => total + physicalBytes(join(path, entry)), 0)
}
