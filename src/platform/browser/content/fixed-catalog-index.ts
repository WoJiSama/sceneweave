import { fromBundle, type EditableProject } from '../../../application/workspace/project.js'
import { extractTemplateFixedContent, listCatalogMetadata } from '../../../shared/library/content.js'
import type { CatalogSelector } from '../../../shared/library/types.js'
import type { ProjectData } from '../../../shared/model/project.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { validation } from '../runtime.js'
import { loadFixedResources } from './load-resources.js'

function readOnce<T>(cache: Map<string, Promise<T>>, key: string, read: () => Promise<T>) {
  const cached = cache.get(key)
  if (cached) return cached
  const pending = read().catch(error => { cache.delete(key); throw error })
  cache.set(key, pending)
  return pending
}

function waitForItem<T>(pending: Promise<T>, signal?: AbortSignal) {
  if (!signal) return pending
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

export function createFixedCatalogIndex(template: ProjectData, paths: Record<string, string>) {
  const itemReads = new Map<string, Promise<EditableProject>>()
  const items = listCatalogMetadata(template)
  function loadItem(selector: CatalogSelector, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const pending = readOnce(itemReads, selector.kind + ':' + selector.definitionId, async () => {
      const project = extractTemplateFixedContent(template, [selector])
      const bytes = await loadFixedResources(project.assets, paths, {})
      return fromBundle({ project, resources: createMemoryResources(bytes) }, validation)
    })
    return waitForItem(pending, signal)
  }
  return { items, loadItem }
}
