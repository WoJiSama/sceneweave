import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import type { LicenseSubject } from '../v3/dependencies'
import { geometryIdentityIdsV3 } from '../v3/domain'
import { effectiveEditLockedV3 } from '../v3/layers'
import { validateSceneSnapshotV3 } from '../v3/snapshots'
import type { PrefabInstance, PropOverrideField, PropV2, SceneDocumentV3, SurfaceRef, SurfaceStyle } from '../v3/types'
import { projectSceneV3 } from '../../render/v3/projection'
import { assertStructureContinuityV4, type StructureContinuityV4 } from '../v4/structure-continuity'
import { addSurfaceAppearanceSourceV5, ensureSourceAssetRootsV5, freezeEffectivePropAppearanceV5, freezeEffectiveSurfaceAppearanceV5, inspectAppearanceScopeV5, setSurfaceStyleV5, surfaceStyleV5 } from './graph'
import { mergeHistoryIdentitiesV5, validateHistoryIdentityV5 } from './identity'
import { validateCompositionContentV5 } from './schema'
import type { CompositionContentV5 } from './types'

export type RestoreModeV5 = 'appearance' | 'source' | 'transform' | 'entity' | 'relationship' | 'layer'
export interface RestoreRequestV5 { ids: string[]; mode: RestoreModeV5 }
export interface RestoreEvidenceV5 { surfaceContinuity?: StructureContinuityV4 }
export interface RestoreChangeV5 {
  id: string
  kind: 'prop' | 'prefabInstance' | 'surface' | 'layer'
  name: string
  action: 'update' | 'recreate' | 'delete'
  layerId: string
  beforeLayerId: string | null
  historicalEditLocked?: boolean
  fields: string[]
  before: unknown
  after: unknown
}
export interface RestorePlanV5 extends CompositionContentV5 {
  request: RestoreRequestV5
  changes: RestoreChangeV5[]
  affectedIds: string[]
  commandCost: number
  inapplicableIds: string[]
  adoptedSubjects: Pick<LicenseSubject, 'subjectKind' | 'subjectId'>[]
  changed: boolean
}

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const requestSchema = z.object({ ids: z.array(id).min(1).max(256), mode: z.enum(['appearance', 'source', 'transform', 'entity', 'relationship', 'layer']) }).strict()
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
const copy = <T>(value: T): T => structuredClone(value)
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const content = (value: CompositionContentV5): CompositionContentV5 => ({ document: value.document, historyIdentity: value.historyIdentity, appearance: value.appearance })
const propAppearance = (prop: PropV2) => ({ definitionRef: prop.definitionRef, appearance: prop.appearance, visualBoundsMm: prop.visualBoundsMm,
  shadowClass: prop.shadowClass, shadowOverride: prop.shadowOverride })
const fields = (prop: PropV2, mode: RestoreModeV5): Partial<PropV2> => mode === 'transform' ? { positionMm: prop.positionMm, rotationDeg: prop.rotationDeg }
  : mode === 'appearance' || mode === 'source' ? propAppearance(prop) : prop
const appearanceFields: PropOverrideField[] = ['definitionRef', 'appearance', 'visualBoundsMm', 'shadowClass', 'shadowOverride']

