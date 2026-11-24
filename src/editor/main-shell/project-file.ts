import { fromVerifiedBundle } from '../../application/workspace/project'
import { projectRepository, validation } from '../../platform/browser/runtime'
import { importHistoryArchive, importProject } from '../../shared/project/file'
import { parseBoundedJson } from '../../shared/project/json'
import { validateProjectSnapshot } from '../../shared/project/resources'
import { inspectZip } from '../../shared/project/zip'

export async function installProjectFile(file: File, signal: AbortSignal) {
  signal.throwIfAborted()
  const bytes = new Uint8Array(await file.arrayBuffer())
  signal.throwIfAborted()
  let header: unknown
  try {
    const zip = inspectZip(bytes, signal)
    header = parseBoundedJson(await zip.read('manifest.json'))
  } catch {
    throw new Error('只支持当前完整工程v1文件；旧开发数据请使用首页独立迁入工具。')
  }
  if (!header || typeof header !== 'object' || Array.isArray(header) || !('format' in header) || header.format !== 'sceneweave-complete-project') {
    throw new Error('只支持当前完整工程v1文件；旧开发数据请使用首页独立迁入工具。')
  }
  const mode = 'packageMode' in header ? header.packageMode : undefined
  const archive = mode === 'history' ? await importHistoryArchive(bytes, { ...validation, signal })
    : mode === 'complete' ? { current: await importProject(bytes, { ...validation, signal }), snapshots: [] }
      : null
  if (!archive) throw new Error('未知的完整工程包模式。')
  const { project } = await projectRepository.importSnapshotArchive(archive, { signal })
  return fromVerifiedBundle(await validateProjectSnapshot(project, { ...validation, signal }), { signal })
}
