import data from './curation-data.json'
import { captureOwnedData } from '../io/v3/owned-data'
import { hasExactKeys } from '../io/v6/limits'
import { validateCatalogKey } from './metadata'
import { normalizeCatalogText } from './organization'
import { CATALOG_COLORS_V1, type CatalogColorV1, type CatalogItemV1 } from './types'

/** App-owned supplemental descriptions. They neither change publisher content nor enter personal library backups. */
export interface CatalogCurationV1 {
  key: string
  tags: readonly string[]
  colors: readonly CatalogColorV1[]
  refines?: string
}
export type CatalogCurationIndexV1 = ReadonlyMap<string, CatalogCurationV1>
export function validateCatalogCurationV1(input: unknown): CatalogCurationIndexV1 {
  const value = captureOwnedData(input)
  if (!hasExactKeys(value, ['format', 'version', 'records']) || value.format !== 'sceneweave-catalog-curation' || value.version !== 1
    || !Array.isArray(value.records) || value.records.length > 2048) throw new Error('目录补充描述版本或结构无效。')
  const result = new Map<string, CatalogCurationV1>()
  for (const record of value.records) {
    if (!hasExactKeys(record, ['key', 'tags', 'colors'], ['refines'])) throw new Error('目录补充描述字段无效。')
    const key = validateCatalogKey(record.key)
    if (result.has(key) || !Array.isArray(record.tags) || record.tags.length > 32 || !Array.isArray(record.colors) || record.colors.length > 8) throw new Error('目录补充描述重复或超过限额。')
    const normalized = new Set<string>()
    for (const tag of record.tags) {
      if (typeof tag !== 'string' || [...tag].length > 40 || /[\p{Cc}\p{Cf}]/u.test(tag)) throw new Error('目录补充标签无效。')
      const text = normalizeCatalogText(tag)
      if (!text || text.startsWith('sceneweave:') || normalized.has(text)) throw new Error('目录补充标签为空、重复或使用内部前缀。')
      normalized.add(text)
    }
    if (Array.from(record.colors).some(color => !(CATALOG_COLORS_V1 as readonly unknown[]).includes(color)) || new Set(record.colors).size !== record.colors.length) throw new Error('目录补充颜色无效。')
    const refines = Object.hasOwn(record, 'refines') ? validateCatalogKey(record.refines) : undefined
    if (refines === key) throw new Error('精修版不能引用自身。')
    result.set(key, Object.freeze({ key, tags: Object.freeze([...record.tags] as string[]), colors: Object.freeze([...record.colors] as CatalogColorV1[]), ...(refines ? { refines } : {}) }))
  }
  for (const record of result.values()) if (record.refines && !result.has(record.refines)) throw new Error('精修来源缺少确切目录补充记录。')
  return result
}
export const CATALOG_CURATION_V1 = validateCatalogCurationV1(data)
/** No logical-ID or image-hash fallback: a different content/version never receives a matching description. */
export function catalogCurationFor(item: CatalogItemV1, index: CatalogCurationIndexV1 = CATALOG_CURATION_V1): CatalogCurationV1 | undefined {
  const identity = item.identity, tuple = [1, identity.namespace, identity.kind, identity.catalogId, identity.fixedVersion]
  if (identity.logicalKey !== JSON.stringify(tuple) || identity.key !== JSON.stringify([...tuple, identity.contentHash])) return undefined
  const record = index.get(item.identity.key)
  return record?.key === item.identity.key ? record : undefined
}
export function catalogReadonlyTags(item: CatalogItemV1, index: CatalogCurationIndexV1 = CATALOG_CURATION_V1): string[] {
  return [...new Map([...item.publisherTags, ...(catalogCurationFor(item, index)?.tags ?? [])].map(tag => [normalizeCatalogText(tag), tag])).values()]
}
