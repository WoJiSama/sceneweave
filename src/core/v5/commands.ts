import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { roundMmV2 } from '../v2/commands'
import { createPublicVisibilityV2 } from '../v2/visibility'
import { applyCommandsV3, sceneCommandSchemaV3 } from '../v3/commands'
import { geometryDocumentForValidationV3, geometryIdentityIdsV3 } from '../v3/domain'
import { effectiveEditLockedV3, enumerateLayerEntitiesV3 } from '../v3/layers'
import type { PointMm, PropV2, SceneDocumentV3, SurfaceRef } from '../v3/types'
import { advanceHistoryIdentityV5 } from './identity'
import { addPropAppearanceSourceV5, effectiveAdjustmentsV5, equalCompositionValueV5, freezeEffectivePropAppearanceV5, inspectAppearanceScopeV5, propAppearanceSnapshotV5, supportedAppearanceKindsV5, syncAppearanceGraphV5 } from './graph'
import { appearanceAdjustmentSchemaV5, compositionIdSchemaV5, validateCompositionContentV5, validateCompositionDraftV5 } from './schema'
import { COMPOSITION_LIMITS_V5, type AdjustmentKindV5, type AppearanceAdjustmentV5, type AppearanceScopeV5, type CompositionCommandV5, type CompositionContentV5 } from './types'
export type { CompositionCommandV5 } from './types'

const id = compositionIdSchemaV5, integer = z.number().finite().refine(Number.isSafeInteger), point = z.object({ x: integer, y: integer }).strict()
const ids = z.array(id).min(1).max(256).refine(values => new Set(values).size === values.length, 'ID不能重复')
const scope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('targets'), ids }).strict(), z.object({ kind: z.literal('layer'), layerId: id }).strict()])
const surfaceRef = z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict()
const version = z.object({ id, version: z.number().int().positive() }).strict()
const c3Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setAppearanceAdjustment'), scope, adjustment: appearanceAdjustmentSchemaV5 }).strict(),
  z.object({ type: z.literal('toggleAppearanceAdjustment'), scope, adjustmentId: id, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('removeAppearanceAdjustment'), scope, adjustmentId: id }).strict(),
  z.object({ type: z.literal('setAppearanceSource'), ids, sourceId: id }).strict(),
  z.object({ type: z.literal('createPrefab'), id, definitionId: id, name: z.string().trim().min(1).max(80), ids: ids.max(128), anchorMm: point, licenseRef: id.optional(), tags: z.array(z.string().min(1).max(256)).max(64).optional() }).strict(),
  z.object({ type: z.literal('instantiatePrefab'), id, definitionRef: version, memberIds: z.record(id, id), anchorMm: point, rotationDeg: z.number().finite().min(0).lt(360).optional(), layerId: id, supportRef: surfaceRef }).strict(),
  z.object({ type: z.literal('duplicatePrefab'), id, newId: id, memberIds: z.record(id, id), offsetMm: point }).strict(),
  z.object({ type: z.literal('deletePrefab'), id, memberIds: z.array(id).max(128).refine(values => new Set(values).size === values.length) }).strict(),
  z.object({ type: z.literal('detachPrefabMember'), groupId: id, propId: id }).strict(),
  z.object({ type: z.literal('resetPrefabMember'), groupId: id, key: id, newId: id.optional(), supportRef: surfaceRef.optional() }).strict(),
])
const schemas = z.array(z.union([c3Schema, sceneCommandSchemaV3])).max(256)
const c3Types = new Set(['setAppearanceAdjustment', 'toggleAppearanceAdjustment', 'removeAppearanceAdjustment', 'setAppearanceSource', 'createPrefab', 'instantiatePrefab', 'duplicatePrefab', 'deletePrefab', 'detachPrefabMember', 'resetPrefabMember'])
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
const required = <T>(record: Record<string, T>, key: string, label: string): T => { const value = own(record, key); if (!value) throw new Error(`${label}不存在：${key}。`); return value }
function assertUnlocked(document: SceneDocumentV3, ids: readonly string[]): void {
  for (const id of ids) if (effectiveEditLockedV3(document, id)) throw new Error(`实体、成员、图层或依赖已锁定：${id}。`)
}
function assertFresh(content: CompositionContentV5, id: string): void {
  if (geometryIdentityIdsV3(content.document).has(id) || Object.hasOwn(content.document.userLayers, id) || Object.hasOwn(content.historyIdentity.propTokens, id) || Object.hasOwn(content.historyIdentity.prefabTokens, id)) throw new Error(`新身份不能复用已占用/已分配 ID：${id}。`)
}
function assertSupport(document: SceneDocumentV3, floorId: string, ref: SurfaceRef): void {
  if (ref.kind === 'floor') { if (ref.id !== floorId || !own(document.floors, ref.id)) throw new Error('支撑必须属于同一Floor。'); return }
  const support = ref.kind === 'room' ? required(document.rooms, ref.id, '支撑房间') : required(document.terrainAreas, ref.id, '支撑地形')
  if (support.floorId !== floorId) throw new Error('支撑必须属于同一Floor。')
  assertUnlocked(document, [support.id])
  if (ref.kind === 'room') assertSupport(document, floorId, document.rooms[ref.id].supportRef)
}
function topOrder(document: SceneDocumentV3, prop: PropV2): number {
  let rank = -1
  for (const other of Object.values(document.props)) if (other.floorId === prop.floorId && other.renderLayer === prop.renderLayer) rank = Math.max(rank, other.renderOrder)
  if (rank >= 10000) throw new Error('当前系统绘制带顺序达到严格格式上限。')
  return rank + 1
}
function memberOverrides(document: SceneDocumentV3, id: string): void {
  for (const group of [...Object.values(document.prefabInstances), ...Object.values(document.scatterGroups)]) {
    const member = Object.values(group.members).find(member => member.propId === id)
    if (!member) continue
    member.overrideFields = [...new Set([...member.overrideFields, 'definitionRef' as const, 'appearance' as const, 'visualBoundsMm' as const, 'shadowClass' as const, 'shadowOverride' as const])]
    if ('state' in member) member.state = 'manual'
  }
}
function assertIndependent(document: SceneDocumentV3, id: string): PropV2 {
  const prop = required(document.props, id, '物件')
  if ([...Object.values(document.prefabInstances), ...Object.values(document.scatterGroups)].some(group => Object.values(group.members).some(member => member.propId === id))) throw new Error('组合创建只支持独立物件；不能包含其他组合、散布或结构。')
  return prop
}
function transformed(position: PointMm, anchor: PointMm, angle: number): PointMm {
  const a = angle * Math.PI / 180
  return { x: roundMmV2(anchor.x + position.x * Math.cos(a) - position.y * Math.sin(a)), y: roundMmV2(anchor.y + position.x * Math.sin(a) + position.y * Math.cos(a)) }
}
const angle = (value: number) => ((value % 360) + 360) % 360
const memberIdsMatch = (keys: string[], memberIds: Record<string, string>) => keys.length === Object.keys(memberIds).length && keys.every(key => Object.hasOwn(memberIds, key)) && new Set(Object.values(memberIds)).size === keys.length

