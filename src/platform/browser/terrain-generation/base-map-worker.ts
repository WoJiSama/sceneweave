import { executeBaseMapRequest, type BaseMapResponse } from '../../../shared/terrain-generation/base-map.js'
import { executeBaseMapRequestV2, type BaseMapResponseV2 } from '../../../shared/terrain-generation/base-map-v2.js'
import { captureJson } from '../../../shared/validation/json.js'

export interface BaseMapWorkerFailure { type: 'error'; message: string }
/** Failed computation can never be parsed as an adoptable base-map response. */
export function executeBaseMapWorkerRequest(raw: unknown): BaseMapResponse | BaseMapResponseV2 | BaseMapWorkerFailure {
  try { const owned = captureJson(raw); return owned && typeof owned === 'object' && 'version' in owned && owned.version === 2 ? executeBaseMapRequestV2(owned) : executeBaseMapRequest(owned) }
  catch { return { type: 'error', message: '程序底图生成失败，请检查输入或缩小范围。' } }
}
interface BaseMapWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: BaseMapResponse | BaseMapResponseV2 | BaseMapWorkerFailure) => void
  close: () => void
}
const scope = globalThis as unknown as BaseMapWorkerScope
if (typeof document === 'undefined' && typeof scope.postMessage === 'function' && typeof scope.close === 'function') {
  let consumed = false
  scope.onmessage = event => {
    if (consumed) return
    consumed = true
    try { scope.postMessage(executeBaseMapWorkerRequest(event.data)) }
    finally { scope.close() }
  }
}
