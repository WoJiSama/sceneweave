import { fromVerifiedBundle } from '../../application/workspace/project'
import { projectRepository, validation } from '../../platform/browser/runtime'
import { importProjectArchive } from '../../shared/project/file'
import { validateProjectSnapshot } from '../../shared/project/resources'

export async function installProjectFile(file: File, signal: AbortSignal) {
  signal.throwIfAborted()
  const bytes = new Uint8Array(await file.arrayBuffer())
  signal.throwIfAborted()
  const archive = await importProjectArchive(bytes, { ...validation, signal })
  const { project } = await projectRepository.importSnapshotArchive(archive, { signal })
  return fromVerifiedBundle(await validateProjectSnapshot(project, { ...validation, signal }), { signal })
}
