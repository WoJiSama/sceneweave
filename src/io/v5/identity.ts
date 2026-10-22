import type { SceneDocumentV3 } from '../../core/v3/types'
import type { HistoryIdentityV5 } from '../../core/v5/types'
import { validateHistoryIdentityV5 as validateCoreIdentity } from '../../core/v5/identity'
import { hasExactKeys, PROJECT_LIMITS_V5 } from './limits'

const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Array.from(value).length <= 256 && value !== '__proto__'

/** Both live identities and tombstones are bounded in one shared budget. */
export function validateHistoryIdentityV5(identity: unknown, document?: SceneDocumentV3): asserts identity is HistoryIdentityV5 {
  if (document) { validateCoreIdentity(identity, document); return }
  if (!hasExactKeys(identity, ['version', 'lineageId', 'rootSceneId', 'propTokens', 'prefabTokens']) || identity.version !== 2
    || !valid(identity.lineageId) || !valid(identity.rootSceneId)) throw new Error('组件历史身份字段缺失、未知或无效。')
  const all: [string, unknown][] = []
  for (const record of [identity.propTokens, identity.prefabTokens]) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('组件历史身份映射无效。')
    all.push(...Object.entries(record))
  }
  if (all.length > PROJECT_LIMITS_V5.identityProps || all.some(([id, token]) => !valid(id) || !valid(token))
    || new Set(all.map(([id]) => id)).size !== all.length || new Set(all.map(([, token]) => token)).size !== all.length) throw new Error('物件/组合身份超过共享预算或ID/token重复、无效。')
}

export function mergeHistoryIdentitiesV5(current: HistoryIdentityV5, others: readonly HistoryIdentityV5[]): HistoryIdentityV5 {
  validateHistoryIdentityV5(current)
  const result = structuredClone(current)
  const reverse = new Map([...Object.entries(result.propTokens), ...Object.entries(result.prefabTokens)].map(([id, token]) => [token, id]))
  for (const identity of others) {
    validateHistoryIdentityV5(identity)
    if (identity.lineageId !== result.lineageId || identity.rootSceneId !== result.rootSceneId) throw new Error('历史快照与当前工程不属于相同 lineage/root。')
    for (const kind of ['propTokens', 'prefabTokens'] as const) for (const [id, token] of Object.entries(identity[kind])) {
      const otherKind = kind === 'propTokens' ? 'prefabTokens' : 'propTokens'
      const oldToken = Object.hasOwn(result[kind], id) ? result[kind][id] : undefined, oldId = reverse.get(token)
      if (Object.hasOwn(result[otherKind], id) || oldToken !== undefined && oldToken !== token || oldId !== undefined && oldId !== id) throw new Error(`历史物件/组合身份冲突：${id}。`)
      result[kind][id] = token; reverse.set(token, id)
    }
  }
  validateHistoryIdentityV5(result)
  return result
}

export function assertHistoryIdentityCompatibleV5(left: HistoryIdentityV5, right: HistoryIdentityV5): void {
  mergeHistoryIdentitiesV5(left, [right])
}
