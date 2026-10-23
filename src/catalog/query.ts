import type { CatalogItemV1, CatalogKindV1, CatalogOrganizationV1 } from './types'
import { normalizeCatalogText } from './organization'
import { CATALOG_CURATION_V1, catalogCurationFor, catalogReadonlyTags, type CatalogCurationIndexV1 } from './curation'

export interface CatalogFilterV1 {
  query: string
  kinds: CatalogKindV1[]
  /** Session-only readonly facet: publisher tags plus separately attributed exact-key app curation. */
  publisherTags: string[]
  tags: string[]
  tagMatch: 'all' | 'any'
  colors: string[]
  favoriteOnly: boolean
}
export const EMPTY_CATALOG_FILTER_V1: CatalogFilterV1 = {
  query: '', kinds: [], publisherTags: [], tags: [], tagMatch: 'all', colors: [], favoriteOnly: false,
}
/** A facet is OR, facets are AND; only the personal tag facet has an explicit ALL option. */
export function matchesCatalogFilter(item: CatalogItemV1, organization: CatalogOrganizationV1 | undefined, filter: CatalogFilterV1, curationIndex: CatalogCurationIndexV1 = CATALOG_CURATION_V1): boolean {
  const normalized = (values: readonly string[]) => values.map(normalizeCatalogText)
  const curation = catalogCurationFor(item, curationIndex)
  const tags = normalized(organization?.tags ?? []), publisherTags = normalized(catalogReadonlyTags(item, curationIndex))
  const query = normalizeCatalogText(filter.query).split(' ').filter(Boolean)
  const haystack = normalizeCatalogText([item.name, item.selector.definitionId, item.identity.catalogId, item.originLabel, ...item.publisherTags, ...(curation?.tags ?? []), ...(organization?.tags ?? [])].join(' '))
  return query.every(term => haystack.includes(term))
    && (!filter.kinds.length || filter.kinds.includes(item.identity.kind))
    && (!filter.publisherTags.length || normalized(filter.publisherTags).some(tag => publisherTags.includes(tag)))
    && (!filter.tags.length || (filter.tagMatch === 'all'
      ? normalized(filter.tags).every(tag => tags.includes(tag))
      : normalized(filter.tags).some(tag => tags.includes(tag))))
    && (!filter.colors.length || filter.colors.some(color => organization?.colors.some(value => value === color) || curation?.colors.some(value => value === color)))
    && (!filter.favoriteOnly || organization?.favorite === true)
}
export function filterCatalogItems(items: readonly CatalogItemV1[], organizations: Record<string, CatalogOrganizationV1>, filter: CatalogFilterV1, curationIndex: CatalogCurationIndexV1 = CATALOG_CURATION_V1): CatalogItemV1[] {
  return items.filter(item => matchesCatalogFilter(item, organizations[item.identity.key], filter, curationIndex))
}
