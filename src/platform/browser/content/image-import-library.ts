import type { ProjectBundle } from '../../../shared/model/project.js'
import type { CompleteValidationOptions, ResourceOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { prepareLibraryEntries } from '../../../shared/library/content.js'
import { LIBRARY_LIMITS, type CatalogSelector, type LibraryMutation, type LibrarySnapshot, type PreparedLibraryEntry } from '../../../shared/library/types.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { id as idSchema } from '../../../shared/validation/primitives.js'
import { libraryRepository, projectRepository, validation } from '../runtime.js'

export interface ImageImportLibraryResult {
  savedCount: number
  existingCount: number
  entryKeys: string[]
}
export interface ImageImportLibraryStores {
  projects: { load(sceneId: string, options?: ResourceOptions): Promise<ProjectBundle | null> }
  library: {
    read(options?: ResourceOptions): Promise<LibrarySnapshot>
    load(key: string, options?: ResourceOptions): Promise<PreparedLibraryEntry>
    commit(expectedRevision: number, input: LibraryMutation, options?: ResourceOptions): Promise<LibrarySnapshot>
  }
  validation: CompleteValidationOptions
}
const defaultStores: ImageImportLibraryStores = { projects: projectRepository, library: libraryRepository, validation }

/** Read a successfully persisted project first. Preview preparation never calls this function. */
export async function installSavedImageImportItems(sceneId: string, propIds: readonly string[], signal?: AbortSignal,
  stores: ImageImportLibraryStores = defaultStores): Promise<ImageImportLibraryResult> {
  idSchema.parse(sceneId); checkCancelled(signal)
  if (!Array.isArray(propIds) || propIds.length > LIBRARY_LIMITS.batch || new Set(propIds).size !== propIds.length) throw new Error('自动入库需要最多64个不同物件。')
  const ids = propIds.map(value => idSchema.parse(value)), options = { signal }
  const saved = await stores.projects.load(sceneId, options)
  checkCancelled(signal)
  if (!saved || saved.project.document.sceneId !== sceneId || saved.project.document.presetSnapshot.presetId !== 'image-import-manual') throw new Error('请先采用并保存图片工程，再将物件加入我的素材。')
  const selectors = new Map<string, CatalogSelector>()
  for (const id of ids) {
    const prop = saved.project.document.props[id]
    if (!prop?.definitionRef || !saved.project.document.propDefinitions[prop.definitionRef.id]) throw new Error('已保存图片工程缺少所选物件定义。')
    if (saved.project.document.propDefinitions[prop.definitionRef.id].tags.includes('source-building-art')) continue
    selectors.set(`prop:${prop.definitionRef.id}`, { kind: 'prop', definitionId: prop.definitionRef.id })
  }
  // A reconstructed floor is a reusable material item, independently of furniture.
  for (const room of Object.values(saved.project.document.rooms)) {
    const materialId = room.floorStyle?.base.materialRef.id, material = materialId ? saved.project.document.materials[materialId] : undefined
    if (material && (saved.project.authoringSources[material.textureAssetId] || material.tags.includes('原图保真'))) selectors.set(`material:${material.id}`, { kind: 'material', definitionId: material.id })
  }
  if (selectors.size > LIBRARY_LIMITS.batch) throw new Error('自动入库的物件与矢量地板合计超过64项，请收窄采用范围。')
  const entries = new Map<string, PreparedLibraryEntry>()
  const prepared = selectors.size ? await prepareLibraryEntries(saved, [...selectors.values()], { ...stores.validation, signal }) : []
  for (const entry of prepared) {
    entries.set(entry.item.identity.key, entry)
  }
  const before = await stores.library.read(options), missing: PreparedLibraryEntry[] = []
  let existingCount = 0
  for (const [key, entry] of entries) {
    checkCancelled(signal)
    if (!before.entries.some(row => row.item.identity.key === key)) { missing.push(entry); continue }
    const installed = await stores.library.load(key, options)
    if (canonicalJson(installed.item) !== canonicalJson(entry.item)) throw new Error('已安装图片素材的固定内容与工程不一致。')
    existingCount++
  }
  checkCancelled(signal)
  if (missing.length) await stores.library.commit(before.revision, { put: missing }, options)
  // Cold read also covers a previously completed write retried after interruption.
  for (const key of entries.keys()) {
    const installed = await stores.library.load(key, options)
    if (canonicalJson(installed.item) !== canonicalJson(entries.get(key)!.item)) throw new Error('图片素材入库后的冷读不一致。')
  }
  checkCancelled(signal)
  return { savedCount: missing.length, existingCount, entryKeys: [...entries.keys()] }
}
