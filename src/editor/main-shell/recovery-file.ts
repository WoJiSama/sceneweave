export function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function downloadWorkspaceRecovery(signal?: AbortSignal) {
  const [{ nativeWorkspace }, { validation }, { exportProjectBackup }, { toBundle }] = await Promise.all([
    import('../main/workspace-session'), import('../../platform/browser/runtime'), import('../../platform/browser/export/project-backup'),
    import('../../application/workspace/project'),
  ])
  const project = nativeWorkspace.getState().project
  if (!project) throw new Error('此页面没有可备份的工程。')
  const checkpoint = nativeWorkspace.checkpoint()
  const archive = await exportProjectBackup(toBundle(project), { ...validation, signal })
  nativeWorkspace.assertCheckpoint(checkpoint)
  downloadFile(archive, 'sceneweave-recovery.sceneweave')
}