function assertTargetLayer(scene: SceneDocumentV3, layerId: string, floorId: string) {
  const layer = own(scene.userLayers, layerId)
  if (!layer) throw new Error(`恢复目标图层不存在：${layerId}。`)
  if (layer.floorId !== floorId) throw new Error('恢复对象与目标图层必须属于同一 Floor。')
  if (layer.editLocked) throw new Error(`恢复目标图层已锁定：${layerId}。`)
}
function assertSupportUnlocked(scene: SceneDocumentV3, prop: PropV2) {
  const check = (ref: SurfaceRef): void => {
    if (ref.kind === 'floor') {
      if (!own(scene.floors, ref.id) || ref.id !== prop.floorId) throw new Error(`恢复物件 ${prop.id} 的支撑 Floor 不存在或不匹配。`)
      return
    }
    const support = ref.kind === 'room' ? own(scene.rooms, ref.id) : own(scene.terrainAreas, ref.id)
    if (!support || support.floorId !== prop.floorId) throw new Error(`恢复物件 ${prop.id} 的支撑依赖不存在或跨 Floor：${ref.id}。`)
    if (support.editLocked || scene.userLayers[scene.entityLayers[support.id]]?.editLocked) throw new Error(`恢复物件的支撑依赖或图层已锁定：${support.id}。`)
    if (ref.kind === 'room') check(scene.rooms[ref.id].supportRef)
  }
  check(prop.supportRef)
  if (prop.roomId !== undefined && (prop.supportRef.kind !== 'room' || prop.supportRef.id !== prop.roomId)) check({ kind: 'room', id: prop.roomId })
}
function owner(scene: SceneDocumentV3, propId: string): { group: PrefabInstance; key: string } | undefined {
  for (const group of Object.values(scene.prefabInstances)) for (const [key, member] of Object.entries(group.members)) if (member.propId === propId) return { group, key }
  return undefined
}
function assertSupportedDependencies(scene: SceneDocumentV3, entityId: string, label: string) {
  if (Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === entityId))) throw new Error(`${label}对象 ${entityId} 属于散布；本次恢复不隐式展开散布和排除记录。`)
  if (Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === entityId)) throw new Error(`${label}对象 ${entityId} 有锚点注记依赖，不能在此恢复。`)
  if (scene.constraints.pathChecks.some(check => [check.from, check.to].some(anchor => anchor.type === 'entity' && anchor.entityId === entityId))) throw new Error(`${label}对象 ${entityId} 有路径检查依赖，不能在此恢复。`)
}
function assertCurrentUnlocked(scene: SceneDocumentV3, entityId: string) {
  if (effectiveEditLockedV3(scene, entityId)) throw new Error(`当前恢复对象、父组合或图层已锁定：${entityId}。`)
  const prop = own(scene.props, entityId)
  if (prop) {
    assertSupportUnlocked(scene, prop)
    const parent = owner(scene, entityId)
    if (parent && effectiveEditLockedV3(scene, parent.group.id)) throw new Error(`当前恢复对象的父组合或图层已锁定：${parent.group.id}。`)
  }
}
function assertSameGroup(a: PrefabInstance, b: PrefabInstance) {
  if (!equal(a.definitionRef, b.definitionRef) || !equal(Object.keys(a.members).sort(), Object.keys(b.members).sort())) throw new Error(`组合固定版本或成员 key 映射已变化：${a.id}；请显式恢复完整组合关系。`)
}

