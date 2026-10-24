import { captureJson } from '../validation/json.js'
import { hasExactKeys } from '../project/limits.js'
import { validateCatalogKey } from './metadata.js'
import { normalizeCatalogText } from './organization.js'
import { CATALOG_COLORS, type CatalogColor, type CatalogItem } from './types.js'

/** App-owned supplemental descriptions. They neither change publisher content nor enter personal library backups. */
export interface CatalogCuration {
  key: string
  tags: readonly string[]
  colors: readonly CatalogColor[]
  refines?: string
}
export type CatalogCurationIndex = ReadonlyMap<string, CatalogCuration>
export function validateCatalogCuration(input: unknown): CatalogCurationIndex {
  const value = captureJson(input)
  if (!hasExactKeys(value, ['format', 'version', 'records']) || value.format !== 'sceneweave-catalog-curation' || value.version !== 1
    || !Array.isArray(value.records) || value.records.length > 2048) throw new Error('目录补充描述版本或结构无效。')
  const result = new Map<string, CatalogCuration>()
  for (const record of value.records) {
    if (!hasExactKeys(record, ['key', 'tags', 'colors', ...(record && typeof record === 'object' && Object.hasOwn(record, 'refines') ? ['refines'] : [])])) throw new Error('目录补充描述字段无效。')
    const key = validateCatalogKey(record.key)
    if (result.has(key) || !Array.isArray(record.tags) || record.tags.length > 32 || !Array.isArray(record.colors) || record.colors.length > 8) throw new Error('目录补充描述重复或超过限额。')
    const normalized = new Set<string>()
    for (const tag of record.tags) {
      if (typeof tag !== 'string' || [...tag].length > 40 || /[\p{Cc}\p{Cf}]/u.test(tag)) throw new Error('目录补充标签无效。')
      const text = normalizeCatalogText(tag)
      if (!text || text.startsWith('sceneweave:') || normalized.has(text)) throw new Error('目录补充标签为空、重复或使用内部前缀。')
      normalized.add(text)
    }
    if (Array.from(record.colors).some(color => !(CATALOG_COLORS as readonly unknown[]).includes(color)) || new Set(record.colors).size !== record.colors.length) throw new Error('目录补充颜色无效。')
    const refines = Object.hasOwn(record, 'refines') ? validateCatalogKey(record.refines) : undefined
    if (refines === key) throw new Error('精修版不能引用自身。')
    result.set(key, Object.freeze({ key, tags: Object.freeze([...record.tags] as string[]), colors: Object.freeze([...record.colors] as CatalogColor[]), ...(refines ? { refines } : {}) }))
  }
  for (const record of result.values()) if (record.refines && !result.has(record.refines)) throw new Error('精修来源缺少确切目录补充记录。')
  return result
}
const EMPTY_CURATION: CatalogCurationIndex = new Map()
/** No logical-ID or image-hash fallback: a different content/version never receives a matching description. */
export function catalogCurationFor(item: CatalogItem, index: CatalogCurationIndex = EMPTY_CURATION): CatalogCuration | undefined {
  const identity = item.identity, tuple = [1, identity.namespace, identity.kind, identity.catalogId, identity.fixedVersion]
  if (identity.logicalKey !== JSON.stringify(tuple) || identity.key !== JSON.stringify([...tuple, identity.contentHash])) return undefined
  const record = index.get(item.identity.key)
  return record?.key === item.identity.key ? record : undefined
}
export function catalogReadonlyTags(item: CatalogItem, index: CatalogCurationIndex = EMPTY_CURATION): string[] {
  return [...new Map([...item.publisherTags, ...(catalogCurationFor(item, index)?.tags ?? [])].map(tag => [normalizeCatalogText(tag), tag])).values()]
}