function createPrefab(content: CompositionContentV5, command: Extract<CompositionCommandV5, { type: 'createPrefab' }>): number {
  const document = content.document, graph = content.appearance, props = command.ids.map(id => assertIndependent(document, id))
  assertFresh(content, command.id); assertFresh(content, command.definitionId)
  if (command.id === command.definitionId) throw new Error('组合与定义必须使用独立ID。')
  assertUnlocked(document, command.ids)
  const floorId = props[0].floorId, layerId = document.entityLayers[props[0].id]
  if (props.some(prop => prop.floorId !== floorId || document.entityLayers[prop.id] !== layerId)) throw new Error('创建组合的成员须属于同一Floor和用户图层；请先明确移层。')
  const visibility = createPublicVisibilityV2(geometryDocumentForValidationV3(document)), privateTemplate = props.some(prop => !visibility.prop(prop))
  const licenseRef = command.licenseRef ?? props.flatMap(prop => prop.definitionRef ? [document.propDefinitions[prop.definitionRef.id].licenseRef] : prop.appearance.kind === 'image' ? [document.assets[prop.appearance.assetId].licenseRef] : []).at(0) ?? Object.values(document.propDefinitions)[0]?.licenseRef
  if (!licenseRef) throw new Error('新组合须有明确、已采用的许可。')
  const knownLicense = [...Object.values(document.assets), ...Object.values(document.propDefinitions), ...Object.values(document.prefabDefinitions), ...Object.values(document.materials)].some(item => item.licenseRef === licenseRef)
  if (!knownLicense) throw new Error('组合许可必须来自当前完整工程的已采用许可。')
  const members = props.map((prop, index) => {
    const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, roomId: _room, supportRef: _support, ...template } = structuredClone(prop)
    template.positionMm = { x: prop.positionMm.x - command.anchorMm.x, y: prop.positionMm.y - command.anchorMm.y }
    return { key: `member-${index + 1}`, propTemplate: template }
  })
  document.prefabDefinitions[command.definitionId] = { id: command.definitionId, catalogId: command.definitionId, version: 1, licenseRef, origin: { kind: 'original', attribution: 'Sceneweave user composition; member assets retain their individual provenance and licenses.', canEmbed: true }, name: command.name, tags: command.tags ?? [], members }
  document.prefabInstances[command.id] = { id: command.id, floorId, editLocked: false, visibility: privateTemplate ? 'gm' : 'public', definitionRef: { id: command.definitionId, version: 1 }, anchorMm: structuredClone(command.anchorMm), rotationDeg: 0, members: Object.fromEntries(members.map((member, index) => [member.key, { propId: props[index].id, overrideFields: [] }])) }
  document.entityLayers[command.id] = layerId
  graph.prefabAppearanceTemplates[command.definitionId] = { definitionRef: { id: command.definitionId, version: 1 }, visibility: privateTemplate ? 'gm' : 'public', members: {} }
  for (let index = 0; index < props.length; index++) {
    const prop = props[index], frozen = freezeEffectivePropAppearanceV5(content, prop.id, prop)
    // The reusable fixed template captures this selection, never a live link to its old layer.
    Object.assign(graph.sources, frozen.appearance.sources)
    graph.prefabAppearanceTemplates[command.definitionId].members[members[index].key] = { sourceId: frozen.appearance.propSources[prop.id], adjustments: frozen.appearance.instanceAdjustments[prop.id] }
  }
  return props.length + 2
}

