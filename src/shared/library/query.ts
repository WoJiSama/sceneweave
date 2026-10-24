import type { CatalogItem, CatalogKind, CatalogOrganization } from './types.js'
import { normalizeCatalogText } from './organization.js'
import { catalogCurationFor, catalogReadonlyTags, type CatalogCurationIndex } from './curation.js'

export interface CatalogFilter {
  query: string
  kinds: CatalogKind[]
  /** Session-only readonly facet: publisher tags plus separately attributed exact-key app curation. */
  publisherTags: string[]
  tags: string[]
  tagMatch: 'all' | 'any'
  colors: string[]
  favoriteOnly: boolean
}
export const EMPTY_CATALOG_FILTER: CatalogFilter = {
  query: '', kinds: [], publisherTags: [], tags: [], tagMatch: 'all', colors: [], favoriteOnly: false,
}
/** A facet is OR, facets are AND; only the personal tag facet has an explicit ALL option. */
export function matchesCatalogFilter(item: CatalogItem, organization: CatalogOrganization | undefined, filter: CatalogFilter, curationIndex: CatalogCurationIndex = new Map()): boolean {
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
export function filterCatalogItems(items: readonly CatalogItem[], organizations: Record<string, CatalogOrganization>, filter: CatalogFilter, curationIndex: CatalogCurationIndex = new Map()): CatalogItem[] {
  return items.filter(item => matchesCatalogFilter(item, organizations[item.identity.key], filter, curationIndex))
}
