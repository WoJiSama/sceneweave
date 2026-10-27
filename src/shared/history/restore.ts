import { visualBase } from '../visual/base.js'
import { z } from 'zod'
import { inspectJsonInput, cloneJson } from '../validation/json.js'
import type { LicenseSubject } from '../commands/dependencies.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { effectiveEditLocked } from '../commands/layers.js'
import { canonicalTerrainEdge, outdoorDependencies } from '../commands/outdoor.js'
import { polygonDistance, propFootprint } from '../geometry/geometry.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import type { PrefabInstance, PropOverrideField, Prop, SceneDocument, SurfaceRef, SurfaceStyle } from '../model/scene.js'
import { projectScene } from '../projection/projection.js'
import { assertStructureContinuity, type StructureContinuity } from './structure-continuity.js'
import { addSurfaceAppearanceSource, ensureSourceAssetRoots, freezeEffectivePropAppearance, freezeEffectiveSurfaceAppearance, inspectAppearanceScope, propAppearanceSnapshot, setSurfaceStyle, surfaceStyle } from '../appearance/graph.js'
import { assertOutdoorContinuity, mergeHistoryIdentities, validateHistoryIdentity } from './identity.js'
import { validateCompositionContent } from '../validation/content.js'
import type { CompositionContent } from '../model/appearance.js'
import { applyVisualCommand, type VisualCommand } from '../visual/commands.js'
import { VISUAL_ENTITY_COLLECTIONS, visualBindingEntityIds } from '../visual/diagnostics.js'
import type { VisualEntity, VisualBoundary, VisualSystem } from '../visual/types.js'
import { assertVisualContinuity, type VisualContinuity, visualTopology } from './visual-continuity.js'
import { outdoorIdentityDescriptors } from './identity.js'
import { detachChangedAppearance } from '../terrain-generation/appearance-lifecycle.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'


export type RestoreMode = 'appearance' | 'source' | 'transform' | 'entity' | 'relationship' | 'layer' | 'outdoorGeometry' | 'outdoorProperties' | 'scatterMembers' | 'visual'
export interface RestoreRequest { ids: string[]; mode: RestoreMode }
export interface RestoreEvidence { surfaceContinuity?: StructureContinuity; visualContinuity?: VisualContinuity }
export interface RestoreChange {
  id: string
  kind: 'prop' | 'prefabInstance' | 'surface' | 'layer' | 'outdoor' | 'scatterGroup' | 'visual' | 'generation'
  name: string
  action: 'update' | 'recreate' | 'delete'
  layerId: string
  beforeLayerId: string | null
  historicalEditLocked?: boolean
  fields: string[]
  before: unknown
  after: unknown
}
export interface RestorePlan extends CompositionContent {
  request: RestoreRequest
  changes: RestoreChange[]
  affectedIds: string[]
  commandCost: number
  inapplicableIds: string[]
  adoptedSubjects: Pick<LicenseSubject, 'subjectKind' | 'subjectId'>[]
  changed: boolean
}

/** Derived from final results as well as the initial pure restore draft. */
export function generationRestoreChanges(beforeDocument: SceneDocument, afterDocument: SceneDocument): RestoreChange[] {
  if (beforeDocument.schemaVersion !== 3 || afterDocument.schemaVersion !== 3) return []
  const changes: RestoreChange[] = []
  for (const collection of ['ownership', 'rules', 'checks', 'exclusions'] as const) {
    const before = beforeDocument.generation![collection], after = afterDocument.generation![collection]
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const previous = before[id], next = after[id]
      if (equal(previous, next)) continue
      const layerId = next && 'layerId' in next ? next.layerId : afterDocument.generation!.rules[
        next && 'ruleId' in next ? next.ruleId : previous && 'ruleId' in previous ? previous.ruleId : ''
      ]?.layerId ?? ''
      changes.push({ id, kind: 'generation', name: `生成${collection} · ${id}`, action: previous ? next ? 'update' : 'delete' : 'recreate',
        layerId, beforeLayerId: layerId || null, fields: ['generation', collection], before: copy(previous ?? null), after: copy(next ?? null) })
    }
  }
  return changes
}

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const requestSchema = z.object({ ids: z.array(id).min(1).max(256), mode: z.enum(['appearance', 'source', 'transform', 'entity', 'relationship', 'layer', 'outdoorGeometry', 'outdoorProperties', 'scatterMembers', 'visual']) }).strict()
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
const copy = <T>(value: T): T => cloneJson(value)
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const propAppearance = propAppearanceSnapshot
const fields = (prop: Prop, mode: RestoreMode): Partial<Prop> => mode === 'transform' ? { positionMm: prop.positionMm, rotationDeg: prop.rotationDeg }
  : mode === 'appearance' || mode === 'source' ? propAppearance(prop) : prop
