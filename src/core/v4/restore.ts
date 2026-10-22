import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { geometryIdentityIdsV3 } from '../v3/domain'
import { effectiveEditLockedV3 } from '../v3/layers'
import { validateSceneSnapshotV3 } from '../v3/snapshots'
import type { PropV2, SceneDocumentV3, SurfaceRef } from '../v3/types'
import { projectSceneV3 } from '../../render/v3/projection'
import { mergeHistoryIdentitiesV4, validateHistoryIdentityV4 } from './identity'
import type { HistoryIdentityV4, RestoreChangeV4, RestorePlanV4, RestoreRequestV4 } from './types'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const requestSchema = z.object({ ids: z.array(id).min(1).max(256), mode: z.enum(['appearance', 'transform', 'entity']) }).strict()
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)

function checkedScene(input: SceneDocumentV3, label: string): SceneDocumentV3 {
  const checked = validateSceneSnapshotV3(input)
  if (!checked.ok) throw new Error(`${label}场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  return checked.document
}

function assertIndependent(scene: SceneDocumentV3, propId: string, label: string): void {
  const groups = [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]
  if (groups.some(group => Object.values(group.members).some(member => member.propId === propId))) throw new Error(`${label}物件 ${propId} 有组合或散布成员关系，首批局部恢复仅支持独立物件。`)
  if (Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === propId)) throw new Error(`${label}物件 ${propId} 有锚点注记依赖，不能局部恢复。`)
  if (scene.constraints.pathChecks.some(check => [check.from, check.to].some(anchor => anchor.type === 'entity' && anchor.entityKind === 'prop' && anchor.entityId === propId))) throw new Error(`${label}物件 ${propId} 有路径/结构检查依赖，首批局部恢复不支持。`)
}

function assertTargetLayer(scene: SceneDocumentV3, layerId: string, floorId: string): void {
  const layer = own(scene.userLayers, layerId)
  if (!layer) throw new Error(`恢复目标图层不存在：${layerId}。`)
  if (layer.floorId !== floorId) throw new Error('恢复物件与目标图层必须属于同一 Floor。')
  if (layer.editLocked) throw new Error(`恢复目标图层已锁定：${layerId}。`)
}

function assertSupportUnlocked(scene: SceneDocumentV3, prop: PropV2): void {
  const check = (ref: SurfaceRef): void => {
    if (ref.kind === 'floor') {
      if (!own(scene.floors, ref.id) || ref.id !== prop.floorId) throw new Error(`恢复物件 ${prop.id} 的支撑 Floor 不存在或不匹配。`)
      return
    }
    const support = ref.kind === 'room' ? own(scene.rooms, ref.id) : own(scene.terrainAreas, ref.id)
    if (!support || support.floorId !== prop.floorId) throw new Error(`恢复物件 ${prop.id} 的支撑依赖不存在或跨 Floor：${ref.id}。`)
    const layer = own(scene.userLayers, scene.entityLayers[support.id])
    if (support.editLocked || layer?.editLocked) throw new Error(`恢复物件的支撑依赖或图层已锁定：${support.id}。`)
    if (ref.kind === 'room') check(scene.rooms[ref.id].supportRef)
  }
  check(prop.supportRef)
  if (prop.roomId !== undefined && (prop.supportRef.kind !== 'room' || prop.supportRef.id !== prop.roomId)) check({ kind: 'room', id: prop.roomId })
}

function restoreFields(prop: PropV2, mode: RestoreRequestV4['mode']): Partial<PropV2> {
  if (mode === 'appearance') return {
    definitionRef: prop.definitionRef, appearance: prop.appearance, visualBoundsMm: prop.visualBoundsMm,
    shadowClass: prop.shadowClass, shadowOverride: prop.shadowOverride,
  }
  if (mode === 'transform') return { positionMm: prop.positionMm, rotationDeg: prop.rotationDeg }
  return prop
}

/** Imports only the fixed prop definition and the two possible image roots it needs. */
function mergePropResources(candidate: SceneDocumentV3, historic: SceneDocumentV3, prop: PropV2): void {
  const mergeAsset = (assetId: string): void => {
    const resource = own(historic.assets, assetId)
    if (!resource) throw new Error(`历史恢复缺少固定资源：${assetId}。`)
    const current = own(candidate.assets, assetId)
    if (current && !equal(current, resource)) throw new Error(`历史资源 ID 与当前内容冲突：${assetId}。`)
    if (!current) candidate.assets[assetId] = structuredClone(resource)
  }
  if (prop.definitionRef) {
    const definition = own(historic.propDefinitions, prop.definitionRef.id)
    if (!definition || definition.version !== prop.definitionRef.version) throw new Error(`历史物件定义缺失或固定版本不匹配：${prop.definitionRef.id}。`)
    const current = own(candidate.propDefinitions, definition.id)
    if (current && !equal(current, definition)) throw new Error(`历史定义 ID 与当前版本或内容冲突：${definition.id}。`)
    if (!current) candidate.propDefinitions[definition.id] = structuredClone(definition)
    if (definition.defaultAppearance.kind === 'image') mergeAsset(definition.defaultAppearance.assetId)
  }
  if (prop.appearance.kind === 'image') mergeAsset(prop.appearance.assetId)
}

/** Pure candidate creation. Workspace supplies checkpoint, resource bytes and the new revision. */
export function buildRestorePlanV4(
  currentInput: SceneDocumentV3,
  currentIdentityInput: HistoryIdentityV4,
  historicInput: SceneDocumentV3,
  historicIdentityInput: HistoryIdentityV4,
  requestInput: RestoreRequestV4,
): RestorePlanV4 {
  const issue = inspectJsonInput(requestInput)
  if (issue) throw new Error(`恢复选择无效：${issue.message}`)
  const parsed = requestSchema.safeParse(requestInput)
  if (!parsed.success) throw new Error(`恢复选择无效：一次须明确选择 1 至 256 个物件及受支持的属性组。${parsed.error.issues.map(item => item.message).join('；')}`)
  const request: RestoreRequestV4 = parsed.data
  if (new Set(request.ids).size !== request.ids.length) throw new Error('恢复物件 ID 不能重复。')
  const current = checkedScene(currentInput, '当前'), historic = checkedScene(historicInput, '历史')
  const historyIdentity = mergeHistoryIdentitiesV4(currentIdentityInput, current, historicIdentityInput, historic)
  const candidate = structuredClone(current), changes: RestoreChangeV4[] = []
  const occupied = geometryIdentityIdsV3(current)
  for (const layerId of Object.keys(current.userLayers)) occupied.add(layerId)

  for (const propId of request.ids) {
    const historical = own(historic.props, propId), present = own(current.props, propId)
    if (!historical) throw new Error(`所选历史物件不存在：${propId}。`)
    if (!present && request.mode !== 'entity') throw new Error(`已删除物件 ${propId} 只能显式选择完整实体重建。`)
    if (!present && occupied.has(propId)) throw new Error(`恢复物件 ID 已被当前其他身份占用：${propId}。`)
    assertIndependent(historic, propId, '历史')
    if (present) {
      assertIndependent(current, propId, '当前')
      if (effectiveEditLockedV3(current, propId)) throw new Error(`当前恢复物件或图层已锁定：${propId}。`)
      assertSupportUnlocked(current, present)
    }

    // Restoring content never restores edit locks. Recreated props start unlocked.
    const restored: PropV2 = request.mode === 'entity'
      ? { ...structuredClone(historical), editLocked: present?.editLocked ?? false }
      : { ...structuredClone(present!), ...structuredClone(restoreFields(historical, request.mode)) }
    const layerId = request.mode === 'entity' ? historic.entityLayers[propId] : current.entityLayers[propId]
    assertTargetLayer(current, layerId, restored.floorId)
    assertSupportUnlocked(current, restored)
    // The chosen historical closure must agree even when instance fields are equal.
    if (request.mode !== 'transform') mergePropResources(candidate, historic, restored)
    const before = present ? restoreFields(present, request.mode) : null, after = restoreFields(restored, request.mode)
    if (present && equal(before, after) && current.entityLayers[propId] === layerId) continue

    candidate.props[propId] = restored
    candidate.entityLayers[propId] = layerId
    changes.push({ id: propId, name: historical.definitionRef ? historic.propDefinitions[historical.definitionRef.id].name : propId,
      action: present ? 'update' : 'recreate', layerId, beforeLayerId: present ? current.entityLayers[propId] : null,
      ...(request.mode === 'entity' ? { historicalEditLocked: historical.editLocked } : {}),
      before: structuredClone(before), after: structuredClone(after) })
  }

  const document = changes.length ? checkedScene(candidate, '恢复候选') : current
  validateHistoryIdentityV4(historyIdentity, document)
  projectSceneV3(document, 'player')
  return { request, historyIdentity, document, changes, changed: changes.length > 0 }
}
