import type { SceneDocumentV3 } from '../../core/v3/types'
import { mergeIdentityRecordsV6, validateHistoryIdentityShapeV6, validateHistoryIdentityV6 as validateCoreIdentity } from '../../core/v6/identity'
import type { HistoryIdentityV6 } from '../../core/v6/types'
export function validateHistoryIdentityV6(identity: unknown, document?: SceneDocumentV3): asserts identity is HistoryIdentityV6 {
  if (document) validateCoreIdentity(identity, document)
  else validateHistoryIdentityShapeV6(identity)
}
export function mergeHistoryIdentitiesV6(current: HistoryIdentityV6, others: readonly HistoryIdentityV6[]): HistoryIdentityV6 { return mergeIdentityRecordsV6(current, others) }
export function assertHistoryIdentityCompatibleV6(left: HistoryIdentityV6, right: HistoryIdentityV6): void { mergeIdentityRecordsV6(left, [right]) }
