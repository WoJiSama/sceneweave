import type { ProjectData } from '../model/project.js'
import { PACKAGE_LIMITS } from './limits.js'

/** Source hashes share the immutable byte port with raster assets. */
export function projectSourceRecords(project: Pick<ProjectData, 'authoringSources'>): Map<string, number> {
  const records = new Map<string, number>()
  let total = 0
  for (const source of Object.values(project.authoringSources)) {
    for (const [hash, size] of [[source.sourceSha256, source.sourceSizeBytes], [source.normalizedSha256, source.normalizedSizeBytes]] as const) {
      const previous = records.get(hash)
      if (previous !== undefined && previous !== size) throw new Error('同hash SVG源字节声明冲突。')
      if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(size) || size < 1 || size > PACKAGE_LIMITS.sourceBytes) throw new Error('SVG源hash或单件字节预算无效。')
      if (previous === undefined) { records.set(hash, size); total += size }
    }
  }
  if (records.size > PACKAGE_LIMITS.uniqueImages * 2 || total > PACKAGE_LIMITS.totalSourceBytes) throw new Error('SVG源累计超过32MiB保护预算。')
  return records
}

export function projectResourceRecords(project: Pick<ProjectData, 'assets' | 'authoringSources'>): Map<string, number> {
  const records = new Map(Object.entries(project.assets).map(([hash, record]) => [hash, record.sizeBytes]))
  for (const [hash, size] of projectSourceRecords(project)) {
    if (records.has(hash)) throw new Error('SVG源不能与图片共用资源hash。')
    records.set(hash, size)
  }
  return records
}

export const projectResourceHashes = (project: Pick<ProjectData, 'assets' | 'authoringSources'>): string[] => [...projectResourceRecords(project).keys()]
