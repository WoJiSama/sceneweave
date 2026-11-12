import Dexie from 'dexie'
import { CancelledOperationError } from '../../../shared/ports/resources.js'

/** Preserve the native lock while awaiting external work. Native abort must
 * reject independently: an aborted IDB transaction cannot service Dexie's
 * waitFor spin queue to deliver that promise's rejection. */
export async function waitForStorageTransaction<T>(pending: PromiseLike<T>, timeoutMs = 60_000): Promise<T> {
  const transaction = Dexie.currentTransaction
  if (!transaction) return Dexie.waitFor(pending, timeoutMs)
  if (!transaction.active) throw new CancelledOperationError()
  const native = transaction.idbtrans
  let rejectAbort: (error: unknown) => void = () => {}
  const aborted = () => rejectAbort(new CancelledOperationError())
  const abort = new Dexie.Promise<never>((_resolve, reject) => { rejectAbort = reject })
  native.addEventListener('abort', aborted, { once: true })
  try { return await Dexie.Promise.race([Dexie.waitFor(pending, timeoutMs), abort]) }
  finally { native.removeEventListener('abort', aborted) }
}
