import { ProjectValidationErrorV2 } from '../v2/diagnostics'
import { validateImageAssetRecord as validateImageRecord } from '../v2/resources'
import { ProjectValidationErrorV3 } from './diagnostics'
import type { AssetBlobRecord } from './types'

/** Pure byte/header/hash/decode primitives are shared; v3 owns its complete closure. */
export { inspectImageBytes, sha256Bytes, withImageDecoderSlotV2 } from '../v2/resources'
export async function validateImageAssetRecord(record: AssetBlobRecord, options: { signal?: AbortSignal } = {}): Promise<void> {
  try { await validateImageRecord(record, options) }
  catch (error) { if (error instanceof ProjectValidationErrorV2) throw new ProjectValidationErrorV3(error.issues); throw error }
}
