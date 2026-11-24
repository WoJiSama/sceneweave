import type { FixedDownloadManifest } from '../src/platform/browser/content/fixed-download-manifest.js'
import { extractTemplateFixedContent } from '../src/shared/library/content.js'
import type { ProjectData } from '../src/shared/model/project.js'

/** Ship names and image dependencies in the picker, leaving full scene definitions in their tool modules. */
export function fixedDownloadManifest(projects: ProjectData[], paths: Record<string, string>): FixedDownloadManifest {
  const result: FixedDownloadManifest = { items: [], assets: {}, paths: {} }
  const seen = new Set<string>()
  for (const project of projects) {
    for (const [kind, collection] of [['material', 'materials'], ['prop', 'propDefinitions'], ['prefab', 'prefabDefinitions']] as const) {
      const definitions: { id: string; name: string; tags: string[] }[] = Object.values(project.document[collection])
      for (const definition of definitions) {
        const id = kind + ':' + definition.id
        if (seen.has(id) || definition.tags.some(tag => tag.startsWith('sceneweave:'))) continue
        const closure = extractTemplateFixedContent(project, [{ kind, definitionId: definition.id }])
        const hashes = Object.keys(closure.assets).filter(hash => Object.hasOwn(paths, hash))
        if (!hashes.length) continue // Embedded sample artwork has no separate download.
        seen.add(id)
        result.items.push({ id, kind, name: definition.name, hashes })
        for (const hash of hashes) {
          result.assets[hash] = closure.assets[hash]
          result.paths[hash] = paths[hash]
        }
      }
    }
  }
  for (const hash of Object.keys(paths)) {
    if (!result.assets[hash]) throw new Error('Missing download entry for ' + paths[hash])
  }
  return result
}
