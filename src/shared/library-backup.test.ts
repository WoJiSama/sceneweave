import { describe, expect, it, vi } from 'vitest'
import { outdoorProject } from '../io/v6/test-fixtures'
import type { ProjectBundle } from './model/project.js'
import type { CompleteValidationOptions } from './ports/resources.js'
import { createMemoryResources } from './project/resources.js'
import { decodeUtf8 } from './project/binary.js'
import { encodeUtf8 } from './validation/json.js'
import { exportLibraryBackup, importLibraryBackup } from './library/backup.js'
import { loadLibraryCapsule, prepareLibraryEntry } from './library/content.js'
import { validateCatalogCuration, catalogCurationFor } from './library/curation.js'
import { EMPTY_CATALOG_FILTER, filterCatalogItems } from './library/query.js'
import { validateCatalogOrganization } from './library/organization.js'
import { LIBRARY_LIMITS, type CatalogOrganization } from './library/types.js'

const validation: CompleteValidationOptions = { images: {
  async decode() { throw new Error('symbol-only fixture must not decode') },
  async transform() { throw new Error('symbol-only fixture must not transform') },
  async encodePng() { throw new Error('symbol-only fixture must not encode') },
} }
const organization: CatalogOrganization = { tags: ['  森林 ', 'Ｍap  Pack'], colors: ['棕', '绿'], favorite: true }
const detachedKey = JSON.stringify([1, '0'.repeat(64), 'prop', 'not-installed', 1, '1'.repeat(64)])
async function entryFixture() {
  const old = await outdoorProject(1)
  const bundle: ProjectBundle = { project: { format: 'sceneweave-complete-project', schemaVersion: 1,
    document: { ...old.document, format: 'sceneweave-scene', schemaVersion: 1 }, historyIdentity: { ...old.historyIdentity, version: 1 }, appearance: old.appearance,
    assets: {}, licenses: old.licenses, licenseBindings: old.licenseBindings, authoringSources: {},
  }, resources: createMemoryResources({}) }
  return prepareLibraryEntry(bundle, { kind: 'prop', definitionId: 'scatter-definition' }, validation)
}

