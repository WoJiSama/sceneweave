import { describe, expect, it } from 'vitest'
import { catalogCurationFor, catalogReadonlyTags, validateCatalogCurationV1 } from './curation'
import { EMPTY_CATALOG_FILTER_V1, matchesCatalogFilter } from './query'
import type { CatalogItemV1 } from './types'

const namespace = 'a'.repeat(64), hash = 'b'.repeat(64), tuple = [1, namespace, 'prop', 'prop.sw.tree-broadleaf', 1]
const key = JSON.stringify([...tuple, hash]), otherKey = JSON.stringify([...tuple, 'c'.repeat(64)])
const item: CatalogItemV1 = { identity: { namespace, kind: 'prop', catalogId: 'prop.sw.tree-broadleaf', fixedVersion: 1, contentHash: hash, logicalKey: JSON.stringify(tuple), key },
  selector: { kind: 'prop', definitionId: 'b3-p-01' }, name: '阔叶树冠', publisherTags: ['原创'], widthMm: 4000, heightMm: 4000,
  originLabel: '项目原创', licenseRefs: ['MIT'], thumbnailAssetIds: [], visibility: 'public' }
const input = () => ({ format: 'sceneweave-catalog-curation', version: 1, records: [{ key, tags: ['室外', '植被'], colors: ['绿'] }] })
describe('readonly exact-identity catalog descriptions', () => {
  it('matches the full fixed key only and does not rewrite fixed metadata or personal organization', () => {
    const index = validateCatalogCurationV1(input()), before = structuredClone(item)
    expect(catalogCurationFor(item, index)?.tags).toEqual(['室外', '植被'])
    expect(catalogReadonlyTags(item, index)).toEqual(['原创', '室外', '植被'])
    const changed = structuredClone(item); changed.identity.key = otherKey; changed.identity.contentHash = 'c'.repeat(64)
    expect(catalogCurationFor(changed, index)).toBeUndefined()
    const forged = structuredClone(item); forged.identity.catalogId = 'prop.sw.different'
    expect(catalogCurationFor(forged, index)).toBeUndefined()
    expect(item).toEqual(before)
  })
  it('adds searchable readonly tags and manual colors but keeps personal tag and favorite semantics', () => {
    const index = validateCatalogCurationV1(input())
    expect(matchesCatalogFilter(item, undefined, { ...EMPTY_CATALOG_FILTER_V1, query: '植被', publisherTags: ['室外'], colors: ['绿'] }, index)).toBe(true)
    expect(matchesCatalogFilter(item, undefined, { ...EMPTY_CATALOG_FILTER_V1, tags: ['植被'] }, index)).toBe(false)
    expect(matchesCatalogFilter(item, undefined, { ...EMPTY_CATALOG_FILTER_V1, favoriteOnly: true }, index)).toBe(false)
    expect(matchesCatalogFilter(item, { tags: [], colors: ['红'], favorite: false }, { ...EMPTY_CATALOG_FILTER_V1, colors: ['红'] }, index)).toBe(true)
  })
  it('rejects ambiguous, malformed or hidden metadata and independently freezes displayed descriptions', () => {
    expect(() => validateCatalogCurationV1({ ...input(), version: 2 })).toThrow()
    expect(() => validateCatalogCurationV1({ ...input(), records: [...input().records, ...input().records] })).toThrow()
    expect(() => validateCatalogCurationV1({ ...input(), records: [{ ...input().records[0], tags: ['sceneweave:internal'] }] })).toThrow()
    expect(() => validateCatalogCurationV1({ ...input(), records: [{ ...input().records[0], colors: ['银'] }] })).toThrow()
    const draft = input(), index = validateCatalogCurationV1(draft); draft.records[0].tags[0] = '已修改'
    expect(index.get(key)?.tags).toEqual(['室外', '植被'])
    expect(Object.isFrozen(index.get(key)?.tags)).toBe(true)
  })
})
