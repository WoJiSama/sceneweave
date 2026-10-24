import { describe, expect, it } from 'vitest'
import { exportCatalogBackup, readCatalogBackup } from './catalog'
import { importLibraryBackup } from '../../shared/library/backup'
import { validation } from '../../platform/browser/runtime'
import type { CatalogOrganization } from '../../shared/library/types'

describe('native main library selected organization backup', () => {
  it('keeps an uninstalled identity and exact label/color order without manufacturing an installation', async () => {
    const key = JSON.stringify([1, 'a'.repeat(64), 'prop', 'prop.sw.uninstalled', 1, 'b'.repeat(64)])
    const organization: CatalogOrganization = { tags: ['  苔石  ', 'ＡＢＣ'], colors: ['蓝', '绿'], favorite: true }
    const blob = await exportCatalogBackup([], undefined, { [key]: organization })
    const decoded = await importLibraryBackup(new Uint8Array(await blob.arrayBuffer()), validation)
    expect(decoded.entries).toEqual([])
    expect(decoded.organizations).toEqual({ [key]: organization })
    const reviewed = await readCatalogBackup(new File([blob], 'personal.sceneweave-library'))
    expect(reviewed.records).toEqual([])
    expect(reviewed.organizations).toEqual({ [key]: organization })
  })
})