/** Merge only selected immutable roots and their full source/bitmap/license subjects. */
function historicalClosure(candidate: CompositionContentV5, historic: CompositionContentV5, subjects: Map<string, Pick<LicenseSubject, 'subjectKind' | 'subjectId'>>) {
  const addSubject = (subjectKind: LicenseSubject['subjectKind'], subjectId: string) => subjects.set(`${subjectKind}:${subjectId}`, { subjectKind, subjectId })
  const merge = <T>(target: Record<string, T>, source: Record<string, T>, key: string, label: string): T => {
    const value = own(source, key)
    if (!value) throw new Error(`历史恢复缺少固定${label}：${key}。`)
    const present = own(target, key)
    if (present && !equal(present, value)) throw new Error(`历史${label} ID 与当前固定内容冲突：${key}。`)
    if (!present) target[key] = copy(value)
    return value
  }
  const seenAssets = new Set<string>(), seenSources = new Set<string>()
  const asset = (assetId: string): void => {
    if (seenAssets.has(assetId)) return
    seenAssets.add(assetId)
    merge(candidate.document.assets, historic.document.assets, assetId, '资源')
    addSubject('asset', assetId)
    for (const variant of Object.values(historic.appearance.variants)) if (variant.outputAssetId === assetId) {
      merge(candidate.appearance.variants, historic.appearance.variants, variant.id, '位图派生')
      asset(variant.sourceAssetId)
    }
  }
  const prop = (value: Pick<PropV2, 'definitionRef' | 'appearance'>) => {
    if (value.definitionRef) {
      const definition = merge(candidate.document.propDefinitions, historic.document.propDefinitions, value.definitionRef.id, '物件定义')
      if (definition.version !== value.definitionRef.version) throw new Error(`历史物件固定版本不匹配：${definition.id}。`)
      addSubject('propDefinition', definition.id)
      if (definition.defaultAppearance.kind === 'image') asset(definition.defaultAppearance.assetId)
    }
    if (value.appearance.kind === 'image') asset(value.appearance.assetId)
  }
  const surface = (style: SurfaceStyle) => {
    for (const paint of [style.base, ...style.overlays.map(overlay => overlay.paint)]) {
      const material = merge(candidate.document.materials, historic.document.materials, paint.materialRef.id, '材质')
      if (material.version !== paint.materialRef.version) throw new Error(`历史材质固定版本不匹配：${material.id}。`)
      addSubject('material', material.id)
      asset(material.textureAssetId)
    }
  }
  const source = (sourceId: string): void => {
    if (seenSources.has(sourceId)) return
    seenSources.add(sourceId)
    const value = merge(candidate.appearance.sources, historic.appearance.sources, sourceId, '外观源')
    if (value.parentSourceId) source(value.parentSourceId)
    if (value.kind === 'prop') prop(value.snapshot)
    else surface(value.snapshot)
  }
  const prefab = (group: PrefabInstance) => {
    const definition = merge(candidate.document.prefabDefinitions, historic.document.prefabDefinitions, group.definitionRef.id, '组合定义')
    if (definition.version !== group.definitionRef.version) throw new Error(`历史组合固定版本不匹配：${definition.id}。`)
    addSubject('prefabDefinition', definition.id)
    for (const member of definition.members) prop(member.propTemplate)
    const template = historic.appearance.prefabAppearanceTemplates[definition.id]
    if (template) {
      merge(candidate.appearance.prefabAppearanceTemplates, historic.appearance.prefabAppearanceTemplates, definition.id, '组合外观模板')
      for (const member of Object.values(template.members)) source(member.sourceId)
    }
  }
  return { prop, source, prefab, surface }
}

