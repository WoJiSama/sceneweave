import { realImageBundle } from './m20c-fixtures'
import { fromBundle, toBundle, type EditableProject } from '../../src/application/workspace/project'
import { validation } from '../../src/platform/browser/runtime'
import { projectContentHash } from '../../src/shared/project/validate'
import { sha256Bytes, sha256Text } from '../../src/shared/validation/hash'

/** Browser fixtures with complete-v1 metadata and actual PNG/JPEG/WebP bytes. */
export async function createNativeProject(title = '原生完整工程与会话夹具'): Promise<EditableProject> {
  const bundle = await realImageBundle(), project = structuredClone(bundle.project)
  project.document.title = title
  return fromBundle({ project, resources: bundle.resources }, validation)
}

export async function readNativeCurrent(project: EditableProject) {
  const bundle = toBundle(project)
  return {
    sceneId: project.document.sceneId, title: project.document.title, revision: project.document.revision,
    contentHash: projectContentHash(bundle.project), document: structuredClone(project.document),
    historyIdentity: structuredClone(project.historyIdentity), appearance: structuredClone(project.appearance),
    assets: Object.fromEntries(await Promise.all(Object.entries(project.assets).map(async ([hash, asset]) => {
      const bytes = await project.resources.read(hash)
      return [hash, { sha256: asset.sha256, actualHash: sha256Bytes(bytes), sizeBytes: asset.sizeBytes }] as const
    }))),
    licenses: Object.fromEntries(Object.entries(project.licenses).map(([hash, license]) =>
      [hash, { sha256: license.sha256, actualHash: sha256Text(license.text) }] as const)),
  }
}
