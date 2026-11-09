import { toBundle, type EditableProject } from '../../../application/workspace/project.js'
import type { AssetReviewContent } from '../../../shared/assets/review.js'
import { listCatalogItems, loadLibraryCapsule, prepareLibraryEntry } from '../../../shared/library/content.js'
import type { CatalogItem, CatalogSelector } from '../../../shared/library/types.js'
import type { ProjectData } from '../../../shared/model/project.js'
import { validateProjectBundle } from '../../../shared/project/resources.js'
import { projectResourceHashes } from '../../../shared/project/source-resources.js'
import { freezeJson } from '../../../shared/validation/json.js'
import { browserProjectValidation } from '../project-validation.js'

export interface ProjectAssetReviews {
  readonly items: readonly CatalogItem[]
  readonly content: readonly AssetReviewContent[]
}
const selectorKey = (selector: CatalogSelector) => JSON.stringify([selector.kind, selector.definitionId])
const fixedSelectors = (project: ProjectData): CatalogSelector[] => [
  ...Object.keys(project.document.propDefinitions).map(definitionId => ({ kind: 'prop' as const, definitionId })),
  ...Object.keys(project.document.materials).map(definitionId => ({ kind: 'material' as const, definitionId })),
  ...Object.keys(project.document.prefabDefinitions).map(definitionId => ({ kind: 'prefab' as const, definitionId })),
]

/** Explicit read-only preparation. A neutral, fully checked library capsule is
 * the authority for both resource hashes and fixed dependencies, including
 * retained source ancestors which are absent from display thumbnails. */
export async function prepareProjectAssetReviews(project: EditableProject, signal?: AbortSignal): Promise<ProjectAssetReviews> {
  signal?.throwIfAborted()
  const validation = { ...browserProjectValidation, signal }
  const bundle = await validateProjectBundle(toBundle(project), validation)
  signal?.throwIfAborted()
  const catalog = listCatalogItems(bundle), items: CatalogItem[] = [], content: AssetReviewContent[] = []
  const exactItems = new Map<string, CatalogItem>()
  for (const item of catalog) {
    signal?.throwIfAborted()
    const entry = await prepareLibraryEntry(bundle, item.selector, validation)
    if (entry.item.identity.key !== item.identity.key) throw new Error('素材审核准备中的确切目录身份发生变化。')
    const capsule = await loadLibraryCapsule(entry, validation)
    signal?.throwIfAborted()
    exactItems.set(selectorKey(item.selector), entry.item)
    const dependencyKeys = new Set<string>()
    for (const selector of fixedSelectors(capsule.project)) {
      signal?.throwIfAborted()
      if (selectorKey(selector) === selectorKey(item.selector)) continue
      const key = selectorKey(selector)
      let dependency = exactItems.get(key)
      if (!dependency) {
        // Internal retained definitions are real dependencies too. They may be
        // intentionally hidden from the project's display catalog.
        dependency = (await prepareLibraryEntry(bundle, selector, validation)).item
        exactItems.set(key, dependency)
      }
      dependencyKeys.add(dependency.identity.key)
    }
    items.push(entry.item)
    content.push({ catalogKey: entry.item.identity.key, resourceHashes: projectResourceHashes(capsule.project).sort(),
      dependencyKeys: [...dependencyKeys].sort() })
  }
  signal?.throwIfAborted()
  return freezeJson({ items, content })
}
