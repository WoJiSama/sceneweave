import { CancelledOperationError, checkCancelled, type CancellationSignal } from '../../../shared/ports/resources.js'
import { WeightedTaskQueue } from '../../../shared/project/task-queue.js'
import type { HistoryHead, HistoryVersion, HistoryPin } from './history-records.js'
import { auditHistoryMessage, type CapturedHistoryAudit, type HistoryAuditMessage } from './history-audit-message.js'

// At most one full historical graph is executing in this page. Workers retain
// no state after completion, failure, cancellation or transaction abort.
const queue = new WeightedTaskQueue(1, 1), active = new Set<() => void>()
let generation = 0
export function disposeHistoryAudits(): void {
  generation++
  for (const cancel of active) cancel()
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', disposeHistoryAudits)

/** Expanded fallback for audits that still execute inside a transaction. */
export async function auditHistoryInWorker(owner: string, head: HistoryHead | null, versions: HistoryVersion[], pins: HistoryPin[], signal?: CancellationSignal): Promise<{ documentBytes: number }> {
  return runHistoryAudit({ owner, head, versions, pins }, signal)
}
/** Native captured rows, including every owner and branch. No transfer list:
 * the final transaction retains and rechecks the original actual byte arrays. */
export async function auditCapturedHistoryInWorker(message: CapturedHistoryAudit, signal?: CancellationSignal): Promise<{ documentBytes: number }> {
  return runHistoryAudit(message, signal)
}
async function runHistoryAudit(message: HistoryAuditMessage, signal?: CancellationSignal): Promise<{ documentBytes: number }> {
  checkCancelled(signal)
  const admitted = generation
  const cancellation: CancellationSignal = { get aborted() { return generation !== admitted || signal?.aborted === true } }
  if (typeof Worker === 'undefined') {
    let start = performance.now()
    return queue.run(1, cancellation, () => auditHistoryMessage(message, cancellation, async () => {
      checkCancelled(cancellation)
      if (performance.now() - start >= 12) { await new Promise<void>(resolve => setTimeout(resolve, 0)); checkCancelled(cancellation); start = performance.now() }
    }))
  }
  return queue.run(1, cancellation, () => new Promise((resolve, reject) => {
    checkCancelled(cancellation)
    const worker = new Worker(new URL('./history-audit-worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (error?: unknown, documentBytes?: number) => {
      if (settled) return
      settled = true; clearInterval(poll); clearTimeout(timeout)
      signal?.removeEventListener?.('abort', cancel)
      active.delete(dispose)
      worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate()
      if (error) reject(error); else resolve({ documentBytes: documentBytes! })
    }
    const cancel = () => { try { checkCancelled(cancellation) } catch (error) { finish(error) } }
    const dispose = () => finish(new CancelledOperationError())
    const poll = setInterval(cancel, 50), timeout = setTimeout(() => finish(new Error('完整历史后台检查超时；保存未采用。')), 120_000)
    active.add(dispose); signal?.addEventListener?.('abort', cancel, { once: true })
    worker.onerror = event => { event.preventDefault(); finish(new Error('完整历史后台检查执行失败；保存未采用。')) }
    worker.onmessageerror = () => finish(new Error('完整历史后台检查结果无法读取；保存未采用。'))
    worker.onmessage = event => {
      try {
        checkCancelled(cancellation)
        const value = event.data
        if (!value || typeof value !== 'object' || value.ok !== true) throw new Error(typeof value?.message === 'string' ? value.message : '完整历史后台检查失败。')
        if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'documentBytes') || !Number.isSafeInteger(value.documentBytes) || value.documentBytes < 0) throw new Error('完整历史后台计量结果无效。')
        finish(undefined, value.documentBytes)
      } catch (error) { finish(error) }
    }
    try { worker.postMessage(message); cancel() } catch (error) { finish(error) }
  }))
}