function instantiate(content: CompositionContentV5, command: Extract<CompositionCommandV5, { type: 'instantiatePrefab' }>): number {
  const document = content.document, graph = content.appearance, definition = required(document.prefabDefinitions, command.definitionRef.id, '固定组合定义')
  if (definition.version !== command.definitionRef.version) throw new Error('组合固定定义版本不匹配。')
  const template = required(graph.prefabAppearanceTemplates, definition.id, '组合外观模板'), layer = required(document.userLayers, command.layerId, '用户图层')
  if (layer.editLocked) throw new Error('目标图层已锁定。')
  assertFresh(content, command.id); assertSupport(document, layer.floorId, command.supportRef)
  if (!memberIdsMatch(definition.members.map(member => member.key), command.memberIds) || Object.values(command.memberIds).includes(command.id)) throw new Error('组合放置须为每个固定成员明确给出不同新ID。')
  const rotation = command.rotationDeg ?? 0, privatePlacement = template.visibility === 'gm' || !createPublicVisibilityV2(geometryDocumentForValidationV3(document)).surface(command.supportRef)
  document.prefabInstances[command.id] = { id: command.id, floorId: layer.floorId, editLocked: false, visibility: privatePlacement ? 'gm' : 'public', definitionRef: structuredClone(command.definitionRef), anchorMm: structuredClone(command.anchorMm), rotationDeg: rotation, members: {} }
  document.entityLayers[command.id] = layer.id
  for (const member of definition.members) {
    const id = command.memberIds[member.key]; assertFresh(content, id)
    const prop: PropV2 = { ...structuredClone(member.propTemplate), id, floorId: layer.floorId, editLocked: false, visibility: privatePlacement ? 'gm' : 'public', supportRef: structuredClone(command.supportRef), ...(command.supportRef.kind === 'room' ? { roomId: command.supportRef.id } : {}), positionMm: transformed(member.propTemplate.positionMm, command.anchorMm, rotation), rotationDeg: angle(member.propTemplate.rotationDeg + rotation) }
    prop.renderOrder = topOrder(document, prop); document.props[id] = prop; document.entityLayers[id] = layer.id
    document.prefabInstances[command.id].members[member.key] = { propId: id, overrideFields: [] }
    graph.propSources[id] = template.members[member.key].sourceId; graph.instanceAdjustments[id] = structuredClone(template.members[member.key].adjustments)
  }
  return definition.members.length + 1
}
function duplicate(content: CompositionContentV5, command: Extract<CompositionCommandV5, { type: 'duplicatePrefab' }>): number {
  const document = content.document, graph = content.appearance, source = required(document.prefabInstances, command.id, '组合'), entries = Object.entries(source.members).filter(([, member]) => member.propId !== null)
  if (!memberIdsMatch(entries.map(([key]) => key), command.memberIds) || Object.values(command.memberIds).includes(command.newId)) throw new Error('复制组合须为实际活成员明确给出不同新ID；已删除槽保持删除。')
  assertUnlocked(document, [source.id, ...entries.map(([, member]) => member.propId!) ]); assertFresh(content, command.newId)
  const visibility = createPublicVisibilityV2(geometryDocumentForValidationV3(document)), group = structuredClone(source)
  group.id = command.newId; group.editLocked = false; group.anchorMm = { x: source.anchorMm.x + command.offsetMm.x, y: source.anchorMm.y + command.offsetMm.y }
  document.prefabInstances[group.id] = group; document.entityLayers[group.id] = document.entityLayers[source.id]
  const ranks = { ground: 0, object: 1, canopy: 2 }
  entries.sort(([, a], [, b]) => { const x = document.props[a.propId!], y = document.props[b.propId!]; return ranks[x.renderLayer] - ranks[y.renderLayer] || x.renderOrder - y.renderOrder || x.id.localeCompare(y.id) })
  for (const [key, member] of entries) {
    const original = document.props[member.propId!], id = command.memberIds[key]; assertFresh(content, id)
    assertSupport(document, original.floorId, original.supportRef)
    if (original.roomId !== undefined) assertSupport(document, original.floorId, { kind: 'room', id: original.roomId })
    const prop = structuredClone(original); prop.id = id; prop.editLocked = false
    prop.positionMm = { x: original.positionMm.x + command.offsetMm.x, y: original.positionMm.y + command.offsetMm.y }
    if (!visibility.prop(original)) prop.visibility = 'gm'
    prop.renderOrder = topOrder(document, prop); document.props[id] = prop; document.entityLayers[id] = document.entityLayers[original.id]
    group.members[key].propId = id; graph.propSources[id] = graph.propSources[original.id]
    if (own(graph.instanceAdjustments, original.id)) graph.instanceAdjustments[id] = structuredClone(graph.instanceAdjustments[original.id])
  }
  return entries.length + 1
}
function resetMember(content: CompositionContentV5, command: Extract<CompositionCommandV5, { type: 'resetPrefabMember' }>): number {
  const document = content.document, graph = content.appearance, group = required(document.prefabInstances, command.groupId, '组合'), member = required(group.members, command.key, '组合成员槽')
  const definition = document.prefabDefinitions[group.definitionRef.id], template = definition.members.find(member => member.key === command.key)!
  const current = member.propId === null ? undefined : required(document.props, member.propId, '成员物件')
  assertUnlocked(document, [group.id, ...(current ? [current.id] : [])])
  if (current && command.newId !== undefined) throw new Error('现有成员重置须保留原身份。')
  if (!current && (!command.newId || !command.supportRef)) throw new Error('已删除成员重建须明确新ID和支撑表面。')
  const id = current?.id ?? command.newId!, support = command.supportRef ?? current!.supportRef
  if (!current) assertFresh(content, id)
  assertSupport(document, group.floorId, support)
  const visibility = createPublicVisibilityV2(geometryDocumentForValidationV3(document))
  const privatePlacement = group.visibility === 'gm' || graph.prefabAppearanceTemplates[definition.id].visibility === 'gm' || (current !== undefined && !visibility.prop(current)) || !visibility.surface(support)
  const prop: PropV2 = { ...structuredClone(template.propTemplate), id, floorId: group.floorId, editLocked: false, supportRef: structuredClone(support), ...(support.kind === 'room' ? { roomId: support.id } : {}), visibility: privatePlacement ? 'gm' : 'public', positionMm: transformed(template.propTemplate.positionMm, group.anchorMm, group.rotationDeg), rotationDeg: angle(template.propTemplate.rotationDeg + group.rotationDeg) }
  prop.renderOrder = current?.renderOrder ?? topOrder(document, prop); document.props[id] = prop; document.entityLayers[id] = document.entityLayers[group.id]
  group.members[command.key] = { propId: id, overrideFields: [] }
  const appearance = graph.prefabAppearanceTemplates[definition.id].members[command.key]
  graph.propSources[id] = appearance.sourceId; graph.instanceAdjustments[id] = structuredClone(appearance.adjustments)
  return 2
}

