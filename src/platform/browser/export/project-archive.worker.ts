import { zipProjectArchive } from './project-archive-zip.js'

export type ProjectArchiveWorkerResult = { archive: Blob } | { error: string }

self.onmessage = (event: MessageEvent<Record<string, Uint8Array>>) => {
  let result: ProjectArchiveWorkerResult
  try { result = { archive: zipProjectArchive(event.data) } }
  catch (error) { result = { error: error instanceof Error ? error.message : String(error) } }
  self.postMessage(result)
}
