import archive from 'virtual:sceneweave-blank-scene'
import { boundedResponseBytes } from './bounded-response.js'

export async function downloadBlankScene(signal?: AbortSignal) {
  signal?.throwIfAborted()
  const response = await fetch(archive.url, { signal })
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error(`空白场景素材读取失败（${response.status}）。`)
  }
  return boundedResponseBytes(response, archive.bytes, { signal })
}
