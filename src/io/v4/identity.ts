import type { SceneDocumentV3 } from '../../core/v3/types'
import type { HistoryIdentityV4 } from '../../core/v4/types'
import { HISTORY_LIMITS_V4 } from '../../core/v4/types'
import { hasExactKeys } from './limits'
import { validateHistoryIdentityV4 as validateCoreIdentity } from '../../core/v4/identity'

const nonempty = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && Array.from(value).length <= max

/** Identity is envelope metadata; tombstones are intentionally allowed in propTokens. */
export function validateHistoryIdentityV4(identity: unknown, document?: SceneDocumentV3): asserts identity is HistoryIdentityV4 {
  if (document) { validateCoreIdentity(identity, document); return }
  if (!hasExactKeys(identity, ['version', 'lineageId', 'rootSceneId', 'propTokens']) || identity.version !== 1
    || !nonempty(identity.lineageId) || identity.lineageId === '__proto__' || !nonempty(identity.rootSceneId) || identity.rootSceneId === '__proto__'
    || identity.propTokens === null || typeof identity.propTokens !== 'object' || Array.isArray(identity.propTokens)) {
    throw new Error('历史身份字段缺失、未知或无效。')
  }
  const tokens = identity.propTokens as Record<string, unknown>
  const ids = Object.keys(tokens)
  if (ids.length > HISTORY_LIMITS_V4.identityProps || ids.some(id => !nonempty(id) || id === '__proto__' || !nonempty(tokens[id], 256) || tokens[id] === '__proto__')) {
    throw new Error('历史物件身份超过预算或包含无效 ID/token。')
  }
  if (new Set(Object.values(tokens)).size !== ids.length) throw new Error('历史物件身份 token 必须唯一。')
}

export function mergeHistoryIdentitiesV4(current: HistoryIdentityV4, others: readonly HistoryIdentityV4[]): HistoryIdentityV4 {
  const result = structuredClone(current), reverse = new Map(Object.entries(result.propTokens).map(([id, token]) => [token, id]))
  for (const identity of others) {
    validateHistoryIdentityV4(identity)
    if (identity.lineageId !== result.lineageId || identity.rootSceneId !== result.rootSceneId) throw new Error('历史快照与当前工程不属于相同 lineage/root。')
    for (const [id, token] of Object.entries(identity.propTokens)) {
      const oldToken = Object.hasOwn(result.propTokens, id) ? result.propTokens[id] : undefined, oldId = reverse.get(token)
      if (oldToken !== undefined && oldToken !== token || oldId !== undefined && oldId !== id) throw new Error(`历史物件身份冲突：${id}。`)
      result.propTokens[id] = token
      reverse.set(token, id)
    }
  }
  validateHistoryIdentityV4(result)
  return result
}

export function assertHistoryIdentityCompatibleV4(left: HistoryIdentityV4, right: HistoryIdentityV4): void {
  if (left.lineageId !== right.lineageId || left.rootSceneId !== right.rootSceneId) throw new Error('快照与当前工程不属于相同 lineage/root。')
  const smaller = Object.keys(left.propTokens).length <= Object.keys(right.propTokens).length ? left : right
  const larger = smaller === left ? right : left
  for (const [id, token] of Object.entries(smaller.propTokens)) if (Object.hasOwn(larger.propTokens, id) && larger.propTokens[id] !== token) {
    throw new Error(`相同物件 ID 的出生身份不一致：${id}。`)
  }
}
