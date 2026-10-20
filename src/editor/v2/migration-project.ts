import type { SceneDocument } from '../../core/types'
import { migrateSceneV1 } from '../../core/v2/migration'
import { readProjectV1 } from '../../io/project-file'
import { importProjectV2, inspectProjectVersionV2 } from '../../io/v2/project-file'
import { sha256Bytes } from '../../io/v2/resources'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { forkProjectV2 } from './workspace'

export async function migrateProjectV1(source: SceneDocument, original?: Blob): Promise<CompleteProjectV2> {
  // Capture the exact source revision before the first await.
  const document = migrateSceneV1(structuredClone(source))
  const bytes = original ?? new Blob([JSON.stringify(source)], { type: 'application/json' })
  const metadata = { sourceSceneId: source.sceneId, sourceRevision: source.revision }
  const sourceHash = await sha256Bytes(new Uint8Array(await bytes.arrayBuffer()))
  return { document, assets: {}, licenses: {}, licenseBindings: [], migrationSource: {
    sourceSchemaVersion: 1, ...metadata, sourceHash, migratorVersion: 'sceneweave-v1-to-v2@1', migratedAt: document.createdAt, original: bytes,
  } }
}

export async function prepareProjectFile(file: Blob, signal?: AbortSignal): Promise<CompleteProjectV2> {
  const version = await inspectProjectVersionV2(file, { signal })
  signal?.throwIfAborted()
  if (version === 1) {
    const source = await readProjectV1(file)
    signal?.throwIfAborted()
    const project = await migrateProjectV1(source, file)
    signal?.throwIfAborted()
    return project
  }
  const imported = await importProjectV2(file, { signal })
  signal?.throwIfAborted()
  return forkProjectV2(imported)
}
