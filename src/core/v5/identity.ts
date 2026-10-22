import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { geometryIdentityIdsV3 } from '../v3/domain'
import { validateSceneSnapshotV3 } from '../v3/snapshots'
import type { SceneDocumentV3 } from '../v3/types'
import { validateHistoryIdentityV4 } from '../v4/identity'
import type { HistoryIdentityV4 } from '../v4/types'
import { COMPOSITION_LIMITS_V5, type HistoryIdentityV5 } from './types'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留 ID')
export const historyIdentitySchemaV5 = z.object({ version: z.literal(2), lineageId: id, rootSceneId: id, propTokens: z.record(id, id), prefabTokens: z.record(id, id) }).strict()
function checkedScene(input: SceneDocumentV3): SceneDocumentV3 {
  const parsed = validateSceneSnapshotV3(input)
  if (!parsed.ok) throw new Error(`历史身份对应场景无效：${parsed.errors.map(issue => issue.message).join('；')}`)
  return parsed.document
}
export function validateHistoryIdentityV5(input: unknown, inputDocument: SceneDocumentV3): HistoryIdentityV5 {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`历史身份无效：${issue.message}`)
  const parsed = historyIdentitySchemaV5.safeParse(input)
  if (!parsed.success) throw new Error(`历史身份无效：${parsed.error.issues.map(issue => issue.message).join('；')}`)
  const document = checkedScene(inputDocument), identity = parsed.data
  const propIds = Object.keys(identity.propTokens), groupIds = Object.keys(identity.prefabTokens)
  if (propIds.length + groupIds.length > COMPOSITION_LIMITS_V5.identities) throw new Error('物件与组合已分配身份总数超过 65536。')
  if (propIds.some(key => Object.hasOwn(identity.prefabTokens, key))) throw new Error('物件与组合身份 ID 不能重用。')
  const tokens = [...Object.values(identity.propTokens), ...Object.values(identity.prefabTokens)]
  if (new Set(tokens).size !== tokens.length) throw new Error('物件与组合历史 token 必须全局唯一。')
  const occupied = geometryIdentityIdsV3(document)
  for (const layerId of Object.keys(document.userLayers)) occupied.add(layerId)
  for (const key of Object.keys(document.props)) {
    if (!Object.hasOwn(identity.propTokens, key)) throw new Error(`当前物件缺少身份 token：${key}。`)
    occupied.delete(key)
  }
  for (const key of Object.keys(document.prefabInstances)) {
    if (!Object.hasOwn(identity.prefabTokens, key)) throw new Error(`当前组合缺少身份 token：${key}。`)
    occupied.delete(key)
  }
  for (const key of [...propIds, ...groupIds]) if (occupied.has(key)) throw new Error(`已分配历史 ID 与其他场景身份冲突：${key}。`)
  return identity
}
export function createHistoryIdentityV5(document: SceneDocumentV3): HistoryIdentityV5 {
  return validateHistoryIdentityV5({ version: 2, lineageId: crypto.randomUUID(), rootSceneId: document.sceneId,
    propTokens: Object.fromEntries(Object.keys(document.props).map(id => [id, crypto.randomUUID()])),
    prefabTokens: Object.fromEntries(Object.keys(document.prefabInstances).map(id => [id, crypto.randomUUID()])),
  }, document)
}
export function migrateHistoryIdentityV4ToV5(input: HistoryIdentityV4, document: SceneDocumentV3): HistoryIdentityV5 {
  const previous = validateHistoryIdentityV4(input, document)
  return validateHistoryIdentityV5({ ...previous, version: 2, prefabTokens: Object.fromEntries(Object.keys(document.prefabInstances).map(id => [id, crypto.randomUUID()])) }, document)
}
/** Explicit validated compatibility view, never a persisted V5 replacement. */
export function toHistoryIdentityV4(input: HistoryIdentityV5, document: SceneDocumentV3): HistoryIdentityV4 {
  const identity = validateHistoryIdentityV5(input, document)
  return validateHistoryIdentityV4({ version: 1, lineageId: identity.lineageId, rootSceneId: identity.rootSceneId, propTokens: identity.propTokens }, document)
}
export interface AdvanceHistoryIdentityOptionsV5 { allowResurrection?: boolean }
export function advanceHistoryIdentityV5(input: HistoryIdentityV5, previousInput: SceneDocumentV3, nextInput: SceneDocumentV3, options: AdvanceHistoryIdentityOptionsV5 = {}): HistoryIdentityV5 {
  const previous = checkedScene(previousInput), next = checkedScene(nextInput), identity = validateHistoryIdentityV5(input, previous)
  if (previous.sceneId !== next.sceneId) throw new Error('身份只能推进同一场景的修订。')
  const result = structuredClone(identity)
  for (const [collection, field] of [['props', 'propTokens'], ['prefabInstances', 'prefabTokens']] as const) {
    for (const id of Object.keys(next[collection])) {
      if (Object.hasOwn(result[field], id)) {
        if (!Object.hasOwn(previous[collection], id) && !options.allowResurrection) throw new Error(`普通编辑不能复用已分配的物件/组合 ID：${id}。`)
      } else result[field][id] = crypto.randomUUID()
    }
  }
  return validateHistoryIdentityV5(result, next)
}
export function mergeHistoryIdentitiesV5(currentInput: unknown, currentDocument: SceneDocumentV3, historicInput: unknown, historicDocument: SceneDocumentV3): HistoryIdentityV5 {
  const current = validateHistoryIdentityV5(currentInput, currentDocument), historic = validateHistoryIdentityV5(historicInput, historicDocument)
  if (current.lineageId !== historic.lineageId || current.rootSceneId !== historic.rootSceneId) throw new Error('历史不是同一 lineage/root，不能恢复。')
  for (const field of ['propTokens', 'prefabTokens'] as const) for (const [id, token] of Object.entries(historic[field])) {
    if (Object.hasOwn(current[field], id) && current[field][id] !== token) throw new Error(`历史身份 token 冲突：${id}。`)
    current[field][id] = token
  }
  return validateHistoryIdentityV5(current, currentDocument)
}
