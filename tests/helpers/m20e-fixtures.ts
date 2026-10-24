import { createC3ProjectV5 } from '../c3-fixtures'
import { prepareCompositionCommandsV5 } from '../../src/io/v5/prepare'
import { migrateProjectV5ToV6 } from '../../src/io/v6/migration'
import { prepareCatalogEntry } from '../../src/catalog/content'
import { CatalogRepositoryV1 } from '../../src/catalog/repository'
import { LibraryRepository } from '../../src/platform/browser/library'
import { createBrowserImagePort } from '../../src/platform/browser/images'
import type { PreparationContext } from '../../src/shared/ports/runtime'
import type { CatalogOrganization } from '../../src/shared/library/types'
import type { LibraryConversionEnvironment } from '../../src/application/migration/library-conversion'
export { rereadBackup } from './m20d-fixtures'

export const ORGANIZATION_ONLY_KEY = JSON.stringify([1, 'a'.repeat(64), 'prop', 'uninstalled-m20e', 1, 'b'.repeat(64)])
export const OUTSIDE_KEY = JSON.stringify([1, 'c'.repeat(64), 'material', 'outside-m20e', 1, 'd'.repeat(64)])
export const SOURCE_ORGANIZATION: CatalogOrganization = { tags: [' 原显示文本 ', '第二个标签'], colors: ['蓝', '灰'], favorite: true }
export function libraryEnvironment(name?: string): LibraryConversionEnvironment {
  const prefix = crypto.randomUUID(); let sequence = 0
  const runtime: PreparationContext = { ids: { nextId: () => `${prefix}-${++sequence}` }, clock: { now: () => '2026-10-24T12:00:00.000Z' } }
  const validation = { images: createBrowserImagePort() }
  return { repository: new LibraryRepository({ name, runtime, validation }), runtime, validation }
}

/** All databases are created only in the isolated Playwright context. Old public writers and native Canvas remain real. */
export async function seedLegacyCatalog() {
  let project = await createC3ProjectV5({ title: 'M2-0e original scene that must never enter a capsule' })
  project = await prepareCompositionCommandsV5(project, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] },
    adjustment: { id: 'm20e-brightness', kind: 'brightness', value: .5, enabled: true } }])
  project = await prepareCompositionCommandsV5(project, [{ type: 'createPrefab', id: 'm20e-private-group', definitionId: 'm20e-private-definition',
    name: 'M2-0e private template', ids: ['c3-left', 'c3-secret'], anchorMm: { x: 4000, y: 4000 } }])
  const legacy = await migrateProjectV5ToV6(project, { sceneId: crypto.randomUUID(), now: '2026-10-24T09:00:00.000Z' })
  const definitionId = Object.keys(legacy.document.propDefinitions).find(id => !legacy.document.propDefinitions[id].tags.some(tag => tag.startsWith('sceneweave:')))!
  const prop = await prepareCatalogEntry(legacy, { kind: 'prop', definitionId })
  const prefab = await prepareCatalogEntry(legacy, { kind: 'prefab', definitionId: 'm20e-private-definition' })
  const repository = new CatalogRepositoryV1()
  await repository.commit(0, { put: [prop, prefab], organization: [
    { key: prop.item.identity.key, value: SOURCE_ORGANIZATION },
    { key: prefab.item.identity.key, value: { tags: ['私密组合'], colors: ['黑'], favorite: false } },
    { key: ORGANIZATION_ONLY_KEY, value: SOURCE_ORGANIZATION },
  ] })
  return { repository, prop, prefab, legacy }
}