const appearanceFields: PropOverrideField[] = ['definitionRef', 'appearance', 'visualBoundsMm', 'shadowClass', 'shadowOverride']
function restoredProp(present: Prop | undefined, historical: Prop, mode: RestoreMode, complete: boolean): Prop {
  if (complete) return { ...copy(historical), editLocked: present?.editLocked ?? false }
  return { ...copy(present!), ...copy(fields(historical, mode)) }
}

function assertTargetLayer(scene: SceneDocument, layerId: string, floorId: string) {
  const layer = own(scene.userLayers, layerId)
  if (!layer) throw new Error(`恢复目标图层不存在：${layerId}。`)
  if (layer.floorId !== floorId) throw new Error('恢复对象与目标图层必须属于同一 Floor。')
  if (layer.editLocked) throw new Error(`恢复目标图层已锁定：${layerId}。`)
}
function assertSupportUnlocked(scene: SceneDocument, prop: Prop) {
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
function owner(scene: SceneDocument, propId: string): { group: PrefabInstance; key: string } | undefined {
  for (const group of Object.values(scene.prefabInstances)) for (const [key, member] of Object.entries(group.members)) if (member.propId === propId) return { group, key }
  return undefined
}
function assertSupportedDependencies(scene: SceneDocument, entityId: string, label: string) {
  if (Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === entityId))) throw new Error(`${label}对象 ${entityId} 属于散布；本次恢复不隐式展开散布和排除记录。`)
  if (Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === entityId)) throw new Error(`${label}对象 ${entityId} 有锚点注记依赖，不能在此恢复。`)
  if (scene.constraints.pathChecks.some(check => [check.from, check.to].some(anchor => anchor.type === 'entity' && anchor.entityId === entityId))) throw new Error(`${label}对象 ${entityId} 有路径检查依赖，不能在此恢复。`)
}
function assertCurrentUnlocked(scene: SceneDocument, entityId: string) {
  if (effectiveEditLocked(scene, entityId)) throw new Error(`当前恢复对象、父组合或图层已锁定：${entityId}。`)
  const prop = own(scene.props, entityId)
  if (prop) {
    assertSupportUnlocked(scene, prop)
    const parent = owner(scene, entityId)
    if (parent && effectiveEditLocked(scene, parent.group.id)) throw new Error(`当前恢复对象的父组合或图层已锁定：${parent.group.id}。`)
  }
}
function assertSameGroup(a: PrefabInstance, b: PrefabInstance) {
  if (!equal(a.definitionRef, b.definitionRef) || !equal(Object.keys(a.members).sort(), Object.keys(b.members).sort())) throw new Error(`组合固定版本或成员 key 映射已变化：${a.id}；请显式恢复完整组合关系。`)
}

