import { HISTORY_LIMITS_V4 } from '../../core/v4/types'
import { PROJECT_LIMITS_V3 } from '../v3/limits'

/** Per-file ZIP protections stay unchanged; history adds cumulative document/identity budgets. */
export const PROJECT_LIMITS_V4 = Object.freeze({
  ...PROJECT_LIMITS_V3,
  namedPerScene: HISTORY_LIMITS_V4.namedPerScene,
  protectionPerScene: HISTORY_LIMITS_V4.protectionPerScene,
  archiveSnapshots: HISTORY_LIMITS_V4.archiveSnapshots,
  identityProps: HISTORY_LIMITS_V4.identityProps,
  storedResourceBytes: HISTORY_LIMITS_V4.storedResourceBytes,
  storedDocumentBytes: HISTORY_LIMITS_V4.storedDocumentBytes,
  storedOriginalBytes: HISTORY_LIMITS_V4.storedOriginalBytes,
  archiveDocumentBytes: HISTORY_LIMITS_V4.archiveDocumentBytes,
})

export { checkCancelled, hasExactKeys, isSha256, crc32 } from '../v3/limits'
export function failV4(message: string): never { throw new Error(`M1 历史工程无效：${message}`) }
