import type { ProjectBundle } from '../../../shared/model/project.js'
import { CancelledOperationError, checkCancelled, type CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { prepareProjectArchive } from '../../../shared/project/file.js'
import type { HistoryArchive } from '../../../shared/project/history.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import ProjectArchiveWorker from './project-archive.worker.ts?worker&inline'
import type { ProjectArchiveWorkerResult } from './project-archive.worker.js'

type BackupOptions = CompleteValidationOptions & { signal?: AbortSignal }

export async function exportProjectBackup(bundle: ProjectBundle, options: BackupOptions): Promise<Blob> {
  return compressInWorker(await prepareProjectArchive({ current: bundle, snapshots: [] }, 'complete', options), options.signal)
}

export async function exportHistoryBackup(archive: HistoryArchive, options: BackupOptions): Promise<Blob> {
  return compressInWorker(await prepareProjectArchive(archive, 'history', options), options.signal)
}

function compressInWorker(files: Record<string, Uint8Array>, signal?: AbortSignal): Promise<Blob> {
  checkCancelled(signal)
  return new Promise((resolve, reject) => {
    // Keep the worker script with the editor so a downloaded workspace can back up offline.
    const worker = new ProjectArchiveWorker({ name: 'sceneweave-project-backup' })
    const finish = () => {
      signal?.removeEventListener('abort', cancel)
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
    }
    const fail = (error: unknown) => { finish(); reject(error) }
    const cancel = () => fail(new CancelledOperationError())
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onerror = event => { event.preventDefault(); fail(new Error('工程备份后台压缩失败，请重试。')) }
    worker.onmessageerror = () => fail(new Error('工程备份后台结果无法读取。'))
    worker.onmessage = (event: MessageEvent<ProjectArchiveWorkerResult>) => {
      if (signal?.aborted) { cancel(); return }
      const result = event.data
      if (result && 'error' in result) { fail(new Error(result.error)); return }
      const archive = result?.archive
      if (!(archive instanceof Blob) || archive.type !== 'application/octet-stream' || archive.size < 22 || archive.size > PACKAGE_LIMITS.compressedBytes) {
        fail(new Error('工程备份后台结果无效。'))
        return
      }
      finish()
      resolve(archive)
    }
    try {
      checkCancelled(signal)
      // Resource-port reads and encoded JSON are fresh buffers owned by this job.
      worker.postMessage(files, Object.values(files).map(bytes => bytes.buffer as ArrayBuffer))
    } catch (error) { fail(error) }
  })
}