/** Merge only selected immutable roots and their full source/bitmap/license subjects. */
function historicalClosure(candidate: CompositionContent, historic: CompositionContent, subjects: Map<string, Pick<LicenseSubject, 'subjectKind' | 'subjectId'>>) {
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
  const prop = (value: Pick<Prop, 'definitionRef' | 'appearance'>) => {
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
    if (candidate.appearance.version === 2 && value.kind === 'prop') {
      if (historic.appearance.version !== 2 || !historic.appearance.presentations || !candidate.appearance.presentations) throw new Error('历史固定物件表现版本不匹配。')
      merge(candidate.appearance.presentations, historic.appearance.presentations, sourceId, '物件表现')
    }
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
export function buildRestorePlan(currentInput: CompositionContent, historicInput: CompositionContent, requestInput: RestoreRequest, evidence: RestoreEvidence = {}): RestorePlan {
  const issue = inspectJsonInput(requestInput)
  if (issue) throw new Error(`恢复选择无效：${issue.message}`)
  const parsed = requestSchema.safeParse(requestInput)
  if (!parsed.success) throw new Error(`恢复选择无效：一次须明确选择 1 至 256 个对象及受支持的属性组。${parsed.error.issues.map(value => value.message).join('；')}`)
  const request: RestoreRequest = parsed.data
  if (new Set(request.ids).size !== request.ids.length) throw new Error('恢复对象 ID 不能重复。')
  const current = validateCompositionContent(currentInput), historic = validateCompositionContent(historicInput)
  const candidate = copy(current)
  candidate.historyIdentity = mergeHistoryIdentities(current.historyIdentity, current.document, historic.historyIdentity, historic.document)
  const changes: RestoreChange[] = [], affected = new Set<string>(), writes = new Set<string>(), inapplicable = new Set<string>(), relationshipRecords = new Set<string>(), subjects = new Map<string, Pick<LicenseSubject, 'subjectKind' | 'subjectId'>>()
  let visualCost = 0
  const closure = historicalClosure(candidate, historic, subjects)
  const occupied = geometryIdentityIds(current.document)
  for (const layerId of Object.keys(current.document.userLayers)) occupied.add(layerId)
  const reserve = (entityId: string) => {
    affected.add(entityId); writes.add(entityId)
    if (writes.size + relationshipRecords.size + visualCost > 256) throw new Error('恢复对象及组合关系展开超过单次 256 条预算，不能拆批绕过。')
  }
  const addChange = (change: RestoreChange) => {
    if (!equal(change.before, change.after) || change.beforeLayerId !== change.layerId) changes.push(change)
  }
  const restoreProp = (propId: string, mode: RestoreMode, relationGroupId?: string) => {
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
    const restored = restoredProp(present, historical, mode, complete)
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
        const frozen = freezeEffectivePropAppearance(candidate, propId, historical)
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
  const outdoorCollections = ['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'scatterGroups'] as const
  const proveOutdoor = (targetId: string) => {
    const roots = new Set<string>([targetId]), visit = (id: string): void => {
      const area = current.document.terrainAreas[id], edge = current.document.terrainEdges[id], connection = current.document.terrainConnections[id], path = current.document.paths[id], group = current.document.scatterGroups[id]
      if (area) area.boundaryMm.forEach(point => { roots.add(point.id); roots.add(point.segmentId) })
      const refs: string[] = edge ? [edge.source.areaId, ...(edge.neighborAreaId ? [edge.neighborAreaId] : [])] : connection ? [connection.from.surfaceRef.id, connection.to.surfaceRef.id] : path ? path.supportRefs.map(ref => ref.id) : group ? [group.domain.kind === 'area' ? group.domain.areaId : group.domain.kind === 'path' ? group.domain.pathId : group.domain.edgeId] : []
      for (const ref of refs) if (current.historyIdentity.outdoorTokens[ref] && !roots.has(ref)) { roots.add(ref); visit(ref) }
    }
    visit(targetId)
    assertOutdoorContinuity(current.historyIdentity, historic.historyIdentity, [...roots])
  }
  const inspectOutdoorImpact = (ids: readonly string[], meaningChanged: boolean) => {
    const dependencies = outdoorDependencies(current.document, ids)
    for (const id of dependencies) { affected.add(id); if (meaningChanged || ids.includes(id)) assertCurrentUnlocked(current.document, id) }
    return dependencies
  }
  const restoreVisual = (targetId: string) => {
    if (!evidence.visualContinuity) throw new Error('视觉恢复须有本会话连续性证明；请先建立命名快照。')
    const currentVisual = visualBase(current.document), historicVisual = visualBase(historic.document)
    if (!currentVisual || !historicVisual) throw new Error('视觉恢复只支持当前与历史均有完整视觉系统的快照。')
    assertVisualContinuity(evidence.visualContinuity, current.document, historic.document, [targetId])
    const before = copy(candidate.document)
    let command: VisualCommand, layerId: string
    if (targetId === current.document.sceneId) {
      for (const layer of Object.values(current.document.userLayers)) if (layer.editLocked) throw new Error(`全景环境恢复涉及锁定图层：${layer.id}。`)
      command = { type: 'setVisualEnvironment', environment: copy(historicVisual.environment) }
      layerId = ''
    } else {
      const collection = VISUAL_ENTITY_COLLECTIONS.find(key => Object.hasOwn(currentVisual[key], targetId))
      if (!collection || !Object.hasOwn(historicVisual[collection], targetId)) throw new Error('视觉恢复只支持同类型现存对象；不重建已删除对象。')
      const present = currentVisual[collection][targetId] as VisualEntity
      const historical = historicVisual[collection][targetId] as VisualEntity
      if (present.floorId !== historical.floorId || visualTopology(current.document).get(targetId) !== visualTopology(historic.document).get(targetId)) throw new Error('视觉绑定、作用范围或控制段拓扑已变化，不能恢复旧参数。')
      const restored = { ...copy(historical), id: present.id, floorId: present.floorId, layerId: present.layerId, visibility: present.visibility, editLocked: present.editLocked }
      layerId = present.layerId
      if (collection === 'boundaries') {
        const curve = restored as VisualBoundary
        for (const rootId of visualBindingEntityIds(curve)) proveOutdoor(rootId)
        if (curve.binding.kind === 'path') {
          const pathId = curve.binding.pathId
          if (current.document.paths[pathId].centerlineMm.length !== historic.document.paths[pathId].centerlineMm.length) throw new Error('道路曲线采样拓扑已变化，不能恢复旧曲线。')
        }
        command = { type: 'upsertVisualBoundary', boundary: curve }
      } else if (collection === 'edgeLooks') command = { type: 'upsertVisualEdgeLook', edgeLook: restored as VisualSystem['edgeLooks'][string] }
      else if (collection === 'lights') command = { type: 'upsertVisualLight', light: restored as VisualSystem['lights'][string] }
      else if (collection === 'fogs') command = { type: 'upsertVisualFog', fog: restored as VisualSystem['fogs'][string] }
      else command = { type: 'upsertVisualFilter', filter: restored as VisualSystem['filters'][string] }
    }
    // A partial restore must never allocate or resurrect a physical point/segment identity.
    const impact = applyVisualCommand(candidate.document, command, {
      ids: { nextId: () => { throw new Error('曲线恢复需要新增采样拓扑；本阶段只支持相同拓扑的参数恢复。') } },
      clock: { now: () => current.document.updatedAt },
    })
    const oldTopology = outdoorIdentityDescriptors(before), nextTopology = outdoorIdentityDescriptors(candidate.document)
    if (!equal(oldTopology, nextTopology)) throw new Error('曲线恢复改变物理采样拓扑；不能隐式重绑或重建。')
    visualCost += Math.max(1, impact.commandCost)
    if (writes.size + relationshipRecords.size + visualCost > 256) throw new Error('视觉对象、控制段和物理采样展开超过单次256条恢复预算，不能拆批绕过。')
    impact.affectedIds.forEach(value => affected.add(value)); affected.add(targetId)
    const visual = (scene: SceneDocument) => targetId === scene.sceneId ? visualBase(scene)!.environment
      : VISUAL_ENTITY_COLLECTIONS.flatMap(key => Object.values(visualBase(scene)![key])).find(value => value.id === targetId)
    const restoredValue = visual(candidate.document), previousValue = visual(before)
    addChange({ id: targetId, kind: 'visual', name: targetId === current.document.sceneId ? '全景环境' : targetId, action: 'update', layerId, beforeLayerId: layerId,
      fields: Object.keys(restoredValue as object).filter(key => !['id', 'floorId', 'layerId', 'visibility', 'editLocked'].includes(key)), before: copy(previousValue), after: copy(restoredValue) })
    for (const entityId of impact.changedIds) {
      if (entityId === targetId) continue
      const collection = outdoorCollections.find(key => Object.hasOwn(before[key], entityId))
      if (!collection) continue
      const a = before[collection][entityId], b = candidate.document[collection][entityId]
      addChange({ id: entityId, kind: 'outdoor', name: entityId, action: 'update', layerId: candidate.document.entityLayers[entityId], beforeLayerId: before.entityLayers[entityId],
        fields: collection === 'terrainAreas' ? ['boundaryMm'] : ['centerlineMm'], before: copy(a), after: copy(b) })
    }
  }
  const restoreOutdoor = (targetId: string) => {
    const collection = outdoorCollections.find(key => Object.hasOwn(current.document[key], targetId))
    if (!collection || collection === 'scatterGroups' || !Object.hasOwn(historic.document[collection], targetId)) throw new Error('此模式只恢复现存地形、来源边缘、连接或道路；不重建实体或历史拓扑。')
    if ((collection === 'terrainAreas' || collection === 'paths') && Object.values(visualBase(current.document)?.boundaries ?? {}).some(curve => visualBindingEntityIds(curve).includes(targetId))) throw new Error('此几何由视觉曲线控制；请显式选择曲线的visual参数恢复。')
    proveOutdoor(targetId); inspectOutdoorImpact([targetId], true); reserve(targetId)
    const present = current.document[collection][targetId], historical = historic.document[collection][targetId]
    if (present.floorId !== historical.floorId) throw new Error('室外对象Floor变化，不能恢复。')
    const keys: string[] = collection === 'terrainAreas' ? ['boundaryMm', 'groundElevationMm'] : collection === 'terrainConnections' ? ['from', 'to', 'widthMm'] : collection === 'paths' ? ['centerlineMm', 'widthMm'] : []
    if (request.mode === 'outdoorProperties') keys.push(...(collection === 'terrainAreas' ? ['visibility', 'coveragePriority', 'blocksMovement', 'blocksSight', 'movementCostMultiplier'] : collection === 'terrainEdges' ? ['visibility', 'kind', 'shoreline', 'blocksMovement', 'blocksSight', 'styleOverride'] : collection === 'terrainConnections' ? ['visibility', 'kind', 'blocksMovement', 'movementCostMultiplier'] : ['visibility', 'movementCostMultiplier', 'renderOrder']))
    if (!keys.length) throw new Error('来源边缘的位置由来源地形段决定；请恢复来源地形，或明确选择边缘业务属性。')
    const before = present as unknown as Record<string, unknown>, source = historical as unknown as Record<string, unknown>, after = candidate.document[collection][targetId] as unknown as Record<string, unknown>
    for (const key of keys) after[key] = copy(source[key])
    addChange({ id: targetId, kind: 'outdoor', name: targetId, action: 'update', layerId: current.document.entityLayers[targetId], beforeLayerId: current.document.entityLayers[targetId], fields: keys,
      before: Object.fromEntries(keys.map(key => [key, copy(before[key])])), after: Object.fromEntries(keys.map(key => [key, copy(after[key])])) })
  }
  const scatterOwner = (scene: SceneDocument, propId: string) => {
    for (const group of Object.values(scene.scatterGroups)) for (const [key, member] of Object.entries(group.members)) if (member.propId === propId) return { group, key, member }
    return undefined
  }
  if (request.mode === 'scatterMembers') {
    const scope = new Set<string>()
    for (const propId of request.ids) {
      const historical = scatterOwner(historic.document, propId)
      if (!historical) continue
      scope.add(propId); scope.add(historical.group.id); scope.add('member:' + historical.group.id + ':' + historical.key)
      for (const exclusion of current.document.scatterGroups[historical.group.id]?.exclusions ?? []) if (exclusion.reason === 'delete' && exclusion.sourceCandidateKey === historical.key) scope.add('exclusion:' + exclusion.id)
    }
    if (scope.size > 256) throw new Error('散布成员、关系与排除记录展开超过256条预算。')
  }
  const restoreScatterProp = (propId: string, explicit: boolean) => {
    const historicOwner = scatterOwner(historic.document, propId), historical = historic.document.props[propId], present = current.document.props[propId]
    if (!historicOwner || !historical) throw new Error(`快照缺少真实历史散布成员：${propId}。`)
    const groupId = historicOwner.group.id, currentGroup = current.document.scatterGroups[groupId], currentOwner = scatterOwner(current.document, propId)
    if (!currentGroup) throw new Error('历史散布组在当前不存在，不能隐式重建整组。')
    proveOutdoor(groupId); assertCurrentUnlocked(current.document, groupId); inspectOutdoorImpact([groupId], false)
    if (!current.historyIdentity.propTokens[propId] || current.historyIdentity.propTokens[propId] !== historic.historyIdentity.propTokens[propId]) throw new Error('历史散布成员缺少同一出生身份。')
    if (currentOwner && (currentOwner.group.id !== groupId || currentOwner.key !== historicOwner.key)) throw new Error('成员当前属于范围外散布关系，不能隐式移回。')
    if (owner(current.document, propId)) throw new Error('历史散布成员当前属于组合，不能隐式取出。')
    if (present) assertCurrentUnlocked(current.document, propId)
    if (!explicit && (!present || !currentOwner || currentGroup.members[historicOwner.key]?.propId !== propId)) throw new Error('默认外观/位置恢复只处理当前仍存活且同候选槽的成员；请显式选择历史散布成员恢复。')
    if (!explicit && !['appearance', 'source', 'transform'].includes(request.mode)) throw new Error('散布完整关系须从显式历史成员入口恢复。')
    if (Object.values(current.document.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === propId) && !present) throw new Error('已删除历史成员仍有悬空注记依赖。')
    const layerId = current.document.entityLayers[groupId]
    assertTargetLayer(current.document, layerId, historical.floorId)
    const target = restoredProp(present, historical, request.mode, explicit)
    assertSupportUnlocked(current.document, target)
    reserve(propId)
    if (explicit) {
      const occupant = currentGroup.members[historicOwner.key]
      if (occupant?.propId && occupant.propId !== propId) throw new Error('历史候选槽当前已有另一个出生身份；请先明确处理该成员，不能隐式删除。')
      const restoredGroup = candidate.document.scatterGroups[groupId], removed = restoredGroup.exclusions.filter(item => item.reason === 'delete' && item.sourceCandidateKey === historicOwner.key)
      const retained = restoredGroup.exclusions.filter(item => !removed.some(value => value.id === item.id))
      if (retained.some(exclusion => polygonDistance(propFootprint(target), exclusion.boundaryMm) <= 1e-7)) throw new Error('历史成员位置与保留的人工/入口或其他删除排除区冲突。')
      reserve(groupId); relationshipRecords.add(`${groupId}:${historicOwner.key}`)
      for (const exclusion of removed) { relationshipRecords.add(`exclusion:${exclusion.id}`); affected.add(exclusion.id) }
      restoredGroup.exclusions = retained
      restoredGroup.members[historicOwner.key] = copy(historicOwner.member)
      addChange({ id: groupId, kind: 'scatterGroup', name: groupId, action: 'update', layerId, beforeLayerId: layerId, fields: ['selectedMember', 'selectedDeleteExclusions'],
        before: { candidateKey: historicOwner.key, member: copy(occupant ?? null), exclusions: copy(removed) },
        after: { candidateKey: historicOwner.key, member: copy(restoredGroup.members[historicOwner.key]), exclusions: [] } })
    } else {
      const member = candidate.document.scatterGroups[groupId].members[historicOwner.key]
      reserve(groupId); relationshipRecords.add(`${groupId}:${historicOwner.key}`)
      const overrides: PropOverrideField[] = request.mode === 'transform' ? ['positionMm', 'rotationDeg'] : appearanceFields
      member.state = 'manual'; member.overrideFields = [...new Set([...member.overrideFields, ...overrides])]
      addChange({ id: groupId, kind: 'scatterGroup', name: groupId, action: 'update', layerId, beforeLayerId: layerId,
        fields: ['selectedMember'], before: { candidateKey: historicOwner.key, member: copy(currentGroup.members[historicOwner.key]) },
        after: { candidateKey: historicOwner.key, member: copy(member) } })
    }
    candidate.document.props[propId] = target; candidate.document.entityLayers[propId] = explicit ? layerId : current.document.entityLayers[propId]
    if (request.mode !== 'transform') {
      closure.prop(historical); const sourceId = historic.appearance.propSources[propId]; closure.source(sourceId); candidate.appearance.propSources[propId] = sourceId
      if (request.mode === 'source') {
        const adjustments = historic.appearance.instanceAdjustments[propId]
        if (adjustments) candidate.appearance.instanceAdjustments[propId] = copy(adjustments); else delete candidate.appearance.instanceAdjustments[propId]
      } else { const frozen = freezeEffectivePropAppearance(candidate, propId, historical); Object.assign(candidate.document, frozen.document); Object.assign(candidate.appearance, frozen.appearance) }
    }
    if (writes.size + relationshipRecords.size > 256) throw new Error('散布成员、关系与排除记录展开超过256条预算。')
    addChange({ id: propId, kind: 'prop', name: propId, action: present ? 'update' : 'recreate', layerId: candidate.document.entityLayers[propId], beforeLayerId: present ? current.document.entityLayers[propId] : null,
      fields: explicit ? ['entity', 'appearance', 'selectedMembership'] : Object.keys(fields(historical, request.mode)),
      before: present ? { entity: copy(present), sourceId: current.appearance.propSources[propId], adjustments: copy(current.appearance.instanceAdjustments[propId] ?? []) } : null,
      after: { entity: copy(candidate.document.props[propId]), sourceId: candidate.appearance.propSources[propId], adjustments: copy(candidate.appearance.instanceAdjustments[propId] ?? []) } })
  }
  const restoredProps = new Set<string>()
  const restoreSurface = (targetId: string) => {
    if (request.mode !== 'appearance' && request.mode !== 'source') throw new Error('表面仅支持外观或原源参数恢复；结构与地形请使用相应恢复入口。')
    const historicalStyle = surfaceStyle(historic.document, targetId), presentStyle = surfaceStyle(current.document, targetId)
    const collections = ['rooms', 'walls', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths'] as const
    const collection = collections.find(key => Object.hasOwn(current.document[key], targetId))
    if (!historicalStyle || !presentStyle || !collection || !Object.hasOwn(historic.document[collection], targetId)) throw new Error(`表面 ${targetId} 在当前或历史中不存在，或实体类型已变化。`)
    if (collection === 'rooms' || collection === 'walls') {
      if (!evidence.surfaceContinuity) throw new Error('房间/墙表面恢复须有本会话结构连续性证明；重开或导入后请重新建立命名快照。')
      assertStructureContinuity(evidence.surfaceContinuity, current.document, historic.document, [targetId])
    } else {
      proveOutdoor(targetId)
      inspectOutdoorImpact([targetId], false)
    }
    if (current.document[collection][targetId].floorId !== historic.document[collection][targetId].floorId) throw new Error('表面 Floor 已变化，不能恢复外观。')
    if (!equal(presentStyle.overlays.map(value => value.id).sort(), historicalStyle.overlays.map(value => value.id).sort())) throw new Error('表面覆盖层集合已变化，外观恢复不能隐式恢复覆盖层几何。')
    reserve(targetId); assertCurrentUnlocked(current.document, targetId)
    if (collection === 'rooms' || collection === 'walls') { assertSupportedDependencies(current.document, targetId, '当前'); assertSupportedDependencies(historic.document, targetId, '历史') }
    const paintFields = (paint: SurfaceStyle['base']) => ({ materialRef: copy(paint.materialRef), tint: paint.tint, opacity: paint.opacity })
    const preservingGeometry = (style: SurfaceStyle): SurfaceStyle => ({ base: { ...copy(presentStyle.base), ...paintFields(style.base) }, overlays: presentStyle.overlays.map(overlay => ({ ...copy(overlay), paint: { ...copy(overlay.paint), ...paintFields(style.overlays.find(value => value.id === overlay.id)!.paint) } })) })
    const sourceId = historic.appearance.surfaceSources[targetId]
    closure.source(sourceId); closure.surface(historicalStyle)
    const historicalSource = historic.appearance.sources[sourceId]
    if (historicalSource.kind !== 'surface') throw new Error('历史表面源类型不符。')
    candidate.appearance.surfaceSources[targetId] = sourceId
    if (request.mode === 'source') {
      candidate.appearance.surfaceSources[targetId] = addSurfaceAppearanceSource(candidate.appearance, preservingGeometry(historicalSource.snapshot), sourceId)
      const adjustments = historic.appearance.instanceAdjustments[targetId]
      if (adjustments) candidate.appearance.instanceAdjustments[targetId] = copy(adjustments)
      else delete candidate.appearance.instanceAdjustments[targetId]
      setSurfaceStyle(candidate.document, targetId, preservingGeometry(historicalStyle))
    } else {
      const frozen = freezeEffectiveSurfaceAppearance(candidate, targetId, preservingGeometry(historicalStyle))
      Object.assign(candidate.document, frozen.document); Object.assign(candidate.appearance, frozen.appearance)
      setSurfaceStyle(candidate.document, targetId, preservingGeometry(historicalStyle))
    }
    addChange({ id: targetId, kind: 'surface', name: targetId, action: 'update', layerId: current.document.entityLayers[targetId], beforeLayerId: current.document.entityLayers[targetId],
      fields: ['surfaceStyle', 'sourceId', 'adjustments'],
      before: { surfaceStyle: presentStyle, sourceId: current.appearance.surfaceSources[targetId], adjustments: current.appearance.instanceAdjustments[targetId] ?? [] },
      after: { surfaceStyle: surfaceStyle(candidate.document, targetId), sourceId: candidate.appearance.surfaceSources[targetId], adjustments: candidate.appearance.instanceAdjustments[targetId] ?? [] } })
  }
  for (const rootId of request.ids) {
    if (request.mode === 'visual') { restoreVisual(rootId); continue }
    if (request.mode === 'outdoorGeometry' || request.mode === 'outdoorProperties') { restoreOutdoor(rootId); continue }
    if (request.mode === 'scatterMembers') { restoreScatterProp(rootId, true); continue }
    if (scatterOwner(current.document, rootId) || scatterOwner(historic.document, rootId)) { restoreScatterProp(rootId, false); continue }
    if (request.mode === 'relationship') { restoreRelation(rootId); continue }
    if (request.mode === 'layer') {
      const layer = current.document.userLayers[rootId]
      if (!layer || !historic.document.userLayers[rootId]) throw new Error(`恢复图层不存在：${rootId}。`)
      if (layer.editLocked) throw new Error(`恢复图层已锁定：${rootId}。`)
      reserve(rootId)
      const kinds = [...new Set([...(current.appearance.layerAdjustments[rootId] ?? []), ...(historic.appearance.layerAdjustments[rootId] ?? [])].filter(value => value.enabled).map(value => value.kind))]
      const targets = new Set<string>()
      for (const kind of kinds) {
        const scope = inspectAppearanceScope(current, { kind: 'layer', layerId: rootId }, [kind])
        scope.targetIds.forEach(targetId => targets.add(targetId)); scope.inapplicableIds.forEach(targetId => inapplicable.add(targetId))
      }
      for (const targetId of targets) {
        reserve(targetId); assertCurrentUnlocked(current.document, targetId)
        const parent = owner(current.document, targetId)
        if (parent) { reserve(parent.group.id); assertCurrentUnlocked(current.document, parent.group.id) }
        if (!scatterOwner(current.document, targetId)) assertSupportedDependencies(current.document, targetId, '当前')
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
  if (request.mode === 'outdoorGeometry' || request.mode === 'outdoorProperties') {
    for (const id of outdoorDependencies(candidate.document, request.ids)) { affected.add(id); if (current.document.entityLayers[id]) assertCurrentUnlocked(current.document, id) }
    for (const edge of Object.values(candidate.document.terrainEdges)) {
      if (!affected.has(edge.id)) continue
      const canonical = canonicalTerrainEdge(candidate.document, edge.source)
      if (!equal(canonical.source, edge.source) || canonical.neighborAreaId !== edge.neighborAreaId) throw new Error(`地形恢复会改变来源边缘拓扑：${edge.id}；本批不隐式重绑或重建。`)
      if (canonical.requiresCliff && (edge.kind !== 'cliff' || !edge.blocksMovement)) {
        if (request.ids.includes(edge.id) && request.mode === 'outdoorProperties') throw new Error('所选历史边缘属性与当前高差阻挡要求冲突。')
        reserve(edge.id); assertCurrentUnlocked(current.document, edge.id)
        const before = { kind: edge.kind, blocksMovement: edge.blocksMovement }
        edge.kind = 'cliff'; edge.blocksMovement = true
        addChange({ id: edge.id, kind: 'outdoor', name: edge.id, action: 'update', layerId: current.document.entityLayers[edge.id], beforeLayerId: current.document.entityLayers[edge.id], fields: ['kind', 'blocksMovement'], before, after: { kind: edge.kind, blocksMovement: edge.blocksMovement } })
      }
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
  // Retain them before strict scene checks, even while the effective candidate awaits materialization.
  const previousDefinitions = new Set(Object.keys(candidate.document.propDefinitions))
  Object.assign(candidate, ensureSourceAssetRoots(candidate))
  for (const definition of Object.values(candidate.document.propDefinitions)) if (!previousDefinitions.has(definition.id)) {
    subjects.set(`propDefinition:${definition.id}`, { subjectKind: 'propDefinition', subjectId: definition.id })
  }
  let commandCost = writes.size + relationshipRecords.size + visualCost
  if (candidate.document.schemaVersion === 3) {
    // History restores change current results and manual protection together;
    // they never copy an old rule's managed ownership back over later edits.
    detachChangedAppearance(current, candidate)
    for (const change of generationRestoreChanges(current.document, candidate.document)) { affected.add(change.id); addChange(change) }
    const expanded = terrainCommandCost(current.document, candidate.document)
    commandCost = Math.max(commandCost, expanded.items.physicalAndVisual) + expanded.total - expanded.items.physicalAndVisual
    if (commandCost > 256) throw new Error('历史恢复、真实几何与生成记录实际展开超过256条操作预算。')
  }
  const checked = validateSceneSnapshot(candidate.document)
  if (!checked.ok) throw new Error(`恢复候选场景无效：${checked.errors.map(value => value.message).join('；')}`)
  candidate.document = checked.document
  validateHistoryIdentity(candidate.historyIdentity, candidate.document)
  // Re-run after materialization as well: a new layer bitmap may enlarge/alter its true player mask.
  projectScene(candidate.document, 'player')
  const changed = !equal(current.document, candidate.document) || !equal(current.appearance, candidate.appearance)
  return { ...candidate, request, changes, affectedIds: [...affected].sort(), inapplicableIds: [...inapplicable].sort(), commandCost, adoptedSubjects: [...subjects.values()], changed }
}
