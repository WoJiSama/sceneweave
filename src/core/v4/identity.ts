import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { geometryIdentityIdsV3 } from '../v3/domain'
import { validateSceneSnapshotV3 } from '../v3/snapshots'
import type { SceneDocumentV3 } from '../v3/types'
import { HISTORY_LIMITS_V4, type HistoryIdentityV4 } from './types'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const identitySchema = z.object({
  version: z.literal(1),
  lineageId: id,
  rootSceneId: id,
  propTokens: z.record(id, id).refine(tokens => Object.keys(tokens).length <= HISTORY_LIMITS_V4.identityProps, '已分配物件身份超过 65536 个。'),
}).strict()
const randomId = () => crypto.randomUUID()

function checkedDocument(input: SceneDocumentV3): SceneDocumentV3 {
  const result = validateSceneSnapshotV3(input)
  if (!result.ok) throw new Error(`物件身份对应的场景无效：${result.errors.map(issue => issue.message).join('；')}`)
  return result.document
}

/** Strictly validates a persisted lineage and every live prop's allocated token. */
export function validateHistoryIdentityV4(input: unknown, inputDocument: SceneDocumentV3): HistoryIdentityV4 {
  const document = checkedDocument(inputDocument)
  const descriptor = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'propTokens') : undefined
  const allocated: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined
  if (allocated && typeof allocated === 'object' && Object.keys(allocated).length > HISTORY_LIMITS_V4.identityProps) throw new Error('已分配物件身份超过 65536 个。')
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`历史身份无效：${issue.message}`)
  const parsed = identitySchema.safeParse(input)
  if (!parsed.success) throw new Error(`历史身份无效：${parsed.error.issues.map(item => `${item.path.join('.') || 'identity'}: ${item.message}`).join('；')}`)
  const identity = parsed.data as HistoryIdentityV4
  const values = Object.values(identity.propTokens)
  if (new Set(values).size !== values.length) throw new Error('历史身份 token 必须全局唯一，不能分配给两个物件。')

  const livePropIds = new Set(Object.keys(document.props))
  for (const propId of livePropIds) if (!Object.hasOwn(identity.propTokens, propId)) throw new Error(`当前物件缺少已分配身份 token：${propId}。`)
  const nonPropIds = geometryIdentityIdsV3(document)
  for (const layerId of Object.keys(document.userLayers)) nonPropIds.add(layerId)
  for (const propId of livePropIds) nonPropIds.delete(propId)
  for (const propId of Object.keys(identity.propTokens)) if (nonPropIds.has(propId)) throw new Error(`已分配物件 ID 与其他场景身份冲突：${propId}。`)
  return identity
}

export function createHistoryIdentityV4(inputDocument: SceneDocumentV3): HistoryIdentityV4 {
  const document = checkedDocument(inputDocument)
  const propTokens: Record<string, string> = {}
  for (const propId of Object.keys(document.props)) propTokens[propId] = randomId()
  return validateHistoryIdentityV4({ version: 1, lineageId: randomId(), rootSceneId: document.sceneId, propTokens }, document)
}

export interface AdvanceHistoryIdentityOptionsV4 { allowResurrection?: boolean }

/** Extends tombstones before a new document is exposed; only internal undo/redo may resurrect. */
export function advanceHistoryIdentityV4(
  inputIdentity: HistoryIdentityV4,
  inputPrevious: SceneDocumentV3,
  inputNext: SceneDocumentV3,
  options: AdvanceHistoryIdentityOptionsV4 = {},
): HistoryIdentityV4 {
  const previous = checkedDocument(inputPrevious), next = checkedDocument(inputNext)
  const identity = validateHistoryIdentityV4(inputIdentity, previous)
  if (previous.sceneId !== next.sceneId) throw new Error('历史身份只能推进同一场景的文档修订。')
  const previousIds = new Set(Object.keys(previous.props))
  const propTokens = { ...identity.propTokens }
  for (const propId of Object.keys(next.props)) {
    if (Object.hasOwn(propTokens, propId)) {
      if (!previousIds.has(propId) && !options.allowResurrection) throw new Error(`普通编辑不能复用已分配的物件 ID：${propId}。`)
      continue
    }
    propTokens[propId] = randomId()
  }
  return validateHistoryIdentityV4({ ...identity, propTokens }, next)
}

/** Merges same-lineage allocated identities. A token conflict is never resolved by reassignment. */
export function mergeHistoryIdentitiesV4(currentInput: unknown, currentDocument: SceneDocumentV3, historicInput: unknown, historicDocument: SceneDocumentV3): HistoryIdentityV4 {
  const current = validateHistoryIdentityV4(currentInput, currentDocument)
  const historic = validateHistoryIdentityV4(historicInput, historicDocument)
  if (current.lineageId !== historic.lineageId || current.rootSceneId !== historic.rootSceneId) throw new Error('快照不属于当前工程的同一 lineage/root，不能按物件 ID 合并恢复。')
  const propTokens = { ...current.propTokens }
  for (const [propId, token] of Object.entries(historic.propTokens)) {
    const existing = Object.hasOwn(propTokens, propId) ? propTokens[propId] : undefined
    if (existing !== undefined && existing !== token) throw new Error(`相同物件 ID 的历史 token 冲突：${propId}。`)
    propTokens[propId] = token
  }
  return validateHistoryIdentityV4({ ...current, propTokens }, currentDocument)
}
