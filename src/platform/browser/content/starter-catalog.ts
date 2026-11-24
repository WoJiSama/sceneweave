import catalog from 'virtual:sceneweave-starter-catalog'
import { fromVerifiedBundle, toBundle, type EditableProject } from '../../../application/workspace/project.js'
import { adoptLibraryEntries, prepareLibraryEntry } from '../../../shared/library/content.js'
import type { CatalogSelector } from '../../../shared/library/types.js'
import type { CompositionCommand } from '../../../shared/model/appearance.js'
import type { SceneDocument, SurfaceStyle, VersionRef } from '../../../shared/model/scene.js'
import { validation } from '../runtime.js'
import { createFixedCatalogIndex } from './fixed-catalog-index.js'

// Only this optional module imports the fixed index. Project files always carry
// the actual bytes and licenses of every definition they reference.
export const { items, loadItem } = createFixedCatalogIndex(catalog.project, catalog.paths)
const collections = { prop: 'propDefinitions', material: 'materials', prefab: 'prefabDefinitions' } as const

/** Tool selectors may show these choices before the picture is needed. This
 * document is for form inputs only, never for rendering, saving, or AI grants. */
export function toolChoices(scene: SceneDocument): SceneDocument {
  const fixed = catalog.project.document
  return { ...scene, materials: { ...fixed.materials, ...scene.materials },
    propDefinitions: { ...fixed.propDefinitions, ...scene.propDefinitions } }
}

export async function withItems(base: EditableProject, selectors: readonly CatalogSelector[], signal?: AbortSignal) {
  signal?.throwIfAborted()
  const missing = new Map<string, CatalogSelector>()
  for (const selector of selectors) {
    const collection = collections[selector.kind]
    if (!Object.hasOwn(base.document[collection], selector.definitionId) && Object.hasOwn(catalog.project.document[collection], selector.definitionId)) {
      missing.set(selector.kind + ':' + selector.definitionId, selector)
    }
  }
  if (!missing.size) return base
  const entries = []
  for (const selector of missing.values()) {
    signal?.throwIfAborted()
    const source = await loadItem(selector, signal)
    entries.push(await prepareLibraryEntry(toBundle(source), selector, { ...validation, signal }))
  }
  const merged = await adoptLibraryEntries(toBundle(base), entries, { ...validation, signal })
  return fromVerifiedBundle(merged.bundle, { signal })
}

export function forCommands(base: EditableProject, commands: readonly CompositionCommand[], signal?: AbortSignal) {
  const selectors: CatalogSelector[] = []
  const add = (kind: CatalogSelector['kind'], ref?: VersionRef | null) => {
    if (ref) selectors.push({ kind, definitionId: ref.id })
  }
  const surface = (style?: SurfaceStyle | null) => {
    if (!style) return
    add('material', style.base.materialRef)
    for (const overlay of style.overlays) add('material', overlay.paint.materialRef)
  }
  for (const command of commands) {
    if ('materialRef' in command) add('material', command.materialRef)
    if ('surfaceStyle' in command) surface(command.surfaceStyle)
    if (command.type === 'setVisualSurface') surface(command.style)
    if (command.type === 'paintSurfaceMaterial') add('material', command.paint.materialRef)
    if ('changes' in command && 'surfaceStyle' in command.changes) surface(command.changes.surfaceStyle)
    if (command.type === 'createDecorationCluster' || command.type === 'paintSurfaceVegetation') {
      for (const row of command.palette) add('prop', row.definitionRef)
    }
    if (command.type === 'createCanopyRegion') add('prop', command.definitionRef)
    if (command.type === 'createScatter' || command.type === 'configureScatter') {
      for (const entry of (command.type === 'createScatter' ? command.palette : command.changes.palette) ?? []) add('prop', entry.propDefinitionRef)
    }
    if (command.type === 'instantiatePrefab') add('prefab', command.definitionRef)
    if (command.type === 'addProp' || command.type === 'replacePropAppearance') add('prop', command.definitionRef)
  }
  return withItems(base, selectors, signal)
}
