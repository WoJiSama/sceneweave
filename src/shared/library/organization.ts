import { captureJson } from '../validation/json.js'
import { CATALOG_COLORS, LIBRARY_LIMITS, type CatalogOrganization } from './types.js'

/** Search/comparison form only; persisted labels retain their original display text. */
export function normalizeCatalogText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

export function validateCatalogOrganization(input: unknown): CatalogOrganization {
  const value = captureJson(input)
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 3 || !['tags', 'colors', 'favorite'].every(key => Object.hasOwn(value, key))) throw new Error('个人整理字段无效。')
  const { tags, colors, favorite } = value as Record<string, unknown>
  if (!Array.isArray(tags) || tags.length > LIBRARY_LIMITS.tags || !Array.isArray(colors) || colors.length > LIBRARY_LIMITS.colors || typeof favorite !== 'boolean') throw new Error('个人整理超过标签/颜色限额或字段类型无效。')
  const seen = new Set<string>()
  for (const tag of tags) {
    if (typeof tag !== 'string' || [...tag].length > LIBRARY_LIMITS.tagCodePoints || /[\p{Cc}\p{Cf}]/u.test(tag)) throw new Error('个人标签必须是至多40个码点且不含控制字符的文字。')
    const normalized = normalizeCatalogText(tag)
    if (!normalized || normalized.startsWith('sceneweave:') || seen.has(normalized)) throw new Error('个人标签为空、重复或使用了内部保留前缀。')
    seen.add(normalized)
  }
  if (Array.from(colors).some(color => typeof color !== 'string' || !(CATALOG_COLORS as readonly string[]).includes(color)) || new Set(colors).size !== colors.length) throw new Error('个人颜色必须从首批12色中选择且不能重复。')
  return { tags: [...tags] as string[], colors: [...colors] as CatalogOrganization['colors'], favorite }
}
