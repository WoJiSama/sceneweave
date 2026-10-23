import { describe, expect, it } from 'vitest'
import type { CatalogItemV1, CatalogOrganizationV1 } from './types'
import { EMPTY_CATALOG_FILTER_V1, matchesCatalogFilter } from './query'
const item: CatalogItemV1 = {
  identity: { namespace: 'origin', kind: 'prop', catalogId: 'camp-table', fixedVersion: 1, contentHash: 'hash', logicalKey: 'logical', key: 'exact' },
  selector: { kind: 'prop', definitionId: 'table' }, name: '营地 Table', publisherTags: ['室外', '家具'], widthMm: 1000, heightMm: 800,
  originLabel: '原创素材', licenseRefs: ['许可'], thumbnailAssetIds: [], visibility: 'public',
}
const organization: CatalogOrganizationV1 = { tags: ['ＮＰＣ 道具', '常用'], colors: ['棕', '蓝'], favorite: true }
describe('catalog filters', () => {
  it('normalizes fullwidth, case and whitespace without changing displayed tags', () => {
    expect(matchesCatalogFilter(item, organization, { ...EMPTY_CATALOG_FILTER_V1, query: '　ＴＡＢＬＥ   npc\t道具 ' })).toBe(true)
    expect(organization.tags[0]).toBe('ＮＰＣ 道具')
  })
  it('ORs values within kind, publisher and color facets, ANDs separate facets', () => {
    const filter = { ...EMPTY_CATALOG_FILTER_V1, kinds: ['material', 'prop'] as const, publisherTags: ['室内', '室外'], colors: ['红', '棕'] }
    expect(matchesCatalogFilter(item, organization, { ...filter, kinds: [...filter.kinds] })).toBe(true)
    expect(matchesCatalogFilter(item, organization, { ...filter, kinds: [...filter.kinds], favoriteOnly: true, query: '不存在' })).toBe(false)
  })
  it('explicitly distinguishes all and any personal tags', () => {
    const filter = { ...EMPTY_CATALOG_FILTER_V1, tags: ['npc 道具', '不存在'] }
    expect(matchesCatalogFilter(item, organization, filter)).toBe(false)
    expect(matchesCatalogFilter(item, organization, { ...filter, tagMatch: 'any' })).toBe(true)
  })
  it('does not treat publisher tags or unspecified organization as personal tags', () => {
    expect(matchesCatalogFilter(item, organization, { ...EMPTY_CATALOG_FILTER_V1, tags: ['家具'] })).toBe(false)
    expect(matchesCatalogFilter(item, undefined, { ...EMPTY_CATALOG_FILTER_V1, favoriteOnly: true })).toBe(false)
  })
})
