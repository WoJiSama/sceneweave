import { projectRepository } from '../../platform/browser/runtime'
import { fromVerifiedBundle } from '../../application/workspace/project'
import { HISTORY_LIMITS } from '../../shared/model/history'

/** UI view of the native repository; all persistence goes through its strict complete-v1 boundary. */
export class WorkspaceRepository {
  open() { return projectRepository.open() }
  list() { return projectRepository.list() }
  async load(sceneId: string) { const value = await projectRepository.load(sceneId); return value ? fromVerifiedBundle(value) : null }
  listNamedSnapshots(sceneId: string) { return projectRepository.listSnapshots(sceneId) }
  listLegacySources(sceneId: string) { return projectRepository.listLegacySources(sceneId) }
  loadLegacyOriginal(sceneId: string, nodeId: string) { return projectRepository.loadLegacyOriginal(sceneId, nodeId) }
  async loadNamedSnapshot(id: string, ownerSceneId: string) {
    const value = await projectRepository.loadSnapshot(ownerSceneId, id)
    if (!value) return null
    const { bundle, ...summary } = value
    return { ...summary, project: fromVerifiedBundle(bundle) }
  }
  renameNamedSnapshot(id: string, name: string, hash: string, metadataVersion: number | undefined, owner: string) {
    if (metadataVersion === undefined) throw new Error('请先读取历史元数据。')
    return projectRepository.renameSnapshot(owner, id, name, hash, metadataVersion)
  }
  deleteNamedSnapshot(id: string, hash: string, metadataVersion: number | undefined, owner: string) {
    if (metadataVersion === undefined) throw new Error('请先读取历史元数据。')
    return projectRepository.deleteSnapshot(owner, id, hash, metadataVersion)
  }
  async usage(sceneId: string) { const value = await projectRepository.usage(sceneId); return { ...value, originalBytes: value.legacyBytes, limits: HISTORY_LIMITS } }
  async exportArchive(sceneId: string, snapshotIds: readonly string[]) {
    const current = await projectRepository.load(sceneId)
    if (!current) throw new Error('工程已不存在。')
    const snapshots = []
    for (const id of snapshotIds) { const value = await projectRepository.loadSnapshot(sceneId, id); if (!value || value.kind === 'imported-auto') throw new Error('请重新选择命名或保护快照。'); snapshots.push(value) }
    return { current, snapshots }
  }
}
