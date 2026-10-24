import data from '../../../catalog/curation-data.json'
import { validateCatalogCuration, catalogCurationFor as findCuration } from '../../../shared/library/curation.js'
import type { CatalogCurationIndex } from '../../../shared/library/curation.js'
import type { CatalogItem } from '../../../shared/library/types.js'

export { validateCatalogCuration } from '../../../shared/library/curation.js'
export type { CatalogCuration, CatalogCurationIndex } from '../../../shared/library/curation.js'
export const CATALOG_CURATION: CatalogCurationIndex = validateCatalogCuration(data)
export function catalogCurationFor(item: CatalogItem, index: CatalogCurationIndex = CATALOG_CURATION) {
  return findCuration(item, index)
}
