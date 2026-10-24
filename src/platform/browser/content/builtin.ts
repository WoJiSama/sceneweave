import data from './builtin-data.json'
import type { ProjectBundle, ProjectData } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { captureJson, freezeJson } from '../../../shared/validation/json.js'
import { createMemoryResources, validateProjectBundle, type VerifiedProjectBundle } from '../../../shared/project/resources.js'
import { listCatalogItems } from '../../../shared/library/content.js'
import { CATALOG_CURATION } from './curation.js'
import { loadFixedResources, type ContentLoadOptions } from './load-resources.js'
export { boundedResponseBytes } from './load-resources.js'
export type { ContentLoadProgress } from './load-resources.js'

// Frozen fixed content and resource locations only. No editor, legacy IO or persistence is imported.
const fixed = freezeJson(captureJson(data))
export function builtinIdentityAudit(bundle: ProjectBundle): { items: number; images: number; curations: number; refines: number } {
  const items = listCatalogItems(bundle), keys = new Set(items.map(item => item.identity.key)), refines = [...CATALOG_CURATION.values()].filter(item => item.refines)
  if (items.length !== 62 || keys.size !== 62 || CATALOG_CURATION.size !== 62 || refines.length !== 6 || Object.keys(bundle.project.assets).length !== 57
    || [...CATALOG_CURATION.keys()].some(key => !keys.has(key)) || refines.some(item => !keys.has(item.key) || !keys.has(item.refines!))) throw new Error('内置目录精确身份、62项补标或6项精修映射不一致。')
  return { items: items.length, images: Object.keys(bundle.project.assets).length, curations: CATALOG_CURATION.size, refines: refines.length }
}
/** Standalone complete-v1 provider. Every call captures and validates actual source image bytes. */
export async function loadBuiltinCatalog(validation: CompleteValidationOptions, onProgress?: ContentLoadOptions['onProgress']): Promise<VerifiedProjectBundle> {
  checkCancelled(validation.signal)
  const project = captureJson(fixed.project) as unknown as ProjectData
  if (Object.keys(fixed.paths).length !== Object.keys(project.assets).length) throw new Error('内置资源路径未精确覆盖固定内容。')
  const bytes = await loadFixedResources(project.assets, fixed.paths as Record<string, string>, {}, { signal: validation.signal, onProgress })
  checkCancelled(validation.signal)
  const bundle: ProjectBundle = { project, resources: createMemoryResources(bytes) }
  onProgress?.({ phase: 'validation', completed: 0, total: bytes.size })
  const verified = await validateProjectBundle(bundle, validation)
  checkCancelled(validation.signal); builtinIdentityAudit(verified)
  onProgress?.({ phase: 'validation', completed: bytes.size, total: bytes.size })
  checkCancelled(validation.signal)
  return verified
}
