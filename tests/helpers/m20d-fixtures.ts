import { createC3ProjectV5 } from '../c3-fixtures'
import { prepareCompositionCommandsV5 } from '../../src/io/v5/prepare'
import { migrateProjectV5ToV6 } from '../../src/io/v6/migration'
import { prepareCompositionCommandsV6 } from '../../src/io/v6/prepare'
import { SceneRepositoryV6 } from '../../src/io/v6/storage'
import { ProjectRepository } from '../../src/platform/browser/storage/repository'
import { createBrowserImagePort } from '../../src/platform/browser/images'
import type { CompleteProjectV6 } from '../../src/io/v6/types'
import type { MigrationSetFiles } from '../../src/shared/migration/set'
import type { PreparationContext } from '../../src/shared/ports/runtime'

/** Runs only in the new Playwright context. Never connect this helper to a user profile. */
export function migrationEnvironment() {
  const prefix = crypto.randomUUID(); let sequence = 0
  const runtime: PreparationContext = { ids: { nextId: () => `${prefix}-${++sequence}` }, clock: { now: () => '2026-10-24T12:00:00.000Z' } }
  const validation = { images: createBrowserImagePort() }
  return { repository: new ProjectRepository({ runtime, validation }), runtime, validation }
}

/** Real old writer, actual Canvas bytes/variant pixels, history and a validated v5 original. */
export async function seedLegacyFamily() {
  const v5 = await prepareCompositionCommandsV5(await createC3ProjectV5({ title: 'M2-0d preserved source' }), [
    { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustment: { id: 'm20d-half-brightness', kind: 'brightness', value: .5, enabled: true } },
  ])
  const first = await migrateProjectV5ToV6(v5, { sceneId: crypto.randomUUID(), now: '2026-10-24T09:00:00.000Z' })
  const repository = new SceneRepositoryV6() // Exact legacy name is part of the capture contract.
  await repository.save(first, null)
  const named = await repository.createNamedSnapshot(first, '保留源命名历史', { kind: 'named', expectedRevision: 0, expectedMetadataVersion: 0 })
  const moved = await prepareCompositionCommandsV6(first, [{ type: 'updateProp', id: 'c3-right', changes: { rotationDeg: 5 } }])
  const current = structuredClone(moved); current.document.revision = 1; current.document.updatedAt = '2026-10-24T10:00:00.000Z'
  await repository.save(current, 0)
  const protection = await repository.createNamedSnapshot(current, '保留源保护历史', { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1 })
  return { repository, current, first, named, protection, reference: { repository: 'v6' as const, sceneId: current.document.sceneId } }
}

/** Native File/Blob reads provide fresh bytes back to the importer; no export receipt exists. */
export async function rereadBackup(files: MigrationSetFiles): Promise<MigrationSetFiles> {
  const index = new File([files.index.slice().buffer], 'fixture.sceneweave-migration.json', { type: 'application/json' })
  const volumes = new Map<string, Uint8Array>()
  for (const [path, bytes] of files.volumes) {
    const file = new File([bytes.slice().buffer], path, { type: 'application/octet-stream' })
    volumes.set(path, new Uint8Array(await file.arrayBuffer()))
  }
  return { index: new Uint8Array(await index.arrayBuffer()), volumes }
}

export async function editLegacySource(input: CompleteProjectV6, repository: SceneRepositoryV6) {
  const candidate = await prepareCompositionCommandsV6(input, [{ type: 'updateProp', id: 'c3-right', changes: { rotationDeg: 15 } }])
  const changed = structuredClone(candidate); changed.document.title = 'New source edit after backup'; changed.document.revision = input.document.revision + 1
  changed.document.updatedAt = '2026-10-24T11:00:00.000Z'
  await repository.save(changed, input.document.revision)
  return changed
}
