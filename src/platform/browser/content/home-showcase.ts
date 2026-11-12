import manifest from './home-showcase-manifest.json'
import { fromBundle, type EditableProject } from '../../../application/workspace/project.js'
import { createHistoryIdentity } from '../../../shared/history/identity.js'
import { importProject } from '../../../shared/project/file.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { captureJson } from '../../../shared/validation/json.js'
import { runtime, validation } from '../runtime.js'
import { boundedResponseBytes, type ContentLoadProgress } from './load-resources.js'

export type HomeShowcaseKind = keyof typeof manifest.entries

/** Read only the chosen fixed archive. A card preview is never an import or a
 * validation certificate. Both the original and its independent copy undergo
 * complete byte/pixel validation before the ordinary save-and-open workflow. */
export async function createHomeShowcaseProject(sample: HomeShowcaseKind, signal?: AbortSignal,
  onProgress?: (progress: ContentLoadProgress) => void): Promise<EditableProject> {
  signal?.throwIfAborted()
  if (!Object.hasOwn(manifest.entries, sample)) throw new Error('未知首页样板。')
  const entry = manifest.entries[sample]
  if (!/^[a-z][a-z-]+\.sceneweave$/.test(entry.archiveFile) || !Number.isSafeInteger(entry.archiveBytes)
    || entry.archiveBytes < 1 || entry.archiveBytes > PACKAGE_LIMITS.imageBytes) throw new Error('首页样板归档描述无效。')
  onProgress?.({ phase: 'resources', completed: 0, total: 1 })
  const response = await fetch(`${import.meta.env.BASE_URL}assets/home-scenes/projects/${entry.archiveFile}`, { signal })
  signal?.throwIfAborted()
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error(`首页样板读取失败 (${response.status})。`) }
  const bytes = await boundedResponseBytes(response, entry.archiveBytes, { signal })
  if (bytes.length !== entry.archiveBytes || sha256Bytes(bytes) !== entry.archiveSha256) throw new Error('首页样板文件不完整或摘要不同，请刷新后重试。')
  signal?.throwIfAborted()
  onProgress?.({ phase: 'resources', completed: 1, total: 1 })
  onProgress?.({ phase: 'validation', completed: 0, total: 1 })
  const bundle = await importProject(bytes, { ...validation, signal })
  signal?.throwIfAborted()
  if (projectContentHash(bundle.project) !== entry.projectHash) throw new Error('首页样板内容与固定清单不同。')
  const project = captureJson(bundle.project), now = runtime.clock.now()
  Object.assign(project.document, { sceneId: runtime.ids.nextId(), revision: 0, createdAt: now, updatedAt: now })
  project.historyIdentity = createHistoryIdentity(project.document, runtime)
  const copy = await fromBundle({ project, resources: bundle.resources }, { ...validation, signal })
  signal?.throwIfAborted()
  onProgress?.({ phase: 'validation', completed: 1, total: 1 })
  return copy
}
