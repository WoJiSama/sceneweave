import { describe, expect, it } from 'vitest'
import { outdoorProject } from '../io/v6/test-fixtures'
import { prepareCatalogEntry, readCatalogEntry } from './content'
import { exportCatalogBackup, readCatalogBackup } from './backup'

async function record() {
  const entry = await prepareCatalogEntry(await outdoorProject(1), { kind: 'prop', definitionId: 'scatter-definition' })
  return { entry, organization: { tags: ['松木'], colors: ['棕'] as ['棕'], favorite: true } }
}

describe('complete standalone library backup', () => {
  it('round trips actual native bytes, licenses and personal labels without scene entities or migration data', async () => {
    const source = await record(), backup = await exportCatalogBackup([source]), restored = await readCatalogBackup(backup)
    expect(restored).toHaveLength(1)
    expect(restored[0].organization).toEqual(source.organization)
    expect(restored[0].entry.item).toEqual(source.entry.item)
    expect(await restored[0].entry.capsule.arrayBuffer()).toEqual(await source.entry.capsule.arrayBuffer())
    const project = await readCatalogEntry(restored[0].entry)
    expect(Object.keys(project.document.props)).toEqual([])
    expect(Object.keys(project.licenses).length).toBeGreaterThan(0)
    expect(project.migrationSource).toBeUndefined()
  })

  it('rejects duplicate JSON keys, unknown fields/version and noncanonical/tampered payload bytes', async () => {
    await expect(readCatalogBackup(new Blob(['{"format":"sceneweave-library","schemaVersion":1,"schemaVersion":1,"records":[]}']))).rejects.toThrow('重复字段')
    const source = await record(), json = JSON.parse(await (await exportCatalogBackup([source])).text())
    await expect(readCatalogBackup(new Blob([JSON.stringify({ ...json, schemaVersion: 2 })]))).rejects.toThrow('版本')
    await expect(readCatalogBackup(new Blob([JSON.stringify({ ...json, url: 'https://example.invalid/no-bytes' })]))).rejects.toThrow('格式')
    json.records[0].capsuleBase64 += '\n'
    await expect(readCatalogBackup(new Blob([JSON.stringify(json)]))).rejects.toThrow('base64')
    json.records[0].capsuleBase64 = 'AAAA'
    await expect(readCatalogBackup(new Blob([JSON.stringify(json)]))).rejects.toThrow('SHA-256')
  })

  it('rejects duplicate identity, missing actual bytes and canceled export before returning a usable archive', async () => {
    const source = await record()
    await expect(exportCatalogBackup([source, source])).rejects.toThrow('重复')
    const broken = structuredClone(source); broken.entry.capsule = new Blob([])
    await expect(exportCatalogBackup([broken])).rejects.toThrow()
    const controller = new AbortController(); controller.abort()
    await expect(exportCatalogBackup([source], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
