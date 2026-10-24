import { checkCancelled, type CancellationSignal } from '../../../shared/ports/resources.js'

let queue: Promise<void> = Promise.resolve()
/** A native-render decoder slot; every returned bitmap remains owned by this one render. */
export async function withRenderDecoderSlot<T>(signal: CancellationSignal | undefined, action: () => Promise<T>): Promise<T> {
  checkCancelled(signal)
  const previous = queue
  let release!: () => void
  queue = new Promise<void>(resolve => { release = resolve })
  await previous
  try { checkCancelled(signal); return await action() }
  finally { release() }
}
