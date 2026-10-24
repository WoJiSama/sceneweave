import { importMigrationSet, type MigrationSetFiles } from '../../shared/migration/set.js'
import type { MigrationScope } from '../../shared/migration/types.js'
import { MIGRATION_SET_LIMITS } from '../../shared/migration/set-limits.js'
import { checkCancelled, type ResourceOptions } from '../../shared/ports/resources.js'
import { parseBoundedJson } from '../../shared/project/json.js'

export const PRESERVATION_SELECTION_LIMITS = Object.freeze({
  indexBytes: MIGRATION_SET_LIMITS.indexBytes,
  volumeBytes: MIGRATION_SET_LIMITS.compressedBytes,
  volumes: MIGRATION_SET_LIMITS.volumes,
  totalBytes: 512 * 1024 * 1024,
})
export interface ReadPreservationResult { files: MigrationSetFiles; scope: MigrationScope }
const volumeName = /^part-(?:0[0-4][0-9]{2}|050[0-9]|051[01])\.sceneweave-migration-part$/

/** Read exactly one index and every declared original-name volume, then validate
 * their actual bytes, archive structure, hashes and complete reconstruction.
 */
export async function readPreservationFiles(input: FileList | readonly File[] | null, options: ResourceOptions = {}): Promise<ReadPreservationResult> {
  checkCancelled(options.signal)
  if (!input || input.length < 1 || input.length > PRESERVATION_SELECTION_LIMITS.volumes + 1) throw new Error('请选择一个保全索引和至多512个完整分卷。')
  const selected = Array.from(input), names = new Set<string>()
  let index: File | undefined, total = 0
  const volumes: File[] = []
  for (const file of selected) {
    if (!(file instanceof File) || !file.name || file.name.length > 512 || /[\0/\\]/.test(file.name) || names.has(file.name)) throw new Error('保全文件包含重复、无效名称或额外文件。')
    names.add(file.name)
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('保全文件为空或实际大小无效。')
    if (file.name.endsWith('.sceneweave-migration.json')) {
      if (index || file.size > PRESERVATION_SELECTION_LIMITS.indexBytes) throw new Error('须选择唯一索引，且索引不得超过16MiB。')
      index = file
    } else {
      if (!volumeName.test(file.name) || file.size > PRESERVATION_SELECTION_LIMITS.volumeBytes) throw new Error('包含额外文件、无效分卷名称或超过33MiB的分卷。')
      volumes.push(file)
    }
    total += file.size
    if (total > PRESERVATION_SELECTION_LIMITS.totalBytes) throw new Error('所选保全文件累计超过512MiB。')
  }
  if (!index) throw new Error('缺少唯一完整保全索引。')
  const read = async (file: File) => {
    checkCancelled(options.signal)
    const bytes = new Uint8Array(await file.arrayBuffer())
    checkCancelled(options.signal)
    if (bytes.length !== file.size) throw new Error('保全文件读取长度与实际大小不符。')
    return bytes
  }
  const files: MigrationSetFiles = { index: await read(index), volumes: new Map() }
  const header = parseBoundedJson(files.index) as { volumes?: unknown }
  if (!header || !Array.isArray(header.volumes) || header.volumes.length > PRESERVATION_SELECTION_LIMITS.volumes) throw new Error('保全索引缺少合法分卷列表。')
  const declared = header.volumes.map(value => value && typeof value === 'object' && !Array.isArray(value) ? (value as { path?: unknown }).path : undefined)
  if (declared.some(name => typeof name !== 'string' || !volumeName.test(name)) || new Set(declared).size !== declared.length
    || declared.length !== volumes.length || volumes.some(file => !declared.includes(file.name))) throw new Error('请选择索引声明的全部同名分卷，不接受额外、重复或缺失文件。')
  for (const file of volumes) files.volumes.set(file.name, await read(file))
  const recovered = await importMigrationSet(files.index, files.volumes, options.signal)
  checkCancelled(options.signal)
  return { files, scope: recovered.manifest.scope }
}
