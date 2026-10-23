import { captureOwnedData } from '../io/v3/owned-data'
import { hasExactKeys, isSha256 } from '../io/v6/limits'
import type { CatalogItemV1 } from './types'

export function validateCatalogKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('素材精确身份键无效。')
  let tuple: unknown
  try { tuple = JSON.parse(value) } catch { throw new Error('素材精确身份键无效。') }
  if (!Array.isArray(tuple) || tuple.length !== 6 || tuple[0] !== 1 || !isSha256(tuple[1]) || !['prop', 'material', 'prefab'].includes(tuple[2])
    || typeof tuple[3] !== 'string' || !tuple[3] || tuple[3].length > 1024 || !Number.isSafeInteger(tuple[4]) || tuple[4] < 1 || !isSha256(tuple[5])
    || JSON.stringify(tuple) !== value) throw new Error('素材精确身份键无效。')
  return value
}

/** Metadata-only checks for listing; load/put separately validate all native capsule bytes. */
export function validateCatalogItemV1(input: unknown): CatalogItemV1 {
  const value = captureOwnedData(input)
  if (!hasExactKeys(value, ['identity', 'selector', 'name', 'publisherTags', 'widthMm', 'heightMm', 'originLabel', 'licenseRefs', 'thumbnailAssetIds', 'visibility'])) throw new Error('素材目录条目字段无效。')
  const identity = value.identity, selector = value.selector
  if (!hasExactKeys(identity, ['namespace', 'kind', 'catalogId', 'fixedVersion', 'contentHash', 'logicalKey', 'key'])
    || !hasExactKeys(selector, ['kind', 'definitionId'])) throw new Error('素材固定身份字段无效。')
  const key = validateCatalogKey(identity.key), tuple = JSON.parse(key) as unknown[]
  if (identity.namespace !== tuple[1] || identity.kind !== tuple[2] || identity.catalogId !== tuple[3] || identity.fixedVersion !== tuple[4] || identity.contentHash !== tuple[5]
    || identity.logicalKey !== JSON.stringify(tuple.slice(0, 5)) || selector.kind !== identity.kind || typeof selector.definitionId !== 'string' || !selector.definitionId || selector.definitionId.length > 1024) throw new Error('素材目录身份与精确键不一致。')
  const text = (value: unknown, max: number, nonempty = false): value is string => typeof value === 'string' && value.length <= max && (!nonempty || value.length > 0)
  const strings = (value: unknown, max: number, length: number) => Array.isArray(value) && value.length <= max && Array.from(value).every(item => text(item, length, true))
  if (!text(value.name, 1024, true) || !text(value.originLabel, 8192) || !strings(value.publisherTags, 256, 256) || !strings(value.licenseRefs, 512, 1024) || !strings(value.thumbnailAssetIds, 512, 1024)
    || typeof value.widthMm !== 'number' || !Number.isFinite(value.widthMm) || value.widthMm < 0 || typeof value.heightMm !== 'number' || !Number.isFinite(value.heightMm) || value.heightMm < 0
    || !['public', 'gm'].includes(value.visibility as string)) throw new Error('素材目录展示元数据无效。')
  return value as unknown as CatalogItemV1
}