describe('M2-0e native selected-library backup and organization-only records', () => {
  it('round-trips complete capsule bytes and exact installed/uninstalled organization display/order', async () => {
    const entry = await entryFixture(), input = { entries: [entry], organizations: { [entry.item.identity.key]: organization, [detachedKey]: organization } }
    const bytes = await exportLibraryBackup(input, validation), value = JSON.parse(decodeUtf8(bytes)), result = await importLibraryBackup(bytes, validation)
    expect(value).toMatchObject({ format: 'sceneweave-asset-library', schemaVersion: 1, capsuleFormat: 'sceneweave-complete-project@1' })
    expect(Object.keys(value).sort()).toEqual(['capsuleFormat', 'format', 'organizations', 'records', 'schemaVersion'])
    expect(Object.keys(value.records[0]).sort()).toEqual(['capsuleBase64', 'capsuleSha256', 'item'])
    expect(result).toEqual(input)
    expect((await loadLibraryCapsule(result.entries[0], validation)).project.document.props).toEqual({})
    expect(result.organizations[detachedKey].tags).toEqual(['  森林 ', 'Ｍap  Pack'])
  })

  it('allows explicitly selected organization-only backup and refuses an empty archive', async () => {
    const input = { entries: [], organizations: { [detachedKey]: organization } }
    expect(await importLibraryBackup(await exportLibraryBackup(input, validation), validation)).toEqual(input)
    await expect(exportLibraryBackup({ entries: [], organizations: {} }, validation)).rejects.toThrow(/至少/)
  })

  it('rejects old wire identity, unknown fields/version, duplicate JSON and noncanonical or tampered base64', async () => {
    const entry = await entryFixture(), json = JSON.parse(decodeUtf8(await exportLibraryBackup({ entries: [entry], organizations: {} }, validation)))
    for (const altered of [{ ...json, format: 'sceneweave-library' }, { ...json, schemaVersion: 2 }, { ...json, capsuleFormat: 'v6' }, { ...json, url: 'https://example.invalid' }]) {
      await expect(importLibraryBackup(encodeUtf8(JSON.stringify(altered)), validation)).rejects.toThrow(/格式|版本/)
    }
    await expect(importLibraryBackup(encodeUtf8('{"format":"sceneweave-asset-library","schemaVersion":1,"schemaVersion":1}'), validation)).rejects.toThrow(/重复字段/)
    const base64 = json.records[0].capsuleBase64
    for (const invalid of [base64 + '\n', 'A===', 'AB==', 'AAAA']) {
      json.records[0].capsuleBase64 = invalid
      await expect(importLibraryBackup(encodeUtf8(JSON.stringify(json)), validation)).rejects.toThrow(/base64|摘要/)
    }
  })

  it('rejects duplicate installed identities and organization-only conflict with the same logical key', async () => {
    const entry = await entryFixture()
    await expect(exportLibraryBackup({ entries: [entry, entry], organizations: {} }, validation)).rejects.toThrow(/重复/)
    const tuple = JSON.parse(entry.item.identity.key); tuple[5] = entry.item.identity.contentHash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64)
    const organizations = { [JSON.stringify(tuple)]: organization }
    await expect(exportLibraryBackup({ entries: [entry], organizations }, validation)).rejects.toThrow(/逻辑/)
    const json = JSON.parse(decodeUtf8(await exportLibraryBackup({ entries: [entry], organizations: {} }, validation)))
    json.organizations = organizations
    await expect(importLibraryBackup(encodeUtf8(JSON.stringify(json)), validation)).rejects.toThrow(/逻辑/)
  })

  it('rejects accessors without invoking them and captures bytes/organization before an await', async () => {
    const entry = await entryFixture(), copied = { entries: [entry], organizations: { [detachedKey]: structuredClone(organization) } }, pending = exportLibraryBackup(copied, validation)
    entry.capsule.fill(0); copied.organizations[detachedKey].tags[0] = 'later'
    const loaded = await importLibraryBackup(await pending, validation)
    expect(loaded.organizations[detachedKey]).toEqual(organization)
    const getter = vi.fn(), input = Object.defineProperty({ organizations: {} }, 'entries', { enumerable: true, get: getter })
    await expect(exportLibraryBackup(input as never, validation)).rejects.toThrow(/访问器/); expect(getter).not.toHaveBeenCalled()
    await expect(importLibraryBackup(await exportLibraryBackup({ entries: [], organizations: { [detachedKey]: organization } }, validation), { ...validation, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps organization limits/display semantics and pure curation exact-key filtering', async () => {
    expect(Object.isFrozen(LIBRARY_LIMITS)).toBe(true)
    expect(validateCatalogOrganization(organization)).toEqual(organization)
    expect(() => validateCatalogOrganization({ ...organization, tags: ['A', 'ａ'] })).toThrow(/重复/)
    expect(() => validateCatalogOrganization({ ...organization, tags: ['sceneweave:internal'] })).toThrow(/内部/)
    const item = (await entryFixture()).item, index = validateCatalogCuration({ format: 'sceneweave-catalog-curation', version: 1,
      records: [{ key: item.identity.key, tags: ['夜色'], colors: ['紫'] }] })
    expect(catalogCurationFor(item, index)?.tags).toEqual(['夜色'])
    expect(catalogCurationFor(item)).toBeUndefined()
    expect(filterCatalogItems([item], {}, { ...EMPTY_CATALOG_FILTER, query: '夜色', colors: ['紫'] }, index)).toEqual([item])
    expect(filterCatalogItems([item], {}, { ...EMPTY_CATALOG_FILTER, query: '夜色' })).toEqual([])
    const changed = { ...item, identity: { ...item.identity, contentHash: 'f'.repeat(64) } }
    expect(catalogCurationFor(changed, index)).toBeUndefined()
    expect(() => validateCatalogCuration({ format: 'sceneweave-catalog-curation', version: 1, records: [{ key: item.identity.key, tags: [], colors: [], refines: detachedKey }] })).toThrow(/缺少/)
  })
})