/** Pure draft. IO materializes any new layer/source combinations before Workspace exposes it. */
export function buildRestorePlanV5(currentInput: CompositionContentV5, historicInput: CompositionContentV5, requestInput: RestoreRequestV5, evidence: RestoreEvidenceV5 = {}): RestorePlanV5 {
  const issue = inspectJsonInput(requestInput)
  if (issue) throw new Error(`恢复选择无效：${issue.message}`)
  const parsed = requestSchema.safeParse(requestInput)
  if (!parsed.success) throw new Error(`恢复选择无效：一次须明确选择 1 至 256 个对象及受支持的属性组。${parsed.error.issues.map(value => value.message).join('；')}`)
  const request: RestoreRequestV5 = parsed.data
  if (new Set(request.ids).size !== request.ids.length) throw new Error('恢复对象 ID 不能重复。')
  const current = validateCompositionContentV5(content(currentInput)), historic = validateCompositionContentV5(content(historicInput))
  const candidate = copy(current)
  candidate.historyIdentity = mergeHistoryIdentitiesV5(current.historyIdentity, current.document, historic.historyIdentity, historic.document)
  const changes: RestoreChangeV5[] = [], affected = new Set<string>(), inapplicable = new Set<string>(), relationshipRecords = new Set<string>(), subjects = new Map<string, Pick<LicenseSubject, 'subjectKind' | 'subjectId'>>()
  const closure = historicalClosure(candidate, historic, subjects)
  const occupied = geometryIdentityIdsV3(current.document)
  for (const layerId of Object.keys(current.document.userLayers)) occupied.add(layerId)
  const reserve = (entityId: string) => {
    affected.add(entityId)
    if (affected.size + relationshipRecords.size > 256) throw new Error('恢复对象及组合关系展开超过单次 256 条预算，不能拆批绕过。')
  }
  const addChange = (change: RestoreChangeV5) => {
    if (!equal(change.before, change.after) || change.beforeLayerId !== change.layerId) changes.push(change)
  }
  const restoreProp = (propId: string, mode: RestoreModeV5, relationGroupId?: string) => {
    const historical = own(historic.document.props, propId), present = own(current.document.props, propId)
    if (!historical) throw new Error(`所选历史物件不存在：${propId}。`)
    if (!present && mode !== 'entity' && mode !== 'relationship') throw new Error(`已删除物件 ${propId} 只能显式选择完整物件或完整关系恢复。`)
    if (!present && occupied.has(propId)) throw new Error(`恢复物件 ID 已被当前其他身份占用：${propId}。`)
    assertSupportedDependencies(historic.document, propId, '历史')
    assertSupportedDependencies(current.document, propId, '当前')
    if (present) assertCurrentUnlocked(current.document, propId)
    const historicalOwner = owner(historic.document, propId), currentOwner = owner(current.document, propId)
    if (mode === 'entity' && (historicalOwner || currentOwner)) throw new Error('组合成员的完整实体恢复必须显式选择完整组合关系。')
    if (mode === 'relationship') {
      if (currentOwner && currentOwner.group.id !== relationGroupId) throw new Error(`历史成员 ${propId} 当前属于范围外组合 ${currentOwner.group.id}。`)
    } else if (historicalOwner || currentOwner) {
      if (!historicalOwner || !currentOwner || historicalOwner.group.id !== currentOwner.group.id || historicalOwner.key !== currentOwner.key) throw new Error(`物件 ${propId} 的组合关系已变化，请显式恢复完整组合关系。`)
      assertSameGroup(currentOwner.group, historicalOwner.group)
      reserve(currentOwner.group.id)
    }
    reserve(propId)
    const complete = mode === 'entity' || mode === 'relationship'
    const restored: PropV2 = complete ? { ...copy(historical), editLocked: present?.editLocked ?? false }
      : { ...copy(present!), ...copy(fields(historical, mode)) }
    const layerId = complete ? historic.document.entityLayers[propId] : current.document.entityLayers[propId]
    assertTargetLayer(current.document, layerId, restored.floorId)
    assertSupportUnlocked(current.document, restored)
    if (mode !== 'transform') closure.prop(historical)
    if (present && mode !== 'source' && mode !== 'relationship' && equal(fields(present, mode), fields(restored, mode)) && current.document.entityLayers[propId] === layerId) return
    candidate.document.props[propId] = restored
    candidate.document.entityLayers[propId] = layerId
    if (mode !== 'transform') {
      const sourceId = historic.appearance.propSources[propId]
      closure.source(sourceId)
      candidate.appearance.propSources[propId] = sourceId
      if (mode === 'source') {
        const adjustments = historic.appearance.instanceAdjustments[propId]
        if (adjustments) candidate.appearance.instanceAdjustments[propId] = copy(adjustments)
        else delete candidate.appearance.instanceAdjustments[propId]
      } else {
        // Freeze the effective historic pixels/parameters against today's continuous layer rule.
        const frozen = freezeEffectivePropAppearanceV5(candidate, propId, historical)
        // Keep the closure's mutable record identity while accepting the helper's immutable draft.
        Object.assign(candidate.document, frozen.document)
        Object.assign(candidate.appearance, frozen.appearance)
      }
    }
    if (currentOwner && mode !== 'relationship') {
      const group = candidate.document.prefabInstances[currentOwner.group.id], member = group.members[currentOwner.key]
      const overrides = mode === 'transform' ? ['positionMm', 'rotationDeg'] as PropOverrideField[] : appearanceFields
      member.overrideFields = [...new Set([...member.overrideFields, ...overrides])]
    }
    addChange({ id: propId, kind: 'prop', name: historical.definitionRef ? historic.document.propDefinitions[historical.definitionRef.id].name : propId,
      action: present ? 'update' : 'recreate', layerId, beforeLayerId: present ? current.document.entityLayers[propId] : null,
      ...(complete ? { historicalEditLocked: historical.editLocked } : {}), fields: Object.keys(fields(historical, mode)),
      before: present ? { ...fields(present, mode), sourceId: current.appearance.propSources[propId], adjustments: current.appearance.instanceAdjustments[propId] ?? [] } : null,
      after: { ...fields(candidate.document.props[propId], mode), sourceId: candidate.appearance.propSources[propId], adjustments: candidate.appearance.instanceAdjustments[propId] ?? [] } })
  }
  const restoreRelation = (groupId: string) => {
    const historical = own(historic.document.prefabInstances, groupId), present = own(current.document.prefabInstances, groupId)
    if (!historical) throw new Error(`所选历史组合不存在：${groupId}。`)
    if (!present && occupied.has(groupId)) throw new Error(`恢复组合 ID 已被当前其他身份占用：${groupId}。`)
    reserve(groupId)
    assertSupportedDependencies(current.document, groupId, '当前')
    assertSupportedDependencies(historic.document, groupId, '历史')
    if (present) assertCurrentUnlocked(current.document, groupId)
    const layerId = historic.document.entityLayers[groupId]
    assertTargetLayer(current.document, layerId, historical.floorId)
    closure.prefab(historical)
    for (const key of new Set([...Object.keys(historical.members), ...Object.keys(present?.members ?? {})])) {
      relationshipRecords.add(`${groupId}:${key}`)
      reserve(groupId)
    }
    const historicMembers = new Set(Object.values(historical.members).flatMap(member => member.propId === null ? [] : [member.propId]))
    for (const member of Object.values(present?.members ?? {})) if (member.propId && !historicMembers.has(member.propId)) {
      const propId = member.propId, prop = current.document.props[propId]
      reserve(propId); assertCurrentUnlocked(current.document, propId); assertSupportedDependencies(current.document, propId, '当前')
      delete candidate.document.props[propId]; delete candidate.document.entityLayers[propId]
      delete candidate.appearance.propSources[propId]; delete candidate.appearance.instanceAdjustments[propId]
      changes.push({ id: propId, kind: 'prop', name: propId, action: 'delete', layerId: current.document.entityLayers[propId], beforeLayerId: current.document.entityLayers[propId],
        fields: ['entity', 'membership'], before: copy(prop), after: null })
    }
    candidate.document.prefabInstances[groupId] = { ...copy(historical), editLocked: present?.editLocked ?? false }
    candidate.document.entityLayers[groupId] = layerId
    for (const propId of historicMembers) restoreProp(propId, 'relationship', groupId)
    // Empty/deleted slots and their manual override records are copied, never regenerated.
    addChange({ id: groupId, kind: 'prefabInstance', name: historic.document.prefabDefinitions[historical.definitionRef.id].name,
      action: present ? 'update' : 'recreate', layerId, beforeLayerId: present ? current.document.entityLayers[groupId] : null,
      historicalEditLocked: historical.editLocked, fields: ['definitionRef', 'members', 'anchorMm', 'rotationDeg', 'visibility'],
      before: present ? { ...copy(present), editLocked: false } : null, after: { ...copy(candidate.document.prefabInstances[groupId]), editLocked: false } })
  }
  const restoredProps = new Set<string>()
  const restoreSurface = (targetId: string) => {
    if (request.mode !== 'appearance' && request.mode !== 'source') throw new Error('表面仅支持外观或原源参数恢复；结构与地形请使用相应恢复入口。')
    const historicalStyle = surfaceStyleV5(historic.document, targetId), presentStyle = surfaceStyleV5(current.document, targetId)
    const collections = ['rooms', 'walls', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths'] as const
    const collection = collections.find(key => Object.hasOwn(current.document[key], targetId))
    if (!historicalStyle || !presentStyle || !collection || !Object.hasOwn(historic.document[collection], targetId)) throw new Error(`表面 ${targetId} 在当前或历史中不存在，或实体类型已变化。`)
    if (collection !== 'rooms' && collection !== 'walls') throw new Error('地形、崖边、通道与路径表面尚无可验证历史身份，本批不支持局部恢复；请等待 C4。')
    if (!evidence.surfaceContinuity) throw new Error('房间/墙表面恢复须有本会话结构连续性证明；重开或导入后请重新建立命名快照。')
    assertStructureContinuityV4(evidence.surfaceContinuity, current.document, historic.document, [targetId])
    if (current.document[collection][targetId].floorId !== historic.document[collection][targetId].floorId) throw new Error('表面 Floor 已变化，不能恢复外观。')
    if (!equal(presentStyle.overlays.map(value => value.id).sort(), historicalStyle.overlays.map(value => value.id).sort())) throw new Error('表面覆盖层集合已变化，外观恢复不能隐式恢复覆盖层几何。')
    reserve(targetId); assertCurrentUnlocked(current.document, targetId)
    assertSupportedDependencies(current.document, targetId, '当前')
    assertSupportedDependencies(historic.document, targetId, '历史')
    const paintFields = (paint: SurfaceStyle['base']) => ({ materialRef: copy(paint.materialRef), tint: paint.tint, opacity: paint.opacity })
    const preservingGeometry = (style: SurfaceStyle): SurfaceStyle => ({ base: { ...copy(presentStyle.base), ...paintFields(style.base) }, overlays: presentStyle.overlays.map(overlay => ({ ...copy(overlay), paint: { ...copy(overlay.paint), ...paintFields(style.overlays.find(value => value.id === overlay.id)!.paint) } })) })
    const sourceId = historic.appearance.surfaceSources[targetId]
    closure.source(sourceId); closure.surface(historicalStyle)
    const historicalSource = historic.appearance.sources[sourceId]
    if (historicalSource.kind !== 'surface') throw new Error('历史表面源类型不符。')
    candidate.appearance.surfaceSources[targetId] = sourceId
    if (request.mode === 'source') {
      candidate.appearance.surfaceSources[targetId] = addSurfaceAppearanceSourceV5(candidate.appearance, preservingGeometry(historicalSource.snapshot), sourceId)
      const adjustments = historic.appearance.instanceAdjustments[targetId]
      if (adjustments) candidate.appearance.instanceAdjustments[targetId] = copy(adjustments)
      else delete candidate.appearance.instanceAdjustments[targetId]
      setSurfaceStyleV5(candidate.document, targetId, preservingGeometry(historicalStyle))
    } else {
      const frozen = freezeEffectiveSurfaceAppearanceV5(candidate, targetId, preservingGeometry(historicalStyle))
      Object.assign(candidate.document, frozen.document); Object.assign(candidate.appearance, frozen.appearance)
      setSurfaceStyleV5(candidate.document, targetId, preservingGeometry(historicalStyle))
    }
    addChange({ id: targetId, kind: 'surface', name: targetId, action: 'update', layerId: current.document.entityLayers[targetId], beforeLayerId: current.document.entityLayers[targetId],
      fields: ['surfaceStyle', 'sourceId', 'adjustments'],
      before: { surfaceStyle: presentStyle, sourceId: current.appearance.surfaceSources[targetId], adjustments: current.appearance.instanceAdjustments[targetId] ?? [] },
      after: { surfaceStyle: surfaceStyleV5(candidate.document, targetId), sourceId: candidate.appearance.surfaceSources[targetId], adjustments: candidate.appearance.instanceAdjustments[targetId] ?? [] } })
  }
  for (const rootId of request.ids) {
    if (request.mode === 'relationship') { restoreRelation(rootId); continue }
    if (request.mode === 'layer') {
      const layer = current.document.userLayers[rootId]
      if (!layer || !historic.document.userLayers[rootId]) throw new Error(`恢复图层不存在：${rootId}。`)
      if (layer.editLocked) throw new Error(`恢复图层已锁定：${rootId}。`)
      reserve(rootId)
      const kinds = [...new Set([...(current.appearance.layerAdjustments[rootId] ?? []), ...(historic.appearance.layerAdjustments[rootId] ?? [])].filter(value => value.enabled).map(value => value.kind))]
      const targets = new Set<string>()
      for (const kind of kinds) {
        const scope = inspectAppearanceScopeV5(current, { kind: 'layer', layerId: rootId }, [kind])
        scope.targetIds.forEach(targetId => targets.add(targetId)); scope.inapplicableIds.forEach(targetId => inapplicable.add(targetId))
      }
      for (const targetId of targets) {
        reserve(targetId); assertCurrentUnlocked(current.document, targetId)
        const parent = owner(current.document, targetId)
        if (parent) { reserve(parent.group.id); assertCurrentUnlocked(current.document, parent.group.id) }
        assertSupportedDependencies(current.document, targetId, '当前')
      }
      const adjustments = historic.appearance.layerAdjustments[rootId]
      if (adjustments) candidate.appearance.layerAdjustments[rootId] = copy(adjustments)
      else delete candidate.appearance.layerAdjustments[rootId]
      addChange({ id: rootId, kind: 'layer', name: layer.name, action: 'update', layerId: rootId, beforeLayerId: rootId, fields: ['layerAdjustments'],
        before: copy(current.appearance.layerAdjustments[rootId] ?? []), after: copy(adjustments ?? []) })
      continue
    }
    if (current.appearance.surfaceSources[rootId] || historic.appearance.surfaceSources[rootId]) { restoreSurface(rootId); continue }
    const group = own(current.document.prefabInstances, rootId), historicalGroup = own(historic.document.prefabInstances, rootId)
    if (group || historicalGroup) {
      if (!group || !historicalGroup || request.mode === 'entity') throw new Error('组合不存在或请求完整实体；请显式选择完整组合关系恢复。')
      assertSameGroup(group, historicalGroup)
      assertCurrentUnlocked(current.document, rootId); assertSupportedDependencies(current.document, rootId, '当前')
      assertSupportedDependencies(historic.document, rootId, '历史'); reserve(rootId)
      for (const [key, member] of Object.entries(group.members)) {
        const historicalMember = historicalGroup.members[key]
        // Default appearance/transform restores never revive excluded/deleted slots.
        if (!member.propId || !historicalMember.propId) continue
        if (member.propId !== historicalMember.propId) throw new Error('组合成员身份映射已变化，请显式恢复完整组合关系。')
        if (restoredProps.has(member.propId)) throw new Error('组合和成员不能重复计入同一次恢复。')
        restoredProps.add(member.propId); restoreProp(member.propId, request.mode)
      }
      if (request.mode === 'transform') {
        candidate.document.prefabInstances[rootId].anchorMm = copy(historicalGroup.anchorMm)
        candidate.document.prefabInstances[rootId].rotationDeg = historicalGroup.rotationDeg
      }
    } else {
      if (restoredProps.has(rootId)) throw new Error('组合和成员不能重复计入同一次恢复。')
      restoredProps.add(rootId); restoreProp(rootId, request.mode)
    }
  }
  // Show relationship records changed by selected members, even when the parent was not a root.
  for (const groupId of affected) {
    const before = current.document.prefabInstances[groupId], after = candidate.document.prefabInstances[groupId]
    if (!before || !after || changes.some(change => change.id === groupId)) continue
    addChange({ id: groupId, kind: 'prefabInstance', name: current.document.prefabDefinitions[before.definitionRef.id].name, action: 'update',
      layerId: candidate.document.entityLayers[groupId], beforeLayerId: current.document.entityLayers[groupId], fields: ['members', 'anchorMm', 'rotationDeg'], before: copy(before), after: copy(after) })
  }
  // A different undo branch may lack the fixed roots of a historic source's ancestors.
  // Retain them before strict v3 checks, even while the effective candidate awaits materialization.
  const previousDefinitions = new Set(Object.keys(candidate.document.propDefinitions))
  Object.assign(candidate, ensureSourceAssetRootsV5(candidate))
  for (const definition of Object.values(candidate.document.propDefinitions)) if (!previousDefinitions.has(definition.id)) {
    subjects.set(`propDefinition:${definition.id}`, { subjectKind: 'propDefinition', subjectId: definition.id })
  }
  const checked = validateSceneSnapshotV3(candidate.document)
  if (!checked.ok) throw new Error(`恢复候选场景无效：${checked.errors.map(value => value.message).join('；')}`)
  candidate.document = checked.document
  validateHistoryIdentityV5(candidate.historyIdentity, candidate.document)
  // Re-run after materialization as well: a new layer bitmap may enlarge/alter its true player mask.
  projectSceneV3(candidate.document, 'player')
  const changed = !equal(current.document, candidate.document) || !equal(current.appearance, candidate.appearance)
  return { ...candidate, request, changes, affectedIds: [...affected].sort(), inapplicableIds: [...inapplicable].sort(), commandCost: affected.size + relationshipRecords.size, adoptedSubjects: [...subjects.values()], changed }
}

