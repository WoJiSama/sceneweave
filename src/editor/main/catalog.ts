import { LibraryRepository } from '../../platform/browser/library'
import { CATALOG_CURATION, catalogCurationFor as curated } from '../../platform/browser/content'
import { loadBuiltinCatalog } from '../../platform/browser/content'
import { validation, runtime } from '../../platform/browser/runtime'
import { toBundle, fromBundle, fromVerifiedBundle, type EditableProject } from '../../application/workspace/project'
import { listCatalogItems, prepareLibraryEntry, loadLibraryCapsule, adoptLibraryEntries } from '../../shared/library/content'
import { exportLibraryBackup, importLibraryBackup } from '../../shared/library/backup'
import { catalogReadonlyTags as readonlyTags } from '../../shared/library/curation'
import { filterCatalogItems as filterItems, EMPTY_CATALOG_FILTER } from '../../shared/library/query'
import { LIBRARY_LIMITS, type CatalogOrganization, type PreparedLibraryEntry } from '../../shared/library/types'
export * from '../../shared/library/organization'
export {
  CATALOG_COLORS as CATALOG_COLORS_V1, LIBRARY_LIMITS as CATALOG_LIMITS_V1,
  EMPTY_CATALOG_ORGANIZATION as EMPTY_CATALOG_ORGANIZATION_V1,
} from '../../shared/library/types'
export type {
  CatalogColor as CatalogColorV1, CatalogItem as CatalogItemV1, CatalogKind as CatalogKindV1,
  CatalogOrganization as CatalogOrganizationV1, LibrarySnapshot as CatalogSnapshotV1,
  PreparedLibraryEntry as PreparedCatalogEntryV1,
} from '../../shared/library/types'
export type { CatalogFilter as CatalogFilterV1 } from '../../shared/library/query'
export const EMPTY_CATALOG_FILTER_V1 = EMPTY_CATALOG_FILTER
export const describeCatalogItems = (project: EditableProject) => listCatalogItems(toBundle(project))
export const prepareCatalogEntry = (project: EditableProject, selector: Parameters<typeof prepareLibraryEntry>[1], signal?: AbortSignal) => prepareLibraryEntry(toBundle(project), selector, { ...validation, signal })
export const readCatalogEntry = async (entry: PreparedLibraryEntry, signal?: AbortSignal) => fromBundle(await loadLibraryCapsule(entry, { ...validation, signal }), { ...validation, signal })
export const loadBuiltinCatalogV1 = async (signal?: AbortSignal) => fromVerifiedBundle(await loadBuiltinCatalog({ ...validation, signal }), { signal })
export const catalogCurationFor = curated
export const catalogReadonlyTags = (item: Parameters<typeof readonlyTags>[0]) => readonlyTags(item, CATALOG_CURATION)
export const filterCatalogItems = (items: Parameters<typeof filterItems>[0], organizations: Parameters<typeof filterItems>[1], filter: Parameters<typeof filterItems>[2]) => filterItems(items, organizations, filter, CATALOG_CURATION)
export class CatalogRepositoryV1 {
  private readonly native = new LibraryRepository({ validation, runtime })
  read() { return this.native.read() }
  load(key: string, signal?: AbortSignal) { return this.native.load(key, { signal }) }
  commit(expected: number, mutation: Parameters<LibraryRepository['commit']>[1], signal?: AbortSignal) { return this.native.commit(expected, mutation, { signal }) }
  close() { this.native.close() }
}
export interface CatalogBackupRecordV1 { entry: PreparedLibraryEntry; organization: CatalogOrganization }
export async function exportCatalogBackup(records: CatalogBackupRecordV1[], signal?: AbortSignal, additionalOrganizations?: Record<string, CatalogOrganization>) {
  const bytes = await exportLibraryBackup({ entries: records.map(record => record.entry), organizations: additionalOrganizations ?? Object.fromEntries(records.map(record => [record.entry.item.identity.key, record.organization])) }, { ...validation, signal })
  return new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })
}
export async function readCatalogBackup(file: File, signal?: AbortSignal): Promise<{ records: CatalogBackupRecordV1[]; organizations: Record<string, CatalogOrganization> }> {
  if (file.size > LIBRARY_LIMITS.backupBytes) throw new Error('所选库备份超过64MiB。')
  signal?.throwIfAborted()
  const backup = await importLibraryBackup(new Uint8Array(await file.arrayBuffer()), { ...validation, signal })
  return { records: backup.entries.map(entry => ({ entry, organization: backup.organizations[entry.item.identity.key] ?? { tags: [], colors: [], favorite: false } })), organizations: backup.organizations }
}
export async function prepareCatalogAdoption(project: EditableProject, entries: PreparedLibraryEntry[], signal?: AbortSignal) {
  const result = await adoptLibraryEntries(toBundle(project), entries, { ...validation, signal })
  return { ...result, project: await fromBundle(result.bundle, { ...validation, signal }) }
}