/** Pure draft only. IO must materialize required bytes, resolve and fully validate before adoption. */
export function applyCompositionCommandsV5(input: CompositionContentV5, inputCommands: readonly CompositionCommandV5[]): CompositionContentV5 {
  const source = validateCompositionContentV5(input), issue = inspectJsonInput(inputCommands)
  if (issue) throw new Error(`组合指令无效：${issue.message}`)
  const parsed = schemas.safeParse(inputCommands)
  if (!parsed.success) throw new Error(`组合指令无效，单事务最多256条：${parsed.error.issues.map(issue => issue.message).join('；')}`)
  const commands = parsed.data as CompositionCommandV5[]
  if (!commands.length) return source
  const isComposition = commands.map(command => c3Types.has(command.type))
  if (isComposition.some(Boolean) && isComposition.some(value => !value)) throw new Error('外观/组件操作与普通场景操作须分别预览采用，不能混批绕过锁或资源准备。')
  let content = structuredClone(source), cost = 0
  const consume = (value: number) => { cost += value; if (cost > 256) throw new Error('展开后的组合事务超过256条操作预算，不能拆批绕过。') }
  if (!isComposition[0]) {
    const legacy = commands as import('../v3/commands').SceneCommandV3[]
    content.document = applyCommandsV3(source.document, legacy)
    const previousEntities = new Map(enumerateLayerEntitiesV3(source.document).map(entity => [entity.id, entity]))
    const currentEntities = new Map(enumerateLayerEntitiesV3(content.document).map(entity => [entity.id, entity]))
    const changed = new Set([...previousEntities.keys(), ...currentEntities.keys()].filter(id => !equalCompositionValueV5(previousEntities.get(id), currentEntities.get(id))))
    // Relationship-only operations still touch their members even when their JSON is otherwise unchanged.
    for (const command of legacy) if (command.type === 'unpackPrefab') {
      changed.add(command.id)
      for (const member of Object.values(source.document.prefabInstances[command.id]?.members ?? {})) if (member.propId !== null) changed.add(member.propId)
    }
    consume(Math.max(commands.length, changed.size))
    content = syncAppearanceGraphV5(content, source.document, legacy)
  } else {
    const appearanceOnly = commands.every(command => ['setAppearanceAdjustment', 'toggleAppearanceAdjustment', 'removeAppearanceAdjustment', 'setAppearanceSource'].includes(command.type))
    const anyAppearance = commands.some(command => ['setAppearanceAdjustment', 'toggleAppearanceAdjustment', 'removeAppearanceAdjustment', 'setAppearanceSource'].includes(command.type))
    if (anyAppearance && !appearanceOnly) throw new Error('新外观派生须先完成资源准备，再保存/放置固定组合。')
    for (const command of commands) {
      switch (command.type) {
        case 'setAppearanceAdjustment': case 'toggleAppearanceAdjustment': case 'removeAppearanceAdjustment': {
          const graph = content.appearance, record = command.scope.kind === 'layer' ? graph.layerAdjustments : graph.instanceAdjustments
          let kinds: AdjustmentKindV5[]
          if (command.type === 'setAppearanceAdjustment') kinds = [command.adjustment.kind]
          else {
            const keys = command.scope.kind === 'layer' ? [command.scope.layerId] : inspectAppearanceScopeV5(content, command.scope).targetIds
            kinds = [...new Set(keys.map(key => {
              const existing = (record[key] ?? []).find(item => item.id === command.adjustmentId)
              if (!existing) throw new Error(`调整记录不存在：${key}/${command.adjustmentId}。`)
              return existing.kind
            }))]
          }
          const plan = inspectAppearanceScopeV5(content, command.scope, kinds); consume(plan.commandCost)
          const keys = command.scope.kind === 'layer' ? [command.scope.layerId] : plan.targetIds
          for (const key of keys) {
            const list = record[key] ?? [], adjustmentId = command.type === 'setAppearanceAdjustment' ? command.adjustment.id : command.adjustmentId, existing = list.find(item => item.id === adjustmentId)
            const enabledAdjustment = command.type === 'setAppearanceAdjustment' ? (command.adjustment.enabled ? command.adjustment : undefined) : command.type === 'toggleAppearanceAdjustment' && command.enabled ? existing : undefined
            if (enabledAdjustment?.kind === 'opacity' && enabledAdjustment.value !== 1 && plan.targetIds.some(id => Object.hasOwn(content.appearance.surfaceSources, id))) throw new Error('严格v3材质底面必须完全不透明；包含材质表面的范围不能采用小于1的透明度。')
            if (command.type === 'setAppearanceAdjustment') {
              if (existing && existing.kind !== command.adjustment.kind) throw new Error('调整记录的固定ID不能改为另一属性。')
              record[key] = [...list.filter(item => item.id !== adjustmentId).map(item => command.adjustment.enabled && item.kind === command.adjustment.kind ? { ...item, enabled: false } : item), structuredClone(command.adjustment)]
            } else if (command.type === 'toggleAppearanceAdjustment') {
              if (command.enabled) for (const item of list) if (item.kind === existing!.kind) item.enabled = false
              existing!.enabled = command.enabled
            }
            else record[key] = list.filter(item => item.id !== adjustmentId)
          }
          if (command.scope.kind === 'targets') plan.targetIds.forEach(id => memberOverrides(content.document, id))
          break
        }
        case 'setAppearanceSource': {
          const sourceNode = required(content.appearance.sources, command.sourceId, '固定外观源'), plan = inspectAppearanceScopeV5(content, { kind: 'targets', ids: command.ids })
          consume(plan.commandCost)
          for (const id of plan.targetIds) {
            if (sourceNode.kind === 'prop' && own(content.document.props, id)) content.appearance.propSources[id] = sourceNode.id
            else if (sourceNode.kind === 'surface' && !own(content.document.props, id)) content.appearance.surfaceSources[id] = sourceNode.id
            else throw new Error('外观源类型与显式目标不符。')
            memberOverrides(content.document, id)
          }
          break
        }
        case 'createPrefab': consume(createPrefab(content, command)); break
        case 'instantiatePrefab': consume(instantiate(content, command)); break
        case 'duplicatePrefab': consume(duplicate(content, command)); break
        case 'resetPrefabMember': consume(resetMember(content, command)); break
        case 'detachPrefabMember': {
          const group = required(content.document.prefabInstances, command.groupId, '组合'), prop = required(content.document.props, command.propId, '成员物件'), member = Object.values(group.members).find(member => member.propId === prop.id)
          if (!member) throw new Error('此物件不是指定组合的活成员。')
          assertUnlocked(content.document, [group.id, prop.id]); consume(2)
          if (!createPublicVisibilityV2(geometryDocumentForValidationV3(content.document)).prop(prop)) prop.visibility = 'gm'
          member.propId = null
          break
        }
        case 'deletePrefab': {
          const document = content.document, group = required(document.prefabInstances, command.id, '组合'), live = Object.values(group.members).flatMap(member => member.propId ?? [])
          if (command.memberIds.length !== live.length || live.some(id => !command.memberIds.includes(id))) throw new Error('删除组合须明确确认全部当前活成员，不能隐式展开。')
          assertUnlocked(document, [group.id, ...live]); consume(live.length + 1)
          if (Object.values(document.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === group.id) || document.constraints.pathChecks.some(check => [check.from, check.to].some(anchor => anchor.type === 'entity' && anchor.entityId === group.id))) throw new Error('组合仍有注记/路径依赖，不能删除。')
          content.document = live.length ? applyCommandsV3(document, live.map(id => ({ type: 'deleteProp', id }))) : document
          delete content.document.prefabInstances[group.id]; delete content.document.entityLayers[group.id]
          break
        }
        default: throw new Error('不支持的组合操作。')
      }
    }
    content = syncAppearanceGraphV5(content)
  }
  content.historyIdentity = advanceHistoryIdentityV5(source.historyIdentity, source.document, content.document)
  return validateCompositionDraftV5(content)
}
